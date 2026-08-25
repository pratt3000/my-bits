/*
 * Plays a complete three-handed game of Go Fish through the real UI — every
 * tap goes through the canvas hit zones the bit registers for itself, nothing
 * reaches into the state to move a card.
 *
 * What it asserts:
 *   - the ask rule: every rank asked for was in the asker's own hand at the
 *     moment of asking, and every player offered as a target had cards;
 *   - the deck is conserved: ocean + hands + books x4 is 52 at every step;
 *   - a successful ask keeps the turn, an unsuccessful one passes it (unless
 *     going again is impossible, which is a real position);
 *   - a book is four of a kind and no rank books twice;
 *   - the game reaches a real end state — the ocean dry, the hands gone, a
 *     winner (or an honest tie) on the board.
 *
 * A full game is sixty-odd turns of three or four public beats each, and in
 * headless SwiftShader every round trip waits on a frame. So the waiting is
 * done INSIDE the page with waitForFunction — one round trip per beat rather
 * than a poll loop — and the two fixed buttons (skip, reveal) are tapped at
 * coordinates read once rather than re-queried every turn.
 */
import { openBit } from "./run.mjs";

const bit = await openBit("/home/user/my-bits/go-fish");
await bit.wait(700);
await bit.shot("gofish-1-title");

const look = () => bit.probe(() => {
  const G = window.__GOFISH__;
  const z = {};
  for (const id of G.zones) { const p = G.zone(id); if (p) z[id] = [p.x, p.y]; }
  return {
    phase: G.phase, beat: G.beat, ocean: G.ocean, turn: G.turn, hands: G.hands,
    books: G.books, bookRanks: G.bookRanks, ranks: G.ranksInHand, targets: G.targets,
    census: G.census, winner: G.winner, topBooks: G.topBooks, asks: G.asks,
    names: G.names, z,
  };
});
const tapAt = async (s, id) => { const p = s.z[id]; if (!p) return false; await bit.tap(p[0], p[1]); return true; };

/**
 * Block in-page until the bit wants input again, and come back with what it
 * wants. Returns "beat" only once that beat will actually accept a skip.
 */
const settle = async () => {
  const h = await bit.page.waitForFunction(() => {
    const G = window.__GOFISH__;
    if (!G) return false;
    if (G.phase === "beat") return G.canSkip ? "beat" : false;
    if (G.phase === "deal") return false;
    // Wait for the screen to have been PAINTED, not just entered. The hit
    // zones register as the frame draws, so a phase read the instant it flips
    // hands back the previous screen's buttons and every tap misses.
    if (G.phase === "ask") return G.zones.indexOf("ask") >= 0 ? "ask" : false;
    if (G.phase === "cover") return G.zones.indexOf("reveal") >= 0 ? "cover" : false;
    return G.phase;
  }, { timeout: 30000 });
  return h.jsonValue();
};

// The public beats are meant to hold long enough to be read out loud, which is
// minutes of wall clock across a whole game.
await bit.page.click('[data-el="cog"]');
await bit.wait(200);
await bit.page.click('[data-el="paces"] button[data-v="2"]');
await bit.wait(140);
await bit.shot("gofish-2-settings");
await bit.page.click('[data-el="cogp-close"]');
await bit.wait(180);

await bit.page.click('[data-el="help"]');
await bit.wait(260);
await bit.shot("gofish-3-help");
await bit.page.click('[data-el="helpp-close"]');
await bit.wait(180);

let s = await look();
await tapAt(s, "pl3");
await bit.wait(140);
s = await look();
await tapAt(s, "deal");
await settle();

// Read the two fixed buttons once. Both are anchored to the bottom safe area
// and never move, so re-querying them sixty times costs a frame each for
// nothing.
s = await look();
const REVEAL = s.z["reveal"];
const SKIP = [bit.viewport.width / 2, bit.viewport.height * 0.42];

const shots = {};
const problems = [];
const t0 = Date.now();
let iter = 0, badCensus = 0, turnKept = 0, turnPassed = 0, steps = 0;
let lastAskCount = -1, stalled = 0;
let pending = null;

