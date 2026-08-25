/*
 * Plays a real hand of Snap to a real end state.
 *
 * The case worth proving is the one the game is built around: two people slam
 * in the same instant. bit.tapTogether sends both touch points in a single
 * CDP touchStart, so the bit sees two pointerdown events in the same frame —
 * exactly what four hands landing together look like. Exactly one of them must
 * come out holding the pile.
 */
import { openBit } from "./run.mjs";

const bit = await openBit("/home/user/my-bits/snap");
const W = 390;
const fail = [];
const check = (ok, msg) => { console.log((ok ? "  ok   " : "  FAIL ") + msg); if (!ok) fail.push(msg); };

/** Centre of a settings pill, found in the page (rect reads are fine out here). */
const pill = (name, i) => bit.probe(({ n, k }) => {
  const host = document.querySelector('[data-el="' + n + '"]');
  const r = host.querySelectorAll("button")[k].getBoundingClientRect();
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
}, { n: name, k: i });

const snap = () => bit.probe(() => {
  const s = window.__SNAP__;
  return s && {
    phase: s.phase, stock: s.stock, pile: s.pile, matchOpen: s.matchOpen,
    counts: s.counts, claims: s.claims, best: s.bestMs, winner: s.winner, baked: s.baked,
  };
});

/** Wait inside the page for a condition — one step instead of a polling loop. */
const until = (fn, ms) => bit.probe(({ src, limit }) => new Promise((res) => {
  const test = new Function("s", "return (" + src + ")(s)");
  const t0 = Date.now();
  const id = setInterval(() => {
    let hit = false;
    try { hit = !!test(window.__SNAP__); } catch (_) {}
    if (hit || Date.now() - t0 > limit) { clearInterval(id); res(hit); }
  }, 25);
}), { src: fn.toString(), limit: ms });

await bit.wait(700);
await bit.shot("snap-1-title");
console.log("baked deck art:", (await snap()).baked);

/* --- Blitz, so a 52-card deck finishes inside a headless run. --- */
await bit.tap(361, 121);                                  // cog
await bit.wait(260);
await bit.shot("snap-2-settings");
const blitz = await pill("speeds", 2);
await bit.tap(blitz.x, blitz.y);
await bit.wait(150);
const done = await bit.probe(() => {
  const r = document.querySelector('[data-el="cogp-close"]').getBoundingClientRect();
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
});
await bit.tap(done.x, done.y);
await bit.wait(180);

/* --- Deal. --- */
await bit.tap(W / 2, 759);
check(await until((s) => s && s.phase === "playing", 6000), "reached the playing phase");
await bit.wait(400);
await bit.shot("snap-3-deal");

const padB = await bit.probe(() => window.__SNAP__.pad("bottom"));
const padT = await bit.probe(() => window.__SNAP__.pad("top"));

/* --- THE TEST: two hands land in the same frame on a live match. --- */
check(await until((s) => s && s.matchOpen, 20000), "a match window opened");
const pileBefore = (await snap()).pile;
await bit.tapTogether([{ x: padB.x, y: padB.y }, { x: padT.x, y: padT.y }]);
await bit.wait(300);
await bit.shot("snap-4-slam");

let st = await snap();
const snaps = st.claims.filter((c) => c.verdict === "snap");
const lates = st.claims.filter((c) => c.verdict === "late");
check(snaps.length === 1, "exactly one winner from a simultaneous slam (got " + snaps.length + ")");
check(lates.length >= 1, "the other hand was recorded late, not penalised (got " + lates.length + ")");
// The pile is not asserted empty: at this speed the next card may already have
// been dealt onto it. What must hold is that the winner banked every card that
// was on the table, and that the loser paid nothing.
const won = st.counts.find((c) => c.seat === snaps[0].seat);
const lost = st.counts.find((c) => c.seat === lates[0].seat);
check(won.cards === pileBefore, "the winner took the whole pile (" + won.cards + " of " + pileBefore + ")");
check(lost.cards === 0 && lost.lock === 0, "the late hand was not penalised");
console.log("  claims:", JSON.stringify(st.claims));

/* --- A false snap must cost a card and lock that pad. --- */
check(await until((s) => s && !s.matchOpen && s.pile > 0, 8000), "table has cards and no match open");
const before = (await snap()).counts;
await bit.tap(padB.x, padB.y);
await bit.wait(220);
st = await snap();
const bIdx = st.counts.findIndex((c) => c.seat === "bottom");
const wasBottomWinner = before[bIdx].cards > 0;
check(st.claims.some((c) => c.verdict === "false"), "the slam was judged a false snap");
check(!wasBottomWinner || st.counts[bIdx].cards === before[bIdx].cards - 1,
  "false snap forfeited a card (" + before[bIdx].cards + " -> " + st.counts[bIdx].cards + ")");
check(st.counts[bIdx].lock > 0, "that pad locked out");
await bit.shot("snap-5-false");

/* --- Run the deck out. Slam whenever a match opens, alternating ends. --- */
for (let i = 0; i < 14; i++) {
  const got = await until((s) => s && (s.matchOpen || s.phase === "over"), 4200);
  const now = await snap();
  if (now.phase === "over") break;
  if (got) {
    const p = i % 2 ? padT : padB;
    await bit.tap(p.x, p.y);
  }
  if (i === 6) await bit.shot("snap-6-midgame");
}
check(await until((s) => s && s.phase === "over", 26000), "the hand reached its end state");

await bit.wait(400);
await bit.shot("snap-7-over");

st = await snap();
console.log("state:", JSON.stringify({
  phase: st.phase, winner: st.winner, best: st.best, stock: st.stock,
  counts: st.counts.map((c) => c.name + ":" + c.cards),
}));
check(st.stock === 0, "the stock ran out");
check(st.counts.reduce((a, c) => a + c.cards, 0) + st.pile === 52, "all 52 cards are accounted for");
check(st.best > 0, "a fastest-snap reaction was recorded (" + st.best + " ms)");

const kinds = await bit.eventKinds();
const tally = {};
for (const k of kinds) tally[k] = (tally[k] || 0) + 1;
console.log("events:", JSON.stringify(tally));
check(kinds.includes("complete"), "ctx.platform.complete fired");
check(kinds.includes("memory.record.submit"), "the record was submitted");

const errs = (await bit.errors()).filter((e) => !/404/.test(e));
console.log(errs.length ? "ERRORS:\n  " + errs.join("\n  ") : "errors: none");
console.log(fail.length ? "\nFAILED " + fail.length + " check(s)" : "\nall checks passed");
await bit.close();
process.exit(fail.length || errs.length ? 1 : 0);
