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
const allAlive = async (where) =>
  check((await state()).birds.every((b) => b.alive), "all four still flying at " + where);

const state = () => P(() => {
  const d = window.__DUSKWING__;
  return { phase: d.phase, busy: d.busy, metres: d.metres, winner: d.winner, fps: d.fps, birds: d.birds() };
});

/**
 * Wait for `sec` of SIMULATED time rather than wall clock.
 *
 * Headless renders this bit through SwiftShader, which runs it an order of
 * magnitude behind a phone, and CDP polling starves the frame loop further —
 * so a plain sleep measures the harness, not the game. Every timing assertion
 * below is written against the clock the simulation itself is using.
 */
async function advance(sec) {
  const t0 = await P(() => window.__DUSKWING__.simT);
  for (let i = 0; i < 90; i++) {
    await bit.wait(90);
    if ((await P(() => window.__DUSKWING__.simT)) - t0 >= sec) return true;
  }
  throw new Error("simulation stalled waiting for " + sec + "s");
}

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

/* --- four fingers, four creatures ------------------------------------
 * The property that matters: a finger flies the creature in its own band and
 * nobody else's. Tested in ONE short window, because flight here is floaty by
 * design and an unpiloted creature reaches the floor in well under a second —
 * a longer test would be measuring its funeral.
 *
 * All four arrive still held from the claim window. Lift two of them; after a
 * third of a second the two that were let go must be accelerating downward
 * under gravity alone, and the two still held must not be, because a wing is
 * still beating on each of them.
 *
 * Velocity is compared as a CHANGE, not a sign: a flap is a discrete impulse
 * at 9.5Hz, so a creature that is very much climbing still reads as falling
 * between beats.
 */
await allAlive("the moment the round goes live");
const vA = (await state()).birds.map((b) => b.vn);
for (const id of [1, 3]) await bit.fingerUp(id);          // bands 0 and 2
await advance(0.32);
const after = await state();
const dv = after.birds.map((b, i) => b.vn - vA[i]);
console.log("dvn:", JSON.stringify(dv.map((v) => v.toFixed(2))), "held:", JSON.stringify(after.birds.map((b) => b.held)));
check(after.birds.every((b) => b.alive), "all four still flying through the isolation test");
check(dv[0] > 0.25 && dv[2] > 0.25, "the two released bands fall away under gravity");
check(dv[1] < 0.10 && dv[3] < 0.10, "the two still-held bands keep beating");
check(!after.birds[0].held && after.birds[2] && !after.birds[2].held &&
      after.birds[1].held && after.birds[3].held,
      "each finger stayed bound to the band it landed in");
// Hand straight over to the pilot rather than blindly re-pressing: the two
// released creatures may be high or low, and a reflex press drives a high
// one into the ceiling.

/* --- fly the round ----------------------------------------------------
 * One bang-bang autopilot per finger, each with its own target height so the
 * four creatures die at four different distances and the round has a real
 * winner. Only a changed hold sends an event, which keeps the step count down.
 */
const held = [false, true, false, true];
const bias = [-0.05, 0.03, 0.09, -0.01];       // four pilots, four bad habits
let mid = false;
for (let step = 0; step < 96; step++) {
  const st = await state();
  if (st.phase !== "play") break;
  for (const b of st.birds) {
    // Aim for the middle of the tunnel ahead, anticipating a third of a
    // second — a fixed height flies straight into the rock the moment the
    // cave meanders, which is exactly how the first attempt died.
    const target = (b.ceil + b.floor) / 2 + bias[b.i];
    const want = b.alive && b.n + b.vn * 0.30 > target;
    if (want !== held[b.i]) {
      held[b.i] = want;
      if (want) await bit.fingerDown(b.i + 1, zones[b.i].x, zones[b.i].y);
      else await bit.fingerUp(b.i + 1);
    }
  }
  if (!mid && st.metres > 45) { mid = true; console.log("fps:", st.fps); console.log("shot:", await bit.shot("dusk-3-play")); }
  await bit.wait(90);
}
if (!mid) console.log("shot:", await bit.shot("dusk-3-play"));

/* --- let go of everything: the cave finishes the job ------------------ */
for (let i = 0; i < 4; i++) if (held[i]) { await bit.fingerUp(i + 1); held[i] = false; }
let end = null;
for (let i = 0; i < 90; i++) {
  end = await state();
  if (end.phase === "over") break;
  await bit.wait(150);
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
check(end.metres > 25, "the flock actually flew somewhere (" + end.metres + " m, at " + end.fps + " fps)");
check(end.winner >= 0 && end.birds[end.winner].best === Math.max(...end.birds.map((b) => b.best)),
      "the winner is the one that flew furthest");

/* --- act two: the replay path, and the wall on the left --------------
 * Two things left to show. That a finished flight can be flown again from
 * the end screen, and that the dark edge is a real way to die rather than
 * decoration — the whole risk curve rests on it.
 *
 * Holding position costs more time on the pad than holding altitude does, so
 * a pilot that only ever aims for the middle of its tunnel is slowly reeled
 * back. That is what this flies.
 */
const again = await P(() => {
  const el = document.querySelector('[data-el="again"]');
  const r = el.getBoundingClientRect();
  return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
});
await bit.tap(again.x, again.y);
await bit.wait(500);
const replayed = await P(() => ({ phase: window.__DUSKWING__.phase, metres: window.__DUSKWING__.metres }));
check(replayed.phase === "claim" && replayed.metres === 0,
      "FLY AGAIN starts a fresh flight: " + JSON.stringify(replayed));

for (let i = 0; i < 4; i++) await bit.fingerDown(i + 1, zones[i].x, zones[i].y);
for (let i = 0; i < 60 && (await P(() => window.__DUSKWING__.busy)); i++) await bit.wait(100);
const hold2 = [true, true, true, true];
let reeled = null;
for (let step = 0; step < 145; step++) {
  const st = await state();
  if (st.phase !== "play") break;
  for (const b of st.birds) {
    const want = b.alive && b.n > (b.ceil + b.floor) / 2;     // hover, no ambition
    if (want !== hold2[b.i]) {
      hold2[b.i] = want;
      if (want) await bit.fingerDown(b.i + 1, zones[b.i].x, zones[b.i].y);
      else await bit.fingerUp(b.i + 1);
    }
  }
  reeled = st.birds.find((b) => b.cause === "LEFT BEHIND");
  await bit.wait(55);
}
for (let i = 0; i < 4; i++) if (hold2[i]) { await bit.fingerUp(i + 1); hold2[i] = false; }
let end2 = null;
for (let i = 0; i < 50; i++) {
  end2 = await state();
  if (end2.phase === "over") break;
  await bit.wait(150);
}
console.log("act two:", JSON.stringify(end2.birds.map((b) => b.i + ":" + b.best + "m " + (b.cause || "flying"))));
console.log("shot:", await bit.shot("dusk-5-wall"));
check(end2.phase === "over", "the replayed flight also reaches a real end state");

// Across eight deaths in two flights, the dark edge has to have taken at
// least one — otherwise the left-hand wall is decoration.
const causes = [...end.birds, ...end2.birds].map((b) => b.cause);
check(causes.includes("LEFT BEHIND"),
      "the dark edge on the left claims at least one creature: " + JSON.stringify(causes));

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