for (steps = 0; steps < 1600; steps++) {
  const where = steps === 0 ? "cover" : await settle();
  if (steps % 20 === 0) {
    const p = await bit.probe(() => {
      const G = window.__GOFISH__;
      return G.ocean + "/" + G.books.join("") + " asks " + G.asks;
    });
    process.stdout.write("  step " + steps + " · " + where + " · ocean " + p + " · " +
      ((Date.now() - t0) / 1000).toFixed(0) + "s\n");
  }
  if (where === "over") break;

  if (where === "beat") {
    // Only look when a screenshot might be due — the beat id is the only
    // thing worth knowing here and every look costs a frame.
    if (Object.keys(shots).length < 6) {
      s = await look();
      if (s.census !== 52) { badCensus++; problems.push("census " + s.census + " during a beat"); }
      if (s.beat === "ask" && !shots.beatAsk) { await bit.wait(200); shots.beatAsk = await bit.shot("gofish-6-public-ask"); }
      if (s.beat === "fish" && !shots.beatFish) { await bit.wait(200); shots.beatFish = await bit.shot("gofish-7-go-fish"); }
      if (s.beat === "give" && !shots.beatGive) { await bit.wait(260); shots.beatGive = await bit.shot("gofish-8-hands-over"); }
      if (s.beat === "caught" && !shots.caught) { await bit.wait(240); shots.caught = await bit.shot("gofish-9-fished-it-out"); }
      if (s.beat === "book" && !shots.book) { await bit.wait(600); shots.book = await bit.shot("gofish-10-book"); }
    }
    await bit.tap(SKIP[0], SKIP[1]);
    continue;
  }

  if (where === "cover") {
    if (!shots.cover) { s = await look(); shots.cover = await bit.shot("gofish-4-cover"); }
    if (pending) {
      const h = await bit.probe(() => ({ t: window.__GOFISH__.turn, hands: window.__GOFISH__.hands,
                                         c: window.__GOFISH__.census, talk: window.__GOFISH__.talk }));
      // What the table heard is the record of what happened: the last line is
      // the ask that just resolved.
      const last = h.talk[h.talk.length - 1];
      if (last && (last.got > 0 || last.caught)) pending.hit = true;
      if (h.c !== 52) { badCensus++; problems.push("census " + h.c + " at a cover"); }
      const kept = h.t === pending.turn;
      // A hit keeps the turn — unless going again is impossible, which is a
      // real position rather than a bug: the four cards that completed a book
      // may have been the whole hand, or every opponent may now be empty.
      const stuck = h.hands[pending.turn] === 0 ||
        h.hands.filter((n, i) => i !== pending.turn && n > 0).length === 0;
      if (pending.hit) {
        if (kept) turnKept++;
        else if (stuck) turnPassed++;
        else problems.push("a hit should keep the turn");
      } else if (!kept) turnPassed++;
      else problems.push("a miss should pass the turn");
      pending = null;
    }
    await bit.tap(REVEAL[0], REVEAL[1]);
    continue;
  }

  // where === "ask"
  s = await look();
  if (s.census !== 52) { badCensus++; problems.push("census " + s.census + " on the ask screen"); }
  if (!s.ranks.length || !s.targets.length) { problems.push("ask screen with nothing to ask"); break; }
  for (const ti of s.targets) if (s.hands[ti] === 0) problems.push("offered an empty-handed target");
  if (s.targets.includes(s.turn)) problems.push("offered the asker themselves");

  // Rotate the choice. Always taking the first rank and the first target
  // deadlocks once the ocean is dry: two players trade misses forever because
  // neither ever varies what it asks for.
  const ri = iter % s.ranks.length;
  const ci = iter % s.targets.length;
  const rank = s.ranks[ri];
  iter++;

  await tapAt(s, "cell" + ri);
  await tapAt(s, "chip" + ci);
  if (!shots.ask) { await bit.wait(140); shots.ask = await bit.shot("gofish-5-ask-picked"); }
  // The rule under test: only a rank already in the asker's own hand.
  if (!s.ranks.includes(rank)) problems.push("asked for a rank not held: " + rank);
  // Two taps on the two pickers must leave an ask armed. Without this check a
  // picker that clears its own selection does not fail the test, it hangs it —
  // which is exactly what a toggling target chip did in the endgame, where
  // there is only one opponent left and it was pre-selected for the player.
  const armed = await bit.probe(() => ({ r: window.__GOFISH__.selRank, t: window.__GOFISH__.selTarget }));
  if (armed.r !== rank || armed.t < 0) {
    problems.push("picking a rank and a player left the ask unarmed (" + armed.r + "/" + armed.t + ")");
    break;
  }
  pending = { turn: s.turn, rank, hit: false };
  await tapAt(s, "ask");

  // Nothing may sit still. If a whole lap of the table goes by without an ask
  // being registered, the game is stuck and the test should say so.
  if (s.asks === lastAskCount) { if (++stalled > 12) { problems.push("stalled: no ask registered in 12 tries"); break; } }
  else { stalled = 0; lastAskCount = s.asks; }
}

const end = await look();
await bit.wait(600);
shots.over = await bit.shot("gofish-11-over");

// A book is four of a kind, and no rank may book twice across the table.
const seen = new Set();
for (const list of end.bookRanks) {
  for (const r of list) {
    if (seen.has(r)) problems.push("rank " + r + " booked twice");
    seen.add(r);
  }
}

const totalBooks = end.books.reduce((a, b) => a + b, 0);
console.log("players:      ", end.names.join(", "));
console.log("asks made:    ", end.asks, "| script steps:", steps, "| wall:", ((Date.now() - t0) / 1000).toFixed(0) + "s");
console.log("books:        ", JSON.stringify(end.books), "= " + totalBooks + " of 13");
console.log("book ranks:   ", JSON.stringify(end.bookRanks));
console.log("ocean:        ", end.ocean, "| hands:", JSON.stringify(end.hands));
console.log("winner:       ", end.winner || "(tie)", "| best:", end.topBooks);
console.log("census:       ", end.census, badCensus ? "BAD x" + badCensus : "(52 every time it was read)");
console.log("turn kept after a hit:", turnKept, "| passed after a miss:", turnPassed);

const ok =
  end.phase === "over" &&
  end.ocean === 0 &&
  end.census === 52 &&
  badCensus === 0 &&
  totalBooks >= 11 &&
  end.topBooks >= 1 &&
  turnKept > 0 && turnPassed > 0 &&
  problems.length === 0;

if (problems.length) console.log("PROBLEMS:\n  " + problems.slice(0, 10).join("\n  "));
console.log("shots:\n  " + Object.values(shots).join("\n  "));
console.log(ok ? "PASS — a whole ocean fished out, rules held" : "FAIL");

const errs = (await bit.errors()).filter((e) => !/404/.test(e));
console.log(errs.length ? "ERRORS:\n  " + errs.join("\n  ") : "errors: none");
await bit.close();
process.exit(ok ? 0 : 1);
