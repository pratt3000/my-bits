/* Plays a real two-player rally: both mallets driven at once by two fingers. */
import { openBit } from "./run.mjs";

const bit = await openBit("/home/user/my-bits/slapshot");
const W = 390, H = 844;
await bit.wait(700);
await bit.shot("slap-1-title");

// Face off.
await bit.tap(W / 2, 520);
await bit.wait(500);
await bit.shot("slap-2-serve");

// Two fingers land in the same frame, one in each half — the case that
// breaks a shared-screen game if pointers are not tracked per id.
await bit.fingerDown(1, W / 2, H * 0.80);        // bottom player
await bit.fingerDown(2, W / 2, H * 0.20);        // top player
await bit.wait(1400);
await bit.shot("slap-3-play");

// Rally: both mallets chase the puck's x, each staying in its own half.
for (let i = 0; i < 90; i++) {
  const p = await bit.probe(() => {
    const c = window.__SLAP__;
    return c ? { x: c.puck.x, z: c.puck.z, hw: c.halfW, hh: c.halfH, phase: c.phase } : null;
  });
  if (!p) break;
  const px = (p.x / p.hw + 1) / 2 * W;
  await bit.fingerMove(1, Math.max(30, Math.min(W - 30, px)), H * (0.70 + Math.sin(i / 7) * 0.10));
  await bit.fingerMove(2, Math.max(30, Math.min(W - 30, px)), H * (0.30 - Math.sin(i / 9) * 0.10));
  await bit.wait(45);
  if (i === 40) await bit.shot("slap-4-rally");
}
await bit.shot("slap-5-late");

const st = await bit.probe(() => {
  const c = window.__SLAP__;
  return c ? { phase: c.phase, score: c.score, rally: c.rally, best: c.bestRally } : "no probe";
});
console.log("state:", JSON.stringify(st));
const kinds = await bit.eventKinds();
const tally = {};
for (const k of kinds) tally[k] = (tally[k] || 0) + 1;
console.log("events:", JSON.stringify(tally));
const errs = (await bit.errors()).filter(e => !/404/.test(e));
console.log(errs.length ? "ERRORS:\n  " + errs.join("\n  ") : "errors: none");
await bit.close();
