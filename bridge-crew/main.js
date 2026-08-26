/**
 * Bridge Crew — a co-op panic panel for two to four people, one phone.
 *
 * This is NOT a port of Spaceteam, and it would be dishonest to pretend
 * otherwise. Spaceteam works because you can SEE an order you cannot execute
 * and CANNOT SEE the control you must operate — and a single shared screen
 * fundamentally cannot provide that. Everything on this phone is visible to
 * everyone sitting round it, and no amount of rotation or small type changes
 * that: thirty-pixel type upside down at arm's length is newspaper-headline
 * size. Build it that way and within two minutes the table works out that the
 * fastest strategy is to read silently and point, and the shouting the game
 * exists for is optimised away.
 *
 * So the asymmetry is put back somewhere a shared screen can actually hold it.
 * Instead of hiding INFORMATION, this partitions CAPABILITY: every control on
 * the panel belongs to exactly one crew member, and only its owner may touch
 * it. You can read every order on the board — and most of them are for somebody
 * else's hands. The shouting comes back on its own, because the person who
 * reads an order is usually not the person who can carry it out.
 *
 * Everything else follows from that. Orders arrive faster than one person can
 * serve, several run at once, and each carries its own clock, so the pressure
 * is volume and coordination rather than secrecy.
 *
 * Contract notes: capped at four players because a phone reports at most five
 * simultaneous touches and never delivers the sixth. No packaged assets
 * (maxAssets is 0) — every switch, dial and lever is a canvas path. The overlay
 * is markup on ctx.createRoot() with pointer-events off on the root itself.
 */
