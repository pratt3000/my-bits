/*
 * Plays a full three-player round: three handovers to write a lie, three more
 * to vote, then the reveal. Asserts the scoring is what the rules say.
 */
import { openBit } from "./run.mjs";

const bit = await openBit("/home/user/my-bits/bluffin");
await bit.wait(800);
await bit.shot("bluffin-1-title");

const click = async (sel) => { await bit.page.click(sel); await bit.wait(220); };
const st = () => bit.probe(() => ({
  phase: window.__BLUFFIN__.phase, cursor: window.__BLUFFIN__.cursor,
  scores: window.__BLUFFIN__.scores, truth: window.__BLUFFIN__.truth,
  board: window.__BLUFFIN__.board, lies: window.__BLUFFIN__.lies,
}));

await click('[data-el="pc"] button[data-v="3"]');      // three players
await click('[data-el="rc"] button[data-v="3"]');      // three rounds
await click('[data-el="go"]');
await bit.wait(400);
await bit.shot("bluffin-2-handoff");

const LIES = ["a rubber duck", "seventeen goats", "the mayor's hat"];
for (let i = 0; i < 3; i++) {
  await click('[data-el="hold"]');                     // reveal my screen
  if (i === 0) await bit.shot("bluffin-3-write");
  await bit.page.fill('[data-el="lie"]', LIES[i]);
  await click('[data-el="done"]');
}

let s = await st();
console.log("after writing — phase:", s.phase, "| board size:", s.board.length, "| lies:", JSON.stringify(s.lies));

// Everyone votes. Player 0 finds the truth; the others take player 0's lie,
// which should pay player 0 twice over.
const truthIdx = s.board.findIndex((b) => b.by === -1);
const p0Lie = s.board.findIndex((b) => b.by === 0);
const votes = [truthIdx, p0Lie, p0Lie];
for (let i = 0; i < 3; i++) {
  await click('[data-el="hold"]');
  if (i === 0) await bit.shot("bluffin-4-pick");
  await click('[data-el="opt-' + votes[i] + '"]');
}
await bit.wait(400);
await bit.shot("bluffin-5-reveal");

s = await st();
console.log("scores:", JSON.stringify(s.scores), "| truth was:", JSON.stringify(s.truth));
// p0: 1000 for the truth + 500 x2 for catching both others = 2000. p1, p2: 0.
const ok = s.scores[0] === 2000 && s.scores[1] === 0 && s.scores[2] === 0;
console.log(ok ? "PASS — scoring matches the rules" : "FAIL — expected [2000,0,0]");

const errs = (await bit.errors()).filter((e) => !/404/.test(e));
console.log(errs.length ? "ERRORS:\n  " + errs.join("\n  ") : "errors: none");
await bit.close();
process.exit(ok ? 0 : 1);
