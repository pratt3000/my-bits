// Headless engine test for Thirty Turns. Not part of the bit package: it runs
// in node, slices the rules engine out of main.js (everything between the data
// tables and the renderer), and plays bot-vs-bot games while checking rule
// invariants every turn.
//
//   node thirty-turns/sim.js            # four quick games across modes
//   node thirty-turns/sim.js full       # every map size and type, 36 games
//   node thirty-turns/sim.js trace      # expansion trace of one game, per turn
//
// Exit status is non-zero if any invariant fails or a game never ends.
const fs = require("fs");
const path = require("path");

const SRC = fs.readFileSync(path.join(__dirname, "main.js"), "utf8");
const START = SRC.indexOf("// 1. Data tables");
const END = SRC.indexOf("// 7. Surfaces, camera and the isometric renderer");
if (START < 0 || END < 0) throw new Error("engine markers not found in main.js");
const engine = SRC.slice(SRC.lastIndexOf("\n", START), SRC.lastIndexOf("\n", END));
const api = new Function(engine + `
  return { generateWorld, aiTurn, endTurn, firstTurn, serialize, deserialize, computeScore, refreshScores,
    TRIBES, MAP_SIZES, MAP_TYPES, UNITS, TECHS, TECH_IDS, BOATS, hasTech, tileActions, doTileAction, canTrain, trainUnit,
    research, techCost, checkVictory, rebuildUnitMap, reachable, attackTargets, predictCombat, attack, maxHp, unitStats,
    tIdx, unitAt, cityAt, isWater, MOUNTAIN, canStand, cityUnits, unitCap, tilePlayer, numCities, playerIncome, BLD, TASKS };
`)();

const mode = process.argv[2] || "quick";
let failures = 0;
function fail(msg) { failures++; if (failures < 40) console.log("  FAIL: " + msg); }

function validate(S, where) {
  const seen = new Map();
  for (const u of S.units) {
    if (u.dead) fail(where + ": dead unit still listed " + u.id);
    if (!(u.x >= 0 && u.y >= 0 && u.x < S.n && u.y < S.n)) fail(where + ": unit off map " + u.id);
    if (!(u.hp > 0 && u.hp <= api.maxHp(u))) fail(where + ": bad hp " + u.hp + " for " + u.type);
    if (Number.isNaN(u.hp)) fail(where + ": NaN hp");
    const k = u.y * S.n + u.x;
    if (seen.has(k)) fail(where + ": two units on tile " + k);
    seen.set(k, u);
    if (S.uAt.get(k) !== u) fail(where + ": uAt out of sync at " + k);
    const t = S.terrain[k];
    if (u.boat && !api.isWater(t)) fail(where + ": boat on land");
    if (!u.boat && api.isWater(t)) fail(where + ": land unit in water");
    if (!S.players[u.owner].alive) fail(where + ": unit of dead player");
  }
  if (S.uAt.size !== S.units.length) fail(where + ": uAt size mismatch " + S.uAt.size + " vs " + S.units.length);
  for (const pl of S.players) {
    if (pl.stars < 0 || Number.isNaN(pl.stars)) fail(where + ": negative/NaN stars " + pl.stars);
    if (pl.alive && api.numCities(S, pl.id) === 0 && S.players.length > 1) fail(where + ": alive with no cities");
  }
  for (const c of S.cities) {
    if (c.owner >= 0 && c.level < 1) fail(where + ": owned city level 0");
    if (c.pop < 0) fail(where + ": negative pop");
    if (c.owner >= 0 && c.pop > c.level) fail(where + ": pop overflow " + c.pop + " at level " + c.level);
  }
  for (let i = 0; i < S.terr.length; i++) {
    if (S.terr[i] >= 0 && S.cities[S.terr[i]].owner < 0) fail(where + ": tile owned by a village");
  }
}

function play(cfg, opts) {
  const t0 = Date.now();
  const S = api.generateWorld(cfg);
  validate(S, "gen");
  api.firstTurn(S);
  let guard = 0;
  let maxEvents = 0;
  while (!S.over && guard < 2000) {
    guard++;
    const p = S.cur;
    if (S.players[p].ai) api.aiTurn(S, p);
    maxEvents = Math.max(maxEvents, S.events.length);
    S.events.length = 0;
    api.endTurn(S);
    validate(S, "turn " + S.turn + " p" + p);
    if (opts && opts.roundtrip && S.turn % 5 === 0 && S.cur === 0) {
      const a = JSON.stringify(api.serialize(S));
      const S2 = api.deserialize(JSON.parse(a));
      const b = JSON.stringify(api.serialize(S2));
      if (a !== b) fail("serialize roundtrip differs at turn " + S.turn);
    }
  }
  if (guard >= 2000) fail("game never ended: " + JSON.stringify({ n: cfg.n, mode: cfg.mode, turn: S.turn }));
  api.refreshScores(S);
  const ms = Date.now() - t0;
  const save = JSON.stringify(api.serialize(S));
  return { S, ms, saveBytes: save.length, maxEvents };
}

