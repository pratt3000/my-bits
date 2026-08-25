/*
 * Exercises Hearts' rules directly, lifted out of main.js between its markers
 * so this tests the shipped code rather than a copy that can drift.
 *
 * Card rules are exactly the kind of thing that looks right in a screenshot and
 * is wrong: the first-trick ban on points, the ban on LEADING hearts before
 * they are broken, the two "unless that is all you hold" escapes, and the moon.
 */
import { readFileSync } from "node:fs";

const src = readFileSync("/home/user/my-bits/hearts/main.js", "utf8");
const body = src.split("/* ===== RULES START ===== */")[1].split("/* ===== RULES END ===== */")[0];
const R = new Function(body + `
  return { cardPoints, passDirFor, passTarget, newHand, openingLeader, legalMoves,
           isLegal, trickWinner, playCard, scoreHand, gameResult, rankOf,
           ORDER, QUEEN_OF_SPADES, TWO_OF_CLUBS };`)();

let fails = 0;
const check = (ok, msg) => { console.log((ok ? "  ok   " : "  FAIL ") + msg); if (!ok) fails++; };
const C = (id) => ({ id, rank: id.slice(0, id.length - 1), suit: id.slice(-1) });
const ids = (list) => list.map((c) => c.id).sort().join(" ");
const H = (...list) => list.map(C);

/* ---- card values --------------------------------------------------- */
console.log("\npoints");
check(R.cardPoints(C("2H")) === 1 && R.cardPoints(C("AH")) === 1, "every heart is worth one");
check(R.cardPoints(C("QS")) === 13, "the queen of spades is worth thirteen");
check(R.cardPoints(C("QH")) === 1, "the queen of HEARTS is worth one, not thirteen");
check(R.cardPoints(C("QD")) === 0 && R.cardPoints(C("KS")) === 0 && R.cardPoints(C("AS")) === 0,
      "no other queen and no other spade scores");
{
  // The whole deck must come to exactly 26, or the moon is unreachable.
  let total = 0;
  for (const s of ["C", "D", "S", "H"]) for (const r of R.ORDER) total += R.cardPoints(C(r + s));
  check(total === 26, "the deck holds exactly 26 points (got " + total + ")");
}

/* ---- passing rotation ---------------------------------------------- */
console.log("\npassing");
check(["left", "right", "across", "hold"].every((d, i) => R.passDirFor(i + 1) === d),
      "hands 1-4 pass left, right, across, then not at all");
check(R.passDirFor(5) === "left" && R.passDirFor(8) === "hold", "and the cycle repeats");
check(R.passTarget(0, "left") === 1 && R.passTarget(3, "left") === 0, "left is the next seat round");
check(R.passTarget(0, "right") === 3 && R.passTarget(1, "right") === 0, "right is the previous seat");
check(R.passTarget(0, "across") === 2 && R.passTarget(3, "across") === 1, "across is two seats over");
check(R.passTarget(2, "hold") === 2, "a hold hand passes to yourself");

/* ---- who leads, and with what -------------------------------------- */
console.log("\nthe opening lead");
function table(h0, h1, h2, h3) {
  const st = R.newHand([h0, h1, h2, h3], 1);
  st.leader = R.openingLeader(st);
  st.turn = st.leader;
  return st;
}
{
  const st = table(H("3C", "4D"), H("2C", "5H"), H("6S", "7D"), H("8C", "9H"));
  check(R.openingLeader(st) === 1, "the two of clubs decides who leads");
  check(ids(R.legalMoves(st, 1)) === "2C", "and that player may lead NOTHING but the two of clubs");
}

