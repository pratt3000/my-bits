/*
 * Plays a complete two-handed game of Crazy Eights to a real winner.
 *
 * Every turn is two gestures on one phone — lift the cover, then play — so
 * the script drives the handover exactly the way a person does, and never
 * peeks at a hand it has not revealed. It polls `busy` rather than sleeping,
 * because a play commits its state instantly and then animates: waiting on the
 * state taps into a moving card and the input is silently dropped.
 *
 * It also checks the two rules that are easy to get wrong and invisible from a
 * screenshot: that the legal set really is rank-or-suit-or-eight, and that a
 * card outside it cannot be selected at all.
 */
import { openBit } from "./run.mjs";

const bit = await openBit("/home/user/my-bits/crazy-eights");

const look = () => bit.probe(() => {
  const s = window.__EIGHTS__;
  return {
    phase: s.phase, busy: s.busy, revealed: s.revealed, turn: s.turn,
    round: s.round, top: s.top, named: s.named, stock: s.stock, pile: s.pile,
    hand: s.hand, legal: s.legal, canDraw: s.canDraw,
    players: s.players, roundWinner: s.roundWinner, matchWinner: s.matchWinner,
    lastClose: s.lastClose, baked: s.baked, target: s.target,
  };
});
const at = (fn, arg) => bit.probe(fn, arg);
const handXY = (i) => at((k) => window.__EIGHTS__.handXY(k), i);
const stockXY = () => at(() => window.__EIGHTS__.stockXY());
const passXY = () => at(() => window.__EIGHTS__.passXY());

async function settle(max = 60) {
  for (let i = 0; i < max; i++) {
    if (!(await bit.probe(() => window.__EIGHTS__.busy))) return true;
    await bit.wait(60);
  }
  return false;
}
const click = async (sel) => { await bit.page.click(sel); await bit.wait(150); };

const fails = [];
const check = (ok, what) => { if (!ok) fails.push(what); console.log((ok ? "  ok   " : "  FAIL ") + what); };

/* ---- title ------------------------------------------------------- */
await bit.wait(900);
await bit.shot("crazy-eights-1-title");
let s = await look();
check(s.phase === "menu", "boots to the title, not a blank frame");
check(s.baked, "card art baked to OffscreenCanvas");

await click('[data-el="seats"] button[data-v="2"]');
await click('[data-el="targets"] button[data-v="25"]');
await click('[data-el="deal"]');
await settle();

/* ---- the handover ------------------------------------------------ */
s = await look();
check(s.phase === "cover", "the deal lands on a pass-the-phone cover, got " + s.phase);
check(!s.revealed, "the hand is face down until the cover is tapped");
check(s.players[0].cards === 7 && s.players[1].cards === 7, "seven cards each");
check(s.pile === 1, "one card turned up to start the pile");
check(s.stock === 52 - 15, "the stock is what is left, got " + s.stock);
await bit.shot("crazy-eights-2-cover");

await click('[data-el="cover-btn"]');
await settle();
s = await look();
check(s.revealed, "tapping the cover reveals the hand");
await bit.shot("crazy-eights-3-hand");

/* ---- the legal set is exactly the rule --------------------------- */
{
  const topRank = s.top.slice(0, -1), topSuit = s.top.slice(-1);
  const want = [];
  s.hand.forEach((id, i) => {
    const r = id.slice(0, -1), su = id.slice(-1);
    const ok = r === "8" || (s.named ? su === s.named : (su === topSuit || r === topRank));
    if (ok) want.push(i);
  });
  check(JSON.stringify(want) === JSON.stringify(s.legal),
    "legal set is rank-or-suit-or-eight: want " + JSON.stringify(want) + " got " + JSON.stringify(s.legal));

  // A dimmed card must never be the card that gets played. It is not simply
  // "the tap does nothing": the fan picks the topmost LEGAL card under the
  // finger, so a thumb over a dim card and a bright one lifts the bright one.
  // What must hold is that the dim card itself cannot leave the hand.
  const bad = s.hand.map((_, i) => i).find((i) => !s.legal.includes(i));
  if (bad !== undefined) {
    const badId = s.hand[bad];
    const p = await handXY(bad);
    await bit.tap(p.x, p.y);
    await settle();
    const after = await look();
    check(after.top !== badId, "a dimmed card (" + badId + ") can never reach the pile");
  } else {
    check(true, "every card in this hand happens to be legal — nothing to dim");
  }
}

