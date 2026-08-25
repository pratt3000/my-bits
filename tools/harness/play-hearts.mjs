/*
 * Plays Hearts for real: four handovers to pass, then 52 handovers and 52
 * cards, hand after hand, until somebody actually crosses the target and the
 * result sheet appears.
 *
 * Every tap is a real touch through CDP — no state is poked directly — and the
 * script polls the bit's `busy` flag instead of sleeping, because a move
 * commits its state change immediately and THEN animates, so a script that
 * waits on the state taps into a board that is still animating and the input is
 * silently dropped.
 *
 * Seat 0 always plays its highest legal card and everybody else their lowest,
 * which funnels tricks (and therefore points) onto one seat and gets the game
 * to a real end state in a couple of hands.
 */
import { openBit } from "./run.mjs";

const ORDER = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"];
const rankOf = (id) => ORDER.indexOf(id.slice(0, id.length - 1));
const TARGET = 50;
const MAX_HANDS = 8;

const bit = await openBit("/home/user/my-bits/hearts");
await bit.wait(700);
const shots = [];
const shot = async (n) => { shots.push(await bit.shot(n)); };
await shot("hearts-1-title");

const st = () => bit.probe(() => {
  const h = window.__HEARTS__;
  return {
    phase: h.phase, busy: h.busy, view: h.view, turn: h.turn, handNo: h.handNo,
    trickNo: h.trickNo, passDir: h.passDir, passSeat: h.passSeat,
    broken: h.heartsBroken, totals: h.totals, names: h.names, handPts: h.handPts,
    trick: h.trick, lastTrick: h.lastTrick, result: h.result, selected: h.selected,
    hand: h.hand(h.phase === "passing" ? h.passSeat : h.view),
    legal: h.phase === "turn" && h.turn >= 0 ? h.legal(h.turn) : [],
  };
});
const tapXY = (i) => bit.probe((n) => window.__HEARTS__.tapXY(n), i);

/** Wait for the bit to stop animating, then return its state. */
async function settle(label) {
  for (let i = 0; i < 220; i++) {
    const s = await st();
    if (!s.busy) return s;
    await bit.wait(28);
  }
  throw new Error("stuck busy at " + label);
}
const tapCard = async (i) => { const p = await tapXY(i); await bit.tap(p.x, p.y); };
const tapTable = () => bit.tap(195, 300);

/* ---- set up a fifty-point game -------------------------------------- */
await bit.page.click('[data-el="tc"] button[data-v="' + TARGET + '"]');
await bit.wait(120);
await bit.page.click('[data-el="go"]');
await bit.wait(420);
await shot("hearts-2-pass-gate");

let taps = 0, moons = 0, queenSeen = null, firstTrickPoints = 0;
let s = await settle("deal");
if (s.phase !== "passGate") throw new Error("expected a pass handover, got " + s.phase);
console.log("hand 1 passes " + s.passDir + "; names " + JSON.stringify(s.names));

