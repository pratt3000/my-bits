/* Serves real orders through the real controls, and checks a miss hurts. */
import { openBit } from "./run.mjs";
const bit = await openBit("/home/user/my-bits/bridge-crew");
let fails = 0;
const check = (ok, m) => { console.log((ok ? "  ok   " : "  FAIL ") + m); if (!ok) fails++; };
const st = () => bit.probe(() => {
  const B = window.__BRIDGE__;
  return { phase: B.phase, hull: B.hull, served: B.served, missed: B.missed,
           wave: B.wave, orders: B.orders };
});

await bit.wait(700);
await bit.shot("bridge-1-title");
await bit.page.click('[data-el="pc"] button[data-v="4"]');
await bit.page.click('[data-el="go"]');
await bit.wait(1500);
await bit.shot("bridge-2-panel");

let s = await st();
check(s.phase === "play", "the panel is live");
check(s.hull === 100, "hull starts full");

// Every order is owned by exactly one console, which is the whole design.
await bit.wait(1200);
s = await st();
check(s.orders.length > 0, "orders are arriving (" + s.orders.length + ")");
check(s.orders.every((o) => o.owner >= 0 && o.owner < 4), "every order names a crew member");

// Expiry first, while the ship is still alive. Once the hull is gone the
// game is over and nothing expires any more — testing it last reads as a
// broken timer when it is really just a finished game.
const before = await st();
for (let i = 0; i < 30; i++) {
  await bit.wait(700);
  if ((await st()).missed > before.missed) break;
}
s = await st();
check(s.missed > before.missed, "an ignored order expires");
check(s.hull < 100, "a missed order costs hull (" + s.hull + ")");

// Serve orders the way a player would: press the actual control.
for (let i = 0; i < 34; i++) {
  const t = await bit.probe(() => window.__BRIDGE__.firstOrderTarget());
  if (!t) { await bit.wait(220); continue; }
  if (t.kind === "lever") {
    await bit.fingerDown(9, t.x, t.y);
    await bit.wait(1300);                       // levers must actually be held
    await bit.fingerUp(9);
  } else if (t.kind === "dial") {
    // A dial steps round one press at a time, so it may take several.
    for (let k = 0; k < 6; k++) {
      await bit.tap(t.x, t.y);
      await bit.wait(70);
      const now = await bit.probe(() => window.__BRIDGE__.firstOrderTarget());
      if (!now || now.x !== t.x || now.y !== t.y) break;
    }
  } else {
    await bit.tap(t.x, t.y);
    await bit.wait(120);
  }
}
await bit.shot("bridge-3-serving");
s = await st();
console.log("after serving:", JSON.stringify({ served: s.served, missed: s.missed, hull: s.hull, wave: s.wave }));
check(s.served > 0, "orders were served by pressing real controls (" + s.served + ")");

await bit.shot("bridge-4-damage");

const errs = (await bit.errors()).filter((e) => !/404/.test(e));
console.log(errs.length ? "ERRORS:\n  " + errs.join("\n  ") : "errors: none");
console.log(fails ? fails + " FAILED" : "all checks passed");
await bit.close();
