/*
 * Plays two complete Othello games on one board.
 *
 * The first is the shortest possible wipe-out — nine plies, White erased —
 * which is the only way to reach a genuine terminal position inside a
 * screenshot budget; a full game is sixty moves. The second is the shortest
 * line that forces a pass, because a mandatory pass is the rule newcomers
 * read as a bug and the card that explains it has to be proved to appear.
 *
 * Along the way it drives the case that actually breaks a shared-screen
 * board: two fingers landing on two different legal cells in the same frame.
 */
import { openBit } from "./run.mjs";

const bit = await openBit("/home/user/my-bits/othello");

/** Centre of a DOM control. Harness-side only — the bit itself never reads a rect. */
const hit = (sel, i = 0) => bit.probe(([s, k]) => {
  const n = document.querySelectorAll(s)[k];
  const r = n.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}, [sel, i]);

const at = (cell) => bit.probe((c) => window.__OTHELLO__.cellXY(c), cell);
const look = () => bit.probe(() => ({
  phase: window.__OTHELLO__.phase, turn: window.__OTHELLO__.turn,
  counts: window.__OTHELLO__.counts, armed: window.__OTHELLO__.armed,
  last: window.__OTHELLO__.last, moves: window.__OTHELLO__.moves,
  result: window.__OTHELLO__.result, legal: window.__OTHELLO__.legal,
}));

// A move commits its state immediately and then animates; input is blocked
// until the cascade lands. Poll the flag, never the state.
async function settle(max = 40) {
  for (let i = 0; i < max; i++) {
    if (!(await bit.probe(() => window.__OTHELLO__.busy))) return true;
    await bit.wait(70);
  }
  return false;
}

const fails = [];
const check = (ok, what) => { if (!ok) fails.push(what); console.log((ok ? "  ok   " : "  FAIL ") + what); };

/* ---- title ------------------------------------------------------- */
await bit.wait(900);
await bit.shot("othello-1-title");
let st = await look();
check(st.phase === "title", "boots to the title with the board already dressed");
check(st.counts.black === 2 && st.counts.white === 2, "opening position is two discs each");
check(st.turn === "black", "Black moves first");
check(st.legal.slice().sort().join(",") === "c4,d3,e6,f5",
  "Black's four opening moves are exactly c4/d3/e6/f5, got " + st.legal.join(","));

const start = await hit('[data-el="start"]');
await bit.tap(start.x, start.y);
await bit.wait(420);

/* ---- two fingers, same frame, two different legal cells ---------- */
const d3 = await at("d3"), f5 = await at("f5");
await bit.tapTogether([{ x: d3.x, y: d3.y }, { x: f5.x, y: f5.y }]);
await bit.wait(260);
st = await look();
check(st.armed === "d3",
  "two fingers in one frame arm exactly one cell (the first), got " + st.armed);
await bit.shot("othello-2-armed");

/* ---- commit it, then switch to one-tap placing so the rest of the
 *      game fits inside the step budget ---------------------------- */
await bit.tap(d3.x, d3.y);
await settle();
st = await look();
check(st.counts.black === 4 && st.counts.white === 1,
  "d3 flips d4: 4-1, got " + st.counts.black + "-" + st.counts.white);

const cog = await hit('[data-el="cog"]', 1);          // the near end's cog
await bit.tap(cog.x, cog.y);
await bit.wait(320);
await bit.shot("othello-7-settings");
const instant = await hit('[data-el="set-confirm"] button', 1);
await bit.tap(instant.x, instant.y);
await bit.wait(180);
const done = await hit('[data-el="cogp-close"]');
await bit.tap(done.x, done.y);
await bit.wait(240);

// The rules, opened from the FAR end: the card should turn to face it.
// How to play now hangs off settings rather than carrying its own key in the
// strip, so it is two taps and it inherits the way settings was facing.
const farCog = await hit('[data-el="cog"]', 0);
await bit.tap(farCog.x, farCog.y);
await bit.wait(280);
const toHelp = await hit('[data-el="to-help"]', 0);
await bit.tap(toHelp.x, toHelp.y);
await bit.wait(320);
await bit.shot("othello-8-help");
const rot = await bit.probe(() =>
  getComputedStyle(document.querySelector('[data-el="helpp-card"]')).transform);
