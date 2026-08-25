/*
 * The other two things that have to work in Cipher, in one short session:
 * the CO-OP variant that two or three players get, and the assassin.
 *
 *   pick 2 players -> co-op, one team against a simulated opposition
 *   deal, hand off, hold the pad, transmit a clue
 *   contact one red agent, then touch the assassin
 *
 * The assassin is the only input in the game that can end it outright, which
 * is exactly why it takes two deliberate taps — arm the tile, then confirm
 * from the band — and why it is worth a test of its own.
 */
import { openBit } from "./run.mjs";

const bit = await openBit("/home/user/my-bits/cipher");
await bit.wait(900);

const P = (fn, ...a) => bit.probe(fn, ...a);
const domXY = (sel) => P((s) => {
  const b = document.querySelector(s);
  const r = b.getBoundingClientRect();
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
}, sel);
async function settle(limit = 90) {
  for (let i = 0; i < limit; i++) {
    if (!(await P(() => window.__CIPHER__.busy))) return;
    await bit.wait(60);
  }
}
async function untilPhase(want, limit = 120) {
  for (let i = 0; i < limit; i++) {
    if ((await P(() => window.__CIPHER__.phase)) === want) return;
    await bit.wait(60);
  }
  throw new Error("never reached phase " + want);
}
async function contact(i) {
  await settle();
  const p = await P((k) => window.__CIPHER__.tileXY(k), i);
  await bit.tap(p.x, p.y);
  await bit.wait(110);
  const c = await P(() => window.__CIPHER__.bandXY("confirm"));
  await bit.tap(c.x, c.y);
  await settle();
}

/* ---- two players: the co-op variant ---- */
const two = await domXY('[data-el="counts"] button[data-v="2"]');
await bit.tap(two.x, two.y);
await bit.wait(200);
await bit.tap(...Object.values(await domXY('[data-el="begin"]')));
await untilPhase("handoff");

/* ---- the handoff still happens: the operative must not see the key ---- */
await bit.wait(800);
const pad = await P(() => window.__CIPHER__.padXY());
await bit.fingerDown(1, pad.x, pad.y);
await bit.wait(1200);
if (!(await P(() => window.__CIPHER__.peek))) throw new Error("the hold did not expose the key");
await bit.fingerUp(1);
// No number to set: the clue is spoken, and the team guesses until it is
// wrong or ends its own turn.
const t = await P(() => window.__CIPHER__.transmitXY());
await bit.tap(t.x, t.y);
await untilPhase("board");
await settle();

const st = await P(() => ({ kinds: window.__CIPHER__.kinds, shown: window.__CIPHER__.shown }));
const first = (kind) => st.kinds.findIndex((k, i) => k === kind && !st.shown[i]);

/* ---- one good contact, then the assassin ---- */
await contact(first("red"));
const mid = await P(() => ({ remaining: window.__CIPHER__.remaining, turn: window.__CIPHER__.turn }));

/* An armed tile is not a committed one: this tap only lifts the card. */
const ax = await P((k) => window.__CIPHER__.tileXY(k), first("assassin"));
await bit.tap(ax.x, ax.y);
await bit.wait(160);
const armedOnly = await P(() => ({ armed: window.__CIPHER__.armed, winner: window.__CIPHER__.winner }));
await bit.shot("cipher-armed");

const c = await P(() => window.__CIPHER__.bandXY("confirm"));
await bit.tap(c.x, c.y);
await bit.wait(700);
await bit.shot("cipher-assassin");
await bit.wait(1400);
await bit.shot("cipher-assassin-over");

const end = await P(() => ({
  phase: window.__CIPHER__.phase,
  winner: window.__CIPHER__.winner,
  ending: window.__CIPHER__.ending,
  guesses: window.__CIPHER__.guesses,
}));
console.log("after one red agent:", JSON.stringify(mid));
console.log("assassin armed only:", JSON.stringify(armedOnly));
console.log("end:                ", JSON.stringify(end));

const ok = mid.remaining.red === 8 && armedOnly.winner === null &&
           end.ending === "assassin" && end.winner === "blue" && end.phase === "over";
console.log(ok ? "PASS — co-op deal, armed assassin held, confirm ended the game"
               : "FAIL");

const errs = (await bit.errors()).filter((e) => !/404/.test(e));
console.log(errs.length ? "ERRORS:\n  " + errs.join("\n  ") : "errors: none");
await bit.close();
process.exit(ok ? 0 : 1);