for (let hand = 1; hand <= MAX_HANDS; hand++) {
  /* ---- the passing round ------------------------------------------- */
  while (true) {
    s = await settle("pass");
    if (s.phase !== "passGate" && s.phase !== "passing") break;
    if (s.phase === "passGate") {
      await tapTable(); taps++;
      s = await settle("reveal-pass");
      if (s.handNo === 1 && s.passSeat === 0) await shot("hearts-3-passing");
    }
    // Three cards from the top of the hand — hearts and high spades sort last.
    for (const i of [s.hand.length - 1, s.hand.length - 2, s.hand.length - 3]) {
      await tapCard(i); taps++;
    }
    const picked = (await st()).selected;
    if (picked.length !== 3) throw new Error("expected 3 selected, got " + picked.length);
    await bit.page.click('[data-el="passbtn"]');
    taps++;
  }

  /* ---- thirteen tricks --------------------------------------------- */
  let guard = 0;
  while (s.phase !== "handEnd" && guard++ < 400) {
    if (s.phase === "gate") {
      await tapTable(); taps++;
      s = await settle("reveal-turn");
      if (s.trickNo === 0 && s.trick.length === 0) {
        // The opening LEAD is forced; the three seats following it are not.
        if (s.legal.length !== 1 || s.legal[0] !== "2C") {
          throw new Error("the opening lead should be forced to 2C, got " + JSON.stringify(s.legal));
        }
        if (hand === 1) await shot("hearts-4-first-lead");
      }
      continue;
    }
    if (s.phase === "turn") {
      if (!s.legal.length) throw new Error("a seat was offered no legal card");
      // Sanity, live, against the two rules that make Hearts awkward.
      if (s.trickNo === 0) {
        for (const id of s.legal) {
          if (id[id.length - 1] === "H" || id === "QS") {
            const onlyPoints = s.hand.every(
              (c) => c[c.length - 1] === "H" || c === "QS");
            if (!onlyPoints) throw new Error("points offered on the first trick: " + id);
          }
        }
      }
      if (!s.broken && !s.trick.length && s.trickNo > 0) {
        const hasOther = s.hand.some((c) => c[c.length - 1] !== "H");
        if (hasOther && s.legal.some((c) => c[c.length - 1] === "H")) {
          throw new Error("a heart was offered as a lead before hearts broke");
        }
      }
      const high = s.turn === 0;
      let want = s.legal[0];
      for (const id of s.legal) {
        if (high ? rankOf(id) > rankOf(want) : rankOf(id) < rankOf(want)) want = id;
      }
      const i = s.hand.indexOf(want);
      if (i < 0) throw new Error("a legal card is not in the hand: " + want);
      if (s.trickNo === 0) firstTrickPoints += (want[want.length - 1] === "H" || want === "QS") ? 1 : 0;
      if (want === "QS") queenSeen = { hand, trick: s.trickNo, seat: s.turn };
      await tapCard(i); taps++;
      s = await settle("play");
      if (want === "QS" && !shots.some((p) => p.indexOf("queen") >= 0)) {
        await shot("hearts-5-queen");
      }
      continue;
    }
    if (s.phase === "trickEnd") {
      if (hand === 1 && s.trickNo === 1) await shot("hearts-6-trick-taken");
      await tapTable(); taps++;
      s = await settle("gather");
      continue;
    }
    s = await settle("loop");
  }
  if (s.phase !== "handEnd") throw new Error("hand " + hand + " never finished (phase " + s.phase + ")");

  const pts = s.handPts;
  const sum = pts.reduce((a, b) => a + b, 0);
  if (sum !== 26) throw new Error("hand " + hand + " took " + sum + " points, not 26");
  if (pts.some((p) => p === 26)) moons++;
  console.log("hand " + hand + " raw points " + JSON.stringify(pts) +
              " -> totals " + JSON.stringify(s.totals) +
              (pts.some((p) => p === 26) ? "  (MOON)" : ""));
  if (hand === 1) await shot("hearts-7-hand-scored");

  await bit.page.click('[data-el="he-next"]');
  await bit.wait(400);
  s = await settle("after hand");
  if (s.phase === "over") break;
}

/* ---- the result ------------------------------------------------------ */
s = await st();
await shot("hearts-8-result");
const errs = (await bit.errors()).filter((e) => !/404/.test(e));
const submitted = (await bit.events()).filter((e) => e.kind === "memory.record.submit");

const low = Math.min.apply(null, s.totals);
const ok =
  s.phase === "over" &&
  !!s.result &&
  s.totals.some((t) => t >= TARGET) &&
  s.result.low === low &&
  s.result.winners.every((i) => s.totals[i] === low) &&
  submitted.length === 1 &&
  submitted[0].args[1] === low &&
  firstTrickPoints === 0 &&
  errs.length === 0;

console.log("\nphase       " + s.phase);
console.log("totals      " + JSON.stringify(s.totals) + "  (target " + TARGET + ")");
console.log("winner      " + s.result.winners.map((i) => s.names[i]).join(" & ") +
            " on " + s.result.low);
console.log("queen       " + (queenSeen
  ? "played hand " + queenSeen.hand + ", trick " + (queenSeen.trick + 1) + ", by " + s.names[queenSeen.seat]
  : "never appeared"));
console.log("moons       " + moons);
console.log("first-trick points ever played: " + firstTrickPoints);
console.log("leaderboard " + JSON.stringify(submitted.map((e) => e.args.slice(0, 2))));
console.log("taps        " + taps);
console.log("shots\n  " + shots.join("\n  "));
console.log(errs.length ? "ERRORS:\n  " + errs.join("\n  ") : "errors: none");
console.log(ok ? "\nPASS — a real game reached a real end state" : "\nFAIL");

await bit.close();
process.exit(ok ? 0 : 1);
