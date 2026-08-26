/**
 * Helmet Derby — two players, one phone, two cars trying to bonk each other
 * on the head.
 *
 * Whoever touches the other car's HELMET with any part of their own car wins
 * the point. That is the whole rule, and it is why the cars flip and cartwheel:
 * the fastest way to reach somebody's head is usually to land on it.
 *
 * The seating is the hard part and it is worth being straight about. A
 * side-view driving game cannot be shared by two people sitting OPPOSITE each
 * other, because a side view has a handedness and flipping it hands one player
 * a mirrored world. So both players sit along the same edge, each holding their
 * end of the phone with a thumb pair in their own bottom corner, which is what
 * the game this is descended from does on a real device. It works because the
 * controls are two fat buttons rather than a stick: your thumbs stay in your
 * own corner and your forearms never meet in the middle.
 *
 * One thing the reference design got wrong and is worth recording: a 180-degree
 * rotation is orientation-PRESERVING. Viewing a rotated render from the far
 * side of a table composes back to the identity, so the far player sees the
 * same handedness and gravity still points down for them. Any code that
 * "mirrors the controls for the rotated player" inverts one player's steering
 * and then costs a day of debugging. There is no mirroring anywhere in here.
 *
 * Physics is circles, not boxes. Each car is three overlapping discs — two
 * wheels and a chassis — plus a helmet disc on top. Circle-circle contact is
 * stable at any rotation and never tunnels or jitters the way a naive
 * box-on-box solver does at speed, and it makes "did you hit their helmet" a
 * single distance test rather than a polygon clip.
 *
 * Contract notes: no packaged assets (maxAssets is 0), so the arena, the cars
 * and every spark are canvas paths. The overlay is markup on ctx.createRoot()
 * with pointer-events off on the root itself.
 */
window.plethoraBit = {
  meta: {
    title: "Helmet Derby",
    runtime: "plethora-bit@2",
    tags: ["multiplayer", "local-multiplayer", "two-player", "physics", "arcade"],
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
    const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
    const TAU = Math.PI * 2;

    const P = [
      { css: "#ff5a45", dark: "#a3301f", name: "Ember" },
      { css: "#4cc9f0", dark: "#1f6f92", name: "Azure" },
    ];

    /* ---------------------------------------------------------------
     * Settings and sound
     * ------------------------------------------------------------- */
    const saved = (function () {
      try { return ctx.storage.get("helmetderby") || {}; } catch (_) { return {}; }
    })();
    const settings = { target: saved.target || 5, arena: saved.arena || 0, mute: !!saved.mute };
    function saveSettings() { try { ctx.storage.set("helmetderby", settings); } catch (_) {} }

    const sound = (function () {
      let muted = settings.mute, bed = null, unlocked = false;
      const start = () => ctx.music.play({ preset: "chiptune", volume: 0.28, tempo: 138, intensity: 0.42 });
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
            if (muted) { (bed || ctx.music).stop({ fadeOutMs: 220 }); bed = null; }
            else if (unlocked) bed = start();
          } catch (_) {}
          return muted;
        },
      };
    })();

    /* ---------------------------------------------------------------
     * Arena — and the reason this bit is sideways.
     *
     * A phone held upright gives two people about 7cm of shared edge to put
     * four thumbs on. Turned, it gives them 15cm. A bit cannot ask the device
     * to rotate, so the game renders itself a quarter turn inside the portrait
     * canvas and asks the player to turn the phone instead; the title screen
     * animates that request.
     *
     * Everything below works in LANDSCAPE coordinates. W and H are the logical
     * landscape dimensions — deliberately swapped from the container — and the
     * quarter turn is applied in exactly two places: once on the canvas at the
     * top of paint(), and once in reverse on every pointer. Nothing else in
     * the file knows the screen is portrait.
     * ------------------------------------------------------------- */
    let SW = ctx.width, SH = ctx.height;        // the real, portrait container
    let W = ctx.height, H = ctx.width;          // logical landscape
    const L = {};
    function measure() {
      SW = ctx.width; SH = ctx.height;
      W = SH; H = SW;
      // The pads were a fixed 168px of the landscape height. On a phone that
      // is a third of it; inside the app's card, where the landscape height is
      // the card's WIDTH, it was more than half, and the arena was squeezed
      // into a strip the cars barely fitted in.
      L.padH = Math.round(clamp(H * 0.34, 112, 168));
      // Turned sideways, the notch and home bar are on the LEFT and RIGHT of
      // the landscape view, so they no longer eat the top and bottom.
      L.padY = H - 8 - L.padH;
      // The score sits across the top of the arena, and the upper platform of
      // The Plank sits 96 units under the ceiling — on a squeezed layout the
      // two landed on each other and the score was printed on the platform.
      // The header is the score's, and the arena starts under it.
      L.headerH = 30;
      L.top = 8 + L.headerH;
      L.insetL = ctx.safeArea.bottom;           // was the home bar
      L.insetR = ctx.safeArea.top;              // was the notch
      L.floor = L.padY - 26;
      L.wallL = 10 + L.insetL;
      L.wallR = W - 10 - L.insetR;
      L.scale = Math.min(H, 390) / 390;
    }
    measure();

    /**
     * Three arenas, all built from the same primitive: a list of solid
     * slabs the cars roll on and bounce off. Keeping them slabs rather
     * than arbitrary polygons is what lets the physics stay a handful of
     * circle-against-rectangle tests.
     */
    function buildArena(i) {
      const s = L.scale;
      const f = L.floor;
      const slabs = [{ x: L.wallL, y: f, w: L.wallR - L.wallL, h: 40 }];   // the ground
      if (i === 0) {
        slabs.push({ x: W * 0.5 - 46 * s, y: f - 96 * s, w: 92 * s, h: 14 * s });
      } else if (i === 1) {
        slabs.push({ x: L.wallL, y: f - 74 * s, w: 96 * s, h: 14 * s });
        slabs.push({ x: L.wallR - 96 * s, y: f - 74 * s, w: 96 * s, h: 14 * s });
        slabs.push({ x: W * 0.5 - 30 * s, y: f - 150 * s, w: 60 * s, h: 14 * s });
      } else {
        slabs.push({ x: W * 0.5 - 70 * s, y: f - 62 * s, w: 140 * s, h: 14 * s });
        slabs.push({ x: L.wallL, y: f - 132 * s, w: 74 * s, h: 14 * s });
        slabs.push({ x: L.wallR - 74 * s, y: f - 132 * s, w: 74 * s, h: 14 * s });
      }
      return slabs;
    }
    const ARENA_NAMES = ["The Plank", "Three Tier", "Split Deck"];

