/**
 * Chess — two players, one phone, real pieces.
 *
 * The phone lies flat between the players. White sits at the near edge, Black
 * at the far edge, and the board never moves: Black plays "upside down"
 * exactly as at a real board, which is both correct and familiar, and it means
 * the board never rotates under anybody's finger. Each player's HUD lives in
 * the band at their own edge, rotated to face them — the same reason a real
 * tournament board engraves its far-side coordinates upside down.
 *
 * The pieces are turned, not drawn. Every Staunton piece except the knight is
 * a rotational solid — a profile swept about a vertical axis — which is
 * precisely what THREE.LatheGeometry builds, so the base flare, the scotia
 * sweep, the collar ring and the finial are all real geometry catching a real
 * key light rather than a sprite pretending to be one. The knight is the one
 * piece that breaks rotational symmetry, so it is extruded from a carved
 * silhouette instead, which is also what makes it read at 45px.
 *
 * The rules are the whole game, so they are not approximated. Move generation
 * is pseudo-legal followed by make / test / unmake against king safety, which
 * is the single test that correctly handles pins, discovered check, moving out
 * of check, and the en-passant discovery case where removing two pawns from
 * one rank exposes your own king. Castling, promotion, the fifty-move clock,
 * threefold repetition and insufficient material are all implemented. The
 * engine block below is delimited so tools/harness/perft-chess.mjs can lift it
 * out and verify it against the published node counts.
 *
 * Contract notes: no packaged assets (maxAssets is 0), so the board's wood is
 * painted into an OffscreenCanvas at boot. The overlay is markup on
 * ctx.createRoot(); pointer maths uses offsetX/offsetY. document.createElement
 * and getBoundingClientRect are both rejected at upload.
 */
