/*
 * Duskwing with one player: the same cave, one band the full height of the
 * screen. Flies it for real with a single finger, steering to the middle of
 * the tunnel ahead, and asserts it reaches a distance and a result card that
 * says what a solo flight should say rather than naming a winner.
 */
import { openBit } from "./run.mjs";

const bit = await openBit("duskwing", { dpr: 3, viewport: { width: 390, height: 844 } });
const P = (fn, ...a) => bit.probe(fn, ...a);
let bad = 0;
const check = (ok, what) => { console.log(`  ${ok ? "ok  " : "FAIL"}   ${what}`); if (!ok) bad++; };
const at = async (sel) => P((s) => {
  const el = document.querySelector(s);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
}, sel);

await bit.wait(1800);
const solo = await at('[data-el="crew"] button[data-v="1"]');
check(!!solo, "the menu offers a solo flight");
if (!solo) { console.log("FAILED"); await bit.close(); process.exit(1); }
await bit.tap(solo.x, solo.y);
await bit.wait(260);
check((await P(() => window.__DUSKWING__.players)) === 1, "player count set to 1");

const fly = await at('[data-el="fly"]');
await bit.tap(fly.x, fly.y);
await bit.wait(300);

const zone = await P(() => window.__DUSKWING__.zone(0));
await bit.fingerDown(1, zone.x, zone.y);
// Claim, then a countdown, and only then "play". Starting the control loop
// before that reads phase !== "play" and quits on the first tick, which looks
// exactly like a creature that died on the start line.
for (let i = 0; i < 120; i++) {
  if ((await P(() => window.__DUSKWING__.phase)) === "play") break;
  await bit.wait(100);
}
const state = () => P(() => ({ phase: window.__DUSKWING__.phase, metres: window.__DUSKWING__.metres,
                               fps: window.__DUSKWING__.fps, simT: window.__DUSKWING__.simT,
                               birds: window.__DUSKWING__.birds() }));
check((await state()).birds.length === 1, "one creature in the cave");

/* The dark edge, measured rather than assumed.
 *
 * The cave reels a creature back toward the wall, and beating its wings is
 * the only thing that buys the ground back — so a creature flown neatly down
 * the middle of the tunnel, which is what this loop does, should lose ground
 * slowly. Slowly is the whole point: the pull used to be steep enough to
 * claim a perfectly flown creature in three seconds, with nothing on screen
 * saying why, and the four-player script asserted that somebody had to be
 * killed by it — an assertion that was holding that balance in place.
 */
const sxTrace = [];
let held = true;
for (let step = 0; step < 130; step++) {
  const st = await state();
  if (st.phase !== "play") break;
  const b = st.birds[0];
  if (!b || !b.alive) break;
  // A wing beat carries the creature up AND forward, and the cave is always
  // reeling it back toward the dark edge — so the way this is actually played
  // is to hold almost continuously and stop only under the ceiling. Steering
  // for the middle of the tunnel flies a tidy line straight into the wall.
  sxTrace.push({ sx: b.sx, t: st.simT });
  const want = b.n + b.vn * 0.30 > b.ceil + 0.14;
  if (want !== held) { held = want; if (want) await bit.fingerDown(1, zone.x, zone.y); else await bit.fingerUp(1); }
  if (step === 20) console.log("fps:", st.fps, "simT:", st.simT.toFixed(1));
  await bit.wait(90);
}
if (held) await bit.fingerUp(1).catch(() => {});

const flown = (await state()).metres;
console.log("flew:", flown, "m");
// The bar is "it flies", not "it is easy". Headless runs the cave on a
// software rasteriser at around 10fps, and the four-player script — which
// steers with per-seat bias and gets four rolls of the dice — still loses two
// of its four creatures inside 5m. A solo creature that clears 8m has left
// the hatch, held a line and covered ground; one that hatches outside its own
// corridor, which is what the bug did, never passes 1m.
check(flown > 8, `a solo flight actually covers ground (${flown} m)`);

await bit.wait(1400);
const card = await P(() => {
  const who = document.querySelector('[data-el="over-who"]');
  const list = document.querySelector('[data-el="over-list"]');
  return { who: who ? who.textContent.trim() : null,
           listShown: list ? getComputedStyle(list).display !== "none" : null,
           dist: (document.querySelector('[data-el="over-dist"]') || {}).textContent };
});
console.log("card:", JSON.stringify(card));
check(!/FLEW FURTHEST/i.test(card.who || ""), "the result does not name a winner of a one-creature race");
check(card.listShown === false, "the one-row scoreboard is not shown");
check(!!card.dist && card.dist !== "0", "the result card carries the distance");

if (sxTrace.length > 8) {
  const a = sxTrace[0], z = sxTrace[sxTrace.length - 1];
  // A rate, not a total: the total only says how long the flight was.
  const rate = (z.sx - a.sx) / Math.max(0.5, z.t - a.t);
  console.log("ground against the dark edge:", rate.toFixed(1), "px/s over",
              (z.t - a.t).toFixed(1) + "s");
  // This loop flies the way the game wants to be flown — beating up to the
  // ceiling and gliding back down — which is a high fraction of the time on
  // the pad, and that has to be enough to hold the dark edge off. It used not
  // to be: at -29px/s in a 206px corridor the pull claimed a perfectly flown
  // creature in about three seconds, with nothing on screen saying why. That
  // is the regression this number guards.
  check(rate > -12, `beating for your ground holds the dark edge off (${rate.toFixed(1)}px/s)`);
}

const subs = await P(() => window.__BIT_LOG__.filter(e => e.kind === "memory.record.submit").map(e => e.args));
check(subs.length > 0, "the solo flight still reaches the leaderboard");

const errs = (await bit.errors()).filter(e => !/404/.test(String(e)));
console.log(errs.length ? "ERRORS: " + JSON.stringify(errs) : "errors: none");
console.log(bad ? `\nFAILED ${bad} check(s)` : "\nPASS — a solo flight flown to a finish");
await bit.close();
process.exit(bad ? 1 : 0);