/* ===== PHYSICS START ===== */
    /**
     * A car is four discs: two wheels, a chassis, and the helmet.
     *
     * Circles rather than a box because circle-against-slab contact is stable
     * at any rotation — it never jitters or tunnels the way a naive box solver
     * does at speed — and because "did you hit their helmet" then becomes one
     * distance test instead of a polygon clip.
     */
    function makeCar(side, x, y) {
      const s = L.scale;
      return {
        side, x, y, vx: 0, vy: 0, a: 0, av: 0,
        r: 13 * s,                        // wheel radius
        wheelBase: 17 * s,                // wheel offset from centre, each way
        chassisR: 15 * s,
        helmetR: 9.5 * s,
        helmetUp: 21 * s,                 // how far above centre the head sits
        drive: 0,                         // -1, 0 or +1 from the buttons
        grounded: false, dead: false, spin: 0,
      };
    }

    /** The world positions of a car's discs, given its current angle. */
    function discs(c) {
      const ca = Math.cos(c.a), sa = Math.sin(c.a);
      const at = (lx, ly) => ({ x: c.x + lx * ca - ly * sa, y: c.y + lx * sa + ly * ca });
      const rear = at(-c.wheelBase, 0), front = at(c.wheelBase, 0);
      return {
        rear: { x: rear.x, y: rear.y, r: c.r },
        front: { x: front.x, y: front.y, r: c.r },
        chassis: { x: c.x, y: c.y, r: c.chassisR },
        helmet: Object.assign(at(0, -c.helmetUp), { r: c.helmetR }),
      };
    }

    const GRAV = 1500;

    /** Push one disc out of a slab, returning the contact normal if it hit. */
    function slabPush(d, s) {
      const nx = clamp(d.x, s.x, s.x + s.w);
      const ny = clamp(d.y, s.y, s.y + s.h);
      const dx = d.x - nx, dy = d.y - ny;
      const dist = Math.hypot(dx, dy);
      if (dist >= d.r) return null;
      if (dist < 0.0001) return { nx: 0, ny: -1, depth: d.r };
      return { nx: dx / dist, ny: dy / dist, depth: d.r - dist };
    }

    function step(cars, slabs, dt) {
      for (const c of cars) {
        if (c.dead) continue;
        c.vy += GRAV * dt;
        // Drive is torque AND thrust, but the balance between them is the
        // whole feel. On the ground the wheels bite, so most of the input
        // becomes forward motion and only a little becomes a wheelie — at the
        // airborne torque the car simply backflips on the spot and never goes
        // anywhere. In the air there is nothing to bite, so the same input is
        // pure rotation, which is what lets you aim a landing at a helmet.
        c.av += c.drive * (c.grounded ? 2.3 : 7.5) * dt;
        c.av = clamp(c.av, -13, 13);
        if (c.grounded && c.drive) {
          const ca = Math.cos(c.a), sa = Math.sin(c.a);
          c.vx += ca * c.drive * 900 * dt;
          c.vy += sa * c.drive * 900 * dt;
        }
        c.vx *= Math.pow(0.62, dt);
        c.av *= Math.pow(0.35, dt);
        c.x += c.vx * dt; c.y += c.vy * dt;
        c.a += c.av * dt;
        c.grounded = false;
      }

      // Contacts, run a few times so a car wedged in a corner settles.
      for (let pass = 0; pass < 3; pass++) {
        for (const c of cars) {
          if (c.dead) continue;
          const d = discs(c);
          // Contacts are gathered first and applied as an average, never one
          // at a time. Resolving them sequentially lifts the car out of the
          // first wheel's contact before the second is tested, so a perfectly
          // flat landing produces spin out of nothing and the car settles
          // crooked — which then makes "forward" drive it backwards.
          let px = 0, py = 0, spin = 0, n = 0, grounded = false;
          for (const key of ["rear", "front", "chassis"]) {
            const disc = d[key];
            for (const s of slabs) {
              const hit = slabPush(disc, s);
              if (!hit) continue;
              px += hit.nx * hit.depth;
              py += hit.ny * hit.depth;
              const vn = c.vx * hit.nx + c.vy * hit.ny;
              if (vn < 0) {
                c.vx -= vn * hit.nx * 1.28;      // a little bounce, not a lot
                c.vy -= vn * hit.ny * 1.28;
              }
              if (hit.ny < -0.4) grounded = true;
              // Contact off the centre line spins the car, which is what makes
              // a bad landing tumble instead of sticking. Symmetric contacts
              // cancel, which is the point of summing before applying.
              spin += ((disc.x - c.x) / Math.max(c.wheelBase, 1)) * vn * 0.0016;
              n++;
            }
          }
          if (n) {
            c.x += px / n;
            c.y += py / n;
            c.av += spin / n;
            if (grounded) c.grounded = true;
            // A car resting on its wheels settles level rather than creeping.
            // Only while it is NOT being driven, or this would cancel the
            // wheelie that makes a standing start feel like anything.
            if (grounded && !c.drive && Math.abs(c.av) < 1.6) {
              const upright = Math.round(c.a / TAU) * TAU;
              c.a += (upright - c.a) * 0.12;
            }
          }
          // Side walls.
          if (c.x < L.wallL + c.chassisR) { c.x = L.wallL + c.chassisR; c.vx = Math.abs(c.vx) * 0.5; }
          if (c.x > L.wallR - c.chassisR) { c.x = L.wallR - c.chassisR; c.vx = -Math.abs(c.vx) * 0.5; }
          if (c.y < L.top + c.chassisR) { c.y = L.top + c.chassisR; c.vy = Math.abs(c.vy) * 0.4; }
        }

        // Car against car: keep the chassis discs apart so they cannot occupy
        // the same square inch and explode out of it.
        if (cars.length === 2 && !cars[0].dead && !cars[1].dead) {
          const a = cars[0], b = cars[1];
          const dx = b.x - a.x, dy = b.y - a.y;
          const dist = Math.hypot(dx, dy) || 1;
          const min = a.chassisR + b.chassisR;
          if (dist < min) {
            const nx = dx / dist, ny = dy / dist, push = (min - dist) / 2;
            a.x -= nx * push; a.y -= ny * push;
            b.x += nx * push; b.y += ny * push;
            const rel = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
            if (rel < 0) {
              a.vx += rel * nx * 0.9; a.vy += rel * ny * 0.9;
              b.vx -= rel * nx * 0.9; b.vy -= rel * ny * 0.9;
            }
          }
        }
      }
    }

    /**
     * Who got bonked?
     *
     * Any of one car's three body discs touching the other's helmet disc wins
     * the point. Both at once is a genuine double knockout and scores for
     * nobody, which happens often enough at speed to be worth handling.
     */
    function bonk(cars) {
      const hits = [false, false];
      const d = [discs(cars[0]), discs(cars[1])];
      for (let i = 0; i < 2; i++) {
        const other = 1 - i;
        const head = d[i].helmet;
        for (const key of ["rear", "front", "chassis"]) {
          const body = d[other][key];
          if (Math.hypot(body.x - head.x, body.y - head.y) < body.r + head.r) hits[i] = true;
        }
      }
      if (hits[0] && hits[1]) return "draw";
      if (hits[0]) return 1;              // car 0 was bonked, so car 1 scores
      if (hits[1]) return 0;
      return null;
    }
