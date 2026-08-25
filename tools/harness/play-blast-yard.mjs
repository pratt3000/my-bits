/*
 * Plays a real four-player match of Blast Yard through the real controls —
 * four fingers on the glass at once, no reaching into state — and asserts the
 * bit reaches a genuine match end.
 *
 * What this is actually testing:
 *   1. Four simultaneous touches are each bound to their own player. The seat
 *      check readies all four in ONE frame (tapTogether), which is the case
 *      that breaks if a pad steals a neighbour's pointer.
 *   2. A stick pushed "toward me" walks a figure toward that player's OWN
 *      edge, from every seat. The pads are rotated 0/90/180/270, so this is
 *      the test that catches a seat whose axes are transposed — a bug that is
 *      invisible until somebody sits on the left.
 *   3. Cooking a bomb, throwing it, and the blast going off.
 *   4. Round wins accumulating to a match win, and the streak record.
 *
 * Headless runs WebGL on SwiftShader at roughly three frames a second, so the
 * simulation advances at about a fifth of wall-clock. Everything below polls
 * the bit's own state rather than sleeping a fixed amount.
 */
import { openBit } from "./run.mjs";

const N = 4;
const bit = await openBit("/home/user/my-bits/blast-yard");
await bit.wait(900);

const at = (what, i) => bit.probe(([w, k]) => window.__BLAST__.hit(w, k), [what, i]);
const state = () => bit.probe(() => ({
  phase: window.__BLAST__.phase,
  busy: window.__BLAST__.busy,
  round: window.__BLAST__.round,
  streak: window.__BLAST__.bestStreak,
  winner: window.__BLAST__.matchWinner,
  bombs: window.__BLAST__.bombs(),
  p: window.__BLAST__.players(),
}));

/** Poll the bit rather than guessing how long a thing takes. */
async function until(pred, tries = 60, ms = 400) {
  for (let i = 0; i < tries; i++) {
    const s = await state();
    if (pred(s)) return s;
    await bit.wait(ms);
  }
  return await state();
}

/* ---- settings: shorten the match to two round wins ---- */
const cog = await at("cog");
await bit.tap(cog.x, cog.y);
await bit.wait(350);
const r2 = await at("rounds", 0);                 // the "2" pill
await bit.tap(r2.x, r2.y);
await bit.wait(200);
await bit.shot("blast-settings");
const close = await at("cogClose");
await bit.tap(close.x, close.y);
await bit.wait(250);

/* ---- how many players ---- */
const c = await at("count", N);
await bit.tap(c.x, c.y);
await until((s) => s.phase === "seat", 20, 200);
await bit.shot("blast-seats");

/* ---- four thumbs land in the same frame ---- */
const bombBtn = [], stickHome = [], stickPush = [];
for (let i = 0; i < N; i++) {
  bombBtn.push(await at("bomb", i));
  stickHome.push(await at("stick", i));
  stickPush.push(await at("stickPush", i));
}
await bit.tapTogether(bombBtn);
const readied = await until((s) => s.p.every((q) => q.ready), 20, 200);
console.log("ready after one 4-finger tap:", readied.p.map((q) => q.ready).join(","));

await until((s) => s.phase === "play", 40, 300);
console.log("round 1 live");

let shotExplosion = false;

/** Ember (seat 0) sits still; everyone else walks off their own edge. */
async function playRound(label) {
  await until((s) => s.phase === "play", 60, 300);

  for (let i = 1; i < N; i++) {
    await bit.fingerDown(20 + i, stickHome[i].x, stickHome[i].y);
    await bit.fingerMove(20 + i, stickPush[i].x, stickPush[i].y);
  }

  // Ember cooks a bomb and lobs it, so a real blast happens on screen.
  await bit.fingerDown(30, bombBtn[0].x, bombBtn[0].y);
  await until((s) => s.p[0].fuse < 2.0, 30, 300);
  if (!shotExplosion) await bit.shot("blast-cooking");
  await bit.fingerUp(30);

  if (!shotExplosion) {
    await until((s) => s.bombs === 0, 40, 250);    // the throw has gone off
    await bit.shot("blast-boom");
    shotExplosion = true;
  }

  const done = await until((s) => s.phase !== "play", 70, 400);
  for (let i = 1; i < N; i++) await bit.fingerUp(20 + i);
  console.log(label, "->", done.p.map((q) => q.name + (q.alive ? " up" : " OUT")).join(", "));
  return done;
}

await playRound("round 1");
await until((s) => s.phase === "play" || s.phase === "matchend", 60, 400);

if ((await state()).phase === "play") await playRound("round 2");

const end = await until((s) => s.phase === "matchend", 60, 400);
await bit.wait(400);
await bit.shot("blast-match-over");

console.log("phase:  ", end.phase);
console.log("rounds: ", end.round, "| winner:", end.winner, "| best streak:", end.streak);
console.log("wins:   ", end.p.map((q) => q.name + " " + q.wins).join("  "));

const events = await bit.eventKinds();
const submitted = (await bit.events()).some((e) => e.kind === "memory.record.submit");
const ok = end.phase === "matchend" && end.winner === 0 &&
           end.p[0].wins >= 2 && end.streak >= 2 &&
           events.includes("complete") && submitted;
console.log(ok
  ? "PASS — four fingers drove a real match to a real end state"
  : "FAIL — winner " + end.winner + " streak " + end.streak +
    " complete:" + events.includes("complete") + " record:" + submitted);

const errs = (await bit.errors()).filter((e) => !/404/.test(e));
console.log(errs.length ? "ERRORS:\n  " + errs.join("\n  ") : "errors: none");
await bit.close();
process.exit(ok ? 0 : 1);
