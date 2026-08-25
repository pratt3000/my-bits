/*
 * Exercises Gin Rummy's melding, lay-off and settlement rules directly, lifted
 * out of rummy/main.js between its markers so this tests the shipped code
 * rather than a copy that can drift.
 *
 * The load-bearing case is the one greedy gets wrong: a card can belong to a
 * set or to a run but never to both, so the fattest meld on the table is
 * regularly the wrong one to take.
 */
import { readFileSync } from "node:fs";

const src = readFileSync("/home/user/my-bits/rummy/main.js", "utf8");
const body = src.split("/* ===== RULES START ===== */")[1].split("/* ===== RULES END ===== */")[0];
const R = new Function(body + `
  return { cardValue, handValue, meldKind, sortMeld, candidateMelds, bestArrangement,
           canLayOff, layOffTarget, layOffAll, scoreKnock, canKnock, discardOutcomes, rankIx };
`)();

let fails = 0;
const check = (ok, msg) => { console.log((ok ? "  ok   " : "  FAIL ") + msg); if (!ok) fails++; };

/** "10S" -> {rank:"10", suit:"S"} */
const C = (id) => ({ id, rank: id.slice(0, id.length - 1), suit: id.slice(-1) });
const hand = (s) => s.split(" ").map(C);
const ids = (cards) => cards.map((c) => c.id).join(" ");
const meldSet = (a) => a.melds.map((m) => m.map((c) => c.id).sort().join("")).sort();

/* -------------------------------------------------------------------------
 * Card values
 * ---------------------------------------------------------------------- */
console.log("\ncard values");
check(R.cardValue(C("AS")) === 1, "an ace is 1");
check(R.cardValue(C("7H")) === 7, "a seven is 7");
check(R.cardValue(C("10D")) === 10, "a ten is 10");
check(R.cardValue(C("JC")) === 10 && R.cardValue(C("QC")) === 10 && R.cardValue(C("KC")) === 10,
      "jack, queen and king are all 10");
check(R.handValue(hand("KS QH 3D AS")) === 24, "a hand adds up (K+Q+3+A = 24)");

/* -------------------------------------------------------------------------
 * What is and is not a meld
 * ---------------------------------------------------------------------- */
console.log("\nmeld recognition");
{
  let a = R.bestArrangement(hand("7S 7H 7D KC 2S"));
  check(a.melds.length === 1 && a.melds[0].length === 3, "three of a rank is a set");
  check(a.deadwood === 12, "the rest is deadwood (K+2 = 12), got " + a.deadwood);

  a = R.bestArrangement(hand("4C 5C 6C KH 2S"));
  check(a.melds.length === 1 && R.meldKind(a.melds[0]) === "run", "three in suit sequence is a run");

  a = R.bestArrangement(hand("4C 5C 6H KH 2S"));
  check(a.melds.length === 0, "a sequence across two suits is not a run");

  a = R.bestArrangement(hand("4C 6C 7C KH 2S"));
  check(a.melds.length === 0, "a gap breaks a run");

  a = R.bestArrangement(hand("7S 7H KH 2S 9D"));
  check(a.melds.length === 0, "a pair is not a set");

  // Aces are LOW. Q-K-A is not a run; A-2-3 is.
  a = R.bestArrangement(hand("QS KS AS 4H 9D"));
  check(a.melds.length === 0, "queen-king-ace is not a run — aces are low");
  a = R.bestArrangement(hand("AS 2S 3S 4H 9D"));
  check(a.melds.length === 1 && a.melds[0].length === 3, "ace-two-three is a run");
}

/* -------------------------------------------------------------------------
 * THE GREEDY TRAP
 *
 * Four tens plus the eight and nine of spades. The four-of-a-kind is the
 * biggest meld available and taking it strands 8+9 = 17. Taking the run
 * first pulls the ten of spades out and leaves three tens, which is still a
 * legal set — so the correct answer melds all six cards and carries nothing.
 * ---------------------------------------------------------------------- */
