/*
 * Drives Hold'em's rules engine directly, lifted out of main.js between its
 * markers so this tests the shipped code rather than a copy that can drift.
 *
 * A hand evaluator that is wrong one time in fifty renders perfectly and ruins
 * every game, so the cases below are chosen to be exactly the ones a naive
 * implementation gets wrong: the wheel (ace LOW), a board that plays for
 * everybody, quads over a full house, a flush over a straight, kickers, side
 * pots when somebody is all in for less, and the rule that an undersized
 * all-in raise does not reopen the betting.
 */
import { readFileSync } from "node:fs";

const src = readFileSync("/home/user/my-bits/holdem/main.js", "utf8");
const body = src.split("/* ===== RULES START ===== */")[1].split("/* ===== RULES END ===== */")[0];
const R = new Function(body + `
return { RANK_VAL, parseCard, parseCards, rank5, best7, handName, preflopName,
         newMatch, startHand, legalActions, applyAction, needsToAct, nextActor,
         closeStreet, dealStreet, openBetting, settle, payout, potTotal,
         liveCount, canActCount, seatsIn, nextSeat, BLIND_LEVELS };`)();

let fails = 0, ran = 0;
const check = (ok, msg) => {
  ran++;
  console.log((ok ? "  ok   " : "  FAIL ") + msg);
  if (!ok) fails++;
};
const H = (s) => R.parseCards(s);
const name5 = (s) => R.handName(R.rank5(H(s)));
const score5 = (s) => R.rank5(H(s)).score;
const best = (s) => R.best7(H(s));

/* ------------------------------------------------------------------ */
console.log("\n— five-card ranking —");

check(R.rank5(H("As Ks Qs Js 10s")).cat === 8, "royal flush is a straight flush");
check(name5("As Ks Qs Js 10s") === "Royal flush", "…and is named a royal flush");
check(name5("9h 8h 7h 6h 5h") === "Straight flush, Nine high", "nine-high straight flush");
check(name5("Kd Kh Kc Ks 4d") === "Four Kings", "quads");
check(name5("7c 7d 7h 2s 2d") === "Sevens full of Twos", "full house reads trips-first");
check(name5("Ad Jd 8d 5d 2d") === "Flush, Ace high", "flush");
check(name5("9c 8d 7h 6s 5c") === "Straight, Nine high", "straight");
check(name5("4c 4d 4h Kc 2d") === "Three Fours", "trips");
check(name5("Ah Ad 9c 9s 3h") === "Two pair, Aces and Nines", "two pair");
check(name5("Qh Qd 9c 6s 3h") === "Pair of Queens", "one pair");
check(name5("Ah Jd 9c 6s 3h") === "Ace high", "high card");

/* --- THE WHEEL. A-2-3-4-5 is a straight and the ace is LOW. --- */
console.log("\n— the wheel (ace plays low) —");
check(R.rank5(H("As 2d 3c 4h 5s")).cat === 4, "A-2-3-4-5 is a straight, not ace-high junk");
check(name5("As 2d 3c 4h 5s") === "Straight, Five high", "…and it is FIVE high, not ace high");
check(score5("6d 5c 4h 3s 2d") > score5("As 2d 3c 4h 5s"),
      "6-high straight BEATS the wheel — the classic ace-high bug");
check(score5("As 2d 3c 4h 5s") > score5("Ah Ad Ac Qs Js"),
      "the wheel is still a straight, so it beats trip aces");
check(R.rank5(H("As 2s 3s 4s 5s")).cat === 8, "the steel wheel is a straight flush");
check(name5("As 2s 3s 4s 5s") === "Straight flush, Five high", "…named five high");
check(score5("6s 5s 4s 3s 2s") > score5("As 2s 3s 4s 5s"),
      "6-high straight flush beats the steel wheel");
check(score5("Ks Qs Js 10s 9s") > score5("As 2s 3s 4s 5s"), "and so does any higher one");
check(R.rank5(H("As Kd Qc Jh 2s")).cat === 0, "A-K-Q-J-2 is NOT a straight");
check(R.rank5(H("2s 3d 4c 5h 7s")).cat === 0, "2-3-4-5-7 is NOT a straight");
check(R.rank5(H("Ah 2d 3c 4h 6s")).cat === 0, "A-2-3-4-6 is NOT a straight");

/* --- category order, the two that get transposed --- */
console.log("\n— category order —");
check(score5("2c 2d 2h 2s 7d") > score5("Ah Ad Ac Kh Kd"),
      "QUADS beat a full house (deuces over aces-full)");
