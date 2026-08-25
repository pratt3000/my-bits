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
    counts: s.counts, claims: s.claims, best: s.bestMs, winner: s.winner,
    baked: s.baked, paused: s.paused,
  };
});

/**
 * Wait inside the page for a condition and hand back the state at the instant
 * it became true. One step instead of a polling loop, and — the reason it
 * returns the state — no extra round trip before acting on it: a match window
 * at Blitz speed is half a second long and a second probe can outlast it.
 */
const until = (fn, ms) => bit.probe(({ src, limit }) => new Promise((res) => {
  const test = new Function("s", "return (" + src + ")(s)");
  const t0 = Date.now();
  const id = setInterval(() => {
    const s = window.__SNAP__;
    let hit = false;
    try { hit = !!test(s); } catch (_) {}
    if (hit) { clearInterval(id); res({ ok: true, pile: s.pile, phase: s.phase, counts: s.counts }); }
    else if (Date.now() - t0 > limit) { clearInterval(id); res({ ok: false }); }
  }, 20);
}), { src: fn.toString(), limit: ms });
const reached = async (fn, ms) => (await until(fn, ms)).ok;

await bit.wait(700);
await bit.shot("snap-1-title");
console.log("baked deck art:", (await snap()).baked);

const cog = await bit.probe(() => {
  const r = document.querySelector('[data-el="cog"]').getBoundingClientRect();
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
});
const doneBtn = async () => bit.probe(() => {
  const r = document.querySelector('[data-el="cogp-close"]').getBoundingClientRect();
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
});
/** Open settings, hit one pill, close again. */
async function setSpeed(i) {
  await bit.tap(cog.x, cog.y);
  await bit.wait(220);
  const b = await pill("speeds", i);
  await bit.tap(b.x, b.y);
  await bit.wait(120);
  return b;
}

/* --- Slow first: the simultaneous-slam test needs a window wide enough to
       survive the round trip out to Node and back through CDP. --- */
await setSpeed(0);
await bit.shot("snap-2-settings");
let done = await doneBtn();
await bit.tap(done.x, done.y);
await bit.wait(180);

/* --- Deal. --- */
await bit.tap(W / 2, 759);
check(await reached((s) => s && s.phase === "playing", 9000), "reached the playing phase");
await bit.wait(400);
await bit.shot("snap-3-deal");

const padB = await bit.probe(() => window.__SNAP__.pad("bottom"));
const padT = await bit.probe(() => window.__SNAP__.pad("top"));

/* --- THE TEST: two hands land in the same frame on a live match. --- */
let pileBefore = 0, snaps = [], lates = [], opened = false;
for (let attempt = 0; attempt < 4 && snaps.length === 0; attempt++) {
  const w = await until((s) => s && s.matchOpen, 20000);
  if (!w.ok) break;
  opened = true;
  pileBefore = w.pile;
  await bit.tapTogether([{ x: padB.x, y: padB.y }, { x: padT.x, y: padT.y }]);
  const c = await bit.probe(() => window.__SNAP__.claims);
  snaps = c.filter((x) => x.verdict === "snap");
  lates = c.filter((x) => x.verdict === "late");
}
check(opened, "a match window opened");
await bit.wait(300);
await bit.shot("snap-4-slam");

let st = await snap();
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
check(await reached((s) => s && !s.matchOpen && s.pile > 0, 8000), "table has cards and no match open");
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

/* --- A sheet must freeze the hand, then Blitz to run the deck out. --- */
await bit.tap(cog.x, cog.y);
await bit.wait(260);
const frozen = (await snap()).stock;
await bit.wait(1600);
const stillFrozen = await snap();
check(stillFrozen.paused && stillFrozen.stock === frozen, "settings froze the hand (" + frozen + " -> " + stillFrozen.stock + ")");
const blitz = await pill("speeds", 2);
await bit.tap(blitz.x, blitz.y);
await bit.wait(120);
done = await doneBtn();
await bit.tap(done.x, done.y);
await bit.wait(200);
check(!(await snap()).paused, "closing settings resumed the hand");

/* --- Run the deck out. Slam whenever a match opens, alternating ends. --- */
for (let i = 0; i < 16; i++) {
  const got = await reached((s) => s && (s.matchOpen || s.phase === "over"), 4200);
  const now = await snap();
  if (now.phase === "over") break;
  if (got) {
    const p = i % 2 ? padT : padB;
    await bit.tap(p.x, p.y);
  }
  if (i === 6) await bit.shot("snap-6-midgame");
}
check(await reached((s) => s && s.phase === "over", 26000), "the hand reached its end state");

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

/* --- The rematch path has to work from the end state. --- */
const again = await bit.probe(() => {
  const r = document.querySelector('[data-el="again"]').getBoundingClientRect();
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
});
await bit.tap(again.x, again.y);
check(await reached((s) => s && s.phase !== "over" && s.stock === 52, 5000), "rematch dealt a fresh deck");
st = await snap();
check(st.counts.every((c) => c.cards === 0), "rematch reset every count");
await bit.shot("snap-8-rematch");

const errs = (await bit.errors()).filter((e) => !/404/.test(e));
console.log(errs.length ? "ERRORS:\n  " + errs.join("\n  ") : "errors: none");
console.log(fail.length ? "\nFAILED " + fail.length + " check(s)" : "\nall checks passed");
await bit.close();
process.exit(fail.length || errs.length ? 1 : 0);
