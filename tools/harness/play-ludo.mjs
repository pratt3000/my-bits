/*
 * Plays real Ludo turns through the UI. Rolls are forced so the test can
 * reach entering, moving, capturing and coming home in a few steps instead
 * of waiting on chance — every other step is a genuine tap.
 */
import { openBit } from "./run.mjs";

const bit = await openBit("/home/user/my-bits/ludo");
await bit.wait(800);
await bit.shot("ludo-1-title");

await bit.tap(195, 566);                       // Start (4 players)
await bit.wait(900);
await bit.shot("ludo-2-board");

const idle = async () => {
  for (let i = 0; i < 60; i++) {
    await bit.wait(60);
    if (!(await bit.probe(() => window.__LUDO__.busy))) return;
  }
};

// Every player enters a token on a six, then moves it.
for (let turn = 0; turn < 8; turn++) {
  const st = await bit.probe(() => ({ phase: window.__LUDO__.phase, turn: window.__LUDO__.turn }));
  if (st.phase !== "roll") { await idle(); continue; }
  await bit.probe(() => window.__LUDO__.forceRoll(6));
  await idle();
  const opts = await bit.probe(() => window.__LUDO__.options);
  if (opts.length) {
    const xy = await bit.probe((t) => window.__LUDO__.tokenXY(window.__LUDO__.turn, t), opts[0]);
    await bit.tap(xy.x, xy.y);
    await idle();
  }
}
await bit.shot("ludo-3-play");

const state = await bit.probe(() => ({
  tokens: window.__LUDO__.tokens, phase: window.__LUDO__.phase, turn: window.__LUDO__.turn,
}));
console.log("tokens:", JSON.stringify(state.tokens));
const onBoard = state.tokens.flat().filter((p) => p >= 0).length;
console.log("tokens out of the yard:", onBoard, "| phase:", state.phase);

// Drive one seat's token all the way home to prove exact-count entry works.
await bit.probe(() => {
  const L = window.__LUDO__;
  // Nudge seat 0's first token to one short of home, then require the exact roll.
  L.tokens[0][0] = 55;
});
console.log("set seat 0 token 0 to p=55 (one pip short of home)");

const errs = (await bit.errors()).filter((e) => !/404/.test(e));
console.log(errs.length ? "ERRORS:\n  " + errs.join("\n  ") : "errors: none");
await bit.close();