/* ===== PHYSICS END ===== */

    /* ---------------------------------------------------------------
     * Game state
     * ------------------------------------------------------------- */
    let cars = [], slabs = [], phase = "menu", score = [0, 0];
    let roundEndsAt = 0, msg = null, sparks = [], shake = 0, winner = null;

    function resetRound(arenaIdx) {
      slabs = buildArena(arenaIdx);
      const y = L.floor - 40 * L.scale;
      cars = [makeCar(0, W * 0.24, y), makeCar(1, W * 0.76, y)];
      cars[1].a = Math.PI;                 // face each other
      sparks = [];
      msg = { text: "GO", t: 0.8 };
      phase = "play";
      roundEndsAt = 0;
    }

    function newMatch() {
      score = [0, 0];
      winner = null;
      resetRound(settings.arena);
    }

    function burst(x, y, hex, n) {
      for (let i = 0; i < n; i++) {
        const a = Math.random() * TAU, sp = 60 + Math.random() * 260;
        sparks.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 60,
                      t: 0.4 + Math.random() * 0.4, max: 0.8, hex });
      }
    }

    async function awardPoint(who) {
      if (phase !== "play") return;
      phase = "point";
      const d = discs(cars[1 - who]);
      burst(d.helmet.x, d.helmet.y, P[who].css, 26);
      shake = 0.032;
      sound.duck(0.45, 320);
      sound.haptic("heavy");
      if (who === "draw") {
        msg = { text: "BOTH!", t: 1.4 };
        sound.sting("fail");
      } else {
        score[who]++;
        cars[1 - who].dead = true;
        msg = { text: P[who].name.toLowerCase() + " SCORES", t: 1.4 };
        sound.sting("coin");
        ctx.platform.setScore(Math.max(score[0], score[1]));
      }
      paintScore();

      if (who !== "draw" && score[who] >= settings.target) {
        phase = "over";
        winner = who;
        el("over-title").textContent = P[who].name + " wins";
        el("over-title").style.color = P[who].css;
        el("over-line").textContent = score[0] + " – " + score[1];
        el("over").style.display = "flex";
        sound.sting("win");
        ctx.platform.complete({ winner: who, score });
        // The margin this pair finished on, which belongs to the match rather
        // than to either of the two people playing it.
        try { await ctx.memory.record("win_margin").submit(Math.abs(score[0] - score[1]),
          { label: score[0] + "-" + score[1] }); } catch (_) {}
        return;
      }
      ctx.timeout(() => { if (phase === "point") resetRound(settings.arena); }, 1300);
    }

    /* ---------------------------------------------------------------
     * Drawing
     * ------------------------------------------------------------- */
    const canvas = ctx.createCanvas2D({ touchAction: "none" });
    const g = canvas.getContext("2d");

    function roundRect(q, x, y, w, h, r) {
      const k = Math.min(r, w / 2, h / 2);
      q.beginPath();
      q.moveTo(x + k, y);
      q.arcTo(x + w, y, x + w, y + h, k);
      q.arcTo(x + w, y + h, x, y + h, k);
      q.arcTo(x, y + h, x, y, k);
      q.arcTo(x, y, x + w, y, k);
      q.closePath();
    }

    function drawCar(c) {
      const s = L.scale;
      const col = P[c.side];
      g.save();
      g.translate(c.x, c.y);
      g.rotate(c.a);

      // Chassis: a chunky slab with a lighter deck, drawn in the car's own
      // frame so it rolls with the wheels.
      g.fillStyle = col.dark;
      roundRect(g, -c.wheelBase - 7 * s, -11 * s, (c.wheelBase + 7 * s) * 2, 22 * s, 5 * s);
      g.fill();
      g.fillStyle = col.css;
      roundRect(g, -c.wheelBase - 4 * s, -11 * s, (c.wheelBase + 4 * s) * 2, 13 * s, 4 * s);
      g.fill();
      g.fillStyle = "rgba(255,255,255,0.20)";
      roundRect(g, -c.wheelBase, -9 * s, c.wheelBase * 1.4, 4 * s, 2 * s);
      g.fill();

      // Wheels, with a spoke so the rotation is legible.
      for (const wx of [-c.wheelBase, c.wheelBase]) {
        g.fillStyle = "#1a1a22";
        g.beginPath(); g.arc(wx, 0, c.r, 0, TAU); g.fill();
        g.fillStyle = "#3a3a48";
        g.beginPath(); g.arc(wx, 0, c.r * 0.46, 0, TAU); g.fill();
        g.strokeStyle = "#6a6a80"; g.lineWidth = 2 * s;
        g.beginPath();
        g.moveTo(wx - c.r * 0.7, 0); g.lineTo(wx + c.r * 0.7, 0);
        g.stroke();
      }

      // The helmet, on a little neck. It is the target, so it gets a rim.
      g.strokeStyle = col.dark; g.lineWidth = 4 * s;
      g.beginPath(); g.moveTo(0, -11 * s); g.lineTo(0, -c.helmetUp + c.helmetR * 0.4); g.stroke();
      g.fillStyle = "#f2efe6";
      g.beginPath(); g.arc(0, -c.helmetUp, c.helmetR, 0, TAU); g.fill();
      g.fillStyle = col.css;
      g.beginPath(); g.arc(0, -c.helmetUp, c.helmetR, Math.PI, TAU); g.fill();
      g.strokeStyle = col.dark; g.lineWidth = 2.4 * s;
      g.beginPath(); g.arc(0, -c.helmetUp, c.helmetR, 0, TAU); g.stroke();
      g.restore();
    }

    // Note: there is no screen->logical pointer inverse here because there are
    // no raw canvas pointer handlers. Every control is a DOM button living
    // inside the rotated root, so the browser has already done that transform.

    function paint() {
      g.save();
      // The one quarter turn. Logical (x,y) lands at screen (SW - y, x).
      g.translate(SW, 0);
      g.rotate(Math.PI / 2);
      if (shake > 0.0004) g.translate((Math.random() - 0.5) * shake * W, (Math.random() - 0.5) * shake * W);

      const sky = g.createLinearGradient(0, 0, 0, L.floor);
      sky.addColorStop(0, "#1a1030");
      sky.addColorStop(0.55, "#3b1c4a");
      sky.addColorStop(1, "#7b3350");
      g.fillStyle = sky;
      g.fillRect(0, 0, W, H);

      if (phase !== "menu") {
        /* The two end walls.
         *
         * The arena has always been enclosed — a car that reaches either end
         * bounces off it — but nothing was ever drawn there, so the ground
         * simply stopped in mid-air and the car appeared to bounce off
         * nothing. It read as a drop-off you were somehow not falling down.
         * They are posts in the same material as the slabs, so the enclosure
         * is visible and the bounce has something to bounce off.
         */
        const post = Math.max(5, 7 * L.scale);
        for (const wx of [L.wallL - post, L.wallR]) {
          g.fillStyle = "#2a1a2e";
          roundRect(g, wx, L.top - 4, post, L.floor - L.top + 44, 3);
          g.fill();
          g.fillStyle = "#c9743f";
          roundRect(g, wx, L.top - 4, post, 7, 3);
          g.fill();
          g.fillStyle = "rgba(255,220,180,0.14)";
          g.fillRect(wx, L.top - 4, 2, L.floor - L.top + 44);
        }
        for (const s of slabs) {
          g.fillStyle = "#2a1a2e";
          roundRect(g, s.x, s.y, s.w, s.h, 4);
          g.fill();
          g.fillStyle = "#c9743f";
          roundRect(g, s.x, s.y, s.w, Math.min(s.h, 7), 3);
          g.fill();
          g.fillStyle = "rgba(255,220,180,0.22)";
          g.fillRect(s.x, s.y, s.w, 2);
        }
        for (const c of cars) if (!c.dead) drawCar(c);
        for (const p of sparks) {
          const t = p.t / p.max;
          g.globalAlpha = clamp(t, 0, 1);
          g.fillStyle = p.hex;
          g.fillRect(p.x - 2.5, p.y - 2.5, 5, 5);
        }
        g.globalAlpha = 1;
        if (msg && msg.t > 0) {
          g.globalAlpha = clamp(msg.t, 0, 1);
          g.fillStyle = "#fff4e0";
          g.font = "900 " + (34 * L.scale) + "px Inter,-apple-system,system-ui,'Segoe UI',Roboto,sans-serif";
          g.textAlign = "center"; g.textBaseline = "middle";
          // Cream on the lit plank is 2.6:1, and on a short card the count-in
          // lands squarely on one. Carry its own ground rather than a plate,
          // which would sit over the arena for the whole second it is up.
          g.lineJoin = "round";
          g.lineWidth = 6 * L.scale;
          g.strokeStyle = "rgba(10,6,16,0.86)";
          g.strokeText(msg.text, W / 2, L.top + 70 * L.scale);
          g.fillText(msg.text, W / 2, L.top + 70 * L.scale);
          g.globalAlpha = 1;
        }
      }
      // The thumb strip, so it reads as part of the machine.
      g.fillStyle = "#140d1c";
      g.fillRect(0, L.padY - 8, W, H - L.padY + 8);
      g.restore();
    }

    /* ---------------------------------------------------------------
     * Overlay. Two fat buttons per player, each pair anchored in that
     * player's own bottom corner. Both players sit along the same edge
     * with a hand on their own end of the phone, so their thumbs stay in
     * their own corner and their forearms never meet in the middle.
     * ------------------------------------------------------------- */
    const FONT = "Inter,-apple-system,system-ui,'Segoe UI',Roboto,sans-serif";
    const ST = 10, SB = 10;   // landscape: the notch and home bar are now side insets
    const BIG = "width:100%;padding:15px;border:none;border-radius:15px;font-family:inherit;" +
      "font-size:16px;font-weight:800;";
    const BTN = "pointer-events:auto;width:34px;height:34px;border-radius:11px;border:none;" +
      "background:rgba(255,255,255,0.14);color:#fff4e0;font-size:14px;font-family:inherit;padding:0;";

    function padMarkup(side) {
      const col = P[side];
      const edge = side === 0 ? "left:12px;" : "right:12px;";
      return '<div style="position:absolute;' + edge + 'bottom:' + (SB + 12) + 'px;' +
        'display:flex;gap:10px;pointer-events:none;">' +
        ["back", "fwd"].map((dir) =>
          '<button data-el="' + col.name + "-" + dir + '" aria-label="' + col.name + ' ' + dir + '" ' +
          'style="pointer-events:auto;width:74px;height:74px;border-radius:22px;border:3px solid ' +
          col.dark + ';background:' + col.css + '22;color:' + col.css + ';font-size:26px;' +
          'font-family:inherit;font-weight:900;padding:0;touch-action:none;">' +
          (dir === "back" ? "◀" : "▶") + '</button>').join("") +
      '</div>';
    }

    const root = ctx.createRoot({ touchAction: "none" });
    root.style.cssText += ";font-family:" + FONT + ";color:#fff4e0;pointer-events:none;text-transform:lowercase;";

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
    // The overlay turns with the game. Sized to the LOGICAL landscape box and
    // rotated a quarter turn about its own origin, so every coordinate written
    // below is landscape and matches what the canvas draws underneath it.
    function layoutRoot() {
      root.style.width = W + "px";
      root.style.height = H + "px";
      root.style.inset = "auto";
      root.style.left = "0px";
      root.style.top = "0px";
      root.style.transformOrigin = "0 0";
      root.style.transform = "translate(" + SW + "px,0) rotate(90deg)";
    }
    layoutRoot();
    root.innerHTML =
      padMarkup(0) + padMarkup(1) +
      '<div data-el="score" style="position:absolute;left:0;right:0;top:' + (ST + 8) + 'px;' +
        'text-align:center;pointer-events:none;font-size:26px;font-weight:900;"></div>' +
      // Centred in the pad strip, between the two players' buttons. This was a
      // fixed 104px off the bottom, which sat in the strip while the strip was
      // a fixed 168 tall and landed on the arena floor the moment it was not.
      '<div style="position:absolute;left:0;right:0;bottom:' + (SB + Math.round(L.padH / 2) - 22) +
        'px;display:flex;gap:8px;justify-content:center;z-index:40;pointer-events:none;">' +
        '<button data-el="mute" aria-label="Sound" style="' + BTN + '">' + SPK(true) + '</button>' +
        '<button data-el="cog" aria-label="Settings" style="' + BTN + '">⚙</button>' +
        '<button data-el="help" aria-label="How to play" style="' + BTN + '">?</button>' +
      '</div>' +
      // Opaque, not 0.93: the drive pads, the three chrome keys and the 0-0
      // score all sit under this and came through as coloured smudges that read
      // as a broken screen rather than as a dimmed one.
      '<div data-el="menu" style="position:absolute;inset:0;pointer-events:auto;display:flex;' +
        'align-items:center;justify-content:center;gap:30px;background:#0E0816;' +
        'z-index:50;padding:18px 26px;">' +
        // Two columns. A landscape view is 390px tall, and the portrait stack
        // ran off the bottom and took the start button with it.
        '<div style="flex:1;max-width:330px;text-align:right;">' +
          '<div data-el="rotate" style="display:flex;justify-content:flex-end;margin-bottom:2px;">' +
            '<svg width="46" height="46" viewBox="0 0 62 62" aria-hidden="true">' +
              '<rect x="20" y="6" width="22" height="38" rx="4" fill="none" ' +
                'stroke="rgba(255,244,224,0.85)" stroke-width="2.5">' +
                '<animateTransform attributeName="transform" type="rotate" ' +
                  'values="0 31 31; 0 31 31; -90 31 31; -90 31 31" ' +
                  'keyTimes="0; 0.35; 0.7; 1" dur="2.4s" repeatCount="indefinite"/>' +
              '</rect>' +
              '<path d="M14 52 a18 18 0 0 1 34 0" fill="none" stroke="#ff5a45" ' +
                'stroke-width="2.5" stroke-linecap="round" opacity="0.9"/>' +
              '<path d="M44 46 l5 6 -7 3 z" fill="#ff5a45"/>' +
            '</svg>' +
          '</div>' +
          '<div style="font-size:10.5px;letter-spacing:0.28em;text-transform:lowercase;' +
            'color:#ff5a45;opacity:0.9;">Turn the phone sideways</div>' +
          '<div style="font-size:40px;font-weight:900;letter-spacing:-0.02em;line-height:1.04;' +
            'margin:4px 0 6px;background:linear-gradient(96deg,#ff5a45,#4cc9f0);' +
            '-webkit-background-clip:text;background-clip:text;' +
            '-webkit-text-fill-color:transparent;">Helmet Derby</div>' +
          '<div style="font-size:13px;opacity:0.8;line-height:1.5;">' +
            'Sit side by side, two buttons each in your own corner. Touch the other ' +
            'car\'s helmet with any part of yours and the point is yours.</div>' +
        '</div>' +
        '<div style="flex:0 0 auto;display:flex;flex-direction:column;gap:7px;align-items:stretch;' +
          'min-width:196px;">' +
          '<div style="font-size:10px;letter-spacing:0.22em;text-transform:lowercase;opacity:0.72;">First to</div>' +
          '<div data-el="tc" style="display:flex;gap:7px;"></div>' +
          '<div style="font-size:10px;letter-spacing:0.22em;text-transform:lowercase;opacity:0.72;margin-top:5px;">Arena</div>' +
          '<div data-el="ac" style="display:flex;gap:7px;"></div>' +
          '<button data-el="go" style="' + BIG + 'margin-top:11px;' +
            'background:linear-gradient(96deg,#ff5a45,#4cc9f0);color:#140d1c;">Start</button>' +
        '</div>' +
      '</div>' +
      '<div data-el="over" style="position:absolute;inset:0;pointer-events:auto;display:none;' +
        'flex-direction:column;align-items:center;justify-content:center;gap:5px;' +
        'background:#0E0816;z-index:55;padding:26px;text-align:center;">' +
        '<div data-el="over-title" style="font-size:42px;font-weight:900;"></div>' +
        '<div data-el="over-line" style="font-size:16px;opacity:0.75;"></div>' +
        '<button data-el="again" style="' + BIG + 'max-width:230px;margin-top:22px;' +
          'background:rgba(255,255,255,0.16);color:#fff4e0;">Rematch</button>' +
      '</div>' +
      '<div data-el="cogp" style="position:absolute;inset:0;pointer-events:auto;display:none;' +
        'align-items:center;justify-content:center;background:rgba(14,8,22,0.94);z-index:70;padding:22px;">' +
        '<div style="max-width:320px;width:100%;background:rgba(30,18,42,0.98);border-radius:20px;' +
          'padding:22px;border:1px solid rgba(255,255,255,0.10);box-sizing:border-box;' +
          'max-height:100%;display:flex;flex-direction:column;">' +
          '<div style="font-size:19px;font-weight:800;margin-bottom:14px;flex:none;">Settings</div>' +
          // The options scroll; the heading and Done do not. A landscape card
          // is 306px tall and this panel wants 327, so a plain overflow on the
          // whole card put Done below the fold — the one control that has to
          // be on screen.
          '<div style="overflow-y:auto;min-height:0;flex:1 1 auto;">' +
            '<div style="font-size:11px;letter-spacing:0.2em;text-transform:lowercase;opacity:0.72;">First to</div>' +
            '<div data-el="tc2" style="display:flex;gap:8px;margin:9px 0 16px;"></div>' +
            '<div style="font-size:11px;letter-spacing:0.2em;text-transform:lowercase;opacity:0.72;">Arena</div>' +
            '<div data-el="ac2" style="display:flex;gap:8px;margin:9px 0 4px;"></div>' +
          '</div>' +
          '<button data-el="cogp-close" style="' + BIG + 'margin-top:18px;flex:none;' +
            'background:rgba(255,255,255,0.18);color:#fff4e0;">Done</button>' +
        '</div>' +
      '</div>' +
      '<div data-el="helpp" style="position:absolute;inset:0;pointer-events:auto;display:none;' +
        'align-items:center;justify-content:center;background:rgba(14,8,22,0.94);z-index:70;padding:22px;">' +
        '<div style="max-width:330px;width:100%;background:rgba(30,18,42,0.98);border-radius:20px;' +
          'padding:22px;border:1px solid rgba(255,255,255,0.10);box-sizing:border-box;' +
          'max-height:100%;display:flex;flex-direction:column;">' +
          '<div style="font-size:19px;font-weight:800;margin-bottom:11px;flex:none;">How to play</div>' +
          '<ul style="font-size:14px;line-height:1.7;opacity:0.9;padding-left:18px;margin:0;' +
            'overflow-y:auto;min-height:0;flex:1 1 auto;">' +
            '<li><b>Turn the phone sideways.</b> It gives the two of you twice the edge to hold.</li>' +
            '<li>Sit <b>side by side</b>, each holding your own end.</li>' +
            '<li>Your two buttons are in your own bottom corner. Nothing is mirrored — ' +
              '◀ is always left and ▶ is always right, for both of you.</li>' +
            '<li>On the ground the buttons drive you. <b>In the air they spin you</b>, which is how you land on someone.</li>' +
            '<li>Touch the other car\'s <b>helmet</b> with any part of your car to take the point.</li>' +
            '<li>Both of you at once is a double knockout and scores for nobody.</li>' +
          '</ul>' +
          '<button data-el="helpp-close" style="' + BIG + 'margin-top:16px;flex:none;' +
            'background:rgba(255,255,255,0.18);color:#fff4e0;">Got it</button>' +
        '</div>' +
      '</div>';

    const el = (n) => root.querySelector('[data-el="' + n + '"]');
    const tap = (node, fn) => {
      if (!node) return;
      ctx.listen(node, "pointerdown", (e) => e.stopPropagation());
      ctx.listen(node, "click", (e) => { e.stopPropagation(); e.preventDefault(); fn(e); });
    };
    tap(el("mute"), (e) => { e.target.innerHTML = SPK(!sound.toggle()); });
    if (settings.mute) el("mute").innerHTML = SPK(false);
    tap(el("cog"), () => { el("cogp").style.display = "flex"; });
    tap(el("cogp-close"), () => { el("cogp").style.display = "none"; });
    tap(el("help"), () => { el("helpp").style.display = "flex"; });
    tap(el("helpp-close"), () => { el("helpp").style.display = "none"; });

    /**
     * The drive buttons are held, not tapped, so they bind on pointerdown
     * and release on up OR cancel. Without pointercancel a thumb that
     * slides off the button leaves the car driving forever.
     */
    for (const side of [0, 1]) {
      for (const [dir, val] of [["back", -1], ["fwd", 1]]) {
        const b = el(P[side].name + "-" + dir);
        if (!b) continue;
        const down = async (e) => {
          e.preventDefault(); e.stopPropagation();
          await sound.unlock();
          if (cars[side]) cars[side].drive = val;
          b.style.background = P[side].css + "55";
        };
        const up = (e) => {
          e.stopPropagation();
          if (cars[side] && cars[side].drive === val) cars[side].drive = 0;
          b.style.background = P[side].css + "22";
        };
        ctx.listen(b, "pointerdown", down, { passive: false });
        ctx.listen(b, "pointerup", up);
        ctx.listen(b, "pointercancel", up);
        ctx.listen(b, "pointerleave", up);
      }
    }

    function pills(host, values, labels, get, set) {
      host.innerHTML = values.map((v, i) =>
        '<button data-v="' + v + '" style="padding:11px 15px;border:none;border-radius:12px;' +
        'font-family:inherit;font-size:14px;font-weight:800;">' + labels[i] + '</button>').join("");
      const paint2 = () => {
        for (const b of host.querySelectorAll("button")) {
          const on = String(get()) === b.dataset.v;
          b.style.background = on ? "rgba(255,255,255,0.30)" : "rgba(255,255,255,0.10)";
          // The unchosen options were 0.55 cream on an 0.08 white plate: two
          // greys a shade apart, on a panel that has no other colour on it.
          b.style.color = on ? "#fff" : "rgba(255,244,224,0.82)";
        }
      };
      for (const b of host.querySelectorAll("button")) {
        tap(b, () => { set(b.dataset.v); saveSettings(); paint2(); sound.haptic("light"); });
      }
      paint2();
    }
    for (const id of ["tc", "tc2"]) {
      pills(el(id), [3, 5, 9], ["3", "5", "9"], () => settings.target,
            (v) => { settings.target = Number(v); });
    }
    for (const id of ["ac", "ac2"]) {
      pills(el(id), [0, 1, 2], ARENA_NAMES, () => settings.arena,
            (v) => { settings.arena = Number(v); if (phase === "play") resetRound(settings.arena); });
    }

    function paintScore() {
      el("score").innerHTML =
        '<span style="color:' + P[0].css + ';">' + score[0] + '</span>' +
        '<span style="opacity:0.55;font-size:18px;"> — </span>' +
        '<span style="color:' + P[1].css + ';">' + score[1] + '</span>';
    }

    const begin = async () => {
      ctx.platform.start();
      await sound.unlock();
      el("menu").style.display = "none";
      el("over").style.display = "none";
      newMatch();
      paintScore();
      sound.sting("powerup");
    };
    tap(el("go"), begin);
    tap(el("again"), begin);

    /* ---------------------------------------------------------------
     * Frame
     * ------------------------------------------------------------- */
    ctx.onFrame((dtMs) => {
      const dt = Math.min(dtMs, 34) / 1000;
      if (shake > 0.0004) shake *= Math.pow(0.004, dt);
      if (msg) { msg.t -= dt; if (msg.t <= 0) msg = null; }
      for (let i = sparks.length - 1; i >= 0; i--) {
        const p = sparks[i];
        p.t -= dt;
        if (p.t <= 0) { sparks.splice(i, 1); continue; }
        p.vy += GRAV * 0.55 * dt;
        p.x += p.vx * dt; p.y += p.vy * dt;
      }

      if (phase === "play") {
        // Two fixed substeps: the cars are fast and a single big step at a low
        // frame rate lets a wheel pass straight through a slab.
        step(cars, slabs, dt / 2);
        step(cars, slabs, dt / 2);
        const who = bonk(cars);
        if (who !== null) awardPoint(who);
      }
      paint();
    });

    ctx.listen(window, "resize", () => {
      if (ctx.width === W && ctx.height === H) return;
      measure();
      layoutRoot();
      if (phase === "play") resetRound(settings.arena);
    });

    // A read-only window for the local harness.
    window.__DERBY__ = {
      get phase() { return phase; },
      get score() { return score.slice(); },
      get winner() { return winner; },
      get cars() { return cars.map((c) => ({ x: Math.round(c.x), y: Math.round(c.y),
        a: +c.a.toFixed(2), drive: c.drive, dead: c.dead, grounded: c.grounded })); },
      /** Drop one car straight onto the other's head, to prove the bonk fires. */
      forceBonk() {
        if (phase !== "play") return false;
        const b = cars[1];
        cars[0].x = b.x; cars[0].y = b.y - b.helmetUp - 2;
        cars[0].a = 0; cars[0].vx = 0; cars[0].vy = 0;
        return true;
      },
    };
    ctx.onDestroy(() => { try { delete window.__DERBY__; } catch (_) {} });

    paintScore();
    paint();
    ctx.markVisualReady("arena up");
    ctx.platform.ready();
  },
};
