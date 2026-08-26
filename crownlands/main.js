/**
 * Crownlands — a tile-laying kingdom race for two to four people, one phone.
 *
 * Everyone drafts dominoes from a shared lane and lays them into their own
 * five-by-five kingdom. Matching terrain has to touch matching terrain, and at
 * the end each connected stretch of land scores its size times the crowns
 * standing on it — so a huge forest with no crowns is worth nothing, and a
 * single mine square with three crowns is worth three.
 *
 * There is no hidden information anywhere in this game. The lane is face up,
 * every kingdom is face up, and only the order of the undrawn pile is unknown.
 * That is what makes it work on one device: the phone lies FLAT on the table
 * and stays there, and players reach in rather than passing it around. There is
 * no privacy screen in this bit and there should not be one.
 *
 * Seating is two-sided only. Players sit along the two long edges, and the
 * whole world flips 180 degrees when the active player's side changes — never
 * 90. A quarter turn would have to fit a five-by-five kingdom plus a draft lane
 * into a portrait phone's width, which collapses the board; a half turn maps
 * the layout exactly onto itself and wastes nothing. Consecutive players on the
 * same side see no flip at all.
 *
 * Contract notes: no packaged assets (maxAssets is 0), so every terrain, crown
 * and castle is a canvas path. The overlay is markup on ctx.createRoot() with
 * pointer-events off on the root itself, because that element sits above the
 * canvas and would otherwise swallow every tap. Pointer maths uses
 * offsetX/offsetY, never getBoundingClientRect.
 */
