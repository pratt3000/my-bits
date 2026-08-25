/**
 * Hold'em — Texas Hold'em for two to six people and one phone.
 *
 * Poker is the hardest thing in this repo to put on a shared screen, for two
 * reasons that pull against each other.
 *
 * The first is secrecy. Every other card game here either has nothing hidden
 * (Crownlands) or hides everything (Bluffin). Hold'em hides exactly four cards
 * per table and shows everything else, and the showing part is the game:
 * the board, the pot, every bet and every stack have to stay up permanently or
 * nobody can read the table. So the hidden part gets the smallest possible
 * enclosure — a cover over the bottom quarter of the screen naming whoever
 * should be holding the phone. It lifts on a TAP, not a hold: the screen
 * underneath has to be tapped to fold, call or size a raise, and holding it
 * open would take a third hand. Its exposure is bounded by the player's own
 * commit instead — acting closes the cover in the same gesture.
 *
 * The second is that the rules are unforgiving. A poker bit that mis-ranks one
 * hand in fifty is worthless, and no screenshot will ever tell you. The whole
 * engine therefore sits between RULES START / RULES END markers and
 * tools/harness/rules-holdem.mjs lifts it out and tests the shipped code
 * directly: the wheel (A-2-3-4-5, ace LOW), a board-plays split, quads over a
 * full house, a flush over a straight, kickers, side pots, minimum raises, and
 * the rule that an all-in raise for less than a full raise does not reopen the
 * betting.
 *
 * Contract notes: no packaged assets (maxAssets is 0), so the felt, the chips
 * and all 52 faces are canvas paths, baked once into OffscreenCanvases with a
 * live-draw fallback. The overlay is one markup string on ctx.createRoot() with
 * pointer-events off on the root itself, because that element sits above the
 * canvas and would otherwise swallow every tap. Player names are escaped before
 * they go anywhere near innerHTML. Every timer is anchored to a
 * performance.now() timestamp rather than accumulated from frame deltas, which
 * would inherit the frame clamp and run slow on a struggling device.
 */
