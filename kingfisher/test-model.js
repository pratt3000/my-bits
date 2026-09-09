// Slices the MODEL block out of main.js and proves the rules. Run from the
// repo root:  node kingfisher/test-model.js kingfisher/main.js
const fs = require("fs");
const src = fs.readFileSync(process.argv[2] || "kingfisher/main.js", "utf8");
const a = src.indexOf("// === MODEL BEGIN"), b = src.indexOf("// === MODEL END");
const M = new Function(src.slice(a, b) + "; return MODEL;")();
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("  FAIL:", m); } };

// ---------------------------------------------------------------- players
// The steady player does what a person does: while a pipe is around it, it
// glides and taps at the last moment that keeps it off the pipe's floor;
// while a pipe is coming it holds a height a little under the gap's centre,
// so a tap's 45 px peak stays under the pipe above. It taps no faster than
// six times a second. The planner is the same player, but every third tick
// it plays both choices a second forward and keeps the one that lives
// longer — that is where the early taps for a climb come from.
const MIN_TAP = 5;
function cloneRun(run) {
  const c = Object.assign({}, run);
  c.pipes = run.pipes.map((p) => Object.assign({}, p));
  return c;
}
function wantsFlap(run) {
  let idx = run.pipes.findIndex((p) => p.x + M.PIPE_W > M.BIRD_X + 2);
  if (idx < 0) return run.y >= M.START_Y;
  // a pipe that will not overlap after this tick is behind us
  if (run.pipes[idx].x - M.SPEED + M.PIPE_W <= M.BIRD_X + 2 && idx + 1 < run.pipes.length) idx++;
  const cur = run.pipes[idx], nxt = run.pipes[idx + 1];
  const nextX = cur.x - M.SPEED;
  const overlapNext = nextX + M.PIPE_W > M.BIRD_X + 2 && nextX < M.BIRD_X + M.BIRD_W - 2;
  const vyNext = run.flapped ? run.vy : Math.min(M.VMAX, run.vy + M.ACC);
  const floor = cur.gapY + M.GAP - M.BIRD_H + 2;          // highest y that still clears the pipe below
  if (overlapNext && run.y + vyNext > floor) return true;  // now or never
  // hold a height inside this gap's safe window, leaning toward the next gap:
  // a tap from y rises 45, so the window for tapping is [gapY+47, gapY+69]
  const want = (nxt ? nxt.gapY : cur.gapY) + 47;
  const aim = Math.min(cur.gapY + 69, Math.max(cur.gapY + 47, want));
  return run.y >= aim;
}
function rollout(run, sinceFlap, flapNow, ticks) {
  const r = cloneRun(run);
  if (flapNow) { M.flap(r); sinceFlap = 0; }
  for (let t = 0; t < ticks; t++) {
    sinceFlap++;
    if (sinceFlap >= MIN_TAP && wantsFlap(r)) { M.flap(r); sinceFlap = 0; }
    M.step(r);
    if (!r.alive) return t;
  }
  return ticks + 1;
}
function play(seedValue, target, planning, observe) {
  const run = M.newRun(seedValue);
  M.flap(run);
  let sinceFlap = 0, ticks = 0;
  while (run.alive && run.score < target && ticks < 200000) {
    sinceFlap++;
    if (sinceFlap >= MIN_TAP) {
      let flap = wantsFlap(run);
      if (planning && ticks % 2 === 0) {
        const stay = rollout(run, sinceFlap, false, 60), go = rollout(run, sinceFlap, true, 60);
        flap = go > stay || (go === stay && flap);
      }
      if (flap) { M.flap(run); sinceFlap = 0; }
    }
    M.step(run); ticks++;
    if (observe) observe(run);
  }
  return run;
}

// ------------------------------------------------- the constants are the original's
ok(M.W === 288 && M.H === 512 && M.TPS === 30, "288×512 at 30 ticks a second");
ok(M.BIRD_X === 57 && M.START_Y === 244 && M.BASE_Y === 404, "bird at x=57, starts at y=244, ground at 404");
ok(M.PIPE_W === 52 && M.GAP === 100 && M.SPEED === 4, "pipes 52 wide, gap 100, four pixels a tick");
ok(M.ACC === 1 && M.FLAP === -9 && M.VMAX === 10, "gravity 1, flap -9, fall capped at 10");
ok(M.GAP_MIN === 80 && M.GAP_RANGE === 142, "gap top uniform over [80, 221]");
ok(M.medal(9) === null && M.medal(10) === "bronze" && M.medal(20) === "silver" && M.medal(30) === "gold" && M.medal(40) === "platinum", "medals at 10/20/30/40");