window.plethoraBit = {
  meta: {
    title: "Bridge Crew",
    runtime: "plethora-bit@2",
    tags: ["co-op", "multiplayer", "local-multiplayer", "party", "frantic"],
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
    const esc = (s) => String(s).replace(/[&<>"']/g,
      (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    const shuffle = (a) => {
      for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
      }
      return a;
    };
    const pickOne = (a) => a[Math.floor(Math.random() * a.length)];

    /* ---------------------------------------------------------------
     * Names. Deliberately similar to each other, so an order has to be
     * read out carefully rather than glanced at — that is where the
     * shouting lives.
     * ------------------------------------------------------------- */
    const HEADS = ["FLUX", "ION", "GRAV", "PLASMA", "CRYO", "QUANTUM", "NEUTRON", "PHASE",
                   "TACHYON", "MAGNETO", "SOLAR", "VOID", "PULSE", "HYPER", "OMEGA", "DELTA"];
    const TAILS = ["CAPACITOR", "INJECTOR", "MANIFOLD", "COUPLING", "REGULATOR", "DAMPENER",
                   "SCRUBBER", "IGNITER", "BAFFLE", "GOVERNOR", "LATTICE", "CONDUIT",
                   "THRUSTER", "SIPHON", "GIMBAL", "ARRAY"];

    const CREW = [
      { css: "#ff4d6d", name: "Red" },
      { css: "#3ddc97", name: "Green" },
      { css: "#4cc9f0", name: "Blue" },
      { css: "#ffd166", name: "Amber" },
    ];

    /* ---------------------------------------------------------------
     * Settings and sound
     * ------------------------------------------------------------- */
    const saved = (function () {
      try { return ctx.storage.get("bridgecrew") || {}; } catch (_) { return {}; }
    })();
    const settings = { players: clamp(saved.players || 3, 2, 4), mute: !!saved.mute };
    function saveSettings() { try { ctx.storage.set("bridgecrew", settings); } catch (_) {} }

    const sound = (function () {
      let muted = settings.mute, bed = null, unlocked = false;
      const start = () => ctx.music.play({ preset: "techno", volume: 0.3, tempo: 118, intensity: 0.35 });
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
        tempo(b) { if (!muted && bed) { try { bed.setTempo(b); } catch (_) {} } },
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
     * Controls.
     *
     * Five kinds, chosen so an order can never be carried out by
     * accident: a switch has to end in the named position, a dial on the
     * named number, a lever held for a real second. Every control
     * belongs to exactly one crew member and refuses anybody else.
     * ------------------------------------------------------------- */
    const KINDS = ["switch", "dial", "slider", "button", "lever"];

    function makeControl(owner, kind, name) {
      const c = { owner, kind, name, value: 0, target: null, held: 0, flash: 0, x: 0, y: 0, w: 0, h: 0 };
      if (kind === "switch") c.value = 0;                       // 0 down, 1 up
      if (kind === "dial") c.value = 1 + Math.floor(Math.random() * 5);   // 1..5
      if (kind === "slider") c.value = Math.floor(Math.random() * 4);     // 0..3
      return c;
    }

    /** The order this control would generate, and what satisfies it. */
    function orderFor(c) {
      if (c.kind === "switch") {
        const want = c.value ? 0 : 1;
        return { text: (want ? "RAISE " : "DROP ") + c.name, want };
      }
      if (c.kind === "dial") {
        let want = 1 + Math.floor(Math.random() * 5);
        if (want === c.value) want = (want % 5) + 1;
        return { text: "SET " + c.name + " TO " + want, want };
      }
      if (c.kind === "slider") {
        let want = Math.floor(Math.random() * 4);
        if (want === c.value) want = (want + 1) % 4;
        return { text: "SLIDE " + c.name + " TO " + "▁▃▅▇"[want], want };
      }
      if (c.kind === "button") return { text: "PRIME " + c.name, want: 1 };
      return { text: "HOLD " + c.name, want: 1 };                // lever
    }

    /* ---------------------------------------------------------------
     * Layout. Two bands, top and bottom, each optionally split in two.
     * Rotation is 0 or 180 only — a quarter turn cannot fit a panel of
     * controls into a portrait phone's width.
     * ------------------------------------------------------------- */
    let W = ctx.width, H = ctx.height;
    const L = {};
    function measure() {
      W = ctx.width; H = ctx.height;
      // The middle band carries up to three order rows and the hull bar, and
      // it used to be given 97px to do it in — the third row ran out of the
      // band and into the console below. Reserve what the rows actually need,
      // then let the consoles have the rest.
      const need = 6 + 3 * 34 + 2 * 6 + 22;          // rows, gaps, hull bar
      L.topY = ctx.safeArea.top + 6;
      const free = H - L.topY - (ctx.safeArea.bottom + 6) - need - 20;
      L.bandH = Math.max(160, free / 2);
      L.botY = H - ctx.safeArea.bottom - 6 - L.bandH;
      L.orderY = L.topY + L.bandH + 10;
      L.orderH = L.botY - L.orderY - 10;
      // How many rows actually fit, and how tall. On a short phone this shows
      // two and counts the rest, rather than drawing three that do not fit.
      L.rowH = Math.min(38, Math.max(24, (L.orderH - 28 - 12) / 3));
      L.rows = Math.max(1, Math.min(3, Math.floor((L.orderH - 22) / (L.rowH + 6))));
    }
    measure();

    /**
     * Where each crew member's console sits.
     *   2 players: one full-width band each, facing each other.
     *   3: the near edge is shared by two, the far edge has one.
     *   4: both edges shared.
     * Everything on the far edge is drawn rotated 180 so it reads from
     * that side of the table.
     */
    function consoles(n) {
      const near = n >= 3 ? 2 : 1;
      const far = n - near;
      const out = [];
      for (let i = 0; i < near; i++) {
        out.push({ rot: 0, x: (W / near) * i, y: L.botY, w: W / near, h: L.bandH });
      }
      for (let i = 0; i < far; i++) {
        out.push({ rot: Math.PI, x: (W / far) * i, y: L.topY, w: W / far, h: L.bandH });
      }
      return out;
    }

    /* ---------------------------------------------------------------
     * State
     * ------------------------------------------------------------- */
    let crew = [], controls = [], orders = [], phase = "menu";
    let hull = 100, wave = 1, served = 0, missed = 0, startedAt = 0;
    let spawnAt = 0, shake = 0, banner = null;

    const PER_CONSOLE = 4;

    /* Width kept clear down the left of the order band for the chrome
     * column, which is pinned to the middle of that same edge. */
    const GUTTER = 46;

    function startGame(n) {
      const boxes = consoles(n);
      crew = [];
      controls = [];
      const heads = shuffle(HEADS.slice()), tails = shuffle(TAILS.slice());
      let nameAt = 0;
      for (let i = 0; i < n; i++) {
        crew.push(Object.assign({ i }, CREW[i], { box: boxes[i] }));
        const kinds = shuffle(KINDS.slice()).slice(0, PER_CONSOLE);
        // Always give every console at least one of each interaction shape it
        // can get, so no crew member ends up with four identical widgets.
        for (let k = 0; k < PER_CONSOLE; k++) {
          const nm = heads[nameAt % heads.length] + " " + tails[(nameAt * 7 + i) % tails.length];
          nameAt++;
          controls.push(makeControl(i, kinds[k % kinds.length], nm));
        }
      }
      layoutControls();
      orders = [];
      hull = 100; wave = 1; served = 0; missed = 0;
      startedAt = performance.now();
      spawnAt = performance.now() + 600;
      phase = "play";
      banner = { text: "WAVE 1", t: 1.4 };
    }

    function layoutControls() {
      for (const c of crew) {
        const mine = controls.filter((x) => x.owner === c.i);
        const b = c.box;
        const cols = 2, rows = Math.ceil(mine.length / cols);
        const pad = 10;
        const cw = (b.w - pad * (cols + 1)) / cols;
        const ch = (b.h - pad * (rows + 1)) / rows;
        mine.forEach((ctl, i) => {
          ctl.x = b.x + pad + (i % cols) * (cw + pad);
          ctl.y = b.y + pad + Math.floor(i / cols) * (ch + pad);
          ctl.w = cw; ctl.h = ch;
          ctl.rot = b.rot;
        });
      }
    }

    function spawnOrder() {
      // Never two live orders on one control: the second would be
      // unservable and would read as the game cheating.
      const busy = new Set(orders.map((o) => o.control));
      const free = controls.filter((c) => !busy.has(c));
      if (!free.length) return;
      const c = pickOne(free);
      const spec = orderFor(c);
      c.target = spec.want;
      const life = Math.max(4.2, 11 - wave * 0.72);
      // Clocks are anchored to real timestamps, never accumulated from frame
      // deltas. dt is clamped so a stall cannot jump the game, but an
      // accumulated clock inherits that clamp: at a low frame rate every
      // countdown, and the spawn interval with it, silently runs in slow
      // motion. An order that says eight seconds has to mean eight seconds.
      orders.push({ control: c, text: spec.text, want: spec.want,
                    life, expiresAt: performance.now() + life * 1000 });
    }

    /** Did this control just satisfy its order? */
    function checkOrder(c) {
      const o = orders.find((x) => x.control === c);
      if (!o) return;
      const done = (c.kind === "lever") ? c.held >= 1 : c.value === o.want;
      if (!done) return;
      orders.splice(orders.indexOf(o), 1);
      c.target = null;
      c.flash = 0.5;
      served++;
      sound.sting("coin");
      sound.haptic("success");
      ctx.platform.interact({ type: "served" });
      // Every eight orders the ship pushes harder.
      if (served % 8 === 0) {
        wave++;
        banner = { text: "WAVE " + wave, t: 1.2 };
        sound.sting("powerup");
        sound.tempo(118 + wave * 5);
      }
    }

    function missOrder(o) {
      orders.splice(orders.indexOf(o), 1);
      o.control.target = null;
      missed++;
      hull -= 10;   // ten misses sinks you
      shake = 0.03;
      sound.duck(0.4, 260);
      sound.sting("danger");
      sound.haptic("error");
      ctx.platform.emit("hull_hit", { hull });
      if (hull <= 0) end();
    }

    async function end() {
      phase = "over";
      hull = Math.max(hull, 0);
      const secs = (performance.now() - startedAt) / 1000;
      el("over-served").textContent = String(served);
      el("over-line").textContent =
        "wave " + wave + " · " + missed + " missed · " + secs.toFixed(0) + "s";
      el("over").style.display = "flex";
      el("chrome").style.display = "none";
      sound.duck(0.55, 500);
      sound.sting("lose");
      sound.haptic("error");
      ctx.platform.setScore(served);
      ctx.platform.complete({ served, wave, missed });
      // What this crew got through together, which is the only score a co-op
      // game should be putting on a board.
      try { await ctx.memory.record("orders_served").submit(served, { label: served + " orders" }); }
      catch (_) {}
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

    function drawControl(c) {
      const owner = crew[c.owner];
      const live = c.target !== null;
      g.save();
      // Each control is drawn in its owner's rotation, so a crew member on the
      // far edge reads their own labels the right way up.
      g.translate(c.x + c.w / 2, c.y + c.h / 2);
      g.rotate(c.rot);
      g.translate(-c.w / 2, -c.h / 2);

      roundRect(g, 0, 0, c.w, c.h, 10);
      g.fillStyle = "rgba(255,255,255,0.05)";
      g.fill();
      g.strokeStyle = live ? owner.css : "rgba(255,255,255,0.13)";
      g.lineWidth = live ? 2.4 : 1;
      g.stroke();
      if (c.flash > 0) {
        g.fillStyle = "rgba(61,220,151," + (c.flash * 0.5).toFixed(3) + ")";
        roundRect(g, 0, 0, c.w, c.h, 10);
        g.fill();
      }
      // A colour tab so a glance says whose console this is.
      g.fillStyle = owner.css;
      roundRect(g, 6, 5, 16, 3.5, 2);
      g.fill();

      g.fillStyle = "rgba(240,246,255,0.86)";
      g.font = "700 " + Math.min(10.5, c.w * 0.108) + "px Inter,-apple-system,system-ui,'Segoe UI',Roboto,sans-serif";
      g.textAlign = "center"; g.textBaseline = "top";
      const words = c.name.split(" ");
      g.fillText(words[0], c.w / 2, 12);
      g.fillText(words[1], c.w / 2, 24);

      // The name always takes two fixed lines at the top, so the widget gets
      // what is left underneath rather than a fraction of the whole console.
      // Anchored at 0.66 of the height it fits a phone and, on the much
      // shorter card the app embeds a bit in, drives a dial's arc straight
      // through the second line of the name. 0.9 is the tallest half-extent
      // any of the widgets below draws.
      const NAME_B = 36;
      const cx = c.w / 2;
      const cy = NAME_B + (c.h - NAME_B) / 2;
      const s = Math.min(Math.min(c.w, c.h) * 0.34, (c.h - NAME_B) / 2 / 0.9);
      if (c.kind === "switch") {
        roundRect(g, cx - s * 0.42, cy - s * 0.9, s * 0.84, s * 1.8, s * 0.42);
        g.fillStyle = "rgba(0,0,0,0.45)"; g.fill();
        g.fillStyle = c.value ? "#3ddc97" : "#63708a";
        g.beginPath();
        g.arc(cx, cy + (c.value ? -s * 0.45 : s * 0.45), s * 0.36, 0, TAU);
        g.fill();
      } else if (c.kind === "dial") {
        g.strokeStyle = "rgba(0,0,0,0.45)"; g.lineWidth = s * 0.30;
        g.beginPath(); g.arc(cx, cy, s * 0.72, Math.PI * 0.75, Math.PI * 2.25); g.stroke();
        const a = Math.PI * 0.75 + ((c.value - 1) / 4) * Math.PI * 1.5;
        g.strokeStyle = owner.css; g.lineWidth = s * 0.22;
        g.beginPath(); g.arc(cx, cy, s * 0.72, Math.PI * 0.75, a); g.stroke();
        g.fillStyle = "#f0f6ff";
        g.font = "800 " + (s * 0.86) + "px Inter,-apple-system,system-ui,'Segoe UI',Roboto,sans-serif";
        g.textAlign = "center"; g.textBaseline = "middle";
        g.fillText(String(c.value), cx, cy + s * 0.04);
      } else if (c.kind === "slider") {
        const tw = c.w * 0.62, tx = cx - tw / 2;
        roundRect(g, tx, cy - s * 0.22, tw, s * 0.44, s * 0.22);
        g.fillStyle = "rgba(0,0,0,0.45)"; g.fill();
        const kx = tx + (tw / 3) * c.value;
        g.fillStyle = owner.css;
        roundRect(g, kx - s * 0.24, cy - s * 0.44, s * 0.48, s * 0.88, s * 0.2);
        g.fill();
      } else if (c.kind === "button") {
        g.beginPath(); g.arc(cx, cy, s * 0.78, 0, TAU);
        g.fillStyle = live ? owner.css : "rgba(255,255,255,0.10)";
        g.fill();
        g.strokeStyle = "rgba(0,0,0,0.4)"; g.lineWidth = 2; g.stroke();
      } else {
        // Lever: a bar that fills while it is held.
        roundRect(g, cx - s * 0.62, cy - s * 0.85, s * 1.24, s * 1.7, 6);
        g.fillStyle = "rgba(0,0,0,0.45)"; g.fill();
        const f = clamp(c.held, 0, 1);
        roundRect(g, cx - s * 0.56, cy + s * 0.79 - s * 1.58 * f, s * 1.12, s * 1.58 * f, 5);
        g.fillStyle = owner.css; g.fill();
      }
      g.restore();
    }

    function paint() {
      g.save();
      if (shake > 0.0004) g.translate((Math.random() - 0.5) * shake * W, (Math.random() - 0.5) * shake * W);

      const grad = g.createLinearGradient(0, 0, 0, H);
      grad.addColorStop(0, "#0a1020");
      grad.addColorStop(0.5, "#0d1830");
      grad.addColorStop(1, "#0a1020");
      g.fillStyle = grad;
      g.fillRect(0, 0, W, H);
      if (phase === "menu") { g.restore(); return; }

      // Hull damage bleeds red in from the edges.
      const hurt = 1 - hull / 100;
      if (hurt > 0.02) {
        const v = g.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.28, W / 2, H / 2, Math.max(W, H) * 0.7);
        v.addColorStop(0, "rgba(255,60,60,0)");
        v.addColorStop(1, "rgba(255,40,40," + (hurt * 0.42).toFixed(3) + ")");
        g.fillStyle = v;
        g.fillRect(0, 0, W, H);
      }

      for (const c of controls) drawControl(c);
      drawOrders();
      drawHull();
      drawBanner();
      g.restore();
    }

    /**
     * The order board.
     *
     * Everybody can read all of it — that is the point. What they cannot do is
     * carry out somebody else's order, so each row is stamped with the colour
     * of the crew member whose hands it needs.
     */
    function drawOrders() {
      const rowH = L.rowH;
      // The chrome column is pinned to the middle of the left edge, which is
      // this band — so the rows start after it rather than under it.
      const n = Math.min(orders.length, L.rows);
      for (let i = 0; i < n; i++) {
        const o = orders[i];
        const owner = crew[o.control.owner];
        const y = L.orderY + 6 + i * (rowH + 6);
        const w = W - 26 - GUTTER;
        roundRect(g, 13 + GUTTER, y, w, rowH, 9);
        g.fillStyle = "rgba(255,255,255,0.055)";
        g.fill();
        // Its clock, draining left to right.
        const f = clamp((o.expiresAt - performance.now()) / (o.life * 1000), 0, 1);
        g.save();
        roundRect(g, 13 + GUTTER, y, w, rowH, 9); g.clip();
        g.fillStyle = f < 0.3 ? "rgba(255,77,109,0.30)" : owner.css + "26";
        g.fillRect(13 + GUTTER, y, w * f, rowH);
        g.restore();
        g.strokeStyle = owner.css; g.lineWidth = 1.6;
        roundRect(g, 13 + GUTTER, y, w, rowH, 9); g.stroke();

        g.fillStyle = owner.css;
        roundRect(g, 20 + GUTTER, y + rowH / 2 - 7, 5, 14, 2.5);
        g.fill();
        g.fillStyle = "#eef4ff";
        g.font = "800 " + Math.min(16, w * 0.045) + "px Inter,-apple-system,system-ui,'Segoe UI',Roboto,sans-serif";
        g.textAlign = "left"; g.textBaseline = "middle";
        g.fillText(o.text, 34 + GUTTER, y + rowH / 2);
        g.fillStyle = owner.css;
        g.font = "700 10px Inter,-apple-system,system-ui,'Segoe UI',Roboto,sans-serif";
        g.textAlign = "right";
        g.fillText(owner.name.toLowerCase(), 13 + GUTTER + w - 12, y + rowH / 2);
      }
      if (orders.length > n) {
        g.fillStyle = "rgba(238,244,255,0.72)";
        g.font = "700 11px Inter,-apple-system,system-ui,'Segoe UI',Roboto,sans-serif";
        g.textAlign = "right"; g.textBaseline = "middle";
        g.fillText("+" + (orders.length - n), W - 15, L.orderY + L.orderH - 22);
      }
    }

    function drawHull() {
      const y = L.orderY + L.orderH - 12, w = W - 26 - GUTTER;
      roundRect(g, 13 + GUTTER, y, w, 7, 3.5);
      g.fillStyle = "rgba(255,255,255,0.09)"; g.fill();
      const f = clamp(hull / 100, 0, 1);
      roundRect(g, 13 + GUTTER, y, w * f, 7, 3.5);
      g.fillStyle = f > 0.5 ? "#3ddc97" : f > 0.25 ? "#ffd166" : "#ff4d6d";
      g.fill();
      // The wave call-out used to be painted at the centre of this band, which
      // is exactly where the live orders are — the two read as one garbled
      // line. It covers the band instead, as a title card that clears.
    }

    /** The wave call-out. Drawn after the orders, over its own plate: painted
     *  under them it showed through the gaps as a ghost, and painted without
     *  a plate it landed straight across a live order and the two read as one
     *  garbled line.
     *
     *  The plate and the word fade on separate clocks, and that is the whole
     *  point. Fading them together — one globalAlpha over both — turned the
     *  plate translucent while the word was still at full size, so for most of
     *  the call-out's life "WAVE 3" sat directly on top of a legible order and
     *  the two read as one garbled line again. The plate stays opaque until
     *  the word is nearly gone. */
    function drawBanner() {
      if (!banner || banner.t <= 0) return;
      const ink = clamp(banner.t, 0, 1);
      const plate = clamp(banner.t * 4, 0, 1);
      g.save();
      g.globalAlpha = plate;
      roundRect(g, 13 + GUTTER, L.orderY + 4, W - 26 - GUTTER, L.orderH - 20, 12);
      g.fillStyle = "rgba(9,13,24,0.985)"; g.fill();
      g.strokeStyle = "rgba(238,244,255,0.16)"; g.lineWidth = 1.4; g.stroke();
      g.globalAlpha = ink;
      g.fillStyle = "#eef4ff";
      g.font = "900 " + Math.round(Math.min(30, (L.orderH - 20) * 0.42)) +
               "px Inter,-apple-system,system-ui,'Segoe UI',Roboto,sans-serif";
      g.textAlign = "center"; g.textBaseline = "middle";
      g.fillText(banner.text, (W + GUTTER) / 2, L.orderY + 4 + (L.orderH - 20) / 2);
      g.restore();
    }

    /* ---------------------------------------------------------------
     * Input.
     *
     * A control refuses anybody but its owner — but a phone cannot tell
     * whose finger it is, so ownership is enforced by GEOMETRY: a
     * control only responds to a pointer that began inside its own
     * console. Reaching across the table to somebody else's panel is
     * physically possible and the game simply lets it happen; what it
     * prevents is a stray touch in your own area operating a widget that
     * is not yours.
     * ------------------------------------------------------------- */
    const held = new Map();

    function controlAt(x, y) {
      for (const c of controls) {
        if (x >= c.x && x <= c.x + c.w && y >= c.y && y <= c.y + c.h) return c;
      }
      return null;
    }

    /** A point in a control's own space, back out to screen coordinates. */
    function toScreen(c, lx, ly) {
      if (c.rot) return { x: c.x + c.w - lx, y: c.y + c.h - ly };
      return { x: c.x + lx, y: c.y + ly };
    }

    /** Pointer position inside a control, in that control's own rotation. */
    function localPos(c, x, y) {
      const lx = x - (c.x + c.w / 2), ly = y - (c.y + c.h / 2);
      if (c.rot) return { x: c.w / 2 - lx, y: c.h / 2 - ly };
      return { x: c.w / 2 + lx, y: c.h / 2 + ly };
    }

    ctx.listen(canvas, "pointerdown", async (e) => {
      if (phase !== "play") return;
      await sound.unlock();
      const c = controlAt(e.offsetX, e.offsetY);
      if (!c) return;
      held.set(e.pointerId, c);
      const p = localPos(c, e.offsetX, e.offsetY);

      if (c.kind === "switch") { c.value = c.value ? 0 : 1; sound.haptic("light"); checkOrder(c); }
      else if (c.kind === "dial") { c.value = (c.value % 5) + 1; sound.haptic("light"); checkOrder(c); }
      else if (c.kind === "slider") {
        const tw = c.w * 0.62, tx = c.w / 2 - tw / 2;
        c.value = clamp(Math.round(((p.x - tx) / tw) * 3), 0, 3);
        sound.haptic("light"); checkOrder(c);
      } else if (c.kind === "button") {
        c.value = 1; c.flash = 0.35; sound.haptic("medium"); checkOrder(c); c.value = 0;
      }
      e.preventDefault();
    }, { passive: false });

    ctx.listen(canvas, "pointermove", (e) => {
      const c = held.get(e.pointerId);
      if (!c || c.kind !== "slider") return;
      const p = localPos(c, e.offsetX, e.offsetY);
      const tw = c.w * 0.62, tx = c.w / 2 - tw / 2;
      const v = clamp(Math.round(((p.x - tx) / tw) * 3), 0, 3);
      if (v !== c.value) { c.value = v; sound.haptic("light"); checkOrder(c); }
      e.preventDefault();
    }, { passive: false });

    const release = (e) => {
      const c = held.get(e.pointerId);
      held.delete(e.pointerId);
      if (c && c.kind === "lever") c.held = 0;      // let go early and it drains
    };
    ctx.listen(canvas, "pointerup", release);
    ctx.listen(canvas, "pointercancel", release);

    /* ---------------------------------------------------------------
     * Overlay
     * ------------------------------------------------------------- */
    const FONT = "Inter,-apple-system,system-ui,'Segoe UI',Roboto,sans-serif";
    const BIG = "width:100%;padding:15px;border:none;border-radius:15px;font-family:inherit;" +
      "font-size:16px;font-weight:800;";
    const BTN = "pointer-events:auto;width:34px;height:34px;border-radius:11px;border:none;" +
      "background:rgba(255,255,255,0.14);color:#eef4ff;font-size:14px;font-family:inherit;padding:0;";

    const root = ctx.createRoot({ touchAction: "none" });
    root.style.cssText += ";font-family:" + FONT + ";color:#eef4ff;pointer-events:none;text-transform:lowercase;";

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
      // The chrome sits under the full-screen panels rather than over them, so
      // while one is up it is two unreachable grey ghosts showing through the
      // scrim — and on the short card they land in the middle of the title
      // blurb. It only exists during play, so it is only shown during play.
      '<div data-el="chrome" style="position:absolute;left:9px;top:50%;transform:translateY(-50%);display:none;' +
        'flex-direction:column;gap:6px;z-index:40;pointer-events:none;">' +
        '<button data-el="mute" aria-label="Sound" style="' + BTN + '">' + SPK(true) + '</button>' +
        '<button data-el="help" aria-label="How to play" style="' + BTN + '">?</button>' +
      '</div>' +
      '<div data-el="menu" style="position:absolute;inset:0;pointer-events:auto;display:flex;' +
        'flex-direction:column;align-items:center;justify-content:center;gap:10px;' +
        'background:rgba(8,14,28,0.94);z-index:50;padding:26px;text-align:center;">' +
        '<div style="font-size:11px;letter-spacing:0.4em;text-transform:lowercase;opacity:0.66;">All hands</div>' +
        '<div style="font-size:50px;font-weight:900;letter-spacing:-0.02em;line-height:1.05;' +
          'background:linear-gradient(96deg,#ff4d6d,#ffd166,#4cc9f0);-webkit-background-clip:text;' +
          'background-clip:text;-webkit-text-fill-color:transparent;">Bridge Crew</div>' +
        '<div style="font-size:14.5px;opacity:0.8;max-width:285px;line-height:1.55;">' +
          'Everyone can read every order. Nobody can reach anybody else\'s controls. ' +
          'You are going to have to shout.</div>' +
        '<div style="font-size:11px;letter-spacing:0.22em;text-transform:lowercase;opacity:0.66;margin-top:14px;">Crew</div>' +
        '<div data-el="pc" style="display:flex;gap:8px;"></div>' +
        '<button data-el="go" style="' + BIG + 'max-width:230px;margin-top:16px;' +
          'background:linear-gradient(96deg,#ff4d6d,#ffd166);color:#12101c;">Take stations</button>' +
      '</div>' +
      '<div data-el="over" style="position:absolute;inset:0;pointer-events:auto;display:none;' +
        'flex-direction:column;align-items:center;justify-content:center;gap:5px;' +
        'background:rgba(8,14,28,0.95);z-index:55;padding:26px;text-align:center;">' +
        '<div style="font-size:12px;letter-spacing:0.32em;text-transform:lowercase;opacity:0.66;">Hull breached</div>' +
        '<div data-el="over-served" style="font-size:74px;font-weight:900;line-height:1;color:#ffd166;">0</div>' +
        '<div style="font-size:13px;letter-spacing:0.2em;text-transform:lowercase;opacity:0.7;">orders served</div>' +
        '<div data-el="over-line" style="font-size:13.5px;opacity:0.74;margin-top:6px;"></div>' +
        '<button data-el="again" style="' + BIG + 'max-width:230px;margin-top:22px;' +
          'background:rgba(255,255,255,0.16);color:#eef4ff;">Again</button>' +
      '</div>' +
      '<div data-el="helpp" style="position:absolute;inset:0;pointer-events:auto;display:none;' +
        'align-items:center;justify-content:center;background:rgba(8,14,28,0.95);z-index:70;padding:22px;">' +
        '<div style="max-width:330px;width:100%;background:rgba(18,26,46,0.98);border-radius:20px;' +
          'padding:22px;border:1px solid rgba(255,255,255,0.10);">' +
          '<div style="font-size:19px;font-weight:800;margin-bottom:11px;">How to play</div>' +
          '<ul style="font-size:14px;line-height:1.7;opacity:0.92;padding-left:18px;margin:0;">' +
            '<li>Phone flat. Everyone takes a console — the coloured tab on each control says whose it is.</li>' +
            '<li>Orders appear in the middle. <b>Everyone can read all of them.</b></li>' +
            '<li>Each order is stamped with the colour of the crew member whose controls it needs. ' +
              'Only they can carry it out.</li>' +
            '<li>So read them out loud. The person who spots an order is usually not the person who can do it.</li>' +
            '<li>Switches flip, dials step round, sliders drag, buttons prime, levers must be <b>held</b>.</li>' +
            '<li>Every order you miss takes a bite out of the hull. Every eight you serve, it gets faster.</li>' +
          '</ul>' +
          '<button data-el="helpp-close" style="' + BIG + 'margin-top:16px;' +
            'background:rgba(255,255,255,0.14);color:#eef4ff;">Got it</button>' +
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
    tap(el("help"), () => { el("helpp").style.display = "flex"; });
    tap(el("helpp-close"), () => { el("helpp").style.display = "none"; });

    (function pills() {
      const host = el("pc");
      host.innerHTML = [2, 3, 4].map((v) =>
        '<button data-v="' + v + '" style="width:56px;padding:12px 0;border:none;border-radius:13px;' +
        'font-family:inherit;font-size:16px;font-weight:800;">' + v + '</button>').join("");
      const paint2 = () => {
        for (const b of host.querySelectorAll("button")) {
          const on = String(settings.players) === b.dataset.v;
          b.style.background = on ? "rgba(255,255,255,0.26)" : "rgba(255,255,255,0.08)";
          b.style.color = on ? "#fff" : "rgba(238,244,255,0.74)";
        }
      };
      for (const b of host.querySelectorAll("button")) {
        tap(b, () => { settings.players = Number(b.dataset.v); saveSettings(); paint2(); sound.haptic("light"); });
      }
      paint2();
    })();

    const begin = async () => {
      ctx.platform.start();
      await sound.unlock();
      el("menu").style.display = "none";
      el("over").style.display = "none";
      el("chrome").style.display = "flex";
      startGame(settings.players);
      sound.sting("powerup");
    };
    tap(el("go"), begin);
    tap(el("again"), begin);

    /* ---------------------------------------------------------------
     * Frame
     * ------------------------------------------------------------- */
    ctx.onFrame((dtMs) => {
      const dt = Math.min(dtMs, 50) / 1000;
      if (shake > 0.0004) shake *= Math.pow(0.004, dt);
      if (banner) { banner.t -= dt; if (banner.t <= 0) banner = null; }
      for (const c of controls) if (c.flash > 0) c.flash = Math.max(0, c.flash - dt * 2);

      if (phase === "play") {
        // Levers fill only while a finger is actually on them.
        for (const [, c] of held) {
          if (c.kind === "lever") {
            c.held += dt;
            if (c.held >= 1 && c.target !== null) checkOrder(c);
          }
        }
        for (const c of controls) {
          if (c.kind === "lever" && ![...held.values()].includes(c)) {
            c.held = Math.max(0, c.held - dt * 1.6);
          }
        }

        const now = performance.now();
        for (let i = orders.length - 1; i >= 0; i--) {
          if (now >= orders[i].expiresAt) missOrder(orders[i]);
        }

        // The board holds roughly one order per crew member from the start,
        // and more as the waves climb. That ratio is the premise: if a queue
        // is ever short enough for one person to work through alone, nobody
        // has any reason to say anything out loud.
        const capacity = clamp(crew.length + Math.floor(wave / 2), 2, controls.length - 1);
        if (now >= spawnAt && orders.length < capacity) {
          spawnOrder();
          spawnAt = now + Math.max(450, 1700 - wave * 120);
        }
        sound.heat(clamp(orders.length / Math.max(crew.length, 2), 0, 1));
      }
      paint();
    });

    ctx.listen(window, "resize", () => {
      if (ctx.width === W && ctx.height === H) return;
      measure();
      if (phase === "play") {
        const boxes = consoles(crew.length);
        crew.forEach((c, i) => { c.box = boxes[i]; });
        layoutControls();
      }
    });

    // A read-only window for the local harness.
    window.__BRIDGE__ = {
      get phase() { return phase; },
      get hull() { return hull; },
      get served() { return served; },
      get missed() { return missed; },
      get wave() { return wave; },
      get orders() { return orders.map((o) => ({ text: o.text, owner: o.control.owner,
        t: +((o.expiresAt - performance.now()) / 1000).toFixed(2) })); },
      /**
       * Where a player would actually press to satisfy the first live order.
       * A slider's target is a position along its track, not its centre, so
       * the press point has to be computed the same way the drawing is.
       */
      firstOrderTarget() {
        if (!orders.length) return null;
        const o = orders[0], c = o.control;
        let lx = c.w / 2, ly = c.h * 0.66;
        if (c.kind === "slider") {
          const tw = c.w * 0.62;
          lx = (c.w / 2 - tw / 2) + (tw / 3) * o.want;
        }
        const p = toScreen(c, lx, ly);
        return { kind: c.kind, owner: c.owner, want: o.want, value: c.value,
                 x: p.x, y: p.y, w: c.w, h: c.h, rot: c.rot };
      },
    };
    ctx.onDestroy(() => { try { delete window.__BRIDGE__; } catch (_) {} });

    paint();
    ctx.markVisualReady("panel lit");
    ctx.platform.ready();
  },
};