window.plethoraBit = {
  meta: {
    title: "Chess",
    runtime: "plethora-bit@2",
    tags: ["multiplayer", "local-multiplayer", "chess", "board", "two-player"],
    permissions: ["backgroundMusic", "haptics", "storage"],
  },

  async init(ctx) {
    const THREE = await ctx.importModule("three", "0.164.1");

/* ===== ENGINE START ===== */
    /**
     * Board is a flat 64-array, index = rank * 8 + file, so index 0 is a1 and
     * index 63 is h8. White's pieces are uppercase, Black's lowercase, empty
     * squares are 0 — the usual convention, and it makes a position readable
     * in a debugger without a decoder.
     */
    const WHITE = "w", BLACK = "b";
    const isWhite = (p) => p !== 0 && p === p.toUpperCase();
    const colourOf = (p) => (p === 0 ? null : isWhite(p) ? WHITE : BLACK);
    const fileOf = (i) => i & 7;
    const rankOf = (i) => i >> 3;
    const onBoard = (f, r) => f >= 0 && f < 8 && r >= 0 && r < 8;
    const sq = (f, r) => r * 8 + f;
    const NAMES = "abcdefgh";
    const sqName = (i) => NAMES[fileOf(i)] + (rankOf(i) + 1);

    const KNIGHT_DELTAS = [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]];
    const KING_DELTAS = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
    const ROOK_DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    const BISHOP_DIRS = [[1, 1], [1, -1], [-1, 1], [-1, -1]];

    function startPosition() {
      const b = new Array(64).fill(0);
      const back = ["R", "N", "B", "Q", "K", "B", "N", "R"];
      for (let f = 0; f < 8; f++) {
        b[sq(f, 0)] = back[f];
        b[sq(f, 1)] = "P";
        b[sq(f, 6)] = "p";
        b[sq(f, 7)] = back[f].toLowerCase();
      }
      return {
        board: b,
        turn: WHITE,
        castling: { K: true, Q: true, k: true, q: true },
        ep: null,                 // square a pawn skipped over, or null
        half: 0,                  // halfmove clock for the fifty-move rule
        full: 1,
        history: [],              // position keys, for repetition
      };
    }

    /** Is `target` attacked by any piece of `by`? Used only for king safety. */
    function attacked(board, target, by) {
      const tf = fileOf(target), tr = rankOf(target);

      // Pawns. A white pawn on (f, r) attacks (f±1, r+1), so a square is
      // attacked by a white pawn sitting one rank BELOW it.
      const pd = by === WHITE ? -1 : 1;
      for (const df of [-1, 1]) {
        const f = tf + df, r = tr + pd;
        if (!onBoard(f, r)) continue;
        const p = board[sq(f, r)];
        if (p !== 0 && colourOf(p) === by && p.toLowerCase() === "p") return true;
      }

      for (const [df, dr] of KNIGHT_DELTAS) {
        const f = tf + df, r = tr + dr;
        if (!onBoard(f, r)) continue;
        const p = board[sq(f, r)];
        if (p !== 0 && colourOf(p) === by && p.toLowerCase() === "n") return true;
      }

      for (const [df, dr] of KING_DELTAS) {
        const f = tf + df, r = tr + dr;
        if (!onBoard(f, r)) continue;
        const p = board[sq(f, r)];
        if (p !== 0 && colourOf(p) === by && p.toLowerCase() === "k") return true;
      }

      const slide = (dirs, types) => {
        for (const [df, dr] of dirs) {
          let f = tf + df, r = tr + dr;
          while (onBoard(f, r)) {
            const p = board[sq(f, r)];
            if (p !== 0) {
              if (colourOf(p) === by && types.includes(p.toLowerCase())) return true;
              break;
            }
            f += df; r += dr;
          }
        }
        return false;
      };
      if (slide(ROOK_DIRS, ["r", "q"])) return true;
      if (slide(BISHOP_DIRS, ["b", "q"])) return true;
      return false;
    }

    function findKing(board, colour) {
      const want = colour === WHITE ? "K" : "k";
      for (let i = 0; i < 64; i++) if (board[i] === want) return i;
      return -1;
    }

    const inCheck = (s, colour) =>
      attacked(s.board, findKing(s.board, colour), colour === WHITE ? BLACK : WHITE);

    /**
     * Pseudo-legal moves: correct piece movement, but not yet filtered for
     * leaving your own king attacked. Castling's "must not pass through
     * check" is tested here because it is a property of the path rather than
     * of the resulting position, which make/test/unmake cannot see.
     */
    function pseudoMoves(s) {
      const out = [];
      const me = s.turn, them = me === WHITE ? BLACK : WHITE;
      const b = s.board;

      const push = (from, to, extra) => out.push(Object.assign({ from, to }, extra || {}));

      for (let from = 0; from < 64; from++) {
        const p = b[from];
        if (p === 0 || colourOf(p) !== me) continue;
        const t = p.toLowerCase();
        const f = fileOf(from), r = rankOf(from);

        if (t === "p") {
          const dir = me === WHITE ? 1 : -1;
          const startRank = me === WHITE ? 1 : 6;
          const lastRank = me === WHITE ? 7 : 0;

          // One forward, onto an empty square only.
          const one = sq(f, r + dir);
          if (onBoard(f, r + dir) && b[one] === 0) {
            if (r + dir === lastRank) for (const q of ["q", "r", "b", "n"]) push(from, one, { promo: q });
            else {
              push(from, one, {});
              // Two forward, only from the home rank and only if BOTH squares
              // are empty.
              const two = sq(f, r + dir * 2);
              if (r === startRank && b[two] === 0) push(from, two, { double: true });
            }
          }
          // Diagonal captures, including en passant.
          for (const df of [-1, 1]) {
            const cf = f + df, cr = r + dir;
            if (!onBoard(cf, cr)) continue;
            const to = sq(cf, cr);
            if (b[to] !== 0 && colourOf(b[to]) === them) {
              if (cr === lastRank) for (const q of ["q", "r", "b", "n"]) push(from, to, { promo: q });
              else push(from, to, {});
            } else if (s.ep === to) {
              push(from, to, { ep: true });
            }
          }
          continue;
        }

        if (t === "n") {
          for (const [df, dr] of KNIGHT_DELTAS) {
            const nf = f + df, nr = r + dr;
            if (!onBoard(nf, nr)) continue;
            const to = sq(nf, nr);
            if (b[to] === 0 || colourOf(b[to]) === them) push(from, to, {});
          }
          continue;
        }

        if (t === "k") {
          for (const [df, dr] of KING_DELTAS) {
            const nf = f + df, nr = r + dr;
            if (!onBoard(nf, nr)) continue;
            const to = sq(nf, nr);
            if (b[to] === 0 || colourOf(b[to]) === them) push(from, to, {});
          }
          // Castling. The king may not start in check, nor pass through or
          // land on an attacked square. The rook may be attacked, and the
          // b-file square only has to be EMPTY, not safe.
          const home = me === WHITE ? 0 : 56;
          if (from === home + 4 && !attacked(b, from, them)) {
            const kSide = me === WHITE ? s.castling.K : s.castling.k;
            const qSide = me === WHITE ? s.castling.Q : s.castling.q;
            const rookK = b[home + 7], rookQ = b[home];
            const wantRook = me === WHITE ? "R" : "r";
            if (kSide && rookK === wantRook &&
                b[home + 5] === 0 && b[home + 6] === 0 &&
                !attacked(b, home + 5, them) && !attacked(b, home + 6, them)) {
              push(from, home + 6, { castle: "K" });
            }
            if (qSide && rookQ === wantRook &&
                b[home + 1] === 0 && b[home + 2] === 0 && b[home + 3] === 0 &&
                !attacked(b, home + 3, them) && !attacked(b, home + 2, them)) {
              push(from, home + 2, { castle: "Q" });
            }
          }
          continue;
        }

        const dirs = t === "r" ? ROOK_DIRS : t === "b" ? BISHOP_DIRS : ROOK_DIRS.concat(BISHOP_DIRS);
        for (const [df, dr] of dirs) {
          let nf = f + df, nr = r + dr;
          while (onBoard(nf, nr)) {
            const to = sq(nf, nr);
            if (b[to] === 0) push(from, to, {});
            else { if (colourOf(b[to]) === them) push(from, to, {}); break; }
            nf += df; nr += dr;
          }
        }
      }
      return out;
    }

    /** Apply a move, returning the undo record. Assumes the move is pseudo-legal. */
    function make(s, m) {
      const b = s.board;
      const piece = b[m.from];
      const undo = {
        m, captured: b[m.to], capturedAt: m.to,
        castling: Object.assign({}, s.castling), ep: s.ep, half: s.half, full: s.full,
      };

      b[m.to] = piece;
      b[m.from] = 0;

      if (m.ep) {
        // The captured pawn is NOT on the destination square — it is the one
        // that just double-stepped, alongside the capturing pawn's old rank.
        const capAt = sq(fileOf(m.to), rankOf(m.from));
        undo.captured = b[capAt];
        undo.capturedAt = capAt;
        b[capAt] = 0;
      }
      if (m.promo) b[m.to] = s.turn === WHITE ? m.promo.toUpperCase() : m.promo;
      if (m.castle) {
        const home = s.turn === WHITE ? 0 : 56;
        if (m.castle === "K") { b[home + 5] = b[home + 7]; b[home + 7] = 0; }
        else { b[home + 3] = b[home]; b[home] = 0; }
      }

      // Castling rights are lost permanently and never come back.
      const t = piece.toLowerCase();
      if (t === "k") {
        if (s.turn === WHITE) { s.castling.K = false; s.castling.Q = false; }
        else { s.castling.k = false; s.castling.q = false; }
      }
      if (m.from === 0 || m.to === 0) s.castling.Q = false;
      if (m.from === 7 || m.to === 7) s.castling.K = false;
      if (m.from === 56 || m.to === 56) s.castling.q = false;
      if (m.from === 63 || m.to === 63) s.castling.k = false;

      s.ep = m.double ? sq(fileOf(m.from), (rankOf(m.from) + rankOf(m.to)) / 2) : null;
      s.half = (t === "p" || undo.captured !== 0) ? 0 : s.half + 1;
      if (s.turn === BLACK) s.full++;
      s.turn = s.turn === WHITE ? BLACK : WHITE;
      return undo;
    }

    function unmake(s, undo) {
      const b = s.board, m = undo.m;
      s.turn = s.turn === WHITE ? BLACK : WHITE;
      const moved = b[m.to];
      b[m.from] = m.promo ? (s.turn === WHITE ? "P" : "p") : moved;
      b[m.to] = 0;
      if (undo.captured !== 0) b[undo.capturedAt] = undo.captured;
      if (m.castle) {
        const home = s.turn === WHITE ? 0 : 56;
        if (m.castle === "K") { b[home + 7] = b[home + 5]; b[home + 5] = 0; }
        else { b[home] = b[home + 3]; b[home + 3] = 0; }
      }
      s.castling = undo.castling;
      s.ep = undo.ep;
      s.half = undo.half;
      s.full = undo.full;
    }

    /**
     * Legal moves. One test — "does this leave my own king attacked" — covers
     * pins, discovered checks, and the en-passant case where lifting two
     * pawns off one rank uncovers a rook. Never special-case a pin.
     */
    function legalMoves(s) {
      const out = [];
      const me = s.turn;
      for (const m of pseudoMoves(s)) {
        const u = make(s, m);
        if (!attacked(s.board, findKing(s.board, me), me === WHITE ? BLACK : WHITE)) out.push(m);
        unmake(s, u);
      }
      return out;
    }
/* ===== ENGINE END ===== */

    /* ---------------------------------------------------------------
     * Pieces.
     *
     * A Staunton set is turned on a lathe: every piece but the knight is
     * a single profile swept about a vertical axis. Feeding that profile
     * to LatheGeometry gives the real thing — flared base, concave
     * scotia, waisted shaft, collar ring, finial — as actual geometry
     * that catches the key light down its left flank the way the
     * reference photographs do.
     *
     * Profiles are [radius, height] in square-widths, read bottom to top.
     * ------------------------------------------------------------- */
    const PROFILES = {
      p: [[0.00, 0.000], [0.215, 0.000], [0.215, 0.030], [0.200, 0.052], [0.150, 0.075],
          [0.108, 0.118], [0.086, 0.185], [0.080, 0.240], [0.104, 0.268], [0.128, 0.282],
          [0.090, 0.296], [0.086, 0.306], [0.130, 0.330], [0.140, 0.372], [0.118, 0.410],
          [0.070, 0.436], [0.000, 0.446]],
      r: [[0.00, 0.000], [0.235, 0.000], [0.235, 0.034], [0.216, 0.060], [0.160, 0.088],
          [0.140, 0.150], [0.138, 0.290], [0.150, 0.322], [0.196, 0.346], [0.206, 0.372],
          [0.196, 0.392], [0.206, 0.404], [0.206, 0.470], [0.000, 0.470]],
      n: [[0.00, 0.000], [0.230, 0.000], [0.230, 0.034], [0.210, 0.060], [0.156, 0.090],
          [0.134, 0.140], [0.132, 0.200], [0.000, 0.210]],
      b: [[0.00, 0.000], [0.232, 0.000], [0.232, 0.032], [0.212, 0.058], [0.152, 0.086],
          [0.106, 0.150], [0.088, 0.250], [0.084, 0.300], [0.124, 0.328], [0.146, 0.348],
          [0.104, 0.366], [0.098, 0.378], [0.150, 0.416], [0.160, 0.470], [0.132, 0.532],
          [0.076, 0.578], [0.030, 0.600], [0.052, 0.614], [0.052, 0.632], [0.000, 0.646]],
      q: [[0.00, 0.000], [0.256, 0.000], [0.256, 0.036], [0.234, 0.064], [0.168, 0.096],
          [0.114, 0.170], [0.094, 0.300], [0.090, 0.372], [0.136, 0.402], [0.162, 0.424],
          [0.116, 0.444], [0.110, 0.458], [0.170, 0.500], [0.216, 0.566], [0.226, 0.612],
          [0.186, 0.630], [0.150, 0.640], [0.088, 0.660], [0.056, 0.686], [0.078, 0.706],
          [0.078, 0.726], [0.000, 0.742]],
      k: [[0.00, 0.000], [0.262, 0.000], [0.262, 0.038], [0.240, 0.068], [0.172, 0.100],
          [0.116, 0.180], [0.096, 0.320], [0.092, 0.400], [0.140, 0.432], [0.166, 0.456],
          [0.118, 0.476], [0.112, 0.492], [0.172, 0.536], [0.214, 0.606], [0.222, 0.652],
          [0.182, 0.672], [0.146, 0.686], [0.104, 0.714], [0.104, 0.744], [0.000, 0.752]],
    };

    /**
     * Height of each piece as a multiple of its authored profile, chosen so
     * the finished set lands on real Staunton proportions relative to a
     * square: pawn 0.80, rook 0.87, knight 1.05, bishop 1.16, queen 1.38,
     * king 1.58. A single global scale would leave the king and queen the
     * same height, which is the one distinction that has to survive.
     */
    const HS = { p: 1.42, r: 1.46, n: 1.46, b: 1.44, q: 1.50, k: 1.68 };
    const RS = 1.14;                          // bases are ~36% of a square wide

    /** Sweep a profile into a solid, in the board's own unit scale. */
    function lathe(profile, unit, hs) {
      const pts = profile.map(([r, h]) =>
        new THREE.Vector2(Math.max(r, 0.0001) * RS * unit, h * hs * unit));
      const g = new THREE.LatheGeometry(pts, 40);
      g.computeVertexNormals();
      return g;
    }

    /**
     * The knight. It is the one piece that is not a solid of revolution —
     * carved rather than turned — so it is extruded from a silhouette and
     * sat on a turned base. That break in the shape language is exactly
     * what makes a knight findable at a glance on a small board.
     */
    function knightHead(unit, hs) {
      const s = new THREE.Shape();
      s.moveTo(-0.150, 0.150);
      s.bezierCurveTo(-0.175, 0.300, -0.130, 0.400, -0.060, 0.455);   // arched neck
      s.lineTo(-0.020, 0.560);                                        // ear
      s.lineTo(0.020, 0.470);
      s.lineTo(0.062, 0.545);                                         // second ear
      s.lineTo(0.086, 0.440);
      s.bezierCurveTo(0.170, 0.430, 0.235, 0.386, 0.245, 0.330);      // brow to muzzle
      s.lineTo(0.212, 0.300);
      s.lineTo(0.238, 0.268);
      s.bezierCurveTo(0.190, 0.226, 0.120, 0.208, 0.060, 0.210);      // jaw
      s.bezierCurveTo(0.030, 0.190, 0.030, 0.170, 0.040, 0.150);
      s.closePath();
      const g = new THREE.ExtrudeGeometry(s, {
        depth: 0.185, bevelEnabled: true, bevelThickness: 0.020,
        bevelSize: 0.022, bevelSegments: 3, curveSegments: 14,
      });
      g.translate(0, 0, -0.0925);
      // Sat on top of its turned base, scaled to the same set proportions.
      g.scale(RS * unit * 1.28, hs * unit * 1.28, RS * unit * 1.28);
      g.translate(0, 0.135 * hs * unit, 0);
      return g;
    }

    /** Rook crenellations: the four blocks that break its cylinder. */
    function crenels(unit, hs) {
      const parts = [];
      const w = 0.115 * RS * unit, h = 0.085 * hs * unit;
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
        const g = new THREE.BoxGeometry(w, h, w * 0.72);
        g.rotateY(-a);
        g.translate(Math.cos(a) * 0.145 * RS * unit, 0.470 * hs * unit + h / 2,
                    Math.sin(a) * 0.145 * RS * unit);
        parts.push(g);
      }
      return parts;
    }

    /** The king's cross and the queen's coronet, as small solids on top. */
    function finial(type, unit, hs) {
      const parts = [];
      const R = RS * unit, Yh = hs * unit;
      if (type === "k") {
        const up = new THREE.BoxGeometry(0.048 * R, 0.150 * Yh, 0.042 * R);
        up.translate(0, 0.812 * Yh, 0);
        const across = new THREE.BoxGeometry(0.130 * R, 0.046 * Yh, 0.042 * R);
        across.translate(0, 0.818 * Yh, 0);
        parts.push(up, across);
      } else if (type === "q") {
        for (let i = 0; i < 5; i++) {
          const a = (i / 5) * Math.PI * 2;
          const g = new THREE.ConeGeometry(0.032 * R, 0.085 * Yh, 8);
          g.translate(Math.cos(a) * 0.150 * R, 0.660 * Yh, Math.sin(a) * 0.150 * R);
          parts.push(g);
        }
      } else if (type === "b") {
        // The mitre's single angled slit, cut as a thin dark wedge.
        const g = new THREE.BoxGeometry(0.020 * R, 0.110 * Yh, 0.150 * R);
        g.rotateX(-0.5);
        g.translate(0, 0.556 * Yh, 0.030 * R);
        parts.push(g);
      }
      return parts;
    }

    /* ---------------------------------------------------------------
     * Layout. The board is a square in the middle of the screen with a
     * HUD band at each end. Anchoring each player's controls at their
     * own outer edge means the two sets of thumbs approach from opposite
     * sides and the board between them is a permanent no-touch buffer —
     * the input zones physically cannot overlap.
     * ------------------------------------------------------------- */
    let W = ctx.width, H = ctx.height;
    const L = {};
    function measure() {
      W = ctx.width; H = ctx.height;
      L.board = Math.min(W - 14, H * 0.475);
      L.bx = (W - L.board) / 2;
      L.by = (H - L.board) / 2;
      L.unit = L.board / 8;
      L.bandTop = L.by;                       // far player's band: 0 .. by
      L.bandBot = H - (L.by + L.board);       // near player's band
    }
    measure();

    const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
    const esc = (s) => String(s).replace(/[&<>"']/g,
      (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

    /* ---------------------------------------------------------------
     * Board texture: real wood, painted once.
     * ------------------------------------------------------------- */
    function surface(w, h) {
      if (typeof OffscreenCanvas === "undefined") return null;
      return new OffscreenCanvas(w, h);
    }

    const THEMES = {
      wood:  { light: "#D9C69C", dark: "#96603C", frame: "#6B3F23", bevel: "#3A2314",
               grain: 0.055, name: "Walnut" },
      green: { light: "#EBECD0", dark: "#6F8C56", frame: "#3D4A34", bevel: "#232B1D",
               grain: 0.018, name: "Tournament" },
      slate: { light: "#C8CEDA", dark: "#5A6981", frame: "#333B4B", bevel: "#1C2230",
               grain: 0.022, name: "Slate" },
    };

    /**
     * One square of board, with straight grain running in a single
     * direction and a faint per-square tonal drift so no two squares are
     * identical — the thing that separates real wood from a checkerboard.
     */
    function makeBoardTexture(theme) {
      const S = 128, T = S * 8;
      const c = surface(T, T);
      if (!c) return null;
      const g = c.getContext("2d");
      for (let r = 0; r < 8; r++) {
        for (let f = 0; f < 8; f++) {
          const dark = (f + r) % 2 === 0;      // a1 (f=0,r=0) is dark
          const x = f * S, y = (7 - r) * S;
          g.fillStyle = dark ? theme.dark : theme.light;
          g.fillRect(x, y, S, S);
          // Per-square drift.
          g.globalAlpha = 0.06;
          g.fillStyle = ((f * 7 + r * 13) % 3 === 0) ? "#000000" : "#ffffff";
          g.fillRect(x, y, S, S);
          g.globalAlpha = theme.grain;
          for (let i = 0; i < 34; i++) {
            const gy = y + Math.random() * S;
            g.strokeStyle = Math.random() < 0.5 ? "#000000" : "#ffffff";
            g.lineWidth = 0.5 + Math.random() * 1.6;
            g.beginPath();
            g.moveTo(x, gy);
            g.bezierCurveTo(x + S * 0.33, gy + (Math.random() - 0.5) * 5,
                            x + S * 0.66, gy + (Math.random() - 0.5) * 5, x + S, gy);
            g.stroke();
          }
          g.globalAlpha = 1;
        }
      }
      // One continuous seam grid, hairline.
      g.strokeStyle = "rgba(0,0,0,0.13)";
      g.lineWidth = 1.5;
      for (let i = 0; i <= 8; i++) {
        g.beginPath(); g.moveTo(i * S, 0); g.lineTo(i * S, T); g.stroke();
        g.beginPath(); g.moveTo(0, i * S); g.lineTo(T, i * S); g.stroke();
      }
      // Coordinate glyphs, in-square, in the opposite square's colour.
      g.font = `600 ${S * 0.20}px ui-sans-serif, system-ui, sans-serif`;
      for (let f = 0; f < 8; f++) {
        const dark = (f + 0) % 2 === 0;
        g.fillStyle = dark ? theme.light : theme.dark;
        g.globalAlpha = 0.55;
        g.textAlign = "right"; g.textBaseline = "bottom";
        g.fillText(NAMES[f], f * S + S - S * 0.09, 8 * S - S * 0.07);
      }
      for (let r = 0; r < 8; r++) {
        const dark = (7 + r) % 2 === 0;
        g.fillStyle = dark ? theme.light : theme.dark;
        g.globalAlpha = 0.55;
        g.textAlign = "left"; g.textBaseline = "top";
        g.fillText(String(r + 1), 7 * S + S * 0.08, (7 - r) * S + S * 0.06);
      }
      g.globalAlpha = 1;
      return c;
    }

    /* ---------------------------------------------------------------
     * Settings
     * ------------------------------------------------------------- */
    const saved = (function () {
      try { return ctx.storage.get("chess") || {}; } catch (_) { return {}; }
    })();
    const settings = {
      theme: THEMES[saved.theme] ? saved.theme : "wood",
      hints: saved.hints !== false,          // show legal-move markers
      mute: !!saved.mute,
    };
    function saveSettings() { try { ctx.storage.set("chess", settings); } catch (_) {} }

    const sound = (function () {
      let muted = settings.mute, bed = null, unlocked = false;
      const start = () => ctx.music.play({ preset: "drift", volume: 0.22, tempo: 74, intensity: 0.18 });
      return {
        get muted() { return muted; },
        async unlock() {
          if (unlocked) return;
          unlocked = true;
          try { await ctx.music.unlock(); if (!muted) bed = start(); } catch (_) {}
        },
        sting(n) { if (!muted) { try { ctx.music.sting(n); } catch (_) {} } },
        duck(a, ms) { if (!muted) { try { ctx.music.duck(a, ms); } catch (_) {} } },
        haptic(k) { try { ctx.platform.haptic(k); } catch (_) {} },
        toggle() {
          muted = !muted; settings.mute = muted; saveSettings();
          try {
            if (muted) { (bed || ctx.music).stop({ fadeOutMs: 260 }); bed = null; }
            else if (unlocked) bed = start();
          } catch (_) {}
          return muted;
        },
      };
    })();

    /* ---------------------------------------------------------------
     * Scene. The camera looks straight down. Two people are playing each
     * other across this board, so any tilt would give one of them a
     * better view of it.
     * ------------------------------------------------------------- */
    const glCanvas = ctx.createCanvas({ touchAction: "none" });
    const renderer = new THREE.WebGLRenderer({ canvas: glCanvas, antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(ctx.dpr, 2));
    renderer.setSize(W, H, false);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.94;
    ctx.onDestroy(() => renderer.dispose());

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(38, W / H, 0.5, 80);
    camera.up.set(0, 0, -1);

    /* Board world units: one square is 1.0, so the board spans -4..4. */
    const U = 1;
    function placeCamera() {
      // A PerspectiveCamera's fov is VERTICAL, and this screen is portrait, so
      // the horizontal extent is the binding one: solve the distance from the
      // width the board has to occupy, or only half the files fit.
      //
      // The fov is deliberately wide. Straight down, a lathe-turned piece is a
      // disc — you lose the profile that makes a Staunton set readable. A wide
      // fov leans the pieces outward from the centre, so each player sees the
      // near side of their own men and the far side of their opponent's,
      // exactly as at a real board. It stays fair because the spread is
      // radial: both ends are the same distance from the camera. Wider than
      // this and the back ranks lean far enough to overlap and spill off the
      // board; 38 degrees is where the profile reads without the pile-up.
      camera.aspect = W / H;
      const halfWidthWorld = 4 * U * (W / L.board);
      const tanHalfFov = Math.tan((38 / 2) * Math.PI / 180);
      camera.position.set(0, halfWidthWorld / (tanHalfFov * camera.aspect), 0);
      camera.lookAt(0, 0, 0);
      camera.up.set(0, 0, -1);
      camera.updateProjectionMatrix();
    }
    placeCamera();

    /** Screen pixels to board square, or -1 outside the board. */
    function pickSquare(px, py) {
      const f = Math.floor((px - L.bx) / L.unit);
      const r = 7 - Math.floor((py - L.by) / L.unit);
      if (f < 0 || f > 7 || r < 0 || r > 7) return -1;
      return sq(f, r);
    }
    /** Board square to its world centre. File 0 is at -3.5; rank 0 nearest the viewer. */
    const worldOf = (i) => ({ x: (fileOf(i) - 3.5) * U, z: (3.5 - rankOf(i)) * U });

    /* --- board mesh --- */
    const boardGroup = new THREE.Group();
    scene.add(boardGroup);
    let boardMesh = null, boardTex = null;

    function buildBoard() {
      const theme = THEMES[settings.theme];
      scene.background = new THREE.Color(theme.bevel).multiplyScalar(0.55);
      if (boardMesh) { boardGroup.remove(boardMesh); boardMesh.geometry.dispose(); }
      if (boardTex) boardTex.dispose();

      const canvasTex = makeBoardTexture(theme);
      const mat = new THREE.MeshStandardMaterial({ roughness: 0.62, metalness: 0.06 });
      if (canvasTex) {
        boardTex = new THREE.CanvasTexture(canvasTex);
        boardTex.colorSpace = THREE.SRGBColorSpace;
        boardTex.anisotropy = 8;
        mat.map = boardTex;
      } else {
        mat.color = new THREE.Color(theme.dark);   // no OffscreenCanvas: plain board
      }
      boardMesh = new THREE.Mesh(new THREE.PlaneGeometry(8 * U, 8 * U), mat);
      boardMesh.rotation.x = -Math.PI / 2;
      boardMesh.receiveShadow = true;
      boardGroup.add(boardMesh);

      // Frame: a raised walnut surround with a bevel, as on a real board.
      if (!buildBoard.frame) {
        const fr = new THREE.Group();
        const t = 0.62 * U, o = 4 * U + t / 2;
        const fmat = new THREE.MeshStandardMaterial({ color: 0x7A4A2B, roughness: 0.55, metalness: 0.10 });
        buildBoard.fmat = fmat;
        for (const [x, z, sx, sz] of [
          [0, -o, 8 * U + t * 2, t], [0, o, 8 * U + t * 2, t],
          [-o, 0, t, 8 * U], [o, 0, t, 8 * U],
        ]) {
          const m = new THREE.Mesh(new THREE.BoxGeometry(sx, 0.16 * U, sz), fmat);
          m.position.set(x, 0.045 * U, z);
          m.castShadow = true; m.receiveShadow = true;
          fr.add(m);
        }
        boardGroup.add(fr);
        buildBoard.frame = fr;
      }
      buildBoard.fmat.color.set(theme.frame);
    }
    buildBoard();

    /* --- lights --- */
    scene.add(new THREE.AmbientLight(0x8d9ab2, 0.34));
    scene.add(new THREE.HemisphereLight(0xc3d2e8, 0x241c14, 0.36));
    // A single soft key from the upper left, as in every reference photograph:
    // it puts a bright highlight down each turned column's left flank and a
    // short, tight contact shadow under each flared base.
    const key = new THREE.DirectionalLight(0xfff2dc, 2.5);
    key.position.set(-6.2 * U, 7.4 * U, -5.0 * U);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.left = -6.5 * U; key.shadow.camera.right = 6.5 * U;
    key.shadow.camera.top = 6.5 * U; key.shadow.camera.bottom = -6.5 * U;
    key.shadow.camera.near = 1; key.shadow.camera.far = 26 * U;
    key.shadow.bias = -0.0016;
    key.shadow.normalBias = 0.02;
    scene.add(key);
    const fill = new THREE.DirectionalLight(0x9fb6d8, 0.30);
    fill.position.set(5 * U, 6 * U, 5 * U);
    scene.add(fill);

    /* --- piece meshes ---
     * Six geometries built once and shared; only the material differs by
     * colour. Thirty-two lathes built individually would cost a second of
     * boot on a phone for no visible gain.
     */
    const GEO = {};
    for (const t of ["p", "n", "b", "r", "q", "k"]) GEO[t] = lathe(PROFILES[t], U, HS[t]);

    const MAT = {
      w: new THREE.MeshStandardMaterial({ color: 0xF2E4C6, roughness: 0.40, metalness: 0.04 }),
      b: new THREE.MeshStandardMaterial({ color: 0x1A1410, roughness: 0.34, metalness: 0.10 }),
    };
    const ACCENT = {
      w: new THREE.MeshStandardMaterial({ color: 0xF6EEDC, roughness: 0.36, metalness: 0.05 }),
      b: new THREE.MeshStandardMaterial({ color: 0x4A423B, roughness: 0.36, metalness: 0.08 }),
    };

    /** One piece: its turned body, plus whatever solids sit on top of it. */
    function buildPiece(type, colour) {
      const g = new THREE.Group();
      const body = new THREE.Mesh(GEO[type], MAT[colour]);
      body.castShadow = true;
      body.receiveShadow = true;
      g.add(body);

      if (type === "r") for (const cg of crenels(U, HS.r)) {
        const m = new THREE.Mesh(cg, MAT[colour]); m.castShadow = true; g.add(m);
      }
      if (type === "k" || type === "q") for (const fg of finial(type, U, HS[type])) {
        const m = new THREE.Mesh(fg, ACCENT[colour]); m.castShadow = true; g.add(m);
      }
      if (type === "b") for (const fg of finial("b", U, HS.b)) {
        const m = new THREE.Mesh(fg, colour === "w" ? MAT.b : ACCENT.b); g.add(m);
      }
      if (type === "n") {
        const head = new THREE.Mesh(knightHead(U, HS.n), MAT[colour]);
        head.castShadow = true;
        head.receiveShadow = true;
        // Knights face their opponent, so the two sides look at each other.
        head.rotation.y = colour === "w" ? 0 : Math.PI;
        g.add(head);
      }
      g.userData.type = type;
      g.userData.colour = colour;
      return g;
    }

    // A pool keyed by piece letter, so a promotion to a ninth queen is free.
    const piecePool = {};
    function takePiece(letter) {
      const type = letter.toLowerCase();
      const colour = isWhite(letter) ? "w" : "b";
      const k = letter;
      (piecePool[k] ||= []);
      const m = piecePool[k].pop() || buildPiece(type, colour);
      m.visible = true;
      scene.add(m);
      return m;
    }
    function returnPiece(letter, mesh) {
      mesh.visible = false;
      scene.remove(mesh);
      (piecePool[letter] ||= []).push(mesh);
    }

    /* ---------------------------------------------------------------
     * Game state
     * ------------------------------------------------------------- */
    let state = startPosition();
    let meshAt = new Array(64).fill(null);
    let selected = -1, legalForSelected = [];
    let lastMove = null, over = null, pendingPromo = null;
    let anim = null;                          // { mesh, from, to, t, dur, arc, after }
    const moveList = [];

    /** Repetition key: pieces, side to move, castling rights, en-passant file. */
    function posKey(s) {
      return s.board.join("") + s.turn +
        (s.castling.K ? "K" : "") + (s.castling.Q ? "Q" : "") +
        (s.castling.k ? "k" : "") + (s.castling.q ? "q" : "") +
        (s.ep === null ? "-" : fileOf(s.ep));
    }

    function insufficientMaterial(s) {
      const men = [];
      for (const p of s.board) if (p !== 0 && p.toLowerCase() !== "k") men.push(p);
      if (men.length === 0) return true;                               // K vs K
      if (men.length === 1) return "bn".includes(men[0].toLowerCase()); // K+B or K+N
      if (men.length === 2 && men.every((m) => m.toLowerCase() === "b")) {
        // K+B vs K+B is drawn only when both bishops are on one colour.
        const on = [];
        for (let i = 0; i < 64; i++) if (s.board[i] !== 0 && s.board[i].toLowerCase() === "b")
          on.push((fileOf(i) + rankOf(i)) & 1);
        return on[0] === on[1] && colourOf(men[0]) !== colourOf(men[1]);
      }
      return false;
    }

    function syncBoard() {
      for (let i = 0; i < 64; i++) {
        const want = state.board[i];
        const have = meshAt[i];
        if (have && have.userData.letter !== want) { returnPiece(have.userData.letter, have); meshAt[i] = null; }
        if (want !== 0 && !meshAt[i]) {
          const m = takePiece(want);
          m.userData.letter = want;
          meshAt[i] = m;
        }
        if (meshAt[i]) {
          const w = worldOf(i);
          meshAt[i].position.set(w.x, 0.09 * U, w.z);
          meshAt[i].scale.setScalar(1);
        }
      }
    }

    /* --- board overlays: selection, last move, legal targets, check --- */
    const overlay = new THREE.Group();
    scene.add(overlay);
    const flatGeo = new THREE.PlaneGeometry(U * 0.995, U * 0.995);
    const dotGeo = new THREE.CircleGeometry(U * 0.155, 24);
    const ringGeo = new THREE.RingGeometry(U * 0.375, U * 0.455, 32);
    function overlayMesh(geo, colour, alpha) {
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
        color: colour, transparent: true, opacity: alpha, depthWrite: false,
      }));
      m.rotation.x = -Math.PI / 2;
      return m;
    }
    function paintOverlays() {
      while (overlay.children.length) {
        const c = overlay.children.pop();
        c.material.dispose();
      }
      const put = (m, i, y) => { const w = worldOf(i); m.position.set(w.x, y, w.z); overlay.add(m); };

      if (lastMove) {
        put(overlayMesh(flatGeo, 0xF2C14A, 0.30), lastMove.from, 0.012 * U);
        put(overlayMesh(flatGeo, 0xF2C14A, 0.30), lastMove.to, 0.012 * U);
      }
      if (selected >= 0) put(overlayMesh(flatGeo, 0xF2C14A, 0.48), selected, 0.016 * U);

      if (selected >= 0 && settings.hints) {
        for (const m of legalForSelected) {
          const capture = state.board[m.to] !== 0 || m.ep;
          put(overlayMesh(capture ? ringGeo : dotGeo, 0x1E1A14, capture ? 0.36 : 0.30), m.to, 0.02 * U);
        }
      }
      if (!over && inCheck(state, state.turn)) {
        const k = findKing(state.board, state.turn);
        // A hand-built radial falloff: the canvas blur property is off-limits,
        // so the glow is concentric rings with a ramped alpha.
        for (let i = 0; i < 6; i++) {
          const rr = 0.16 + i * 0.08;
          const g = new THREE.RingGeometry(U * (rr - 0.05), U * rr, 28);
          const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({
            color: 0xC4432E, transparent: true, opacity: 0.55 * (1 - i / 6), depthWrite: false,
          }));
          m.rotation.x = -Math.PI / 2;
          put(m, k, 0.018 * U);
        }
      }
    }

    /* --- SAN, for the move list --- */
    function toSAN(s, m) {
      const piece = s.board[m.from];
      const t = piece.toLowerCase();
      if (m.castle) return m.castle === "K" ? "O-O" : "O-O-O";
      const capture = s.board[m.to] !== 0 || m.ep;
      let out = "";
      if (t === "p") {
        if (capture) out += NAMES[fileOf(m.from)] + "x";
        out += sqName(m.to);
        if (m.promo) out += "=" + m.promo.toUpperCase();
      } else {
        out += t.toUpperCase();
        // Disambiguate only when another identical piece could legally reach
        // the same square: file first, then rank, then both.
        const rivals = legalMoves(s).filter((o) =>
          o.to === m.to && o.from !== m.from && s.board[o.from] === piece);
        if (rivals.length) {
          const sameFile = rivals.some((o) => fileOf(o.from) === fileOf(m.from));
          const sameRank = rivals.some((o) => rankOf(o.from) === rankOf(m.from));
          out += sameFile && sameRank ? sqName(m.from)
               : sameFile ? String(rankOf(m.from) + 1) : NAMES[fileOf(m.from)];
        }
        if (capture) out += "x";
        out += sqName(m.to);
      }
      const u = make(s, m);
      if (inCheck(s, s.turn)) out += legalMoves(s).length ? "+" : "#";
      unmake(s, u);
      return out;
    }

    /* ---------------------------------------------------------------
     * HUD. One band per player at their own outer edge, the far one
     * rotated 180 so it reads right-way-up from that side of the table —
     * the same reason a tournament board engraves its far coordinates
     * upside down.
     * ------------------------------------------------------------- */
    const FONT = "-apple-system,system-ui,'Segoe UI',Roboto,sans-serif";
    const PLAQUE =
      "background:linear-gradient(180deg,#4A2F1C,#35210F);border-radius:12px;" +
      "border-top:1px solid rgba(214,168,110,0.35);border-left:1px solid rgba(214,168,110,0.28);" +
      "border-bottom:1px solid rgba(0,0,0,0.5);border-right:1px solid rgba(0,0,0,0.4);";
    const PILL = (accent) =>
      "padding:11px 20px;border:1px solid " + accent + ";border-radius:999px;background:#2F2620;" +
      "color:#E8D9B4;font-family:inherit;font-size:14px;font-weight:700;letter-spacing:0.06em;" +
      "text-transform:uppercase;box-shadow:inset 0 1px 0 rgba(255,255,255,0.12);";

    function band(who, top) {
      const rot = top ? "transform:rotate(180deg);" : "";
      const edge = top ? "top:" + (ctx.safeArea.top + 6) + "px;" : "bottom:" + (ctx.safeArea.bottom + 6) + "px;";
      return '<div data-el="band-' + who + '" style="position:absolute;left:0;right:0;' + edge + rot +
        'display:flex;flex-direction:column;align-items:center;gap:7px;pointer-events:none;">' +
        '<div data-el="cap-' + who + '" style="height:19px;font-size:15px;letter-spacing:1px;opacity:0.8;"></div>' +
        '<div style="' + PLAQUE + 'padding:7px 17px;display:flex;align-items:center;gap:9px;">' +
          '<span style="width:13px;height:13px;border-radius:50%;background:' +
            (who === "w" ? "#EFE3C8" : "#1B1611") + ';border:1px solid rgba(214,168,110,0.5);"></span>' +
          '<span data-el="name-' + who + '" style="font-size:15px;font-weight:700;letter-spacing:0.10em;' +
            'text-transform:uppercase;color:#E8D9B4;">' + (who === "w" ? "White" : "Black") + '</span>' +
          '<span data-el="turn-' + who + '" style="font-size:11px;letter-spacing:0.16em;' +
            'text-transform:uppercase;color:#F2C14A;opacity:0;">to move</span>' +
        '</div>' +
        '<button data-el="act-' + who + '" style="' + PILL("#8A6A45") + 'pointer-events:auto;opacity:0.35;">Resign</button>' +
      '</div>';
    }

    const root = ctx.createRoot({ touchAction: "none" });
    // The overlay sits above the WebGL canvas, so it must be transparent to
    // pointers or it swallows every tap meant for the board. Only the pieces
    // of chrome that are meant to be pressed opt back in.
    root.style.cssText += ";font-family:" + FONT + ";color:#E8D9B4;pointer-events:none;";
    root.innerHTML =
      band("b", true) + band("w", false) +
      // Chrome sits in the strip between the board and White's HUD. It cannot
      // go down either side: the board is 376px wide on a 390px screen, so the
      // margins are 7px and a side column would cover the h-file.
      '<div data-el="chrome" style="position:absolute;left:0;right:0;top:' + (L.by + L.board + 9) + 'px;' +
        'display:flex;gap:9px;justify-content:center;z-index:40;pointer-events:none;">' +
        '<button data-el="mute" aria-label="Sound" style="pointer-events:auto;width:36px;height:36px;' +
          'border-radius:11px;border:1px solid rgba(214,168,110,0.28);background:#2F2620;color:#E8D9B4;' +
          'font-size:15px;font-family:inherit;padding:0;">🔊</button>' +
        '<button data-el="cog" aria-label="Settings" style="pointer-events:auto;width:36px;height:36px;' +
          'border-radius:11px;border:1px solid rgba(214,168,110,0.28);background:#2F2620;color:#E8D9B4;' +
          'font-size:15px;font-family:inherit;padding:0;">⚙</button>' +
        '<button data-el="help" aria-label="How to play" style="pointer-events:auto;width:36px;height:36px;' +
          'border-radius:11px;border:1px solid rgba(214,168,110,0.28);background:#2F2620;color:#E8D9B4;' +
          'font-size:15px;font-family:inherit;padding:0;">?</button>' +
      '</div>' +
      // Promotion picker, drawn in the promoting player's own rotation.
      '<div data-el="promo" style="position:absolute;inset:0;pointer-events:auto;display:none;align-items:center;' +
        'justify-content:center;background:rgba(18,14,10,0.82);z-index:60;">' +
        '<div data-el="promo-inner" style="' + PLAQUE + 'padding:18px;text-align:center;">' +
          '<div style="font-size:12px;letter-spacing:0.2em;text-transform:uppercase;opacity:0.65;' +
            'margin-bottom:12px;">Promote to</div>' +
          '<div data-el="promo-row" style="display:flex;gap:9px;"></div>' +
        '</div>' +
      '</div>' +
      // Terminal state.
      '<div data-el="over" style="position:absolute;inset:0;pointer-events:auto;display:none;flex-direction:column;' +
        'align-items:center;justify-content:center;gap:5px;background:rgba(18,14,10,0.88);z-index:65;' +
        'padding:26px;text-align:center;">' +
        '<div data-el="over-title" style="font-size:38px;font-weight:800;letter-spacing:0.04em;' +
          'text-transform:uppercase;color:#F2C14A;"></div>' +
        '<div data-el="over-line" style="font-size:14px;opacity:0.66;"></div>' +
        '<button data-el="again" style="' + PILL("#8A6A45") + 'margin-top:22px;">New game</button>' +
      '</div>' +
      // Settings.
      '<div data-el="cogp" style="position:absolute;inset:0;pointer-events:auto;display:none;align-items:center;' +
        'justify-content:center;background:rgba(18,14,10,0.9);z-index:70;padding:24px;">' +
        '<div style="max-width:320px;width:100%;' + PLAQUE + 'padding:22px;">' +
          '<div style="font-size:19px;font-weight:700;margin-bottom:15px;letter-spacing:0.04em;">Settings</div>' +
          '<div style="font-size:11px;letter-spacing:0.2em;text-transform:uppercase;opacity:0.55;">Board</div>' +
          '<div data-el="themes" style="display:flex;gap:7px;margin:9px 0 17px;"></div>' +
          '<div style="font-size:11px;letter-spacing:0.2em;text-transform:uppercase;opacity:0.55;">Legal move hints</div>' +
          '<div data-el="hints" style="display:flex;gap:7px;margin:9px 0 4px;"></div>' +
          '<button data-el="cogp-close" style="' + PILL("#8A6A45") + 'width:100%;margin-top:20px;">Done</button>' +
        '</div>' +
      '</div>' +
      // Instructions.
      '<div data-el="helpp" style="position:absolute;inset:0;pointer-events:auto;display:none;align-items:center;' +
        'justify-content:center;background:rgba(18,14,10,0.9);z-index:70;padding:24px;">' +
        '<div style="max-width:320px;width:100%;' + PLAQUE + 'padding:22px;">' +
          '<div style="font-size:19px;font-weight:700;margin-bottom:11px;letter-spacing:0.04em;">How to play</div>' +
          '<ul style="font-size:14px;line-height:1.72;opacity:0.86;padding-left:18px;margin:0;">' +
            '<li>Put the phone flat between you. White sits at the bottom edge, Black at the top.</li>' +
            '<li>The board never turns. Black plays it upside down, exactly as at a real board.</li>' +
            '<li>Tap your piece, then tap where it goes. Tap it again to change your mind.</li>' +
            '<li>Dots are quiet moves, rings are captures. Turn the hints off in settings.</li>' +
            '<li>Castling, en passant and promotion all work. A pawn reaching the far rank lets you choose.</li>' +
            '<li>Draws are called automatically: stalemate, dead position, fifty moves, fivefold repetition.</li>' +
          '</ul>' +
          '<button data-el="helpp-close" style="' + PILL("#8A6A45") + 'width:100%;margin-top:17px;">Got it</button>' +
        '</div>' +
      '</div>';

    const el = (n) => root.querySelector('[data-el="' + n + '"]');
    const tap = (node, fn) => {
      if (!node) return;
      ctx.listen(node, "pointerdown", (e) => e.stopPropagation());
      ctx.listen(node, "click", (e) => { e.stopPropagation(); e.preventDefault(); fn(e); });
    };

    const GLYPH = { p: "♟", n: "♞", b: "♝", r: "♜", q: "♛", k: "♚" };
    function paintHud() {
      for (const who of ["w", "b"]) {
        const mine = state.turn === who && !over;
        el("turn-" + who).style.opacity = mine ? "1" : "0";
        const act = el("act-" + who);
        act.style.opacity = mine ? "1" : "0.35";
        act.style.pointerEvents = mine ? "auto" : "none";
        // Captured material: the pieces this player has taken.
        const taken = [];
        const full = { p: 8, n: 2, b: 2, r: 2, q: 1 };
        for (const t of ["q", "r", "b", "n", "p"]) {
          const enemy = who === "w" ? t : t.toUpperCase();
          let left = 0;
          for (const p of state.board) if (p === enemy) left++;
          for (let i = 0; i < full[t] - left; i++) taken.push(GLYPH[t]);
        }
        el("cap-" + who).textContent = taken.join("");
      }
    }

    /* ---------------------------------------------------------------
     * Playing a move
     * ------------------------------------------------------------- */
    function commit(m) {
      const mover = state.turn;
      const san = toSAN(state, m);
      const fromW = worldOf(m.from), toW = worldOf(m.to);
      const mesh = meshAt[m.from];
      const captured = m.ep ? meshAt[sq(fileOf(m.to), rankOf(m.from))] : meshAt[m.to];

      make(state, m);
      state.history.push(posKey(state));
      moveList.push(san);
      lastMove = m;
      selected = -1; legalForSelected = [];

      sound.haptic(captured ? "medium" : "light");
      sound.sting(captured ? "coin" : "tap");

      // Slide the piece rather than teleporting it. A knight lifts slightly
      // at the midpoint so its jump reads as a jump.
      anim = {
        mesh, captured,
        fx: fromW.x, fz: fromW.z, tx: toW.x, tz: toW.z,
        t: 0, dur: 0.18,
        arc: mesh && mesh.userData.type === "n" ? 0.30 * U : 0,
        after: () => {
          syncBoard();
          paintOverlays();
          paintHud();
          checkTerminal();
        },
      };
      ctx.platform.interact({ type: "move", san });
    }

    function checkTerminal() {
      const moves = legalMoves(state);
      const checked = inCheck(state, state.turn);
      let title = null, line = null, result = null;

      if (moves.length === 0) {
        if (checked) {
          const winner = state.turn === WHITE ? "Black" : "White";
          title = "Checkmate"; line = winner + " wins in " + Math.ceil(moveList.length / 2) + " moves";
          result = state.turn === WHITE ? "b" : "w";
        } else { title = "Stalemate"; line = "Draw — no legal move, and not in check"; result = "draw"; }
      } else if (insufficientMaterial(state)) {
        title = "Draw"; line = "Dead position — neither side can mate"; result = "draw";
      } else if (state.half >= 150) {
        title = "Draw"; line = "Seventy-five moves without a capture or a pawn move"; result = "draw";
      } else {
        const key = posKey(state);
        let n = 0;
        for (const k of state.history) if (k === key) n++;
        if (n >= 5) { title = "Draw"; line = "Fivefold repetition"; result = "draw"; }
      }
      if (!title) return;

      over = result;
      el("over-title").textContent = title;
      el("over-line").textContent = line;
      el("over").style.display = "flex";
      sound.duck(0.5, 400);
      sound.sting(result === "draw" ? "fail" : "win");
      sound.haptic(result === "draw" ? "warning" : "success");
      ctx.platform.complete({ result, moves: moveList.length });

      // The record belongs to the match, not to one of the two people at the
      // table: how quickly this board produced a mate.
      if (result !== "draw") {
        try { ctx.memory.record("fastest_mate").submit(Math.ceil(moveList.length / 2),
          { label: Math.ceil(moveList.length / 2) + " moves" }); } catch (_) {}
      }
    }

    function offerPromotion(from, to, options) {
      pendingPromo = { from, to, options };
      const row = el("promo-row");
      row.innerHTML = ["q", "r", "b", "n"].map((t) =>
        '<button data-p="' + t + '" style="width:56px;height:56px;border-radius:12px;' +
        'border:1px solid rgba(214,168,110,0.4);background:#2F2620;color:#E8D9B4;font-size:30px;' +
        'line-height:1;font-family:inherit;padding:0;">' + GLYPH[t] + '</button>').join("");
      for (const b of row.querySelectorAll("button")) {
        tap(b, () => {
          const pick = options.find((o) => o.promo === b.dataset.p);
          el("promo").style.display = "none";
          pendingPromo = null;
          if (pick) commit(pick);
        });
      }
      // Shown in the promoting player's own rotation, so they are not reading
      // their own choice upside down.
      el("promo-inner").style.transform = state.turn === BLACK ? "rotate(180deg)" : "none";
      el("promo").style.display = "flex";
    }

    /* --- input: tap to select, tap to move --- */
    ctx.listen(glCanvas, "pointerdown", async (e) => {
      if (over || anim || pendingPromo) return;
      await sound.unlock();
      ctx.platform.start();
      const i = pickSquare(e.offsetX, e.offsetY);
      if (i < 0) { selected = -1; legalForSelected = []; paintOverlays(); return; }

      if (selected >= 0) {
        const picks = legalForSelected.filter((m) => m.to === i);
        if (picks.length > 1) return offerPromotion(selected, i, picks);   // four promotion choices
        if (picks.length === 1) return commit(picks[0]);
      }
      const p = state.board[i];
      if (p !== 0 && colourOf(p) === state.turn) {
        selected = i;
        legalForSelected = legalMoves(state).filter((m) => m.from === i);
        sound.haptic("light");
      } else {
        selected = -1;
        legalForSelected = [];
      }
      paintOverlays();
      e.preventDefault();
    }, { passive: false });

    /* --- chrome --- */
    tap(el("mute"), (e) => { e.target.textContent = sound.toggle() ? "🔇" : "🔊"; });
    if (settings.mute) el("mute").textContent = "🔇";
    tap(el("cog"), () => { el("cogp").style.display = "flex"; });
    tap(el("cogp-close"), () => { el("cogp").style.display = "none"; });
    tap(el("help"), () => { el("helpp").style.display = "flex"; });
    tap(el("helpp-close"), () => { el("helpp").style.display = "none"; });

    function pills(host, values, labels, get, set) {
      host.innerHTML = values.map((v, i) =>
        '<button data-v="' + v + '" style="flex:1;padding:10px 0;border-radius:10px;' +
        'border:1px solid rgba(214,168,110,0.24);font-family:inherit;font-size:13px;' +
        'font-weight:600;">' + labels[i] + '</button>').join("");
      const paint = () => {
        for (const b of host.querySelectorAll("button")) {
          const on = String(get()) === b.dataset.v;
          b.style.background = on ? "#5A4028" : "#2A211A";
          b.style.color = on ? "#F2C14A" : "rgba(232,217,180,0.55)";
        }
      };
      for (const b of host.querySelectorAll("button")) {
        tap(b, () => { set(b.dataset.v); saveSettings(); paint(); sound.haptic("light"); });
      }
      paint();
    }
    pills(el("themes"), ["wood", "green", "slate"], ["Walnut", "Green", "Slate"],
      () => settings.theme, (v) => { settings.theme = v; buildBoard(); });
    pills(el("hints"), ["true", "false"], ["On", "Off"],
      () => String(settings.hints), (v) => { settings.hints = v === "true"; paintOverlays(); });

    function resign(who) {
      over = who === "w" ? "b" : "w";
      el("over-title").textContent = "Resigned";
      el("over-line").textContent = (who === "w" ? "Black" : "White") + " wins";
      el("over").style.display = "flex";
      sound.sting("lose");
      ctx.platform.complete({ result: over, resigned: true });
    }
    tap(el("act-w"), () => resign("w"));
    tap(el("act-b"), () => resign("b"));

    function newGame() {
      for (let i = 0; i < 64; i++) if (meshAt[i]) { returnPiece(meshAt[i].userData.letter, meshAt[i]); meshAt[i] = null; }
      state = startPosition();
      state.history.push(posKey(state));
      moveList.length = 0;
      selected = -1; legalForSelected = []; lastMove = null; over = null; anim = null;
      el("over").style.display = "none";
      syncBoard(); paintOverlays(); paintHud();
      ctx.platform.interact({ type: "new_game" });
    }
    tap(el("again"), newGame);

    /* ---------------------------------------------------------------
     * Frame
     * ------------------------------------------------------------- */
    const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
    let checkPulse = 0;

    ctx.onFrame((dtMs) => {
      const dt = Math.min(dtMs, 50) / 1000;

      if (anim) {
        anim.t += dt;
        const t = Math.min(anim.t / anim.dur, 1);
        const e = easeOutCubic(t);
        if (anim.mesh) {
          anim.mesh.position.x = anim.fx + (anim.tx - anim.fx) * e;
          anim.mesh.position.z = anim.fz + (anim.tz - anim.fz) * e;
          anim.mesh.position.y = 0.09 * U + Math.sin(t * Math.PI) * anim.arc;
        }
        // The taken piece shrinks away rather than blinking out.
        if (anim.captured) {
          const s = 1 - e;
          anim.captured.scale.setScalar(Math.max(s, 0.001));
        }
        if (t >= 1) { const a = anim; anim = null; a.after(); }
      }

      // The check ring breathes: continuous, low-frequency, ignorable but present.
      if (!over && !anim && inCheck(state, state.turn)) {
        checkPulse += dt;
        const a = 0.35 + Math.sin(checkPulse * 2.2) * 0.15;
        for (const c of overlay.children) {
          if (c.material.color.getHex() === 0xC4432E) c.material.opacity = a * c.userData.k;
        }
      }

      renderer.render(scene, camera);
    });

    ctx.listen(window, "resize", () => {
      if (ctx.width === W && ctx.height === H) return;
      measure();
      renderer.setSize(ctx.width, ctx.height, false);
      placeCamera();
    });

    /* --- boot --- */
    state.history.push(posKey(state));
    syncBoard();
    paintOverlays();
    paintHud();

    // A read-only window for the local harness, so a scripted game can assert
    // on real positions. It exposes nothing the board does not already show.
    window.__CHESS__ = {
      get fen() { return state.board.join(""); },
      get turn() { return state.turn; },
      get moves() { return moveList.slice(); },
      get over() { return over; },
      get legal() { return legalMoves(state).length; },
      get check() { return inCheck(state, state.turn); },
      get sel() { return selected; },
      // True while a piece is sliding: the board rejects input until it lands.
      get busy() { return anim !== null; },
      squareXY: (name) => {
        const i = NAMES.indexOf(name[0]) + (Number(name[1]) - 1) * 8;
        return { x: L.bx + (fileOf(i) + 0.5) * L.unit, y: L.by + (7 - rankOf(i) + 0.5) * L.unit };
      },
    };
    ctx.onDestroy(() => { try { delete window.__CHESS__; } catch (_) {} });

    renderer.render(scene, camera);
    ctx.markVisualReady("board set");
    ctx.platform.ready();
  },
};
