/*
 * Exercises Crownlands' placement and scoring rules directly, lifted out of
 * main.js between its markers so this tests the shipped code.
 */
import { readFileSync } from "node:fs";
const src = readFileSync("/home/user/my-bits/crownlands/main.js", "utf8");
const body = src.split("/* ===== RULES START ===== */")[1].split("/* ===== RULES END ===== */")[0];
const R = new Function(body + "\nreturn { newKingdom, at, canPlace, place, legalPlacements, scoreKingdom, DIRS, touches, fitsBounds };")();

let fails = 0;
const check = (ok, msg) => { console.log((ok ? "  ok   " : "  FAIL ") + msg); if (!ok) fails++; };
const tile = (a, ca, b, cb) => ({ a: { t: a, c: ca }, b: { t: b, c: cb }, n: 1 });

// --- adjacency ---
let k = R.newKingdom();
check(R.canPlace(k, tile("wheat", 0, "forest", 0), 1, 0, "E"), "a first tile may touch the castle");
check(!R.canPlace(k, tile("wheat", 0, "forest", 0), 3, 3, "E"), "a tile floating free is illegal");

R.place(k, tile("wheat", 0, "forest", 0), 1, 0, "E");     // wheat at 1,0; forest at 2,0
check(R.at(k, 1, 0).t === "wheat" && R.at(k, 2, 0).t === "forest", "both halves land, in order");
check(!R.canPlace(k, tile("lake", 0, "swamp", 0), 3, 0, "E"), "neither half matching is illegal");
check(R.canPlace(k, tile("forest", 0, "lake", 0), 3, 0, "E"), "one half matching is enough");
// A at (4,0), B at (3,0): the SECOND half is the one touching the forest.
check(R.canPlace(k, tile("lake", 0, "forest", 0), 4, 0, "W"), "the matching half may be either one");

// --- the five-by-five bound ---
k = R.newKingdom();
for (let i = 1; i <= 2; i++) R.place(k, tile("wheat", 0, "wheat", 0), i * 2 - 1, 0, "E");
check(k.maxX === 4, "kingdom reaches x=4 after two tiles east");
check(!R.canPlace(k, tile("wheat", 0, "wheat", 0), 5, 0, "E"), "a sixth column is refused");
check(R.canPlace(k, tile("wheat", 0, "wheat", 0), 1, 1, "E"), "but the same tile fits on the next row");

// --- scoring ---
k = R.newKingdom();
R.place(k, tile("forest", 0, "forest", 0), 1, 0, "E");
R.place(k, tile("forest", 0, "forest", 0), 1, 1, "E");
let s = R.scoreKingdom(k);
check(s.total === 0, "four forest squares with no crowns score 0, not 4 (got " + s.total + ")");

k = R.newKingdom();
R.place(k, tile("forest", 0, "forest", 1), 1, 0, "E");
R.place(k, tile("forest", 0, "forest", 0), 1, 1, "E");
s = R.scoreKingdom(k);
check(s.total === 4, "the same four squares with one crown score 4 (got " + s.total + ")");

k = R.newKingdom();
R.place(k, tile("mine", 0, "wheat", 0), 1, 0, "E");
k.cells["1,0"].c = 3;
s = R.scoreKingdom(k);
check(s.total === 3, "one mine square with three crowns scores 3 (got " + s.total + ")");

// Two separate stretches of the same terrain score separately.
k = R.newKingdom();
R.place(k, tile("lake", 1, "wheat", 0), 1, 0, "E");        // lake at 1,0 (1 crown)
R.place(k, tile("wheat", 0, "lake", 1, ), 0, 1, "E");      // wheat 0,1 ; lake 1,1 (1 crown)
s = R.scoreKingdom(k);
check(s.total === 4, "two lakes touching form one stretch of 2 with 2 crowns = 4 (got " + s.total + ")");

// --- legal placement enumeration ---
k = R.newKingdom();
const opts = R.legalPlacements(k, tile("wheat", 0, "forest", 0));
// Four squares touch the castle; each can pair with three of its own
// neighbours (not the castle itself); each pair can be laid either way round,
// and the two terrains differ so the two orderings are genuinely different
// placements. 4 x 3 x 2 = 24.
check(opts.length === 24, "twenty-four ways to hang the first tile off the castle (got " + opts.length + ")");
check(opts.every((o) => R.canPlace(R.newKingdom(), tile("wheat", 0, "forest", 0), o.x, o.y, o.dir)),
      "every enumerated placement is actually legal");

console.log(fails ? "\n" + fails + " FAILED" : "\nall rules checks passed");
process.exit(fails ? 1 : 0);