function summary(r, cfg) {
  const S = r.S;
  const players = S.players.map((pl) => `${api.TRIBES[pl.tribe].name}/${pl.ai || "human"}${pl.alive ? "" : "(dead)"}: ${pl.score} pts, ${api.numCities(S, pl.id)} cities, ${S.units.filter((u) => u.owner === pl.id).length} units, ${pl.techs.length} techs, ${pl.stars}★ inc ${api.playerIncome(S, pl.id)}`);
  console.log(`  ${cfg.n}x${cfg.n} ${cfg.mapType} ${cfg.mode} P${cfg.players.length} seed ${cfg.seed}: turn ${S.turn}, winner ${S.winner >= 0 ? api.TRIBES[S.players[S.winner].tribe].name : "-"}, ${r.ms} ms, save ${r.saveBytes} B, maxEvents ${r.maxEvents}`);
  for (const p of players) console.log("     " + p);
}

const configs = [];
let seed = 11;
if (mode === "quick" || mode === "trace") {
  configs.push({ n: 16, mapType: "lakes", seed: 101, mode: "perfection", turnLimit: 30, players: [{ tribe: 0, ai: "normal" }, { tribe: 1, ai: "normal" }, { tribe: 3, ai: "hard" }, { tribe: 6, ai: "crazy" }] });
  configs.push({ n: 11, mapType: "dryland", seed: 7, mode: "domination", turnLimit: 200, players: [{ tribe: 2, ai: "easy" }, { tribe: 4, ai: "normal" }] });
  configs.push({ n: 14, mapType: "archipelago", seed: 9, mode: "glory", turnLimit: 200, players: [{ tribe: 3, ai: "hard" }, { tribe: 7, ai: "hard" }, { tribe: 9, ai: "normal" }] });
  configs.push({ n: 20, mapType: "continents", seed: 5, mode: "might", turnLimit: 200, players: [{ tribe: 5, ai: "crazy" }, { tribe: 8, ai: "crazy" }, { tribe: 10, ai: "easy" }, { tribe: 11, ai: "normal" }, { tribe: 1, ai: "normal" }] });
} else {
  for (const sz of api.MAP_SIZES) for (const ty of api.MAP_TYPES) {
    const P = Math.min(sz.maxPlayers, 2 + (seed % 4));
    const players = [];
    for (let i = 0; i < P; i++) players.push({ tribe: (seed + i * 5) % 12, ai: ["easy", "normal", "hard", "crazy"][(seed + i) % 4] });
    const md = ["perfection", "domination", "glory", "might"][seed % 4];
    configs.push({ n: sz.n, mapType: ty.id, seed: seed++, mode: md, turnLimit: md === "perfection" ? 30 : 200, players });
  }
}

if (mode === "trace") {
  const cfg = configs[0];
  const S = api.generateWorld(cfg);
  api.firstTurn(S);
  while (!S.over && S.turn <= 30) {
    const p = S.cur;
    api.aiTurn(S, p);
    S.events.length = 0;
    if (S.players.slice(p + 1).every((q) => !q.alive)) {
      console.log("turn " + S.turn + ": " + S.players.map((pl) => `${api.TRIBES[pl.tribe].name[0]}${pl.ai[0]} c${api.numCities(S, pl.id)} u${S.units.filter((u) => u.owner === pl.id).length} t${pl.techs.length} s${pl.stars}`).join(" | "));
    }
    api.endTurn(S);
  }
  process.exit(0);
}

const t0 = Date.now();
for (const cfg of configs) {
  const r = play(cfg, { roundtrip: true });
  summary(r, cfg);
  if (r.saveBytes > 7600) console.log("     note: save over 7600 bytes; Continue Playing will carry a pointer and the save lives in storage");
}
{
  const cfg = configs[0];
  const a = JSON.stringify(api.serialize(play(cfg).S));
  const b = JSON.stringify(api.serialize(play(cfg).S));
  if (a !== b) fail("non-deterministic game for identical config");
  else console.log("  determinism: ok");
}
console.log(`\n${configs.length} games in ${Date.now() - t0} ms, ${failures} failures`);
process.exit(failures ? 1 : 0);