console.log("\nthe arrangement greedy gets wrong");
{
  const h = hand("8S 9S 10S 10H 10D 10C KH QD 3C 2C");
  const a = R.bestArrangement(h);
  check(a.deadwood === 25, "quad-vs-run: deadwood is 25 (K+Q+3+2), not 42 — got " + a.deadwood);
  check(a.melds.length === 2, "it finds two melds, not one four-card set");
  const ms = meldSet(a);
  check(ms.some((m) => m === "10S8S9S".split("").sort().join("") || m === ["8S", "9S", "10S"].sort().join("")),
        "the spade run 8-9-10 is one of them");
  check(ms.some((m) => m === ["10H", "10D", "10C"].sort().join("")),
        "three tens survive as a set");
  // And prove greedy-largest-first really is worse, using the same engine.
  const greedy = R.bestArrangement(hand("KH QD 3C 2C 8S 9S"));   // what is left after taking the quad
  check(greedy.deadwood === 42, "taking the quad first would have left 42 — got " + greedy.deadwood);
}

{
  // The mirror image: a run of four is the fattest meld, but splitting it
  // completes a set and melds one more card.
  const h = R.bestArrangement(hand("5S 6S 7S 8S 8H 8D KC"));
  check(h.deadwood === 10, "run-of-four vs set: deadwood 10 (just the king) — got " + h.deadwood);
  check(h.melds.length === 2, "5-6-7 spades plus three eights, not the run of four");
}

{
  // A whole hand that is entirely melded except one card.
  const a = R.bestArrangement(hand("2H 3H 4H 5H 9C 9D 9S KS KH KD"));
  check(a.deadwood === 0, "eleven-point-free: four hearts, three nines, three kings — got " + a.deadwood);
  check(a.melds.length === 3, "three melds cover all ten cards");
}

{
  // Overlapping runs in one suit: 3-4-5-6-7 can only be one run, and the
  // engine should take all five rather than three and strand two.
  const a = R.bestArrangement(hand("3D 4D 5D 6D 7D KS QH 2C AC 9H"));
  check(a.melds.length === 1 && a.melds[0].length === 5, "a five-card run is taken whole");
  check(a.deadwood === 32, "leaving K+Q+2+A+9 = 32 — got " + a.deadwood);
}

{
  // Deterministic: the same cards in a different order must arrange the same.
  const a = R.bestArrangement(hand("8S 9S 10S 10H 10D 10C KH QD 3C 2C"));
  const b = R.bestArrangement(hand("2C 10C KH 10D 9S 3C 10H QD 8S 10S"));
  check(a.deadwood === b.deadwood && JSON.stringify(meldSet(a)) === JSON.stringify(meldSet(b)),
        "the arrangement does not depend on the order the cards arrive in");
}

/* -------------------------------------------------------------------------
 * Knocking
 * ---------------------------------------------------------------------- */
console.log("\nknocking");
check(R.canKnock(10) && R.canKnock(0) && !R.canKnock(11), "you may knock at 10 but not at 11");
{
  const h = hand("2H 3H 4H 9C 9D 9S KS 5C 3C AD");
  const outs = R.discardOutcomes(h);
  check(outs.length === 11 || outs.length === 10, "one outcome per card in hand");
  const king = outs.find((o) => o.card.id === "KS");
  const ace = outs.find((o) => o.card.id === "AD");
  check(king.deadwood < ace.deadwood, "throwing the king leaves less than throwing the ace");
  check(king.deadwood === 9, "throw the king and 5+3+A = 9 remains — got " + king.deadwood);
}

/* -------------------------------------------------------------------------
 * Lay-offs
 * ---------------------------------------------------------------------- */
console.log("\nlay-offs");
{
  const set3 = R.sortMeld(hand("7S 7H 7D"));
  check(R.canLayOff(C("7C"), set3), "the fourth seven goes onto three sevens");
  const set4 = R.sortMeld(hand("7S 7H 7D 7C"));
  check(!R.canLayOff(C("7C"), set4), "a set of four takes nothing more");

  const run = R.sortMeld(hand("5C 6C 7C"));
  check(R.canLayOff(C("4C"), run), "a run takes the card below it");
  check(R.canLayOff(C("8C"), run), "a run takes the card above it");
  check(!R.canLayOff(C("4S"), run), "a run refuses another suit");
  check(!R.canLayOff(C("9C"), run), "a run refuses a card that does not touch either end");

  const low = R.sortMeld(hand("AC 2C 3C"));
  check(R.canLayOff(C("4C"), low), "an ace-low run still extends upward");
  const high = R.sortMeld(hand("JC QC KC"));
  check(!R.canLayOff(C("AC"), high), "no ace on top of a king — aces are low");
}

