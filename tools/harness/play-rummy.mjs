/*
 * Plays Gin Rummy for real — two whole matches, hand after hand, until
 * somebody actually crosses the target and the match sheet appears.
 *
 * Every move is a genuine touch through CDP: the handover cover, the pile, the
 * card in the fan, the button. Nothing pokes the state. The script polls the
 * bit's `busy` flag rather than sleeping, because a move commits its state
 * change immediately and THEN animates — a script that waits on the state taps
 * into a board that is still settling and the input is silently dropped.
 *
 * Both seats are played by the same greedy policy: take the upcard only when it
 * lowers your deadwood, otherwise draw blind; throw whichever card leaves the
 * least behind; knock the moment you are at ten or under. The policy asks the
 * bit's own rules engine what a hand is worth (`evaluate`, a read-only query),
 * so the script is a second consumer of the shipped engine rather than a
 * reimplementation that could quietly disagree with it.
 *
 * What it asserts:
 *   - a throw always lands behind the handover cover — the next player's hand
 *     is never on screen for whoever is still holding the phone;
 *   - the upcard cannot be thrown straight back on the turn it was taken;
 *   - nobody knocks over ten, and lay-offs never raise the defender's deadwood;
 *   - the settlement matches the rules: a knock pays the difference, gin pays
 *     the defender's whole hand plus 25 with no lay-offs, an undercut pays the
 *     other way;
 *   - both matches reach a real end state with a winner past the target;
 *   - a short house match records nothing, and a full hundred-point match
 *     records the number of hands it took.
 */
import { openBit } from "./run.mjs";

const RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
const rankOf = (id) => RANKS.indexOf(id.slice(0, id.length - 1));
const valueOf = (id) => (rankOf(id) >= 9 ? 10 : rankOf(id) + 1);

const bit = await openBit("/home/user/my-bits/rummy");
const shots = [];
const shot = async (n) => { shots.push(await bit.shot("rummy-" + n)); };
let fails = 0;
const check = (ok, msg) => { console.log((ok ? "  ok   " : "  FAIL ") + msg); if (!ok) fails++; };

const st = () => bit.probe(() => {
  const R = window.__RUMMY__;
  return {
    phase: R.phase, busy: R.busy, turn: R.turn, handNo: R.handNo, stock: R.stock,
    discardTop: R.discardTop, scores: R.scores, names: R.names, took: R.took,
    selected: R.selected, show: R.show, result: R.result, winner: R.winner,
    zones: R.zones(), hands: [R.hand(0), R.hand(1)],
  };
});
async function settle(label) {
  // Poll a two-field probe, not the whole state: a full read per poll is most
  // of the wall clock in a game this long.
  for (let i = 0; i < 400; i++) {
    if (!(await bit.probe(() => window.__RUMMY__.busy))) return st();
    await bit.wait(20);
  }
  throw new Error("stuck busy at " + label);
}

/**
 * One round trip for the whole draw decision.
 *
 * Asking the bit to price eleven candidate hands one call at a time is twelve
 * round trips per turn and, over two matches, most of the runtime. The loop
 * belongs inside the page.
 */
const shouldTakeUpcard = (hand, top) => bit.probe(([h, t]) => {
  const R = window.__RUMMY__;
  const before = R.evaluate(h);
  const withTop = h.concat([t]);
  let best = 99;
  for (const c of withTop) {
    const d = R.evaluate(withTop.filter((x) => x !== c));
    if (d < best) best = d;
  }
  return best < before;
}, [hand, top]);
const outcomes = () => bit.probe(() => window.__RUMMY__.outcomes());
const pile = (w) => bit.probe((c) => window.__RUMMY__.pile(c), w);
async function tapCard(id) {
  const p = await bit.probe((c) => window.__RUMMY__.tapXY(c), id);
  if (!p) throw new Error("no reachable tap point for " + id);
  await bit.tap(p.x, p.y);
}

const tally = {
  turns: 0, knocks: 0, gins: 0, undercuts: 0, dead: 0,
  covered: 0, layoffs: 0, upcardsTaken: 0, lockedRefusals: 0,
};

/**
 * Play one match through to its end sheet. `snap` screenshots the first knock,
 * lay-off and result sheet it meets.
 */