/* ---- following suit ------------------------------------------------- */
console.log("\nfollowing suit");
{
  const st = table(H("3C", "9C", "4D", "KH"), H("2C"), H("5C", "AD"), H("7D", "8H"));
  R.playCard(st, 1, "2C");
  check(st.turn === 2, "play moves to the next seat round");
  check(ids(R.legalMoves(st, 2)) === "5C", "holding a club, you must play the club");
  R.playCard(st, 2, "5C");
  check(ids(R.legalMoves(st, 3)) === "7D", "void in clubs on the first trick: only the safe card");
}
{
  // Void, later in the hand: anything goes.
  const st = table(H("3C"), H("2C"), H("5C"), H("7D", "8H", "QS"));
  st.trickNo = 3;                       // pretend we are past the first trick
  st.trick = [{ seat: 0, card: C("3C") }];
  check(ids(R.legalMoves(st, 3)) === "7D 8H QS",
        "void away from the first trick, every card is legal including the queen");
}

/* ---- the first-trick ban on points ---------------------------------- */
console.log("\nthe first trick");
{
  const st = table(H("3C"), H("2C"), H("5C"), H("7D", "8H", "QS"));
  R.playCard(st, 1, "2C");
  check(ids(R.legalMoves(st, 3)) === "7D",
        "void on the first trick: no hearts and no queen may be thrown");
}
{
  // The escape: a hand made of nothing but points has to be allowed to play.
  const st = table(H("3C"), H("2C"), H("5C"), H("8H", "9H", "QS"));
  R.playCard(st, 1, "2C");
  check(ids(R.legalMoves(st, 3)) === "8H 9H QS",
        "unless points are the only thing you hold, and then they are allowed");
}

/* ---- hearts may not be led until broken ------------------------------ */
console.log("\nleading hearts");
{
  const st = table(H("3C", "8H"), H("2C"), H("5C"), H("7D"));
  st.trickNo = 4;
  st.heartsBroken = false;
  check(ids(R.legalMoves(st, 0)) === "3C", "hearts cannot be LED while they are intact");
  st.heartsBroken = true;
  check(ids(R.legalMoves(st, 0)) === "3C 8H", "once broken, they can");
}
{
  const st = table(H("8H", "9H"), H("2C"), H("5C"), H("7D"));
  st.trickNo = 4;
  st.heartsBroken = false;
  check(ids(R.legalMoves(st, 0)) === "8H 9H",
        "a hand of nothing but hearts may lead them anyway");
}
{
  // The queen is not a heart: she may be led any time.
  const st = table(H("QS", "8H"), H("2C"), H("5C"), H("7D"));
  st.trickNo = 4;
  st.heartsBroken = false;
  check(ids(R.legalMoves(st, 0)) === "QS", "the queen of spades may be led before hearts break");
}
{
  // A heart played because you were void breaks hearts.
  const st = table(H("3C", "8D"), H("2C", "9D"), H("5C", "AD"), H("7C", "8H"));
  R.playCard(st, 1, "2C"); R.playCard(st, 2, "5C"); R.playCard(st, 3, "7C"); R.playCard(st, 0, "3C");
  check(!st.heartsBroken, "hearts are intact after a clean first trick");
  st.trick = [{ seat: 2, card: C("AD") }];
  st.hands[2] = [];
  st.turn = 3;
  R.playCard(st, 3, "8H");
  check(st.heartsBroken, "discarding a heart breaks them");
}

/* ---- who takes the trick -------------------------------------------- */
console.log("\ntaking tricks");
check(R.trickWinner([
  { seat: 0, card: C("3C") }, { seat: 1, card: C("AH") },
  { seat: 2, card: C("KS") }, { seat: 3, card: C("5C") },
]) === 3, "a high card off suit does NOT win — the five of clubs takes it");
check(R.trickWinner([
  { seat: 2, card: C("10D") }, { seat: 3, card: C("JD") },
  { seat: 0, card: C("2D") }, { seat: 1, card: C("AD") },
]) === 1, "the highest of the led suit wins wherever it sits in the order");
{
  const st = table(H("3C", "4D"), H("2C", "5D"), H("5C", "6D"), H("7C", "7D"));
  R.playCard(st, 1, "2C"); R.playCard(st, 2, "5C"); R.playCard(st, 3, "7C");
  const out = R.playCard(st, 0, "3C");
  check(out.trickDone && out.winner === 3, "the seven of clubs takes the first trick");
  check(st.turn === 3 && st.leader === 3, "and its winner leads the next one");
  check(st.taken[3].length === 4 && st.trickNo === 1, "four cards land in the winner's pile");
}

