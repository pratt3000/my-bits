/*
 * Plays a whole match of Lob through the real UI — taps only — and asserts the
 * bit reaches a genuine end state on its own.
 *
 * The script never asks the bit where to shoot. It reads the same public
 * constants a player can see (gravity, wind, both tank positions, the ground
 * heights) and integrates its own trajectory, then taps the aim dome at the
 * screen point that means that angle and power. Both seats are driven, so the
 * half-turn transform on Ember's deck is exercised for real: if that inverse
 * were wrong, Ember's taps would land nowhere and the match would stall.
 */
import { openBit } from "./run.mjs";

const bit = await openBit("/home/user/my-bits/lob");
await bit.wait(900);

/* --- start ---------------------------------------------------------------- */
const start = await bit.probe(() => window.__LOB__.startXY());
await bit.tap(start.x, start.y);
await bit.wait(700);

/** Wait on the animation, never on the state: a fresh turn is only tappable
 *  once the shell has landed, the ground has settled and the tanks have
 *  finished falling, and `busy` is the only honest signal for all three. */
const idle = async () => {
  for (let i = 0; i < 150; i++) {
    const s = await bit.probe(() => ({ b: window.__LOB__.busy, over: window.__LOB__.phase === "over" }));
    if (s.over || !s.b) return true;
    await bit.wait(90);
  }
  return false;
};

/**
 * Search angle and power by integrating the bit's own published physics.
 * Runs inside the page so the 2700 candidate trajectories cost nothing.
 */
const solve = () => bit.probe(() => {
  const P = window.__LOB__.physics();
  const RAD = Math.PI / 180;
  const surf = P.surf;
  function fly(a, pw) {
    const v = pw * P.mk;
    const ca = Math.cos(a * RAD), sa = Math.sin(a * RAD);
    let x = P.px + P.facing * ca * 17;
    let y = P.py - 10 - sa * 17;
    let vx = P.facing * ca * v, vy = -sa * v;
    let clear = 9;
    let best = 1e9;
    for (let step = 0; step < 620; step++) {
      vy += P.grav;
      vx += P.wind;
      const sp = Math.hypot(vx, vy);
      const sub = Math.max(1, Math.min(10, Math.ceil(sp / 3)));
      for (let k = 0; k < sub; k++) {
        x += vx / sub; y += vy / sub;
        if (clear > 0) clear--;
        if (x < -60 || x > P.w + 60 || y > P.bfBot + 30) return best;
        if (clear <= 0) {
          const d = Math.hypot(x - P.fx, y - P.fy);
          if (d < best) best = d;
          if (Math.abs(P.fx - x) < 13 && Math.abs(P.fy - y) < 12) return d;
          if (y >= P.bfTop && x >= 0 && x < P.w && y >= surf[Math.round(x)]) {
            return Math.min(best, Math.hypot(x - P.fx, surf[Math.round(x)] - P.fy));
          }
        }
      }
    }
    return best;
  }
  let bestD = 1e9, bestA = 45, bestP = 60;
  for (let a = 14; a <= 84; a += 1) {
    for (let pw = 24; pw <= 100; pw += 2) {
      const d = fly(a, pw);
      if (d < bestD) { bestD = d; bestA = a; bestP = pw; }
    }
  }
  return { ang: bestA, pow: bestP, dist: Math.round(bestD) };
});

/** Ballistic weapons whose flight the solver above actually models. */
const PREF = ["lob", "chain", "auger", "bounce", "buck", "roll", "sky", "hail"];

let shot = 0;
const log = [];
while (shot < 15) {
  if (!(await idle())) { log.push("STALLED at shot " + shot); break; }
  if (await bit.probe(() => window.__LOB__.phase === "over")) break;

  const st = await bit.probe(() => ({
    turn: window.__LOB__.turn,
    hand: window.__LOB__.hand,
    weapon: window.__LOB__.weapon,
  }));

  // Swap to a weapon the solver can predict, if the auto-pick is not one.
  if (!PREF.includes(st.weapon)) {
    let want = -1;
    for (const id of PREF) {
      const i = st.hand.findIndex((h) => !h.used && h.id === id);
      if (i >= 0) { want = i; break; }
    }
    if (want >= 0) {
      const wp = await bit.probe(() => window.__LOB__.hit("weapon"));
      await bit.tap(wp.x, wp.y);
      await bit.wait(220);
      const cell = await bit.probe((i) => window.__LOB__.cellXY(i), want);
      await bit.tap(cell.x, cell.y);
      await bit.wait(200);
    }
  }

  const aim = await solve();
  const dp = await bit.probe((a) => window.__LOB__.domePoint(a.ang, a.pow), aim);
  await bit.tap(dp.x, dp.y);
  await bit.wait(120);

  // The dome quantises to whole pixels; nudge the last degree with the pads.
  for (let n = 0; n < 3; n++) {
    const cur = await bit.probe(() => window.__LOB__.aim);
    const da = aim.ang - cur.ang;
    if (da === 0) break;
    const b = await bit.probe((k) => window.__LOB__.hit(k), da > 0 ? "angP" : "angM");
    await bit.tap(b.x, b.y);
    await bit.wait(70);
  }

  const before = await bit.probe(() => ({ hp: window.__LOB__.hp, w: window.__LOB__.weapon }));
  const fireBtn = await bit.probe(() => window.__LOB__.hit("fire"));
  await bit.tap(fireBtn.x, fireBtn.y);
  shot++;
  if (shot === 3) await bit.shot("lob-3-flight");
  await bit.wait(500);
  if (!(await idle())) { log.push("STALLED in flight after shot " + shot); break; }

  const after = await bit.probe(() => ({ hp: window.__LOB__.hp, best: window.__LOB__.bestShot }));
  log.push("shot " + shot + "  P" + (st.turn + 1) + "  " + before.w +
    "  aim " + aim.ang + "/" + aim.pow + " (miss " + aim.dist + "px)" +
    "  hp " + before.hp.join("/") + " -> " + after.hp.join("/"));
  if (shot === 4) await bit.shot("lob-4-midgame");
}

await bit.wait(900);
const end = await bit.probe(() => ({
  phase: window.__LOB__.phase,
  winner: window.__LOB__.winner,
  reason: window.__LOB__.reason,
  hp: window.__LOB__.hp,
  best: window.__LOB__.bestShot,
  shots: window.__LOB__.shots,
  volley: window.__LOB__.volley,
}));
await bit.shot("lob-5-over");

console.log(log.join("\n"));
console.log("");
console.log("phase:  ", end.phase, "| winner:", end.winner, "|", end.reason);
console.log("armour: ", end.hp.join(" / "), "| shells:", end.shots, "| volleys:", end.volley);
console.log("best shot:", end.best);

const submitted = (await bit.events()).filter((e) => e.kind === "memory.record.submit");
console.log("leaderboard submits:", JSON.stringify(submitted.map((e) => e.args.slice(0, 2))));

const ok = end.phase === "over" && end.winner >= 0 && end.hp.some((h) => h === 0 || end.reason === "OUT OF SHELLS")
  && end.best > 0 && submitted.length === 1;
console.log(ok ? "PASS — match played to a real finish" : "FAIL");

const errs = (await bit.errors()).filter((e) => !/404/.test(e));
console.log(errs.length ? "ERRORS:\n  " + errs.join("\n  ") : "errors: none");
await bit.close();
process.exit(ok ? 0 : 1);
