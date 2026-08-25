/**
 * Chess — two players, one phone, drawn flat.
 *
 * This was a 3D board and it did not work. Seen from straight overhead — the
 * only fair angle when two people are playing each other across a table — a
 * lathe-turned Staunton piece is a disc. The profile that makes a chess set
 * readable is its SIDE, and from above you cannot see any of it: a bishop, a
 * pawn and a queen are three circles of slightly different diameter. So the
 * board is now flat, and the pieces are the flat vector silhouettes every
 * chess site uses, for exactly this reason.
 *
 * Everything else about the seating is unchanged and still right. The phone
 * lies flat between the players, White at the near edge and Black at the far
 * one, and THE BOARD NEVER TURNS — Black plays it upside down exactly as at a
 * real board. Each player's HUD sits in the band at their own edge, rotated to
 * face them, which is the same reason a tournament board engraves its far-side
 * coordinates upside down.
 *
 * The rules engine below is untouched from the 3D version and is delimited so
 * tools/harness/perft-chess.mjs can lift it out and verify it against the
 * published node counts. It matches exactly at every depth tested, including
 * the two positions that trap en-passant discovered check and castling rights.
 *
 * Dropping three.js also drops the only dependency this bit had, and with it
 * the 1.2MB module download that preceded the first frame.
 *
 * Contract notes: no packaged assets (maxAssets is 0), so the board's wood and
 * every piece are canvas paths. The overlay is markup on ctx.createRoot() with
 * pointer-events off on the root itself, because that element sits above the
 * canvas and would otherwise swallow every tap. Pointer maths uses
 * offsetX/offsetY, never getBoundingClientRect.
 */
