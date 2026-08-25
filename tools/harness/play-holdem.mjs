/*
 * Plays a real three-handed match of Hold'em to a real end state.
 *
 * Hand one is checked and called all the way to a river showdown, so the
 * script exercises every street, every handover, and a genuine multi-way
 * evaluation. After that everybody shoves every hand until only one player
 * has chips, which is the actual win condition.
 *
 * Everything waits on the bit's own `busy` flag rather than sleeping a fixed
 * amount: a move commits its state immediately and then animates, and a tap
 * that lands mid-animation is silently dropped.
 */
import { openBit } from "./run.mjs";

const bit = await openBit("/home/user/my-bits/holdem");
const st = () => bit.probe(() => {
  const h = window.__HOLDEM__;
  return {
    phase: h.phase, busy: h.busy, hand: h.handNo, street: h.street, toAct: h.toAct,
    pot: h.pot, board: h.board, seats: h.seats, legal: h.legal,
    chipsTotal: h.chipsTotal, winner: h.winner, biggest: h.biggestPot,
    headline: h.result ? h.result.headline : null,
    showdown: h.result ? h.result.showdown : null,
  };
});

async function settled(ms = 9000) {
  const t0 = Date.now();
  for (;;) {
    const s = await st();
    if (!s.busy && s.phase !== "anim" && s.phase !== "deal") return s;
    if (Date.now() - t0 > ms) return s;
    await bit.wait(90);
  }
}
const click = async (sel) => { await bit.page.click('[data-el="' + sel + '"]'); await bit.wait(90); };

await bit.wait(700);
await bit.shot("holdem-1-menu");

await click("pc\"] button[data-v=\"3");        // three at the table
await click("go");
let s = await settled();
console.log("dealt — hand", s.hand, "| pot", s.pot, "| to act:", s.seats[s.toAct].name);
await bit.shot("holdem-2-handoff");

// --- hand one: everybody checks and calls to a showdown ---
let shots = { acting: false, flop: false, river: false };
let steps = 0;
while (s.phase !== "result" && steps++ < 26) {
  if (s.phase === "handoff") {
    await click("cover");
    s = await settled();
    if (!shots.acting) { await bit.shot("holdem-3-acting"); shots.acting = true; }
    if (s.street === 1 && !shots.flop) { await bit.shot("holdem-4-flop"); shots.flop = true; }
    if (s.street === 3 && !shots.river) { await bit.shot("holdem-5-river"); shots.river = true; }
  } else if (s.phase === "acting") {
    await click("aCall");                      // reads "Check" or "Call n"
    s = await settled();
  } else break;
}
console.log("hand 1 reached:", s.phase, "| board:", s.board.join(" "), "| pot", s.pot);
const boardOK = s.board.length === 5;
await bit.shot("holdem-6-showdown");
console.log("showdown:", s.showdown, "|", s.headline);

let conserved = s.chipsTotal === 3000;
let potSizing = true;
console.log("chips on the table:", s.chipsTotal, conserved ? "(conserved)" : "(LEAKED)");

// --- from here on everybody shoves, so the match resolves ---
await click("next");
s = await settled();

steps = 0;
while (s.phase !== "over" && steps++ < 46) {
  if (s.phase === "handoff") { await click("cover"); s = await settled(); }
  else if (s.phase === "acting") {
    if (s.legal && s.legal.canRaise) {
      await click("aRaise");
      if (!shots.raise) { await bit.shot("holdem-9-raise"); shots.raise = true; }
      // "Pot" has to mean pot: call first, then raise by what the pot is worth
      // with your call in it. betToMatch + pot + toCall, clamped legal. Leaving
      // the call out of that sum undershoots every raise facing a bet.
      await click("rPot");
      const la = s.legal, bet = s.seats[s.toAct].bet;
      const want = Math.min(la.maxTo, Math.max(la.minTo, bet + la.toCall + la.pot + la.toCall));
      const shown = Number((await bit.probe(() =>
        document.querySelector('[data-el="rAmt"]').textContent)).replace(/[^0-9]/g, ""));
      if (shown !== want) { potSizing = false; console.log("POT BUTTON: showed " + shown + ", pot raise is " + want); }
      await click("rAll");
      await click("rGo");
    } else await click("aCall");
    s = await settled();
    if (s.chipsTotal !== 3000) { conserved = false; console.log("LEAK at hand", s.hand, s.chipsTotal); }
  } else if (s.phase === "result") {
    if (s.hand === 2) await bit.shot("holdem-7-allin");
    await click("next");
    s = await settled();
  } else break;
}

await bit.wait(300);
await bit.shot("holdem-8-over");
s = await st();
console.log("final phase:", s.phase, "| winner:", s.winner, "| hands played:", s.hand,
            "| biggest pot:", s.biggest);
console.log("stacks:", s.seats.map(p => p.name + " " + p.chips + (p.out ? " (out)" : "")).join(", "));

const errs = (await bit.errors()).filter(e => !/404/.test(e));
console.log(errs.length ? "ERRORS:\n  " + errs.join("\n  ") : "errors: none");

const alive = s.seats.filter(p => !p.out).length;
const ok = boardOK && conserved && potSizing && s.phase === "over" && alive === 1 &&
           !!s.winner && errs.length === 0;
console.log(ok
  ? "PASS — a full board was dealt, the Pot button sized a real pot raise, chips stayed " +
    "conserved, and the match reached one survivor"
  : "FAIL — board5:" + boardOK + " conserved:" + conserved + " potSizing:" + potSizing +
    " phase:" + s.phase + " alive:" + alive);
await bit.close();
process.exit(ok ? 0 : 1);