async function playMatch(snap) {
  const stockPos = await pile("stock");
  const discPos = await pile("discard");
  let guard = 0;

  for (;;) {
    if (++guard > 900) throw new Error("match never ended");
    const s = await settle("loop");

    if (s.phase === "over") return s;
    if (s.phase === "throwing" || s.phase === "deal") { await bit.wait(50); continue; }

    if (s.phase === "handoff") {
      await bit.page.click('[data-el="cover-go"]');
      await settle("reveal");
      continue;
    }

    if (s.phase === "draw") {
      tally.turns++;
      const take = await shouldTakeUpcard(s.hands[s.turn], s.discardTop);
      if (take) tally.upcardsTaken++;
      await bit.tap(take ? discPos.x : stockPos.x, stockPos.y);
      const after = await settle("draw");
      if (after.hands[after.turn].length !== 11) {
        check(false, "drawing should put an eleventh card in hand, got " + after.hands[after.turn].length);
      }
      continue;
    }

    if (s.phase === "discard") {
      const outs = await outcomes();
      if (s.took && tally.lockedRefusals === 0) {
        // The card just lifted off the pile must refuse to go straight back.
        await tapCard(s.took);
        await bit.wait(80);
        const t = await st();
        check(t.selected !== s.took, "the just-taken upcard cannot be thrown back the same turn");
        tally.lockedRefusals++;
      }
      const legal = outs.filter((o) => !o.locked)
        .sort((a, b) => a.deadwood - b.deadwood || valueOf(b.id) - valueOf(a.id));
      const pick = legal[0];
      await tapCard(pick.id);
      await bit.wait(70);
      const chose = await st();
      if (chose.selected !== pick.id) {
        check(false, "tapping " + pick.id + " selected " + chose.selected);
        throw new Error("selection went wrong");
      }

      const knocking = pick.deadwood <= 10;
      await bit.page.click(knocking
        ? (pick.deadwood === 0 ? '[data-el="b-gin"]' : '[data-el="b-knock"]')
        : '[data-el="b-discard"]');
      const after = await settle("throw");
      if (!knocking) {
        if (after.phase === "handoff" || after.phase === "throwing" || after.phase === "result") {
          tally.covered++;
        } else {
          check(false, "a throw must land behind the cover, not on the next hand (was " + after.phase + ")");
        }
      }
      const both = after.hands[0].concat(after.hands[1]);
      if (new Set(both).size !== both.length) check(false, "a card is in both hands at once");
      if (both.length + after.stock > 52) check(false, "more than 52 cards are in play");
      continue;
    }

    if (s.phase === "knock") {
      tally.knocks++;
      if (s.show.gin) tally.gins++;
      if (snap && tally.knocks === 1) await shot("3-knock");
      if (s.show.kDeadwood > 10) check(false, "knocked at " + s.show.kDeadwood + ", which is over ten");
      await bit.page.click('[data-el="b-tolayoff"]');
      await settle("to lay-off");
      continue;
    }

    if (s.phase === "layoff") {
      const before = s.show.dDeadwood;
      const one = s.zones.find((z) => z.startsWith("lay:"));
      if (one) {                                   // lay one off by hand first
        await tapCard(one.slice(4));
        await settle("one lay-off");
      }
      if (snap && tally.layoffs === 0) await shot("4-layoff");
      if (await bit.page.locator('[data-el="b-layall"]').count()) {
        await bit.page.click('[data-el="b-layall"]');
        await settle("lay all");
      }
      const mid = await st();
      if (mid.show.dDeadwood > before) check(false, "lay-offs raised the defender's deadwood");
      tally.layoffs++;
      await bit.page.click('[data-el="b-settle"]');
      await settle("settle");
      continue;
    }

    if (s.phase === "result") {
      const r = s.result;
      if (r.dead) {
        tally.dead++;
      } else {
        const expected = r.gin ? r.dDeadwood + 25
          : r.dDeadwood <= r.kDeadwood ? (r.kDeadwood - r.dDeadwood) + 25
          : r.dDeadwood - r.kDeadwood;
        check(r.points === expected,
              "hand " + r.hand + ": " + (r.gin ? "gin" : r.undercut ? "undercut" : "knock") +
              " " + r.kDeadwood + " v " + r.dDeadwood + " pays " + r.points);
        if (r.undercut) {
          tally.undercuts++;
          check(r.seat !== r.knocker, "an undercut pays the defender, not the knocker");
        }
        if (r.gin) check(r.seat === r.knocker, "gin pays the knocker");
      }
      if (snap && !shots.some((p) => p.includes("5-result"))) await shot("5-result");
      await bit.page.click('[data-el="sheet-go"]');
      await settle("next hand");
      continue;
    }

    throw new Error("unexpected phase " + s.phase);
  }
}

