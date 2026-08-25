/* Drives both cars at once with real button holds and scores a real point. */
import { openBit } from "./run.mjs";
const bit = await openBit("/home/user/my-bits/helmet-derby");
let fails = 0;
const check = (ok, m) => { console.log((ok ? "  ok   " : "  FAIL ") + m); if (!ok) fails++; };
const st = () => bit.probe(() => ({ phase: window.__DERBY__.phase, score: window.__DERBY__.score,
                                    cars: window.__DERBY__.cars, winner: window.__DERBY__.winner }));

await bit.wait(700);
await bit.shot("derby-1-title");
await bit.page.click('[data-el="go"]');
await bit.wait(900);
await bit.shot("derby-2-arena");

let s = await st();
check(s.phase === "play", "the arena is live");
check(s.cars.length === 2, "two cars on the boards");
const startX = s.cars.map((c) => c.x);

// Both players hold a button in the same instant — each pad must drive only
// its own car.
// Measured from the test side with Playwright, not from inside the bit:
// offsetLeft is relative to the offset parent, so a button inside a
// positioned wrapper reports coordinates that are not screen coordinates.
const bbox = async (n) => {
  const b = await bit.page.locator('[data-el="' + n + '"]').boundingBox();
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
};
const box = { emberFwd: await bbox("Ember-fwd"), azureBack: await bbox("Azure-back") };
await bit.fingerDown(1, box.emberFwd.x, box.emberFwd.y);
await bit.fingerDown(2, box.azureBack.x, box.azureBack.y);
await bit.wait(1100);
s = await st();
check(s.cars[0].drive === 1, "Ember's pad drives Ember (drive=" + s.cars[0].drive + ")");
check(s.cars[1].drive === -1, "Azure's pad drives Azure (drive=" + s.cars[1].drive + ")");
await bit.shot("derby-3-driving");
await bit.fingerUp(1);
await bit.fingerUp(2);
await bit.wait(300);
s = await st();
check(s.cars[0].drive === 0 && s.cars[1].drive === 0, "letting go stops both cars");
check(Math.abs(s.cars[0].x - startX[0]) > 6 || Math.abs(s.cars[1].x - startX[1]) > 6,
      "the cars actually moved");

// Land one car on the other's helmet and check the point lands.
const before = (await st()).score.slice();
await bit.probe(() => window.__DERBY__.forceBonk());
await bit.wait(900);
s = await st();
check(s.score[0] + s.score[1] > before[0] + before[1],
      "landing on a helmet scores (" + s.score.join("-") + ")");
await bit.shot("derby-4-point");

const errs = (await bit.errors()).filter((e) => !/404/.test(e));
console.log(errs.length ? "ERRORS:\n  " + errs.join("\n  ") : "errors: none");
console.log(fails ? fails + " FAILED" : "all checks passed");
await bit.close();
