/**
 * Polytopia — a pocket 4X after The Battle of Polytopia. (Listed as
 * "Thirty Turns"; the name on the title screen is Polytopia.)
 *
 * A square world of fields, forests, mountains and water, twelve tribes with a
 * starting technology each, villages to capture, a 24-technology tree, nine unit
 * types plus boats, city levels with rewards, ruins, monuments, and four ways to
 * win: Perfection (highest score after the last turn), Domination, Glory and
 * Might. Play alone against bots at four difficulties or pass the phone around.
 *
 * The file is one bit in three layers: data tables, a pure rules engine that the
 * bots and the node simulation drive without a browser, and the isometric
 * renderer and interface that run on the phone. Everything is drawn and
 * synthesised at runtime; nothing is loaded.
 */
window.plethoraBit = {
  meta: {
    title: "Thirty Turns",
    runtime: "plethora-bit@2",
    tags: ["strategy", "4x", "turn-based", "game", "tactics", "multiplayer"],
    permissions: ["audio", "backgroundMusic", "haptics", "storage"]
  },

  async init(ctx) {
    // ====================================================================== //
    // 1. Data tables                                                         //
    // ====================================================================== //
    // Everything the rules engine needs to know about the world is in these
    // tables: terrain, resources, buildings, the 24-technology tree, units,
    // tribes, city rewards and the monument tasks. The engine below is written
    // against the tables, so a balance change is a number here, not a hunt.

    const TAU = Math.PI * 2;
    const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
    const lerp = (a, b, t) => a + (b - a) * t;

    // ---- Terrain
    const FIELD = 0, FOREST = 1, MOUNTAIN = 2, SHALLOW = 3, OCEAN = 4;
    const TERRAIN_NAME = ["Field", "Forest", "Mountain", "Shallow water", "Ocean"];
    const isWater = (t) => t === SHALLOW || t === OCEAN;

    // ---- Resources
    const R_NONE = 0, R_FRUIT = 1, R_CROP = 2, R_ANIMAL = 3, R_FISH = 4, R_METAL = 5, R_WHALE = 6;
    const RES_NAME = ["", "Fruit", "Crop", "Wild animal", "Fish", "Metal", "Whale"];

    // ---- Buildings (tile.bld). Temples carry a level in tile.lvl; a monument
    // carries its task index there.
    const B_NONE = 0, B_FARM = 1, B_MINE = 2, B_LUMBER = 3, B_PORT = 4, B_WINDMILL = 5,
      B_FORGE = 6, B_SAWMILL = 7, B_CUSTOMS = 8, B_TEMPLE = 9, B_FTEMPLE = 10,
      B_MTEMPLE = 11, B_WTEMPLE = 12, B_MONUMENT = 13, B_RUIN = 14;

    // on: terrains it may stand on. res: the resource it consumes. adj: the
    // building it counts next door (pop per neighbour). temple: scores over time.
    const BLD = [];
    BLD[B_FARM] = { name: "Farm", cost: 5, pop: 2, tech: "farming", on: [FIELD], res: R_CROP };
    BLD[B_MINE] = { name: "Mine", cost: 5, pop: 2, tech: "mining", on: [MOUNTAIN], res: R_METAL };
    BLD[B_LUMBER] = { name: "Lumber Hut", cost: 2, pop: 1, tech: "forestry", on: [FOREST] };
    BLD[B_PORT] = { name: "Port", cost: 10, pop: 2, tech: "sailing", on: [SHALLOW] };
    BLD[B_WINDMILL] = { name: "Windmill", cost: 5, pop: 0, tech: "construction", on: [FIELD], adj: B_FARM, adjPop: 1, unique: true };
    BLD[B_FORGE] = { name: "Forge", cost: 5, pop: 0, tech: "smithery", on: [FIELD], adj: B_MINE, adjPop: 2, unique: true };
    BLD[B_SAWMILL] = { name: "Sawmill", cost: 5, pop: 0, tech: "mathematics", on: [FIELD], adj: B_LUMBER, adjPop: 1, unique: true };
    BLD[B_CUSTOMS] = { name: "Customs House", cost: 5, pop: 0, tech: "trade", on: [FIELD], adj: B_PORT, adjStars: 2, unique: true };
    BLD[B_TEMPLE] = { name: "Temple", cost: 20, pop: 1, tech: "free_spirit", on: [FIELD], temple: true };
    BLD[B_FTEMPLE] = { name: "Forest Temple", cost: 15, pop: 1, tech: "spiritualism", on: [FOREST], temple: true };
    BLD[B_MTEMPLE] = { name: "Mountain Temple", cost: 20, pop: 1, tech: "meditation", on: [MOUNTAIN], temple: true };
    BLD[B_WTEMPLE] = { name: "Water Temple", cost: 20, pop: 1, tech: "aquatism", on: [SHALLOW, OCEAN], temple: true };
    BLD[B_MONUMENT] = { name: "Monument", cost: 0, pop: 3, on: [FIELD, FOREST, MOUNTAIN] };
    BLD[B_RUIN] = { name: "Ruins", cost: 0, pop: 0, on: [] };

    const TEMPLE_SCORE = [0, 100, 175, 250, 325, 400];   // by temple level 1..5
    const TEMPLE_TURNS = 3;                              // turns per temple level
    const MONUMENT_SCORE = 400;
    const PARK_SCORE = 250;

    // ---- Economy
    const HARVEST_COST = { fruit: 2, animal: 2, fish: 2 };
    const HARVEST_POP = 1;
    const WHALE_STARS = 10;
    const ROAD_COST = 3;
    const BRIDGE_COST = 5;
    const CLEAR_FOREST_GAIN = 1;
    const BURN_FOREST_COST = 5;
    const GROW_FOREST_COST = 5;
    const START_STARS = 5;
    const TECH_BASE = 4;                 // tech cost = TECH_BASE + tier * cities
    const PHILOSOPHY_DISCOUNT = 0.2;
    const GLORY_SCORE = 10000;
    const ENDLESS_CAP = 200;             // Domination, Glory and Might end on score after this many turns
    const VETERAN_KILLS = 3;
    const VETERAN_BONUS_HP = 5;
    const SIEGE = true;

    // ---- Technologies. 24 of them: five tier-1 roots, two tier-2 branches
    // each, and a tier-3 leaf on every branch except Shields.
    const TECHS = {
      riding:       { name: "Riding", tier: 1, from: null, blurb: "Rider unit" },
      organization: { name: "Organization", tier: 1, from: null, blurb: "Harvest fruit" },
      climbing:     { name: "Climbing", tier: 1, from: null, blurb: "Cross mountains, see metal" },
      fishing:      { name: "Fishing", tier: 1, from: null, blurb: "Catch fish" },
      hunting:      { name: "Hunting", tier: 1, from: null, blurb: "Hunt animals" },

      roads:        { name: "Roads", tier: 2, from: "riding", blurb: "Roads and bridges" },
      free_spirit:  { name: "Free Spirit", tier: 2, from: "riding", blurb: "Temple, disband units" },
      farming:      { name: "Farming", tier: 2, from: "organization", blurb: "Farms on crop" },
      shields:      { name: "Shields", tier: 2, from: "organization", blurb: "Defender unit" },
      meditation:   { name: "Meditation", tier: 2, from: "climbing", blurb: "Mountain temple, mountain defence" },
      mining:       { name: "Mining", tier: 2, from: "climbing", blurb: "Mines on metal" },
      sailing:      { name: "Sailing", tier: 2, from: "fishing", blurb: "Ports, ships" },
      whaling:      { name: "Whaling", tier: 2, from: "fishing", blurb: "Hunt whales for stars" },
      archery:      { name: "Archery", tier: 2, from: "hunting", blurb: "Archer unit, forest defence" },
      forestry:     { name: "Forestry", tier: 2, from: "hunting", blurb: "Lumber huts, clear forest" },

      trade:        { name: "Trade", tier: 3, from: "roads", blurb: "Customs House" },
      chivalry:     { name: "Chivalry", tier: 3, from: "free_spirit", blurb: "Knight unit, burn forest" },
      construction: { name: "Construction", tier: 3, from: "farming", blurb: "Windmill" },
      philosophy:   { name: "Philosophy", tier: 3, from: "meditation", blurb: "Mind Bender, cheaper research" },
      smithery:     { name: "Smithery", tier: 3, from: "mining", blurb: "Swordsman, Forge" },
      navigation:   { name: "Navigation", tier: 3, from: "sailing", blurb: "Battleship, deep ocean" },
      aquatism:     { name: "Aquatism", tier: 3, from: "whaling", blurb: "Water temple, water defence" },
      spiritualism: { name: "Spiritualism", tier: 3, from: "archery", blurb: "Forest temple, grow forest" },
      mathematics:  { name: "Mathematics", tier: 3, from: "forestry", blurb: "Catapult, Sawmill" }
    };
    const TECH_IDS = Object.keys(TECHS);
    const TECH_ROOTS = TECH_IDS.filter((t) => TECHS[t].tier === 1);
    const techChildren = (id) => TECH_IDS.filter((t) => TECHS[t].from === id);

    // ---- Units. Attack/defence/hp/movement/range exactly as the classic
    // ruleset; skills decide what a unit may do around a move.
    const UNITS = {
      warrior:    { name: "Warrior", cost: 2, hp: 10, atk: 2, def: 2, mv: 1, rng: 1, skills: "dash fortify", tech: null },
      rider:      { name: "Rider", cost: 3, hp: 10, atk: 2, def: 1, mv: 2, rng: 1, skills: "dash escape fortify", tech: "riding" },
      archer:     { name: "Archer", cost: 3, hp: 10, atk: 2, def: 1, mv: 1, rng: 2, skills: "dash fortify", tech: "archery" },
      defender:   { name: "Defender", cost: 3, hp: 15, atk: 1, def: 3, mv: 1, rng: 1, skills: "fortify", tech: "shields" },
      swordsman:  { name: "Swordsman", cost: 5, hp: 15, atk: 3, def: 3, mv: 1, rng: 1, skills: "dash fortify", tech: "smithery" },
      catapult:   { name: "Catapult", cost: 8, hp: 10, atk: 4, def: 0, mv: 1, rng: 3, skills: "", tech: "mathematics" },
      knight:     { name: "Knight", cost: 8, hp: 10, atk: 3.5, def: 1, mv: 3, rng: 1, skills: "dash persist fortify", tech: "chivalry" },
      mindbender: { name: "Mind Bender", cost: 5, hp: 10, atk: 0, def: 1, mv: 1, rng: 1, skills: "heal convert", tech: "philosophy" },
      giant:      { name: "Giant", cost: 10, hp: 40, atk: 5, def: 4, mv: 1, rng: 1, skills: "", tech: null, superUnit: true }
    };
    const UNIT_IDS = Object.keys(UNITS);
    const TRAINABLE = UNIT_IDS.filter((u) => !UNITS[u].superUnit);
    const hasSkill = (type, s) => UNITS[type].skills.indexOf(s) >= 0;

    // Boats: a land unit that steps onto a friendly port becomes one. The hull
    // provides the fighting stats; the passenger keeps its hit points.
    const BOATS = [null,
      { name: "Boat", atk: 1, def: 1, mv: 2, rng: 2, cost: 0, tech: "sailing" },
      { name: "Ship", atk: 2, def: 2, mv: 3, rng: 2, cost: 5, tech: "sailing" },
      { name: "Battleship", atk: 4, def: 3, mv: 3, rng: 2, cost: 15, tech: "navigation" }
    ];

    // ---- Tribes. Each has a starting technology (or a bigger capital), a
    // colour, a biome palette and generation weights for the land around its
    // capital. `syl` are syllables for city names.
    const TRIBES = [
      { id: "verdane", tree: "cone", wall: "#f3efe6", earth: "#7b5438", animal: { body: "#5a4330", mark: "#8c6a4a", horn: "tusk" }, name: "Verdane", tech: "organization", color: "#3b7dd8", dark: "#24518f",
        field: "#8fcf6a", forest: "#3e9b4a", trunk: "#6b4a2a", rock: "#9aa0a6",
        gen: { forest: 1.0, mountain: 0.8, fruit: 1.6, crop: 0.8, animal: 0.8, metal: 0.8, fish: 1.0 },
        syl: ["li", "re", "pa", "fim", "to", "mo", "ca", "lu", "ne", "sa", "vi", "do"] },
      { id: "hjold", tree: "snow", wall: "#a97c50", earth: "#6a5646", animal: { body: "#e9eef2", mark: "#c9d2da", horn: "antler" }, name: "Hjold", tech: "hunting", color: "#3a3f47", dark: "#1d2024",
        field: "#e6ecef", forest: "#2f5d3a", trunk: "#4a3526", rock: "#8e969c", snow: true,
        gen: { forest: 1.8, mountain: 1.1, fruit: 0.5, crop: 0.3, animal: 1.7, metal: 1.0, fish: 0.9 },
        syl: ["bae", "rg", "off", "ul", "ha", "gr", "im", "ske", "nor", "vik", "ol", "fjo"] },
      { id: "saharn", tree: "cone", wall: "#f3e3b8", earth: "#a8824e", animal: { body: "#c9a36a", mark: "#e3c48e", horn: "hump" }, name: "Saharn", tech: "riding", color: "#e2c046", dark: "#9c8220",
        field: "#e8d9a0", forest: "#8fae4e", trunk: "#8a6a3a", rock: "#b8a888",
        gen: { forest: 0.35, mountain: 0.5, fruit: 1.0, crop: 0.9, animal: 0.6, metal: 0.6, fish: 0.6 },
        syl: ["ou", "ma", "ji", "ta", "ke", "sa", "ha", "ra", "zu", "mi", "nu", "ba"] },
      { id: "tiwa", tree: "palm", wall: "#f5e6c0", earth: "#b08d5e", animal: { body: "#3f7f4a", mark: "#7fbf6a", horn: "none" }, name: "Tiwa", tech: "fishing", color: "#39b54a", dark: "#1f7a2c",
        field: "#6fc96b", forest: "#2e8b57", trunk: "#7a5a2a", rock: "#8fa39a", palm: true,
        gen: { forest: 1.0, mountain: 0.5, fruit: 1.2, crop: 0.6, animal: 0.6, metal: 0.5, fish: 2.0, water: 1.6 },
        syl: ["ki", "ko", "ha", "wa", "lo", "ma", "nu", "ti", "pa", "ae", "ola", "ni"] },
      { id: "fennow", tree: "cone", wall: "#e8dcc0", earth: "#7b5438", animal: { body: "#8a5a2b", mark: "#c98a4a", horn: "antler" }, name: "Fennow", tech: "archery", color: "#c8762a", dark: "#7f4612",
        field: "#a7bf5a", forest: "#c9783a", trunk: "#5c3a1e", rock: "#9a948a",
        gen: { forest: 1.7, mountain: 0.7, fruit: 1.3, crop: 0.5, animal: 1.3, metal: 0.7, fish: 0.8 },
        syl: ["hoo", "dri", "ck", "wen", "ash", "fel", "ber", "mor", "ly", "dun", "oak", "tam"] },
      { id: "aurelle", tree: "round", wall: "#efe3f2", earth: "#6e5470", animal: { body: "#5b3a86", mark: "#9a7ac2", horn: "horn" }, name: "Aurelle", tech: null, color: "#8e44ad", dark: "#5b2a73", capitalLevel: 3,
        field: "#b48bd8", forest: "#5b3a86", trunk: "#3a2250", rock: "#a897b4",
        gen: { forest: 0.9, mountain: 0.8, fruit: 1.4, crop: 0.8, animal: 0.8, metal: 0.9, fish: 0.9 },
        syl: ["lux", "ido", "or", "au", "rel", "vi", "sel", "ame", "tho", "ris", "ena", "ul"] },
      { id: "grimm", tree: "dead", wall: "#8a8187", earth: "#4b4349", animal: { body: "#2e2a30", mark: "#5a4f5a", horn: "horn" }, name: "Grimm", tech: "smithery", color: "#8c1f2e", dark: "#4d1119",
        field: "#8c8c90", forest: "#4d4a52", trunk: "#2d2a30", rock: "#5e5a66", dead: true,
        gen: { forest: 0.8, mountain: 1.3, fruit: 0.25, crop: 0.9, animal: 0.4, metal: 2.0, fish: 0.6 },
        syl: ["ven", "gir", "mor", "ska", "dro", "th", "ul", "grim", "ash", "nak", "vor", "ek"] },
      { id: "sabu", tree: "acacia", wall: "#e9d9b0", earth: "#9c7a42", animal: { body: "#c08a3a", mark: "#f0c07a", horn: "horn" }, name: "Sabu", tech: "farming", color: "#f0932b", dark: "#a35d12",
        field: "#d9c66a", forest: "#6c8f3b", trunk: "#7a5a2a", rock: "#a8987a",
        gen: { forest: 0.6, mountain: 0.7, fruit: 0.9, crop: 1.9, animal: 0.9, metal: 0.6, fish: 0.7 },
        syl: ["ze", "ba", "si", "ka", "lu", "mo", "nde", "ya", "tu", "wa", "ngo", "ri"] },
      { id: "aiyun", tree: "snow", wall: "#e4eef2", earth: "#6e6a6a", animal: { body: "#d9d2c4", mark: "#f4efe6", horn: "horn" }, name: "Aiyun", tech: "meditation", color: "#2ab7c9", dark: "#15727e",
        field: "#c8dfd0", forest: "#4e8a6a", trunk: "#5a4a3a", rock: "#b9c4cc", snow: true,
        gen: { forest: 0.9, mountain: 1.9, fruit: 1.1, crop: 0.5, animal: 0.7, metal: 1.1, fish: 0.7 },
        syl: ["ai", "mo", "li", "tsu", "yan", "ko", "ren", "shi", "an", "pei", "lun", "mei"] },
      { id: "quill", tree: "round", wall: "#e9e2c8", earth: "#6f5036", animal: { body: "#2f6b3a", mark: "#8fd07a", horn: "none" }, name: "Quill", tech: "shields", color: "#0e7c66", dark: "#064a3c",
        field: "#7bc47f", forest: "#1f6f4a", trunk: "#5a3e24", rock: "#9aa89c",
        gen: { forest: 1.4, mountain: 0.7, fruit: 1.5, crop: 0.6, animal: 1.0, metal: 0.7, fish: 0.9 },
        syl: ["que", "tza", "li", "xo", "chi", "tla", "pan", "ame", "cu", "ya", "tec", "oa"] },
      { id: "yoruk", tree: "cone", wall: "#e3d2b0", earth: "#8a6a42", animal: { body: "#7a4b2a", mark: "#b88a5a", horn: "horn" }, name: "Yoruk", tech: "roads", color: "#b5457a", dark: "#6e2448",
        field: "#c9a77a", forest: "#8b5a2b", trunk: "#4e2f14", rock: "#a89078",
        gen: { forest: 0.6, mountain: 0.9, fruit: 1.2, crop: 1.0, animal: 0.9, metal: 0.8, fish: 0.6 },
        syl: ["ya", "da", "kk", "or", "tur", "kem", "al", "bay", "sar", "uz", "gol", "ir"] },
      { id: "shen", tree: "round", wall: "#efe3cf", earth: "#7b5438", animal: { body: "#2b2b2b", mark: "#f2f2f2", horn: "none" }, name: "Shen", tech: "climbing", color: "#e04848", dark: "#8e2222",
        field: "#a9c76b", forest: "#d9534f", trunk: "#5a3a2a", rock: "#8e8a8a",
        gen: { forest: 1.0, mountain: 1.7, fruit: 1.1, crop: 0.6, animal: 0.8, metal: 1.5, fish: 0.8 },
        syl: ["xin", "xi", "shen", "lo", "pu", "jia", "tai", "wu", "ming", "hua", "zhi", "cao"] }
    ];
    const tribeByIndex = (i) => TRIBES[((i % TRIBES.length) + TRIBES.length) % TRIBES.length];

    // ---- City rewards, one choice per level reached. Level 5 and up repeat.
    const REWARDS = {
      2: [{ id: "workshop", name: "Workshop", blurb: "+1 star every turn" },
          { id: "explorer", name: "Explorer", blurb: "Reveals the land around" }],
      3: [{ id: "walls", name: "City Wall", blurb: "Units here defend four times harder" },
          { id: "resources", name: "Resources", blurb: "+5 stars now" }],
      4: [{ id: "popgrowth", name: "Population Growth", blurb: "+3 population" },
          { id: "border", name: "Border Growth", blurb: "Territory reaches two tiles out" }],
      5: [{ id: "park", name: "Park", blurb: "+" + PARK_SCORE + " score" },
          { id: "superunit", name: "Super Unit", blurb: "A Giant joins the city" }]
    };
    const rewardsFor = (level) => REWARDS[Math.min(5, Math.max(2, level))];

    // ---- Monument tasks. Finish one and its monument becomes free to build.
    const TASKS = [
      { id: "wisdom", name: "Tower of Knowing", desc: "Research every technology" },
      { id: "power", name: "Gate of War", desc: "Defeat 10 enemy units" },
      { id: "tomb", name: "Tomb of Kings", desc: "Hold 100 stars at once" },
      { id: "bazaar", name: "Great Market", desc: "Connect 5 cities to your capital by road" },
      { id: "fortune", name: "Fortune Gardens", desc: "Grow a city to level 5" },
      { id: "eye", name: "Eye of the World", desc: "Meet every other tribe" },
      { id: "peace", name: "Altar of Calm", desc: "Attack nobody for 5 turns after meeting a tribe" }
    ];

    // ---- Map sizes and types. Player counts set a minimum size.
    const MAP_SIZES = [
      { id: "tiny", name: "Tiny", n: 11, maxPlayers: 3 },
      { id: "small", name: "Small", n: 14, maxPlayers: 4 },
      { id: "normal", name: "Normal", n: 16, maxPlayers: 5 },
      { id: "large", name: "Large", n: 18, maxPlayers: 6 },
      { id: "huge", name: "Huge", n: 20, maxPlayers: 8 },
      { id: "massive", name: "Massive", n: 30, maxPlayers: 8 }
    ];
    const MAP_TYPES = [
      { id: "dryland", name: "Dryland", water: 0.08 },
      { id: "lakes", name: "Lakes", water: 0.2 },
      { id: "pangea", name: "Pangea", water: 0.28 },
      { id: "continents", name: "Continents", water: 0.38 },
      { id: "archipelago", name: "Archipelago", water: 0.52 },
      { id: "waterworld", name: "Water World", water: 0.68 }
    ];
    const MODES = [
      { id: "perfection", name: "Perfection", blurb: "Highest score after the last turn" },
      { id: "domination", name: "Domination", blurb: "Be the last tribe standing" },
      { id: "glory", name: "Glory", blurb: "First to " + GLORY_SCORE.toLocaleString() + " score" },
      { id: "might", name: "Might", blurb: "Hold every capital" }
    ];
    const DIFFICULTIES = [
      { id: "easy", name: "Easy", bonus: 0, perCity: 0, startStars: 0, sloppy: 0.45 },
      { id: "normal", name: "Normal", bonus: 0, perCity: 0, startStars: 0, sloppy: 0.12 },
      { id: "hard", name: "Hard", bonus: 1, perCity: 0, startStars: 3, sloppy: 0.03 },
      { id: "crazy", name: "Crazy", bonus: 2, perCity: 1, startStars: 8, sloppy: 0 }
    ];
    const diffById = (id) => DIFFICULTIES.find((d) => d.id === id) || DIFFICULTIES[1];

    // ====================================================================== //
    // 2. Deterministic random numbers                                        //
    // ====================================================================== //
    // mulberry32. Every game carries its own generator state so a resumed game
    // rolls the same ruins and explorer paths it would have rolled anyway.
    function makeRng(seed) {
      let a = seed >>> 0;
      const next = () => {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
      next.state = () => a;
      next.int = (n) => Math.floor(next() * n);
      next.pick = (arr) => arr[Math.floor(next() * arr.length)];
      next.chance = (p) => next() < p;
      return next;
    }
    function hashStr(s) {
      let h = 2166136261 >>> 0;
      for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
      return h >>> 0;
    }
    // Small integer hash for per-tile decoration jitter (pure, no state).
    function hash2(x, y) {
      let h = (x * 374761393 + y * 668265263) >>> 0;
      h = (h ^ (h >>> 13)) >>> 0; h = Math.imul(h, 1274126177) >>> 0;
      return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
    }

    // ---- Grid helpers (8-neighbourhood, Chebyshev distance), used everywhere.
    const DIRS8 = [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]];
    const cheb = (ax, ay, bx, by) => Math.max(Math.abs(ax - bx), Math.abs(ay - by));

    // City names: two or three syllables from the tribe's pool, capitalised.
    function cityName(tribe, rng, taken) {
      for (let tries = 0; tries < 40; tries++) {
        const n = 2 + (rng() < 0.35 ? 1 : 0);
        let s = "";
        for (let i = 0; i < n; i++) s += rng.pick(tribe.syl);
        s = s.charAt(0).toUpperCase() + s.slice(1);
        if (s.length <= 9 && !taken[s]) { taken[s] = true; return s; }
      }
      return tribe.name + " " + Object.keys(taken).length;
    }

    // ====================================================================== //
    // 3. Map generation                                                      //
    // ====================================================================== //
    // A square world. Capitals are spread by farthest-point sampling, land and
    // water come from a value-noise height field thresholded at the map type's
    // water fraction, and every land tile is "biomed" by its nearest capital so
    // each tribe's corner of the map looks and yields like that tribe. Villages
    // keep a Chebyshev spacing of three so their first territories never
    // overlap; resources cluster around villages and capitals the way they do
    // in the game that inspired this one.

    function valueNoise(rng, n, cells) {
      const g = cells + 2;
      const lattice = new Float32Array(g * g);
      for (let i = 0; i < lattice.length; i++) lattice[i] = rng();
      const sm = (t) => t * t * (3 - 2 * t);
      return (x, y) => {
        const fx = (x / n) * cells, fy = (y / n) * cells;
        const x0 = Math.floor(fx), y0 = Math.floor(fy);
        const tx = sm(fx - x0), ty = sm(fy - y0);
        const v = (xx, yy) => lattice[yy * g + xx];
        const a = lerp(v(x0, y0), v(x0 + 1, y0), tx);
        const b = lerp(v(x0, y0 + 1), v(x0 + 1, y0 + 1), tx);
        return lerp(a, b, ty);
      };
    }

    function fbm(rng, n, baseCells) {
      const n1 = valueNoise(rng, n, Math.max(2, baseCells));
      const n2 = valueNoise(rng, n, Math.max(3, baseCells * 2));
      const n3 = valueNoise(rng, n, Math.max(5, baseCells * 4));
      return (x, y) => (n1(x, y) * 0.6 + n2(x, y) * 0.28 + n3(x, y) * 0.12);
    }

    /**
     * cfg: { n, mapType, seed, mode, turnLimit, players: [{ tribe, human, ai }] }
     * Returns a complete initial game state.
     */
    function generateWorld(cfg) {
      const n = cfg.n;
      const N = n * n;
      const rng = makeRng(cfg.seed >>> 0);
      const P = cfg.players.length;
      const mapType = MAP_TYPES.find((m) => m.id === cfg.mapType) || MAP_TYPES[1];
      const idx = (x, y) => y * n + x;
      const inb = (x, y) => x >= 0 && y >= 0 && x < n && y < n;

      // ---- Capitals: farthest-point sampling with a margin from the edge.
      const margin = n >= 14 ? 2 : 1;
      const cands = [];
      for (let y = margin; y < n - margin; y++) for (let x = margin; x < n - margin; x++) cands.push([x, y]);
      const caps = [];
      caps.push(rng.pick(cands));
      while (caps.length < P) {
        let best = null, bestD = -1;
        for (const c of cands) {
          let d = Infinity;
          for (const k of caps) d = Math.min(d, cheb(c[0], c[1], k[0], k[1]) + 0.35 * Math.abs(c[0] - k[0] + c[1] - k[1]) * 0.1);
          d += rng() * 0.5;
          if (d > bestD) { bestD = d; best = c; }
        }
        caps.push(best);
      }

      // ---- Height field and water.
      const height = fbm(rng, n, Math.max(2, Math.round(n / 5)));
      const forestNoise = valueNoise(rng, n, Math.max(3, Math.round(n / 3)));
      const mountNoise = valueNoise(rng, n, Math.max(3, Math.round(n / 4)));
      const h = new Float32Array(N);
      const cx = (n - 1) / 2, cy = (n - 1) / 2;
      // Continents get two attractors far apart; pangea is a single blob.
      const att = [];
      if (mapType.id === "continents") {
        const ang = rng() * TAU;
        att.push([cx + Math.cos(ang) * n * 0.27, cy + Math.sin(ang) * n * 0.27]);
        att.push([cx - Math.cos(ang) * n * 0.27, cy - Math.sin(ang) * n * 0.27]);
      } else if (mapType.id === "pangea") {
        att.push([cx + (rng() - 0.5) * n * 0.1, cy + (rng() - 0.5) * n * 0.1]);
      }
      for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
        let v = height(x, y);
        if (att.length) {
          let best = 0;
          for (const a of att) {
            const d = Math.hypot(x - a[0], y - a[1]) / (n * 0.5);
            best = Math.max(best, Math.exp(-d * d * 2.2));
          }
          v = v * 0.55 + best * 0.6;
        }
        // Water worlds and archipelagos like their coasts ragged.
        if (mapType.water >= 0.5) v += (rng() - 0.5) * 0.08;
        h[idx(x, y)] = v;
      }
      // Tribe water preference (island tribes) nudges their neighbourhood down.
      for (let i = 0; i < P; i++) {
        const tr = tribeByIndex(cfg.players[i].tribe);
        const wm = (tr.gen.water || 1) - 1;
        if (!wm) continue;
        for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
          const d = cheb(x, y, caps[i][0], caps[i][1]);
          if (d >= 2 && d <= 5) h[idx(x, y)] -= wm * 0.12 * (1 - (d - 2) / 4);
        }
      }
      const sorted = Array.from(h).sort((a, b) => a - b);
      const waterLevel = sorted[Math.floor(clamp(mapType.water, 0, 0.95) * (N - 1))];

      const terrain = new Uint8Array(N);
      for (let i = 0; i < N; i++) terrain[i] = h[i] < waterLevel ? OCEAN : FIELD;

      // Land is guaranteed under and around every capital.
      for (const c of caps) {
        for (const d of DIRS8) if (inb(c[0] + d[0], c[1] + d[1])) terrain[idx(c[0] + d[0], c[1] + d[1])] = FIELD;
        terrain[idx(c[0], c[1])] = FIELD;
        for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
          const x = c[0] + dx, y = c[1] + dy;
          if (inb(x, y) && Math.max(Math.abs(dx), Math.abs(dy)) === 2 && isWater(terrain[idx(x, y)]) && rng() < 0.6) terrain[idx(x, y)] = FIELD;
        }
      }

      // ---- Biome: nearest capital's tribe.
      const biome = new Uint8Array(N);
      for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
        let best = 0, bd = Infinity;
        for (let i = 0; i < P; i++) {
          const d = Math.hypot(x - caps[i][0], y - caps[i][1]) + rng() * 0.8;
          if (d < bd) { bd = d; best = i; }
        }
        biome[idx(x, y)] = cfg.players[best].tribe;
      }
      const tribeAt = (i) => tribeByIndex(biome[i]);

      // ---- Shallow water hugs the coast; everything else is ocean.
      const landNear = (x, y, r) => {
        for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
          const xx = x + dx, yy = y + dy;
          if (inb(xx, yy) && !isWater(terrain[idx(xx, yy)])) return true;
        }
        return false;
      };
      for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
        const i = idx(x, y);
        if (!isWater(terrain[i])) continue;
        if (landNear(x, y, 1)) terrain[i] = SHALLOW;
        else if (landNear(x, y, 2) && rng() < 0.45) terrain[i] = SHALLOW;
      }

      // ---- Forests and mountains on land, biased by the local tribe.
      for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
        const i = idx(x, y);
        if (terrain[i] !== FIELD) continue;
        const g = tribeAt(i).gen;
        const fm = forestNoise(x, y), mm = mountNoise(x, y);
        const mountainP = clamp(0.1 * g.mountain * (mm > 0.58 ? 3.2 : 0.35), 0, 0.9);
        const forestP = clamp(0.26 * g.forest * (fm > 0.5 ? 2.0 : 0.5), 0, 0.92);
        const r = rng();
        if (r < mountainP) terrain[i] = MOUNTAIN;
        else if (r < mountainP + forestP) terrain[i] = FOREST;
      }
      for (const c of caps) terrain[idx(c[0], c[1])] = FIELD;

      // ---- Villages.
      const cities = [];
      const center = new Int16Array(N).fill(-1);
      const taken = {};
      for (let i = 0; i < P; i++) {
        const tr = tribeByIndex(cfg.players[i].tribe);
        cities.push({ id: i, x: caps[i][0], y: caps[i][1], owner: i, name: cityName(tr, rng, taken),
          level: tr.capitalLevel || 1, pop: 0, capital: true, walls: false, workshop: 0, border: 1,
          parks: 0, connected: false, rewards: 0 });
        center[idx(caps[i][0], caps[i][1])] = i;
      }
      let land = 0;
      for (let i = 0; i < N; i++) if (!isWater(terrain[i])) land++;
      const villageTarget = Math.max(P + 1, Math.round(land / 12.5));
      const vcands = [];
      for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
        const i = idx(x, y);
        if (terrain[i] === MOUNTAIN || isWater(terrain[i])) continue;
        let ok = true;
        for (const c of caps) if (cheb(x, y, c[0], c[1]) < 3) { ok = false; break; }
        if (ok) vcands.push([x, y]);
      }
      // Shuffle, then place greedily with spacing.
      for (let i = vcands.length - 1; i > 0; i--) { const j = rng.int(i + 1); const t = vcands[i]; vcands[i] = vcands[j]; vcands[j] = t; }
      let placed = 0;
      for (const v of vcands) {
        if (placed >= villageTarget) break;
        let ok = true;
        for (const c of cities) if (cheb(v[0], v[1], c.x, c.y) < 3) { ok = false; break; }
        if (!ok) continue;
        const id = cities.length;
        cities.push({ id, x: v[0], y: v[1], owner: -1, name: cityName(tribeAt(idx(v[0], v[1])), rng, taken),
          level: 0, pop: 0, capital: false, walls: false, workshop: 0, border: 1, parks: 0, connected: false, rewards: 0 });
        center[idx(v[0], v[1])] = id;
        terrain[idx(v[0], v[1])] = FIELD;
        placed++;
      }

      // ---- Resources.
      const res = new Uint8Array(N);
      const nearCity = (x, y, r) => {
        for (const c of cities) if (cheb(x, y, c.x, c.y) <= r) return true;
        return false;
      };
      for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
        const i = idx(x, y);
        if (center[i] >= 0) continue;
        const g = tribeAt(i).gen;
        const base = nearCity(x, y, 1) ? 0.62 : nearCity(x, y, 2) ? 0.3 : 0.07;
        const t = terrain[i];
        if (t === FIELD) {
          const pf = base * 0.6 * g.fruit, pc = base * 0.38 * g.crop;
          const r = rng();
          if (r < pf) res[i] = R_FRUIT; else if (r < pf + pc) res[i] = R_CROP;
        } else if (t === FOREST) {
          if (rng() < base * 0.75 * g.animal) res[i] = R_ANIMAL;
        } else if (t === MOUNTAIN) {
          if (rng() < base * 0.7 * g.metal) res[i] = R_METAL;
        } else if (t === SHALLOW) {
          if (rng() < base * 0.7 * g.fish) res[i] = R_FISH;
        } else if (t === OCEAN) {
          if (rng() < 0.045) res[i] = R_WHALE;
        }
      }
      // Every capital gets a usable start: at least two things its starting
      // technology can work with, inside the first ring.
      for (let i = 0; i < P; i++) {
        const tr = tribeByIndex(cfg.players[i].tribe);
        const c = caps[i];
        const ring = [];
        for (const d of DIRS8) if (inb(c[0] + d[0], c[1] + d[1])) ring.push(idx(c[0] + d[0], c[1] + d[1]));
        for (let k = ring.length - 1; k > 0; k--) { const j = rng.int(k + 1); const t = ring[k]; ring[k] = ring[j]; ring[j] = t; }
        const want = { organization: [FIELD, R_FRUIT], hunting: [FOREST, R_ANIMAL], fishing: [SHALLOW, R_FISH],
          climbing: [MOUNTAIN, R_METAL], riding: [FIELD, R_FRUIT], archery: [FOREST, R_ANIMAL], farming: [FIELD, R_CROP],
          smithery: [MOUNTAIN, R_METAL], meditation: [MOUNTAIN, R_METAL], shields: [FIELD, R_FRUIT], roads: [FIELD, R_FRUIT] };
        const w = want[tr.tech] || [FIELD, R_FRUIT];
        let have = 0;
        for (const t of ring) if (terrain[t] === w[0] && res[t] === w[1]) have++;
        let k = 0;
        while (have < 2 && k < ring.length) {
          const t = ring[k++];
          if (terrain[t] === w[0] && res[t] === w[1]) continue;
          if (w[0] === SHALLOW && !isWater(terrain[t])) continue;   // never flood a start
          if (w[0] !== SHALLOW && isWater(terrain[t])) continue;
          terrain[t] = w[0]; res[t] = w[1]; have++;
        }
        // And a little fruit or an animal for everyone, so turn one is never dead.
        let food = 0;
        for (const t of ring) if (res[t] === R_FRUIT || res[t] === R_ANIMAL || res[t] === R_FISH) food++;
        k = 0;
        while (food < 2 && k < ring.length) {
          const t = ring[k++];
          if (res[t]) continue;
          if (terrain[t] === FIELD) { res[t] = R_FRUIT; food++; }
          else if (terrain[t] === FOREST) { res[t] = R_ANIMAL; food++; }
        }
      }

      // ---- Ruins, on land away from cities and in deep water.
      const bld = new Uint8Array(N);
      const lvl = new Uint8Array(N);
      let ocean = 0;
      for (let i = 0; i < N; i++) if (terrain[i] === OCEAN) ocean++;
      const ruinTarget = Math.max(2, Math.round(land / 32)) + Math.round(ocean / 70);
      const rcands = [];
      for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
        const i = idx(x, y);
        if (terrain[i] === SHALLOW || center[i] >= 0) continue;
        if (nearCity(x, y, 1)) continue;
        let okc = true;
        for (const c of caps) if (cheb(x, y, c[0], c[1]) <= 2) { okc = false; break; }
        if (okc) rcands.push([x, y]);
      }
      for (let i = rcands.length - 1; i > 0; i--) { const j = rng.int(i + 1); const t = rcands[i]; rcands[i] = rcands[j]; rcands[j] = t; }
      const ruins = [];
      for (const r of rcands) {
        if (ruins.length >= ruinTarget) break;
        let ok = true;
        for (const q of ruins) if (cheb(r[0], r[1], q[0], q[1]) < 3) { ok = false; break; }
        if (!ok) continue;
        ruins.push(r);
        bld[idx(r[0], r[1])] = B_RUIN;
        res[idx(r[0], r[1])] = R_NONE;
      }

      // ---- Players, territory, units, fog.
      const players = [];
      for (let i = 0; i < P; i++) {
        const pc = cfg.players[i];
        const tr = tribeByIndex(pc.tribe);
        const diff = pc.human ? null : diffById(pc.ai);
        players.push({
          id: i, tribe: pc.tribe, human: !!pc.human, ai: pc.human ? null : (pc.ai || "normal"),
          stars: START_STARS + (diff ? diff.startStars : 0),
          techs: tr.tech ? [tr.tech] : [], alive: true, kills: 0, lost: 0,
          explored: new Uint8Array(N), met: [], tasks: {}, built: {},
          lastAttackTurn: 0, metTurn: 0, score: 0, attackedThisTurn: false
        });
      }

      const S = {
        v: 1, seed: cfg.seed >>> 0, n, mapType: mapType.id, mode: cfg.mode || "perfection",
        turnLimit: cfg.turnLimit || 30, turn: 1, cur: 0, over: false, winner: -1,
        terrain, res, bld, lvl, road: new Uint8Array(N), terr: new Int16Array(N).fill(-1), center, biome,
        cities, units: [], nextUnitId: 1, players, rngState: 0, pendingRewards: [], events: [],
        uAt: new Map()
      };
      S.rngState = rng.state();

      for (let i = 0; i < P; i++) {
        claimTerritory(S, cities[i]);
        const u = spawnUnit(S, "warrior", i, caps[i][0], caps[i][1], i);
        if (u) { u.moved = false; u.attacked = false; }
        revealArea(S, i, caps[i][0], caps[i][1], 2);
      }
      rebuildUnitMap(S);
      return S;
    }

    // ====================================================================== //
    // 4. Rules engine                                                        //
    // ====================================================================== //
    // Pure state transitions over the game state S. Nothing in here touches
    // the DOM or the canvas; the UI and the AI both drive the game through
    // these functions, and the node simulation runs them without a browser.
    // Anything the UI might want to animate is pushed onto S.events.

    let AI_EXTRA_STARS = 0;      // creator tuning knob, applied to every bot
    const tIdx = (S, x, y) => y * S.n + x;
    const inBounds = (S, x, y) => x >= 0 && y >= 0 && x < S.n && y < S.n;
    const emit = (S, ev) => { if (S.events) S.events.push(ev); };

    function rebuildUnitMap(S) {
      S.uAt = new Map();
      for (const u of S.units) S.uAt.set(tIdx(S, u.x, u.y), u);
    }
    const unitAt = (S, x, y) => (inBounds(S, x, y) ? S.uAt.get(tIdx(S, x, y)) || null : null);
    const cityAt = (S, x, y) => (inBounds(S, x, y) && S.center[tIdx(S, x, y)] >= 0 ? S.cities[S.center[tIdx(S, x, y)]] : null);
    const tileCity = (S, i) => (S.terr[i] >= 0 ? S.cities[S.terr[i]] : null);
    const tilePlayer = (S, i) => (S.terr[i] >= 0 ? S.cities[S.terr[i]].owner : -1);
    const hasTech = (S, p, t) => S.players[p].techs.indexOf(t) >= 0;
    const playerCities = (S, p) => S.cities.filter((c) => c.owner === p);
    const numCities = (S, p) => { let k = 0; for (const c of S.cities) if (c.owner === p) k++; return k; };
    const alivePlayers = (S) => S.players.filter((pl) => pl.alive);
    const maxHp = (u) => UNITS[u.type].hp + (u.vet ? VETERAN_BONUS_HP : 0);
    const unitStats = (u) => (u.boat ? BOATS[u.boat] : UNITS[u.type]);
    const unitName = (u) => (u.boat ? BOATS[u.boat].name : UNITS[u.type].name);
    const canDash = (u) => (u.boat ? true : hasSkill(u.type, "dash"));

    function gameRng(S) {
      const r = makeRng(S.rngState);
      return { rng: r, done: () => { S.rngState = r.state(); } };
    }

    // ---------------------------------------------------------------- units
    function spawnUnit(S, type, owner, x, y, home) {
      if (unitAt(S, x, y)) return null;
      const u = { id: S.nextUnitId++, type, owner, x, y, hp: UNITS[type].hp, moved: true, attacked: true,
        home: home == null ? -1 : home, boat: 0, kills: 0, vet: false };
      S.units.push(u);
      if (S.uAt) S.uAt.set(tIdx(S, x, y), u);
      emit(S, { t: "spawn", u: u.id, x, y, p: owner });
      return u;
    }
    function removeUnit(S, u) {
      const k = S.units.indexOf(u);
      if (k >= 0) S.units.splice(k, 1);
      if (S.uAt && S.uAt.get(tIdx(S, u.x, u.y)) === u) S.uAt.delete(tIdx(S, u.x, u.y));
      u.dead = true;
    }
    const cityUnits = (S, c) => { let k = 0; for (const u of S.units) if (u.home === c.id) k++; return k; };
    const unitCap = (c) => c.level + 1;

    // ----------------------------------------------------------- territory
    function claimTerritory(S, c) {
      const r = c.border;
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        const x = c.x + dx, y = c.y + dy;
        if (!inBounds(S, x, y)) continue;
        const i = tIdx(S, x, y);
        if (S.terr[i] < 0) S.terr[i] = c.id;
      }
    }

    function meet(S, p, q) {
      if (p === q || p < 0 || q < 0) return;
      const a = S.players[p], b = S.players[q];
      if (a.met.indexOf(q) < 0) { a.met.push(q); if (!a.metTurn) a.metTurn = S.turn; emit(S, { t: "meet", p, q }); }
      if (b.met.indexOf(p) < 0) { b.met.push(p); if (!b.metTurn) b.metTurn = S.turn; }
    }

    function revealTile(S, p, x, y) {
      if (!inBounds(S, x, y)) return;
      const i = tIdx(S, x, y);
      const pl = S.players[p];
      if (!pl.explored[i]) { pl.explored[i] = 1; emit(S, { t: "reveal", p, i }); }
      const u = unitAt(S, x, y);
      if (u && u.owner !== p) meet(S, p, u.owner);
      const c = S.center[i] >= 0 ? S.cities[S.center[i]] : null;
      if (c && c.owner >= 0 && c.owner !== p) meet(S, p, c.owner);
    }
    function revealArea(S, p, x, y, r) {
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) revealTile(S, p, x + dx, y + dy);
    }
    function revealForUnit(S, u) {
      const r = S.terrain[tIdx(S, u.x, u.y)] === MOUNTAIN ? 2 : (u.boat === 3 ? 2 : 1);
      revealArea(S, u.owner, u.x, u.y, r);
    }
    // The Explorer reward: a wandering scout that reveals the land around.
    function explorerReveal(S, p, x, y) {
      const dice = gameRng(S);
      let cx = x, cy = y;
      for (let step = 0; step < 15; step++) {
        const d = dice.rng.pick(DIRS8);
        const nx = clamp(cx + d[0], 0, S.n - 1), ny = clamp(cy + d[1], 0, S.n - 1);
        cx = nx; cy = ny;
        revealArea(S, p, cx, cy, 1);
      }
      dice.done();
    }

    // ------------------------------------------------------------ economy
    function sieged(S, c) {
      if (!SIEGE) return false;
      const u = unitAt(S, c.x, c.y);
      return !!(u && u.owner !== c.owner);
    }
    function cityIncome(S, c) {
      if (c.owner < 0 || sieged(S, c)) return 0;
      let s = c.level + (c.capital ? 1 : 0) + (c.workshop ? 1 : 0);
      // Customs houses pay per adjacent friendly port.
      for (let i = 0; i < S.terr.length; i++) {
        if (S.terr[i] !== c.id || S.bld[i] !== B_CUSTOMS) continue;
        const x = i % S.n, y = (i - x) / S.n;
        s += BLD[B_CUSTOMS].adjStars * countAdjacentBuilding(S, x, y, B_PORT, c.owner);
      }
      return s;
    }
    function countAdjacentBuilding(S, x, y, b, p) {
      let k = 0;
      for (const d of DIRS8) {
        const xx = x + d[0], yy = y + d[1];
        if (!inBounds(S, xx, yy)) continue;
        const j = tIdx(S, xx, yy);
        if (S.bld[j] === b && (p == null || tilePlayer(S, j) === p)) k++;
      }
      return k;
    }
    function playerIncome(S, p) {
      let s = 0;
      for (const c of S.cities) if (c.owner === p) s += cityIncome(S, c);
      const pl = S.players[p];
      if (pl.ai) { const d = diffById(pl.ai); s += d.bonus + d.perCity * numCities(S, p) + AI_EXTRA_STARS; }
      return s;
    }

    function techCost(S, p, t) {
      let c = TECH_BASE + TECHS[t].tier * Math.max(1, numCities(S, p));
      if (t !== "philosophy" && hasTech(S, p, "philosophy")) c = Math.round(c * (1 - PHILOSOPHY_DISCOUNT));
      return Math.max(1, c);
    }
    function techAvailable(S, p, t) {
      if (hasTech(S, p, t)) return false;
      const from = TECHS[t].from;
      return !from || hasTech(S, p, from);
    }
    function canResearch(S, p, t) { return techAvailable(S, p, t) && S.players[p].stars >= techCost(S, p, t); }
    function research(S, p, t) {
      if (!canResearch(S, p, t)) return false;
      const pl = S.players[p];
      pl.stars -= techCost(S, p, t);
      pl.techs.push(t);
      emit(S, { t: "research", p, tech: t });
      checkTasks(S, p);
      return true;
    }

    // -------------------------------------------------------------- cities
    function addPop(S, c, k) {
      if (c.owner < 0 || k === 0) return;
      c.pop += k;
      emit(S, { t: "pop", c: c.id, n: k, x: c.x, y: c.y });
      while (c.pop >= c.level + 1) {
        c.pop -= c.level + 1;
        c.level++;
        emit(S, { t: "levelup", c: c.id, level: c.level, x: c.x, y: c.y });
        S.pendingRewards.push({ city: c.id, level: c.level });
      }
      if (c.pop < 0) c.pop = 0;
      checkTasks(S, c.owner);
    }
    function pendingRewardFor(S, p) {
      return S.pendingRewards.find((r) => S.cities[r.city].owner === p) || null;
    }
    function applyReward(S, c, id) {
      const k = S.pendingRewards.findIndex((r) => r.city === c.id);
      if (k >= 0) S.pendingRewards.splice(k, 1);
      const pl = S.players[c.owner];
      switch (id) {
        case "workshop": c.workshop = 1; break;
        case "explorer": explorerReveal(S, c.owner, c.x, c.y); break;
        case "walls": c.walls = true; break;
        case "resources": pl.stars += 5; emit(S, { t: "stars", p: c.owner, n: 5, x: c.x, y: c.y }); break;
        case "popgrowth": addPop(S, c, 3); break;
        case "border": c.border = 2; claimTerritory(S, c); break;
        case "park": c.parks++; break;
        case "superunit": {
          let spot = null;
          if (!unitAt(S, c.x, c.y)) spot = [c.x, c.y];
          else for (const d of DIRS8) {
            const x = c.x + d[0], y = c.y + d[1];
            if (inBounds(S, x, y) && !isWater(S.terrain[tIdx(S, x, y)]) && S.terrain[tIdx(S, x, y)] !== MOUNTAIN && !unitAt(S, x, y)) { spot = [x, y]; break; }
          }
          if (spot) { const g = spawnUnit(S, "giant", c.owner, spot[0], spot[1], c.id); if (g) revealForUnit(S, g); }
          break;
        }
        default: break;
      }
      c.rewards++;
      emit(S, { t: "reward", c: c.id, id });
    }

    function canTrain(S, c, type) {
      if (c.owner < 0 || UNITS[type].superUnit) return null;
      const pl = S.players[c.owner];
      if (UNITS[type].tech && !hasTech(S, c.owner, UNITS[type].tech)) return null;
      if (unitAt(S, c.x, c.y)) return "occupied";
      if (cityUnits(S, c) >= unitCap(c)) return "full";
      if (pl.stars < UNITS[type].cost) return "stars";
      return "ok";
    }
    function trainUnit(S, c, type) {
      if (canTrain(S, c, type) !== "ok") return null;
      S.players[c.owner].stars -= UNITS[type].cost;
      const u = spawnUnit(S, type, c.owner, c.x, c.y, c.id);
      if (u) { revealForUnit(S, u); emit(S, { t: "train", u: u.id, c: c.id }); }
      return u;
    }

    // -------------------------------------------------------- movement
    function canStand(S, u, i) {
      const t = S.terrain[i];
      const p = u.owner;
      if (u.boat) {
        if (isWater(t)) return t === SHALLOW || hasTech(S, p, "navigation");
        return t !== MOUNTAIN || hasTech(S, p, "climbing");          // disembark
      }
      if (isWater(t)) return S.bld[i] === B_PORT && tilePlayer(S, i) === p;
      if (t === MOUNTAIN) return hasTech(S, p, "climbing");
      return true;
    }
    function enemyAdjacent(S, p, x, y) {
      for (const d of DIRS8) {
        const u = unitAt(S, x + d[0], y + d[1]);
        if (u && u.owner !== p) return true;
      }
      return false;
    }
    // Entering some tiles ends the move: forests and mountains (unless the
    // road runs through), boarding or landing, and any tile touching an enemy.
    function stopsHere(S, u, i, usedRoad) {
      const t = S.terrain[i];
      const x = i % S.n, y = (i - x) / S.n;
      if (u.boat) { if (!isWater(t)) return true; }
      else {
        if (isWater(t)) return true;
        if ((t === FOREST || t === MOUNTAIN) && !usedRoad) return true;
      }
      return enemyAdjacent(S, u.owner, x, y);
    }
    const roadLike = (S, i, p) => (S.road[i] && tilePlayer(S, i) !== -2 && (tilePlayer(S, i) === -1 || tilePlayer(S, i) === p)) ||
      (S.center[i] >= 0 && S.cities[S.center[i]].owner === p);

    function unitMoves(S, u) { return unitStats(u).mv; }

    /** Dijkstra over the move budget; returns Map<tileIndex, { cost, prev }>. */
    function reachable(S, u) {
      const out = new Map();
      if (u.moved || u.dead) return out;
      const budget = unitMoves(S, u) + 1e-6;
      const start = tIdx(S, u.x, u.y);
      const best = new Map([[start, 0]]);
      const open = [{ i: start, cost: 0, term: false }];
      while (open.length) {
        let bi = 0;
        for (let k = 1; k < open.length; k++) if (open[k].cost < open[bi].cost) bi = k;
        const cur = open.splice(bi, 1)[0];
        if (cur.term) continue;
        const cx = cur.i % S.n, cy = (cur.i - cx) / S.n;
        for (const d of DIRS8) {
          const x = cx + d[0], y = cy + d[1];
          if (!inBounds(S, x, y)) continue;
          const j = tIdx(S, x, y);
          if (unitAt(S, x, y)) continue;
          if (!canStand(S, u, j)) continue;
          const road = !u.boat && roadLike(S, cur.i, u.owner) && roadLike(S, j, u.owner);
          const step = road ? 0.5 : 1;
          const c = cur.cost + step;
          if (c > budget) continue;
          if (best.has(j) && best.get(j) <= c) continue;
          best.set(j, c);
          const term = stopsHere(S, u, j, road);
          out.set(j, { cost: c, prev: cur.i });
          open.push({ i: j, cost: c, term });
        }
      }
      return out;
    }
    function pathTo(reach, i) {
      const path = [];
      let k = i;
      while (k != null && reach.has(k)) { path.unshift(k); k = reach.get(k).prev; }
      return path;
    }

    function placeUnit(S, u, i) {
      const from = tIdx(S, u.x, u.y);
      if (S.uAt.get(from) === u) S.uAt.delete(from);
      u.x = i % S.n; u.y = (i - u.x) / S.n;
      S.uAt.set(i, u);
      const t = S.terrain[i];
      if (u.boat && !isWater(t)) u.boat = 0;
      if (!u.boat && isWater(t) && S.bld[i] === B_PORT) u.boat = 1;
      revealForUnit(S, u);
    }
    function moveUnit(S, u, i, path) {
      const from = tIdx(S, u.x, u.y);
      placeUnit(S, u, i);
      u.moved = true;
      emit(S, { t: "move", u: u.id, from, to: i, path: path || [from, i], p: u.owner });
      return true;
    }

    // ---------------------------------------------------------------- combat
    function defenceBonus(S, d) {
      const i = tIdx(S, d.x, d.y);
      const c = S.center[i] >= 0 ? S.cities[S.center[i]] : null;
      if (c && c.owner === d.owner && !d.boat && hasSkill(d.type, "fortify")) return c.walls ? 4 : 1.5;
      const t = S.terrain[i];
      if (t === FOREST && hasTech(S, d.owner, "archery")) return 1.5;
      if (t === MOUNTAIN && hasTech(S, d.owner, "meditation")) return 1.5;
      if (isWater(t) && hasTech(S, d.owner, "aquatism")) return 1.5;
      return 1;
    }
    /** Predict an exchange without applying it. */
    function predictCombat(S, a, d) {
      const as = unitStats(a), ds = unitStats(d);
      const attackForce = as.atk * (a.hp / maxHp(a));
      const defenseForce = ds.def * (d.hp / maxHp(d)) * defenceBonus(S, d);
      const total = attackForce + defenseForce;
      let toD = 0, toA = 0;
      if (total > 0) {
        toD = Math.round((attackForce / total) * as.atk * 4.5);
        toA = Math.round((defenseForce / total) * ds.def * 4.5);
      }
      const dist = cheb(a.x, a.y, d.x, d.y);
      const killed = d.hp - toD <= 0;
      const retaliates = !killed && dist <= ds.rng && toA > 0;
      return { toD, toA: retaliates ? toA : 0, killed, aKilled: retaliates && a.hp - toA <= 0 };
    }
    function attackTargets(S, u) {
      const out = [];
      if (u.dead || u.attacked) return out;
      if (u.moved && !canDash(u)) return out;
      if (unitStats(u).atk <= 0) return out;
      const r = unitStats(u).rng;
      const pl = S.players[u.owner];
      for (const d of S.units) {
        if (d.owner === u.owner || d.dead) continue;
        if (cheb(u.x, u.y, d.x, d.y) > r) continue;
        if (!pl.explored[tIdx(S, d.x, d.y)]) continue;
        out.push(d);
      }
      return out;
    }
    function attack(S, a, d) {
      const pre = predictCombat(S, a, d);
      const hadMoved = a.moved;
      const dIdx = tIdx(S, d.x, d.y);
      d.hp -= pre.toD;
      const pl = S.players[a.owner];
      pl.attackedThisTurn = true;
      pl.lastAttackTurn = S.turn;
      const ev = { t: "attack", a: a.id, d: d.id, toD: pre.toD, toA: 0, killed: false, aKilled: false,
        ax: a.x, ay: a.y, dx: d.x, dy: d.y, p: a.owner, q: d.owner };
      if (d.hp <= 0) {
        ev.killed = true;
        killUnit(S, d, a);
        if (unitStats(a).rng === 1 && !unitAt(S, d.x, d.y) && canStand(S, a, dIdx) &&
            !(a.boat && !isWater(S.terrain[dIdx])) && !(!a.boat && isWater(S.terrain[dIdx]))) {
          placeUnit(S, a, dIdx);
          ev.advanced = dIdx;
        }
      } else if (pre.toA > 0) {
        a.hp -= pre.toA;
        ev.toA = pre.toA;
        if (a.hp <= 0) { ev.aKilled = true; killUnit(S, a, d); }
      }
      if (!a.dead) {
        a.attacked = true;
        a.moved = true;
        if (ev.killed && !a.boat && hasSkill(a.type, "persist")) a.attacked = false;
        if (!hadMoved && !a.boat && hasSkill(a.type, "escape")) a.moved = false;
      }
      emit(S, ev);
      return ev;
    }
    function killUnit(S, u, by) {
      removeUnit(S, u);
      S.players[u.owner].lost++;
      emit(S, { t: "death", u: u.id, x: u.x, y: u.y, p: u.owner,
        unit: { id: u.id, type: u.type, owner: u.owner, x: u.x, y: u.y, hp: 1, boat: u.boat, vet: u.vet, kills: u.kills, moved: false, attacked: false, dead: true } });
      if (by && !by.dead) {
        by.kills++;
        S.players[by.owner].kills++;
        checkTasks(S, by.owner);
      }
    }

    // --------------------------------------------------------- unit actions
    const canCapture = (S, u) => {
      if (u.dead || u.moved || u.attacked || u.boat) return false;
      const c = cityAt(S, u.x, u.y);
      return !!(c && c.owner !== u.owner);
    };
    function captureCity(S, u) {
      if (!canCapture(S, u)) return false;
      const c = cityAt(S, u.x, u.y);
      const prev = c.owner;
      c.owner = u.owner;
      c.connected = false;
      if (prev < 0) { c.level = 1; c.pop = 0; claimTerritory(S, c); }
      else {
        c.pop = 0;
        for (const v of S.units) if (v.home === c.id && v.owner !== u.owner) v.home = -1;
        claimTerritory(S, c);
      }
      // Temples in the territory restart their growth for the new owner.
      for (let i = 0; i < S.terr.length; i++) if (S.terr[i] === c.id && BLD[S.bld[i]] && BLD[S.bld[i]].temple) S.lvl[i] = 0;
      u.moved = true; u.attacked = true;
      u.home = u.home < 0 ? c.id : u.home;
      revealArea(S, u.owner, c.x, c.y, 2);
      emit(S, { t: "capture", c: c.id, p: u.owner, q: prev, x: c.x, y: c.y });
      if (prev >= 0) checkElimination(S, prev);
      checkTasks(S, u.owner);
      return true;
    }
    function checkElimination(S, p) {
      const pl = S.players[p];
      if (!pl.alive) return;
      if (numCities(S, p) > 0) return;
      pl.alive = false;
      for (const u of S.units.slice()) if (u.owner === p) removeUnit(S, u);
      emit(S, { t: "eliminated", p });
    }

    const canRecover = (S, u) => !u.dead && !u.moved && !u.attacked && u.hp < maxHp(u);
    function recover(S, u) {
      if (!canRecover(S, u)) return false;
      const own = tilePlayer(S, tIdx(S, u.x, u.y)) === u.owner;
      const before = u.hp;
      u.hp = Math.min(maxHp(u), u.hp + (own ? 4 : 2));
      u.moved = true; u.attacked = true;
      emit(S, { t: "heal", u: u.id, n: u.hp - before, x: u.x, y: u.y });
      return true;
    }
    const canExamine = (S, u) => !u.dead && !u.attacked && S.bld[tIdx(S, u.x, u.y)] === B_RUIN;
    function examineRuins(S, u) {
      if (!canExamine(S, u)) return null;
      const i = tIdx(S, u.x, u.y);
      S.bld[i] = B_NONE;
      const pl = S.players[u.owner];
      const dice = gameRng(S);
      const options = [];
      const water = isWater(S.terrain[i]);
      if (water && u.boat && u.boat < 3) options.push("battleship", "battleship", "battleship");
      options.push("stars", "stars", "stars");
      const own = S.cities.filter((c) => c.owner === u.owner);
      if (own.length) options.push("pop", "pop", "pop");
      if (TECH_IDS.some((t) => techAvailable(S, u.owner, t))) options.push("tech", "tech");
      if (!water) options.push("giant");
      options.push("explorer", "explorer");
      const pick = dice.rng.pick(options);
      let detail = "";
      if (pick === "stars") { pl.stars += WHALE_STARS; detail = "+" + WHALE_STARS + " stars"; emit(S, { t: "stars", p: u.owner, n: WHALE_STARS, x: u.x, y: u.y }); }
      else if (pick === "pop") {
        let best = own[0], bd = Infinity;
        for (const c of own) { const d = cheb(c.x, c.y, u.x, u.y); if (d < bd) { bd = d; best = c; } }
        addPop(S, best, 3); detail = "+3 population for " + best.name;
      } else if (pick === "tech") {
        const avail = TECH_IDS.filter((t) => techAvailable(S, u.owner, t));
        const t = dice.rng.pick(avail);
        pl.techs.push(t); detail = TECHS[t].name + " discovered";
        emit(S, { t: "research", p: u.owner, tech: t });
        checkTasks(S, u.owner);
      } else if (pick === "giant") {
        let spot = null;
        for (const d of DIRS8) {
          const x = u.x + d[0], y = u.y + d[1];
          if (inBounds(S, x, y) && !isWater(S.terrain[tIdx(S, x, y)]) && S.terrain[tIdx(S, x, y)] !== MOUNTAIN && !unitAt(S, x, y)) { spot = [x, y]; break; }
        }
        if (spot) { const gi = spawnUnit(S, "giant", u.owner, spot[0], spot[1], -1); if (gi) revealForUnit(S, gi); detail = "A Giant awakens"; }
        else { pl.stars += WHALE_STARS; detail = "+" + WHALE_STARS + " stars"; }
      } else if (pick === "battleship") { u.boat = 3; detail = "The wreck becomes a Battleship"; }
      else { explorerReveal(S, u.owner, u.x, u.y); detail = "The land around is revealed"; }
      dice.done();
      u.moved = true; u.attacked = true;
      emit(S, { t: "ruin", u: u.id, x: u.x, y: u.y, reward: pick, detail, p: u.owner });
      return { reward: pick, detail };
    }
    const canHeal = (S, u) => !u.dead && !u.boat && hasSkill(u.type, "heal") && !u.attacked && !u.moved && S.units.some((v) => v.owner === u.owner && v !== u && cheb(v.x, v.y, u.x, u.y) <= 1 && v.hp < maxHp(v));
    function healOthers(S, u) {
      if (!canHeal(S, u)) return false;
      for (const v of S.units) if (v.owner === u.owner && v !== u && cheb(v.x, v.y, u.x, u.y) <= 1 && v.hp < maxHp(v)) {
        const before = v.hp; v.hp = Math.min(maxHp(v), v.hp + 4);
        emit(S, { t: "heal", u: v.id, n: v.hp - before, x: v.x, y: v.y });
      }
      u.moved = true; u.attacked = true;
      return true;
    }
    function convertTargets(S, u) {
      if (u.dead || u.boat || !hasSkill(u.type, "convert") || u.attacked || u.moved) return [];
      return S.units.filter((v) => v.owner !== u.owner && !v.dead && cheb(v.x, v.y, u.x, u.y) <= 1);
    }
    function convertUnit(S, u, v) {
      if (convertTargets(S, u).indexOf(v) < 0) return false;
      const q = v.owner;
      v.owner = u.owner; v.home = -1; v.moved = true; v.attacked = true;
      u.moved = true; u.attacked = true;
      S.players[u.owner].attackedThisTurn = true;
      S.players[u.owner].lastAttackTurn = S.turn;
      emit(S, { t: "convert", u: u.id, v: v.id, p: u.owner, q, x: v.x, y: v.y });
      checkElimination(S, q);
      return true;
    }
    const canDisband = (S, u) => !u.dead && hasTech(S, u.owner, "free_spirit") && !u.moved && !u.attacked;
    function disband(S, u) {
      if (!canDisband(S, u)) return false;
      const back = Math.floor(UNITS[u.type].cost / 2);
      S.players[u.owner].stars += back;
      removeUnit(S, u);
      emit(S, { t: "disband", u: u.id, x: u.x, y: u.y, n: back, p: u.owner });
      return true;
    }
    function boatUpgrades(S, u) {
      const out = [];
      if (!u.boat || u.dead) return out;
      for (let k = u.boat + 1; k < BOATS.length; k++) {
        if (BOATS[k].tech && !hasTech(S, u.owner, BOATS[k].tech)) continue;
        out.push({ kind: k, name: BOATS[k].name, cost: BOATS[k].cost, can: S.players[u.owner].stars >= BOATS[k].cost });
      }
      return out;
    }
    function upgradeBoat(S, u, kind) {
      const o = boatUpgrades(S, u).find((b) => b.kind === kind);
      if (!o || !o.can) return false;
      S.players[u.owner].stars -= o.cost;
      u.boat = kind;
      emit(S, { t: "upgrade", u: u.id, kind });
      return true;
    }
    const canPromote = (u) => !u.dead && !u.vet && !UNITS[u.type].superUnit && u.kills >= VETERAN_KILLS;
    function promote(S, u) {
      if (!canPromote(u)) return false;
      u.vet = true; u.hp = maxHp(u);
      emit(S, { t: "promote", u: u.id, x: u.x, y: u.y });
      return true;
    }

    // ---------------------------------------------------------- tile actions
    /** Everything player p could do on tile (x, y) right now. */
    function tileActions(S, p, x, y) {
      const out = [];
      if (!inBounds(S, x, y)) return out;
      const i = tIdx(S, x, y);
      const pl = S.players[p];
      if (!pl.explored[i]) return out;
      const t = S.terrain[i], r = S.res[i], b = S.bld[i];
      const own = tilePlayer(S, i) === p;
      const city = tileCity(S, i);
      const isCenter = S.center[i] >= 0;
      const add = (id, name, cost, extra) => out.push(Object.assign({ id, name, cost, can: pl.stars >= cost }, extra || {}));

      if (own && !isCenter) {
        if (r === R_FRUIT && hasTech(S, p, "organization")) add("harvest", "Harvest fruit", HARVEST_COST.fruit, { pop: 1 });
        if (r === R_ANIMAL && hasTech(S, p, "hunting")) add("harvest", "Hunt", HARVEST_COST.animal, { pop: 1 });
        if (r === R_FISH && hasTech(S, p, "fishing")) add("harvest", "Fish", HARVEST_COST.fish, { pop: 1 });
        if (r === R_WHALE && hasTech(S, p, "whaling")) add("whale", "Hunt whale", 0, { stars: WHALE_STARS });
        if (b === B_NONE) {
          for (let k = 1; k < BLD.length; k++) {
            const d = BLD[k];
            if (!d || k === B_MONUMENT || k === B_RUIN) continue;
            if (!hasTech(S, p, d.tech)) continue;
            if (d.on.indexOf(t) < 0) continue;
            if (d.res ? r !== d.res : r !== R_NONE) continue;
            if (d.unique && cityHasBuilding(S, city, k)) continue;
            let pop = d.pop;
            if (d.adj) pop += (d.adjPop || 0) * countAdjacentBuilding(S, x, y, d.adj, p);
            add("build:" + k, d.name, d.cost, { pop, bld: k, stars: d.adjStars ? d.adjStars * countAdjacentBuilding(S, x, y, d.adj, p) : 0 });
          }
          if (r === R_NONE && !isWater(t)) {
            for (let k = 0; k < TASKS.length; k++) {
              const task = TASKS[k];
              if (pl.tasks[task.id] && !pl.built[task.id]) add("monument:" + k, task.name, 0, { pop: 3, monument: k });
            }
          }
          if (t === FOREST && hasTech(S, p, "forestry")) add("clear", "Clear forest", 0, { stars: CLEAR_FOREST_GAIN });
          if (t === FOREST && hasTech(S, p, "chivalry")) add("burn", "Burn forest", BURN_FOREST_COST);
          if (t === FIELD && r === R_NONE && hasTech(S, p, "spiritualism")) add("grow", "Grow forest", GROW_FOREST_COST);
        }
      }
      if (hasTech(S, p, "roads") && !isCenter && !S.road[i] && (tilePlayer(S, i) === -1 || own) && b !== B_RUIN) {
        if (t === FIELD || t === FOREST) add("road", "Road", ROAD_COST);
        if (t === SHALLOW && b === B_NONE && landSides(S, x, y) >= 2) add("bridge", "Bridge", BRIDGE_COST);
      }
      return out;
    }
    function landSides(S, x, y) {
      let k = 0;
      const sides = [[0, -1], [0, 1], [-1, 0], [1, 0]];
      for (const d of sides) if (inBounds(S, x + d[0], y + d[1]) && !isWater(S.terrain[tIdx(S, x + d[0], y + d[1])])) k++;
      return k;
    }
    function cityHasBuilding(S, c, b) {
      if (!c) return false;
      for (let i = 0; i < S.terr.length; i++) if (S.terr[i] === c.id && S.bld[i] === b) return true;
      return false;
    }
    function doTileAction(S, p, x, y, id) {
      const act = tileActions(S, p, x, y).find((a) => a.id === id);
      if (!act || !act.can) return false;
      const i = tIdx(S, x, y);
      const pl = S.players[p];
      const city = tileCity(S, i);
      pl.stars -= act.cost;
      if (id === "harvest") { S.res[i] = R_NONE; addPop(S, city, HARVEST_POP); }
      else if (id === "whale") { S.res[i] = R_NONE; pl.stars += WHALE_STARS; emit(S, { t: "stars", p, n: WHALE_STARS, x, y }); }
      else if (id.indexOf("build:") === 0) {
        const k = act.bld;
        S.bld[i] = k;
        S.lvl[i] = 0;
        if (BLD[k].res) S.res[i] = R_NONE;
        addPop(S, city, act.pop);
        // A new farm/mine/hut/port feeds the mill next door too.
        for (const d of DIRS8) {
          const xx = x + d[0], yy = y + d[1];
          if (!inBounds(S, xx, yy)) continue;
          const j = tIdx(S, xx, yy);
          const nb = BLD[S.bld[j]];
          if (nb && nb.adj === k && nb.adjPop && tilePlayer(S, j) === p) addPop(S, tileCity(S, j), nb.adjPop);
        }
      } else if (id.indexOf("monument:") === 0) {
        S.bld[i] = B_MONUMENT; S.lvl[i] = act.monument;
        pl.built[TASKS[act.monument].id] = true;
        addPop(S, city, 3);
        emit(S, { t: "monument", p, x, y, k: act.monument });
      } else if (id === "clear") { S.terrain[i] = FIELD; S.res[i] = R_NONE; pl.stars += CLEAR_FOREST_GAIN; emit(S, { t: "stars", p, n: CLEAR_FOREST_GAIN, x, y }); }
      else if (id === "burn") { S.terrain[i] = FIELD; S.res[i] = R_CROP; }
      else if (id === "grow") { S.terrain[i] = FOREST; }
      else if (id === "road" || id === "bridge") { S.road[i] = 1; updateConnections(S, p); }
      emit(S, { t: "tile", p, x, y, id });
      checkTasks(S, p);
      return true;
    }

    // ------------------------------------------------------ road network
    function connectedCities(S, p) {
      const cap = S.cities.find((c) => c.owner === p && c.capital);
      const out = [];
      if (!cap) return out;
      const seen = new Uint8Array(S.terr.length);
      const stack = [tIdx(S, cap.x, cap.y)];
      seen[stack[0]] = 1;
      while (stack.length) {
        const i = stack.pop();
        const x = i % S.n, y = (i - x) / S.n;
        const c = S.center[i] >= 0 ? S.cities[S.center[i]] : null;
        if (c && c.owner === p && c !== cap) out.push(c);
        for (const d of DIRS8) {
          const xx = x + d[0], yy = y + d[1];
          if (!inBounds(S, xx, yy)) continue;
          const j = tIdx(S, xx, yy);
          if (seen[j]) continue;
          const tp = tilePlayer(S, j);
          const cj = S.center[j] >= 0 ? S.cities[S.center[j]] : null;
          const ok = (S.road[j] && (tp === -1 || tp === p)) || (cj && cj.owner === p);
          if (!ok) continue;
          seen[j] = 1;
          stack.push(j);
        }
      }
      return out;
    }
    function updateConnections(S, p) {
      const cap = S.cities.find((c) => c.owner === p && c.capital);
      if (!cap) return;
      for (const c of connectedCities(S, p)) {
        if (c.connected) continue;
        c.connected = true;
        addPop(S, c, 1);
        addPop(S, cap, 1);
        emit(S, { t: "connected", c: c.id });
      }
      checkTasks(S, p);
    }

    // ------------------------------------------------------------- scoring
    function computeScore(S, p) {
      let s = 0;
      const n2 = S.terr.length;
      for (let i = 0; i < n2; i++) {
        if (tilePlayer(S, i) !== p) continue;
        s += 20;
        const b = S.bld[i];
        if (BLD[b] && BLD[b].temple) s += TEMPLE_SCORE[templeLevel(S, i)];
        else if (b === B_MONUMENT) s += MONUMENT_SCORE;
      }
      for (const c of S.cities) if (c.owner === p) s += 100 + 50 * (c.level - 1) + PARK_SCORE * c.parks;
      for (const t of S.players[p].techs) s += 100 * TECHS[t].tier;
      for (const u of S.units) if (u.owner === p) s += 5 * UNITS[u.type].cost;
      return s;
    }
    const templeLevel = (S, i) => Math.min(5, 1 + Math.floor(S.lvl[i] / TEMPLE_TURNS));
    function refreshScores(S) { for (const pl of S.players) pl.score = pl.alive ? computeScore(S, pl.id) : pl.score; }

    // --------------------------------------------------------------- tasks
    function checkTasks(S, p) {
      const pl = S.players[p];
      if (!pl || !pl.alive) return;
      const done = (id) => { if (!pl.tasks[id]) { pl.tasks[id] = S.turn; emit(S, { t: "task", p, id }); } };
      if (pl.techs.length >= TECH_IDS.length) done("wisdom");
      if (pl.kills >= 10) done("power");
      if (pl.stars >= 100) done("tomb");
      if (!pl.tasks.bazaar && connectedCities(S, p).length >= 5) done("bazaar");
      if (S.cities.some((c) => c.owner === p && c.level >= 5)) done("fortune");
      if (S.players.length > 1 && pl.met.length >= S.players.length - 1) done("eye");
      if (pl.metTurn && S.turn - Math.max(pl.metTurn, pl.lastAttackTurn) >= 5) done("peace");
    }

    // ---------------------------------------------------------- turn flow
    function startTurn(S, p) {
      const pl = S.players[p];
      pl.attackedThisTurn = false;
      const inc = S.turn === 1 ? 0 : playerIncome(S, p);   // turn one is played on the starting stars
      pl.stars += inc;
      for (const u of S.units) if (u.owner === p) { u.moved = false; u.attacked = false; }
      for (let i = 0; i < S.terr.length; i++) {
        if (tilePlayer(S, i) !== p) continue;
        if (BLD[S.bld[i]] && BLD[S.bld[i]].temple && S.lvl[i] < TEMPLE_TURNS * 4) S.lvl[i]++;
      }
      updateConnections(S, p);
      checkTasks(S, p);
      emit(S, { t: "turnStart", p, income: inc });
    }
    function checkVictory(S) {
      const alive = alivePlayers(S);
      const humans = S.players.filter((pl) => pl.human);
      refreshScores(S);
      const finish = (w) => { S.over = true; S.winner = w; emit(S, { t: "over", winner: w }); };
      if (!alive.length) return finish(-1);
      if (humans.length && !humans.some((h) => h.alive)) {
        return finish(alive.slice().sort((a, b) => b.score - a.score)[0].id);
      }
      if (alive.length === 1 && S.players.length > 1) return finish(alive[0].id);
      if (S.mode === "might") {
        const caps = S.cities.filter((c) => c.capital);
        for (const pl of alive) if (caps.every((c) => c.owner === pl.id)) return finish(pl.id);
      }
      if (S.mode === "glory") {
        const top = alive.slice().sort((a, b) => b.score - a.score)[0];
        if (top.score >= GLORY_SCORE) return finish(top.id);
      }
      // Perfection ends at its turn limit; the other modes carry a long cap so
      // two tribes that can never reach each other still get a result.
      if (S.turn > S.turnLimit) {
        const top = alive.slice().sort((a, b) => b.score - a.score)[0];
        return finish(top.id);
      }
      return false;
    }
    function endTurn(S) {
      if (S.over) return;
      const p = S.cur;
      // Rewards the player never chose are decided for them.
      let r;
      while ((r = pendingRewardFor(S, p))) applyReward(S, S.cities[r.city], aiPickReward(S, S.cities[r.city], r.level));
      checkTasks(S, p);
      emit(S, { t: "turnEnd", p });
      if (checkVictory(S)) return;
      let next = -1;
      for (let k = 1; k <= S.players.length; k++) {
        const q = (p + k) % S.players.length;
        if (S.players[q].alive) { next = q; break; }
      }
      if (next < 0) { checkVictory(S); return; }
      if (next <= p) S.turn++;
      S.cur = next;
      if (S.turn > S.turnLimit) { checkVictory(S); return; }
      startTurn(S, next);
    }
    function firstTurn(S) {
      startTurn(S, S.cur);
    }

    // ====================================================================== //
    // 5. The computer tribes                                                 //
    // ====================================================================== //
    // One turn of a bot: decide every unit's move and attack, then spend stars
    // on whatever buys the most for the least — population, a technology that
    // unlocks resources already inside its borders, or a unit when something
    // is coming. Difficulty is a bonus income and a "sloppiness": the chance a
    // decision is skipped or made at random. Everything random goes through
    // the game's own generator so a resumed game plays on identically.

    function enemyNear(S, p, x, y, r) {
      const pl = S.players[p];
      for (const u of S.units) {
        if (u.owner === p || u.dead) continue;
        if (cheb(u.x, u.y, x, y) <= r && pl.explored[tIdx(S, u.x, u.y)]) return u;
      }
      return null;
    }

    function aiPickReward(S, c, level) {
      const p = c.owner;
      const dice = gameRng(S);
      const threat = !!enemyNear(S, p, c.x, c.y, 3);
      let pick;
      switch (Math.min(5, level)) {
        case 2: pick = (S.turn <= 6 && dice.rng() < 0.35) ? "explorer" : "workshop"; break;
        case 3: pick = (threat || (c.capital && S.mode !== "perfection" && S.turn > 8)) ? "walls" : "resources"; break;
        case 4: {
          let gain = 0;
          for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
            if (Math.max(Math.abs(dx), Math.abs(dy)) !== 2) continue;
            const x = c.x + dx, y = c.y + dy;
            if (!inBounds(S, x, y)) continue;
            const i = tIdx(S, x, y);
            if (S.terr[i] >= 0) continue;
            gain += S.res[i] ? 1.5 : (isWater(S.terrain[i]) ? 0.3 : 0.8);
          }
          pick = gain >= 4 ? "border" : "popgrowth";
          break;
        }
        default: {
          const war = S.mode === "domination" || S.mode === "might" || threat;
          pick = war || (S.players[p].met.length && dice.rng() < 0.4) ? "superunit" : "park";
          if (pick === "superunit" && unitAt(S, c.x, c.y) && !freeNeighbour(S, c.x, c.y)) pick = "park";
        }
      }
      dice.done();
      return pick;
    }
    function freeNeighbour(S, x, y) {
      for (const d of DIRS8) {
        const xx = x + d[0], yy = y + d[1];
        if (inBounds(S, xx, yy) && !isWater(S.terrain[tIdx(S, xx, yy)]) && S.terrain[tIdx(S, xx, yy)] !== MOUNTAIN && !unitAt(S, xx, yy)) return true;
      }
      return false;
    }

    // Breadth-first distances for a unit, ignoring other units. Land units may
    // board at friendly ports and sail on; boats may land anywhere they could
    // stand. Returns Int16Array, -1 where unreachable.
    function distMap(S, u, fromIdx) {
      const n = S.n, N = n * n;
      const dist = new Int16Array(N).fill(-1);
      const p = u.owner;
      const nav = hasTech(S, p, "navigation"), climb = hasTech(S, p, "climbing");
      const okLand = (j) => S.terrain[j] !== MOUNTAIN || climb;
      const okWater = (j) => S.terrain[j] === SHALLOW || nav;
      const q = [fromIdx];
      dist[fromIdx] = 0;
      let head = 0;
      while (head < q.length) {
        const i = q[head++];
        const x = i % n, y = (i - x) / n;
        const onWater = isWater(S.terrain[i]);
        for (const d of DIRS8) {
          const xx = x + d[0], yy = y + d[1];
          if (xx < 0 || yy < 0 || xx >= n || yy >= n) continue;
          const j = yy * n + xx;
          if (dist[j] >= 0) continue;
          const w = isWater(S.terrain[j]);
          let ok;
          if (!w) ok = okLand(j);
          else if (onWater) ok = okWater(j);
          else ok = S.bld[j] === B_PORT && tilePlayer(S, j) === p;
          if (!ok) continue;
          dist[j] = dist[i] + 1;
          q.push(j);
        }
      }
      return dist;
    }

    // How hard the enemies that could reach tile i next turn would hit u there.
    function threatAt(S, u, i) {
      const x = i % S.n, y = (i - x) / S.n;
      let dmg = 0;
      const us = unitStats(u);
      const myDef = us.def * defenceBonusAt(S, u, i);
      for (const e of S.units) {
        if (e.owner === u.owner || e.dead) continue;
        const es = unitStats(e);
        if (cheb(e.x, e.y, x, y) > es.mv + es.rng) continue;
        if (es.atk <= 0) continue;
        const af = es.atk * (e.hp / maxHp(e));
        const df = myDef * (u.hp / maxHp(u));
        const tot = af + df;
        if (tot > 0) dmg += Math.round((af / tot) * es.atk * 4.5);
      }
      return dmg;
    }
    function defenceBonusAt(S, u, i) {
      const c = S.center[i] >= 0 ? S.cities[S.center[i]] : null;
      if (c && c.owner === u.owner && !u.boat && hasSkill(u.type, "fortify")) return c.walls ? 4 : 1.5;
      const t = S.terrain[i];
      if (t === FOREST && hasTech(S, u.owner, "archery")) return 1.5;
      if (t === MOUNTAIN && hasTech(S, u.owner, "meditation")) return 1.5;
      if (isWater(t) && hasTech(S, u.owner, "aquatism")) return 1.5;
      return 1;
    }

    function attackScore(S, u, d, pre) {
      let s = pre.toD * 1.1 - pre.toA * 1.0;
      if (pre.killed) s += 14 + UNITS[d.type].cost * 2 + (UNITS[d.type].superUnit ? 20 : 0);
      // Friends already pressing the same target make a trade worth taking.
      let allies = 0;
      for (const v of S.units) if (v.owner === u.owner && v !== u && !v.dead && cheb(v.x, v.y, d.x, d.y) <= 2) allies++;
      s += Math.min(4, allies) * 2.5;
      if (pre.aKilled) s -= (allies >= 2 ? 12 : 30) + UNITS[u.type].cost * (allies >= 2 ? 1 : 3);
      const dc = cityAt(S, d.x, d.y);
      if (dc && dc.owner === u.owner) s += 12;           // throw them out of our city
      if (dc && dc.owner === d.owner) s += 9 + (S.mode === "domination" || S.mode === "might" ? 6 : 0);   // the garrison is the prize
      return s;
    }
    function bestAttack(S, u) {
      let best = null;
      for (const d of attackTargets(S, u)) {
        const pre = predictCombat(S, u, d);
        const sc = attackScore(S, u, d, pre);
        if (!best || sc > best.score) best = { d, score: sc, pre };
      }
      return best;
    }
    // Attack options if u stood on tile i (used to rank dash destinations).
    function bestAttackFrom(S, u, i) {
      const x = i % S.n, y = (i - x) / S.n;
      const r = unitStats(u).rng;
      const pl = S.players[u.owner];
      let best = 0;
      for (const d of S.units) {
        if (d.owner === u.owner || d.dead) continue;
        if (cheb(x, y, d.x, d.y) > r) continue;
        if (!pl.explored[tIdx(S, d.x, d.y)]) continue;
        const sx = u.x, sy = u.y;
        u.x = x; u.y = y;
        const pre = predictCombat(S, u, d);
        u.x = sx; u.y = sy;
        const sc = attackScore(S, u, d, pre);
        if (sc > best) best = sc;
      }
      return best;
    }

    function chooseGoal(S, u, A) {
      const p = u.owner;
      const pl = S.players[p];
      const dist = distMap(S, u, tIdx(S, u.x, u.y));
      const aggressive = (S.mode === "domination" || S.mode === "might" ? 18 : 0) + (A.diff.id === "hard" ? 6 : A.diff.id === "crazy" ? 14 : 0);
      let best = null;
      const consider = (i, val, kind) => {
        if (A.reserved.has(i)) return;
        if (!best || val > best.val) best = { i, val, kind };
      };
      for (const c of S.cities) {
        const i = tIdx(S, c.x, c.y);
        const d = dist[i];
        if (d < 0 || !pl.explored[i]) continue;
        if (c.owner === -1) consider(i, 72 - 3.2 * d, "village");
        else if (c.owner !== p) {
          const guard = unitAt(S, c.x, c.y);
          const weak = !guard || guard.hp <= 5;
          const myStrength = unitStats(u).atk * (u.hp / maxHp(u));
          consider(i, 22 + aggressive - 3 * d + (weak ? 16 : -12) + myStrength * 2 + (c.capital ? (S.mode === "might" ? 24 : 6) : 0), "enemyCity");
        } else if (!unitAt(S, c.x, c.y) && enemyNear(S, p, c.x, c.y, 2) && d <= 5) {
          consider(i, 58 - 4 * d + (c.capital ? 8 : 0), "defend");
        }
      }
      for (let i = 0; i < dist.length; i++) {
        if (dist[i] < 0 || !pl.explored[i]) continue;
        if (S.bld[i] === B_RUIN && !unitAt(S, i % S.n, (i - (i % S.n)) / S.n)) consider(i, 50 - 3 * dist[i], "ruin");
      }
      for (const e of S.units) {
        if (e.owner === p || e.dead) continue;
        const i = tIdx(S, e.x, e.y);
        if (!pl.explored[i] || dist[i] < 0 || dist[i] > 4) continue;
        const pre = predictCombat(S, u, e);
        const win = pre.toD >= pre.toA && !pre.aKilled;
        consider(i, 18 - 4 * dist[i] + (win ? 10 : -18) + (pre.killed ? 8 : 0), "hunt");
      }
      // Exploring: the closest tile that still borders the unknown.
      let bestExplore = null;
      for (let i = 0; i < dist.length; i++) {
        if (dist[i] < 0 || !pl.explored[i]) continue;
        const x = i % S.n, y = (i - x) / S.n;
        let edge = false;
        for (const d of DIRS8) {
          const xx = x + d[0], yy = y + d[1];
          if (inBounds(S, xx, yy) && !pl.explored[tIdx(S, xx, yy)]) { edge = true; break; }
        }
        if (!edge) continue;
        const val = 14 - 1.6 * dist[i] + (S.turn < 8 ? 6 : 0);
        if (!bestExplore || val > bestExplore.val) bestExplore = { i, val };
      }
      if (bestExplore) consider(bestExplore.i, bestExplore.val, "explore");
      if (best && (best.kind === "village" || best.kind === "ruin" || best.kind === "defend")) A.reserved.add(best.i);
      return best;
    }

    function aiMoveUnit(S, u, A) {
      if (u.dead || u.moved) return;
      const reach = reachable(S, u);
      if (!reach.size) return;
      const goal = chooseGoal(S, u, A);
      const distGoal = goal ? distMap(S, u, goal.i) : null;
      const here = tIdx(S, u.x, u.y);
      const dash = canDash(u);
      const hurt = u.hp < maxHp(u) * 0.5;
      const evalAt = (i, isStay) => {
        let v = 0;
        if (distGoal) {
          const dg = distGoal[i];
          v += dg < 0 ? -40 : -3.2 * dg;
          if (i === goal.i) v += goal.kind === "village" || goal.kind === "enemyCity" ? 40 : 20;
        }
        const th = threatAt(S, u, i);
        if (th >= u.hp) v -= hurt ? 45 : 30;
        else v -= th * (hurt ? 1.4 : 0.6);
        if (th > 0) v += (defenceBonusAt(S, u, i) - 1) * 10;
        if (dash && !u.attacked) v += bestAttackFrom(S, u, i) * 0.9;
        if (!isStay) v -= 0.5;
        v += A.rng() * 1.5;
        return v;
      };
      let bestI = null, bestV = evalAt(here, true);
      const canCap = canCapture(S, u) || (cityAt(S, u.x, u.y) && cityAt(S, u.x, u.y).owner !== u.owner);
      if (canCap) bestV += 60;   // already standing on a prize: stay and take it
      if (A.sloppy()) {
        const keys = Array.from(reach.keys());
        bestI = keys[A.rng.int(keys.length)];
      } else {
        for (const i of reach.keys()) {
          const v = evalAt(i, false);
          if (v > bestV) { bestV = v; bestI = i; }
        }
      }
      if (bestI != null) moveUnit(S, u, bestI, pathTo(reach, bestI));
    }

    function aiUnitTurn(S, u, A) {
      if (u.dead) return;
      if (canPromote(u)) promote(S, u);
      if (canCapture(S, u)) { captureCity(S, u); return; }
      if (canExamine(S, u)) { examineRuins(S, u); return; }
      if (!u.boat && hasSkill(u.type, "convert")) {
        const ts = convertTargets(S, u);
        if (ts.length) { ts.sort((a, b) => UNITS[b.type].cost - UNITS[a.type].cost); convertUnit(S, u, ts[0]); return; }
        if (canHeal(S, u)) { healOthers(S, u); return; }
      }
      // Strike first when the shot is good or the unit cannot shoot after moving.
      let b = bestAttack(S, u);
      if (b && !A.sloppy() && (b.score >= 4 || (!canDash(u) && b.score > -2))) {
        attack(S, u, b.d);
        if (u.dead) return;
        while (!u.attacked && !u.boat && hasSkill(u.type, "persist")) {
          b = bestAttack(S, u);
          if (!b || b.score < 0) break;
          attack(S, u, b.d);
          if (u.dead) return;
        }
      }
      if (!u.moved) aiMoveUnit(S, u, A);
      if (u.dead) return;
      if (!u.attacked && canDash(u)) {
        b = bestAttack(S, u);
        if (b && b.score >= 2 && !A.sloppy()) {
          attack(S, u, b.d);
          if (u.dead) return;
          while (!u.attacked && !u.boat && hasSkill(u.type, "persist")) {
            b = bestAttack(S, u);
            if (!b || b.score < 0) break;
            attack(S, u, b.d);
            if (u.dead) return;
          }
        }
      }
      if (canExamine(S, u)) { examineRuins(S, u); return; }
      if (canRecover(S, u) && u.hp <= maxHp(u) * 0.75) recover(S, u);
    }

    // ------------------------------------------------------------ economy
    function countInTerritory(S, p, fn) {
      let k = 0;
      for (let i = 0; i < S.terr.length; i++) if (tilePlayer(S, i) === p && fn(i)) k++;
      return k;
    }
    function techValue(S, p, t) {
      const pl = S.players[p];
      const threat = S.cities.some((c) => c.owner === p && enemyNear(S, p, c.x, c.y, 3));
      const met = pl.met.length > 0;
      const war = S.mode === "domination" || S.mode === "might";
      const inT = (fn) => countInTerritory(S, p, fn);
      switch (t) {
        case "organization": return 0.8 + 1.1 * inT((i) => S.res[i] === R_FRUIT);
        case "hunting": return 0.8 + 1.1 * inT((i) => S.res[i] === R_ANIMAL);
        case "fishing": return 0.6 + 1.1 * inT((i) => S.res[i] === R_FISH);
        case "climbing": return 0.6 + 0.5 * inT((i) => S.terrain[i] === MOUNTAIN) + 0.8 * inT((i) => S.res[i] === R_METAL);
        case "riding": return 1.6 + (S.turn < 10 ? 1.2 : 0) + (war ? 1 : 0);
        case "farming": return 0.6 + 1.6 * inT((i) => S.res[i] === R_CROP);
        case "mining": return 0.6 + 1.6 * inT((i) => S.res[i] === R_METAL);
        case "forestry": return 0.5 + 0.8 * inT((i) => S.terrain[i] === FOREST && S.res[i] === R_NONE && S.bld[i] === B_NONE);
        case "sailing": return 0.4 + 0.9 * Math.min(4, inT((i) => S.terrain[i] === SHALLOW && S.bld[i] === B_NONE));
        case "whaling": { let w = 0; for (let i = 0; i < S.res.length; i++) if (S.res[i] === R_WHALE && pl.explored[i]) w++; return 0.4 + 2.2 * w; }
        case "archery": return 1.4 + (threat || met ? 2.2 : 0.4);
        case "shields": return 0.8 + (threat ? 2.6 : 0.3);
        case "roads": return 0.3 + 0.8 * Math.max(0, numCities(S, p) - 1);
        case "free_spirit": return 0.6 + (pl.stars > 30 ? 1.2 : 0);
        case "meditation": return 0.6 + 0.6 * inT((i) => S.terrain[i] === MOUNTAIN) + (threat ? 0.5 : 0);
        case "smithery": return 1.2 + 1.4 * inT((i) => S.bld[i] === B_MINE) + (threat || met ? 2.5 : 0.6);
        case "chivalry": return 1.2 + (threat || met ? 2.2 : 0.6) + (war ? 1.2 : 0);
        case "construction": return 0.5 + 0.9 * inT((i) => S.bld[i] === B_FARM);
        case "mathematics": return 0.9 + 0.9 * inT((i) => S.bld[i] === B_LUMBER) + (threat || met ? 1.2 : 0.2);
        case "philosophy": return 0.8 + 0.25 * (TECH_IDS.length - pl.techs.length) * (S.turn < 18 ? 1 : 0.4);
        case "navigation": return 0.5 + (S.mapType === "archipelago" || S.mapType === "waterworld" ? 2.2 : 0.3) + 0.3 * inT((i) => S.bld[i] === B_PORT);
        case "trade": return 0.4 + 1.3 * inT((i) => S.bld[i] === B_PORT);
        case "aquatism": return 0.5 + 0.4 * inT((i) => isWater(S.terrain[i]));
        case "spiritualism": return 0.6 + (S.mode === "perfection" && S.turn > 15 ? 1.0 : 0.2);
        default: return 0.5;
      }
    }
    function unitNeed(S, p, c, type, A) {
      const threat = enemyNear(S, p, c.x, c.y, 3);
      const met = S.players[p].met.length > 0;
      const mine = S.units.filter((u) => u.owner === p).length;
      let base = 0.55;
      if (threat) base = 2.6;
      else if (S.turn < 10 && mine < numCities(S, p) + 1) base = 1.5;
      else if (met && mine < numCities(S, p) * 1.5) base = 1.0;
      else if (S.mode === "domination" || S.mode === "might") base = 0.9;
      const d = UNITS[type];
      let fit = 1;
      if (threat) fit = type === "defender" ? 1.6 : type === "swordsman" ? 1.5 : type === "archer" ? 1.3 : type === "knight" ? 1.2 : type === "catapult" ? 0.8 : type === "mindbender" ? 0.3 : 1;
      else fit = type === "rider" ? 1.5 : type === "knight" ? 1.3 : type === "swordsman" ? 1.2 : type === "archer" ? 1.1 : type === "defender" ? 0.6 : type === "catapult" ? 0.7 : type === "mindbender" ? 0.4 : 1;
      if (type === "catapult" && S.cities.some((e) => e.owner >= 0 && e.owner !== p && e.walls && S.players[p].explored[tIdx(S, e.x, e.y)] && cheb(e.x, e.y, c.x, c.y) <= 7)) fit = Math.max(fit, 1.7);
      if (!unitAt(S, c.x, c.y) && (threat || (met && c.capital))) base += 0.8;
      return base * fit * (1 + d.cost * 0.08);
    }

    function aiEconomy(S, p, A) {
      const pl = S.players[p];
      const drain = () => { let r; while ((r = pendingRewardFor(S, p))) applyReward(S, S.cities[r.city], aiPickReward(S, S.cities[r.city], r.level)); };
      drain();
      for (let iter = 0; iter < 40 && !S.over; iter++) {
        const opts = [];
        const want = (kind, cost, value, data) => { if (cost <= pl.stars) opts.push({ kind, cost, value: value / Math.max(0.6, cost), data }); };
        for (const t of TECH_IDS) if (techAvailable(S, p, t)) want("tech", techCost(S, p, t), techValue(S, p, t), t);
        for (const c of S.cities) {
          if (c.owner !== p) continue;
          const need = c.level + 1 - c.pop;          // pop to the next level
          for (let i = 0; i < S.terr.length; i++) {
            if (S.terr[i] !== c.id) continue;
            const x = i % S.n, y = (i - x) / S.n;
            for (const a of tileActions(S, p, x, y)) {
              if (!a.can) continue;
              let v = 0;
              if (a.pop) v += a.pop * (a.pop >= need ? 1.25 : 1) * (c.level >= 6 ? 0.8 : 1);
              if (a.stars) v += a.stars * 0.5;
              if (a.id === "road") {
                v += roadValue(S, p, x, y);
              } else if (a.id === "bridge") v += 0.4;
              if (a.id === "burn") v += 0.3;
              if (a.id === "grow") v += S.mode === "perfection" && pl.stars > 25 ? 0.6 : 0;
              if (a.bld && BLD[a.bld].temple) v += S.mode === "perfection" || S.mode === "glory" ? (S.turn > 12 ? 2.4 : 0.8) : 0.5;
              if (a.monument != null) v += 6;
              if (v <= 0) continue;
              want("tile", a.cost, v, { x, y, id: a.id });
            }
          }
          for (const type of TRAINABLE) {
            if (canTrain(S, c, type) !== "ok") continue;
            want("train", UNITS[type].cost, unitNeed(S, p, c, type, A), { c, type });
          }
        }
        for (const u of S.units) {
          if (u.owner !== p || !u.boat) continue;
          for (const b of boatUpgrades(S, u)) if (b.can) want("boat", b.cost, b.kind === 3 ? 3.5 : 1.6, { u, kind: b.kind });
        }
        if (!opts.length) break;
        opts.sort((a, b) => b.value - a.value);
        let pick = opts[0];
        if (A.sloppy()) pick = opts[A.rng.int(Math.min(opts.length, 4))];
        if (pick.value < 0.08) break;
        if (pick.kind === "tech") research(S, p, pick.data);
        else if (pick.kind === "tile") doTileAction(S, p, pick.data.x, pick.data.y, pick.data.id);
        else if (pick.kind === "train") trainUnit(S, pick.data.c, pick.data.type);
        else if (pick.kind === "boat") upgradeBoat(S, pick.data.u, pick.data.kind);
        drain();
      }
    }
    // A road is worth building when it lies between two of our cities.
    function roadValue(S, p, x, y) {
      const own = S.cities.filter((c) => c.owner === p);
      if (own.length < 2) return 0;
      let best = 0;
      for (let a = 0; a < own.length; a++) for (let b = a + 1; b < own.length; b++) {
        const A = own[a], B = own[b];
        const d = cheb(A.x, A.y, B.x, B.y);
        if (d > 6) continue;
        const onPath = cheb(A.x, A.y, x, y) + cheb(x, y, B.x, B.y) <= d + 0.5;
        if (onPath) best = Math.max(best, (A.connected || A.capital) && !B.connected ? 1.3 : (!A.connected || !B.connected) ? 0.9 : 0.2);
      }
      return best;
    }

    function aiTurn(S, p) {
      const pl = S.players[p];
      if (!pl.alive || S.over) return;
      const dice = gameRng(S);
      const diff = diffById(pl.ai || "normal");
      const A = { rng: dice.rng, diff, reserved: new Set(), sloppy: () => dice.rng() < diff.sloppy };
      // Buy before moving so fresh walls and units count, then again after.
      aiEconomy(S, p, A);
      const mine = S.units.filter((u) => u.owner === p && !u.dead);
      // Strong units act first so weak ones can follow into cleared tiles.
      mine.sort((a, b) => unitStats(b).atk - unitStats(a).atk);
      for (const u of mine) if (!u.dead && !S.over) aiUnitTurn(S, u, A);
      aiEconomy(S, p, A);
      dice.done();
    }

    // ====================================================================== //
    // 6. Saving and loading                                                  //
    // ====================================================================== //
    // The whole game packs into a small JSON object: every per-tile layer is a
    // string with one character per tile, fog is a bit string, and units,
    // cities and players are short arrays. A 16x16 game is about four
    // kilobytes, which fits the 8 KB Continue Playing budget; bigger maps go
    // to viewer storage with a pointer left in Continue Playing.

    const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    const B64_INDEX = {};
    for (let i = 0; i < 64; i++) B64_INDEX[B64[i]] = i;

    function packSmall(arr) {          // values 0..63, one char each
      let s = "";
      for (let i = 0; i < arr.length; i++) s += B64[arr[i] & 63];
      return s;
    }
    function unpackSmall(s, len, Ctor) {
      const out = new (Ctor || Uint8Array)(len);
      for (let i = 0; i < len && i < s.length; i++) out[i] = B64_INDEX[s[i]] || 0;
      return out;
    }
    function packBits(arr) {
      let s = "";
      for (let i = 0; i < arr.length; i += 6) {
        let v = 0;
        for (let k = 0; k < 6; k++) if (arr[i + k]) v |= 1 << k;
        s += B64[v];
      }
      return s;
    }
    function unpackBits(s, len) {
      const out = new Uint8Array(len);
      for (let i = 0; i < s.length; i++) {
        const v = B64_INDEX[s[i]] || 0;
        for (let k = 0; k < 6; k++) if (i * 6 + k < len) out[i * 6 + k] = (v >> k) & 1;
      }
      return out;
    }
    // Territory: city index per tile, -1 for none. One char when the city count
    // allows it, two otherwise.
    function packTerr(terr) {
      let max = 0;
      for (let i = 0; i < terr.length; i++) if (terr[i] > max) max = terr[i];
      const wide = max >= 63;
      let s = wide ? "2" : "1";
      for (let i = 0; i < terr.length; i++) {
        const v = terr[i] < 0 ? (wide ? 4095 : 63) : terr[i];
        s += wide ? B64[(v >> 6) & 63] + B64[v & 63] : B64[v & 63];
      }
      return s;
    }
    function unpackTerr(s, len) {
      const out = new Int16Array(len);
      const wide = s[0] === "2";
      for (let i = 0; i < len; i++) {
        let v;
        if (wide) v = (B64_INDEX[s[1 + i * 2]] << 6) | B64_INDEX[s[2 + i * 2]];
        else v = B64_INDEX[s[1 + i]];
        out[i] = (wide ? v === 4095 : v === 63) ? -1 : v;
      }
      return out;
    }

    function serialize(S) {
      return {
        v: 1, seed: S.seed, n: S.n, mapType: S.mapType, mode: S.mode, turnLimit: S.turnLimit,
        turn: S.turn, cur: S.cur, over: S.over, winner: S.winner, rngState: S.rngState, nextUnitId: S.nextUnitId,
        terrain: packSmall(S.terrain), res: packSmall(S.res), bld: packSmall(S.bld), lvl: packSmall(S.lvl),
        road: packBits(S.road), terr: packTerr(S.terr), biome: packSmall(S.biome),
        cities: S.cities.map((c) => [c.x, c.y, c.owner, c.level, c.pop, c.capital ? 1 : 0, c.walls ? 1 : 0, c.workshop,
          c.border, c.parks, c.connected ? 1 : 0, c.rewards, c.name]),
        units: S.units.map((u) => [u.id, UNIT_IDS.indexOf(u.type), u.owner, u.x, u.y, u.hp, u.moved ? 1 : 0, u.attacked ? 1 : 0,
          u.home, u.boat, u.kills, u.vet ? 1 : 0]),
        players: S.players.map((pl) => ({
          tribe: pl.tribe, human: pl.human ? 1 : 0, ai: pl.ai, stars: pl.stars,
          techs: pl.techs.map((t) => TECH_IDS.indexOf(t)), alive: pl.alive ? 1 : 0, kills: pl.kills, lost: pl.lost,
          explored: packBits(pl.explored), met: pl.met, tasks: pl.tasks, built: pl.built,
          lastAttackTurn: pl.lastAttackTurn, metTurn: pl.metTurn, score: pl.score
        })),
        pending: S.pendingRewards.map((r) => [r.city, r.level])
      };
    }

    function deserialize(o) {
      if (!o || o.v !== 1 || !o.n || !o.terrain) return null;
      const n = o.n, N = n * n;
      const S = {
        v: 1, seed: o.seed >>> 0, n, mapType: o.mapType, mode: o.mode, turnLimit: o.turnLimit,
        turn: o.turn, cur: o.cur, over: !!o.over, winner: o.winner, rngState: o.rngState >>> 0, nextUnitId: o.nextUnitId,
        terrain: unpackSmall(o.terrain, N), res: unpackSmall(o.res, N), bld: unpackSmall(o.bld, N), lvl: unpackSmall(o.lvl, N),
        road: unpackBits(o.road, N), terr: unpackTerr(o.terr, N), biome: unpackSmall(o.biome, N),
        center: new Int16Array(N).fill(-1), cities: [], units: [], players: [], pendingRewards: [], events: [], uAt: null
      };
      o.cities.forEach((c, id) => {
        S.cities.push({ id, x: c[0], y: c[1], owner: c[2], level: c[3], pop: c[4], capital: !!c[5], walls: !!c[6], workshop: c[7],
          border: c[8], parks: c[9], connected: !!c[10], rewards: c[11], name: c[12] });
        S.center[c[1] * n + c[0]] = id;
      });
      for (const u of o.units) {
        S.units.push({ id: u[0], type: UNIT_IDS[u[1]], owner: u[2], x: u[3], y: u[4], hp: u[5], moved: !!u[6], attacked: !!u[7],
          home: u[8], boat: u[9], kills: u[10], vet: !!u[11] });
      }
      o.players.forEach((pl, id) => {
        S.players.push({
          id, tribe: pl.tribe, human: !!pl.human, ai: pl.ai, stars: pl.stars, techs: pl.techs.map((k) => TECH_IDS[k]),
          alive: !!pl.alive, kills: pl.kills, lost: pl.lost, explored: unpackBits(pl.explored, N), met: pl.met || [],
          tasks: pl.tasks || {}, built: pl.built || {}, lastAttackTurn: pl.lastAttackTurn || 0, metTurn: pl.metTurn || 0,
          score: pl.score || 0, attackedThisTurn: false
        });
      });
      S.pendingRewards = (o.pending || []).map((r) => ({ city: r[0], level: r[1] }));
      rebuildUnitMap(S);
      return S;
    }

    // ====================================================================== //
    // 7. Surfaces, camera and the isometric renderer                         //
    // ====================================================================== //
    const FONT = "-apple-system,system-ui,'Segoe UI',Roboto,sans-serif";
    const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    const haptic = (kind) => { if (!ctx.capabilities.haptics) return; try { ctx.platform.haptic(kind); } catch (_) {} };
    const sa = ctx.safeArea || { top: 0, bottom: 0, left: 0, right: 0 };
    // Runtime calls that may return nothing, a promise, or throw: never chain on them.
    function fireAndForget(thunk) {
      try { const r = thunk(); if (r && typeof r.catch === "function") r.catch(() => {}); } catch (_) { /* unsupported here */ }
    }
    function tune(id, dflt) {
      try { const knob = ctx.tune && ctx.tune.get ? ctx.tune.get(id) : undefined; return knob === undefined || knob === null ? dflt : knob; }
      catch (_) { return dflt; }
    }
    let ANIM_SPEED = clamp(Number(tune("anim_speed", 1)) || 1, 0.4, 2.5);

    // A high-resolution backing store in CSS coordinates: everything here draws
    // in ctx.width/ctx.height pixels, which is exactly the opt-in the SDK asks for.
    const canvas = ctx.createCanvas2D({ touchAction: "none", maxDpr: 3, coordinateSpace: "css" });
    let ART_T = 0;                // seconds, for the small ambient motions
    const g = canvas.getContext("2d");
    // Older WebViews have no roundRect; give this context one.
    if (typeof g.roundRect !== "function") {
      g.roundRect = function (x, y, w, h, r) {
        const rr = Math.min(r || 0, w / 2, h / 2);
        this.moveTo(x + rr, y);
        this.arcTo(x + w, y, x + w, y + h, rr);
        this.arcTo(x + w, y + h, x, y + h, rr);
        this.arcTo(x, y + h, x, y, rr);
        this.arcTo(x, y, x + w, y, rr);
        this.closePath();
      };
    }
    const ui = ctx.createRoot({ touchAction: "none", style: "pointer-events:none;font-family:" + FONT + ";color:#f3efe6;" });

    // ---- Camera. World units are CSS pixels at zoom 1; tiles are 2:1 diamonds.
    const TW = 76, TH = 38;
    const cam = { x: 0, y: 0, z: 1, tx: null, ty: null, tz: null, t: 0, dur: 0, fx: 0, fy: 0, fz: 1 };
    const W = () => ctx.width, H = () => ctx.height;
    const toScreen = (tx, ty) => [W() / 2 + ((tx - ty) * (TW / 2) - cam.x) * cam.z, H() / 2 + ((tx + ty) * (TH / 2) - cam.y) * cam.z];
    function toTile(sx, sy) {
      const u = (sx - W() / 2) / cam.z + cam.x, v = (sy - H() / 2) / cam.z + cam.y;
      return [Math.round(u / TW + v / TH), Math.round(v / TH - u / TW)];
    }
    function centerOn(tx, ty, zoom) {
      cam.x = (tx - ty) * (TW / 2);
      cam.y = (tx + ty) * (TH / 2);
      cam.tx = null;
      if (zoom) cam.z = zoom;
    }
    // Glide the camera to a tile over a few hundred milliseconds.
    function panTo(tx, ty, zoom, ms) {
      cam.fx = cam.x; cam.fy = cam.y; cam.fz = cam.z;
      cam.tx = (tx - ty) * (TW / 2); cam.ty = (tx + ty) * (TH / 2); cam.tz = zoom || cam.z;
      cam.t = 0; cam.dur = ms || 420;
    }
    function tickCamera(dt) {
      if (cam.tx == null) return false;
      cam.t += dt;
      const k = clamp(cam.t / cam.dur, 0, 1);
      const e = 1 - Math.pow(1 - k, 3);
      cam.x = lerp(cam.fx, cam.tx, e); cam.y = lerp(cam.fy, cam.ty, e); cam.z = lerp(cam.fz, cam.tz, e);
      if (k >= 1) cam.tx = null;
      return true;
    }
    function clampCamera() {
      if (!S) return;
      const n = S.n;
      const lim = n * TW * 0.55;
      cam.x = clamp(cam.x, -lim, lim);
      cam.y = clamp(cam.y, -TH, n * TH + TH);
      cam.z = clamp(cam.z, 0.42, 2.8);
    }

    // ---- UI state
    let S = null;                 // the game
    const V = {                   // what is on screen
      screen: "menu",             // menu | play | over
      viewer: 0,                  // player whose fog we draw; -1 for none
      sel: null,                  // selected unit
      selTile: -1,                // selected tile index
      reach: null, targets: [], converts: [],
      panel: null,                // open modal name
      replay: [], replayT: 0,     // event scenes waiting to play
      busy: false,                // AI thinking or scenes playing
      floats: [],                 // rising texts
      vis: new Map(),             // unit id -> {x, y} display override
      ghosts: new Map(),          // units that died this turn but are still being drawn
      flash: new Map(),           // unit id -> ms of hit flash
      hideMap: false, dirty: true, demo: false, demoT: 0,
      toastT: 0, started: false, soundOn: true, lastSave: 0, rev: 0
    };
    const curPlayer = () => (S ? S.players[S.cur] : null);
    const isHumanTurn = () => !!(S && !S.over && curPlayer().human && !V.busy && !V.hideMap);
    const viewerExplored = (i) => V.viewer < 0 || !S || !S.players[V.viewer] || !!S.players[V.viewer].explored[i];

    // ====================================================================== //
    // Drawing helpers                                                        //
    // ====================================================================== //
    function diamond(cx, cy, hw, hh) {
      g.beginPath();
      g.moveTo(cx, cy - hh); g.lineTo(cx + hw, cy); g.lineTo(cx, cy + hh); g.lineTo(cx - hw, cy);
      g.closePath();
    }
    function shade(hex, k) {        // darken (k<1) or lighten (k>1) a #rrggbb
      const n = parseInt(hex.slice(1), 16);
      let r = (n >> 16) & 255, gg = (n >> 8) & 255, b = n & 255;
      if (k <= 1) { r = Math.round(r * k); gg = Math.round(gg * k); b = Math.round(b * k); }
      else { r = Math.round(r + (255 - r) * (k - 1)); gg = Math.round(gg + (255 - gg) * (k - 1)); b = Math.round(b + (255 - b) * (k - 1)); }
      return "rgb(" + r + "," + gg + "," + b + ")";
    }
    function rgba(hex, a) {
      const n = parseInt(hex.slice(1), 16);
      return "rgba(" + ((n >> 16) & 255) + "," + ((n >> 8) & 255) + "," + (n & 255) + "," + a + ")";
    }
    function tri(x, y, w, h, color) {
      g.fillStyle = color;
      g.beginPath(); g.moveTo(x, y - h); g.lineTo(x + w / 2, y); g.lineTo(x - w / 2, y); g.closePath(); g.fill();
    }
    function circle(x, y, r, color) {
      g.fillStyle = color; g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill();
    }
    function rect(x, y, w, h, color) { g.fillStyle = color; g.fillRect(x, y, w, h); }
    function text(s, x, y, size, color, align, weight) {
      g.font = (weight || 700) + " " + size.toFixed(1) + "px -apple-system,system-ui,sans-serif";
      g.textAlign = align || "center";
      g.textBaseline = "middle";
      g.fillStyle = color;
      g.fillText(s, x, y);
    }
    function outlinedText(s, x, y, size, color, align) {
      g.font = "800 " + size.toFixed(1) + "px -apple-system,system-ui,sans-serif";
      g.textAlign = align || "center";
      g.textBaseline = "middle";
      g.lineWidth = Math.max(2, size * 0.22);
      g.strokeStyle = "rgba(10,14,20,0.85)";
      g.lineJoin = "round";
      g.strokeText(s, x, y);
      g.fillStyle = color;
      g.fillText(s, x, y);
    }

    // ---- Tile palette: land colour comes from the tribe whose land it is.
    function tileColor(i) {
      const tr = tribeByIndex(S.biome[i]);
      const j = hash2(i % S.n, (i - (i % S.n)) / S.n);
      return shade(tr.field, 0.975 + j * 0.05);
    }

    // ====================================================================== //
    // The scene                                                              //
    // ====================================================================== //
    // The visible range of tile diagonals (tx+ty) and anti-diagonals (tx-ty),
    // from the screen corners, so the cloud sea can be drawn to the edge of
    // the screen whatever the map size. tx = (d + e) / 2, ty = (d - e) / 2.
    function visibleRange(w, h, z) {
      const u0 = (-w * 0.1 - w / 2) / z + cam.x, u1 = (w * 1.1 - w / 2) / z + cam.x;
      const v0 = (-h * 0.1 - h / 2) / z + cam.y, v1 = (h * 1.15 - h / 2) / z + cam.y;
      return { d0: Math.floor(2 * v0 / TH) - 2, d1: Math.ceil(2 * v1 / TH) + 3, e0: Math.floor(2 * u0 / TW) - 2, e1: Math.ceil(2 * u1 / TW) + 2 };
    }

    function drawScene(nowMs) {
      const w = W(), h = H();
      g.fillStyle = SEA_FLOOR;
      g.fillRect(0, 0, w, h);
      const n = S ? S.n : 0, z = cam.z;
      const hw = (TW / 2) * z, hh = (TH / 2) * z;
      const curP = S ? S.cur : -1;
      const sel = V.sel;
      const low = z < 0.62;
      const drop = WATER_DROP * z;
      const hidden = !S || V.hideMap;
      const seen = (i) => !hidden && viewerExplored(i);
      const vr = visibleRange(w, h, z);
      // Tiles off screen are skipped; the margin covers tall objects.
      const onScreen = (sx, sy) => sx > -TW * z * 1.5 && sx < w + TW * z * 1.5 && sy > -TH * z * 3 && sy < h + TH * z * 2.2;
      const at = (tx, ty) => (S && inBounds(S, tx, ty) ? ty * n + tx : -1);
      const landAt = (tx, ty) => { const j = at(tx, ty); return j >= 0 && !isWater(S.terrain[j]); };

      // Pass 0: the cloud sea under everything; the known world is drawn on
      // top of it and so becomes a hole in the clouds.
      if (!artSeaFill(w, h, z)) {
        const sea = [];
        for (let d = vr.d0; d <= vr.d1; d++) {
          const txLo = Math.ceil((d + vr.e0) / 2), txHi = Math.floor((d + vr.e1) / 2);
          for (let tx = txLo; tx <= txHi; tx++) {
            const ty = d - tx, i = at(tx, ty);
            if (i >= 0 && seen(i)) continue;
            const p = toScreen(tx, ty);
            if (onScreen(p[0], p[1])) sea.push(p[0], p[1], hash2(tx * 7 + 1, ty * 3 + 2));
          }
        }
        artSeaTiles(sea, z);
      }
      if (hidden) return;

      // Pass 1: ground. Every explored tile draws its two front faces, then
      // its top; the tiles in front cover the faces unless they sit lower
      // (water) or are unexplored, which is where the cliffs and the island's
      // edge show. The backdrop already is the floor of the cloud sea.
      for (let d = Math.max(0, vr.d0); d <= Math.min(2 * n - 2, vr.d1); d++) {
        for (let tx = Math.max(0, d - n + 1); tx <= Math.min(n - 1, d); tx++) {
          const ty = d - tx;
          const i = ty * n + tx;
          if (!seen(i)) continue;
          const p = toScreen(tx, ty);
          if (!onScreen(p[0], p[1])) continue;
          const t = S.terrain[i];
          const tr = tribeByIndex(S.biome[i]);
          if (isWater(t)) {
            artSides(p[0], p[1] + drop, z, t === OCEAN ? WATER.sideDeep : WATER.side, TILE_T - WATER_DROP, null, null);
            let coast = 0;
            if (landAt(tx - 1, ty)) coast |= 1;
            if (landAt(tx, ty - 1)) coast |= 2;
            if (landAt(tx, ty + 1)) coast |= 4;
            if (landAt(tx + 1, ty)) coast |= 8;
            artWaterTop(p[0], p[1] + drop, z, t === OCEAN, coast, hash2(tx + 7, ty + 3));
          } else {
            const col = tileColor(i);
            const wL = at(tx, ty + 1) >= 0 && isWater(S.terrain[at(tx, ty + 1)]);
            const wR = at(tx + 1, ty) >= 0 && isWater(S.terrain[at(tx + 1, ty)]);
            const lipL = wL ? "#d8c48a" : shade(tr.field, 0.72);
            const lipR = wR ? "#cbb67c" : shade(tr.field, 0.6);
            artSides(p[0], p[1], z, tr.earth || "#7b5438", TILE_T, lipL, lipR);
            let sand = 0;
            if (at(tx - 1, ty) >= 0 && isWater(S.terrain[at(tx - 1, ty)])) sand |= 1;
            if (at(tx, ty - 1) >= 0 && isWater(S.terrain[at(tx, ty - 1)])) sand |= 2;
            if (wL) sand |= 4;
            if (wR) sand |= 8;
            artLandTop(p[0], p[1], z, col, hash2(tx * 5 + 2, ty * 7 + 1), sand, tr.snow, tr.field);
          }
          const owner = tilePlayer(S, i);
          if (owner >= 0) {
            g.fillStyle = rgba(tribeByIndex(S.players[owner].tribe).color, owner === curP ? 0.16 : 0.11);
            diamond(p[0], p[1] + (isWater(t) ? drop : 0), hw, hh); g.fill();
          }
        }
      }
      // The fog tiles along the edge of the known world, for the lit cloud
      // bank drawn after the objects.
      const clouds = [];
      for (let ty = -1; ty <= n; ty++) for (let tx = -1; tx <= n; tx++) {
        const i = at(tx, ty);
        if (i >= 0 && seen(i)) continue;
        const p = toScreen(tx, ty);
        if (!onScreen(p[0], p[1])) continue;
        for (const dd of DIRS8) { const j = at(tx + dd[0], ty + dd[1]); if (j >= 0 && seen(j)) { clouds.push([p[0], p[1], hash2(tx * 3, ty * 5)]); break; } }
      }
      // Pass 1.5: roads, borders, highlights
      g.lineWidth = Math.max(1.2, 2 * z);
      for (let ty = 0; ty < n; ty++) for (let tx = 0; tx < n; tx++) {
        const i = ty * n + tx;
        if (!seen(i)) continue;
        const p = toScreen(tx, ty);
        if (!onScreen(p[0], p[1])) continue;
        const owner = tilePlayer(S, i);
        if (S.road[i]) drawRoad(tx, ty, p, hw, hh);
        if (owner >= 0) {
          const trb = tribeByIndex(S.players[owner].tribe);
          const dy = isWater(S.terrain[i]) ? drop : 0;
          const nb = [[-1, 0, [-hw, 0, 0, -hh]], [0, -1, [0, -hh, hw, 0]], [1, 0, [0, hh, hw, 0]], [0, 1, [-hw, 0, 0, hh]]];
          for (const e of nb) {
            const xx = tx + e[0], yy = ty + e[1];
            const other = inBounds(S, xx, yy) ? tilePlayer(S, yy * n + xx) : -1;
            if (other === owner) continue;
            drawBorderEdge(p[0] + e[2][0] * 0.97, p[1] + dy + e[2][1] * 0.97, p[0] + e[2][2] * 0.97, p[1] + dy + e[2][3] * 0.97, trb.color, trb.dark, z);
          }
        }
      }
      if (sel && V.reach) {
        for (const i of V.reach.keys()) {
          const tx = i % n, ty = (i - tx) / n;
          const p = toScreen(tx, ty);
          const dy = isWater(S.terrain[i]) ? drop : 0;
          g.fillStyle = "rgba(255,255,255,0.28)";
          diamond(p[0], p[1] + dy, hw - 2, hh - 1); g.fill();
          g.strokeStyle = "rgba(255,255,255,0.75)"; g.lineWidth = 1.6;
          diamond(p[0], p[1] + dy, hw - 4, hh - 2); g.stroke();
        }
      }
      if (V.selTile >= 0 && !sel) {
        const tx = V.selTile % n, ty = (V.selTile - tx) / n;
        const p = toScreen(tx, ty);
        const dy = isWater(S.terrain[V.selTile]) ? drop : 0;
        g.strokeStyle = "rgba(255,255,255,0.95)"; g.lineWidth = 2.5;
        diamond(p[0], p[1] + dy, hw - 1, hh - 0.5); g.stroke();
      }

      // Pass 2: objects and units back to front.
      const units = S.units;
      for (let d = Math.max(0, vr.d0); d <= Math.min(2 * n - 2, vr.d1); d++) {
        for (let tx = Math.max(0, d - n + 1); tx <= Math.min(n - 1, d); tx++) {
          const ty = d - tx;
          const i = ty * n + tx;
          if (!seen(i)) continue;
          const p = toScreen(tx, ty);
          if (!onScreen(p[0], p[1])) continue;
          if (low) drawTileObjectsLow(i, tx, ty, p, z); else drawTileObjects(i, tx, ty, p, z);
        }
        for (const u of units) {
          const pos = V.vis.get(u.id);
          const ux = pos ? pos.x : u.x, uy = pos ? pos.y : u.y;
          if (Math.round(ux + uy) !== d) continue;
          const ti = Math.round(uy) * n + Math.round(ux);
          if (!seen(ti) && !(pos && seen(u.y * n + u.x))) continue;
          const p = toScreen(ux, uy);
          if (!onScreen(p[0], p[1])) continue;
          drawUnit(u, p, z, u === sel);
        }
        for (const gh of V.ghosts.values()) {
          if (Math.round(gh.x + gh.y) !== d) continue;
          const p = toScreen(gh.x, gh.y);
          drawUnit(gh, p, z, false);
        }
      }
      if (clouds.length && !low) for (let layer = 0; layer < 3; layer++) for (const c of clouds) artCloud(c[0], c[1], z, c[2], layer);
      // attack and convert targets
      if (sel) {
        for (const t of V.targets.concat(V.converts)) {
          const p = toScreen(t.x, t.y);
          const dy = isWater(S.terrain[t.y * n + t.x]) ? drop : 0;
          const pk = 1 + 0.05 * Math.sin(ART_T * 7);
          const conv = V.converts.indexOf(t) >= 0;
          // a bullseye of rings under the target
          const tones = conv ? ["rgba(199,125,255,0.5)", "rgba(199,125,255,0.32)", "rgba(199,125,255,0.6)"] : ["rgba(255,120,60,0.55)", "rgba(255,70,50,0.35)", "rgba(255,90,60,0.7)"];
          ellipse(p[0], p[1] + dy + 2 * z, hw * 0.46 * pk, hh * 0.46 * pk, tones[0]);
          ellipse(p[0], p[1] + dy + 2 * z, hw * 0.3 * pk, hh * 0.3 * pk, tones[1]);
          ellipse(p[0], p[1] + dy + 2 * z, hw * 0.14 * pk, hh * 0.14 * pk, tones[2]);
          g.strokeStyle = conv ? "#d9a6ff" : "#ff6a4e"; g.lineWidth = 2.2 * z;
          g.beginPath(); g.ellipse(p[0], p[1] + dy + 2 * z, hw * 0.46 * pk, hh * 0.46 * pk, 0, 0, TAU); g.stroke();
        }
      }
      // Pass 3: labels and floats
      if (z >= 0.55) {
        for (const c of S.cities) {
          const i = c.y * n + c.x;
          if (!seen(i)) continue;
          const p = toScreen(c.x, c.y);
          if (!onScreen(p[0], p[1])) continue;
          drawCityLabel(c, p, z);
        }
      }
      for (const f of V.floats) {
        const p = toScreen(f.x, f.y);
        const k = f.t / f.dur;
        g.globalAlpha = k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3;
        outlinedText(f.text, p[0] + f.dx * z, p[1] - (30 + k * 40) * z + f.dy * z, Math.max(11, 14 * z), f.color || "#fff");
        g.globalAlpha = 1;
      }
    }

    // A border is a low wall along the edge: a dark base band with blocks
    // of the tribe colour on top.
    function drawBorderEdge(ax, ay, bx, by, col, dark, z) {
      const L = Math.hypot(bx - ax, by - ay);
      const segs = Math.max(2, Math.round(L / (9 * z)));
      const lift = 2.2 * z;
      line(ax, ay + lift * 0.5, bx, by + lift * 0.5, dark, 4.6 * z, "butt");
      for (let k = 0; k < segs; k += 2) {
        const t0 = k / segs, t1 = Math.min(1, (k + 1) / segs);
        line(ax + (bx - ax) * t0, ay + (by - ay) * t0 - lift * 0.5, ax + (bx - ax) * t1, ay + (by - ay) * t1 - lift * 0.5, col, 4.2 * z, "butt");
      }
    }
    function drawRoad(tx, ty, p, hw, hh) {
      const z = cam.z;
      let any = false;
      const segs = [];
      for (const d of DIRS8) {
        const xx = tx + d[0], yy = ty + d[1];
        if (!inBounds(S, xx, yy)) continue;
        const j = yy * S.n + xx;
        const rl = S.road[j] || (S.center[j] >= 0 && S.cities[S.center[j]].owner >= 0);
        if (!rl) continue;
        const q = toScreen(xx, yy);
        segs.push([(p[0] + q[0]) / 2, (p[1] + q[1]) / 2]);
        any = true;
      }
      if (!any) segs.push([p[0] - hw * 0.3, p[1]], [p[0] + hw * 0.3, p[1]]);
      for (let pass = 0; pass < 2; pass++) {
        g.strokeStyle = pass ? "#d4b57a" : "#a8885a";
        g.lineWidth = Math.max(1.5, (pass ? 4 : 7) * z);
        g.lineCap = "round";
        g.beginPath();
        for (const s of segs) { g.moveTo(p[0], p[1]); g.lineTo(s[0], s[1]); }
        g.stroke();
      }
    }

    const hasTechView = (t) => V.viewer < 0 || (S && S.players[V.viewer] && hasTech(S, V.viewer, t));
    function drawTileObjects(i, tx, ty, p, z) {
      const t = S.terrain[i], r = S.res[i], b = S.bld[i];
      const tr = tribeByIndex(S.biome[i]);
      const seed = hash2(tx * 3 + 1, ty * 5 + 2);
      const cx = p[0], cy = p[1] + (isWater(t) ? WATER_DROP * z : 0);
      const c = S.center[i] >= 0 ? S.cities[S.center[i]] : null;
      const ownerP = tilePlayer(S, i);
      const ownerColor = ownerP >= 0 ? tribeByIndex(S.players[ownerP].tribe).color : "#8a7f70";
      if (c) {
        const ctr = c.owner >= 0 ? tribeByIndex(S.players[c.owner].tribe) : null;
        artCity(cx, cy, z, { level: c.level, capital: c.capital, walls: c.walls, owned: c.owner >= 0,
          color: ctr ? ctr.color : "#8a7f70", wall: ctr ? ctr.wall : "#cfc6b4", sieged: sieged(S, c), t: ART_T + seed * 7, seed });
        return;
      }
      if (t === MOUNTAIN) {
        artMountain(cx, cy, z, tr, seed, r === R_METAL && hasTechView("climbing"));
        if (b === B_MINE) artBuilding(B_MINE, cx, cy + 4 * z, z, ownerColor, seed);
        else if (b === B_MTEMPLE) artBuilding(B_MTEMPLE, cx, cy - TH * 0.4 * z, z, ownerColor, seed, templeLevel(S, i));
        return;
      }
      if (t === FOREST) {
        if (b === B_LUMBER || b === B_FTEMPLE) {
          artForest(cx, cy, z, tr, seed, 1);
          artBuilding(b, cx, cy, z, ownerColor, seed, templeLevel(S, i));
        } else {
          artForest(cx, cy, z, tr, seed, r === R_ANIMAL ? 2 : 3 + (seed > 0.55 ? 1 : 0));
          if (r === R_ANIMAL) artAnimal(cx, cy, z, tr, seed);
        }
        return;
      }
      if (isWater(t)) {
        if (b === B_PORT) artBuilding(B_PORT, cx, cy, z, ownerColor, seed);
        else if (b === B_WTEMPLE) artBuilding(B_WTEMPLE, cx, cy, z, ownerColor, seed, templeLevel(S, i));
        else if (b === B_RUIN) artBuilding(B_RUIN, cx, cy, z, ownerColor, seed);
        else if (r === R_FISH) artFish(cx, cy, z, seed);
        else if (r === R_WHALE) artWhale(cx, cy, z);
        return;
      }
      // fields
      if (b) artBuilding(b, cx, cy, z, ownerColor, seed, b === B_TEMPLE ? templeLevel(S, i) : S.lvl[i]);
      else if (r === R_FRUIT) artFruit(cx, cy, z, seed);
      else if (r === R_CROP) artCrop(cx, cy, z, seed);
    }
    // Far out, every tile gets one shape: enough to read the map, cheap enough for 900 tiles.
    function drawTileObjectsLow(i, tx, ty, p, z) {
      const t = S.terrain[i], r = S.res[i], b = S.bld[i];
      const tr = tribeByIndex(S.biome[i]);
      const cx = p[0], cy = p[1] + (isWater(t) ? WATER_DROP * z : 0);
      const c = S.center[i] >= 0 ? S.cities[S.center[i]] : null;
      if (c) {
        const owned = c.owner >= 0;
        const roof = owned ? tribeByIndex(S.players[c.owner].tribe).color : "#8a7f70";
        rect(cx - 9 * z, cy - 6 * z, 18 * z, 10 * z, "#efe6d2");
        tri(cx, cy - 6 * z, 22 * z, 9 * z, roof);
        if (c.walls) { g.strokeStyle = "#b9ab93"; g.lineWidth = 3 * z; diamond(cx, cy, TW * 0.42 * z, TH * 0.42 * z); g.stroke(); }
        return;
      }
      if (t === MOUNTAIN) { cone(cx, cy + TH * 0.2 * z, TW * 0.55 * z, TH * 1.2 * z, shade(tr.rock, LIGHT), shade(tr.rock, DARK)); tri(cx, cy - TH * 0.75 * z, TW * 0.16 * z, TH * 0.25 * z, "#f4f7fa"); }
      else if (t === FOREST) { cone(cx, cy + 4 * z, 22 * z, TH * 1.1 * z, shade(tr.forest, LIGHT), shade(tr.forest, DARK)); }
      if (r === R_FRUIT) circle(cx + 10 * z, cy + 6 * z, 4 * z, "#ff6b4a");
      else if (r === R_CROP) rect(cx - 10 * z, cy + 2 * z, 20 * z, 4 * z, "#e4c43f");
      else if (r === R_ANIMAL) circle(cx + 8 * z, cy + 6 * z, 4 * z, "#5a4330");
      else if (r === R_FISH) circle(cx, cy, 3.5 * z, "#dfe9f3");
      else if (r === R_METAL && hasTechView("climbing")) circle(cx, cy - 4 * z, 3.5 * z, "#ffe066");
      else if (r === R_WHALE) circle(cx, cy, 5 * z, "#2d3e5a");
      if (b === B_RUIN) rect(cx - 8 * z, cy - 10 * z, 16 * z, 12 * z, "#9a9388");
      else if (b && BLD[b]) {
        const col = BLD[b].temple ? "#f1e6cf" : b === B_MONUMENT ? "#d9d2c4" : b === B_PORT ? "#8a6a44" : "#e8dcc4";
        rect(cx - 7 * z, cy - 8 * z, 14 * z, 10 * z, col);
      }
    }
    function drawCityLabel(c, p, z) {
      const owned = c.owner >= 0;
      const tr = owned ? tribeByIndex(S.players[c.owner].tribe) : null;
      const y = p[1] - (c.capital ? 44 : 30) * z - 10;
      const label = owned ? c.name : "Village";
      const size = clamp(11 * Math.sqrt(z), 9, 15);
      g.font = "700 " + size.toFixed(1) + "px -apple-system,system-ui,sans-serif";
      const tw = g.measureText(label).width + 16;
      const pillW = owned ? tw + 22 : tw;
      g.fillStyle = owned ? rgba(tr.dark, 0.92) : "rgba(60,60,60,0.85)";
      g.beginPath(); g.roundRect(p[0] - pillW / 2, y - 9, pillW, 18, 9); g.fill();
      if (owned) {
        circle(p[0] - pillW / 2 + 11, y, 7.5, tr.color);
        text(String(c.level), p[0] - pillW / 2 + 11, y + 0.5, 9.5, "#fff");
        text(label, p[0] + 11, y + 0.5, size, "#fff");
        const need = c.level + 1;
        const bw = Math.min(pillW - 8, need * 6);
        for (let k = 0; k < need; k++) {
          g.fillStyle = k < c.pop ? "#ffd166" : "rgba(255,255,255,0.3)";
          g.fillRect(p[0] - bw / 2 + k * (bw / need) + 1, y + 11, bw / need - 2, 3);
        }
      } else text(label, p[0], y + 0.5, size, "#eee");
    }
    function drawUnit(u, p, z, selected) {
      const tr = tribeByIndex(S.players[u.owner].tribe);
      const onWater = isWater(S.terrain[Math.round(u.y) * S.n + Math.round(u.x)]);
      const y = p[1] + (onWater ? WATER_DROP * z : 0);
      if (selected) {
        // a cyan glow under the chosen unit, breathing a little
        const k = 1 + 0.06 * Math.sin(ART_T * 6);
        ellipse(p[0], y + 2 * z, TW * 0.4 * z * k, TH * 0.4 * z * k, "rgba(90,225,255,0.28)");
        g.strokeStyle = "rgba(90,225,255,0.45)"; g.lineWidth = 7 * z;
        g.beginPath(); g.ellipse(p[0], y + 2 * z, TW * 0.4 * z * k, TH * 0.4 * z * k, 0, 0, TAU); g.stroke();
        g.strokeStyle = "#8ef0ff"; g.lineWidth = 2.4 * z;
        g.beginPath(); g.ellipse(p[0], y + 2 * z, TW * 0.4 * z * k, TH * 0.4 * z * k, 0, 0, TAU); g.stroke();
      }
      artUnit(p[0], y, z, { type: u.type, boat: u.boat, color: tr.color, hpFrac: u.hp / maxHp(u), hp: u.dead ? null : Math.max(0, Math.round(u.hp)), vet: u.vet,
        dim: u.owner === S.cur && u.moved && u.attacked && !u.dead, hit: !!V.flash.get(u.id) });
    }

    // ====================================================================== //
    // Floating text, replay scenes                                           //
    // ====================================================================== //
    function floatText(x, y, s, color, dx, dy) {
      V.floats.push({ x, y, text: s, color, t: 0, dur: 1100, dx: dx || 0, dy: dy || 0 });
      if (V.floats.length > 40) V.floats.shift();
    }
    const sceneVisible = (ev) => {
      if (V.viewer < 0) return true;
      const ex = S.players[V.viewer].explored;
      const at = (x, y) => inBounds(S, x, y) && ex[y * S.n + x];
      if (ev.t === "move") { const fx = ev.from % S.n, fy = (ev.from - fx) / S.n, tx = ev.to % S.n, ty = (ev.to - tx) / S.n; return at(fx, fy) || at(tx, ty); }
      if (ev.x != null) return at(ev.x, ev.y);
      if (ev.t === "attack") return at(ev.ax, ev.ay) || at(ev.dx, ev.dy);
      return true;
    };
    const tribeName = (p) => tribeByIndex(S.players[p].tribe).name;

    /** Turn the engine's event list into scenes the viewer should watch. */
    function harvestEvents() {
      const evs = S.events.splice(0, S.events.length);
      const scenes = [];
      for (const ev of evs) {
        if (ev.t === "over") { scenes.push({ ev, dur: 0 }); continue; }
        if (ev.t === "turnStart") { scenes.push({ ev, dur: 0 }); continue; }
        if (!sceneVisible(ev)) continue;
        switch (ev.t) {
          case "move": {
            const u = S.units.find((q) => q.id === ev.u);
            if (!u) break;
            if (!V.vis.has(u.id) && !V.pendingMoves.has(u.id)) {
              const fx = ev.from % S.n, fy = (ev.from - fx) / S.n;
              V.vis.set(u.id, { x: fx, y: fy });
            }
            V.pendingMoves.add(u.id);
            scenes.push({ ev, dur: Math.max(1, ev.path.length - 1) * 150 });
            break;
          }
          case "attack": {
            scenes.push({ ev, dur: 420 });
            if (ev.advanced != null) {
              const u = S.units.find((q) => q.id === ev.a);
              if (u) {
                const from = ev.ay * S.n + ev.ax;
                if (!V.vis.has(u.id) && !V.pendingMoves.has(u.id)) V.vis.set(u.id, { x: ev.ax, y: ev.ay });
                V.pendingMoves.add(u.id);
                scenes.push({ ev: { t: "move", u: u.id, from, to: ev.advanced, path: [from, ev.advanced], p: ev.p, silent: true }, dur: 150 });
              }
            }
            break;
          }
          case "death": {
            const u = ev.unit;
            if (u) V.ghosts.set(ev.u, u);
            scenes.push({ ev, dur: 260 });
            break;
          }
          case "capture": scenes.push({ ev, dur: 500 }); break;
          case "pop": case "stars": case "heal": case "levelup": case "ruin": case "convert": case "monument":
            scenes.push({ ev, dur: 180 }); break;
          case "research": case "task": case "meet": case "eliminated": case "reward": case "connected":
            scenes.push({ ev, dur: 0 }); break;
          default: break;
        }
      }
      V.replay.push(...scenes);
    }
    V.pendingMoves = new Set();

    function startScene(sc) {
      const ev = sc.ev;
      const mine = ev.p === V.viewer;
      switch (ev.t) {
        case "move": {
          const u = S.units.find((q) => q.id === ev.u);
          if (!u) { sc.dur = 0; break; }
          sc.unit = u;
          sc.path = ev.path.map((i) => [i % S.n, (i - (i % S.n)) / S.n]);
          if (mine && !ev.silent) sfx("step");
          break;
        }
        case "attack": {
          sfx("hit");
          V.flash.set(ev.d, 1);
          floatText(ev.dx, ev.dy, "-" + ev.toD, "#ff6b6b");
          if (ev.toA) { V.flash.set(ev.a, 1); floatText(ev.ax, ev.ay, "-" + ev.toA, "#ffb347", 0, 6); }
          if (ev.q === V.viewer) haptic("warning"); else if (mine) haptic("medium");
          break;
        }
        case "death": { sfx("death"); if (ev.p === V.viewer) { sting("fail"); } break; }
        case "capture": {
          if (mine) { sting("success"); haptic("success"); toast("You captured " + S.cities[ev.c].name); }
          else if (ev.q === V.viewer) { toast(tribeName(ev.p) + " took " + S.cities[ev.c].name); haptic("error"); }
          floatText(ev.x, ev.y, "Captured", "#ffd166");
          break;
        }
        case "pop": if (ev.n > 0) floatText(ev.x, ev.y, "+" + ev.n + " pop", "#9be37d", 0, -8); break;
        case "stars": floatText(ev.x, ev.y, "+" + ev.n + "★", "#ffd166", 0, -14); if (mine) sting("coin"); break;
        case "heal": floatText(ev.x, ev.y, "+" + ev.n, "#6ddb6d"); break;
        case "levelup": floatText(ev.x, ev.y, S.cities[ev.c].name + " → " + ev.level, "#fff", 0, -22); if (mine) { sfx("levelup"); } break;
        case "ruin": if (mine) { toast("Ruins: " + ev.detail); sting("powerup"); } break;
        case "convert": floatText(ev.x, ev.y, "Converted", "#c77dff"); break;
        case "monument": floatText(ev.x, ev.y, "Monument", "#ffd166"); break;
        case "research": if (mine) { toast(TECHS[ev.tech].name + " researched"); } break;
        case "task": if (mine) { const tk = TASKS.find((t) => t.id === ev.id); toast("Task done: " + tk.name + " can be built"); sting("powerup"); } break;
        case "meet": if (mine) toast("You met the " + tribeName(ev.q)); break;
        case "eliminated": toast("The " + tribeName(ev.p) + " have fallen"); break;
        case "turnStart": if (ev.p === V.viewer && ev.income) { V.incomeFlash = ev.income; } break;
        case "over": break;
        default: break;
      }
    }
    function endScene(sc) {
      const ev = sc.ev;
      if (ev.t === "move" && sc.unit) { V.vis.delete(sc.unit.id); V.pendingMoves.delete(sc.unit.id); }
      if (ev.t === "death") V.ghosts.delete(ev.u);
      if (ev.t === "attack") { V.flash.delete(ev.d); V.flash.delete(ev.a); }
    }
    function tickReplay(dt) {
      if (!V.replay.length) return;
      // Long bot turns are compressed so nobody waits.
      const total = V.replay.reduce((a, s) => a + s.dur, 0);
      const speed = ANIM_SPEED * Math.max(1, total / 3200);
      let sc = V.replay[0];
      if (!sc.started) { sc.started = true; sc.t = 0; startScene(sc); }
      sc.t += dt * speed;
      if (sc.ev.t === "move" && sc.unit) {
        const k = clamp(sc.t / Math.max(1, sc.dur), 0, 1);
        const seg = (sc.path.length - 1) * k;
        const a = Math.min(sc.path.length - 1, Math.floor(seg)), b = Math.min(sc.path.length - 1, a + 1);
        const f = seg - a;
        V.vis.set(sc.unit.id, { x: lerp(sc.path[a][0], sc.path[b][0], f), y: lerp(sc.path[a][1], sc.path[b][1], f) });
      }
      while (sc && sc.t >= sc.dur) {
        endScene(sc);
        V.replay.shift();
        sc = V.replay[0];
        if (sc) { sc.started = true; sc.t = 0; startScene(sc); }
      }
      V.dirty = true;
    }

    // ====================================================================== //
    // 7a. Meshes: low-poly solids projected onto the 2:1 world               //
    // ====================================================================== //
    // World units: a tile is 1 by 1 and z is up; a unit of height is TZ
    // screen pixels at zoom 1, which is what makes a cube look like a cube in
    // this projection. Every face is lit by its normal against one light from
    // the upper left and front, culled when it faces away from the camera, and
    // painted back to front. An object is rendered once per zoom step into a
    // sprite and stamped with drawImage after that, so a screen full of trees
    // costs a few hundred image draws rather than thousands of polygons.
    const TZ = 42;
    const LIGHT_DIR = [0.228, 0.608, 0.76];
    const VIEW_DIR = [0.631, 0.631, 0.451];
    const ISO_X = TW / 2, ISO_Y = TH / 2;
    const projPt = (p, z) => [(p[0] - p[1]) * ISO_X * z, (p[0] + p[1]) * ISO_Y * z - p[2] * TZ * z];
    // shade() for mesh colours: the same darken or lighten, but back to a hex
    // string so the lit faces can be shaded again.
    function hexShade(hex, k) {
      const n = parseInt(hex.slice(1), 16);
      let r = (n >> 16) & 255, gg = (n >> 8) & 255, b = n & 255;
      if (k <= 1) { r = Math.round(r * k); gg = Math.round(gg * k); b = Math.round(b * k); }
      else { r = Math.round(r + (255 - r) * (k - 1)); gg = Math.round(gg + (255 - gg) * (k - 1)); b = Math.round(b + (255 - b) * (k - 1)); }
      const h = (v) => (v < 16 ? "0" : "") + v.toString(16);
      return "#" + h(r) + h(gg) + h(b);
    }
    function normalOf(pts) {
      const a = pts[0], b = pts[1], c = pts[2];
      const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
      const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const len = Math.hypot(nx, ny, nz) || 1;
      return [nx / len, ny / len, nz / len];
    }
    // Brightness from the normal: a top face comes out a touch lighter than
    // the base colour, the front-left face is the base, the front-right is
    // shaded, and slopes land in between.
    function litColor(col, n) {
      const d = n[0] * LIGHT_DIR[0] + n[1] * LIGHT_DIR[1] + n[2] * LIGHT_DIR[2];
      return shade(col, clamp(0.5 + 0.8 * Math.max(0, d), 0.46, 1.3));
    }
    function depthOf(pts) {
      let d = 0;
      for (const p of pts) d += p[0] * VIEW_DIR[0] + p[1] * VIEW_DIR[1] + p[2] * VIEW_DIR[2];
      return d / pts.length;
    }
    // Draw faces into a context with the object's ground point at (ox, oy).
    // A face is { p: [[x, y, z], ...], c: colour } with two options: flat
    // (painted as is, never culled) and two (two-sided, lit from either side).
    function drawFaces(pg, faces, ox, oy, z) {
      const list = [];
      for (const f of faces) {
        let n = normalOf(f.p);
        if (!f.flat) {
          const facing = n[0] * VIEW_DIR[0] + n[1] * VIEW_DIR[1] + n[2] * VIEW_DIR[2];
          if (facing <= 0.01) { if (!f.two) continue; n = [-n[0], -n[1], -n[2]]; }
        }
        list.push({ f, n, d: depthOf(f.p) + (f.bias || 0) });
      }
      list.sort((a, b) => a.d - b.d);
      for (const it of list) {
        const col = it.f.flat ? it.f.c : litColor(it.f.c, it.n);
        pg.fillStyle = col; pg.strokeStyle = col; pg.lineWidth = it.f.flat ? 0.2 : 0.7; pg.lineJoin = "round";
        pg.beginPath();
        for (let i = 0; i < it.f.p.length; i++) {
          const q = projPt(it.f.p[i], z);
          if (i) pg.lineTo(ox + q[0], oy + q[1]); else pg.moveTo(ox + q[0], oy + q[1]);
        }
        pg.closePath(); pg.fill(); pg.stroke();
      }
    }

    // ---- Builders. All take world units and return faces with outward
    // windings; cx, cy is the footprint centre and z0 the base height.
    function mBox(cx, cy, z0, w, d, h, c, opts) {
      const x0 = cx - w / 2, x1 = cx + w / 2, y0 = cy - d / 2, y1 = cy + d / 2, z1 = z0 + h;
      const o = opts || {};
      const out = [
        { p: [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], c: o.top || c },
        { p: [[x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]], c: o.right || c },
        { p: [[x1, y1, z0], [x0, y1, z0], [x0, y1, z1], [x1, y1, z1]], c: o.front || c },
        { p: [[x0, y1, z0], [x0, y0, z0], [x0, y0, z1], [x0, y1, z1]], c },
        { p: [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]], c }
      ];
      if (o.bias) for (const f of out) f.bias = o.bias;
      return out;
    }
    function mPyramid(cx, cy, z0, w, d, h, c, lean) {
      const x0 = cx - w / 2, x1 = cx + w / 2, y0 = cy - d / 2, y1 = cy + d / 2;
      const a = [cx + (lean ? lean[0] : 0), cy + (lean ? lean[1] : 0), z0 + h];
      const b = [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0]];
      const out = [];
      for (let k = 0; k < 4; k++) out.push({ p: [b[k], b[(k + 1) % 4], a], c });
      return out;
    }
    function mCone(cx, cy, z0, r, h, c, seg, ry) {
      const n = seg || 7, a = [cx, cy, z0 + h];
      const out = [];
      for (let k = 0; k < n; k++) {
        const t0 = (k / n) * TAU, t1 = ((k + 1) / n) * TAU;
        out.push({ p: [[cx + r * Math.cos(t0), cy + (ry || r) * Math.sin(t0), z0], [cx + r * Math.cos(t1), cy + (ry || r) * Math.sin(t1), z0], a], c });
      }
      return out;
    }
    function mFrustum(cx, cy, z0, r0, r1, h, c, seg, topCol) {
      const n = seg || 7, z1 = z0 + h;
      const out = [], top = [];
      for (let k = 0; k < n; k++) {
        const t0 = (k / n) * TAU, t1 = ((k + 1) / n) * TAU;
        const P0 = [cx + r0 * Math.cos(t0), cy + r0 * Math.sin(t0), z0], P1 = [cx + r0 * Math.cos(t1), cy + r0 * Math.sin(t1), z0];
        const Q0 = [cx + r1 * Math.cos(t0), cy + r1 * Math.sin(t0), z1], Q1 = [cx + r1 * Math.cos(t1), cy + r1 * Math.sin(t1), z1];
        out.push({ p: [P0, P1, Q1, Q0], c });
        top.push(Q0);
      }
      if (r1 > 0.001) out.push({ p: top, c: topCol || c });
      return out;
    }
    // A low-poly ball: rings of quads between a bottom and a top point.
    function mSphere(cx, cy, cz, r, c, seg, rings) {
      const n = seg || 6, m = rings || 3;
      const pt = (i, j) => {
        const lat = -Math.PI / 2 + (i / m) * Math.PI, lon = (j / n) * TAU;
        return [cx + r * Math.cos(lat) * Math.cos(lon), cy + r * Math.cos(lat) * Math.sin(lon), cz + r * Math.sin(lat)];
      };
      const out = [];
      for (let i = 0; i < m; i++) for (let j = 0; j < n; j++) {
        const a = pt(i, j), b = pt(i, j + 1), cc = pt(i + 1, j + 1), d = pt(i + 1, j);
        if (i === 0) out.push({ p: [a, b, cc], c });
        else if (i === m - 1) out.push({ p: [a, b, cc], c });
        else out.push({ p: [a, b, cc, d], c });
      }
      return out;
    }
    // A thin two-sided sheet from a to b, w wide across the direction up.
    function mSheet(a, b, w, c, upx, upy, upz) {
      const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
      let ux = upx == null ? 0 : upx, uy = upy == null ? 0 : upy, uz = upz == null ? 1 : upz;
      // perpendicular to the direction and the given up vector
      let px = dy * uz - dz * uy, py = dz * ux - dx * uz, pz = dx * uy - dy * ux;
      const len = Math.hypot(px, py, pz) || 1;
      px = px / len * w / 2; py = py / len * w / 2; pz = pz / len * w / 2;
      return [{ p: [[a[0] - px, a[1] - py, a[2] - pz], [b[0] - px, b[1] - py, b[2] - pz], [b[0] + px, b[1] + py, b[2] + pz], [a[0] + px, a[1] + py, a[2] + pz]], c, two: true }];
    }
    // A soft shadow on the ground: a flat dark octagon.
    function mShadow(cx, cy, rx, ry, a) {
      const pts = [];
      for (let k = 0; k < 8; k++) { const t = (k / 8) * TAU; pts.push([cx + rx * Math.cos(t), cy + ry * Math.sin(t), 0.002]); }
      return [{ p: pts, c: "rgba(10,20,30," + (a == null ? 0.2 : a) + ")", flat: true, bias: -5 }];
    }
    const mAll = (...lists) => [].concat(...lists);
    function mMove(faces, dx, dy, dz) {
      for (const f of faces) f.p = f.p.map((p) => [p[0] + dx, p[1] + dy, p[2] + (dz || 0)]);
      return faces;
    }
    function mScale(faces, s, sz) {
      for (const f of faces) f.p = f.p.map((p) => [p[0] * s, p[1] * s, p[2] * (sz == null ? s : sz)]);
      return faces;
    }

    // ---- Sprites: an object rendered once per zoom step and stamped after.
    // Sprites share a few atlas pages (one texture each) so the stamps come
    // from a handful of sources rather than hundreds of little canvases.
    const ATLAS = 2048;
    const spriteCache = new Map();
    let atlasPages = [], spriteBucket = 0, spritesOk = true;
    function spriteZoom(z) {
      // keep the bucket while a gesture is live or the zoom is close, so a
      // pinch never rebuilds every sprite on every frame
      const far = !spriteBucket || Math.abs(z - spriteBucket) / spriteBucket > 0.18;
      if (far && (!gesture || !spriteBucket)) { spriteBucket = Math.max(0.3, Math.round(z * 20) / 20); spriteCache.clear(); atlasPages = []; }
      return spriteBucket;
    }
    function atlasAlloc(w, h) {
      let page = atlasPages[atlasPages.length - 1];
      if (page && page.x + w > ATLAS) { page.x = 0; page.y += page.rowH; page.rowH = 0; }
      if (!page || page.y + h > ATLAS) {
        if (atlasPages.length >= 6) { spriteCache.clear(); atlasPages = []; }
        const c = new OffscreenCanvas(ATLAS, ATLAS);
        page = { c, pg: c.getContext("2d"), x: 0, y: 0, rowH: 0 };
        atlasPages.push(page);
      }
      const slot = { page, sx: page.x, sy: page.y };
      page.x += w; page.rowH = Math.max(page.rowH, h);
      return slot;
    }
    function makeSprite(faces, zq) {
      const dpr = seaDpr();
      let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
      for (const f of faces) for (const p of f.p) {
        const q = projPt(p, zq);
        if (q[0] < x0) x0 = q[0]; if (q[0] > x1) x1 = q[0]; if (q[1] < y0) y0 = q[1]; if (q[1] > y1) y1 = q[1];
      }
      const pad = 3;
      const w = Math.ceil(x1 - x0) + pad * 2, h = Math.ceil(y1 - y0) + pad * 2;
      const pw = Math.min(ATLAS, Math.ceil(w * dpr)), ph = Math.min(ATLAS, Math.ceil(h * dpr));
      const slot = atlasAlloc(pw, ph);
      const pg = slot.page.pg;
      pg.save();
      pg.translate(slot.sx, slot.sy);
      pg.scale(dpr, dpr);
      drawFaces(pg, faces, pad - x0, pad - y0, zq);
      pg.restore();
      return { page: slot.page, sx: slot.sx, sy: slot.sy, pw, ph, ax: x0 - pad, ay: y0 - pad, w, h };
    }
    // Stamp the object whose faces build() returns, with its ground point at
    // (x, y) on screen. Without OffscreenCanvas the faces are drawn directly.
    function stamp(key, x, y, z, build) {
      if (!spritesOk || typeof OffscreenCanvas !== "function") { drawFaces(g, build(), x, y, z); return; }
      try {
        const zq = spriteZoom(z);
        let sp = spriteCache.get(key);
        if (!sp) { sp = makeSprite(build(), zq); spriteCache.set(key, sp); }
        const sc = z / zq;
        g.drawImage(sp.page.c, sp.sx, sp.sy, sp.pw, sp.ph, x + sp.ax * sc, y + sp.ay * sc, sp.w * sc, sp.h * sc);
      } catch (_) { spritesOk = false; drawFaces(g, build(), x, y, z); }
    }

    // ====================================================================== //
    // 7b. Art: everything that stands on a tile                              //
    // ====================================================================== //
    // The ground is a few flat facets around a jittered centre, so it folds
    // like paper; everything that stands on it is a low-poly solid built from
    // the mesh builders above, lit by one light and stamped as a sprite. All
    // functions take the tile centre in screen pixels and the zoom z; nothing
    // here looks at the game state.

    const LIGHT = 1.16, DARK = 0.74;
    function poly(pts, color) {
      g.fillStyle = color;
      g.beginPath();
      g.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]);
      g.closePath();
      g.fill();
    }
    // A facet is a polygon stroked in its own colour, so neighbouring facets
    // meet without a hairline between them.
    function facet(pts, color) {
      g.fillStyle = color; g.strokeStyle = color; g.lineWidth = 0.8; g.lineJoin = "round";
      g.beginPath();
      g.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]);
      g.closePath();
      g.fill(); g.stroke();
    }
    function ellipse(x, y, rx, ry, color, rot) {
      g.fillStyle = color; g.beginPath(); g.ellipse(x, y, rx, ry, rot || 0, 0, TAU); g.fill();
    }
    function halfDisc(x, y, r, color, rot) {   // right half of a disc (rotated), for shading round things
      g.fillStyle = color; g.beginPath(); g.arc(x, y, r, (rot || 0) - Math.PI / 2, (rot || 0) + Math.PI / 2); g.closePath(); g.fill();
    }
    function line(x1, y1, x2, y2, color, w, cap) {
      g.strokeStyle = color; g.lineWidth = w; g.lineCap = cap || "round";
      g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke();
    }
    // A cone with a lit left face and a shaded right face (the far-out map).
    function cone(x, y, w, h, light, dark) {
      poly([[x, y - h], [x - w / 2, y], [x, y + w * 0.1]], light);
      poly([[x, y - h], [x, y + w * 0.1], [x + w / 2, y]], dark);
    }

    // ---- Ground
    const WATER = { shallow: "#62c6ee", deep: "#2d7fd4", side: "#1d5290", sideDeep: "#174378" };
    const TILE_T = 14, WATER_DROP = 5;        // land thickness, how far the sea sits below the land

    function artSides(cx, cy, z, earth, thick, lipL, lipR) {
      const hw = TW / 2 * z, hh = TH / 2 * z, t = thick * z;
      facet([[cx - hw, cy], [cx, cy + hh], [cx, cy + hh + t], [cx - hw, cy + t]], shade(earth, 0.92));
      facet([[cx, cy + hh], [cx + hw, cy], [cx + hw, cy + t], [cx, cy + hh + t]], shade(earth, 0.62));
      const lip = 2.2 * z;
      if (lipL) poly([[cx - hw, cy], [cx, cy + hh], [cx, cy + hh + lip], [cx - hw, cy + lip]], lipL);
      if (lipR) poly([[cx, cy + hh], [cx + hw, cy], [cx + hw, cy + lip], [cx, cy + hh + lip]], lipR);
    }
    // The folded-paper ground: four facets around a jittered centre, one of
    // them split again, each a step lighter or darker by where it faces.
    function artFacets(cx, cy, hw, hh, base, seed, spread) {
      const s = Math.floor(seed * 1000);
      const j1 = hash2(s + 3, 17), j2 = hash2(s + 9, 31), j3 = hash2(s + 5, 7);
      const C = [cx + (j1 - 0.5) * hw * 0.6, cy + (j2 - 0.5) * hh * 0.6];
      const N = [cx, cy - hh], E = [cx + hw, cy], S = [cx, cy + hh], W = [cx - hw, cy];
      const k = spread;
      facet([W, N, C], shade(base, 1 + k * (0.7 + j3 * 0.5)));
      facet([N, E, C], shade(base, 1 + k * (0.0 + j1 * 0.4)));
      facet([E, S, C], shade(base, 1 - k * (0.7 + j2 * 0.5)));
      facet([S, W, C], shade(base, 1 - k * (0.1 + j3 * 0.4)));
      if (j1 > 0.5) {
        const M = [(E[0] + S[0]) / 2 + (j2 - 0.5) * hw * 0.2, (E[1] + S[1]) / 2 + (j3 - 0.5) * hh * 0.2];
        facet([C, M, S], shade(base, 1 - k * (0.2 + j1 * 0.3)));
      } else {
        const M = [(W[0] + N[0]) / 2 + (j3 - 0.5) * hw * 0.2, (W[1] + N[1]) / 2 + (j1 - 0.5) * hh * 0.2];
        facet([C, W, M], shade(base, 1 + k * (0.2 + j2 * 0.5)));
      }
    }
    function artLandTop(cx, cy, z, color, seed, sand, snow, baseHex) {
      const hw = TW / 2 * z, hh = TH / 2 * z;
      g.fillStyle = color;
      diamond(cx, cy, hw + 0.7, hh + 0.5);
      g.fill();
      artFacets(cx, cy, hw, hh, baseHex, seed, snow ? 0.035 : 0.07);
      if (z >= 0.85 && seed > 0.45 && !snow) {
        // a few grass tufts
        const k = Math.floor(seed * 3) + 1;
        for (let i = 0; i < k; i++) {
          const jx = hash2(i * 13 + 1, Math.floor(seed * 1000)), jy = hash2(i * 7 + 5, Math.floor(seed * 777));
          const u = (jx - 0.5) * 0.7, v = (jy - 0.5) * 0.7;
          const x = cx + (u - v) * hw, y = cy + (u + v) * hh;
          const tuft = shade(baseHex || "#8fcf6a", 0.74);
          line(x, y, x - 1.6 * z, y - 3.8 * z, tuft, 1.2 * z); line(x, y, x + 0.4 * z, y - 4.4 * z, tuft, 1.2 * z); line(x, y, x + 2 * z, y - 3.4 * z, tuft, 1.2 * z);
        }
      }
    }
    function artShadow(x, y, z, rx, ry, a) {
      ellipse(x, y, rx * z, ry * z, "rgba(10,20,30," + (a || 0.22) + ")");
    }
    // coast: bitmask of edges touching land — 1 top-left, 2 top-right, 4 bottom-left, 8 bottom-right
    function artWaterTop(cx, cy, z, deep, coast, seed) {
      const hw = TW / 2 * z, hh = TH / 2 * z;
      const base = deep ? WATER.deep : WATER.shallow;
      g.fillStyle = base;
      diamond(cx, cy, hw + 0.7, hh + 0.5);
      g.fill();
      artFacets(cx, cy, hw, hh, base, seed, deep ? 0.05 : 0.06);
      // a glint that drifts slowly
      const ph = Math.sin(ART_T * 0.9 + seed * 9);
      const sx = ph * hw * 0.08;
      g.strokeStyle = deep ? "rgba(255,255,255,0.18)" : "rgba(255,255,255,0.34)";
      g.lineWidth = Math.max(1, 1.4 * z); g.lineCap = "round";
      g.beginPath();
      g.moveTo(cx - hw * 0.4 + sx, cy + hh * (0.1 - seed * 0.3)); g.lineTo(cx - hw * 0.12 + sx, cy + hh * (0.1 - seed * 0.3));
      g.stroke();
      if (!coast) return;
      // a pale shelf along the shore
      const E = [[[-hw, 0], [0, -hh]], [[0, -hh], [hw, 0]], [[-hw, 0], [0, hh]], [[0, hh], [hw, 0]]];
      for (let e = 0; e < 4; e++) {
        if (!(coast & (1 << e))) continue;
        const a = E[e][0], b = E[e][1];
        const f = 0.8;
        poly([[cx + a[0], cy + a[1]], [cx + b[0], cy + b[1]], [cx + b[0] * f, cy + b[1] * f], [cx + a[0] * f, cy + a[1] * f]], "rgba(255,255,255,0.22)");
      }
    }

    // ---- The cloud sea: every unexplored tile, on the map or beyond it,
    // carries three puffs lit from the upper left. The puffs are the same at
    // every zoom, so they are painted once per zoom step into a small canvas
    // that repeats across the screen; the whole sea is then one fill per frame.
    const SEA_SPOTS = [[-0.3, -0.08], [0.22, -0.18], [0.0, 0.24]];
    const SEA_FLOOR = "#808da1";
    const SEA_TONE = [["#8e9bae", "#8e9bae"], ["#b9c3cf", "#bfc8d3"], ["#e1e6ec", "#e9edf1"]];
    let seaCanvas = null, seaPat = null, seaPatZ = -1, seaOk = true;
    // The backing-store scale of the main canvas, so textures are as sharp as the screen.
    const seaDpr = () => Math.min(3, Math.max(1, (canvas.width / Math.max(1, ctx.width)) || Number(ctx.dpr) || 1));
    function seaPeriod(z) { const k = clamp(Math.round(700 / (TW / 2 * z)), 8, 48); return k + (k & 1); }
    function seaPuffs(pg, cx, cy, z, seed, PW, PH) {
      const hw = TW / 2 * z, hh = TH / 2 * z;
      const dot = (x, y, r, col) => {
        if (x + r < 0 || x - r > PW || y + r < 0 || y - r > PH) return;
        pg.fillStyle = col; pg.beginPath(); pg.arc(x, y, r, 0, TAU); pg.fill();
      };
      // two or three puffs per tile; zoomed out they grow a little so the sea stays soft
      const count = z < 0.9 ? 2 : 3, grow = z < 0.7 ? 1.4 : z < 0.9 ? 1.2 : 1.1;
      for (let k = 0; k < count; k++) {
        const j = hash2(k * 7 + 3, Math.floor(seed * 911));
        const tone = j > 0.5 ? 1 : 0;
        const x = cx + SEA_SPOTS[k][0] * hw * 1.2 + (j - 0.5) * 10 * z, y = cy + SEA_SPOTS[k][1] * hh * 1.2 + (j - 0.5) * 6 * z;
        const r = hh * (0.78 + j * 0.4) * grow;
        dot(x, y + 3 * z, r, SEA_TONE[0][tone]);
        dot(x - r * 0.08, y - r * 0.1, r * 0.92, SEA_TONE[1][tone]);
        dot(x - r * 0.32, y - r * 0.42, r * 0.44, SEA_TONE[2][tone]);
      }
    }
    function buildSeaPattern(z) {
      const dpr = seaDpr();
      const K = seaPeriod(z);
      const PW = K * TW / 2 * z, PH = K * TH / 2 * z;
      // a fresh canvas each time: its context starts with an identity transform
      seaCanvas = new OffscreenCanvas(Math.max(1, Math.round(PW * dpr)), Math.max(1, Math.round(PH * dpr)));
      const pg = seaCanvas.getContext("2d");
      pg.scale(dpr, dpr);
      pg.fillStyle = SEA_FLOOR; pg.fillRect(0, 0, PW, PH);
      // Tile (tx, ty) sits at ((tx - ty) * TW / 2, (tx + ty) * TH / 2); over
      // one period e = tx - ty and d = tx + ty run 0..K-1 with equal parity.
      // Two rows and columns beyond the period are drawn too, back to front,
      // so the puffs crossing an edge continue in the same order on the
      // other side and the repeat is seamless.
      for (let d = -2; d < K + 2; d++) for (let e = -2 + ((d + 2) & 1); e < K + 2; e += 2) {
        const we = ((e % K) + K) % K, wd = ((d % K) + K) % K;
        seaPuffs(pg, e * TW / 2 * z, d * TH / 2 * z, z, hash2(we + 11, wd + 5), PW, PH);
      }
      seaPat = g.createPattern(seaCanvas, "repeat");
      seaPatZ = z;
    }
    // Fill the screen with the sea, aligned to the tile lattice and drifting
    // a few pixels over a minute. Returns false on a browser without
    // OffscreenCanvas, where the sea is drawn tile by tile instead.
    function artSeaFill(w, h, z) {
      if (!seaOk || typeof OffscreenCanvas !== "function") return false;
      try {
        const zq = Math.max(0.3, Math.round(z * 20) / 20);
        if (!seaPat || seaPatZ !== zq) buildSeaPattern(zq);
        const dpr = seaDpr(), sc = z / zq;
        const K = seaPeriod(zq), PW = K * TW / 2 * z, PH = K * TH / 2 * z;
        const sx0 = w / 2 - cam.x * z + Math.sin(ART_T * 0.11) * 6 * z, sy0 = h / 2 - cam.y * z + Math.cos(ART_T * 0.07) * 3 * z;
        const ox = ((sx0 % PW) + PW) % PW, oy = ((sy0 % PH) + PH) % PH;
        g.save();
        g.translate(ox, oy);
        g.scale(sc / dpr, sc / dpr);
        g.fillStyle = seaPat;
        g.fillRect(-ox * dpr / sc, -oy * dpr / sc, w * dpr / sc, h * dpr / sc);
        g.restore();
        return true;
      } catch (_) { seaOk = false; try { g.restore(); } catch (_e) {} return false; }
    }
    // The same sea drawn tile by tile, for a runtime without patterns.
    function artSeaTiles(tiles, z) {
      const hw = TW / 2 * z, hh = TH / 2 * z;
      for (let k = 0; k < tiles.length; k += 3) {
        const cx = tiles[k], cy = tiles[k + 1], seed = tiles[k + 2];
        for (let q = 0; q < 3; q++) {
          const j = hash2(q * 7 + 3, Math.floor(seed * 911));
          const tone = j > 0.5 ? 1 : 0;
          const x = cx + SEA_SPOTS[q][0] * hw * 1.2 + (j - 0.5) * 10 * z, y = cy + SEA_SPOTS[q][1] * hh * 1.2 + (j - 0.5) * 6 * z;
          const r = hh * (0.78 + j * 0.4);
          circle(x, y + 3 * z, r, SEA_TONE[0][tone]);
          circle(x - r * 0.08, y - r * 0.1, r * 0.92, SEA_TONE[1][tone]);
          circle(x - r * 0.32, y - r * 0.42, r * 0.44, SEA_TONE[2][tone]);
        }
      }
    }
    // Cloud banks are drawn in three layers over every fog tile that borders
    // the known world: shadowed bodies, then lighter tops, then highlights, so
    // the puffs of neighbouring tiles merge into one bank instead of a row of balls.
    function artCloud(cx, cy, z, seed, layer) {
      const hw = TW / 2 * z, hh = TH / 2 * z;
      const puffs = [[-0.36, -0.02, 0.9], [0.0, -0.3, 1.0], [0.36, 0.02, 0.9], [0.02, 0.26, 0.95], [-0.2, 0.14, 0.8], [0.22, -0.12, 0.85]];
      for (let k = 0; k < puffs.length; k++) {
        const puff = puffs[k];
        const j = hash2(k + 1, Math.floor(seed * 997));
        const x = cx + puff[0] * hw * 1.15 + (j - 0.5) * 6 * z, y = cy + puff[1] * hh * 1.3 + (j - 0.5) * 4 * z;
        const r = puff[2] * hh * (0.95 + j * 0.3);
        if (layer === 0) circle(x, y + 2 * z, r * 1.02, "#8592a6");
        else if (layer === 1) circle(x - r * 0.08, y - r * 0.18, r * 0.86, "#cdd5df");
        else circle(x - r * 0.28, y - r * 0.46, r * 0.4, "#f3f6f9");
      }
    }

    // ====================================================================== //
    // Meshes of the things on the map                                        //
    // ====================================================================== //
    const WOOD = "#8d6e4c", BARK = "#6b4a2a", STEEL = "#c9ced6", IRON = "#3b3b45", BONE = "#efe6d6", GOLD = "#ffd166";

    // ---- Trees
    function meshTree(style, forest, trunk, v) {
      const s = 0.82 + v * 0.11;
      let f;
      switch (style) {
        case "palm": {
          f = mShadow(0.1, 0.05, 0.3, 0.22, 0.18);
          for (let k = 0; k < 4; k++) f = mAll(f, mBox(0.03 + k * 0.045, 0, k * 0.19, 0.08, 0.08, 0.2, trunk));
          const top = [0.2, 0, 0.78];
          for (let i = 0; i < 6; i++) {
            const a = (i / 6) * TAU + 0.4 + v * 0.3;
            const tip = [top[0] + Math.cos(a) * 0.42, top[1] + Math.sin(a) * 0.42, top[2] - 0.14];
            const mid = [top[0] + Math.cos(a) * 0.2, top[1] + Math.sin(a) * 0.2, top[2] + 0.04];
            f = mAll(f, mSheet(top, mid, 0.1, forest), mSheet(mid, tip, 0.13, hexShade(forest, 0.92)));
          }
          f = mAll(f, mSphere(0.17, 0.04, 0.74, 0.045, "#6b4a2a", 5, 2), mSphere(0.23, -0.04, 0.73, 0.045, "#8a5f3b", 5, 2));
          break;
        }
        case "round": {
          f = mAll(mShadow(0.02, 0.02, 0.27, 0.2, 0.18),
            mBox(0, 0, 0, 0.1, 0.1, 0.34, trunk),
            mSphere(0, 0, 0.42, 0.25, forest, 6, 3),
            mSphere(0.07, -0.05, 0.6, 0.2, hexShade(forest, 1.06), 6, 3),
            mSphere(-0.04, 0.03, 0.76, 0.15, hexShade(forest, 1.12), 6, 3));
          break;
        }
        case "acacia": {
          f = mAll(mShadow(0.05, 0.02, 0.36, 0.24, 0.16),
            mBox(0, 0, 0, 0.07, 0.07, 0.62, trunk),
            mSheet([0, 0, 0.45], [0.16, 0.04, 0.66], 0.05, trunk),
            mFrustum(0.06, 0.02, 0.6, 0.1, 0.4, 0.12, forest, 8, hexShade(forest, 1.1)),
            mCone(0.06, 0.02, 0.72, 0.4, 0.06, hexShade(forest, 1.15), 8));
          break;
        }
        case "dead": {
          f = mAll(mShadow(0, 0, 0.14, 0.1, 0.14),
            mBox(0, 0, 0, 0.09, 0.09, 0.78, forest),
            mSheet([0, 0, 0.45], [-0.24, 0.06, 0.68], 0.05, forest),
            mSheet([0, 0, 0.34], [0.22, -0.04, 0.56], 0.045, forest),
            mSheet([-0.13, 0.03, 0.57], [-0.26, 0.08, 0.8], 0.035, forest));
          break;
        }
        default: {   // cone and snow: three tiers
          f = mAll(mShadow(0.02, 0.02, 0.3, 0.22, 0.18),
            mBox(0, 0, 0, 0.09, 0.09, 0.14, trunk),
            mCone(0, 0, 0.1, 0.28, 0.44, forest, 7),
            mCone(0, 0, 0.36, 0.22, 0.4, hexShade(forest, 1.05), 7),
            mCone(0, 0, 0.6, 0.15, 0.36, hexShade(forest, 1.1), 7));
          if (style === "snow") f = mAll(f,
            mCone(0, 0, 0.42, 0.095, 0.12, "#ffffff", 7),
            mCone(0, 0, 0.64, 0.085, 0.12, "#ffffff", 7),
            mCone(0, 0, 0.85, 0.07, 0.11, "#ffffff", 7));
        }
      }
      return mScale(f, s, s);
    }
    function artTree(x, y, z, tribe, v) {
      const style = tribe.tree || "cone";
      stamp("tree|" + style + "|" + tribe.forest + "|" + tribe.trunk + "|" + v, x, y, z, () => meshTree(style, tribe.forest, tribe.trunk, v));
    }
    function artForest(cx, cy, z, tribe, seed, count) {
      const hw = TW / 2 * z, hh = TH / 2 * z;
      const spots = [[-0.26, -0.24], [0.26, -0.2], [-0.22, 0.26], [0.26, 0.26], [0.0, 0.02]];
      const trees = [];
      for (let k = 0; k < count; k++) {
        const s = spots[k];
        const j1 = hash2(k * 31 + 7, Math.floor(seed * 1000)), j2 = hash2(k * 17 + 3, Math.floor(seed * 977));
        const u = s[0] + (j1 - 0.5) * 0.14, v = s[1] + (j2 - 0.5) * 0.14;
        trees.push({ x: cx + (u - v) * hw, y: cy + (u + v) * hh, v: Math.floor(j2 * 4) });
      }
      trees.sort((a, b) => a.y - b.y);
      for (const t of trees) artTree(t.x, t.y, z, tribe, t.v);
    }

    // ---- Mountain: a height field over the tile, two or three peaks, snow
    // above the line, every triangle its own facet.
    function meshMountain(rock, v, metal) {
      const j = (k) => hash2(k * 17 + 3, v * 131 + 7);
      const peaks = [[-0.08 + (j(1) - 0.5) * 0.2, -0.06 + (j(2) - 0.5) * 0.2, 1.2 + j(3) * 0.45, 0.66], [0.3, 0.18, 0.7 + j(4) * 0.3, 0.46]];
      if (j(5) > 0.45) peaks.push([-0.34, 0.3, 0.55 + j(6) * 0.3, 0.4]);
      const N = 6, half = 0.56;
      const H = [];
      let maxH = 0;
      for (let i = 0; i <= N; i++) {
        H.push([]);
        for (let k = 0; k <= N; k++) {
          const x = -half + (i / N) * 2 * half, y = -half + (k / N) * 2 * half;
          let h = 0;
          for (const pk of peaks) { const d = Math.hypot(x - pk[0], y - pk[1]); h += Math.max(0, pk[2] * (1 - d / pk[3])); }
          if (i === 0 || k === 0 || i === N || k === N) h = 0;
          else h += (hash2(i * 7 + 1, k * 5 + v) - 0.5) * 0.1;
          h = Math.max(0, h);
          H[i].push(h);
          if (h > maxH) maxH = h;
        }
      }
      const f = [];
      const snowLine = maxH * 0.7;
      const P = (i, k) => [-half + (i / N) * 2 * half, -half + (k / N) * 2 * half, H[i][k]];
      for (let i = 0; i < N; i++) for (let k = 0; k < N; k++) {
        const a = P(i, k), b = P(i + 1, k), c = P(i + 1, k + 1), d = P(i, k + 1);
        const tris = ((i + k + v) % 2) ? [[a, b, c], [a, c, d]] : [[a, b, d], [b, c, d]];
        for (const t of tris) {
          const avg = (t[0][2] + t[1][2] + t[2][2]) / 3;
          if (avg < 0.004) continue;
          const col = avg > snowLine ? (avg > snowLine * 1.2 ? "#ffffff" : "#e9eef3") : hexShade(rock, 0.93 + hash2(i * 3 + k, v + 11) * 0.14);
          f.push({ p: t, c: col });
        }
      }
      if (metal) {
        for (const o of [[-0.3, 0.3], [-0.08, 0.42], [0.18, 0.34]]) {
          f.push(...mCone(o[0], o[1], 0.02, 0.07, 0.18, "#8d99ad", 5), ...mCone(o[0] + 0.03, o[1] - 0.02, 0.02, 0.045, 0.12, "#c3ccdb", 5));
        }
      }
      return f;
    }
    function artMountain(cx, cy, z, tribe, seed, metal) {
      const hw = TW / 2 * z, hh = TH / 2 * z;
      const v = Math.floor(seed * 6);
      stamp("mtn|" + tribe.rock + "|" + v + "|" + (metal ? 1 : 0), cx, cy, z, () => meshMountain(tribe.rock, v, metal));
      // mist drifting at the foot
      const drift = Math.sin(ART_T * 0.4 + seed * 6) * 2 * z;
      for (let k = 0; k < 4; k++) {
        const mx = cx + (k - 1.5) * hw * 0.42 + drift * (k % 2 ? 1 : -1), my = cy + hh * 0.45 + (k % 2) * 3 * z;
        ellipse(mx, my, hw * 0.34, hh * 0.3, "rgba(255,255,255," + (0.2 + hash2(k + 4, Math.floor(seed * 100)) * 0.12) + ")");
      }
    }

    // ---- Resources
    function meshFruit(v) {
      const tones = [["#ffb13a", "#4f9d3a"], ["#ff6b47", "#3a7f2a"], ["#f7c948", "#4f9d3a"]];
      let f = mShadow(0, 0.02, 0.36, 0.26, 0.14);
      const spots = [[-0.2, 0.06], [0.16, 0.12], [-0.02, -0.18]];
      for (let k = 0; k < 3; k++) {
        const t = tones[(k + v) % 3];
        const r = 0.09 + hash2(k, v) * 0.025;
        f = mAll(f, mSphere(spots[k][0], spots[k][1], r, r, t[0], 6, 3), mCone(spots[k][0], spots[k][1], r * 1.85, 0.06, 0.1, t[1], 5));
      }
      return f;
    }
    function artFruit(cx, cy, z, seed) { const v = Math.floor(seed * 3); stamp("fruit|" + v, cx, cy, z, () => meshFruit(v)); }
    function meshCrop() {
      let f = [];
      for (let r = -1; r <= 1; r++) for (let k = 0; k < 4; k++) {
        f = mAll(f, mCone(-0.3 + k * 0.2, r * 0.22, 0, 0.055, 0.22 + ((k + r) % 2) * 0.04, (k + r) % 2 ? "#e8c63d" : "#cfae2e", 5));
      }
      return f;
    }
    function artCrop(cx, cy, z) { stamp("crop", cx, cy, z, meshCrop); }
    // A boxy beast: body, head and snout boxes, legs, a mark on the back, and
    // whatever grows on its head.
    function meshAnimal(a) {
      const body = a.body, mark = a.mark;
      let f = mAll(mShadow(0.02, 0, 0.32, 0.18, 0.2),
        mBox(0, 0, 0.14, 0.44, 0.22, 0.22, body),
        mBox(-0.05, 0, 0.36, 0.26, 0.23, 0.02, mark),
        mBox(0.3, 0, 0.26, 0.17, 0.16, 0.16, body),
        mBox(0.4, 0, 0.27, 0.08, 0.1, 0.08, mark),
        mBox(0.26, -0.06, 0.42, 0.04, 0.03, 0.06, body), mBox(0.26, 0.06, 0.42, 0.04, 0.03, 0.06, body),
        mBox(-0.26, 0, 0.3, 0.1, 0.04, 0.04, hexShade(body, 0.8)));
      for (const lx of [-0.15, 0.15]) for (const ly of [-0.07, 0.07]) f = mAll(f, mBox(lx, ly, 0, 0.07, 0.07, 0.14, hexShade(body, 0.85)));
      // eyes
      f.push({ p: [[0.34, 0.081, 0.36], [0.37, 0.081, 0.36], [0.37, 0.081, 0.39], [0.34, 0.081, 0.39]], c: "#222222", flat: true, bias: 1 });
      if (a.horn === "antler") f = mAll(f, mSheet([0.28, -0.05, 0.42], [0.2, -0.14, 0.62], 0.03, BONE), mSheet([0.28, 0.05, 0.42], [0.2, 0.14, 0.62], 0.03, BONE),
        mSheet([0.24, -0.1, 0.52], [0.3, -0.16, 0.6], 0.025, BONE), mSheet([0.24, 0.1, 0.52], [0.3, 0.16, 0.6], 0.025, BONE));
      else if (a.horn === "horn") f = mAll(f, mBox(0.3, -0.06, 0.42, 0.03, 0.03, 0.12, BONE), mBox(0.3, 0.06, 0.42, 0.03, 0.03, 0.12, BONE));
      else if (a.horn === "tusk") f = mAll(f, mSheet([0.44, 0.04, 0.26], [0.52, 0.07, 0.34], 0.025, BONE));
      else if (a.horn === "hump") f = mAll(f, mSphere(-0.06, 0, 0.4, 0.11, body, 6, 3));
      return f;
    }
    function artAnimal(cx, cy, z, tribe, seed) {
      const a = tribe.animal || { body: "#5a4330", mark: "#8c6a4a", horn: "horn" };
      stamp("beast|" + a.body + "|" + a.mark + "|" + a.horn, cx + (seed - 0.5) * 8 * z, cy + 3 * z, z, () => meshAnimal(a));
    }
    function artFish(cx, cy, z, seed) {
      const spots = [[-9, -3], [8, 3], [-2, 8]];
      for (let k = 0; k < 2 + (seed > 0.6 ? 1 : 0); k++) {
        const x = cx + spots[k][0] * z, y = cy + spots[k][1] * z;
        const flip = k % 2 ? -1 : 1;
        ellipse(x, y + 2.5 * z, 9 * z, 3 * z, "rgba(255,255,255,0.18)");
        facet([[x + 6 * z * flip, y], [x + 1 * z * flip, y - 3.2 * z], [x - 5 * z * flip, y - 1 * z], [x - 5 * z * flip, y + 1.2 * z], [x + 1 * z * flip, y + 3 * z]], "#f2f6fa");
        facet([[x + 6 * z * flip, y], [x - 5 * z * flip, y + 1.2 * z], [x + 1 * z * flip, y + 3 * z]], "#c9d8e8");
        facet([[x - 5 * z * flip, y], [x - 10 * z * flip, y - 3.5 * z], [x - 10 * z * flip, y + 3.5 * z]], "#dfe8f1");
        circle(x + 3.4 * z * flip, y - 0.8 * z, 0.8 * z, "#223");
      }
    }
    function artWhale(cx, cy, z) {
      facet([[cx - 16 * z, cy - 2 * z], [cx - 8 * z, cy - 8 * z], [cx + 8 * z, cy - 8 * z], [cx + 16 * z, cy - 1 * z], [cx + 10 * z, cy + 5 * z], [cx - 10 * z, cy + 5 * z]], "#2d3e5a");
      facet([[cx - 14 * z, cy + 1 * z], [cx + 14 * z, cy + 1 * z], [cx + 10 * z, cy + 5 * z], [cx - 10 * z, cy + 5 * z]], "#4a5f80");
      poly([[cx + 14 * z, cy - 1 * z], [cx + 22 * z, cy - 7 * z], [cx + 25 * z, cy + 1 * z], [cx + 17 * z, cy + 2 * z]], "#2d3e5a");
      circle(cx - 10 * z, cy - 3 * z, 1 * z, "#dde");
      g.strokeStyle = "rgba(230,245,255,0.85)"; g.lineWidth = 1.6 * z;
      g.beginPath(); g.moveTo(cx - 5 * z, cy - 8 * z); g.lineTo(cx - 8 * z, cy - 16 * z); g.moveTo(cx - 5 * z, cy - 8 * z); g.lineTo(cx - 2 * z, cy - 15 * z); g.stroke();
      circle(cx - 9 * z, cy - 17 * z, 1.3 * z, "rgba(230,245,255,0.8)"); circle(cx - 1 * z, cy - 16.5 * z, 1.3 * z, "rgba(230,245,255,0.8)");
    }

    // ---- Buildings
    // A house: walls, a pyramid roof, a door on the lit face, a window on the shaded one.
    function mHouse(cx, cy, w, d, h, wall, roofCol, opts) {
      const o = opts || {};
      const f = mAll(mBox(cx, cy, 0, w, d, h, wall, { top: hexShade(wall, 0.96) }),
        mPyramid(cx, cy, h, w + 0.03, d + 0.03, o.roofH || h * 0.62, roofCol));
      const dy = cy + d / 2 + 0.003, dx = cx + w / 2 + 0.003;
      f.push({ p: [[cx - w * 0.3, dy, 0], [cx - w * 0.08, dy, 0], [cx - w * 0.08, dy, h * 0.55], [cx - w * 0.3, dy, h * 0.55]], c: o.door || "#5a4030", bias: 0.3 });
      if (h > 0.18) f.push({ p: [[dx, cy - d * 0.2, h * 0.45], [dx, cy + d * 0.1, h * 0.45], [dx, cy + d * 0.1, h * 0.72], [dx, cy - d * 0.2, h * 0.72]], c: "#f6e3a0", bias: 0.3 });
      return f;
    }
    function mHut(cx, cy, r, wall, roofCol) {
      const f = mAll(mFrustum(cx, cy, 0, r, r * 0.95, r * 0.9, wall, 7), mCone(cx, cy, r * 0.9, r * 1.35, r * 1.1, roofCol, 7));
      f.push({ p: [[cx - r * 0.2, cy + r * 0.94, 0], [cx + r * 0.2, cy + r * 0.94, 0], [cx + r * 0.2, cy + r * 0.94, r * 0.6], [cx - r * 0.2, cy + r * 0.94, r * 0.6]], c: "#4a3a2a", bias: 0.3 });
      return f;
    }
    function mTower(cx, cy, w, h, wall, capCol, spire) {
      const f = mBox(cx, cy, 0, w, w, h, wall, { top: hexShade(wall, 0.96) });
      if (spire) f.push(...mCone(cx, cy, h, w * 0.75, w * 1.2, capCol, 6));
      else f.push(...mPyramid(cx, cy, h, w + 0.03, w + 0.03, w * 0.7, capCol));
      return f;
    }
    function meshBuilding(kind, color, lvl) {
      const wall = "#efe6d2";
      switch (kind) {
        case B_FARM: {
          let f = [{ p: [[-0.42, -0.1, 0.004], [0.02, -0.42, 0.004], [0.42, 0.02, 0.004], [0.0, 0.42, 0.004]], c: "#b8864f", flat: true, bias: -4 }];
          for (let k = 0; k < 4; k++) for (let m = 0; m < 3; m++) f = mAll(f, mCone(-0.3 + k * 0.17 + m * 0.07, -0.26 + m * 0.2 - k * 0.04, 0, 0.05, 0.13, m % 2 ? "#7fd05a" : "#55a83a", 5));
          return mAll(f, mHouse(0.2, 0.18, 0.26, 0.22, 0.18, wall, color));
        }
        case B_MINE: return mAll(mBox(0, 0.05, 0, 0.5, 0.3, 0.24, "#4a3d35"),
          { p: [[-0.2, 0.203, 0], [-0.04, 0.203, 0], [-0.04, 0.203, 0.16], [-0.2, 0.203, 0.16]], c: "#15100d", flat: true, bias: 0.3 },
          mBox(-0.22, 0.2, 0, 0.04, 0.04, 0.2, WOOD), mBox(-0.02, 0.2, 0, 0.04, 0.04, 0.2, WOOD), mBox(-0.12, 0.2, 0.19, 0.26, 0.05, 0.04, WOOD),
          mBox(0.24, 0.28, 0, 0.22, 0.14, 0.1, "#4d4d55"), mSphere(0.2, 0.26, 0.14, 0.04, GOLD, 5, 2), mSphere(0.29, 0.3, 0.14, 0.04, GOLD, 5, 2));
        case B_LUMBER: {
          const f = mHouse(-0.12, 0.05, 0.36, 0.3, 0.22, "#a97c50", BARK);
          for (let k = 0; k < 3; k++) f.push(...mBox(0.26, 0.1, k * 0.07, 0.3, 0.07, 0.07, k % 2 ? "#c9a070" : "#b8905f"));
          return f;
        }
        case B_PORT: {
          let f = [];
          for (let k = 0; k < 4; k++) f = mAll(f, mBox(-0.3 + k * 0.2, 0.1, -0.1, 0.05, 0.05, 0.2, "#5e4630"));
          return mAll(f, mBox(0, 0.1, 0.08, 0.8, 0.26, 0.04, "#9c7a4e"), mHouse(0.22, 0.02, 0.26, 0.22, 0.18, wall, color),
            mBox(-0.28, 0.34, -0.03, 0.26, 0.12, 0.06, "#8a5f3b"), mBox(-0.28, 0.34, 0.03, 0.02, 0.02, 0.2, "#5a4a3a"));
        }
        case B_WINDMILL: return mAll(mFrustum(0, 0, 0, 0.16, 0.12, 0.52, "#e6dcc8", 6, "#d5cab4"), mCone(0, 0, 0.52, 0.17, 0.16, color, 6),
          { p: [[-0.05, 0.121, 0], [0.05, 0.121, 0], [0.05, 0.121, 0.16], [-0.05, 0.121, 0.16]], c: "#5a4030", flat: true, bias: 0.3 });
        case B_FORGE: return mAll(mHouse(0, 0.02, 0.5, 0.34, 0.26, "#8f8a83", "#4a4440", { door: "#ff8c3a" }), mBox(0.16, -0.08, 0.26, 0.09, 0.09, 0.3, "#5a5450"));
        case B_SAWMILL: return mAll(mHouse(-0.06, 0.04, 0.46, 0.3, 0.22, "#b48a5a", BARK), mBox(-0.28, 0.3, 0, 0.14, 0.14, 0.05, "#c9a070"), mBox(-0.28, 0.3, 0.05, 0.14, 0.14, 0.05, "#b8905f"));
        case B_CUSTOMS: return mAll(mBox(0, 0, 0, 0.56, 0.36, 0.26, wall, { top: hexShade(wall, 0.96) }),
          mBox(-0.18, 0.183, 0, 0.05, 0.02, 0.26, "#d9ceb6"), mBox(0.18, 0.183, 0, 0.05, 0.02, 0.26, "#d9ceb6"),
          mSphere(0, 0, 0.26, 0.2, color, 8, 3), mSphere(0, 0, 0.48, 0.035, GOLD, 5, 2),
          { p: [[-0.06, 0.183, 0], [0.06, 0.183, 0], [0.06, 0.183, 0.16], [-0.06, 0.183, 0.16]], c: "#5a4a3a", flat: true, bias: 0.3 });
        case B_TEMPLE: case B_FTEMPLE: case B_MTEMPLE: case B_WTEMPLE: {
          const col = kind === B_TEMPLE ? "#f1e6cf" : kind === B_FTEMPLE ? "#cfe8c4" : kind === B_MTEMPLE ? "#e4ecf2" : "#cfe3f1";
          let f = mAll(mBox(0, 0, 0, 0.64, 0.5, 0.06, hexShade(col, 0.9)), mBox(0, 0, 0.06, 0.54, 0.4, 0.06, hexShade(col, 0.95)));
          for (const c of [[-0.18, -0.12], [0.18, -0.12], [-0.18, 0.12], [0.18, 0.12]]) f = mAll(f, mBox(c[0], c[1], 0.12, 0.07, 0.07, 0.28, col));
          f = mAll(f, mBox(0, 0, 0.4, 0.56, 0.42, 0.05, col), mPyramid(0, 0, 0.45, 0.58, 0.44, 0.2, hexShade(col, 0.97)));
          if ((lvl || 1) >= 3) f = mAll(f, mBox(0, 0, 0.45, 0.57, 0.43, 0.02, GOLD));
          if ((lvl || 1) >= 5) f = mAll(f, mSphere(0, 0, 0.68, 0.05, GOLD, 5, 2));
          return f;
        }
        case B_MONUMENT: {
          const k = (lvl || 0) % 3;
          const f = mAll(mBox(0, 0, 0, 0.52, 0.4, 0.07, "#9a9386"), mBox(0, 0, 0.07, 0.36, 0.28, 0.06, "#b1aa9c"), mBox(0, 0, 0.13, 0.12, 0.1, 0.62, "#d9d1c1"));
          if (k === 0) f.push(...mPyramid(0, 0, 0.75, 0.16, 0.14, 0.16, GOLD));
          else if (k === 1) f.push(...mSphere(0, 0, 0.84, 0.1, "#5bc2ea", 6, 3));
          else f.push(...mCone(0, 0, 0.75, 0.1, 0.24, "#ff8c3a", 6));
          return f;
        }
        case B_RUIN: {
          const f = [];
          for (const c of [[-0.22, 0.06, 0.3], [0, -0.1, 0.44], [0.22, 0.02, 0.2]]) f.push(...mBox(c[0], c[1], 0, 0.09, 0.09, c[2], "#a39b8f", { top: "#b5ada0" }));
          f.push(...mBox(0.14, 0.26, 0, 0.36, 0.08, 0.08, "#9a9388"), ...mSphere(-0.3, 0.28, 0.04, 0.045, "#8d8578", 5, 2));
          return f;
        }
        default: return [];
      }
    }
    function artBuilding(kind, cx, cy, z, color, seed, extra) {
      stamp("bld|" + kind + "|" + color + "|" + (extra || 0), cx, cy, z, () => meshBuilding(kind, color, extra));
      // the moving parts, drawn over the sprite
      if (kind === B_WINDMILL) {
        const hx = cx + 1 * z, hy = cy - TZ * 0.56 * z;
        for (let k = 0; k < 4; k++) {
          const a = k * Math.PI / 2 + ART_T * 0.6;
          const ex = hx + Math.cos(a) * 15 * z, ey = hy + Math.sin(a) * 15 * z;
          line(hx, hy, ex, ey, "#5a4a3a", 2 * z);
          const px = -Math.sin(a) * 3.4 * z, py = Math.cos(a) * 3.4 * z;
          poly([[hx + Math.cos(a) * 4 * z, hy + Math.sin(a) * 4 * z], [ex, ey], [ex + px, ey + py], [hx + Math.cos(a) * 4 * z + px, hy + Math.sin(a) * 4 * z + py]], "rgba(245,238,220,0.92)");
        }
        circle(hx, hy, 2 * z, "#3a2f28");
      } else if (kind === B_FORGE) {
        const sx = cx + 9 * z, sy = cy - TZ * 0.56 * z;
        const dr = (ART_T * 4 + seed * 10) % 10;
        circle(sx + dr * 0.3 * z, sy - 3 * z - dr * z, 3.6 * z, "rgba(230,230,235,0.55)");
        circle(sx + 2.5 * z + dr * 0.5 * z, sy - 8 * z - dr * z, 4.2 * z, "rgba(230,230,235,0.4)");
        circle(sx + 5.5 * z + dr * 0.7 * z, sy - 13 * z - dr * z, 4.8 * z, "rgba(230,230,235," + (0.25 * (1 - dr / 10)) + ")");
      } else if (kind === B_SAWMILL) {
        const sx = cx + 13 * z, sy = cy - 2 * z;
        for (let k = 0; k < 12; k++) { const a = k * TAU / 12 + ART_T * 0.8; poly([[sx + Math.cos(a) * 6 * z, sy + Math.sin(a) * 6 * z], [sx + Math.cos(a + 0.26) * 7.6 * z, sy + Math.sin(a + 0.26) * 7.6 * z], [sx + Math.cos(a + 0.52) * 6 * z, sy + Math.sin(a + 0.52) * 6 * z]], "#8c8c8c"); }
        circle(sx, sy, 6 * z, "#a5a5a5"); circle(sx, sy, 1.6 * z, "#444");
      }
    }

    // ---- Cities: houses packed around a plaza, a hall with a tower from level
    // four, a keep from level seven, walls as a ring of blocks.
    function meshCity(o) {
      const spots = [[-0.04, -0.16], [-0.3, -0.04], [0.26, -0.1], [-0.22, 0.24], [0.28, 0.2], [0.02, -0.38], [-0.38, 0.1], [0.38, 0.02], [0.0, 0.3]];
      const n = o.owned ? Math.min(9, o.level + 2) : 2;
      let f = mShadow(0.02, 0.04, 0.5, 0.42, 0.14);
      if (o.walls) {
        const pts = [[0, -0.46], [0.46, 0], [0, 0.46], [-0.46, 0]];
        for (let e = 0; e < 4; e++) {
          const a = pts[e], b = pts[(e + 1) % 4];
          for (let k = 0; k < 5; k++) { const t = (k + 0.5) / 5; f = mAll(f, mBox(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, 0, 0.09, 0.09, k % 2 ? 0.16 : 0.12, k % 2 ? "#e7dcc4" : "#d5c9ae")); }
        }
        for (const c of pts) f = mAll(f, mBox(c[0], c[1], 0, 0.14, 0.14, 0.26, "#cfc2a8", { top: "#e7dcc4" }));
      }
      for (let k = 0; k < n; k++) {
        const s = spots[k], jit = hash2(k * 7 + 1, o.v * 13 + 5);
        if (!o.owned) { f = mAll(f, mHut(s[0], s[1], 0.15, "#b9a98a", "#c9a265")); continue; }
        const big = k === 0;
        if (big && o.level >= 7) f = mAll(f, mHouse(s[0], s[1], 0.42, 0.34, 0.3, o.wall, o.color), mTower(s[0] + 0.15, s[1] - 0.1, 0.16, 0.82, o.wall, o.color, false),
          mBox(s[0] + 0.15, s[1] - 0.1, 0.82, 0.19, 0.19, 0.03, hexShade(o.wall, 0.9)));
        else if (big && o.level >= 4) f = mAll(f, mHouse(s[0], s[1], 0.4, 0.32, 0.28, o.wall, o.color), mTower(s[0] + 0.14, s[1] - 0.08, 0.14, 0.56, o.wall, o.color, true));
        else f = mAll(f, mHouse(s[0], s[1], (big ? 0.3 : 0.24 + jit * 0.06), (big ? 0.26 : 0.2 + jit * 0.05), (big ? 0.24 : 0.17 + jit * 0.07), o.wall, o.color));
      }
      return f;
    }
    function artCity(cx, cy, z, o) {
      const hw = TW / 2 * z, hh = TH / 2 * z;
      // the plaza: a paler stone diamond with a faint rim
      g.fillStyle = o.owned ? "rgba(236,226,200,0.5)" : "rgba(255,255,255,0.14)";
      diamond(cx, cy, hw * 0.9, hh * 0.9); g.fill();
      if (o.owned) { g.strokeStyle = "rgba(120,100,70,0.35)"; g.lineWidth = 1.2 * z; diamond(cx, cy, hw * 0.9, hh * 0.9); g.stroke(); }
      const v = Math.floor((o.seed || 0) * 4);
      stamp("city|" + (o.owned ? o.level : "v") + "|" + (o.walls ? 1 : 0) + "|" + o.color + "|" + o.wall + "|" + v, cx, cy, z, () => meshCity({ level: o.level, owned: o.owned, walls: o.walls, color: o.color, wall: o.wall, v }));
      if (o.capital && o.owned) {
        const px = cx + hw * 0.56, py = cy - hh * 0.05;
        const wave = Math.sin((o.t || 0) * 2.6) * 2.4 * z;
        line(px, py + 4 * z, px, py - 36 * z, "#4a3a2a", 2 * z);
        poly([[px, py - 36 * z], [px + 15 * z, py - 31 * z + wave], [px, py - 25 * z]], shade(o.color, LIGHT));
        poly([[px, py - 36 * z], [px + 15 * z, py - 31 * z + wave], [px + 5 * z, py - 31 * z + wave * 0.4]], shade(o.color, DARK));
        circle(px, py - 37 * z, 2.2 * z, GOLD);
      }
      if (o.sieged) {
        g.strokeStyle = "#ff5a4e"; g.lineWidth = 2.5 * z;
        diamond(cx, cy, hw * 0.95, hh * 0.95); g.stroke();
      }
    }

    // ---- Units: blocky figures, a box body under a box head, gear per type,
    // a mount or a boat when they have one.
    const SKIN = "#f1d2b1";
    function meshFigure(type, col, hit, giant) {
      const C = hit ? "#ffffff" : col;
      const skin = hit ? "#ffffff" : giant ? "#b7bda8" : SKIN;
      const legs = hit ? "#dddddd" : "#3b3028";
      let f = mAll(mBox(-0.06, 0, 0, 0.08, 0.08, 0.1, legs), mBox(0.06, 0, 0, 0.08, 0.08, 0.1, legs),
        mBox(0, 0, 0.1, 0.24, 0.16, 0.26, C), mBox(0, 0, 0.19, 0.25, 0.17, 0.03, legs),
        mBox(-0.165, 0, 0.17, 0.07, 0.07, 0.19, skin), mBox(0.165, 0, 0.17, 0.07, 0.07, 0.19, skin),
        mBox(0, 0, 0.37, 0.22, 0.19, 0.2, skin));
      // eyes on the lit face
      const ey = 0.095 + 0.003;
      f.push({ p: [[-0.065, ey, 0.45], [-0.025, ey, 0.45], [-0.025, ey, 0.49], [-0.065, ey, 0.49]], c: "#222222", flat: true, bias: 0.4 });
      f.push({ p: [[0.02, ey, 0.45], [0.06, ey, 0.45], [0.06, ey, 0.49], [0.02, ey, 0.49]], c: "#222222", flat: true, bias: 0.4 });
      const hx = 0.26, hz = 0.2;   // the right hand
      switch (type) {
        case "warrior":
          f = mAll(f, mBox(0, 0, 0.56, 0.24, 0.21, 0.07, IRON), mBox(0, 0.1, 0.5, 0.03, 0.02, 0.08, IRON),
            mBox(hx, 0, hz, 0.04, 0.04, 0.42, WOOD), mSphere(hx, 0, hz + 0.44, 0.07, "#6e6e78", 6, 3));
          break;
        case "rider":
          f = mAll(f, mBox(0, 0, 0.56, 0.24, 0.21, 0.06, WOOD), mBox(hx, 0, hz - 0.05, 0.03, 0.03, 0.64, STEEL), mCone(hx, 0, hz + 0.59, 0.03, 0.07, "#eef1f5", 4));
          break;
        case "archer":
          f = mAll(f, mCone(0, 0, 0.55, 0.16, 0.24, "#4f7a3a", 6),
            mSheet([hx + 0.04, 0, hz - 0.1], [hx + 0.1, 0, hz + 0.12], 0.035, WOOD), mSheet([hx + 0.1, 0, hz + 0.12], [hx + 0.1, 0, hz + 0.36], 0.035, WOOD),
            mSheet([hx + 0.1, 0, hz + 0.36], [hx + 0.04, 0, hz + 0.58], 0.035, WOOD), mSheet([hx + 0.04, 0, hz - 0.1], [hx + 0.04, 0, hz + 0.58], 0.012, "#e9dcc8"));
          break;
        case "defender": {
          f = mAll(f, mBox(0, 0, 0.56, 0.25, 0.22, 0.08, STEEL), mBox(-0.21, 0, 0.08, 0.04, 0.3, 0.38, STEEL));
          f.push({ p: [[-0.26, 0.153, 0.18], [-0.16, 0.153, 0.18], [-0.16, 0.153, 0.32], [-0.26, 0.153, 0.32]], c: col, flat: true, bias: 0.4 });
          break;
        }
        case "swordsman": {
          f = mAll(f, mBox(0, 0, 0.56, 0.25, 0.22, 0.08, STEEL), mBox(0, 0, 0.64, 0.04, 0.16, 0.06, col),
            mBox(hx, 0, hz + 0.05, 0.03, 0.03, 0.5, "#eef1f5"), mBox(hx, 0, hz + 0.05, 0.12, 0.04, 0.03, WOOD),
            mBox(-0.2, 0, 0.14, 0.04, 0.22, 0.26, STEEL));
          f.push({ p: [[-0.23, 0.113, 0.22], [-0.17, 0.113, 0.22], [-0.17, 0.113, 0.3], [-0.23, 0.113, 0.3]], c: col, flat: true, bias: 0.4 });
          break;
        }
        case "catapult": f = mAll(f, mBox(0, 0, 0.56, 0.24, 0.21, 0.06, WOOD)); break;
        case "knight":
          f = mAll(f, mBox(0, 0, 0.56, 0.25, 0.22, 0.09, STEEL), mCone(0, 0, 0.65, 0.05, 0.2, col, 5),
            mBox(hx, 0, hz - 0.1, 0.03, 0.03, 0.95, "#e9dcc8"), mCone(hx, 0, hz + 0.85, 0.035, 0.1, STEEL, 4));
          break;
        case "mindbender":
          f = mAll(f, mCone(0, 0, 0.55, 0.17, 0.36, "#5b3a86", 6),
            mBox(hx, 0, hz - 0.05, 0.03, 0.03, 0.62, WOOD), mSphere(hx, 0, hz + 0.6, 0.065, "#c77dff", 6, 3));
          break;
        case "giant":
          f = mAll(f, mBox(0, 0.1, 0.49, 0.2, 0.02, 0.03, "#3a3f38"));
          break;
        default: break;
      }
      return f;
    }
    function meshHorse(color, armored, stripes) {
      const dark = hexShade(color, 0.72);
      let f = mAll(mBox(0, 0, 0.24, 0.62, 0.24, 0.26, color),
        mBox(0.3, 0, 0.42, 0.14, 0.14, 0.3, color), mBox(0.42, 0, 0.6, 0.24, 0.14, 0.14, color),
        mBox(0.36, -0.05, 0.74, 0.03, 0.03, 0.06, dark), mBox(0.36, 0.05, 0.74, 0.03, 0.03, 0.06, dark),
        mBox(0.3, 0, 0.72, 0.16, 0.05, 0.05, dark), mBox(-0.33, 0, 0.3, 0.06, 0.05, 0.2, dark));
      for (const lx of [-0.2, 0.2]) for (const ly of [-0.08, 0.08]) f = mAll(f, mBox(lx, ly, 0, 0.08, 0.08, 0.24, hexShade(color, 0.9)));
      f.push({ p: [[0.5, 0.071, 0.66], [0.53, 0.071, 0.66], [0.53, 0.071, 0.69], [0.5, 0.071, 0.69]], c: "#222222", flat: true, bias: 0.4 });
      if (stripes) for (let k = -2; k <= 2; k++) f.push({ p: [[k * 0.11 - 0.025, 0.123, 0.26], [k * 0.11 + 0.025, 0.123, 0.26], [k * 0.11 + 0.025, 0.123, 0.48], [k * 0.11 - 0.025, 0.123, 0.48]], c: "#2b2b2b", flat: true, bias: 0.4 });
      if (armored) f = mAll(f, mBox(-0.06, 0, 0.5, 0.44, 0.27, 0.05, "#9aa3b2"), mBox(0.44, 0, 0.74, 0.2, 0.12, 0.04, "#9aa3b2"));
      return f;
    }
    function meshBoat(kind, color) {
      if (kind === 3) return mAll(mBox(0, 0, -0.06, 0.9, 0.34, 0.12, "#7d8794", { top: "#a9b2bf" }), mBox(0, 0, 0.06, 0.44, 0.24, 0.18, "#9aa3b2"),
        mBox(0.02, 0, 0.24, 0.1, 0.1, 0.18, "#5a6270"), mBox(-0.3, 0, 0.06, 0.16, 0.08, 0.05, "#3a3f47"), mBox(0.3, 0, 0.06, 0.16, 0.08, 0.05, "#3a3f47"));
      const big = kind === 2;
      const L = big ? 0.84 : 0.7;
      const f = mAll(mBox(0, 0, -0.06, L, 0.28, 0.1, "#8a5f3b", { top: "#b0804f" }), mBox(0, 0, 0.04, L + 0.02, 0.3, 0.03, "#b0804f"),
        mCone(L / 2, 0, -0.06, 0.08, 0.14, "#8a5f3b", 4, 0.14), mBox(0, 0, 0.07, 0.03, 0.03, 0.7, "#5a4a3a"));
      const sail = (x0, dir) => {
        f.push({ p: [[x0, 0, 0.74], [x0 + dir * (big ? 0.34 : 0.28), 0, 0.5], [x0, 0, 0.26]], c: "#f3ead8", two: true });
        for (let k = 0; k < 3; k++) {
          const t0 = 0.12 + k * 0.3, t1 = t0 + 0.14;
          const zt0 = 0.74 - 0.48 * t0, zt1 = 0.74 - 0.48 * t1;
          const w0 = (big ? 0.34 : 0.28) * (1 - Math.abs(zt0 - 0.5) / 0.24), w1 = (big ? 0.34 : 0.28) * (1 - Math.abs(zt1 - 0.5) / 0.24);
          f.push({ p: [[x0, 0.004, zt0], [x0 + dir * w0, 0.004, zt0], [x0 + dir * w1, 0.004, zt1], [x0, 0.004, zt1]], c: color, two: true, bias: 0.2 });
        }
      };
      sail(0.02, 1);
      if (big) sail(-0.02, -1);
      f.push({ p: [[0, 0, 0.78], [-0.1, 0, 0.74], [0, 0, 0.7]], c: color, two: true });
      return f;
    }
    function meshUnit(o) {
      const giant = o.type === "giant";
      let f = [];
      let base = 0, s = giant ? 1.5 : 1;
      if (o.boat) { f = mAll(f, meshBoat(o.boat, o.color)); base = 0.08; s *= 0.85; }
      else if (o.type === "rider" || o.type === "knight") { f = mAll(f, meshHorse(o.type === "knight" ? "#7c8795" : "#e9e2d2", o.type === "knight", o.type === "rider")); base = 0.5; s *= 0.9; }
      let fx = 0;
      if (o.type === "catapult" && !o.boat) {
        f = mAll(f, mBox(0.1, 0, 0.06, 0.6, 0.3, 0.08, BARK), mBox(-0.1, 0, 0, 0.06, 0.2, 0.2, "#4a3a2a"), mBox(0.3, 0, 0, 0.06, 0.2, 0.2, "#4a3a2a"),
          mBox(0.02, -0.06, 0.14, 0.05, 0.05, 0.2, WOOD), mBox(0.02, 0.06, 0.14, 0.05, 0.05, 0.2, WOOD),
          mSheet([-0.04, 0, 0.16], [0.42, 0, 0.66], 0.06, WOOD), mSphere(0.42, 0, 0.7, 0.07, "#555555", 6, 3));
        fx = -0.38; s *= 0.85;
      }
      const fig = meshFigure(o.type, o.color, o.hit, giant);
      mScale(fig, s, s);
      mMove(fig, fx, 0, base);
      return mAll(f, fig);
    }
    function artUnit(cx, cy, z, o) {
      const x = cx, y = cy + 2 * z;
      g.globalAlpha = o.dim ? 0.75 : 1;
      ellipse(x, y + 3 * z, (o.boat ? 18 : 13) * z, 5.5 * z, "rgba(0,0,0,0.3)");
      stamp("unit|" + o.type + "|" + (o.boat || 0) + "|" + o.color + "|" + (o.hit ? 1 : 0), x, y, z, () => meshUnit(o));
      if (o.type === "mindbender") circle(x + 10 * z, y - TZ * (0.8 + (o.boat ? 0.08 : 0)) * z, 7 * z, "rgba(199,125,255,0.28)");
      g.globalAlpha = 1;
      if (o.vet) { circle(x + 11 * z, y - 18 * z, 2.8 * z, GOLD); circle(x + 11 * z, y - 18 * z, 1.1 * z, "#fff3c0"); }
      if (o.hp != null) {
        // hit points as a small number at the shoulder, the way the original shows them
        const lift = o.boat ? 4 : (o.type === "rider" || o.type === "knight") ? 22 : 0;
        outlinedText(String(o.hp), x - 12 * z, y - 22 * z - lift * z, clamp(8.5 * z, 9, 12), o.hpFrac > 0.5 ? "#ffffff" : o.hpFrac > 0.25 ? "#ffd166" : "#ff7a6e", "right");
      }
    }

    // ====================================================================== //
    // 8. HUD, panels, input, turn flow, sound, saving                        //
    // ====================================================================== //
    // The interface is DOM inside the bit's own root, styled by one style
    // block (classes, keyframes and press states), with inline SVG icons. One
    // delegated click listener handles every button through data-act.

    const ICON = {
      star: "M12 2.5l2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.4 6.1 20.5l1.2-6.5L2.5 9.4l6.6-.9z",
      flask: "M9 3h6v2h-1v4.4l5.6 9.4A2 2 0 0 1 17.9 22H6.1a2 2 0 0 1-1.7-3.2L10 9.4V5H9zm3 8.5L8.6 17h6.8z",
      menu: "M4 6h16v2H4zm0 5h16v2H4zm0 5h16v2H4z",
      trophy: "M7 3h10v2h3v3a5 5 0 0 1-4.2 4.9A5.5 5.5 0 0 1 13 15.9V18h3v2H8v-2h3v-2.1A5.5 5.5 0 0 1 8.2 12.9 5 5 0 0 1 4 8V5h3zm-1 4v1a3 3 0 0 0 2 2.8V7zm12 0h-2v3.8A3 3 0 0 0 18 8z",
      arrow: "M5 11h10.2l-3.6-3.6L13 6l6 6-6 6-1.4-1.4 3.6-3.6H5z",
      sword: "M14.5 3l6.5 6.5-1.4 1.4-1.1-1.1-6 6 1.6 1.6-1.4 1.4-1.6-1.6L8.3 20 4 15.7l3.2-3.2L5.6 11 7 9.6l1.6 1.6 6-6-1.1-1.1z",
      shield: "M12 2l8 3v6c0 5-3.4 9.3-8 11-4.6-1.7-8-6-8-11V5z",
      flag: "M5 3h2v18H5zm3 1h10l-2.5 4L18 12H8z",
      hammer: "M14 4l6 6-2 2-1.5-1.5L8 19l-3-3 8.5-8.5L12 6z",
      coin: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zm0 3a6 6 0 1 1 0 12 6 6 0 0 1 0-12zm-1 2h2v1.2c1.2.3 2 1.1 2 2.3h-2c0-.5-.4-.7-1-.7s-1 .2-1 .6c0 .4.4.6 1.3.8 1.6.4 2.7 1 2.7 2.4 0 1.2-.8 2-2 2.3V17h-2v-1.1c-1.3-.3-2.1-1.1-2.1-2.4h2c0 .5.5.8 1.1.8s1-.2 1-.6c0-.5-.5-.7-1.4-.9-1.5-.4-2.6-1-2.6-2.3 0-1.2.8-2 2-2.3z",
      heart: "M12 21s-7.5-4.6-9.3-9.4C1.5 8.3 3.6 5 7 5c2 0 3.4 1 5 2.8C13.6 6 15 5 17 5c3.4 0 5.5 3.3 4.3 6.6C19.5 16.4 12 21 12 21z",
      city: "M3 21V9l5-3v3l4-2v4l4-2v11zm2-2h2v-2H5zm4 0h2v-2H9zm4 0h2v-2h-2zm4 0h2v-2h-2zM5 15h2v-2H5zm4 0h2v-2H9zm4 0h2v-2h-2zm4 0h2v-2h-2z",
      eye: "M12 5c5 0 9 4 10 7-1 3-5 7-10 7S3 15 2 12c1-3 5-7 10-7zm0 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8zm0 2a2 2 0 1 1 0 4 2 2 0 0 1 0-4z",
      play: "M7 4l13 8-13 8z",
      users: "M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zm7 1a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM2 19c0-3 3-5 7-5s7 2 7 5v1H2zm15 1v-1c0-1.8-.8-3.3-2.1-4.3 3.2.1 7.1 1.6 7.1 4.3v1z",
      book: "M4 4h7a3 3 0 0 1 3 3v13a2 2 0 0 0-2-2H4zm16 0h-7a3 3 0 0 0-3 3v13a2 2 0 0 1 2-2h8z",
      chart: "M4 20V10h3v10zm6.5 0V4h3v16zm6.5 0v-7h3v7z",
      close: "M6.2 4.8L12 10.6l5.8-5.8 1.4 1.4-5.8 5.8 5.8 5.8-1.4 1.4-5.8-5.8-5.8 5.8-1.4-1.4 5.8-5.8-5.8-5.8z",
      back: "M19 11H8.8l3.6-3.6L11 6l-6 6 6 6 1.4-1.4L8.8 13H19z",
      sound: "M4 9v6h4l5 4V5L8 9zm11.5 3a3.5 3.5 0 0 0-2-3.2v6.4a3.5 3.5 0 0 0 2-3.2zm-2-7.2v2.1A5.5 5.5 0 0 1 17.5 12a5.5 5.5 0 0 1-4 5.1v2.1A7.5 7.5 0 0 0 19.5 12a7.5 7.5 0 0 0-6-7.2z",
      boot: "M7 3h6v8l6 3v4H7v-3h3v-2H7z",
      scroll: "M6 3h12a2 2 0 0 1 2 2v2h-2V5H8v12h8v-2h2v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zm3 4h6v2H9zm0 4h6v2H9z",
      bolt: "M13 2L4 14h6l-1 8 9-12h-6z",
      check: "M9 16.2l-3.5-3.5L4 14.2l5 5 11-11-1.5-1.4z"
    };
    const svg = (name, size, color) => `<svg class="ic" viewBox="0 0 24 24" width="${size || 18}" height="${size || 18}" aria-hidden="true"><path fill="${color || "currentColor"}" d="${ICON[name]}"/></svg>`;

    const CSS = `
      .tt * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
      .tt { font-family: ${FONT}; color: #f3efe6; }
      .tt .glass { background: rgba(14,19,28,0.8); backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px);
        border: 1px solid rgba(255,255,255,0.09); box-shadow: 0 8px 28px rgba(0,0,0,0.45); }
      .tt .hud { position: absolute; display: flex; justify-content: space-between; align-items: flex-start; gap: 8px; pointer-events: none; }
      .tt .pill { display: flex; align-items: center; gap: 8px; padding: 8px 13px 8px 10px; border-radius: 16px; font-size: 13px; font-weight: 700; white-space: nowrap; }
      .tt .pill .muted { opacity: 0.68; font-weight: 600; }
      .tt .pill .gold { color: #ffd166; font-weight: 900; font-size: 16px; }
      .tt .emblem { width: 22px; height: 22px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center;
        font-size: 11px; font-weight: 900; color: #fff; text-shadow: 0 1px 2px rgba(0,0,0,0.5); box-shadow: inset -4px -4px 0 rgba(0,0,0,0.22), 0 0 0 2px rgba(255,255,255,0.14); flex: none; }
      .tt .ic { display: inline-block; vertical-align: -3px; flex: none; }
      .tt .btn { pointer-events: auto; border: 1px solid rgba(255,255,255,0.1); background: rgba(30,37,50,0.94); color: #f3efe6;
        font-family: ${FONT}; font-weight: 700; font-size: 13px; line-height: 1.15; padding: 10px 14px; border-radius: 14px;
        display: inline-flex; align-items: center; gap: 7px; cursor: pointer; white-space: nowrap; box-shadow: 0 3px 12px rgba(0,0,0,0.35);
        transition: transform 0.08s ease, filter 0.15s ease; }
      .tt .btn:active { transform: scale(0.95); filter: brightness(1.15); }
      .tt .btn.round { width: 42px; height: 42px; padding: 0; justify-content: center; border-radius: 50%; }
      .tt .btn.primary { background: linear-gradient(180deg, #ffd97a, #f2b53c); color: #221a06; border-color: rgba(255,255,255,0.3);
        box-shadow: 0 6px 20px rgba(242,181,60,0.38), inset 0 1px 0 rgba(255,255,255,0.5); font-weight: 900; font-size: 15px; padding: 12px 18px; }
      .tt .btn.accent { background: linear-gradient(180deg, #4f9df2, #2f7fd6); border-color: rgba(255,255,255,0.22); box-shadow: 0 5px 16px rgba(47,127,214,0.38); }
      .tt .btn.danger { background: linear-gradient(180deg, #ff7a6e, #e0493d); border-color: rgba(255,255,255,0.22); }
      .tt .btn.ghost { background: rgba(255,255,255,0.08); box-shadow: none; }
      .tt .btn.dim { opacity: 0.42; }
      .tt .btn.wide { min-width: 240px; justify-content: center; }
      .tt .btn .sub { display: block; font-size: 11px; font-weight: 600; opacity: 0.7; margin-top: 2px; }
      .tt .chip { pointer-events: auto; border: 1px solid rgba(255,255,255,0.08); background: rgba(255,255,255,0.08); color: #f3efe6;
        font-family: ${FONT}; font-weight: 700; font-size: 12.5px; padding: 8px 12px; border-radius: 999px; margin: 3px; cursor: pointer;
        display: inline-flex; align-items: center; gap: 6px; transition: transform 0.08s ease; }
      .tt .chip:active { transform: scale(0.95); }
      .tt .chip.on { background: #ffd166; color: #1a1408; border-color: #ffd166; box-shadow: 0 3px 12px rgba(255,209,102,0.35); }
      .tt .card { background: rgba(22,28,39,0.96); border: 1px solid rgba(255,255,255,0.07); border-radius: 18px; padding: 14px 16px; margin: 10px 0;
        box-shadow: 0 8px 28px rgba(0,0,0,0.4); }
      .tt .card.tinted { border-left: 4px solid var(--c, #ffd166); }
      .tt .h1 { font-size: 26px; font-weight: 900; letter-spacing: 0.2px; margin: 4px 0 6px; line-height: 1.15; }
      .tt .h2 { font-size: 15px; font-weight: 800; margin: 0 0 4px; }
      .tt .small { font-size: 12.5px; opacity: 0.78; line-height: 1.45; }
      .tt .label { font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: 1.1px; opacity: 0.6; margin: 14px 0 4px; }
      .tt .row { display: flex; align-items: center; gap: 10px; padding: 9px 0; border-top: 1px solid rgba(255,255,255,0.07); }
      .tt .row:first-child { border-top: none; }
      .tt .grow { flex: 1; min-width: 0; }
      .tt .stat { display: inline-flex; align-items: center; gap: 4px; font-size: 12px; opacity: 0.85; margin-right: 9px; }
      .tt .bar { height: 7px; border-radius: 4px; background: rgba(255,255,255,0.12); overflow: hidden; }
      .tt .bar > i { display: block; height: 100%; background: linear-gradient(90deg, #ffd166, #ffb347); border-radius: 4px; }
      .tt .panel { position: absolute; inset: 0; display: none; pointer-events: auto; background: rgba(8,11,17,0.9);
        overflow-y: auto; -webkit-overflow-scrolling: touch; }
      .tt .panel .inner { max-width: 520px; margin: 0 auto; }
      .tt .panel .inner.rise { animation: rise 0.26s ease-out; }
      .tt .sheet { position: absolute; left: 8px; right: 8px; border-radius: 20px; padding: 10px 12px 10px; pointer-events: none; display: none; animation: rise 0.2s ease-out; }
      .tt .sheet .head { display: flex; align-items: center; gap: 10px; }
      .tt .sheet .title { font-size: 15px; font-weight: 900; }
      .tt .sheet .info { font-size: 12px; opacity: 0.78; margin-top: 2px; line-height: 1.35; }
      .tt .sheet .actions { display: flex; gap: 7px; overflow-x: auto; padding: 8px 2px 2px; pointer-events: auto; scrollbar-width: none; }
      .tt .sheet .actions::-webkit-scrollbar { display: none; }
      .tt .toast { position: absolute; left: 50%; transform: translateX(-50%); max-width: 86%; padding: 10px 16px; border-radius: 16px;
        font-weight: 700; font-size: 13px; opacity: 0; transition: opacity 0.25s; pointer-events: none; text-align: center; }
      .tt .banner { position: absolute; left: 50%; transform: translateX(-50%); padding: 9px 16px; border-radius: 999px; font-weight: 800; font-size: 13px; display: none; pointer-events: none; }
      .tt .banner i { display: inline-block; width: 6px; height: 6px; border-radius: 50%; background: #ffd166; margin-left: 3px; animation: blink 1.2s infinite; }
      .tt .banner i:nth-child(2) { animation-delay: 0.2s; } .tt .banner i:nth-child(3) { animation-delay: 0.4s; }
      .tt .hero { text-align: center; padding-top: 10vh; }
      .tt .hero .title { font-size: 48px; font-weight: 900; letter-spacing: 1px; line-height: 1; text-shadow: 0 6px 24px rgba(0,0,0,0.7), 0 2px 0 rgba(255,209,102,0.35); }
      .tt .hero .rule { width: 110px; height: 3px; background: linear-gradient(90deg, transparent, #ffd166, transparent); margin: 14px auto; }
      .tt .vignette { position: absolute; inset: 0; pointer-events: none; background: radial-gradient(ellipse at 50% 45%, rgba(0,0,0,0) 55%, rgba(0,0,0,0.3) 100%); }
      .tt .reward { pointer-events: auto; flex: 1; background: rgba(22,28,39,0.96); border: 1px solid rgba(255,255,255,0.1); border-radius: 18px;
        padding: 18px 12px; color: #f3efe6; font-family: ${FONT}; cursor: pointer; text-align: center; transition: transform 0.08s ease; box-shadow: 0 8px 28px rgba(0,0,0,0.4); }
      .tt .reward:active { transform: scale(0.96); }
      .tt .podium { display: flex; align-items: center; gap: 10px; padding: 9px 0; border-top: 1px solid rgba(255,255,255,0.07); }
      .tt .rank { width: 26px; height: 26px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; font-weight: 900; font-size: 13px; background: rgba(255,255,255,0.1); flex: none; }
      .tt .rank.one { background: #ffd166; color: #1a1408; }
      .tt .tribe-card { display: flex; align-items: center; gap: 10px; }
      .tt .swatch { width: 38px; height: 38px; border-radius: 12px; flex: none; box-shadow: inset -6px -6px 0 rgba(0,0,0,0.2), 0 3px 10px rgba(0,0,0,0.4); }
      @keyframes rise { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: none; } }
      @keyframes blink { 0%, 100% { opacity: 0.25; } 50% { opacity: 1; } }
      @keyframes pulse { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.04); } }
    `;

    ui.className = "tt";
    ui.innerHTML =
      `<style>${CSS}</style>` +
      `<div class="vignette"></div>` +
      `<div data-el="hud" class="hud" style="left:${sa.left + 8}px;right:${sa.right + 8}px;top:${sa.top + 8}px;"></div>` +
      `<div data-el="banner" class="banner glass" style="top:${sa.top + 108}px;"></div>` +
      `<div data-el="toast" class="toast glass" style="top:${sa.top + 150}px;"></div>` +
      `<div data-el="sheet" class="sheet glass" style="bottom:${sa.bottom + 10}px;">` +
        `<div class="head"><div class="grow"><div data-el="title" class="title"></div><div data-el="info" class="info"></div></div>` +
        `<button data-act="endturn" data-el="end" class="btn primary">End turn ${svg("arrow", 18)}</button></div>` +
        `<div data-el="actions" class="actions"></div>` +
      `</div>` +
      `<div data-el="panel" class="panel"></div>`;

    const el = (n) => ui.querySelector('[data-el="' + n + '"]');
    const hudEl = el("hud"), bannerEl = el("banner"), toastEl = el("toast"), sheetEl = el("sheet"), titleEl = el("title"),
      infoEl = el("info"), actionsEl = el("actions"), endBtn = el("end"), panelEl = el("panel");

    function toast(msg) { toastEl.textContent = msg; toastEl.style.opacity = "1"; V.toastT = 2800; }
    function banner(msg) { bannerEl.innerHTML = msg ? esc(msg) + " <i></i><i></i><i></i>" : ""; bannerEl.style.display = msg ? "block" : "none"; }

    // ====================================================================== //
    // Sound: a music bed from the runtime, short synthesised cues of our own  //
    // ====================================================================== //
    let musicHandle = null, ac = null;
    async function startMusic() {
      if (!ctx.capabilities.backgroundMusic || !V.soundOn || musicHandle) return;
      try {
        await ctx.music.unlock();
        musicHandle = await ctx.music.play({ preset: "cozy", volume: clamp(Number(tune("music_volume", 0.3)), 0, 1) * 0.9, fadeInMs: 1800, intensity: 0.3, density: 0.4 });
      } catch (_) { musicHandle = null; }
    }
    function stopMusic() { if (!musicHandle) return; try { ctx.music.stop({ fadeOutMs: 600 }); } catch (_) {} musicHandle = null; }
    function sting(name) {
      if (!V.soundOn || !ctx.capabilities.backgroundMusic) return;
      try { const stingResult = ctx.music.sting(name); if (stingResult && stingResult.catch) stingResult.catch(() => {}); } catch (_) {}
    }
    function ensureAudio() {
      if (ac || !ctx.capabilities.audio) return;
      try { ac = new (window.AudioContext || window.webkitAudioContext)(); } catch (_) { ac = null; }
    }
    function tone(freq, dur, type, vol, when, slide) {
      if (!ac) return;
      const t0 = ac.currentTime + (when || 0);
      const o = ac.createOscillator(), gn = ac.createGain();
      o.type = type || "sine";
      o.frequency.setValueAtTime(freq, t0);
      if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, slide), t0 + dur);
      gn.gain.setValueAtTime(0.0001, t0);
      gn.gain.exponentialRampToValueAtTime(vol || 0.08, t0 + 0.01);
      gn.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      o.connect(gn); gn.connect(ac.destination);
      o.start(t0); o.stop(t0 + dur + 0.02);
    }
    function noise(dur, vol, cutoff) {
      if (!ac) return;
      const len = Math.floor(ac.sampleRate * dur);
      const buf = ac.createBuffer(1, len, ac.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
      const bufNode = ac.createBufferSource(); bufNode.buffer = buf;
      const f = ac.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = cutoff || 1200;
      const gn = ac.createGain(); gn.gain.value = vol || 0.12;
      bufNode.connect(f); f.connect(gn); gn.connect(ac.destination);
      bufNode.start();
    }
    function sfx(name) {
      if (!V.soundOn || !ac) return;
      try {
        if (ac.state === "suspended") ac.resume();
        switch (name) {
          case "tap": tone(880, 0.05, "triangle", 0.04); break;
          case "step": tone(220, 0.07, "triangle", 0.05, 0, 160); break;
          case "hit": noise(0.12, 0.16, 900); tone(140, 0.12, "square", 0.06, 0, 70); break;
          case "death": noise(0.25, 0.14, 600); tone(200, 0.3, "sawtooth", 0.05, 0, 50); break;
          case "build": tone(330, 0.08, "square", 0.05); tone(440, 0.1, "square", 0.05, 0.08); break;
          case "levelup": tone(523, 0.1, "triangle", 0.07); tone(659, 0.1, "triangle", 0.07, 0.1); tone(784, 0.18, "triangle", 0.07, 0.2); break;
          case "research": tone(660, 0.12, "sine", 0.07); tone(990, 0.2, "sine", 0.06, 0.1); break;
          case "endturn": tone(392, 0.1, "triangle", 0.06); tone(294, 0.16, "triangle", 0.06, 0.1); break;
          default: break;
        }
      } catch (_) { /* audio is a nicety */ }
    }

    // ====================================================================== //
    // HUD and the action sheet                                               //
    // ====================================================================== //
    let hudKey = "";
    function updateHud(force) {
      if (!S || V.screen !== "play") { hudEl.style.display = "none"; sheetEl.style.display = "none"; return; }
      hudEl.style.display = "flex"; sheetEl.style.display = "block";
      const p = V.viewer >= 0 ? V.viewer : S.cur;
      const pl = S.players[p];
      const tr = tribeByIndex(pl.tribe);
      const limit = S.mode === "perfection" ? " / " + S.turnLimit : "";
      // Score and income walk the whole map, so only recompute when something happened.
      const key = [p, pl.stars, S.turn, V.busy, S.cur, V.rev].join("|");
      if (key === hudKey && !force) return;
      hudKey = key;
      const inc = playerIncome(S, p);
      const score = computeScore(S, p);
      hudEl.innerHTML =
        `<div style="display:flex;flex-direction:column;gap:7px;align-items:flex-start;">` +
          `<div class="pill glass"><span class="emblem" style="background:${tr.color}">${esc(tr.name[0])}</span><span>${esc(tr.name)}</span><span class="muted">Turn ${S.turn}${limit}</span></div>` +
          `<div class="pill glass">${svg("star", 17, "#ffd166")}<span class="gold">${pl.stars}</span><span class="muted">+${inc}</span>` +
            `<span style="width:1px;height:16px;background:rgba(255,255,255,0.15);"></span>${svg("trophy", 16, "#cfd6e2")}<span class="muted">${score.toLocaleString()}</span></div>` +
        `</div>` +
        `<div style="display:flex;gap:8px;">` +
          `<button data-act="tech" class="btn round glass" aria-label="Technology">${svg("flask", 20)}</button>` +
          `<button data-act="gamemenu" class="btn round glass" aria-label="Menu">${svg("menu", 20)}</button>` +
        `</div>`;
      endBtn.style.opacity = isHumanTurn() ? "1" : "0.45";
      endBtn.innerHTML = S.over ? "Results " + svg("trophy", 18) : "End turn " + svg("arrow", 18);
    }

    function setSheet(title, info, buttons) {
      titleEl.innerHTML = title || "";
      infoEl.innerHTML = info || "";
      actionsEl.innerHTML = buttons.map((b) =>
        `<button data-act="${esc(b.act)}" class="btn${b.on === false ? " dim" : ""}${b.accent ? " accent" : ""}${b.danger ? " danger" : ""}">${b.icon ? svg(b.icon, 16) : ""}${esc(b.label)}</button>`).join("");
      actionsEl.style.display = buttons.length ? "flex" : "none";
    }
    const stat = (icon, s) => `<span class="stat">${svg(icon, 13)}${esc(s)}</span>`;
    function refreshActions() {
      if (!S || V.screen !== "play") return;
      if (!isHumanTurn()) { setSheet(V.busy ? "" : "", "", []); return; }
      const p = S.cur, pl = S.players[p];
      const u = V.sel;
      if (u && !u.dead) {
        const st = unitStats(u);
        const btns = [];
        if (canCapture(S, u)) { const c = cityAt(S, u.x, u.y); btns.push({ act: "unit:capture", label: c.owner < 0 ? "Capture village" : "Capture city", accent: true, icon: "flag" }); }
        if (canExamine(S, u)) btns.push({ act: "unit:examine", label: "Examine ruins", accent: true, icon: "eye" });
        if (canRecover(S, u)) btns.push({ act: "unit:recover", label: "Recover +" + (tilePlayer(S, tIdx(S, u.x, u.y)) === p ? 4 : 2), icon: "heart" });
        if (canHeal(S, u)) btns.push({ act: "unit:heal", label: "Heal others", icon: "heart" });
        if (canPromote(u)) btns.push({ act: "unit:promote", label: "Promote", icon: "star" });
        for (const b of boatUpgrades(S, u)) btns.push({ act: "unit:upgrade:" + b.kind, label: b.name + " ★" + b.cost, on: b.can, icon: "hammer" });
        const uc = cityAt(S, u.x, u.y);
        if (uc && uc.owner === p) btns.push({ act: "city:here", label: uc.name + " · train", icon: "city" });
        if (canDisband(S, u)) btns.push({ act: "unit:disband", label: "Disband +" + Math.floor(UNITS[u.type].cost / 2) + "★", icon: "coin" });
        btns.push({ act: "unit:done", label: "Done", icon: "check" });
        let hint = "";
        if (V.converts.length) hint = "Tap a purple tile to convert.";
        else if (V.targets.length && V.reach && V.reach.size) hint = "Tap a lit tile to move or a red tile to attack.";
        else if (V.targets.length) hint = "Tap a red tile to attack.";
        else if (V.reach && V.reach.size) hint = "Tap a lit tile to move.";
        else hint = "This unit has acted this turn.";
        setSheet(esc(unitName(u)) + (u.vet ? " ★" : ""),
          stat("heart", u.hp + "/" + maxHp(u)) + stat("sword", String(st.atk)) + stat("shield", String(st.def)) + stat("boot", String(st.mv)) + (st.rng > 1 ? stat("bolt", "range " + st.rng) : "") + "<br>" + esc(hint), btns);
        return;
      }
      if (V.selTile >= 0) {
        const i = V.selTile, x = i % S.n, y = (i - x) / S.n;
        const c = S.center[i] >= 0 ? S.cities[S.center[i]] : null;
        const acts = tileActions(S, p, x, y);
        const btns = acts.map((a) => ({
          act: "tile:" + a.id, on: a.can, icon: a.id === "harvest" || a.id === "whale" ? "coin" : a.id === "road" || a.id === "bridge" ? "boot" : "hammer",
          label: a.name + (a.cost ? " ★" + a.cost : "") + (a.pop ? " +" + a.pop + " pop" : "") + (a.stars ? " +" + a.stars + "★" : "")
        }));
        if (c && c.owner === p) btns.unshift({ act: "city:open", label: "Train units", accent: true, icon: "city" });
        let title = TERRAIN_NAME[S.terrain[i]];
        let info = "";
        if (S.res[i]) title = RES_NAME[S.res[i]] + " · " + title;
        if (S.bld[i] && BLD[S.bld[i]]) title = BLD[S.bld[i]].name + (BLD[S.bld[i]].temple ? " (level " + templeLevel(S, i) + ")" : "") + " · " + TERRAIN_NAME[S.terrain[i]];
        const tc = tileCity(S, i);
        if (c) title = (c.owner < 0 ? "Village" : esc(c.name) + (c.capital ? " ★" : "")) + (c.owner >= 0 && c.owner !== p ? " · " + tribeName(c.owner) : "");
        if (c && c.owner !== p) info = "Move a unit here, then capture it next turn.";
        else if (c) info = "Level " + c.level + " · " + c.pop + "/" + (c.level + 1) + " population · +" + cityIncome(S, c) + " a turn";
        else if (tc) info = (tc.owner === p ? "Your land, " : tribeName(tc.owner) + " land, ") + esc(tc.name) + (!acts.length && tc.owner === p && S.res[i] ? " · needs " + neededTech(S.res[i]) : "");
        else info = "Unclaimed land.";
        setSheet(title, info, btns);
        return;
      }
      setSheet("Your move", "Tap a unit to move it, a tile to work it, or a city to train.", []);
    }
    const neededTech = (r) => ({ 1: "Organization", 2: "Farming", 3: "Hunting", 4: "Fishing", 5: "Mining", 6: "Whaling" }[r] || "");

    // ====================================================================== //
    // Selection                                                              //
    // ====================================================================== //
    function deselect() { V.sel = null; V.selTile = -1; V.reach = null; V.targets = []; V.converts = []; refreshActions(); V.dirty = true; }
    function select(u) {
      V.sel = u; V.selTile = -1;
      V.reach = reachable(S, u);
      V.targets = attackTargets(S, u);
      V.converts = convertTargets(S, u);
      refreshActions(); V.dirty = true;
    }
    function selectTile(i) { V.sel = null; V.selTile = i; V.reach = null; V.targets = []; V.converts = []; refreshActions(); V.dirty = true; }
    function refreshSel() {
      if (V.sel) {
        if (V.sel.dead || V.sel.owner !== S.cur) { deselect(); return; }
        const u = V.sel;
        V.reach = reachable(S, u); V.targets = attackTargets(S, u); V.converts = convertTargets(S, u);
        if (!V.reach.size && !V.targets.length && !V.converts.length && !canCapture(S, u) && !canExamine(S, u) && !canRecover(S, u) && !canHeal(S, u)) {
          V.sel = null;
        }
      }
      refreshActions(); updateHud(); V.dirty = true;
    }
    function afterHumanAction(kind) {
      V.rev++;
      harvestEvents();
      refreshSel();
      try { ctx.platform.interact({ type: kind, turn: S.turn }); } catch (_) {}
      if (S.over) { V.busy = true; waitReplayThen(() => { V.busy = false; showGameOver(); }); return; }
      const r = pendingRewardFor(S, S.cur);
      if (r) openPanel("reward", r);
    }

    function onTapTile(tx, ty) {
      if (!S || V.screen !== "play") return;
      if (!isHumanTurn()) return;
      if (!inBounds(S, tx, ty)) { deselect(); return; }
      const i = tIdx(S, tx, ty);
      const p = S.cur;
      if (!S.players[p].explored[i]) { deselect(); return; }
      const u = unitAt(S, tx, ty);
      if (V.sel && !V.sel.dead) {
        if (V.reach && V.reach.has(i)) {
          const path = pathTo(V.reach, i);
          moveUnit(S, V.sel, i, path);
          sfx("step"); haptic("light");
          afterHumanAction("move");
          return;
        }
        if (u && V.targets.indexOf(u) >= 0) {
          attack(S, V.sel, u);
          afterHumanAction("attack");
          return;
        }
        if (u && V.converts.indexOf(u) >= 0) {
          convertUnit(S, V.sel, u);
          sting("powerup");
          afterHumanAction("convert");
          return;
        }
      }
      if (u && u.owner === p) {
        if (V.sel === u) { selectTile(i); return; }
        select(u); sfx("tap"); haptic("light");
        return;
      }
      const c = cityAt(S, tx, ty);
      if (c && c.owner === p && V.selTile === i) { openPanel("city", c); return; }
      selectTile(i);
      haptic("light");
    }

    function unitAction(act) {
      const u = V.sel;
      if (!u || !isHumanTurn()) return;
      if (act === "unit:capture") { if (captureCity(S, u)) { try { ctx.platform.milestone("city_captured", { turn: S.turn }); } catch (_) {} afterHumanAction("capture"); } }
      else if (act === "unit:examine") { if (examineRuins(S, u)) afterHumanAction("ruins"); }
      else if (act === "unit:recover") { if (recover(S, u)) afterHumanAction("recover"); }
      else if (act === "unit:heal") { if (healOthers(S, u)) afterHumanAction("heal"); }
      else if (act === "unit:promote") { if (promote(S, u)) { sting("powerup"); afterHumanAction("promote"); } }
      else if (act === "unit:disband") { if (disband(S, u)) afterHumanAction("disband"); }
      else if (act.indexOf("unit:upgrade:") === 0) { if (upgradeBoat(S, u, Number(act.split(":")[2]))) { sfx("build"); afterHumanAction("upgrade"); } }
      else if (act === "unit:done") deselect();
    }
    function tileAction(id) {
      if (V.selTile < 0 || !isHumanTurn()) return;
      const x = V.selTile % S.n, y = (V.selTile - x) / S.n;
      if (doTileAction(S, S.cur, x, y, id)) { sfx("build"); haptic("light"); afterHumanAction("tile:" + id); }
    }

    // ====================================================================== //
    // Panels                                                                 //
    // ====================================================================== //
    const setup = { mode: "perfection", size: "normal", type: "lakes", limit: 30, players: [{ tribe: 0, kind: "human" }, { tribe: 1, kind: "normal" }, { tribe: 3, kind: "normal" }] };
    let savedGame = null;       // compact save found at startup

    function openPanel(name, arg) {
      // Re-rendering the panel that is already open (a chip tapped in setup,
      // a technology bought) keeps its scroll position and does not replay
      // the rise; a new panel starts at the top.
      const same = V.panel === name && V.panelArg === arg && panelEl.style.display === "block";
      const keep = same ? panelEl.scrollTop : 0;
      V.panel = name; V.panelArg = arg;
      panelEl.style.display = "block";
      panelEl.innerHTML = `<div class="inner${same ? "" : " rise"}" style="padding:${sa.top + 14}px 14px ${sa.bottom + 28}px;">` + panelHtml(name, arg) + `</div>`;
      panelEl.scrollTop = keep;
      V.dirty = true;
    }
    function closePanel() { V.panel = null; panelEl.style.display = "none"; panelEl.innerHTML = ""; V.dirty = true; }
    const h1 = (s) => `<div class="h1">${esc(s)}</div>`;
    const small = (s) => `<div class="small">${s}</div>`;
    const label = (s) => `<div class="label">${esc(s)}</div>`;
    const chip = (act, text, on, icon) => `<button data-act="${esc(act)}" class="chip${on ? " on" : ""}">${icon ? svg(icon, 14) : ""}${esc(text)}</button>`;
    const closeBtn = (text, icon) => `<div style="text-align:center;margin-top:18px;"><button data-act="close" class="btn primary">${svg(icon || "check", 16)}${esc(text || "Done")}</button></div>`;
    const modeBlurb = (id) => (MODES.find((m) => m.id === id) || MODES[0]).blurb;

    function panelHtml(name, arg) {
      switch (name) {
        case "menu": {
          const has = !!(S && !S.over && V.screen === "play") || !!savedGame;
          return `<div class="hero">` +
            `<div style="color:#ffd166;letter-spacing:8px;font-size:22px;margin-bottom:4px;">${svg("star", 22, "#ffd166")}${svg("star", 28, "#ffd166")}${svg("star", 22, "#ffd166")}</div>` +
            `<div class="title">Polytopia</div>` +
            `<div class="rule"></div>` +
            `<div class="small" style="margin:0 20px 26px;">Grow a tribe from one village to an empire — in thirty turns, or until nobody else is left.</div>` +
            `<div style="display:flex;flex-direction:column;gap:10px;align-items:center;">` +
            (has ? `<button data-act="menu:continue" class="btn primary wide">${svg("play", 18)}Continue game</button>` : "") +
            `<button data-act="menu:new" class="btn ${has ? "" : "primary "}wide">${svg("flag", 18)}New game</button>` +
            `<button data-act="menu:help" class="btn ghost wide">${svg("book", 18)}How to play</button>` +
            `<button data-act="menu:board" class="btn ghost wide">${svg("chart", 18)}Leaderboards</button>` +
            `</div></div>`;
        }
        case "setup": {
          const size = MAP_SIZES.find((s) => s.id === setup.size) || MAP_SIZES[2];
          const maxP = size.maxPlayers;
          while (setup.players.length > maxP) setup.players.pop();
          const kinds = [["human", "Human"], ["easy", "Easy"], ["normal", "Normal"], ["hard", "Hard"], ["crazy", "Crazy"]];
          const prow = setup.players.map((pp, k) => {
            const tr = tribeByIndex(pp.tribe);
            return `<div class="card tinted" style="--c:${tr.color};padding:10px 12px;">` +
              `<div class="tribe-card">` +
                `<button data-act="setup:tribe:${k}:-1" class="btn round ghost" aria-label="Previous tribe">${svg("back", 18)}</button>` +
                `<div class="swatch" style="background:${tr.color};"></div>` +
                `<div class="grow"><div class="h2">${esc(tr.name)}</div><div class="small">${esc(tr.tech ? "Starts with " + TECHS[tr.tech].name : "Starts with a level 3 capital")}</div></div>` +
                `<button data-act="setup:tribe:${k}:1" class="btn round ghost" aria-label="Next tribe">${svg("arrow", 18)}</button>` +
                (setup.players.length > 2 ? `<button data-act="setup:remp:${k}" class="btn round ghost" aria-label="Remove">${svg("close", 16)}</button>` : "") +
              `</div>` +
              `<div style="margin-top:6px;">${kinds.map((kd) => chip("setup:kind:" + k + ":" + kd[0], kd[1], pp.kind === kd[0], kd[0] === "human" ? "users" : null)).join("")}</div>` +
            `</div>`;
          }).join("");
          return h1("New game") +
            label("Mode") + `<div>${MODES.map((m) => chip("setup:mode:" + m.id, m.name, setup.mode === m.id)).join("")}</div>` + small(esc(modeBlurb(setup.mode))) +
            (setup.mode === "perfection" ? label("Turns") + `<div>${[20, 30, 40, 50].map((n) => chip("setup:limit:" + n, String(n), setup.limit === n)).join("")}</div>` : "") +
            label("Map size") + `<div>${MAP_SIZES.map((s) => chip("setup:size:" + s.id, s.name + " " + s.n + "²", setup.size === s.id)).join("")}</div>` +
            label("Map type") + `<div>${MAP_TYPES.map((t) => chip("setup:type:" + t.id, t.name, setup.type === t.id)).join("")}</div>` +
            label("Tribes · " + setup.players.length + " of " + maxP) + prow +
            (setup.players.length < maxP ? `<button data-act="setup:addp" class="btn ghost">${svg("users", 16)}Add a tribe</button>` : "") +
            `<div style="display:flex;gap:10px;justify-content:center;margin-top:20px;">` +
              `<button data-act="setup:back" class="btn ghost">${svg("back", 16)}Back</button>` +
              `<button data-act="setup:start" class="btn primary">${svg("play", 18)}Start</button>` +
            `</div>` + small("Two or more humans play pass-and-play on this phone. Bots fill the rest.");
        }
        case "tech": {
          const p = S.cur, pl = S.players[p];
          const item = (t) => {
            const d = TECHS[t];
            const have = hasTech(S, p, t);
            const avail = techAvailable(S, p, t);
            const cost = techCost(S, p, t);
            const can = avail && pl.stars >= cost;
            return `<div class="row" style="margin-left:${(d.tier - 1) * 18}px;${d.tier > 1 ? "border-left:2px solid rgba(255,255,255,0.08);padding-left:10px;" : ""}">` +
              `<div class="grow"><div class="h2" style="${have ? "color:#9be37d;" : avail ? "" : "opacity:0.5;"}">${esc(d.name)} <span class="small" style="display:inline;">T${d.tier}</span></div>` +
              `<div class="small">${esc(d.blurb)}</div></div>` +
              (have ? `<span style="color:#9be37d;">${svg("check", 20, "#9be37d")}</span>` :
                `<button data-act="tech:${t}" class="btn${can ? " accent" : " dim"}">${svg("star", 14, can ? "#fff" : "#ffd166")}${cost}</button>`) +
            `</div>`;
          };
          const branch = (root) => `<div class="card">` + item(root) + techChildren(root).map((c) => item(c) + techChildren(c).map(item).join("")).join("") + `</div>`;
          return h1("Technology") + small(`${svg("star", 13, "#ffd166")} ${pl.stars} available · a technology costs ${TECH_BASE} + tier × your cities${hasTech(S, p, "philosophy") ? ", minus " + Math.round(PHILOSOPHY_DISCOUNT * 100) + "% for Philosophy" : ""}.`) +
            TECH_ROOTS.map(branch).join("") + closeBtn("Back to the map", "back");
        }
        case "city": {
          const c = arg, p = c.owner;
          const units = TRAINABLE.map((t) => {
            const d = UNITS[t];
            const st = canTrain(S, c, t);
            if (st === null) return "";
            const can = st === "ok";
            const why = st === "occupied" ? "tile occupied" : st === "full" ? "city full" : st === "stars" ? "not enough stars" : "";
            return `<div class="row">` +
              `<div class="grow"><div class="h2">${esc(d.name)}</div><div class="small">${stat("heart", String(d.hp))}${stat("sword", String(d.atk))}${stat("shield", String(d.def))}${stat("boot", String(d.mv))}${d.rng > 1 ? stat("bolt", "range " + d.rng) : ""}${d.skills ? " · " + esc(d.skills.split(" ").join(", ")) : ""}</div></div>` +
              (why ? `<span class="small" style="width:70px;text-align:right;">${why}</span>` : "") +
              `<button data-act="train:${t}" class="btn${can ? " accent" : " dim"}">${svg("star", 14, can ? "#fff" : "#ffd166")}${d.cost}</button>` +
            `</div>`;
          }).join("");
          const inc = cityIncome(S, c);
          const tr = tribeByIndex(S.players[p].tribe);
          return `<div class="card tinted" style="--c:${tr.color};">` +
              `<div class="tribe-card"><div class="swatch" style="background:${tr.color};"></div><div class="grow"><div class="h1" style="margin:0;">${esc(c.name)}${c.capital ? " ★" : ""}</div><div class="small">Level ${c.level} · +${inc} stars a turn · units ${cityUnits(S, c)} of ${unitCap(c)}${c.walls ? " · walled" : ""}${c.workshop ? " · workshop" : ""}${c.parks ? " · parks " + c.parks : ""}${c.border > 1 ? " · wide borders" : ""}</div></div></div>` +
              `<div class="label">Population ${c.pop} of ${c.level + 1}</div><div class="bar"><i style="width:${Math.round(100 * c.pop / (c.level + 1))}%"></i></div>` +
              `<div class="small" style="margin-top:8px;">Work the tiles inside the border to add population. Each level adds a star every turn and room for one more unit.</div>` +
            `</div>` +
            `<div class="card"><div class="label" style="margin-top:0;">Train</div>${units}</div>` + closeBtn("Back to the map", "back");
        }
        case "reward": {
          const c = S.cities[arg.city];
          const opts = rewardsFor(arg.level);
          const icons = { workshop: "hammer", explorer: "eye", walls: "shield", resources: "star", popgrowth: "users", border: "flag", park: "heart", superunit: "sword" };
          return `<div style="padding-top:14vh;text-align:center;">` + h1(c.name + " reached level " + arg.level) + small("Choose a reward") +
            `<div style="display:flex;gap:10px;margin-top:16px;">` + opts.map((o) =>
              `<button data-act="reward:${o.id}" class="reward"><div style="color:#ffd166;margin-bottom:6px;">${svg(icons[o.id] || "star", 28, "#ffd166")}</div>` +
                `<div class="h2" style="font-size:16px;">${esc(o.name)}</div><div class="small">${esc(o.blurb)}</div></button>`).join("") +
            `</div></div>`;
        }
        case "pass": {
          const tr = tribeByIndex(S.players[S.cur].tribe);
          return `<div class="hero" style="padding-top:22vh;">` +
            `<div class="swatch" style="width:72px;height:72px;border-radius:50%;margin:0 auto 16px;background:${tr.color};"></div>` +
            h1("Pass the phone") + small("It is the <b>" + esc(tr.name) + "</b> turn. Only they should look.") +
            `<div style="margin-top:24px;"><button data-act="pass:go" class="btn primary wide">${svg("users", 18)}I am the ${esc(tr.name)}</button></div></div>`;
        }
        case "over": {
          refreshScores(S);
          const ranked = S.players.slice().sort((a, b) => (b.alive - a.alive) || (b.score - a.score));
          const rows = ranked.map((pl, k) => {
            const tr = tribeByIndex(pl.tribe);
            return `<div class="podium" style="${pl.alive ? "" : "opacity:0.5;"}">` +
              `<span class="rank${k === 0 ? " one" : ""}">${k + 1}</span>` +
              `<span class="emblem" style="background:${tr.color}">${esc(tr.name[0])}</span>` +
              `<span class="grow"><b>${esc(tr.name)}</b> <span class="small" style="display:inline;">${pl.human ? "human" : pl.ai + " bot"}${pl.alive ? "" : " · fallen"}</span></span>` +
              `<span class="small">${numCities(S, pl.id)} cities</span>` +
              `<b>${pl.score.toLocaleString()}</b></div>`;
          }).join("");
          const w = S.winner >= 0 ? S.players[S.winner] : null;
          const title = w ? (w.human ? (S.players.filter((q) => q.human).length > 1 ? tribeName(w.id) + " win" : "Victory") : "Defeat") : "Game over";
          const sub = w ? ("The " + tribeName(w.id) + (S.mode === "perfection" ? " scored highest after " + S.turnLimit + " turns." : S.mode === "glory" ? " reached " + GLORY_SCORE.toLocaleString() + " points." : S.mode === "might" ? " hold every capital." : " are the last tribe standing.")) : "";
          return `<div style="padding-top:8vh;"><div style="text-align:center;color:#ffd166;">${svg("trophy", 40, w && w.human ? "#ffd166" : "#8c93a1")}</div>` + `<div class="h1" style="text-align:center;font-size:34px;">${esc(title)}</div>` + `<div class="small" style="text-align:center;">${esc(sub)} Turn ${S.turn}.</div>` +
            `<div class="card">${rows}</div>` +
            (V.recordNote ? small(V.recordNote) : "") +
            `<div style="display:flex;gap:10px;justify-content:center;margin-top:16px;flex-wrap:wrap;">` +
              `<button data-act="over:again" class="btn primary">${svg("play", 16)}Play again</button>` +
              `<button data-act="over:menu" class="btn ghost">${svg("menu", 16)}Main menu</button>` +
              `<button data-act="close" class="btn ghost">${svg("eye", 16)}Look at the map</button>` +
            `</div></div>`;
        }
        case "gamemenu": {
          return `<div class="hero" style="padding-top:10vh;">` + h1("Paused") +
            `<div style="display:flex;flex-direction:column;gap:10px;align-items:center;margin-top:10px;">` +
            `<button data-act="close" class="btn primary wide">${svg("play", 18)}Resume</button>` +
            `<button data-act="game:tasks" class="btn ghost wide">${svg("scroll", 18)}Tasks and monuments</button>` +
            `<button data-act="game:help" class="btn ghost wide">${svg("book", 18)}How to play</button>` +
            `<button data-act="game:sound" class="btn ghost wide">${svg("sound", 18)}Sound: ${V.soundOn ? "on" : "off"}</button>` +
            `<button data-act="menu:board" class="btn ghost wide">${svg("chart", 18)}Leaderboards</button>` +
            `<button data-act="game:quit" class="btn ghost wide">${svg("flag", 18)}Save and leave</button>` +
            `</div></div>`;
        }
        case "tasks": {
          const p = V.viewer >= 0 ? V.viewer : S.cur, pl = S.players[p];
          const rows = TASKS.map((t) => `<div class="row">` +
            `<span style="color:${pl.built[t.id] ? "#ffd166" : pl.tasks[t.id] ? "#9be37d" : "rgba(255,255,255,0.3)"};">${svg(pl.built[t.id] ? "star" : pl.tasks[t.id] ? "check" : "scroll", 20)}</span>` +
            `<div class="grow"><div class="h2">${esc(t.name)}</div><div class="small">${esc(t.desc)}${pl.tasks[t.id] && !pl.built[t.id] ? " · ready to build on any empty tile you own" : ""}</div></div></div>`).join("");
          return h1("Tasks") + small("Finish a task and its monument becomes free to build: +3 population and +" + MONUMENT_SCORE + " score.") + `<div class="card">${rows}</div>` + closeBtn("Back", "back");
        }
        case "help": return h1("How to play") + helpHtml() + closeBtn("Back", "back");
        case "board": {
          const diff = arg || "normal";
          return h1("Leaderboards") +
            `<div>${DIFFICULTIES.map((d) => chip("board:" + d.id, d.name, diff === d.id)).join("")}</div>` +
            `<div data-el="boardbody" class="card">Loading…</div>` + small("Perfection scores after the final turn, single player against bots of that difficulty.") + closeBtn("Back", "back");
        }
        default: return "";
      }
    }
    function helpHtml() {
      const card = (icon, t, b) => `<div class="card"><div class="h2">${svg(icon, 16, "#ffd166")} ${esc(t)}</div>${small(b)}</div>`;
      return card("star", "Turns and stars", "Every turn your cities pay stars. Spend them on technology, on working the land, and on units. Tap <b>End turn</b> when you are done.") +
        card("city", "Cities", "Harvest fruit, hunt animals, fish, farm and mine inside a city's border to add population. Fill the bar and the city levels up: it earns one more star a turn, supports one more unit, and lets you pick a reward.") +
        card("boot", "Units", "Tap a unit, then a lit tile to move or a red tile to attack. Moving into a forest, a mountain, or next to an enemy ends the move. Stand on a village or an enemy city for a turn, then capture it. A unit that does nothing can recover health.") +
        card("sword", "Combat", "Damage depends on attack, defence and remaining health. Defenders fight back if you are in their reach. Units in their own city defend harder, and much harder behind a wall.") +
        card("flask", "Technology", "Five roots, each with two branches. Costs rise with the number of cities you own. Tribes start with one technology already known.") +
        card("trophy", "Winning", "<b>Perfection</b>: highest score after the final turn. <b>Domination</b>: last tribe standing. <b>Glory</b>: first to " + GLORY_SCORE.toLocaleString() + " points. <b>Might</b>: hold every capital.");
    }
    async function fillBoard(diff) {
      const host = panelEl.querySelector('[data-el="boardbody"]');
      if (!host) return;
      let rows = [];
      try {
        const lb = await ctx.memory.record("perfection").leaderboard({ scope: "global", period: "all_time", dimensions: { difficulty: diff } });
        rows = (lb && (lb.entries || lb.rows || lb.items)) || [];
      } catch (_) { rows = null; }
      if (!panelEl.querySelector('[data-el="boardbody"]')) return;
      if (rows === null) { host.innerHTML = small("Leaderboards are not available right now."); return; }
      if (!rows.length) { host.innerHTML = small("No scores yet. Finish a Perfection game to post one."); return; }
      host.innerHTML = rows.slice(0, 20).map((row, k) => {
        const who = (row.user && (row.user.handle || row.user.displayName || row.user.username)) || row.handle || row.displayName || "someone";
        return `<div class="podium" style="${row.self ? "color:#ffd166;" : ""}"><span class="rank${k === 0 ? " one" : ""}">${row.rank || k + 1}</span><span class="grow">${esc(who)}</span><b>${esc(row.label || row.value)}</b></div>`;
      }).join("");
    }

    // ---- One delegate for every button in the bit.
    ctx.listen(ui, "click", (e) => {
      const b = e.target && e.target.closest ? e.target.closest("[data-act]") : null;
      if (!b) return;
      e.stopPropagation();
      firstGesture();
      handleAct(b.getAttribute("data-act"));
    });
    ctx.listen(ui, "pointerdown", (e) => { if (e.target && e.target.closest && e.target.closest("[data-act]")) e.stopPropagation(); });

    function handleAct(act) {
      const parts = act.split(":");
      switch (parts[0]) {
        case "close": closePanel(); if (V.screen === "play") { refreshActions(); updateHud(true); } break;
        case "endturn": if (S && S.over) { openPanel("over"); break; } onEndTurn(); break;
        case "tech": if (parts.length === 1) { if (S && V.screen === "play" && isHumanTurn()) openPanel("tech"); }
          else if (research(S, S.cur, parts[1])) { sfx("research"); afterHumanAction("research"); openPanel("tech"); } break;
        case "gamemenu": openPanel("gamemenu"); break;
        case "unit": unitAction(act); break;
        case "tile": tileAction(parts.slice(1).join(":")); break;
        case "city": {
          let c = null;
          if (parts[1] === "here" && V.sel) c = cityAt(S, V.sel.x, V.sel.y);
          else if (V.selTile >= 0) c = S.center[V.selTile] >= 0 ? S.cities[S.center[V.selTile]] : null;
          if (c && c.owner === S.cur) openPanel("city", c);
          break;
        }
        case "train": { const c = V.panelArg; if (c && trainUnit(S, c, parts[1])) { sfx("build"); haptic("light"); afterHumanAction("train"); openPanel("city", c); } break; }
        case "reward": { const r = V.panelArg; applyReward(S, S.cities[r.city], parts[1]); sfx("levelup"); closePanel(); afterHumanAction("reward"); break; }
        case "pass": closePanel(); V.hideMap = false; beginHuman(); break;
        case "menu":
          if (parts[1] === "new") openPanel("setup");
          else if (parts[1] === "continue") continueGame();
          else if (parts[1] === "help") openPanel("help");
          else if (parts[1] === "board") { openPanel("board", "normal"); fillBoard("normal"); }
          break;
        case "board": openPanel("board", parts[1]); fillBoard(parts[1]); break;
        case "setup": setupAct(parts); break;
        case "game":
          if (parts[1] === "tasks") openPanel("tasks");
          else if (parts[1] === "help") openPanel("help");
          else if (parts[1] === "sound") { V.soundOn = !V.soundOn; saveSettings(); if (V.soundOn) startMusic(); else stopMusic(); openPanel("gamemenu"); }
          else if (parts[1] === "quit") { save(true, true); V.screen = "menu"; V.demo = true; deselect(); updateHud(); openPanel("menu"); }
          break;
        case "over":
          if (parts[1] === "menu") { V.screen = "menu"; V.demo = true; savedGame = null; updateHud(); openPanel("menu"); }
          else if (parts[1] === "again") { startGame(lastCfg ? Object.assign({}, lastCfg, { seed: (Math.random() * 4294967295) >>> 0 }) : buildCfg()); }
          break;
        default: break;
      }
    }
    function setupAct(parts) {
      const k = Number(parts[2]);
      switch (parts[1]) {
        case "mode": setup.mode = parts[2]; break;
        case "size": setup.size = parts[2]; break;
        case "type": setup.type = parts[2]; break;
        case "limit": setup.limit = Number(parts[2]); break;
        case "addp": { const used = setup.players.map((q) => q.tribe); let t = 0; while (used.indexOf(t) >= 0 && t < TRIBES.length - 1) t++; setup.players.push({ tribe: t, kind: "normal" }); break; }
        case "remp": setup.players.splice(k, 1); break;
        case "tribe": { const used = setup.players.map((q) => q.tribe); let t = setup.players[k].tribe; for (let s = 0; s < TRIBES.length; s++) { t = (t + Number(parts[3]) + TRIBES.length) % TRIBES.length; if (used.indexOf(t) < 0) break; } setup.players[k].tribe = t; break; }
        case "kind": setup.players[k].kind = parts[3]; break;
        case "back": openPanel("menu"); return;
        case "start": startGame(buildCfg()); return;
        default: break;
      }
      openPanel("setup");
    }
    let lastCfg = null;
    function buildCfg() {
      const size = MAP_SIZES.find((s) => s.id === setup.size) || MAP_SIZES[2];
      return {
        n: size.n, mapType: setup.type, mode: setup.mode, seed: (Math.random() * 4294967295) >>> 0,
        turnLimit: setup.mode === "perfection" ? (Number(tune("turn_limit", 0)) || setup.limit) : ENDLESS_CAP,
        players: setup.players.map((q) => ({ tribe: q.tribe, human: q.kind === "human", ai: q.kind === "human" ? null : q.kind }))
      };
    }

    // ====================================================================== //
    // Turn flow                                                              //
    // ====================================================================== //
    const humans = () => (S ? S.players.filter((q) => q.human) : []);
    const nextHuman = () => {
      if (!S) return 0;
      for (let k = 0; k < S.players.length; k++) { const q = (S.cur + k) % S.players.length; if (S.players[q].human && S.players[q].alive) return q; }
      const any = S.players.findIndex((q) => q.human);
      return any >= 0 ? any : 0;
    };

    function startGame(cfg) {
      lastCfg = cfg;
      S = generateWorld(cfg);
      V.recordNote = "";
      V.screen = "play"; V.demo = false; V.hideMap = false; V.busy = false; V.reported = false;
      V.replay = []; V.vis.clear(); V.ghosts.clear(); V.flash.clear(); V.floats = []; V.pendingMoves.clear();
      V.lastHuman = -1;
      firstTurn(S);
      S.events.length = 0;
      const h = S.players.findIndex((q) => q.human);
      V.viewer = h >= 0 ? h : 0;
      const cap = S.cities[V.viewer];
      centerOn(cap.x, cap.y, START_ZOOM);
      cam.y += SHEET_LIFT / cam.z;
      closePanel();
      deselect();
      updateHud(true);
      try { ctx.platform.start({ mode: cfg.mode, players: cfg.players.length, n: cfg.n }); } catch (_) {}
      V.started = true;
      save(true, true);
      advance();
    }
    function continueGame() {
      if (S && !S.over && V.screen === "play") { closePanel(); updateHud(true); refreshActions(); return; }
      if (S && V.screen === "play") { closePanel(); return; }
      const loaded = savedGame ? deserialize(savedGame) : null;
      if (!loaded) { openPanel("setup"); return; }
      S = loaded;
      V.screen = "play"; V.demo = false; V.hideMap = false; V.busy = false; V.recordNote = ""; V.reported = false;
      V.replay = []; V.vis.clear(); V.ghosts.clear(); V.flash.clear(); V.floats = []; V.pendingMoves.clear();
      V.viewer = nextHuman();
      V.lastHuman = humans().length > 1 ? -1 : S.cur;
      const cap = S.cities.find((c) => c.owner === V.viewer && c.capital) || S.cities[0];
      centerOn(cap.x, cap.y, START_ZOOM);
      cam.y += SHEET_LIFT / cam.z;
      closePanel();
      deselect();
      updateHud(true);
      try { ctx.platform.start({ resumed: true }); } catch (_) {}
      V.started = true;
      advance();
    }
    function advance() {
      if (!S) return;
      if (S.over) { showGameOver(); return; }
      const q = curPlayer();
      if (!q.human) { runAi(); return; }
      if (humans().length > 1 && V.lastHuman !== S.cur) {
        V.hideMap = true; V.viewer = S.cur; deselect(); updateHud(true);
        openPanel("pass");
        return;
      }
      beginHuman();
    }
    function beginHuman() {
      V.viewer = S.cur; V.lastHuman = S.cur; V.busy = false; V.hideMap = false; V.rev++;
      banner("");
      if (S.turn === 1 || humans().length > 1) {
        const cap = S.cities.find((c) => c.owner === S.cur && c.capital);
        if (cap) { panTo(cap.x, cap.y, cam.z, 500); cam.ty += SHEET_LIFT / cam.tz; }
      }
      deselect(); updateHud(true);
      try { if (S.mode === "perfection") ctx.platform.setProgress(clamp((S.turn - 1) / S.turnLimit, 0, 1)); } catch (_) {}
      const r = pendingRewardFor(S, S.cur);
      if (r) openPanel("reward", r);
    }
    function onEndTurn() {
      if (!S || S.over) return;
      if (!isHumanTurn()) return;
      const r = pendingRewardFor(S, S.cur);
      if (r) { openPanel("reward", r); return; }
      sfx("endturn"); haptic("light");
      deselect();
      endTurn(S);
      try { ctx.platform.interact({ type: "end_turn", turn: S.turn }); } catch (_) {}
      harvestEvents();
      save(false, true);
      V.busy = true;
      waitReplayThen(() => { V.busy = false; advance(); });
    }
    function runAi() {
      V.busy = true;
      deselect();
      V.viewer = nextHuman();
      banner(tribeName(S.cur) + " are thinking");
      updateHud(true);
      ctx.timeout(() => {
        if (!S || S.over || V.screen !== "play") { V.busy = false; banner(""); if (S && S.over) showGameOver(); return; }
        try { aiTurn(S, S.cur); } catch (err) { try { ctx.platform.error({ where: "ai", message: String(err && err.message || err) }); } catch (_) {} }
        endTurn(S);
        harvestEvents();
        V.rev++;
        waitReplayThen(() => {
          banner("");
          V.busy = false;
          if (S.over) { showGameOver(); return; }
          if (!curPlayer().human) { runAi(); return; }
          save(false);
          advance();
        });
      }, 80);
    }
    function waitReplayThen(fn) { if (!V.replay.length) fn(); else V.afterReplay = fn; }

    function showGameOver() {
      V.busy = false; banner("");
      refreshScores(S);
      deselect(); updateHud(true);
      const w = S.winner >= 0 ? S.players[S.winner] : null;
      const me = humans()[0];
      const single = humans().length === 1;
      if (w && w.human) { sting("win"); haptic("success"); } else { sting("lose"); }
      if (!V.reported) {
        V.reported = true;
        try {
          if (single && me) {
            if (w && w.id === me.id) ctx.platform.complete({ mode: S.mode, turn: S.turn, score: me.score });
            else ctx.platform.fail({ mode: S.mode, turn: S.turn, score: me.score });
          } else ctx.platform.complete({ mode: S.mode, turn: S.turn, passAndPlay: true });
        } catch (_) {}
        if (single && me) submitRecords(me, w && w.id === me.id);
        fireAndForget(() => ctx.game && ctx.game.progress && single && ctx.game.progress.complete("main", {
          state: { finished: true, mode: S.mode, turn: S.turn }, label: "Finished", percent: 100 }));
        fireAndForget(() => ctx.storage.remove("tt_save"));
        savedGame = null;
        if (w && w.human && ctx.pulse && ctx.pulse.complete) {
          fireAndForget(() => ctx.pulse.complete({ mode: S.mode, score: w.score, level: S.turn,
            text: "Won a game of Polytopia (" + MODES.find((m) => m.id === S.mode).name + ") as the " + tribeName(w.id) + " with " + w.score.toLocaleString() + " points" }));
        }
      }
      openPanel("over");
    }
    async function submitRecords(me, won) {
      const bots = S.players.filter((q) => q.ai);
      if (!bots.length) return;
      const order = ["easy", "normal", "hard", "crazy"];
      let diff = "easy";
      for (const b of bots) if (order.indexOf(b.ai) > order.indexOf(diff)) diff = b.ai;
      try {
        if (S.mode === "perfection" && S.turnLimit === 30) {
          const submitted = await ctx.memory.record("perfection").submit(me.score, { label: me.score.toLocaleString() + " pts", dimensions: { difficulty: diff } });
          if (submitted && submitted.isPersonalBest) { V.recordNote = "A new personal best on the " + diff + " board."; if (V.panel === "over") openPanel("over"); }
        }
        if (won && S.mode !== "perfection") {
          await ctx.memory.record("conquest").submit(S.turn, { label: "turn " + S.turn, dimensions: { difficulty: diff } });
        }
      } catch (_) { /* leaderboards are a nicety */ }
    }

    // ====================================================================== //
    // Saving                                                                 //
    // ====================================================================== //
    const SAVE_KEY = "tt_save", SETTINGS_KEY = "tt_settings";
    // Viewer storage keeps every save; Continue Playing is written once per
    // human turn, which is the checkpoint the contract asks for.
    function save(force, progressToo) {
      if (!S || S.over || V.screen !== "play") return;
      const now = Date.now();
      if (!force && now - V.lastSave < 1500) return;
      V.lastSave = now;
      let data;
      try { data = serialize(S); } catch (_) { return; }
      savedGame = data;
      if (ctx.capabilities.storage) fireAndForget(() => ctx.storage.set(SAVE_KEY, data));
      if (progressToo && humans().length === 1 && ctx.game && ctx.game.progress) {
        const me = humans()[0];
        const size = JSON.stringify(data).length;
        const text = tribeName(me.id) + " · turn " + S.turn + (S.mode === "perfection" ? " of " + S.turnLimit : "") + " · " + MODES.find((m) => m.id === S.mode).name;
        const percent = S.mode === "perfection" ? Math.round(clamp((S.turn - 1) / S.turnLimit, 0, 0.99) * 100) : Math.min(95, Math.round(numCities(S, me.id) / Math.max(1, S.cities.length) * 100));
        const state = size < 7600 ? data : { v: 1, ref: "storage", n: S.n, turn: S.turn };
        fireAndForget(() => ctx.game.progress.save("main", { state, label: text, percent, dimensions: { mode: S.mode } }));
      }
    }
    function saveSettings() { if (ctx.capabilities.storage) fireAndForget(() => ctx.storage.set(SETTINGS_KEY, { sound: V.soundOn })); }
    async function loadSaved() {
      let data = null;
      if (ctx.capabilities.storage) {
        try { const stored = ctx.storage.get(SAVE_KEY); data = stored && typeof stored.then === "function" ? await stored : stored; } catch (_) { data = null; }
        try { const storedSettings = ctx.storage.get(SETTINGS_KEY); const settings = storedSettings && typeof storedSettings.then === "function" ? await storedSettings : storedSettings; if (settings && typeof settings.sound === "boolean") V.soundOn = settings.sound; } catch (_) {}
      }
      if (!data && ctx.game && ctx.game.progress) {
        try {
          const saved = await ctx.game.progress.load("main");
          if (saved && saved.resumeEligible === true && saved.state && saved.state.terrain) data = saved.state;
        } catch (_) {}
      }
      if (data && data.v === 1 && data.terrain && !data.over) savedGame = data;
    }

    // ====================================================================== //
    // Input on the map                                                       //
    // ====================================================================== //
    // The first view: close enough that a unit is a character, with the
    // capital sitting above the action sheet rather than behind it.
    const START_ZOOM = Math.min(1.6, Math.max(1.2, W() / 300));
    const SHEET_LIFT = 70;
    const pointers = new Map();
    let gesture = null;
    function firstGesture() {
      if (V.gestured) return;
      V.gestured = true;
      ensureAudio();
      startMusic();
      try { if (!V.started) ctx.platform.start(); } catch (_) {}
      V.started = true;
    }
    ctx.listen(canvas, "pointerdown", (e) => {
      firstGesture();
      try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
      cam.tx = null;
      pointers.set(e.pointerId, { x: e.offsetX, y: e.offsetY, sx: e.offsetX, sy: e.offsetY });
      if (pointers.size === 1) gesture = { kind: "tap", moved: false, lastX: e.offsetX, lastY: e.offsetY };
      else if (pointers.size === 2) {
        const pts = Array.from(pointers.values());
        gesture = { kind: "pinch", d0: Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y), z0: cam.z,
          cx: (pts[0].x + pts[1].x) / 2, cy: (pts[0].y + pts[1].y) / 2, moved: true };
      }
    });
    ctx.listen(canvas, "pointermove", (e) => {
      const pt = pointers.get(e.pointerId);
      if (!pt || !gesture) return;
      pt.x = e.offsetX; pt.y = e.offsetY;
      if (gesture.kind === "tap" || gesture.kind === "pan") {
        const dx = e.offsetX - gesture.lastX, dy = e.offsetY - gesture.lastY;
        if (!gesture.moved && Math.hypot(e.offsetX - pt.sx, e.offsetY - pt.sy) > 7) { gesture.moved = true; gesture.kind = "pan"; }
        if (gesture.kind === "pan") { cam.x -= dx / cam.z; cam.y -= dy / cam.z; clampCamera(); V.dirty = true; }
        gesture.lastX = e.offsetX; gesture.lastY = e.offsetY;
      } else if (gesture.kind === "pinch" && pointers.size >= 2) {
        const pts = Array.from(pointers.values());
        const d = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
        const cx = (pts[0].x + pts[1].x) / 2, cy = (pts[0].y + pts[1].y) / 2;
        const before = toWorld(cx, cy);
        cam.z = clamp(gesture.z0 * (d / Math.max(1, gesture.d0)), 0.42, 2.8);
        const after = toWorld(cx, cy);
        cam.x += before[0] - after[0]; cam.y += before[1] - after[1];
        cam.x -= (cx - gesture.cx) / cam.z; cam.y -= (cy - gesture.cy) / cam.z;
        gesture.cx = cx; gesture.cy = cy;
        clampCamera(); V.dirty = true;
      }
    });
    const toWorld = (sx, sy) => [(sx - W() / 2) / cam.z + cam.x, (sy - H() / 2) / cam.z + cam.y];
    function endPointer(e) {
      const pt = pointers.get(e.pointerId);
      pointers.delete(e.pointerId);
      if (!gesture) return;
      if (gesture.kind === "tap" && pt && !gesture.moved && e.type !== "pointercancel") {
        const t = toTile(pt.x, pt.y);
        if (V.panel) { /* a modal is up; ignore the map */ }
        else if (V.screen === "play") onTapTile(t[0], t[1]);
      }
      if (pointers.size === 0) gesture = null;
      else if (pointers.size === 1) { const q = Array.from(pointers.values())[0]; gesture = { kind: "pan", moved: true, lastX: q.x, lastY: q.y }; }
    }
    ctx.listen(canvas, "pointerup", endPointer);
    ctx.listen(canvas, "pointercancel", endPointer);
    ctx.listen(canvas, "wheel", (e) => {
      e.preventDefault();
      const before = toWorld(e.offsetX, e.offsetY);
      cam.z = clamp(cam.z * (e.deltaY < 0 ? 1.1 : 0.9), 0.42, 2.8);
      const after = toWorld(e.offsetX, e.offsetY);
      cam.x += before[0] - after[0]; cam.y += before[1] - after[1];
      clampCamera(); V.dirty = true;
    }, { passive: false });

    // ====================================================================== //
    // Frame loop and boot                                                    //
    // ====================================================================== //
    let lastW = -1, lastH = -1, ambientAcc = 0, drawMs = 0;
    ctx.onFrame((dtMs) => {
      const dt = Math.min(100, dtMs || 16);
      ART_T += dt / 1000;
      if (ctx.width !== lastW || ctx.height !== lastH) { lastW = ctx.width; lastH = ctx.height; V.dirty = true; }
      if (V.toastT > 0) { V.toastT -= dt; if (V.toastT <= 0) toastEl.style.opacity = "0"; }
      if (V.demo && S) { cam.x += dt * 0.012; cam.y += dt * 0.004; const lim = S.n * TW * 0.3; if (cam.x > lim) { cam.x = -lim; } if (cam.y > S.n * TH * 0.8) cam.y = S.n * TH * 0.2; V.dirty = true; }
      if (tickCamera(dt)) V.dirty = true;
      tickReplay(dt);
      if (!V.replay.length && V.afterReplay) { const fn = V.afterReplay; V.afterReplay = null; fn(); }
      if (V.floats.length) {
        for (const f of V.floats) f.t += dt;
        V.floats = V.floats.filter((f) => f.t < f.dur);
        V.dirty = true;
      }
      if (V.incomeFlash && V.viewer >= 0 && S) {
        const cap = S.cities.find((c) => c.owner === V.viewer && c.capital);
        if (cap) floatText(cap.x, cap.y, "+" + V.incomeFlash + "★", "#ffd166", 0, -30);
        V.incomeFlash = 0;
      }
      // Ambient motion (water, flags, smoke, the selection pulse) at a gentle rate.
      // A frame that takes long to draw (a big map on a big screen) animates
      // at half the rate rather than stalling the input.
      ambientAcc += dt;
      if (ambientAcc > (drawMs > 14 ? 140 : 70) && S && !V.hideMap && !V.panel) { ambientAcc = 0; V.dirty = true; }
      if (S && V.screen === "play") updateHud(false);
      if (V.dirty) { V.dirty = false; const t0 = performance.now(); drawScene(t0); drawMs = drawMs * 0.7 + (performance.now() - t0) * 0.3; }
    });

    // Tuning knobs the creator can turn at draft time.
    AI_EXTRA_STARS = clamp(Math.round(Number(tune("ai_bonus_stars", 0)) || 0), 0, 5);
    try { if (ctx.tune && ctx.tune.onChange) ctx.tune.onChange(["ai_bonus_stars", "anim_speed"], () => {
      AI_EXTRA_STARS = clamp(Math.round(Number(tune("ai_bonus_stars", 0)) || 0), 0, 5);
      ANIM_SPEED = clamp(Number(tune("anim_speed", 1)) || 1, 0.4, 2.5);
    }); } catch (_) {}

    // A world to look at behind the title, then the menu.
    await loadSaved();
    if (savedGame) {
      const loaded = deserialize(savedGame);
      if (loaded) { S = loaded; V.viewer = nextHuman(); V.demo = true; const cap = S.cities.find((c) => c.owner === V.viewer && c.capital) || S.cities[0]; centerOn(cap.x, cap.y, 0.9); }
    }
    if (!S) {
      S = generateWorld({ n: 14, mapType: "lakes", seed: (Math.random() * 4294967295) >>> 0, mode: "perfection", turnLimit: 30,
        players: [{ tribe: 0, ai: "normal" }, { tribe: 3, ai: "normal" }, { tribe: 11, ai: "normal" }] });
      V.viewer = -1; V.demo = true;
      centerOn(S.n / 2, S.n / 2, 0.9);
    }
    V.screen = "menu";
    drawScene(performance.now());
    openPanel("menu");
    ctx.markVisualReady("world drawn");
    ctx.platform.ready();
  }
};
