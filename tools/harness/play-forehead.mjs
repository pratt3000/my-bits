/* Plays a full round with taps, since headless has no accelerometer. */
import { openBit } from "./run.mjs";
const bit = await openBit("/home/user/my-bits/forehead");
await bit.wait(700);
await bit.shot("forehead-1-title");
const click = async (sel) => { await bit.page.click(sel); await bit.wait(200); };

await click('[data-el="decks"] button[data-v="animals"]');
await click('[data-el="secs"] button[data-v="30"]');
await click('[data-el="go"]');
await bit.wait(400);
await bit.shot("forehead-2-ready");
console.log("tilt available in headless:", await bit.probe(() => window.__FOREHEAD__.tiltAvailable));
await click('[data-el="go3"]');
// Wait for play to actually begin. Headless runs at a handful of frames a
// second, so a fixed sleep lands mid-countdown and the first tap is eaten.
for (let i = 0; i < 80; i++) {
  await bit.wait(100);
  if ((await bit.probe(() => window.__FOREHEAD__.phase)) === "play") break;
}
await bit.shot("forehead-3-word");
console.log("phase:", await bit.probe(() => window.__FOREHEAD__.phase),
            "| word:", await bit.probe(() => window.__FOREHEAD__.word));

// Six answers: right half is a hit, left half a pass.
for (let i = 0; i < 6; i++) {
  await bit.tap(i % 3 === 2 ? 90 : 300, 420);
  await bit.wait(520);
}
const r = await bit.probe(() => window.__FOREHEAD__.results);
console.log("results:", JSON.stringify(r.map((x) => x.word + (x.hit ? " ✓" : " ✗"))));
const hits = r.filter((x) => x.hit).length;
console.log("hits:", hits, "of", r.length, (hits === 4 && r.length === 6) ? "— PASS" : "— FAIL");
const errs = (await bit.errors()).filter((e) => !/404/.test(e));
console.log(errs.length ? "ERRORS:\n  " + errs.join("\n  ") : "errors: none");
await bit.close();
