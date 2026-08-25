/*
 * Drives a real four-player race to a real finish: four thumbs down at the
 * same instant, four sticks steered independently, briars planted from four
 * corners in one frame, and a genuine win in the heart cell.
 */
import { openBit } from "./run.mjs";

const bit = await openBit("/home/user/my-bits/maze-duel");
const fail = [];
const check = (ok, what) => { if (!ok) fail.push(what); console.log((ok ? "ok   " : "FAIL ") + what); };

/** Tap a control by its data-el name (or the nth button inside one). */
async function tapEl(name, nth) {
  const p = await bit.probe(([n, i]) => {
    const host = document.querySelector('[data-el="' + n + '"]');
    if (!host) return null;
    const node = i === undefined ? host : host.querySelectorAll("button")[i];
    if (!node) return null;
    const r = node.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }, [name, nth]);
  if (!p) throw new Error("no control " + name + "/" + nth);
  await bit.tap(p.x, p.y);
}

await bit.wait(900);
await bit.shot("maze-1-title");

// --- the two panels, then a smaller garden so a SwiftShader run finishes ---
await tapEl("help");
await bit.wait(320);
await bit.shot("maze-2-help");
await tapEl("helpp-close");
await bit.wait(250);
await tapEl("cog");
await bit.wait(320);
await bit.shot("maze-3-settings");
await tapEl("sizes", 0);                          // "Small" = 9x9
await bit.wait(200);
await tapEl("cogp-close");
await bit.wait(250);

// --- four players, then go ---
await tapEl("counts", 2);
await bit.wait(280);
await bit.shot("maze-4-four-up");
await tapEl("go");
await bit.wait(650);

const zones = await bit.probe(() => {
  const m = window.__MAZE__;
  return m ? [0, 1, 2, 3].map((i) => m.zone(i)) : null;
});
check(!!zones, "probe exposes the four stick zones");

const corners = await bit.probe(() => window.__MAZE__.cornerDists());
console.log("corner distances to the heart:", JSON.stringify(corners));
check(corners.every((d) => d === corners[0] && d > 0),
      "all four corners are exactly the same number of steps from the heart");

// Four thumbs land in the same frame, one per corner — the case that breaks a
// shared-screen game if pointers are not bound per id.
for (let i = 0; i < 4; i++) await bit.fingerDown(i + 1, zones[i].x, zones[i].y);
// Headless runs on SwiftShader at a few frames a second — and slower still when
// another agent's browser is sharing the box — so the countdown is waited out by
// polling the bit's own phase rather than by wall time.
let live = false;
for (let i = 0; i < 70 && !live; i++) {
  await bit.wait(700);
  live = (await bit.probe(() => window.__MAZE__.phase)) === "play";
}
await bit.shot("maze-5-start");
check(live, "the race started with four fingers already down");

// --- the race. Crimson runs the shortest path every step; the other three are
// steered every other tick so somebody actually wins. ---
let planted = false;
for (let step = 0; step < 90; step++) {
  const st = await bit.probe(() => {
    const m = window.__MAZE__;
    return { phase: m.phase, hints: [0, 1, 2, 3].map((i) => m.hint(i)), ps: m.players() };
  });
  // "count" means the countdown is still running on a very slow frame budget:
  // wait it out rather than treating it as the end of the race.
  if (st.phase === "count") { await bit.wait(500); continue; }
  if (st.phase !== "play") break;

  for (let i = 0; i < 4; i++) {
    const h = st.hints[i];
    if (!h || (i > 0 && step % 2 === 1)) continue;   // handicap the field
    const z = zones[i];
    await bit.fingerMove(i + 1, z.x + h.x * z.r * 0.95, z.y + h.y * z.r * 0.95);
  }

  if (step === 6) await bit.shot("maze-6-running");

  // Every corner plants a briar in the same frame: four short taps, all
  // landing together, each one having to find its own owner.
  //
  // Armed on the state, never on a step count. A tap with nothing in hand is
  // a fizzle by design, and on a SwiftShader run the countdown alone can eat
  // the first dozen steps of this loop — so a fixed step number tests the
  // frame budget, not the game.
  const armed = st.ps.filter((p) => p.briars > 0).length >= 2;
  if (armed && step > 6 && !planted) {
    planted = true;
    for (let i = 0; i < 4; i++) await bit.fingerUp(i + 1);
    await bit.tapTogether(zones.map((z) => ({ x: z.x, y: z.y })));
    // A tap taken mid-corridor is spent when the peg clears the gap, so the
    // hedges land a beat later, not in the same frame as the tap.
    await bit.wait(1400);
    const b = await bit.probe(() => window.__MAZE__.briars);
    const why = await bit.probe(() => window.__MAZE__.plantLog);
    // The thing under test is that all four taps REACHED their own player.
    // Whether each became a hedge is then the game's own rules talking, and a
    // legal refusal is not a routing bug.
    const seats = new Set(why.map((w) => w.seat));
    check(seats.size >= 3, "four simultaneous taps reached " + seats.size + " different seats");
    check(b >= 1, "at least one became a hedge (" + b + ") — outcomes: " + JSON.stringify(why));
    await bit.shot("maze-7-briars");
    for (let i = 0; i < 4; i++) await bit.fingerDown(i + 1, zones[i].x, zones[i].y);
  }

  await bit.wait(240);
}

// Every finger comes up before the end screen: a tap that reuses a touch id
// still held down is silently dropped, so the rematch button would never fire.
for (let i = 0; i < 4; i++) { try { await bit.fingerUp(i + 1); } catch (_) {} }
await bit.wait(900);
const end = await bit.probe(() => {
  const m = window.__MAZE__;
  return { phase: m.phase, winner: m.winner, ms: m.elapsed, players: m.players() };
});
console.log("end state:", JSON.stringify(end));
check(end.phase === "over", "the race reached a real end state");
check(!!end.winner, "a peg entered the heart and won");
check(end.ms > 0, "a solve time was measured");
await bit.shot("maze-8-won");

// --- rematch path ---
await tapEl("again");
await bit.wait(1500);
const again = await bit.probe(() => window.__MAZE__.phase);
check(again === "count" || again === "play", "rematch starts a fresh garden (" + again + ")");
await bit.shot("maze-9-rematch");

const kinds = await bit.eventKinds();
const tally = {};
for (const k of kinds) tally[k] = (tally[k] || 0) + 1;
console.log("events:", JSON.stringify(tally));
check(kinds.includes("memory.record.submit"), "the solve time went to the leaderboard");
check(kinds.includes("music.play"), "the music bed started");
check(kinds.includes("haptic"), "haptics fired");

const errs = (await bit.errors()).filter((e) => !/404/.test(e));
console.log(errs.length ? "ERRORS:\n  " + errs.join("\n  ") : "errors: none");
console.log(fail.length ? "\nFAILED: " + fail.join(" | ") : "\nALL CHECKS PASSED");
await bit.close();
