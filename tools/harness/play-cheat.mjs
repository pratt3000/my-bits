/*
 * Plays a complete five-handed game of Cheat to a real winner.
 *
 * Every turn is the two situations the bit is built around — a private
 * pick-up and a public challenge window — so the script drives both the way
 * people do: lift the cover, choose cards, put the phone down, and then either
 * let the window run out or slam a call into it. It never peeks at a hand it
 * has not revealed, and it polls `busy` rather than sleeping, because a play
 * commits its state instantly and then animates.
 *
 * The three claims that are invisible from a screenshot and that this exists
 * to settle:
 *   - a caught lie sends the whole pile to the liar, and a bad call sends it
 *     to the caller;
 *   - several fingers landing in the same frame produce exactly ONE caller;
 *   - the placer cannot call cheat on their own claim.
 */
import { openBit } from "./run.mjs";

const bit = await openBit("/home/user/my-bits/cheat");

const look = () => bit.probe(() => {
  const s = window.__CHEAT__;
  return {
    phase: s.phase, busy: s.busy, turn: s.turn, turnNo: s.turnNo, rank: s.rank,
    pile: s.pile, claim: s.claim, open: s.open, caller: s.caller, picked: s.picked,
    hand: s.hand, players: s.players, winner: s.winner, bestRun: s.bestRun,
    caught: s.caught, badCalls: s.badCalls, baked: s.baked,
  };
});
const click = async (sel) => { await bit.page.click(sel); await bit.wait(150); };
async function until(fn, max = 160) {
  for (let i = 0; i < max; i++) { const s = await look(); if (fn(s)) return s; await bit.wait(90); }
  return await look();
}
async function settle(max = 90) {
  for (let i = 0; i < max; i++) {
    if (!(await bit.probe(() => window.__CHEAT__.busy))) return true;
    await bit.wait(70);
  }
  return false;
}

const fails = [];
const check = (ok, what) => { if (!ok) fails.push(what); console.log((ok ? "  ok   " : "  FAIL ") + what); };

/* ---- title -------------------------------------------------------- */
await bit.wait(900);
await bit.shot("cheat-1-title");
let s = await look();
check(s.phase === "menu", "boots to the title, not a blank frame");
check(s.baked, "card art baked to OffscreenCanvas");

// Quick call window, so eleven turns of waiting stay inside a test run.
await click('[data-el="cog"]');
await click('[data-el="wins"] button[data-v="0"]');
await click('[data-el="cogp-close"]');
await click('[data-el="seats"] button[data-v="5"]');
await click('[data-el="deal"]');

s = await until((x) => x.phase === "cover");
check(s.phase === "cover", "the deal lands on a pass-the-phone cover, got " + s.phase);
check(s.players.length === 5, "five seats, got " + s.players.length);
check(s.players.reduce((n, p) => n + p.cards, 0) === 52,
  "the whole deck is dealt out, got " + s.players.reduce((n, p) => n + p.cards, 0));
check(s.hand.length === 0, "the cover shows no hand until it is tapped");
check(s.rank === "A", "the first claim is aces, got " + s.rank);
await bit.shot("cheat-2-cover");

/* ---- the whole game ----------------------------------------------- */
const seen = { challengeAfterLastCommit: false };
let shotPlace = false, shotPicked = false, shotWindow = false, shotReveal = false, shotBad = false;
let didCaught = false, didMisfire = false;
let lastRank = null, rankOk = true;
let steps = 0;