check(score5("2c 5c 9c Jc Kc") > score5("Ah Kd Qc Js 10h"),
      "a FLUSH beats a straight (nine-high-ish flush over Broadway)");
check(score5("Ah Ad Ac Kh Kd") > score5("2c 5c 9c Jc Kc"), "a full house beats a flush");
check(score5("Ah Kd Qc Js 10h") > score5("Ah Ad Ac Kh Qd"), "a straight beats trips");
check(score5("Ah Ad Ac Kh Qd") > score5("Ah Ad Kc Ks Qd"), "trips beat two pair");
check(score5("Ah Ad Kc Ks Qd") > score5("Ah Ad Kc Qs Jd"), "two pair beats a pair");

/* --- kickers --- */
console.log("\n— kickers —");
check(score5("Ah Ad Kc 7s 4d") > score5("Ah As Qc 7s 4d"), "pair of aces: king kicker beats queen");
check(score5("Ah Ad Kc 7s 4d") === score5("Ac As Kd 7h 4c"), "identical ranks tie exactly, suits are nothing");
check(score5("9h 9d 4c 4s Ad") > score5("9h 9d 4c 4s Kd"), "two pair: ace kicker beats king");
check(score5("Kh Kd Qc Qs 2d") > score5("Kh Kd Jc Js Ad"), "two pair: the SECOND pair outranks a kicker");
check(score5("Ah Kd Qc Js 8d") > score5("Ah Kd Qc Js 7d"), "high card falls to the fifth card");
check(score5("Ad Kd 8d 5d 3d") > score5("Ah Kh 8h 5h 2h"), "flush kickers run all five cards");

/* ------------------------------------------------------------------ */
console.log("\n— best five of seven —");
{
  // Seven cards holding a flush AND a straight: the flush has to win.
  const b = best("2c 5c 9c Jc Kc 10d Qh");
  check(b.cat === 5, "picks the flush out of seven when a straight is also there");
}
{
  // Board pairs and the player has trips: full house, not just trips.
  const b = best("7h 7d 7c Ks Kd 2h 3s");
  check(R.handName(b) === "Sevens full of Kings", "assembles a full house from seven");
}
{
  // Two pair on board plus a pocket pair: the best two pair is aces+kings
  // with a queen kicker, NOT three pair.
  const b = best("Ah Ad Kh Kd Qc 3s 2h");
  check(R.handName(b) === "Two pair, Aces and Kings", "three pair collapses to the best two");
  check(b.tie[2] === 12, "…with the queen as the kicker, not the deuce");
}
{
  const b = best("As 2h 3d 4c 5s Kh Qd");
  check(R.handName(b) === "Straight, Five high", "finds the wheel inside seven cards");
}
{
  // Six to the straight: it must take the top five, not the bottom five.
  const b = best("9h 8d 7c 6s 5h 4d 2c");
  check(R.handName(b) === "Straight, Nine high", "six-card straight resolves to the high end");
}
{
  const b = best("Ac Kc Qc Jc 10c 9c 2h");
  check(R.handName(b) === "Royal flush", "six-card straight flush resolves to the royal");
}

/* ------------------------------------------------------------------ */
console.log("\n— pots, splits and side pots —");

/** Build a settled state by hand, without running a betting round. */
function table(seats, board, dealer) {
  const S = R.newMatch(seats.map((s, i) => s.name || "P" + i), { stack: 0 });
  S.board = R.parseCards(board);
  S.dealer = dealer || 0;
  S.players.forEach((p, i) => {
    p.hole = seats[i].hole ? R.parseCards(seats[i].hole) : [];
    p.committed = seats[i].committed;
    p.folded = !!seats[i].folded;
    p.chips = 0;
  });
  return S;
}

