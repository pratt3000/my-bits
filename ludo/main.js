/**
 * Ludo — two to four players, one phone, flat on the table.
 *
 * Ludo has no hidden information at all: every roll and every token is public
 * by definition. That single fact shapes the whole adaptation. There is no
 * pass-the-phone step, no privacy screen, no peeking — the phone goes down in
 * the middle and nobody ever picks it up. The setup screen says so, because it
 * is this game's biggest advantage over most things you can play on one
 * device.
 *
 * The board is radially symmetric, so unlike a chess board it reads correctly
 * from every side and must NOT be rotated per player. Only the text and the
 * controls rotate: each seat's plate is anchored by casting a ray from the
 * board's centre along that seat's sector bisector out to the screen edge, and
 * turned so its "up" points away from the board. A player at the top of the
 * phone therefore reads text that is upside down to the player at the bottom,
 * which is exactly right.
 *
 * Turns are strictly sequential, so only one control set is ever live and the
 * input zones cannot collide — the opposite of the simultaneous-play bits in
 * this repo, and much easier for it.
 *
 * The rules are the full ones, not the friendly subset: entry only on a six,
 * an extra roll for a six and for a capture and for coming home, three sixes
 * in a turn voiding the third roll, immunity on the eight safe squares,
 * blockades that stop an opponent passing, and an exact count required to come
 * home.
 *
 * Contract notes: no packaged assets (maxAssets is 0), so the board is painted
 * into an OffscreenCanvas at boot. The overlay is markup on ctx.createRoot()
 * with pointer-events off, because that element sits above the canvas and will
 * otherwise swallow every tap. Pointer maths uses offsetX/offsetY.
 */