/* ---- play the game out ------------------------------------------- */
let shotSuit = false, shotEight = false, shotNamed = false, shotDraw = false;
let steps = 0;
// A stall guard. The first version of the fan hit-test returned the topmost
// card whose rectangle covered the point rather than the topmost *legal* one,
// so tapping the middle of a card in a ten-card fan selected its neighbour and
// nothing ever happened. Without this the script span for eleven minutes and
// then timed out with no clue why.
let lastSig = "", sameFor = 0;
while (steps++ < 260) {
  const settled = await settle();
  s = await look();
  if (process.env.EIGHTS_TRACE) {
    console.log("   " + steps, s.phase, settled ? "" : "STILL-BUSY",
      "turn" + s.turn, JSON.stringify(s.players.map((p) => p.cards)),
      "stock" + s.stock, "pile" + s.pile, "top" + s.top, "named" + s.named,
      "legal" + JSON.stringify(s.legal), "draw" + s.canDraw);
  }
  if (s.phase === "match") break;

  const sig = s.phase + s.turn + s.top + s.named + JSON.stringify(s.players.map((p) => p.cards));
  sameFor = sig === lastSig ? sameFor + 1 : 0;
  lastSig = sig;
  if (sameFor >= 4) {
    check(false, "the game stalled — " + sig + " for five turns running, input is being dropped");
    break;
  }

  if (s.phase === "cover") { await click('[data-el="cover-btn"]'); continue; }

  if (s.phase === "suit") {
    if (!shotSuit) { await bit.shot("crazy-eights-4-name-a-suit"); shotSuit = true; }
    await click('[data-el="suit-H"]');
    continue;
  }

  if (s.phase === "round") {
    if (s.round === 1) {
      console.log("  round 1 —", s.roundWinner || "blocked",
        "| scores", JSON.stringify(s.players.map((p) => p.score)),
        "| cards left between the losers:", s.lastClose);
      await bit.shot("crazy-eights-5-round-over");
    }
    await click('[data-el="round-btn"]');
    continue;
  }

  if (s.phase === "play") {
    if (s.named && !shotNamed) {
      // An eight is live: the token above the pile has to be saying which suit.
      check(s.legal.every((i) => s.hand[i][0] === "8" || s.hand[i].slice(-1) === s.named),
        "with an eight live only the named suit (or another eight) is legal");
      await bit.shot("crazy-eights-7-eight-live");
      shotNamed = true;
    }
    if (!s.legal.length && s.canDraw && !shotDraw) {
      await bit.shot("crazy-eights-8-must-draw");
      shotDraw = true;
    }
    if (s.legal.length) {
      // Play the first eight it is dealt, so the wild path is exercised early,
      // then play like a person: keep the suit you hold most of and save your
      // eights. Naive first-legal play drags a two-handed round past a hundred
      // turns because it changes suit constantly and neither hand shrinks.
      let pick = s.legal[0];
      const eight = s.legal.find((i) => s.hand[i][0] === "8");
      if (eight !== undefined && !shotEight) {
        pick = eight;
        shotEight = true;
      } else {
        const bySuit = {};
        for (const id of s.hand) bySuit[id.slice(-1)] = (bySuit[id.slice(-1)] || 0) + 1;
        const plain = s.legal.filter((i) => s.hand[i][0] !== "8");
        const pool = plain.length ? plain : s.legal;
        pick = pool.reduce((best, i) =>
          (bySuit[s.hand[i].slice(-1)] || 0) > (bySuit[s.hand[best].slice(-1)] || 0) ? i : best, pool[0]);
      }
      const p = await handXY(pick);
      await bit.tap(p.x, p.y);
    } else if (s.canDraw) {
      const p = await stockXY();
      await bit.tap(p.x, p.y);
    } else {
      const p = await passXY();
      await bit.tap(p.x, p.y);
    }
    continue;
  }
  await bit.wait(120);
}

/* ---- the end ----------------------------------------------------- */
await settle();
s = await look();
await bit.shot("crazy-eights-6-game-over");
console.log("  finished in", s.round, "rounds after", steps, "interactions");
console.log("  final scores:", JSON.stringify(s.players.map((p) => p.name + " " + p.score)));

check(s.phase === "match", "reached the game-over screen, got " + s.phase);
check(!!s.matchWinner, "a winner is named: " + s.matchWinner);
check(Math.max(...s.players.map((p) => p.score)) >= s.target,
  "somebody crossed the " + s.target + " target");
check(s.players.find((p) => p.name === s.matchWinner).score ===
  Math.min(...s.players.map((p) => p.score)), "the winner is the LOWEST score (penalties)");

/* ---- replay path ------------------------------------------------- */
await click('[data-el="again"]');
await settle();
s = await look();
check(s.round === 1 && s.players.every((p) => p.score === 0), "Play again deals a fresh game");

/* ---- four round one phone ---------------------------------------- */
// The rail has to hold three opponents on a 390px screen, and a four-handed
// deal is five cards rather than seven. Both are layout claims a screenshot
// can settle and a unit test cannot.
await click('[data-el="cog"]');
await click('[data-el="leave"]');
s = await look();
check(s.phase === "menu", "Leave this game walks out of a half-played hand, got " + s.phase);
await click('[data-el="seats"] button[data-v="4"]');
await click('[data-el="deal"]');
await settle();
await click('[data-el="cover-btn"]');
await settle();
s = await look();
check(s.players.length === 4 && s.players.every((p) => p.cards === 5),
  "four players get five cards each, got " + JSON.stringify(s.players.map((p) => p.cards)));
await bit.shot("crazy-eights-9-four-players");

/* ---- the two panels every bit has to have ------------------------ */
await click('[data-el="cog"]');
await bit.shot("crazy-eights-10-settings");
await click('[data-el="cogp-close"]');
await click('[data-el="help"]');
await bit.shot("crazy-eights-11-how-to-play");
await click('[data-el="helpp-close"]');

const errs = (await bit.errors()).filter((e) => !/404|favicon/.test(e));
console.log(errs.length ? "ERRORS:\n  " + errs.join("\n  ") : "errors: none");
console.log(fails.length ? "\nFAILED: " + fails.length : "\nALL CHECKS PASS");
await bit.close();
process.exit(fails.length || errs.length ? 1 : 0);