{
  // BOARD PLAYS. Both players' seven cards make the identical hand, because
  // nothing in either hole card beats the board. The pot splits exactly.
  const S = table([
    { name: "A", hole: "2c 3d", committed: 100 },
    { name: "B", hole: "2h 3s", committed: 100 },
  ], "As Ks Qh Jd 10c");
  const res = R.settle(S);
  check(res.awards[0] === 100 && res.awards[1] === 100,
        "board plays: an ace-high straight on the board splits 200 exactly (got " +
        res.awards.join("/") + ")");
  check(R.handName(res.hands[0]) === "Straight, Ace high", "…and both are named the board's hand");
}
{
  // Same board, but one player pairs it — no longer a split.
  const S = table([
    { name: "A", hole: "Ac 3d", committed: 100 },
    { name: "B", hole: "2h 3s", committed: 100 },
  ], "As Ks Qh Jd 10c");
  const res = R.settle(S);
  check(res.awards[0] === 100 && res.awards[1] === 100,
        "a pair of aces does NOT beat the straight already on the board — still a split");
}
{
  // An odd chip cannot be halved. Three players in for 51 each, the middle
  // one folded, so 153 splits between two winners: 76 each and one over.
  // With the button on seat 1, the first winner to its left is seat 2.
  const S = table([
    { name: "A", hole: "2c 3d", committed: 51 },
    { name: "B", hole: "7h 8s", committed: 51, folded: true },
    { name: "C", hole: "2d 3h", committed: 51 },
  ], "As Ks Qh Jd 10c", 1);
  const res = R.settle(S);
  const tot = res.awards.reduce((a, b) => a + b, 0);
  check(tot === 153, "every chip is paid out (got " + tot + ")");
  check(res.awards[2] === 77 && res.awards[0] === 76,
        "the odd chip goes to the first winner left of the button (got " + res.awards.join("/") + ")");
}
{
  // SIDE POT. A is all in for 100, B and C put in 500 each.
  // Main pot 300, contested by all three. Side pot 800, only B and C.
  // A has the best hand overall but can only win the main pot.
  const S = table([
    { name: "A", hole: "Ac Ad", committed: 100 },   // trip aces
    { name: "B", hole: "Kc Kd", committed: 500 },   // trip kings
    { name: "C", hole: "7c 8d", committed: 500 },   // nothing
  ], "Ah Kh 2s 5d 9c");
  const res = R.settle(S);
  check(res.pots.length === 2, "two pots (got " + res.pots.length + ")");
  check(res.pots[0].amount === 300 && res.pots[1].amount === 800,
        "main 300 / side 800 (got " + res.pots.map(p => p.amount).join("/") + ")");
  check(res.awards[0] === 300, "the short all-in wins ONLY the main pot (got " + res.awards[0] + ")");
  check(res.awards[1] === 800, "the second-best hand takes the side pot (got " + res.awards[1] + ")");
  check(res.awards[2] === 0, "the worst hand gets nothing");
}
{
  // Three different all-in amounts. A is in for 50, B for 200, C for 500 — but
  // nobody matched more than 200, so 300 of C's money was never contested.
  // That is TWO pots and a returned bet, not three pots: a layer with one
  // eligible player is not a pot, it is your own chips coming home.
  const S = table([
    { name: "A", hole: "2c 2d", committed: 50 },
    { name: "B", hole: "3c 3d", committed: 200 },
    { name: "C", hole: "4c 4d", committed: 500 },
  ], "Ah Kh 9s 5d 7c");
  const res = R.settle(S);
  check(res.pots.length === 2, "two contested pots for three all-in sizes (got " + res.pots.length + ")");
  check(res.pots.map(p => p.amount).join(",") === "150,300",
        "layers are 150 / 300 (got " + res.pots.map(p => p.amount).join(",") + ")");
  check(!!res.returned && res.returned.seat === 2 && res.returned.amount === 300,
        "C's uncalled 300 comes off the top as a return, not as a pot");
  check(res.total === 450, "the pot that was actually played for is 450 (got " + res.total + ")");
  check(res.awards[2] === 750 && res.awards[0] === 0 && res.awards[1] === 0,
        "the best hand with the deepest stack takes both pots and its own money back (got " +
        res.awards.join("/") + ")");
  check(res.awards.reduce((a, b) => a + b, 0) === 750, "no chips created or destroyed");
}
{
  // An uncalled bet is returned before anything is counted, so it can never
  // dress itself up as a side pot and can never reach the leaderboard.
  const S = R.newMatch(["A", "B", "C"], { stack: 1000, blindEvery: 0 });
  S.board = R.parseCards("Ah Kh 9s 5d 7c");
  S.dealer = 0;
  S.players[0].hole = R.parseCards("Ac Ad"); S.players[0].committed = 500; S.players[0].chips = 500;
  S.players[1].hole = R.parseCards("2c 3d"); S.players[1].committed = 10;
  S.players[1].folded = true; S.players[1].chips = 990;
  S.players[2].hole = R.parseCards("4c 5d"); S.players[2].committed = 20;
  S.players[2].folded = true; S.players[2].chips = 980;
  const res = R.settle(S); R.payout(S, res);
  check(res.returned.amount === 480, "480 of a 500 shove nobody called comes straight back");
  check(res.total === 50, "the pot that was played for is 50, not 530 (got " + res.total + ")");
  check(S.players[0].delta === 30, "…and the shover is up 30 on the hand (got " + S.players[0].delta + ")");
  check(S.biggestPot === 50,
        "the biggest-pot record is the 50 dragged, not the 530 pushed (got " + S.biggestPot + ")");
  check(S.players.reduce((a, p) => a + p.chips, 0) === 3000 - 530 + 530,
        "chips still balance after the return");
}
{
  // A walk. The big blind's own blind is only called as far as the small
  // blind went, so the pot is 20 and the blind is up 10 — the two numbers a
  // player sees on the same screen have to agree.
  const S = table([
    { name: "A", hole: "2c 3d", committed: 10, folded: true },
    { name: "B", hole: "Ac Kd", committed: 20 },
  ], "");
  S.board = [];
  const res = R.settle(S); R.payout(S, res);
  check(res.total === 20, "a walk is a 20 pot, not 30 (got " + res.total + ")");
  check(S.players[1].delta === 10, "the big blind is up exactly the small blind");
}
{
  // Folded money stays in the pot but a folder can never win it.
  const S = table([
    { name: "A", hole: "Ac Ad", committed: 100, folded: true },
    { name: "B", hole: "2c 7d", committed: 100 },
  ], "3h 4h 9s Jd Qc");
  const res = R.settle(S);
  check(res.awards[0] === 0 && res.awards[1] === 200,
        "a folded pair of aces wins nothing; the caller takes 200");
}
{
  // Uncalled excess is refunded by the layer maths, with no special case.
  const S = table([
    { name: "A", hole: "Ac Ad", committed: 100 },
    { name: "B", hole: "2c 7d", committed: 400, folded: false },
    { name: "C", hole: "3c 8d", committed: 100, folded: true },
  ], "3h 4h 9s Jd Qc");
  const res = R.settle(S);
  check(res.awards[1] >= 300, "the uncalled 300 comes back to the player who bet it");
  check(res.awards[0] + res.awards[1] + res.awards[2] === 600, "and the total still balances");
}