check(/matrix\(-1,/.test(rot), "a panel opened from the far end turns to face it, got " + rot);
const gotit = await hit('[data-el="helpp-close"]');
await bit.tap(gotit.x, gotit.y);
await bit.wait(240);


/* ---- the shortest wipe-out in Othello: nine plies --------------- */
for (const mv of ["c3", "b3", "d2", "e1", "d6", "d7", "e3", "f4"]) {
  const p = await at(mv);
  if (mv === "d7") {
    // Fire the capture and the screenshot together: the cascade only runs for
    // about 500ms and a sequential shot always lands after it has settled.
    const shot = bit.shot("othello-3-cascade");
    await bit.tap(p.x, p.y);
    await shot;
  } else {
    await bit.tap(p.x, p.y);
  }
  await settle();
}
await bit.wait(420);
await bit.shot("othello-4-wipeout");

st = await look();
check(st.phase === "over", "game ends by itself, phase = " + st.phase);
check(st.counts.black === 13 && st.counts.white === 0,
  "White is wiped out 13-0, got " + st.counts.black + "-" + st.counts.white);
check(st.result && st.result.margin === 64,
  "tournament margin credits the 51 empty squares: 64, got " + (st.result && st.result.margin));
check(st.moves === 9, "nine plies, got " + st.moves);

/* ---- rematch from the FAR end's button -------------------------- */
const againFar = await hit('[data-el="again"]', 0);
await bit.tap(againFar.x, againFar.y);
await bit.wait(420);
st = await look();
check(st.phase === "play" && st.counts.black === 2 && st.counts.white === 2,
  "the far player's rematch button resets the board");
await bit.shot("othello-5-rematch");

/* ---- the shortest line that forces a pass -----------------------
 * a1 on the way through is a corner, which also exercises the gold pulse. */
const passLine = ["d3", "c3", "b3", "b2", "f5", "a3", "a1", "c1"];
let passCardUp = null;
for (const mv of passLine) {
  const p = await at(mv);
  if (mv === "c1") {
    // The pass card lives for 2.4s and is tap-dismissible. Under SwiftShader a
    // single CDP round trip can cost most of that, so the screenshot is fired
    // alongside the move rather than after it, and the durable proof that the
    // pass happened is the platform event further down, not this frame.
    const shot = bit.shot("othello-6-pass");
    await bit.tap(p.x, p.y);
    passCardUp = await bit.probe(() => {
      const n = document.querySelector('[data-el="pass"]');
      const w = document.querySelector('[data-el="pass-who"]');
      return n && getComputedStyle(n).display !== "none" && w ? w.textContent : null;
    });
    await shot;
  } else {
    await bit.tap(p.x, p.y);
  }
  await settle();
}
console.log("  note   pass card seen on screen: " + JSON.stringify(passCardUp));
st = await look();
check(st.phase === "pass" || st.phase === "play",
  "the board is playable again after the pass; phase = " + st.phase);
const log = await bit.events();
const passes = log.filter((e) => e.kind === "interact" && e.args[0] && e.args[0].type === "pass");
check(passes.length === 1 && passes[0].args[0].by === "Black",
  "Black had no legal move and passed exactly once, got " + JSON.stringify(passes.map((e) => e.args[0])));
const corners = log.filter((e) => e.kind === "milestone" && e.args[0] === "corner");
check(corners.length === 1 && corners[0].args[1].cell === "a1",
  "taking a1 fires the corner milestone, got " + JSON.stringify(corners.map((e) => e.args[1])));

/* ---- report ------------------------------------------------------ */
const kinds = await bit.eventKinds();
const tally = {};
for (const k of kinds) tally[k] = (tally[k] || 0) + 1;
console.log("events:", JSON.stringify(tally));
const submitted = (await bit.events()).filter((e) => e.kind === "memory.record.submit");
console.log("records:", JSON.stringify(submitted.map((e) => e.args)));
const errs = (await bit.errors()).filter((e) => !/404/.test(e));
console.log(errs.length ? "ERRORS:\n  " + errs.join("\n  ") : "errors: none");
console.log(fails.length ? "\n" + fails.length + " CHECK(S) FAILED" : "\nall checks passed");
await bit.close();
process.exit(fails.length || errs.length ? 1 : 0);