while (steps++ < 140) {
  await settle();
  s = await look();
  if (s.phase === "over") break;

  if (s.phase === "cover") {
    await click('[data-el="cover-btn"]');
    continue;
  }

  if (s.phase === "place") {
    const RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
    // The claim rank must march round by one every single turn, whoever won
    // the last challenge and whatever they were holding.
    if (lastRank !== null) {
      const want = RANKS[(RANKS.indexOf(lastRank) + 1) % 13];
      if (s.rank !== want) { rankOk = false; console.log("    rank jumped: " + lastRank + " -> " + s.rank); }
    }
    lastRank = s.rank;

    const real = s.hand.map((id, i) => [id, i])
      .filter(([id]) => id.slice(0, -1) === s.rank).map(([, i]) => i);
    // One turn is played honestly on purpose, so a call can be made against a
    // TRUE claim and the misfire branch gets exercised for real.
    const honest = !didMisfire && didCaught && real.length > 0;
    const pick = honest ? real.slice(0, 4) : s.hand.map((_, i) => i).slice(0, 4);

    if (!shotPlace) { await bit.shot("cheat-3-your-hand"); shotPlace = true; }
    for (const i of pick) {
      const p = await bit.probe((k) => window.__CHEAT__.handXY(k), i);
      await bit.tap(p.x, p.y);
      await bit.wait(70);
    }
    const after = await look();
    check(after.picked.length === pick.length || steps > 3,
      "tapping " + pick.length + " cards selects " + pick.length + ", got " + after.picked.length);
    if (!shotPicked) { await bit.shot("cheat-4-picked"); shotPicked = true; }

    const c = await bit.probe(() => window.__CHEAT__.commitXY());
    await bit.tap(c.x, c.y);
    await until((x) => x.phase !== "place", 40);
    if (honest) console.log("    turn " + (s.turnNo + 1) + ": played the real " + s.rank + "s");
    continue;
  }

  if (s.phase === "settle") { await until((x) => x.phase !== "settle", 60); continue; }

  if (s.phase === "challenge") {
    seen.challengeAfterLastCommit = true;
    if (!shotWindow) { await bit.shot("cheat-5-call-window"); shotWindow = true; }
    const placer = s.claim.by;
    const others = s.players.map((p, i) => i).filter((i) => i !== placer);

    if (!didCaught) {
      /* --- the placer may not call their own claim --- */
      const own = await bit.probe((seat) => window.__CHEAT__.padXY(seat), s.players[placer].seat);
      await bit.tap(own.x, own.y);
      await bit.wait(120);
      const still = await look();
      check(still.phase === "challenge" && still.open,
        "the placer cannot call cheat on their own claim");

      const before = { pile: s.pile, cards: s.players.map((p) => p.cards), lie: s.claim.lie };
      const pad = await bit.probe((seat) => window.__CHEAT__.padXY(seat), s.players[others[0]].seat);
      await bit.tap(pad.x, pad.y);
      await bit.wait(400);
      if (!shotReveal) { await bit.shot("cheat-6-reveal"); shotReveal = true; }
      const r = await until((x) => x.phase === "verdict", 60);
      check(r.caller === others[0], "the call is credited to the seat that tapped");
      await bit.wait(500);
      await bit.shot("cheat-7-verdict");
      const done = await until((x) => x.phase === "cover" || x.phase === "over", 90);
      const taker = before.lie ? placer : others[0];
      check(done.players[taker].cards === before.cards[taker] + before.pile,
        (before.lie ? "a caught liar" : "a bad caller") + " takes all " + before.pile +
        " cards: " + before.cards[taker] + " -> " + done.players[taker].cards);
      didCaught = true;
      console.log("    call 1 — claim was " + (before.lie ? "a LIE" : "TRUE") +
        ", pile of " + before.pile + " went to " + done.players[taker].name);
      continue;
    }

    if (didCaught && !didMisfire && s.claim && !s.claim.lie) {
      /* --- several hands landing in the same frame must make ONE caller --- */
      const pads = [];
      for (const i of others.slice(0, 3)) {
        pads.push(await bit.probe((seat) => window.__CHEAT__.padXY(seat), s.players[i].seat));
      }
      const before = { pile: s.pile, cards: s.players.map((p) => p.cards) };
      await bit.tapTogether(pads);
      const r = await until((x) => x.phase === "reveal" || x.phase === "verdict", 60);
      check(r.caller >= 0 && others.indexOf(r.caller) >= 0,
        "three fingers in one frame produce exactly one caller, got seat " + r.caller);
      check(!r.open, "the window closed on the first of the three");
      if (!shotBad) { await bit.shot("cheat-8-bad-call"); shotBad = true; }
      const done = await until((x) => x.phase === "cover" || x.phase === "over", 110);
      check(done.players[r.caller].cards === before.cards[r.caller] + before.pile,
        "calling a TRUE claim costs the caller the pile: " + before.cards[r.caller] +
        " -> " + done.players[r.caller].cards);
      didMisfire = true;
      console.log("    call 2 — claim was TRUE, " + done.players[r.caller].name +
        " ate " + before.pile + " cards");
      continue;
    }

    // Nobody calls: let the window run out, which is the common case.
    await until((x) => x.phase !== "challenge", 90);
    continue;
  }

  await bit.wait(110);
}