/* ------------------------------------------------------------------ */
console.log("\n— the betting round —");

/**
 * A deck that deals the hands and board you name, in real dealing order.
 * holes is indexed by SEAT; the deal starts one seat left of the button, so
 * the button has to be passed in or every hand lands one chair over.
 */
function scriptDeck(holes, board, dealer) {
  const n = holes.length, d = dealer || 0;
  const out = [];
  for (let r = 0; r < 2; r++) {
    for (let c = 0; c < n; c++) out.push(R.parseCards(holes[(d + 1 + c) % n])[r]);
  }
  const b = R.parseCards(board);
  out.push(R.parseCard("2c"));                       // burn
  out.push(b[0], b[1], b[2]);
  out.push(R.parseCard("3c"));                       // burn
  out.push(b[3]);
  out.push(R.parseCard("4c"));                       // burn
  out.push(b[4]);
  return out;
}

{
  const S = R.newMatch(["A", "B", "C"], { stack: 1000, blindEvery: 0 });
  S.dealer = 0;
  R.startHand(S, scriptDeck(["Ac Ad", "Kc Kd", "Qc Qd"], "2h 5s 9d Jc 3h", S.dealer));
  check(S.players[1].bet === 10 && S.players[2].bet === 20,
        "three-handed: seat 1 posts the small blind, seat 2 the big blind");
  check(S.toAct === 0, "…and the button speaks first before the flop");
  check(S.players[0].hole.map(c => c.id).join(" ") === "AC AD",
        "the scripted deal reaches the seat it was written for");
  const la = R.legalActions(S);
  check(la.toCall === 20 && la.minTo === 40,
        "facing the big blind, the minimum raise is TO 40, not to 30 (got " + la.minTo + ")");
  check(la.canCheck === false, "and you cannot check facing a blind");
}
{
  // Minimum raise tracks the size of the LAST raise, not the blind.
  const S = R.newMatch(["A", "B", "C"], { stack: 1000, blindEvery: 0 });
  S.dealer = 0;
  R.startHand(S, scriptDeck(["Ac Ad", "Kc Kd", "Qc Qd"], "2h 5s 9d Jc 3h", S.dealer));
  R.applyAction(S, "raise", 60);                     // raise of 40 over the 20
  check(S.minRaise === 40, "a raise to 60 sets the minimum raise increment to 40");
  check(R.legalActions(S).minTo === 100, "so the next raise must be to at least 100");
}
{
  // A raise below the minimum is clamped up to the minimum rather than
  // silently accepted — an under-raise must never reach the table.
  const S = R.newMatch(["A", "B"], { stack: 1000, blindEvery: 0 });
  S.dealer = 0;
  R.startHand(S, scriptDeck(["Ac Ad", "Kc Kd"], "2h 5s 9d Jc 3h", S.dealer));
  check(S.toAct === 0 && S.players[0].bet === 10,
        "heads up: the button posts the small blind and acts first pre-flop");
  R.applyAction(S, "raise", 25);                     // asked for an illegal 25
  check(S.players[0].bet === 40, "a raise to 25 is clamped up to the legal 40 (got " + S.players[0].bet + ")");
}
{
  // The big blind's option: everyone calls, and the blind still gets to act.
  const S = R.newMatch(["A", "B", "C"], { stack: 1000, blindEvery: 0 });
  S.dealer = 0;
  R.startHand(S, scriptDeck(["Ac Ad", "Kc Kd", "Qc Qd"], "2h 5s 9d Jc 3h", S.dealer));
  R.applyAction(S, "call");                          // seat 0 limps
  R.applyAction(S, "call");                          // seat 1 completes
  check(S.toAct === 2, "the big blind still has the option after everybody limps");
  R.applyAction(S, "check");
  check(S.toAct === -1, "…and checking closes the round");
  R.closeStreet(S);
  R.dealStreet(S);
  R.openBetting(S);
  check(S.board.length === 3, "the flop is three cards");
  check(S.toAct === 1, "after the flop the small blind speaks first, not the button");
}
{
  // AN UNDERSIZED ALL-IN DOES NOT REOPEN THE BETTING.
  // A bets 100, B calls, C shoves for 130 — a raise of only 30 against a
  // minimum of 100. A and B may call or fold; neither may re-raise.
  const S = R.newMatch(["A", "B", "C"], { stack: 1000, blindEvery: 0 });
  S.players[2].chips = 130;
  S.dealer = 2;                                      // so seat 0 is the small blind
  R.startHand(S, scriptDeck(["Ac Ad", "Kc Kd", "Qc Qd"], "2h 5s 9d Jc 3h", S.dealer));
  R.closeStreet(S);                                  // jump straight to a clean street
  S.board = R.parseCards("2h 5s 9d");
  S.street = 1;
  R.openBetting(S);
  check(S.toAct === 0, "post-flop action opens on the seat left of the button");
  R.applyAction(S, "raise", 100);                    // A bets 100
  R.applyAction(S, "call");                          // B calls 100
  check(S.toAct === 2, "action reaches the short stack");
  const before = R.legalActions(S);
  check(before.maxTo === S.players[2].chips + S.players[2].bet, "the short stack can only shove what it has");
  R.applyAction(S, "allin");
  check(S.players[2].allIn, "the short stack is all in");
  check(S.betToMatch === 130, "the bet to match rises to 130");
  check(S.toAct === 0, "A owes the extra 30 and must act again");
  const laA = R.legalActions(S);
  check(laA.toCall === 30, "…for exactly 30 more");
  check(laA.canRaise === false,
        "and A may NOT re-raise: an all-in under a full raise does not reopen the betting");
  R.applyAction(S, "call");
  const laB = R.legalActions(S);
  check(S.toAct === 1 && laB.canRaise === false, "the same is true for B");
  R.applyAction(S, "call");
  check(S.toAct === -1, "the round closes once both have called");
  check(R.canActCount(S) === 2, "two players still have chips behind");
}
{
  // A FULL raise over the top DOES reopen it.
  const S = R.newMatch(["A", "B", "C"], { stack: 1000, blindEvery: 0 });
  S.dealer = 2;
  R.startHand(S, scriptDeck(["Ac Ad", "Kc Kd", "Qc Qd"], "2h 5s 9d Jc 3h", S.dealer));
  R.closeStreet(S);
  S.board = R.parseCards("2h 5s 9d");
  S.street = 1;
  R.openBetting(S);
  R.applyAction(S, "raise", 100);                    // A bets 100
  R.applyAction(S, "call");                          // B calls
  R.applyAction(S, "raise", 300);                    // C raises a full 200
  check(S.toAct === 0, "A must answer the raise");
  check(R.legalActions(S).canRaise === true, "and A may re-raise, because it was a full raise");
  check(R.legalActions(S).minTo === 500, "the next legal raise is to 500");
}
{
  // Folding round to one player ends the hand with no showdown.
  const S = R.newMatch(["A", "B", "C"], { stack: 1000, blindEvery: 0 });
  S.dealer = 0;
  R.startHand(S, scriptDeck(["Ac Ad", "Kc Kd", "Qc Qd"], "2h 5s 9d Jc 3h", S.dealer));
  R.applyAction(S, "fold");
  R.applyAction(S, "fold");
  check(R.liveCount(S) === 1, "everybody folded to the big blind");
  const res = R.settle(S);
  R.payout(S, res);
  check(res.showdown === false, "no showdown when only one player is left");
  check(S.players[2].chips === 1010, "the big blind collects the 10 it was owed (got " + S.players[2].chips + ")");
  check(S.players[0].chips === 1000 && S.players[1].chips === 990, "and the small blind is down 10");
}
{
  // Chips are conserved across a whole scripted hand.
  const S = R.newMatch(["A", "B", "C"], { stack: 1000, blindEvery: 0 });
  S.dealer = 0;
  R.startHand(S, scriptDeck(["Ac Ad", "Kc Kd", "Qc Qd"], "2h 5s 9d Jc 3h", S.dealer));
  R.applyAction(S, "call"); R.applyAction(S, "call"); R.applyAction(S, "check");
  for (let st = 0; st < 3; st++) {
    R.closeStreet(S); R.dealStreet(S); R.openBetting(S);
    while (S.toAct >= 0) R.applyAction(S, "check");
  }
  check(S.board.length === 5, "the board runs out to five cards");
  R.closeStreet(S);
  const res = R.settle(S);
  R.payout(S, res);
  const total = S.players.reduce((a, p) => a + p.chips, 0);
  check(total === 3000, "3000 chips in, 3000 chips out (got " + total + ")");
  check(S.players[0].chips === 1040,
        "pocket aces on a 2-5-9-J-3 board take the 60 (got " + S.players[0].chips + ")");
  check(S.biggestPot === 60, "the biggest pot of the match is recorded as 60");
}
{
  // Blind levels climb on schedule and stop climbing when set to never.
  const S = R.newMatch(["A", "B"], { stack: 1000, blindEvery: 2 });
  for (let i = 0; i < 3; i++) R.startHand(S, scriptDeck(["Ac Ad", "Kc Kd"], "2h 5s 9d Jc 3h", S.dealer));
  check(S.sb === 15 && S.bb === 30, "blinds step up after two hands (got " + S.sb + "/" + S.bb + ")");
  const T = R.newMatch(["A", "B"], { stack: 1000, blindEvery: 0 });
  for (let i = 0; i < 9; i++) R.startHand(T, scriptDeck(["Ac Ad", "Kc Kd"], "2h 5s 9d Jc 3h", T.dealer));
  check(T.sb === 10 && T.bb === 20, "…and never climb when the setting says never");
}

