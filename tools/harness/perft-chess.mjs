/*
 * Perft-tests the chess bit's rules engine.
 *
 * Perft counts every distinct legal move path to a given depth. The numbers
 * are published and exact, so a mismatch pins the bug to a category: a wrong
 * depth-1 count is basic movement, depth 2-3 usually castling rights or the
 * en-passant square, depth 4+ almost always the en-passant discovered-check
 * case. It is the difference between "the rules look right" and "the rules
 * are right".
 *
 * The engine is lifted straight out of main.js between its markers, so this
 * tests the shipped code rather than a copy that can drift.
 */
import { readFileSync } from "node:fs";

const src = readFileSync("/home/user/my-bits/chess/main.js", "utf8");
const body = src.split("/* ===== ENGINE START ===== */")[1].split("/* ===== ENGINE END ===== */")[0];
const engine = new Function(body + "\nreturn { startPosition, legalMoves, make, unmake, inCheck, sqName, fileOf, rankOf, sq, attacked, findKing };")();

function fromFen(fen) {
  const s = engine.startPosition();
  const [placement, turn, castling, ep] = fen.split(" ");
  s.board = new Array(64).fill(0);
  let r = 7, f = 0;
  for (const ch of placement) {
    if (ch === "/") { r--; f = 0; }
    else if (/\d/.test(ch)) f += Number(ch);
    else { s.board[r * 8 + f] = ch; f++; }
  }
  s.turn = turn;
  s.castling = { K: castling.includes("K"), Q: castling.includes("Q"),
                 k: castling.includes("k"), q: castling.includes("q") };
  s.ep = ep && ep !== "-" ? "abcdefgh".indexOf(ep[0]) + (Number(ep[1]) - 1) * 8 : null;
  return s;
}

function perft(s, depth) {
  if (depth === 0) return 1;
  let n = 0;
  for (const m of engine.legalMoves(s)) {
    const u = engine.make(s, m);
    n += perft(s, depth - 1);
    engine.unmake(s, u);
  }
  return n;
}

// Published counts. Kiwipete and position 3-5 are the standard traps for
// castling rights, en passant, and promotion.
const CASES = [
  ["start",     "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -",            [20, 400, 8902, 197281]],
  ["kiwipete",  "r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq -", [48, 2039, 97862]],
  ["position3", "8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - -",                            [14, 191, 2812, 43238]],
  ["position4", "r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq -",     [6, 264, 9467]],
  ["position5", "rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ -",            [44, 1486, 62379]],
  ["position6", "r4rk1/1pp1qppp/p1np1n2/2b1p1B1/2B1P1b1/P1NP1N2/1PP1QPPP/R4RK1 w - -", [46, 2079]],
];

let bad = 0;
for (const [name, fen, want] of CASES) {
  for (let d = 0; d < want.length; d++) {
    const got = perft(fromFen(fen), d + 1);
    const ok = got === want[d];
    if (!ok) bad++;
    console.log(`${ok ? "✓" : "✗"} ${name} depth ${d + 1}: ${got}${ok ? "" : `  EXPECTED ${want[d]}`}`);
  }
}
console.log(bad ? `\n${bad} MISMATCH(ES)` : "\nall perft counts exact");
process.exit(bad ? 1 : 0);