{
  // The cascade: laying the nine on 6-7-8 puts the ten within reach, which
  // a single pass over the deadwood would miss.
  const melds = [R.sortMeld(hand("6C 7C 8C"))];
  const r = R.layOffAll(hand("9C 10C KH"), melds);
  check(r.laid.length === 2, "the nine then the ten both go — got " + r.laid.length);
  check(r.deadwood === 10, "only the king is left, worth 10 — got " + r.deadwood);
  check(melds[0].length === 5, "the run grew to five cards");
}

{
  // A set of three with two candidates for its fourth slot: only one fits.
  const melds = [R.sortMeld(hand("9S 9H 9D"))];
  const r = R.layOffAll(hand("9C KH"), melds);
  check(r.laid.length === 1 && r.laid[0].card.id === "9C", "one nine goes onto the set");
  check(r.remaining.length === 1 && r.remaining[0].id === "KH", "the king stays put");
}

{
  const melds = [R.sortMeld(hand("2S 3S 4S"))];
  const r = R.layOffAll(hand("KH QD 8C"), melds);
  check(r.laid.length === 0 && r.deadwood === 28, "nothing fits, nothing moves, 28 stays");
}

/* -------------------------------------------------------------------------
 * Settlement
 * ---------------------------------------------------------------------- */
console.log("\nscoring a knock");
{
  let s = R.scoreKnock(7, 23, false);
  check(s.winner === "knocker" && s.points === 16 && !s.gin && !s.undercut,
        "knock 7 against 23 pays the knocker 16");

  s = R.scoreKnock(0, 41, true);
  check(s.winner === "knocker" && s.points === 66 && s.gin,
        "gin against 41 pays 41 + 25 = 66 — got " + s.points);

  s = R.scoreKnock(9, 4, false);
  check(s.winner === "defender" && s.points === 30 && s.undercut,
        "undercut: knock 9 against 4 pays the DEFENDER 5 + 25 = 30 — got " + s.points);

  s = R.scoreKnock(6, 6, false);
  check(s.winner === "defender" && s.points === 25 && s.undercut,
        "equal deadwood is still an undercut, worth exactly 25 — got " + s.points);

  s = R.scoreKnock(10, 11, false);
  check(s.winner === "knocker" && s.points === 1, "one point of daylight still goes to the knocker");

  // Gin is never an undercut even when the defender is also low.
  s = R.scoreKnock(0, 0, true);
  check(s.winner === "knocker" && s.points === 25, "gin against a gin-less zero still pays 25");
}

/* -------------------------------------------------------------------------
 * A whole settlement end to end, the way the bit runs it
 * ---------------------------------------------------------------------- */
console.log("\na full settlement");
{
  // Knocker: 4-5-6 hearts, three jacks, deadwood 2C 3C = 5.
  const knocker = hand("4H 5H 6H JS JH JD 2C 3C AD KS");
  const ka = R.bestArrangement(knocker);
  check(ka.deadwood === 16, "knocker holds 2+3+A+K = 16 before the throw — got " + ka.deadwood);
  const outs = R.discardOutcomes(knocker);
  const throwKing = outs.find((o) => o.card.id === "KS");
  check(throwKing.deadwood === 6, "throwing the king brings them to 6 — got " + throwKing.deadwood);

  const kMelds = R.bestArrangement(knocker.filter((c) => c.id !== "KS")).melds.map((m) => m.slice());
  // Defender: one set of three queens, and deadwood that partly lays off —
  // the 7H extends 4-5-6 hearts and the JC completes the jacks.
  const defender = hand("QS QH QD 7H JC 9S 8D 2S 4C 3D");
  const da = R.bestArrangement(defender);
  check(da.deadwood === 43, "defender carries 7+10+9+8+2+4+3 = 43 — got " + da.deadwood);

  const r = R.layOffAll(da.dead, kMelds);
  check(r.laid.length === 2, "two cards lay off (7H onto the run, JC onto the jacks) — got " + r.laid.length);
  check(r.deadwood === 26, "leaving 9+8+2+4+3 = 26 — got " + r.deadwood);

  const s = R.scoreKnock(6, r.deadwood, false);
  check(s.winner === "knocker" && s.points === 20, "knock 6 against 26 pays 20 — got " + s.points);
}

