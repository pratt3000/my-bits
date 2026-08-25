/*
 * Plays a real game of Ratscrew to a real end state.
 *
 * The case the whole bit is built around is everybody slapping in the same
 * instant. bit.tapTogether sends every touch point in a single CDP touchStart,
 * so the bit sees three pointerdown events in the same frame — exactly what
 * three hands landing together look like. Exactly one of them must come out
 * holding the pile, and the other two must pay nothing.
 *
 * Everything else here polls the bit's `busy` flag rather than sleeping. A flip
 * commits instantly and then animates, and a tap that arrives inside that
 * animation is either dropped (your own flip) or judged a burn (somebody
 * else's) — a fixed sleep would make this script's results depend on the frame
 * rate of a SwiftShader build.
 */
import { openBit } from "./run.mjs";

const bit = await openBit("/home/user/my-bits/ratscrew");
const W = 390;
const fail = [];
const check = (ok, msg) => { console.log((ok ? "  ok   " : "  FAIL ") + msg); if (!ok) fail.push(msg); };

const rs = () => bit.probe(() => {
  const s = window.__RATSCREW__;
  return s && {
    phase: s.phase, busy: s.busy, pile: s.pile, slap: s.slap, turn: s.turn,
    tribute: s.tribute, collecting: s.collecting, counts: s.counts,
    claims: s.claims, best: s.bestMs, winner: s.winner, deckN: s.deckN,
    total: s.total, baked: s.baked, paused: s.paused,
  };
});

/**
 * Wait inside the page for a condition and hand back the state at the instant
 * it became true. One step instead of a polling loop, and — the reason it
 * returns the state — no extra round trip before acting on it: a slap window
 * is open for as long as nobody takes it, but the turn moves on in 240 ms.
 */
const until = (fn, ms) => bit.probe(({ src, limit }) => new Promise((res) => {
  const test = new Function("s", "return (" + src + ")(s)");
  const t0 = Date.now();
  const id = setInterval(() => {
    const s = window.__RATSCREW__;
    let hit = false;
    try { hit = !!test(s); } catch (_) {}
    if (hit || Date.now() - t0 > limit) {
      clearInterval(id);
      res({ ok: hit, phase: s && s.phase, pile: s && s.pile, slap: s && s.slap,
            turn: s && s.turn, counts: s && s.counts, busy: s && s.busy,
            claims: s ? s.claims : [] });
    }
  }, 16);
}), { src: fn.toString(), limit: ms });
const reached = async (fn, ms) => (await until(fn, ms)).ok;

const dom = (sel) => bit.probe((s) => {
  const n = document.querySelector(s);
  if (!n) return null;
  const r = n.getBoundingClientRect();
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
}, sel);
const pill = (name, i) => bit.probe(({ n, k }) => {
  const r = document.querySelector('[data-el="' + n + '"]').querySelectorAll("button")[k].getBoundingClientRect();
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
}, { n: name, k: i });

await bit.wait(700);
await bit.shot("ratscrew-1-title");
console.log("baked deck art:", (await rs()).baked);

/* --- Settings: three players, tens on, so every rule is exercised. --- */
const cog = await dom('[data-el="cog"]');
await bit.tap(cog.x, cog.y);
await bit.wait(240);
await bit.shot("ratscrew-2-settings");
let p = await pill("counts", 1);            // 3 players
await bit.tap(p.x, p.y);
await bit.wait(120);
p = await pill("tenses", 1);                // tens slap on
await bit.tap(p.x, p.y);
await bit.wait(120);
let done = await dom('[data-el="cogp-close"]');
await bit.tap(done.x, done.y);
await bit.wait(200);

/* --- The rules panel has to open and close. --- */
const help = await dom('[data-el="help"]');
await bit.tap(help.x, help.y);
await bit.wait(260);
await bit.shot("ratscrew-3-rules");
check(await bit.probe(() => window.__RATSCREW__.paused), "the rules sheet froze the game");
done = await dom('[data-el="helpp-close"]');
await bit.tap(done.x, done.y);
await bit.wait(180);

