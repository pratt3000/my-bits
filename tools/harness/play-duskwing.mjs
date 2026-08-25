/*
 * Flies a real four-player round of Duskwing on one phone.
 *
 * The whole point of this bit is four fingers down at the same instant, each
 * one flying its own creature in its own band, so that is what this proves:
 *   1. four fingers land together during the seat-claim window and all four
 *      bands report claimed;
 *   2. with all four held, all four creatures are climbing — and with only
 *      one held, only that one is;
 *   3. a bang-bang autopilot per finger flies the round to a genuine end
 *      state, with a winner and a distance the bit worked out itself.
 *
 * Everything goes through the real UI. The only thing read out of the bit is
 * window.__DUSKWING__, which exposes nothing it does not already draw.
 */
import { openBit } from "./run.mjs";

const bit = await openBit("/home/user/my-bits/duskwing");
const P = (fn, ...a) => bit.probe(fn, ...a);
const state = () => P(() => {
  const d = window.__DUSKWING__;
  return { phase: d.phase, busy: d.busy, metres: d.metres, winner: d.winner, birds: d.birds() };
});

let fail = null;
const check = (ok, msg) => { console.log((ok ? "  ok   " : "  FAIL ") + msg); if (!ok) fail = fail || msg; };

await bit.wait(900);
console.log("shot:", await bit.shot("dusk-1-title"));

/* --- four players, take flight -------------------------------------
 * The chips are real DOM, so the harness finds them the way a finger would
 * rather than by a magic number that drifts the moment the copy changes.
 */
const at = (sel) => P((s) => {
  const el = document.querySelector(s);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
}, sel);

const four = await at('[data-el="crew"] button[data-v="4"]');
await bit.tap(four.x, four.y);
await bit.wait(220);
const layout = await P(() => window.__DUSKWING__.layout());
console.log("layout:", JSON.stringify({ U: Math.round(layout.U), WALL: Math.round(layout.WALL) }));
check((await P(() => window.__DUSKWING__.players)) === 4, "player count set to 4");

const fly = await at('[data-el="fly"]');
await bit.tap(fly.x, fly.y);                                // TAKE FLIGHT
await bit.wait(300);
check((await P(() => window.__DUSKWING__.phase)) === "claim", "claim window opened");

/* --- the test: four fingers land in the same frame ------------------ */
const zones = await P(() => [0, 1, 2, 3].map((i) => window.__DUSKWING__.zone(i)));
console.log("zones:", JSON.stringify(zones));
for (let i = 0; i < 4; i++) await bit.fingerDown(i + 1, zones[i].x, zones[i].y);
await bit.wait(260);
console.log("shot:", await bit.shot("dusk-2-claim"));
check((await state()).birds.every((b) => b.held), "all four bands hold their own finger");

/* --- wait out the countdown; a hold placed now must survive it ------ */
for (let i = 0; i < 60 && (await P(() => window.__DUSKWING__.busy)); i++) await bit.wait(100);
check((await P(() => window.__DUSKWING__.phase)) === "play", "round went live");

/* --- with all four held, all four climb ------------------------------
 * A flap is a discrete impulse at 9.5Hz, not a thrust, so vertical velocity
 * stair-steps across zero for the first few beats. Sampling once would read
 * a creature that is very much climbing as falling — so take the minimum
 * over a short window instead.
 */
const lift = [0, 0, 0, 0];
for (let k = 0; k < 5; k++) {
  const st = await state();
  for (const b of st.birds) lift[b.i] = Math.min(lift[b.i], b.vn);
  await bit.wait(70);
}
check(lift.every((v) => v < -0.15), "all four creatures climb while all four are held: " + JSON.stringify(lift.map((v) => v.toFixed(2))));

/* --- lift three: only the remaining one should still be climbing ----- */
for (const id of [1, 2, 3]) await bit.fingerUp(id);
await bit.wait(320);
const solo = (await state()).birds.map((b) => (b.vn < -0.05 ? "up" : b.vn > 0.05 ? "down" : "flat"));
check(solo[3] === "up" && solo[0] === "down" && solo[1] === "down" && solo[2] === "down",
      "only the held band climbs, the other three fall: " + JSON.stringify(solo));
for (const id of [1, 2, 3]) await bit.fingerDown(id, zones[id - 1].x, zones[id - 1].y);

/* --- fly the round ----------------------------------------------------
 * One bang-bang autopilot per finger, each with its own target height so the
 * four creatures die at four different distances and the round has a real
 * winner. Only a changed hold sends an event, which keeps the step count down.
 */
const held = [true, true, true, true];
const aim = [0.42, 0.50, 0.58, 0.46];
let mid = false;
for (let step = 0; step < 40; step++) {
  const st = await state();
  if (st.phase !== "play") break;
  for (const b of st.birds) {
    const want = b.alive && b.n + b.vn * 0.30 > aim[b.i];
    if (want !== held[b.i]) {
      held[b.i] = want;
      if (want) await bit.fingerDown(b.i + 1, zones[b.i].x, zones[b.i].y);
      else await bit.fingerUp(b.i + 1);
    }
  }
  if (!mid && st.metres > 60) { mid = true; console.log("shot:", await bit.shot("dusk-3-play")); }
  await bit.wait(70);
}
if (!mid) console.log("shot:", await bit.shot("dusk-3-play"));

/* --- let go of everything: the cave finishes the job ------------------ */
for (let i = 0; i < 4; i++) if (held[i]) { await bit.fingerUp(i + 1); held[i] = false; }
let end = null;
for (let i = 0; i < 70; i++) {
  end = await state();
  if (end.phase === "over") break;
  await bit.wait(110);
}
await bit.wait(500);
console.log("shot:", await bit.shot("dusk-4-over"));

console.log("final:", JSON.stringify({
  phase: end.phase, metres: end.metres, winner: end.winner,
  birds: end.birds.map((b) => b.i + ":" + b.best + "m " + (b.cause || "-")),
}));
check(end.phase === "over", "round reached a real end state");
check(end.birds.every((b) => !b.alive), "every creature is out");
check(end.winner >= 0 && end.winner <= 3, "a winner was named");
check(end.metres > 40, "the flock actually flew somewhere (" + end.metres + " m)");
check(end.birds[end.winner].best === Math.max(...end.birds.map((b) => b.best)),
      "the winner is the one that flew furthest");

const events = await bit.eventKinds();
const tally = {};
for (const k of events) tally[k] = (tally[k] || 0) + 1;
console.log("events:", JSON.stringify(tally));
check(events.includes("memory.record.submit"), "furthest_flight submitted to the board");
check(events.includes("music.play") || events.includes("music.unlock"), "audio bed was unlocked");

const errs = (await bit.errors()).filter((e) => !/404/.test(e));
console.log(errs.length ? "ERRORS:\n  " + errs.join("\n  ") : "errors: none");
await bit.close();
console.log(fail ? "FAIL — " + fail : "PASS — four-finger round flown to a finish");
process.exit(fail || errs.length ? 1 : 0);