window.plethoraBit = {
  meta: {
    title: "Crownlands",
    runtime: "plethora-bit@2",
    tags: ["board", "multiplayer", "local-multiplayer", "tiles", "strategy"],
    permissions: ["backgroundMusic", "haptics", "storage"],
  },

  async init(ctx) {

    /* A drawn speaker rather than the emoji. Colour-emoji glyphs land as a
     * blue-and-white blob beside otherwise monochrome chrome, they ignore the
     * button's own colour, and they are the one thing on screen that is not
     * set in the game's typeface. currentColor keeps this one in step. */
    const SPK = (on) =>
      '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" ' +
        'stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" ' +
        'style="display:block;margin:0 auto;overflow:visible;" aria-hidden="true">' +
        '<path d="M4 9.4h3.5L12.2 5.4v13.2L7.5 14.6H4z" fill="currentColor" stroke="none"/>' +
        (on ? '<path d="M15.8 9.2a4 4 0 0 1 0 5.6"/><path d="M18.4 6.6a7.7 7.7 0 0 1 0 10.8"/>'
            : '<path d="M16.2 9.6l5 4.8M21.2 9.6l-5 4.8"/>') +
      '</svg>';

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
    /* ---------------------------------------------------------------
     * Terrain
     * ------------------------------------------------------------- */
    const T = {
      wheat:  { id: "wheat",  base: "#F9D306", dark: "#D8B006", name: "Wheat" },
      grass:  { id: "grass",  base: "#C6CD2F", dark: "#9DA522", name: "Grass" },
      forest: { id: "forest", base: "#2E5A2A", dark: "#1E3F1B", name: "Forest" },
      lake:   { id: "lake",   base: "#1D93D2", dark: "#1272A6", name: "Lake" },
      swamp:  { id: "swamp",  base: "#C5BD9F", dark: "#A39A7C", name: "Swamp" },
      mine:   { id: "mine",   base: "#221F1B", dark: "#100E0C", name: "Mine" },
    };
    const GOLD = "#F2C438", KEYLINE = "#8A4A12", PARCH = "#F3E4C0", FELT = "#0F2C3D";
    const RED = "#D2412F", SKY = "#A4DBF0";

    /**
     * The tile deck.
     *
     * Forty-eight dominoes, built to the same crown economy the physical game
     * uses rather than transcribed from it: the plentiful terrains carry no
     * crowns at all, crowns get rarer as the terrain does, and the only
     * three-crown tiles are mines. That is what makes a small mine worth
     * chasing and a vast empty forest worth nothing.
     */
    function buildDeck() {
      const spec = [
        // [terrainA, crownsA, terrainB, crownsB, howMany]
        ["wheat", 0, "wheat", 0, 2],  ["forest", 0, "forest", 0, 4],
        ["lake", 0, "lake", 0, 4],    ["grass", 0, "grass", 0, 2],
        ["swamp", 0, "swamp", 0, 2],
        ["wheat", 0, "forest", 0, 1], ["wheat", 0, "lake", 0, 1],
        ["wheat", 0, "grass", 0, 1],  ["wheat", 0, "swamp", 0, 1],
        ["forest", 0, "lake", 0, 1],  ["forest", 0, "grass", 0, 1],
        // One crown, on the half that is NOT the common terrain.
        ["wheat", 0, "forest", 1, 2], ["wheat", 0, "lake", 1, 2],
        ["wheat", 0, "grass", 1, 2],  ["wheat", 0, "swamp", 1, 2],
        ["wheat", 0, "mine", 1, 2],   ["forest", 0, "wheat", 1, 4],
        ["lake", 0, "wheat", 1, 2],   ["grass", 0, "wheat", 1, 1],
        // Two crowns.
        ["wheat", 0, "grass", 2, 2],  ["wheat", 0, "swamp", 2, 2],
        ["forest", 0, "grass", 2, 1], ["lake", 0, "swamp", 2, 1],
        ["grass", 0, "mine", 2, 1],
        // Three crowns are mines, and there are very few.
        ["wheat", 0, "mine", 3, 1],   ["swamp", 0, "mine", 3, 2],
      ];
      const deck = [];
      for (const [a, ca, b, cb, n] of spec) {
        for (let i = 0; i < n; i++) deck.push({ a: { t: a, c: ca }, b: { t: b, c: cb } });
      }
      // A tile's number is its rank once the deck is built: low numbers are the
      // plain land everybody can afford, high numbers carry the crowns. Sorting
      // the lane by it is the whole tension of the draft.
      deck.sort((x, y) => (x.a.c + x.b.c) - (y.a.c + y.b.c));
      deck.forEach((d, i) => { d.n = i + 1; });
      return deck;
    }

    const shuffle = (a) => {
      for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
      }
      return a;
    };
    const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
    const esc = (s) => String(s).replace(/[&<>"']/g,
      (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/* ===== RULES START ===== */
    /**
     * A kingdom is a sparse map keyed "x,y" holding { t, c }, plus the bounds
     * it currently occupies. The castle sits at 0,0 and every coordinate is
     * relative to it, so a kingdom can grow in any direction as long as its
     * final bounding box never exceeds five by five.
     */
    function newKingdom() {
      return { cells: { "0,0": { t: "castle", c: 0 } }, minX: 0, maxX: 0, minY: 0, maxY: 0 };
    }
    const at = (k, x, y) => k.cells[x + "," + y] || null;

    /** Would adding (x,y) push the kingdom past five squares in either axis? */
    function fitsBounds(k, cells) {
      let nx0 = k.minX, nx1 = k.maxX, ny0 = k.minY, ny1 = k.maxY;
      for (const [x, y] of cells) {
        nx0 = Math.min(nx0, x); nx1 = Math.max(nx1, x);
        ny0 = Math.min(ny0, y); ny1 = Math.max(ny1, y);
      }
      return (nx1 - nx0) < 5 && (ny1 - ny0) < 5;
    }

    /**
     * Is this placement legal?
     *
     * Both halves must land on empty squares inside a five-by-five box, and at
     * least one half must touch either the castle or a square of its own
     * terrain. That "at least one" is the rule people get wrong — the OTHER
     * half is free to sit against anything at all.
     */
    function canPlace(k, tile, x, y, dir) {
      const [bx, by] = [x + DIRS[dir][0], y + DIRS[dir][1]];
      if (at(k, x, y) || at(k, bx, by)) return false;
      if (!fitsBounds(k, [[x, y], [bx, by]])) return false;
      return touches(k, x, y, tile.a.t) || touches(k, bx, by, tile.b.t);
    }
    const DIRS = { E: [1, 0], S: [0, 1], W: [-1, 0], N: [0, -1] };

    function touches(k, x, y, terrain) {
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const n = at(k, x + dx, y + dy);
        if (!n) continue;
        if (n.t === "castle" || n.t === terrain) return true;
      }
      return false;
    }

    function place(k, tile, x, y, dir) {
      const [bx, by] = [x + DIRS[dir][0], y + DIRS[dir][1]];
      k.cells[x + "," + y] = { t: tile.a.t, c: tile.a.c };
      k.cells[bx + "," + by] = { t: tile.b.t, c: tile.b.c };
      k.minX = Math.min(k.minX, x, bx); k.maxX = Math.max(k.maxX, x, bx);
      k.minY = Math.min(k.minY, y, by); k.maxY = Math.max(k.maxY, y, by);
    }

    /** Every legal placement for a tile, so the UI can offer exactly those. */
    function legalPlacements(k, tile) {
      const out = [];
      const seen = new Set();
      // Two beyond the bounds, not one. Only ONE half has to touch the
      // kingdom, so the other can sit a full square further out — and since
      // either half may be the toucher, the leading half ranges over
      // bounds +/- 2. Scanning +/- 1 silently drops every placement that
      // reaches outward, which is most of them.
      for (let x = k.minX - 2; x <= k.maxX + 2; x++) {
        for (let y = k.minY - 2; y <= k.maxY + 2; y++) {
          for (const dir of ["E", "S", "W", "N"]) {
            if (!canPlace(k, tile, x, y, dir)) continue;
            const key = x + "," + y + dir;
            if (seen.has(key)) continue;
            seen.add(key);
            out.push({ x, y, dir });
          }
        }
      }
      return out;
    }

    /**
     * Score: every connected run of one terrain is worth its size times the
     * crowns standing on it. A vast forest with no crowns scores nothing,
     * which is the whole game.
     */
    function scoreKingdom(k) {
      const seen = new Set();
      let total = 0;
      const parts = [];
      for (const key of Object.keys(k.cells)) {
        const cell = k.cells[key];
        if (cell.t === "castle" || seen.has(key)) continue;
        const stack = [key];
        seen.add(key);
        let size = 0, crowns = 0;
        while (stack.length) {
          const cur = stack.pop();
          const [cx, cy] = cur.split(",").map(Number);
          const c = k.cells[cur];
          size++; crowns += c.c;
          for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const nk = (cx + dx) + "," + (cy + dy);
            const n = k.cells[nk];
            if (n && !seen.has(nk) && n.t === cell.t) { seen.add(nk); stack.push(nk); }
          }
        }
        if (crowns) parts.push({ t: cell.t, size, crowns, points: size * crowns });
        total += size * crowns;
      }
      // Two common house rules, both on by default because they reward the
      // thing the game is actually asking you to do.
      const w = k.maxX - k.minX, h = k.maxY - k.minY;
      const filled = Object.keys(k.cells).length === 25;
      const centred = k.minX === -2 && k.maxX === 2 && k.minY === -2 && k.maxY === 2;
      const bonus = (filled ? 5 : 0) + (centred ? 10 : 0);
      return { total: total + bonus, parts, bonus, filled, centred, w: w + 1, h: h + 1 };
    }
/* ===== RULES END ===== */

    /* ---------------------------------------------------------------
     * Settings and sound
     * ------------------------------------------------------------- */
    const saved = (function () {
      try { return ctx.storage.get("crownlands") || {}; } catch (_) { return {}; }
    })();
    const settings = { players: clamp(saved.players || 3, 2, 4), mute: !!saved.mute };
    function saveSettings() { try { ctx.storage.set("crownlands", settings); } catch (_) {} }

    const sound = (function () {
      let muted = settings.mute, bed = null, unlocked = false;
      const start = () => ctx.music.play({ preset: "cozy", volume: 0.24, tempo: 88, intensity: 0.24 });
      return {
        get muted() { return muted; },
        async unlock() {
          if (unlocked) return;
          unlocked = true;
          try { await ctx.music.unlock(); if (!muted) bed = start(); } catch (_) {}
        },
        sting(n) { if (!muted) { try { ctx.music.sting(n); } catch (_) {} } },
        duck(a, ms) { if (!muted) { try { ctx.music.duck(a, ms); } catch (_) {} } },
        haptic(k) { try { ctx.platform.haptic(k); } catch (_) {} },
        toggle() {
          muted = !muted; settings.mute = muted; saveSettings();
          try {
            if (muted) { (bed || ctx.music).stop({ fadeOutMs: 240 }); bed = null; }
            else if (unlocked) bed = start();
          } catch (_) {}
          return muted;
        },
      };
    })();

    const COLOURS = ["#D2412F", "#1D93D2", "#F2C438", "#2E9E5B"];
    // The same four inks lifted for type on the dark felt. Crimson and Verdant
    // at board saturation sit at about 4:1 there, which is under the line for
    // 14px text and reads as a bruise rather than a name; the frame and the
    // claim dot are shapes and keep the saturated version.
    const INKS = ["#F58974", "#5FB9EF", "#F7CF57", "#5AD494"];
    // And taken the other way for the parchment panels — the handoff card and
    // the final table. Amber at board saturation on parchment is 1.3:1: the
    // name of whoever the phone is being passed to was invisible on their own
    // handoff card, and Cobalt and Verdant were not much better at 2.7.
    const DEEPS = ["#B32E1F", "#135C8E", "#7A5504", "#1B6B3A"];
    // The ink to print ON a player's own colour, which is a button fill. White
    // on Amber is 1.6:1 — "lay it" was a blank yellow lozenge.
    const ONS = ["#FFF7F2", "#04202F", "#2A1E03", "#03210E"];
    const NAMES = ["Crimson", "Cobalt", "Amber", "Verdant"];

    /* ---------------------------------------------------------------
     * Layout
     * ------------------------------------------------------------- */
    let W = ctx.width, H = ctx.height;
    const L = {};
    function measure() {
      W = ctx.width; H = ctx.height;
      // Width was the only thing the board was sized against, which is right
      // on a phone and wrong on the short card the app embeds a bit in: the
      // lane and its numbers then ran down into the action row and the score
      // line, and "tap a tile to claim it" printed across the tiles it was
      // talking about. Take the bottom chrome first and give the board what is
      // left. Everything under the grid is a fixed multiple of the cell, so
      // the whole stack ends at H/2 + 0.858*grid and the cap falls out of it.
      const bandH = ctx.safeArea.bottom + 76;   // score line + action row + a gap
      L.grid = Math.min(W - 44, 312, (H / 2 - bandH) / 0.858);
      L.cell = L.grid / 5;
      L.gx = (W - L.grid) / 2;
      // Biased upward. The stack below the kingdom is taller than the one
      // above it — lane, tile numbers, action row, scores — so centring the
      // grid on the screen pushes the lane's numbers under the buttons.
      L.gy = (H - L.grid) / 2 - L.cell * 0.75;
      // The shared lane sits below the kingdom, belonging to neither end.
      L.laneY = L.gy + L.grid + L.cell * 0.52;
      L.laneW = Math.min(W - 34, 340);
      L.laneX = (W - L.laneW) / 2;
      L.tileW = L.cell * 0.86;
      placeChrome();
    }
    // Filled in once the overlay exists; measure() runs before that.
    let placeChrome = () => {};
    measure();

    const canvas = ctx.createCanvas2D({ touchAction: "none" });
    const g = canvas.getContext("2d");

    /* ---------------------------------------------------------------
     * Terrain art. Every square is drawn, not blitted — six terrains,
     * each with its own marks so a colour-blind player can still read
     * the board.
     * ------------------------------------------------------------- */
    function terrainSquare(gg, t, x, y, s, crowns) {
      const spec = T[t];
      if (!spec) {                                   // the castle
        gg.fillStyle = "#6B4A2E";
        gg.fillRect(x, y, s, s);
        gg.fillStyle = "#8A6540";
        gg.fillRect(x + s * 0.16, y + s * 0.30, s * 0.68, s * 0.54);
        gg.fillStyle = RED;
        gg.beginPath();
        gg.moveTo(x + s * 0.10, y + s * 0.34);
        gg.lineTo(x + s * 0.50, y + s * 0.10);
        gg.lineTo(x + s * 0.90, y + s * 0.34);
        gg.closePath(); gg.fill();
        gg.fillStyle = GOLD;
        gg.fillRect(x + s * 0.42, y + s * 0.46, s * 0.16, s * 0.24);
        return;
      }
      gg.fillStyle = spec.base;
      gg.fillRect(x, y, s, s);
      gg.save();
      gg.beginPath(); gg.rect(x, y, s, s); gg.clip();
      gg.fillStyle = spec.dark;
      const u = s / 10;
      if (t === "forest") {
        for (let i = 0; i < 5; i++) {
          const tx = x + s * (0.18 + (i % 3) * 0.30), ty = y + s * (0.28 + Math.floor(i / 3) * 0.36);
          gg.beginPath();
          gg.moveTo(tx, ty - u * 1.9); gg.lineTo(tx + u * 1.3, ty + u * 1.2);
          gg.lineTo(tx - u * 1.3, ty + u * 1.2);
          gg.closePath(); gg.fill();
        }
      } else if (t === "wheat") {
        for (let i = 0; i < 6; i++) {
          gg.fillRect(x + s * (0.12 + i * 0.14), y + s * 0.22, u * 0.5, s * 0.56);
        }
      } else if (t === "lake") {
        gg.globalAlpha = 0.5;
        for (let i = 0; i < 4; i++) {
          gg.beginPath();
          const wy = y + s * (0.24 + i * 0.19);
          gg.moveTo(x, wy);
          gg.quadraticCurveTo(x + s * 0.25, wy - u, x + s * 0.5, wy);
          gg.quadraticCurveTo(x + s * 0.75, wy + u, x + s, wy);
          gg.lineWidth = u * 0.55; gg.strokeStyle = spec.dark; gg.stroke();
        }
        gg.globalAlpha = 1;
      } else if (t === "grass") {
        for (let i = 0; i < 7; i++) {
          const gx = x + s * (0.10 + (i % 4) * 0.26), gy2 = y + s * (0.34 + Math.floor(i / 4) * 0.34);
          gg.beginPath();
          gg.moveTo(gx, gy2 + u); gg.quadraticCurveTo(gx + u * 0.4, gy2 - u * 0.9, gx + u * 1.1, gy2 - u * 1.4);
          gg.lineWidth = u * 0.45; gg.strokeStyle = spec.dark; gg.stroke();
        }
      } else if (t === "swamp") {
        gg.globalAlpha = 0.62;
        for (let i = 0; i < 4; i++) {
          gg.beginPath();
          gg.ellipse(x + s * (0.26 + (i % 2) * 0.44), y + s * (0.30 + Math.floor(i / 2) * 0.38),
                     u * 1.5, u * 0.85, 0, 0, Math.PI * 2);
          gg.fill();
        }
        gg.globalAlpha = 1;
      } else if (t === "mine") {
        gg.fillStyle = "#4A423B";
        for (let i = 0; i < 3; i++) {
          const mx = x + s * (0.26 + i * 0.24), my = y + s * (0.40 + (i % 2) * 0.22);
          gg.beginPath();
          gg.moveTo(mx, my - u * 1.1); gg.lineTo(mx + u, my); gg.lineTo(mx, my + u * 1.1);
          gg.lineTo(mx - u, my); gg.closePath(); gg.fill();
        }
      }
      gg.restore();

      // Crowns, stacked along the top of the square.
      for (let i = 0; i < (crowns || 0); i++) {
        crown(gg, x + s * (0.22 + i * 0.26), y + s * 0.20, s * 0.19);
      }
    }

    function crown(gg, cx, cy, r) {
      gg.save();
      gg.translate(cx, cy);
      gg.fillStyle = GOLD;
      gg.strokeStyle = KEYLINE;
      gg.lineWidth = Math.max(0.8, r * 0.16);
      gg.beginPath();
      gg.moveTo(-r, r * 0.55);
      gg.lineTo(-r, -r * 0.35);
      gg.lineTo(-r * 0.42, r * 0.10);
      gg.lineTo(0, -r * 0.70);
      gg.lineTo(r * 0.42, r * 0.10);
      gg.lineTo(r, -r * 0.35);
      gg.lineTo(r, r * 0.55);
      gg.closePath();
      gg.fill(); gg.stroke();
      gg.restore();
    }

    /* ---------------------------------------------------------------
     * Game state
     * ------------------------------------------------------------- */
    let players = [], kings = [], deck = [], lane = [], nextLane = [];
    let order = [], turn = 0, phase = "setup", round = 0, totalRounds = 0;
    let pick = null;                 // { x, y, dir } the placement being aimed
    let flip = 0;                    // 0 or PI — which way the world faces
    let pendingFlip = null, results = null;

    function startGame(n) {
      players = [];
      for (let i = 0; i < n; i++) {
        players.push({
          name: NAMES[i], colour: COLOURS[i], ink: INKS[i], deep: DEEPS[i], on: ONS[i],
          side: i % 2,                       // alternate the two long edges
          kingdom: newKingdom(), score: 0,
        });
      }
      // Two players get two kings each, which is how the real game keeps the
      // lane four wide and the draft tense with only two people.
      kings = [];
      const perPlayer = n === 2 ? 2 : 1;
      for (let k = 0; k < perPlayer; k++) for (let i = 0; i < n; i++) kings.push({ p: i });

      deck = shuffle(buildDeck());
      // Use only as many tiles as divide evenly into whole rounds.
      totalRounds = Math.floor((n === 2 ? 24 : n === 3 ? 36 : 48) / kings.length);
      deck = deck.slice(0, totalRounds * kings.length);

      lane = drawLane();
      // Round one has nothing to place, so the claim order is simply random.
      order = shuffle(kings.map((_, i) => i));
      lane.forEach((slot, i) => { slot.king = order[i]; });
      round = 1;
      nextLane = drawLane();
      order = laneOrder(lane);
      turn = 0;
      phase = "claim";                       // round one: claim only
      pick = null;
      results = null;
      setFlipFor(currentPlayer(), true);
    }

    function drawLane() {
      const out = [];
      for (let i = 0; i < kings.length && deck.length; i++) out.push({ tile: deck.pop(), king: null });
      out.sort((a, b) => a.tile.n - b.tile.n);
      return out;
    }
    /** Claim order for the next phase: whoever took the lowest tile goes first. */
    const laneOrder = (l) => l.filter((s) => s.king !== null).map((s) => s.king);

    const currentKing = () => order[turn];
    const currentPlayer = () => players[kings[currentKing()].p];
    const claimedSlot = () => lane.find((s) => s.king === currentKing()) || null;

    /* --- the 180 degree world flip, hidden behind a handoff card --- */
    function setFlipFor(p, instant) {
      const want = p.side === 1 ? Math.PI : 0;
      if (want === flip) return false;
      if (instant) { flip = want; return false; }
      pendingFlip = want;
      return true;
    }

    /* ---------------------------------------------------------------
     * Turn flow
     * ------------------------------------------------------------- */
    function claim(slotIndex) {
      const slot = nextLane[slotIndex];
      if (!slot || slot.king !== null || phase !== "claim") return;
      slot.king = currentKing();
      sound.sting("coin");
      sound.haptic("medium");
      ctx.platform.interact({ type: "claim", n: slot.tile.n });
      advance();
    }

    function commitPlace() {
      if (phase !== "place" || !pick) return;
      const slot = claimedSlot();
      const p = currentPlayer();
      place(p.kingdom, slot.tile, pick.x, pick.y, pick.dir);
      slot.done = true;
      pick = null;
      sound.sting("tap");
      sound.haptic("light");
      ctx.platform.interact({ type: "place" });
      // Placing is always followed by claiming, except in the final round
      // when there is nothing left to claim.
      phase = nextLane.length ? "claim" : "placeDone";
      if (phase === "placeDone") advance();
      else paintHud();
    }

    /** The claimed tile cannot be placed anywhere legal — it is discarded. */
    function discard() {
      const slot = claimedSlot();
      if (slot) slot.done = true;
      pick = null;
      sound.sting("fail");
      sound.haptic("warning");
      phase = nextLane.length ? "claim" : "placeDone";
      if (phase === "placeDone") advance();
      else paintHud();
    }

    function advance() {
      turn++;
      if (turn < order.length) return beginTurn();
      // The round is over. Whatever was claimed this round becomes next
      // round's lane, and the claim order comes with it.
      round++;
      lane = nextLane;
      nextLane = deck.length ? drawLane() : [];
      order = laneOrder(lane);
      turn = 0;
      if (!order.length) return finish();
      beginTurn();
    }

    function beginTurn() {
      const p = currentPlayer();
      const slot = claimedSlot();
      phase = slot && !slot.done ? "place" : "claim";
      pick = null;
      if (phase === "place") {
        const opts = legalPlacements(p.kingdom, slot.tile);
        if (!opts.length) return discard();       // nowhere legal: it is lost
        pick = opts[0];
      }
      // The flip is always hidden behind the handoff card, so nobody watches
      // the board spin.
      const flipping = setFlipFor(p, false);
      showHandoff(p, flipping);
    }

    async function finish() {
      phase = "over";
      results = players.map((p, i) => ({ i, p, s: scoreKingdom(p.kingdom) }))
        .sort((a, b) => b.s.total - a.s.total || b.s.parts.length - a.s.parts.length);
      for (const r of results) r.p.score = r.s.total;
      sound.duck(0.5, 420); sound.sting("win"); sound.haptic("success");
      showResults();
      ctx.platform.complete({ players: players.length, top: results[0].s.total });
      // The best kingdom built at this table, which is a property of the game
      // rather than of one of the people around it.
      try { await ctx.memory.record("best_kingdom").submit(results[0].s.total,
        { label: results[0].s.total + " pts" }); } catch (_) {}
    }

    /* ---------------------------------------------------------------
     * Painting
     * ------------------------------------------------------------- */
    function paint() {
      const grad = g.createLinearGradient(0, 0, 0, H);
      grad.addColorStop(0, "#0F2C3D");
      grad.addColorStop(1, "#07161F");
      g.fillStyle = grad;
      g.fillRect(0, 0, W, H);
      if (phase === "setup") return;

      g.save();
      // One world layer, rotated about the centre of the screen.
      g.translate(W / 2, H / 2);
      g.rotate(flip);
      g.translate(-W / 2, -H / 2);

      const p = currentPlayer();
      drawKingdom(p);
      drawLaneStrip();
      g.restore();
    }

    /**
     * The top-left corner of the five-by-five window on screen.
     *
     * It has to cover the tile being AIMED as well as the kingdom already
     * laid, or a placement reaching outward gets drawn past the edge of the
     * grid and over whatever is underneath. One function, used by the board,
     * the ghost and the hit test, so all three always agree.
     */
    function viewOrigin(k, aim) {
      let x0 = k.minX, x1 = k.maxX, y0 = k.minY, y1 = k.maxY;
      if (aim) {
        const cells = [[aim.x, aim.y], [aim.x + DIRS[aim.dir][0], aim.y + DIRS[aim.dir][1]]];
        for (const [x, y] of cells) {
          x0 = Math.min(x0, x); x1 = Math.max(x1, x);
          y0 = Math.min(y0, y); y1 = Math.max(y1, y);
        }
      }
      // Both spans are at most five wide, so anchoring at the low corner is
      // always enough to contain the high one.
      return { x: x0, y: y0 };
    }

    function drawKingdom(p) {
      const k = p.kingdom;
      const aim = phase === "place" ? pick : null;
      const o = viewOrigin(k, aim);
      const originX = o.x, originY = o.y;

      g.strokeStyle = "rgba(243,228,192,0.16)";
      g.lineWidth = 1;
      for (let cx = 0; cx < 5; cx++) {
        for (let cy = 0; cy < 5; cy++) {
          const x = L.gx + cx * L.cell, y = L.gy + cy * L.cell;
          const cell = at(k, originX + cx, originY + cy);
          if (cell) terrainSquare(g, cell.t, x, y, L.cell, cell.c);
          else { g.fillStyle = "rgba(164,219,240,0.05)"; g.fillRect(x, y, L.cell, L.cell); }
          g.strokeRect(x + 0.5, y + 0.5, L.cell - 1, L.cell - 1);
        }
      }

      // The tile being aimed, drawn as a ghost over the grid.
      if (phase === "place" && pick) {
        const slot = claimedSlot();
        const cells = [[pick.x, pick.y, slot.tile.a], [pick.x + DIRS[pick.dir][0], pick.y + DIRS[pick.dir][1], slot.tile.b]];
        g.globalAlpha = 0.92;
        for (const [x, y, half] of cells) {
          const sx = L.gx + (x - originX) * L.cell, sy = L.gy + (y - originY) * L.cell;
          terrainSquare(g, half.t, sx, sy, L.cell, half.c);
          g.strokeStyle = GOLD; g.lineWidth = 3;
          g.strokeRect(sx + 1.5, sy + 1.5, L.cell - 3, L.cell - 3);
        }
        g.globalAlpha = 1;
      }

      // A gold frame in the active player's colour.
      g.strokeStyle = p.colour;
      g.lineWidth = 3;
      g.strokeRect(L.gx - 4.5, L.gy - 4.5, L.grid + 9, L.grid + 9);
    }

    /** The shared lane: what is still on offer, and who has taken what. */
    function drawLaneStrip() {
      const list = phase === "claim" ? nextLane : lane;
      if (!list.length) return;
      const n = list.length;
      const slotW = L.laneW / n;
      const tw = Math.min(slotW - 8, L.tileW);
      for (let i = 0; i < n; i++) {
        const slot = list[i];
        const cx = L.laneX + slotW * (i + 0.5);
        const x = cx - tw / 2, y = L.laneY;
        terrainSquare(g, slot.tile.a.t, x, y, tw, slot.tile.a.c);
        terrainSquare(g, slot.tile.b.t, x, y + tw, tw, slot.tile.b.c);
        g.strokeStyle = KEYLINE; g.lineWidth = 1.6;
        g.strokeRect(x + 0.5, y + 0.5, tw - 1, tw * 2 - 1);
        // Its number, which is the whole reason to take a weaker tile early.
        g.fillStyle = PARCH;
        g.font = "700 " + (tw * 0.30) + "px Inter,-apple-system,system-ui,'Segoe UI',Roboto,sans-serif";
        g.textAlign = "center"; g.textBaseline = "top";
        g.fillText(String(slot.tile.n), cx, y + tw * 2 + 4);
        // A claimed tile wears its owner's colour and is out of the running.
        if (slot.king !== null) {
          const owner = players[kings[slot.king].p];
          g.fillStyle = "rgba(8,20,28,0.62)";
          g.fillRect(x, y, tw, tw * 2);
          g.fillStyle = owner.colour;
          g.beginPath();
          g.arc(cx, y + tw, tw * 0.26, 0, Math.PI * 2);
          g.fill();
          g.strokeStyle = KEYLINE; g.lineWidth = 1.5; g.stroke();
        } else if (phase === "claim") {
          g.strokeStyle = GOLD; g.lineWidth = 2;
          g.strokeRect(x - 2, y - 2, tw + 4, tw * 2 + 4);
        }
      }
    }

    /** Screen point to a lane slot index, in world (un-flipped) space. */
    function laneHit(px, py) {
      const list = phase === "claim" ? nextLane : lane;
      if (!list.length) return -1;
      const n = list.length, slotW = L.laneW / n, tw = Math.min(slotW - 8, L.tileW);
      if (py < L.laneY - 6 || py > L.laneY + tw * 2 + 6) return -1;
      const i = Math.floor((px - L.laneX) / slotW);
      return i >= 0 && i < n ? i : -1;
    }

    /** Screen point to a kingdom cell, in world space. */
    function gridHit(px, py) {
      const cx = Math.floor((px - L.gx) / L.cell), cy = Math.floor((py - L.gy) / L.cell);
      if (cx < 0 || cx > 4 || cy < 0 || cy > 4) return null;
      const k = currentPlayer().kingdom;
      const o = viewOrigin(k, phase === "place" ? pick : null);
      return { x: o.x + cx, y: o.y + cy };
    }

    /** Undo the world rotation so a tap lands where the player sees it. */
    function toWorld(px, py) {
      if (flip === 0) return { x: px, y: py };
      return { x: W - px, y: H - py };
    }

    /* ---------------------------------------------------------------
     * Overlay
     * ------------------------------------------------------------- */
    const FONT = "Inter,-apple-system,system-ui,'Segoe UI',Roboto,sans-serif";
    const ST = ctx.safeArea.top, SB = ctx.safeArea.bottom;
    const PANEL = "background:" + PARCH + ";color:#3A2314;border-radius:16px;" +
      "box-shadow:0 6px 22px rgba(0,0,0,0.45);";
    const BIG = "width:100%;padding:14px;border:none;border-radius:14px;font-family:inherit;" +
      "font-size:16px;font-weight:800;letter-spacing:0.02em;";
    const BTN = "pointer-events:auto;width:34px;height:34px;border-radius:11px;border:none;" +
      "background:rgba(243,228,192,0.16);color:" + PARCH + ";font-size:14px;font-family:inherit;padding:0;";

    const root = ctx.createRoot({ touchAction: "none" });
    root.style.cssText += ";font-family:" + FONT + ";color:" + PARCH + ";pointer-events:none;text-transform:lowercase;";

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
      // Each end's HUD, the far one turned to face its own player.
      '<div data-el="hud-1" style="position:absolute;left:0;right:0;top:' + (ST + 8) + 'px;' +
        'transform:rotate(180deg);text-align:center;pointer-events:none;"></div>' +
      '<div data-el="hud-0" style="position:absolute;left:0;right:0;bottom:' + (SB + 8) + 'px;' +
        'text-align:center;pointer-events:none;"></div>' +
      // The one control the active player needs, at their own end.
      '<div data-el="act-1" style="position:absolute;left:0;right:0;top:' + (ST + 40) + 'px;' +
        'transform:rotate(180deg);display:flex;gap:8px;justify-content:center;pointer-events:none;"></div>' +
      '<div data-el="act-0" style="position:absolute;left:0;right:0;bottom:' + (SB + 40) + 'px;' +
        'display:flex;gap:8px;justify-content:center;pointer-events:none;"></div>' +
      // Chrome goes in the empty band between the far player's controls and
      // the top of the kingdom. Down the side it would clip the grid, which
      // starts 39px in on a 390px screen.
      '<div data-el="chrome" style="position:absolute;left:9px;top:' + (ST + 96) + 'px;display:flex;' +
        'gap:6px;z-index:40;pointer-events:none;">' +
        '<button data-el="mute" aria-label="Sound" style="' + BTN + '">' + SPK(true) + '</button>' +
        '<button data-el="help" aria-label="How to play" style="' + BTN + '">?</button>' +
      '</div>' +
      // The handoff card. It covers the flip, so nobody watches the board spin.
      '<div data-el="hand" style="position:absolute;inset:0;pointer-events:auto;display:none;' +
        'align-items:center;justify-content:center;background:rgba(7,22,31,0.96);z-index:60;">' +
        '<div data-el="hand-inner" style="' + PANEL + 'padding:26px 30px;text-align:center;max-width:280px;">' +
          '<div style="font-size:11px;letter-spacing:0.28em;text-transform:lowercase;opacity:0.55;">Round ' +
            '<span data-el="hand-round">1</span></div>' +
          '<div data-el="hand-name" style="font-size:34px;font-weight:900;margin:6px 0 2px;"></div>' +
          '<div data-el="hand-what" style="font-size:14px;opacity:0.7;"></div>' +
          '<button data-el="hand-go" style="' + BIG + 'margin-top:20px;background:#3A2314;color:' +
            PARCH + ';">Ready</button>' +
        '</div>' +
      '</div>' +
      '<div data-el="menu" style="position:absolute;inset:0;pointer-events:auto;display:flex;' +
        'flex-direction:column;align-items:center;justify-content:center;gap:10px;' +
        'background:rgba(7,22,31,0.94);z-index:50;padding:26px;text-align:center;">' +
        '<div style="font-size:11px;letter-spacing:0.4em;text-transform:lowercase;opacity:0.5;">Lay the phone flat</div>' +
        '<div style="font-size:52px;font-weight:900;letter-spacing:-0.02em;line-height:1.05;color:' + GOLD + ';">Crownlands</div>' +
        '<div style="font-size:14.5px;opacity:0.68;max-width:280px;line-height:1.55;">' +
          'Draft land from the shared lane and lay it into your own five-by-five kingdom. ' +
          'Land only scores where crowns stand on it.</div>' +
        '<div style="font-size:11px;letter-spacing:0.22em;text-transform:lowercase;opacity:0.5;margin-top:14px;">Players</div>' +
        '<div data-el="pc" style="display:flex;gap:8px;"></div>' +
        '<button data-el="go" style="' + BIG + 'max-width:230px;margin-top:16px;background:' + GOLD + ';color:#3A2314;">Begin</button>' +
      '</div>' +
      '<div data-el="over" style="position:absolute;inset:0;pointer-events:auto;display:none;' +
        'align-items:center;justify-content:center;background:rgba(7,22,31,0.95);z-index:65;padding:22px;">' +
        '<div style="max-width:330px;width:100%;' + PANEL + 'padding:22px;">' +
          '<div style="font-size:11px;letter-spacing:0.28em;text-transform:lowercase;opacity:0.55;">Final</div>' +
          '<div data-el="over-body"></div>' +
          '<button data-el="again" style="' + BIG + 'margin-top:16px;background:#3A2314;color:' + PARCH + ';">Play again</button>' +
        '</div>' +
      '</div>' +
      '<div data-el="helpp" style="position:absolute;inset:0;pointer-events:auto;display:none;' +
        'align-items:center;justify-content:center;background:rgba(7,22,31,0.95);z-index:70;padding:22px;">' +
        '<div style="max-width:330px;width:100%;' + PANEL + 'padding:22px;">' +
          '<div style="font-size:19px;font-weight:800;margin-bottom:10px;">How to play</div>' +
          '<ul style="font-size:14px;line-height:1.7;padding-left:18px;margin:0;">' +
            '<li>Phone flat on the table. Nothing is hidden — nobody picks it up.</li>' +
            '<li>On your turn, lay the tile you claimed last round into your kingdom, then claim a new one.</li>' +
            '<li>A tile must touch your castle, or land matching one of its own halves. Only <b>one</b> half has to match.</li>' +
            '<li>Your kingdom can never grow past five squares across or down.</li>' +
            '<li>Taking a low-numbered tile means going earlier next round. High tiles carry the crowns.</li>' +
            '<li>Each connected stretch of land scores <b>its size times its crowns</b>. No crowns, no points.</li>' +
            '<li>+10 if your castle ends up dead centre, +5 for filling all twenty-five squares.</li>' +
          '</ul>' +
          '<button data-el="helpp-close" style="' + BIG + 'margin-top:16px;background:#3A2314;color:' + PARCH + ';">Got it</button>' +
        '</div>' +
      '</div>';

    const el = (n) => root.querySelector('[data-el="' + n + '"]');
    const tap = (node, fn) => {
      if (!node) return;
      ctx.listen(node, "pointerdown", (e) => e.stopPropagation());
      ctx.listen(node, "click", (e) => { e.stopPropagation(); e.preventDefault(); fn(e); });
    };
    /* The chrome sits in the band between the far player's controls and the
     * top of the kingdom. That band exists on a phone and not on the short
     * card, where the fixed 96px offset put both buttons inside the board.
     * Park them just above whatever the grid turned out to be. */
    placeChrome = () => {
      const c = el("chrome");
      if (c) c.style.top = Math.min(ST + 96, Math.max(ST + 8, L.gy - 42)) + "px";
    };
    placeChrome();

    /* Every full-screen sheet is painted over the chrome, so the buttons
     * showed through the title's 94% scrim as two grey ghosts and the word
     * "crownlands" was set straight across them. Nothing under a sheet is
     * reachable anyway — take them out of the picture while one is up. */
    const sheets = ["menu", "hand", "over", "helpp"];
    const syncChrome = () => {
      const covered = sheets.some((n) => {
        const s = el(n);
        return s && s.style.display !== "none";
      });
      el("chrome").style.visibility = covered ? "hidden" : "visible";
    };
    syncChrome();

    tap(el("mute"), (e) => { e.target.innerHTML = SPK(!sound.toggle()); });
    if (settings.mute) el("mute").innerHTML = SPK(false);
    tap(el("help"), () => { el("helpp").style.display = "flex"; syncChrome(); });
    tap(el("helpp-close"), () => { el("helpp").style.display = "none"; syncChrome(); });

    function pills(host, values, labels, get, set) {
      host.innerHTML = values.map((v, i) =>
        '<button data-v="' + v + '" style="width:56px;padding:12px 0;border:none;border-radius:13px;' +
        'font-family:inherit;font-size:16px;font-weight:800;">' + labels[i] + '</button>').join("");
      const paint2 = () => {
        for (const b of host.querySelectorAll("button")) {
          const on = String(get()) === b.dataset.v;
          b.style.background = on ? GOLD : "rgba(243,228,192,0.12)";
          b.style.color = on ? "#3A2314" : "rgba(243,228,192,0.6)";
        }
      };
      for (const b of host.querySelectorAll("button")) {
        tap(b, () => { set(b.dataset.v); saveSettings(); paint2(); sound.haptic("light"); });
      }
      paint2();
    }
    pills(el("pc"), [2, 3, 4], ["2", "3", "4"], () => settings.players,
          (v) => { settings.players = Number(v); });

    function showHandoff(p, flipping) {
      el("hand-round").textContent = round + " of " + totalRounds;
      el("hand-name").textContent = p.name;
      el("hand-name").style.color = p.deep;
      el("hand-what").textContent = phase === "place" ? "lay your tile, then claim" : "claim a tile";
      el("hand-inner").style.transform = p.side === 1 ? "rotate(180deg)" : "none";
      el("hand").style.display = "flex";
      syncChrome();
      // The flip happens while the card covers the screen.
      if (flipping) ctx.timeout(() => { flip = pendingFlip; pendingFlip = null; }, 120);
    }
    tap(el("hand-go"), () => {
      el("hand").style.display = "none";
      syncChrome();
      if (pendingFlip !== null) { flip = pendingFlip; pendingFlip = null; }
      paintHud();
    });

    /** Each end shows its own player's running score; the active end also
     * gets whatever control this phase needs. */
    function paintHud() {
      for (const side of [0, 1]) {
        const mine = players.filter((p) => p.side === side);
        el("hud-" + side).innerHTML = mine.map((p) => {
          const s = scoreKingdom(p.kingdom);
          const live = p === currentPlayer() && phase !== "over";
          return '<span style="display:inline-block;margin:0 7px;font-size:14px;font-weight:800;' +
            'color:' + p.ink + ';opacity:' + (live ? 1 : 0.8) + ';">' +
            esc(p.name) + ' <span style="color:' + PARCH + ';">' + s.total + '</span></span>';
        }).join("");
        el("act-" + side).innerHTML = "";
      }
      if (phase === "over" || phase === "setup") return;

      const p = currentPlayer();
      const host = el("act-" + p.side);
      if (phase === "place") {
        host.innerHTML =
          '<button data-el="rot" style="pointer-events:auto;padding:11px 16px;border:none;' +
            'border-radius:12px;background:rgba(243,228,192,0.16);color:' + PARCH + ';' +
            'font-family:inherit;font-size:14px;font-weight:700;">Turn</button>' +
          '<button data-el="ok" style="pointer-events:auto;padding:11px 22px;border:none;' +
            'border-radius:12px;background:' + p.colour + ';color:' + p.on + ';font-family:inherit;' +
            'font-size:14px;font-weight:800;">Lay it</button>';
        tap(host.querySelector('[data-el="rot"]'), rotatePick);
        tap(host.querySelector('[data-el="ok"]'), commitPlace);
      } else if (phase === "claim") {
        host.innerHTML = '<span style="font-size:13px;letter-spacing:0.16em;text-transform:lowercase;' +
          'opacity:0.7;">Tap a tile to claim it</span>';
      }
    }

    /**
     * Cycle to the next legal placement that keeps the same anchor square if
     * one exists, otherwise the next legal placement anywhere. Offering only
     * legal options means a player can never aim at something that will be
     * refused.
     */
    function rotatePick() {
      const slot = claimedSlot();
      if (!slot) return;
      const opts = legalPlacements(currentPlayer().kingdom, slot.tile);
      if (!opts.length) return;
      const i = opts.findIndex((o) => o.x === pick.x && o.y === pick.y && o.dir === pick.dir);
      pick = opts[(i + 1) % opts.length];
      sound.haptic("light");
    }

    function showResults() {
      el("over-body").innerHTML = results.map((r, n) =>
        '<div style="display:flex;justify-content:space-between;align-items:baseline;gap:10px;' +
          'padding:9px 0;border-bottom:1px solid rgba(58,35,20,0.14);">' +
          '<span style="font-size:16px;font-weight:800;color:' + r.p.deep + ';">' +
            (n + 1) + '. ' + esc(r.p.name) + '</span>' +
          '<span style="font-size:13px;opacity:0.6;">' +
            r.s.parts.length + ' crowned ' + (r.s.parts.length === 1 ? "region" : "regions") +
            (r.s.bonus ? ' · +' + r.s.bonus : '') + '</span>' +
          '<span style="font-size:20px;font-weight:900;">' + r.s.total + '</span>' +
        '</div>').join("");
      el("over").style.display = "flex";
      syncChrome();
    }

    const begin = async () => {
      ctx.platform.start();
      await sound.unlock();
      el("menu").style.display = "none";
      el("over").style.display = "none";
      syncChrome();
      startGame(settings.players);
      paintHud();
      sound.sting("coin");
    };
    tap(el("go"), begin);
    tap(el("again"), begin);

    /* ---------------------------------------------------------------
     * Input
     * ------------------------------------------------------------- */
    ctx.listen(canvas, "pointerdown", (e) => {
      if (phase === "setup" || phase === "over") return;
      if (el("hand").style.display === "flex") return;
      const w = toWorld(e.offsetX, e.offsetY);

      if (phase === "claim") {
        const i = laneHit(w.x, w.y);
        if (i >= 0) claim(i);
        e.preventDefault();
        return;
      }
      if (phase === "place") {
        const cell = gridHit(w.x, w.y);
        if (!cell) return;
        // Snap to the legal placement nearest the tap, so a finger landing
        // anywhere sensible finds the move the player meant.
        const slot = claimedSlot();
        const opts = legalPlacements(currentPlayer().kingdom, slot.tile);
        let best = null, bestD = 1e9;
        for (const o of opts) {
          const mx = o.x + DIRS[o.dir][0] * 0.5, my = o.y + DIRS[o.dir][1] * 0.5;
          const d = Math.hypot(mx - cell.x, my - cell.y);
          if (d < bestD) { bestD = d; best = o; }
        }
        if (best && bestD < 2.2) {
          // Tapping the same spot again turns the tile rather than doing nothing.
          if (pick && pick.x === best.x && pick.y === best.y && pick.dir === best.dir) rotatePick();
          else { pick = best; sound.haptic("light"); }
        }
        e.preventDefault();
      }
    }, { passive: false });

    ctx.onFrame(() => paint());
    ctx.listen(window, "resize", () => {
      if (ctx.width === W && ctx.height === H) return;
      measure();
    });

    // A read-only window for the local harness.
    window.__CROWN__ = {
      get phase() { return phase; },
      get round() { return round; },
      get totalRounds() { return totalRounds; },
      get turnPlayer() { return phase === "setup" || phase === "over" ? -1 : kings[currentKing()].p; },
      get lane() { return lane.map((s) => ({ n: s.tile.n, king: s.king, done: !!s.done })); },
      get nextLane() { return nextLane.map((s) => ({ n: s.tile.n, king: s.king })); },
      get scores() { return players.map((p) => scoreKingdom(p.kingdom).total); },
      get cells() { return players.map((p) => Object.keys(p.kingdom.cells).length); },
      get handoffUp() { return el("hand").style.display === "flex"; },
      get pick() { return pick; },
      dismissHandoff: () => { const b = el("hand-go"); if (b) b.click(); },
      claimIndex: (i) => claim(i),
      layIt: () => commitPlace(),
    };
    ctx.onDestroy(() => { try { delete window.__CROWN__; } catch (_) {} });

    paint();
    ctx.markVisualReady("table set");
    ctx.platform.ready();
  },
};