/* ---- the end ------------------------------------------------------- */
await settle();
s = await until((x) => x.phase === "over", 60);
await bit.wait(400);
await bit.shot("cheat-9-game-over");

console.log("  finished after " + (s.turnNo + 1) + " turns and " + steps + " interactions");
console.log("  final counts: " + JSON.stringify(s.players.map((p) => p.name + " " + p.cards)));
console.log("  longest run of lies: " + s.bestRun + " | caught " + s.caught + " | bad calls " + s.badCalls);

check(s.phase === "over", "reached the game-over screen, got " + s.phase);
check(!!s.winner, "a winner is named: " + s.winner);
check(s.players.find((p) => p.name === s.winner).cards === 0,
  "the winner is the player holding nothing");
check(s.players.filter((p) => p.cards === 0).length === 1, "exactly one player is out");
check(rankOk, "the claim rank advanced by exactly one every turn");
check(seen.challengeAfterLastCommit, "the winning play still went through a challenge window");
check(didCaught && didMisfire, "both verdict branches were exercised");
check(s.caught === 1 && s.badCalls === 1,
  "one cheat caught and one bad call, got " + s.caught + "/" + s.badCalls);
check(s.bestRun >= 1, "some lie got past the table: longest run " + s.bestRun);

const rec = await bit.events();
const sub = rec.find((e) => e.kind === "memory.record.submit");
check(!!sub && sub.args[0] === "longest_bluff_run" && sub.args[1] === s.bestRun,
  "the run is submitted to the leaderboard: " + JSON.stringify(sub && sub.args.slice(0, 2)));
check(rec.some((e) => e.kind === "complete"), "the bit told the platform the match completed");

/* ---- replay path --------------------------------------------------- */
await click('[data-el="again"]');
await until((x) => x.phase === "cover", 60);
s = await look();
check(s.turnNo === 0 && s.rank === "A" && s.players.every((p) => p.cards >= 10),
  "Deal again starts a fresh game at aces, got turn " + s.turnNo + " rank " + s.rank);

/* ---- the two panels every bit has to have -------------------------- */
await click('[data-el="help"]');
await bit.shot("cheat-10-how-to-play");
await click('[data-el="helpp-close"]');
await click('[data-el="cog"]');
await bit.shot("cheat-11-settings");
await click('[data-el="leave"]');
s = await look();
check(s.phase === "menu", "Leave this game walks out of a half-played hand, got " + s.phase);

/* ---- three round one phone ----------------------------------------
 * Three players seat at the near end and both long sides, so the far edge is
 * empty and the pile has to stay in the same place it was with five. That is
 * a layout claim a screenshot settles and a unit test cannot. */
await click('[data-el="seats"] button[data-v="3"]');
await click('[data-el="deal"]');
s = await until((x) => x.phase === "cover", 60);
check(s.players.length === 3 && s.players.map((p) => p.cards).sort().join(",") === "17,17,18",
  "three players split 52 into 18/17/17, got " + JSON.stringify(s.players.map((p) => p.cards)));
await click('[data-el="cover-btn"]');
await until((x) => x.phase === "place", 40);
for (const i of [0, 1]) {
  const q = await bit.probe((k) => window.__CHEAT__.handXY(k), i);
  await bit.tap(q.x, q.y);
  await bit.wait(70);
}
await bit.shot("cheat-12-three-hand");
const c3 = await bit.probe(() => window.__CHEAT__.commitXY());
await bit.tap(c3.x, c3.y);
s = await until((x) => x.phase === "challenge", 80);
check(s.phase === "challenge", "three-handed play reaches the call window, got " + s.phase);
await bit.shot("cheat-13-three-window");

const errs = (await bit.errors()).filter((e) => !/404|favicon/.test(e));
console.log(errs.length ? "ERRORS:\n  " + errs.join("\n  ") : "errors: none");
console.log(fails.length ? "\nFAILED: " + fails.length : "\nALL CHECKS PASS");
await bit.close();
process.exit(fails.length || errs.length ? 1 : 0);