window.plethoraBit = {
  meta: {
    title: "Hold'em",
    runtime: "plethora-bit@2",
    tags: ["cards", "poker", "multiplayer", "local-multiplayer", "pass-and-play", "classic"],
    permissions: ["backgroundMusic", "haptics", "storage"],
    keyboardBehavior: "none",
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

    /** Offscreen surface for baking sprites. Never a host-document canvas. */
    function makeSurface(w, h) {
      if (typeof OffscreenCanvas === "undefined") return null;   // older WebViews: draw live
      return new OffscreenCanvas(Math.max(1, Math.ceil(w)), Math.max(1, Math.ceil(h)));
    }

    /* ---------------------------------------------------------------------
     * PLAYING CARDS — a full 52-card deck drawn procedurally.
     *
     * Packaged assets are disabled (maxAssets: 0), so pips and courts are
     * canvas paths. Each face is baked once to an OffscreenCanvas and then
     * blitted, which keeps a board of five cards to five drawImage calls.
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
     * the ~54px a phone gives a board card. This draws a single flat heraldic
     * figure — crown, face, mantle — reading as King/Queen/Jack by its headwear,
     * with the suit colour carrying the rest.
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
/*
 * The whole of Hold'em: hand ranking, side pots, and the betting round.
 *
 * Nothing in here touches ctx, the canvas or the clock, so
 * tools/harness/rules-holdem.mjs can lift this block straight out of the file
 * and drive it in node. That matters more here than anywhere else in the repo:
 * a hand evaluator that is wrong one time in fifty looks perfect in every
 * screenshot and ruins every game.
 *
 * Cards are the same objects the renderer uses — { rank: "10", suit: "H" } —
 * so nothing has to be converted between the engine and the table. The rank
 * names below are declared locally rather than reused from the deck block
 * above, which is the price of keeping this section liftable.
 */
const HRANKS = ["2","3","4","5","6","7","8","9","10","J","Q","K","A"];
const RANK_VAL = {};
HRANKS.forEach((r, i) => { RANK_VAL[r] = i + 2; });          // 2..14, ace HIGH by default
const RANK_NAME = { 2:"Two",3:"Three",4:"Four",5:"Five",6:"Six",7:"Seven",8:"Eight",
                    9:"Nine",10:"Ten",11:"Jack",12:"Queen",13:"King",14:"Ace" };
const RANK_PLURAL = { 2:"Twos",3:"Threes",4:"Fours",5:"Fives",6:"Sixes",7:"Sevens",8:"Eights",
                      9:"Nines",10:"Tens",11:"Jacks",12:"Queens",13:"Kings",14:"Aces" };
const CAT_NAME = ["High card","Pair","Two pair","Three of a kind","Straight",
                  "Flush","Full house","Four of a kind","Straight flush"];

/** "As" / "Td" / "10h" -> a card object. Test convenience, and cheap. */
function parseCard(s) {
  const t = String(s).trim();
  let r = t.slice(0, -1).toUpperCase();
  const suit = t.slice(-1).toUpperCase();
  if (r === "T") r = "10";
  return { rank: r, suit, red: suit === "H" || suit === "D", id: r + suit };
}
function parseCards(str) { return String(str).trim().split(/\s+/).filter(Boolean).map(parseCard); }

/** Every 5-subset of n indices. n is 7 in play, so this is the 21 combinations. */
const _combos = {};
function combos5(n) {
  if (_combos[n]) return _combos[n];
  const out = [];
  for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) for (let c = b + 1; c < n; c++)
    for (let d = c + 1; d < n; d++) for (let e = d + 1; e < n; e++) out.push([a, b, c, d, e]);
  return (_combos[n] = out);
}

/**
 * Rank exactly five cards.
 *
 * Returns { score, cat, tie } where a bigger score is a better hand and score
 * is total across categories, so two hands are compared with one integer
 * compare and an exact tie is an exact tie — which is what a split pot needs.
 *
 * cat: 0 high card … 8 straight flush. tie is the ordered list of values that
 * break ties inside the category, longest first, so kickers fall out of the
 * same comparison rather than needing a second pass.
 *
 * The wheel is the trap. A-2-3-4-5 is a straight, and in it the ace is LOW:
 * it is the WORST straight, beaten by 6-5-4-3-2. Ranking by the ace would make
 * it the best, which is the single most common poker bug there is.
 */
function rank5(cards) {
  const rs = cards.map(c => RANK_VAL[c.rank]).sort((a, b) => b - a);
  const s0 = cards[0].suit;
  const flush = cards.every(c => c.suit === s0);

  const uniq = [];
  for (const r of rs) if (uniq[uniq.length - 1] !== r) uniq.push(r);
  let sHigh = 0;
  if (uniq.length === 5) {
    if (uniq[0] - uniq[4] === 4) sHigh = uniq[0];
    // A-5-4-3-2: the ace plays low and the straight is FIVE high, not ace high.
    else if (uniq[0] === 14 && uniq[1] === 5 && uniq[1] - uniq[4] === 3) sHigh = 5;
  }

  const cnt = {};
  for (const r of rs) cnt[r] = (cnt[r] || 0) + 1;
  // Group ranks by how many of them there are, then by rank. Trips before
  // pairs, higher pair before lower, so grp reads straight out as the tiebreak.
  const grp = Object.keys(cnt).map(Number).sort((a, b) => cnt[b] - cnt[a] || b - a);
  const n0 = cnt[grp[0]], n1 = grp.length > 1 ? cnt[grp[1]] : 0;

  let cat, tie;
  if (flush && sHigh)            { cat = 8; tie = [sHigh]; }
  else if (n0 === 4)             { cat = 7; tie = [grp[0], grp[1]]; }
  else if (n0 === 3 && n1 === 2) { cat = 6; tie = [grp[0], grp[1]]; }
  else if (flush)                { cat = 5; tie = rs.slice(); }
  else if (sHigh)                { cat = 4; tie = [sHigh]; }
  else if (n0 === 3)             { cat = 3; tie = [grp[0], grp[1], grp[2]]; }
  else if (n0 === 2 && n1 === 2) { cat = 2; tie = [grp[0], grp[1], grp[2]]; }
  else if (n0 === 2)             { cat = 1; tie = [grp[0], grp[1], grp[2], grp[3]]; }
  else                           { cat = 0; tie = rs.slice(); }

  let score = cat;
  for (let i = 0; i < 5; i++) score = score * 15 + (tie[i] || 0);
  return { score, cat, tie };
}

/** The best five of seven (or six, or five). All 21 combinations, ranked. */
function best7(cards) {
  const idx = combos5(cards.length);
  let best = null;
  for (const cb of idx) {
    const five = [cards[cb[0]], cards[cb[1]], cards[cb[2]], cards[cb[3]], cards[cb[4]]];
    const r = rank5(five);
    if (!best || r.score > best.score) best = { score: r.score, cat: r.cat, tie: r.tie, cards: five };
  }
  return best;
}

function handName(h) {
  const t = h.tie;
  switch (h.cat) {
    case 8: return t[0] === 14 ? "Royal flush" : "Straight flush, " + RANK_NAME[t[0]] + " high";
    case 7: return "Four " + RANK_PLURAL[t[0]];
    case 6: return RANK_PLURAL[t[0]] + " full of " + RANK_PLURAL[t[1]];
    case 5: return "Flush, " + RANK_NAME[t[0]] + " high";
    case 4: return "Straight, " + RANK_NAME[t[0]] + " high";
    case 3: return "Three " + RANK_PLURAL[t[0]];
    case 2: return "Two pair, " + RANK_PLURAL[t[0]] + " and " + RANK_PLURAL[t[1]];
    case 1: return "Pair of " + RANK_PLURAL[t[0]];
    default: return RANK_NAME[t[0]] + " high";
  }
}

/** What two hole cards are called before a flop exists. */
function preflopName(hole) {
  if (!hole || hole.length < 2) return "";
  const a = RANK_VAL[hole[0].rank], b = RANK_VAL[hole[1].rank];
  if (a === b) return "Pocket " + RANK_PLURAL[a];
  const hi = Math.max(a, b), lo = Math.min(a, b);
  return RANK_NAME[hi] + "-" + RANK_NAME[lo] + (hole[0].suit === hole[1].suit ? " suited" : "");
}

/* ---------------- the table ---------------- */

const BLIND_LEVELS = [[10,20],[15,30],[25,50],[50,100],[75,150],[100,200],
                      [150,300],[200,400],[300,600],[500,1000]];

function newMatch(names, opts) {
  opts = opts || {};
  return {
    players: names.map((n, i) => ({
      i, name: n, chips: opts.stack || 1000, hole: [],
      folded: false, allIn: false, out: false,
      bet: 0, committed: 0, hasActed: false, raiseLocked: false,
      last: "", delta: 0,
    })),
    board: [], deck: [], dealer: 0, sbIdx: 0, bbIdx: 0,
    street: 0, toAct: -1, betToMatch: 0, minRaise: 0,
    sb: BLIND_LEVELS[0][0], bb: BLIND_LEVELS[0][1], level: 0,
    handNo: 0, blindEvery: opts.blindEvery === undefined ? 8 : opts.blindEvery,
    biggestPot: 0, result: null,
  };
}

const seatsIn   = (S) => S.players.filter(p => !p.out).length;
const liveCount = (S) => S.players.filter(p => !p.out && !p.folded).length;
const canActCount = (S) => S.players.filter(p => !p.out && !p.folded && !p.allIn).length;
const potTotal  = (S) => S.players.reduce((a, p) => a + p.committed, 0);
const potMiddle = (S) => S.players.reduce((a, p) => a + p.committed - p.bet, 0);

function nextSeat(S, i) {
  const n = S.players.length;
  for (let k = 1; k <= n; k++) { const j = (i + k) % n; if (!S.players[j].out) return j; }
  return i;
}

/**
 * Does this player still owe the table an action?
 *
 * The second clause is the one that earns its keep. A player who has already
 * acted still owes an action if somebody raised behind them — and, crucially,
 * also if somebody moved all in for LESS than a full raise, where they must
 * call or fold but may not raise again.
 */
function needsToAct(S, p) {
  return !p.out && !p.folded && !p.allIn && (!p.hasActed || p.bet < S.betToMatch);
}

function nextActor(S, from) {
  const n = S.players.length;
  for (let k = 0; k < n; k++) {
    const i = (from + k) % n;
    if (needsToAct(S, S.players[i])) return i;
  }
  return -1;
}

function put(S, p, n) {
  n = Math.max(0, Math.min(n, p.chips));
  p.chips -= n; p.bet += n; p.committed += n;
  if (p.chips === 0) p.allIn = true;
  return n;
}

/**
 * A forced blind. An all-in blind smaller than the full blind does NOT lower
 * what everybody else has to call — the bet to match stays at the big blind.
 */
function postBlind(S, i, amt) {
  const p = S.players[i];
  put(S, p, amt);
  p.last = amt === S.sb ? "small blind" : "big blind";
}

function startHand(S, deck) {
  S.deck = deck.slice();
  S.board = [];
  S.street = 0;
  S.result = null;
  S.handNo++;
  S.level = S.blindEvery > 0
    ? Math.min(BLIND_LEVELS.length - 1, Math.floor((S.handNo - 1) / S.blindEvery))
    : 0;
  S.sb = BLIND_LEVELS[S.level][0];
  S.bb = BLIND_LEVELS[S.level][1];

  for (const p of S.players) {
    p.hole = []; p.folded = p.out; p.allIn = false;
    p.bet = 0; p.committed = 0; p.hasActed = false; p.raiseLocked = false;
    p.last = ""; p.delta = 0;
  }

  const n = seatsIn(S);
  let first;
  if (n === 2) {
    // Heads up the dealer IS the small blind and acts first before the flop,
    // then acts last on every street after it. Getting this backwards is the
    // classic two-handed bug.
    S.sbIdx = S.dealer; S.bbIdx = nextSeat(S, S.dealer); first = S.sbIdx;
  } else {
    S.sbIdx = nextSeat(S, S.dealer);
    S.bbIdx = nextSeat(S, S.sbIdx);
    first = nextSeat(S, S.bbIdx);
  }
  postBlind(S, S.sbIdx, S.sb);
  postBlind(S, S.bbIdx, S.bb);
  S.betToMatch = S.bb;
  S.minRaise = S.bb;

  // One card at a time, twice round, starting left of the dealer — the order a
  // real deal uses, so a scripted deck lays out the way a reader expects.
  for (let round = 0; round < 2; round++) {
    let k = nextSeat(S, S.dealer);
    for (let c = 0; c < n; c++) { S.players[k].hole.push(S.deck.shift()); k = nextSeat(S, k); }
  }
  S.toAct = nextActor(S, first);
  return S;
}

/** What the player to act may legally do, and the exact legal raise window. */
function legalActions(S) {
  const i = S.toAct;
  if (i < 0) return null;
  const p = S.players[i];
  const toCall = Math.max(0, S.betToMatch - p.bet);
  const callAmt = Math.min(toCall, p.chips);
  const maxTo = p.bet + p.chips;
  const opponents = S.players.filter(q => q !== p && !q.out && !q.folded && !q.allIn).length;
  // No point raising when nobody left can answer it, and a player facing an
  // undersized all-in may call but not re-raise.
  const canRaise = !p.raiseLocked && opponents > 0 && maxTo > S.betToMatch;
  const minTo = Math.min(S.betToMatch + S.minRaise, maxTo);
  return {
    seat: i, toCall, callAmt,
    canFold: true,
    canCheck: toCall === 0,
    canCall: toCall > 0 && p.chips > 0,
    allInCall: toCall > 0 && p.chips <= toCall,
    canRaise, minTo, maxTo,
    opening: S.betToMatch === 0,
    pot: potTotal(S),
  };
}

/**
 * Commit one action and hand the turn on.
 *
 * kind: "fold" | "check" | "call" | "raise" | "allin". For "raise", amount is
 * the total this player will have in FOR THE STREET (raise *to*, not raise
 * *by*) — the number a live dealer says out loud, and the one that makes the
 * minimum-raise test a single comparison.
 */
function applyAction(S, kind, amount) {
  const la = legalActions(S);
  if (!la) throw new Error("nobody to act");
  const i = S.toAct;
  const p = S.players[i];
  const ev = { seat: i, kind, amount: 0, allIn: false };

  if (kind === "fold") {
    p.folded = true; p.last = "fold";
  } else if (kind === "check") {
    if (!la.canCheck) throw new Error("cannot check facing a bet");
    p.last = "check";
  } else if (kind === "call") {
    ev.amount = put(S, p, la.callAmt);
    p.last = ev.amount > 0 ? "call" : "check";
  } else if (kind === "raise" || kind === "bet") {
    if (!la.canRaise) throw new Error("cannot raise here");
    let to = Math.round(amount);
    if (to > la.maxTo) to = la.maxTo;
    if (to < la.minTo) to = la.minTo;
    const raiseSize = to - S.betToMatch;
    ev.amount = put(S, p, to - p.bet);
    p.last = la.opening ? "bet" : "raise";
    if (raiseSize >= S.minRaise) {
      // A full raise resets the round: everybody still in gets to answer it,
      // and anybody previously locked out of raising is free again.
      S.minRaise = raiseSize;
      for (const q of S.players) {
        if (q !== p && !q.out && !q.folded && !q.allIn) { q.hasActed = false; q.raiseLocked = false; }
      }
    } else {
      // An all-in for less than a full raise does NOT reopen the betting.
      // Players who have already acted must call or fold; they may not re-raise.
      for (const q of S.players) {
        if (q !== p && !q.out && !q.folded && !q.allIn && q.hasActed) q.raiseLocked = true;
      }
    }
    if (to > S.betToMatch) S.betToMatch = to;
  } else if (kind === "allin") {
    if (la.canRaise && la.maxTo > S.betToMatch) return applyAction(S, "raise", la.maxTo);
    ev.amount = put(S, p, la.callAmt);            // all in for less than the call
    p.last = "call";
  } else {
    throw new Error("unknown action " + kind);
  }

  if (!p.folded && p.chips === 0) { p.allIn = true; p.last = "all in"; ev.allIn = true; }
  p.hasActed = true;
  S.toAct = nextActor(S, (i + 1) % S.players.length);
  return ev;
}

/** Sweep the street's bets into the pot and reset the round. */
function closeStreet(S) {
  for (const p of S.players) {
    p.bet = 0; p.hasActed = false; p.raiseLocked = false;
    if (!p.folded && !p.allIn) p.last = "";
  }
  S.betToMatch = 0;
  S.minRaise = S.bb;
}

/** Burn one, then flop / turn / river. */
function dealStreet(S) {
  S.street++;
  S.deck.shift();
  if (S.street === 1) S.board.push(S.deck.shift(), S.deck.shift(), S.deck.shift());
  else S.board.push(S.deck.shift());
  return S.street;
}

/** After the flop the first live player left of the dealer speaks first. */
function openBetting(S) {
  S.toAct = nextActor(S, nextSeat(S, S.dealer));
}

/**
 * Split the money.
 *
 * An uncalled bet comes off the top FIRST. If one player put in more than
 * anybody matched, the excess was never contested and a live dealer pushes it
 * straight back before counting anything. Leaving it in instead produces a
 * one-player "side pot" that is really just your own chips coming home, and it
 * inflates every number downstream: a 500 shove everyone folds to reads as a
 * 530 pot, and that is what would go on the leaderboard.
 *
 * What is left is then built by contribution level, not by "who was all in".
 * Every distinct total anybody still has in becomes a ceiling; each layer
 * collects the slice every player paid into it — folded players included,
 * because their chips stay in the pot — and only unfolded players who reached
 * that ceiling can win it. That handles three players all in for three
 * different amounts.
 *
 * Odd chips left over from a split go to the first winner left of the dealer,
 * which is how a live dealer breaks it.
 */
function settle(S) {
  const ps = S.players;

  // The most anybody else matched. Only money up to that line was ever played
  // for; one player's overhang above it is returned, not won.
  const desc = ps.map(p => p.committed).sort((a, b) => b - a);
  const called = desc[1] || 0;
  const eff = ps.map(p => p.committed);
  let returned = null;
  if (desc[0] > called) {
    const top = ps.findIndex(p => p.committed === desc[0]);
    returned = { seat: top, amount: desc[0] - called };
    eff[top] = called;
  }

  const levels = [];
  for (const p of ps) if (eff[p.i] > 0 && levels.indexOf(eff[p.i]) < 0) levels.push(eff[p.i]);
  levels.sort((a, b) => a - b);

  const raw = [];
  let prev = 0;
  for (const lv of levels) {
    let amount = 0;
    for (const p of ps) amount += Math.min(eff[p.i], lv) - Math.min(eff[p.i], prev);
    const elig = ps.filter(p => !p.folded && eff[p.i] >= lv).map(p => p.i);
    if (amount > 0) raw.push({ amount, elig });
    prev = lv;
  }
  // Neighbouring layers with identical eligibility are one pot to a human.
  const pots = [];
  for (const pt of raw) {
    const last = pots[pots.length - 1];
    if (last && last.elig.length === pt.elig.length && last.elig.every((v, k) => v === pt.elig[k])) {
      last.amount += pt.amount;
    } else pots.push({ amount: pt.amount, elig: pt.elig.slice() });
  }

  const showdown = ps.filter(p => !p.folded).length > 1;
  const hands = {};
  if (showdown) for (const p of ps) if (!p.folded) hands[p.i] = best7(p.hole.concat(S.board));

  const awards = ps.map(() => 0);
  if (returned) awards[returned.seat] += returned.amount;
  for (const pt of pots) {
    let elig = pt.elig;
    if (!elig.length) elig = ps.filter(p => p.committed > 0).map(p => p.i);
    let winners;
    if (!showdown) winners = elig.filter(i => !ps[i].folded);
    else {
      let best = -1;
      for (const i of elig) if (hands[i] && hands[i].score > best) best = hands[i].score;
      winners = elig.filter(i => hands[i] && hands[i].score === best);
    }
    if (!winners.length) winners = elig;
    pt.winners = winners;
    const base = Math.floor(pt.amount / winners.length);
    let rem = pt.amount - base * winners.length;
    const order = [];
    for (let k = 1; k <= ps.length; k++) {
      const i = (S.dealer + k) % ps.length;
      if (winners.indexOf(i) >= 0) order.push(i);
    }
    for (const i of order) { awards[i] += base + (rem > 0 ? 1 : 0); if (rem > 0) rem--; }
  }
  return { pots, awards, hands, showdown, returned,
           total: potTotal(S) - (returned ? returned.amount : 0) };
}

/** Pay out, then note the biggest single pot anybody has dragged this match. */
function payout(S, res) {
  for (const p of S.players) {
    p.delta = res.awards[p.i] - p.committed;
    p.chips += res.awards[p.i];
  }
  // The record is money somebody actually dragged. A bet nobody called was
  // never won — it only came home — so it does not count towards it.
  res.awards.forEach((a, i) => {
    const won = a - (res.returned && res.returned.seat === i ? res.returned.amount : 0);
    if (won > S.biggestPot) S.biggestPot = won;
  });
  S.result = res;
  return res;
}
/* ===== RULES END ===== */

    const TAU = Math.PI * 2;
    const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
    const esc = (s) => String(s).replace(/[&<>"']/g,
      (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    const now = () => performance.now();

    /* ---------------------------------------------------------------
     * Settings and sound
     * ------------------------------------------------------------- */
    const DEFAULT_NAMES = ["Ada", "Bo", "Cleo", "Dov", "Esme", "Finn"];
    const saved = (function () {
      try { return ctx.storage.get("holdem") || {}; } catch (_) { return {}; }
    })();
    const settings = {
      players: clamp(saved.players || 3, 2, 6),
      blindEvery: saved.blindEvery === undefined ? 8 : saved.blindEvery,
      names: Array.isArray(saved.names) ? saved.names.slice(0, 6) : DEFAULT_NAMES.slice(),
      mute: !!saved.mute,
    };
    while (settings.names.length < 6) settings.names.push(DEFAULT_NAMES[settings.names.length]);
    function saveSettings() { try { ctx.storage.set("holdem", settings); } catch (_) {} }

    const sound = (function () {
      let muted = settings.mute, bed = null, unlocked = false;
      const start = () => ctx.music.play({ preset: "lofi", volume: 0.22, tempo: 82, intensity: 0.24 });
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
     * Palette. Warm low light over green felt: the light is amber and
     * comes from above, so every highlight leans yellow and every
     * shadow leans blue-green. Nothing here is a pure hue.
     * ------------------------------------------------------------- */
    const C = {
      feltHi: "#1a5c42", feltMid: "#0e3b2c", feltLow: "#05180f",
      railHi: "#7a4a2c", railMid: "#48281a", railLow: "#24120c",
      brass: "#c9a24a", gold: "#e8bd6a",
      parch: "#f3e7cf", dim: "rgba(243,231,207,0.52)",
      panelHi: "#1d1510", panelLow: "#0a0705",
      seat: ["#f0b429", "#e0644a", "#54bdd8", "#9b83f0", "#5fc188", "#ef7ab8"],
    };
    const F = "-apple-system,system-ui,'Segoe UI',Roboto,sans-serif";

    /* ---------------------------------------------------------------
     * Layout. A portrait phone with six seats and a five-card board is
     * genuinely tight, so nothing is placed on a circle by formula —
     * the seat rings are hand-picked per player count to keep the
     * horizontal mid-band clear for the board, and every bet badge
     * hangs off its own plaque rather than floating where it can
     * collide with a card.
     * ------------------------------------------------------------- */
    let W = ctx.width, H = ctx.height;
    const ST = ctx.safeArea.top, SB = ctx.safeArea.bottom;
    const L = {};

    // u,v are in [-1,1] across the table ellipse. Clockwise from the bottom.
    const SEATS = {
      2: [[0, 1], [0, -1]],
      3: [[0, 1], [-0.88, -0.50], [0.88, -0.50]],
      4: [[0, 1], [-0.88, 0.42], [0, -1], [0.88, 0.42]],
      5: [[0, 1], [-0.88, 0.44], [-0.80, -0.52], [0.80, -0.52], [0.88, 0.44]],
      6: [[0, 1], [-0.88, 0.42], [-0.88, -0.42], [0, -1], [0.88, -0.42], [0.88, 0.42]],
    };

    function measure() {
      W = ctx.width; H = ctx.height;
      L.panelH = Math.round(clamp(H * 0.315, 224, 268));
      L.panelTop = H - SB - L.panelH;
      L.topBar = ST + 52;
      L.tableTop = L.topBar + 14;
      L.tableBot = L.panelTop - 8;
      L.cx = W / 2;
      L.cy = (L.tableTop + L.tableBot) / 2;
      L.rx = Math.min(172, (W - 24) / 2);
      L.ry = (L.tableBot - L.tableTop) / 2;
      L.cw = Math.min(54, Math.floor((W - 44) / 5) - 6);
      L.ch = Math.round(L.cw * 1.4);
      L.plaqueW = 104; L.plaqueH = 46;
      // The action row is anchored to the bottom edge; everything else in the
      // panel is measured off it, so the hole cards fill whatever is left
      // instead of leaving a dead band under the buttons.
      L.actH = 56; L.actBottom = SB + 16;
      L.actTop = H - L.actBottom - L.actH;
      L.holeTop = L.panelTop + 16;
      L.holeBot = L.actTop - 14;
      L.hw = Math.min(80, Math.round((L.holeBot - L.holeTop) / 1.4), Math.floor((W - 200) / 2));
      L.hh = Math.round(L.hw * 1.4);
      L.hwS = 42; L.hhS = 59;                    // the same cards while sizing a raise
    }
    measure();

    /** Where seat i sits, for a table of n. */
    function seatPos(i, n) {
      const s = (SEATS[n] || SEATS[6])[i] || [0, 1];
      // Clamped so a 104px plaque always keeps both ends on screen: a 390px
      // phone leaves about seven pixels either side of the felt, and an
      // unclamped seat ring puts half a name past the edge.
      const half = L.plaqueW / 2 + 6;
      return { x: clamp(L.cx + s[0] * (L.rx - 10), half, W - half),
               y: L.cy + s[1] * (L.ry - 24), u: s[0], v: s[1] };
    }
    /** Where that seat's bet chips sit — attached to the plaque, toward the middle. */
    function betPos(i, n) {
      const p = seatPos(i, n);
      // Top and bottom seats stack their chips above/below the plaque and
      // offset to the right, because the dealer button lives on the left
      // corner and the two would otherwise sit on each other.
      if (Math.abs(p.u) < 0.3) return { x: p.x + 30, y: p.y - Math.sign(p.v) * 34 };
      return { x: p.x - Math.sign(p.u) * 72, y: p.y };
    }
    function potPos() { return { x: L.cx, y: L.cy + L.ch * 0.5 + 24 }; }
    function boardPos(k) {
      const gap = 6, total = 5 * L.cw + 4 * gap;
      return { x: L.cx - total / 2 + k * (L.cw + gap) + L.cw / 2, y: L.cy - 4 };
    }

    /* ---------------------------------------------------------------
     * State
     * ------------------------------------------------------------- */
    let S = null;
    let phase = "menu";        // menu | deal | handoff | acting | anim | result | over
    let status = "";
    let revealed = null;       // { seat, hole:[art,art], label }
    let raiseOpen = false, raiseTo = 0;
    let anims = [], pending = 0, shake = 0;
    let emblemA = 1;             // the house wordmark, cleared away by the board
    let lastResult = null, matchWinner = null;
    const busy = () => anims.length > 0 || pending > 0;

    function queue(fn, ms) {
      pending++;
      ctx.timeout(() => { pending--; try { fn(); } catch (e) { ctx.platform.error({ message: String(e) }); } }, ms);
    }
    function anim(a) { a.t0 = now(); anims.push(a); return a; }
    /** Anchored to a timestamp, never accumulated from frame deltas. */
    function prog(a) { return clamp((now() - a.t0) / a.dur, 0, 1); }

    /* ---------------------------------------------------------------
     * Baked art
     * ------------------------------------------------------------- */
    const canvas = ctx.createCanvas2D({ touchAction: "none" });
    const g = canvas.getContext("2d");
    let art = null, felt = null;

    function bakeFelt() {
      const c = makeSurface(W, H);
      if (!c) return null;
      const q = c.getContext("2d");

      // Room: almost black, with the lamp's warm spill on the wall behind.
      const room = q.createRadialGradient(L.cx, L.cy - L.ry * 0.5, 10, L.cx, L.cy, Math.max(W, H));
      room.addColorStop(0, "#1a1109");
      room.addColorStop(0.45, "#0d0906");
      room.addColorStop(1, "#040302");
      q.fillStyle = room; q.fillRect(0, 0, W, H);

      // Rail: a thick mahogany ring under the lamp, brighter at the top.
      const rr = 15;
      const railGrad = q.createLinearGradient(0, L.cy - L.ry, 0, L.cy + L.ry);
      railGrad.addColorStop(0, C.railHi);
      railGrad.addColorStop(0.42, C.railMid);
      railGrad.addColorStop(1, C.railLow);
      q.save();
      q.beginPath(); q.ellipse(L.cx, L.cy, L.rx + rr, L.ry + rr, 0, 0, TAU);
      q.fillStyle = railGrad; q.fill();
      // A drop under the rail so the table sits on the floor rather than in it.
      q.restore();
      softShadow(q, (t) => { t.beginPath(); t.ellipse(L.cx, L.cy + 6, L.rx + rr, L.ry + rr, 0, 0, TAU); },
                 { spread: 22, alpha: 0.06, step: 3 });
      q.beginPath(); q.ellipse(L.cx, L.cy, L.rx + rr, L.ry + rr, 0, 0, TAU);
      q.fillStyle = railGrad; q.fill();

      // Brass inlay between rail and felt.
      q.beginPath(); q.ellipse(L.cx, L.cy, L.rx + 3, L.ry + 3, 0, 0, TAU);
      q.strokeStyle = "rgba(201,162,74,0.55)"; q.lineWidth = 2; q.stroke();

      // Felt, lit from above.
      const fg = q.createRadialGradient(L.cx, L.cy - L.ry * 0.42, 8, L.cx, L.cy, L.rx * 1.5);
      fg.addColorStop(0, C.feltHi);
      fg.addColorStop(0.55, C.feltMid);
      fg.addColorStop(1, C.feltLow);
      q.save();
      q.beginPath(); q.ellipse(L.cx, L.cy, L.rx, L.ry, 0, 0, TAU); q.clip();
      q.fillStyle = fg; q.fillRect(0, 0, W, H);

      // Weave: a fine two-way speckle so the cloth has a surface under the light.
      q.globalAlpha = 0.045;
      for (let i = 0; i < 4200; i++) {
        q.fillStyle = Math.random() < 0.5 ? "#ffffff" : "#000000";
        q.fillRect(Math.random() * W, Math.random() * H, 1.5, 1.5);
      }
      q.globalAlpha = 1;

      // House emblem rings, dead centre, barely there. Rings only: a ring the
      // board partly covers still reads as a ring.
      q.strokeStyle = "rgba(243,231,207,0.09)"; q.lineWidth = 1.2;
      q.beginPath(); q.ellipse(L.cx, L.cy, L.rx * 0.60, L.ry * 0.42, 0, 0, TAU); q.stroke();
      q.beginPath(); q.ellipse(L.cx, L.cy, L.rx * 0.60 - 5, L.ry * 0.42 - 5, 0, 0, TAU);
      q.strokeStyle = "rgba(243,231,207,0.05)"; q.stroke();
      q.restore();
      // The wordmark itself is NOT baked — it is drawn live in paintTable so it
      // can be put away when the board arrives. Baked, a three-card flop covers
      // it only as far as its third card and leaves the tail of the M sticking
      // out beside the king, which reads as a stray glyph rather than a table.

      // Vignette: concentric strokes rather than a blur filter.
      q.save();
      q.lineJoin = "round";
      for (let k = 0; k < 26; k++) {
        q.strokeStyle = "rgba(0,0,0,0.055)";
        q.lineWidth = 12;
        q.beginPath();
        q.rect(-6 - k * 5, -6 - k * 5, W + 12 + k * 10, H + 12 + k * 10);
        q.stroke();
      }
      q.restore();
      return c;
    }

    function rebuildArt() {
      art = makeDeckArt(Math.round(L.cw * 2), Math.round(L.ch * 2), { accent: "#1d4f7a" });
      felt = bakeFelt();
    }
    rebuildArt();

    /* ---------------------------------------------------------------
     * Chips. Weight comes from drawing the wall of the disc, not just
     * the top of it, and the edge stripes are the thing that makes a
     * clay chip read as a clay chip.
     * ------------------------------------------------------------- */
    const DENOMS = [
      [500, "#7c5cd6", "#3a2a70"],
      [100, "#2b2b34", "#0f0f14"],
      [25,  "#3f9d63", "#1c4a2e"],
      [5,   "#c0392b", "#6b1e15"],
      [1,   "#e8e2d4", "#8a8272"],
    ];

    function drawChip(x, y, r, c1, c2) {
      const ry = r * 0.42, t = r * 0.36;
      g.beginPath();
      g.moveTo(x + r, y); g.lineTo(x + r, y + t);
      g.ellipse(x, y + t, r, ry, 0, 0, Math.PI);
      g.lineTo(x - r, y);
      g.closePath();
      g.fillStyle = c2; g.fill();
      g.fillStyle = "rgba(255,255,255,0.26)";
      for (let k = 0; k < 7; k++) {
        const a = Math.PI * (0.08 + k * 0.14);
        g.fillRect(x + Math.cos(a) * r * 0.97 - r * 0.07, y + Math.sin(a) * ry * 0.97, r * 0.14, t);
      }
      g.beginPath(); g.ellipse(x, y, r, ry, 0, 0, TAU);
      g.fillStyle = c1; g.fill();
      g.strokeStyle = "rgba(0,0,0,0.38)"; g.lineWidth = 0.8; g.stroke();
      g.fillStyle = c2;
      for (let k = 0; k < 6; k++) {
        const a = k * TAU / 6 + 0.35;
        g.save();
        g.translate(x + Math.cos(a) * r * 0.79, y + Math.sin(a) * ry * 0.79);
        g.beginPath(); g.ellipse(0, 0, r * 0.15, ry * 0.26, 0, 0, TAU); g.fill();
        g.restore();
      }
      g.beginPath(); g.ellipse(x, y, r * 0.56, ry * 0.56, 0, 0, TAU);
      g.strokeStyle = "rgba(255,255,255,0.34)"; g.lineWidth = 1.1; g.stroke();
    }

    function drawStack(x, y, r, n, c1, c2) {
      const t = r * 0.36;
      for (let i = 0; i < n; i++) drawChip(x, y - i * t, r, c1, c2);
    }

    /** Break an amount into up to four stacks and draw them side by side. */
    function drawChipPile(x, y, amount, r) {
      if (amount <= 0) return;
      const parts = [];
      let left = amount;
      for (const [d, c1, c2] of DENOMS) {
        if (left < d) continue;
        const n = Math.floor(left / d);
        left -= n * d;
        parts.push({ n: Math.min(n, 6), c1, c2 });
        if (parts.length === 4) break;
      }
      if (!parts.length) parts.push({ n: 1, c1: "#e8e2d4", c2: "#8a8272" });
      const gap = r * 2.15;
      const x0 = x - (parts.length - 1) * gap / 2;
      parts.forEach((p, i) => drawStack(x0 + i * gap, y, r, p.n, p.c1, p.c2));
    }

    /* ---------------------------------------------------------------
     * Cards on the table
     * ------------------------------------------------------------- */
    function paintCard(card, x, y, w, h, o) {
      o = o || {};
      g.save();
      g.translate(x, y + (o.lift ? -o.lift : 0));
      if (o.rot) g.rotate(o.rot);
      if (o.scale && o.scale !== 1) g.scale(o.scale, 1);
      softShadow(g, (q) => roundRect(q, -w / 2, -h / 2, w, h, w * 0.09),
                 { spread: 10 + (o.lift || 0) * 0.6, alpha: 0.075 });
      if (o.ring) {
        g.save(); g.lineJoin = "round";
        for (let s = 12; s >= 2; s -= 2.2) {
          g.strokeStyle = o.ring + (0.26 * (1 - s / 12) + 0.09).toFixed(3) + ")";
          g.lineWidth = s;
          roundRect(g, -w / 2, -h / 2, w, h, w * 0.09);
          g.stroke();
        }
        g.restore();
      }
      const img = o.img || (o.face === false ? (art && art.back) : (art && art.faces[card.id]));
      if (img) g.drawImage(img, -w / 2, -h / 2, w, h);
      else {
        roundRect(g, -w / 2, -h / 2, w, h, w * 0.09);
        g.fillStyle = o.face === false ? "#1d4f7a" : "#fdfcf7"; g.fill();
        if (o.face !== false && card) {
          g.fillStyle = card.red ? "#c8202f" : "#1b1b22";
          g.font = "700 " + (w * 0.4) + "px ui-serif, Georgia, serif";
          g.textAlign = "center"; g.textBaseline = "middle";
          g.fillText(card.rank, 0, 0);
        }
      }
      if (o.dim) {
        roundRect(g, -w / 2, -h / 2, w, h, w * 0.09);
        g.fillStyle = "rgba(4,10,7," + o.dim + ")"; g.fill();
      }
      g.restore();
    }

    function label(text, x, y, size, colour, align, track) {
      g.save();
      g.font = "800 " + size + "px " + F;
      g.fillStyle = colour;
      g.textAlign = align || "center";
      g.textBaseline = "middle";
      if (track) {
        const chars = String(text).split("");
        const wtot = chars.reduce((a, ch) => a + g.measureText(ch).width + track, -track);
        let cx = align === "center" ? x - wtot / 2 : x;
        g.textAlign = "left";
        for (const ch of chars) { g.fillText(ch, cx, y); cx += g.measureText(ch).width + track; }
      } else g.fillText(text, x, y);
      g.restore();
    }

    /* ---------------------------------------------------------------
     * The table
     * ------------------------------------------------------------- */
    function drawPlaque(p, n) {
      const pos = seatPos(p.i, n);
      const w = L.plaqueW, h = L.plaqueH;
      const x = pos.x - w / 2, y = pos.y - h / 2;
      const col = C.seat[p.i % C.seat.length];
      const active = S && S.toAct === p.i && (phase === "handoff" || phase === "acting");
      const alpha = p.out ? 0.28 : p.folded ? 0.4 : 1;

      g.save();
      g.globalAlpha = alpha;
      softShadow(g, (q) => roundRect(q, x, y, w, h, 13), { spread: 12, alpha: 0.09, step: 3 });
      if (active) {
        g.save(); g.lineJoin = "round";
        for (let s = 16; s >= 2; s -= 2.4) {
          g.strokeStyle = hexA(col, 0.16 * (1 - s / 16) + 0.05);
          g.lineWidth = s;
          roundRect(g, x, y, w, h, 13);
          g.stroke();
        }
        g.restore();
      }
      roundRect(g, x, y, w, h, 13);
      const bg = g.createLinearGradient(0, y, 0, y + h);
      bg.addColorStop(0, active ? "rgba(30,22,14,0.97)" : "rgba(10,16,13,0.90)");
      bg.addColorStop(1, active ? "rgba(14,10,6,0.97)" : "rgba(4,9,7,0.92)");
      g.fillStyle = bg; g.fill();
      g.strokeStyle = active ? hexA(col, 0.95) : hexA(col, 0.30);
      g.lineWidth = active ? 1.8 : 1;
      g.stroke();

      // Two face-down hole cards live inside the plaque, so a seat always
      // reads as "has cards / mucked" without needing room outside it.
      const cw = 22, ch = 31, cxx = x + 24, cyy = pos.y;
      if (S && p.hole.length && !p.folded && !p.out) {
        paintCard(null, cxx - 5, cyy, cw, ch, { face: false, rot: -0.12 });
        paintCard(null, cxx + 4, cyy, cw, ch, { face: false, rot: 0.10 });
      } else if (S && p.folded && !p.out) {
        g.save();
        g.globalAlpha = 0.35;
        paintCard(null, cxx, cyy, cw, ch, { face: false, rot: 0.5, dim: 0.55 });
        g.restore();
      }

      const tx = x + 44;
      g.textAlign = "left";
      label(clipText(p.name, 70, "800 12.5px " + F), tx, pos.y - 9, 12.5, col, "left");
      if (p.out) label("out", tx, pos.y + 9, 12, C.dim, "left");
      else if (p.allIn) label("ALL IN", tx, pos.y + 9, 11, C.gold, "left", 0.8);
      else label(p.chips.toLocaleString(), tx, pos.y + 9, 14, C.parch, "left");
      g.restore();

      // Dealer button, outboard of the plaque.
      if (S && S.dealer === p.i && !p.out) {
        // Opposite corner from the bet chips, and never off the screen edge.
        const dx = pos.x + (pos.u > -0.2 ? -1 : 1) * (w / 2 - 13);
        const dy = pos.y + (pos.v >= 0 ? -1 : 1) * (h / 2 + 9);
        g.beginPath(); g.arc(dx, dy, 10, 0, TAU);
        g.fillStyle = "#f6f1e4"; g.fill();
        g.strokeStyle = "rgba(0,0,0,0.35)"; g.lineWidth = 1; g.stroke();
        label("D", dx, dy + 0.5, 11, "#23180d");
      }
    }

    function drawBetBadge(p, n) {
      if (!p.bet || p.folded || p.out) return;
      const b = betPos(p.i, n);
      const txt = p.bet.toLocaleString();
      g.font = "800 11.5px " + F;
      const tw = g.measureText(txt).width;
      const w = 20 + tw + 11, h = 19;
      roundRect(g, b.x - w / 2, b.y - h / 2, w, h, 9.5);
      g.fillStyle = "rgba(4,11,8,0.72)"; g.fill();
      drawChip(b.x - w / 2 + 11, b.y - 1, 6.5, "#c0392b", "#6b1e15");
      label(txt, b.x - w / 2 + 20, b.y, 11.5, C.parch, "left");
    }

    function drawBoard() {
      const n = S.board.length;
      const ba = anims.find(a => a.kind === "board");
      for (let k = 0; k < 5; k++) {
        const p = boardPos(k);
        // No footprint for a slot that has no card in it: five grey boxes on
        // the felt read as chrome, and a real table has nothing there.
        if (k >= n) continue;
        let t = 1;
        if (ba && k >= ba.from) {
          const per = 1 / Math.max(1, ba.to - ba.from);
          t = clamp((prog(ba) - (k - ba.from) * per * 0.72) / (per * 0.9), 0, 1);
        }
        if (t <= 0) continue;
        const ease = 1 - Math.pow(1 - t, 3);
        // A flip: the card scales through zero width, back to front.
        const sc = Math.abs(Math.cos(Math.PI * (1 - ease) * 0.5));
        const showBack = ease < 0.5;
        const winRing = lastResult && lastResult.boardMark && lastResult.boardMark[k];
        paintCard(S.board[k], p.x, p.y, L.cw, L.ch, {
          face: !showBack,
          scale: Math.max(0.02, sc),
          lift: Math.sin(ease * Math.PI) * 10,
          ring: winRing ? "rgba(232,189,106," : null,
        });
      }
    }

    function drawPot() {
      // The pile in the middle is only the money already swept in, but the
      // NUMBER has to be the whole pot: the panel quotes the total, and a felt
      // reading "POT 0" beside a panel reading "POT 30" is just two numbers
      // with the same label disagreeing. A live dealer calls the total too.
      const mid = potMiddle(S);
      const total = potTotal(S);
      const p = potPos();
      if (mid > 0) drawChipPile(p.x, p.y, mid, 11);
      const on = total > 0;
      label("POT", p.x, p.y + 24, 9.5, on ? C.dim : "rgba(243,231,207,0.26)", "center", 2.2);
      label(on ? total.toLocaleString() : "0", p.x, p.y + 42, 19,
            on ? C.gold : "rgba(243,231,207,0.28)");
    }

    function drawFlyers() {
      for (const a of anims) {
        if (a.kind === "chips") {
          const t = prog(a);
          const e = 1 - Math.pow(1 - t, 3);
          for (const it of a.items) {
            const x = it.from.x + (it.to.x - it.from.x) * e;
            const y = it.from.y + (it.to.y - it.from.y) * e - Math.sin(e * Math.PI) * 22;
            drawChipPile(x, y, it.amount, 8);
          }
        } else if (a.kind === "deal") {
          const t = prog(a);
          for (const it of a.items) {
            const local = clamp((t * a.dur - it.delay) / it.dur, 0, 1);
            if (local <= 0 || local >= 1) continue;
            const e = 1 - Math.pow(1 - local, 3);
            paintCard(null,
              it.from.x + (it.to.x - it.from.x) * e,
              it.from.y + (it.to.y - it.from.y) * e,
              22, 31, { face: false, rot: (1 - e) * 0.7, lift: Math.sin(e * Math.PI) * 14 });
          }
        }
      }
    }

    function paintTable() {
      g.save();
      if (shake > 0.0005) g.translate((Math.random() - 0.5) * shake * W, (Math.random() - 0.5) * shake * W);
      if (felt) g.drawImage(felt, 0, 0, W, H);
      else { g.fillStyle = C.feltMid; g.fillRect(0, 0, W, H); }
      if (emblemA > 0.01) {
        label("H O L D ' E M", L.cx, L.cy, 12, "rgba(243,231,207," + (0.10 * emblemA).toFixed(3) + ")");
      }

      // Top bar: whose game this is, and where the blinds have got to.
      if (S && phase !== "over") {
        label("HAND", 18, ST + 16, 9, C.dim, "left", 2);
        label(String(S.handNo || 1), 18, ST + 33, 17, C.parch, "left");
        label("BLINDS", 74, ST + 16, 9, C.dim, "left", 2);
        label(S.sb + " / " + S.bb, 74, ST + 33, 17, C.gold, "left");
      }

      // Felt only under the match-over sheet. It is a 0.94 wash, and at 6%
      // a white board card and a lit seat plaque both show straight through
      // the winner's name.
      if (S && phase !== "over") {
        const n = S.players.length;
        drawBoard();
        drawPot();
        for (const p of S.players) drawPlaque(p, n);
        for (const p of S.players) drawBetBadge(p, n);
        drawFlyers();
      }
      g.restore();
    }

    /* ---------------------------------------------------------------
     * The bottom panel: the only private thing on the screen.
     * ------------------------------------------------------------- */
    function panelBase() {
      const y = L.panelTop;
      roundRect(g, -2, y, W + 4, H - y + 4, 22);
      const lg = g.createLinearGradient(0, y, 0, H);
      lg.addColorStop(0, C.panelHi);
      lg.addColorStop(1, C.panelLow);
      g.fillStyle = lg; g.fill();
      g.beginPath(); g.moveTo(0, y + 0.5); g.lineTo(W, y + 0.5);
      g.strokeStyle = "rgba(201,162,74,0.34)"; g.lineWidth = 1; g.stroke();
      return y;
    }

    function drawCover() {
      const y = panelBase();
      const p = S.players[S.toAct];
      const col = C.seat[p.i % C.seat.length];
      g.save();
      roundRect(g, -2, y, W + 4, H - y + 4, 22); g.clip();
      const rg = g.createRadialGradient(L.cx, y + 40, 6, L.cx, y + 40, W * 0.9);
      rg.addColorStop(0, hexA(col, 0.24));
      rg.addColorStop(1, hexA(col, 0));
      g.fillStyle = rg; g.fillRect(0, y, W, H - y);

      label("PASS THE PHONE TO", L.cx, y + 30, 10, C.dim, "center", 2.6);
      label(clipText(p.name, W - 60, "900 38px " + F), L.cx, y + 68, 38, col);
      const la = legalActions(S);
      const what = la && la.toCall > 0 ? "to call " + la.toCall : "to check or bet";
      label(what, L.cx, y + 98, 13, "rgba(243,231,207,0.55)");

      // Two backs face down on the felt, breathing. They are the target: the
      // whole panel is the hit area, and this is what it looks like it does.
      const bob = Math.sin((now() % 2600) / 2600 * TAU) * 3;
      const cy2 = y + L.panelH - 84 + bob;
      paintCard(null, L.cx - 27, cy2 + 3, 76, 106, { face: false, rot: -0.15 });
      paintCard(null, L.cx + 27, cy2, 76, 106, { face: false, rot: 0.15 });
      label("TAP TO SEE YOUR CARDS", L.cx, y + L.panelH - 15, 10.5, hexA(col, 0.92), "center", 2.4);
      g.restore();
    }

    function drawActing() {
      const y = panelBase();
      const p = S.players[S.toAct];
      const col = C.seat[p.i % C.seat.length];
      const la = legalActions(S);
      const hw = raiseOpen ? L.hwS : L.hw, hh = raiseOpen ? L.hhS : L.hh;
      const cy = raiseOpen ? L.holeTop + hh / 2 : (L.holeTop + L.holeBot) / 2;

      // The two cards, fanned like a hand held low over the felt.
      paintCard(p.hole[0], 20 + hw / 2, cy + 3, hw, hh,
                { rot: -0.055, img: !raiseOpen && revealed ? revealed.art[0] : null });
      paintCard(p.hole[1], 20 + hw + 10 + hw / 2, cy, hw, hh,
                { rot: 0.055, img: !raiseOpen && revealed ? revealed.art[1] : null });

      const tx = 20 + hw * 2 + 20;
      if (raiseOpen) {
        label(clipText(p.name, W - tx - 18, "900 17px " + F), tx, cy - 14, 17, col, "left");
        label(clipText(revealed ? revealed.label : "", W - tx - 18, "800 12px " + F),
              tx, cy + 6, 12, C.gold, "left");
        label("stack " + p.chips.toLocaleString() + "  ·  pot " + la.pot.toLocaleString(),
              tx, cy + 26, 11.5, C.dim, "left");
        return;
      }

      label(clipText(p.name, W - tx - 18, "900 20px " + F), tx, y + 30, 20, col, "left");
      label(clipText(revealed ? revealed.label : "", W - tx - 18, "800 12.5px " + F),
            tx, y + 54, 12.5, C.gold, "left");

      const rows = [
        ["STACK", p.chips.toLocaleString(), C.parch],
        [la.toCall > 0 ? "TO CALL" : "TO BET", la.toCall > 0 ? la.toCall.toLocaleString() : "—",
         la.toCall > 0 ? "#ff9b6a" : C.dim],
        ["POT", la.pot.toLocaleString(), C.gold],
      ];
      const r0 = y + 86, rgap = Math.min(30, (L.holeBot - r0 - 6) / 3);
      rows.forEach((r, i) => {
        const ry = r0 + i * rgap + rgap / 2;
        label(r[0], tx, ry, 9, C.dim, "left", 2);
        label(r[1], W - 20, ry, 16, r[2], "right");
        if (i < 2) {
          const ly = Math.round(ry + rgap / 2) + 0.5;
          g.save();
          g.strokeStyle = "rgba(243,231,207,0.09)"; g.lineWidth = 1;
          g.beginPath(); g.moveTo(tx, ly); g.lineTo(W - 20, ly); g.stroke();
          g.restore();
        }
      });
    }

    function drawIdlePanel() {
      const y = panelBase();
      label(status || "", L.cx, y + L.panelH * 0.42, 17, C.parch);
      if (S && phase === "anim") {
        label("dealing", L.cx, y + L.panelH * 0.42 + 26, 10, C.dim, "center", 2.4);
      }
    }

    /* ---------------------------------------------------------------
     * The showdown. Everything is public here, so it gets the whole
     * screen — this is the one moment the table wants to lean in.
     * ------------------------------------------------------------- */
    function paintResult() {
      const r = lastResult;
      if (!r) return;
      // Opaque, and it fades up rather than cutting. A showdown is the one
      // screen everybody leans over, and the table ghosting through the rows
      // made them unreadable.
      const fa = anims.find(a => a.kind === "veil");
      const k = fa ? prog(fa) : 1;
      if (k < 1) { g.fillStyle = "rgba(5,10,8," + (k * 0.99).toFixed(3) + ")"; g.fillRect(0, 0, W, H); }
      else { const vg = g.createLinearGradient(0, 0, 0, H);
             vg.addColorStop(0, "#0b100d"); vg.addColorStop(1, "#050807");
             g.fillStyle = vg; g.fillRect(0, 0, W, H); }
      if (k < 0.4) return;

      label(r.showdown ? "SHOWDOWN" : "EVERYONE FOLDED", L.cx, ST + 58, 10.5, C.dim, "center", 3);
      label(clipText(r.headline, W - 44, "900 22px " + F), L.cx, ST + 94, 22, C.gold);

      // Board, pot breakdown and rows are allocated out of one budget, top
      // down, so a two-handed showdown and a six-handed one with three side
      // pots both compose instead of one of them overrunning the other.
      const nR = Math.max(1, r.rows.length);
      const topY = ST + 112, floorY = H - SB - 76;
      const budget = floorY - topY;
      const pl = r.potLines || [];
      const lh = 15, plH = pl.length * lh + 20;
      // With no board to hold, the rows are allowed to grow further: two rows
      // pinned at 130 leave a fifth of the screen empty above and below them,
      // and two symmetrical holes read as a layout fault where one generous
      // margin reads as design.
      const rowH = clamp((budget - plH - 100) / nR, 54, S.board.length ? 130 : 156);
      let bandH = budget - plH - rowH * nR;
      let topY2 = topY;
      // A hand that ends before the flop has no board, and holding the board's
      // whole band open for it leaves one grey line marooned in 280px of
      // nothing. Give the band to the money instead — the pot IS the subject
      // of a hand nobody saw a flop in — and re-centre what is left.
      if (!S.board.length) {
        const want = 112;
        topY2 = topY + Math.round((bandH - want) / 2);
        bandH = want;
      }

      const bwMax = Math.floor((W - 56) / 5) - 5;
      const bw = Math.min(Math.round(clamp(bandH - 24, 44, 90) / 1.4), bwMax);
      const bh = Math.round(bw * 1.4);
      const gap = 5, tot = 5 * bw + 4 * gap, bcy = topY2 + bandH / 2;
      for (let k = 0; k < S.board.length; k++) {
        paintCard(S.board[k], L.cx - tot / 2 + k * (bw + gap) + bw / 2, bcy, bw, bh,
                  { ring: r.boardMark && r.boardMark[k] ? "rgba(232,189,106," : null });
      }
      if (!S.board.length) {
        drawChipPile(L.cx, bcy - 12, r.total || 0, 13);
        label("no flop — the hand ended before the board", L.cx, bcy + 32, 12, C.dim);
      }

      const plTop = topY2 + bandH + 10;
      pl.forEach((t, i) => label(clipText(t, W - 28, "800 11.5px " + F), L.cx,
                                 plTop + i * lh + lh / 2, 11.5, "rgba(243,231,207,0.48)"));

      let y = topY2 + bandH + plH;
      const mw = clamp(rowH * 0.44, 30, 46), mh = Math.round(mw * 1.4);
      r.rows.forEach((row, i) => {
        const ry = y + i * rowH;
        const col = C.seat[row.seat % C.seat.length];
        roundRect(g, 14, ry + 4, W - 28, rowH - 12, 15);
        g.fillStyle = row.main ? "rgba(232,189,106,0.12)"
                    : row.win ? "rgba(232,189,106,0.055)" : "rgba(255,255,255,0.045)";
        g.fill();
        g.strokeStyle = row.main ? "rgba(232,189,106,0.65)"
                      : row.win ? "rgba(232,189,106,0.26)" : "rgba(255,255,255,0.08)";
        g.lineWidth = row.main ? 1.7 : 1;
        g.stroke();

        const mid = ry + rowH / 2 - 2;
        const cx0 = 26 + mw / 2;
        if (row.cards) {
          paintCard(row.cards[0], cx0, mid, mw, mh, { rot: -0.08, ring: row.mark && row.mark[0] ? "rgba(232,189,106," : null });
          paintCard(row.cards[1], cx0 + mw * 0.84, mid, mw, mh, { rot: 0.08, ring: row.mark && row.mark[1] ? "rgba(232,189,106," : null });
        } else {
          paintCard(null, cx0, mid, mw, mh, { face: false, rot: -0.08, dim: 0.45 });
          paintCard(null, cx0 + mw * 0.84, mid, mw, mh, { face: false, rot: 0.08, dim: 0.45 });
        }
        // Measure the chip delta and give the hand name everything that is
        // left: "Two pair, Kings and Queens" is 26 characters and a fixed
        // reserve truncates it on exactly the hands worth reading.
        const dtext = (row.delta >= 0 ? "+" : "") + row.delta.toLocaleString();
        const dsize = row.main ? 20 : 15;
        g.save(); g.font = "800 " + dsize + "px " + F;
        const dw = g.measureText(dtext).width; g.restore();

        const tx = cx0 + mw * 1.34 + 14;
        label(clipText(row.name, W - tx - dw - 30, "800 15.5px " + F), tx, mid - 11, 15.5, col, "left");
        label(clipText(row.hand, W - tx - dw - 30, "800 11.5px " + F), tx, mid + 10, 11.5,
              row.win ? C.gold : C.dim, "left");
        // A player can win a side pot and still be down on the hand, so the
        // number is coloured by the delta, not by whether they won something.
        const dc = row.delta > 0 ? C.gold : row.delta < 0 ? "rgba(224,100,74,0.85)"
                                                          : "rgba(243,231,207,0.42)";
        label(dtext, W - 24, mid, dsize, dc, "right");
      });
    }

    function clipText(s, maxW, font) {
      g.save();
      g.font = font || "800 13px " + F;
      let t = String(s);
      while (t.length > 2 && g.measureText(t).width > maxW) t = t.slice(0, -1);
      if (t !== String(s)) t = t.slice(0, -1) + "…";
      g.restore();
      return t;
    }

    function hexA(hex, a) {
      const h = hex.replace("#", "");
      const n = parseInt(h.length === 3 ? h.split("").map(c => c + c).join("") : h, 16);
      return "rgba(" + ((n >> 16) & 255) + "," + ((n >> 8) & 255) + "," + (n & 255) + "," + a + ")";
    }

    function paint() {
      paintTable();
      if (phase === "result") { paintResult(); return; }
      if (phase === "handoff") drawCover();
      else if (phase === "acting") drawActing();
      // No panel on the menu: its edge would draw a hard line across the
      // dimmed table behind the title.
      else if (phase !== "menu" && phase !== "over") drawIdlePanel();
    }

    /* ---------------------------------------------------------------
     * Overlay. One markup string; the root itself must not eat pointers
     * or it silently swallows every tap meant for the buttons below it.
     * ------------------------------------------------------------- */
    const PB = SB;
    const BIG = "box-sizing:border-box;width:100%;padding:15px;border:none;border-radius:15px;" +
      "font-family:inherit;font-size:16px;font-weight:800;letter-spacing:0.01em;";
    const BTN = "pointer-events:auto;width:34px;height:34px;border-radius:11px;border:none;" +
      "background:rgba(243,231,207,0.12);color:#f3e7cf;font-size:14px;font-family:inherit;padding:0;";
    const ACT = "box-sizing:border-box;pointer-events:auto;flex:1;min-width:0;border:none;" +
      "border-radius:14px;font-family:inherit;" +
      "font-size:15px;font-weight:800;padding:0;height:100%;color:#f3e7cf;";
    const PILL = "box-sizing:border-box;pointer-events:auto;border:none;border-radius:12px;" +
      "font-family:inherit;font-size:13px;font-weight:800;padding:10px 0;flex:1;min-width:0;";
    const CARD = "box-sizing:border-box;background:rgba(20,15,10,0.96);border:1px solid rgba(201,162,74,0.22);border-radius:20px;";
    const INP = "box-sizing:border-box;padding:11px 12px;border-radius:12px;" +
      "border:1px solid rgba(243,231,207,0.16);" +
      "background:rgba(243,231,207,0.06);color:#f3e7cf;font-family:inherit;font-size:14px;font-weight:700;width:100%;";

    const root = ctx.createRoot({ touchAction: "manipulation" });
    root.style.cssText += ";font-family:" + F + ";color:#f3e7cf;pointer-events:none;";
    root.innerHTML =
      '<div style="position:absolute;right:11px;top:' + (ST + 9) + 'px;display:flex;gap:7px;' +
        'z-index:60;pointer-events:none;">' +
        '<button data-el="mute" aria-label="Sound" style="' + BTN + '">🔊</button>' +
        '<button data-el="gear" aria-label="Settings" style="' + BTN + '">⚙</button>' +
        '<button data-el="help" aria-label="How to play" style="' + BTN + '">?</button>' +
      '</div>' +

      // The pass-the-phone cover is a transparent hit target over the whole
      // panel; the art under it is on the canvas.
      '<button data-el="cover" aria-label="Reveal my cards" style="position:absolute;left:0;right:0;' +
        'bottom:' + PB + 'px;height:' + L.panelH + 'px;background:transparent;border:none;' +
        'pointer-events:auto;display:none;font-family:inherit;color:transparent;"></button>' +

      '<div data-el="acts" style="position:absolute;left:18px;right:18px;bottom:' + L.actBottom + 'px;' +
        'height:' + L.actH + 'px;display:none;gap:8px;pointer-events:none;">' +
        '<button data-el="aFold" style="' + ACT + 'background:rgba(224,100,74,0.20);' +
          'box-shadow:inset 0 0 0 1px rgba(224,100,74,0.45);">Fold</button>' +
        '<button data-el="aCall" style="' + ACT + 'background:rgba(95,193,136,0.22);' +
          'box-shadow:inset 0 0 0 1px rgba(95,193,136,0.5);">Check</button>' +
        '<button data-el="aRaise" style="' + ACT + 'background:rgba(232,189,106,0.24);' +
          'box-shadow:inset 0 0 0 1px rgba(232,189,106,0.55);">Raise</button>' +
      '</div>' +

      '<div data-el="rowA" style="position:absolute;left:18px;right:18px;bottom:' + (L.actBottom + L.actH + 44 + 16) + 'px;' +
        'height:50px;display:none;gap:8px;align-items:stretch;pointer-events:none;">' +
        '<button data-el="rMinus" style="' + ACT + 'flex:0 0 54px;background:rgba(243,231,207,0.10);' +
          'font-size:22px;">−</button>' +
        '<div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;' +
          'background:rgba(243,231,207,0.06);border-radius:14px;">' +
          '<div style="font-size:8.5px;letter-spacing:0.24em;opacity:0.5;">RAISE TO</div>' +
          '<div data-el="rAmt" style="font-size:21px;font-weight:900;color:#e8bd6a;line-height:1.15;">0</div>' +
        '</div>' +
        '<button data-el="rPlus" style="' + ACT + 'flex:0 0 54px;background:rgba(243,231,207,0.10);' +
          'font-size:22px;">+</button>' +
      '</div>' +
      '<div data-el="rowB" style="position:absolute;left:18px;right:18px;bottom:' + (L.actBottom + L.actH + 8) + 'px;' +
        'height:36px;display:none;gap:7px;pointer-events:none;">' +
        '<button data-el="rMin" style="' + PILL + 'background:rgba(243,231,207,0.09);color:#f3e7cf;">Min</button>' +
        '<button data-el="rHalf" style="' + PILL + 'background:rgba(243,231,207,0.09);color:#f3e7cf;">½ Pot</button>' +
        '<button data-el="rPot" style="' + PILL + 'background:rgba(243,231,207,0.09);color:#f3e7cf;">Pot</button>' +
        '<button data-el="rAll" style="' + PILL + 'background:rgba(224,100,74,0.26);color:#ffd9c9;">All in</button>' +
      '</div>' +
      '<div data-el="rowC" style="position:absolute;left:18px;right:18px;bottom:' + L.actBottom + 'px;' +
        'height:' + L.actH + 'px;display:none;gap:8px;pointer-events:none;">' +
        '<button data-el="rBack" style="' + ACT + 'flex:0 0 104px;background:rgba(243,231,207,0.09);">Back</button>' +
        '<button data-el="rGo" style="' + ACT + 'background:#e8bd6a;color:#241a08;">Confirm</button>' +
      '</div>' +

      '<button data-el="next" style="position:absolute;left:22px;right:22px;bottom:' + (PB + 12) + 'px;' +
        'height:52px;display:none;pointer-events:auto;' + BIG + 'width:auto;background:#e8bd6a;color:#241a08;">' +
        'Next hand</button>' +

      // Menu
      '<div data-el="menu" style="position:absolute;inset:0;pointer-events:auto;display:flex;' +
        'flex-direction:column;align-items:center;justify-content:center;gap:9px;z-index:50;' +
        'overflow-y:auto;background:rgba(6,11,8,0.88);' +
        'padding:' + (ST + 16) + 'px 22px ' + (SB + 16) + 'px;">' +
        '<div style="font-size:10px;letter-spacing:0.42em;text-transform:uppercase;opacity:0.5;">One phone, pass and play</div>' +
        '<div style="font-size:56px;font-weight:900;letter-spacing:-0.035em;line-height:1;' +
          'background:linear-gradient(100deg,#f3e7cf,#e8bd6a 55%,#b3803a);' +
          '-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;">Hold’em</div>' +
        '<div style="font-size:13.5px;opacity:0.6;line-height:1.5;max-width:270px;text-align:center;">' +
          'Everyone starts on 1,000. Your two cards live behind a cover with your name on it — ' +
          'the board, the pot and every bet stay on the table.</div>' +
        '<div style="font-size:10px;letter-spacing:0.3em;text-transform:uppercase;opacity:0.5;margin-top:12px;">Players</div>' +
        '<div data-el="pc" style="display:flex;gap:6px;width:100%;max-width:300px;"></div>' +
        '<div data-el="names" style="display:grid;grid-template-columns:1fr 1fr;gap:7px;width:100%;' +
          'max-width:300px;margin-top:6px;"></div>' +
        '<button data-el="go" style="' + BIG + 'max-width:300px;margin-top:12px;background:#e8bd6a;' +
          'color:#241a08;">Deal me in</button>' +
        '<div style="font-size:11.5px;opacity:0.42;line-height:1.5;max-width:290px;' +
          'text-align:center;margin-top:10px;">The chips are just numbers. There is no money in ' +
          'this, nothing to buy, and nothing to win but the table.</div>' +
      '</div>' +

      // Match over
      '<div data-el="over" style="position:absolute;inset:0;pointer-events:auto;display:none;' +
        'flex-direction:column;align-items:center;justify-content:center;z-index:58;' +
        'overflow-y:auto;background:rgba(6,11,8,0.94);padding:' + (ST + 16) + 'px 22px ' + (SB + 16) + 'px;">' +
        '<div style="font-size:10px;letter-spacing:0.42em;text-transform:uppercase;opacity:0.5;">Last one with chips</div>' +
        '<div data-el="over-name" style="font-size:46px;font-weight:900;line-height:1.1;margin:6px 0 2px;"></div>' +
        '<div data-el="over-sub" style="font-size:14px;opacity:0.62;"></div>' +
        '<div data-el="over-body" style="' + CARD + 'padding:16px 18px;margin-top:18px;width:100%;max-width:300px;"></div>' +
        '<button data-el="again" style="' + BIG + 'max-width:300px;margin-top:18px;background:#e8bd6a;' +
          'color:#241a08;">New match</button>' +
      '</div>' +

      // Settings
      '<div data-el="setp" style="position:absolute;inset:0;pointer-events:auto;display:none;' +
        'overflow-y:auto;background:#050b08;z-index:70;' +
        'padding:' + (ST + 20) + 'px 22px ' + (SB + 20) + 'px;">' +
        '<div style="max-width:330px;width:100%;margin:auto;' + CARD + 'padding:22px;">' +
          '<div style="font-size:19px;font-weight:800;margin-bottom:14px;">Settings</div>' +
          '<div style="font-size:10px;letter-spacing:0.26em;text-transform:uppercase;opacity:0.5;">Blinds up every</div>' +
          '<div data-el="be" style="display:flex;gap:6px;margin:9px 0 18px;"></div>' +
          '<div style="font-size:10px;letter-spacing:0.26em;text-transform:uppercase;opacity:0.5;">Sound</div>' +
          '<div data-el="sn" style="display:flex;gap:6px;margin:9px 0 6px;"></div>' +
          '<div style="font-size:12.5px;opacity:0.5;line-height:1.5;margin-bottom:16px;">' +
            'Blinds climb through 10/20, 15/30, 25/50, 50/100 and on up, so a big ' +
            'stack cannot simply wait everyone else out.</div>' +
          '<button data-el="endm" style="' + BIG + 'background:rgba(224,100,74,0.22);' +
            'box-shadow:inset 0 0 0 1px rgba(224,100,74,0.45);color:#ffd9c9;">End match</button>' +
          '<button data-el="setp-close" style="' + BIG + 'margin-top:9px;' +
            'background:rgba(243,231,207,0.12);color:#f3e7cf;">Done</button>' +
        '</div>' +
      '</div>' +

      // Instructions
      '<div data-el="helpp" style="position:absolute;inset:0;pointer-events:auto;display:none;' +
        'overflow-y:auto;background:#070c09;z-index:80;' +
        'padding:' + (ST + 18) + 'px 18px ' + (SB + 18) + 'px;">' +
        '<div style="max-width:340px;width:100%;margin:auto;' + CARD + 'padding:20px;">' +
          '<div style="font-size:19px;font-weight:800;margin-bottom:10px;">How to play</div>' +
          '<ul style="font-size:13px;line-height:1.6;opacity:0.88;padding-left:17px;margin:0;">' +
            '<li>Everyone starts on <b>1,000</b>. The two players left of the dealer button post the small and big blind; the button moves one seat every hand.</li>' +
            '<li>You get <b>two cards face down</b>. Five more come out for everybody to share — the flop (3), the turn (1) and the river (1).</li>' +
            '<li>There is a round of betting after the deal and after each of those three.</li>' +
            '<li>On your turn the cover says your name. <b>Tap it</b>, look at your cards, act. Acting closes the cover again, so the phone is never left sitting on your hand.</li>' +
            '<li><b>Fold</b> gives up. <b>Check</b> passes when nothing is owed. <b>Call</b> matches the bet. <b>Raise</b> puts more in, and must be at least as big as the last raise — though going <b>all in</b> for less is always allowed.</li>' +
            '<li>All in for less than the others can bet? The extra goes into a <b>side pot</b> you cannot win, and it is worked out for you.</li>' +
            '<li>At the end, the best <b>five cards out of your seven</b> wins. You may use both, one, or neither of your own.</li>' +
            '<li>Order: straight flush, four of a kind, full house, flush, straight, trips, two pair, pair, high card. Kickers break ties; an exact tie splits the pot.</li>' +
            '<li>A-2-3-4-5 is a straight and the <b>ace counts low</b> — it is the worst straight there is.</li>' +
            '<li>Blinds climb every few hands, so nobody can sit on a stack forever. Last player with chips takes the table.</li>' +
          '</ul>' +
          '<button data-el="helpp-close" style="' + BIG + 'margin-top:16px;' +
            'background:rgba(243,231,207,0.12);color:#f3e7cf;">Got it</button>' +
        '</div>' +
      '</div>';

    const el = (n) => root.querySelector('[data-el="' + n + '"]');
    const tap = (node, fn) => {
      if (!node) return;
      ctx.listen(node, "pointerdown", (e) => e.stopPropagation());
      ctx.listen(node, "click", (e) => { e.stopPropagation(); e.preventDefault(); fn(e); });
    };

    tap(el("mute"), (e) => { e.target.textContent = sound.toggle() ? "🔇" : "🔊"; paintSettings(); });
    if (settings.mute) el("mute").textContent = "🔇";
    tap(el("help"), () => {
      const h = el("helpp");
      if (h.style.display === "flex") { h.style.display = "none"; return; }
      h.style.display = "flex"; h.scrollTop = 0;
    });
    // Tapping the surround closes it too — the panel is taller than a phone,
    // so its own button can be a scroll away.
    ctx.listen(el("helpp"), "click", (e) => {
      if (e.target === el("helpp")) el("helpp").style.display = "none";
    });
    ctx.listen(el("setp"), "click", (e) => {
      if (e.target === el("setp")) el("setp").style.display = "none";
    });
    tap(el("helpp-close"), () => { el("helpp").style.display = "none"; });
    tap(el("gear"), () => {
      paintSettings();
      // Nothing to end from the menu, and offering it there reads as a
      // control that does not work.
      el("endm").style.display = S ? "block" : "none";
      el("setp").scrollTop = 0; el("setp").style.display = "flex";
    });
    tap(el("setp-close"), () => { el("setp").style.display = "none"; });
    tap(el("endm"), () => { el("setp").style.display = "none"; toMenu(); });

    function pills(host, values, labels, get, set) {
      host.innerHTML = values.map((v, i) =>
        '<button data-v="' + esc(String(v)) + '" style="' + PILL + '">' + esc(labels[i]) + '</button>').join("");
      const repaint = () => {
        for (const b of host.querySelectorAll("button")) {
          const on = String(get()) === b.dataset.v;
          b.style.background = on ? C.gold : "rgba(243,231,207,0.09)";
          b.style.color = on ? "#241a08" : "rgba(243,231,207,0.62)";
        }
      };
      for (const b of host.querySelectorAll("button")) {
        tap(b, () => { set(b.dataset.v); saveSettings(); repaint(); sound.haptic("light"); });
      }
      repaint();
      return repaint;
    }

    const repaintCount = pills(el("pc"), [2, 3, 4, 5, 6], ["2", "3", "4", "5", "6"],
      () => settings.players, (v) => { settings.players = Number(v); renderNames(); });

    function renderNames() {
      el("names").innerHTML = "";
      let html = "";
      for (let i = 0; i < settings.players; i++) {
        html += '<input data-el="nm-' + i + '" maxlength="12" autocomplete="off" ' +
          'autocorrect="off" spellcheck="false" placeholder="' + esc(DEFAULT_NAMES[i]) + '" ' +
          'value="' + esc(settings.names[i] || DEFAULT_NAMES[i]) + '" style="' + INP + '">';
      }
      el("names").innerHTML = html;
      for (let i = 0; i < settings.players; i++) {
        const inp = el("nm-" + i);
        ctx.listen(inp, "input", () => { settings.names[i] = inp.value; saveSettings(); });
      }
    }
    renderNames();

    let repaintBlinds = null, repaintSound = null;
    function paintSettings() {
      if (!repaintBlinds) {
        repaintBlinds = pills(el("be"), [5, 8, 12, 0], ["5", "8", "12", "Never"],
          () => settings.blindEvery, (v) => {
            settings.blindEvery = Number(v);
            if (S) S.blindEvery = settings.blindEvery;
          });
        repaintSound = pills(el("sn"), ["on", "off"], ["On", "Muted"],
          () => (sound.muted ? "off" : "on"), (v) => {
            if ((v === "off") !== sound.muted) {
              sound.toggle();
              el("mute").textContent = sound.muted ? "🔇" : "🔊";
            }
          });
      } else { repaintBlinds(); repaintSound(); }
    }

    /* ---------------------------------------------------------------
     * Panel wiring
     * ------------------------------------------------------------- */
    function show(name, on) { const n = el(name); if (n) n.style.display = on ? "flex" : "none"; }

    function syncPanel() {
      show("cover", phase === "handoff");
      if (phase === "handoff") el("cover").style.display = "block";
      show("acts", phase === "acting" && !raiseOpen);
      show("rowA", phase === "acting" && raiseOpen);
      show("rowB", phase === "acting" && raiseOpen);
      show("rowC", phase === "acting" && raiseOpen);
      show("next", phase === "result");
      if (phase === "result") el("next").style.display = "block";
      if (phase === "acting") {
        const la = legalActions(S);
        el("aCall").textContent = la.canCheck ? "Check"
          : (la.allInCall ? "Call " + la.callAmt + " ⋅ all in" : "Call " + la.callAmt);
        el("aRaise").textContent = la.opening ? "Bet" : "Raise";
        el("aRaise").style.display = la.canRaise ? "block" : "none";
        el("aFold").textContent = la.canCheck ? "Fold" : "Fold";
      }
    }

    function syncRaise() {
      const la = legalActions(S);
      if (!la) return;
      raiseTo = clamp(raiseTo, la.minTo, la.maxTo);
      el("rAmt").textContent = raiseTo.toLocaleString() + (raiseTo >= la.maxTo ? " ⋅ all in" : "");
      el("rGo").textContent = (la.opening ? "Bet " : "Raise to ") + raiseTo.toLocaleString();
    }

    tap(el("cover"), async () => {
      if (phase !== "handoff") return;
      await sound.unlock();
      reveal();
    });

    tap(el("aFold"), () => commit("fold"));
    tap(el("aCall"), () => { const la = legalActions(S); commit(la.canCheck ? "check" : "call"); });
    tap(el("aRaise"), () => {
      const la = legalActions(S);
      raiseTo = la.minTo; raiseOpen = true;
      sound.haptic("light"); syncPanel(); syncRaise();
    });
    tap(el("rBack"), () => { raiseOpen = false; sound.haptic("light"); syncPanel(); });
    tap(el("rMinus"), () => { raiseTo -= step(); sound.haptic("light"); syncRaise(); });
    tap(el("rPlus"), () => { raiseTo += step(); sound.haptic("light"); syncRaise(); });
    tap(el("rMin"), () => { raiseTo = legalActions(S).minTo; sound.haptic("light"); syncRaise(); });
    // A pot-sized raise is: call first, THEN raise by what the pot is worth
    // once your call is in it — betToMatch + pot + toCall. Dropping the call
    // out of the sum (pot + betToMatch) undershoots every time there is
    // something to call: facing 40 into 60 it offered 140 where a pot raise
    // is 180, and "Pot" has to mean pot.
    const potRaise = (la, f) => S.betToMatch + Math.round((la.pot + la.toCall) * f);
    tap(el("rHalf"), () => { raiseTo = potRaise(legalActions(S), 0.5); sound.haptic("light"); syncRaise(); });
    tap(el("rPot"), () => { raiseTo = potRaise(legalActions(S), 1); sound.haptic("light"); syncRaise(); });
    tap(el("rAll"), () => { raiseTo = legalActions(S).maxTo; sound.haptic("medium"); syncRaise(); });
    tap(el("rGo"), () => { const to = raiseTo; raiseOpen = false; commit("raise", to); });
    function step() { return Math.max(S.bb, S.minRaise); }

    tap(el("next"), () => nextHand());
    tap(el("go"), () => startMatch());
    tap(el("again"), () => toMenu());

    /* ---------------------------------------------------------------
     * Flow
     * ------------------------------------------------------------- */
    function toMenu() {
      phase = "menu"; S = null; lastResult = null; revealed = null; raiseOpen = false;
      anims = []; status = "";
      el("menu").style.display = "flex";
      el("over").style.display = "none";
      syncPanel();
    }

    async function startMatch() {
      ctx.platform.start();
      await sound.unlock();
      const names = [];
      for (let i = 0; i < settings.players; i++) {
        const raw = (settings.names[i] || "").trim();
        names.push(raw ? raw.slice(0, 12) : DEFAULT_NAMES[i]);
      }
      S = newMatch(names, { stack: 1000, blindEvery: settings.blindEvery });
      S.dealer = Math.floor(Math.random() * names.length);
      el("menu").style.display = "none";
      el("over").style.display = "none";
      matchWinner = null;
      sound.sting("coin");
      dealHand();
    }

    function dealHand() {
      phase = "anim";
      lastResult = null; revealed = null; raiseOpen = false;
      status = "";
      startHand(S, freshDeck());
      syncPanel();

      // Cards fly from the button seat, one at a time, twice round.
      const n = S.players.length;
      const from = seatPos(S.dealer, n);
      const items = [];
      let d = 0;
      for (let round = 0; round < 2; round++) {
        let k = nextSeat(S, S.dealer);
        for (let c = 0; c < seatsIn(S); c++) {
          const to = seatPos(k, n);
          items.push({ from: { x: from.x, y: from.y }, to: { x: to.x - 24, y: to.y }, delay: d, dur: 240 });
          d += 46; k = nextSeat(S, k);
        }
      }
      anim({ kind: "deal", dur: d + 260, items });
      sound.sting("tap");
      sound.haptic("light");
      queue(() => { sound.sting("coin"); step2(); }, d + 280);
    }

    /** One tick of the state machine. Called whenever something finishes. */
    function step2() {
      if (!S) return;
      if (liveCount(S) === 1) return finishHand();
      if (S.toAct >= 0) return showTurn();
      // The round is closed. Either the street ends, or nobody can bet again.
      if (canActCount(S) < 2) return runOut();
      if (S.street >= 3) return finishHand();
      return collectAndDeal();
    }

    function showTurn() {
      phase = "handoff";
      revealed = null; raiseOpen = false;
      const p = S.players[S.toAct];
      status = "";
      sound.haptic("light");
      ctx.platform.interact({ type: "turn", seat: p.i });
      syncPanel();
    }

    function reveal() {
      const p = S.players[S.toAct];
      const w = Math.round(L.hw * 2), h = Math.round(L.hh * 2);
      // Two cards baked fresh at panel resolution: the shared deck art is
      // sized for the board and would be soft this big, and it is only ever
      // two cards, so the bake is free.
      const a0 = bakeCard(p.hole[0].rank, p.hole[0].suit, w, h, {});
      const a1 = bakeCard(p.hole[1].rank, p.hole[1].suit, w, h, {});
      const made = S.board.length >= 3
        ? handName(best7(p.hole.concat(S.board)))
        : preflopName(p.hole);
      revealed = { seat: p.i, art: [a0, a1], label: made };
      phase = "acting";
      sound.sting("tap");
      sound.haptic("medium");
      syncPanel();
    }

    /** State commits first, then animates; input is blocked until it lands. */
    function commit(kind, amount) {
      if (phase !== "acting" || busy()) return;
      const seat = S.toAct;
      const p = S.players[seat];
      const before = potMiddle(S);
      let ev;
      try { ev = applyAction(S, kind, amount); }
      catch (e) { sound.sting("fail"); sound.haptic("warning"); return; }

      phase = "anim";
      revealed = null; raiseOpen = false;
      status = p.name + " " + p.last + (ev.amount > 0 && kind !== "fold" ? " " + ev.amount.toLocaleString() : "");
      syncPanel();

      if (kind === "fold") { sound.sting("fail"); sound.haptic("light"); }
      else if (ev.allIn) { sound.duck(0.4, 320); sound.sting("danger"); sound.haptic("heavy"); shake = 0.014; }
      else if (ev.amount > 0) { sound.sting("coin"); sound.haptic("medium"); }
      else { sound.sting("tap"); sound.haptic("light"); }
      ctx.platform.interact({ type: kind, seat });
      void before;

      queue(step2, 360);
    }

    function collectAndDeal() {
      phase = "anim";
      const n = S.players.length;
      const items = S.players.filter(p => p.bet > 0)
        .map(p => ({ from: betPos(p.i, n), to: potPos(), amount: p.bet }));
      if (items.length) anim({ kind: "chips", dur: 400, items });
      closeStreet(S);
      const wait = items.length ? 420 : 60;
      queue(() => {
        const st = dealStreet(S);
        status = ["", "Flop", "Turn", "River"][st];
        anim({ kind: "board", dur: st === 1 ? 720 : 380, from: st === 1 ? 0 : S.board.length - 1, to: S.board.length });
        sound.sting("powerup");
        sound.haptic("light");
        openBetting(S);
        queue(step2, st === 1 ? 760 : 420);
      }, wait);
    }

    /** Everybody who can bet is done betting — run the rest of the board out. */
    function runOut() {
      phase = "anim";
      const n = S.players.length;
      const items = S.players.filter(p => p.bet > 0)
        .map(p => ({ from: betPos(p.i, n), to: potPos(), amount: p.bet }));
      if (items.length) anim({ kind: "chips", dur: 400, items });
      closeStreet(S);
      const run = () => {
        if (S.street >= 3) return finishHand();
        const st = dealStreet(S);
        status = ["", "Flop", "Turn", "River"][st];
        anim({ kind: "board", dur: st === 1 ? 700 : 360, from: st === 1 ? 0 : S.board.length - 1, to: S.board.length });
        sound.sting("powerup");
        sound.haptic("light");
        queue(run, st === 1 ? 760 : 480);
      };
      queue(run, items.length ? 430 : 120);
    }

    function finishHand() {
      const n = S.players.length;
      // Sweep the last street's bets in before the money is split, so the
      // pot animation and the numbers agree.
      const items = S.players.filter(p => p.bet > 0)
        .map(p => ({ from: betPos(p.i, n), to: potPos(), amount: p.bet }));
      if (items.length) anim({ kind: "chips", dur: 380, items });
      closeStreet(S);

      const res = settle(S);
      payout(S, res);

      // Build the human-facing result. The state is already committed; this
      // is only presentation.
      const winners = [];
      res.awards.forEach((a, i) => { if (a > 0) winners.push(i); });
      const rows = [];
      const mainWinners = res.pots[0] ? res.pots[0].winners : winners;
      const boardMark = [false, false, false, false, false];
      for (const p of S.players) {
        if (p.out && p.committed === 0) continue;
        if (p.folded && p.committed === 0) continue;
        // Getting your own uncalled bet back is not winning. Counting it as a
        // win gave the player a gold row, ringed their hole cards and marked
        // the board cards of a hand that lost — while their delta sat there in
        // red saying so.
        const back = res.returned && res.returned.seat === p.i ? res.returned.amount : 0;
        const win = res.awards[p.i] - back > 0;
        const h = res.hands[p.i];
        let mark = null;
        if (win && h) {
          mark = [h.cards.some(c => c.id === p.hole[0].id), h.cards.some(c => c.id === p.hole[1].id)];
          S.board.forEach((c, k) => { if (h.cards.some(x => x.id === c.id)) boardMark[k] = true; });
        }
        rows.push({
          seat: p.i, name: p.name, win, main: mainWinners.indexOf(p.i) >= 0,
          cards: p.folded ? null : (res.showdown || win ? p.hole : null),
          hand: p.folded ? "folded" : (h ? handName(h) : (win ? "wins uncontested" : "")),
          delta: p.delta, mark,
        });
      }
      rows.sort((a, b) => (b.main - a.main) || (b.win - a.win) || (b.delta - a.delta));
      // Side pots taken by the same player are one pot as far as a reader is
      // concerned, so they are merged before anything is written. That matters
      // for the headline too: three layers all won by one player is not a side
      // pot story, it is "Bo takes 4,000".
      const disp = [];
      res.pots.forEach((pt, i) => {
        const who = pt.winners.map(w => S.players[w].name).join(" & ");
        const last = disp[disp.length - 1];
        if (last && last.who === who) { last.amount += pt.amount; return; }
        disp.push({ who, amount: pt.amount, names: pt.winners.map(w => S.players[w].name),
                    main: i === 0 });
      });
      const mainNames = disp.length ? disp[0].names : winners.map(i => S.players[i].name);
      let headline, potLines;
      if (disp.length <= 1) {
        headline = mainNames.length > 1
          ? mainNames.join(" and ") + " split " + res.total.toLocaleString()
          : (mainNames[0] || "") + " takes " + res.total.toLocaleString();
        potLines = [res.total.toLocaleString() + " in the pot"];
      } else {
        // "Cleo and Dov split 4,000" is a lie when Cleo won the main pot and
        // Dov only got his own uncalled chips back.
        headline = mainNames.join(" and ") +
          (mainNames.length > 1 ? " split the main pot" : " takes the main pot");
        potLines = disp.map(d =>
          (d.main ? "Main pot " : "Side pot ") + d.amount.toLocaleString() + " → " + d.who);
      }
      // A bet nobody called is not a pot anybody won, and calling it one is
      // what made the headline lie in the first place.
      if (res.returned) {
        potLines.push(res.returned.amount.toLocaleString() + " returned to " +
                      S.players[res.returned.seat].name + " — uncalled");
      }

      lastResult = { showdown: res.showdown, rows, headline, boardMark, winners, potLines,
                     total: res.total };

      const chipItems = winners.map(i => ({
        from: potPos(), to: seatPos(i, n), amount: res.awards[i],
      }));

      queue(() => {
        if (chipItems.length) anim({ kind: "chips", dur: 520, items: chipItems });
        sound.duck(0.55, 460);
        sound.sting(res.showdown ? "win" : "success");
        sound.haptic("success");
        shake = 0.02;
        queue(() => {
          phase = "result";
          anim({ kind: "veil", dur: 300 });
          syncPanel();
          ctx.platform.interact({ type: "hand", pot: res.total, winners: winners.length });
        }, 540);
      }, items.length ? 400 : 60);
    }

    async function nextHand() {
      if (!S) return;
      for (const p of S.players) if (!p.out && p.chips <= 0) p.out = true;
      if (seatsIn(S) <= 1) return endMatch();
      S.dealer = nextSeat(S, S.dealer);
      lastResult = null;
      phase = "anim";
      syncPanel();
      sound.sting("tap");
      dealHand();
    }

    async function endMatch() {
      phase = "over";
      const win = S.players.find(p => !p.out) || S.players[0];
      matchWinner = win;
      el("over-name").textContent = win.name;
      el("over-name").style.color = C.seat[win.i % C.seat.length];
      el("over-sub").textContent = S.handNo + " hands · blinds finished at " + S.sb + " / " + S.bb;
      el("over-body").innerHTML =
        '<div style="font-size:10px;letter-spacing:0.26em;text-transform:uppercase;opacity:0.5;">Biggest pot of the night</div>' +
        '<div style="font-size:34px;font-weight:900;color:#e8bd6a;line-height:1.2;">' +
          S.biggestPot.toLocaleString() + '</div>' +
        '<div style="height:1px;background:rgba(243,231,207,0.12);margin:12px 0;"></div>' +
        S.players.slice().sort((a, b) => b.chips - a.chips).map(p =>
          '<div style="display:flex;justify-content:space-between;padding:4px 0;font-size:14px;">' +
            '<span style="color:' + C.seat[p.i % C.seat.length] + ';font-weight:700;' +
              (p.out ? 'opacity:0.55;' : '') + '">' + esc(p.name) + '</span>' +
            '<span style="' + (p.out ? 'opacity:0.42;' : 'color:#e8bd6a;font-weight:800;') + '">' +
              p.chips.toLocaleString() + '</span></div>').join("");
      el("over").style.display = "flex";
      syncPanel();
      sound.duck(0.6, 520);
      sound.sting("win");
      sound.haptic("success");
      ctx.platform.complete({ winner: win.name, hands: S.handNo, biggestPot: S.biggestPot });
      // The record that travels is the biggest pot this TABLE dragged in one
      // hand — a property of the match, not of whichever person was holding
      // the phone when it happened.
      try {
        await ctx.memory.record("biggest_pot").submit(S.biggestPot,
          { label: S.biggestPot.toLocaleString() + " chips" });
      } catch (_) {}
    }

    /* ---------------------------------------------------------------
     * Frame
     * ------------------------------------------------------------- */
    ctx.onFrame((dtMs) => {
      const dt = Math.min(dtMs, 50) / 1000;
      if (shake > 0.0004) shake *= Math.pow(0.004, dt);
      const wantE = S && S.board.length ? 0 : 1;
      emblemA += (wantE - emblemA) * Math.min(1, dt * 7);
      for (let i = anims.length - 1; i >= 0; i--) if (prog(anims[i]) >= 1) anims.splice(i, 1);
      if (S && phase !== "menu") {
        const total = S.players.reduce((a, p) => a + p.chips, 0) + potTotal(S);
        sound.heat(clamp(potTotal(S) / Math.max(1, total * 0.35), 0, 1));
      }
      paint();
    });

    ctx.listen(window, "resize", () => {
      if (ctx.width === W && ctx.height === H) return;
      measure();
      rebuildArt();
      const cv = el("cover");
      if (cv) cv.style.height = L.panelH + "px";
    });

    /* ---------------------------------------------------------------
     * A read-only window for the local harness, so a scripted game can
     * drive real handovers and assert on real chip counts.
     * ------------------------------------------------------------- */
    window.__HOLDEM__ = {
      get phase() { return phase; },
      get busy() { return busy(); },
      get handNo() { return S ? S.handNo : 0; },
      get street() { return S ? S.street : -1; },
      get toAct() { return S ? S.toAct : -1; },
      get board() { return S ? S.board.map(c => c.id) : []; },
      get pot() { return S ? potTotal(S) : 0; },
      get blinds() { return S ? [S.sb, S.bb] : [0, 0]; },
      get biggestPot() { return S ? S.biggestPot : 0; },
      get seats() {
        return S ? S.players.map(p => ({
          name: p.name, chips: p.chips, bet: p.bet, committed: p.committed,
          folded: p.folded, allIn: p.allIn, out: p.out, last: p.last,
          hole: p.hole.map(c => c.id),
        })) : [];
      },
      get legal() { return S && S.toAct >= 0 ? legalActions(S) : null; },
      get result() { return lastResult; },
      get winner() { return matchWinner ? matchWinner.name : null; },
      // Chips in play. Once a hand is settled the pot has already been paid
      // into the stacks, so counting committed as well would double it.
      get chipsTotal() {
        if (!S) return 0;
        const c = S.players.reduce((a, p) => a + p.chips, 0);
        return c + (S.result ? 0 : potTotal(S));
      },
    };
    ctx.onDestroy(() => { try { delete window.__HOLDEM__; } catch (_) {} });

    paint();
    ctx.markVisualReady("table lit");
    ctx.platform.ready();
  },
};
