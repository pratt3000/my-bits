/**
 * Deep Pockets — a Plethora Bit.
 *
 * Dig a hole. Keep digging. The good stuff is further down than you think.
 *
 * Contract notes (plethora-bit@2):
 *  - Every surface comes from ctx.createCanvas2D / ctx.createRoot. The overlay is
 *    declared as markup on the runtime-owned root and queried back out; bits may
 *    not reach into the host DOM with document.createElement.
 *  - Offscreen bakes go to OffscreenCanvas, with a live-draw fallback.
 *  - Pointer positions come from event.offsetX/offsetY. getBoundingClientRect is
 *    rejected by upload validation.
 *  - Timers go through ctx.timeout / ctx.interval so the runtime owns cleanup.
 */
window.plethoraBit = {
  meta: {
    title: "Deep Pockets",
    runtime: "plethora-bit@2",
    tags: ["game", "mining", "adventure", "idle", "collect", "upgrade"],
    permissions: ["audio", "backgroundMusic", "haptics", "storage"]
  },

  async init(ctx) {
    "use strict";

    // ====================================================================
    // 1. WORLD CONSTANTS
    // ====================================================================
    const COLS = 24;             // width of the plot, in tiles
    const SKY = 8;               // rows of open sky above the dirt
    const CORE_M = 1000;         // depth of the core, in metres
    const ROWS = SKY + CORE_M + 2;
    const GROUND = SKY;          // first diggable row; depth 1 m
    const SAVE_V = 3;

    const depthOf = (row) => row - GROUND + 1;      // tile row -> metres
    const rowOf = (m) => m + GROUND - 1;            // metres -> tile row

    // Material ids. 0 is air; everything else is solid until you break it.
    const AIR = 0;
    const M = {};                 // key -> id
    const MAT = [null];           // id -> definition
    function mat(key, def) {
      const id = MAT.length;
      def.id = id; def.key = key;
      M[key] = id; MAT.push(def);
      return id;
    }

    // --- Rock: the bulk fill of each zone. hard = shovel power needed. -----
    const ROCK = (name, hard, base, spec, grain) =>
      ({ name, kind: "rock", hard, base, spec, grain });

    mat("SOIL",     ROCK("Topsoil",      1, "#6b4a2f", "#8a6440", 0.55));
    mat("CLAY",     ROCK("Clay",         2, "#8a5a3c", "#a5714c", 0.40));
    mat("LIME",     ROCK("Limestone",    2, "#8c8577", "#a8a294", 0.34));
    mat("SHALE",    ROCK("Shale",        3, "#4f5560", "#666d7a", 0.30));
    mat("GRANITE",  ROCK("Granite",      3, "#6d6270", "#867a8b", 0.46));
    mat("QUARTZITE",ROCK("Quartzite",    4, "#5b6a86", "#7688a6", 0.42));
    mat("BASALT",   ROCK("Basalt",       5, "#2f3440", "#454c5c", 0.30));
    mat("BONEROCK", ROCK("Bone Shale",   5, "#59503f", "#736850", 0.36));
    mat("MAGMAROCK",ROCK("Magmastone",   6, "#4a2320", "#75352c", 0.44));
    mat("MANTLE",   ROCK("Mantle Rock",  7, "#5c1f2e", "#8c3040", 0.50));
    mat("CORESHELL",ROCK("Core Shell",   7, "#7a3410", "#c26a1c", 0.60));

    // --- Ore: what you carry up and sell. --------------------------------
    const ORE = (name, hard, value, base, spec, icon) =>
      ({ name, kind: "ore", hard, value, base, spec, icon });

    mat("PEBBLE",   ORE("Pebble",         1,     2, "#6b4a2f", "#9a9a92", "rock"));
    mat("WORM",     ORE("Startled Worm",  1,     5, "#6b4a2f", "#e08a92", "worm"));
    mat("CAP",      ORE("Bottle Cap",     1,     9, "#6b4a2f", "#cf5b4a", "disc"));
    mat("PLASTIC",  ORE("Crisp Packet",   1,    14, "#6b4a2f", "#4bb3d8", "bag"));
    mat("BOOT",     ORE("Someone's Boot", 1,    22, "#6b4a2f", "#5b4230", "boot"));
    mat("COIN",     ORE("Lost Coin",      1,    40, "#6b4a2f", "#e8c65a", "disc"));

    mat("CLAYLUMP", ORE("Clay Lump",      2,    24, "#8a5a3c", "#c08a5e", "blob"));
    mat("FLINT",    ORE("Flint",          2,    42, "#8a5a3c", "#4a4f56", "shard"));
    mat("COAL",     ORE("Coal",           2,    70, "#8a5a3c", "#23242a", "blob"));
    mat("IRON",     ORE("Iron Ore",       2,   120, "#8a5a3c", "#b07a5c", "gem"));

    mat("COPPER",   ORE("Copper Ore",     2,   200, "#8c8577", "#d2733c", "gem"));
    mat("SILVER",   ORE("Silver Ore",     3,   330, "#8c8577", "#dfe6ec", "gem"));
    mat("SHELL",    ORE("Fossil Shell",   2,   440, "#8c8577", "#e3d5ab", "shell"));
    mat("AMBER",    ORE("Amber",          3,   600, "#8c8577", "#f0a832", "gem"));

    mat("GOLD",     ORE("Gold Ore",       3,   900, "#6d6270", "#ffcf40", "gem"));
    mat("AMETHYST", ORE("Amethyst",       3,  1200, "#6d6270", "#b06ce8", "gem"));
    mat("JADE",     ORE("Jade",           3,  1550, "#6d6270", "#3fd39a", "gem"));

    mat("EMERALD",  ORE("Emerald",        4,  2200, "#5b6a86", "#2ee07a", "gem"));
    mat("SAPPHIRE", ORE("Sapphire",       4,  3000, "#5b6a86", "#3a7bff", "gem"));
    mat("GEODE",    ORE("Split Geode",    5,  4200, "#5b6a86", "#c9a6ff", "geode"));

    mat("OBSIDIAN", ORE("Obsidian",       5,  3600, "#2f3440", "#1a1a24", "shard"));
    mat("OPAL",     ORE("Black Opal",     5,  6000, "#2f3440", "#5ce0d8", "gem"));
    mat("DIAMOND",  ORE("Diamond",        6,  9000, "#2f3440", "#bff4ff", "gem"));

    mat("RUBY",     ORE("Ruby",           5,  8500, "#59503f", "#ff3b5c", "gem"));
    mat("RELIC",    ORE("Ancient Coin",   5,  7000, "#59503f", "#e0b45c", "disc"));
    mat("TRILO",    ORE("Trilobite",      5, 11000, "#59503f", "#9ad4a8", "shell"));

    mat("MAGMATITE",ORE("Magmatite",      6, 15000, "#4a2320", "#ff7a1c", "gem"));
    mat("METEOR",   ORE("Meteorite",      6, 21000, "#4a2320", "#9fb4c8", "blob"));

    mat("MYTHRIL",  ORE("Mythril",        7, 32000, "#5c1f2e", "#7ef0ff", "gem"));
    mat("STARSTONE",ORE("Starstone",      7, 46000, "#5c1f2e", "#ffe9a3", "star"));
    mat("VOID",     ORE("Void Crystal",   7, 68000, "#5c1f2e", "#c04cff", "gem"));

    // --- Special tiles ---------------------------------------------------
    mat("BOULDER",  { name: "Boulder",   kind: "boulder", hard: 9, base: "#585a63", spec: "#787b86" });
    mat("LAVA",     { name: "Lava",      kind: "lava",    hard: 9, base: "#ff6a12", spec: "#ffd45e" });
    mat("GAS",      { name: "Gas Pocket",kind: "gas",     hard: 1, base: "#3d5a3a", spec: "#7fd06a" });
    mat("CHEST",    { name: "Chest",     kind: "chest",   hard: 9, base: "#7a4a22", spec: "#e8b74a" });
    mat("BONE",     { name: "Fossil",    kind: "bone",    hard: 1, base: "#7a7360", spec: "#efe6cd" });
    mat("CORESTONE",{ name: "The Core",  kind: "core",    hard: 9, base: "#ff9c1a", spec: "#fff0b0" });

    const isSolid = (m) => m !== AIR;
    const matDef = (m) => MAT[m];

    // ====================================================================
    // 2. ZONES — the strata, top to bottom
    // ====================================================================
    // ore: [materialKey, weight] pairs. weight is relative within the zone.
    const ZONES = [
      {
        name: "Topsoil", short: "TOPSOIL", from: 1, to: 40, rock: "SOIL",
        sky: ["#3a2a1e", "#241a13"], tint: "#c99a63", music: "cozy",
        density: 0.16, ore: [["PEBBLE", 34], ["WORM", 22], ["CAP", 18], ["PLASTIC", 13], ["BOOT", 8], ["COIN", 5]]
      },
      {
        name: "Clay Beds", short: "CLAY", from: 41, to: 110, rock: "CLAY",
        sky: ["#2e1c14", "#1d120d"], tint: "#c2794c", music: "cozy",
        density: 0.15, ore: [["CLAYLUMP", 30], ["FLINT", 26], ["COAL", 24], ["IRON", 20]]
      },
      {
        name: "Limestone Caverns", short: "LIMESTONE", from: 111, to: 200, rock: "LIME",
        sky: ["#20211f", "#141513"], tint: "#b9b3a2", music: "drift",
        density: 0.14, boulders: 0.010, caves: 0.55,
        ore: [["COPPER", 34], ["SILVER", 26], ["SHELL", 22], ["AMBER", 18]]
      },
      {
        name: "Deep Rock", short: "DEEP ROCK", from: 201, to: 320, rock: "GRANITE",
        sky: ["#1b1720", "#100e14"], tint: "#9a8fa4", music: "drift",
        density: 0.13, boulders: 0.014, gas: 0.006, caves: 0.4,
        ore: [["GOLD", 30], ["AMETHYST", 24], ["JADE", 18], ["SILVER", 16], ["COPPER", 12]]
      },
      {
        name: "Crystal Vaults", short: "CRYSTAL", from: 321, to: 450, rock: "QUARTZITE",
        sky: ["#131a26", "#0b0f17"], tint: "#8fa4c6", music: "sparkle",
        density: 0.13, boulders: 0.016, gas: 0.008, caves: 0.6,
        ore: [["EMERALD", 32], ["SAPPHIRE", 24], ["GEODE", 14], ["AMETHYST", 18], ["GOLD", 12]]
      },
      {
        name: "The Abyss", short: "ABYSS", from: 451, to: 600, rock: "BASALT",
        sky: ["#0a0d13", "#05070b"], tint: "#5d6577", music: "drone",
        density: 0.12, boulders: 0.018, gas: 0.012, lava: 0.0012, caves: 0.5,
        ore: [["OBSIDIAN", 34], ["OPAL", 22], ["DIAMOND", 12], ["SAPPHIRE", 18], ["EMERALD", 14]]
      },
      {
        name: "Fossil Strata", short: "FOSSILS", from: 601, to: 720, rock: "BONEROCK",
        sky: ["#141109", "#0b0906"], tint: "#a3927a", music: "spooky",
        density: 0.13, boulders: 0.014, gas: 0.012, caves: 0.55,
        ore: [["RUBY", 26], ["RELIC", 26], ["TRILO", 18], ["OPAL", 16], ["DIAMOND", 14]]
      },
      {
        name: "Magma Shelf", short: "MAGMA", from: 721, to: 870, rock: "MAGMAROCK",
        sky: ["#1d0906", "#0e0503"], tint: "#e0713a", music: "techno",
        density: 0.13, boulders: 0.012, gas: 0.012, lava: 0.0040, caves: 0.45,
        heat: 1,
        ore: [["MAGMATITE", 42], ["METEOR", 26], ["RUBY", 18], ["DIAMOND", 14]]
      },
      {
        name: "The Mantle", short: "MANTLE", from: 871, to: 990, rock: "MANTLE",
        sky: ["#20060e", "#0e0306"], tint: "#d1465f", music: "pulse",
        density: 0.14, boulders: 0.010, gas: 0.013, lava: 0.0055, caves: 0.5,
        heat: 2,
        ore: [["MYTHRIL", 40], ["STARSTONE", 30], ["VOID", 16], ["MAGMATITE", 14]]
      },
      {
        name: "The Core", short: "THE CORE", from: 991, to: CORE_M + 2, rock: "CORESHELL",
        sky: ["#2a0d02", "#160601"], tint: "#ffa42a", music: "triumph",
        density: 0.0, heat: 2,
        ore: [["VOID", 1]]
      }
    ];

    function zoneAt(m) {
      for (let i = 0; i < ZONES.length; i++) if (m <= ZONES[i].to) return ZONES[i];
      return ZONES[ZONES.length - 1];
    }
    function zoneIndexAt(m) {
      for (let i = 0; i < ZONES.length; i++) if (m <= ZONES[i].to) return i;
      return ZONES.length - 1;
    }

    // Halls: wide carved chambers with chests, one per band. [depth, width, height]
    const HALLS = [
      { m: 132, w: 15, h: 5, chests: 1 },
      { m: 256, w: 16, h: 6, chests: 2 },
      { m: 384, w: 17, h: 6, chests: 2 },
      { m: 512, w: 18, h: 7, chests: 2 },
      { m: 648, w: 18, h: 7, chests: 3 },
      { m: 786, w: 19, h: 7, chests: 3 },
      { m: 918, w: 20, h: 8, chests: 3 }
    ];

    // ====================================================================
    // 3. THE T-REX — eight bones, one per band below the topsoil
    // ====================================================================
    const BONES = [
      { key: "tail",  name: "Tail Vertebra", from: 45,  to: 108 },
      { key: "rib",   name: "Rib Cage",      from: 115, to: 198 },
      { key: "femur", name: "Femur",         from: 205, to: 316 },
      { key: "claw",  name: "Hooked Claw",   from: 325, to: 446 },
      { key: "pelvis",name: "Pelvis",        from: 455, to: 596 },
      { key: "spine", name: "Spine Column",  from: 605, to: 716 },
      { key: "jaw",   name: "Jawbone",       from: 725, to: 866 },
      { key: "skull", name: "Great Skull",   from: 875, to: 986 }
    ];
    const TREX_REWARD = 150000;

    // ====================================================================
    // 4. SHOP
    // ====================================================================
    const SHOVELS = [
      { name: "Rusty Trowel",   power: 1, speed: 1.00, cost: 0 },
      { name: "Steel Spade",    power: 2, speed: 1.30, cost: 140 },
      { name: "Miner's Pick",   power: 3, speed: 1.70, cost: 900 },
      { name: "Tungsten Drill", power: 4, speed: 2.20, cost: 5000 },
      { name: "Diamond Auger",  power: 5, speed: 2.85, cost: 22000 },
      { name: "Plasma Cutter",  power: 6, speed: 3.70, cost: 78000 },
      { name: "Corebreaker",    power: 7, speed: 4.80, cost: 260000 }
    ];
    const PACKS = [
      { name: "Canvas Sack",       slots: 10, cost: 0 },
      { name: "Toolbelt Pack",     slots: 16, cost: 90 },
      { name: "Rucksack",          slots: 26, cost: 550 },
      { name: "Hauler Frame",      slots: 38, cost: 3400 },
      { name: "Cargo Rig",         slots: 52, cost: 17000 },
      { name: "Bottomless Duffel", slots: 70, cost: 90000 }
    ];
    const LAMPS = [
      { name: "Candle Stub", r: 3.4,  cost: 0 },
      { name: "Oil Lamp",    r: 5.2,  cost: 180 },
      { name: "Carbide Lamp",r: 7.2,  cost: 1400 },
      { name: "Arc Lamp",    r: 9.8,  cost: 9000 },
      { name: "Sunbottle",   r: 13.0, cost: 46000 }
    ];
    const BOOTS = [
      { name: "Worn Boots",    mul: 1.00, cost: 0 },
      { name: "Grip Boots",    mul: 1.24, cost: 400 },
      { name: "Spring Heels",  mul: 1.52, cost: 3800 },
      { name: "Gravity Weave", mul: 1.90, cost: 24000 }
    ];
    const SUITS = [
      { name: "Work Vest",     hp: 100, heat: 0, cost: 0 },
      { name: "Padded Jacket", hp: 150, heat: 0, cost: 700 },
      { name: "Asbestos Coat", hp: 230, heat: 1, cost: 12000 },
      { name: "Coreplate",     hp: 340, heat: 2, cost: 95000 }
    ];
    const GEAR = {
      cart:  { name: "Mine Cart",     cost: 1800,  blurb: "Ride back down to your deepest tunnel." },
      winch: { name: "Return Winch",  cost: 9000,  blurb: "Haul yourself up from anywhere, forever." },
      rod:   { name: "Dowsing Rod",   cost: 6500,  blurb: "Ore and fossils glow through solid rock." }
    };
    const GOODS = {
      dyn:  { name: "Dynamite",   cost: 400, blurb: "Blasts a crater. Ignores hardness." },
      kit:  { name: "Med Kit",    cost: 350, blurb: "Patches you up by 70." },
      rope: { name: "Rope Ladder",cost: 150, blurb: "One-use climb straight to the surface." }
    };

    // ====================================================================
    // 5. RANDOM — seeded, so a world can be rebuilt from a saved seed
    // ====================================================================
    function mulberry(a) {
      return function () {
        a |= 0; a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    }
    // Stable per-coordinate hash: texture speckle a tile always agrees with,
    // without storing a byte of it.
    function hash2(x, y) {
      let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263);
      h = (h ^ (h >>> 13)) | 0;
      h = Math.imul(h, 1274126177);
      return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
    }
    const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
    const lerp = (a, b, t) => a + (b - a) * t;

    // ====================================================================
    // 6. GAME STATE
    // ====================================================================
    const grid = new Uint8Array(COLS * ROWS);   // material per tile
    const seen = new Uint8Array(COLS * ROWS);   // remembered brightness, 0 = never lit
    const idx = (x, y) => y * COLS + x;
    const inBounds = (x, y) => x >= 0 && x < COLS && y >= 0 && y < ROWS;
    const tileAt = (x, y) => (inBounds(x, y) ? grid[idx(x, y)] : M.CORESHELL);

    const S = {
      seed: 0,
      money: 0,
      lifetime: 0,
      hp: 100,
      shovel: 0, pack: 0, lamp: 0, boots: 0, suit: 0,
      cart: false, winch: false, rod: false,
      dyn: 0, kit: 0, rope: 0,
      inv: {},                 // materialId -> count
      bones: {},               // bone key -> true
      trex: false,
      chests: {},              // "x,y" -> true once opened
      deepest: 0,              // metres
      deepTile: null,          // [x, y] deepest air tile stood in
      playMs: 0,
      finished: false,
      firstCoreMs: 0
    };

    const shovel = () => SHOVELS[S.shovel];
    const packSlots = () => PACKS[S.pack].slots;
    const lampR = () => LAMPS[S.lamp].r;
    const bootMul = () => BOOTS[S.boots].mul;
    const suitDef = () => SUITS[S.suit];
    const maxHp = () => suitDef().hp;
    const heatRes = () => suitDef().heat;
    const luck = () => (S.trex ? 1.15 : 1);

    function carried() {
      let n = 0;
      for (const k in S.inv) n += S.inv[k];
      return n;
    }
    const packFull = () => carried() >= packSlots();
    function haulValue() {
      let v = 0;
      for (const k in S.inv) v += MAT[k].value * S.inv[k];
      return Math.round(v * luck());
    }

    // ====================================================================
    // 7. WORLD GENERATION
    // ====================================================================
    // Deterministic from the seed. Loading a save regenerates the strata and
    // re-applies the player's tunnels from a run-length encoded mask, so the
    // save stays a few kilobytes no matter how much of the plot is gone.
    const bonePlace = {};        // boneKey -> [x, y]
    const hallInfo = [];         // { m, x0, x1, y0, y1 }
    const CORE = { x: 12, y: 0, top: 0 };

    function pickWeighted(list, rnd) {
      let total = 0;
      for (let i = 0; i < list.length; i++) total += list[i][1];
      let r = rnd() * total;
      for (let i = 0; i < list.length; i++) {
        r -= list[i][1];
        if (r <= 0) return list[i][0];
      }
      return list[list.length - 1][0];
    }

    function blobMat(cx, cy, id, r, rnd) {
      for (let y = cy - r; y <= cy + r; y++) {
        for (let x = cx - r; x <= cx + r; x++) {
          if (!inBounds(x, y) || y < GROUND + 3 || depthOf(y) > CORE_M - 12) continue;
          if ((x - cx) * (x - cx) + (y - cy) * (y - cy) > r * r + rnd()) continue;
          grid[idx(x, y)] = id;
        }
      }
    }

    function generate(seed) {
      const rnd = mulberry(seed);
      grid.fill(AIR);
      hallInfo.length = 0;
      for (const k in bonePlace) delete bonePlace[k];

      // --- strata ----------------------------------------------------------
      for (let y = GROUND; y < ROWS; y++) {
        const m = depthOf(y);
        const zi = zoneIndexAt(m);
        const z = ZONES[zi];
        const rockId = M[z.rock];
        // Soft band boundary: near the top of a zone some tiles are still the
        // zone above, so strata interleave instead of stopping dead.
        const above = zi > 0 ? M[ZONES[zi - 1].rock] : rockId;
        const blend = clamp((m - z.from) / 9, 0, 1);

        for (let x = 0; x < COLS; x++) {
          let id = rockId;
          if (blend < 1 && rnd() > blend) id = above;
          if (rnd() < z.density) id = M[pickWeighted(z.ore, rnd)];
          grid[idx(x, y)] = id;
        }
      }

      // --- pockets: caves, boulders, gas, lava ------------------------------
      for (let y = GROUND; y < ROWS; y++) {
        const m = depthOf(y);
        if (m > CORE_M - 12) break;
        const z = zoneAt(m);
        for (let x = 0; x < COLS; x++) {
          if (z.caves && rnd() < z.caves * 0.006) blobMat(x, y, AIR, 1 + Math.floor(rnd() * 3), rnd);
          if (z.boulders && rnd() < z.boulders) grid[idx(x, y)] = M.BOULDER;
          if (z.gas && rnd() < z.gas) grid[idx(x, y)] = M.GAS;
          // A lava seed paints a disc of five to thirteen tiles, so the seed
          // rate is roughly a ninth of the coverage it produces.
          if (z.lava && rnd() < z.lava) blobMat(x, y, M.LAVA, 1 + Math.floor(rnd() * 2), rnd);
        }
      }

      // --- halls with chests -------------------------------------------------
      for (let i = 0; i < HALLS.length; i++) {
        const h = HALLS[i];
        const y0 = rowOf(h.m), y1 = y0 + h.h - 1;
        const x0 = 1 + Math.floor(rnd() * (COLS - h.w - 2));
        const x1 = Math.min(COLS - 2, x0 + h.w - 1);
        for (let y = y0; y <= y1; y++) {
          for (let x = x0; x <= x1; x++) {
            // rounded ends, so the chamber reads as a cave and not a box
            const fx = (x - x0) / (x1 - x0 || 1) - 0.5;
            const fy = (y - y0) / (y1 - y0 || 1) - 0.5;
            if (fx * fx * 1.05 + fy * fy * 1.9 > 0.27) continue;
            grid[idx(x, y)] = AIR;
          }
        }
        // pillars, for silhouette
        const pillars = 2 + Math.floor(rnd() * 2);
        for (let p = 0; p < pillars; p++) {
          const px = x0 + 2 + Math.floor(rnd() * Math.max(1, x1 - x0 - 3));
          for (let y = y0; y <= y1; y++) {
            if (grid[idx(px, y)] === AIR) grid[idx(px, y)] = M[zoneAt(h.m).rock];
          }
        }
        // chests on the chamber floor
        for (let c = 0; c < h.chests; c++) {
          for (let tries = 0; tries < 30; tries++) {
            const cx = x0 + 1 + Math.floor(rnd() * Math.max(1, x1 - x0 - 1));
            if (grid[idx(cx, y1)] === AIR && grid[idx(cx, y1 - 1)] === AIR) {
              grid[idx(cx, y1)] = M.CHEST;
              break;
            }
          }
        }
        hallInfo.push({ m: h.m, x0, x1, y0, y1 });
      }

      // --- one fossil per band ------------------------------------------------
      for (let i = 0; i < BONES.length; i++) {
        const b = BONES[i];
        for (let tries = 0; tries < 240; tries++) {
          const y = rowOf(b.from + Math.floor(rnd() * (b.to - b.from)));
          const x = 2 + Math.floor(rnd() * (COLS - 4));
          const cur = grid[idx(x, y)];
          if (cur !== AIR && matDef(cur).kind === "rock") {
            grid[idx(x, y)] = M.BONE;
            bonePlace[b.key] = [x, y];
            break;
          }
        }
      }

      // --- the core chamber ---------------------------------------------------
      const cTop = rowOf(CORE_M - 8);
      for (let y = cTop; y < ROWS; y++) {
        for (let x = 0; x < COLS; x++) {
          const dx = (x - COLS / 2 + 0.5) / (COLS * 0.42);
          const dy = (y - (cTop + 5)) / 6.4;
          grid[idx(x, y)] = dx * dx + dy * dy < 1 ? AIR : M.CORESHELL;
        }
      }
      const heartY = cTop + 8, heartX = Math.floor(COLS / 2);
      for (let x = heartX - 1; x <= heartX + 1; x++) {
        if (inBounds(x, heartY)) grid[idx(x, heartY)] = M.CORESTONE;
      }
      CORE.x = heartX; CORE.y = heartY - 1; CORE.top = cTop;

      // sky above the dirt
      for (let y = 0; y < GROUND; y++) for (let x = 0; x < COLS; x++) grid[idx(x, y)] = AIR;
    }

    // ====================================================================
    // 8. SAVE CODEC
    // ====================================================================
    // The tunnel mask is the difference between a freshly generated world and
    // the current one, walked column-major so a vertical shaft collapses into a
    // single run. Runs are variable-length base64 with a continuation bit,
    // which keeps a thoroughly excavated plot in the low kilobytes.
    const A64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    const V64 = {};
    for (let i = 0; i < 64; i++) V64[A64[i]] = i;

    function encodeRuns(runs) {
      let out = "";
      for (let i = 0; i < runs.length; i++) {
        let v = runs[i];
        do {
          const chunk = v % 32;
          v = Math.floor(v / 32);
          out += A64[chunk + (v > 0 ? 32 : 0)];
        } while (v > 0);
      }
      return out;
    }
    function decodeRuns(str) {
      const runs = [];
      let v = 0, shift = 1;
      for (let i = 0; i < str.length; i++) {
        const c = V64[str.charAt(i)];
        if (c === undefined) continue;
        v += (c % 32) * shift;
        if (c >= 32) shift *= 32;
        else { runs.push(v); v = 0; shift = 1; }
      }
      return runs;
    }

    function encodeDug() {
      const live = new Uint8Array(COLS * ROWS);
      const lit = new Uint8Array(COLS * ROWS);
      live.set(grid); lit.set(seen);
      generate(S.seed);                    // grid now holds the pristine world
      const runs = [];
      let cur = 0, run = 0;
      for (let x = 0; x < COLS; x++) {
        for (let y = 0; y < ROWS; y++) {
          const i = idx(x, y);
          const dug = live[i] === AIR && grid[i] !== AIR ? 1 : 0;
          if (dug === cur) run++;
          else { runs.push(run); cur = dug; run = 1; }
        }
      }
      runs.push(run);
      grid.set(live); seen.set(lit);       // put the played-in world back
      return encodeRuns(runs);
    }

    function applyDug(str) {
      const runs = decodeRuns(str);
      let cur = 0, p = 0;
      for (let r = 0; r < runs.length; r++) {
        const len = runs[r];
        if (cur === 1) {
          for (let k = 0; k < len; k++) {
            const lin = p + k;
            const x = (lin / ROWS) | 0, y = lin % ROWS;
            if (x < COLS) { grid[idx(x, y)] = AIR; seen[idx(x, y)] = 90; }
          }
        }
        p += len;
        cur = cur ? 0 : 1;
      }
    }

    function snapshot(withDug) {
      const o = {
        v: SAVE_V, seed: S.seed, money: S.money, life: S.lifetime, hp: Math.round(S.hp),
        up: [S.shovel, S.pack, S.lamp, S.boots, S.suit],
        gear: (S.cart ? 1 : 0) | (S.winch ? 2 : 0) | (S.rod ? 4 : 0),
        goods: [S.dyn, S.kit, S.rope],
        inv: S.inv, bones: Object.keys(S.bones), trex: S.trex,
        chests: Object.keys(S.chests), deep: S.deepest, dt: S.deepTile,
        t: Math.round(S.playMs), fin: S.finished, core: S.firstCoreMs
      };
      if (withDug) { try { o.dug = encodeDug(); } catch (_) { /* progress only */ } }
      return o;
    }

    function restore(o) {
      if (!o || o.v !== SAVE_V || typeof o.seed !== "number") return false;
      S.seed = o.seed;
      generate(S.seed);
      seen.fill(0);
      if (o.dug) { try { applyDug(o.dug); } catch (_) { /* strata stay pristine */ } }
      S.money = o.money || 0;
      S.lifetime = o.life || 0;
      const up = o.up || [];
      S.shovel = clamp(up[0] | 0, 0, SHOVELS.length - 1);
      S.pack = clamp(up[1] | 0, 0, PACKS.length - 1);
      S.lamp = clamp(up[2] | 0, 0, LAMPS.length - 1);
      S.boots = clamp(up[3] | 0, 0, BOOTS.length - 1);
      S.suit = clamp(up[4] | 0, 0, SUITS.length - 1);
      const g = o.gear | 0;
      S.cart = !!(g & 1); S.winch = !!(g & 2); S.rod = !!(g & 4);
      const gd = o.goods || [];
      S.dyn = gd[0] | 0; S.kit = gd[1] | 0; S.rope = gd[2] | 0;
      S.inv = {};
      const inv = o.inv || {};
      for (const k in inv) {
        const id = k | 0;
        if (MAT[id] && MAT[id].kind === "ore" && inv[k] > 0) S.inv[id] = inv[k] | 0;
      }
      S.bones = {};
      for (const b of (o.bones || [])) S.bones[b] = true;
      S.trex = !!o.trex;
      S.chests = {};
      for (const c of (o.chests || [])) S.chests[c] = true;
      // Chests already emptied and fossils already lifted do not come back.
      for (const key in S.chests) {
        const parts = String(key).split(",");
        const cx = parts[0] | 0, cy = parts[1] | 0;
        if (inBounds(cx, cy) && grid[idx(cx, cy)] === M.CHEST) grid[idx(cx, cy)] = AIR;
      }
      for (const bk in S.bones) {
        const p = bonePlace[bk];
        if (p && grid[idx(p[0], p[1])] === M.BONE) grid[idx(p[0], p[1])] = AIR;
      }
      S.deepest = o.deep || 0;
      S.deepTile = Array.isArray(o.dt) && o.dt.length === 2 ? [o.dt[0] | 0, o.dt[1] | 0] : null;
      S.playMs = o.t || 0;
      S.finished = !!o.fin;
      S.firstCoreMs = o.core || 0;
      S.hp = clamp(o.hp || maxHp(), 1, maxHp());
      return true;
    }

    // ====================================================================
    // 9. SOUND
    // ====================================================================
    // A shovel needs to feel like it is hitting something, so the dig hits are
    // synthesised per material rather than being one sample pitched about: a
    // noise burst through a band-pass for the scrape, plus a body thump whose
    // pitch and decay follow the rock. ctx.music carries the bed underneath.
    let ac = null, master = null, dryBus = null, wetBus = null, noiseBuf = null;
    let audioOK = ctx.capabilities && ctx.capabilities.audio !== false;
    let muted = false, audioBuilt = false;

    function buildAudio() {
      if (audioBuilt) return ac;
      audioBuilt = true;
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC || !audioOK) { audioOK = false; return null; }
      try { ac = new AC(); } catch (_) { audioOK = false; return null; }

      master = ac.createGain();
      master.gain.value = 0.85;
      const comp = ac.createDynamicsCompressor();
      comp.threshold.value = -14; comp.ratio.value = 3.2;
      comp.attack.value = 0.003; comp.release.value = 0.25;
      master.connect(comp); comp.connect(ac.destination);

      dryBus = ac.createGain(); dryBus.gain.value = 1; dryBus.connect(master);

      // Cave reverb: decaying noise, rolled off up top so the tail reads as
      // stone rather than hiss.
      wetBus = ac.createGain(); wetBus.gain.value = 0.5;
      try {
        const verb = ac.createConvolver();
        const len = Math.floor(ac.sampleRate * 1.9);
        const buf = ac.createBuffer(2, len, ac.sampleRate);
        for (let c = 0; c < 2; c++) {
          const d = buf.getChannelData(c);
          for (let i = 0; i < len; i++) {
            const t = i / len;
            d[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, 3.4);
          }
        }
        verb.buffer = buf;
        const cut = ac.createBiquadFilter();
        cut.type = "lowpass"; cut.frequency.value = 4200;
        wetBus.connect(verb); verb.connect(cut); cut.connect(master);
      } catch (_) { wetBus.connect(master); }

      noiseBuf = ac.createBuffer(1, Math.floor(ac.sampleRate * 0.7), ac.sampleRate);
      const nd = noiseBuf.getChannelData(0);
      for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;

      ctx.onDestroy(() => { try { ac.close(); } catch (_) {} });
      return ac;
    }

    let resuming = false;
    function tryResume() {
      if (!ac || ac.state === "running" || resuming) return;
      resuming = true;
      let p;
      try { p = ac.resume(); } catch (_) { resuming = false; return; }
      if (p && p.then) p.then(() => { resuming = false; }, () => { resuming = false; });
      else resuming = false;
    }
    // Mobile WebViews hand back a suspended context and only unlock it inside a
    // real gesture, so this runs on every press.
    function unlockAudio() {
      if (!ac && !buildAudio()) return;
      tryResume();
      try {
        const b = ac.createBuffer(1, 1, ac.sampleRate || 22050);
        const s = ac.createBufferSource();
        s.buffer = b; s.connect(ac.destination); s.start(0);
      } catch (_) {}
    }

    const now = () => (ac ? ac.currentTime : 0);
    function ready() { return !muted && ac && ac.state === "running"; }

    function noise(dur, gain, type, f0, f1, q, wet) {
      if (!ready()) return;
      const t = now();
      const src = ac.createBufferSource();
      src.buffer = noiseBuf;
      src.playbackRate.value = 0.85 + Math.random() * 0.3;
      const flt = ac.createBiquadFilter();
      flt.type = type || "bandpass";
      flt.frequency.setValueAtTime(f0, t);
      if (f1 && f1 !== f0) flt.frequency.exponentialRampToValueAtTime(Math.max(40, f1), t + dur);
      flt.Q.value = q == null ? 1.1 : q;
      const g = ac.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t + 0.006);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      src.connect(flt); flt.connect(g);
      g.connect(dryBus);
      if (wet) { const w = ac.createGain(); w.gain.value = wet; g.connect(w); w.connect(wetBus); }
      try { src.start(t); src.stop(t + dur + 0.05); } catch (_) {}
    }

    function tone(f0, f1, dur, gain, type, wet, delay) {
      if (!ready()) return;
      const t = now() + (delay || 0);
      const o = ac.createOscillator();
      o.type = type || "sine";
      o.frequency.setValueAtTime(f0, t);
      if (f1 && f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
      const g = ac.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g); g.connect(dryBus);
      if (wet) { const w = ac.createGain(); w.gain.value = wet; g.connect(w); w.connect(wetBus); }
      try { o.start(t); o.stop(t + dur + 0.06); } catch (_) {}
    }

    // --- the cues ---------------------------------------------------------
    const SFX = {
      // one shovel bite; hardness colours the scrape and the thump
      dig(hard, prog) {
        const h = clamp(hard, 1, 7);
        const bright = 420 + h * 300 + prog * 260;
        noise(0.055 + h * 0.004, 0.16 - h * 0.008, "bandpass", bright, bright * 0.55, 1.3, 0.1);
        tone(90 + h * 16, 52 + h * 10, 0.07, 0.10, "triangle", 0.05);
      },
      // the tile finally gives way
      breakTile(hard) {
        const h = clamp(hard, 1, 7);
        noise(0.2 + h * 0.012, 0.3, "bandpass", 900 + h * 340, 200, 0.8, 0.5);
        tone(150 - h * 8, 48, 0.24, 0.26, "triangle", 0.35);
      },
      step() { noise(0.035, 0.05, "lowpass", 620, 320, 0.7, 0.04); },
      // rarer ore, brighter arpeggio
      ore(rank) {
        const base = 520 * Math.pow(1.0595, Math.min(24, rank * 3));
        tone(base, base, 0.16, 0.16, "triangle", 0.4);
        tone(base * 1.5, base * 1.5, 0.2, 0.12, "sine", 0.5, 0.055);
        if (rank >= 3) tone(base * 2, base * 2, 0.28, 0.10, "sine", 0.6, 0.11);
        if (rank >= 5) tone(base * 3, base * 3, 0.34, 0.07, "sine", 0.7, 0.17);
      },
      coin() {
        tone(1180, 1180, 0.09, 0.11, "square", 0.2);
        tone(1760, 1760, 0.16, 0.09, "square", 0.3, 0.05);
      },
      sell(n) {
        for (let i = 0; i < Math.min(6, n); i++) {
          tone(880 * Math.pow(1.26, i), 880 * Math.pow(1.26, i), 0.13, 0.09, "square", 0.25, i * 0.055);
        }
        tone(220, 165, 0.5, 0.12, "sawtooth", 0.3, 0.1);
      },
      buy() {
        tone(392, 392, 0.12, 0.13, "triangle", 0.2);
        tone(523, 523, 0.14, 0.13, "triangle", 0.25, 0.07);
        tone(784, 784, 0.3, 0.12, "triangle", 0.4, 0.14);
      },
      deny() { tone(180, 120, 0.18, 0.13, "sawtooth", 0.1); },
      hurt() {
        noise(0.16, 0.24, "lowpass", 900, 200, 0.9, 0.2);
        tone(180, 70, 0.26, 0.2, "sawtooth", 0.15);
      },
      fuse() { noise(0.5, 0.05, "highpass", 2600, 5200, 0.6, 0.1); },
      boom() {
        noise(0.85, 0.5, "lowpass", 1400, 90, 0.7, 0.9);
        tone(120, 26, 0.75, 0.42, "sine", 0.5);
        tone(64, 20, 1.0, 0.3, "triangle", 0.4, 0.02);
      },
      rumble() { noise(1.2, 0.14, "lowpass", 260, 70, 0.6, 0.6); },
      chest() {
        noise(0.28, 0.14, "bandpass", 700, 1500, 2.2, 0.4);
        const n = [523, 659, 784, 1046];
        for (let i = 0; i < n.length; i++) tone(n[i], n[i], 0.4, 0.12, "triangle", 0.55, 0.09 + i * 0.075);
      },
      bone() {
        const n = [294, 392, 466, 587, 698];
        for (let i = 0; i < n.length; i++) tone(n[i], n[i], 0.9, 0.09, "sine", 0.8, i * 0.1);
        noise(0.5, 0.06, "highpass", 3000, 6000, 0.5, 0.5);
      },
      trex() {
        tone(70, 44, 1.5, 0.4, "sawtooth", 0.6);
        tone(140, 88, 1.5, 0.2, "square", 0.5, 0.05);
        noise(1.3, 0.22, "lowpass", 1100, 150, 0.7, 0.8);
      },
      lift() { noise(0.7, 0.08, "bandpass", 300, 1400, 1.4, 0.3); tone(220, 660, 0.7, 0.08, "sine", 0.4); },
      drop() { noise(0.9, 0.10, "bandpass", 1400, 260, 1.4, 0.4); tone(660, 190, 0.9, 0.09, "sine", 0.4); },
      heal() { tone(523, 784, 0.4, 0.12, "sine", 0.4); tone(659, 988, 0.5, 0.09, "sine", 0.5, 0.08); },
      core() {
        const n = [131, 165, 196, 262, 330, 392, 523];
        for (let i = 0; i < n.length; i++) tone(n[i], n[i], 2.6, 0.11, "triangle", 0.9, i * 0.16);
        noise(2.4, 0.1, "lowpass", 400, 120, 0.6, 0.9);
      }
    };

    // --- the bed ----------------------------------------------------------
    let musicOn = ctx.capabilities && ctx.capabilities.backgroundMusic !== false;
    let musicHandle = null, musicPreset = "";
    async function startMusic(preset) {
      if (!musicOn || muted) return;
      try {
        await ctx.music.unlock();
        musicHandle = await ctx.music.play({ preset, volume: 0.34, tempo: 96, intensity: 0.45, fadeInMs: 1400 });
        musicPreset = preset;
      } catch (_) { musicOn = false; }
    }
    function setMusicZone(z) {
      if (!musicOn || muted || !z || z.music === musicPreset) return;
      musicPreset = z.music;
      try { ctx.music.setPreset(z.music, { fadeMs: 1800 }); } catch (_) {}
    }
    function duck(a, ms) { if (musicOn && !muted) { try { ctx.music.duck(a, ms); } catch (_) {} } }

    function setMuted(v) {
      muted = v;
      if (master) { try { master.gain.value = v ? 0 : 0.85; } catch (_) {} }
      try { v ? ctx.music.pause() : ctx.music.resume(); } catch (_) {}
    }

    const haptic = (k) => { if (ctx.capabilities && ctx.capabilities.haptics) { try { ctx.platform.haptic(k); } catch (_) {} } };

    // ====================================================================
    // 10. SURFACE + CANVAS
    // ====================================================================
    const canvas = ctx.createCanvas2D({ touchAction: "none" });
    const g = canvas.getContext("2d");
    const FONT = "-apple-system,system-ui,'Segoe UI',Roboto,sans-serif";

    let W = ctx.width, H = ctx.height, TS = 34, VW = 12, VH = 20;
    const cam = { x: 0, y: 0 };
    let shake = 0, shakeT = 0;

    // Buildings sit on the grass as scenery, not collision: walking into their
    // footprint is what opens them.
    const SPOTS = [
      { id: "shop",   x0: 2,  x1: 6,  label: "SHOP",   icon: "🛖" },
      { id: "museum", x0: 8,  x1: 11, label: "MUSEUM", icon: "🦴" },
      { id: "cart",   x0: 14, x1: 17, label: "MINE CART", icon: "⛏" }
    ];
    const START_X = 20;

    function layout() {
      W = ctx.width; H = ctx.height;
      TS = Math.round(clamp(Math.min(W / 11.2, H / 17.5), 20, 64));
      VW = Math.ceil(W / TS) + 2;
      VH = Math.ceil(H / TS) + 2;
    }
    layout();

    // ====================================================================
    // 11. TEXTURE BAKE
    // ====================================================================
    // The runtime owns every canvas in the DOM, so bakes go to an
    // OffscreenCanvas. Where a WebView has none, tiles are drawn live as flat
    // fills — plainer, never blank.
    const CAN_BAKE = typeof OffscreenCanvas === "function";
    const VARIANTS = 4;
    let atlas = null, atlasTS = 0;

    function makeSurface(w, h) {
      if (!CAN_BAKE) return null;
      try { return new OffscreenCanvas(Math.max(1, w | 0), Math.max(1, h | 0)); }
      catch (_) { return null; }
    }

    function drawIcon(c, kind, cx, cy, r, col, dark) {
      c.fillStyle = col;
      c.strokeStyle = dark || "rgba(0,0,0,0.45)";
      c.lineWidth = Math.max(1, r * 0.16);
      c.beginPath();
      switch (kind) {
        case "gem":
          c.moveTo(cx, cy - r); c.lineTo(cx + r * 0.82, cy - r * 0.18);
          c.lineTo(cx + r * 0.5, cy + r * 0.9); c.lineTo(cx - r * 0.5, cy + r * 0.9);
          c.lineTo(cx - r * 0.82, cy - r * 0.18); c.closePath();
          break;
        case "disc":
          c.arc(cx, cy, r * 0.82, 0, Math.PI * 2); break;
        case "shard":
          c.moveTo(cx - r * 0.6, cy + r * 0.85); c.lineTo(cx + r * 0.15, cy - r * 0.95);
          c.lineTo(cx + r * 0.7, cy + r * 0.2); c.lineTo(cx + r * 0.2, cy + r * 0.85);
          c.closePath(); break;
        case "blob":
          c.ellipse(cx, cy, r * 0.9, r * 0.72, 0.35, 0, Math.PI * 2); break;
        case "worm":
          c.lineWidth = r * 0.5; c.strokeStyle = col; c.lineCap = "round";
          c.moveTo(cx - r * 0.7, cy + r * 0.4);
          c.quadraticCurveTo(cx, cy - r * 0.8, cx + r * 0.7, cy + r * 0.3);
          c.stroke(); return;
        case "bag":
          c.moveTo(cx - r * 0.7, cy - r * 0.6); c.lineTo(cx + r * 0.7, cy - r * 0.4);
          c.lineTo(cx + r * 0.5, cy + r * 0.8); c.lineTo(cx - r * 0.6, cy + r * 0.7);
          c.closePath(); break;
        case "boot":
          c.moveTo(cx - r * 0.3, cy - r * 0.85); c.lineTo(cx + r * 0.2, cy - r * 0.85);
          c.lineTo(cx + r * 0.25, cy + r * 0.2); c.lineTo(cx + r * 0.85, cy + r * 0.35);
          c.lineTo(cx + r * 0.85, cy + r * 0.8); c.lineTo(cx - r * 0.35, cy + r * 0.8);
          c.closePath(); break;
        case "shell":
          c.arc(cx, cy + r * 0.3, r * 0.85, Math.PI, 0); c.closePath(); break;
        case "geode":
          c.arc(cx, cy, r * 0.9, 0, Math.PI * 2); c.closePath(); break;
        case "star":
          for (let i = 0; i < 10; i++) {
            const a = -Math.PI / 2 + (i * Math.PI) / 5;
            const rr = i % 2 ? r * 0.42 : r;
            i ? c.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr)
              : c.moveTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
          }
          c.closePath(); break;
        default:
          c.arc(cx, cy, r * 0.75, 0, Math.PI * 2);
      }
      c.fill(); c.stroke();
      if (kind === "geode") {
        c.fillStyle = "rgba(255,255,255,0.55)";
        c.beginPath(); c.arc(cx, cy, r * 0.42, 0, Math.PI * 2); c.fill();
      }
    }

    function paintTile(c, id, ox, oy, v, size) {
      const d = MAT[id];
      const r = mulberry(id * 977 + v * 31);
      c.fillStyle = d.base;
      c.fillRect(ox, oy, size, size);

      // grain: speckles of the highlight colour, denser for crumbly stuff
      const grain = d.grain == null ? 0.3 : d.grain;
      const n = Math.round(size * size * 0.012 * (0.5 + grain));
      c.fillStyle = d.spec;
      c.globalAlpha = 0.32 + grain * 0.28;
      for (let i = 0; i < n; i++) {
        const px = ox + r() * size, py = oy + r() * size;
        const s = 1 + r() * (size * 0.075);
        c.fillRect(px, py, s, s);
      }
      c.globalAlpha = 1;

      // relief: a lit top-left, a shaded bottom-right
      const gr = c.createLinearGradient(ox, oy, ox + size, oy + size);
      gr.addColorStop(0, "rgba(255,255,255,0.10)");
      gr.addColorStop(0.5, "rgba(255,255,255,0)");
      gr.addColorStop(1, "rgba(0,0,0,0.22)");
      c.fillStyle = gr;
      c.fillRect(ox, oy, size, size);

      if (d.kind === "ore") {
        const cx = ox + size * (0.35 + r() * 0.3), cy = oy + size * (0.35 + r() * 0.3);
        drawIcon(c, d.icon, cx, cy, size * 0.27, d.spec);
        c.fillStyle = "rgba(255,255,255,0.6)";
        c.beginPath();
        c.arc(cx - size * 0.08, cy - size * 0.09, size * 0.055, 0, Math.PI * 2);
        c.fill();
      } else if (d.kind === "bone") {
        c.strokeStyle = d.spec; c.lineWidth = size * 0.14; c.lineCap = "round";
        c.beginPath();
        c.moveTo(ox + size * 0.26, oy + size * 0.7);
        c.lineTo(ox + size * 0.74, oy + size * 0.3);
        c.stroke();
        c.fillStyle = d.spec;
        for (const p of [[0.22, 0.62], [0.3, 0.78], [0.7, 0.22], [0.78, 0.38]]) {
          c.beginPath(); c.arc(ox + size * p[0], oy + size * p[1], size * 0.1, 0, Math.PI * 2); c.fill();
        }
      } else if (d.kind === "boulder") {
        c.fillStyle = "rgba(0,0,0,0.35)";
        c.fillRect(ox, oy, size, size);
        c.fillStyle = d.base;
        c.beginPath(); c.arc(ox + size / 2, oy + size / 2, size * 0.44, 0, Math.PI * 2); c.fill();
        c.fillStyle = d.spec;
        c.beginPath(); c.arc(ox + size * 0.38, oy + size * 0.36, size * 0.16, 0, Math.PI * 2); c.fill();
        c.strokeStyle = "rgba(0,0,0,0.5)"; c.lineWidth = size * 0.05;
        c.beginPath(); c.arc(ox + size / 2, oy + size / 2, size * 0.44, 0, Math.PI * 2); c.stroke();
      } else if (d.kind === "gas") {
        c.fillStyle = "rgba(120,220,110,0.22)";
        for (let i = 0; i < 5; i++) {
          c.beginPath();
          c.arc(ox + size * (0.2 + r() * 0.6), oy + size * (0.2 + r() * 0.6), size * (0.08 + r() * 0.14), 0, Math.PI * 2);
          c.fill();
        }
      } else if (d.kind === "chest") {
        c.fillStyle = "rgba(0,0,0,0.4)"; c.fillRect(ox, oy, size, size);
        c.fillStyle = d.base;
        c.fillRect(ox + size * 0.1, oy + size * 0.3, size * 0.8, size * 0.6);
        c.fillStyle = d.spec;
        c.fillRect(ox + size * 0.1, oy + size * 0.3, size * 0.8, size * 0.13);
        c.fillRect(ox + size * 0.42, oy + size * 0.42, size * 0.16, size * 0.2);
        c.strokeStyle = "rgba(0,0,0,0.55)"; c.lineWidth = size * 0.05;
        c.strokeRect(ox + size * 0.1, oy + size * 0.3, size * 0.8, size * 0.6);
      }
    }

    function bakeAtlas() {
      if (!CAN_BAKE || atlasTS === TS) return;
      const cv = makeSurface(VARIANTS * TS, MAT.length * TS);
      if (!cv) { atlas = null; return; }
      const c = cv.getContext("2d");
      for (let id = 1; id < MAT.length; id++) {
        const d = MAT[id];
        if (d.kind === "lava" || d.kind === "core") continue;   // animated, drawn live
        for (let v = 0; v < VARIANTS; v++) paintTile(c, id, v * TS, id * TS, v, TS);
      }
      atlas = cv; atlasTS = TS;
    }

    // ====================================================================
    // 12. PARTICLES + FLOATING TEXT
    // ====================================================================
    const bits = [];      // debris
    const pops = [];      // floating labels
    const rings = [];     // shockwaves

    function spawnDebris(px, py, col, n, force) {
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2;
        const s = (0.35 + Math.random() * 0.9) * (force || 1);
        bits.push({
          x: px, y: py, vx: Math.cos(a) * s * TS * 3.4, vy: Math.sin(a) * s * TS * 3.4 - TS * 1.4,
          life: 0.45 + Math.random() * 0.5, t: 0, col, r: TS * (0.05 + Math.random() * 0.07)
        });
      }
      if (bits.length > 420) bits.splice(0, bits.length - 420);
    }
    function pop(px, py, text, col, big) {
      pops.push({ x: px, y: py, text, col, t: 0, life: big ? 1.9 : 1.15, big: !!big });
      if (pops.length > 26) pops.shift();
    }
    function ring(px, py, r, col) { rings.push({ x: px, y: py, r0: TS * 0.2, r1: r, col, t: 0, life: 0.6 }); }

    function stepParticles(dt) {
      for (let i = bits.length - 1; i >= 0; i--) {
        const b = bits[i];
        b.t += dt;
        if (b.t >= b.life) { bits.splice(i, 1); continue; }
        b.vy += TS * 13 * dt;
        b.x += b.vx * dt; b.y += b.vy * dt;
      }
      for (let i = pops.length - 1; i >= 0; i--) {
        const p = pops[i];
        p.t += dt;
        if (p.t >= p.life) pops.splice(i, 1);
        else p.y -= dt * TS * (p.big ? 0.5 : 0.9);
      }
      for (let i = rings.length - 1; i >= 0; i--) {
        rings[i].t += dt;
        if (rings[i].t >= rings[i].life) rings.splice(i, 1);
      }
      if (shakeT > 0) { shakeT -= dt; if (shakeT <= 0) shake = 0; }
    }
    function kick(amount, ms) { shake = Math.max(shake, amount); shakeT = Math.max(shakeT, ms / 1000); }

    // ====================================================================
    // 13. SCENERY ABOVE GROUND
    // ====================================================================
    let sky = null, skyKey = "";
    function bakeSky() {
      const key = W + "x" + H;
      if (skyKey === key && sky) return;
      const cv = makeSurface(Math.max(1, W), Math.max(1, Math.round(SKY * TS) + 40));
      skyKey = key;
      if (!cv) { sky = null; return; }
      const c = cv.getContext("2d");
      const h = cv.height;
      const grd = c.createLinearGradient(0, 0, 0, h);
      grd.addColorStop(0, "#1d2c52");
      grd.addColorStop(0.42, "#5a4d7a");
      grd.addColorStop(0.72, "#c76a55");
      grd.addColorStop(1, "#f0a35e");
      c.fillStyle = grd; c.fillRect(0, 0, cv.width, h);

      // low sun
      c.fillStyle = "rgba(255,232,170,0.9)";
      c.beginPath(); c.arc(cv.width * 0.76, h * 0.68, Math.min(cv.width, h) * 0.09, 0, Math.PI * 2); c.fill();
      c.fillStyle = "rgba(255,220,150,0.16)";
      c.beginPath(); c.arc(cv.width * 0.76, h * 0.68, Math.min(cv.width, h) * 0.22, 0, Math.PI * 2); c.fill();

      // two ridges of hills
      const r = mulberry(4242);
      for (let layer = 0; layer < 2; layer++) {
        c.fillStyle = layer ? "rgba(38,32,52,0.92)" : "rgba(70,56,84,0.7)";
        c.beginPath();
        c.moveTo(0, h);
        const baseY = h * (layer ? 0.9 : 0.78);
        for (let x = 0; x <= cv.width; x += 14) {
          const y = baseY - Math.sin(x * 0.006 + layer * 2.1) * h * 0.09 - r() * h * 0.02;
          c.lineTo(x, y);
        }
        c.lineTo(cv.width, h); c.closePath(); c.fill();
      }
      sky = cv;
    }

    // grassY is the screen y of the grass line; the sky is hung above it and
    // the colour of its top row is stretched over anything left over.
    function drawSky(grassY) {
      const h = SKY * TS + 40;
      const top = grassY - h;
      if (top > 0) { g.fillStyle = "#1d2c52"; g.fillRect(0, 0, W, top + 1); }
      if (sky) { g.drawImage(sky, 0, 0, sky.width, sky.height, 0, top, W, h); return; }
      const grd = g.createLinearGradient(0, top, 0, grassY);
      grd.addColorStop(0, "#1d2c52"); grd.addColorStop(0.72, "#c76a55"); grd.addColorStop(1, "#f0a35e");
      g.fillStyle = grd; g.fillRect(0, top, W, h);
    }

    function drawHut(px, py, s) {                // the shop
      g.fillStyle = "#5c3a22";
      g.fillRect(px - s * 1.1, py - s * 1.35, s * 2.2, s * 1.35);
      g.fillStyle = "#7d4f2c";
      for (let i = 0; i < 4; i++) g.fillRect(px - s * 1.1, py - s * 1.35 + i * s * 0.34, s * 2.2, s * 0.06);
      g.fillStyle = "#a5442f";
      g.beginPath();
      g.moveTo(px - s * 1.45, py - s * 1.3); g.lineTo(px, py - s * 2.1);
      g.lineTo(px + s * 1.45, py - s * 1.3); g.closePath(); g.fill();
      g.fillStyle = "#2a1b12";
      g.fillRect(px - s * 0.32, py - s * 0.82, s * 0.64, s * 0.82);
      g.fillStyle = "#ffd88a";
      g.fillRect(px + s * 0.42, py - s * 1.06, s * 0.44, s * 0.4);
      g.fillStyle = "#e8c46a";
      g.font = "700 " + (s * 0.34) + "px " + FONT;
      g.textAlign = "center"; g.textBaseline = "middle";
      g.fillText("SHOP", px, py - s * 1.62);
    }

    function drawMuseum(px, py, s, done) {       // the fossil tent
      g.fillStyle = "#26303c";
      g.beginPath();
      g.moveTo(px - s * 1.3, py); g.lineTo(px, py - s * 1.85);
      g.lineTo(px + s * 1.3, py); g.closePath(); g.fill();
      g.fillStyle = "#39475a";
      g.beginPath();
      g.moveTo(px - s * 0.5, py); g.lineTo(px, py - s * 1.85);
      g.lineTo(px + s * 0.15, py); g.closePath(); g.fill();
      g.fillStyle = done ? "#f0e2b8" : "#7d8698";
      g.font = "700 " + (s * 0.8) + "px " + FONT;
      g.textAlign = "center"; g.textBaseline = "alphabetic";
      g.fillText("🦴", px, py - s * 0.5);
    }

    function drawHeadframe(px, py, s, unlocked) {  // the winch over the shaft
      g.strokeStyle = unlocked ? "#c9a05a" : "#5a5f6b";
      g.lineWidth = Math.max(2, s * 0.13);
      g.lineCap = "round";
      g.beginPath();
      g.moveTo(px - s * 0.95, py); g.lineTo(px - s * 0.3, py - s * 2.0);
      g.moveTo(px + s * 0.95, py); g.lineTo(px + s * 0.3, py - s * 2.0);
      g.moveTo(px - s * 0.3, py - s * 2.0); g.lineTo(px + s * 0.3, py - s * 2.0);
      g.moveTo(px - s * 0.72, py - s * 0.62); g.lineTo(px + s * 0.72, py - s * 0.62);
      g.stroke();
      g.beginPath();
      g.arc(px, py - s * 2.2, s * 0.3, 0, Math.PI * 2);
      g.stroke();
      g.strokeStyle = "rgba(210,200,180,0.7)"; g.lineWidth = Math.max(1, s * 0.06);
      g.beginPath(); g.moveTo(px, py - s * 2.2); g.lineTo(px, py); g.stroke();
    }

    function drawSurface(gy) {
      // grass lip
      g.fillStyle = "#3f7a34";
      g.fillRect(0, gy - TS * 0.22, W, TS * 0.24);
      g.fillStyle = "#57a047";
      for (let x = 0; x < W; x += 5) {
        const h = 3 + hash2(x, 7) * TS * 0.22;
        g.fillRect(x, gy - TS * 0.22 - h, 2.5, h);
      }
      for (const sp of SPOTS) {
        const cx = ((sp.x0 + sp.x1) / 2 + 0.5 - cam.x) * TS;
        if (cx < -TS * 4 || cx > W + TS * 4) continue;
        if (sp.id === "shop") drawHut(cx, gy - TS * 0.2, TS);
        else if (sp.id === "museum") drawMuseum(cx, gy - TS * 0.2, TS, S.trex);
        else drawHeadframe(cx, gy - TS * 0.2, TS, S.cart);
      }
    }

    // ====================================================================
    // 14. THE MINER
    // ====================================================================
    const DIRS = [[1, 0], [0, 1], [-1, 0], [0, -1]];
    const P = {
      tx: START_X, ty: GROUND - 1,
      x: START_X, y: GROUND - 1,
      fx: START_X, fy: GROUND - 1,      // interpolation origin
      face: -1, dir: -1,
      mode: "idle",                     // idle | move | dig
      prog: 0, dur: 0,
      dtx: 0, dty: 0,                   // tile being dug
      anim: 0, swing: 0, bob: 0
    };
    const MOVE_MS = 168, DIG_MS = 380;
    let heatBurn = 0, regen = 0, invuln = 0;
    let deaths = 0, tilesDug = 0, sessionStart = 0;

    function placePlayer(x, y) {
      P.tx = x; P.ty = y; P.x = x; P.y = y; P.fx = x; P.fy = y;
      P.mode = "idle"; P.prog = 0; P.dir = -1; P.dtx = -1; P.dty = -1;
      cam.x = clamp(P.x - VW / 2 + 1, 0, Math.max(0, COLS - VW + 2));
      cam.y = P.y - VH / 2 + 1;
      arrived();
    }

    const atSurface = () => P.ty <= GROUND - 1;
    const playerDepth = () => Math.max(0, depthOf(P.ty));

    function spotUnder() {
      if (!atSurface()) return null;
      for (const sp of SPOTS) if (P.tx >= sp.x0 && P.tx <= sp.x1) return sp;
      return null;
    }

    // ====================================================================
    // 15. DIGGING AND PICKING THINGS UP
    // ====================================================================
    const rarityRank = (v) => (v < 30 ? 0 : v < 150 ? 1 : v < 800 ? 2 : v < 4000 ? 3 : v < 15000 ? 4 : 5);

    function addToPack(id, n) {
      const d = MAT[id];
      let added = 0;
      for (let i = 0; i < n; i++) {
        if (packFull()) break;
        S.inv[id] = (S.inv[id] || 0) + 1;
        added++;
      }
      if (added) {
        const rank = rarityRank(d.value);
        SFX.ore(rank);
        if (rank >= 4) { haptic("success"); duck(0.3, 400); } else haptic("light");
        pop(P.x, P.y - 0.5, d.name + (added > 1 ? " ×" + added : ""), d.spec, rank >= 4);
        ctx.platform.interact({ type: "collect", item: d.key });
      }
      if (added < n) {
        packWarn();
      }
      return added;
    }

    let lastWarn = 0;
    function packWarn() {
      if (S.playMs - lastWarn < 4000) return;
      lastWarn = S.playMs;
      toast("Backpack full — head up and sell");
      SFX.deny();
    }

    function collectBone(x, y) {
      let key = null;
      for (const bk in bonePlace) {
        const p = bonePlace[bk];
        if (p[0] === x && p[1] === y) { key = bk; break; }
      }
      if (!key) {
        const m = depthOf(y);
        for (const b of BONES) if (m >= b.from && m <= b.to && !S.bones[b.key]) { key = b.key; break; }
      }
      if (!key || S.bones[key]) { return; }
      S.bones[key] = true;
      const b = BONES.find((v) => v.key === key);
      SFX.bone(); haptic("success"); duck(0.5, 900);
      pop(P.x, P.y - 0.8, b.name + " found!", "#f2e8c9", true);
      const have = Object.keys(S.bones).length;
      toast("🦴 " + b.name + " — " + have + "/8 bones. The museum wants a word.");
      ctx.platform.milestone("bone_found", { bone: key, total: have });
      ring(P.x, P.y, TS * 3.5, "#f2e8c9");
      save(true);
    }

    function openChest(x, y) {
      const key = x + "," + y;
      if (S.chests[key]) return;
      S.chests[key] = true;
      grid[idx(x, y)] = AIR;
      const m = depthOf(y);
      const z = zoneAt(m);
      const rnd = mulberry(S.seed + x * 7919 + y * 104729);
      const cash = Math.round((300 + m * 26) * (0.75 + rnd() * 0.9));
      S.money += cash; S.lifetime += cash;
      SFX.chest(); haptic("success"); duck(0.45, 700);
      kick(TS * 0.18, 220);
      ring(x + 0.5, y + 0.5, TS * 4, "#ffd66b");
      pop(x + 0.5, y - 0.2, "$" + fmt(cash), "#ffd66b", true);
      let extra = [];
      if (rnd() < 0.55) { const n = 1 + Math.floor(rnd() * 3); S.dyn += n; extra.push(n + "× dynamite"); }
      if (rnd() < 0.3) { S.kit += 1; extra.push("a med kit"); }
      if (rnd() < 0.28) { S.rope += 1; extra.push("a rope ladder"); }
      if (rnd() < 0.75) {
        const oreId = M[pickWeighted(z.ore, rnd)];
        const n = 1 + Math.floor(rnd() * 3);
        const got = addToPack(oreId, n);
        if (got) extra.push(got + "× " + MAT[oreId].name);
      }
      toast("Chest: $" + fmt(cash) + (extra.length ? " and " + extra.join(", ") : ""));
      ctx.platform.interact({ type: "chest", depth: m });
      save(true);
    }

    function breakTile(x, y, byBlast) {
      const id = grid[idx(x, y)];
      if (id === AIR) return;
      const d = MAT[id];
      grid[idx(x, y)] = AIR;
      seen[idx(x, y)] = 255;
      tilesDug++;
      const px = x + 0.5, py = y + 0.5;
      spawnDebris(px, py, d.base, byBlast ? 3 : 6, byBlast ? 1.4 : 1);
      spawnDebris(px, py, d.spec, byBlast ? 2 : 3, byBlast ? 1.4 : 1);
      if (d.kind === "ore") addToPack(id, 1);
      else if (d.kind === "bone") collectBone(x, y);
      else if (d.kind === "gas") gasBlast(x, y);
      if (!byBlast) { SFX.breakTile(d.hard); haptic("light"); }
      settleAbove(x, y);
    }

    // Anything resting on a tile you just removed starts to fall.
    const falling = [];
    function settleAbove(x, y) {
      for (let k = 1; k <= 3; k++) {
        const yy = y - k;
        if (!inBounds(x, yy)) break;
        const id = grid[idx(x, yy)];
        if (id === AIR) continue;
        if (id === M.BOULDER) startFall(x, yy);
        break;
      }
    }
    function startFall(x, y) {
      for (const f of falling) if (f.x === x && f.y === y) return;
      grid[idx(x, y)] = AIR;
      falling.push({ x, y, fy: y, vy: 0, wait: 0.16 });
    }
    function stepFalling(dt) {
      for (let i = falling.length - 1; i >= 0; i--) {
        const f = falling[i];
        if (f.wait > 0) { f.wait -= dt; continue; }
        f.vy = Math.min(15, f.vy + 30 * dt);
        f.fy += f.vy * dt;
        const below = Math.floor(f.fy) + 1;
        // landed on the player?
        if (P.tx === f.x && Math.floor(f.fy + 0.5) === P.ty && invuln <= 0) {
          hurt(30, "A boulder found your head");
          kick(TS * 0.4, 320); SFX.rumble();
        }
        if (!inBounds(f.x, below) || grid[idx(f.x, below)] !== AIR) {
          const rest = Math.max(GROUND, Math.min(ROWS - 1, Math.round(f.fy)));
          f.y = rest; f.fy = rest;
          if (grid[idx(f.x, rest)] === AIR) grid[idx(f.x, rest)] = M.BOULDER;
          spawnDebris(f.x + 0.5, rest + 0.5, "#585a63", 6, 1.1);
          if (Math.abs(rest - P.ty) < 6 && Math.abs(f.x - P.tx) < 6) { SFX.breakTile(5); kick(TS * 0.12, 180); }
          falling.splice(i, 1);
        }
      }
    }

    function gasBlast(x, y) {
      SFX.boom(); duck(0.55, 700); kick(TS * 0.32, 340);
      ring(x + 0.5, y + 0.5, TS * 3.4, "#8fe07a");
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx, ny = y + dy;
          if (!inBounds(nx, ny) || ny < GROUND) continue;
          const id = grid[idx(nx, ny)];
          if (id !== AIR && MAT[id].kind !== "chest" && MAT[id].kind !== "lava" && MAT[id].kind !== "core") {
            if (MAT[id].hard <= 7) breakTile(nx, ny, true);
          }
        }
      }
      const dist = Math.abs(P.tx - x) + Math.abs(P.ty - y);
      if (dist <= 2) hurt(22, "Gas pocket");
      spawnDebris(x + 0.5, y + 0.5, "#8fe07a", 16, 1.7);
    }

    // ====================================================================
    // 16. DAMAGE, DEATH, HEALING
    // ====================================================================
    function hurt(n, why) {
      if (invuln > 0 || isEnding()) return;
      S.hp -= n;
      invuln = 0.55;
      SFX.hurt(); haptic("warning");
      kick(TS * 0.22, 260);
      hurtFlash = 1;
      pop(P.x, P.y - 0.4, "-" + Math.round(n), "#ff6b6b");
      if (S.hp <= 0) die(why);
    }
    let hurtFlash = 0;

    function die(why) {
      deaths++;
      const lost = {};
      let lostCount = 0;
      for (const k in S.inv) {
        const drop = Math.ceil(S.inv[k] / 2);
        if (drop > 0) { lost[k] = drop; lostCount += drop; S.inv[k] -= drop; if (S.inv[k] <= 0) delete S.inv[k]; }
      }
      S.hp = Math.max(1, Math.round(maxHp() * 0.5));
      placePlayer(START_X, GROUND - 1);
      SFX.rumble(); haptic("error");
      ctx.platform.emit("blackout", { depth: playerDepth(), lost: lostCount });
      toast(lostCount
        ? "You woke up on the grass. " + lostCount + " " + (lostCount === 1 ? "thing" : "things") + " did not come up with you."
        : "You woke up on the grass. Nothing to lose but your dignity.");
      save(true);
    }

    // ====================================================================
    // 17. EXPLOSIVES, ROPES AND THE CART
    // ====================================================================
    const bombs = [];
    function dropBomb() {
      if (S.dyn <= 0) { SFX.deny(); toast("No dynamite. The shop sells it."); return; }
      if (atSurface()) { SFX.deny(); toast("Not up here. Save it for the rock."); return; }
      S.dyn--;
      bombs.push({ x: P.tx, y: P.ty, t: 1.35 });
      SFX.fuse(); haptic("medium");
      toast("Fuse lit — move!");
      ctx.platform.interact({ type: "dynamite" });
    }
    function stepBombs(dt) {
      for (let i = bombs.length - 1; i >= 0; i--) {
        const b = bombs[i];
        b.t -= dt;
        if (b.t > 0) continue;
        bombs.splice(i, 1);
        detonate(b.x, b.y);
      }
    }
    function detonate(bx, by) {
      SFX.boom(); duck(0.7, 900); haptic("heavy");
      kick(TS * 0.55, 520);
      ring(bx + 0.5, by + 0.5, TS * 6, "#ffb347");
      const R = 2.6, power = shovel().power + 2;
      for (let y = Math.floor(by - R); y <= Math.ceil(by + R); y++) {
        for (let x = Math.floor(bx - R); x <= Math.ceil(bx + R); x++) {
          if (!inBounds(x, y) || y < GROUND) continue;
          if ((x - bx) * (x - bx) + (y - by) * (y - by) > R * R) continue;
          const id = grid[idx(x, y)];
          if (id === AIR) continue;
          const d = MAT[id];
          if (d.kind === "chest") { openChest(x, y); continue; }
          if (d.kind === "lava" || d.kind === "core") continue;
          if (d.kind === "boulder" || d.hard <= power) breakTile(x, y, true);
        }
      }
      spawnDebris(bx + 0.5, by + 0.5, "#ffb347", 22, 2.1);
      const dist = Math.hypot(P.tx - bx, P.ty - by);
      if (dist <= R) hurt(Math.round(34 - dist * 8), "Your own dynamite");
    }

    function toSurface(reason) {
      SFX.lift();
      placePlayer(START_X, GROUND - 1);
      toast(reason || "Hauled up to the grass.");
      save(true);
    }
    // Always available, so a bad tunnel and a blunt shovel can never strand you
    // at the bottom of a hole. Without a rope it costs you the haul, and that is
    // asked for rather than taken.
    function useRope() {
      if (atSurface()) { SFX.deny(); toast("You are already up here."); return; }
      if (S.winch) { toSurface("The winch hums. Up you go."); return; }
      if (S.rope > 0) { S.rope--; toSurface("Rope ladder used. Up you go."); return; }
      askHaul();
    }
    function haulOut() {
      const n = carried();
      S.inv = {};
      haptic("warning");
      toSurface(n
        ? "Pinch's lad hauled you out and kept the " + n + " " + (n === 1 ? "thing" : "things") +
          " in your bag as payment."
        : "Pinch's lad hauled you out. Nothing in the bag to argue over.");
    }
    function rideCart() {
      if (!S.cart) { SFX.deny(); toast("You do not own the mine cart yet."); return; }
      const t = S.deepTile;
      if (!t || depthOf(t[1]) < 4) { SFX.deny(); toast("Dig a proper hole first."); return; }
      let [x, y] = t;
      x = clamp(x | 0, 0, COLS - 1); y = clamp(y | 0, GROUND, ROWS - 2);
      if (grid[idx(x, y)] !== AIR) grid[idx(x, y)] = AIR;   // the shaft shifted; make room
      SFX.drop();
      seen[idx(x, y)] = 255;
      placePlayer(x, y);
      toast("Down to " + depthOf(y) + " m.");
      ctx.platform.interact({ type: "cart", depth: depthOf(y) });
    }

    // ====================================================================
    // 18. INPUT — one floating thumbstick
    // ====================================================================
    const stick = { on: false, id: -1, ox: 0, oy: 0, x: 0, y: 0, dir: -1 };
    const keys = {};
    let held = -1;          // direction currently requested, -1 for none
    let uiBlocked = false;  // a panel is open

    function stickDir() {
      const dx = stick.x - stick.ox, dy = stick.y - stick.oy;
      const mag = Math.hypot(dx, dy);
      if (mag < TS * 0.42) return -1;
      // Bias toward the direction already held so a slightly crooked thumb does
      // not chatter between two axes.
      const ax = Math.abs(dx), ay = Math.abs(dy);
      const cur = stick.dir;
      if (cur >= 0) {
        const axis = cur % 2;               // 0 = horizontal, 1 = vertical
        if (axis === 0 && ax > ay * 0.62) return dx > 0 ? 0 : 2;
        if (axis === 1 && ay > ax * 0.62) return dy > 0 ? 1 : 3;
      }
      return ax > ay ? (dx > 0 ? 0 : 2) : (dy > 0 ? 1 : 3);
    }

    function onDown(e) {
      if (uiBlocked) return;
      firstGesture();
      stick.on = true; stick.id = e.pointerId == null ? 1 : e.pointerId;
      stick.ox = stick.x = e.offsetX; stick.oy = stick.y = e.offsetY;
      stick.dir = -1;
      try { if (canvas.setPointerCapture && e.pointerId != null) canvas.setPointerCapture(e.pointerId); } catch (_) {}
      if (e.preventDefault) e.preventDefault();
    }
    function onMove(e) {
      if (!stick.on) return;
      if (e.pointerId != null && e.pointerId !== stick.id) return;
      stick.x = e.offsetX; stick.y = e.offsetY;
      stick.dir = stickDir();
      if (e.preventDefault) e.preventDefault();
    }
    function onUp(e) {
      if (e && e.pointerId != null && e.pointerId !== stick.id) return;
      stick.on = false; stick.dir = -1;
    }

    if (window.PointerEvent) {
      ctx.listen(canvas, "pointerdown", onDown, { passive: false });
      ctx.listen(canvas, "pointermove", onMove, { passive: false });
      ctx.listen(canvas, "pointerup", onUp);
      ctx.listen(canvas, "pointercancel", onUp);
      ctx.listen(canvas, "lostpointercapture", onUp);
    } else {
      // Very old WebViews: touch coordinates are viewport-relative, and the
      // canvas fills the bit container, so they line up closely enough.
      const t2e = (t) => ({ offsetX: t.clientX, offsetY: t.clientY, pointerId: 1, preventDefault: () => {} });
      ctx.listen(canvas, "touchstart", (e) => { onDown(t2e(e.changedTouches[0])); e.preventDefault(); }, { passive: false });
      ctx.listen(canvas, "touchmove", (e) => { onMove(t2e(e.changedTouches[0])); e.preventDefault(); }, { passive: false });
      ctx.listen(canvas, "touchend", () => onUp(null));
      ctx.listen(canvas, "touchcancel", () => onUp(null));
    }

    const KEYMAP = {
      ArrowRight: 0, KeyD: 0, ArrowDown: 1, KeyS: 1,
      ArrowLeft: 2, KeyA: 2, ArrowUp: 3, KeyW: 3
    };
    ctx.listen(window, "keydown", (e) => {
      if (KEYMAP[e.code] !== undefined) { keys[KEYMAP[e.code]] = true; firstGesture(); e.preventDefault(); }
      else if (e.code === "Space") { firstGesture(); dropBomb(); e.preventDefault(); }
      else if (e.code === "KeyE") { firstGesture(); actionKey(); }
    });
    ctx.listen(window, "keyup", (e) => { if (KEYMAP[e.code] !== undefined) keys[KEYMAP[e.code]] = false; });

    function keyDir() {
      for (let d = 0; d < 4; d++) if (keys[d]) return d;
      return -1;
    }

    // ====================================================================
    // 19. PLAYER STEP
    // ====================================================================
    const TOO_HARD = [
      "This rock laughs at your shovel.",
      "Sparks, but no progress. Better shovel needed.",
      "Your shovel pings off it. Upgrade time.",
      "Nope. That needs a serious tool."
    ];
    let hardWarn = 0;

    function canEnter(x, y) {
      if (!inBounds(x, y)) return false;
      if (y < GROUND - 1) return false;                    // no flying
      if (y < GROUND) return true;                          // the grass strip
      return grid[idx(x, y)] === AIR;
    }

    function tryDirection(d, dt) {
      const [dx, dy] = DIRS[d];
      const nx = P.tx + dx, ny = P.ty + dy;
      P.dir = d;
      if (dx) P.face = dx;
      if (!inBounds(nx, ny) || ny < GROUND - 1) return;
      const id = ny < GROUND ? AIR : grid[idx(nx, ny)];

      if (id === AIR) {
        P.mode = "move"; P.fx = P.x; P.fy = P.y; P.tx = nx; P.ty = ny;
        P.prog = 0; P.dur = MOVE_MS / bootMul();
        return;
      }
      const d2 = MAT[id];
      if (d2.kind === "chest") { openChest(nx, ny); return; }
      if (d2.kind === "lava") {
        if (invuln <= 0) { hurt(18, "Lava"); toast("Lava. Go around."); }
        return;
      }
      if (d2.kind === "core") { reachCore(); return; }
      if (d2.kind === "boulder") {
        // shove it sideways if there is somewhere for it to go
        const bx = nx + dx, by = ny + dy;
        if (dy === 0 && inBounds(bx, by) && grid[idx(bx, by)] === AIR && by >= GROUND) {
          grid[idx(nx, ny)] = AIR; grid[idx(bx, by)] = M.BOULDER;
          SFX.breakTile(4); haptic("medium");
          settleAbove(nx, ny);
          spawnDebris(nx + 0.5, ny + 0.5, "#585a63", 4, 0.8);
        } else if (S.playMs - hardWarn > 3000) {
          hardWarn = S.playMs; SFX.deny();
          toast("That boulder is not moving. Try dynamite.");
        }
        return;
      }
      if (d2.hard > shovel().power) {
        if (S.playMs - hardWarn > 3200) {
          hardWarn = S.playMs; SFX.deny(); haptic("warning");
          toast(TOO_HARD[Math.floor(Math.random() * TOO_HARD.length)] +
            "  (" + d2.name + " needs " + SHOVELS[d2.hard - 1].name + ")");
        }
        return;
      }
      // Start, or pick up where a slipped thumb left off: progress only resets
      // when the tile being worked actually changes.
      if (P.dtx !== nx || P.dty !== ny) { P.dtx = nx; P.dty = ny; P.prog = 0; }
      P.mode = "dig";
      P.dur = (DIG_MS * d2.hard) / shovel().speed;
    }

    let digTick = 0;
    function stepPlayer(dt) {
      P.anim += dt;
      const want = stick.on && stick.dir >= 0 ? stick.dir : keyDir();
      held = want;

      if (P.mode === "idle") {
        if (want >= 0) tryDirection(want, dt);
      } else if (P.mode === "move") {
        P.prog += (dt * 1000) / P.dur;
        if (P.prog >= 1) {
          P.x = P.tx; P.y = P.ty; P.mode = "idle"; P.prog = 0;
          SFX.step();
          arrived();
          if (want >= 0) tryDirection(want, dt);
        } else {
          const t = P.prog;
          P.x = lerp(P.fx, P.tx, t); P.y = lerp(P.fy, P.ty, t);
        }
      } else if (P.mode === "dig") {
        if (want !== P.dir) { P.mode = "idle"; return; }      // keep the progress
        const still = grid[idx(P.dtx, P.dty)];
        if (still === AIR) { P.mode = "idle"; P.prog = 0; return; }
        P.prog += (dt * 1000) / P.dur;
        P.swing = (P.swing + dt * 15) % (Math.PI * 2);
        digTick -= dt;
        if (digTick <= 0) {
          digTick = 0.13;
          SFX.dig(MAT[still].hard, P.prog);
          spawnDebris(P.dtx + 0.5, P.dty + 0.5, MAT[still].base, 2, 0.5);
          if (P.prog > 0.35) haptic("light");
        }
        if (P.prog >= 1) {
          breakTile(P.dtx, P.dty);
          P.mode = "move"; P.fx = P.x; P.fy = P.y;
          P.tx = P.dtx; P.ty = P.dty;
          P.prog = 0; P.dur = MOVE_MS / bootMul();
        }
      }
    }

    function arrived() {
      const m = playerDepth();
      if (m > S.deepest) {
        const before = S.deepest;
        S.deepest = m;
        if (Math.floor(m / 50) > Math.floor(before / 50)) {
          ctx.platform.milestone("depth_" + Math.floor(m / 50) * 50, { depth: m });
          pop(P.x, P.y - 1, Math.floor(m / 50) * 50 + " m", "#ffe9a3", true);
          haptic("medium");
          submitDepth();
        }
        ctx.platform.setProgress(clamp(m / CORE_M, 0, 1));
      }
      if (P.ty >= GROUND && (!S.deepTile || P.ty > S.deepTile[1])) S.deepTile = [P.tx, P.ty];
      const z = zoneAt(Math.max(1, m));
      if (z !== curZone) { enterZone(z); }
      if (grid[idx(P.tx, P.ty)] === M.CORESTONE) reachCore();
    }

    let curZone = null;
    function enterZone(z) {
      const first = curZone === null;
      curZone = z;
      setMusicZone(z);
      if (!first && P.ty >= GROUND) {
        let tail = "";
        if (z.heat && z.heat > heatRes()) tail = " — it is far too hot down here";
        else if (z.from > CORE_M - 20) {
          // The chamber is not directly below wherever you happened to dig.
          tail = " — something is glowing to the " + (CORE.x < P.tx ? "left" : "right");
        }
        toast("▼ " + z.name + tail);
        ctx.platform.milestone("zone", { zone: z.name });
      }
    }

    // ====================================================================
    // 20. LIGHT
    // ====================================================================
    let lightLayer = null, lightKey = "";
    function ensureLayer() {
      const key = W + "x" + H;
      if (lightKey === key && lightLayer) return lightLayer;
      lightKey = key;
      lightLayer = makeSurface(Math.max(1, Math.round(W)), Math.max(1, Math.round(H)));
      return lightLayer;
    }

    const emitters = [];                 // visible glowing tiles, rebuilt per frame
    function ambientDark(m) {
      if (m <= 2) return 0;
      return clamp((m - 2) / 30, 0, 1) * 0.84;
    }

    function markSeen() {
      const r = Math.ceil(lampR()) + 1;
      const cx = Math.round(P.x), cy = Math.round(P.y);
      for (let y = cy - r; y <= cy + r; y++) {
        for (let x = cx - r; x <= cx + r; x++) {
          if (!inBounds(x, y)) continue;
          const d = Math.hypot(x - P.x, y - P.y);
          if (d <= lampR() + 0.6) seen[idx(x, y)] = 255;
        }
      }
      // daylight near the surface
      for (let y = 0; y < GROUND + 3; y++) for (let x = 0; x < COLS; x++) seen[idx(x, y)] = 255;
      for (const e of emitters) {
        const r2 = Math.ceil(e.r);
        for (let y = e.y - r2; y <= e.y + r2; y++) {
          for (let x = e.x - r2; x <= e.x + r2; x++) {
            if (!inBounds(x, y)) continue;
            if (Math.hypot(x - e.x, y - e.y) <= e.r) seen[idx(x, y)] = 255;
          }
        }
      }
    }

    // ====================================================================
    // 21. DRAW
    // ====================================================================
    function tileScreen(x, y) { return [(x - cam.x) * TS, (y - cam.y) * TS]; }

    function draw(dt) {
      // camera chases the miner, then is nudged by any active screen shake
      const tgtX = clamp(P.x - VW / 2 + 1, 0, Math.max(0, COLS - (W / TS)));
      const tgtY = P.y - (H / TS) * 0.5 + 0.5;
      const k = 1 - Math.pow(0.0015, dt);
      cam.x += (tgtX - cam.x) * k;
      cam.y += (tgtY - cam.y) * k;
      cam.y = clamp(cam.y, -SKY * 0.4, ROWS - H / TS);
      let sx = 0, sy = 0;
      if (shake > 0 && shakeT > 0) {
        sx = (Math.random() - 0.5) * shake; sy = (Math.random() - 0.5) * shake;
      }
      g.setTransform(1, 0, 0, 1, sx, sy);

      const zNow = zoneAt(Math.max(1, playerDepth()));
      g.fillStyle = "#07060a";
      g.fillRect(-4, -4, W + 8, H + 8);

      const x0 = Math.max(0, Math.floor(cam.x) - 1), x1 = Math.min(COLS - 1, Math.ceil(cam.x + W / TS) + 1);
      const y0 = Math.max(0, Math.floor(cam.y) - 1), y1 = Math.min(ROWS - 1, Math.ceil(cam.y + H / TS) + 1);

      // sky and buildings, when any of the surface is on screen
      if (cam.y < GROUND + 1) {
        const grassY = (GROUND - cam.y) * TS;
        drawSky(grassY);
        drawSurface(grassY);
      }

      // gather emitters before tiles so the light pass can use them
      emitters.length = 0;
      const tt = P.anim;
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const id = grid[idx(x, y)];
          if (id === M.LAVA) { if (emitters.length < 48) emitters.push({ x, y, r: 3.6, col: "255,150,40" }); }
          else if (id === M.CORESTONE) { if (emitters.length < 48) emitters.push({ x, y, r: 9, col: "255,190,80" }); }
        }
      }
      markSeen();

      // --- tiles ---------------------------------------------------------
      const dowse = S.rod ? 7.5 : 0;
      for (let y = y0; y <= y1; y++) {
        const m = depthOf(y);
        const zt = y >= GROUND ? zoneAt(Math.max(1, m)).tint : "#000";
        for (let x = x0; x <= x1; x++) {
          const i = idx(x, y);
          const id = grid[i];
          const px = Math.round((x - cam.x) * TS), py = Math.round((y - cam.y) * TS);
          if (id === AIR) {
            if (y >= GROUND && seen[i]) {                    // a tunnel you have opened
              g.fillStyle = "rgba(0,0,0,0.55)";
              g.fillRect(px, py, TS + 1, TS + 1);
            }
            continue;
          }
          if (!seen[i]) {
            // unexcavated: only the colour of the stratum shows through
            if (dowse && (MAT[id].kind === "ore" || MAT[id].kind === "bone") &&
                Math.hypot(x - P.x, y - P.y) < dowse) {
              g.fillStyle = MAT[id].spec;
              g.globalAlpha = 0.20 + 0.14 * Math.sin(tt * 4 + x + y);
              g.fillRect(px, py, TS + 1, TS + 1);
              g.globalAlpha = 1;
            } else {
              g.fillStyle = zt;
              g.globalAlpha = 0.11;
              g.fillRect(px, py, TS + 1, TS + 1);
              g.globalAlpha = 1;
            }
            continue;
          }
          const d = MAT[id];
          if (d.kind === "lava") { drawLava(px, py, x, y, tt); continue; }
          if (d.kind === "core") { drawCoreStone(px, py, tt); continue; }
          if (atlas) {
            const v = (hash2(x, y) * VARIANTS) | 0;
            g.drawImage(atlas, v * TS, id * TS, TS, TS, px, py, TS + 1, TS + 1);
          } else {
            g.fillStyle = d.base; g.fillRect(px, py, TS + 1, TS + 1);
            if (d.kind === "ore") drawIcon(g, d.icon, px + TS / 2, py + TS / 2, TS * 0.26, d.spec);
          }
          // tunnel lip: a highlight where rock meets open air above
          if (y > GROUND && grid[idx(x, y - 1)] === AIR) {
            g.fillStyle = "rgba(255,255,255,0.10)";
            g.fillRect(px, py, TS + 1, Math.max(1, TS * 0.09));
          }
        }
      }

      // digging crack overlay
      if (P.mode === "dig") {
        const [px, py] = tileScreen(P.dtx, P.dty);
        drawCracks(px, py, P.prog);
      }

      // --- falling boulders, bombs ---------------------------------------
      for (const f of falling) {
        const px = (f.x - cam.x) * TS, py = (f.fy - cam.y) * TS;
        g.fillStyle = "#585a63";
        g.beginPath(); g.arc(px + TS / 2, py + TS / 2, TS * 0.44, 0, Math.PI * 2); g.fill();
        g.fillStyle = "#787b86";
        g.beginPath(); g.arc(px + TS * 0.38, py + TS * 0.36, TS * 0.15, 0, Math.PI * 2); g.fill();
      }
      for (const b of bombs) {
        const px = (b.x + 0.5 - cam.x) * TS, py = (b.y + 0.5 - cam.y) * TS;
        const blink = b.t < 0.5 ? (Math.sin(b.t * 40) > 0 ? 1 : 0.4) : 1;
        g.fillStyle = "#b03a2e"; g.globalAlpha = blink;
        g.fillRect(px - TS * 0.2, py - TS * 0.26, TS * 0.4, TS * 0.52);
        g.globalAlpha = 1;
        g.strokeStyle = "#ffd27a"; g.lineWidth = Math.max(1, TS * 0.07);
        g.beginPath(); g.moveTo(px, py - TS * 0.26); g.lineTo(px + TS * 0.14, py - TS * 0.46); g.stroke();
        g.fillStyle = "#ffe9a3";
        g.beginPath(); g.arc(px + TS * 0.15, py - TS * 0.48, TS * (0.06 + Math.random() * 0.05), 0, Math.PI * 2); g.fill();
      }

      drawFlags();
      drawMiner();

      // --- particles ------------------------------------------------------
      for (const b of bits) {
        const a = 1 - b.t / b.life;
        g.globalAlpha = a;
        g.fillStyle = b.col;
        g.fillRect((b.x - cam.x) * TS - b.r, (b.y - cam.y) * TS - b.r, b.r * 2, b.r * 2);
      }
      g.globalAlpha = 1;
      for (const r of rings) {
        const t = r.t / r.life;
        g.globalAlpha = (1 - t) * 0.75;
        g.strokeStyle = r.col; g.lineWidth = Math.max(1.5, TS * 0.09 * (1 - t));
        g.beginPath();
        g.arc((r.x - cam.x) * TS, (r.y - cam.y) * TS, lerp(r.r0, r.r1, t), 0, Math.PI * 2);
        g.stroke();
      }
      g.globalAlpha = 1;

      // --- darkness --------------------------------------------------------
      const dark = ambientDark(playerDepth());
      if (dark > 0.02) {
        const lay = ensureLayer();
        if (lay) {
          const lc = lay.getContext("2d");
          lc.setTransform(1, 0, 0, 1, 0, 0);
          lc.globalCompositeOperation = "source-over";
          lc.fillStyle = "#000";
          lc.fillRect(0, 0, W, H);
          lc.globalCompositeOperation = "destination-out";
          const px = (P.x + 0.5 - cam.x) * TS, py = (P.y + 0.5 - cam.y) * TS;
          const rr = lampR() * TS * (1 + 0.02 * Math.sin(tt * 3));
          let grd = lc.createRadialGradient(px, py, rr * 0.12, px, py, rr);
          grd.addColorStop(0, "rgba(0,0,0,1)");
          grd.addColorStop(0.55, "rgba(0,0,0,0.86)");
          grd.addColorStop(1, "rgba(0,0,0,0)");
          lc.fillStyle = grd;
          lc.fillRect(px - rr, py - rr, rr * 2, rr * 2);
          for (const e of emitters) {
            const ex = (e.x + 0.5 - cam.x) * TS, ey = (e.y + 0.5 - cam.y) * TS;
            const er = e.r * TS;
            grd = lc.createRadialGradient(ex, ey, er * 0.1, ex, ey, er);
            grd.addColorStop(0, "rgba(0,0,0,0.95)");
            grd.addColorStop(1, "rgba(0,0,0,0)");
            lc.fillStyle = grd;
            lc.fillRect(ex - er, ey - er, er * 2, er * 2);
          }
          lc.globalCompositeOperation = "source-over";
          g.globalAlpha = dark;
          g.drawImage(lay, 0, 0);
          g.globalAlpha = 1;
        } else {
          g.fillStyle = "rgba(0,0,0," + (dark * 0.55).toFixed(3) + ")";
          g.fillRect(0, 0, W, H);
        }
        // warm cast from the lamp on top of the darkness
        const px = (P.x + 0.5 - cam.x) * TS, py = (P.y + 0.5 - cam.y) * TS;
        const rr = lampR() * TS;
        const warm = g.createRadialGradient(px, py, 0, px, py, rr);
        warm.addColorStop(0, "rgba(255,210,140,0.16)");
        warm.addColorStop(1, "rgba(255,180,90,0)");
        g.fillStyle = warm;
        g.fillRect(px - rr, py - rr, rr * 2, rr * 2);
      }
      for (const e of emitters) {
        const ex = (e.x + 0.5 - cam.x) * TS, ey = (e.y + 0.5 - cam.y) * TS;
        const er = e.r * TS * 0.8;
        const gl = g.createRadialGradient(ex, ey, 0, ex, ey, er);
        gl.addColorStop(0, "rgba(" + e.col + ",0.30)");
        gl.addColorStop(1, "rgba(" + e.col + ",0)");
        g.fillStyle = gl;
        g.fillRect(ex - er, ey - er, er * 2, er * 2);
      }

      // --- floating labels --------------------------------------------------
      g.textAlign = "center"; g.textBaseline = "middle";
      for (const p of pops) {
        const a = clamp(1 - p.t / p.life, 0, 1);
        g.globalAlpha = a;
        g.font = "800 " + Math.round(TS * (p.big ? 0.5 : 0.36)) + "px " + FONT;
        g.lineWidth = Math.max(2, TS * 0.1);
        g.strokeStyle = "rgba(0,0,0,0.75)";
        const px = (p.x + 0.5 - cam.x) * TS, py = (p.y + 0.5 - cam.y) * TS;
        g.strokeText(p.text, px, py);
        g.fillStyle = p.col;
        g.fillText(p.text, px, py);
      }
      g.globalAlpha = 1;

      if (hurtFlash > 0) {
        g.fillStyle = "rgba(190,30,40," + (hurtFlash * 0.34).toFixed(3) + ")";
        g.fillRect(0, 0, W, H);
        hurtFlash = Math.max(0, hurtFlash - dt * 2.6);
      }

      g.setTransform(1, 0, 0, 1, 0, 0);
      drawCoreCompass(tt);
      drawDepthBar();
      drawStick();
    }

    // Down here the last thing you need is to be tunnelling past the chamber in
    // the dark, so the heat points the way once you are on the core's level.
    function drawCoreCompass(t) {
      const m = playerDepth();
      if (m < CORE_M - 34 || tileAt(P.tx, P.ty) === M.CORESTONE) return;
      const dx = CORE.x - P.tx;
      if (Math.abs(dx) < 3) return;
      const right = dx > 0;
      const pulse = 0.45 + 0.35 * Math.sin(t * 3.4);
      const cy = H * 0.52, x = right ? W - 42 : 42;
      g.save();
      g.globalAlpha = pulse;
      const gl = g.createRadialGradient(x, cy, 0, x, cy, TS * 2.2);
      gl.addColorStop(0, "rgba(255,170,60,0.55)");
      gl.addColorStop(1, "rgba(255,140,30,0)");
      g.fillStyle = gl;
      g.fillRect(x - TS * 2.2, cy - TS * 2.2, TS * 4.4, TS * 4.4);
      g.strokeStyle = "#ffd27a";
      g.lineWidth = Math.max(2, TS * 0.1);
      g.lineCap = "round"; g.lineJoin = "round";
      for (let i = 0; i < 2; i++) {
        const off = (right ? 1 : -1) * i * TS * 0.34;
        g.beginPath();
        g.moveTo(x + off - (right ? TS * 0.22 : -TS * 0.22), cy - TS * 0.34);
        g.lineTo(x + off + (right ? TS * 0.22 : -TS * 0.22), cy);
        g.lineTo(x + off - (right ? TS * 0.22 : -TS * 0.22), cy + TS * 0.34);
        g.stroke();
      }
      g.restore();
    }

    function drawCracks(px, py, prog) {
      const n = Math.floor(prog * 5) + 1;
      g.strokeStyle = "rgba(10,8,6," + (0.35 + prog * 0.5).toFixed(2) + ")";
      g.lineWidth = Math.max(1, TS * 0.055 * (0.5 + prog));
      const r = mulberry(P.dtx * 31 + P.dty * 17);
      g.beginPath();
      for (let i = 0; i < n; i++) {
        const a = r() * Math.PI * 2;
        const len = TS * (0.2 + r() * 0.3) * (0.4 + prog);
        const cx = px + TS / 2, cy = py + TS / 2;
        g.moveTo(cx, cy);
        g.lineTo(cx + Math.cos(a) * len, cy + Math.sin(a) * len);
      }
      g.stroke();
      g.fillStyle = "rgba(0,0,0," + (prog * 0.25).toFixed(2) + ")";
      g.fillRect(px, py, TS, TS);
    }

    function drawLava(px, py, x, y, t) {
      const w = Math.sin(t * 2.1 + x * 0.9 + y * 0.6) * 0.5 + 0.5;
      g.fillStyle = "#8a1f06";
      g.fillRect(px, py, TS + 1, TS + 1);
      const grd = g.createLinearGradient(px, py, px, py + TS);
      grd.addColorStop(0, "#ff9a2a");
      grd.addColorStop(0.5 + w * 0.2, "#ff5c10");
      grd.addColorStop(1, "#a52a06");
      g.fillStyle = grd;
      g.fillRect(px, py + TS * 0.08, TS + 1, TS * 0.92);
      g.fillStyle = "rgba(255,230,150," + (0.3 + w * 0.4).toFixed(2) + ")";
      g.fillRect(px + TS * 0.15, py + TS * (0.2 + w * 0.1), TS * 0.7, TS * 0.1);
    }

    function drawCoreStone(px, py, t) {
      const w = Math.sin(t * 3) * 0.5 + 0.5;
      const grd = g.createRadialGradient(px + TS / 2, py + TS / 2, TS * 0.1, px + TS / 2, py + TS / 2, TS * 0.75);
      grd.addColorStop(0, "#fff6cf");
      grd.addColorStop(0.4, "#ffc24a");
      grd.addColorStop(1, "#c9450a");
      g.fillStyle = grd;
      g.fillRect(px, py, TS + 1, TS + 1);
      g.fillStyle = "rgba(255,255,220," + (0.15 + w * 0.25).toFixed(2) + ")";
      g.fillRect(px, py, TS + 1, TS + 1);
    }

    function drawMiner() {
      const px = (P.x + 0.5 - cam.x) * TS, py = (P.y + 0.5 - cam.y) * TS;
      const s = TS;
      const moving = P.mode === "move";
      const walk = moving ? Math.sin(P.anim * 20) : 0;
      const digging = P.mode === "dig";
      const swing = digging ? Math.sin(P.anim * 16) : 0;

      g.save();
      g.translate(px, py);
      if (invuln > 0 && Math.floor(invuln * 20) % 2 === 0) g.globalAlpha = 0.45;

      // shadow
      g.fillStyle = "rgba(0,0,0,0.35)";
      g.beginPath(); g.ellipse(0, s * 0.44, s * 0.26, s * 0.09, 0, 0, Math.PI * 2); g.fill();

      const suitCol = ["#3f6f8f", "#3f8f6a", "#8f6a3f", "#8f3f4f"][S.suit] || "#3f6f8f";

      // shovel, held in the facing direction
      g.save();
      g.translate(P.face * s * 0.2, s * 0.05);
      let ang = P.face > 0 ? -0.5 : 0.5;
      if (digging) ang += P.face * swing * 0.75;
      if (P.dir === 1) ang = P.face * 1.25;
      if (P.dir === 3) ang = -P.face * 0.15;
      g.rotate(ang);
      g.strokeStyle = "#8a5a30"; g.lineWidth = Math.max(1.5, s * 0.075); g.lineCap = "round";
      g.beginPath(); g.moveTo(0, 0); g.lineTo(0, s * 0.4); g.stroke();
      g.fillStyle = ["#9a9a9a", "#b8b8b8", "#c9c2a8", "#d8d8e6", "#bff4ff", "#a8e6ff", "#ffd27a"][S.shovel] || "#9a9a9a";
      g.beginPath();
      g.moveTo(-s * 0.12, s * 0.38); g.lineTo(s * 0.12, s * 0.38);
      g.lineTo(s * 0.09, s * 0.56); g.lineTo(-s * 0.09, s * 0.56);
      g.closePath(); g.fill();
      g.restore();

      // legs
      g.strokeStyle = "#2a2f38"; g.lineWidth = Math.max(1.5, s * 0.09); g.lineCap = "round";
      g.beginPath();
      g.moveTo(-s * 0.08, s * 0.14); g.lineTo(-s * 0.08 + walk * s * 0.1, s * 0.4);
      g.moveTo(s * 0.08, s * 0.14); g.lineTo(s * 0.08 - walk * s * 0.1, s * 0.4);
      g.stroke();

      // body
      g.fillStyle = suitCol;
      g.beginPath();
      g.moveTo(-s * 0.16, -s * 0.1); g.lineTo(s * 0.16, -s * 0.1);
      g.lineTo(s * 0.19, s * 0.18); g.lineTo(-s * 0.19, s * 0.18);
      g.closePath(); g.fill();

      // head + helmet
      g.fillStyle = "#e8bd94";
      g.beginPath(); g.arc(0, -s * 0.22, s * 0.14, 0, Math.PI * 2); g.fill();
      g.fillStyle = ["#e0b23c", "#e0b23c", "#d8683c", "#c9d2e0"][S.suit] || "#e0b23c";
      g.beginPath(); g.arc(0, -s * 0.24, s * 0.16, Math.PI, 0); g.fill();
      g.fillRect(P.face > 0 ? -s * 0.06 : -s * 0.2, -s * 0.26, s * 0.26, s * 0.05);
      // lamp
      g.fillStyle = "#fff3c4";
      g.beginPath(); g.arc(P.face * s * 0.1, -s * 0.28, s * 0.05, 0, Math.PI * 2); g.fill();
      // eye
      g.fillStyle = "#22201d";
      g.beginPath(); g.arc(P.face * s * 0.06, -s * 0.2, s * 0.022, 0, Math.PI * 2); g.fill();
      g.restore();
      g.globalAlpha = 1;

      // lamp cone, cast in the direction of travel
      if (playerDepth() > 3) {
        const dirA = P.dir === 1 ? Math.PI / 2 : P.dir === 3 ? -Math.PI / 2 : P.face > 0 ? 0 : Math.PI;
        const len = lampR() * TS * 0.95;
        g.save();
        g.translate(px, py - s * 0.24);
        g.rotate(dirA);
        const cone = g.createLinearGradient(0, 0, len, 0);
        cone.addColorStop(0, "rgba(255,236,180,0.20)");
        cone.addColorStop(1, "rgba(255,220,150,0)");
        g.fillStyle = cone;
        g.beginPath();
        g.moveTo(0, 0);
        g.lineTo(len, -len * 0.42);
        g.lineTo(len, len * 0.42);
        g.closePath(); g.fill();
        g.restore();
      }
    }

    // Right-edge strata gauge: every zone as a band, you as a bead on it.
    function drawDepthBar() {
      const bw = Math.max(8, Math.min(14, W * 0.028));
      const bx = W - bw - 10;
      const by = ctx.safeArea.top + 96;
      const bh = Math.max(120, H - by - ctx.safeArea.bottom - 190);
      g.fillStyle = "rgba(0,0,0,0.42)";
      roundRect(g, bx - 2, by - 2, bw + 4, bh + 4, bw * 0.6);
      g.fill();
      for (let i = 0; i < ZONES.length; i++) {
        const z = ZONES[i];
        const t0 = (z.from - 1) / CORE_M, t1 = Math.min(1, z.to / CORE_M);
        g.fillStyle = z.tint;
        g.globalAlpha = S.deepest >= z.from ? 0.95 : 0.32;
        g.fillRect(bx, by + t0 * bh, bw, Math.max(1, (t1 - t0) * bh));
      }
      g.globalAlpha = 1;
      // deepest ever
      const dy = by + clamp(S.deepest / CORE_M, 0, 1) * bh;
      g.strokeStyle = "rgba(255,255,255,0.5)"; g.lineWidth = 1.5;
      g.beginPath(); g.moveTo(bx - 3, dy); g.lineTo(bx + bw + 3, dy); g.stroke();
      // where you are now
      const py = by + clamp(playerDepth() / CORE_M, 0, 1) * bh;
      g.fillStyle = "#fff";
      g.beginPath(); g.arc(bx + bw / 2, py, bw * 0.52, 0, Math.PI * 2); g.fill();
      g.fillStyle = "#111";
      g.beginPath(); g.arc(bx + bw / 2, py, bw * 0.26, 0, Math.PI * 2); g.fill();

      g.textAlign = "right"; g.textBaseline = "middle";
      g.font = "800 " + Math.round(Math.min(16, W * 0.035)) + "px " + FONT;
      g.fillStyle = "rgba(255,255,255,0.92)";
      g.strokeStyle = "rgba(0,0,0,0.7)"; g.lineWidth = 3;
      const label = playerDepth() + " m";
      g.strokeText(label, bx - 8, py);
      g.fillText(label, bx - 8, py);
      g.font = "600 " + Math.round(Math.min(11, W * 0.026)) + "px " + FONT;
      g.fillStyle = "rgba(255,255,255,0.55)";
      g.strokeText(zoneAt(Math.max(1, playerDepth())).short, bx - 8, py + 15);
      g.fillText(zoneAt(Math.max(1, playerDepth())).short, bx - 8, py + 15);
    }

    function drawStick() {
      if (!stick.on) return;
      const r = TS * 1.25;
      g.globalAlpha = 0.3;
      g.fillStyle = "#000";
      g.beginPath(); g.arc(stick.ox, stick.oy, r, 0, Math.PI * 2); g.fill();
      g.globalAlpha = 0.55;
      g.strokeStyle = "#ffe9b8"; g.lineWidth = 2;
      g.beginPath(); g.arc(stick.ox, stick.oy, r, 0, Math.PI * 2); g.stroke();
      const dx = clamp(stick.x - stick.ox, -r, r), dy = clamp(stick.y - stick.oy, -r, r);
      g.globalAlpha = 0.8;
      g.fillStyle = "#ffe9b8";
      g.beginPath(); g.arc(stick.ox + dx, stick.oy + dy, r * 0.42, 0, Math.PI * 2); g.fill();
      if (stick.dir >= 0) {
        const [ax, ay] = DIRS[stick.dir];
        g.fillStyle = "rgba(255,255,255,0.9)";
        g.beginPath();
        g.arc(stick.ox + ax * r * 0.78, stick.oy + ay * r * 0.78, r * 0.13, 0, Math.PI * 2);
        g.fill();
      }
      g.globalAlpha = 1;
    }

    function roundRect(c, x, y, w, h, r) {
      const rr = Math.min(r, w / 2, h / 2);
      c.beginPath();
      c.moveTo(x + rr, y);
      c.arcTo(x + w, y, x + w, y + h, rr);
      c.arcTo(x + w, y + h, x, y + h, rr);
      c.arcTo(x, y + h, x, y, rr);
      c.arcTo(x, y, x + w, y, rr);
      c.closePath();
    }

    // ====================================================================
    // 22. OVERLAY
    // ====================================================================
    // Bits may not reach into the host DOM, so the whole overlay is declared as
    // markup on the runtime-owned root and the handles are queried back out.
    const ui = ctx.createRoot({ style: "pointer-events:none;" });
    const esc = (s) => String(s).replace(/[&<>"]/g,
      (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
    const fmt = (n) => {
      n = Math.round(n);
      if (n >= 1e9) return (n / 1e9).toFixed(2) + "B";
      if (n >= 1e6) return (n / 1e6).toFixed(2) + "M";
      return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    };
    const mmss = (ms) => {
      const s = Math.floor(ms / 1000);
      return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
    };

    const TOP = ctx.safeArea.top, BOT = ctx.safeArea.bottom;
    const BTN =
      "pointer-events:auto;min-width:40px;height:40px;border-radius:13px;border:none;cursor:pointer;" +
      "background:rgba(24,20,28,0.72);color:#f0e2c4;font-size:17px;line-height:1;padding:0 10px;" +
      "backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);" +
      "box-shadow:0 2px 12px rgba(0,0,0,0.5);font-family:" + FONT + ";";
    const BIGBTN =
      "pointer-events:auto;border:none;cursor:pointer;border-radius:14px;padding:11px 16px;" +
      "font-family:" + FONT + ";font-weight:800;font-size:14px;letter-spacing:0.3px;" +
      "background:linear-gradient(180deg,#f0b558,#d1892f);color:#2a1a08;" +
      "box-shadow:0 3px 14px rgba(0,0,0,0.5);";

    ui.innerHTML =
      '<div data-el="hud" style="position:absolute;left:12px;top:' + (TOP + 10) + 'px;pointer-events:none;' +
        'font-family:' + FONT + ';color:#f4e7cf;text-shadow:0 1px 6px rgba(0,0,0,0.85);"></div>' +
      '<div style="position:absolute;right:10px;top:' + (TOP + 10) + 'px;display:flex;gap:7px;pointer-events:none;">' +
        '<button data-el="mute" aria-label="Sound" style="' + BTN + '">🔊</button>' +
        '<button data-el="board" aria-label="Leaderboards" style="' + BTN + '">🏆</button>' +
        '<button data-el="help" aria-label="How to play" style="' + BTN + '">?</button>' +
      '</div>' +
      '<div data-el="toast" style="position:absolute;left:50%;transform:translateX(-50%);top:' + (TOP + 60) +
        'px;max-width:82%;text-align:center;pointer-events:none;font-family:' + FONT + ';font-size:13px;' +
        'font-weight:600;color:#fdf3e0;opacity:0;background:rgba(18,14,20,0.9);padding:9px 15px;' +
        'border-radius:999px;transition:opacity 0.3s;box-shadow:0 3px 14px rgba(0,0,0,0.5);"></div>' +
      '<div style="position:absolute;right:12px;bottom:' + (BOT + 16) + 'px;display:flex;flex-direction:column;' +
        'align-items:flex-end;gap:9px;pointer-events:none;">' +
        '<button data-el="act" style="' + BIGBTN + 'display:none;">OPEN</button>' +
        '<div style="display:flex;gap:9px;">' +
          '<button data-el="rope" aria-label="Rope up" style="' + BTN + 'min-width:52px;">🪢<small data-el="ropen" style="font-size:11px;margin-left:3px;">0</small></button>' +
          '<button data-el="bomb" aria-label="Dynamite" style="' + BTN + 'min-width:52px;">🧨<small data-el="bombn" style="font-size:11px;margin-left:3px;">0</small></button>' +
        '</div>' +
      '</div>' +
      '<div data-el="panel" style="position:absolute;inset:0;display:none;pointer-events:auto;' +
        'background:rgba(8,6,10,0.9);backdrop-filter:blur(5px);-webkit-backdrop-filter:blur(5px);' +
        'overflow-y:auto;-webkit-overflow-scrolling:touch;font-family:' + FONT + ';color:#f2e6d2;"></div>';

    const el = (n) => ui.querySelector('[data-el="' + n + '"]');
    const hudEl = el("hud"), toastEl = el("toast"), panel = el("panel");
    const actBtn = el("act"), bombBtn = el("bomb"), ropeBtn = el("rope");
    const bombN = el("bombn"), ropeN = el("ropen"), muteBtn = el("mute");

    function tap(node, fn) {
      if (!node) return;
      ctx.listen(node, "pointerdown", (e) => e.stopPropagation());
      ctx.listen(node, "touchstart", (e) => e.stopPropagation(), { passive: true });
      ctx.listen(node, "click", (e) => { e.stopPropagation(); firstGesture(); fn(e); });
    }

    let toastT = 0;
    function toast(msg) {
      toastEl.textContent = msg;
      toastEl.style.opacity = "1";
      toastT = 3.4;
    }

    // ====================================================================
    // 23. HUD
    // ====================================================================
    let hudKey = "";
    function drawHud() {
      const hp = Math.max(0, Math.round(S.hp)), mx = maxHp();
      const key = S.money + "|" + carried() + "|" + packSlots() + "|" + hp + "|" + mx + "|" + Object.keys(S.bones).length;
      if (key === hudKey) return;
      hudKey = key;
      const pc = clamp(hp / mx, 0, 1);
      const col = pc > 0.5 ? "#5fd18a" : pc > 0.22 ? "#f0c04a" : "#ef5f5f";
      hudEl.innerHTML =
        '<div style="font-size:19px;font-weight:800;letter-spacing:0.2px;">$' + fmt(S.money) + '</div>' +
        '<div style="font-size:12px;font-weight:700;opacity:0.9;margin-top:2px;">🎒 ' + carried() + ' / ' + packSlots() +
          '  <span style="opacity:0.7;">🦴 ' + Object.keys(S.bones).length + '/8</span></div>' +
        '<div style="margin-top:5px;width:104px;height:8px;border-radius:5px;background:rgba(0,0,0,0.55);overflow:hidden;">' +
          '<div style="width:' + (pc * 100).toFixed(1) + '%;height:100%;background:' + col + ';transition:width 0.2s;"></div>' +
        '</div>';
    }

    let actSpot = null;
    function refreshAct() {
      const sp = spotUnder();
      if (sp !== actSpot) {
        actSpot = sp;
        if (sp) {
          actBtn.style.display = "block";
          actBtn.textContent = sp.id === "shop" ? "🛖  OPEN SHOP"
            : sp.id === "museum" ? "🦴  MUSEUM"
            : (S.cart ? "⛏  RIDE DOWN" : "⛏  MINE HEAD");
        } else actBtn.style.display = "none";
      }
      const bn = String(S.dyn), rn = S.winch ? "∞" : String(S.rope);
      if (bombN.textContent !== bn) bombN.textContent = bn;
      if (ropeN.textContent !== rn) ropeN.textContent = rn;
      const bo = S.dyn > 0 ? "1" : "0.42";
      if (bombBtn.style.opacity !== bo) bombBtn.style.opacity = bo;
    }

    function actionKey() {
      const sp = spotUnder();
      if (!sp) return;
      if (sp.id === "shop") openShop();
      else if (sp.id === "museum") openMuseum();
      else rideCart();
    }

    tap(actBtn, actionKey);
    tap(bombBtn, dropBomb);
    tap(ropeBtn, useRope);
    tap(muteBtn, () => {
      setMuted(!muted);
      muteBtn.textContent = muted ? "🔇" : "🔊";
    });
    tap(el("help"), openHelp);
    tap(el("board"), openBoards);

    // ====================================================================
    // 24. PANELS
    // ====================================================================
    let panelOpen = "";
    function showPanel(name, html) {
      panelOpen = name;
      uiBlocked = true;
      stick.on = false; stick.dir = -1;
      for (const k in keys) keys[k] = false;
      panel.innerHTML = html;
      panel.style.display = "block";
      panel.scrollTop = 0;
      const close = panel.querySelector('[data-el="close"]');
      if (close) tap(close, closePanel);
      for (const b of panel.querySelectorAll("[data-buy]")) tap(b, () => doBuy(b.getAttribute("data-buy")));
      for (const b of panel.querySelectorAll("[data-act]")) tap(b, () => panelAct(b.getAttribute("data-act")));
    }
    function closePanel() {
      panel.style.display = "none";
      panel.innerHTML = "";
      panelOpen = "";
      uiBlocked = false;
    }
    function isEnding() { return panelOpen === "end"; }

    const SHEET =
      "max-width:520px;margin:0 auto;padding:0 16px " + (BOT + 28) + "px;";
    const HEAD = (title, sub) =>
      '<div style="position:sticky;top:0;z-index:2;background:linear-gradient(180deg,rgba(8,6,10,0.98),rgba(8,6,10,0.86));' +
        'padding:' + (TOP + 14) + 'px 0 12px;margin-bottom:6px;">' +
        '<div style="display:flex;align-items:center;gap:10px;">' +
          '<div style="flex:1;"><div style="font-size:20px;font-weight:800;">' + title + '</div>' +
          '<div style="font-size:12px;opacity:0.68;margin-top:2px;">' + sub + '</div></div>' +
          '<button data-el="close" style="' + BTN + '">✕</button>' +
        '</div></div>';
    const CARD = "background:rgba(255,255,255,0.055);border-radius:14px;padding:12px 13px;margin-bottom:9px;";
    const ROWBTN = (label, key, ok) =>
      '<button ' + (ok ? 'data-buy="' + key + '"' : 'disabled') + ' style="pointer-events:auto;border:none;' +
      'border-radius:11px;padding:9px 13px;font-family:' + FONT + ';font-weight:800;font-size:13px;white-space:nowrap;' +
      (ok ? 'background:linear-gradient(180deg,#f0b558,#d1892f);color:#2a1a08;cursor:pointer;'
          : 'background:rgba(255,255,255,0.09);color:rgba(255,255,255,0.35);') + '">' + label + '</button>';

    function tierRow(icon, track, level, nextName, effect, cost, key) {
      const maxed = level >= track.length - 1;
      const ok = !maxed && S.money >= cost;
      return '<div style="' + CARD + 'display:flex;align-items:center;gap:11px;">' +
        '<div style="font-size:22px;width:26px;text-align:center;">' + icon + '</div>' +
        '<div style="flex:1;min-width:0;">' +
          '<div style="font-weight:700;font-size:14px;">' + esc(maxed ? track[level].name : nextName) + '</div>' +
          '<div style="font-size:11.5px;opacity:0.66;margin-top:2px;">' + effect + '</div>' +
          '<div style="display:flex;gap:3px;margin-top:6px;">' +
            track.map((_, i) => '<div style="width:' + (100 / track.length) + '%;height:4px;border-radius:2px;background:' +
              (i <= level ? "#f0b558" : "rgba(255,255,255,0.15)") + ';"></div>').join("") +
          '</div>' +
        '</div>' +
        (maxed ? '<div style="font-size:12px;opacity:0.5;font-weight:700;">MAX</div>' : ROWBTN("$" + fmt(cost), key, ok)) +
        '</div>';
    }

    function goodRow(icon, name, blurb, cost, key, owned, ownedLabel) {
      const ok = !owned && S.money >= cost;
      return '<div style="' + CARD + 'display:flex;align-items:center;gap:11px;">' +
        '<div style="font-size:22px;width:26px;text-align:center;">' + icon + '</div>' +
        '<div style="flex:1;min-width:0;">' +
          '<div style="font-weight:700;font-size:14px;">' + esc(name) + '</div>' +
          '<div style="font-size:11.5px;opacity:0.66;margin-top:2px;">' + esc(blurb) + '</div>' +
        '</div>' +
        (owned ? '<div style="font-size:12px;opacity:0.55;font-weight:700;">' + (ownedLabel || "OWNED") + '</div>'
               : ROWBTN("$" + fmt(cost), key, ok)) +
        '</div>';
    }

    function openShop() {
      const inv = Object.keys(S.inv).filter((k) => S.inv[k] > 0)
        .sort((a, b) => MAT[b].value - MAT[a].value);
      const total = haulValue();
      let sellHtml;
      if (!inv.length) {
        sellHtml = '<div style="' + CARD + 'text-align:center;opacity:0.6;font-size:13px;padding:18px 12px;">' +
          'Your backpack is empty. Dig something up.</div>';
      } else {
        sellHtml = '<div style="' + CARD + '">' +
          inv.map((k) => {
            const d = MAT[k], n = S.inv[k];
            return '<div style="display:flex;align-items:center;gap:9px;padding:4px 0;font-size:13px;">' +
              '<span style="width:9px;height:9px;border-radius:3px;background:' + d.spec + ';flex:none;"></span>' +
              '<span style="flex:1;">' + esc(d.name) + ' <span style="opacity:0.55;">×' + n + '</span></span>' +
              '<span style="opacity:0.85;font-weight:700;">$' + fmt(d.value * n * luck()) + '</span></div>';
          }).join("") +
          (S.trex ? '<div style="font-size:11px;opacity:0.6;margin-top:7px;">Fossil King bonus: +15% on everything.</div>' : "") +
          '<div style="margin-top:11px;">' + ROWBTN("SELL EVERYTHING — $" + fmt(total), "sell", true) + '</div>' +
          '</div>';
      }

      const sh = S.shovel, pk = S.pack, lm = S.lamp, bt = S.boots, st = S.suit;
      showPanel("shop",
        '<div style="' + SHEET + '">' +
        HEAD("Pinch &amp; Sons", "Ore bought. Tools sold. No refunds, no questions.") +
        '<div style="font-size:13px;font-weight:800;opacity:0.75;margin:10px 2px 7px;">SELL YOUR HAUL</div>' +
        sellHtml +
        '<div style="font-size:13px;font-weight:800;opacity:0.75;margin:16px 2px 7px;">TOOLS</div>' +
        tierRow("⛏", SHOVELS, sh, sh < SHOVELS.length - 1 ? SHOVELS[sh + 1].name : "",
          sh < SHOVELS.length - 1 ? "Breaks hardness " + SHOVELS[sh + 1].power + " rock · " +
            SHOVELS[sh + 1].speed.toFixed(1) + "× faster" : "Nothing left to sharpen",
          sh < SHOVELS.length - 1 ? SHOVELS[sh + 1].cost : 0, "shovel") +
        tierRow("🎒", PACKS, pk, pk < PACKS.length - 1 ? PACKS[pk + 1].name : "",
          pk < PACKS.length - 1 ? "Carry " + PACKS[pk + 1].slots + " things" : "It already holds everything",
          pk < PACKS.length - 1 ? PACKS[pk + 1].cost : 0, "pack") +
        tierRow("🏮", LAMPS, lm, lm < LAMPS.length - 1 ? LAMPS[lm + 1].name : "",
          lm < LAMPS.length - 1 ? "See " + LAMPS[lm + 1].r.toFixed(1) + " m into the dark" : "Bright as day",
          lm < LAMPS.length - 1 ? LAMPS[lm + 1].cost : 0, "lamp") +
        tierRow("👢", BOOTS, bt, bt < BOOTS.length - 1 ? BOOTS[bt + 1].name : "",
          bt < BOOTS.length - 1 ? "Move " + Math.round((BOOTS[bt + 1].mul - 1) * 100) + "% faster" : "You are a blur",
          bt < BOOTS.length - 1 ? BOOTS[bt + 1].cost : 0, "boots") +
        tierRow("🦺", SUITS, st, st < SUITS.length - 1 ? SUITS[st + 1].name : "",
          st < SUITS.length - 1 ? SUITS[st + 1].hp + " health" +
            (SUITS[st + 1].heat > SUITS[st].heat ? " · survives " + (SUITS[st + 1].heat === 1 ? "the Magma Shelf" : "the Mantle") : "")
            : "Nothing down there can touch you",
          st < SUITS.length - 1 ? SUITS[st + 1].cost : 0, "suit") +
        '<div style="font-size:13px;font-weight:800;opacity:0.75;margin:16px 2px 7px;">GEAR</div>' +
        goodRow("🛒", GEAR.cart.name, GEAR.cart.blurb, GEAR.cart.cost, "cart", S.cart) +
        goodRow("🪝", GEAR.winch.name, GEAR.winch.blurb, GEAR.winch.cost, "winch", S.winch) +
        goodRow("🔱", GEAR.rod.name, GEAR.rod.blurb, GEAR.rod.cost, "rod", S.rod) +
        '<div style="font-size:13px;font-weight:800;opacity:0.75;margin:16px 2px 7px;">SUPPLIES</div>' +
        goodRow("🧨", GOODS.dyn.name + " (have " + S.dyn + ")", GOODS.dyn.blurb, GOODS.dyn.cost, "dyn", false) +
        goodRow("🧰", GOODS.kit.name + " (have " + S.kit + ")", GOODS.kit.blurb, GOODS.kit.cost, "kit", false) +
        goodRow("🪢", GOODS.rope.name + " (have " + S.rope + ")", GOODS.rope.blurb, GOODS.rope.cost, "rope",
          S.winch, "WINCH") +
        '<div style="text-align:center;opacity:0.4;font-size:11px;margin-top:14px;">' +
          'Lifetime earnings $' + fmt(S.lifetime) + ' · ' + mmss(S.playMs) + ' underground</div>' +
        '</div>');
    }

    function doBuy(key) {
      const spend = (cost) => {
        if (S.money < cost) { SFX.deny(); toast("Not enough money."); return false; }
        S.money -= cost; SFX.buy(); haptic("success");
        return true;
      };
      if (key === "sell") {
        const total = haulValue(), n = carried();
        if (!n) { SFX.deny(); return; }
        S.money += total; S.lifetime += total;
        S.inv = {};
        SFX.sell(n); haptic("success"); duck(0.4, 700);
        toast("Sold " + n + " " + (n === 1 ? "thing" : "things") + " for $" + fmt(total) + ".");
        ctx.platform.interact({ type: "sell", value: total });
        submitFortune();
        save(true); openShop();
        return;
      }
      const tracks = { shovel: [SHOVELS, "shovel"], pack: [PACKS, "pack"], lamp: [LAMPS, "lamp"], boots: [BOOTS, "boots"], suit: [SUITS, "suit"] };
      if (tracks[key]) {
        const [track, field] = tracks[key];
        const lvl = S[field];
        if (lvl >= track.length - 1) return;
        const nxt = track[lvl + 1];
        if (!spend(nxt.cost)) return;
        S[field] = lvl + 1;
        if (field === "suit") S.hp = Math.min(maxHp(), S.hp + (SUITS[lvl + 1].hp - SUITS[lvl].hp));
        toast("Bought the " + nxt.name + ".");
        ctx.platform.interact({ type: "upgrade", item: field, level: lvl + 1 });
        save(true); openShop();
        return;
      }
      if (key === "cart" || key === "winch" || key === "rod") {
        if (S[key]) return;
        if (!spend(GEAR[key].cost)) return;
        S[key] = true;
        toast(GEAR[key].name + " acquired.");
        save(true); openShop();
        return;
      }
      if (key === "dyn" || key === "kit" || key === "rope") {
        if (key === "rope" && S.winch) return;
        if (!spend(GOODS[key].cost)) return;
        if (key === "dyn") S.dyn++; else if (key === "kit") S.kit++; else S.rope++;
        save(true); openShop();
      }
    }

    function openMuseum() {
      const have = Object.keys(S.bones).length;
      const slots = BONES.map((b) => {
        const got = !!S.bones[b.key];
        return '<div style="' + CARD + 'display:flex;align-items:center;gap:11px;' +
          (got ? "" : "opacity:0.55;") + '">' +
          '<div style="font-size:21px;width:26px;text-align:center;">' + (got ? "🦴" : "❔") + '</div>' +
          '<div style="flex:1;"><div style="font-weight:700;font-size:14px;">' +
            (got ? esc(b.name) : "???") + '</div>' +
          '<div style="font-size:11.5px;opacity:0.66;margin-top:2px;">' +
            (got ? "Catalogued." : "Somewhere between " + b.from + " m and " + b.to + " m") + '</div></div></div>';
      }).join("");
      showPanel("museum",
        '<div style="' + SHEET + '">' +
        HEAD("The Museum of Under", "One tent. Eight bones. Big dreams.") +
        (S.trex
          ? '<div style="' + CARD + 'text-align:center;padding:22px 14px;">' +
            '<div style="font-size:44px;">🦖</div>' +
            '<div style="font-weight:800;margin-top:8px;font-size:16px;">Complete.</div>' +
            '<div style="font-size:12.5px;opacity:0.72;margin-top:6px;line-height:1.5;">He is 12 metres of reassembled ' +
            'menace and the curator has named him Terrence. Everything you sell is worth 15% more, because ' +
            'people come for Terrence and stay for the gift shop.</div></div>'
          : '<div style="' + CARD + 'text-align:center;padding:16px 14px;">' +
            '<div style="font-size:34px;opacity:' + (0.3 + have / 8 * 0.7).toFixed(2) + ';">🦖</div>' +
            '<div style="font-weight:800;margin-top:6px;">' + have + ' / 8 bones</div>' +
            '<div style="font-size:12.5px;opacity:0.7;margin-top:5px;line-height:1.5;">Bring all eight and the curator ' +
            'will build the tyrannosaur. He says the reward is "life-changing". He also says that about soup.</div>' +
            (have === 8
              ? '<div style="margin-top:12px;">' + ROWBTN("ASSEMBLE THE TYRANNOSAUR", "trex", true) + '</div>'
              : "") +
            '</div>') +
        '<div style="font-size:13px;font-weight:800;opacity:0.75;margin:14px 2px 7px;">THE COLLECTION</div>' +
        slots +
        '</div>');
      for (const b of panel.querySelectorAll('[data-buy="trex"]')) tap(b, buildTrex);
    }

    function buildTrex() {
      if (S.trex || Object.keys(S.bones).length < 8) return;
      S.trex = true;
      S.money += TREX_REWARD; S.lifetime += TREX_REWARD;
      SFX.trex(); haptic("success"); duck(0.6, 1400); kick(TS * 0.3, 700);
      toast("🦖 TERRENCE LIVES. $" + fmt(TREX_REWARD) + " and a 15% cut of every sale.");
      ctx.platform.milestone("trex_complete", {});
      submitFortune();
      save(true); openMuseum();
    }

    function askHaul() {
      const n = carried(), v = haulValue();
      SFX.deny();
      showPanel("haul",
        '<div style="' + SHEET + 'display:flex;flex-direction:column;justify-content:center;min-height:100%;">' +
        '<div style="' + CARD + 'padding:20px 17px;">' +
        '<div style="font-size:18px;font-weight:800;">No rope ladder.</div>' +
        '<div style="font-size:13.5px;line-height:1.65;opacity:0.84;margin-top:9px;">' +
        'You can always climb back up your own tunnel for free. Or Pinch\'s lad will drop a hook and haul you ' +
        'out right now — but he keeps what is in your bag as payment.' +
        (n ? ' That is <b>' + n + ' ' + (n === 1 ? "thing" : "things") + '</b>, worth <b>$' + fmt(v) + '</b>.'
           : ' Your bag is empty, so it costs you nothing.') +
        '</div>' +
        '<div style="display:flex;gap:9px;margin-top:16px;">' +
          '<button data-buy="haulno" style="pointer-events:auto;flex:1;border:none;border-radius:12px;padding:12px;' +
          'font-family:' + FONT + ';font-weight:800;font-size:13.5px;cursor:pointer;' +
          'background:rgba(255,255,255,0.11);color:#f2e6d2;">I\'ll climb</button>' +
          '<button data-buy="haulyes" style="pointer-events:auto;flex:1;border:none;border-radius:12px;padding:12px;' +
          'font-family:' + FONT + ';font-weight:800;font-size:13.5px;cursor:pointer;' +
          'background:linear-gradient(180deg,#f0b558,#d1892f);color:#2a1a08;">Haul me up</button>' +
        '</div></div></div>');
      for (const b of panel.querySelectorAll('[data-buy="haulno"]')) tap(b, closePanel);
      for (const b of panel.querySelectorAll('[data-buy="haulyes"]')) tap(b, () => { closePanel(); haulOut(); });
    }

    function openHelp() {
      showPanel("help",
        '<div style="' + SHEET + '">' +
        HEAD("How to dig", "It is a hole. You are in it.") +
        '<div style="' + CARD + 'font-size:13.5px;line-height:1.65;">' +
        '<div style="margin-bottom:9px;"><b>1. Steer with your thumb.</b> Press anywhere on the ground and drag. ' +
        'Push into dirt and you dig it; push into open tunnel and you walk.</div>' +
        '<div style="margin-bottom:9px;"><b>2. Fill the backpack.</b> Ore, gems, junk — it all sells. ' +
        'It fills up fast, and you can only carry so much.</div>' +
        '<div style="margin-bottom:9px;"><b>3. Climb back up and sell.</b> The shop is the hut on the surface. ' +
        'Walk onto it and the OPEN SHOP button appears.</div>' +
        '<div style="margin-bottom:9px;"><b>4. Buy a better shovel.</b> Rock gets harder every stratum. ' +
        'If your shovel pings off, that is the game telling you to shop.</div>' +
        '<div style="margin-bottom:9px;"><b>5. Mind the hazards.</b> Boulders fall when you dig underneath them, ' +
        'green gas pockets go bang, and lava is exactly as friendly as it looks.</div>' +
        '<div style="margin-bottom:9px;"><b>6. 🧨 blasts a crater</b> and clears boulders. ' +
        '🪢 always gets you home — with a rope ladder you keep your haul, without one Pinch\'s lad keeps ' +
        'the bag as payment. The mine cart at the headframe drops you back to your deepest tunnel.</div>' +
        '<div style="margin-bottom:9px;"><b>7. Eight fossils are buried down there</b>, one per stratum. ' +
        'The museum tent wants all of them.</div>' +
        '<div><b>8. The core is at 1000 m.</b> Someone is down there. He has been waiting a while.</div>' +
        '</div>' +
        '<div style="' + CARD + 'font-size:12.5px;line-height:1.6;opacity:0.78;">' +
        '<b>On a keyboard:</b> arrows or WASD to dig and move, <b>space</b> for dynamite, <b>E</b> to use whatever ' +
        'you are standing on.</div>' +
        '<div style="' + CARD + 'font-size:12.5px;line-height:1.6;opacity:0.78;">' +
        'Your dig is saved automatically — the shaft, the money, the bones, all of it. Close the Bit and come back to ' +
        'the exact hole you left.</div>' +
        '<div style="text-align:center;margin-top:14px;">' + ROWBTN("BACK TO DIGGING", "close2", true) + '</div>' +
        '</div>');
      for (const b of panel.querySelectorAll('[data-buy="close2"]')) tap(b, closePanel);
    }

    // ====================================================================
    // 25. MEMORY — saves, leaderboards, the poll, the flags
    // ====================================================================
    const SKEY = "deep_pockets_save";
    let lastSave = 0, saveBusy = false;

    async function save(force) {
      if (saveBusy) return;
      if (!force && S.playMs - lastSave < 12000) return;
      lastSave = S.playMs;
      saveBusy = true;
      try {
        const full = snapshot(true);
        if (ctx.capabilities && ctx.capabilities.storage) {
          try { await ctx.storage.set(SKEY, full); } catch (_) {}
        }
        const lean = snapshot(false);
        try { await ctx.memory.local("progress").set(lean); } catch (_) {}
      } catch (_) { /* a failed save must never interrupt play */ }
      saveBusy = false;
    }

    async function load() {
      let data = null;
      if (ctx.capabilities && ctx.capabilities.storage) {
        try {
          const v = ctx.storage.get(SKEY);
          data = v && typeof v.then === "function" ? await v : v;
        } catch (_) {}
      }
      if (!data) {
        try {
          const v = await ctx.memory.local("progress").get();
          data = v && v.value !== undefined ? v.value : v;
        } catch (_) {}
      }
      if (data && restore(data)) return true;
      return false;
    }

    let lastDepthSubmit = 0;
    async function submitDepth() {
      if (S.deepest <= lastDepthSubmit) return;
      lastDepthSubmit = S.deepest;
      try { await ctx.memory.record("depth").submit(S.deepest, { label: S.deepest + " m" }); } catch (_) {}
      ctx.platform.setScore(S.deepest, { unit: "m" });
    }
    let lastFortune = 0;
    async function submitFortune() {
      if (S.lifetime <= lastFortune) return;
      lastFortune = S.lifetime;
      try { await ctx.memory.record("fortune").submit(S.lifetime, { label: "$" + fmt(S.lifetime) }); } catch (_) {}
    }
    async function submitCoreRun(ms) {
      try { await ctx.memory.record("core_run").submit(Math.round(ms), { label: mmss(ms) }); } catch (_) {}
    }

    function rowsOf(board) {
      if (!board) return [];
      return board.entries || board.rows || board.items || board.leaderboard || [];
    }
    function entryName(e) {
      return e.displayName || e.name || e.username || (e.user && (e.user.displayName || e.user.username)) || "someone";
    }
    function entryValue(e) {
      if (e.label) return e.label;
      const v = e.value != null ? e.value : e.score;
      return v == null ? "—" : String(v);
    }

    async function openBoards() {
      showPanel("board",
        '<div style="' + SHEET + '">' + HEAD("Deepest diggers", "Everyone who has picked up a shovel") +
        '<div data-el="boards" style="' + CARD + 'font-size:13px;opacity:0.7;">Fetching…</div></div>');
      const host = panel.querySelector('[data-el="boards"]');
      const defs = [
        ["depth", "Deepest Dig"],
        ["fortune", "Lifetime Earnings"],
        ["core_run", "Time to the Core"]
      ];
      let html = "";
      for (const [ch, title] of defs) {
        let rows = [];
        try { rows = rowsOf(await ctx.memory.record(ch).leaderboard({ scope: "global", period: "all_time" })); }
        catch (_) { rows = []; }
        html += '<div style="font-size:13px;font-weight:800;opacity:0.75;margin:12px 2px 7px;">' + title + '</div>';
        if (!rows.length) {
          html += '<div style="' + CARD + 'font-size:12.5px;opacity:0.6;">No entries yet. Be the first.</div>';
        } else {
          html += '<div style="' + CARD + '">' + rows.slice(0, 10).map((e, i) =>
            '<div style="display:flex;gap:9px;padding:4px 0;font-size:13px;align-items:center;">' +
            '<span style="width:20px;opacity:0.55;font-weight:800;">' + (i + 1) + '</span>' +
            '<span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' +
              esc(entryName(e)) + '</span>' +
            '<span style="font-weight:700;">' + esc(entryValue(e)) + '</span></div>').join("") + '</div>';
        }
      }
      if (!panel.querySelector('[data-el="boards"]')) return;   // closed while loading
      host.outerHTML = html +
        '<div style="text-align:center;opacity:0.45;font-size:11.5px;margin-top:12px;">' +
        'Your best: ' + S.deepest + ' m · $' + fmt(S.lifetime) + ' earned' +
        (S.firstCoreMs ? ' · core in ' + mmss(S.firstCoreMs) : "") + '</div>';
    }

    // ====================================================================
    // 26. THE CORE
    // ====================================================================
    let coreShown = false;
    function reachCore() {
      if (coreShown) return;
      coreShown = true;
      const first = !S.finished;
      S.finished = true;
      // You stand on the lip of the chamber rather than inside the heart, so
      // credit the full thousand metres instead of the 999 you are standing at.
      S.deepest = Math.max(S.deepest, CORE_M);
      if (!S.firstCoreMs) S.firstCoreMs = S.playMs;
      SFX.core(); haptic("success"); duck(0.8, 2600); kick(TS * 0.35, 900);
      ring(P.x, P.y, TS * 12, "#ffd66b");
      ctx.platform.milestone("core_reached", { ms: Math.round(S.firstCoreMs) });
      ctx.platform.setProgress(1);
      if (first) submitCoreRun(S.firstCoreMs);
      submitDepth(); submitFortune();
      save(true);
      ctx.timeout(() => showEnding(first), 900);
    }

    const VERDICTS = [
      "Worth every blister",
      "My thumb has evolved",
      "I am going back down",
      "Gary was the real treasure"
    ];

    function showEnding(first) {
      const stats =
        '<div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:14px;">' +
        [["Depth", "1000 m"], ["Time", mmss(S.firstCoreMs || S.playMs)],
         ["Earned", "$" + fmt(S.lifetime)], ["Tiles dug", fmt(tilesDug)],
         ["Fossils", Object.keys(S.bones).length + "/8"], ["Blackouts", String(deaths)]]
          .map(([k, v]) => '<div style="flex:1 1 30%;background:rgba(255,255,255,0.06);border-radius:11px;padding:9px 8px;text-align:center;">' +
            '<div style="font-size:15px;font-weight:800;">' + esc(v) + '</div>' +
            '<div style="font-size:10.5px;opacity:0.6;margin-top:2px;">' + k + '</div></div>').join("") +
        '</div>';

      showPanel("end",
        '<div style="' + SHEET + '">' +
        HEAD("The Core of the Earth", "Staff only. Please knock.") +
        '<div style="' + CARD + 'text-align:center;padding:18px 14px;">' +
          '<div style="font-size:52px;line-height:1;">🦎</div>' +
          '<div style="font-size:13.5px;line-height:1.7;margin-top:12px;text-align:left;">' +
          '<p style="margin:0 0 10px;">The rock gives way and the heat stops, all at once. There is a desk down here. ' +
          'There is a lamp. There is a salamander in a very small hard hat, and he is <i>delighted</i>.</p>' +
          '<p style="margin:0 0 10px;">"Oh! Oh, you actually made it." He shakes your hand with both of his. ' +
          '"I\'m Gary. I run the core. It\'s mostly a pressure job, you wouldn\'t enjoy it."</p>' +
          '<p style="margin:0 0 10px;">"Four and a half billion years," he says, "and you are the first person to knock."</p>' +
          '<p style="margin:0 0 10px;">He gives you a plaque. It says <b>EMPLOYEE OF THE AEON</b>. It is warm, ' +
          'and slightly melted at one corner.</p>' +
          '<p style="margin:0;">"On your way up," Gary says, "could you water Kevin? 🪴 He is the only plant down here ' +
          'and I think he is getting notions."</p>' +
          '</div>' +
        stats +
        '</div>' +
        (first ? '<div data-el="poll"></div>' : "") +
        '<div data-el="flags" style="' + CARD + 'font-size:12.5px;opacity:0.72;">Planting your flag at the core…</div>' +
        '<div style="text-align:center;margin-top:6px;">' + ROWBTN("KEEP DIGGING", "close3", true) + '</div>' +
        '<div style="text-align:center;opacity:0.4;font-size:11px;margin-top:12px;">' +
        'There is no down left. There is, however, a great deal of up.</div>' +
        '</div>');
      for (const b of panel.querySelectorAll('[data-buy="close3"]')) tap(b, () => { coreShown = false; closePanel(); });
      if (first) renderPoll();
      plantFlag();
    }

    function renderPoll() {
      const host = panel.querySelector('[data-el="poll"]');
      if (!host) return;
      host.innerHTML = '<div style="' + CARD + '">' +
        '<div style="font-weight:800;font-size:13.5px;margin-bottom:9px;">So. Was it worth it?</div>' +
        VERDICTS.map((v, i) =>
          '<button data-act="vote' + i + '" style="pointer-events:auto;display:block;width:100%;text-align:left;' +
          'margin-bottom:6px;border:none;border-radius:11px;padding:11px 13px;cursor:pointer;font-family:' + FONT + ';' +
          'font-size:13px;font-weight:700;background:rgba(255,255,255,0.09);color:#f2e6d2;">' + esc(v) + '</button>').join("") +
        '</div>';
      for (const b of host.querySelectorAll("[data-act]")) tap(b, () => panelAct(b.getAttribute("data-act")));
    }

    async function panelAct(key) {
      if (key && key.indexOf("vote") === 0) {
        const i = parseInt(key.slice(4), 10);
        const host = panel.querySelector('[data-el="poll"]');
        if (host) host.innerHTML = '<div style="' + CARD + 'font-size:12.5px;opacity:0.75;">Counting…</div>';
        SFX.coin();
        let results = null;
        try {
          await ctx.memory.tally("verdict").choose(VERDICTS[i]);
          results = await ctx.memory.tally("verdict").results();
        } catch (_) {}
        if (!host) return;
        const opts = (results && (results.options || results.results || results.counts)) || null;
        let body = '<div style="font-weight:800;font-size:13.5px;margin-bottom:9px;">Everyone who made it down here:</div>';
        if (Array.isArray(opts) && opts.length) {
          const total = opts.reduce((a, o) => a + (o.count || o.votes || 0), 0) || 1;
          body += opts.map((o) => {
            const label = o.value || o.option || o.label || "";
            const n = o.count || o.votes || 0;
            const pc = Math.round((n / total) * 100);
            return '<div style="margin-bottom:7px;font-size:12.5px;">' +
              '<div style="display:flex;justify-content:space-between;"><span>' + esc(label) + '</span>' +
              '<span style="opacity:0.7;">' + pc + '%</span></div>' +
              '<div style="height:6px;border-radius:3px;background:rgba(255,255,255,0.12);margin-top:3px;overflow:hidden;">' +
              '<div style="width:' + pc + '%;height:100%;background:#f0b558;"></div></div></div>';
          }).join("");
        } else {
          body += '<div style="font-size:12.5px;opacity:0.7;">Vote counted. Gary has written it down.</div>';
        }
        host.innerHTML = '<div style="' + CARD + '">' + body + '</div>';
      }
    }

    // A points world at the bottom of the map: every miner who reaches the core
    // leaves a flag, and sees everyone else's.
    let flagId = null;
    async function plantFlag() {
      const host = panel.querySelector('[data-el="flags"]');
      let snap = null;
      try {
        if (!flagId) {
          let stored = null;
          try {
            const v = ctx.storage.get("deep_pockets_flag");
            stored = v && typeof v.then === "function" ? await v : v;
          } catch (_) {}
          flagId = stored || ("f" + Math.floor(Math.random() * 1e9).toString(36));
          try { await ctx.storage.set("deep_pockets_flag", flagId); } catch (_) {}
        }
        await ctx.memory.world("flags").mutate({
          id: flagId,
          x: Math.round(clamp(P.tx, 0, COLS - 1)),
          y: Math.round(clamp(S.firstCoreMs ? (S.firstCoreMs / 60000) : 0, 0, 120)),
          depth: 1000
        });
        snap = await ctx.memory.world("flags").get();
      } catch (_) { snap = null; }
      if (!panel.querySelector('[data-el="flags"]')) return;
      const pts = (snap && (snap.points || snap.items || snap.objects)) || [];
      flags.length = 0;
      for (const p of pts.slice(0, 60)) {
        flags.push({
          x: clamp(Number(p.x) || 0, 0, COLS - 1),
          name: String((p.attribution && (p.attribution.displayName || p.attribution.username)) ||
                       p.displayName || p.name || "").slice(0, 18)
        });
      }
      if (!host) return;
      host.innerHTML = pts.length
        ? '🚩 <b>' + pts.length + '</b> ' + (pts.length === 1 ? "miner has" : "miners have") +
          ' planted a flag at the core. Yours is down there with them — go and look.'
        : '🚩 Your flag is the first one at the core. Somebody will find it.';
    }
    const flags = [];

    // Flags left at the core by everyone else who got this far.
    function drawFlags() {
      if (!flags.length || P.ty < CORE.top - 2) return;
      const gy = (CORE.y + 1 - cam.y) * TS;
      for (let i = 0; i < flags.length; i++) {
        const f = flags[i];
        const fx = ((f.x + (i % 3) * 0.24 - 0.24) + 0.5 - cam.x) * TS;
        if (fx < -TS || fx > W + TS) continue;
        const h = TS * (0.85 + (i % 4) * 0.08);
        g.strokeStyle = "rgba(240,230,210,0.75)";
        g.lineWidth = Math.max(1, TS * 0.05);
        g.beginPath(); g.moveTo(fx, gy); g.lineTo(fx, gy - h); g.stroke();
        g.fillStyle = ["#e35b4a", "#4aa3e3", "#5fd18a", "#f0b558"][i % 4];
        g.beginPath();
        g.moveTo(fx, gy - h); g.lineTo(fx + TS * 0.32, gy - h + TS * 0.13);
        g.lineTo(fx, gy - h + TS * 0.26); g.closePath(); g.fill();
      }
    }

    // ====================================================================
    // 27. PER-FRAME HAZARDS AND UPKEEP
    // ====================================================================
    let heatTick = 0, healTick = 0;
    function upkeep(dt) {
      if (invuln > 0) invuln -= dt;
      const m = playerDepth();
      const z = zoneAt(Math.max(1, m));

      // heat, where the suit is not up to it
      const over = (z.heat || 0) - heatRes();
      if (m > 0 && over > 0) {
        heatTick += dt;
        if (heatTick >= 1) {
          heatTick = 0;
          const before = invuln; invuln = 0;
          hurt(over * 8, "Heat");
          invuln = Math.max(before, 0.2);
          if (S.hp > 0) toast("🔥 " + z.name + " is cooking you. Get a better suit.");
        }
      } else heatTick = 0;

      // the grass patches you up
      if (atSurface() && S.hp < maxHp()) {
        healTick += dt;
        S.hp = Math.min(maxHp(), S.hp + dt * 26);
        if (healTick > 0.9) { healTick = 0; if (S.hp < maxHp()) pop(P.x, P.y - 0.6, "+", "#5fd18a"); }
      }

      // med kit, used automatically when you are about to be a statistic
      if (S.hp < maxHp() * 0.25 && S.kit > 0 && !atSurface()) {
        S.kit--;
        S.hp = Math.min(maxHp(), S.hp + 70);
        SFX.heal(); haptic("success");
        toast("Med kit used. " + S.kit + " left.");
      }

      if (toastT > 0) {
        toastT -= dt;
        if (toastT <= 0) toastEl.style.opacity = "0";
      }
    }

    // ====================================================================
    // 28. BOOT
    // ====================================================================
    let started = false;
    function firstGesture() {
      if (started) return;
      started = true;
      sessionStart = S.playMs;
      try { ctx.platform.start({ depth: S.deepest }); } catch (_) {}
      unlockAudio();
      startMusic(zoneAt(Math.max(1, playerDepth())).music);
    }

    function titleCard(returning) {
      showPanel("title",
        '<div style="' + SHEET + 'display:flex;flex-direction:column;justify-content:center;min-height:100%;">' +
        '<div style="text-align:center;padding:10px 0 4px;">' +
          '<div style="font-size:46px;line-height:1;">⛏</div>' +
          '<div style="font-size:31px;font-weight:900;letter-spacing:-0.5px;margin-top:8px;">Deep Pockets</div>' +
          '<div style="font-size:13.5px;opacity:0.72;margin-top:7px;line-height:1.6;padding:0 6px;">' +
          (returning
            ? 'Your hole is where you left it — ' + S.deepest + ' m down, $' + fmt(S.money) + ' in the tin.'
            : 'A small plot of land. One rusty trowel. The core of the Earth is 1000 metres straight down, ' +
              'and there is a great deal of money in the way.') +
          '</div>' +
        '</div>' +
        '<div style="' + CARD + 'margin-top:16px;font-size:13px;line-height:1.7;">' +
          '<b>Press and drag anywhere</b> to steer. Push into the dirt to dig, push into a tunnel to walk.<br>' +
          '<b>Fill your backpack</b>, climb home, sell the lot, buy a better shovel. Repeat until the rock stops winning.' +
        '</div>' +
        '<div style="text-align:center;margin-top:16px;">' +
          '<button data-buy="go" style="' + BIGBTN + 'font-size:16px;padding:14px 28px;">' +
          (returning ? "BACK TO THE HOLE" : "START DIGGING") + '</button>' +
        '</div>' +
        '<div style="text-align:center;margin-top:12px;">' +
          '<button data-buy="howto" style="pointer-events:auto;border:none;background:none;cursor:pointer;' +
          'font-family:' + FONT + ';font-size:12.5px;color:rgba(242,230,210,0.6);text-decoration:underline;">' +
          'How to play</button></div>' +
        '</div>');
      for (const b of panel.querySelectorAll('[data-buy="go"]')) tap(b, () => { closePanel(); firstGesture(); });
      for (const b of panel.querySelectorAll('[data-buy="howto"]')) tap(b, () => { firstGesture(); openHelp(); });
    }

    // ---- go ---------------------------------------------------------------
    bakeSky();
    bakeAtlas();

    let returning = false;
    try { returning = await load(); } catch (_) { returning = false; }
    if (!returning) {
      S.seed = (Math.random() * 2147483647) | 0;
      generate(S.seed);
      S.hp = maxHp();
    }
    placePlayer(
      S.deepTile && returning ? clamp(S.deepTile[0], 0, COLS - 1) : START_X,
      GROUND - 1
    );
    curZone = null;
    enterZone(zoneAt(1));
    lastDepthSubmit = S.deepest;
    lastFortune = S.lifetime;
    ctx.platform.setProgress(clamp(S.deepest / CORE_M, 0, 1));
    ctx.platform.setScore(S.deepest, { unit: "m" });

    // First frame before anything else, so the loader never hides a blank screen.
    draw(0.016);
    drawHud();
    refreshAct();
    ctx.markVisualReady("world drawn");
    ctx.platform.ready({ depth: S.deepest });
    titleCard(returning);

    let saveAcc = 0;
    ctx.onFrame((dtMs) => {
      const dt = Math.min(0.05, Math.max(0.001, dtMs / 1000));
      if (W !== ctx.width || H !== ctx.height) {
        layout(); bakeAtlas(); bakeSky();
        lightKey = ""; skyKey = "";
        bakeSky();
      }
      if (!uiBlocked) {
        S.playMs += dtMs;
        stepPlayer(dt);
        stepFalling(dt);
        stepBombs(dt);
        upkeep(dt);
        saveAcc += dt;
        if (saveAcc > 15) { saveAcc = 0; save(false); }
      } else if (toastT > 0) {
        toastT -= dt;
        if (toastT <= 0) toastEl.style.opacity = "0";
      }
      stepParticles(dt);
      draw(dt);
      drawHud();
      refreshAct();
    });

    ctx.onDestroy(() => { try { save(true); } catch (_) {} });
  }
};