/* ---- illegal plays are refused -------------------------------------- */
console.log("\nrefusals");
{
  const st = table(H("3C", "KH"), H("2C"), H("5C"), H("7C"));
  check(R.playCard(st, 0, "3C") === null, "you cannot play out of turn");
  R.playCard(st, 1, "2C");
  check(R.playCard(st, 2, "5C") !== null, "the seat whose turn it is may play");
  check(R.playCard(st, 3, "KH") === null, "you cannot play a card you do not hold");
}

/* ---- scoring, and the moon ------------------------------------------ */
console.log("\nscoring");
{
  const st = R.newHand([[], [], [], []], 1);
  st.taken[0] = H("2H", "3H", "QS");
  st.taken[1] = H("4H");
  const s = R.scoreHand(st);
  check(s.pts.join(",") === "15,1,0,0" && s.shooter === -1, "ordinary hand: 2 hearts + queen = 15");
}
{
  // Every heart and the queen in one pile.
  const st = R.newHand([[], [], [], []], 1);
  st.taken[2] = R.ORDER.map((r) => C(r + "H")).concat([C("QS")]);
  const s = R.scoreHand(st);
  check(s.shooter === 2, "thirteen hearts and the queen is recognised as a moon");
  check(s.pts.join(",") === "26,26,0,26", "the shooter takes nothing and everybody else takes 26");
}
{
  // Twelve hearts and the queen is 25, which is NOT a moon.
  const st = R.newHand([[], [], [], []], 1);
  st.taken[2] = R.ORDER.slice(0, 12).map((r) => C(r + "H")).concat([C("QS")]);
  st.taken[0] = H("AH");
  const s = R.scoreHand(st);
  check(s.shooter === -1 && s.pts.join(",") === "1,0,25,0",
        "one heart short of the moon scores 25 the hard way");
}
{
  // All thirteen hearts but no queen is 13, also not a moon.
  const st = R.newHand([[], [], [], []], 1);
  st.taken[1] = R.ORDER.map((r) => C(r + "H"));
  st.taken[3] = H("QS");
  const s = R.scoreHand(st);
  check(s.shooter === -1 && s.pts.join(",") === "0,13,0,13",
        "all the hearts without the queen is 13, not a moon");
}

/* ---- the end of the game --------------------------------------------- */
console.log("\nthe end");
check(R.gameResult([40, 62, 31, 99], 100) === null, "nobody at 100 yet, so play continues");
{
  const r = R.gameResult([40, 62, 31, 100], 100);
  check(r && r.winners.join(",") === "2" && r.low === 31, "the LOWEST score wins, not the highest");
}
{
  const r = R.gameResult([12, 104, 12, 60], 100);
  check(r && r.winners.join(",") === "0,2", "a tie for lowest reports both seats");
}
check(R.gameResult([50, 10, 10, 10], 50) !== null, "the target may be set to 50");