/* ------------------------------------------------------------------ */
console.log("\n— exhaustive sanity —");
{
  // Every five-card hand out of a small deck must land in a sane category,
  // and best7 must never return a hand worse than any five of the seven.
  const deck = [];
  for (const s of ["S", "H", "D", "C"]) for (const r of ["2","5","8","9","10","J","Q","K","A"])
    deck.push(R.parseCard(r === "10" ? "10" + s : r + s));
  let worst = 0, checked = 0;
  const rnd = (n) => Math.floor(Math.random() * n);
  for (let trial = 0; trial < 4000; trial++) {
    const pool = deck.slice();
    const seven = [];
    for (let k = 0; k < 7; k++) seven.push(pool.splice(rnd(pool.length), 1)[0]);
    const b = R.best7(seven);
    // Brute force the same 21 combinations independently.
    let manual = -1;
    for (let a = 0; a < 7; a++) for (let bb = a + 1; bb < 7; bb++) for (let c = bb + 1; c < 7; c++)
      for (let d = c + 1; d < 7; d++) for (let e = d + 1; e < 7; e++) {
        const sc = R.rank5([seven[a], seven[bb], seven[c], seven[d], seven[e]]).score;
        if (sc > manual) manual = sc;
      }
    if (b.score !== manual) worst++;
    checked++;
  }
  check(worst === 0, "best7 matches a brute-force maximum over " + checked + " random seven-card hands");
}

console.log("\n" + ran + " checks, " + (fails ? fails + " FAILED" : "all passed"));
process.exit(fails ? 1 : 0);