/* --- Deal. --- */
const deal = await dom('[data-el="deal"]');
await bit.tap(deal.x, deal.y);
await bit.shot("ratscrew-3b-deal");
check(await reached((s) => s && s.phase === "play", 8000), "reached the play phase");
let st = await rs();
check(st.counts.length === 3, "three players seated (got " + st.counts.length + ")");
check(st.total === st.deckN && st.deckN === 18, "18 cards dealt, six each (got " + st.total + ")");
const pads = {};
for (const c of st.counts) pads[c.seat] = await bit.probe((s) => window.__RATSCREW__.pad(s), c.seat);

/** Throw a card from whoever's turn it is. Returns false if nobody can. */
async function flip() {
  const w = await until((s) => s && !s.busy && s.phase === "play", 6000);
  if (!w.ok || !w.turn) return false;
  const t = pads[w.turn];
  await bit.tap(t.x, t.y);
  return true;
}

/* --- THE TEST: three hands land in the same frame on a live table. ---
       Flip until something is slappable, then bring every pad down at once. */
let snaps = [], lates = [], pileBefore = 0, opened = false, kind = null, heldBefore = {};
for (let i = 0; i < 34 && !opened; i++) {
  // Wait for the window inside the page and act on the state it hands back.
  // Probing, deciding out here and then tapping costs a whole round trip, and
  // under load that was long enough for the table to move on — the fingers
  // landed on a pile that had already been claimed and were judged burns.
  const s = await until((x) => x && (x.slap || !x.busy || x.phase !== "play"), 6000);
  if (s.slap) {
    opened = true; pileBefore = s.pile; kind = s.slap;
    for (const c of s.counts) heldBefore[c.seat] = c.cards;
    // Only the claims from this instant on. Earlier in the game a swept-up
    // tribute also opens a grace window, and hands that landed in that one are
    // legitimately logged late — counting them here would pass the test for
    // the wrong reason.
    const mark = s.claims.length;
    // The live table, before anybody has taken it: gold ring, gold plate, and
    // a gold outline on the two cards that actually made the condition.
    await bit.shot("ratscrew-4a-live");
    // All three seats, one CDP touchStart: three pointerdown events in the same
    // frame, which is what three hands landing together actually looks like.
    await bit.tapTogether(s.counts.map((c) => ({ x: pads[c.seat].x, y: pads[c.seat].y })));
    const c = (await bit.probe(() => window.__RATSCREW__.claims)).slice(mark);
    snaps = c.filter((x) => x.verdict === "slap");
    lates = c.filter((x) => x.verdict === "late");
    console.log("  simultaneous claims:", JSON.stringify(c));
    break;
  }
  if (s.phase !== "play") break;
  if (!s.turn) { await bit.wait(120); continue; }
  await bit.tap(pads[s.turn].x, pads[s.turn].y);
}
check(opened, "a slap window opened (" + kind + ")");
await bit.wait(260);
await bit.shot("ratscrew-4-slam");

st = await rs();
check(snaps.length === 1, "exactly one winner from a simultaneous slap (got " + snaps.length + ")");
check(lates.length >= 2, "the other two hands were recorded late, not burned (got " + lates.length + ")");
if (snaps.length === 1 && lates.length >= 1) {
  const won = st.counts.find((c) => c.seat === snaps[0].seat);
  const lost = st.counts.find((c) => c.seat === lates[0].seat);
  check(won.cards === heldBefore[won.seat] + pileBefore,
    "the winner banked the whole pile of " + pileBefore +
    " (" + heldBefore[won.seat] + " -> " + won.cards + ")");
  check(lost.cards === heldBefore[lost.seat] && lost.lock === 0,
    "the late hand paid nothing (" + heldBefore[lost.seat] + " -> " + lost.cards + ")");
}
console.log("  claims:", JSON.stringify(st.claims));

/* --- A hand that comes down on nothing must burn a card and lock the pad. --- */
check(await reached((s) => s && !s.slap && !s.busy && s.phase === "play", 6000), "table is quiet again");
const quiet = await rs();
const before = quiet.counts;
const victim = before.find((c) => c.seat !== quiet.turn && !c.out) || before[0];
if (!victim) {
  console.log("  FAIL no live pad to test a burn with — the deal never happened");
  fail.push("no live pad");
  await bit.close();
  process.exit(1);
}
await bit.tap(pads[victim.seat].x, pads[victim.seat].y);
await bit.wait(90);
// Probe before the screenshot. A page.screenshot on SwiftShader takes most of
// a second, so the pad's lockout can expire inside the capture itself and the
// assertion afterwards reads a pad that has already come back to life.
st = await rs();
const nowV = st.counts.find((c) => c.seat === victim.seat);
check(st.claims.some((c) => c.verdict === "burn"), "the hand was judged a burn");
check(nowV.cards === victim.cards - 1, "the burn cost a card (" + victim.cards + " -> " + nowV.cards + ")");
check(nowV.lock > 0, "that pad locked out");
await bit.shot("ratscrew-5-burn");

