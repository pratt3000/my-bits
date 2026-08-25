/*
 * Plays a full match of Cipher through the real UI — taps only, never
 * reaching into state to move the game along — and asserts the bit reaches a
 * genuine win.
 *
 *   turn 1  RED    clue OWL:2   two red agents, then a bystander (turn ends)
 *   turn 2  BLUE   clue :1      one blue agent, then END TURN
 *   turn 3  RED    clue :7      the seven remaining red agents — red wins
 *
 * Every turn goes through the real handoff: the shutters close, the pad is
 * held for the full 700ms, the key comes up, the number is picked and
 * TRANSMIT fires. The probe is used only to read the key (which is the one
 * thing a scripted operative cannot see) and to find button centres.
 */
import { openBit } from "./run.mjs";

const bit = await openBit("/home/user/my-bits/cipher");
await bit.wait(900);

const P = (fn, ...a) => bit.probe(fn, ...a);
const state = () => P(() => ({
  phase: window.__CIPHER__.phase,
  turn: window.__CIPHER__.turn,
  kinds: window.__CIPHER__.kinds,
  shown: window.__CIPHER__.shown,
  guesses: window.__CIPHER__.guesses,
  remaining: window.__CIPHER__.remaining,
  winner: window.__CIPHER__.winner,
}));

/** Wait on the animation, not on the state: the board rejects input while a
 *  card is turning, and a tap that lands then is silently dropped. */
async function settle(limit = 90) {
  for (let i = 0; i < limit; i++) {
    if (!(await P(() => window.__CIPHER__.busy))) return true;
    await bit.wait(60);
  }
  return false;
}
async function untilPhase(want, limit = 90) {
  for (let i = 0; i < limit; i++) {
    if ((await P(() => window.__CIPHER__.phase)) === want) return true;
    await bit.wait(60);
  }
  throw new Error("never reached phase " + want);
}
const domXY = (sel) => P((s) => {
  const b = document.querySelector(s);
  const r = b.getBoundingClientRect();
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
}, sel);

/** One spymaster turn: hold the pad, read the key, set the number, transmit. */
async function brief(num, { word, shots } = {}) {
  await untilPhase("handoff");
  await bit.wait(950);                       // the pass line finishes typing
  if (shots) await bit.shot(shots + "-handoff");

  const pad = await P(() => window.__CIPHER__.padXY());
  await bit.wait(150);                       // let the renderer settle after a shot
  await bit.fingerDown(1, pad.x, pad.y);
  await bit.wait(1200);                      // 700ms hold, then the key is up
  const up = await P(() => ({ peek: window.__CIPHER__.peek, phase: window.__CIPHER__.phase }));
  if (!up.peek) throw new Error("the hold did not expose the key");
  if (shots) await bit.shot(shots + "-key");
  await bit.fingerUp(1);
  await bit.wait(120);
  const down = await P(() => window.__CIPHER__.peek);
  if (down) throw new Error("the key stayed up after the finger lifted");

  if (word) {
    const chip = await P(() => window.__CIPHER__.chipXY());
    await bit.tap(chip.x, chip.y);
    await bit.wait(150);
    for (const ch of word) {
      const k = await P((c) => window.__CIPHER__.keyXY(c), ch);
      await bit.tap(k.x, k.y);
      await bit.wait(70);
    }
    if (shots) await bit.shot(shots + "-typing");
    const ok = await P(() => window.__CIPHER__.keyXY("OK"));
    await bit.tap(ok.x, ok.y);
    await bit.wait(150);
  }

  const pill = await P((n) => window.__CIPHER__.pillXY(n), num);
  await bit.tap(pill.x, pill.y);
  await bit.wait(120);
  const t = await P(() => window.__CIPHER__.transmitXY());
  await bit.tap(t.x, t.y);
  await untilPhase("board");
  await settle();
}

/** Arm a codeword, then confirm it from the active team's own band. */
async function contact(i) {
  await settle();
  const p = await P((k) => window.__CIPHER__.tileXY(k), i);
  await bit.tap(p.x, p.y);
  await bit.wait(110);
  if ((await P(() => window.__CIPHER__.armed)) !== i) throw new Error("tile " + i + " did not arm");
  const c = await P(() => window.__CIPHER__.bandXY("confirm"));
  await bit.tap(c.x, c.y);
  await settle();
}
const pick = (st, kind, n) =>
  st.kinds.map((k, i) => [k, i]).filter(([k, i]) => k === kind && !st.shown[i])
    .map(([, i]) => i).slice(0, n);

/* ---- deal ---- */
await bit.tap(...Object.values(await domXY('[data-el="begin"]')));
await untilPhase("handoff");

/* ---- turn 1: RED, clue OWL 2 ---- */
let st = await state();
await brief(2, { word: "OWL", shots: "cipher" });
for (const i of pick(st, "red", 2)) await contact(i);
await bit.shot("cipher-board");
st = await state();
await contact(pick(st, "neutral", 1)[0]);         // bystander: turn ends

/* ---- turn 2: BLUE, clue 1 ---- */
st = await state();
if (st.turn !== "blue") throw new Error("the bystander did not end red's turn");
await brief(1);
await contact(pick(st, "blue", 1)[0]);
await bit.shot("cipher-blue");                    // blue's band, rotated to their seat
const pass = await P(() => window.__CIPHER__.bandXY("pass"));
await bit.tap(pass.x, pass.y);                    // END TURN, legal after one guess
await settle();

/* ---- turn 3: RED takes the rest ---- */
st = await state();
if (st.turn !== "red") throw new Error("END TURN did not hand the phone back to red");
await brief(7);
for (const i of pick(st, "red", 7)) await contact(i);

await bit.wait(1400);
await bit.shot("cipher-end");
const end = await state();

// The record is a property of the match, so it must be submitted exactly once
// and carry the whole match's guess count.
const log = await bit.events();
const submits = log.filter((e) => e.kind === "memory.record.submit");
const beds = log.filter((e) => e.kind === "music.play");

console.log("record:   ", JSON.stringify(submits.map((e) => e.args)));
console.log("music:    ", JSON.stringify(beds.map((e) => e.args[0])),
            "| stings:", log.filter((e) => e.kind === "music.sting").map((e) => e.args[0]).join(","));
console.log("winner:   ", end.winner, "| phase:", end.phase);
console.log("guesses:  ", end.guesses);
console.log("remaining:", JSON.stringify(end.remaining));
const ok = end.winner === "red" && end.remaining.red === 0 && end.phase === "over" &&
           end.guesses === 11 &&
           submits.length === 1 && submits[0].args[0] === "fewest_guesses" &&
           submits[0].args[1] === 11 &&
           beds.length === 1;
console.log(ok ? "PASS — red contacted all nine agents in a real match" : "FAIL");

const errs = (await bit.errors()).filter((e) => !/404/.test(e));
console.log(errs.length ? "ERRORS:\n  " + errs.join("\n  ") : "errors: none");
await bit.close();
process.exit(ok ? 0 : 1);
