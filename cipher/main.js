/**
 * Cipher — twenty-five codewords, two teams, one phone.
 *
 * A 5x5 grid of common nouns. A hidden key assigns each word to RED, BLUE, a
 * neutral bystander, or the single assassin. Each team's spymaster sees the
 * key and says one word and one number out loud; their operatives tap the
 * words they think it points at. Own colour scores and you keep going, a
 * bystander ends the turn, the other team's colour ends the turn and helps
 * them, and the assassin ends the game on the spot.
 *
 * Four decisions drive the whole build.
 *
 * THE KEY IS THE ONLY SECRET, AND IT IS NEVER ON SCREEN UNHELD. There is no
 * screen a player can wander into that shows the key. Each turn opens with the
 * phone shuttered closed and "PASS THE PHONE TO THE RED SPYMASTER" typed
 * across it; the key appears only while a finger is held on the fingerprint
 * pad for 700ms, and it is gone in the same frame the finger lifts. The pad
 * sits at the same coordinates on the handoff screen and on the clue screen,
 * so the shutters open under a finger that is already down — one screen, one
 * gesture, and no way to leave the key sitting face-up on a table.
 *
 * THE BOARD IS ORIENTATION-NEUTRAL, THE CHROME IS NOT. Every codeword is
 * printed once on its tile at full size, with the whole grid turning to face
 * whichever team is guessing — it used to be printed twice, once upright and
 * once rotated 180 degrees,
 * exactly as the physical cards are, so both sides of the table read the grid
 * without anybody turning the phone. Only the two HUD bands rotate: each team
 * gets the band at its own edge, turned to face it, and the idle one drops
 * back to 40% so there is never a question whose move it is.
 *
 * A TOUCH IS FINAL, SO A TOUCH IS NEVER ENOUGH. Tapping a tile only ARMS it —
 * it lifts, and a dashed reticle turns around it. The contact is committed by
 * a separate CONFIRM button down in the active team's own band. The assassin
 * ends the game instantly and a fat finger must not be able to do that.
 *
 * FLATNESS IS THE AESTHETIC. This is paper: card stock, stencil ink, rubber
 * stamps and a printed sunburst. Everything is canvas 2D — gradients, paths
 * and a generated grain tile — with each of the 25 tile faces baked once into
 * an OffscreenCanvas and blitted, because printing 25 words twice over per
 * frame is 50 text layouts a frame for no reason.
 *
 * Contract notes: packaged assets are disabled, so there are no images. The
 * overlay is one markup string on ctx.createRoot() rather than
 * document.createElement, pointer maths uses offsetX/offsetY rather than
 * getBoundingClientRect, and soft glows are stacked translucent strokes rather
 * than a canvas blur filter — all three are rejected at upload and none of
 * them is documented in sdk.md.
 */