/* --- Tribute: keep flipping until a face card puts somebody in debt. --- */
let sawTribute = false;
for (let i = 0; i < 26 && !sawTribute; i++) {
  const s = await rs();
  if (s.phase !== "play") break;
  if (s.tribute) { sawTribute = true; await bit.shot("ratscrew-6-tribute"); break; }
  if (s.slap) { await bit.tap(pads[s.counts.find((c) => !c.out).seat].x, pads[s.counts.find((c) => !c.out).seat].y); await bit.wait(120); continue; }
  if (!(await flip())) break;
}
check(sawTribute, "a face card put somebody in tribute");
check((await bit.eventKinds()).length > 0, "the bit is talking to the platform");

/* --- Run the game out. Slap whatever is live, otherwise throw a card. ---
       One in-page wait per action rather than a probe and then a wait: on
       SwiftShader every round trip out to Node costs more than the frame it is
       asking about, and a hundred-move game turns into ten minutes of latency. */
let shotMid = false;
for (let i = 0; i < 220; i++) {
  const w = await until((s) => s && (s.phase !== "play" || s.slap || !s.busy), 4000);
  if (!w.phase || w.phase === "over" || w.phase === "resolve") break;
  if (w.slap) {
    // Whoever is not locked takes it, so the piles actually move around.
    const taker = w.counts.find((c) => !c.out && c.lock === 0) || w.counts.find((c) => !c.out);
    await bit.tap(pads[taker.seat].x, pads[taker.seat].y);
    continue;
  }
  if (!shotMid && w.pile >= 4) { await bit.shot("ratscrew-7-midgame"); shotMid = true; }
  if (w.ok && w.turn) await bit.tap(pads[w.turn].x, pads[w.turn].y);
  else await bit.wait(120);
  if (i && i % 60 === 0) console.log("  ... move " + i + ", pile " + w.pile);
}
check(await reached((s) => s && s.phase === "over", 12000), "the game reached its end state");
await bit.wait(500);
await bit.shot("ratscrew-8-over");

st = await rs();
console.log("state:", JSON.stringify({
  phase: st.phase, winner: st.winner, best: st.best, deckN: st.deckN,
  counts: st.counts.map((c) => c.name + ":" + c.cards + (c.out ? "(out)" : "")),
}));
check(st.winner !== null, "a winner was named");
check(st.counts.filter((c) => !c.out).length === 1, "exactly one player is still holding cards");
check(st.total === st.deckN, "every dealt card is accounted for (" + st.total + " of " + st.deckN + ")");
check(st.best > 0, "a fastest-slap reaction was recorded (" + st.best + " ms)");

const kinds = await bit.eventKinds();
const tally = {};
for (const k of kinds) tally[k] = (tally[k] || 0) + 1;
console.log("events:", JSON.stringify(tally));
check(kinds.includes("complete"), "ctx.platform.complete fired");
check(kinds.includes("memory.record.submit"), "the record was submitted");
check(kinds.includes("music.play"), "the music bed started");

/* --- The rematch path has to work from the end state. --- */
const again = await dom('[data-el="again"]');
await bit.tap(again.x, again.y);
check(await reached((s) => s && s.phase === "play" && s.total === s.deckN, 6000), "rematch dealt a fresh game");
st = await rs();
check(st.counts.every((c) => !c.out && c.cards === 6), "rematch reset every stack to six");
await bit.shot("ratscrew-9-rematch");

const errs = (await bit.errors()).filter((e) => !/404/.test(e));
console.log(errs.length ? "ERRORS:\n  " + errs.join("\n  ") : "errors: none");
console.log(fail.length ? "\nFAILED " + fail.length + " check(s)" : "\nall checks passed");
await bit.close();
process.exit(fail.length || errs.length ? 1 : 0);