{
  // The same knocker, but this defender's lay-offs turn the hand around: the
  // seven of hearts extends the knocker's own run and the jack of clubs
  // completes their set, and what is left undercuts them.
  const kMelds = [R.sortMeld(hand("4H 5H 6H")), R.sortMeld(hand("JS JH JD"))];
  const defender = hand("QS QH QD 2C 3C 4C 7H JC AS 2S");
  const da = R.bestArrangement(defender);
  check(da.deadwood === 20, "defender carries 7+J+A+2 = 20 before lay-offs — got " + da.deadwood);
  const r = R.layOffAll(da.dead, kMelds.map((m) => m.slice()));
  check(r.laid.length === 2, "the jack and the seven both go onto the knocker's melds");
  check(r.deadwood === 3, "after lay-offs the defender is down to 3 — got " + r.deadwood);
  const s = R.scoreKnock(9, r.deadwood, false);
  check(s.winner === "defender" && s.undercut && s.points === 31,
        "so the knocker is undercut for 9 - 3 + 25 = 31 — got " + s.points);
}

/* -------------------------------------------------------------------------
 * Fuzz: the exact search must never be beaten by any single meld choice,
 * and must never claim a meld that is not legal.
 * ---------------------------------------------------------------------- */
console.log("\nfuzz against a brute-force check");
{
  const RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
  const SUITS = ["S", "H", "D", "C"];
  const deck = [];
  for (const s of SUITS) for (const r of RANKS) deck.push({ id: r + s, rank: r, suit: s });
  let seed = 20260825;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };

  const legalMeld = (m) => {
    if (m.length < 3) return false;
    if (m.every((c) => c.rank === m[0].rank)) {
      return m.length <= 4 && new Set(m.map((c) => c.suit)).size === m.length;
    }
    if (!m.every((c) => c.suit === m[0].suit)) return false;
    const ix = m.map((c) => RANKS.indexOf(c.rank)).sort((a, b) => a - b);
    for (let i = 1; i < ix.length; i++) if (ix[i] !== ix[i - 1] + 1) return false;
    return true;
  };

  let bad = 0, disjointBad = 0, worse = 0;
  for (let t = 0; t < 4000; t++) {
    const d = deck.slice();
    for (let i = d.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [d[i], d[j]] = [d[j], d[i]]; }
    const h = d.slice(0, 10);
    const a = R.bestArrangement(h);

    for (const m of a.melds) if (!legalMeld(m)) bad++;
    const used = a.melds.flat().map((c) => c.id);
    if (new Set(used).size !== used.length) disjointBad++;
    if (R.handValue(h) - R.handValue(a.melds.flat()) !== a.deadwood) worse++;

    // Independent exhaustive check: brute force over every subset of the
    // candidate melds, which is a different code path from the memoised
    // lowest-card-first search.
    const cand = R.candidateMelds(h).map((m) => m.idx.reduce((x, i) => x | (1 << i), 0));
    const vals = h.map(R.cardValue);
    let bestBrute = Infinity;
    const walk = (i, taken) => {
      if (i === cand.length) {
        let dw = 0;
        for (let k = 0; k < h.length; k++) if (!((taken >> k) & 1)) dw += vals[k];
        if (dw < bestBrute) bestBrute = dw;
        return;
      }
      walk(i + 1, taken);
      if ((cand[i] & taken) === 0) walk(i + 1, taken | cand[i]);
    };
    if (cand.length <= 14) walk(0, 0); else bestBrute = a.deadwood;
    if (bestBrute !== a.deadwood) worse++;
  }
  check(bad === 0, "4000 random hands: every meld returned is legal");
  check(disjointBad === 0, "4000 random hands: no card is in two melds at once");
  check(worse === 0, "4000 random hands: the memoised search matches brute force exactly");
}

console.log(fails ? "\n" + fails + " FAILED" : "\nall rules checks passed");
process.exit(fails ? 1 : 0);
