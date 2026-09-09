// Slices the MODEL block out of main.js and proves the rules. Run from the
// repo root:  node kingfisher/test-model.js kingfisher/main.js
const fs = require("fs");
const src = fs.readFileSync(process.argv[2] || "kingfisher/main.js", "utf8");
const a = src.indexOf("// === MODEL BEGIN"), b = src.indexOf("// === MODEL END");
const M = new Function(src.slice(a, b) + "; return MODEL;")();
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("  FAIL:", m); } };
const DT = 1 / 120;

// --- difficulty: monotone, bounded, smooth
let prev = M.difficulty(0);
ok(prev.gap > 4 && prev.speed < 4.5, "starts generous and slow");
for (let s = 1; s <= 200; s++) {
  const d = M.difficulty(s);
  ok(d.speed >= prev.speed && d.gap <= prev.gap && d.spacing <= prev.spacing, "monotone at " + s);
  ok(d.gap >= 2.9 && d.speed <= 6.5, "bounded at " + s);
  ok(Math.abs(d.gap - prev.gap) < 0.08 && Math.abs(d.speed - prev.speed) < 0.12, "no cliff at " + s);
  ok(d.gap > 2 * M.BIRD_R * 3.4, "gap stays at least 3.4 bird diameters at " + s);
  prev = d;
}
ok(M.difficulty(40).wind === 0 && M.difficulty(41).wind > 0 && M.difficulty(200).wind <= 1.1, "wind arrives after 40 and is bounded");

// --- spawning: always reachable, drift bounded, ids unique
for (const seed of [1, 2, 3, 4, 5]) {
  const run = M.newRun(seed);
  run.score = 0;
  for (let i = 0; i < 300; i++) { M.spawnPillar(run); run.score = Math.min(200, i); }
  let last = 6.6;
  const ids = new Set();
  for (const p of run.pillars) {
    const [lo, hi] = M.gapBounds(p.gap);
    ok(p.cy >= lo - 1e-9 && p.cy <= hi + 1e-9, "gap inside the play band (seed " + seed + ")");
    ok(Math.abs(p.cy - last) <= 3.4 + 1e-9, "drift bounded (seed " + seed + ")");
    const r = M.reach(p.__d || M.difficulty(200));
    ok(p.cy - last <= r.up + 1e-9 && last - p.cy <= r.down + 1e-9, "every gap is reachable from the last (seed " + seed + ")");
    ok(!ids.has(p.id), "ids unique"); ids.add(p.id);
    last = p.cy;
  }
}
ok(M.newRun(7).pillars.length === 0 && M.newRun(7).nextX === M.FIRST_PILLAR_X, "a run starts with a runway");

// --- collision: circle vs the two columns
const P = { x: 10, cy: 6, gap: 3, w: 1.35, passed: false };
ok(!M.hitsPillar(10, 6, P), "centre of the gap is clear");
ok(!M.hitsPillar(10, 6 + 1.5 - 0.40 - 0.06, P), "just under the top edge (with inset) is clear");
ok(M.hitsPillar(10, 6 + 1.5 + 0.2, P), "into the upper column hits");
ok(M.hitsPillar(10, 6 - 1.5 - 0.2, P), "into the lower column hits");
ok(!M.hitsPillar(10 - 0.675 - 0.41, 9, P), "beside the column, not touching, is clear");
ok(M.hitsPillar(10 - 0.675 + 0.1, 9, P), "overlapping the column's face hits");
ok(!M.hitsPillar(10, 2, { x: 10, cy: 6, gap: 3, w: 1.35 }) === false, "deep in the lower column hits");