// ------------------------------------------------- a fresh run
{
  const run = M.newRun(3);
  ok(run.pipes.length === 2 && run.pipes[0].x === 488 && run.pipes[1].x === 632, "first pipes at 488 and 632");
  for (let i = 0; i < 40; i++) M.step(run);
  ok(!run.started && run.y === M.START_Y && Math.abs(run.bob) <= 8, "before the first tap the bird only bobs");
  ok(run.pipes[0].x === 488, "and nothing scrolls");
  ok(M.flap(run) && run.started && run.vy === -9, "the first tap starts the run at vy = -9");
}
// ------------------------------------------------- the flap arc
{
  const run = M.newRun(4);
  M.flap(run);
  const y0 = run.y;
  let top = y0;
  for (let i = 0; i < 12; i++) { M.step(run); top = Math.min(top, run.y); }
  ok(y0 - top === 45, "a flap rises exactly 45 px: 9+8+...+1 (" + (y0 - top) + ")");
  ok(run.vy === 2, "twelve ticks after a flap the bird falls 2 px a tick (" + run.vy + ")");
  for (let i = 0; i < 40 && run.alive; i++) M.step(run);
  ok(run.vy === 10 || !run.alive, "and the fall caps at 10");
}
// ------------------------------------------------- the nose
{
  const run = M.newRun(5);
  M.flap(run); M.step(run);
  ok(M.visibleRot(run) === 20 && run.rot === 45, "after a tap the nose shows 20° up (internally 45)");
  for (let i = 0; i < 8; i++) M.step(run);
  ok(run.rot === 21 && M.visibleRot(run) === 20, "still 20° up eight ticks later");
  for (let i = 0; i < 60; i++) if (run.alive) M.step(run);
  ok(run.rot === -90 || !run.alive, "and it pitches all the way down");
}
// ------------------------------------------------- no input
{
  const run = M.newRun(6);
  M.flap(run);
  let ev = null, n = 0;
  while (!ev && n < 400) { ev = M.step(run); n++; }
  ok(ev === "die:ground" && run.cause === "ground" && run.landed, "no input ends on the ground (" + ev + ")");
  ok(run.pipes[0].x > M.BIRD_X + M.BIRD_W, "before the first pipe arrives");
  ok(M.flap(run) === false, "dead birds do not flap");
}
// ------------------------------------------------- collision
{
  const run = M.newRun(8);
  const p = { x: M.BIRD_X, gapY: 200, passed: false };
  run.y = 200 + 50 - 12;
  ok(!M.hitsPipe(run, p), "centred in the gap is clear");
  run.y = 200 - 2;
  ok(!M.hitsPipe(run, p), "top edge two pixels into the upper pipe is forgiven");
  run.y = 200 - 3;
  ok(M.hitsPipe(run, p), "three pixels in is a hit");
  run.y = 300 - 24 + 2;
  ok(!M.hitsPipe(run, p), "bottom edge two pixels into the lower pipe is forgiven");
  run.y = 300 - 24 + 3;
  ok(M.hitsPipe(run, p), "three pixels in is a hit");
  run.y = 200;
  ok(!M.hitsPipe(run, { x: M.BIRD_X + M.BIRD_W - 2, gapY: 400 }), "a pipe the bird has not reached is clear");
  ok(!M.hitsPipe(run, { x: M.BIRD_X - M.PIPE_W + 2, gapY: 400 }), "a pipe the bird has cleared is clear");
}
// ------------------------------------------------- scoring
{
  const run = M.newRun(9);
  M.flap(run);
  run.pipes = [{ id: 1, x: M.BIRD_X + M.BIRD_W / 2 - M.PIPE_W / 2 + 3, gapY: run.y - 40, passed: false }];
  const ev = M.step(run);
  ok(ev === "score" && run.score === 1, "the point lands on the tick the middles cross (" + ev + ")");
}
// ------------------------------------------------- fairness, and the pipe survey
const steady = [];
let minGap = 999, maxGap = -1, spacingsBad = 0, spawns = 0, lastSpawn = null;
const ids = new Set();
for (const seedValue of [1, 2, 3, 4, 5, 6, 7, 8]) {
  const run = play(seedValue, 200, true, (r) => {
    for (const p of r.pipes) {
      if (ids.has(seedValue + ":" + p.id)) continue;
      ids.add(seedValue + ":" + p.id);
      spawns++;
      minGap = Math.min(minGap, p.gapY); maxGap = Math.max(maxGap, p.gapY);
      if (lastSpawn && lastSpawn.seed === seedValue && p.id > 2) {
        const s = p.x - lastSpawn.x + (r.tick - lastSpawn.tick) * M.SPEED;
        if (s < 144 || s > 152) spacingsBad++;
      }
      lastSpawn = { seed: seedValue, x: p.x, tick: r.tick };
    }
  });
  ok(run.alive && run.score >= 200, "the planner clears 200 on seed " + seedValue + " (got " + run.score + ", " + (run.cause || "alive") + ")");
  steady.push(play(seedValue, 200, false).score);
}
ok(minGap >= 80 && maxGap <= 221 && maxGap - minGap > 120, "gap tops span the band [80, 221] (saw " + minGap + ".." + maxGap + " over " + spawns + " pipes)");
ok(spawns > 1500 && spacingsBad === 0, "pipe spacing stays between 144 and 152 (" + spacingsBad + " outside)");
steady.sort((x, y) => x - y);
ok(steady[0] >= 10, "the steady player always reaches bronze (scores " + steady.join(" ") + ")");
console.log("  steady player over 8 seeds:", steady.join(" "));
// ------------------------------------------------- determinism
{
  const r1 = play(5, 40, false), r2 = play(5, 40, false);
  ok(r1.y === r2.y && r1.score === r2.score && r1.tick === r2.tick, "same seed, same run");
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
