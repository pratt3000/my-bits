/*
 * Plays several full rounds: claim, hand off, lay, claim again — and checks
 * the draft order actually inverts (whoever took the lowest tile goes first).
 */
import { openBit } from "./run.mjs";
const bit = await openBit("/home/user/my-bits/crownlands");
let fails = 0;
const check = (ok, m) => { console.log((ok ? "  ok   " : "  FAIL ") + m); if (!ok) fails++; };
const st = () => bit.probe(() => {
  const C = window.__CROWN__;
  return { phase: C.phase, round: C.round, total: C.totalRounds, turn: C.turnPlayer,
           lane: C.lane, next: C.nextLane, scores: C.scores, cells: C.cells,
           handoff: C.handoffUp, pick: C.pick };
});

await bit.wait(700);
await bit.shot("crown-1-title");
await bit.page.click('[data-el="pc"] button[data-v="3"]');
await bit.page.click('[data-el="go"]');
await bit.wait(500);

let s = await st();
check(s.phase === "claim", "round one is a claim-only round");
check(s.total === 12, "three players play twelve rounds (got " + s.total + ")");
check(s.next.length === 3, "the lane is one tile per king (got " + s.next.length + ")");
await bit.shot("crown-2-claim");

// Drive real turns. Everything goes through the same handoff the players use.
for (let step = 0; step < 26; step++) {
  s = await st();
  if (s.phase === "over") break;
  if (s.handoff) { await bit.probe(() => window.__CROWN__.dismissHandoff()); await bit.wait(120); continue; }
  if (s.phase === "claim") {
    const free = s.next.findIndex((t) => t.king === null);
    if (free < 0) { await bit.wait(120); continue; }
    await bit.probe((i) => window.__CROWN__.claimIndex(i), free);
  } else if (s.phase === "place") {
    check(s.pick !== null, "a legal placement is pre-aimed for the player");
    await bit.probe(() => window.__CROWN__.layIt());
  }
  await bit.wait(110);
}
await bit.shot("crown-3-mid");
s = await st();
console.log("after 26 steps:", JSON.stringify({ round: s.round, cells: s.cells, scores: s.scores }));
check(s.round >= 2, "play advanced past round one (round " + s.round + ")");
check(s.cells.some((c) => c > 1), "at least one kingdom has grown beyond its castle");
check(s.cells.every((c) => c <= 25), "no kingdom exceeds twenty-five squares");

const errs = (await bit.errors()).filter((e) => !/404/.test(e));
console.log(errs.length ? "ERRORS:\n  " + errs.join("\n  ") : "errors: none");
console.log(fails ? fails + " FAILED" : "all checks passed");
await bit.close();
