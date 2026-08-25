/**
 * Rummy — Gin Rummy for exactly two people and one phone.
 *
 * Two is not a compromise here, it is the reason this game fits a phone at all.
 * A melding hand has to be readable as *structure* — these three are a run,
 * those three are a set, the rest is what you are carrying — and that costs a
 * lot of screen. Ten cards laid out as groups with the loose cards fanned
 * underneath fills most of a 390-wide display on its own. Gin Rummy is a two
 * hander by definition, so there is exactly one hand on screen at a time and it
 * can have the whole board.
 *
 * The interesting problem is not the dealing, it is the reading. A card can
 * belong to a set or to a run but never to both, so "what is my deadwood"
 * is a small optimisation problem rather than a scan. Four tens and the eight
 * and nine of spades is the trap: grab the four-of-a-kind because it is the
 * biggest meld and the eight and nine are stranded for seventeen, where taking
 * the run first leaves three tens which is still a set and nothing at all in
 * hand. The bit solves it exactly — every candidate meld, then a memoised
 * search over which of them to actually use — because a player who has to do
 * that arithmetic themselves is playing a different, worse game.
 *
 * Hidden hands are gated by a physical handover card that names who should be
 * holding the phone, and it is dismissed with a TAP rather than held open: the
 * screen behind it has to be tapped a dozen times to draw and discard, and
 * holding the cover open would take a third hand. Exposure is bounded by the
 * player's own commit instead — the discard closes the cover again, so the
 * phone is never left sitting on somebody's hand.
 *
 * After a knock nothing is secret any more: both hands go face up, the
 * defender lays off onto the knocker's melds, and the whole settlement plays
 * out on one screen with no cover at all. Putting a privacy gate there would be
 * theatre.
 *
 * Contract notes: no packaged assets (maxAssets is 0), so all 52 faces and the
 * back are canvas paths baked into OffscreenCanvases with a live-draw fallback.
 * The overlay is one markup string on ctx.createRoot() with pointer-events off
 * on the root, because that element is created after the canvas and would
 * otherwise swallow every tap. Pointer maths uses offsetX/offsetY, never
 * getBoundingClientRect. Every timer is anchored to a performance.now()
 * timestamp, never accumulated from frame deltas.
 */
