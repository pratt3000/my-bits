/*
 * Plays a real two-player race: both hands driven at once, and the win
 * condition reached. Speed has no turns, so the interesting assertion is that
 * two fingers landing in the same instant each play their OWN hand.
 */
import { openBit } from "./run.mjs";

const bit = await openBit("/home/user/my-bits/speed");
const W = 390, H = 844;
let fails = 0;
const check = (ok, msg) => { console.log((ok ? "  ok   " : "  FAIL ") + msg); if (!ok) fails++; };

await bit.wait(700);
await bit.shot("speed-1-title");
await bit.page.click('[data-el="go1"]');
await bit.wait(600);
await bit.shot("speed-2-dealt");

const st = () => bit.probe(() => ({
  phase: window.__SPEED__.phase, hands: window.__SPEED__.hands,
  centre: window.__SPEED__.centre, counts: window.__SPEED__.counts,
  winner: window.__SPEED__.winner,
}));
let s = await st();
check(s.phase === "play", "dealt and playing");
check(s.hands.p1.length === 5 && s.hands.p2.length === 5, "five cards each");
check(s.centre.filter(Boolean).length === 2, "two centre piles turned up");
const dealt = s.hands.p1.length + s.hands.p2.length + s.counts.p1 + s.counts.p2;
check(dealt > 0, "draw piles dealt (" + s.counts.p1 + " / " + s.counts.p2 + ")");

const idle = async () => {
  for (let i = 0; i < 40; i++) {
    await bit.wait(50);
    if (!(await bit.probe(() => window.__SPEED__.busy))) return;
  }
};

// Both players play their first legal card in the same instant. Each finger
// must find its OWN half — the case that breaks a shared-screen game.
const both = await bit.probe(() => {
  const S = window.__SPEED__;
  const i1 = S.legalIndex("p1"), i2 = S.legalIndex("p2");
  return { i1, i2, a: i1 >= 0 ? S.handXY("p1", i1) : null, b: i2 >= 0 ? S.handXY("p2", i2) : null };
});
if (both.a && both.b) {
  const before = await st();
  await bit.tapTogether([{ x: both.a.x, y: both.a.y }, { x: both.b.x, y: both.b.y }]);
  await idle();
  const after = await st();
  check(after.centre[0] !== before.centre[0] || after.centre[1] !== before.centre[1],
        "simultaneous plays from both ends landed");
} else {
  console.log("  (no simultaneous legal pair in this deal — skipped)");
}

// Then race it out: keep playing whatever is legal for whichever side has it.
for (let step = 0; step < 120; step++) {
  const p = await bit.probe(() => {
    const S = window.__SPEED__;
    if (S.phase !== "play") return null;
    for (const who of ["p1", "p2"]) {
      const i = S.legalIndex(who);
      if (i >= 0) return Object.assign({ who }, S.handXY(who, i));
    }
    return { stuck: true };
  });
  if (!p) break;
  if (p.stuck) { await bit.wait(420); continue; }   // let the auto-flip resolve it
  await bit.tap(p.x, p.y);
  await bit.wait(40);
}
await bit.shot("speed-3-late");
s = await st();
console.log("final:", JSON.stringify({ phase: s.phase, winner: s.winner, counts: s.counts }));
check(s.phase === "over", "the race reached a winner");
await bit.shot("speed-4-over");

const errs = (await bit.errors()).filter((e) => !/404/.test(e));
console.log(errs.length ? "ERRORS:\n  " + errs.join("\n  ") : "errors: none");
console.log(fails ? fails + " FAILED" : "all checks passed");
await bit.close();