window.plethoraBit = {
  meta: {
    title: "Cipher",
    runtime: "plethora-bit@2",
    tags: ["word", "party", "local-multiplayer", "teams", "spy", "deduction", "family"],
    permissions: ["backgroundMusic", "haptics", "storage"],
  },

  async init(ctx) {

    /* Every game in this set is set in lowercase Inter. Canvas text comes from
     * a few hundred call sites, so the case change goes in at the one place
     * they all pass through rather than at each of them. Single characters are
     * left alone — card ranks and piece letters are symbols, not words, and
     * "k" on a king reads as a bug. measureText is patched to match, or
     * centred text would be measured at its uppercase width and drift off
     * its own anchor. */
    for (const Proto of [globalThis.CanvasRenderingContext2D,
                         globalThis.OffscreenCanvasRenderingContext2D]) {
      if (!Proto || Proto.prototype.__lcText) continue;
      Proto.prototype.__lcText = true;
      for (const method of ["fillText", "strokeText", "measureText"]) {
        const original = Proto.prototype[method];
        if (!original) continue;
        Proto.prototype[method] = function (text, ...rest) {
          const t = typeof text === "string" && text.length > 1 ? text.toLowerCase() : text;
          return original.call(this, t, ...rest);
        };
      }
    }
    // Inter, from the Plethora font registry, in the three weights it serves.
    // The calls are fire-and-forget with literal arguments: a font is a
    // nicety and the first frame must never wait on one, and the upload
    // validator only accepts loader arguments that are direct literals.
    try { ctx.loadFont("Inter", "inter", "1.0.0", { weight: "400" }); } catch (_) {}
    try { ctx.loadFont("Inter", "inter", "1.0.0", { weight: "600" }); } catch (_) {}
    try { ctx.loadFont("Inter", "inter", "1.0.0", { weight: "700" }); } catch (_) {}
    const TAU = Math.PI * 2;
    const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
    const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
    const easeOutBack = (t, s = 1.7) => 1 + (s + 1) * Math.pow(t - 1, 3) + s * Math.pow(t - 1, 2);

    /** Escape anything that could ever be player-authored before it meets innerHTML. */
    const esc = (s) => String(s).replace(/[&<>"']/g,
      (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

    /* ===============================================================
     * PALETTE — a 1960s intelligence dossier printed in four inks.
     *
     * The sunburst is the only place saturated colour is allowed to
     * spread; everything the players read sits on card stock or on a
     * lacquer slab, so the two team colours never have to fight a
     * background for attention.
     * ============================================================= */
    const SUN = ["#FFE24E", "#FFC21C", "#F4882A", "#D9482E", "#A62B57", "#5E1246"];
    const RED = "#CE3B31", RED_DEEP = "#8F1B10", RED_LIT = "#FF8B54";
    const BLUE = "#2A6AB4", BLUE_DEEP = "#123C6E", BLUE_LIT = "#7FB7E8";
    const TAN = "#E3D3A4";
    const NOIR = "#0B0B0D", RIM = "#B9BBA8";
    const CARD = "#F3EBD8", PLAQUE = "#FBF7EC", INK = "#2A2622";
    const LACQ = "#141210", GOLD = "#FFC21C", TAUPE = "#8C6E5E";
    const CREAM = "#F1E7D2";

    // No remote fonts: a bit may not reach a font CDN, so the display voice is
    // the most condensed face the device already has and every size is chosen
    // by measureText rather than assumed.
    const DISPLAY = "Inter,-apple-system,system-ui,'Segoe UI',Roboto,sans-serif";
    const MONO = "Inter,-apple-system,system-ui,'Segoe UI',Roboto,sans-serif";
    const BODY = "Inter,-apple-system,system-ui,'Segoe UI',Roboto,sans-serif";

    const TEAM = {
      red:  { name: "RED",  ink: RED,  deep: RED_DEEP,  lit: RED_LIT,  agents: 9 },
      blue: { name: "BLUE", ink: BLUE, deep: BLUE_DEEP, lit: BLUE_LIT, agents: 8 },
    };
    const other = (t) => (t === "red" ? "blue" : "red");

    const HOLD_MS = 700;        // how long the fingerprint pad must be held
    const FLIP_MS = 280;        // tile turn-over, half out and half back
    const GUT = 4;              // grid gutter

    /* ===============================================================
     * THE DECK
     *
     * ~330 common, concrete, deliberately ambiguous nouns — the kind
     * that carry two or three unrelated senses, which is the whole
     * game. No proper nouns (a clue may legally be a proper name, so
     * putting one on the board just creates arguments), nothing longer
     * than nine characters so it survives a 70px tile, and nothing
     * anybody has to apologise for saying out loud at a table.
     * ============================================================= */
    const WORDS = (
      "BACK,BALL,BAND,BANK,BAR,BARK,BASE,BAT,BATTERY,BEACH,BEAM,BEAR,BED,BEE,BELL,BELT,BENCH," +
      "BERRY,BILL,BIRD,BLADE,BLOCK,BOARD,BOAT,BOLT,BOMB,BOND,BONE,BOOK,BOOM,BOOT,BOTTLE,BOW," +
      "BOWL,BOX,BRAKE,BRANCH,BREAD,BRICK,BRIDGE,BRUSH,BUBBLE,BUCKET,BUG,BULB,BUTTON,CABLE,CAKE," +
      "CAMP,CANDLE,CANE,CANNON,CAP,CAPE,CAR,CARD,CARROT,CART,CASE,CASTLE,CAT,CELL,CHAIN,CHAIR," +
      "CHALK,CHARGE,CHECK,CHEST,CHIP,CHURCH,CIRCLE,CLIFF,CLOAK,CLOCK,CLOUD,CLUB,COACH,COAL,COAT," +
      "COFFEE,COIN,COLLAR,COMB,COMET,COMPASS,CONE,COOK,COPPER,CORD,CORK,CORN,COTTON,COURT,COVER," +
      "CRANE,CRASH,CREAM,CROSS,CROWN,CRYSTAL,CUP,CURRENT,CURTAIN,DAM,DART,DECK,DESERT,DESK," +
      "DIAMOND,DICE,DIESEL,DISH,DOCK,DOCTOR,DOG,DOLL,DOOR,DRAGON,DRESS,DRILL,DRIVE,DROP,DRUM," +
      "DUCK,DUST,EAGLE,EAR,EARTH,EGG,ENGINE,EYE,FACE,FAIR,FALL,FAN,FANG,FARM,FEATHER,FENCE," +
      "FIELD,FIGURE,FILE,FILM,FIRE,FISH,FLAG,FLAME,FLASH,FLOOR,FLUTE,FOOT,FORCE,FOREST,FORK," +
      "FORT,FOSSIL,FOUNTAIN,FOX,FRAME,FROG,FRONT,FROST,FRUIT,GARDEN,GAS,GATE,GEAR,GHOST,GIANT," +
      "GLASS,GLOVE,GLUE,GOAT,GOLD,GRAIN,GRAPE,GRASS,GRAVE,GRILL,GUARD,GULF,HAMMER,HAND,HAT," +
      "HAWK,HEAD,HEART,HELMET,HIVE,HOLE,HONEY,HOOD,HOOK,HORN,HORSE,HOSE,HOTEL,ICE,INK,IRON," +
      "IVORY,JACK,JAM,JAR,JET,JEWEL,JOINT,KEY,KING,KITE,KNIFE,KNIGHT,KNOT,LACE,LADDER,LAKE," +
      "LAMP,LANE,LANTERN,LASER,LAVA,LAWN,LEAD,LEAF,LEDGE,LEMON,LENS,LETTER,LIGHT,LIMB,LINE," +
      "LINK,LION,LIP,LOCK,LOG,LOOP,LORD,MACHINE,MAIL,MAP,MARBLE,MARCH,MASK,MAST,MATCH,MEDAL," +
      "METAL,METER,MILL,MINE,MINT,MIRROR,MISSILE,MIST,MODEL,MOLE,MONKEY,MOON,MOTH,MOTOR,MOUNT," +
      "MOUSE,MOUTH,MUG,MUSCLE,NAIL,NEEDLE,NERVE,NEST,NET,NIGHT,NOTE,NURSE,NUT,OAK,OCEAN,OIL," +
      "OLIVE,ONION,ORANGE,ORBIT,ORGAN,OTTER,OVEN,OWL,PAD,PAGE,PAINT,PALM,PAN,PANEL,PAPER,PARK," +
      "PART,PASS,PATCH,PATH,PAW,PEACH,PEARL,PEDAL,PEN,PENGUIN,PEPPER,PIANO,PICK,PIE,PIER,PIG," +
      "PILL,PILOT,PIN,PINE,PIPE,PIRATE,PISTOL,PIT,PITCH,PLANE,PLANT,PLATE,PLUG,POCKET,POINT," +
      "POISON,POLE,POLICE,POND,PONY,POOL,PORT,POST,POT,POUND,POWDER,PRESS,PRINT,PRISM,PUMP," +
      "PUNCH,PUPIL,PYRAMID,QUEEN,RACK,RADIO,RAFT,RAIL,RAIN,RANGE,RAT,RAY,RAZOR,RECORD,REEF," +
      "RIB,RIBBON,RICE,RING,RIVER,ROAD,ROBIN,ROBOT,ROCK,ROCKET,ROD,ROOF,ROOM,ROOT,ROPE,ROSE," +
      "ROW,RULER,RUST,SACK,SADDLE,SAFE,SAIL,SALT,SAND,SAUCE,SCALE,SCARF,SCHOOL,SCOUT,SCREEN," +
      "SCREW,SCRIPT,SEAL,SEED,SHADOW,SHAFT,SHARK,SHEEP,SHEET,SHELL,SHIELD,SHIP,SHOE,SHOP,SHOT," +
      "SHOWER,SIGN,SILK,SILVER,SINK,SKATE,SKULL,SKY,SLED,SLIDE,SMOKE,SNAIL,SNAKE,SNOW,SOAP," +
      "SOCK,SODA,SOLDIER,SOLE,SOUND,SOUP,SPACE,SPADE,SPARK,SPEAR,SPELL,SPICE,SPIDER,SPIKE," +
      "SPINE,SPIRIT,SPOON,SPOT,SPRING,SPY,SQUARE,STABLE,STAFF,STAGE,STAMP,STAND,STAR,STATION," +
      "STEAM,STEEL,STEM,STICK,STOCK,STONE,STORM,STOVE,STRAW,STREAM,STRING,SUGAR,SUIT,SUN," +
      "SWING,SWITCH,SWORD,TABLE,TAIL,TANK,TAPE,TEA,TEETH,TEMPLE,TENT,THREAD,THRONE,THUMB,TICK," +
      "TIDE,TIGER,TILE,TIMBER,TIN,TIP,TOAST,TOOTH,TORCH,TOWER,TOWN,TRACK,TRAIN,TRAP,TRAY,TREE," +
      "TRIP,TRUCK,TRUNK,TUBE,TUNNEL,TURTLE,TWIST,VALVE,VAN,VAULT,VEIN,VEST,VINE,VIOLET,VOLUME," +
      "WAGON,WALL,WALLET,WATCH,WATER,WAVE,WAX,WEB,WELL,WHALE,WHEEL,WHIP,WHISTLE,WIND,WINDOW," +
      "WING,WIRE,WOLF,WOOD,WOOL,WORM,WRENCH,YARD,ZEBRA"
    ).split(",");

    /* ===============================================================
     * SETTINGS — remembered between sessions.
     * ============================================================= */
    const saved = (function () {
      try { return ctx.storage.get("cipher") || {}; } catch (_) { return {}; }
    })();
    const settings = {
      players: clamp(saved.players || 4, 2, 8),
      redSeat: saved.redSeat === "top" ? "top" : "bottom",
      bonus: saved.bonus === undefined ? true : !!saved.bonus,   // the number+1 guess
      mute: !!saved.mute,
    };
    function saveSettings() {
      try { ctx.storage.set("cipher", settings); } catch (_) {}
    }
    /** Two or three at the table is the official co-op variant. */
    const isCoop = () => settings.players <= 3;

    /* ===============================================================
     * SOUND — a low drifting bed under a talking game, cues on the
     * moments that decide something. All wrapped: audio is a nicety and
     * must never be able to break a hand.
     * ============================================================= */
    const sound = (function () {
      let muted = settings.mute, bed = null, unlocked = false;
      const start = () => ctx.music.play({ preset: "drift", volume: 0.26, tempo: 82 });
      return {
        get muted() { return muted; },
        async unlock() {
          if (unlocked) return;
          unlocked = true;
          try { await ctx.music.unlock(); if (!muted) bed = start(); } catch (_) {}
        },
        sting(n) { if (!muted) { try { ctx.music.sting(n); } catch (_) {} } },
        duck(a, ms) { if (!muted) { try { ctx.music.duck(a, ms); } catch (_) {} } },
        heat(v) { if (!muted && bed) { try { bed.setIntensity(clamp(v, 0, 1)); } catch (_) {} } },
        haptic(k) { try { ctx.platform.haptic(k); } catch (_) {} },
        toggle() {
          muted = !muted;
          settings.mute = muted;
          saveSettings();
          try {
            if (muted) { (bed || ctx.music).stop({ fadeOutMs: 220 }); bed = null; }
            else if (unlocked) bed = start();
          } catch (_) {}
          return muted;
        },
      };
    })();

    /* ===============================================================
     * SURFACES
     *
     * Offscreen drawing surfaces are OffscreenCanvas — never
     * document.createElement("canvas"), which is rejected at upload —
     * and every bake site has a live-drawing fallback, because some
     * WebViews have no OffscreenCanvas at all and a blank tile is a
     * broken game.
     * ============================================================= */
    /* Two different numbers that must not be confused.
     *
     * `bake` caps how much resolution the offscreen card art is drawn at — a
     * memory choice, and 2x is already past what the eye resolves at this
     * size. `dpr` is the scale the runtime used to size the real canvas
     * buffer, so any transform written onto that buffer has to match it
     * exactly. Using the capped one for the transform on a 3x phone draws
     * every frame at two-thirds scale into the top-left corner and leaves
     * the rest of the screen empty. */
    const dpr = ctx.dpr || 1;
    const bake = Math.min(dpr, 2);
    const HAS_OFFSCREEN = typeof OffscreenCanvas !== "undefined";
    function surface(w, h) {
      if (!HAS_OFFSCREEN) return null;
      try {
        const s = new OffscreenCanvas(Math.max(1, Math.ceil(w * bake)), Math.max(1, Math.ceil(h * bake)));
        const g = s.getContext("2d");
        if (!g) return null;
        g.scale(bake, bake);
        return { s, g, w, h };
      } catch (_) { return null; }
    }
    const blit = (g, surf, x, y) => { if (surf) g.drawImage(surf.s, x, y, surf.w, surf.h); };

    /** One 64px noise tile, repeated, is the whole paper texture. */
    const GRAIN = (function () {
      if (!HAS_OFFSCREEN) return null;
      try {
        const s = new OffscreenCanvas(64, 64);
        const g = s.getContext("2d");
        const img = g.createImageData(64, 64);
        for (let i = 0; i < img.data.length; i += 4) {
          img.data[i] = 139; img.data[i + 1] = 122; img.data[i + 2] = 85;
          img.data[i + 3] = Math.random() * 14;
        }
        g.putImageData(img, 0, 0);
        return g.createPattern(s, "repeat");
      } catch (_) { return null; }
    })();

    /* ===============================================================
     * CANVAS PRIMITIVES
     * ============================================================= */
    function roundRect(g, x, y, w, h, r) {
      const k = Math.min(r, w / 2, h / 2);
      g.beginPath();
      g.moveTo(x + k, y);
      g.arcTo(x + w, y, x + w, y + h, k);
      g.arcTo(x + w, y + h, x, y + h, k);
      g.arcTo(x, y + h, x, y, k);
      g.arcTo(x, y, x + w, y, k);
      g.closePath();
    }
    /** Deco slab: straight 45-degree cuts at two opposite corners, no curves. */
    function chamferRect(g, x, y, w, h, c) {
      g.beginPath();
      g.moveTo(x + c, y);
      g.lineTo(x + w, y);
      g.lineTo(x + w, y + h - c);
      g.lineTo(x + w - c, y + h);
      g.lineTo(x, y + h);
      g.lineTo(x, y + c);
      g.closePath();
    }
    /**
     * A glow, built from three stacked shapes instead of a blur filter.
     * Writing ctx.filter = "blur(...)" is rejected at upload because the
     * property also takes url(#…) and reads as a remote resource.
     */
    function glowRect(g, x, y, w, h, r, colour, spread) {
      const a = [0.5, 0.25, 0.12];
      for (let i = 0; i < 3; i++) {
        const s = spread * (i + 1) / 3;
        g.globalAlpha = a[i];
        roundRect(g, x - s, y - s, w + s * 2, h + s * 2, r + s);
        g.strokeStyle = colour; g.lineWidth = 1.6; g.stroke();
      }
      g.globalAlpha = 1;
    }
    function glowArc(g, cx, cy, r, colour, spread) {
      const a = [0.5, 0.25, 0.12];
      for (let i = 0; i < 3; i++) {
        g.globalAlpha = a[i];
        g.beginPath(); g.arc(cx, cy, r + spread * (i + 1) / 3, 0, TAU);
        g.strokeStyle = colour; g.lineWidth = 1.6; g.stroke();
      }
      g.globalAlpha = 1;
    }

    /** Letter-spaced type, drawn a character at a time so it works everywhere. */
    // Set lowercase like the rest of the game. This helper draws one
    // character at a time for its own tracking, and single characters slip
    // past the case fold that every other canvas string goes through.
    function trackWidth(g, str, track) {
      str = typeof str === "string" ? str.toLowerCase() : str;
      let t = 0;
      for (let i = 0; i < str.length; i++) t += g.measureText(str[i]).width + track;
      return t - track;
    }
    // Set lowercase like the rest of the game. This helper draws one
    // character at a time for its own tracking, and single characters slip
    // past the case fold that every other canvas string goes through.
    function tracked(g, str, x, y, track, align) {
      str = typeof str === "string" ? str.toLowerCase() : str;
      const total = trackWidth(g, str, track);
      let cx = align === "center" ? x - total / 2 : align === "right" ? x - total : x;
      const prev = g.textAlign;
      g.textAlign = "left";
      for (let i = 0; i < str.length; i++) {
        g.fillText(str[i], cx, y);
        cx += g.measureText(str[i]).width + track;
      }
      g.textAlign = prev;
      return total;
    }
    /** Binary-search the largest size that still fits — the whole reason a
     *  ten-letter word survives a seventy-pixel tile. */
    function fitSize(gg, str, maxW, maxSize, family, weight) {
      let lo = 7, hi = maxSize;
      while (hi - lo > 0.4) {
        const mid = (lo + hi) / 2;
        gg.font = weight + " " + mid.toFixed(1) + "px " + family;
        if (gg.measureText(str).width <= maxW) lo = mid; else hi = mid;
      }
      return lo;
    }
    /** The same, but counting the letter-spacing, which on a headline is most
     *  of the width. Leaves the fitted font selected. */
    function fitTracked(gg, str, maxW, maxSize, family, weight, track) {
      let lo = 8, hi = maxSize;
      while (hi - lo > 0.4) {
        const mid = (lo + hi) / 2;
        gg.font = weight + " " + mid.toFixed(1) + "px " + family;
        if (trackWidth(gg, str, track) <= maxW) lo = mid; else hi = mid;
      }
      gg.font = weight + " " + lo.toFixed(1) + "px " + family;
      return lo;
    }

    /* ===============================================================
     * LAYOUT
     *
     * The grid is a square dead-centre; the two bands are whatever is
     * left over at the top and bottom, one per team. Nothing goes in the
     * side margins — at 390px wide they are ten pixels each and a button
     * column there covers the outermost column of play. The utility
     * chrome lives in a 40px spine between the grid and the near band,
     * which is the only horizontal strip that belongs to nobody.
     * ============================================================= */
    let W = 0, H = 0, SAFE_T = 0, SAFE_B = 0, L = null;
    function layout() {
      W = ctx.width; H = ctx.height;
      SAFE_T = ctx.safeArea.top || 0; SAFE_B = ctx.safeArea.bottom || 0;
      const spine = 40;
      const gw = Math.min(W - 20, (H - spine) * 0.46, 430);
      const cell = (gw - 4 * GUT) / 5;
      const bandH = (H - spine - gw) / 2;
      L = {
        spine,
        gx: (W - gw) / 2, gy: bandH, gw, cell,
        spineY: bandH + gw,
        bandH,
        // Both bands lay their content out inside the same usable height so
        // the two teams get identical controls; the deeper of the two safe
        // areas sets it, and the surplus becomes margin at the near edge.
        bandU: Math.max(110, bandH - Math.max(SAFE_T, SAFE_B)),
      };
      // The spymaster's own controls own everything below the grid, in four
      // full-width rows. The first 40px stays clear of the utility chrome
      // parked in the spine. The hold bar is the last row and keeps those
      // coordinates on the handoff screen too, so the shutters can open under
      // a finger that is already down.
      const R0 = L.spineY, R1 = H - SAFE_B, room = R1 - R0;
      const rowH = Math.min(37, room * 0.164), gap = room * 0.040;
      const top = R0 + room * 0.185;
      L.sm = {
        numLabelY: R0 + room * 0.10,
        pills: { x: 10, y: top, w: W - 20, h: rowH * 0.92 },
        chip:  { x: 12, y: top + rowH + gap, w: W - 24, h: rowH * 0.86 },
        trans: { x: 12, y: top + (rowH + gap) * 2, w: W - 24, h: rowH },
        pad:   { x: 12, y: top + (rowH + gap) * 3, w: W - 24, h: rowH },
      };
      L.tileArt = null;   // cell size changed: every baked face is stale
    }
    layout();

    const canvas = ctx.createCanvas2D({ touchAction: "none" });
    const g = canvas.getContext("2d");

    function tileRect(i) {
      const c = i % 5, r = (i / 5) | 0;
      return { x: L.gx + c * (L.cell + GUT), y: L.gy + r * (L.cell + GUT), w: L.cell, h: L.cell };
    }
    /**
     * The grid turns 180 degrees to face whoever is guessing.
     *
     * Codenames is turn-based, so only one team ever reads the board at a
     * time, and turning it for them buys the codeword the whole tile instead
     * of half of it. `boardFlip` is applied in exactly two places: around the
     * grid draw, and inverted here on every pointer.
     */
    let boardFlip = 0;
    function gridCentre() {
      return { x: L.gx + L.gw / 2, y: L.gy + L.gw / 2 };
    }
    function pushGrid(gg) {
      gg.save();
      if (boardFlip) {
        const c = gridCentre();
        gg.translate(c.x, c.y); gg.rotate(Math.PI); gg.translate(-c.x, -c.y);
      }
    }
    /** Screen point -> un-turned grid space. */
    function gridPoint(x, y) {
      if (!boardFlip) return { x, y };
      const c = gridCentre();
      return { x: 2 * c.x - x, y: 2 * c.y - y };
    }

    function tileAt(sx0, sy0) {
      const gp = gridPoint(sx0, sy0);
      const x = gp.x, y = gp.y;
      const c = Math.floor((x - L.gx) / (L.cell + GUT));
      const r = Math.floor((y - L.gy) / (L.cell + GUT));
      if (c < 0 || c > 4 || r < 0 || r > 4) return -1;
      const t = tileRect(r * 5 + c);
      if (x > t.x + t.w || y > t.y + t.h) return -1;   // in the gutter
      return r * 5 + c;
    }
    const inRect = (x, y, r) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;

    /** Which physical edge a team is sitting at. */
    const seatOf = (team) =>
      settings.redSeat === "bottom" ? (team === "red" ? "bottom" : "top")
                                    : (team === "red" ? "top" : "bottom");
    /** Screen point -> band-local point, or null if it is not in that band. */
    function toLocal(seat, x, y) {
      if (seat === "top") {
        if (y > L.bandH) return null;
        return { x: W - x, y: L.bandH - y };
      }
      if (y < H - L.bandH) return null;
      return { x, y: y - (H - L.bandH) };
    }
    function bandTransform(seat) {
      if (seat === "top") { g.translate(W, L.bandH); g.rotate(Math.PI); }
      else g.translate(0, H - L.bandH);
    }
    /**
     * The rows inside a band, in band-local coordinates.
     *
     * Both bands use one height — the deeper of the two safe areas sets it —
     * so the two teams get identical controls rather than one of them getting
     * a taller balloon because their edge has no home indicator. The surplus
     * at the shallower edge becomes margin, centred.
     */
    function bandRows(seat) {
      const s = L.bandU / 170;
      const safe = seat === "top" ? SAFE_T : SAFE_B;
      const off = Math.max(0, (L.bandH - safe - L.bandU) / 2);
      return {
        hdr:     { x: 12, y: off + 2 * s, w: W - 24, h: 24 * s },
        balloon: { x: 12, y: off + 30 * s, w: W - 24, h: 60 * s },
        pips:    { x: 12, y: off + 94 * s, w: W - 24, h: 18 * s },
        confirm: { x: 12, y: off + 118 * s, w: W - 24 - 106, h: 44 * s },
        pass:    { x: W - 12 - 100, y: off + 118 * s, w: 100, h: 44 * s },
      };
    }

    /* ===============================================================
     * GAME STATE
     * ============================================================= */
    let phase = "menu";                 // menu | handoff | clue | board | over
    let words = [], kinds = [], shown = [];
    let turn = "red", turnNo = 0;
    let clue = null;                    // {word, num, unlimited}
    const lastClue = { red: null, blue: null };   // shown, dimmed, in the idle band
    let clueNum = 2, clueDraft = "", typing = false;
    let guessesLeft = 0, guessedThisTurn = 0, totalGuesses = 0;
    let armed = -1, pressed = null;
    let anim = null;                    // tile turn-over
    let winner = null, ending = "";
    let peek = false, holdOn = false, holdT = 0, holdStart = 0, holdBounce = 0;
    let holdSeq = 0;                    // invalidates a timer from an earlier press
    let shutter = 1, shutterTo = 0;
    let sparks = [], endFx = null, oppose = null;
    let typed = 0;                      // characters of the handoff line typed
    let wedgeT = 0, reticle = 0, pulse = 0, revealAll = -1;

    function remaining(team) {
      let n = 0;
      for (let i = 0; i < 25; i++) if (kinds[i] === team && !shown[i]) n++;
      return n;
    }
    const busy = () => anim !== null || endFx !== null || oppose !== null ||
                       Math.abs(shutter - shutterTo) > 0.02;

    function newDeal() {
      const pool = WORDS.slice();
      words = [];
      for (let i = 0; i < 25; i++) words.push(pool.splice((Math.random() * pool.length) | 0, 1)[0]);
      // Red starts, so red owns nine words to blue's eight; seven bystanders
      // and exactly one assassin make up the rest of the twenty-five.
      kinds = [].concat(
        new Array(9).fill("red"), new Array(8).fill("blue"),
        new Array(7).fill("neutral"), ["assassin"]);
      for (let i = kinds.length - 1; i > 0; i--) {
        const j = (Math.random() * (i + 1)) | 0;
        const t = kinds[i]; kinds[i] = kinds[j]; kinds[j] = t;
      }
      shown = new Array(25).fill(false);
      lastClue.red = null; lastClue.blue = null;
      turn = "red"; turnNo = 0; totalGuesses = 0;
      winner = null; ending = ""; armed = -1; clue = null; clueNum = 2; clueDraft = "";
      sparks = []; endFx = null; oppose = null; revealAll = -1;
      L.tileArt = null;
      bakeTiles();
      beginTurn("red");
    }

    function beginTurn(team) {
      turn = team;
      turnNo++;
      // Turn the grid to face whichever team is about to guess. seatOf tells
      // us which physical edge they are at; the far edge needs the half turn.
      boardFlip = seatOf(team) === "top" ? Math.PI : 0;
      clue = null; clueNum = 2; clueDraft = "";
      guessedThisTurn = 0; guessesLeft = 0; armed = -1;
      typed = 0;
      phase = "handoff";
      shutterTo = 1;
      sound.heat(clamp(1 - remaining(team) / TEAM[team].agents, 0.1, 1));
      paintChrome();
    }

    /* ===============================================================
     * TILE ART
     *
     * Each of the 25 faces is baked once into its own OffscreenCanvas
     * and blitted from then on. The unrevealed face alone is a rounded
     * card, a grain fill, an inset plaque, a hairline with a rivet and
     * two chevrons, and the codeword printed twice — around fourteen
     * paths and two text layouts. Times 25, times 60 frames a second,
     * that is not a thing to do live.
     * ============================================================= */
    function paintCard(gg, word, w, h) {
      // stock
      roundRect(gg, 0.5, 0.5, w - 1, h - 2, 8);
      const grad = gg.createLinearGradient(0, 0, 0, h);
      grad.addColorStop(0, CARD); grad.addColorStop(1, "#E4D9BE");
      gg.fillStyle = grad; gg.fill();
      if (GRAIN) { gg.save(); gg.clip(); gg.globalAlpha = 0.5; gg.fillStyle = GRAIN; gg.fillRect(0, 0, w, h); gg.restore(); }
      gg.strokeStyle = "#C9BB99"; gg.lineWidth = 1; gg.stroke();

      // inset plaque
      roundRect(gg, 5.5, 5.5, w - 11, h - 13, 6);
      gg.fillStyle = PLAQUE; gg.fill();
      gg.strokeStyle = INK; gg.lineWidth = 1; gg.stroke();
      gg.strokeStyle = "rgba(255,255,255,0.9)"; gg.lineWidth = 0.6;
      roundRect(gg, 6.6, 6.6, w - 13.2, h - 15.2, 5); gg.stroke();

      // hairline rule with its rivet and two chevrons
      const my = (h - 2) / 2;
      gg.strokeStyle = "rgba(40,36,32,0.35)"; gg.lineWidth = 0.8;
      gg.beginPath(); gg.moveTo(9, my); gg.lineTo(w - 9, my); gg.stroke();
      gg.fillStyle = "rgba(40,36,32,0.22)";
      for (const s of [-1, 1]) {
        gg.beginPath();
        gg.moveTo(w / 2 + s * 15, my); gg.lineTo(w / 2 + s * 9, my - 3.4); gg.lineTo(w / 2 + s * 9, my + 3.4);
        gg.closePath(); gg.fill();
      }
      gg.beginPath(); gg.arc(w / 2, my, 3, 0, TAU);
      gg.fillStyle = "#D8CDB2"; gg.fill();
      gg.strokeStyle = "#9C8F6E"; gg.lineWidth = 0.8; gg.stroke();

      // The codeword, printed ONCE and as large as the plaque allows.
      //
      // It used to be printed twice, upright and upside down, so both sides of
      // the table could read it without turning the phone. On a 70px tile that
      // gave each copy about 28px of height for up to ten letters, and the
      // result was two rows of tiny type per tile and a grid that read as
      // noise. Codenames is turn-based — only one team is guessing at a time —
      // so the whole board turns to face them instead, and the word gets the
      // entire tile.
      //
      // The budget has to pay for the letter-spacing too: fitSize measures the
      // glyph run only, and tracked() then adds `track` between every pair.
      const track = word.length > 7 ? 0.3 : 0.7;
      const size = fitSize(gg, word, w - 16 - track * (word.length - 1),
                           Math.min(h * 0.40, 30), DISPLAY, "700");
      gg.fillStyle = INK;
      gg.textAlign = "center"; gg.textBaseline = "middle";
      gg.font = "700 " + size.toFixed(1) + "px " + DISPLAY;
      tracked(gg, word, w / 2, my + (h - 2) * 0.235, track, "center");
    }

    /** The four agent faces. Flat, high contrast, one rim light — never modelled. */
    function paintAgent(gg, word, kind, w, h) {
      gg.save();
      roundRect(gg, 0.5, 0.5, w - 1, h - 2, 8);
      gg.clip();

      if (kind === "red") {
        const rg = gg.createRadialGradient(w * 0.45, h * 0.38, 2, w * 0.45, h * 0.38, w * 0.95);
        rg.addColorStop(0, "#FF9A2E"); rg.addColorStop(0.35, "#E8511F");
        rg.addColorStop(0.75, "#B3241A"); rg.addColorStop(1, "#5E0F0F");
        gg.fillStyle = rg; gg.fillRect(0, 0, w, h);
        gg.strokeStyle = "rgba(255,200,120,0.10)"; gg.lineWidth = 1.4;
        for (let i = 0; i < 18; i++) {                       // rays behind the head
          const a = (i / 18) * TAU;
          gg.beginPath(); gg.moveTo(w * 0.5, h * 0.42);
          gg.lineTo(w * 0.5 + Math.cos(a) * w, h * 0.42 + Math.sin(a) * w); gg.stroke();
        }
        // hooded figure, with the rim light as a lit copy offset up-left and
        // then covered — stroking it would draw the interior seams too
        const hood = (p) => {
          p.beginPath();
          p.moveTo(w * 0.16, h * 0.94);
          p.bezierCurveTo(w * 0.20, h * 0.66, w * 0.32, h * 0.58, w * 0.36, h * 0.52);
          p.bezierCurveTo(w * 0.22, h * 0.40, w * 0.34, h * 0.18, w * 0.5, h * 0.18);
          p.bezierCurveTo(w * 0.66, h * 0.18, w * 0.78, h * 0.40, w * 0.64, h * 0.52);
          p.bezierCurveTo(w * 0.68, h * 0.58, w * 0.80, h * 0.66, w * 0.84, h * 0.94);
          p.closePath();
        };
        gg.save();
        gg.translate(-1.8, -1.4);
        gg.fillStyle = "#FFC98A"; hood(gg); gg.fill();
        gg.restore();
        gg.fillStyle = "#2A0709"; hood(gg); gg.fill();
        // the lit rim of the hood opening, which is what makes a dark shape
        // read as a hood rather than as a head
        gg.strokeStyle = "rgba(255,206,140,0.9)"; gg.lineWidth = Math.max(1.4, w * 0.026);
        gg.beginPath();
        gg.arc(w * 0.5, h * 0.37, w * 0.155, Math.PI * 0.86, Math.PI * 2.14);
        gg.stroke();
      } else if (kind === "blue") {
        const rg = gg.createRadialGradient(w * 0.45, h * 0.38, 2, w * 0.45, h * 0.38, w * 0.95);
        rg.addColorStop(0, "#7FB7E8"); rg.addColorStop(0.4, "#2E6BB4");
        rg.addColorStop(0.8, "#123C6E"); rg.addColorStop(1, "#0A2244");
        gg.fillStyle = rg; gg.fillRect(0, 0, w, h);
        for (let i = 0; i < 4; i++) {                        // architectural columns
          const x = w * (0.08 + i * 0.28);
          gg.fillStyle = "rgba(255,255,255,0.06)"; gg.fillRect(x, 0, w * 0.13, h);
          gg.fillStyle = "rgba(255,255,255,0.12)"; gg.fillRect(x, 0, 1, h);
        }
        gg.fillStyle = "#CBDEEA";                            // pale head and hood
        gg.beginPath();
        gg.moveTo(w * 0.18, h);
        gg.bezierCurveTo(w * 0.20, h * 0.68, w * 0.34, h * 0.60, w * 0.37, h * 0.54);
        gg.bezierCurveTo(w * 0.25, h * 0.42, w * 0.35, h * 0.18, w * 0.5, h * 0.18);
        gg.bezierCurveTo(w * 0.65, h * 0.18, w * 0.75, h * 0.42, w * 0.63, h * 0.54);
        gg.bezierCurveTo(w * 0.66, h * 0.60, w * 0.80, h * 0.68, w * 0.82, h);
        gg.closePath(); gg.fill();
        const ey = h * 0.40, er = w * 0.088;                 // the spectacles are the identity
        gg.fillStyle = BLUE_DEEP;
        gg.beginPath(); gg.arc(w * 0.41, ey, er, 0, TAU); gg.fill();
        gg.beginPath(); gg.arc(w * 0.59, ey, er, 0, TAU); gg.fill();
        gg.strokeStyle = BLUE_DEEP; gg.lineWidth = 1.2;
        gg.beginPath(); gg.moveTo(w * 0.41 + er, ey); gg.lineTo(w * 0.59 - er, ey); gg.stroke();
        gg.strokeStyle = "#87B6DC"; gg.lineWidth = 1;
        gg.beginPath(); gg.arc(w * 0.41, ey, er * 0.62, Math.PI * 0.9, Math.PI * 1.6); gg.stroke();
        gg.beginPath(); gg.arc(w * 0.59, ey, er * 0.62, Math.PI * 0.9, Math.PI * 1.6); gg.stroke();
      } else if (kind === "neutral") {
        const lg = gg.createLinearGradient(0, 0, 0, h);
        lg.addColorStop(0, "#DCD2AE"); lg.addColorStop(1, "#C6BA92");
        gg.fillStyle = lg; gg.fillRect(0, 0, w, h);
        if (GRAIN) { gg.save(); gg.globalAlpha = 0.6; gg.fillStyle = GRAIN; gg.fillRect(0, 0, w, h); gg.restore(); }
        gg.globalAlpha = 0.55; gg.fillStyle = "#9AA083";
        gg.beginPath();
        gg.moveTo(w * 0.18, h);
        gg.bezierCurveTo(w * 0.20, h * 0.70, w * 0.36, h * 0.62, w * 0.40, h * 0.56);
        gg.lineTo(w * 0.60, h * 0.56);
        gg.bezierCurveTo(w * 0.64, h * 0.62, w * 0.80, h * 0.70, w * 0.82, h);
        gg.closePath(); gg.fill();
        gg.beginPath(); gg.arc(w * 0.5, h * 0.40, w * 0.16, 0, TAU); gg.fill();
        gg.globalAlpha = 1;
        gg.strokeStyle = "#6E7358"; gg.lineWidth = 1;
        gg.beginPath(); gg.arc(w * 0.5, h * 0.40, w * 0.16, 0, TAU); gg.stroke();
      } else {                                                // assassin
        gg.fillStyle = "#0A0A0C"; gg.fillRect(0, 0, w, h);
        gg.save();                                            // a cone of light from above
        gg.beginPath();
        gg.moveTo(w * 0.34, 0); gg.lineTo(w * 0.66, 0); gg.lineTo(w * 0.94, h); gg.lineTo(w * 0.06, h);
        gg.closePath(); gg.clip();
        const cg = gg.createLinearGradient(0, 0, 0, h);
        cg.addColorStop(0, "rgba(190,196,176,0.18)"); cg.addColorStop(1, "rgba(190,196,176,0)");
        gg.fillStyle = cg; gg.fillRect(0, 0, w, h);
        gg.restore();
        const path = (gg2) => {
          gg2.beginPath();
          gg2.moveTo(w * 0.12, h);                            // coat
          gg2.bezierCurveTo(w * 0.16, h * 0.70, w * 0.30, h * 0.60, w * 0.34, h * 0.55);
          gg2.lineTo(w * 0.42, h * 0.62); gg2.lineTo(w * 0.5, h * 0.55);
          gg2.lineTo(w * 0.58, h * 0.62); gg2.lineTo(w * 0.66, h * 0.55);
          gg2.bezierCurveTo(w * 0.70, h * 0.60, w * 0.84, h * 0.70, w * 0.88, h);
          gg2.closePath();
        };
        const head = (p) => { p.beginPath(); p.ellipse(w * 0.5, h * 0.38, w * 0.13, h * 0.15, 0, 0, TAU); };
        const brim = (p) => { p.beginPath(); p.ellipse(w * 0.5, h * 0.30, w * 0.31, h * 0.05, 0, 0, TAU); };
        const crown = (p) => {
          p.beginPath();
          p.moveTo(w * 0.36, h * 0.30); p.lineTo(w * 0.40, h * 0.14);
          p.lineTo(w * 0.60, h * 0.14); p.lineTo(w * 0.64, h * 0.30);
          p.closePath();
        };
        const bits = [path, head, brim, crown];
        gg.save();                                            // cold rim, up and left
        gg.translate(-1.6, -1.2);
        gg.fillStyle = RIM;
        for (const b of bits) { b(gg); gg.fill(); }
        gg.restore();
        gg.fillStyle = "#000";
        for (const b of bits) { b(gg); gg.fill(); }
      }

      // The key's glyph-per-colour pairing repeats on the covered card, so the
      // two teams are told apart by shape as well as by hue.
      if (kind === "red" || kind === "blue") {
        const ex = w * 0.135, ey = h * 0.145, er = w * 0.062;
        gg.save();
        gg.globalAlpha = 0.9;
        if (kind === "red") {
          gg.fillStyle = "#FFD8B0";
          gg.beginPath();
          gg.moveTo(ex, ey - er); gg.quadraticCurveTo(ex + er * 0.35, ey - er * 0.35, ex + er, ey);
          gg.quadraticCurveTo(ex + er * 0.35, ey + er * 0.35, ex, ey + er);
          gg.quadraticCurveTo(ex - er * 0.35, ey + er * 0.35, ex - er, ey);
          gg.quadraticCurveTo(ex - er * 0.35, ey - er * 0.35, ex, ey - er);
          gg.fill();
        } else {
          gg.strokeStyle = "#DCEBF6"; gg.lineWidth = 2;
          gg.beginPath(); gg.arc(ex, ey, er, 0, TAU); gg.stroke();
        }
        gg.restore();
      }

      // A covered card still has to be discussable, so the word survives on a
      // stamped plate — printed both ways up, like the face it replaced.
      const plateH = Math.max(15, h * 0.26);
      const ptrack = word.length > 7 ? 0.28 : 0.5;
      const size = fitSize(gg, word, w - 14 - ptrack * (word.length - 1),
                           plateH * 0.74, DISPLAY, "700");
      // Printed once, for the same reason the face is: the board turns.
      for (const flip of [false]) {
        gg.save();
        if (flip) { gg.translate(w / 2, h / 2); gg.rotate(Math.PI); gg.translate(-w / 2, -h / 2); }
        gg.fillStyle = kind === "neutral" ? "rgba(52,48,34,0.72)" : "rgba(6,6,9,0.62)";
        gg.fillRect(0, h - plateH - 1, w, plateH);
        gg.fillStyle = kind === "assassin" ? RIM : "rgba(250,244,230,0.94)";
        gg.font = "700 " + size.toFixed(1) + "px " + DISPLAY;
        gg.textAlign = "center"; gg.textBaseline = "middle";
        tracked(gg, word, w / 2, h - plateH / 2 - 1, ptrack, "center");
        gg.restore();
      }
      gg.restore();

      roundRect(gg, 0.5, 0.5, w - 1, h - 2, 8);
      gg.strokeStyle = kind === "assassin" ? "rgba(214,52,42,0.75)" : "rgba(10,8,6,0.5)";
      gg.lineWidth = 1.4; gg.stroke();
    }

    function bakeTiles() {
      const w = L.cell, h = L.cell;
      L.tileArt = { face: [], back: [] };
      for (let i = 0; i < 25; i++) {
        const a = surface(w, h + 2);
        if (a) paintCard(a.g, words[i], w, h);
        L.tileArt.face[i] = a;
        const b = surface(w, h + 2);
        if (b) paintAgent(b.g, words[i], kinds[i], w, h);
        L.tileArt.back[i] = b;
      }
    }

    /* ===============================================================
     * BACKGROUND — the printed sunburst.
     *
     * Baked once: a radial gradient, fourteen onion rings and a corner
     * vignette. Only the thirty-six rays turn, and they turn at 0.004
     * rad/s — far too slow to notice, which is exactly the point. It
     * keeps the screen alive during the long silences of a talking game
     * without ever pulling an eye off the grid.
     * ============================================================= */
    let sunburst = null;
    function bakeSunburst() {
      const s = surface(W, H);
      if (!s) { sunburst = null; return; }
      const gg = s.g, cx = W / 2, cy = H * 0.40, R = Math.hypot(W, H) * 0.60;
      const rg = gg.createRadialGradient(cx, cy, 0, cx, cy, R);
      rg.addColorStop(0, SUN[0]); rg.addColorStop(0.10, SUN[1]); rg.addColorStop(0.28, SUN[2]);
      rg.addColorStop(0.50, SUN[3]); rg.addColorStop(0.72, SUN[4]); rg.addColorStop(1, SUN[5]);
      gg.fillStyle = rg; gg.fillRect(0, 0, W, H);
      for (let i = 1; i <= 14; i++) {
        gg.beginPath(); gg.arc(cx, cy, R * i / 14, 0, TAU);
        gg.strokeStyle = i % 2 ? "rgba(255,255,255,0.045)" : "rgba(0,0,0,0.05)";
        gg.lineWidth = R / 26; gg.stroke();
      }
      const vg = gg.createRadialGradient(cx, cy, R * 0.25, cx, cy, R * 0.95);
      vg.addColorStop(0, "rgba(20,4,26,0)"); vg.addColorStop(1, "rgba(20,4,26,0.55)");
      gg.fillStyle = vg; gg.fillRect(0, 0, W, H);
      sunburst = s;
    }
    bakeSunburst();

    function drawBackground() {
      const cx = W / 2, cy = H * 0.40, R = Math.hypot(W, H) * 0.60;
      if (sunburst) blit(g, sunburst, 0, 0);
      else {
        const rg = g.createRadialGradient(cx, cy, 0, cx, cy, R);
        rg.addColorStop(0, SUN[1]); rg.addColorStop(0.5, SUN[3]); rg.addColorStop(1, SUN[5]);
        g.fillStyle = rg; g.fillRect(0, 0, W, H);
      }
      g.save();
      g.fillStyle = "rgba(255,255,255,0.03)";
      for (let i = 0; i < 36; i += 2) {
        const a0 = wedgeT + (i / 36) * TAU, a1 = wedgeT + ((i + 1) / 36) * TAU;
        g.beginPath(); g.moveTo(cx, cy); g.arc(cx, cy, R, a0, a1); g.closePath(); g.fill();
      }
      g.restore();
    }

    /* ===============================================================
     * THE GRID
     * ============================================================= */
    function drawTile(i) {
      const t = tileRect(i);
      const revealed = shown[i] || (revealAll >= 0 && i <= revealAll);
      let sx = 1, lift = 0;
      if (anim && anim.i === i) {
        const p = anim.t / FLIP_MS;
        sx = Math.abs(1 - p * 2);                        // 1 -> 0 -> 1
        lift = Math.sin(p * Math.PI) * 3;
      }
      const isArmed = armed === i && !revealed;
      const scale = isArmed ? 1.04 : 1;

      g.save();
      g.translate(t.x + t.w / 2, t.y + t.h / 2 - lift);
      g.scale(sx * scale, scale);
      g.translate(-t.w / 2, -t.h / 2);

      // Shadow first — it shortens as the card turns, so the flip has weight.
      g.fillStyle = "rgba(52,26,10,0.30)";
      roundRect(g, 1, 3 + (isArmed ? 3 : 0), t.w - 1, t.h - 2, 8); g.fill();

      const art = L.tileArt && (revealed ? L.tileArt.back[i] : L.tileArt.face[i]);
      if (art) blit(g, art, 0, 0);
      else if (revealed) paintAgent(g, words[i], kinds[i], t.w, t.h);
      else paintCard(g, words[i], t.w, t.h);

      // A specular sweep at the midpoint of the turn sells it as card stock.
      if (anim && anim.i === i && sx < 0.25) {
        g.globalAlpha = 1 - sx * 4;
        g.fillStyle = "rgba(255,255,255,0.75)";
        roundRect(g, 0, 0, t.w, t.h - 2, 8); g.fill();
        g.globalAlpha = 1;
      }
      g.restore();

      if (isArmed) {
        const cx = t.x + t.w / 2, cy = t.y + t.h / 2;
        g.save();
        g.setLineDash([6, 10]);
        g.lineDashOffset = reticle;
        g.strokeStyle = TEAM[turn].ink; g.lineWidth = 2;
        g.beginPath(); g.arc(cx, cy, t.w * 0.46, 0, TAU); g.stroke();
        g.setLineDash([]);
        glowArc(g, cx, cy, t.w * 0.46, TEAM[turn].lit, 5);
        g.restore();
      }
    }

    /** The key overlay — only ever drawn while a finger is on the pad. */
    function drawKeyOverlay(alpha) {
      g.save();
      g.globalAlpha = alpha;
      for (let i = 0; i < 25; i++) {
        if (shown[i]) continue;
        const t = tileRect(i), k = kinds[i];
        const in6 = 6;
        roundRect(g, t.x + in6, t.y + in6, t.w - in6 * 2, t.h - in6 * 2 - 2, 5);
        g.fillStyle = k === "red" ? RED : k === "blue" ? BLUE : k === "neutral" ? TAN : "#111114";
        g.globalAlpha = alpha * 0.9; g.fill();
        g.globalAlpha = alpha;
        const cx = t.x + t.w / 2, cy = t.y + t.h / 2 - 1, r = t.w * 0.16;
        // The glyph per colour is a real colour-blind affordance: diamond for
        // red, ring for blue, nothing for a bystander, a hollow outline for
        // the assassin.
        if (k === "red") {
          g.fillStyle = RED_DEEP;
          g.beginPath();
          g.moveTo(cx, cy - r); g.quadraticCurveTo(cx + r * 0.35, cy - r * 0.35, cx + r, cy);
          g.quadraticCurveTo(cx + r * 0.35, cy + r * 0.35, cx, cy + r);
          g.quadraticCurveTo(cx - r * 0.35, cy + r * 0.35, cx - r, cy);
          g.quadraticCurveTo(cx - r * 0.35, cy - r * 0.35, cx, cy - r);
          g.fill();
        } else if (k === "blue") {
          g.fillStyle = BLUE_DEEP;
          g.beginPath(); g.arc(cx, cy, r * 0.55, 0, TAU); g.fill();
          g.strokeStyle = "#4E8CC4"; g.lineWidth = 2;
          g.beginPath(); g.arc(cx, cy, r, 0, TAU); g.stroke();
        } else if (k === "assassin") {
          g.strokeStyle = "#D6342A"; g.lineWidth = 1.4;
          roundRect(g, t.x + in6 + 3, t.y + in6 + 3, t.w - in6 * 2 - 6, t.h - in6 * 2 - 8, 4);
          g.stroke();
          g.fillStyle = "#D6342A";
          g.beginPath(); g.ellipse(cx, cy + 2, r * 1.1, r * 0.22, 0, 0, TAU); g.fill();
          g.beginPath();
          g.moveTo(cx - r * 0.55, cy + 2); g.lineTo(cx - r * 0.4, cy - r * 0.6);
          g.lineTo(cx + r * 0.4, cy - r * 0.6); g.lineTo(cx + r * 0.55, cy + 2);
          g.closePath(); g.fill();
        }

        // The codeword, reprinted on top of the swatch. Underneath it is card
        // stock that this fill covers at 90%, which left the word showing at
        // about 1.2:1 — and this is the one screen whose reader has to match
        // every word to its colour. Same fit and same two positions as the
        // baked face, so it lands exactly over the print it replaces.
        const cw = words[i];
        const tk = cw.length > 6 ? 0.35 : 0.8;
        const sz = fitSize(g, cw, t.w - 22 - tk * (cw.length - 1),
                           Math.min(t.h * 0.235, 20), DISPLAY, "700");
        g.font = "700 " + sz.toFixed(1) + "px " + DISPLAY;
        g.fillStyle = k === "neutral" ? "rgba(40,34,20,0.90)"
                    : k === "assassin" ? "rgba(255,214,206,0.92)"
                    : "rgba(255,250,240,0.96)";
        g.textAlign = "center"; g.textBaseline = "middle";
        const my = (t.h - 2) / 2, wx = t.x + t.w / 2, wy = t.y + my;
        tracked(g, cw, wx, wy + (t.h - 2) * 0.235, tk, "center");
        g.save();
        g.translate(wx, wy); g.rotate(Math.PI); g.translate(-wx, -wy);
        tracked(g, cw, wx, wy + (t.h - 2) * 0.235, tk, "center");
        g.restore();
      }
      g.restore();
    }

    function drawGridFrame() {
      g.save();
      roundRect(g, L.gx - 7, L.gy - 7, L.gw + 14, L.gw + 14, 12);
      g.fillStyle = "rgba(11,11,13,0.72)"; g.fill();
      g.strokeStyle = "rgba(140,110,94,0.55)"; g.lineWidth = 1; g.stroke();
      roundRect(g, L.gx - 3.5, L.gy - 3.5, L.gw + 7, L.gw + 7, 9);
      g.strokeStyle = "rgba(255,194,28,0.16)"; g.lineWidth = 1; g.stroke();
      g.restore();
    }

    /* ===============================================================
     * HUD BANDS
     * ============================================================= */
    function drawBalloon(gg, x, y, w, h, r) {
      roundRect(gg, x, y, w, h, r);
      gg.fill();
      gg.beginPath();                                   // the little tail
      gg.moveTo(x + 22, y + h - 1);
      gg.lineTo(x + 14, y + h + 9);
      gg.lineTo(x + 38, y + h - 1);
      gg.closePath(); gg.fill();
    }

    /** Score is two stacks of agent cards filling in — never a numeral. */
    function drawStack(gg, x, y, team, size) {
      const n = TEAM[team].agents, left = remaining(team);
      for (let i = 0; i < n; i++) {
        const cx = x + i * (size + 3.2);
        roundRect(gg, cx, y, size, size * 1.4, 2);
        if (i < n - left) {
          gg.fillStyle = TEAM[team].ink; gg.fill();
          gg.strokeStyle = TEAM[team].lit; gg.lineWidth = 0.7; gg.stroke();
        } else {
          // Empty slots carry the team's own colour at low strength, so a
          // stack of nine unfilled cards still reads as "red has nine left"
          // rather than as a row of blank boxes.
          gg.fillStyle = "rgba(255,255,255,0.04)"; gg.fill();
          gg.strokeStyle = TEAM[team].ink; gg.globalAlpha *= 0.55;
          gg.lineWidth = 1; gg.stroke(); gg.globalAlpha /= 0.55;
        }
      }
      return n * (size + 3.2);
    }

    function decoButton(gg, r, label, opts) {
      const o = opts || {};
      const fill = o.fill || null, stroke = o.stroke || CREAM;
      chamferRect(gg, r.x, r.y, r.w, r.h, 9);
      if (fill) { gg.fillStyle = fill; gg.fill(); }
      else { gg.fillStyle = "rgba(255,255,255,0.04)"; gg.fill(); }
      gg.strokeStyle = stroke; gg.lineWidth = 2; gg.stroke();
      if (o.glow) glowRect(gg, r.x, r.y, r.w, r.h, 9, o.glow, 6);
      gg.fillStyle = o.ink || CREAM;
      gg.font = "700 " + (o.size || 17) + "px " + DISPLAY;
      gg.textAlign = "center"; gg.textBaseline = "middle";
      tracked(gg, label, r.x + r.w / 2, r.y + (o.sub ? r.h * 0.665 : r.h / 2 + 1),
              o.track === undefined ? 2.2 : o.track, "center");
      if (o.sub) {
        gg.font = "700 11px " + MONO;
        gg.fillStyle = o.subInk || (fill ? "rgba(0,0,0,0.62)" : "rgba(255,255,255,0.55)");
        tracked(gg, o.sub, r.x + r.w / 2, r.y + r.h * 0.30, 1.6, "center");
      }
    }

    function drawBand(team) {
      const seat = seatOf(team), active = team === turn && phase === "board";
      const coopBot = isCoop() && team === "blue";
      const R = bandRows(seat);
      g.save();
      bandTransform(seat);

      // lacquer slab
      chamferRect(g, 0, 0, W, L.bandH, 16);
      const lg = g.createLinearGradient(0, 0, 0, L.bandH);
      lg.addColorStop(0, "rgba(28,25,21,0.95)");
      lg.addColorStop(0.55, "rgba(17,15,13,0.96)");
      lg.addColorStop(1, "rgba(9,8,7,0.98)");
      g.fillStyle = lg; g.fill();
      g.save();
      chamferRect(g, 0, 0, W, L.bandH, 16); g.clip();
      const tg = g.createLinearGradient(0, 0, 0, L.bandH * 0.7);
      tg.addColorStop(0, TEAM[team].ink); tg.addColorStop(1, "rgba(0,0,0,0)");
      g.globalAlpha = active ? 0.16 : 0.09;
      g.fillStyle = tg; g.fillRect(0, 0, W, L.bandH);
      if (GRAIN) { g.globalAlpha = 0.35; g.fillStyle = GRAIN; g.fillRect(0, 0, W, L.bandH); }
      g.restore();
      g.strokeStyle = "rgba(255,255,255,0.10)"; g.lineWidth = 1;
      g.beginPath(); g.moveTo(16, 0.5); g.lineTo(W, 0.5); g.stroke();
      g.fillStyle = TEAM[team].ink;                       // team hairline at the grid edge
      g.globalAlpha = active ? 1 : 0.45;
      g.fillRect(0, 0, W, 2.5);
      g.globalAlpha = 1;
      // a gold hairline along the near edge, so the panel has two sides
      const R2 = bandRows(seat);
      g.strokeStyle = active ? "rgba(255,194,28,0.30)" : "rgba(255,194,28,0.10)";
      g.lineWidth = 1;
      // Clamped to the seat's own safe inset: at bandH-6 the top band drew this
      // rule at y=43 on a 47px notch, i.e. underneath it.
      const nearY = Math.min(L.bandH - (seat === "top" ? SAFE_T : SAFE_B) - 4,
                             R2.confirm.y + R2.confirm.h + 12);
      g.beginPath(); g.moveTo(12, nearY); g.lineTo(W - 12, nearY); g.stroke();

      g.globalAlpha = active ? 1 : 0.58;

      // header: team, agents left, the stack of agent cards
      g.fillStyle = TEAM[team].ink;
      g.font = "700 20px " + DISPLAY; g.textAlign = "left"; g.textBaseline = "middle";
      const nm = coopBot ? "OPPOSITION" : TEAM[team].name;
      const nw = tracked(g, nm, R.hdr.x, R.hdr.y + R.hdr.h / 2, 3, "left");
      g.font = "400 9px " + MONO; g.fillStyle = "rgba(241,231,210,0.55)";
      tracked(g, remaining(team) + " LEFT", R.hdr.x + nw + 10, R.hdr.y + R.hdr.h / 2 + 1, 1, "left");
      drawStack(g, W - 12 - (TEAM[team].agents * 10.2), R.hdr.y + 2, team, 7);

      // clue balloon — the idle team keeps its own last clue on the table,
      // dimmed, the way the spoken one hangs around in the room
      const b = R.balloon;
      const show = active ? clue : lastClue[team];
      if (show) {
        g.fillStyle = active ? PLAQUE : "rgba(241,231,210,0.13)";
        drawBalloon(g, b.x, b.y, b.w, b.h, 12);
        if (!active) {
          g.strokeStyle = "rgba(241,231,210,0.28)"; g.lineWidth = 1;
          roundRect(g, b.x, b.y, b.w, b.h, 12); g.stroke();
        }
        const cw = show.word ? show.word : "SPOKEN ALOUD";
        fitTracked(g, cw, b.w - 92, 32, DISPLAY, "700", 2);
        g.fillStyle = show.word ? (active ? TEAM[team].ink : TEAM[team].lit)
                                : (active ? "rgba(42,38,34,0.62)" : "rgba(241,231,210,0.5)");
        g.textAlign = "left"; g.textBaseline = "middle";
        tracked(g, cw, b.x + 16, b.y + b.h / 2, 2, "left");
        const cx = b.x + b.w - 28, cy = b.y + b.h / 2;
        g.beginPath(); g.arc(cx, cy, 18, 0, TAU);
        g.fillStyle = TEAM[team].ink; g.fill();
        g.fillStyle = "#fff"; g.font = "700 22px " + DISPLAY;
        g.textAlign = "center";
        g.fillText(show.display, cx, cy + 1);
        if (!active) {                                    // tagged as history
          g.fillStyle = "rgba(241,231,210,0.45)"; g.font = "400 7.5px " + MONO;
          g.textAlign = "left"; g.textBaseline = "middle";
          tracked(g, "LAST CLUE", b.x + 16, b.y + b.h - 12, 1.4, "left");
        }
      } else {
        chamferRect(g, b.x, b.y, b.w, b.h, 10);
        g.fillStyle = "rgba(255,255,255,0.03)"; g.fill();
        g.strokeStyle = "rgba(255,255,255,0.10)"; g.lineWidth = 1; g.stroke();
        g.fillStyle = "rgba(241,231,210,0.45)";
        g.font = "400 10px " + MONO; g.textAlign = "center"; g.textBaseline = "middle";
        tracked(g, active ? "AWAITING TRANSMISSION" : (coopBot ? "AUTOMATED" : "STANDING BY"),
                b.x + b.w / 2, b.y + b.h / 2, 2, "center");
      }

      // guess allowance, one lozenge per guess, the bonus one hollow
      if (active && clue) {
        const total = clue.unlimited ? 0 : clue.num + (settings.bonus ? 1 : 0);
        const used = guessedThisTurn;
        if (clue.unlimited) {
          g.fillStyle = "rgba(241,231,210,0.7)"; g.font = "400 10px " + MONO;
          g.textAlign = "left"; g.textBaseline = "middle";
          tracked(g, "UNLIMITED GUESSES", R.pips.x, R.pips.y + R.pips.h / 2, 1.6, "left");
        } else {
          for (let i = 0; i < total; i++) {
            const x = R.pips.x + i * 22, bonus = settings.bonus && i === total - 1;
            roundRect(g, x, R.pips.y + 3, 17, 9, 4.5);
            if (i < used) { g.fillStyle = "rgba(255,255,255,0.10)"; g.fill(); }
            else if (bonus) { g.strokeStyle = GOLD; g.lineWidth = 1.4; g.stroke(); }
            else { g.fillStyle = GOLD; g.fill(); }
          }
        }
      }

      // buttons — only the team whose turn it is gets any
      if (active) {
        const canConfirm = armed >= 0 && !busy();
        decoButton(g, R.confirm, canConfirm ? "CONFIRM CONTACT" : "TAP A CODEWORD", {
          fill: canConfirm ? GOLD : "rgba(255,255,255,0.03)",
          stroke: canConfirm ? GOLD : "rgba(255,255,255,0.18)",
          ink: canConfirm ? NOIR : "rgba(241,231,210,0.45)",
          glow: canConfirm ? GOLD : null,
          sub: canConfirm ? words[armed] : "",
          size: 16,
        });
        const canPass = guessedThisTurn > 0;
        decoButton(g, R.pass, "END TURN", {
          stroke: canPass ? TEAM[team].ink : "rgba(255,255,255,0.14)",
          ink: canPass ? CREAM : "rgba(241,231,210,0.35)",
          size: 15, track: 1.2,
        });
      } else if (phase === "board") {
        // The idle team's controls are absent, not greyed — so the space says
        // what is happening instead of holding four dead buttons.
        const r = R.confirm, y = r.y + r.h / 2;
        g.save();
        g.setLineDash([5, 7]);
        g.strokeStyle = "rgba(241,231,210,0.22)"; g.lineWidth = 1;
        g.beginPath(); g.moveTo(r.x, y); g.lineTo(W - 12, y); g.stroke();
        g.restore();
        const line = coopBot ? "OPPOSITION MOVES AFTER EACH TURN" : TEAM[turn].name + " IS GUESSING";
        g.font = "400 9px " + MONO;
        const lw = trackWidth(g, line, 2) + 20;
        g.fillStyle = "rgba(20,18,16,0.98)";
        g.fillRect(W / 2 - lw / 2, y - 7, lw, 14);
        g.fillStyle = "rgba(241,231,210,0.5)";
        g.textAlign = "center"; g.textBaseline = "middle";
        tracked(g, line, W / 2, y, 2, "center");
      }
      g.globalAlpha = 1;
      g.restore();
    }

    /* ===============================================================
     * THE SPINE — the one horizontal strip that belongs to nobody, so
     * the utility chrome can live there without covering either team's
     * controls or the outermost column of play.
     * ============================================================= */
    function drawSpine() {
      const y = L.spineY;
      g.save();
      g.fillStyle = "rgba(11,10,9,0.55)";
      g.fillRect(0, y, W, L.spine);
      g.strokeStyle = "rgba(255,194,28,0.18)"; g.lineWidth = 1;
      g.beginPath(); g.moveTo(0, y + 0.5); g.lineTo(W, y + 0.5); g.stroke();
      g.beginPath(); g.moveTo(0, y + L.spine - 0.5); g.lineTo(W, y + L.spine - 0.5); g.stroke();
      g.fillStyle = "rgba(241,231,210,0.62)";
      g.font = "400 9px " + MONO; g.textAlign = "left"; g.textBaseline = "middle";
      const line = phase === "board"
        ? "TRANSMISSION " + turnNo + "  •  " + TEAM[turn].name + " OPERATIVES"
        : "DOSSIER 25  •  CLASSIFIED";
      tracked(g, line, 12, y + L.spine / 2, 1.3, "left");
      g.restore();
    }

    /* ===============================================================
     * THE HANDOFF
     *
     * Two lacquer shutters slide in from the edges and meet at the
     * centre. The instruction is set the right way up for whoever is
     * being handed the phone, and the only control on the screen is the
     * fingerprint pad — which sits at exactly the same coordinates on
     * the clue screen, so the shutters can open under a finger that is
     * already down.
     * ============================================================= */
    function drawShutters() {
      if (shutter <= 0.002) return;
      const e = easeOutCubic(shutter);
      const half = H / 2 + 2;
      g.save();
      for (const top of [true, false]) {
        const y = top ? -half + half * e : H - half * e;
        g.fillStyle = "#17140F";
        g.fillRect(0, y, W, half);
        const lg = g.createLinearGradient(0, y, 0, y + half);
        lg.addColorStop(0, "rgba(255,255,255,0.05)"); lg.addColorStop(1, "rgba(0,0,0,0.35)");
        g.fillStyle = lg; g.fillRect(0, y, W, half);
        if (GRAIN) { g.save(); g.globalAlpha = 0.55; g.fillStyle = GRAIN; g.fillRect(0, y, W, half); g.restore(); }
        g.fillStyle = TEAM[turn].ink;
        g.fillRect(0, top ? y + half - 3 : y, W, 3);
        g.strokeStyle = "rgba(255,194,28,0.25)"; g.lineWidth = 1;
        const ey = top ? y + half - 8.5 : y + 8.5;
        g.beginPath(); g.moveTo(0, ey); g.lineTo(W, ey); g.stroke();
      }
      g.restore();
    }

    /** The two lines are decided before a character is typed, so the
     *  instruction never reflows under the reader as it comes in. */
    function handoffLines() {
      if (isCoop()) return ["PASS THE PHONE", "TO THE SPYMASTER"];
      return ["PASS THE PHONE TO THE", TEAM[turn].name + " SPYMASTER"];
    }

    function drawHandoff() {
      const seat = seatOf(turn), lines = handoffLines();
      const n = Math.floor(typed);
      const s1 = lines[0].slice(0, n);
      const s2 = n > lines[0].length ? lines[1].slice(0, n - lines[0].length) : "";
      const done = n >= lines[0].length + lines[1].length;

      g.save();
      // Rotated to the seat of whoever is being handed the phone: they read it
      // while the phone is still flat on the table.
      g.translate(W / 2, H * 0.30);
      if (seat === "top") g.rotate(Math.PI);
      g.textAlign = "center"; g.textBaseline = "middle";

      // rings in the receiving team's colour, well under the type
      g.strokeStyle = TEAM[turn].ink;
      for (let i = 0; i < 3; i++) {
        g.globalAlpha = 0.14 - i * 0.035;
        g.lineWidth = 1.5;
        g.beginPath(); g.arc(0, 0, 96 + i * 34, 0, TAU); g.stroke();
      }
      g.globalAlpha = 1;

      g.fillStyle = TEAM[turn].ink;
      g.font = "700 10px " + MONO;
      tracked(g, (isCoop() ? "OPERATION" : TEAM[turn].name + " TURN") + "  ·  TRANSMISSION " + turnNo,
              0, -62, 3, "center");

      g.fillStyle = CREAM;
      // Fit on the finished lines, not the typed prefix, so the type does not
      // shrink under the reader as more of it arrives.
      const size = Math.min(fitTracked(g, lines[0], W - 48, 30, DISPLAY, "700", 2.4),
                            fitTracked(g, lines[1], W - 48, 30, DISPLAY, "700", 2.4));
      g.font = "700 " + size.toFixed(1) + "px " + DISPLAY;
      tracked(g, s1, 0, -18, 2.4, "center");
      g.fillStyle = n > lines[0].length ? TEAM[turn].ink : CREAM;
      tracked(g, s2, 0, 16, 2.4, "center");

      g.strokeStyle = "rgba(255,194,28,0.35)"; g.lineWidth = 1;
      g.beginPath(); g.moveTo(-58, 42); g.lineTo(58, 42); g.stroke();
      g.fillStyle = "rgba(241,231,210,0.55)"; g.font = "400 9.5px " + MONO;
      tracked(g, done ? "EVERYONE ELSE: EYES UP" : "", 0, 60, 1.6, "center");
      g.restore();

      // The key card, face down: the holder, the bezel and twenty-five blank
      // chips, with the edge lights lit in the team the phone is going to. It
      // says what is behind the shutter without showing a single colour.
      // Centred in the lower shutter, between the seam where the two shutters
      // meet and the hold bar. It used to be pinned to H*0.625, which put its
      // top bezel exactly on the seam — the shutter's team-coloured edge then
      // ran straight through the card and out to both screen edges.
      const seam = H / 2 + 14;
      const foot = L.sm.pad.y - 20;
      const side = Math.min(W * 0.50, (foot - seam) * 0.80, H * 0.23);
      const cy = (seam + foot) / 2, x0 = W / 2 - side / 2, y0 = cy - side / 2;
      g.save();
      g.globalAlpha = 0.85;
      chamferRect(g, x0 - 13, y0 - 13, side + 26, side + 26, 12);
      g.fillStyle = "rgba(140,110,94,0.30)"; g.fill();
      g.strokeStyle = "rgba(190,155,128,0.65)"; g.lineWidth = 1.4; g.stroke();
      roundRect(g, x0 - 5, y0 - 5, side + 10, side + 10, 5);
      g.fillStyle = "rgba(8,8,10,0.85)"; g.fill();
      const c = side / 5;
      g.fillStyle = "rgba(241,231,210,0.10)";
      for (let i = 0; i < 25; i++) {
        roundRect(g, x0 + (i % 5) * c + 2.5, y0 + ((i / 5) | 0) * c + 2.5, c - 5, c - 5, 3);
        g.fill();
      }
      for (const [ex, ey, hw, hh] of [                      // four edge lights
        [W / 2, y0 - 9, 11, 2.4], [W / 2, y0 + side + 9, 11, 2.4],
        [x0 - 9, cy, 2.4, 11], [x0 + side + 9, cy, 2.4, 11],
      ]) {
        roundRect(g, ex - hw, ey - hh, hw * 2, hh * 2, 2);
        g.fillStyle = TEAM[turn].ink; g.fill();
        glowRect(g, ex - hw, ey - hh, hw * 2, hh * 2, 2, TEAM[turn].lit, 4);
      }
      g.restore();

      // deco corner brackets, clear of the hold bar at the foot
      g.strokeStyle = "rgba(255,194,28,0.45)"; g.lineWidth = 2;
      const m = 14, len = 26;
      for (const [bx, by, sx, sy] of [
        [m, SAFE_T + 10, 1, 1], [W - m, SAFE_T + 10, -1, 1],
        [m, L.sm.pad.y - 16, 1, -1], [W - m, L.sm.pad.y - 16, -1, -1],
      ]) {
        g.beginPath();
        g.moveTo(bx + sx * len, by); g.lineTo(bx, by); g.lineTo(bx, by + sy * len);
        g.stroke();
      }
    }

    /**
     * The hold bar: a procedural fingerprint at one end, and the 700ms hold
     * drawn as gold sweeping across the bar rather than as a ring, because a
     * bar this wide is a far easier target for a thumb than a small disc — and
     * it is the only control on the handoff screen.
     */
    function drawPad() {
      const p = L.sm.pad;
      const prog = clamp(holdT / HOLD_MS, 0, 1);
      const b = holdBounce * 0.3;
      const x = p.x - b, y = p.y - b, w = p.w + b * 2, h = p.h + b * 2;

      g.save();
      chamferRect(g, x, y, w, h, 10);
      g.fillStyle = "rgba(11,10,9,0.72)"; g.fill();
      g.save();
      chamferRect(g, x, y, w, h, 10); g.clip();
      if (prog > 0) {                                    // the hold, sweeping across
        g.fillStyle = peek ? "rgba(255,194,28,0.30)" : "rgba(255,194,28,0.18)";
        g.fillRect(x, y, w * prog, h);
        g.fillStyle = GOLD;
        g.fillRect(x + w * prog - 2, y, 2, h);
      }
      g.restore();
      g.strokeStyle = peek ? GOLD : "rgba(241,231,210,0.42)"; g.lineWidth = 1.6;
      chamferRect(g, x, y, w, h, 10); g.stroke();
      if (peek) glowRect(g, x, y, w, h, 10, GOLD, 7);

      // fingerprint: nine nested arcs with a little random phase, no asset
      const fx = x + h * 0.62, fy = y + h / 2, fr = h * 0.34;
      g.save();
      g.beginPath(); g.arc(fx, fy, fr + 2, 0, TAU); g.clip();
      g.strokeStyle = peek ? "rgba(255,194,28,0.95)" : "rgba(241,231,210,0.62)";
      g.lineWidth = 1.3;
      for (let i = 0; i < 9; i++) {
        const rr = fr * (0.16 + i * 0.105), ph = (i * 1.7) % TAU;
        g.beginPath();
        g.arc(fx, fy + i * 0.5, rr, ph, ph + 2.2 + (i % 3) * 0.4);
        g.stroke();
      }
      g.restore();
      g.restore();

      g.textAlign = "left"; g.textBaseline = "middle";
      g.fillStyle = peek ? GOLD : "rgba(241,231,210,0.8)";
      g.font = "700 15px " + DISPLAY;
      tracked(g, peek ? "KEY EXPOSED" : "HOLD TO READ THE KEY", x + h * 1.25, y + h * 0.40, 2.2, "left");
      g.fillStyle = "rgba(241,231,210,0.45)"; g.font = "400 8px " + MONO;
      tracked(g, peek ? "LET GO AND IT HIDES" : "AND KEEP HOLDING", x + h * 1.25, y + h * 0.70, 1, "left");
    }

    /** A rubber stamp: boxed, letter-spaced mono, knocked slightly off square. */
    function drawStamp(text, colour, y, size) {
      g.save();
      g.translate(W / 2, y);
      g.rotate(-0.055);
      g.font = "700 " + size + "px " + MONO;
      const w = trackWidth(g, text, 4) + 26, h = size * 2.1;
      g.strokeStyle = colour; g.lineWidth = 2;
      g.strokeRect(-w / 2, -h / 2, w, h);
      g.strokeRect(-w / 2 + 3, -h / 2 + 3, w - 6, h - 6);
      g.fillStyle = colour;
      g.textAlign = "center"; g.textBaseline = "middle";
      tracked(g, text, 0, 1, 4, "center");
      g.restore();
    }

    /** A hard pulsing frame, for as long as the key is up. */
    function drawExposed() {
      const a = 0.55 + Math.sin(pulse * 3.4) * 0.35;
      g.save();
      g.strokeStyle = "rgba(214,52,42," + a.toFixed(3) + ")";
      g.lineWidth = 3;
      g.strokeRect(1.5, 1.5, W - 3, H - 3);
      g.restore();
    }

    /* ===============================================================
     * THE CLUE PANEL — number first, because the number is the part the
     * table has to see; the word itself is usually just said out loud.
     * ============================================================= */
    function pillRect(i) {
      const p = L.sm.pills, n = 11, gap = 3;
      const w = (p.w - gap * (n - 1)) / n;
      return { x: p.x + i * (w + gap), y: p.y, w, h: p.h };
    }
    function drawCluePanel() {
      const R0 = L.spineY;
      g.save();
      g.fillStyle = "rgba(20,18,16,0.94)";
      chamferRect(g, 0, R0, W, H - R0, 16); g.fill();
      g.strokeStyle = "rgba(255,194,28,0.22)"; g.lineWidth = 1;
      g.beginPath(); g.moveTo(16, R0 + 0.5); g.lineTo(W, R0 + 0.5); g.stroke();
      g.restore();

      for (let i = 0; i < 11; i++) {
        const r = pillRect(i), on = clueNum === i;
        roundRect(g, r.x, r.y, r.w, r.h, 5);
        g.fillStyle = on ? TEAM[turn].ink : "rgba(255,255,255,0.05)"; g.fill();
        if (!on) { g.strokeStyle = "rgba(255,255,255,0.12)"; g.lineWidth = 1; g.stroke(); }
        g.fillStyle = on ? "#fff" : "rgba(241,231,210,0.62)";
        g.font = "700 17px " + DISPLAY; g.textAlign = "center"; g.textBaseline = "middle";
        g.fillText(i === 10 ? "∞" : String(i), r.x + r.w / 2, r.y + r.h / 2 + 1);
      }
      g.fillStyle = "rgba(241,231,210,0.45)";
      g.font = "400 8px " + MONO; g.textAlign = "left"; g.textBaseline = "middle";
      tracked(g, "HOW MANY WORDS DOES IT POINT AT?", 12, L.sm.numLabelY, 1.2, "left");

      const c = L.sm.chip;
      roundRect(g, c.x, c.y, c.w, c.h, 7);
      g.fillStyle = "rgba(255,255,255,0.05)"; g.fill();
      g.strokeStyle = "rgba(255,255,255,0.16)"; g.lineWidth = 1; g.stroke();
      g.textBaseline = "middle";
      if (clueDraft) {
        g.fillStyle = CREAM; g.font = "700 18px " + DISPLAY; g.textAlign = "left";
        tracked(g, clueDraft, c.x + 12, c.y + c.h / 2, 2, "left");
      } else {
        g.fillStyle = "rgba(241,231,210,0.42)"; g.font = "400 10px " + MONO; g.textAlign = "left";
        tracked(g, "TYPE THE CLUE, OR JUST SAY IT ALOUD", c.x + 12, c.y + c.h / 2, 1.2, "left");
      }
      g.fillStyle = GOLD; g.font = "700 11px " + DISPLAY; g.textAlign = "right";
      tracked(g, clueDraft ? "EDIT" : "TYPE", c.x + c.w - 12, c.y + c.h / 2, 1.6, "right");

      drawPad();
      decoButton(g, L.sm.trans, "TRANSMIT", {
        fill: GOLD, stroke: GOLD, ink: NOIR, glow: GOLD, size: 20, track: 3,
        sub: clueNum === 10 ? "UNLIMITED" : clueNum === 0 ? "ZERO — A WARNING" : "",
      });
    }

    function drawSpymasterHeader() {
      const h = L.gy, top = SAFE_T, room = h - top;
      g.save();
      chamferRect(g, 0, 0, W, h, 16);
      const lg = g.createLinearGradient(0, 0, 0, h);
      lg.addColorStop(0, "rgba(9,8,7,0.98)");
      lg.addColorStop(1, "rgba(26,23,20,0.96)");
      g.fillStyle = lg; g.fill();
      if (GRAIN) { g.save(); chamferRect(g, 0, 0, W, h, 16); g.clip();
        g.globalAlpha = 0.35; g.fillStyle = GRAIN; g.fillRect(0, 0, W, h); g.restore(); }
      g.restore();

      // The stamp holds the same spot whether or not the key is up, so nothing
      // jumps when it comes on — and it is impossible to have the key on
      // screen without a stamp saying so.
      drawStamp(peek ? "KEY EXPOSED" : "SPYMASTER ONLY",
                peek ? "rgba(214,52,42,0.95)" : "rgba(255,194,28,0.75)",
                top + room * 0.14, 12);

      g.textAlign = "center"; g.textBaseline = "middle";
      g.fillStyle = TEAM[turn].ink; g.font = "700 32px " + DISPLAY;
      tracked(g, (isCoop() ? "" : TEAM[turn].name + " ") + "SPYMASTER",
              W / 2, top + room * 0.40, 4, "center");
      g.fillStyle = "rgba(241,231,210,0.5)"; g.font = "400 9px " + MONO;
      tracked(g, "ANGLE THE SCREEN AWAY FROM THE TABLE", W / 2, top + room * 0.55, 1.4, "center");

      // Both agent stacks, so the spymaster can read the state of the board
      // without leaving this screen.
      const sw = 7, wR = TEAM.red.agents * (sw + 3.2), wB = TEAM.blue.agents * (sw + 3.2);
      const lw = 26;                                    // room for the count
      const x0 = (W - (wR + wB + lw * 2 + 26)) / 2;
      g.save();
      g.translate(x0, top + room * 0.70);
      drawStack(g, lw, 0, "red", sw);
      drawStack(g, lw * 2 + wR + 26, 0, "blue", sw);
      // Two anonymous rows of lozenges do not say which team, or how many:
      // the number is what the spymaster is actually reading off them.
      g.font = "700 12px " + DISPLAY; g.textBaseline = "middle";
      for (const [team, tx] of [["red", lw - 5], ["blue", lw * 2 + wR + 26 - 5]]) {
        g.fillStyle = TEAM[team].ink; g.textAlign = "right";
        g.fillText(String(remaining(team)), tx, sw * 0.7);
      }
      g.restore();

      g.fillStyle = "rgba(255,194,28,0.55)"; g.font = "400 8px " + MONO;
      g.textAlign = "center";
      tracked(g, "ONE WORD · ONE NUMBER · NOTHING ABOUT SPELLING OR POSITION",
              W / 2, h - 14, 0.7, "center");
    }

    /* ===============================================================
     * THE ON-CANVAS KEYBOARD
     *
     * No DOM inputs: a text field would summon the system keyboard over
     * a phone that is deliberately being shielded. There is no space
     * key, because a clue is exactly one word.
     * ============================================================= */
    const KB_ROWS = ["QWERTYUIOP", "ASDFGHJKL", "ZXCVBNM"];
    function keyRects() {
      const out = [];
      const kw = Math.min(34, (W - 16) / 10), kh = 44, gap = (W - 16 - kw * 10) / 9;
      const y0 = H - SAFE_B - kh * 3 - 30;
      for (let r = 0; r < 3; r++) {
        const row = KB_ROWS[r];
        const rowW = row.length * kw + (row.length - 1) * gap;
        const x0 = (W - rowW) / 2;
        for (let i = 0; i < row.length; i++) {
          out.push({ id: "k:" + row[i], ch: row[i], x: x0 + i * (kw + gap), y: y0 + r * (kh + 6), w: kw, h: kh });
        }
      }
      out.push({ id: "k:BS", ch: "⌫", x: 10, y: y0 + 2 * (kh + 6), w: kw * 1.4, h: kh });
      out.push({ id: "k:OK", ch: "DONE", x: W - 10 - kw * 1.6, y: y0 + 2 * (kh + 6), w: kw * 1.6, h: kh });
      return out;
    }
    function drawKeyboard() {
      const keys = keyRects();
      const kbTop = keys[0].y - 18;
      g.save();
      g.fillStyle = "rgba(6,5,8,0.988)"; g.fillRect(0, 0, W, H);

      const fy = H * 0.19;
      g.textAlign = "center"; g.textBaseline = "middle";
      g.fillStyle = TEAM[turn].ink; g.font = "700 11px " + MONO;
      tracked(g, "CLUE WORD", W / 2, fy, 4, "center");
      g.fillStyle = clueDraft ? CREAM : "rgba(241,231,210,0.22)";
      const shownWord = clueDraft || "—";
      const size = fitSize(g, shownWord, W - 60, 54, DISPLAY, "700");
      g.font = "700 " + size.toFixed(1) + "px " + DISPLAY;
      tracked(g, shownWord, W / 2, fy + 44, 3, "center");
      g.strokeStyle = "rgba(255,194,28,0.4)"; g.lineWidth = 1;
      g.beginPath(); g.moveTo(W * 0.14, fy + 76); g.lineTo(W * 0.86, fy + 76); g.stroke();
      g.fillStyle = "rgba(241,231,210,0.4)"; g.font = "400 9px " + MONO;
      tracked(g, "ONE WORD ONLY — THE NUMBER IS SET ON THE PREVIOUS SCREEN",
              W / 2, fy + 92, 0.9, "center");

      // The keys sit on their own slab, so the board behind never competes
      // with them for contrast.
      chamferRect(g, 0, kbTop, W, H - kbTop, 18);
      const lg = g.createLinearGradient(0, kbTop, 0, H);
      lg.addColorStop(0, "rgba(30,27,34,0.98)"); lg.addColorStop(1, "rgba(12,11,15,1)");
      g.fillStyle = lg; g.fill();
      g.strokeStyle = "rgba(255,194,28,0.20)"; g.lineWidth = 1;
      g.beginPath(); g.moveTo(18, kbTop + 0.5); g.lineTo(W, kbTop + 0.5); g.stroke();

      for (const k of keys) {
        const hot = pressed === k.id, wide = k.ch.length > 1;
        roundRect(g, k.x, k.y, k.w, k.h, 6);
        g.fillStyle = hot ? GOLD : wide ? "#332F3C" : "#26232D"; g.fill();
        g.strokeStyle = "rgba(0,0,0,0.5)"; g.lineWidth = 1; g.stroke();
        g.beginPath(); g.moveTo(k.x + 5, k.y + 1.5); g.lineTo(k.x + k.w - 5, k.y + 1.5);
        g.strokeStyle = "rgba(255,255,255,0.20)"; g.stroke();
        g.fillStyle = hot ? NOIR : "#E7E0D0";
        g.font = (wide ? "700 11px " + MONO : "700 16px " + MONO);
        g.textAlign = "center"; g.textBaseline = "middle";
        g.fillText(k.ch, k.x + k.w / 2, k.y + k.h / 2 + 1);
      }
      g.restore();
    }

    /* ===============================================================
     * JUICE
     * ============================================================= */
    function spark(i, colour, n) {
      const t = tileRect(i);
      for (let k = 0; k < n; k++) {
        const a = Math.random() * TAU, s = 40 + Math.random() * 150;
        sparks.push({
          x: t.x + t.w / 2, y: t.y + t.h / 2,
          vx: Math.cos(a) * s, vy: Math.sin(a) * s,
          life: 0.32 + Math.random() * 0.22, t: 0, c: colour,
        });
      }
    }
    function drawSparks() {
      g.save();
      g.lineCap = "round";
      for (const p of sparks) {
        const k = 1 - p.t / p.life;
        g.globalAlpha = clamp(k, 0, 1);
        g.strokeStyle = p.c; g.lineWidth = 2.2 * k + 0.4;
        g.beginPath();
        g.moveTo(p.x, p.y);
        g.lineTo(p.x - p.vx * 0.035, p.y - p.vy * 0.035);
        g.stroke();
      }
      g.restore();
      g.globalAlpha = 1;
    }

    /** The assassin: flash, wash, the card blown up at centre, an iris wipe. */
    function drawEndFx() {
      const t = endFx.t;
      if (endFx.kind === "assassin") {
        if (t < 0.09) {
          g.fillStyle = "rgba(255,255,255," + (1 - t / 0.09).toFixed(3) + ")";
          g.fillRect(0, 0, W, H);
        }
        const wash = clamp((t - 0.05) / 0.35, 0, 1) * 0.78;
        g.fillStyle = "rgba(10,10,12," + wash.toFixed(3) + ")";
        g.fillRect(0, 0, W, H);
        const k = clamp((t - 0.12) / 0.4, 0, 1);
        const s = 1 + easeOutBack(k) * 0.9;
        const r = tileRect(endFx.i);
        g.save();
        g.translate(W / 2, H * 0.42);
        g.scale(s, s);
        g.translate(-r.w / 2, -r.h / 2);
        const art = L.tileArt && L.tileArt.back[endFx.i];
        if (art) blit(g, art, 0, 0); else paintAgent(g, words[endFx.i], "assassin", r.w, r.h);
        g.restore();
        if (t > 0.3) {
          const p = clamp((t - 0.3) / 0.7, 0, 1);
          g.save();
          g.globalAlpha = (1 - p) * 0.85;
          g.strokeStyle = "#D6342A";
          g.lineWidth = Math.max(W, H) * 0.9;
          g.beginPath();
          g.arc(W / 2, H * 0.42, p * Math.hypot(W, H) * 0.75 + g.lineWidth / 2, 0, TAU);
          g.stroke();
          g.restore();
        }
      } else {
        const wash = clamp(t / 0.5, 0, 1) * 0.22;
        g.fillStyle = "rgba(8,6,12," + wash.toFixed(3) + ")";
        g.fillRect(0, 0, W, H);
      }
    }

    /* ===============================================================
     * FRAME
     * ============================================================= */
    function render() {
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, W, H);
      drawBackground();

      if (phase === "menu") { drawMenuArt(); return; }

      drawGridFrame();
      pushGrid(g);
      for (let i = 0; i < 25; i++) drawTile(i);
      g.restore();
      if (peek && (phase === "clue" || phase === "handoff")) drawKeyOverlay(1);
      drawSparks();

      if (phase === "board" || phase === "over") {
        drawBand("red"); drawBand("blue");
        if (phase === "board") drawSpine();
      } else if (phase === "clue") {
        drawSpymasterHeader(); drawCluePanel();
      }

      drawShutters();
      if (phase === "handoff") { drawHandoff(); drawPad(); }
      if (peek) drawExposed();
      if (typing) drawKeyboard();
      if (endFx) drawEndFx();
    }

    /* ===============================================================
     * TITLE ART — the box-cover layer: silhouettes on the sunburst with
     * a speech balloon, drawn straight rather than modelled.
     * ============================================================= */
    function drawMenuArt() {
      const baseY = H * 0.485;

      /**
       * Three flat figures on a deco rule. Each is a handful of separate
       * closed paths — coat, neck, head, hat — filled in the same ink so they
       * read as one silhouette, then stroked again along their left contour
       * inside a clip, which is the single rim light the whole cover style
       * runs on. No modelling, no cartoon outline.
       */
      const fig = (cx, s, kind) => {
        const parts = [];
        let detail = null;
        if (kind === 0) {                                  // skirt suit
          parts.push((p) => {                              // shoulders, waist, A-line skirt
            p.moveTo(-29, 0); p.lineTo(-11, -50);
            p.lineTo(-18, -71);
            p.quadraticCurveTo(-20, -78, -12, -80);
            p.lineTo(12, -80);
            p.quadraticCurveTo(20, -78, 18, -71);
            p.lineTo(11, -50);
            p.lineTo(29, 0); p.closePath();
          });
          parts.push((p) => { p.moveTo(-5, -86); p.lineTo(5, -86); p.lineTo(5, -76); p.lineTo(-5, -76); p.closePath(); });
          parts.push((p) => { p.ellipse(0, -97, 12.5, 14, 0, 0, TAU); });   // bobbed hair
          parts.push((p) => { p.moveTo(-12.5, -97); p.lineTo(-10, -79); p.lineTo(-3, -85); p.closePath(); });
        } else if (kind === 1) {                           // suit
          parts.push((p) => {
            p.moveTo(-19, 0); p.lineTo(-21, -52);
            p.quadraticCurveTo(-24, -73, -14, -78);
            p.lineTo(14, -78);
            p.quadraticCurveTo(24, -73, 21, -52);
            p.lineTo(19, 0); p.closePath();
          });
          parts.push((p) => { p.moveTo(-5, -84); p.lineTo(5, -84); p.lineTo(5, -74); p.lineTo(-5, -74); p.closePath(); });
          parts.push((p) => { p.ellipse(0, -95, 11.5, 13.5, 0, 0, TAU); });
          detail = (p) => {                                // collar and tie, one stroke
            p.beginPath();
            p.moveTo(-9, -78); p.lineTo(0, -66); p.lineTo(9, -78);
            p.lineWidth = 2; p.lineJoin = "round";
            p.strokeStyle = "rgba(255,206,124,0.85)"; p.stroke();
          };
        } else {                                           // fedora and trench coat
          parts.push((p) => {
            p.moveTo(-37, 2); p.lineTo(-31, -56);
            p.quadraticCurveTo(-33, -78, -14, -84);
            p.lineTo(14, -84);
            p.quadraticCurveTo(33, -78, 31, -56);
            p.lineTo(37, 2); p.closePath();
          });
          detail = (p) => {                                // lapel notch, one V
            p.beginPath();
            p.moveTo(-13, -83); p.lineTo(0, -63); p.lineTo(13, -83);
            p.lineWidth = 2.2; p.lineJoin = "round";
            p.strokeStyle = "rgba(255,206,124,0.9)"; p.stroke();
          };
          parts.push((p) => { p.ellipse(0, -96, 11.5, 13, 0, 0, TAU); });
          parts.push((p) => { p.ellipse(0, -105, 29, 4.6, 0, 0, TAU); });   // brim
          parts.push((p) => {                              // crown
            p.moveTo(-15, -105); p.lineTo(-12, -124);
            p.quadraticCurveTo(0, -128, 12, -124); p.lineTo(15, -105); p.closePath();
          });
        }
        g.save();
        g.translate(cx, baseY);
        g.scale(s, s);
        // The rim light is the same silhouette, filled once in warm light and
        // offset up-left, then covered by the ink copy. Stroking the parts
        // instead would draw every interior seam — a head ringed like a coin.
        g.fillStyle = "rgba(255,206,124,0.92)";
        g.save();
        g.translate(-2.6, -1.6);
        for (const part of parts) { g.beginPath(); part(g); g.fill(); }
        g.restore();
        g.fillStyle = "rgba(9,9,12,0.96)";
        for (const part of parts) { g.beginPath(); part(g); g.fill(); }
        if (detail) detail(g);
        g.restore();
      };
      // The lapel triangle sits inside the coat, so the middle figure keeps
      // its notch even though every part shares one ink.
      fig(W * 0.18, 0.92, 0);
      fig(W * 0.50, 1.12, 2);
      fig(W * 0.82, 0.90, 1);

      // a white balloon with red caps, straight off the cover
      const bw = Math.min(232, W - 72), bh = 52, bx = (W - bw) / 2, by = H * 0.17;
      g.save();
      g.fillStyle = PLAQUE;
      drawBalloon(g, bx, by, bw, bh, 14);
      g.fillStyle = RED;
      g.font = "700 21px " + DISPLAY; g.textAlign = "center"; g.textBaseline = "middle";
      tracked(g, "ONE WORD.", bx + bw / 2, by + 17, 2.4, "center");
      tracked(g, "ONE NUMBER.", bx + bw / 2, by + 38, 2.4, "center");
      g.restore();

      g.fillStyle = "rgba(11,11,13,0.85)";
      g.fillRect(0, baseY, W, 4);
      g.fillStyle = "rgba(255,194,28,0.5)";
      g.fillRect(0, baseY + 5, W, 1);
    }

    /* ===============================================================
     * RULES
     * ============================================================= */
    function commitGuess(i) {
      if (shown[i] || anim || endFx) return;
      armed = -1;
      // The state commits at the midpoint of the turn-over, and input stays
      // blocked until the card lands — hence the exposed `busy` flag.
      anim = {
        i, t: 0,
        mid: () => { shown[i] = true; },
        after: () => { resolve(i); },
      };
      sound.duck(0.4, 260);
      sound.haptic("medium");
      ctx.platform.interact({ type: "guess", team: turn });
    }

    function resolve(i) {
      const k = kinds[i];
      totalGuesses++;
      guessedThisTurn++;
      paintChrome();

      if (k === "assassin") {
        spark(i, "#D6342A", 22);
        sound.sting("lose"); sound.haptic("heavy");
        endGame(other(turn), "assassin");
        return;
      }
      if (k === turn) {
        spark(i, TEAM[turn].lit, 14);
        sound.sting("coin"); sound.haptic("light");
        sound.heat(clamp(1 - remaining(turn) / TEAM[turn].agents, 0.1, 1));
        if (remaining(turn) === 0) return endGame(turn, "agents");
        guessesLeft--;
        if (guessesLeft <= 0) return endTurn();
        return;
      }
      if (k === "neutral") {
        spark(i, TAN, 8);
        sound.sting("fail"); sound.haptic("warning");
        return endTurn();
      }
      // the other team's agent: it counts for them, and it can hand them the game
      spark(i, TEAM[k].lit, 12);
      sound.sting("danger"); sound.haptic("warning");
      if (remaining(k) === 0) return endGame(k, "agents");
      endTurn();
    }

    function endTurn() {
      if (winner) return;
      if (isCoop() && turn === "red") {
        // The simulated opposition takes its turn by covering one of its own
        // words, exactly as the two-player rules say to.
        const pool = [];
        for (let i = 0; i < 25; i++) if (kinds[i] === "blue" && !shown[i]) pool.push(i);
        if (!pool.length) return endGame("blue", "agents");
        const pick = pool[(Math.random() * pool.length) | 0];
        oppose = { i: pick, t: 0 };
        return;
      }
      beginTurn(other(turn));
    }

    function endGame(who, why) {
      winner = who; ending = why;
      phase = "over";
      armed = -1;
      paintChrome();
      revealAll = -1;
      endFx = { t: 0, kind: why === "assassin" ? "assassin" : "win", i: -1 };
      if (why === "assassin") {
        for (let i = 0; i < 25; i++) if (kinds[i] === "assassin") endFx.i = i;
      }
      sound.duck(0.55, 500);
      if (why !== "assassin") { sound.sting("win"); sound.haptic("success"); }
      const coop = isCoop();
      const won = coop ? who === "red" : true;
      ctx.platform.complete({
        result: coop ? (who === "red" ? "win" : "loss") : who,
        guesses: totalGuesses, reason: why,
      });
      // The record belongs to the match, not to one of the eight people
      // sharing the phone: how few contacts this board took to settle.
      if (why !== "assassin" && won) {
        try {
          ctx.memory.record("fewest_guesses").submit(totalGuesses,
            { label: totalGuesses + " guesses" });
        } catch (_) {}
      }
      ctx.timeout(showOver, why === "assassin" ? 1150 : 700);
    }

    /* ===============================================================
     * INPUT
     *
     * A pointer is bound to a zone the moment it lands and keeps it for
     * its whole life; a zone that already holds a live pointer refuses
     * any more. On a phone shared by up to eight people that is the
     * difference between a considered contact and whichever hand was
     * fastest. Everything except the pad resolves on pointerUP over the
     * same target, so a finger that slides off cancels.
     * ============================================================= */
    const live = new Map();          // pointerId -> {zone, id}
    const heldZones = new Set();

    function hitTest(x, y) {
      if (phase === "menu" || phase === "over") return null;
      if (typing) {
        for (const k of keyRects()) if (inRect(x, y, k)) return { zone: "kb", id: k.id };
        return { zone: "kb", id: "none" };
      }
      if (phase === "handoff") {
        if (inRect(x, y, L.sm.pad)) return { zone: "pad", id: "pad" };
        return null;
      }
      if (phase === "clue") {
        const s = L.sm;
        if (inRect(x, y, s.pad)) return { zone: "pad", id: "pad" };
        if (inRect(x, y, s.trans)) return { zone: "sm", id: "transmit" };
        if (inRect(x, y, s.chip)) return { zone: "sm", id: "chip" };
        for (let i = 0; i < 11; i++) if (inRect(x, y, pillRect(i))) return { zone: "sm", id: "pill:" + i };
        return null;
      }
      // board
      const t = tileAt(x, y);
      if (t >= 0) return { zone: "grid", id: "tile:" + t };
      const seat = seatOf(turn), p = toLocal(seat, x, y);
      if (p) {
        const R = bandRows(seat);
        if (inRect(p.x, p.y, R.confirm)) return { zone: "band", id: "confirm" };
        if (inRect(p.x, p.y, R.pass)) return { zone: "band", id: "pass" };
      }
      return null;
    }

    /** Raise the key. Called from whichever comes first — the frame that
     *  notices the wall clock has passed 700ms, or the timer armed when the
     *  finger landed. A device that stalls a frame (a GC pause, a tab coming
     *  back to the front) must not leave a held finger waiting. */
    function openKey() {
      if (peek || !holdOn) return;
      peek = true;
      holdT = HOLD_MS;
      holdBounce = 5;
      sound.sting("success"); sound.haptic("medium");
      if (phase === "handoff") { phase = "clue"; shutterTo = 0; paintChrome(); }
      render();
    }

    ctx.listen(canvas, "pointerdown", (e) => {
      e.preventDefault();
      firstGesture();
      const hit = hitTest(e.offsetX, e.offsetY);
      if (!hit) return;
      if (heldZones.has(hit.zone)) return;              // that zone already has a hand on it
      if (canvas.setPointerCapture) { try { canvas.setPointerCapture(e.pointerId); } catch (_) {} }
      heldZones.add(hit.zone);
      live.set(e.pointerId, hit);
      pressed = hit.id;
      if (hit.zone === "pad") {
        holdOn = true; holdT = 0; holdStart = performance.now(); sound.haptic("light");
        const seq = ++holdSeq;
        ctx.timeout(() => { if (seq === holdSeq) openKey(); }, HOLD_MS);
      }
      else if (hit.zone === "kb" && hit.id !== "none") sound.haptic("light");
    }, { passive: false });

    const release = (e) => {
      const hit = live.get(e.pointerId);
      if (!hit) return;
      live.delete(e.pointerId);
      heldZones.delete(hit.zone);
      pressed = null;
      if (hit.zone === "pad") {
        holdOn = false; holdSeq++;
        if (peek) { peek = false; holdBounce = 0; sound.haptic("light"); }
        holdT = 0;
        render();
        return;
      }
      const now = hitTest(e.offsetX, e.offsetY);
      if (!now || now.id !== hit.id) return;            // slid off: cancelled
      act(hit.id);
    };
    ctx.listen(canvas, "pointerup", release);
    ctx.listen(canvas, "pointercancel", release);

    function act(id) {
      if (busy()) return;
      if (id.startsWith("tile:")) {
        const i = Number(id.slice(5));
        if (shown[i] || phase !== "board" || !clue) return;
        armed = armed === i ? -1 : i;
        sound.sting("tap"); sound.haptic("light");
        return;
      }
      if (id === "confirm") { if (armed >= 0) commitGuess(armed); return; }
      if (id === "pass") {
        if (guessedThisTurn > 0) {
          sound.sting("tap"); sound.haptic("light");
          ctx.platform.interact({ type: "pass", team: turn });
          endTurn();
        }
        return;
      }
      if (id.startsWith("pill:")) {
        clueNum = Number(id.slice(5));
        sound.sting("tap"); sound.haptic("light");
        return;
      }
      if (id === "chip") { typing = true; sound.sting("tap"); return; }
      if (id === "transmit") return transmit();
      if (id.startsWith("k:")) {
        const k = id.slice(2);
        if (k === "BS") clueDraft = clueDraft.slice(0, -1);
        else if (k === "OK") typing = false;
        else if (clueDraft.length < 12) clueDraft += k;
        sound.sting("tap");
        return;
      }
      if (id === "none") { typing = false; return; }
    }

    function transmit() {
      // Zero and infinity are the two official special numbers: both lift the
      // guess cap, and zero additionally means "none of ours" — a pure warning.
      const unlimited = clueNum === 0 || clueNum === 10;
      clue = {
        word: clueDraft, num: clueNum === 10 ? 0 : clueNum, unlimited,
        display: clueNum === 10 ? "∞" : String(clueNum),
      };
      guessesLeft = unlimited ? 99 : clueNum + (settings.bonus ? 1 : 0);
      guessedThisTurn = 0;
      lastClue[turn] = clue;
      peek = false; holdOn = false; holdT = 0; holdSeq++;
      typing = false;
      phase = "board";
      shutter = 1; shutterTo = 0;                        // a wipe, so the key is gone
      sound.sting("powerup"); sound.haptic("medium");
      ctx.platform.interact({ type: "clue", team: turn, number: clueNum });
      paintChrome();
    }

    /* ===============================================================
     * OVERLAY — one markup string on the runtime-owned root, handles
     * queried back by [data-el]. The root is pointer-transparent: it is
     * created after the canvas and fills the container, so left alone it
     * silently eats every tap meant for the board.
     * ============================================================= */
    const btn = "pointer-events:auto;width:36px;height:36px;border-radius:10px;border:none;" +
      "background:rgba(11,10,9,0.72);color:" + CREAM + ";font-size:15px;line-height:1;" +
      "font-family:inherit;padding:0;box-shadow:inset 0 0 0 1px rgba(255,194,28,0.32);";
    const bigBtn = (bg, fg) => "width:100%;padding:14px;border:none;border-radius:4px;font-family:inherit;" +
      "font-size:15px;font-weight:700;letter-spacing:0.14em;background:" + bg + ";color:" + fg + ";" +
      "margin-top:10px;pointer-events:auto;text-transform:lowercase;";
    // A sheet is a column: fixed head, scrolling body, and the button pinned
    // at the foot — a rules list long enough to scroll must never push its own
    // way out of reach.
    const panel = "max-width:330px;width:100%;max-height:86%;display:flex;flex-direction:column;" +
      "background:linear-gradient(180deg,#1B1814,#100E0C);border-radius:4px;padding:20px;" +
      "box-shadow:inset 0 0 0 1px rgba(255,194,28,0.30),0 24px 60px rgba(0,0,0,0.6);";
    const sheetTitle = "font-family:" + DISPLAY + ";font-size:27px;letter-spacing:0.14em;" +
      "flex:0 0 auto;color:#FFDA7A;";
    const scroller = "flex:1 1 auto;overflow-y:auto;min-height:0;-webkit-overflow-scrolling:touch;";
    const sheet = "position:absolute;inset:0;display:none;align-items:center;justify-content:center;" +
      "background:rgba(6,4,3,0.90);z-index:70;padding:22px;pointer-events:auto;";
    const label = "font-size:10px;letter-spacing:0.28em;text-transform:lowercase;opacity:0.5;font-family:" + MONO + ";";

    const root = ctx.createRoot({ touchAction: "none" });
    root.style.cssText += ";font-family:" + BODY + ";color:" + CREAM + ";pointer-events:none;text-transform:lowercase;";

    /* Form controls do not inherit text-transform: the UA stylesheet pins
     * `text-transform:none` on button/input/select, so the lowercase set on
     * this root stops dead at every button. Stamp them as they are built,
     * rather than threading the declaration through 250 style strings. */
    const lowercaseControls = () => {
      for (const el of root.querySelectorAll("button,input,select,textarea")) {
        if (el.style.textTransform !== "lowercase") el.style.textTransform = "lowercase";
      }
    };
    lowercaseControls();
    new MutationObserver(lowercaseControls).observe(root, { childList: true, subtree: true });
    root.innerHTML =
      /* ---- utility chrome, parked in the spine that belongs to nobody ---- */
      '<div data-el="chrome" style="position:absolute;right:8px;top:0;display:flex;gap:6px;' +
        'z-index:40;pointer-events:none;">' +
        '<button data-el="mute" aria-label="Sound" style="' + btn + 'font-size:16px;">♪</button>' +
        '<button data-el="cog" aria-label="Settings" style="' + btn + '">⚙</button>' +
        '<button data-el="help" aria-label="How to play" style="' + btn + '">?</button>' +
      '</div>' +

      /* ---- title ---- */
      '<div data-el="menu" style="position:absolute;inset:0;display:flex;flex-direction:column;' +
        'justify-content:flex-end;align-items:center;z-index:50;pointer-events:auto;text-align:center;' +
        'padding:0 24px ' + (ctx.safeArea.bottom + 18) + 'px;background:linear-gradient(180deg,' +
        'rgba(9,6,10,0) 40%,rgba(9,6,10,0.55) 52%,rgba(9,6,10,0.94) 64%,rgba(9,6,10,0.99) 100%);">' +
        '<div style="' + label + 'margin-bottom:4px;">Dossier 25 · Classified</div>' +
        '<div style="font-family:' + DISPLAY + ';font-size:64px;font-weight:700;letter-spacing:0.09em;' +
          'line-height:0.94;background:linear-gradient(178deg,#FFF0C2 8%,#FFC21C 48%,#D9482E);' +
          '-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;' +
          'color:transparent;text-shadow:0 10px 34px rgba(0,0,0,0.55);">CIPHER</div>' +
        '<div style="font-size:13.5px;line-height:1.55;opacity:0.72;max-width:262px;margin-top:6px;">' +
          'Two spymasters know which of the twenty-five words are theirs. ' +
          'Everyone else has one word and one number — and one assassin to avoid.</div>' +
        '<div style="' + label + 'margin:18px 0 8px;">How many players?</div>' +
        '<div data-el="counts" style="display:flex;gap:6px;"></div>' +
        '<div data-el="modenote" style="font-size:11.5px;opacity:0.6;margin-top:9px;min-height:16px;' +
          'font-family:' + MONO + ';letter-spacing:0.04em;"></div>' +
        '<div style="width:100%;max-width:280px;">' +
          '<button data-el="begin" style="' + bigBtn("linear-gradient(180deg,#FFD75A,#E09A16)", "#1A1105") +
            'margin-top:14px;font-size:16px;">Deal the board</button>' +
        '</div>' +
        '<div style="display:flex;gap:8px;margin-top:10px;">' +
          '<button data-el="mhelp" style="pointer-events:auto;padding:9px 14px;border:none;border-radius:4px;' +
            'background:rgba(255,255,255,0.08);color:' + CREAM + ';font-family:inherit;font-size:12px;' +
            'letter-spacing:0.12em;text-transform:lowercase;">How to play</button>' +
          '<button data-el="mcog" style="pointer-events:auto;padding:9px 14px;border:none;border-radius:4px;' +
            'background:rgba(255,255,255,0.08);color:' + CREAM + ';font-family:inherit;font-size:12px;' +
            'letter-spacing:0.12em;text-transform:lowercase;">Settings</button>' +
        '</div>' +
      '</div>' +

      /* ---- result: a bottom sheet, so the key stays readable above it ---- */
      '<div data-el="over" style="position:absolute;inset:0;display:none;z-index:60;pointer-events:none;">' +
        '<div data-el="over-mirror" style="position:absolute;left:0;right:0;top:' + (ctx.safeArea.top + 16) + 'px;' +
          'transform:rotate(180deg);text-align:center;font-family:' + DISPLAY + ';font-size:30px;' +
          'letter-spacing:0.14em;opacity:0.9;"></div>' +
        '<div style="position:absolute;left:0;right:0;bottom:0;pointer-events:auto;padding:44px 22px ' +
          (ctx.safeArea.bottom + 18) + 'px;text-align:center;background:linear-gradient(180deg,' +
          // Opaque by the time it reaches the headline: at 0.90 the live band
          // underneath ghosted its team name and lozenges through, directly
          // behind the largest type on the screen.
          'rgba(9,6,10,0) 0%,rgba(9,6,10,0.94) 12%,rgba(9,6,10,1) 24%);">' +
          '<div data-el="over-label" style="' + label + '">Mission closed</div>' +
          '<div data-el="over-title" style="font-family:' + DISPLAY + ';font-size:46px;letter-spacing:0.10em;' +
            'line-height:1.05;margin-top:2px;"></div>' +
          '<div data-el="over-sub" style="font-size:13px;opacity:0.7;margin-top:4px;line-height:1.5;"></div>' +
          '<div style="width:100%;max-width:290px;margin:0 auto;">' +
            '<button data-el="again" style="' + bigBtn("linear-gradient(180deg,#FFD75A,#E09A16)", "#1A1105") + '">Deal again</button>' +
            '<button data-el="quit" style="' + bigBtn("rgba(255,255,255,0.10)", CREAM) + '">Change players</button>' +
          '</div>' +
        '</div>' +
      '</div>' +

      /* ---- settings ---- */
      '<div data-el="cogp" style="' + sheet + '">' +
        '<div style="' + panel + '">' +
          '<div style="' + sheetTitle + '">SETTINGS</div>' +
          '<div style="' + scroller + '">' +
            '<div style="' + label + 'margin:14px 0 7px;">Sound</div>' +
            '<div data-el="mutes" style="display:flex;gap:6px;"></div>' +
            '<div style="' + label + 'margin:16px 0 7px;">Red sits at the</div>' +
            '<div data-el="seats" style="display:flex;gap:6px;"></div>' +
            '<div style="font-size:11.5px;opacity:0.5;margin-top:7px;line-height:1.5;">' +
              'Each team gets the band at its own edge of the phone, turned to face it.</div>' +
            '<div style="' + label + 'margin:16px 0 7px;">Bonus guess</div>' +
            '<div data-el="bonus" style="display:flex;gap:6px;"></div>' +
            '<div style="font-size:11.5px;opacity:0.5;margin-top:7px;line-height:1.5;">' +
              'The extra guess after the number, for picking up a word missed on an earlier clue.</div>' +
            '<div style="' + label + 'margin:16px 0 7px;">Players</div>' +
            '<div data-el="counts2" style="display:flex;gap:6px;flex-wrap:wrap;"></div>' +
            '<div style="font-size:11.5px;opacity:0.5;margin:7px 0 4px;line-height:1.5;">' +
              'Two or three play the co-op variant. Applies on the next deal.</div>' +
          '</div>' +
          '<button data-el="cogp-close" style="' + bigBtn("rgba(255,255,255,0.11)", CREAM) + 'margin-top:14px;flex:0 0 auto;">Done</button>' +
        '</div>' +
      '</div>' +

      /* ---- how to play ---- */
      '<div data-el="helpp" style="' + sheet + '">' +
        '<div style="' + panel + '">' +
          '<div style="' + sheetTitle + '">HOW TO PLAY</div>' +
          '<ul style="' + scroller + 'font-size:13px;line-height:1.55;opacity:0.86;' +
            'padding-left:17px;margin:10px 0 0;">' +
            '<li>Two teams. Each picks <b>one spymaster</b>; everyone else is an operative.</li>' +
            '<li>The phone lies flat between you. The grid turns to face whichever team is guessing, so the codewords are always the right way up for them.</li>' +
            '<li>At the start of a turn the screen shutters closed. <b>Pass the phone to that team’s spymaster.</b></li>' +
            '<li>The spymaster <b>holds the fingerprint pad</b> to read the key. Let go and it hides instantly — never put the phone down while it is up.</li>' +
            '<li>Nine words are RED, eight are BLUE, seven are bystanders and <b>one is the assassin</b>. Red goes first.</li>' +
            '<li>The spymaster gives <b>one word and one number</b> — how many codewords the clue points at. Never anything about spelling, letters or where a word sits.</li>' +
            '<li>Operatives tap a codeword to <b>arm</b> it, then press CONFIRM CONTACT. Two steps, on purpose.</li>' +
            '<li>Your own colour: it stays yours, and you may keep guessing. A bystander ends the turn. The other team’s colour ends the turn <b>and counts for them</b>.</li>' +
            '<li>The assassin ends the game at once and the team that touched it loses.</li>' +
            '<li>You get the number plus one guess, and may stop after the first with END TURN.</li>' +
            '<li>First team to contact all of its agents wins — which can happen on the other team’s turn.</li>' +
            '<li>Two or three players: one team, one spymaster, racing an opposition that covers one of its own words every turn.</li>' +
          '</ul>' +
          '<button data-el="helpp-close" style="' + bigBtn("rgba(255,255,255,0.11)", CREAM) + 'margin-top:14px;flex:0 0 auto;">Got it</button>' +
        '</div>' +
      '</div>';

    const el = (n) => root.querySelector('[data-el="' + n + '"]');
    const tap = (node, fn) => {
      if (!node) return;
      ctx.listen(node, "pointerdown", (e) => e.stopPropagation());
      ctx.listen(node, "click", (e) => { e.stopPropagation(); e.preventDefault(); fn(e); });
    };

    /** Segmented pills, the only settings control this bit needs. */
    function pills(host, values, labels, get, set) {
      if (!host) return null;
      host.innerHTML = values.map((v, i) =>
        '<button data-v="' + esc(v) + '" style="flex:1;min-width:34px;padding:10px 0;border:none;border-radius:4px;' +
        'font-family:inherit;font-size:13px;font-weight:700;pointer-events:auto;letter-spacing:0.08em;">' +
        esc(labels[i]) + '</button>').join("");
      const paint = () => {
        for (const b of host.querySelectorAll("button")) {
          const on = String(get()) === b.dataset.v;
          b.style.background = on ? "rgba(255,194,28,0.26)" : "rgba(255,255,255,0.06)";
          b.style.color = on ? "#FFE9AE" : "rgba(241,231,210,0.55)";
          b.style.boxShadow = on ? "inset 0 0 0 1px rgba(255,194,28,0.6)" : "none";
        }
      };
      for (const b of host.querySelectorAll("button")) {
        tap(b, () => { set(b.dataset.v); saveSettings(); paintAll(); sound.haptic("light"); sound.sting("tap"); });
      }
      paint();
      return paint;
    }
    let repaints = [];
    function paintAll() {
      for (const f of repaints) if (f) f();
      const note = el("modenote");
      if (note) {
        note.textContent = isCoop()
          ? "CO-OP — ONE TEAM VS THE OPPOSITION"
          : "TWO TEAMS · ONE SPYMASTER EACH";
      }
      paintMute();
    }
    const COUNTS = [2, 3, 4, 5, 6, 7, 8];
    function wirePills() {
      repaints = [
        pills(el("counts"), COUNTS, COUNTS, () => settings.players, (v) => { settings.players = Number(v); }),
        pills(el("counts2"), COUNTS, COUNTS, () => settings.players, (v) => { settings.players = Number(v); }),
        pills(el("seats"), ["bottom", "top"], ["Bottom", "Top"], () => settings.redSeat,
          (v) => { settings.redSeat = v; paintChrome(); }),
        pills(el("bonus"), ["true", "false"], ["On", "Off"], () => String(settings.bonus),
          (v) => { settings.bonus = v === "true"; }),
        pills(el("mutes"), ["false", "true"], ["On", "Muted"], () => String(sound.muted),
          (v) => { if ((v === "true") !== sound.muted) sound.toggle(); }),
      ];
    }
    wirePills();
    function paintMute() {
      const b = el("mute");
      if (!b) return;
      b.style.textDecoration = sound.muted ? "line-through" : "none";
      b.style.opacity = sound.muted ? "0.45" : "1";
    }

    /** The chrome sits in the spine and hides on the title screen. */
    function paintChrome() {
      const c = el("chrome");
      if (!c) return;
      c.style.top = (L.spineY + 2) + "px";
      c.style.display = (phase === "menu" || phase === "over" || phase === "handoff") ? "none" : "flex";
    }

    let started = false;
    function firstGesture() {
      if (started) return;
      started = true;
      try { ctx.platform.start({ players: settings.players }); } catch (_) {}
      sound.unlock();
    }

    tap(el("mute"), () => { sound.toggle(); paintAll(); });
    tap(el("cog"), () => { el("cogp").style.display = "flex"; paintAll(); });
    tap(el("mcog"), () => { el("cogp").style.display = "flex"; paintAll(); });
    tap(el("cogp-close"), () => { el("cogp").style.display = "none"; });
    tap(el("help"), () => { el("helpp").style.display = "flex"; });
    tap(el("mhelp"), () => { el("helpp").style.display = "flex"; });
    tap(el("helpp-close"), () => { el("helpp").style.display = "none"; });

    tap(el("begin"), () => {
      firstGesture();
      el("menu").style.display = "none";
      newDeal();
      paintChrome();
    });
    tap(el("again"), () => {
      el("over").style.display = "none";
      newDeal();
      ctx.platform.interact({ type: "replay" });
    });
    tap(el("quit"), () => {
      el("over").style.display = "none";
      el("menu").style.display = "flex";
      phase = "menu";
      shutter = 0; shutterTo = 0; peek = false; holdOn = false; holdSeq++; endFx = null;
      paintChrome(); paintAll();
    });

    function showOver() {
      const coop = isCoop();
      const t = el("over-title"), s = el("over-sub"), m = el("over-mirror");
      let head, sub;
      if (ending === "assassin") {
        head = coop ? "ASSASSIN" : TEAM[winner].name + " WINS";
        sub = coop
          ? "Your operatives touched the assassin."
          : TEAM[other(winner)].name + " touched the assassin — instant loss.";
      } else if (coop) {
        head = winner === "red" ? "ALL AGENTS HOME" : "OPPOSITION WINS";
        sub = winner === "red"
          ? "Every one of your nine agents contacted in " + totalGuesses + " guesses."
          : "The opposition contacted all eight of theirs first.";
      } else {
        head = TEAM[winner].name + " WINS";
        sub = "All " + TEAM[winner].agents + " agents contacted — " + totalGuesses + " guesses in all.";
      }
      t.textContent = head;
      t.style.color = ending === "assassin" && coop ? "#D6342A"
                    : winner === "red" ? RED : BLUE;
      s.textContent = sub;
      m.textContent = head;
      m.style.color = t.style.color;
      el("over").style.display = "block";
    }

    /* ===============================================================
     * FRAME LOOP
     * ============================================================= */
    ctx.onFrame((dtMs) => {
      const dt = Math.min(dtMs, 60) / 1000;
      wedgeT += dt * 0.004;
      reticle -= dt * 36;
      pulse += dt;

      shutter += (shutterTo - shutter) * Math.min(1, dt * 17);
      if (Math.abs(shutter - shutterTo) < 0.004) shutter = shutterTo;

      if (phase === "handoff") typed += (dtMs / 1000) * 46;   // real time, not frame-capped

      if (holdOn && !peek) {
        // Wall clock, not accumulated frame time: on a device that drops a
        // long frame the hold must still finish in 700 real milliseconds.
        holdT = performance.now() - holdStart;
        if (holdT >= HOLD_MS) openKey();
      }
      holdBounce *= Math.max(0, 1 - dt * 9);

      if (anim) {
        const was = anim.t;
        anim.t += dtMs;
        if (was < FLIP_MS / 2 && anim.t >= FLIP_MS / 2) anim.mid();
        if (anim.t >= FLIP_MS) { const a = anim; anim = null; a.after(); }
      }

      if (oppose) {
        oppose.t += dtMs;
        if (oppose.t > 320 && !shown[oppose.i]) {
          shown[oppose.i] = true;
          spark(oppose.i, BLUE_LIT, 10);
          sound.sting("danger"); sound.haptic("warning");
        }
        if (oppose.t > 820) {
          const done = remaining("blue") === 0;
          oppose = null;
          if (done) endGame("blue", "agents");
          else beginTurn("red");
        }
      }

      if (endFx) {
        endFx.t += dtMs / 1000;      // real seconds: the cascade is choreography
        // The whole key turns over behind the result sheet, one card at a time.
        if (endFx.t > 0.5) revealAll = Math.min(24, Math.floor((endFx.t - 0.5) / 0.045));
        if (endFx.t > 3) endFx = null;
      }

      for (let i = sparks.length - 1; i >= 0; i--) {
        const p = sparks[i];
        p.t += dt;
        p.x += p.vx * dt; p.y += p.vy * dt;
        p.vy += 180 * dt; p.vx *= 0.94; p.vy *= 0.94;
        if (p.t >= p.life) sparks.splice(i, 1);
      }

      render();
    });

    ctx.listen(window, "resize", () => {
      if (ctx.width === W && ctx.height === H) return;
      canvas.width = Math.round(ctx.width * dpr);
      canvas.height = Math.round(ctx.height * dpr);
      // Writing canvas.width RESETS the 2D transform to the identity, so the
      // DPR scale ctx.createCanvas2D() installed at boot is gone and every
      // following frame draws at 1:1 in physical pixels — the whole game
      // shrinks into the top-left corner. It has to be re-applied here.
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      layout();
      bakeSunburst();
      if (words.length) bakeTiles();
      paintChrome();
    });

    /* ===============================================================
     * A read-only window for the local harness, so a scripted match can
     * drive the real UI and assert on what actually happened. It shows
     * nothing a player at the table could not already work out — except
     * the key, which only the test needs and which no on-screen control
     * can reach.
     * ============================================================= */
    window.__CIPHER__ = {
      get phase() { return phase; },
      get turn() { return turn; },
      get busy() { return busy() || typing; },
      get winner() { return winner; },
      get ending() { return ending; },
      get kinds() { return kinds.slice(); },
      get words() { return words.slice(); },
      get shown() { return shown.slice(); },
      get armed() { return armed; },
      get clue() { return clue ? { word: clue.word, num: clue.num, unlimited: clue.unlimited } : null; },
      get guessesLeft() { return guessesLeft; },
      get guessedThisTurn() { return guessedThisTurn; },
      get guesses() { return totalGuesses; },
      get peek() { return peek; },
      get remaining() { return { red: remaining("red"), blue: remaining("blue") }; },
      /** SCREEN centre of a tile, which is not its grid centre once the
       *  board has turned to face the other team. gridPoint is its own
       *  inverse, so it converts in both directions. */
      tileXY(i) {
        const t = tileRect(i);
        return gridPoint(t.x + t.w / 2, t.y + t.h / 2);
      },
      padXY() { const r = L.sm.pad; return { x: r.x + r.w / 2, y: r.y + r.h / 2 }; },
      transmitXY() { const r = L.sm.trans; return { x: r.x + r.w / 2, y: r.y + r.h / 2 }; },
      chipXY() { const r = L.sm.chip; return { x: r.x + r.w / 2, y: r.y + r.h / 2 }; },
      pillXY(n) { const r = pillRect(n); return { x: r.x + r.w / 2, y: r.y + r.h / 2 }; },
      keyXY(ch) {
        const k = keyRects().find((r) => r.id === "k:" + ch);
        return k ? { x: k.x + k.w / 2, y: k.y + k.h / 2 } : null;
      },
      bandXY(which) {
        const seat = seatOf(turn), R = bandRows(seat), r = R[which];
        const lx = r.x + r.w / 2, ly = r.y + r.h / 2;
        return seat === "top" ? { x: W - lx, y: L.bandH - ly } : { x: lx, y: H - L.bandH + ly };
      },
    };
    ctx.onDestroy(() => { try { delete window.__CIPHER__; } catch (_) {} });

    // The sunburst, the frieze and the title are all on screen before ready()
    // is called, so the host never shows a blank bit for a single frame.
    paintAll();
    paintChrome();
    render();
    ctx.markVisualReady("dossier open");
    ctx.platform.ready();

    // Wait for the real face before baking, or the tiles are measured in the
    // fallback stack and every codeword is set at the wrong size. Sizes come
    // from measureText, so a failure just leaves the fallback in place and
    // nothing reflows wrongly.
    try {
      await ctx.loadFont("Inter", "inter", "1.0.0", { weight: "700" });
      if (words.length) bakeTiles();
    } catch (_) { /* the fallback stack is already carrying the screen */ }
  },
};