window.plethoraBit = {
  meta: {
    title: "Chess",
    runtime: "plethora-bit@2",
    tags: ["chess", "multiplayer", "local-multiplayer", "board", "two-player"],
    permissions: ["backgroundMusic", "haptics", "storage"],
  },

  async init(ctx) {
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
    const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
    const TAU = Math.PI * 2;
    const esc = (s) => String(s).replace(/[&<>"']/g,
      (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

    /* ---------------------------------------------------------------
     * The pieces.
     *
     * Flat silhouettes in a unit box, drawn the way every chess site
     * draws them: a solid body in the player's colour with a heavy
     * contrasting outline, so a white piece on a light square and a
     * black piece on a dark square both stay legible. Each path is
     * authored in a 0..1 square with the piece standing on y = 0.94.
     * ------------------------------------------------------------- */
    function pieceBase(p, w) {
      // The flared foot every piece stands on.
      p.moveTo(0.22, 0.94);
      p.lineTo(0.78, 0.94);
      p.lineTo(0.72, 0.86);
      p.lineTo(0.28, 0.86);
      p.closePath();
    }

    const PIECE = {
      p(p) {                                   // pawn
        p.moveTo(0.30, 0.88);
        p.bezierCurveTo(0.30, 0.72, 0.40, 0.66, 0.43, 0.60);
        p.bezierCurveTo(0.36, 0.55, 0.36, 0.44, 0.44, 0.41);
        p.bezierCurveTo(0.38, 0.36, 0.40, 0.26, 0.50, 0.26);
        p.bezierCurveTo(0.60, 0.26, 0.62, 0.36, 0.56, 0.41);
        p.bezierCurveTo(0.64, 0.44, 0.64, 0.55, 0.57, 0.60);
        p.bezierCurveTo(0.60, 0.66, 0.70, 0.72, 0.70, 0.88);
        p.closePath();
      },
      r(p) {                                   // rook
        p.moveTo(0.26, 0.88);
        p.lineTo(0.30, 0.46);
        p.lineTo(0.26, 0.46);
        p.lineTo(0.26, 0.26);
        p.lineTo(0.35, 0.26);
        p.lineTo(0.35, 0.33);
        p.lineTo(0.44, 0.33);
        p.lineTo(0.44, 0.26);
        p.lineTo(0.56, 0.26);
        p.lineTo(0.56, 0.33);
        p.lineTo(0.65, 0.33);
        p.lineTo(0.65, 0.26);
        p.lineTo(0.74, 0.26);
        p.lineTo(0.74, 0.46);
        p.lineTo(0.70, 0.46);
        p.lineTo(0.74, 0.88);
        p.closePath();
      },
      n(p) {                                   // knight — the one asymmetric piece
        p.moveTo(0.30, 0.88);
        p.bezierCurveTo(0.28, 0.66, 0.34, 0.54, 0.44, 0.47);
        p.lineTo(0.38, 0.40);
        p.bezierCurveTo(0.30, 0.44, 0.26, 0.40, 0.26, 0.35);
        p.bezierCurveTo(0.26, 0.28, 0.33, 0.24, 0.38, 0.27);
        p.lineTo(0.42, 0.20);
        p.lineTo(0.46, 0.26);
        p.lineTo(0.50, 0.17);
        p.bezierCurveTo(0.64, 0.19, 0.74, 0.31, 0.75, 0.48);
        p.bezierCurveTo(0.76, 0.66, 0.74, 0.78, 0.72, 0.88);
        p.closePath();
      },
      b(p) {                                   // bishop
        p.moveTo(0.28, 0.88);
        p.bezierCurveTo(0.28, 0.72, 0.38, 0.66, 0.42, 0.62);
        p.lineTo(0.58, 0.62);
        p.bezierCurveTo(0.62, 0.66, 0.72, 0.72, 0.72, 0.88);
        p.closePath();
        p.moveTo(0.50, 0.16);
        p.bezierCurveTo(0.64, 0.26, 0.68, 0.42, 0.62, 0.56);
        p.lineTo(0.38, 0.56);
        p.bezierCurveTo(0.32, 0.42, 0.36, 0.26, 0.50, 0.16);
        p.closePath();
      },
      q(p) {                                   // queen
        p.moveTo(0.24, 0.88);
        p.lineTo(0.30, 0.56);
        p.lineTo(0.70, 0.56);
        p.lineTo(0.76, 0.88);
        p.closePath();
        p.moveTo(0.30, 0.52);
        p.lineTo(0.20, 0.24);
        p.lineTo(0.34, 0.38);
        p.lineTo(0.42, 0.18);
        p.lineTo(0.50, 0.36);
        p.lineTo(0.58, 0.18);
        p.lineTo(0.66, 0.38);
        p.lineTo(0.80, 0.24);
        p.lineTo(0.70, 0.52);
        p.closePath();
      },
      k(p) {                                   // king
        p.moveTo(0.26, 0.88);
        p.lineTo(0.32, 0.58);
        p.lineTo(0.68, 0.58);
        p.lineTo(0.74, 0.88);
        p.closePath();
        p.moveTo(0.32, 0.54);
        p.bezierCurveTo(0.26, 0.44, 0.30, 0.32, 0.40, 0.32);
        p.bezierCurveTo(0.45, 0.32, 0.48, 0.35, 0.50, 0.38);
        p.bezierCurveTo(0.52, 0.35, 0.55, 0.32, 0.60, 0.32);
        p.bezierCurveTo(0.70, 0.32, 0.74, 0.44, 0.68, 0.54);
        p.closePath();
        p.moveTo(0.455, 0.30);                 // the cross
        p.lineTo(0.455, 0.20);
        p.lineTo(0.40, 0.20);
        p.lineTo(0.40, 0.13);
        p.lineTo(0.455, 0.13);
        p.lineTo(0.455, 0.06);
        p.lineTo(0.545, 0.06);
        p.lineTo(0.545, 0.13);
        p.lineTo(0.60, 0.13);
        p.lineTo(0.60, 0.20);
        p.lineTo(0.545, 0.20);
        p.lineTo(0.545, 0.30);
        p.closePath();
      },
    };

    /** Draw one piece, filling its square. */
    function drawPiece(g, letter, x, y, size, scale) {
      const white = isWhite(letter);
      const t = letter.toLowerCase();
      const s = size * (scale || 1);
      const off = (size - s) / 2;
      g.save();
      g.translate(x + off, y + off);
      g.scale(s, s);

      const path = new Path2D();
      PIECE[t](path);
      pieceBase(path);

      // A soft contact shadow so the piece sits ON the square rather than
      // floating over it. Drawn as a squashed ellipse, not a blur filter.
      g.save();
      g.globalAlpha = 0.18;
      g.fillStyle = "#000";
      g.beginPath();
      g.ellipse(0.5, 0.925, 0.30, 0.052, 0, 0, TAU);
      g.fill();
      g.restore();

      g.fillStyle = white ? "#F7F4EC" : "#2B2724";
      g.strokeStyle = white ? "#3B3733" : "#0B0A09";
      g.lineWidth = 0.038;
      g.lineJoin = "round";
      g.fill(path);
      g.stroke(path);
      // One interior line, which is what separates a chess glyph from a blob:
      // the bishop's slit, the king's collar, the rook's belt.
      g.lineWidth = 0.026;
      g.strokeStyle = white ? "#8A857C" : "#6A635C";
      g.beginPath();
      if (t === "b") { g.moveTo(0.44, 0.34); g.lineTo(0.56, 0.34); }
      else if (t === "k") { g.moveTo(0.34, 0.56); g.lineTo(0.66, 0.56); }
      else if (t === "r") { g.moveTo(0.30, 0.46); g.lineTo(0.70, 0.46); }
      else if (t === "q") { g.moveTo(0.30, 0.55); g.lineTo(0.70, 0.55); }
      else if (t === "p") { g.moveTo(0.43, 0.60); g.lineTo(0.57, 0.60); }
      else { g.moveTo(0.40, 0.40); g.lineTo(0.44, 0.34); }   // knight's cheek
      g.stroke();
      g.restore();
    }

    /* ---------------------------------------------------------------
     * Layout, settings and sound
     * ------------------------------------------------------------- */
    let W = ctx.width, H = ctx.height;
    const L = {};
    function measure() {
      W = ctx.width; H = ctx.height;
      L.board = Math.min(W - 14, H * 0.475);
      L.sq = L.board / 8;
      L.bx = (W - L.board) / 2;
      L.by = (H - L.board) / 2;
    }
    measure();

    const THEMES = {
      green: { light: "#EEEED2", dark: "#769656", edge: "#5C7A44", name: "Green" },
      wood:  { light: "#E9D9B4", dark: "#A9744C", edge: "#7A4A2B", name: "Walnut" },
      slate: { light: "#D6DBE4", dark: "#6E7A90", edge: "#4A5262", name: "Slate" },
    };
    const MARK = "rgba(246,201,74,0.62)";      // selection / last move
    const HINT = "rgba(30,26,20,0.26)";        // legal-move dot
    const DANGER = "#C4432E";

    const saved = (function () {
      try { return ctx.storage.get("chess") || {}; } catch (_) { return {}; }
    })();
    const settings = {
      theme: THEMES[saved.theme] ? saved.theme : "green",
      hints: saved.hints !== false,
      mute: !!saved.mute,
    };
    function saveSettings() { try { ctx.storage.set("chess", settings); } catch (_) {} }

    const sound = (function () {
      let muted = settings.mute, bed = null, unlocked = false;
      const start = () => ctx.music.play({ preset: "drift", volume: 0.2, tempo: 72, intensity: 0.16 });
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
     * State
     * ------------------------------------------------------------- */
    let state = startPosition();
    let selected = -1, legalForSelected = [], lastMove = null, over = null;
    let pendingPromo = null, anim = null;
    const moveList = [];

    function posKey(s) {
      return s.board.join("") + s.turn +
        (s.castling.K ? "K" : "") + (s.castling.Q ? "Q" : "") +
        (s.castling.k ? "k" : "") + (s.castling.q ? "q" : "") +
        (s.ep === null ? "-" : fileOf(s.ep));
    }

    function insufficientMaterial(s) {
      const men = [];
      for (const p of s.board) if (p !== 0 && p.toLowerCase() !== "k") men.push(p);
      if (men.length === 0) return true;
      if (men.length === 1) return "bn".includes(men[0].toLowerCase());
      if (men.length === 2 && men.every((m) => m.toLowerCase() === "b")) {
        const on = [];
        for (let i = 0; i < 64; i++) if (s.board[i] !== 0 && s.board[i].toLowerCase() === "b")
          on.push((fileOf(i) + rankOf(i)) & 1);
        return on[0] === on[1] && colourOf(men[0]) !== colourOf(men[1]);
      }
      return false;
    }

    /* --- geometry: the board never turns, so this is a plain mapping --- */
    const sqX = (i) => L.bx + fileOf(i) * L.sq;
    const sqY = (i) => L.by + (7 - rankOf(i)) * L.sq;
    function pickSquare(px, py) {
      const f = Math.floor((px - L.bx) / L.sq);
      const r = 7 - Math.floor((py - L.by) / L.sq);
      if (f < 0 || f > 7 || r < 0 || r > 7) return -1;
      return sq(f, r);
    }

    /* ---------------------------------------------------------------
     * Painting
     * ------------------------------------------------------------- */
    const canvas = ctx.createCanvas2D({ touchAction: "none" });
    const g = canvas.getContext("2d");

    function roundRect(q, x, y, w, h, r) {
      const k = Math.min(r, w / 2, h / 2);
      q.beginPath();
      q.moveTo(x + k, y);
      q.arcTo(x + w, y, x + w, y + h, k);
      q.arcTo(x + w, y + h, x, y + h, k);
      q.arcTo(x, y + h, x, y, k);
      q.arcTo(x, y, x + w, y, k);
      q.closePath();
    }

    function paint() {
      const th = THEMES[settings.theme];
      g.fillStyle = "#1D1B18";
      g.fillRect(0, 0, W, H);

      // Frame.
      g.fillStyle = th.edge;
      roundRect(g, L.bx - 7, L.by - 7, L.board + 14, L.board + 14, 8);
      g.fill();

      // Squares. a1 is dark, and h1 is light under White's right hand.
      for (let i = 0; i < 64; i++) {
        const dark = (fileOf(i) + rankOf(i)) % 2 === 0;
        g.fillStyle = dark ? th.dark : th.light;
        g.fillRect(sqX(i), sqY(i), L.sq + 0.5, L.sq + 0.5);
      }

      // Last move and selection, under the pieces.
      if (lastMove) {
        g.fillStyle = MARK;
        g.globalAlpha = 0.55;
        g.fillRect(sqX(lastMove.from), sqY(lastMove.from), L.sq, L.sq);
        g.fillRect(sqX(lastMove.to), sqY(lastMove.to), L.sq, L.sq);
        g.globalAlpha = 1;
      }
      if (selected >= 0) {
        g.fillStyle = MARK;
        g.fillRect(sqX(selected), sqY(selected), L.sq, L.sq);
      }

      // The king in check gets a hand-built radial falloff — concentric rings
      // with a ramped alpha, because the canvas blur filter is off-limits.
      if (!over && inCheck(state, state.turn)) {
        const k = findKing(state.board, state.turn);
        const cx = sqX(k) + L.sq / 2, cy = sqY(k) + L.sq / 2;
        for (let i = 6; i >= 1; i--) {
          g.fillStyle = "rgba(196,67,46," + (0.09 * (7 - i) / 6).toFixed(3) + ")";
          g.beginPath();
          g.arc(cx, cy, L.sq * 0.10 * i, 0, TAU);
          g.fill();
        }
      }

      // Coordinates, in-square in the opposite square's colour.
      g.font = "700 " + (L.sq * 0.21) + "px -apple-system, system-ui, sans-serif";
      for (let f = 0; f < 8; f++) {
        const i = sq(f, 0);
        g.fillStyle = (f % 2 === 0) ? th.light : th.dark;
        g.globalAlpha = 0.7;
        g.textAlign = "right"; g.textBaseline = "bottom";
        g.fillText(NAMES[f], sqX(i) + L.sq - L.sq * 0.08, sqY(i) + L.sq - L.sq * 0.05);
      }
      for (let r = 0; r < 8; r++) {
        const i = sq(7, r);
        g.fillStyle = ((7 + r) % 2 === 0) ? th.light : th.dark;
        g.textAlign = "left"; g.textBaseline = "top";
        g.fillText(String(r + 1), sqX(i) + L.sq * 0.07, sqY(i) + L.sq * 0.05);
      }
      g.globalAlpha = 1;

      // Pieces, skipping whichever one is currently in flight.
      for (let i = 0; i < 64; i++) {
        const p = state.board[i];
        if (p === 0) continue;
        if (anim && anim.hideAt === i) continue;
        drawPiece(g, p, sqX(i), sqY(i), L.sq, selected === i ? 1.06 : 1);
      }

      // Legal-move markers, over the pieces so a capture ring is not hidden.
      if (selected >= 0 && settings.hints) {
        for (const m of legalForSelected) {
          const cx = sqX(m.to) + L.sq / 2, cy = sqY(m.to) + L.sq / 2;
          const capture = state.board[m.to] !== 0 || m.ep;
          g.strokeStyle = HINT; g.fillStyle = HINT;
          if (capture) {
            g.lineWidth = L.sq * 0.085;
            g.beginPath(); g.arc(cx, cy, L.sq * 0.42, 0, TAU); g.stroke();
          } else {
            g.beginPath(); g.arc(cx, cy, L.sq * 0.155, 0, TAU); g.fill();
          }
        }
      }

      // The moving piece, on top.
      if (anim) {
        const t = 1 - Math.pow(1 - clamp(anim.t / anim.dur, 0, 1), 3);
        const x = anim.fx + (anim.tx - anim.fx) * t;
        const y = anim.fy + (anim.ty - anim.fy) * t;
        const lift = anim.arc ? Math.sin(t * Math.PI) * L.sq * 0.16 : 0;
        drawPiece(g, anim.letter, x, y - lift, L.sq, 1);
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
     * Overlay
     * ------------------------------------------------------------- */
    const FONT = "-apple-system,system-ui,'Segoe UI',Roboto,sans-serif";
    const ST = ctx.safeArea.top, SB = ctx.safeArea.bottom;
    const PLAQUE =
      "background:linear-gradient(180deg,#3A3733,#26241F);border-radius:12px;" +
      "border-top:1px solid rgba(230,225,210,0.18);border-bottom:1px solid rgba(0,0,0,0.45);";
    const PILL = (accent) =>
      "padding:11px 20px;border:1px solid " + accent + ";border-radius:999px;background:#2A2724;" +
      "color:#EFEAE0;font-family:inherit;font-size:14px;font-weight:700;letter-spacing:0.06em;" +
      "text-transform:uppercase;";
    const BIG = "width:100%;padding:13px;border:none;border-radius:14px;font-family:inherit;" +
      "font-size:15px;font-weight:700;background:rgba(239,234,224,0.14);color:#EFEAE0;";

    function band(who, top) {
      const rot = top ? "transform:rotate(180deg);" : "";
      const edge = top ? "top:" + (ST + 6) + "px;" : "bottom:" + (SB + 6) + "px;";
      return '<div style="position:absolute;left:0;right:0;' + edge + rot +
        'display:flex;flex-direction:column;align-items:center;gap:7px;pointer-events:none;">' +
        '<div data-el="cap-' + who + '" style="height:19px;font-size:15px;letter-spacing:1px;opacity:0.8;"></div>' +
        '<div style="' + PLAQUE + 'padding:7px 17px;display:flex;align-items:center;gap:9px;">' +
          '<span style="width:13px;height:13px;border-radius:50%;background:' +
            (who === "w" ? "#F7F4EC" : "#2B2724") + ';border:1px solid rgba(230,225,210,0.45);"></span>' +
          '<span style="font-size:15px;font-weight:700;letter-spacing:0.10em;' +
            'text-transform:uppercase;color:#EFEAE0;">' + (who === "w" ? "White" : "Black") + '</span>' +
          '<span data-el="turn-' + who + '" style="font-size:11px;letter-spacing:0.16em;' +
            'text-transform:uppercase;color:#F6C94A;opacity:0;">to move</span>' +
        '</div>' +
        '<button data-el="act-' + who + '" style="' + PILL("#6E6A62") + 'pointer-events:auto;opacity:0.35;">Resign</button>' +
      '</div>';
    }

    const root = ctx.createRoot({ touchAction: "none" });
    root.style.cssText += ";font-family:" + FONT + ";color:#EFEAE0;pointer-events:none;";
    root.innerHTML =
      band("b", true) + band("w", false) +
      // Chrome sits between the board and White's HUD. It cannot go down
      // either side: the board is 376px wide on a 390px screen.
      '<div style="position:absolute;left:0;right:0;top:' + (L.by + L.board + 9) + 'px;' +
        'display:flex;gap:9px;justify-content:center;z-index:40;pointer-events:none;">' +
        '<button data-el="mute" aria-label="Sound" style="pointer-events:auto;width:36px;height:36px;' +
          'border-radius:11px;border:none;background:rgba(239,234,224,0.13);color:#EFEAE0;' +
          'font-size:15px;font-family:inherit;padding:0;">🔊</button>' +
        '<button data-el="cog" aria-label="Settings" style="pointer-events:auto;width:36px;height:36px;' +
          'border-radius:11px;border:none;background:rgba(239,234,224,0.13);color:#EFEAE0;' +
          'font-size:15px;font-family:inherit;padding:0;">⚙</button>' +
        '<button data-el="help" aria-label="How to play" style="pointer-events:auto;width:36px;height:36px;' +
          'border-radius:11px;border:none;background:rgba(239,234,224,0.13);color:#EFEAE0;' +
          'font-size:15px;font-family:inherit;padding:0;">?</button>' +
      '</div>' +
      '<div data-el="promo" style="position:absolute;inset:0;pointer-events:auto;display:none;' +
        'align-items:center;justify-content:center;background:rgba(16,15,13,0.84);z-index:60;">' +
        '<div data-el="promo-inner" style="' + PLAQUE + 'padding:18px;text-align:center;">' +
          '<div style="font-size:12px;letter-spacing:0.2em;text-transform:uppercase;opacity:0.65;' +
            'margin-bottom:12px;">Promote to</div>' +
          '<div data-el="promo-row" style="display:flex;gap:9px;"></div>' +
        '</div>' +
      '</div>' +
      '<div data-el="over" style="position:absolute;inset:0;pointer-events:auto;display:none;' +
        'flex-direction:column;align-items:center;justify-content:center;gap:5px;' +
        'background:rgba(16,15,13,0.9);z-index:65;padding:26px;text-align:center;">' +
        '<div data-el="over-title" style="font-size:38px;font-weight:800;letter-spacing:0.04em;' +
          'text-transform:uppercase;color:#F6C94A;"></div>' +
        '<div data-el="over-line" style="font-size:14px;opacity:0.66;"></div>' +
        '<button data-el="again" style="' + PILL("#6E6A62") + 'margin-top:22px;">New game</button>' +
      '</div>' +
      '<div data-el="cogp" style="position:absolute;inset:0;pointer-events:auto;display:none;' +
        'align-items:center;justify-content:center;background:rgba(16,15,13,0.92);z-index:70;padding:24px;">' +
        '<div style="max-width:320px;width:100%;' + PLAQUE + 'padding:22px;">' +
          '<div style="font-size:19px;font-weight:700;margin-bottom:15px;">Settings</div>' +
          '<div style="font-size:11px;letter-spacing:0.2em;text-transform:uppercase;opacity:0.55;">Board</div>' +
          '<div data-el="themes" style="display:flex;gap:7px;margin:9px 0 17px;"></div>' +
          '<div style="font-size:11px;letter-spacing:0.2em;text-transform:uppercase;opacity:0.55;">Legal move hints</div>' +
          '<div data-el="hints" style="display:flex;gap:7px;margin:9px 0 4px;"></div>' +
          '<button data-el="cogp-close" style="' + BIG + 'margin-top:20px;">Done</button>' +
        '</div>' +
      '</div>' +
      '<div data-el="helpp" style="position:absolute;inset:0;pointer-events:auto;display:none;' +
        'align-items:center;justify-content:center;background:rgba(16,15,13,0.92);z-index:70;padding:24px;">' +
        '<div style="max-width:320px;width:100%;' + PLAQUE + 'padding:22px;">' +
          '<div style="font-size:19px;font-weight:700;margin-bottom:11px;">How to play</div>' +
          '<ul style="font-size:14px;line-height:1.72;opacity:0.86;padding-left:18px;margin:0;">' +
            '<li>Put the phone flat between you. White sits at the bottom edge, Black at the top.</li>' +
            '<li>The board never turns. Black plays it upside down, exactly as at a real board.</li>' +
            '<li>Tap your piece, then tap where it goes. Tap it again to change your mind.</li>' +
            '<li>Dots are quiet moves, rings are captures. Turn the hints off in settings.</li>' +
            '<li>Castling, en passant and promotion all work. A pawn reaching the far rank lets you choose.</li>' +
            '<li>Draws are called automatically: stalemate, dead position, fifty moves, fivefold repetition.</li>' +
          '</ul>' +
          '<button data-el="helpp-close" style="' + BIG + 'margin-top:17px;">Got it</button>' +
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
      const san = toSAN(state, m);
      const letter = state.board[m.from];
      const captured = m.ep ? state.board[sq(fileOf(m.to), rankOf(m.from))] : state.board[m.to];

      make(state, m);
      state.history.push(posKey(state));
      moveList.push(san);
      lastMove = m;
      selected = -1; legalForSelected = [];

      sound.haptic(captured ? "medium" : "light");
      sound.sting(captured ? "coin" : "tap");

      // Slide the piece rather than snapping it. A knight lifts at the
      // midpoint so its jump reads as a jump.
      anim = {
        letter, hideAt: m.to,
        fx: sqX(m.from), fy: sqY(m.from), tx: sqX(m.to), ty: sqY(m.to),
        t: 0, dur: 0.16, arc: letter.toLowerCase() === "n",
        after: () => { paintHud(); checkTerminal(); },
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
        'border:1px solid rgba(230,225,210,0.35);background:#2A2724;color:#EFEAE0;font-size:30px;' +
        'line-height:1;font-family:inherit;padding:0;">' + GLYPH[t] + '</button>').join("");
      for (const b of row.querySelectorAll("button")) {
        tap(b, () => {
          const pick = options.find((o) => o.promo === b.dataset.p);
          el("promo").style.display = "none";
          pendingPromo = null;
          if (pick) commit(pick);
        });
      }
      // Shown in the promoting player's own rotation.
      el("promo-inner").style.transform = state.turn === BLACK ? "rotate(180deg)" : "none";
      el("promo").style.display = "flex";
    }

    /* --- input: tap to select, tap to move --- */
    ctx.listen(canvas, "pointerdown", async (e) => {
      if (over || anim || pendingPromo) return;
      await sound.unlock();
      ctx.platform.start();
      const i = pickSquare(e.offsetX, e.offsetY);
      if (i < 0) { selected = -1; legalForSelected = []; return; }

      if (selected >= 0) {
        const picks = legalForSelected.filter((m) => m.to === i);
        if (picks.length > 1) return offerPromotion(selected, i, picks);
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
        'border:1px solid rgba(230,225,210,0.2);font-family:inherit;font-size:13px;' +
        'font-weight:600;">' + labels[i] + '</button>').join("");
      const paint2 = () => {
        for (const b of host.querySelectorAll("button")) {
          const on = String(get()) === b.dataset.v;
          b.style.background = on ? "#5A5348" : "#211F1C";
          b.style.color = on ? "#F6C94A" : "rgba(239,234,224,0.55)";
        }
      };
      for (const b of host.querySelectorAll("button")) {
        tap(b, () => { set(b.dataset.v); saveSettings(); paint2(); sound.haptic("light"); });
      }
      paint2();
    }
    pills(el("themes"), ["green", "wood", "slate"], ["Green", "Walnut", "Slate"],
      () => settings.theme, (v) => { settings.theme = v; });
    pills(el("hints"), ["true", "false"], ["On", "Off"],
      () => String(settings.hints), (v) => { settings.hints = v === "true"; });

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
      state = startPosition();
      state.history.push(posKey(state));
      moveList.length = 0;
      selected = -1; legalForSelected = []; lastMove = null; over = null; anim = null;
      el("over").style.display = "none";
      paintHud();
      ctx.platform.interact({ type: "new_game" });
    }
    tap(el("again"), newGame);

    /* --- frame --- */
    ctx.onFrame((dtMs) => {
      const dt = Math.min(dtMs, 50) / 1000;
      if (anim) {
        anim.t += dt;
        if (anim.t >= anim.dur) { const a = anim; anim = null; a.after(); }
      }
      paint();
    });

    ctx.listen(window, "resize", () => {
      if (ctx.width === W && ctx.height === H) return;
      measure();
    });

    /* --- boot --- */
    state.history.push(posKey(state));
    paintHud();

    // A read-only window for the local harness.
    window.__CHESS__ = {
      get fen() { return state.board.join(""); },
      get turn() { return state.turn; },
      get moves() { return moveList.slice(); },
      get over() { return over; },
      get legal() { return legalMoves(state).length; },
      get check() { return inCheck(state, state.turn); },
      get sel() { return selected; },
      get busy() { return anim !== null; },
      squareXY: (name) => {
        const i = NAMES.indexOf(name[0]) + (Number(name[1]) - 1) * 8;
        return { x: sqX(i) + L.sq / 2, y: sqY(i) + L.sq / 2 };
      },
    };
    ctx.onDestroy(() => { try { delete window.__CHESS__; } catch (_) {} });

    paint();
    ctx.markVisualReady("board set");
    ctx.platform.ready();
  },
};
