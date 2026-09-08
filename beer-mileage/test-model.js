// Slices the MODEL block out of main.js (run from the repo root:
//   node beer-mileage/test-model.js beer-mileage/main.js) and checks it against label values
// and published figures. Run: node test-model.js
const fs = require("fs");
const src = fs.readFileSync(process.argv[2] || "beer-mileage/main.js", "utf8");
const a = src.indexOf("// === MODEL BEGIN"), b = src.indexOf("// === MODEL END");
if (a < 0 || b < 0) throw new Error("model markers missing");
const M = new Function(src.slice(a, b) + "; return MODEL;")();

let pass = 0, fail = 0;
function ok(cond, msg) { if (cond) pass++; else { fail++; console.log("  FAIL:", msg); } }
function near(v, target, tolFrac, msg) {
  const err = Math.abs(v - target) / target;
  ok(err <= tolFrac, `${msg}: got ${v.toFixed(2)}, want ${target} ±${(tolFrac*100).toFixed(0)}% (off by ${(err*100).toFixed(1)}%)`);
}
const kg = 70;

// --- energy: published rules of thumb
near(M.actKcal({ steps: 10000 }, "steps", kg), 278, 0.10, "10k steps @70kg net kcal");
near(M.actKcal({ run: 10 }, "run", kg), 635, 0.12, "10 km run @70kg (≈0.9 kcal/kg/km net)");
near(M.actKcal({ ride: 20 }, "ride", kg), 467, 0.12, "20 km ride @70kg");
near(M.actKcal({ swim: 1000 }, "swim", kg), 210, 0.12, "1 km swim @70kg");
near(M.actKcal({ gym: 60 }, "gym", kg), 280, 0.12, "60 min gym @70kg");
ok(M.actKcal({ steps: 0 }, "steps", kg) === 0, "zero steps is zero kcal");
ok(M.actKcal({ steps: 5000 }, "steps", 100) > M.actKcal({ steps: 5000 }, "steps", 50), "heavier burns more");

// --- beer: label values per the same serving
near(M.beerKcal("lager"), 193, 0.15, "lager vs Budweiser (145/355ml → 193/473)");
near(M.beerKcal("stout"), 200, 0.15, "stout vs Guinness Draught (125/355ml → 200/568)");
near(M.beerKcal("wheat"), 220, 0.15, "wheat vs Weihenstephaner Hefe (~220/500)");
ok(M.beerKcal("ipa") > 200 && M.beerKcal("ipa") < 300, "IPA in the 200-300 band");
ok(M.beerKcal("ipa") > M.beerKcal("lager"), "IPA costs more than lager");
ok(M.beerKcal("stout") < M.beerKcal("ipa"), "stout is lighter than IPA despite the bigger glass");
for (const k of M.STYLE_KEYS) ok(M.STYLES[k].glass && M.STYLES[k].name, "style " + k + " is complete");

// --- pints
near(M.pintsFor(278, "lager"), 1.48, 0.05, "278 kcal is ~1.5 pints of lager");

// --- day arithmetic, immutability
let day = M.newDay("2026-09-08");
const d1 = M.add(day, "steps", 5000);
ok(day.log.steps === 0 && d1.log.steps === 5000, "add is immutable and correct");
ok(d1.adds.length === 1 && d1.adds[0].act === "steps", "add is recorded");
const d2 = M.add(d1, "run", 5);
const d3 = M.add(d2, "steps", 5000);
ok(d3.log.steps === 10000 && d3.log.run === 5, "adds accumulate per activity");
ok(M.add(d3, "steps", -100) === d3, "negative add is ignored");
ok(M.add(d3, "nope", 100) === d3, "unknown activity is ignored");
const u = M.undo(d3);
ok(u.log.steps === 5000 && u.adds.length === 2, "undo removes the last add only");
ok(M.undo(M.newDay("x")) .adds.length === 0, "undo on empty day is a no-op");
const c = M.clearAct(d3, "steps");
ok(c.log.steps === 0 && c.log.run === 5 && c.adds.every((x) => x.act !== "steps"), "clearAct clears one activity and its adds");

// --- pouring
const kcal3 = M.dayKcal(d3.log, kg);
const earned3 = M.earned(d3, kg, "lager");
near(earned3, kcal3 / M.beerKcal("lager"), 0.001, "earned = kcal / kcal per pint");
ok(M.fullGlasses(d3, kg, "lager") === Math.floor(earned3), "fullGlasses floors");
let p = d3;
const n = M.fullGlasses(p, kg, "lager");
for (let i = 0; i < n; i++) { const q = M.pour(p, kg, "lager"); ok(q.poured === p.poured + 1, "pour increments"); p = q; }
ok(M.canPour(p, kg, "lager") === false, "cannot pour past what is earned");
ok(M.pour(p, kg, "lager") === p, "pour when you cannot is a no-op");
ok(M.remaining(p, kg, "lager") >= 0 && M.remaining(p, kg, "lager") < 1, "remainder is the fraction in the glass");
const overdrawn = M.clearAct(p, "run");                // undo the run after drinking on it
ok(M.remaining(overdrawn, kg, "lager") >= 0, "remaining clamps at zero when overdrawn");

// --- to next pint
const half = M.add(M.newDay("d"), "steps", Math.round(0.5 * M.beerKcal("lager") / M.actKcal({ steps: 1 }, "steps", kg)));
near(M.toNextPint(half, kg, "lager", "steps"), 0.5 * M.beerKcal("lager") / M.actKcal({ steps: 1 }, "steps", kg), 0.01, "steps to finish the glass");
ok(M.toNextPint(M.newDay("d"), kg, "lager", "run") > 0, "a full pint of running is a positive distance");

// --- rollover
const same = M.rollover(d3, [], "2026-09-08", kg, "lager");
ok(same.day === d3 && same.history.length === 0, "same date keeps the day");
const next = M.rollover(d3, [], "2026-09-09", kg, "lager");
ok(next.day.date === "2026-09-09" && next.day.log.steps === 0 && next.day.poured === 0, "new date starts fresh");
ok(next.history.length === 1 && next.history[0].date === "2026-09-08" && next.history[0].pints > 0, "yesterday is archived with pints");
let hist = [];
for (let i = 0; i < 20; i++) hist = M.rollover(M.add(M.newDay("2026-01-" + String(i + 1).padStart(2, "0")), "steps", 1000), hist, "2026-02-01", kg, "lager").history;
ok(hist.length === 14, "history is capped at 14 days (got " + hist.length + ")");
const fresh = M.rollover(null, [], "2026-09-09", kg, "lager");
ok(fresh.day.date === "2026-09-09" && fresh.history.length === 0, "first launch has no yesterday");
ok(/^\d{4}-\d{2}-\d{2}$/.test(M.localDate(new Date(2026, 8, 8))) && M.localDate(new Date(2026, 8, 8)) === "2026-09-08", "localDate is local YYYY-MM-DD");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
