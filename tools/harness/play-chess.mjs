/*
 * Plays Scholar's Mate through the real UI — taps only, no reaching into
 * state — and asserts the bit detects the checkmate itself.
 * 1. e4 e5  2. Bc4 Nc6  3. Qh5 Nf6??  4. Qxf7#
 */
import { openBit } from "./run.mjs";

const bit = await openBit("/home/user/my-bits/chess");
await bit.wait(900);

const at = (name) => bit.probe((n) => window.__CHESS__.squareXY(n), name);
async function move(from, to) {
  const a = await at(from), b = await at(to);
  await bit.tap(a.x, a.y);
  await bit.wait(120);
  await bit.tap(b.x, b.y);
  // Wait for the piece to LAND, not for the move to be recorded. The move
  // list grows the instant a move commits, while the slide is still running
  // and the board is still rejecting input — waiting on the list taps into a
  // busy board and the move is silently dropped.
  for (let i = 0; i < 60; i++) {
    await bit.wait(60);
    if (!(await bit.probe(() => window.__CHESS__.busy))) break;
  }
}

const GAME = [["e2","e4"],["e7","e5"],["f1","c4"],["b8","c6"],
              ["d1","h5"],["g8","f6"],["h5","f7"]];
for (const [f, t] of GAME) await move(f, t);
await bit.wait(400);
await bit.shot("chess-mate");

const st = await bit.probe(() => ({
  moves: window.__CHESS__.moves,
  over: window.__CHESS__.over,
  turn: window.__CHESS__.turn,
  legal: window.__CHESS__.legal,
  check: window.__CHESS__.check,
}));
console.log("moves:  ", st.moves.join(" "));
console.log("over:   ", st.over, "| turn:", st.turn, "| legal moves:", st.legal, "| in check:", st.check);

const ok = st.moves.join(" ") === "e4 e5 Bc4 Nc6 Qh5 Nf6 Qxf7#" && st.over === "w" && st.legal === 0;
console.log(ok ? "PASS — scholar's mate played and detected" : "FAIL");

const errs = (await bit.errors()).filter(e => !/404/.test(e));
console.log(errs.length ? "ERRORS:\n  " + errs.join("\n  ") : "errors: none");
await bit.close();
process.exit(ok ? 0 : 1);