window.plethoraBit = {
  meta: {
    title: "Rummy",
    runtime: "plethora-bit@2",
    tags: ["cards", "multiplayer", "local-multiplayer", "two-player", "classic"],
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

    const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
    const esc = (s) => String(s).replace(/[&<>"']/g,
      (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/* ===== RULES START ===== */
    /**
     * Gin Rummy, as rules rather than as a screen.
     *
     * Everything below is self-contained on purpose: tools/harness/rules-rummy.mjs
     * lifts this block straight out of the file and calls it, so it must not
     * reach for anything defined outside the markers. A card is any object with
     * { rank, suit }.
     */
    const R_RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
    const R_SUITS = ["S", "H", "D", "C"];
    const rankIx = (r) => R_RANKS.indexOf(r);

    /** Aces are one, faces are ten, everything else is its own pips. */
    function cardValue(c) {
      const i = rankIx(c.rank);
      return i >= 9 ? 10 : i + 1;
    }
    const handValue = (cards) => cards.reduce((a, c) => a + cardValue(c), 0);

    /** A meld of two or more same-rank cards is a set; anything else is a run. */
    function meldKind(m) {
      return m.length > 1 && m[0].rank === m[1].rank ? "set" : "run";
    }

    /** Sets read by suit, runs read by rank. Sorting them is purely cosmetic. */
    function sortMeld(m) {
      if (meldKind(m) === "set") m.sort((a, b) => R_SUITS.indexOf(a.suit) - R_SUITS.indexOf(b.suit));
      else m.sort((a, b) => rankIx(a.rank) - rankIx(b.rank));
      return m;
    }

    /**
     * Every meld that could be formed from this hand, as index lists.
     *
     * Four of a kind yields the four-card set AND all four of its three-card
     * subsets, because dropping one member of a quad is often what frees the
     * card a run needs. Runs yield every contiguous stretch of three or more
     * rather than only the maximal one, for the same reason.
     */
    function candidateMelds(cards) {
      const out = [];
      const byRank = {};
      cards.forEach((c, i) => { (byRank[c.rank] || (byRank[c.rank] = [])).push(i); });
      for (const r of Object.keys(byRank)) {
        const idx = byRank[r];
        if (idx.length < 3) continue;
        out.push({ kind: "set", idx: idx.slice() });
        if (idx.length === 4) {
          for (let k = 0; k < 4; k++) out.push({ kind: "set", idx: idx.filter((_, j) => j !== k) });
        }
      }
      const bySuit = {};
      cards.forEach((c, i) => { (bySuit[c.suit] || (bySuit[c.suit] = [])).push(i); });
      for (const s of Object.keys(bySuit)) {
        const idx = bySuit[s].slice().sort((a, b) => rankIx(cards[a].rank) - rankIx(cards[b].rank));
        for (let a = 0; a < idx.length; a++) {
          const run = [idx[a]];
          for (let b = a + 1; b < idx.length; b++) {
            if (rankIx(cards[idx[b]].rank) !== rankIx(cards[run[run.length - 1]].rank) + 1) break;
            run.push(idx[b]);
            if (run.length >= 3) out.push({ kind: "run", idx: run.slice() });
          }
        }
      }
      return out;
    }

    /**
     * The arrangement that leaves the least deadwood.
     *
     * This is the whole point of the bit. A card can be in a set or in a run but
     * never in both, so picking melds greedily — biggest first, or sets before
     * runs — is wrong often enough to matter. Four tens with the eight and nine
     * of spades is the standard trap: the quad is the fattest meld on the table
     * and taking it strands seventeen points, where the run of three takes the
     * ten of spades out and leaves a perfectly good set of three tens behind.
     *
     * So: enumerate every candidate meld, then search over which of them to
     * actually use. The search always branches on the lowest still-unassigned
     * card, which makes the state exactly "the set of cards not yet spoken for"
     * and lets a memo on that bitmask collapse the whole thing. Eleven cards is
     * 2048 states, which is nothing.
     */
    function bestArrangement(cards) {
      const n = cards.length;
      const cand = candidateMelds(cards);
      const masks = cand.map((m) => m.idx.reduce((a, i) => a | (1 << i), 0));
      const vals = cards.map(cardValue);
      const memo = new Map();

      function solve(mask) {
        if (mask === 0) return { dw: 0, use: [] };
        const hit = memo.get(mask);
        if (hit) return hit;
        let low = 0;
        while (!((mask >> low) & 1)) low++;
        const rest = solve(mask & ~(1 << low));
        let best = { dw: vals[low] + rest.dw, use: rest.use };
        for (let m = 0; m < cand.length; m++) {
          if (!(masks[m] & (1 << low))) continue;
          if ((masks[m] & mask) !== masks[m]) continue;
          const r = solve(mask & ~masks[m]);
          if (r.dw < best.dw) best = { dw: r.dw, use: [m].concat(r.use) };
        }
        memo.set(mask, best);
        return best;
      }

      const res = solve(n === 0 ? 0 : (1 << n) - 1);
      const spoken = new Set();
      const melds = res.use.map((mi) => {
        const m = cand[mi].idx.map((i) => { spoken.add(i); return cards[i]; });
        return sortMeld(m);
      });
      // Melds read in a stable order so the layout does not shuffle itself
      // between frames: runs first, then sets, each by their lowest rank.
      melds.sort((a, b) => {
        const ka = meldKind(a) === "run" ? 0 : 1, kb = meldKind(b) === "run" ? 0 : 1;
        if (ka !== kb) return ka - kb;
        return rankIx(a[0].rank) - rankIx(b[0].rank);
      });
      const dead = cards.filter((_, i) => !spoken.has(i))
        .sort((a, b) => cardValue(b) - cardValue(a) || R_SUITS.indexOf(a.suit) - R_SUITS.indexOf(b.suit));
      return { melds, dead, deadwood: res.dw, melded: n - dead.length };
    }

    /**
     * May this card be laid off onto that meld?
     *
     * A set takes a fourth card of its rank. A run takes a card of its own suit
     * at either end — and only there, because aces are low in gin: there is no
     * queen-king-ace.
     */
    function canLayOff(card, meld) {
      if (meldKind(meld) === "set") {
        return meld.length < 4 && card.rank === meld[0].rank &&
               !meld.some((c) => c.suit === card.suit);
      }
      if (card.suit !== meld[0].suit) return false;
      const ix = meld.map((c) => rankIx(c.rank));
      const lo = Math.min.apply(null, ix), hi = Math.max.apply(null, ix);
      const ci = rankIx(card.rank);
      return ci === lo - 1 || ci === hi + 1;
    }

    /** Which of the knocker's melds this card could join, if any. */
    function layOffTarget(card, melds) {
      for (let i = 0; i < melds.length; i++) if (canLayOff(card, melds[i])) return i;
      return -1;
    }

    /**
     * Lay every card that can go, fattest first, repeating until nothing moves.
     *
     * The loop matters: laying a nine onto a run of six-seven-eight puts a ten
     * within reach that was not before. Fattest-first is not a heuristic here,
     * it is optimal — a run never refuses a card it could take, and the only
     * thing that can block is a set filling its fourth slot, where the two
     * contenders are the same rank and therefore the same points.
     *
     * `melds` is mutated, so callers hand it a clone.
     */
    function layOffAll(deadwood, melds) {
      const rest = deadwood.slice();
      const laid = [];
      for (;;) {
        let bi = -1, bm = -1, bv = -1;
        for (let i = 0; i < rest.length; i++) {
          const m = layOffTarget(rest[i], melds);
          if (m >= 0 && cardValue(rest[i]) > bv) { bv = cardValue(rest[i]); bi = i; bm = m; }
        }
        if (bi < 0) break;
        const card = rest.splice(bi, 1)[0];
        melds[bm].push(card);
        sortMeld(melds[bm]);
        laid.push({ card, meld: bm });
      }
      return { laid, remaining: rest, deadwood: handValue(rest) };
    }

    /**
     * Settle a knock.
     *
     * Gin is zero deadwood: twenty-five plus everything the defender is holding,
     * and no lay-offs at all. Otherwise the difference goes to the knocker —
     * unless the defender got to the same number or below, which is the
     * undercut, and then the difference plus twenty-five goes the other way.
     * Equal deadwood is an undercut worth exactly the twenty-five.
     */
    function scoreKnock(knockDeadwood, defenderDeadwood, gin) {
      if (gin) {
        return { winner: "knocker", points: defenderDeadwood + 25, gin: true, undercut: false };
      }
      if (defenderDeadwood <= knockDeadwood) {
        return {
          winner: "defender",
          points: (knockDeadwood - defenderDeadwood) + 25,
          gin: false, undercut: true,
        };
      }
      return {
        winner: "knocker",
        points: defenderDeadwood - knockDeadwood,
        gin: false, undercut: false,
      };
    }

    /** Ten or under and you may knock; nothing at all and it is gin. */
    const canKnock = (deadwood) => deadwood <= 10;

    /**
     * For each card in an eleven-card hand, the deadwood left if you throw it.
     * Drives the knock affordance and the optional hint ring.
     */
    function discardOutcomes(hand) {
      return hand.map((c, i) => {
        const rest = hand.slice(0, i).concat(hand.slice(i + 1));
        return { card: c, deadwood: bestArrangement(rest).deadwood };
      });
    }
/* ===== RULES END ===== */

    /* ---------------------------------------------------------------
     * Settings, persisted
     * ------------------------------------------------------------- */
    const FELTS = {
      burgundy: { hi: "#7A2C3E", mid: "#551C2A", lo: "#33101A", name: "Burgundy" },
      forest:   { hi: "#2E5B44", mid: "#1E4130", lo: "#10261C", name: "Forest" },
      indigo:   { hi: "#2E3B66", mid: "#1F2848", lo: "#11162B", name: "Indigo" },
    };
    const saved = (function () {
      try { return ctx.storage.get("rummy") || {}; } catch (_) { return {}; }
    })();
    const settings = {
      target: [50, 100, 250].indexOf(saved.target) >= 0 ? saved.target : 100,
      felt: FELTS[saved.felt] ? saved.felt : "burgundy",
      hints: saved.hints === undefined ? true : !!saved.hints,
      mute: !!saved.mute,
      names: Array.isArray(saved.names) ? saved.names.slice(0, 2) : ["", ""],
    };
    function saveSettings() { try { ctx.storage.set("rummy", settings); } catch (_) {} }

    /* ---------------------------------------------------------------
     * Sound. Every call is wrapped: audio is a nicety and must never
     * break a hand of cards.
     * ------------------------------------------------------------- */
    const sound = (function () {
      let muted = settings.mute, bed = null, unlocked = false;
      const start = () => ctx.music.play({ preset: "cozy", volume: 0.2, tempo: 92, intensity: 0.32 });
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
     * Palette and layout
     * ------------------------------------------------------------- */
    const WOOD_HI = "#7A4A26", WOOD = "#4A2A15", WOOD_LO = "#26150A";
    const BRASS = "#C9A05C", GOLD = "#EFC96B", PARCH = "#F6EBD8";
    const SEATS = [
      { key: "a", css: "#F0B347", ink: "#3A2210", fallback: "Player 1" },
      { key: "b", css: "#7FC6A4", ink: "#0F2A1E", fallback: "Player 2" },
    ];

    let W = ctx.width, H = ctx.height;
    const L = {};
    function measure() {
      W = ctx.width; H = ctx.height;
      L.ST = ctx.safeArea.top; L.SB = ctx.safeArea.bottom;
      L.feltX = 11; L.feltW = W - 22;
      L.feltY = L.ST + 52;
      L.ledgeH = 134;
      L.feltB = H - L.SB - L.ledgeH;
      L.feltH = L.feltB - L.feltY;

      L.pw = Math.min(78, W * 0.20); L.ph = L.pw * 1.4;
      L.hw = Math.min(56, W * 0.1436); L.hh = L.hw * 1.4;

      // Fixed anchors rather than a stack that grows off whatever is above it.
      // The deadwood fan in particular never moves: it is the thing a thumb
      // reaches for a dozen times a hand, and a target that slides around as
      // melds form is a target you have to look for every time.
      const F = L.feltH / 575;                    // scales the rhythm on other screens
      L.oppY = L.feltY + 42 * F;
      L.pileY = L.feltY + 140 * F;
      L.meldRow = L.hh + 10;
      L.deadLabelY = L.feltB - 128 * F;
      L.trayBot = L.deadLabelY - 16 * F;      // the tray's floor is fixed; it grows upward
      L.deadY = L.feltB - 70 * F;
      L.stockX = W / 2 - L.pw * 0.62 - 5;
      L.discX = W / 2 + L.pw * 0.62 + 5;

      // Showdown uses a smaller card so two whole hands fit on one screen.
      L.sw = Math.min(43, W * 0.111); L.sh = L.sw * 1.4;
    }
    measure();

    /* ---------------------------------------------------------------
     * State
     * ------------------------------------------------------------- */
    let phase = "menu";        // menu | deal | handoff | draw | discard | throwing | knock | layoff | result | over
    let players = null;        // [{ name, css, score }]
    let hands = [[], []];
    let stock = [], discard = [];
    let turn = 0, dealer = 1, handNo = 0;
    let revealed = false;      // is the current player's hand face up?
    let selected = null;       // card id chosen for the discard
    let drewFrom = null;       // "stock" | "discard"
    let tookId = null;         // the upcard just taken — it may not go straight back
    let show = null;           // the knock settlement
    let result = null;         // the round result sheet
    let winner = -1;
    let lockUntil = 0;         // input is dead until the commit's animation lands
    let meldSig = "";          // used to notice a NEW meld forming
    let lastHeat = -1;
    let shake = 0;
    let bandPulse = 0;

    const busy = () => performance.now() < lockUntil;
    const lock = (ms) => { lockUntil = Math.max(lockUntil, performance.now() + ms); };

    /* ---------------------------------------------------------------
     * Sprites. Every card on screen is one of these, and it springs
     * toward whatever target the current layout gives it — so a hand
     * re-sorting itself after a draw is the same code path as a card
     * flying out of the stock.
     * ------------------------------------------------------------- */
    const sprites = new Map();
    function sprite(card, spawn) {
      let s = sprites.get(card.id);
      if (!s) {
        s = {
          card, x: spawn.x, y: spawn.y, rot: spawn.rot || 0, sc: spawn.sc || 1,
          vx: 0, vy: 0, vr: 0, a: spawn.a === undefined ? 1 : spawn.a, ta: 1,
          face: !!spawn.face, faceWant: !!spawn.face, flipAt: 0,
          tx: spawn.x, ty: spawn.y, trot: spawn.rot || 0, tsc: spawn.sc || 1, z: 0,
        };
        sprites.set(card.id, s);
      }
      return s;
    }

    /** Hand the sprite list this frame's targets; anything unlisted fades out. */
    function applyTargets(items) {
      const seen = new Set();
      for (const it of items) {
        seen.add(it.card.id);
        const s = sprite(it.card, it.spawn || { x: it.x, y: it.y, face: it.face, a: 0 });
        s.card = it.card;
        s.tx = it.x; s.ty = it.y; s.trot = it.rot || 0; s.tsc = it.sc || 1;
        s.z = it.z || 0; s.ta = 1; s.glow = it.glow || null; s.dim = !!it.dim;
        if (!!it.face !== s.faceWant) { s.faceWant = !!it.face; s.flipAt = performance.now(); }
      }
      for (const [id, s] of sprites) if (!seen.has(id)) { s.ta = 0; if (s.a < 0.02) sprites.delete(id); }
    }

    function stepSprites(dt) {
      const K = 260, D = 25;
      const now = performance.now();
      for (const s of sprites) {
        const p = s[1];
        p.vx += ((p.tx - p.x) * K - p.vx * D) * dt;
        p.vy += ((p.ty - p.y) * K - p.vy * D) * dt;
        p.vr += ((p.trot - p.rot) * K - p.vr * D) * dt;
        p.x += p.vx * dt; p.y += p.vy * dt; p.rot += p.vr * dt;
        p.sc += (p.tsc - p.sc) * Math.min(1, dt * 14);
        p.a += (p.ta - p.a) * Math.min(1, dt * 11);
        if (p.flipAt) {
          const t = (now - p.flipAt) / 240;
          if (t >= 1) { p.flipAt = 0; p.face = p.faceWant; }
          else if (t >= 0.5) p.face = p.faceWant;
        }
      }
    }
    /** Horizontal squeeze of a card mid-flip; 1 when it is not flipping. */
    function flipScale(s) {
      if (!s.flipAt) return 1;
      const t = clamp((performance.now() - s.flipAt) / 240, 0, 1);
      return Math.abs(Math.cos(t * Math.PI));
    }

    /* ---------------------------------------------------------------
     * The deal
     * ------------------------------------------------------------- */
    function newMatch() {
      players = SEATS.map((s, i) => ({
        name: (settings.names[i] || "").trim().slice(0, 12) || s.fallback,
        css: s.css, ink: s.ink, score: 0,
      }));
      handNo = 0; dealer = 1; winner = -1; result = null; show = null;
      dealRound();
    }

    function dealRound() {
      sprites.clear();
      const d = freshDeck();
      hands = [d.splice(0, 10), d.splice(0, 10)];
      discard = [d.pop()];
      stock = d;
      turn = 1 - dealer;             // non-dealer leads
      handNo++;
      selected = null; drewFrom = null; tookId = null; show = null; result = null;
      revealed = false;
      phase = "deal";
      meldSig = "";
      // Every card spawns on the stock and springs out of it, so the deal reads
      // as a deal rather than as a screen that changed.
      const sp = { x: L.stockX, y: L.pileY, face: false, a: 1, sc: L.pw / L.hw };
      for (const h of hands) for (const c of h) sprite(c, sp);
      sprite(discard[0], sp);
      lock(1120);
      sound.sting("coin");
      sound.haptic("medium");
      ctx.timeout(() => { if (phase === "deal") openHandoff(); }, 1040);
    }

    function openHandoff() {
      phase = "handoff";
      revealed = false;
      selected = null; drewFrom = null; tookId = null;
      const p = players[turn];
      el("cover-name").textContent = p.name;
      el("cover-name").style.color = p.css;
      el("cover-go").style.background = p.css;
      el("cover-go").style.color = p.ink;
      el("cover-go").textContent = "I'm " + p.name + " — show my hand";
      el("cover-sub").textContent = stock.length <= 2
        ? "last cards — the stock is nearly out"
        : "hand " + handNo + " · first to " + settings.target;
      el("cover-scores").innerHTML = players.map((q) =>
        '<span style="color:' + q.css + ';opacity:' + (q === p ? 1 : 0.55) + ';">' +
        esc(q.name) + ' <span style="color:' + PARCH + ';">' + q.score + '</span></span>').join("");
      el("cover").style.display = "flex";
      paintHud();
    }

    function beginTurn() {
      el("cover").style.display = "none";
      phase = "draw";
      revealed = true;
      lock(300);
      sound.haptic("light");
      paintHud();
    }

    /* ---------------------------------------------------------------
     * The turn
     * ------------------------------------------------------------- */
    function drawFrom(src) {
      if (phase !== "draw" || busy()) return;
      if (src === "stock") {
        if (!stock.length) return;
        hands[turn].push(stock.pop());
        tookId = null;
      } else {
        if (!discard.length) return;
        const c = discard.pop();
        hands[turn].push(c);
        tookId = c.id;
      }
      drewFrom = src;
      phase = "discard";
      selected = null;
      lock(360);
      sound.sting("tap");
      sound.haptic("light");
      ctx.platform.interact({ type: "draw", from: src, seat: turn });
      paintHud();
    }

    function selectCard(id) {
      if (phase !== "discard" || busy()) return;
      // You may not put the upcard straight back on the pile. Without this the
      // discard pile becomes a free look every turn: take the card, see it,
      // return it, having cost yourself nothing.
      if (id === tookId) {
        sound.haptic("warning");
        flashHint("that one just came off the pile");
        return;
      }
      selected = selected === id ? null : id;
      sound.haptic("light");
      paintHud();
    }

    /** Throw the selected card. `knocking` also ends the hand. */
    function commitDiscard(knocking) {
      if (phase !== "discard" || busy() || !selected) return;
      const i = hands[turn].findIndex((c) => c.id === selected);
      if (i < 0 || selected === tookId) return;
      const card = hands[turn].splice(i, 1)[0];
      const arr = bestArrangement(hands[turn]);
      selected = null;

      if (knocking) {
        discard.push(card);
        openKnock(arr);
        return;
      }
      discard.push(card);
      sound.sting("tap");
      sound.haptic("light");
      ctx.platform.interact({ type: "discard", seat: turn });

      // `turn` does NOT flip here.
      //
      // It used to, and for the third of a second the thrown card spent in the
      // air the screen was drawing the NEXT player's hand, face up, to whoever
      // was still holding the phone. The seat changes when the cover goes up
      // and not a moment sooner. The lock outlasts the timer on purpose, so
      // "not busy" always means the cover is already there.
      phase = "throwing";
      lock(470);
      ctx.timeout(() => {
        if (stock.length <= 2) return deadHand();
        turn = 1 - turn;
        openHandoff();
      }, 420);
    }

    function deadHand() {
      phase = "result";
      result = { dead: true, points: 0, hand: handNo };
      revealed = false;
      sound.sting("fail");
      sound.haptic("warning");
      paintResult();
    }

    /* ---------------------------------------------------------------
     * The settlement
     * ------------------------------------------------------------- */
    function openKnock(arr) {
      const gin = arr.deadwood === 0;
      const dArr = bestArrangement(hands[1 - turn]);
      show = {
        knocker: turn,
        defender: 1 - turn,
        gin,
        kMelds: arr.melds.map((m) => m.slice()),
        kDead: arr.dead.slice(),
        kDeadwood: arr.deadwood,
        dMelds: dArr.melds.map((m) => m.slice()),
        dDead: dArr.dead.slice(),
        dDeadwood: dArr.deadwood,
        laid: [],
        settled: false,
      };
      phase = "knock";
      revealed = true;
      lock(700);
      sound.duck(0.55, 500);
      sound.sting(gin ? "success" : "powerup");
      sound.haptic("heavy");
      shake = gin ? 0.026 : 0.016;
      ctx.platform.milestone(gin ? "gin" : "knock", { seat: turn, deadwood: arr.deadwood });
      paintHud();
    }

    /** One lay-off, by tap. Cards that cannot go anywhere simply do not react. */
    function layOffCard(id) {
      if (phase !== "layoff" || !show || show.settled) return;
      const i = show.dDead.findIndex((c) => c.id === id);
      if (i < 0) return;
      const m = layOffTarget(show.dDead[i], show.kMelds);
      if (m < 0) { sound.haptic("warning"); return; }
      const card = show.dDead.splice(i, 1)[0];
      show.kMelds[m].push(card);
      sortMeld(show.kMelds[m]);
      show.laid.push({ card, meld: m });
      show.dDeadwood = handValue(show.dDead);
      sound.sting("coin");
      sound.haptic("light");
      bandPulse = 1;
      lock(280);
      paintHud();
    }

    function layOffEverything() {
      if (phase !== "layoff" || !show || show.settled) return;
      const r = layOffAll(show.dDead, show.kMelds);
      if (r.laid.length) {
        show.laid = show.laid.concat(r.laid);
        show.dDead = r.remaining;
        show.dDeadwood = r.deadwood;
        sound.sting("coin");
        sound.haptic("medium");
        bandPulse = 1;
        lock(340);
      }
      paintHud();
    }

    function settle() {
      if (!show || show.settled) return;
      show.settled = true;
      const sc = scoreKnock(show.kDeadwood, show.dDeadwood, show.gin);
      const seat = sc.winner === "knocker" ? show.knocker : show.defender;
      players[seat].score += sc.points;
      result = {
        dead: false,
        hand: handNo,
        seat,
        points: sc.points,
        gin: sc.gin,
        undercut: sc.undercut,
        kDeadwood: show.kDeadwood,
        dDeadwood: show.dDeadwood,
        knocker: show.knocker,
      };
      phase = "result";
      sound.duck(0.5, 420);
      sound.sting(sc.undercut ? "danger" : sc.gin ? "win" : "success");
      sound.haptic(sc.undercut ? "warning" : "success");
      if (sc.undercut) shake = 0.022;
      paintResult();
    }

    function nextHand() {
      if (players[0].score >= settings.target || players[1].score >= settings.target) return endMatch();
      // A dead hand is washed out, so the same dealer deals it again — the deal
      // is worth something and nobody should lose theirs to a hand that never
      // finished.
      if (!result || !result.dead) dealer = 1 - dealer;
      el("sheet").style.display = "none";
      dealRound();
      paintHud();
    }

    async function endMatch() {
      winner = players[0].score >= players[1].score ? 0 : 1;
      phase = "over";
      el("sheet").style.display = "none";
      el("over-name").textContent = players[winner].name;
      el("over-name").style.color = players[winner].css;
      const top = Math.max(players[0].score, players[1].score, 1);
      el("over-bars").innerHTML = players.map((q) =>
        '<div style="display:flex;align-items:center;gap:9px;margin:7px 0;">' +
          '<div style="width:74px;font-size:12.5px;font-weight:800;color:' + q.css + ';' +
            'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + esc(q.name) + '</div>' +
          '<div style="flex:1;height:7px;border-radius:4px;background:rgba(246,235,216,0.10);overflow:hidden;">' +
            '<div style="width:' + Math.round((q.score / top) * 100) + '%;height:100%;background:' + q.css + ';"></div>' +
          '</div>' +
          '<div style="width:32px;text-align:right;font-size:16px;font-weight:900;">' + q.score + '</div>' +
        '</div>').join("");
      el("over-sub").textContent = handNo + (handNo === 1 ? " hand" : " hands") +
        " to " + settings.target +
        (settings.target === 100 ? " — on the board" : " · house match, not recorded");
      el("over").style.display = "flex";
      sound.duck(0.6, 600);
      sound.sting("win");
      sound.haptic("success");
      ctx.platform.complete({ winner: players[winner].name, hands: handNo, target: settings.target });
      // The record belongs to the MATCH, not to one of the two people sharing
      // the phone — and only a full hundred-point game counts as one.
      if (settings.target === 100) {
        try { await ctx.memory.record("fewest_hands").submit(handNo); } catch (_) {}
      }
      paintHud();
    }

    /* ---------------------------------------------------------------
     * Layout — turns a game state into a list of sprite targets.
     * ------------------------------------------------------------- */
    let hit = [];              // tap zones, tested back to front

    /**
     * A card's tap zone is the part of it you can actually SEE.
     *
     * In a fan each card covers most of the one before it, so a zone the size
     * of the whole card means tapping the seven you are looking at selects the
     * eight lying on top of it. Clipping every zone to the sliver left visible
     * — the strip between this card's left edge and the next card's — makes
     * "tap the card you can see" true, which is the only rule a player has.
     * The last card in each group keeps its whole face.
     */
    function hitZone(id, x, y, rot, w, h, exposed) {
      if (!exposed || exposed >= w) { hit.push({ id, x, y, w, h, rot }); return; }
      const dx = -w / 2 + exposed / 2;
      hit.push({
        id, w: exposed, h, rot,
        x: x + dx * Math.cos(rot || 0), y: y + dx * Math.sin(rot || 0),
      });
    }

    /**
     * Pack groups of cards into rows.
     *
     * A group is one meld, or the loose cards. Each group may set its own
     * overlap, and any group too wide for a row tightens its own overlap to
     * fit rather than running off the felt — ten loose cards at a comfortable
     * spread is wider than a phone, and there is nowhere else for them to go.
     */
    function layGroups(groups, xMid, halfW, yTop, cw, ch, step, gap, rowGap) {
      const maxW = halfW * 2;
      const rows = [];
      let cur = [], curW = 0;
      for (const gr of groups) {
        const n = gr.cards.length;
        const gstep = n > 1 ? Math.min(gr.step || step, (maxW - cw) / (n - 1)) : step;
        const gw = (n - 1) * gstep + cw;
        if (cur.length && (gr.brk || curW + gap + gw > maxW)) {
          rows.push({ list: cur, w: curW }); cur = []; curW = 0;
        }
        curW += (cur.length ? gap : 0) + gw;
        cur.push({ gr, w: gw, step: gstep });
      }
      if (cur.length) rows.push({ list: cur, w: curW });

      const out = [], bands = [];
      rows.forEach((row, ri) => {
        let x = xMid - row.w / 2;
        const y = yTop + ri * (ch + rowGap) + ch / 2;
        for (const item of row.list) {
          if (item.gr.band) {
            bands.push({ x: x - 5, y: y - ch / 2 - 5, w: item.w + 10, h: ch + 10, kind: item.gr.kind });
          }
          item.gr.cards.forEach((c, i) => out.push({
            card: c, x: x + cw / 2 + i * item.step, y, group: item.gr, step: item.step,
          }));
          x += item.w + gap;
        }
      });
      const height = rows.length ? rows.length * ch + (rows.length - 1) * rowGap : 0;
      return { items: out, bands, rows: rows.length, height };
    }

    /** A loose fan — a shallow arc with a little rotation at the ends. */
    function fanOut(cards, xMid, yMid, cw, maxSpan) {
      const n = cards.length;
      if (!n) return [];
      const step = n > 1 ? Math.min(cw * 0.64, (maxSpan - cw) / (n - 1)) : 0;
      const x0 = xMid - ((n - 1) * step) / 2;
      return cards.map((c, i) => {
        const t = n > 1 ? (i - (n - 1) / 2) / ((n - 1) / 2) : 0;
        return { card: c, x: x0 + i * step, y: yMid + t * t * 9, rot: t * 0.11 };
      });
    }

    let arrCache = { key: "", val: null };
    function arrangementOf(cards) {
      const key = cards.map((c) => c.id).sort().join(",");
      if (arrCache.key === key) return arrCache.val;
      const val = bestArrangement(cards);
      arrCache = { key, val };
      return val;
    }

    let outCache = { key: "", val: null };
    function outcomesOf(cards) {
      const key = cards.map((c) => c.id).sort().join(",");
      if (outCache.key === key) return outCache.val;
      const val = discardOutcomes(cards);
      outCache = { key, val };
      return val;
    }

    let view = null;           // what the current layout decided, for the HUD

    function layout() {
      const items = [];
      hit = [];
      view = null;

      if (phase === "menu") {
        // A real gin hand on the title screen: a run and a set, fanned.
        const demo = ["7S", "8S", "9S", "QH", "QD", "QC", "AS"].map((id) => ({
          id, rank: id.slice(0, id.length - 1), suit: id.slice(-1),
          red: id.slice(-1) === "H" || id.slice(-1) === "D",
        }));
        const cw = Math.min(76, W * 0.196);
        const n = demo.length;
        demo.forEach((c, i) => {
          const t = (i - (n - 1) / 2) / ((n - 1) / 2);
          const at = {
            x: W / 2 + t * (W * 0.315), y: L.feltY + L.feltH * 0.435 + t * t * 30,
            rot: t * 0.28, sc: cw / L.hw, face: true,
          };
          // Spawned already settled: the first frame has to be right, and a
          // spring cannot promise that in one frame.
          items.push({ card: c, z: i, spawn: Object.assign({ a: 1 }, at), ...at });
        });
        applyTargets(items);
        return;
      }

      if (phase === "knock" || phase === "layoff" ||
          (phase === "result" && show && result && !result.dead)) {
        layoutShowdown(items);
        applyTargets(items);
        return;
      }

      // ---- the table: stock and discard ----
      const pileSc = L.pw / L.hw;
      if (discard.length) {
        const topCard = discard[discard.length - 1];
        items.push({ card: topCard, x: L.discX, y: L.pileY, sc: pileSc, face: true, z: 6 });
        hit.push({ id: "discard", x: L.discX, y: L.pileY, w: L.pw, h: L.ph, rot: 0 });
      }
      if (stock.length) hit.push({ id: "stock", x: L.stockX, y: L.pileY, w: L.pw, h: L.ph, rot: 0 });

      // ---- the opponent's hand, face down, along the far edge ----
      const oppN = hands[1 - turn].length;
      const oppSc = 0.80;
      const ow = L.hw * oppSc;
      const ostep = Math.min(ow * 0.55, (W * 0.78 - ow) / Math.max(1, oppN - 1));
      hands[1 - turn].forEach((c, i) => {
        const t = oppN > 1 ? (i - (oppN - 1) / 2) / ((oppN - 1) / 2) : 0;
        items.push({
          card: c, x: W / 2 + (i - (oppN - 1) / 2) * ostep, y: L.oppY - t * t * 6,
          rot: t * -0.07, sc: oppSc, face: false, z: 2 + i, dim: true,
        });
      });

      // ---- my hand ----
      const mine = hands[turn];
      const sel = selected ? mine.find((c) => c.id === selected) : null;
      // Selecting a discard re-reads the remaining ten immediately, so the
      // melds re-form under your thumb while you are still deciding.
      const shown = sel ? mine.filter((c) => c.id !== selected) : mine;
      // A face-down hand lies in a plain fan. Sorted into meld groups it would
      // announce "two melds already" to everyone watching the deal, which is
      // information nobody at a real table has yet.
      const arr = revealed ? arrangementOf(shown) : { melds: [], dead: shown.slice(), deadwood: 0, melded: 0 };
      const outcomes = (phase === "discard" || phase === "throwing") ? outcomesOf(mine) : null;
      let bestId = null;
      if (outcomes && settings.hints) {
        let bd = 1e9, bv = -1;
        for (const o of outcomes) {
          if (o.deadwood < bd || (o.deadwood === bd && cardValue(o.card) > bv)) {
            bd = o.deadwood; bv = cardValue(o.card); bestId = o.card.id;
          }
        }
      }
      view = {
        arr, sel, bestId,
        after: sel ? arr.deadwood : null,
        outcomes,
      };

      const groups = arr.melds.map((m) => ({ cards: m, band: true, kind: meldKind(m) }));
      // Measure, then place. The tray's floor is fixed and it grows UPWARD to
      // hold whatever rows there are — anchored the other way it would either
      // sit half empty all game or shove the fan around, and the fan is the
      // thing a thumb keeps coming back to.
      const measured = layGroups(groups, W / 2, L.feltW / 2 - 12, 0, L.hw, L.hh, L.hw * 0.56, 15, 10);
      const rows = Math.max(1, measured.rows);
      const trayH = rows * L.hh + (rows - 1) * 10 + 26;
      const trayTop = L.trayBot - trayH;
      const yTop = trayTop + (trayH - measured.height) / 2;
      const packed = layGroups(groups, W / 2, L.feltW / 2 - 12,
                               measured.rows ? yTop : trayTop + 13, L.hw, L.hh, L.hw * 0.56, 15, 10);
      view.bands = packed.bands;
      view.meldRows = packed.rows;
      view.trayTop = trayTop;
      view.ruleY = trayTop - 13;
      // z climbs left to right along the row. Sprites are drawn in z order and
      // ties fall back to the order the Map happens to hold them in — which is
      // deal order, not layout order — so a flat z let a card sit on top of the
      // one to its RIGHT. That hides the wrong corner index, and it makes the
      // exposed-sliver tap zones point at the wrong card.
      packed.items.forEach((it, i) => {
        items.push({ card: it.card, x: it.x, y: it.y, sc: 1, face: revealed, z: 20 + i });
        if (revealed) {
          const last = it.card === it.group.cards[it.group.cards.length - 1];
          hitZone("card:" + it.card.id, it.x, it.y, 0, L.hw, L.hh, last ? 0 : it.step);
        }
      });

      // The chosen card rides at the right-hand end of the fan, lifted clear
      // of it. Everything left of it has already re-formed into the melds you
      // would actually be holding, so the lift shows the trade, not just the
      // selection.
      const row = sel ? arr.dead.concat([sel]) : arr.dead;
      const fan = fanOut(row, W / 2, L.deadY, L.hw, L.feltW - 34);
      const fanStep = fan.length > 1 ? fan[1].x - fan[0].x : L.hw;
      fan.forEach((it, i) => {
        const chosen = sel && it.card.id === sel.id;
        const y = it.y - (chosen ? 26 : 0);
        items.push({
          card: it.card, x: it.x, y, rot: chosen ? 0 : it.rot, sc: chosen ? 1.07 : 1,
          face: revealed, z: chosen ? 900 : 400 + i, dim: it.card.id === tookId,
          glow: chosen ? "rgba(246,235,216," :
                (settings.hints && revealed && !sel && it.card.id === bestId ? "rgba(239,201,107," : null),
        });
        if (revealed) {
          hitZone("card:" + it.card.id, it.x, y, chosen ? 0 : it.rot, L.hw, L.hh,
                  (chosen || i === fan.length - 1) ? 0 : fanStep);
        }
      });
      view.fan = fan;

      applyTargets(items);
    }

    /**
     * The settlement.
     *
     * Both hands go face up here, so this is the one screen in the bit with no
     * cover on it and the only one that has to hold twenty cards at once. It
     * sizes itself down until both hands fit rather than letting the second one
     * fall off the bottom of the felt, and the loose cards always start a fresh
     * row so a meld and a handful of deadwood never read as one shape.
     */
    function layoutShowdown(items) {
      const minTop = L.feltY + 52;                 // room above for the heading
      // The result sheet slides up over the bottom of the felt, so once it is
      // showing the settlement re-lays itself into what is left — otherwise the
      // sheet lands on top of the defender's deadwood, which is the one number
      // the sheet is explaining.
      const bottom = phase === "result" ? L.feltB - 118 : L.feltB - 30;

      let cw, ch, kp, dp, dTop, top = minTop;
      for (const trial of [54, 48, 42, 37]) {
        cw = trial; ch = cw * 1.4;
        const step = cw * 0.66, gap = 13, rowGap = 11;
        const half = L.feltW / 2 - 12;
        const kGroups = show.kMelds.map((m) => ({ cards: m, band: true, kind: meldKind(m) }));
        if (show.kDead.length) kGroups.push({ cards: show.kDead, band: false, kind: "dead", brk: true });
        const dGroups = show.dMelds.map((m) => ({ cards: m, band: true, kind: meldKind(m) }));
        if (show.dDead.length) dGroups.push({ cards: show.dDead, band: false, kind: "dead", brk: true });

        // Measure both halves, then drop the whole settlement into the middle
        // of the felt. Top-aligned it left a third of the table empty under it.
        const kh = layGroups(kGroups, W / 2, half, 0, cw, ch, step, gap, rowGap).height;
        const dh = layGroups(dGroups, W / 2, half, 0, cw, ch, step, gap, rowGap).height;
        const totalH = kh + 48 + dh + 30;
        if (totalH > bottom - minTop && trial !== 37) continue;

        top = minTop + Math.max(0, (bottom - minTop - totalH) / 2);
        kp = layGroups(kGroups, W / 2, half, top, cw, ch, step, gap, rowGap);
        dTop = top + kp.height + 48;
        dp = layGroups(dGroups, W / 2, half, dTop, cw, ch, step, gap, rowGap);
        break;
      }

      const sc = cw / L.hw;
      kp.items.forEach((it, i) => items.push({
        card: it.card, x: it.x, y: it.y, sc, face: true, z: 20 + i,
      }));
      dp.items.forEach((it, i) => {
        const live = phase === "layoff" && it.group.kind === "dead" &&
                     layOffTarget(it.card, show.kMelds) >= 0;
        items.push({
          card: it.card, x: it.x, y: it.y, sc, face: true, z: 200 + i,
          glow: live ? "rgba(239,201,107," : null,
        });
        if (live) {
          const last = it.card === it.group.cards[it.group.cards.length - 1];
          hitZone("lay:" + it.card.id, it.x, it.y, 0, cw, ch, last ? 0 : it.step);
        }
      });
      view = {
        kBands: kp.bands, dBands: dp.bands, kTop: top, dTop,
        kH: kp.height, dH: dp.height, cw, ch,
        headY: top - 33,                           // the heading travels with the block
      };
    }

    /* ---------------------------------------------------------------
     * Painting
     * ------------------------------------------------------------- */
    const canvas = ctx.createCanvas2D({ touchAction: "none" });
    const g = canvas.getContext("2d");
    let art = null, table = null;

    /**
     * The whole table — walnut, grain, the recessed baize and its brass
     * keylines — painted once into an offscreen surface and then blitted.
     *
     * This used to run live every frame and it cost the bit its frame rate:
     * nine hundred nap speckles and a stack of shadow strokes per frame put
     * headless at roughly three fps, which showed up as springs that never
     * settled rather than as anything that looked like a performance problem.
     */
    function paintTableInto(q) {
      const wg = q.createLinearGradient(0, 0, W * 0.7, H);
      wg.addColorStop(0, WOOD_HI); wg.addColorStop(0.42, WOOD); wg.addColorStop(1, WOOD_LO);
      q.fillStyle = wg; q.fillRect(0, 0, W, H);
      // Grain: long shallow waves down the length of the board.
      q.lineWidth = 1;
      for (let i = 0; i < 130; i++) {
        const y = (i / 130) * H + Math.random() * 5;
        q.strokeStyle = "rgba(" + (Math.random() < 0.5 ? "255,226,190," : "20,9,3,") +
          (0.02 + Math.random() * 0.05).toFixed(3) + ")";
        q.beginPath();
        q.moveTo(-10, y);
        const amp = 3 + Math.random() * 7;
        for (let x = -10; x <= W + 10; x += 26) q.lineTo(x, y + Math.sin(x * 0.021 + i) * amp);
        q.stroke();
      }

      const f = FELTS[settings.felt];
      const path = (c) => roundRect(c, L.feltX, L.feltY, L.feltW, L.feltH, 20);
      // Recess: a dark lip so the baize sits IN the wood rather than on it.
      softShadow(q, path, { spread: 16, alpha: 0.075, step: 2.4 });
      path(q);
      const fg = q.createRadialGradient(W / 2, L.feltY + L.feltH * 0.34, 10,
                                        W / 2, L.feltY + L.feltH * 0.5, L.feltH * 0.78);
      fg.addColorStop(0, f.hi); fg.addColorStop(0.55, f.mid); fg.addColorStop(1, f.lo);
      q.fillStyle = fg; q.fill();
      q.save(); path(q); q.clip();
      q.globalAlpha = 0.05;                                  // baize nap
      for (let i = 0; i < 1400; i++) {
        q.fillStyle = i % 2 ? "#ffffff" : "#000000";
        q.fillRect(L.feltX + Math.random() * L.feltW, L.feltY + Math.random() * L.feltH, 1.7, 1.7);
      }
      q.globalAlpha = 1;
      q.restore();
      path(q);
      q.strokeStyle = "rgba(201,160,92,0.55)"; q.lineWidth = 1.6; q.stroke();
      roundRect(q, L.feltX + 5, L.feltY + 5, L.feltW - 10, L.feltH - 10, 15);
      q.strokeStyle = "rgba(201,160,92,0.18)"; q.lineWidth = 1; q.stroke();
    }

    /**
     * Baked at DEVICE resolution and blitted one-for-one.
     *
     * The obvious version — bake at CSS size, draw it back at CSS size — makes
     * the runtime rescale a full-screen image on every single frame, and on a
     * software rasteriser that alone took this bit from sixty frames a second
     * to two. Matching the backing store exactly turns the same call into a
     * straight copy, and it stops the keylines and the nap being an upscale.
     */
    function bakeTable() {
      const S = Math.min(ctx.dpr || 1, 3);
      const c = makeSurface(W * S, H * S);
      if (!c) return null;
      const q = c.getContext("2d");
      q.setTransform(S, 0, 0, S, 0, 0);
      paintTableInto(q);
      return c;
    }

    /** Letter-spaced small caps; canvas letterSpacing is not safe on every WebView. */
    function tracked(text, x, y, size, colour, spacing) {
      g.save();
      g.font = "800 " + size + "px -apple-system, system-ui, sans-serif";
      g.fillStyle = colour;
      g.textAlign = "center"; g.textBaseline = "middle";
      const chars = String(text).split("");
      let total = 0;
      for (const ch of chars) total += g.measureText(ch).width + spacing;
      total -= spacing;
      let cx = x - total / 2;
      for (const ch of chars) {
        const w = g.measureText(ch).width;
        g.fillText(ch, cx + w / 2, y);
        cx += w + spacing;
      }
      g.restore();
    }

    function drawCardSprite(s) {
      if (s.a < 0.01) return;
      const w = L.hw * s.sc, h = L.hh * s.sc;
      const fs = flipScale(s);
      g.save();
      g.globalAlpha = s.a * (s.dim ? 0.62 : 1);
      g.translate(s.x, s.y);
      if (s.rot) g.rotate(s.rot);
      if (s.glow) {
        g.save();
        g.lineJoin = "round";
        for (let k = 14; k >= 2; k -= 2.4) {
          g.strokeStyle = s.glow + (0.15 * (1 - k / 14) + 0.04).toFixed(3) + ")";
          g.lineWidth = k;
          roundRect(g, -w / 2, -h / 2, w, h, w * 0.09);
          g.stroke();
        }
        g.restore();
      }
      if (fs < 0.999) g.scale(Math.max(0.02, fs), 1);
      const img = s.face ? (art && art.faces[s.card.id]) : (art && art.back);
      if (img) {
        const p = (art.pad || 0) * w;
        g.drawImage(img, -w / 2 - p, -h / 2 - p, w + p * 2, h + p * 2);
      } else {
        roundRect(g, -w / 2, -h / 2, w, h, w * 0.09);
        g.fillStyle = s.face ? "#fdfcf7" : "#5A2C3C"; g.fill();
        g.strokeStyle = "rgba(0,0,0,0.25)"; g.lineWidth = 1; g.stroke();
        if (s.face) {
          g.fillStyle = s.card.red ? "#c8202f" : "#1b1b22";
          g.font = "700 " + (w * 0.38) + "px ui-serif, Georgia, serif";
          g.textAlign = "center"; g.textBaseline = "middle";
          g.fillText(s.card.rank, 0, -h * 0.08);
          suitPath(g, s.card.suit, 0, h * 0.22, w * 0.16);
        }
      }
      g.restore();
    }

    function drawPileBack(x, y, count) {
      const w = L.pw, h = L.ph;
      const n = Math.min(count, 6);
      for (let i = n - 1; i >= 0; i--) {
        g.save();
        g.translate(x + i * 0.9, y - i * 0.9);
        if (art && art.back) {
          const p = (art.pad || 0) * w;
          g.drawImage(art.back, -w / 2 - p, -h / 2 - p, w + p * 2, h + p * 2);
        } else { roundRect(g, -w / 2, -h / 2, w, h, w * 0.09); g.fillStyle = "#5A2C3C"; g.fill(); }
        g.restore();
      }
    }

    function drawSlot(x, y, label) {
      g.save();
      roundRect(g, x - L.pw / 2, y - L.ph / 2, L.pw, L.ph, L.pw * 0.09);
      g.strokeStyle = "rgba(246,235,216,0.16)";
      g.lineWidth = 1.4;
      g.setLineDash([6, 6]);
      g.stroke();
      g.setLineDash([]);
      g.fillStyle = "rgba(246,235,216,0.26)";
      g.font = "700 10px -apple-system, system-ui, sans-serif";
      g.textAlign = "center"; g.textBaseline = "middle";
      g.fillText(label, x, y);
      g.restore();
    }

    function drawBands(bands, alpha) {
      for (const b of bands) {
        g.save();
        const pulse = bandPulse * 0.35;
        roundRect(g, b.x, b.y, b.w, b.h, 12);
        g.fillStyle = "rgba(201,160,92," + (0.11 * alpha + pulse * 0.2).toFixed(3) + ")";
        g.fill();
        g.strokeStyle = "rgba(239,201,107," + (0.42 * alpha + pulse).toFixed(3) + ")";
        g.lineWidth = 1.2;
        g.stroke();
        g.restore();
      }
    }

    function paint() {
      g.save();
      if (shake > 0.0004) {
        g.translate((Math.random() - 0.5) * shake * W, (Math.random() - 0.5) * shake * W);
      }
      if (table) {
        g.save();
        g.setTransform(1, 0, 0, 1, 0, 0);           // 1:1 device pixels — a copy, not a rescale
        g.drawImage(table, 0, 0);
        g.restore();
      } else paintTableInto(g);                     // no OffscreenCanvas: draw it live

      if (phase === "menu") {
        drawSorted();
        // The title scrim is painted HERE rather than as a translucent DOM
        // layer. A full-screen semi-transparent div over a canvas makes the
        // compositor re-blend the whole screen every frame — it measured at
        // four fifths of the budget — and it also greyed the cards it was
        // supposed to be sitting behind. Two canvas fills cost nothing and can
        // be shaped to leave the fan alone.
        const topH = H * 0.34;
        const tg = g.createLinearGradient(0, 0, 0, topH);
        tg.addColorStop(0, "rgba(20,10,4,0.93)");
        tg.addColorStop(0.55, "rgba(20,10,4,0.70)");
        tg.addColorStop(1, "rgba(20,10,4,0)");
        g.fillStyle = tg; g.fillRect(0, 0, W, topH);
        const botY = H * 0.52;
        const bg2 = g.createLinearGradient(0, botY, 0, H);
        bg2.addColorStop(0, "rgba(16,8,3,0)");
        bg2.addColorStop(0.35, "rgba(16,8,3,0.58)");
        bg2.addColorStop(0.72, "rgba(16,8,3,0.93)");
        bg2.addColorStop(1, "rgba(16,8,3,0.98)");
        g.fillStyle = bg2; g.fillRect(0, botY, W, H - botY);
        g.restore();
        return;
      }

      if (phase === "knock" || phase === "layoff" || (phase === "result" && show && result && !result.dead)) {
        paintShowdown();
        g.restore();
        return;
      }

      // piles
      if (stock.length) drawPileBack(L.stockX, L.pileY, stock.length);
      else drawSlot(L.stockX, L.pileY, "EMPTY");
      if (discard.length > 1) {
        // A couple of edges under the top card, so the pile has depth.
        for (let i = Math.min(3, discard.length - 1); i >= 1; i--) {
          g.save();
          roundRect(g, L.discX - L.pw / 2 + i * 1.2, L.pileY - L.ph / 2 + i * 1.2, L.pw, L.ph, L.pw * 0.09);
          g.fillStyle = "rgba(250,246,238," + (0.30 - i * 0.06).toFixed(2) + ")";
          g.fill();
          g.restore();
        }
      } else if (!discard.length) drawSlot(L.discX, L.pileY, "DISCARD");

      const ly = L.pileY + L.ph / 2 + 16;
      tracked("STOCK  " + stock.length, L.stockX, ly, 9.5, "rgba(246,235,216,0.5)", 1.6);
      tracked("DISCARD", L.discX, ly, 9.5, "rgba(246,235,216,0.5)", 1.6);

      if (phase === "draw" && !busy()) {
        // The two live targets pulse gently so the choice is obvious.
        const t = 0.5 + 0.5 * Math.sin(performance.now() / 380);
        for (const x of [stock.length ? L.stockX : null, discard.length ? L.discX : null]) {
          if (x === null) continue;
          g.save();
          g.lineJoin = "round";
          for (let k = 12; k >= 2; k -= 2.5) {
            g.strokeStyle = "rgba(239,201,107," + (0.05 + 0.11 * t * (1 - k / 12)).toFixed(3) + ")";
            g.lineWidth = k;
            roundRect(g, x - L.pw / 2, L.pileY - L.ph / 2, L.pw, L.ph, L.pw * 0.09);
            g.stroke();
          }
          g.restore();
        }
      }

      // section rules
      if (view) {
        const ry = view.ruleY;
        const caption = view.arr.melds.length ? "MELDS" : "NO MELDS YET";
        g.save();
        g.font = "800 9.5px -apple-system, system-ui, sans-serif";
        const half = g.measureText(caption).width / 2 + caption.length * 0.9 + 13;
        g.strokeStyle = "rgba(201,160,92,0.22)";
        g.lineWidth = 1;
        g.beginPath(); g.moveTo(L.feltX + 24, ry); g.lineTo(W / 2 - half, ry); g.stroke();
        g.beginPath(); g.moveTo(W / 2 + half, ry); g.lineTo(L.feltX + L.feltW - 24, ry); g.stroke();
        g.restore();
        tracked(caption, W / 2, ry, 9.5, "rgba(246,235,216,0.5)", 1.8);

        // The tray. Without it the band between the piles and the hand reads
        // as a hole in the screen for the first few turns of every deal.
        g.save();
        roundRect(g, L.feltX + 16, view.trayTop, L.feltW - 32, L.trayBot - view.trayTop, 16);
        g.fillStyle = "rgba(0,0,0,0.11)"; g.fill();
        g.setLineDash([5, 7]);
        g.strokeStyle = "rgba(201,160,92,0.20)"; g.lineWidth = 1; g.stroke();
        g.setLineDash([]);
        g.restore();
        if (!view.arr.melds.length && revealed) {
          tracked("SETS OF THREE  ·  RUNS IN ONE SUIT", W / 2,
                  (view.trayTop + L.trayBot) / 2, 9.5, "rgba(246,235,216,0.24)", 1.6);
        }

        drawBands(view.bands, revealed ? 1 : 0.25);

        // Left-aligned: the chosen card lifts at the RIGHT end of the fan and
        // would sit on a centred readout.
        const dy = L.deadLabelY;
        g.save();
        g.textBaseline = "middle";
        g.textAlign = "left";
        g.font = "800 9.5px -apple-system, system-ui, sans-serif";
        g.fillStyle = "rgba(246,235,216,0.5)";
        let cx = L.feltX + 24;
        for (const ch of "DEADWOOD") { g.fillText(ch, cx, dy); cx += g.measureText(ch).width + 1.8; }
        g.font = "900 16px -apple-system, system-ui, sans-serif";
        g.fillStyle = revealed ? (view.arr.deadwood <= 10 ? GOLD : PARCH) : "rgba(246,235,216,0.3)";
        g.fillText(revealed ? String(view.arr.deadwood) : "··", cx + 8, dy - 1);
        if (revealed && view.arr.deadwood <= 10 && phase === "discard" && selected) {
          g.font = "800 11px -apple-system, system-ui, sans-serif";
          g.fillStyle = GOLD;
          g.fillText(view.arr.deadwood === 0 ? "gin" : "knockable", cx + 34, dy);
        }
        g.restore();
      }

      drawSorted();
      g.restore();
    }

    function paintShowdown() {
      const k = players[show.knocker], d = players[show.defender];
      g.save();
      g.textAlign = "center"; g.textBaseline = "middle";
      g.font = "900 18px -apple-system, system-ui, sans-serif";
      g.fillStyle = k.css;
      g.fillText(show.gin ? k.name + " GOES GIN" : k.name + " KNOCKS", W / 2, view.headY);
      g.restore();
      tracked(show.gin ? "NOTHING IN HAND  ·  NO LAY-OFFS" : "DEADWOOD  " + show.kDeadwood,
              W / 2, view.headY + 16, 9, "rgba(246,235,216,0.5)", 1.8);
      drawBands(view.kBands, 1);

      // The dividing rule carries the defender's name, so the two halves of
      // the settlement are never mistaken for one long hand.
      const midY = view.dTop - 26;
      g.save();
      g.font = "900 13px -apple-system, system-ui, sans-serif";
      const half = g.measureText(d.name.toUpperCase()).width / 2 + 16;
      g.strokeStyle = "rgba(201,160,92,0.22)";
      g.lineWidth = 1;
      g.beginPath(); g.moveTo(L.feltX + 24, midY); g.lineTo(W / 2 - half, midY); g.stroke();
      g.beginPath(); g.moveTo(W / 2 + half, midY); g.lineTo(L.feltX + L.feltW - 24, midY); g.stroke();
      g.textAlign = "center"; g.textBaseline = "middle";
      g.fillStyle = d.css;
      g.fillText(d.name.toUpperCase(), W / 2, midY);
      g.restore();

      drawBands(view.dBands, 1);
      drawSorted();

      const fy = view.dTop + view.dH + 20;
      const undercutting = !show.gin && show.dDeadwood <= show.kDeadwood;
      g.save();
      g.textBaseline = "middle"; g.textAlign = "center";
      g.font = "800 9.5px -apple-system, system-ui, sans-serif";
      let total = 0;
      const cap = "DEADWOOD";
      for (const ch2 of cap) total += g.measureText(ch2).width + 1.8;
      const numW = 30;
      let cx = W / 2 - (total + numW) / 2;
      g.textAlign = "left";
      g.fillStyle = "rgba(246,235,216,0.5)";
      for (const ch2 of cap) { g.fillText(ch2, cx, fy); cx += g.measureText(ch2).width + 1.8; }
      g.font = "900 17px -apple-system, system-ui, sans-serif";
      g.fillStyle = undercutting ? "#FF9F7A" : PARCH;
      g.fillText(String(show.dDeadwood), cx + 9, fy - 1);
      if (undercutting) {
        g.font = "800 10px -apple-system, system-ui, sans-serif";
        g.fillStyle = "#FF9F7A";
        g.fillText("UNDERCUT", cx + 9, fy + 17);
      }
      g.restore();
    }

    function drawSorted() {
      const list = [...sprites.values()].sort((a, b) => (a.z || 0) - (b.z || 0));
      for (const s of list) drawCardSprite(s);
    }

    /* ---------------------------------------------------------------
     * Input. The canvas has no children, so e.target is always the
     * canvas and offsetX/offsetY are already canvas-relative.
     * ------------------------------------------------------------- */
    function hitAt(x, y) {
      for (let i = hit.length - 1; i >= 0; i--) {
        const z = hit[i];
        let dx = x - z.x, dy = y - z.y;
        if (z.rot) {
          const c = Math.cos(-z.rot), s = Math.sin(-z.rot);
          const rx = dx * c - dy * s, ry = dx * s + dy * c;
          dx = rx; dy = ry;
        }
        if (Math.abs(dx) <= z.w / 2 && Math.abs(dy) <= z.h / 2) return z.id;
      }
      return null;
    }

    ctx.listen(canvas, "pointerdown", async (e) => {
      e.preventDefault();
      await sound.unlock();
      if (busy()) return;
      const id = hitAt(e.offsetX, e.offsetY);
      if (!id) return;
      if (id === "stock") drawFrom("stock");
      else if (id === "discard") drawFrom("discard");
      else if (id.startsWith("card:")) selectCard(id.slice(5));
      else if (id.startsWith("lay:")) layOffCard(id.slice(4));
    }, { passive: false });

    /* ---------------------------------------------------------------
     * Overlay — one markup string, root transparent to pointers.
     * ------------------------------------------------------------- */
    const FONT = "-apple-system,system-ui,'Segoe UI',Roboto,sans-serif";
    const ST = ctx.safeArea.top, SB = ctx.safeArea.bottom;
    const PANEL = "background:linear-gradient(180deg,rgba(58,32,18,0.98),rgba(34,18,9,0.99));" +
      "border:1px solid rgba(201,160,92,0.35);border-radius:22px;";
    const BIG = "width:100%;padding:15px;border:none;border-radius:15px;font-family:inherit;" +
      "font-size:16px;font-weight:800;letter-spacing:0.01em;";
    const CHIP = "pointer-events:auto;width:31px;height:31px;border-radius:10px;border:none;" +
      "background:rgba(246,235,216,0.11);color:#F6EBD8;font-size:14px;font-family:inherit;padding:0;";
    const INPUT = "width:100%;padding:12px 13px;border-radius:13px;border:1px solid rgba(201,160,92,0.3);" +
      "background:rgba(0,0,0,0.28);color:#F6EBD8;font-family:inherit;font-size:16px;font-weight:700;";

    const root = ctx.createRoot({ touchAction: "manipulation" });
    root.style.cssText += ";font-family:" + FONT + ";color:" + PARCH + ";pointer-events:none;";
    root.innerHTML =
      // ---- top strip: both scores, the hand number, the chrome ----
      '<div style="position:absolute;left:11px;right:11px;top:' + (ST + 7) + 'px;height:38px;' +
        'display:flex;align-items:center;gap:8px;pointer-events:none;">' +
        '<div data-el="s0" style="flex:1;min-width:0;"></div>' +
        '<div data-el="mid" style="text-align:center;font-size:9.5px;letter-spacing:0.18em;' +
          'text-transform:uppercase;opacity:0.55;line-height:1.35;white-space:nowrap;"></div>' +
        '<div data-el="s1" style="flex:1;min-width:0;text-align:right;"></div>' +
      '</div>' +

      // ---- the wooden ledge: chrome, a hint line, the action buttons ----
      '<div data-el="ledge" style="position:absolute;left:0;right:0;bottom:0;' +
        'height:' + (134 + SB) + 'px;pointer-events:none;">' +
        '<div style="position:absolute;left:14px;top:9px;display:flex;gap:7px;">' +
          '<button data-el="mute" aria-label="Sound" style="' + CHIP + '">🔊</button>' +
          '<button data-el="help" aria-label="How to play" style="' + CHIP + '">?</button>' +
          '<button data-el="cog" aria-label="Settings" style="' + CHIP + '">⚙</button>' +
        '</div>' +
        '<div data-el="hint" style="position:absolute;right:14px;top:9px;height:31px;' +
          'display:flex;align-items:center;font-size:12.5px;opacity:0.7;text-align:right;"></div>' +
        // pointer-events:auto, or the canvas underneath eats every one of
        // these — the root is transparent to pointers by design and the ledge
        // inherits that, so each interactive island has to opt back in.
        '<div data-el="acts" style="position:absolute;left:14px;right:14px;bottom:' + (SB + 14) + 'px;' +
          'display:flex;gap:9px;pointer-events:auto;"></div>' +
      '</div>' +

      // ---- the handover cover ----
      //
      // Dressed as the back of one enormous card, because that is exactly what
      // it is: the thing between you and somebody else's hand. Same lattice and
      // same inset keyline as the fifty-two backs on the table.
      '<div data-el="cover" style="position:absolute;inset:0;pointer-events:auto;display:none;' +
        'flex-direction:column;align-items:center;justify-content:center;gap:5px;padding:30px;' +
        'background-color:#5C2434;background-image:' +
          'radial-gradient(115% 74% at 50% 42%,rgba(0,0,0,0) 0%,rgba(0,0,0,0.30) 58%,rgba(0,0,0,0.72) 100%),' +
          'repeating-linear-gradient(45deg,rgba(255,255,255,0.075) 0 1.7px,rgba(255,255,255,0) 1.7px 20px),' +
          'repeating-linear-gradient(-45deg,rgba(255,255,255,0.075) 0 1.7px,rgba(255,255,255,0) 1.7px 20px);' +
        'z-index:60;">' +
        '<div style="position:absolute;left:13px;right:13px;top:' + (ST + 13) + 'px;bottom:' + (SB + 13) + 'px;' +
          'border:2px solid rgba(255,255,255,0.30);border-radius:18px;pointer-events:none;"></div>' +
        '<div data-el="cover-scores" style="position:absolute;left:0;right:0;top:' + (ST + 34) + 'px;' +
          'display:flex;justify-content:center;gap:22px;font-size:12px;font-weight:800;"></div>' +
        '<div style="font-size:10px;letter-spacing:0.36em;text-transform:uppercase;opacity:0.62;">Pass the phone to</div>' +
        '<div data-el="cover-name" style="font-size:44px;font-weight:900;line-height:1.08;text-align:center;' +
          'text-shadow:0 2px 14px rgba(0,0,0,0.45);"></div>' +
        '<div data-el="cover-sub" style="font-size:13px;opacity:0.66;margin-bottom:24px;"></div>' +
        '<button data-el="cover-go" style="' + BIG + 'max-width:300px;' +
          'box-shadow:0 6px 22px rgba(0,0,0,0.35);"></button>' +
        '<div style="font-size:12px;opacity:0.5;line-height:1.55;text-align:center;max-width:250px;margin-top:14px;">' +
          'Only you should see the next screen.<br>It closes again the moment you throw a card.</div>' +
      '</div>' +

      // ---- the round sheet, a bottom card so the settlement stays visible ----
      '<div data-el="sheet" style="position:absolute;left:12px;right:12px;bottom:' + (SB + 12) + 'px;' +
        'display:none;pointer-events:auto;' + PANEL + 'padding:17px 18px;z-index:55;">' +
        '<div data-el="sheet-body"></div>' +
        '<button data-el="sheet-go" style="' + BIG + 'margin-top:13px;background:' + GOLD + ';color:#3A2210;"></button>' +
      '</div>' +

      // ---- menu ----
      '<div data-el="menu" style="position:absolute;inset:0;pointer-events:auto;display:flex;' +
        'flex-direction:column;justify-content:space-between;padding:' + (ST + 18) + 'px 22px ' + (SB + 18) + 'px;' +
        // No background: the scrim is painted on the canvas instead, so this
        // element never makes the compositor re-blend the screen.
        
        'z-index:50;">' +
        '<div style="text-align:center;">' +
          '<div style="font-size:10px;letter-spacing:0.44em;text-transform:uppercase;opacity:0.5;">Two players · one phone</div>' +
          '<div style="font-size:58px;font-weight:900;letter-spacing:-0.045em;line-height:0.92;margin-top:6px;' +
            'background:linear-gradient(120deg,#F0B347,#EFC96B 45%,#7FC6A4);-webkit-background-clip:text;' +
            'background-clip:text;-webkit-text-fill-color:transparent;">Gin<br>Rummy</div>' +
          '<div style="width:52px;height:2px;margin:13px auto 0;background:rgba(201,160,92,0.55);"></div>' +
          '<div style="font-size:14px;opacity:0.66;line-height:1.55;max-width:262px;margin:11px auto 0;">' +
            'Draw one, throw one. Build sets and runs until what you cannot use is worth ten or less — then knock.</div>' +
        '</div>' +
        '<div>' +
          '<div style="display:flex;gap:9px;">' +
            '<input data-el="n0" maxlength="12" placeholder="Player 1" autocomplete="off" autocorrect="off" ' +
              'spellcheck="false" style="' + INPUT + 'border-color:rgba(240,179,71,0.5);">' +
            '<input data-el="n1" maxlength="12" placeholder="Player 2" autocomplete="off" autocorrect="off" ' +
              'spellcheck="false" style="' + INPUT + 'border-color:rgba(127,198,164,0.5);">' +
          '</div>' +
          '<button data-el="go" style="' + BIG + 'margin-top:11px;background:' + GOLD + ';color:#3A2210;">Deal</button>' +
          '<div style="display:flex;gap:9px;margin-top:9px;">' +
            '<button data-el="menu-help" style="' + BIG + 'background:rgba(246,235,216,0.10);color:' + PARCH + ';font-size:14px;">How to play</button>' +
            '<button data-el="menu-cog" style="' + BIG + 'background:rgba(246,235,216,0.10);color:' + PARCH + ';font-size:14px;">Settings</button>' +
          '</div>' +
        '</div>' +
      '</div>' +

      // ---- game over ----
      '<div data-el="over" style="position:absolute;inset:0;pointer-events:auto;display:none;' +
        'align-items:center;justify-content:center;padding:22px;' +
        'background:rgba(14,7,3,0.72);z-index:65;">' +
        '<div style="max-width:330px;width:100%;' + PANEL + 'padding:24px 22px;text-align:center;' +
          'box-shadow:0 18px 60px rgba(0,0,0,0.55);">' +
          '<div style="font-size:10px;letter-spacing:0.4em;text-transform:uppercase;opacity:0.45;">Match over</div>' +
          '<div data-el="over-name" style="font-size:40px;font-weight:900;line-height:1.05;margin-top:5px;"></div>' +
          '<div style="font-size:13.5px;opacity:0.6;margin-top:2px;">takes the match</div>' +
          '<div style="margin:15px 0 4px;font-size:13px;letter-spacing:0.5em;color:rgba(201,160,92,0.75);">' +
            '&#9824;&#9829;&#9830;&#9827;</div>' +
          '<div data-el="over-bars" style="margin-top:13px;text-align:left;"></div>' +
          '<div data-el="over-sub" style="font-size:12px;opacity:0.5;margin:14px 0 18px;"></div>' +
          '<button data-el="again" style="' + BIG + 'background:' + GOLD + ';color:#3A2210;">Play again</button>' +
          '<button data-el="over-menu" style="' + BIG + 'margin-top:9px;' +
            'background:rgba(246,235,216,0.10);color:' + PARCH + ';font-size:14px;">Back to the table</button>' +
        '</div>' +
      '</div>' +

      // ---- settings ----
      '<div data-el="cogp" style="position:absolute;inset:0;pointer-events:auto;display:none;' +
        'align-items:center;justify-content:center;background:rgba(16,8,3,0.95);z-index:70;' +
        'padding:' + (ST + 14) + 'px 20px ' + (SB + 14) + 'px;">' +
        '<div style="max-width:330px;width:100%;' + PANEL + 'padding:21px;">' +
          '<div style="font-size:19px;font-weight:800;margin-bottom:14px;">Settings</div>' +
          '<div style="font-size:10px;letter-spacing:0.22em;text-transform:uppercase;opacity:0.5;">Match to</div>' +
          '<div data-el="tc" style="display:flex;gap:8px;margin:7px 0 15px;"></div>' +
          '<div style="font-size:10px;letter-spacing:0.22em;text-transform:uppercase;opacity:0.5;">Baize</div>' +
          '<div data-el="fc" style="display:flex;gap:8px;margin:7px 0 15px;"></div>' +
          '<div style="font-size:10px;letter-spacing:0.22em;text-transform:uppercase;opacity:0.5;">Hints</div>' +
          '<div data-el="hc" style="display:flex;gap:8px;margin:7px 0 4px;"></div>' +
          '<div style="font-size:12px;opacity:0.5;line-height:1.5;">Rings the card that leaves you the least deadwood.</div>' +
          '<button data-el="cogp-close" style="' + BIG + 'margin-top:17px;background:' + GOLD + ';color:#3A2210;">Done</button>' +
          '<button data-el="abandon" style="' + BIG + 'margin-top:9px;background:rgba(246,235,216,0.09);color:' + PARCH + ';font-size:14px;">Abandon match</button>' +
        '</div>' +
      '</div>' +

      // ---- how to play ----
      '<div data-el="helpp" style="position:absolute;inset:0;pointer-events:auto;display:none;' +
        'align-items:center;justify-content:center;background:rgba(16,8,3,0.95);z-index:75;' +
        'padding:' + (ST + 12) + 'px 18px ' + (SB + 12) + 'px;">' +
        '<div style="max-width:340px;width:100%;' + PANEL + 'padding:21px;max-height:100%;overflow:auto;">' +
          '<div style="font-size:19px;font-weight:800;margin-bottom:11px;">How to play</div>' +
          '<ul style="font-size:13px;line-height:1.62;opacity:0.87;padding-left:16px;margin:0;">' +
            '<li>Ten cards each. One card is turned up as the <b>discard</b>; the rest is the <b>stock</b>.</li>' +
            '<li>On your turn take <b>either</b> the face-up discard <b>or</b> the top of the stock, then throw one card away.</li>' +
            '<li><b>Sets</b> are three or four of a rank. <b>Runs</b> are three or more in sequence in one suit. Aces are low.</li>' +
            '<li>A card can be in a set or a run, never both. The bit finds the arrangement that leaves you least.</li>' +
            '<li>Whatever will not meld is <b>deadwood</b>: aces 1, faces 10, everything else its own number.</li>' +
            '<li><b>Knock</b> when your deadwood is 10 or less. Your opponent lays off what fits onto your melds, and you score the difference.</li>' +
            '<li><b>Gin</b> is zero deadwood: 25 bonus and no lay-offs allowed.</li>' +
            '<li><b>Undercut</b>: if their deadwood ends up equal or lower than yours, <i>they</i> score the difference plus 25.</li>' +
            '<li>If the stock runs down to two cards with nobody knocking, the hand is dead and nobody scores.</li>' +
            '<li>The cover names whoever should be holding the phone, and closes itself the moment they throw a card.</li>' +
          '</ul>' +
          '<button data-el="helpp-close" style="' + BIG + 'margin-top:16px;background:' + GOLD + ';color:#3A2210;">Got it</button>' +
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
    tap(el("menu-help"), () => { el("helpp").style.display = "flex"; });
    tap(el("helpp-close"), () => { el("helpp").style.display = "none"; });
    const openSettings = () => {
      el("abandon").style.display = phase === "menu" ? "none" : "block";
      el("cogp").style.display = "flex";
    };
    tap(el("cog"), openSettings);
    tap(el("menu-cog"), openSettings);
    tap(el("cogp-close"), () => { el("cogp").style.display = "none"; });
    tap(el("abandon"), () => {
      el("cogp").style.display = "none";
      el("cover").style.display = "none";
      el("sheet").style.display = "none";
      el("over").style.display = "none";
      el("menu").style.display = "flex";
      phase = "menu"; show = null; result = null;
      sprites.clear();
      paintHud();
    });

    function pills(host, values, labels, get, set) {
      host.innerHTML = values.map((v, i) =>
        '<button data-v="' + esc(String(v)) + '" style="flex:1;padding:11px 0;border:none;border-radius:12px;' +
        'font-family:inherit;font-size:14px;font-weight:800;">' + esc(labels[i]) + '</button>').join("");
      const repaint = () => {
        for (const b of host.querySelectorAll("button")) {
          const on = String(get()) === b.dataset.v;
          b.style.background = on ? GOLD : "rgba(246,235,216,0.10)";
          b.style.color = on ? "#3A2210" : "rgba(246,235,216,0.62)";
        }
      };
      for (const b of host.querySelectorAll("button")) {
        tap(b, () => { set(b.dataset.v); saveSettings(); repaint(); sound.haptic("light"); });
      }
      repaint();
    }
    pills(el("tc"), [50, 100, 250], ["50", "100", "250"],
          () => settings.target, (v) => { settings.target = Number(v); });
    pills(el("fc"), ["burgundy", "forest", "indigo"], ["Burgundy", "Forest", "Indigo"],
          () => settings.felt, (v) => { settings.felt = v; table = bakeTable(); });
    pills(el("hc"), ["on", "off"], ["On", "Off"],
          () => (settings.hints ? "on" : "off"), (v) => { settings.hints = v === "on"; });

    el("n0").value = settings.names[0] || "";
    el("n1").value = settings.names[1] || "";

    tap(el("go"), async () => {
      settings.names = [el("n0").value, el("n1").value];
      saveSettings();
      ctx.platform.start();
      await sound.unlock();
      el("menu").style.display = "none";
      newMatch();
      paintHud();
    });
    tap(el("cover-go"), () => beginTurn());
    tap(el("again"), () => {
      el("over").style.display = "none";
      newMatch();
      paintHud();
    });
    tap(el("over-menu"), () => {
      el("over").style.display = "none";
      el("menu").style.display = "flex";
      phase = "menu"; sprites.clear();
      paintHud();
    });

    /* ---------------------------------------------------------------
     * HUD painting
     * ------------------------------------------------------------- */
    function chip(p, right) {
      const lead = p.score >= settings.target;
      return '<div style="display:flex;flex-direction:column;' +
        (right ? "align-items:flex-end;" : "align-items:flex-start;") + '">' +
        '<div style="font-size:11px;font-weight:800;letter-spacing:0.05em;color:' + p.css + ';' +
          'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:110px;">' + esc(p.name) + '</div>' +
        '<div style="font-size:22px;font-weight:900;line-height:1;margin-top:1px;' +
          'color:' + (lead ? GOLD : PARCH) + ';">' + p.score + '</div>' +
      '</div>';
    }

    function btn(label, style, dataEl) {
      return '<button data-el="' + dataEl + '" style="' + BIG + 'flex:1;pointer-events:auto;' +
        style + '">' + label + '</button>';
    }

    let hintUntil = 0, hintText = "";
    function flashHint(msg) {
      hintText = msg;
      hintUntil = performance.now() + 2000;
      el("hint").textContent = msg;
      el("hint").style.color = "#FF9F7A";
      ctx.timeout(() => {
        if (performance.now() >= hintUntil) { hintText = ""; el("hint").style.color = ""; paintHud(); }
      }, 2050);
    }

    function paintHud() {
      if (!players) {
        el("s0").innerHTML = ""; el("s1").innerHTML = "";
        el("mid").innerHTML = "";
        el("acts").innerHTML = "";
        el("hint").textContent = "";
        el("ledge").style.display = phase === "menu" ? "none" : "block";
        return;
      }
      el("ledge").style.display = "block";
      el("s0").innerHTML = chip(players[0], false);
      el("s1").innerHTML = chip(players[1], true);
      el("mid").innerHTML = "Hand " + handNo + "<br>to " + settings.target;

      const acts = el("acts");
      acts.innerHTML = "";
      let hint = "";

      if (phase === "draw") {
        hint = stock.length + " left in the stock";
        acts.innerHTML = '<div style="' + BIG + 'flex:1;background:rgba(246,235,216,0.07);' +
          'color:rgba(246,235,216,0.55);text-align:center;">Take a pile — face-up or blind</div>';
      } else if (phase === "discard") {
        // Recomputed here rather than read off `view`: paintHud runs on the
        // commit, before the next layout, so `view` is still last frame's and
        // the button would offer to knock on a number nobody can see.
        const shown = selected ? hands[turn].filter((c) => c.id !== selected) : hands[turn];
        const dw = arrangementOf(shown).deadwood;
        if (!selected) {
          hint = dw <= 10 ? "you can knock" : "knock at 10 or less";
          acts.innerHTML = '<div style="' + BIG + 'flex:1;background:rgba(246,235,216,0.07);' +
            'color:rgba(246,235,216,0.55);text-align:center;">Tap a card to throw it</div>';
        } else if (dw === 0) {
          hint = "Nothing left in hand";
          acts.innerHTML = btn("Throw", "background:rgba(246,235,216,0.13);color:" + PARCH + ";", "b-discard") +
            btn("GIN", "background:" + GOLD + ";color:#3A2210;", "b-gin");
        } else if (canKnock(dw)) {
          hint = "knock is on";
          acts.innerHTML = btn("Throw", "background:rgba(246,235,216,0.13);color:" + PARCH + ";", "b-discard") +
            btn("Knock &nbsp;" + dw, "background:" + GOLD + ";color:#3A2210;", "b-knock");
        } else {
          hint = "leaves " + dw + " · knock at 10";
          acts.innerHTML = btn("Throw it", "background:" + GOLD + ";color:#3A2210;", "b-discard");
        }
      } else if (phase === "knock") {
        hint = show.gin ? "No lay-offs against gin" : "Pass the phone to " + players[show.defender].name;
        acts.innerHTML = btn(show.gin ? "Count it up" : players[show.defender].name + " — lay off",
                             "background:" + GOLD + ";color:#3A2210;", "b-tolayoff");
      } else if (phase === "layoff") {
        const any = show.dDead.some((c) => layOffTarget(c, show.kMelds) >= 0);
        hint = any ? "Tap a glowing card to lay it off" : "Nothing else fits";
        acts.innerHTML = (any ? btn("Lay them all off", "background:rgba(246,235,216,0.13);color:" + PARCH + ";", "b-layall") : "") +
          btn("Score it", "background:" + GOLD + ";color:#3A2210;", "b-settle");
      } else if (phase === "throwing") {
        hint = "";
        acts.innerHTML = '<div style="' + BIG + 'flex:1;background:rgba(246,235,216,0.07);' +
          'color:rgba(246,235,216,0.4);text-align:center;">…</div>';
      } else if (phase === "over") {
        acts.innerHTML = "";
      }

      if (performance.now() < hintUntil) el("hint").textContent = hintText;
      else { el("hint").textContent = hint; el("hint").style.color = ""; }
    }

    /**
     * One delegated handler for the action row, bound exactly once.
     *
     * Binding buttons from inside a paint function looks harmless when the
     * markup is rebuilt around them — innerHTML throws the old nodes away with
     * their listeners — but the same habit applied to a button that is NOT
     * rebuilt is a real bug. The round sheet's "Next hand" collected one more
     * listener on every result, so by the fourth hand a single tap dealt four
     * of them and the hands in between were never played at all. It took the
     * hand numbers in a scripted match jumping 1, 2, 4, 7, 11 to see it.
     */
    const ACTIONS = {
      "b-discard": () => commitDiscard(false),
      "b-knock": () => commitDiscard(true),
      "b-gin": () => commitDiscard(true),
      "b-tolayoff": () => {
        if (show.gin) { settle(); return; }
        phase = "layoff";
        sound.haptic("light");
        paintHud();
      },
      "b-layall": () => layOffEverything(),
      "b-settle": () => settle(),
    };
    ctx.listen(el("acts"), "pointerdown", (e) => e.stopPropagation());
    ctx.listen(el("acts"), "click", (e) => {
      e.stopPropagation();
      e.preventDefault();
      const node = e.target && e.target.closest ? e.target.closest("[data-el]") : null;
      const fn = node && ACTIONS[node.dataset.el];
      if (fn) fn();
    });
    tap(el("sheet-go"), () => nextHand());

    function paintResult() {
      el("acts").innerHTML = "";
      el("hint").textContent = "";
      const s = el("sheet-body");
      if (result.dead) {
        s.innerHTML =
          '<div style="font-size:10px;letter-spacing:0.3em;text-transform:uppercase;opacity:0.5;">Hand ' + result.hand + '</div>' +
          '<div style="font-size:26px;font-weight:900;margin-top:3px;">Dead hand</div>' +
          '<div style="font-size:13.5px;opacity:0.62;line-height:1.5;margin-top:5px;">' +
            'The stock ran down to two cards with nobody knocking. Nobody scores; same dealer deals again.</div>';
      } else {
        const p = players[result.seat];
        const tagStyle = "display:inline-block;padding:3px 9px;border-radius:8px;font-size:10px;" +
          "font-weight:900;letter-spacing:0.18em;text-transform:uppercase;";
        const tag = result.gin
          ? '<span style="' + tagStyle + 'background:' + GOLD + ';color:#3A2210;">Gin +25</span>'
          : result.undercut
            ? '<span style="' + tagStyle + 'background:#FF9F7A;color:#3A1408;">Undercut +25</span>'
            : '<span style="' + tagStyle + 'background:rgba(246,235,216,0.14);color:' + PARCH + ';">Knock</span>';
        s.innerHTML =
          '<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;">' +
            '<div style="font-size:10px;letter-spacing:0.3em;text-transform:uppercase;opacity:0.5;">Hand ' + result.hand + '</div>' + tag +
          '</div>' +
          '<div style="font-size:27px;font-weight:900;margin-top:6px;color:' + p.css + ';line-height:1.15;">' +
            esc(p.name) + ' +' + result.points + '</div>' +
          '<div style="font-size:13px;opacity:0.66;margin-top:4px;line-height:1.5;">' +
            esc(players[result.knocker].name) + ' ' + result.kDeadwood + ' deadwood · ' +
            esc(players[1 - result.knocker].name) + ' ' + result.dDeadwood +
            (result.gin ? ' · no lay-offs' : '') + '</div>' +
          '<div style="display:flex;gap:14px;margin-top:11px;font-size:14px;font-weight:800;">' +
            '<span style="color:' + players[0].css + ';">' + esc(players[0].name) + ' ' + players[0].score + '</span>' +
            '<span style="color:' + players[1].css + ';">' + esc(players[1].name) + ' ' + players[1].score + '</span>' +
          '</div>';
      }
      const done = players && (players[0].score >= settings.target || players[1].score >= settings.target);
      el("sheet-go").textContent = done ? "Final score" : "Next hand";
      el("sheet").style.display = "block";
      paintHud();
    }

    /* ---------------------------------------------------------------
     * Art and the frame loop
     * ------------------------------------------------------------- */
    /**
     * Bake the drop shadow INTO each card, once.
     *
     * The shadow has to be built from concentric strokes because the canvas
     * blur filter is rejected at upload — and stroking a wide rounded rect
     * three times per card per frame is the single most expensive thing on
     * this screen. Twenty cards is sixty wide strokes a frame, which measured
     * at four fifths of the budget on a machine with no GPU. Composited into
     * the sprite instead, a card costs exactly one drawImage.
     */
    function shadowed(src, w, h) {
      if (!src) return null;
      const pad = Math.round(w * 0.12);
      const surf = makeSurface(w + pad * 2, h + pad * 2);
      if (!surf) return src;
      const q = surf.getContext("2d");
      softShadow(q, (c) => roundRect(c, pad, pad, w, h, Math.min(w, h) * 0.085),
                 { spread: pad * 1.6, alpha: 0.05, step: Math.max(1.6, pad * 0.24) });
      q.drawImage(src, pad, pad, w, h);
      return surf;
    }

    function rebuildArt() {
      const cw = Math.round(L.pw * 2), ch = Math.round(L.ph * 2);
      const deck = makeDeckArt(cw, ch, { accent: "#6A2B3C" });
      const faces = {};
      for (const k of Object.keys(deck.faces)) faces[k] = shadowed(deck.faces[k], cw, ch);
      art = { faces, back: shadowed(deck.back, cw, ch), pad: Math.round(cw * 0.12) / cw };
      table = bakeTable();
    }
    rebuildArt();

    ctx.onFrame((dtMs) => {
      const dt = Math.min(dtMs, 40) / 1000;
      if (bandPulse > 0.002) bandPulse *= Math.pow(0.02, dt); else bandPulse = 0;
      if (shake > 0.0004) shake *= Math.pow(0.004, dt); else shake = 0;

      layout();
      stepSprites(dt);

      // A new meld forming is the moment worth marking, so notice it here
      // rather than trying to catch it at every place a card can move.
      if (view && view.arr && (phase === "draw" || phase === "discard" || phase === "throwing") && revealed) {
        const sig = view.arr.melds.map((m) => m.map((c) => c.id).join("")).join("|");
        if (sig !== meldSig) {
          if (sig.length > meldSig.length && meldSig !== "") {
            sound.sting("coin");
            sound.haptic("light");
            bandPulse = 1;
          }
          meldSig = sig;
        }
        const heat = Math.round(clamp(1 - view.arr.deadwood / 60, 0.15, 1) * 10) / 10;
        if (heat !== lastHeat) { lastHeat = heat; sound.heat(heat); }
      }

      paint();
    });

    ctx.listen(window, "resize", () => {
      if (ctx.width === W && ctx.height === H) return;
      measure();
      rebuildArt();
    });

    /* ---------------------------------------------------------------
     * A read-only window for the local harness. Nothing here mutates
     * state — every move in a test goes through a real tap.
     * ------------------------------------------------------------- */
    window.__RUMMY__ = {
      get phase() { return phase; },
      get busy() { return busy(); },
      get turn() { return turn; },
      get handNo() { return handNo; },
      get target() { return settings.target; },
      get scores() { return players ? players.map((p) => p.score) : []; },
      get names() { return players ? players.map((p) => p.name) : []; },
      get stock() { return stock.length; },
      get discardTop() { return discard.length ? discard[discard.length - 1].id : null; },
      get selected() { return selected; },
      get winner() { return winner; },
      get result() { return result; },
      get show() {
        return show && {
          knocker: show.knocker, defender: show.defender, gin: show.gin,
          kDeadwood: show.kDeadwood, dDeadwood: show.dDeadwood,
          laid: show.laid.map((l) => l.card.id), settled: show.settled,
        };
      },
      hand: (i) => hands[i].map((c) => c.id),
      /** What the shipped rules engine says about an arbitrary set of ids. */
      readHand: (i) => {
        const a = bestArrangement(hands[i]);
        return { deadwood: a.deadwood, melds: a.melds.map((m) => m.map((c) => c.id)), dead: a.dead.map((c) => c.id) };
      },
      outcomes: () => discardOutcomes(hands[turn])
        .map((o) => ({ id: o.card.id, deadwood: o.deadwood, locked: o.card.id === tookId })),
      /** Deadwood for any set of card ids, straight through the shipped engine. */
      evaluate: (list) => bestArrangement(list.map((id) =>
        ({ id, rank: id.slice(0, id.length - 1), suit: id.slice(-1) }))).deadwood,
      get took() { return tookId; },
      pile: (which) => ({ x: which === "stock" ? L.stockX : L.discX, y: L.pileY }),
      cardXY: (id) => {
        const s = sprites.get(id);
        return s ? { x: s.tx, y: s.ty } : null;
      },
      /** Where a finger has to land to hit THIS card and not its neighbour. */
      tapXY: (id) => {
        const z = hit.find((q) => q.id === "card:" + id || q.id === "lay:" + id);
        if (!z) return null;
        return hitAt(z.x, z.y) === z.id ? { x: z.x, y: z.y } : null;
      },
      zones: () => hit.map((z) => z.id),
    };
    ctx.onDestroy(() => { try { delete window.__RUMMY__; } catch (_) {} });

    paintHud();
    layout();
    paint();
    ctx.markVisualReady("table laid");
    ctx.platform.ready();
  },
};