/* ---- a full hand, played out ----------------------------------------- */
console.log("\na whole hand, thirteen tricks");
{
  // A deterministic deal: deal the sorted deck round the table.
  const deck = [];
  for (const s of ["C", "D", "S", "H"]) for (const r of R.ORDER) deck.push(C(r + s));
  let seed = 12345;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  const st = R.newHand([deck.slice(0, 13), deck.slice(13, 26), deck.slice(26, 39), deck.slice(39)], 1);
  st.leader = R.openingLeader(st);
  st.turn = st.leader;
  check(st.hands[st.leader].some((c) => c.id === "2C"), "the leader really does hold the two of clubs");

  let plays = 0, out = null, firstTrickPoints = 0, stuck = false;
  while (st.turn >= 0 && plays < 60) {
    const seat = st.turn;
    const moves = R.legalMoves(st, seat);
    if (!moves.length) { stuck = true; break; }
    // Deterministic choice: the highest legal card, which drags points around.
    let pick = moves[0];
    for (const m of moves) if (R.rankOf(m) > R.rankOf(pick)) pick = m;
    if (st.trickNo === 0) firstTrickPoints += R.cardPoints(pick);
    out = R.playCard(st, seat, pick.id);
    if (!out) { check(false, "a move the rules offered was then refused"); break; }
    plays++;
  }
  check(!stuck, "there is always at least one legal move");
  check(plays === 52, "exactly 52 cards are played (got " + plays + ")");
  check(st.trickNo === 13, "thirteen tricks are completed");
  check(firstTrickPoints === 0, "not one point landed on the first trick");
  check(st.hands.every((h) => h.length === 0), "every hand is empty at the end");
  check(st.taken.reduce((a, p) => a + p.length, 0) === 52, "all 52 cards are accounted for");
  const s = R.scoreHand(st);
  const total = s.shooter >= 0 ? 78 : 26;
  check(s.pts.reduce((a, b) => a + b, 0) === total,
        "the hand scores " + total + " in total (got " + s.pts.reduce((a, b) => a + b, 0) + ")");
  console.log("       final hand scores: [" + s.pts.join(", ") + "]");
}

/* ---- a thousand random hands, checking the invariants ---------------- */
console.log("\na thousand random hands");
{
  let seed = 987654321;
  const rnd = () => { seed ^= seed << 13; seed >>>= 0; seed ^= seed >> 17; seed ^= seed << 5; seed >>>= 0; return seed / 4294967296; };
  let bad = 0, moons = 0, firstTrickPoints = 0, heartsLedEarly = 0, deadEnds = 0, badTotals = 0;
  for (let n = 0; n < 1000; n++) {
    const deck = [];
    for (const s of ["C", "D", "S", "H"]) for (const r of R.ORDER) deck.push(C(r + s));
    for (let i = deck.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    const st = R.newHand([deck.slice(0, 13), deck.slice(13, 26), deck.slice(26, 39), deck.slice(39)],
                         (n % 4) + 1);
    st.leader = R.openingLeader(st);
    st.turn = st.leader;
    if (!st.hands[st.leader].some((c) => c.id === "2C")) bad++;
    let plays = 0;
    while (st.turn >= 0 && plays < 60) {
      const seat = st.turn;
      const moves = R.legalMoves(st, seat);
      if (!moves.length) { deadEnds++; break; }
      // Every offered move must in fact be held and in fact be legal.
      for (const m of moves) {
        if (!st.hands[seat].some((c) => c.id === m.id)) bad++;
        if (!R.isLegal(st, seat, m.id)) bad++;
      }
      const leading = st.trick.length === 0;
      const pick = moves[Math.floor(rnd() * moves.length)];
      if (st.trickNo === 0 && R.cardPoints(pick) > 0) firstTrickPoints++;
      if (leading && pick.suit === "H" && !st.heartsBroken &&
          st.hands[seat].some((c) => c.suit !== "H")) heartsLedEarly++;
      if (!R.playCard(st, seat, pick.id)) bad++;
      plays++;
    }
    if (plays !== 52) bad++;
    const s = R.scoreHand(st);
    if (s.shooter >= 0) moons++;
    const sum = s.pts.reduce((a, b) => a + b, 0);
    if (sum !== (s.shooter >= 0 ? 78 : 26)) badTotals++;
  }
  check(bad === 0, "no illegal state in 1000 hands (" + bad + " problems)");
  check(deadEnds === 0, "no hand ever ran out of legal moves");
  check(firstTrickPoints === 0, "not one point was ever legal on a first trick");
  check(heartsLedEarly === 0, "hearts were never led early while another suit was held");
  check(badTotals === 0, "every hand scored 26, or 78 on a moon");
  console.log("       " + moons + " of 1000 random hands happened to shoot the moon");
}

console.log(fails ? "\n" + fails + " FAILED" : "\nall rules checks passed");
process.exit(fails ? 1 : 0);