window.plethoraBit = {
  meta: {
    title: "Ludo",
    runtime: "plethora-bit@2",
    tags: ["multiplayer", "local-multiplayer", "board", "dice", "party", "classic"],
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
    const THREE = await ctx.importModule("three", "0.164.1");

/* ===== RULES START ===== */
    /**
     * The ring, measured cell by cell off a real board: all 52 track squares
     * in clockwise order, starting at Red's start square. Every path in the
     * game is an offset into this one array.
     */
    const RING = [
      [6,1],[6,2],[6,3],[6,4],[6,5],[5,6],[4,6],[3,6],[2,6],[1,6],[0,6],
      [0,7],[0,8],[1,8],[2,8],[3,8],[4,8],[5,8],[6,9],[6,10],[6,11],[6,12],
      [6,13],[6,14],[7,14],[8,14],[8,13],[8,12],[8,11],[8,10],[8,9],[9,8],
      [10,8],[11,8],[12,8],[13,8],[14,8],[14,7],[14,6],[13,6],[12,6],[11,6],
      [10,6],[9,6],[8,5],[8,4],[8,3],[8,2],[8,1],[8,0],[7,0],[6,0],
    ];
    // The four starts sit exactly thirteen apart, and the eight safe squares
    // are those four plus the four stars.
    const SAFE = new Set([0, 8, 13, 21, 26, 34, 39, 47]);
    const STARS = [8, 21, 34, 47];

    /**
     * Seats. `start` is the ring index of that colour's start square; `home`
     * is its five-cell home column, walked from the branch point inward;
     * `yard` is where its idle tokens sit.
     */
    const SEATS = [
      { id: "red",    hex: 0xEB1C24, css: "#EB1C24", ink: "#FF6B6B", name: "Red",    start: 0,
        home: [[7,1],[7,2],[7,3],[7,4],[7,5]],       yard: [0, 0], corner: [-1, -1] },
      { id: "green",  hex: 0x039F4B, css: "#039F4B", ink: "#35D07F", name: "Green",  start: 13,
        home: [[1,7],[2,7],[3,7],[4,7],[5,7]],       yard: [0, 9], corner: [ 1, -1] },
      { id: "yellow", hex: 0xF7C600, css: "#F7C600", ink: "#FFD429", name: "Yellow", start: 26,
        home: [[7,13],[7,12],[7,11],[7,10],[7,9]],   yard: [9, 9], corner: [ 1,  1] },
      { id: "blue",   hex: 0x24A5F6, css: "#24A5F6", ink: "#4FC3F7", name: "Blue",   start: 39,
        home: [[13,7],[12,7],[11,7],[10,7],[9,7]],   yard: [9, 0], corner: [-1,  1] },
    ];
    // Two players sit across the table, so they take diagonally opposite yards.
    const SEATS_FOR = { 2: [0, 2], 3: [0, 1, 2], 4: [0, 1, 2, 3] };

    /**
     * A token's position is one number, `p`.
     *   p = -1        still in the yard
     *   p = 0..50     on the ring, absolute cell = (start + p) mod 52
     *   p = 51..55    that seat's five home-column cells
     *   p = 56        HOME
     * Fifty-six pips from the start square to home, with the branch at p = 50.
     */
    const HOME_P = 56;

    /** Which board cell a token occupies, or null while it is in the yard. */
    function cellOf(seat, p) {
      if (p < 0 || p > 55) return null;
      if (p <= 50) return RING[(seat.start + p) % 52];
      return seat.home[p - 51];
    }
    /** Ring index, or -1 when the token is off the ring. Captures only happen here. */
    const ringIndexOf = (seat, p) => (p >= 0 && p <= 50 ? (seat.start + p) % 52 : -1);

    /**
     * Legal moves for a roll.
     *
     * Returns one entry per token that can legally move, so the UI can light
     * exactly those tokens and no others. A turn with an empty list is a
     * forfeited roll, which is a normal and frequent event in Ludo.
     */
    function legalMoves(game, seatIdx, roll) {
      const seat = SEATS[game.order[seatIdx]];
      const mine = game.tokens[seatIdx];
      const out = [];

      for (let t = 0; t < 4; t++) {
        const p = mine[t];
        if (p === HOME_P) continue;

        if (p < 0) {
          // A token leaves the yard only on a six, and only onto its own start.
          if (roll !== 6) continue;
          if (blockedAt(game, seatIdx, seat.start)) continue;
          out.push({ token: t, from: p, to: 0 });
          continue;
        }

        const np = p + roll;
        // Coming home needs an exact count; overshooting is not a legal move.
        if (np > HOME_P) continue;
        if (np <= 50 && passesBlock(game, seatIdx, p, np)) continue;
        out.push({ token: t, from: p, to: np });
      }
      return out;
    }

    /** Is `ring` held by two or more tokens of some OTHER seat? */
    function blockedAt(game, seatIdx, ring) {
      for (let s = 0; s < game.order.length; s++) {
        if (s === seatIdx) continue;
        const seat = SEATS[game.order[s]];
        let n = 0;
        for (const p of game.tokens[s]) if (ringIndexOf(seat, p) === ring) n++;
        if (n >= 2) return true;
      }
      return false;
    }

    /**
     * Does the path from p to np run into an opponent's blockade?
     *
     * Two or more tokens of one colour on a cell stop an opponent landing on
     * it AND passing through it. The soft variant, offered in settings, only
     * stops landing — which is the rule most people actually play at home.
     */
    function passesBlock(game, seatIdx, p, np) {
      const seat = SEATS[game.order[seatIdx]];
      const first = game.hardBlocks ? p + 1 : np;
      for (let q = first; q <= Math.min(np, 50); q++) {
        if (blockedAt(game, seatIdx, (seat.start + q) % 52)) return true;
      }
      return false;
    }

    /**
     * Apply a move. Returns what happened, because the caller needs to know
     * whether to grant another roll: a six, a capture, and coming home each
     * earn one, and they do not stack beyond one bonus roll.
     */
    function applyMove(game, seatIdx, move, roll) {
      const seat = SEATS[game.order[seatIdx]];
      game.tokens[seatIdx][move.token] = move.to;

      const captured = [];
      const landing = ringIndexOf(seat, move.to);
      // Capture is impossible on a safe square: a token there is immune and
      // the arriving token simply shares the cell.
      if (landing >= 0 && !SAFE.has(landing)) {
        for (let s = 0; s < game.order.length; s++) {
          if (s === seatIdx) continue;
          const other = SEATS[game.order[s]];
          for (let t = 0; t < 4; t++) {
            if (ringIndexOf(other, game.tokens[s][t]) === landing) {
              game.tokens[s][t] = -1;                  // back to the yard
              captured.push({ seat: s, token: t });
            }
          }
        }
      }
      return {
        captured,
        camehome: move.to === HOME_P,
        six: roll === 6,
        finished: game.tokens[seatIdx].every((p) => p === HOME_P),
      };
    }
/* ===== RULES END ===== */

    const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
    const TAU = Math.PI * 2;

    /* ---------------------------------------------------------------
     * Settings
     * ------------------------------------------------------------- */
    const saved = (function () {
      try { return ctx.storage.get("ludo") || {}; } catch (_) { return {}; }
    })();
    const settings = {
      players: clamp(saved.players || 4, 2, 4),
      hardBlocks: saved.hardBlocks !== false,
      mute: !!saved.mute,
    };
    function saveSettings() { try { ctx.storage.set("ludo", settings); } catch (_) {} }

    const sound = (function () {
      let muted = settings.mute, bed = null, unlocked = false;
      const start = () => ctx.music.play({ preset: "cozy", volume: 0.28, tempo: 102, intensity: 0.3 });
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

    /* ---------------------------------------------------------------
     * Board texture. Fifteen cells square, painted once.
     * ------------------------------------------------------------- */
    function surface(w, h) {
      if (typeof OffscreenCanvas === "undefined") return null;
      return new OffscreenCanvas(w, h);
    }

    const INK = "#2A3340";

    function star(g, cx, cy, r, colour) {
      g.beginPath();
      for (let i = 0; i < 10; i++) {
        const a = -Math.PI / 2 + (i / 10) * TAU;
        const rr = i % 2 ? r * 0.44 : r;
        g[i ? "lineTo" : "moveTo"](cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
      }
      g.closePath();
      g.fillStyle = colour;
      g.fill();
      g.strokeStyle = INK;
      g.lineWidth = r * 0.14;
      g.stroke();
    }

    /** An arrow pointing along the direction a colour's tokens turn for home. */
    function arrow(g, cx, cy, s, rot, colour) {
      g.save();
      g.translate(cx, cy);
      g.rotate(rot);
      g.beginPath();
      g.moveTo(0, -s * 0.34);
      g.lineTo(s * 0.30, 0);
      g.lineTo(0, s * 0.34);
      g.lineTo(0, s * 0.14);
      g.lineTo(-s * 0.30, s * 0.14);
      g.lineTo(-s * 0.30, -s * 0.14);
      g.lineTo(0, -s * 0.14);
      g.closePath();
      g.fillStyle = colour;
      g.fill();
      g.strokeStyle = INK;
      g.lineWidth = s * 0.05;
      g.stroke();
      g.restore();
    }

    function makeBoardTexture(active) {
      const C = 64, T = C * 15;
      const c = surface(T, T);
      if (!c) return null;
      const g = c.getContext("2d");
      const at = (r, col) => ({ x: col * C, y: r * C });
      const live = new Set(active.map((i) => SEATS[i].id));

      g.fillStyle = "#FFFFFF";
      g.fillRect(0, 0, T, T);

      // --- yards ---
      for (const seat of SEATS) {
        const [yr, yc] = seat.yard;
        const on = live.has(seat.id);
        const p = at(yr, yc);
        g.fillStyle = on ? seat.css : "#DCE2EA";
        g.fillRect(p.x, p.y, C * 6, C * 6);
        g.strokeStyle = INK; g.lineWidth = C * 0.09;
        g.strokeRect(p.x, p.y, C * 6, C * 6);
        // Inner white pad with the four resting circles.
        g.fillStyle = "#FFFFFF";
        g.fillRect(p.x + C * 0.85, p.y + C * 0.85, C * 4.3, C * 4.3);
        g.strokeStyle = INK; g.lineWidth = C * 0.055;
        g.strokeRect(p.x + C * 0.85, p.y + C * 0.85, C * 4.3, C * 4.3);
        for (let i = 0; i < 4; i++) {
          const dx = p.x + C * (i % 2 ? 3.6 : 1.75);
          const dy = p.y + C * (i > 1 ? 3.6 : 1.75);
          g.beginPath(); g.arc(dx, dy, C * 0.62, 0, TAU);
          g.fillStyle = on ? seat.css : "#C6CFDA"; g.fill();
          g.strokeStyle = INK; g.lineWidth = C * 0.055; g.stroke();
        }
      }

      // --- track ---
      for (let i = 0; i < 52; i++) {
        const [r, col] = RING[i];
        const p = at(r, col);
        const owner = SEATS.find((s) => s.start === i);
        g.fillStyle = owner && live.has(owner.id) ? owner.css : "#FFFFFF";
        g.fillRect(p.x, p.y, C, C);
        g.strokeStyle = INK; g.lineWidth = C * 0.055;
        g.strokeRect(p.x, p.y, C, C);
      }
      for (const i of STARS) {
        const [r, col] = RING[i];
        const p = at(r, col);
        star(g, p.x + C / 2, p.y + C / 2, C * 0.40, "#9AA6B4");
      }

      // --- home columns and the arrows that lead into them ---
      for (const seat of SEATS) {
        const on = live.has(seat.id);
        for (const [r, col] of seat.home) {
          const p = at(r, col);
          g.fillStyle = on ? seat.css : "#DCE2EA";
          g.fillRect(p.x, p.y, C, C);
          g.strokeStyle = INK; g.lineWidth = C * 0.055;
          g.strokeRect(p.x, p.y, C, C);
        }
        const [br, bc] = RING[(seat.start + 50) % 52];
        const [hr, hc] = seat.home[0];
        const p = at(br, bc);
        arrow(g, p.x + C / 2, p.y + C / 2, C,
              Math.atan2(hr - br, hc - bc), on ? seat.css : "#B8C2CE");
      }

      // --- centre: four triangles meeting at the exact middle ---
      const m = C * 7.5;
      for (const seat of SEATS) {
        const [hr, hc] = seat.home[4];          // innermost home cell
        const dr = Math.sign(7 - hr), dc = Math.sign(7 - hc);
        g.beginPath();
        g.moveTo(m, m);
        if (dc !== 0) {                         // triangle opens left or right
          g.lineTo(m + dc * C * 1.5, m - C * 1.5);
          g.lineTo(m + dc * C * 1.5, m + C * 1.5);
        } else {
          g.lineTo(m - C * 1.5, m + dr * C * 1.5);
          g.lineTo(m + C * 1.5, m + dr * C * 1.5);
        }
        g.closePath();
        g.fillStyle = live.has(seat.id) ? seat.css : "#DCE2EA";
        g.fill();
        g.strokeStyle = INK; g.lineWidth = C * 0.07;
        g.stroke();
      }
      g.strokeStyle = INK; g.lineWidth = C * 0.09;
      g.strokeRect(C * 6, C * 6, C * 3, C * 3);

      // --- outer rule ---
      g.strokeStyle = INK; g.lineWidth = C * 0.14;
      g.strokeRect(C * 0.07, C * 0.07, T - C * 0.14, T - C * 0.14);
      return c;
    }

    /* ---------------------------------------------------------------
     * Layout and scene. The board is radially symmetric, so the camera
     * looks straight down and the board itself never rotates — only the
     * seat plates do.
     * ------------------------------------------------------------- */
    let W = ctx.width, H = ctx.height;
    const L = {};
    function measure() {
      W = ctx.width; H = ctx.height;
      // Leave a rim wide enough for four seat plates and the dice puck.
      L.board = Math.min(W - 22, H * 0.50);
      L.bx = (W - L.board) / 2;
      L.by = (H - L.board) / 2;
      L.cell = L.board / 15;
    }
    measure();

    const glCanvas = ctx.createCanvas({ touchAction: "none" });
    const renderer = new THREE.WebGLRenderer({ canvas: glCanvas, antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(ctx.dpr, 2));
    renderer.setSize(W, H, false);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    ctx.onDestroy(() => renderer.dispose());

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x123a72);


    const FOV = 34;
    const U = 1;                                 // one board cell is one unit

    /**
     * A felt table under the board. A square board on a portrait phone leaves
     * a deep empty band at each end; left flat they read as the bit having
     * failed to fill the screen, and they are also where the die and the seat
     * plates live, so they need to look like part of the object.
     */
    const cloth = new THREE.Mesh(
      new THREE.PlaneGeometry(80 * U, 80 * U),
      new THREE.MeshStandardMaterial({ color: 0x0d2b57, roughness: 0.92, metalness: 0.0 })
    );
    cloth.rotation.x = -Math.PI / 2;
    cloth.position.y = -0.09 * U;
    cloth.receiveShadow = true;
    scene.add(cloth);
    const camera = new THREE.PerspectiveCamera(FOV, W / H, 0.5, 120);
    camera.up.set(0, 0, -1);
    function placeCamera() {
      // The fov is vertical and the screen is portrait, so the horizontal
      // extent is the binding one — solve the distance from the width the
      // board has to occupy or the outer files fall off the screen.
      camera.aspect = W / H;
      const halfWidthWorld = 7.5 * U * (W / L.board);
      camera.position.set(0, halfWidthWorld / (Math.tan((FOV / 2) * Math.PI / 180) * camera.aspect), 0);
      camera.lookAt(0, 0, 0);
      camera.up.set(0, 0, -1);
      camera.updateProjectionMatrix();
    }
    placeCamera();

    /** Board cell (row, col) to its world centre. */
    const worldOf = (r, col) => ({ x: (col - 7) * U, z: (r - 7) * U });
    /** Screen pixels to a board cell, or null outside the board. */
    function pickCell(px, py) {
      const col = Math.floor((px - L.bx) / L.cell);
      const r = Math.floor((py - L.by) / L.cell);
      if (col < 0 || col > 14 || r < 0 || r > 14) return null;
      return [r, col];
    }
    /**
     * World to screen. The camera is orthogonal to the board and frames it by
     * width, so this is a straight linear scale — and having exactly one copy
     * of it keeps every hit test agreeing with what is actually drawn.
     */
    function worldToScreen(x, z) {
      const halfW = 7.5 * U * (W / L.board);
      const halfH = halfW / (W / H);
      return { x: W / 2 + (x / halfW) * (W / 2), y: H / 2 + (z / halfH) * (H / 2) };
    }

    /** World position for a token, including its resting spot in the yard. */
    function tokenWorld(seat, p, slot) {
      if (p < 0) {
        const [yr, yc] = seat.yard;
        return worldOf(yr + (slot > 1 ? 3.6 : 1.75) - 0.5, yc + (slot % 2 ? 3.6 : 1.75) - 0.5);
      }
      if (p >= HOME_P) {
        // Finished tokens gather in that colour's wedge of the centre.
        const [hr, hc] = seat.home[4];
        const dr = Math.sign(7 - hr), dc = Math.sign(7 - hc);
        return worldOf(7 + dr * 0.55 - (dc ? (slot - 1.5) * 0.42 : 0),
                       7 + dc * 0.55 - (dr ? (slot - 1.5) * 0.42 : 0));
      }
      const [r, col] = cellOf(seat, p);
      return worldOf(r, col);
    }

    /* --- board mesh --- */
    const boardGroup = new THREE.Group();
    scene.add(boardGroup);
    let boardMesh = null, boardTex = null;
    function buildBoard(active) {
      if (boardMesh) { boardGroup.remove(boardMesh); boardMesh.geometry.dispose(); boardMesh.material.dispose(); }
      if (boardTex) boardTex.dispose();
      const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.68, metalness: 0.03 });
      const cv = makeBoardTexture(active);
      if (cv) {
        boardTex = new THREE.CanvasTexture(cv);
        boardTex.colorSpace = THREE.SRGBColorSpace;
        boardTex.anisotropy = 8;
        mat.map = boardTex;
      } else {
        mat.color = new THREE.Color(0xf2f5f9);   // no OffscreenCanvas: plain board
      }
      boardMesh = new THREE.Mesh(new THREE.PlaneGeometry(15 * U, 15 * U), mat);
      boardMesh.rotation.x = -Math.PI / 2;
      boardMesh.receiveShadow = true;
      boardGroup.add(boardMesh);

      if (!buildBoard.rim) {
        const rim = new THREE.Group();
        const rmat = new THREE.MeshStandardMaterial({ color: 0x0E3E7E, roughness: 0.42, metalness: 0.35 });
        const t = 0.7 * U, o = 7.5 * U + t / 2;
        for (const [x, z, sx, sz] of [
          [0, -o, 15 * U + t * 2, t], [0, o, 15 * U + t * 2, t],
          [-o, 0, t, 15 * U], [o, 0, t, 15 * U],
        ]) {
          const mm = new THREE.Mesh(new THREE.BoxGeometry(sx, 0.34 * U, sz), rmat);
          mm.position.set(x, 0.10 * U, z);
          mm.castShadow = true; mm.receiveShadow = true;
          rim.add(mm);
        }
        boardGroup.add(rim);
        buildBoard.rim = rim;
      }
    }

    /* --- lights --- */
    scene.add(new THREE.AmbientLight(0xc8d8f0, 0.72));
    scene.add(new THREE.HemisphereLight(0xeaf2ff, 0x0a1c38, 0.60));
    const key = new THREE.DirectionalLight(0xfff6e8, 2.0);
    key.position.set(-7 * U, 13 * U, -6 * U);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.left = -11 * U; key.shadow.camera.right = 11 * U;
    key.shadow.camera.top = 11 * U; key.shadow.camera.bottom = -11 * U;
    key.shadow.camera.near = 1; key.shadow.camera.far = 40 * U;
    key.shadow.bias = -0.0014;
    key.shadow.normalBias = 0.02;
    scene.add(key);

    /* --- tokens ---
     * The classic Ludo pawn: a wide skirted base sweeping into a waisted
     * neck under a ball. A rotational solid, so it is turned on a lathe
     * the same way the chess bit turns its Staunton pieces.
     */
    const TOKEN_PROFILE = [
      [0.00, 0.00], [0.42, 0.00], [0.42, 0.05], [0.40, 0.10], [0.28, 0.17],
      [0.18, 0.26], [0.15, 0.36], [0.17, 0.44], [0.22, 0.50], [0.16, 0.55],
      [0.14, 0.58], [0.20, 0.63], [0.28, 0.72], [0.29, 0.82], [0.24, 0.91],
      [0.14, 0.98], [0.00, 1.01],
    ];
    const tokenGeo = new THREE.LatheGeometry(
      TOKEN_PROFILE.map(([r, h]) => new THREE.Vector2(Math.max(r, 0.0001) * U, h * 0.92 * U)), 32);
    tokenGeo.computeVertexNormals();

    function buildToken(hex) {
      const g = new THREE.Group();
      const body = new THREE.Mesh(tokenGeo, new THREE.MeshStandardMaterial({
        color: hex, roughness: 0.30, metalness: 0.12,
      }));
      body.castShadow = true;
      g.add(body);
      // A pale collar, so a token still reads against its own home column.
      const collar = new THREE.Mesh(
        new THREE.TorusGeometry(0.205 * U, 0.052 * U, 10, 26),
        new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.34 }));
      collar.rotation.x = Math.PI / 2;
      collar.position.y = 0.50 * U;
      g.add(collar);
      // A halo the turn indicator switches on, so "these are yours, now" is
      // legible from any seat without reading a word.
      const halo = new THREE.Mesh(
        new THREE.RingGeometry(0.42 * U, 0.50 * U, 28),
        new THREE.MeshBasicMaterial({ color: hex, transparent: true, opacity: 0, depthWrite: false }));
      halo.rotation.x = -Math.PI / 2;
      halo.position.y = 0.02 * U;
      g.add(halo);
      g.userData.halo = halo;
      return g;
    }

    /* --- the die ---
     * A real cube that tumbles. Pips are painted onto one texture strip and
     * mapped face by face, so there are no extra draw calls and no assets.
     */
    function makeDieTexture() {
      const S = 128, c = surface(S * 6, S);
      if (!c) return null;
      const g = c.getContext("2d");
      const P = [[], [[0.5,0.5]], [[0.28,0.28],[0.72,0.72]],
                 [[0.26,0.26],[0.5,0.5],[0.74,0.74]],
                 [[0.28,0.28],[0.72,0.28],[0.28,0.72],[0.72,0.72]],
                 [[0.26,0.26],[0.74,0.26],[0.5,0.5],[0.26,0.74],[0.74,0.74]],
                 [[0.28,0.24],[0.72,0.24],[0.28,0.5],[0.72,0.5],[0.28,0.76],[0.72,0.76]]];
      for (let f = 1; f <= 6; f++) {
        const x0 = (f - 1) * S;
        g.fillStyle = "#FFFDF6"; g.fillRect(x0, 0, S, S);
        g.strokeStyle = "rgba(20,28,40,0.16)"; g.lineWidth = 5;
        g.strokeRect(x0 + 3, 3, S - 6, S - 6);
        g.fillStyle = "#1D2733";
        for (const [px, py] of P[f]) {
          g.beginPath(); g.arc(x0 + px * S, py * S, S * 0.093, 0, TAU); g.fill();
        }
      }
      return c;
    }

    // BoxGeometry material order is +X, -X, +Y, -Y, +Z, -Z. Opposite faces of a
    // real die sum to seven, so pairing them (1,6) (2,5) (3,4) makes the cube
    // honest from every angle.
    const DIE_FACES = [1, 6, 2, 5, 3, 4];
    // Rotation that brings each value to the top.
    const FACE_UP = {
      1: [0, 0, Math.PI / 2], 2: [0, 0, 0], 3: [-Math.PI / 2, 0, 0],
      4: [Math.PI / 2, 0, 0], 5: [0, 0, Math.PI], 6: [0, 0, -Math.PI / 2],
    };

    const dieGroup = new THREE.Group();
    scene.add(dieGroup);
    (function buildDie() {
      const cv = makeDieTexture();
      const mats = DIE_FACES.map((f) => {
        const m = new THREE.MeshStandardMaterial({ color: 0xfffdf6, roughness: 0.30, metalness: 0.05 });
        if (cv) {
          const t = new THREE.CanvasTexture(cv);
          t.colorSpace = THREE.SRGBColorSpace;
          t.repeat.set(1 / 6, 1);
          t.offset.set((f - 1) / 6, 0);
          m.map = t;
          ctx.onDestroy(() => t.dispose());
        }
        return m;
      });
      const cube = new THREE.Mesh(new THREE.BoxGeometry(1.15 * U, 1.15 * U, 1.15 * U), mats);
      cube.castShadow = true;
      dieGroup.add(cube);
      dieGroup.position.y = 0.62 * U;
    })();

    /* ---------------------------------------------------------------
     * Game state
     * ------------------------------------------------------------- */
    let game = null;
    let phase = "setup";                 // setup | roll | choose | moving | over
    let roll = 0, sixes = 0, options = [], winner = null;
    let tokenMesh = [];                  // [seat][token] -> Group
    let anim = null, dieAnim = null;

    function newGame(n) {
      const order = SEATS_FOR[n];
      game = {
        order,
        tokens: order.map(() => [-1, -1, -1, -1]),
        hardBlocks: settings.hardBlocks,
        turn: 0,
      };
      for (const row of tokenMesh) for (const m of row) scene.remove(m);
      tokenMesh = order.map((si) => {
        const seat = SEATS[si];
        return [0, 1, 2, 3].map(() => { const m = buildToken(seat.hex); scene.add(m); return m; });
      });
      buildBoard(order);
      phase = "roll"; roll = 0; sixes = 0; options = []; winner = null; anim = null;
      syncTokens();
      paintSeats();
      paintTurn();
    }

    function syncTokens() {
      for (let s = 0; s < game.order.length; s++) {
        const seat = SEATS[game.order[s]];
        // Tokens sharing a cell fan out slightly so a stack is visibly a stack.
        const byCell = {};
        for (let t = 0; t < 4; t++) {
          const p = game.tokens[s][t];
          const c = cellOf(seat, p);
          const k = c ? c.join(",") : "yard" + t;
          (byCell[k] ||= []).push(t);
        }
        for (let t = 0; t < 4; t++) {
          const p = game.tokens[s][t];
          const w = tokenWorld(seat, p, t);
          const c = cellOf(seat, p);
          const share = c ? byCell[c.join(",")] : null;
          let ox = 0, oz = 0;
          if (share && share.length > 1) {
            const i = share.indexOf(t);
            ox = (i - (share.length - 1) / 2) * 0.22 * U;
            oz = (i % 2 ? 0.10 : -0.10) * U;
          }
          const m = tokenMesh[s][t];
          if (m !== (anim && anim.mesh)) m.position.set(w.x + ox, 0.055 * U, w.z + oz);
        }
      }
    }

    /* ---------------------------------------------------------------
     * Turn flow
     * ------------------------------------------------------------- */
    function activeSeat() { return SEATS[game.order[game.turn]]; }

    function doRoll() {
      if (phase !== "roll") return;
      phase = "moving";
      const value = 1 + Math.floor(Math.random() * 6);
      sound.sting("tap");
      sound.haptic("light");
      // Tumble, then settle on the rolled face. The result is decided up
      // front and the animation lands on it — the alternative, reading the
      // face off a physics settle, can disagree with the rules engine.
      dieAnim = {
        t: 0, dur: 0.72, value,
        spin: { x: 6 + Math.random() * 6, y: 5 + Math.random() * 6, z: 4 + Math.random() * 5 },
        after: () => {
          roll = value;
          options = legalMoves(game, game.turn, value);
          paintTurn();
          if (options.length === 0) {
            // Nothing is playable. The turn still does not move on by itself:
            // it waits to be acknowledged, so a player always sees why they
            // got nothing rather than watching the dice hand over on its own.
            sound.sting("fail");
            phase = "stuck";
            paintTurn();
          } else {
            // Always wait for a tap, even when there is only one legal move.
            // Playing it automatically reads as the game skipping your turn —
            // you rolled, you looked away for a second, and the dice were
            // suddenly with the next player. A turn should never advance
            // without its owner having touched something.
            phase = "choose";
            paintTurn();
          }
        },
      };
      sixes = value === 6 ? sixes + 1 : 0;
      // Three sixes in one turn voids the third roll entirely.
      if (sixes >= 3) {
        dieAnim.after = () => {
          roll = value;
          paintTurn();
          sound.sting("danger");
          toast("Three sixes — roll voided");
          ctx.timeout(endTurn, 1100);
        };
      }
    }

    function play(move) {
      phase = "moving";
      options = [];
      const s = game.turn;
      const seat = activeSeat();
      const mesh = tokenMesh[s][move.token];
      const from = tokenWorld(seat, move.from, move.token);
      const to = tokenWorld(seat, move.to, move.token);
      const hops = Math.max(1, Math.min(move.to - Math.max(move.from, 0), 6));

      anim = {
        mesh, t: 0, dur: 0.10 * hops + 0.16, hops,
        fx: from.x, fz: from.z, tx: to.x, tz: to.z,
        after: () => {
          const res = applyMove(game, s, move, roll);
          syncTokens();
          paintSeats();
          if (res.captured.length) {
            sound.sting("powerup"); sound.haptic("heavy");
            sound.duck(0.4, 300);
            toast(SEATS[game.order[res.captured[0].seat]].name + " sent home");
          } else if (res.camehome) {
            sound.sting("coin"); sound.haptic("success");
            toast("Home!");
          } else {
            sound.haptic("light");
          }
          ctx.platform.interact({ type: "move", roll });

          if (res.finished) return finish(s);
          // A six, a capture and coming home each earn another roll — but at
          // most one, so a capture with a six is still a single extra turn.
          const bonus = res.six || res.captured.length > 0 || res.camehome;
          if (bonus && sixes < 3) { phase = "roll"; paintTurn(); }
          else endTurn();
        },
      };
    }

    /** Acknowledge a roll that had no legal move. */
    function clearStuck() {
      if (phase !== "stuck") return;
      const sixAgain = roll === 6 && sixes < 3;
      if (sixAgain) { phase = "roll"; paintTurn(); }
      else endTurn();
    }

    function endTurn() {
      sixes = 0; roll = 0; options = [];
      game.turn = (game.turn + 1) % game.order.length;
      phase = "roll";
      paintTurn();
    }

    async function finish(s) {
      phase = "over";
      winner = SEATS[game.order[s]];
      el("over-title").textContent = winner.name + " wins";
      el("over-title").style.color = winner.css;
      el("over").style.display = "flex";
      sound.duck(0.5, 420); sound.sting("win"); sound.haptic("success");
      ctx.platform.complete({ winner: winner.id, players: game.order.length });
      // How quickly this table finished — a property of the match, not of one
      // of the people sharing the phone.
      try { await ctx.memory.record("fastest_finish").submit(turnCount, { label: turnCount + " turns" }); }
      catch (_) {}
    }
    let turnCount = 0;

    /* ---------------------------------------------------------------
     * Overlay. Seat plates sit at the four corners, each turned so its
     * "up" points off-screen away from the board, which is what makes
     * four people reading one phone work.
     * ------------------------------------------------------------- */
    const FONT = "Inter,-apple-system,system-ui,'Segoe UI',Roboto,sans-serif";
    const ST = ctx.safeArea.top, SB = ctx.safeArea.bottom;
    // Corner direction -> the CSS rotation that points the plate outward.
    const PLATE_ROT = { "-1,-1": -45, "1,-1": 45, "1,1": 135, "-1,1": 225 };

    function plateMarkup(seat) {
      const [cx, cy] = seat.corner;
      const rot = PLATE_ROT[cx + "," + cy];
      const vert = cy < 0 ? "top:" + (ST + 10) + "px;" : "bottom:" + (SB + 10) + "px;";
      const horz = cx < 0 ? "left:8px;" : "right:8px;";
      return '<div data-el="plate-' + seat.id + '" style="position:absolute;' + vert + horz +
        'transform:rotate(' + rot + 'deg);transform-origin:center;pointer-events:none;' +
        'display:none;flex-direction:column;align-items:center;gap:4px;">' +
        '<div data-el="pname-' + seat.id + '" style="padding:5px 13px;border-radius:999px;' +
          'background:' + seat.css + ';color:#0d1826;font-size:13px;font-weight:800;' +
          'letter-spacing:0.09em;text-transform:lowercase;white-space:nowrap;' +
          'box-shadow:0 2px 10px rgba(0,0,0,0.35);">' + seat.name + '</div>' +
        '<div data-el="pcount-' + seat.id + '" style="font-size:11px;letter-spacing:0.14em;' +
          'color:#cfe0ff;opacity:0.75;white-space:nowrap;">0 home</div>' +
      '</div>';
    }

    const BTN = "pointer-events:auto;width:36px;height:36px;border-radius:12px;border:none;" +
      "background:rgba(255,255,255,0.14);color:#eaf2ff;font-size:15px;font-family:inherit;padding:0;";
    const BIG = "width:100%;padding:14px;border:none;border-radius:16px;font-family:inherit;" +
      "font-size:16px;font-weight:800;letter-spacing:0.04em;";

    const root = ctx.createRoot({ touchAction: "none" });
    // The overlay sits above the WebGL canvas, so it must be transparent to
    // pointers or it swallows every tap meant for the board.
    root.style.cssText += ";font-family:" + FONT + ";color:#eaf2ff;pointer-events:none;text-transform:lowercase;";

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
      SEATS.map(plateMarkup).join("") +
      // Whose turn it is, on the centre line where it belongs to nobody.
      '<div data-el="turnbar" style="position:absolute;left:0;right:0;top:' + (ST + 8) + 'px;' +
        'text-align:center;pointer-events:none;font-size:12px;letter-spacing:0.24em;' +
        'text-transform:lowercase;"></div>' +
      '<div data-el="toast" style="position:absolute;left:0;right:0;top:50%;transform:translateY(-50%);' +
        'text-align:center;pointer-events:none;font-size:19px;font-weight:800;opacity:0;' +
        'text-shadow:0 2px 14px rgba(0,0,0,0.6);"></div>' +
      '<div style="position:absolute;left:0;right:0;bottom:' + (SB + 52) + 'px;display:flex;' +
        'gap:8px;justify-content:center;z-index:40;pointer-events:none;">' +
        '<button data-el="mute" aria-label="Sound" style="' + BTN + '">' + SPK(true) + '</button>' +
        '<button data-el="cog" aria-label="Settings" style="' + BTN + '">⚙</button>' +
        '<button data-el="help" aria-label="How to play" style="' + BTN + '">?</button>' +
      '</div>' +
      // Setup.
      '<div data-el="menu" style="position:absolute;inset:0;pointer-events:auto;display:flex;' +
        'flex-direction:column;align-items:center;justify-content:center;gap:9px;' +
        // Opaque. At 0.93 the board's white squares still came through at 16/255
        // behind every line of copy, and the chrome keys under it read as three
        // grey smudges rather than as buttons.
        'background:#081630;z-index:50;padding:26px;text-align:center;">' +
        '<div style="font-size:12px;letter-spacing:0.42em;text-transform:lowercase;opacity:0.66;">Pass and play</div>' +
        '<div style="font-size:56px;font-weight:900;letter-spacing:-0.02em;' +
          'background:linear-gradient(96deg,#EB1C24,#F7C600,#039F4B,#24A5F6);' +
          '-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;">Ludo</div>' +
        '<div style="font-size:15px;opacity:0.66;max-width:260px;line-height:1.55;margin-top:2px;">' +
          'Put the phone down in the middle. Nothing is hidden, so you never have to pick it up.</div>' +
        '<div style="font-size:11px;letter-spacing:0.22em;text-transform:lowercase;opacity:0.66;margin-top:16px;">Players</div>' +
        '<div data-el="pc" style="display:flex;gap:10px;margin-top:2px;"></div>' +
        '<button data-el="play" style="' + BIG + 'max-width:230px;margin-top:20px;' +
          // Deeper than the board's own red and blue: white on #24A5F6 is
          // 2.7:1, and this is the one button on the screen.
          'background:linear-gradient(96deg,#C8151C,#1565C0);color:#fff;">Start</button>' +
      '</div>' +
      // Winner.
      '<div data-el="over" style="position:absolute;inset:0;pointer-events:auto;display:none;' +
        'flex-direction:column;align-items:center;justify-content:center;gap:6px;' +
        'background:#081630;z-index:55;padding:26px;text-align:center;">' +
        '<div data-el="over-title" style="font-size:42px;font-weight:900;"></div>' +
        '<div data-el="over-line" style="font-size:14px;opacity:0.6;">All four tokens home</div>' +
        '<button data-el="again" style="' + BIG + 'max-width:230px;margin-top:22px;' +
          'background:rgba(255,255,255,0.16);color:#eaf2ff;">Play again</button>' +
      '</div>' +
      // Settings.
      '<div data-el="cogp" style="position:absolute;inset:0;pointer-events:auto;display:none;' +
        'align-items:center;justify-content:center;background:rgba(8,22,48,0.94);z-index:70;padding:24px;">' +
        '<div style="max-width:320px;width:100%;background:rgba(14,40,84,0.98);border-radius:22px;' +
          'padding:22px;border:1px solid rgba(255,255,255,0.10);">' +
          '<div style="font-size:19px;font-weight:800;margin-bottom:15px;">Settings</div>' +
          '<div style="font-size:11px;letter-spacing:0.2em;text-transform:lowercase;opacity:0.72;">Blockades</div>' +
          '<div data-el="blocks" style="display:flex;gap:8px;margin:9px 0 6px;"></div>' +
          '<div style="font-size:12.5px;opacity:0.75;line-height:1.5;">Strict blocks stop an opponent passing ' +
            'through a pair of your tokens. Soft blocks only stop them landing on it.</div>' +
          '<button data-el="cogp-close" style="' + BIG + 'margin-top:20px;' +
            'background:rgba(255,255,255,0.14);color:#eaf2ff;">Done</button>' +
        '</div>' +
      '</div>' +
      // Instructions.
      '<div data-el="helpp" style="position:absolute;inset:0;pointer-events:auto;display:none;' +
        'align-items:center;justify-content:center;background:rgba(8,22,48,0.94);z-index:70;padding:24px;">' +
        '<div style="max-width:330px;width:100%;background:rgba(14,40,84,0.98);border-radius:22px;' +
          'padding:22px;border:1px solid rgba(255,255,255,0.10);">' +
          '<div style="font-size:19px;font-weight:800;margin-bottom:11px;">How to play</div>' +
          '<ul style="font-size:14px;line-height:1.7;opacity:0.86;padding-left:18px;margin:0;">' +
            '<li>Phone flat in the middle. Nothing is hidden — nobody picks it up.</li>' +
            '<li>Take the corner nearest your colour. Your name plate faces you.</li>' +
            '<li>Tap the die on your turn, then tap a lit token to move it.</li>' +
            '<li>A token only leaves your yard on a <b>six</b>.</li>' +
            '<li>A six, a capture, or getting a token home earns another roll.</li>' +
            '<li>Three sixes in one turn and the third is voided — your turn ends.</li>' +
            '<li>Land on a lone opponent to send it home. The eight starred and ' +
              'coloured squares are safe: nobody can be taken there.</li>' +
            '<li>Coming home needs the exact count. All four home wins.</li>' +
          '</ul>' +
          '<button data-el="helpp-close" style="' + BIG + 'margin-top:17px;' +
            'background:rgba(255,255,255,0.14);color:#eaf2ff;">Got it</button>' +
        '</div>' +
      '</div>';

    const el = (n) => root.querySelector('[data-el="' + n + '"]');
    const tap = (node, fn) => {
      if (!node) return;
      ctx.listen(node, "pointerdown", (e) => e.stopPropagation());
      ctx.listen(node, "click", (e) => { e.stopPropagation(); e.preventDefault(); fn(e); });
    };

    let toastTimer = null;
    function toast(msg) {
      const n = el("toast");
      n.textContent = msg;
      n.style.opacity = "1";
      if (toastTimer) return;
      toastTimer = ctx.timeout(() => { n.style.opacity = "0"; toastTimer = null; }, 1150);
    }

    function paintSeats() {
      for (const seat of SEATS) {
        const s = game ? game.order.indexOf(SEATS.indexOf(seat)) : -1;
        el("plate-" + seat.id).style.display = s >= 0 ? "flex" : "none";
        if (s >= 0) {
          const home = game.tokens[s].filter((p) => p === HOME_P).length;
          el("pcount-" + seat.id).textContent = home + " home";
        }
      }
    }

    function paintTurn() {
      if (!game) return;
      const seat = activeSeat();
      el("turnbar").innerHTML = phase === "over" ? "" :
        // `ink`, not `css`: board red on the near-black table is 3.4:1, and
        // the one line that says whose turn it is cannot be the dim one.
        '<span style="color:' + seat.ink + ';font-weight:800;">' + seat.name + '</span>' +
        '<span style="opacity:0.72;"> &nbsp;' +
          (phase === "roll" ? "tap the die"
            : phase === "choose" ? "pick a token"
            : phase === "stuck" ? "no move — tap to pass"
            : "…") + '</span>';
      for (const seat2 of SEATS) {
        const plate = el("pname-" + seat2.id);
        if (plate) plate.style.boxShadow = seat2 === seat && phase !== "over"
          ? "0 0 0 3px rgba(255,255,255,0.85), 0 2px 12px rgba(0,0,0,0.4)"
          : "0 2px 10px rgba(0,0,0,0.35)";
      }
      // Light exactly the tokens that can legally move, and nothing else.
      const movable = new Set(options.map((o) => o.token));
      for (let s = 0; s < game.order.length; s++) {
        for (let t = 0; t < 4; t++) {
          tokenMesh[s][t].userData.halo.material.opacity =
            (s === game.turn && movable.has(t)) ? 0.9 : 0;
        }
      }
      // The die sits between the board and whoever's turn it is.
      // The die sits in the band beyond the board's near edge, pushed toward
      // the active player's corner. It cannot go diagonally outside the board:
      // a portrait screen frames the board by width, so there is barely any
      // horizontal margin and the die would land off-screen.
      const seatIdx = game.order[game.turn];
      const [cx, cy] = SEATS[seatIdx].corner;
      dieGroup.position.x = cx * 4.4 * U;
      dieGroup.position.z = cy * 9.5 * U;
    }

    /* ---------------------------------------------------------------
     * Input. Turns are sequential, so only the active player's die and
     * their own movable tokens are ever live — the zones cannot collide.
     * ------------------------------------------------------------- */
    /** Where the die puck is on screen, so a tap can find it. */
    function diePuckXY() {
      const seatIdx = game.order[game.turn];
      const [cx, cy] = SEATS[seatIdx].corner;
      const p = worldToScreen(cx * 4.4 * U, cy * 9.5 * U);
      return { x: p.x, y: p.y, r: L.cell * 1.6 };
    }

    ctx.listen(glCanvas, "pointerdown", async (e) => {
      if (!game || phase === "over") return;
      await sound.unlock();
      ctx.platform.start();
      const x = e.offsetX, y = e.offsetY;

      if (phase === "roll") {
        const d = diePuckXY();
        // Generous hit area: it is the only live control, so there is nothing
        // for a loose tap to collide with.
        if (Math.hypot(x - d.x, y - d.y) < d.r * 1.5) { turnCount++; doRoll(); }
        e.preventDefault();
        return;
      }

      if (phase === "stuck") { clearStuck(); e.preventDefault(); return; }

      if (phase === "choose") {
        const cell = pickCell(x, y);
        const seat = activeSeat();
        let best = null, bestD = 1e9;
        for (const o of options) {
          const p = game.tokens[game.turn][o.token];
          const w = tokenWorld(seat, p, o.token);
          const sp = worldToScreen(w.x, w.z);      // hit test where it is drawn
          const d = Math.hypot(x - sp.x, y - sp.y);
          if (d < bestD) { bestD = d; best = o; }
        }
        if (best && bestD < L.cell * 1.25) play(best);
        else if (cell) sound.haptic("warning");
        e.preventDefault();
      }
    }, { passive: false });

    /* --- chrome --- */
    tap(el("mute"), (e) => { e.target.innerHTML = SPK(!sound.toggle()); });
    if (settings.mute) el("mute").innerHTML = SPK(false);
    tap(el("cog"), () => { el("cogp").style.display = "flex"; });
    tap(el("cogp-close"), () => { el("cogp").style.display = "none"; });
    tap(el("help"), () => { el("helpp").style.display = "flex"; });
    tap(el("helpp-close"), () => { el("helpp").style.display = "none"; });

    function pills(host, values, labels, get, set) {
      host.innerHTML = values.map((v, i) =>
        '<button data-v="' + v + '" style="flex:1;min-width:58px;padding:11px 0;border:none;' +
        'border-radius:13px;font-family:inherit;font-size:15px;font-weight:700;">' +
        labels[i] + '</button>').join("");
      const paint = () => {
        for (const b of host.querySelectorAll("button")) {
          const on = String(get()) === b.dataset.v;
          // Two whites a shade apart is not a selected state. The chosen pill
          // takes the board's blue and a ring; the quiet one gets an ink that
          // clears the floor instead of the 4.1:1 it sat at.
          b.style.background = on ? "rgba(36,165,246,0.32)" : "rgba(255,255,255,0.10)";
          b.style.color = on ? "#EAF6FF" : "rgba(234,242,255,0.78)";
          b.style.boxShadow = on ? "inset 0 0 0 1.6px rgba(36,165,246,0.85)" : "none";
        }
      };
      for (const b of host.querySelectorAll("button")) {
        tap(b, () => { set(b.dataset.v); saveSettings(); paint(); sound.haptic("light"); });
      }
      paint();
    }
    pills(el("pc"), [2, 3, 4], ["2", "3", "4"],
      () => settings.players, (v) => { settings.players = Number(v); });
    pills(el("blocks"), ["true", "false"], ["Strict", "Soft"],
      () => String(settings.hardBlocks), (v) => {
        settings.hardBlocks = v === "true";
        if (game) game.hardBlocks = settings.hardBlocks;
      });

    tap(el("play"), async () => {
      ctx.platform.start();
      await sound.unlock();
      el("menu").style.display = "none";
      turnCount = 0;
      newGame(settings.players);
    });
    tap(el("again"), () => {
      el("over").style.display = "none";
      turnCount = 0;
      newGame(settings.players);
      ctx.platform.interact({ type: "replay" });
    });

    /* ---------------------------------------------------------------
     * Frame
     * ------------------------------------------------------------- */
    const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);

    ctx.onFrame((dtMs) => {
      const dt = Math.min(dtMs, 50) / 1000;

      if (dieAnim) {
        dieAnim.t += dt;
        const t = Math.min(dieAnim.t / dieAnim.dur, 1);
        if (t < 1) {
          const k = 1 - t;
          dieGroup.rotation.x += dieAnim.spin.x * dt * k;
          dieGroup.rotation.y += dieAnim.spin.y * dt * k;
          dieGroup.rotation.z += dieAnim.spin.z * dt * k;
          dieGroup.position.y = 0.62 * U + Math.abs(Math.sin(t * Math.PI * 2.4)) * (1 - t) * 1.5 * U;
        } else {
          const [rx, ry, rz] = FACE_UP[dieAnim.value];
          dieGroup.rotation.set(rx, ry, rz);
          dieGroup.position.y = 0.62 * U;
          const a = dieAnim; dieAnim = null; a.after();
        }
      }

      if (anim) {
        anim.t += dt;
        const t = Math.min(anim.t / anim.dur, 1);
        const e = easeOutCubic(t);
        // One little hop per square travelled, so a move of five reads as five.
        const hop = Math.abs(Math.sin(t * Math.PI * anim.hops)) * 0.34 * U * (1 - t * 0.4);
        anim.mesh.position.x = anim.fx + (anim.tx - anim.fx) * e;
        anim.mesh.position.z = anim.fz + (anim.tz - anim.fz) * e;
        anim.mesh.position.y = 0.055 * U + hop;
        if (t >= 1) { const a = anim; anim = null; a.mesh.position.y = 0.055 * U; a.after(); }
      }

      // The active player's tokens breathe a little, so "it is your move"
      // reads from any seat without anybody reading a word.
      if (game && phase === "choose") {
        const b = 0.72 + Math.sin(performance.now() * 0.006) * 0.26;
        const movable = new Set(options.map((o) => o.token));
        for (let t = 0; t < 4; t++) {
          if (movable.has(t)) tokenMesh[game.turn][t].userData.halo.material.opacity = b;
        }
      }

      renderer.render(scene, camera);
    });

    ctx.listen(window, "resize", () => {
      if (ctx.width === W && ctx.height === H) return;
      measure();
      renderer.setSize(ctx.width, ctx.height, false);
      placeCamera();
    });

    /* --- boot: draw a full board behind the title so the first frame is
     * never empty, then hand over. --- */
    buildBoard(SEATS_FOR[settings.players]);
    paintSeats();

    // A read-only window for the local harness, so a scripted game can assert
    // on real positions. It exposes nothing the board does not already show.
    window.__LUDO__ = {
      get phase() { return phase; },
      get turn() { return game ? game.turn : -1; },
      get roll() { return roll; },
      get tokens() { return game ? game.tokens.map((r) => r.slice()) : []; },
      get options() { return options.map((o) => o.token); },
      get busy() { return anim !== null || dieAnim !== null; },
      get winner() { return winner ? winner.id : null; },
      diePuck: () => diePuckXY(),
      tokenXY: (s, t) => {
        const seat = SEATS[game.order[s]];
        const w = tokenWorld(seat, game.tokens[s][t], t);
        return worldToScreen(w.x, w.z);
      },
      // Force a roll value, so a test can reach late-game states in a few
      // steps instead of waiting on chance.
      forceRoll: (v) => { if (phase === "roll") { turnCount++; phase = "moving";
        dieAnim = { t: 0, dur: 0.01, value: v, spin: { x: 0, y: 0, z: 0 }, after: () => {
          roll = v; sixes = v === 6 ? sixes + 1 : 0;
          options = legalMoves(game, game.turn, v); paintTurn();
          if (!options.length) { if (v === 6 && sixes < 3) { phase = "roll"; paintTurn(); } else endTurn(); }
          else phase = "choose";
        } }; } },
    };
    ctx.onDestroy(() => { try { delete window.__LUDO__; } catch (_) {} });

    renderer.render(scene, camera);
    ctx.markVisualReady("board painted");
    ctx.platform.ready();
  },
};