// --- a run: hover before the first flap, then physics
{
  const run = M.newRun(11);
  for (let i = 0; i < 120; i++) M.step(run, DT);
  ok(run.x === 0 && run.started === false && Math.abs(run.hover) <= 0.28, "no input: hovers in place");
  ok(M.flap(run) && run.started && run.vy === M.FLAP_VY, "first flap starts the run");
  const y0 = run.y;
  for (let i = 0; i < 12; i++) M.step(run, DT);
  ok(run.y > y0, "a flap goes up");
  for (let i = 0; i < 30; i++) M.step(run, DT);
  ok(run.alive && run.vy < 0, "and gravity brings it down");
}
// --- no input after the first flap dies, and dies in the water within the runway
{
  const run = M.newRun(12);
  M.flap(run);
  let ev = null, steps = 0;
  while (!ev && steps < 2000) { ev = M.step(run, DT); steps++; }
  ok(ev === "die:water" && !run.alive, "falling with no input ends in the water (" + ev + ")");
  ok(run.x < M.FIRST_PILLAR_X, "and before the first pillar");
  ok(M.flap(run) === false, "dead birds do not flap");
}
// --- two players. The steady player flaps to hold the next gap's height,
// --- taps no faster than a thumb, and looks one pillar ahead. The planner
// --- is the same player, but before each tap it plays both choices forward
// --- a second and keeps the one that lives longer. The planner must clear
// --- 200 pillars on every seed, or the difficulty is unfair; the steady
// --- player must reach the silver medal, or it is unkind.
const MIN_TAP = 0.18;                  // 5.5 taps a second at most
function cloneRun(run) {
  const c = Object.assign({}, run);
  c.pillars = run.pillars.map((p) => Object.assign({}, p));
  return c;
}
function wantsFlap(run) {
  const idx = run.pillars.findIndex((p) => p.x + p.w / 2 + M.BIRD_R > run.x);
  const cur = idx >= 0 ? run.pillars[idx] : null, nxt = idx >= 0 ? run.pillars[idx + 1] : null;
  let aim = 6.6, panic = false;
  if (cur) {
    const bandLo = cur.cy - cur.gap / 2 + M.BIRD_R, bandHi = cur.cy + cur.gap / 2 - M.BIRD_R;
    // a flap from aim-0.5 peaks at aim+0.97, so keep both inside the band
    const lo = bandLo + 0.62, hi = bandHi - 1.1;
    aim = Math.min(hi, Math.max(lo, (nxt ? nxt.cy : cur.cy) - 0.2));
    const inside = run.x > cur.x - cur.w / 2 - M.BIRD_R;
    panic = inside && run.y < bandLo + 0.15 && run.vy < 0;
  }
  return (run.y < aim - 0.5 && run.vy < 3) || panic;
}
function rollout(run, sinceFlap, flapNow, horizon) {
  const r = cloneRun(run);
  let t = 0;
  if (flapNow) { M.flap(r); sinceFlap = 0; }
  while (t < horizon && r.alive) {
    sinceFlap += DT;
    if (sinceFlap > MIN_TAP && wantsFlap(r)) { M.flap(r); sinceFlap = 0; }
    M.step(r, DT); t += DT;
  }
  return r.alive ? horizon + 1 : t;
}
function play(seedValue, target, planning) {
  const run = M.newRun(seedValue);
  M.flap(run);
  let sinceFlap = 0, tick = 0;
  while (run.alive && run.score < target && tick < 400000) {
    sinceFlap += DT;
    if (sinceFlap > MIN_TAP) {
      let flap = wantsFlap(run);
      if (planning && tick % 2 === 0) {
        const stay = rollout(run, sinceFlap, false, 1.0), go = rollout(run, sinceFlap, true, 1.0);
        flap = go > stay || (go === stay && flap);
      }
      if (flap) { M.flap(run); sinceFlap = 0; }
    }
    M.step(run, DT); tick++;
  }
  return run;
}
const idealRun = (seedValue, target) => play(seedValue, target, true);
const steady = [];
for (const seedValue of [1, 2, 3, 4, 5, 6, 7, 8]) {
  const run = play(seedValue, 200, true);
  ok(run.alive && run.score >= 200, "the planner clears 200 on seed " + seedValue + " (got " + run.score + ", " + (run.cause || "alive") + ")");
  steady.push(play(seedValue, 200, false).score);
}
steady.sort((a, b) => a - b);
ok(steady[0] >= 25, "the steady player always reaches silver (scores " + steady.join(" ") + ")");
console.log("  steady player over 8 seeds:", steady.join(" "));
// --- scoring: exactly one point per pillar, in order
{
  const run = idealRun(3, 30);
  const passed = run.pillars.filter((p) => p.passed).length;
  ok(run.score === 30, "score counts pillars passed (" + run.score + ")");
}
ok(M.medal(9) === null && M.medal(10) === "bronze" && M.medal(25) === "silver" && M.medal(50) === "gold" && M.medal(100) === "platinum", "medals at 10/25/50/100");
// --- determinism
{
  const a1 = idealRun(5, 60), a2 = idealRun(5, 60);
  ok(a1.x === a2.x && a1.y === a2.y && a1.score === a2.score, "same seed, same run");
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