/* ---- a short house match, first to fifty ---------------------------- */
await bit.wait(700);
await shot("1-title");

await bit.page.click('[data-el="menu-cog"]');
await bit.wait(200);
await bit.page.click('[data-el="tc"] button[data-v="50"]');
await bit.page.click('[data-el="cogp-close"]');
await bit.wait(150);
await bit.page.fill('[data-el="n0"]', "Ines");
await bit.page.fill('[data-el="n1"]', "Otto");
await bit.page.click('[data-el="go"]');
await bit.wait(1300);
await shot("2-handover");

const first = await settle("first cover");
check(first.phase === "handoff", "the deal ends behind a handover cover, not on somebody's hand");
check(first.names[0] === "Ines" && first.names[1] === "Otto", "the names entered are the names used");

const short = await playMatch(true);
await shot("6-match");
console.log("\nshort match — hands:", short.handNo, "scores:", JSON.stringify(short.scores),
            "| turns:", tally.turns, "knocks:", tally.knocks, "gins:", tally.gins,
            "undercuts:", tally.undercuts, "dead hands:", tally.dead);

check(short.phase === "over", "the match reached a real end state");
check(Math.max(...short.scores) >= 50, "somebody crossed fifty (" + short.scores.join(" v ") + ")");
check(short.winner === (short.scores[0] >= short.scores[1] ? 0 : 1), "the higher score is the winner");
check(tally.covered === tally.turns - tally.knocks, "every throw that was not a knock went behind the cover");
check(tally.layoffs === tally.knocks - tally.gins, "every knock that was not gin passed through lay-off");
check(tally.lockedRefusals >= 1, "the upcard-return rule was exercised");
check(tally.upcardsTaken >= 1, "the discard pile was drawn from at least once");

const log = () => bit.probe(() => window.__BIT_LOG__.map((e) => ({ kind: e.kind, args: e.args })));
let events = await log();
check(events.some((e) => e.kind === "complete"), "the bit told the platform the match completed");
check(!events.some((e) => e.kind === "memory.record.submit"),
      "a fifty-point house match records nothing — the board is fewest hands to ONE HUNDRED");

/* ---- and now the real thing, first to a hundred --------------------- */
await bit.page.click('[data-el="over-menu"]');
await bit.wait(250);
await bit.page.click('[data-el="menu-cog"]');
await bit.wait(200);
await bit.page.click('[data-el="tc"] button[data-v="100"]');
await bit.page.click('[data-el="cogp-close"]');
await bit.wait(150);
await bit.page.click('[data-el="go"]');
await bit.wait(1300);

const full = await playMatch(false);
await shot("7-hundred");
console.log("hundred match — hands:", full.handNo, "scores:", JSON.stringify(full.scores));
check(full.phase === "over" && Math.max(...full.scores) >= 100,
      "the hundred-point match also reaches a real end state (" + full.scores.join(" v ") + ")");

events = await log();
const rec = events.find((e) => e.kind === "memory.record.submit");
check(!!rec && rec.args[0] === "fewest_hands", "and it submits to the fewest_hands board");
check(!!rec && rec.args[1] === full.handNo,
      "the value recorded is the number of hands it took (" + (rec && rec.args[1]) + ")");

const errs = (await bit.errors()).filter((e) => !/404/.test(e));
console.log(errs.length ? "ERRORS:\n  " + errs.join("\n  ") : "\nerrors: none");
console.log("shots:\n  " + shots.join("\n  "));
await bit.close();
console.log(fails ? "\n" + fails + " FAILED" : "\nall play checks passed");
process.exit(fails || errs.length ? 1 : 0);
