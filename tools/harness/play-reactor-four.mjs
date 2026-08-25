/*
 * Drives a real four-player match of Reactor Four to a real end state.
 *
 * The interesting cases here are the ones a single-pointer harness cannot see:
 * four fingers arming four stations in the same frame, a slap landing while the
 * signal is false (which must scram that station and nobody else), and two
 * hands racing the same true signal (only the first may score).
 */
import { openBit } from "./run.mjs";

const bit = await openBit("/home/user/my-bits/reactor-four");
const W = 390, H = 844;
const probe = (fn) => bit.probe(fn);

/** Park inside the page until the bit reports a state, so each round costs
 *  one round trip instead of a poll storm. */
const until = (expr, ms = 20000) => bit.probe(([e, m]) => new Promise((res) => {
  const test = new Function("R", "return " + e);
  const t = setInterval(() => {
    const R = window.__REACTOR__;
    if (R && test(R)) { clearInterval(t); clearTimeout(k); res(true); }
  }, 12);
  const k = setTimeout(() => { clearInterval(t); res(false); }, m);
}), [expr, ms]);

await bit.wait(700);
await bit.shot("r4-1-title");

// --- chrome panels ---------------------------------------------------------
await bit.tap(365, 105);                       // settings
await bit.wait(320);
await bit.shot("r4-0a-settings");
await bit.tap(195, 520);                       // done
await bit.wait(250);
await bit.tap(365, 145);                       // how to play
await bit.wait(320);
await bit.shot("r4-0b-help");
await bit.tap(195, 640);
await bit.wait(250);

// --- crew picker: four stations -------------------------------------------
await bit.tap(293, 543);
await bit.wait(500);
await bit.shot("r4-2-stations");

const taps = await probe(() => window.__REACTOR__.taps());
console.log("tap points:", JSON.stringify(taps));

// Four fingers land in the same frame. Each must arm its own station and no
// other — the case that breaks a shared-screen game if pointers are not bound
// to a zone on pointerdown.
await bit.tapTogether(taps);
await bit.wait(220);
console.log("armed after simultaneous tap:",
  JSON.stringify(await probe(() => window.__REACTOR__.armedStations)));

await until("R.phase === 'brief'", 4000);
await bit.shot("r4-3-brief");
console.log("phase when the brief shot landed:",
  await probe(() => window.__REACTOR__.phase));

// --- a deliberate false start on the left station -------------------------
// Slapping while the signal is false must lock that station and nobody else.
await until("R.phase === 'charge'", 8000);
await bit.shot("r4-4-charge");
let scrammed = false;
for (let a = 0; a < 5 && !scrammed; a++) {
  await until("R.phase === 'charge' && R.live === false", 26000);
  await bit.tap(taps[2].x, taps[2].y);
  await bit.wait(240);
  scrammed = (await probe(() => window.__REACTOR__.locked))[2];
  if (!scrammed) await until("R.phase === 'charge'", 26000);
}
console.log("false start ->", scrammed ? "station 3 scrammed" : "NEVER SCRAMMED",
  "locked:", JSON.stringify(await probe(() => window.__REACTOR__.locked)),
  "scores:", JSON.stringify(await probe(() => window.__REACTOR__.scores)));
await bit.shot("r4-5-scram");

// --- let one true signal pass untouched: the hold window must expire and
// --- the round must fall back to decoys rather than freezing --------------
await until("R.live === true", 26000);
await bit.shot("r4-6-armed");
await until("R.phase === 'charge'", 8000);
console.log("after an ignored signal, phase is:",
  await probe(() => window.__REACTOR__.phase), "(expected charge)");

// --- play out the match: station 1 (bottom) takes every true signal --------
let shotMid = false;
for (let r = 0; r < 22; r++) {
  const st = await probe(() => ({ phase: window.__REACTOR__.phase, scores: window.__REACTOR__.scores }));
  if (st.phase === "over") break;

  const live = await until("R.live === true || R.phase === 'over'", 26000);
  if (!live) { console.log("timed out waiting for a true signal"); break; }
  if (await probe(() => window.__REACTOR__.phase === "over")) break;

  // Two hands race the same signal in the same frame; only the first may score.
  if (r === 1) await bit.tapTogether([taps[0], taps[1]]);
  else await bit.tap(taps[0].x, taps[0].y);

  await bit.wait(240);
  const after = await probe(() => ({
    scores: window.__REACTOR__.scores, round: window.__REACTOR__.round,
    kind: window.__REACTOR__.kind, best: window.__REACTOR__.bestReaction,
  }));
  console.log(`round ${after.round} (${after.kind}) -> ${JSON.stringify(after.scores)} best=${after.best}ms`);
  if (!shotMid && after.round >= 3) { await bit.shot("r4-7-resolve"); shotMid = true; }
  await until("R.phase !== 'resolve'", 6000);
}

await until("R.phase === 'over'", 12000);
await bit.wait(700);
await bit.shot("r4-8-over");

const final = await probe(() => ({
  phase: window.__REACTOR__.phase, winner: window.__REACTOR__.winner,
  scores: window.__REACTOR__.scores, best: window.__REACTOR__.bestReaction,
  falseStarts: window.__REACTOR__.falseStarts, target: window.__REACTOR__.target,
}));
console.log("final:", JSON.stringify(final));

const kinds = await bit.eventKinds();
const tally = {};
for (const k of kinds) tally[k] = (tally[k] || 0) + 1;
console.log("events:", JSON.stringify(tally));

const submits = (await bit.events()).filter(e => e.kind === "memory.record.submit");
console.log("leaderboard submits:", JSON.stringify(submits.map(e => e.args)));

// --- rematch path ----------------------------------------------------------
await bit.tap(W / 2, 552);
await bit.wait(600);
console.log("after rematch:", JSON.stringify(await probe(() => ({
  phase: window.__REACTOR__.phase, scores: window.__REACTOR__.scores,
}))));
await bit.shot("r4-9-rematch");

const ok = final.phase === "over" && final.winner >= 0 &&
  final.scores[final.winner] >= final.target && scrammed;
console.log(ok ? "PASS: match reached its win condition" : "FAIL: never reached a win");

const errs = (await bit.errors()).filter(e => !/404/.test(e));
console.log(errs.length ? "ERRORS:\n  " + errs.join("\n  ") : "errors: none");
await bit.close();
process.exit(ok && !errs.length ? 0 : 1);
