/**
 * Reactor Four — a two-to-four player reaction duel on one phone.
 *
 * The phone goes flat on the table and two, three or four people each claim an
 * edge. A reactor core burns in a circular viewport at the centre; four console
 * wedges radiate out from it, one per seat. When the signal comes true, the
 * first player to slap their own wedge takes the round. Slap while it is false
 * and the station scrams: locked out, one point gone.
 *
 * Four decisions drive everything else.
 *
 * **The screen is divided by its own diagonals, not by a grid.** Rays from the
 * centre through the four screen corners cut the display into four wedges that
 * tile it exactly, and every player's wedge touches the edge they are sitting
 * at along its whole length. The same test carries two and three players: the
 * sector list simply gets coarser (two 180° halves, or 135°/90°/135°), so a
 * three-player game has no dead strip of screen that swallows a slap.
 *
 * **Nothing important is written only in the middle.** Text that reads
 * right-way-up for the player at the bottom is upside down for the player at
 * the top, so the centre carries only rotation-invariant state — the core's
 * colour, a pair of glyphs, a row of dots — and every console repeats the
 * signal rotated to its own seat. Control rooms mirror the master gauge onto
 * each station for exactly this reason.
 *
 * **Colour is only a cue in the round that says it is.** In a GO round the core
 * turns green the instant it arms, and that is the whole game. In MATCH, COUNT
 * and MATH the core keeps burning in the round's own hue right through the arm,
 * because if it flashed green the round would collapse back into GO. The decoy
 * cycles tick audibly whether they are true or false so the sound cannot leak
 * the answer either.
 *
 * **A pointer belongs to the wedge it landed in, for its whole life.** A slap
 * is decided on pointerdown and the binding is held in a Map keyed by
 * pointerId, with one live pointer per station — otherwise a hand that lands
 * across a mitre line, or a second finger from the same player, fires somebody
 * else's console.
 *
 * Contract notes: packaged assets are disabled (maxAssets is 0), so the console
 * plating, the chamber behind the core, the glow sprites and every readout are
 * painted into OffscreenCanvases at boot and either blitted or uploaded as
 * textures. The overlay is one markup string on ctx.createRoot() rather than
 * document.createElement, and pointer maths uses offsetX/offsetY rather than
 * getBoundingClientRect — both of those are rejected at upload and neither is
 * documented in sdk.md.
 */
window.plethoraBit = {
  meta: {
    title: "Reactor Four",
    runtime: "plethora-bit@2",
    tags: ["multiplayer", "local-multiplayer", "party", "reflex", "four-player"],
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

    const TAU = Math.PI * 2;
    const D2R = Math.PI / 180;
    const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
    const now = () => performance.now();
    const rnd = (n) => Math.floor(Math.random() * n);

    /** Escape anything that could ever be player-authored before it hits innerHTML. */
    const esc = (s) => String(s).replace(/[&<>"']/g,
      (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

    /* ---------------------------------------------------------------
     * Stations. Index is fixed: 0 bottom, 1 top, 2 left, 3 right, so a
     * two-player game is always bottom-and-top and a three-player game
     * always adds the left edge. `rad` is the rotation a console needs
     * to read right-way-up from that seat.
     * ------------------------------------------------------------- */
    const STATIONS = [
      { key: "bottom", name: "CYAN",    ink: "#22dcff", hex: 0x22dcff, rgb: [34, 220, 255] },
      { key: "top",    name: "MAGENTA", ink: "#ff2f8f", hex: 0xff2f8f, rgb: [255, 47, 143] },
      { key: "left",   name: "AMBER",   ink: "#ffb020", hex: 0xffb020, rgb: [255, 176, 32] },
      { key: "right",  name: "LIME",    ink: "#8bf03a", hex: 0x8bf03a, rgb: [139, 240, 58] },
    ];
    const SEAT_RAD = { bottom: 0, top: Math.PI, left: Math.PI / 2, right: -Math.PI / 2 };

    /** Angular ownership, in screen degrees where 90° is straight down. */
    function sectorsFor(n) {
      if (n === 2) return [[0, 180], [180, 360]];
      if (n === 3) return [[0, 135], [225, 360], [135, 225]];
      return [[45, 135], [225, 315], [135, 225], [315, 45]];
    }

    const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;

    /* ---------------------------------------------------------------
     * Round types. Each carries the hue the core burns while it is the
     * active mode, so a glance at the core says which game you are in
     * before you have read a word.
     * ------------------------------------------------------------- */
    const TYPES = ["go", "match", "count", "math"];
    const TYPE = {
      go:    { name: "GO",    rule: "TAP ON GREEN",  hex: 0xff2a33, hexStr: "#ff2a33", rgb: [255, 42, 51] },
      match: { name: "MATCH", rule: "TAP ON A PAIR", hex: 0xc05cff, hexStr: "#c05cff", rgb: [192, 92, 255] },
      count: { name: "COUNT", rule: "TAP ON N",      hex: 0x2f9dff, hexStr: "#2f9dff", rgb: [47, 157, 255] },
      math:  { name: "MATH",  rule: "TAP IF TRUE",   hex: 0xffa312, hexStr: "#ffa312", rgb: [255, 163, 18] },
    };
    const GREEN = { hex: 0x24f58c, rgb: [36, 245, 140] };
    const IDLE = { hex: 0x2c4a7a, rgb: [44, 74, 122] };

    /* ---------------------------------------------------------------
     * Settings, remembered between sessions.
     * ------------------------------------------------------------- */
    const saved = (function () {
      try { return ctx.storage.get("reactor4") || {}; } catch (_) { return {}; }
    })();
    const settings = {
      crew: saved.crew || 4,
      target: saved.target || 5,
      pace: saved.pace === undefined ? 1 : saved.pace,   // 0 calm, 1 normal, 2 brutal
      mute: !!saved.mute,
    };
    const PACE = { 0: 1.3, 1: 1.0, 2: 0.74 };
    const pace = () => PACE[settings.pace];
    function saveSettings() { try { ctx.storage.set("reactor4", settings); } catch (_) {} }

    /* ---------------------------------------------------------------
     * Sound. A techno bed whose intensity tracks the reactor's charge,
     * so the room can hear the wind-up as well as see it. Every call is
     * wrapped: audio is a nicety and must never break play.
     * ------------------------------------------------------------- */
    const sound = (function () {
      let muted = settings.mute, bed = null, unlocked = false, lastHeat = -1;
      const start = () => ctx.music.play({ preset: "techno", volume: 0.30, tempo: 120, intensity: 0.25 });
      return {
        get muted() { return muted; },
        async unlock() {
          if (unlocked) return;
          unlocked = true;
          try { await ctx.music.unlock(); if (!muted) bed = start(); } catch (_) {}
        },
        sting(n) { if (!muted) { try { ctx.music.sting(n); } catch (_) {} } },
        duck(a, ms) { if (!muted) { try { ctx.music.duck(a, ms); } catch (_) {} } },
        heat(v) {
          // The bed is driven every frame; only tell it when the number has
          // actually moved, or the audio graph gets 60 writes a second.
          const c = clamp(v, 0, 1);
          if (Math.abs(c - lastHeat) < 0.03) return;
          lastHeat = c;
          if (!muted && bed) { try { bed.setIntensity(c); } catch (_) {} }
        },
        tempo(v) { if (!muted && bed) { try { bed.setTempo(v); } catch (_) {} } },
        haptic(k) { try { ctx.platform.haptic(k); } catch (_) {} },
        toggle() {
          muted = !muted;
          settings.mute = muted;
          saveSettings();
          try {
            if (muted) { (bed || ctx.music).stop({ fadeOutMs: 200 }); bed = null; }
            else if (unlocked) bed = start();
          } catch (_) {}
          return muted;
        },
      };
    })();

    /* ---------------------------------------------------------------
     * Layout. Everything is measured from the port — the circular hole
     * in the console plating that the 3D core burns through.
     * ------------------------------------------------------------- */
    let W = ctx.width, H = ctx.height, cx = W / 2, cy = H / 2, portR = 112;
    const safeT = ctx.safeArea.top, safeB = ctx.safeArea.bottom;
    function measure() {
      W = ctx.width; H = ctx.height;
      cx = W / 2; cy = H / 2;
      portR = Math.round(Math.min(W * 0.272, H * 0.148));
    }
    measure();

    let sectors = sectorsFor(settings.crew);
    let crew = settings.crew;

    /** Which station owns a screen point. Normalised first, so the mitre
     *  lines land exactly on the screen diagonals whatever the aspect. */
    function zoneAt(px, py) {
      const u = (px - cx) / (W / 2), v = (py - cy) / (H / 2);
      let a = Math.atan2(v, u) / D2R;
      if (a < 0) a += 360;
      for (let i = 0; i < sectors.length; i++) {
        const s = sectors[i][0], e = sectors[i][1];
        if (s < e ? (a >= s && a < e) : (a >= s || a < e)) return i;
      }
      return 0;
    }

    /** A point on the r=3 unit ellipse — far outside the screen in every
     *  direction, which is what makes a sector clip cover its whole wedge. */
    function ray(deg, r) {
      const t = deg * D2R;
      return { x: cx + Math.cos(t) * r * (W / 2), y: cy + Math.sin(t) * r * (H / 2) };
    }
    /** The circle angle a normalised bearing lands on. The wedges are cut in
     *  normalised space, so an arc drawn round the port has to be converted or
     *  it will not line up with the mitre it is supposed to sit inside. */
    function pixAng(deg) {
      const t = deg * D2R;
      return Math.atan2(Math.sin(t) * H, Math.cos(t) * W);
    }
    function wedgePath(g, i) {
      const s = sectors[i][0];
      let span = sectors[i][1] - s;
      if (span <= 0) span += 360;
      const steps = Math.max(2, Math.ceil(span / 30));
      g.beginPath();
      g.moveTo(cx, cy);
      for (let k = 0; k <= steps; k++) {
        const p = ray(s + span * k / steps, 3);
        g.lineTo(p.x, p.y);
      }
      g.closePath();
    }
    /** Two successive clips intersect, which is how the port stays a real hole
     *  in every wedge rather than an even-odd artefact in three of them. */
    function clipOutsidePort(g) {
      g.beginPath();
      g.rect(0, 0, W, H);
      g.arc(cx, cy, portR, 0, TAU, true);          // reversed: nonzero punches
      g.clip();
    }
    function clipZone(g, i) { wedgePath(g, i); g.clip(); }

    /** Where a station's readout strip sits, and how it is turned. */
    function anchor(i) {
      const k = STATIONS[i].key;
      const rad = SEAT_RAD[k];
      if (k === "bottom") return { x: cx, y: H - safeB - 54, rad };
      if (k === "top")    return { x: cx, y: safeT + 50, rad };
      if (k === "left")   return { x: 54, y: cy, rad };
      return { x: W - 54, y: cy, rad };
    }
    /** A generous point inside a station's wedge — where a hand naturally lands. */
    function tapPoint(i) {
      const k = STATIONS[i].key;
      if (k === "bottom") return { x: cx, y: H - safeB - 24 };
      if (k === "top")    return { x: cx, y: safeT + 22 };
      if (k === "left")   return { x: 22, y: cy };
      return { x: W - 22, y: cy };
    }

    function surface(w, h) {
      if (typeof OffscreenCanvas === "undefined") return null;   // older WebViews draw live
      return new OffscreenCanvas(Math.max(1, Math.ceil(w)), Math.max(1, Math.ceil(h)));
    }

    /* =============================================================
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

    /** Letter-spaced caps, drawn per glyph so the tracking is identical on
     *  every engine — ctx.letterSpacing is not universally present. */
    // Set lowercase like the rest of the game. This helper draws one
    // character at a time for its own tracking, and single characters slip
    // past the case fold that every other canvas string goes through.
    function tracked(g, text, x, y, size, track, align, maxW) {
      text = typeof text === "string" ? text.toLowerCase() : text;
      const chars = String(text).split("");
      let total = 0;
      // Shrink until it fits, tracking included — fitting the glyphs alone and
      // then adding spacing is how a label ends up reading "TAP ON A PAI".
      for (let guard = 0; guard < 40; guard++) {
        g.font = "700 " + size + "px " + MONO;
        total = 0;
        for (const c of chars) total += g.measureText(c).width + track;
        total -= track;
        if (!maxW || total <= maxW || size <= 5) break;
        size -= 0.5;
        track = Math.max(0.4, track * 0.92);
      }
      let px = align === "center" ? x - total / 2 : align === "right" ? x - total : x;
      g.textAlign = "left";
      for (const c of chars) {
        g.fillText(c, px, y);
        px += g.measureText(c).width + track;
      }
      return total;
    }

    /** Shrink a font until the string fits; readouts must never overflow. */
    function fitFont(g, text, maxW, size, weight, family) {
      let s = size;
      g.font = weight + " " + s + "px " + family;
      while (s > 6 && g.measureText(text).width > maxW) {
        s -= 1;
        g.font = weight + " " + s + "px " + family;
      }
      return s;
    }

    const FONT = "Inter,-apple-system,system-ui,'Segoe UI',Roboto,sans-serif";
    const MONO = "Inter,-apple-system,system-ui,'Segoe UI',Roboto,sans-serif";

    /* ---------------------------------------------------------------
     * Signal glyphs. Six shapes that stay distinguishable from any seat:
     * whether two of them match is a rotation-invariant question, which
     * is exactly why MATCH can live in the middle of the screen.
     * ------------------------------------------------------------- */
    function glyph(g, idx, x, y, s) {
      g.beginPath();
      if (idx === 0) {                                   // ring
        g.lineWidth = s * 0.42;
        g.arc(x, y, s * 0.74, 0, TAU);
        g.stroke();
        return;
      }
      if (idx === 1) {                                   // square
        g.rect(x - s * 0.82, y - s * 0.82, s * 1.64, s * 1.64);
      } else if (idx === 2) {                            // triangle
        g.moveTo(x, y - s);
        g.lineTo(x + s * 0.92, y + s * 0.72);
        g.lineTo(x - s * 0.92, y + s * 0.72);
        g.closePath();
      } else if (idx === 3) {                            // cross
        const t = s * 0.34;
        g.rect(x - t, y - s, t * 2, s * 2);
        g.rect(x - s, y - t, s * 2, t * 2);
      } else if (idx === 4) {                            // hexagon
        for (let k = 0; k < 6; k++) {
          const a = k * TAU / 6 + Math.PI / 6;
          const px = x + Math.cos(a) * s, py = y + Math.sin(a) * s;
          if (k === 0) g.moveTo(px, py); else g.lineTo(px, py);
        }
        g.closePath();
      } else {                                           // diamond
        g.moveTo(x, y - s);
        g.lineTo(x + s * 0.78, y);
        g.lineTo(x, y + s);
        g.lineTo(x - s * 0.78, y);
        g.closePath();
      }
      g.fill();
    }

    /**
     * The signal payload, drawn into a box of w×h with its top-left at 0,0.
     * One function serves both the master gauge baked onto the core's readout
     * plate and the four repeats on the consoles, so a station can never show
     * something subtly different from the middle of the table.
     */
    function payloadArt(g, w, h, sig, opts) {
      const o = opts || {};
      const ink = o.ink || "#eaf4ff";
      const scale = h / 66;
      if (!sig || !sig.kind) return;

      if (sig.kind === "go") {
        // A single lamp. Red means hold; green is the only thing worth a slap.
        const on = !!sig.on;
        const col = on ? "36,245,140" : "255,42,51";
        const r = h * 0.30;
        for (let k = 4; k >= 1; k--) {                   // concentric halo, no blur filter
          g.beginPath();
          g.arc(w / 2, h * 0.44, r + k * r * 0.32, 0, TAU);
          g.fillStyle = "rgba(" + col + "," + (on ? 0.10 : 0.05) + ")";
          g.fill();
        }
        g.beginPath();
        g.arc(w / 2, h * 0.44, r, 0, TAU);
        g.fillStyle = "rgba(" + col + ",1)";
        g.fill();
        if (o.label !== false) {
          g.fillStyle = "rgba(" + col + ",0.95)";
          tracked(g, on ? "GO" : "HOLD", w / 2, h * 0.96, Math.max(8, 9 * scale), 2 * scale, "center");
        }
        return;
      }

      if (sig.kind === "match") {
        const s = h * 0.26;
        g.fillStyle = ink;
        g.strokeStyle = ink;
        glyph(g, sig.a, w * 0.29, h * 0.48, s);
        g.fillStyle = ink;
        g.strokeStyle = ink;
        glyph(g, sig.b, w * 0.71, h * 0.48, s);
        g.strokeStyle = "rgba(219,230,245,0.22)";        // divider
        g.lineWidth = Math.max(1, scale);
        g.beginPath();
        g.moveTo(w / 2, h * 0.16);
        g.lineTo(w / 2, h * 0.80);
        g.stroke();
        return;
      }

      if (sig.kind === "count") {
        const n = sig.n;
        const cols = Math.min(n, 4);
        const rows = Math.ceil(n / 4);
        const r = h * (rows > 1 ? 0.085 : 0.115);
        const gapX = r * 3.1, gapY = r * 3.1;
        g.fillStyle = ink;
        let drawn = 0;
        for (let ry = 0; ry < rows; ry++) {
          const inRow = Math.min(4, n - drawn);
          for (let k = 0; k < inRow; k++) {
            const px = w / 2 + (k - (inRow - 1) / 2) * gapX;
            const py = h * 0.46 + (ry - (rows - 1) / 2) * gapY;
            g.beginPath();
            g.arc(px, py, r, 0, TAU);
            g.fill();
            drawn++;
          }
        }
        if (o.label !== false) {
          g.fillStyle = "rgba(219,230,245,0.55)";
          tracked(g, "NEED " + sig.target, w / 2, h * 0.97, Math.max(8, 8.5 * scale), 1.6 * scale, "center");
        }
        void cols;
        return;
      }

      // math
      const size = fitFont(g, sig.text, w * 0.90, h * 0.40, "700", MONO);
      g.font = "700 " + size + "px " + MONO;
      g.fillStyle = ink;
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.fillText(sig.text, w / 2, h * 0.5);
      g.textBaseline = "alphabetic";
    }

    /* =============================================================
     * 3D — the reactor core
     * ============================================================= */
    const canvas = ctx.createCanvas({ touchAction: "none" });
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(ctx.dpr, 2));
    renderer.setSize(W, H, false);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;
    ctx.onDestroy(() => renderer.dispose());

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x04060b);

    const FOV = 32;
    const camDist = 1 / Math.tan((FOV / 2) * D2R);
    const camera = new THREE.PerspectiveCamera(FOV, W / H, 0.1, 20);
    camera.position.set(0, 0, camDist);
    camera.lookAt(0, 0, 0);

    // Screen pixels to world units. Everything the core is made of lives near
    // z=0, so this stays a straight linear scale.
    const P = (px) => px / (H / 2);

    // The whole reactor hangs off one group, and every dimension inside it is a
    // fraction of the port radius. A rotation changes the port, and rescaling
    // the rig is then one number rather than rebuilt geometry.
    const rig = new THREE.Group();
    scene.add(rig);
    const R0 = portR;
    const K = (f) => P(R0 * f);

    /** A soft radial sprite, baked once. Used for the bloom and the motes. */
    function radialTexture(size, stops) {
      const c = surface(size, size);
      if (!c) return null;
      const g = c.getContext("2d");
      const gr = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
      for (const s of stops) gr.addColorStop(s[0], s[1]);
      g.fillStyle = gr;
      g.fillRect(0, 0, size, size);
      const t = new THREE.CanvasTexture(c);
      ctx.onDestroy(() => t.dispose());
      return t;
    }

    /** The chamber wall behind the core: machinery you only half see. */
    function chamberTexture() {
      const S = 512;
      const c = surface(S, S);
      if (!c) return null;
      const g = c.getContext("2d");
      g.fillStyle = "#05070c";
      g.fillRect(0, 0, S, S);
      const m = S / 2;
      // Radial vents.
      for (let k = 0; k < 48; k++) {
        const a = k * TAU / 48;
        g.strokeStyle = k % 4 === 0 ? "rgba(130,175,235,0.34)" : "rgba(95,130,185,0.14)";
        g.lineWidth = k % 4 === 0 ? 3 : 1.4;
        g.beginPath();
        g.moveTo(m + Math.cos(a) * m * 0.30, m + Math.sin(a) * m * 0.30);
        g.lineTo(m + Math.cos(a) * m * 0.98, m + Math.sin(a) * m * 0.98);
        g.stroke();
      }
      // Containment rings.
      for (const r of [0.34, 0.48, 0.62, 0.78, 0.93]) {
        g.strokeStyle = "rgba(120,160,215,0.26)";
        g.lineWidth = r > 0.7 ? 2.5 : 1.5;
        g.beginPath();
        g.arc(m, m, m * r, 0, TAU);
        g.stroke();
      }
      // Hazard arc at the rim.
      g.save();
      g.beginPath();
      g.arc(m, m, m * 0.955, 0, TAU);
      g.arc(m, m, m * 0.90, 0, TAU, true);
      g.clip();
      for (let k = -S; k < S * 2; k += 22) {
        g.fillStyle = "rgba(190,140,40,0.22)";
        g.beginPath();
        g.moveTo(k, 0); g.lineTo(k + 11, 0); g.lineTo(k + 11 + S, S); g.lineTo(k + S, S);
        g.closePath(); g.fill();
      }
      g.restore();
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace;
      ctx.onDestroy(() => t.dispose());
      return t;
    }

    // --- chamber wall ---------------------------------------------------
    const chamberTex = chamberTexture();
    const chamber = new THREE.Mesh(
      new THREE.CircleGeometry(K(3.0), 64),
      new THREE.MeshBasicMaterial({
        color: chamberTex ? 0xffffff : 0x0a0f18,
        map: chamberTex || null,
      })
    );
    chamber.position.z = -K(1.7);
    rig.add(chamber);

    /**
     * The core's skin. A flat emissive sphere reads as a sticker; this bakes a
     * veined plasma into an equirectangular map and multiplies the emission
     * through it, so the surface has structure that churns as the core turns.
     */
    function plasmaTexture() {
      const TW = 640, TH = 320;
      const c = surface(TW, TH);
      if (!c) return null;
      const g = c.getContext("2d");
      g.fillStyle = "#0a0d14";
      g.fillRect(0, 0, TW, TH);
      // Soft cells: the body of the plasma.
      for (let k = 0; k < 90; k++) {
        const x = Math.random() * TW, y = Math.random() * TH;
        const r = 18 + Math.random() * 78;
        const gr = g.createRadialGradient(x, y, 0, x, y, r);
        const a = 0.10 + Math.random() * 0.42;
        gr.addColorStop(0, "rgba(255,255,255," + a + ")");
        gr.addColorStop(0.55, "rgba(255,255,255," + a * 0.32 + ")");
        gr.addColorStop(1, "rgba(255,255,255,0)");
        g.fillStyle = gr;
        g.fillRect(x - r, y - r, r * 2, r * 2);
      }
      // Veins: hot filaments arcing across the surface.
      g.lineCap = "round";
      for (let k = 0; k < 130; k++) {
        let x = Math.random() * TW, y = Math.random() * TH;
        let a = Math.random() * TAU;
        g.beginPath();
        g.moveTo(x, y);
        for (let j = 0; j < 7; j++) {
          a += (Math.random() - 0.5) * 1.3;
          x += Math.cos(a) * 13; y += Math.sin(a) * 13;
          g.lineTo(x, y);
        }
        g.strokeStyle = "rgba(255,255,255," + (0.18 + Math.random() * 0.55) + ")";
        g.lineWidth = 0.8 + Math.random() * 2.6;
        g.stroke();
      }
      // Cool patches, so the sphere is never uniformly bright.
      for (let k = 0; k < 26; k++) {
        const x = Math.random() * TW, y = Math.random() * TH;
        const r = 30 + Math.random() * 90;
        const gr = g.createRadialGradient(x, y, 0, x, y, r);
        gr.addColorStop(0, "rgba(4,6,10,0.72)");
        gr.addColorStop(1, "rgba(4,6,10,0)");
        g.fillStyle = gr;
        g.fillRect(x - r, y - r, r * 2, r * 2);
      }
      const t = new THREE.CanvasTexture(c);
      t.wrapS = THREE.RepeatWrapping;
      t.wrapT = THREE.ClampToEdgeWrapping;
      ctx.onDestroy(() => t.dispose());
      return t;
    }
    const plasmaTex = plasmaTexture();

    // --- the core --------------------------------------------------------
    const coreCol = new THREE.Color(IDLE.hex);
    const coreMat = new THREE.MeshStandardMaterial({
      color: 0x080b12, emissive: coreCol.clone(), emissiveIntensity: 1.0,
      emissiveMap: plasmaTex || null, roughness: 0.45, metalness: 0.15,
    });
    const core = new THREE.Mesh(new THREE.SphereGeometry(K(0.60), 56, 40), coreMat);
    rig.add(core);

    // A faceted cage riding just off the surface. Counter-rotating, it makes
    // the core read as a contained reaction rather than a painted ball.
    const cageMat = new THREE.MeshBasicMaterial({
      color: coreCol.clone(), wireframe: true, transparent: true, opacity: 0.30,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const cage = new THREE.Mesh(new THREE.IcosahedronGeometry(K(0.735), 1), cageMat);
    rig.add(cage);

    // Nested back-faced shells: the cheapest honest stand-in for volume. Each
    // one adds light where the sightline is longest, so the core has a falloff
    // instead of an edge.
    const halos = [];
    for (const [r, op] of [[0.70, 0.11], [0.855, 0.068], [1.05, 0.040], [1.30, 0.022]]) {
      const m = new THREE.Mesh(
        new THREE.SphereGeometry(K(r), 32, 24),
        new THREE.MeshBasicMaterial({
          color: coreCol.clone(), transparent: true, opacity: op, side: THREE.BackSide,
          blending: THREE.AdditiveBlending, depthWrite: false,
        })
      );
      rig.add(m);
      halos.push({ mesh: m, base: op });
    }

    // Camera-facing bloom, so the port itself looks like it is emitting.
    const bloomTex = radialTexture(256, [
      [0, "rgba(255,255,255,0.95)"], [0.22, "rgba(255,255,255,0.42)"],
      [0.55, "rgba(255,255,255,0.10)"], [1, "rgba(255,255,255,0)"],
    ]);
    const bloomMat = new THREE.MeshBasicMaterial({
      color: coreCol.clone(), map: bloomTex || null, transparent: true,
      opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const bloom = new THREE.Mesh(new THREE.PlaneGeometry(K(3.2), K(3.2)), bloomMat);
    bloom.position.z = K(0.62);
    rig.add(bloom);

    // --- gyroscope rings -------------------------------------------------
    const ringMat = new THREE.MeshStandardMaterial({
      color: 0x1b2536, roughness: 0.22, metalness: 1.0,
      emissive: coreCol.clone(), emissiveIntensity: 0.18,
    });
    const rings = [];
    for (const [r, ax] of [[0.79, "x"], [0.875, "y"], [0.955, "z"]]) {
      const m = new THREE.Mesh(new THREE.TorusGeometry(K(r), K(0.024), 10, 80), ringMat);
      if (ax === "x") m.rotation.x = 0.5;
      if (ax === "y") { m.rotation.y = 0.9; m.rotation.x = 1.1; }
      if (ax === "z") { m.rotation.x = 1.5; m.rotation.z = 0.4; }
      rig.add(m);
      rings.push({ mesh: m, ax });
    }

    // --- control rods ----------------------------------------------------
    // Eight rods that withdraw as the core charges. A reactor tells you it is
    // about to go by the rods pulling out, which is the tension made physical.
    const rodMat = new THREE.MeshStandardMaterial({
      color: 0x27354d, roughness: 0.3, metalness: 0.9,
      emissive: coreCol.clone(), emissiveIntensity: 0.5,
    });
    const rods = [];
    for (let k = 0; k < 8; k++) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(K(0.042), K(0.31), K(0.042)), rodMat);
      const a = k * TAU / 8;
      m.userData.a = a;
      m.rotation.z = -a + Math.PI / 2;
      rig.add(m);
      rods.push(m);
    }

    // --- energy motes ----------------------------------------------------
    const moteTex = radialTexture(64, [
      [0, "rgba(255,255,255,1)"], [0.35, "rgba(255,255,255,0.55)"], [1, "rgba(255,255,255,0)"],
    ]);
    const MOTES = 260;
    const motePos = new Float32Array(MOTES * 3);
    const moteState = [];
    for (let k = 0; k < MOTES; k++) {
      moteState.push({
        a: Math.random() * TAU, r: K(0.55 + Math.random() * 0.82),
        y: (Math.random() - 0.5) * K(1.45), sp: 0.5 + Math.random() * 1.4,
        vr: 0, vy: 0, blast: 0,
      });
    }
    const moteGeo = new THREE.BufferGeometry();
    moteGeo.setAttribute("position", new THREE.BufferAttribute(motePos, 3));
    const moteMat = new THREE.PointsMaterial({
      size: K(0.065), map: moteTex || null, color: coreCol.clone(),
      transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending,
      depthWrite: false, sizeAttenuation: true,
    });
    const motes = new THREE.Points(moteGeo, moteMat);
    rig.add(motes);

    // --- discharge shockwave --------------------------------------------
    const waveMat = new THREE.MeshBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 0, side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const wave = new THREE.Mesh(new THREE.RingGeometry(K(0.80), K(0.91), 96), waveMat);
    wave.position.z = K(0.55);
    wave.visible = false;
    rig.add(wave);
    let waveT = 0;

    // --- readout plate ---------------------------------------------------
    // The master gauge. Smoked glass across the core's face, carrying whatever
    // the round asks people to read. GO rounds hide it, so the bare core is
    // itself the signal.
    const plateW = 1.52, plateH = 0.86;      // port radii
    const plateSurf = surface(512, 295);
    const plateTex = plateSurf ? new THREE.CanvasTexture(plateSurf) : null;
    if (plateTex) { plateTex.colorSpace = THREE.SRGBColorSpace; ctx.onDestroy(() => plateTex.dispose()); }
    // depthTest off and a late renderOrder: the additive halos live in front of
    // the core's surface, and without this the master gauge reads through them.
    const plate = new THREE.Mesh(
      new THREE.PlaneGeometry(K(plateW), K(plateH)),
      new THREE.MeshBasicMaterial({
        map: plateTex || null, transparent: true, depthWrite: false, depthTest: false,
      })
    );
    plate.renderOrder = 40;
    plate.position.z = K(1.35);
    plate.visible = false;
    rig.add(plate);

    function paintPlate(sig) {
      if (!plateSurf || !plateTex) return;
      const g = plateSurf.getContext("2d");
      const w = 512, h = 295;
      g.clearRect(0, 0, w, h);
      // Smoked glass so the readout survives against a white-hot core.
      roundRect(g, 8, 8, w - 16, h - 16, 24);
      // Smoked glass, not a hole: dark enough at the rim to carry white type,
      // open enough in the middle that the core still burns behind the number.
      const glass = g.createLinearGradient(0, 8, 0, h - 8);
      glass.addColorStop(0.00, "rgba(3,5,10,0.92)");
      glass.addColorStop(0.42, "rgba(6,10,18,0.62)");
      glass.addColorStop(0.58, "rgba(6,10,18,0.62)");
      glass.addColorStop(1.00, "rgba(3,5,10,0.92)");
      g.fillStyle = glass;
      g.fill();
      // A raking highlight across the pane.
      g.save();
      roundRect(g, 8, 8, w - 16, h - 16, 24);
      g.clip();
      const sheen = g.createLinearGradient(0, 0, w * 0.7, h);
      sheen.addColorStop(0.00, "rgba(190,220,255,0.00)");
      sheen.addColorStop(0.34, "rgba(190,220,255,0.075)");
      sheen.addColorStop(0.42, "rgba(190,220,255,0.00)");
      g.fillStyle = sheen;
      g.fillRect(0, 0, w, h);
      g.restore();
      for (const [lw, al] of [[9, 0.10], [5, 0.22], [2.4, 0.85]]) {
        g.lineWidth = lw;
        g.strokeStyle = "rgba(180,214,255," + al + ")";
        g.stroke();
      }
      roundRect(g, 20, 20, w - 40, h - 40, 15);
      g.lineWidth = 1.5;
      g.strokeStyle = "rgba(180,214,255,0.16)";
      g.stroke();
      // Corner brackets: an instrument face, not a text box.
      g.strokeStyle = "rgba(180,214,255,0.55)";
      g.lineWidth = 3;
      for (const sx of [0, 1]) for (const sy of [0, 1]) {
        const bx = sx ? w - 26 : 26, by = sy ? h - 26 : 26;
        const dx = sx ? -22 : 22, dy = sy ? -18 : 18;
        g.beginPath();
        g.moveTo(bx + dx, by); g.lineTo(bx, by); g.lineTo(bx, by + dy);
        g.stroke();
      }
      g.save();
      g.translate(30, 34);
      payloadArt(g, w - 60, h - 68, sig, { ink: "#eef7ff", label: false });
      g.restore();
      plateTex.needsUpdate = true;
    }

    // --- lights -----------------------------------------------------------
    scene.add(new THREE.AmbientLight(0x24344f, 0.55));
    const coreLight = new THREE.PointLight(IDLE.hex, 1.2, K(4.6), 2);
    scene.add(coreLight);
    const rim = new THREE.DirectionalLight(0x9fc4ff, 0.5);
    rim.position.set(0.6, 0.9, 1.2);
    scene.add(rim);

    /* =============================================================
     * 2D — the console plating
     * ============================================================= */
    const fxc = ctx.createCanvas2D({ touchAction: "none" });
    const fx = fxc.getContext("2d");
    // The 2D layer is created after the WebGL one, so it stacks above it. Every
    // fill is clipped outside the port, which leaves the port transparent and
    // the core burning through from below.

    let frameArt = null;
    // Station nameplates are baked into the frame, so they also sit under
    // the title screen — where the scrim is deliberately thin over the core
    // and they came through as ghost text across the tagline and the CREW
    // label. The board itself is wanted back there; the labelling is not.
    let platesOn = false;
    const zoneArt = [null, null, null, null];
    const zoneKey = ["", "", "", ""];

    /**
     * The static console: plating, radar arcs, the lit rail at the port, hazard
     * banding at the outer edge and each station's name. Baked once per layout
     * because none of it moves.
     */
    function paintFrame(g) {
      g.clearRect(0, 0, W, H);
      const edge = 15;                                   // hazard band depth

      for (let i = 0; i < crew; i++) {
        const st = STATIONS[i];
        const a = anchor(i);
        g.save();
        clipZone(g, i);
        clipOutsidePort(g);

        // Plate: lit steel where the player's hands are, sinking toward the
        // core so the port's own light has something to fall on.
        const mid = sectors[i][0] + ((sectors[i][1] - sectors[i][0] + 360) % 360) / 2;
        const outer = ray(mid, 1);
        const gr = g.createLinearGradient(outer.x, outer.y, cx, cy);
        gr.addColorStop(0.00, "rgb(" + Math.round(20 + st.rgb[0] * 0.13) + "," +
          Math.round(26 + st.rgb[1] * 0.13) + "," + Math.round(36 + st.rgb[2] * 0.13) + ")");
        gr.addColorStop(0.34, "#141b27");
        gr.addColorStop(0.72, "#0d131d");
        gr.addColorStop(1.00, "#080c13");
        g.fillStyle = gr;
        g.fillRect(0, 0, W, H);

        // Brushed grain. A flat fill on a phone reads as a bug, not a panel.
        g.globalAlpha = 0.05;
        for (let k = 0; k < 260; k++) {
          const y = Math.random() * H;
          g.strokeStyle = Math.random() < 0.5 ? "#ffffff" : "#000000";
          g.lineWidth = Math.random() * 1.5;
          g.beginPath();
          g.moveTo(Math.random() * W, y);
          g.lineTo(Math.random() * W + 60, y + (Math.random() - 0.5) * 2);
          g.stroke();
        }
        g.globalAlpha = 1;

        // Conduits: radial runs from the seat into the core, a few of them lit.
        for (let k = 0; k < 15; k++) {
          const deg = sectors[i][0] + ((sectors[i][1] - sectors[i][0] + 360) % 360) * (k + 0.5) / 15;
          const p0 = ray(deg, portR / (H / 2) * 1.06), p1 = ray(deg, 3);
          const lit = k % 4 === 1;
          g.strokeStyle = lit ? rgba(st.rgb, 0.16) : "rgba(150,180,220,0.055)";
          g.lineWidth = lit ? 2.2 : 1;
          g.beginPath();
          g.moveTo(p0.x, p0.y);
          g.lineTo(p1.x, p1.y);
          g.stroke();
        }

        // Radar arcs stepping out from the port.
        for (let k = 0; k < 11; k++) {
          const r = portR + 20 + k * 42;
          g.strokeStyle = k === 0 ? rgba(st.rgb, 0.34)
            : k % 3 === 0 ? rgba(st.rgb, 0.13) : "rgba(150,180,220,0.085)";
          g.lineWidth = k === 0 ? 2 : k % 3 === 0 ? 1.4 : 1;
          g.beginPath();
          g.arc(cx, cy, r, 0, TAU);
          g.stroke();
        }

        // Rivets.
        g.fillStyle = "rgba(180,205,240,0.10)";
        for (let ry = 24; ry < H; ry += 40) {
          for (let rx = 20; rx < W; rx += 40) {
            g.beginPath();
            g.arc(rx, ry, 1.5, 0, TAU);
            g.fill();
          }
        }

        // Hazard banding along the screen edges this wedge actually reaches —
        // the strip that ends up right under the player's hand.
        g.save();
        g.beginPath();
        g.rect(0, 0, W, edge);
        g.rect(0, H - edge, W, edge);
        g.rect(0, 0, edge, H);
        g.rect(W - edge, 0, edge, H);
        g.clip();
        g.fillStyle = "rgba(6,9,14,0.9)";
        g.fillRect(0, 0, W, H);
        for (let k = -H; k < W + H; k += 24) {
          g.fillStyle = rgba(st.rgb, 0.55);
          g.beginPath();
          g.moveTo(k, 0); g.lineTo(k + 12, 0); g.lineTo(k + 12 + H, H); g.lineTo(k + H, H);
          g.closePath(); g.fill();
        }
        g.restore();
        // A hairline inboard of the hazard band, so it reads as an applied strip.
        g.strokeStyle = rgba(st.rgb, 0.30);
        g.lineWidth = 1;
        g.strokeRect(edge + 0.5, edge + 0.5, W - edge * 2 - 1, H - edge * 2 - 1);

        // The lit rail: a thick arc hugging the port in the station's colour,
        // so at a glance you can see which slice of the rim belongs to you.
        g.save();
        wedgePath(g, i);
        g.clip();
        for (const [w, al] of [[18, 0.035], [10, 0.065], [4.4, 0.16], [1.6, 0.40]]) {
          g.strokeStyle = rgba(st.rgb, al);
          g.lineWidth = w;
          g.beginPath();
          g.arc(cx, cy, portR + 9, 0, TAU);
          g.stroke();
        }
        g.restore();

        // Station plate — number over colour name, turned to face the seat.
        //
        // Where it can go depends on which axis the console lies along, and
        // the two cases are genuinely different on a portrait screen. A top or
        // bottom console has the whole width of the plating inboard of it. A
        // side console has 14px of plating outboard of it and the port bezel
        // immediately inboard, so its plate goes past the end of the strip
        // instead, along the same edge. Both land inside the safe area, clear
        // of the port and clear of the strip: before this the plate for a side
        // seat was drawn underneath the core, and every colour name was off
        // the screen entirely — so the two players on the long edges had no
        // name anywhere, while the game-over card announces the winner by
        // colour.
        const side = st.key === "left" || st.key === "right";
        const plateX = side ? -(STRIP_W / 2 + 64) : 0;
        const plateY = side ? -7 : -74;
        g.save();
        g.translate(a.x, a.y);
        g.rotate(a.rad);
        if (platesOn) {
          g.fillStyle = rgba(st.rgb, 0.92);
          tracked(g, "STATION " + (i + 1), plateX, plateY, 10, 3.8, "center", 120);
          g.fillStyle = "rgba(219,230,245,0.42)";
          tracked(g, st.name, plateX, plateY + 14, 8, 3.0, "center", 108);
        }
        // Corner brackets around the readout slot.
        g.strokeStyle = rgba(st.rgb, 0.34);
        g.lineWidth = 1.6;
        for (const sx of [-1, 1]) {
          for (const sy of [-1, 1]) {
            const bx = sx * (STRIP_W / 2 + 10), by = sy * (STRIP_H / 2 + 6);
            g.beginPath();
            g.moveTo(bx - sx * 13, by);
            g.lineTo(bx, by);
            g.lineTo(bx, by - sy * 11);
            g.stroke();
          }
        }
        g.restore();
        g.restore();
      }

      // Mitre lines between neighbouring stations.
      for (let i = 0; i < crew; i++) {
        const p = ray(sectors[i][0], 3);
        g.save();
        clipOutsidePort(g);
        g.strokeStyle = "rgba(4,6,11,0.95)";
        g.lineWidth = 6;
        g.beginPath(); g.moveTo(cx, cy); g.lineTo(p.x, p.y); g.stroke();
        g.strokeStyle = "rgba(170,200,240,0.28)";
        g.lineWidth = 1;
        g.beginPath(); g.moveTo(cx, cy); g.lineTo(p.x, p.y); g.stroke();
        g.restore();
      }

      // Port bezel: a machined collar with a graduated scale around it.
      g.save();
      clipOutsidePort(g);
      const bez = g.createRadialGradient(cx, cy, portR, cx, cy, portR + 26);
      bez.addColorStop(0.00, "#4a596f");
      bez.addColorStop(0.22, "#212b3c");
      bez.addColorStop(1.00, "rgba(11,15,22,0)");
      g.fillStyle = bez;
      g.beginPath();
      g.arc(cx, cy, portR + 26, 0, TAU);
      g.fill();
      g.strokeStyle = "rgba(205,228,255,0.70)";
      g.lineWidth = 1.6;
      g.beginPath();
      g.arc(cx, cy, portR + 1.5, 0, TAU);
      g.stroke();
      for (let k = 0; k < 84; k++) {
        const ang = k * TAU / 84;
        const long = k % 7 === 0;
        const r0 = portR + 7, r1 = portR + (long ? 19 : 12);
        g.strokeStyle = long ? "rgba(210,232,255,0.55)" : "rgba(170,200,240,0.24)";
        g.lineWidth = long ? 2 : 1;
        g.beginPath();
        g.moveTo(cx + Math.cos(ang) * r0, cy + Math.sin(ang) * r0);
        g.lineTo(cx + Math.cos(ang) * r1, cy + Math.sin(ang) * r1);
        g.stroke();
      }
      // Four bolt heads on the collar, on the mitre diagonals.
      for (let k = 0; k < 4; k++) {
        const ang = Math.PI / 4 + k * Math.PI / 2;
        const bx = cx + Math.cos(ang) * (portR + 17), by = cy + Math.sin(ang) * (portR + 17);
        g.beginPath(); g.arc(bx, by, 4.2, 0, TAU);
        g.fillStyle = "#3d4a60"; g.fill();
        g.strokeStyle = "rgba(210,232,255,0.4)"; g.lineWidth = 1; g.stroke();
      }
      g.restore();
    }

    function bakeFrame() {
      const c = surface(W * ctx.dpr, H * ctx.dpr);
      if (!c) { frameArt = null; return; }
      const g = c.getContext("2d");
      g.setTransform(ctx.dpr, 0, 0, ctx.dpr, 0, 0);
      paintFrame(g);
      frameArt = c;
    }

    /* ---------------------------------------------------------------
     * The readout strip. 264×88, identical for every seat — the layout a
     * player learns at the bottom of the table is the layout they get if
     * they move to the side.
     * ------------------------------------------------------------- */
    const STRIP_W = 264, STRIP_H = 80;

    function paintStrip(g, i) {
      const st = STATIONS[i];
      const x0 = -STRIP_W / 2, y0 = -STRIP_H / 2;
      const dead = locked[i] && (phase === "charge" || phase === "armed" || phase === "resolve");

      // Backing.
      roundRect(g, x0, y0, STRIP_W, STRIP_H, 12);
      g.fillStyle = "rgba(6,9,15,0.72)";
      g.fill();
      g.strokeStyle = dead ? "rgba(255,51,68,0.55)" : rgba(st.rgb, 0.30);
      g.lineWidth = 1.2;
      g.stroke();

      // --- score block -------------------------------------------------
      const sx = x0 + 30;
      g.textAlign = "center";
      g.fillStyle = dead ? "rgba(255,120,130,0.9)" : st.ink;
      g.font = "800 32px " + FONT;
      g.fillText(String(scores[i]), sx, y0 + 40);
      // Segment bar: one notch per point needed to hold the core.
      const bw = 52, bx = sx - bw / 2, by = y0 + 50;
      for (let k = 0; k < settings.target; k++) {
        const seg = bw / settings.target;
        g.fillStyle = k < scores[i] ? st.ink : "rgba(150,180,220,0.16)";
        g.fillRect(bx + k * seg, by, Math.max(1.4, seg - 1.1), 5);
      }
      g.fillStyle = "rgba(219,230,245,0.34)";
      tracked(g, "OF " + settings.target, sx, y0 + 68, 7.5, 1.8, "center", 56);

      // --- centre panel --------------------------------------------------
      const mx = x0 + 64, mw = 124, mh = 60, my = y0 + 10;
      if (phase === "brief") {
        // Round card: the type name spread across the panel and the status
        // column, because between rounds legibility beats density.
        const T = TYPE[roundKind];
        g.textAlign = "left";
        g.fillStyle = "rgba(219,230,245,0.45)";
        tracked(g, "ROUND " + roundNo, mx, y0 + 21, 8, 2.2, "left");
        const label = T.name;
        g.fillStyle = rgba(T.rgb, 1);
        const fs = fitFont(g, label, 118, 28, "800", FONT);
        g.font = "800 " + fs + "px " + FONT;
        g.fillText(label, mx, y0 + 50);
        g.fillStyle = "rgba(219,230,245,0.62)";
        tracked(g, roundKind === "count" ? "TAP ON " + countTarget : T.rule,
          mx, y0 + 68, 8.5, 1.9, "left", 190);
      } else if (phase === "stations") {
        roundRect(g, mx, my, mw, mh, 9);
        g.fillStyle = zoneArmed[i] ? rgba(st.rgb, 0.18) : "rgba(150,180,220,0.06)";
        g.fill();
        g.strokeStyle = zoneArmed[i] ? rgba(st.rgb, 0.8) : "rgba(150,180,220,0.22)";
        g.lineWidth = 1.2;
        g.stroke();
        g.fillStyle = zoneArmed[i] ? st.ink : "rgba(219,230,245,0.65)";
        tracked(g, zoneArmed[i] ? "ARMED" : "TAP TO ARM", mx + mw / 2, my + mh / 2 + 4, 11, 2.6, "center");
      } else {
        roundRect(g, mx, my, mw, mh, 9);
        g.fillStyle = "rgba(3,6,11,0.85)";
        g.fill();
        g.strokeStyle = dead ? "rgba(255,51,68,0.35)" : rgba(st.rgb, 0.26);
        g.lineWidth = 1.1;
        g.stroke();
        if (!dead && sig.kind) {
          g.save();
          roundRect(g, mx, my, mw, mh, 9);
          g.clip();
          g.translate(mx, my);
          payloadArt(g, mw, mh, sig, { ink: "#e8f2ff" });
          g.restore();
        } else if (phase === "over") {
          g.save();
          roundRect(g, mx, my, mw, mh, 9);
          g.clip();
          g.fillStyle = winner === i ? st.ink : "rgba(219,230,245,0.34)";
          tracked(g, winner === i ? "CORE HELD" : "STAND DOWN",
            mx + mw / 2, my + mh / 2 + 4, 11, 2.4, "center");
          g.restore();
        } else if (dead) {
          g.save();
          roundRect(g, mx, my, mw, mh, 9);
          g.clip();
          for (let k = -mh; k < mw + mh; k += 12) {          // scram hatching
            g.strokeStyle = "rgba(255,51,68,0.30)";
            g.lineWidth = 4;
            g.beginPath();
            g.moveTo(mx + k, my); g.lineTo(mx + k + mh, my + mh);
            g.stroke();
          }
          g.fillStyle = "#ff6b76";
          tracked(g, "SCRAM", mx + mw / 2, my + mh / 2 + 5, 14, 3.4, "center");
          g.restore();
        }
      }

      // --- status column ---------------------------------------------------
      if (phase !== "brief") {
        const tx = x0 + 196, tw = 62;
        g.textAlign = "left";
        let l1 = "", l2 = "", l3 = "", c1 = rgba(st.rgb, 0.95);
        if (phase === "stations") { l1 = "STANDBY"; l2 = "TAKE"; l3 = "YOUR EDGE"; }
        else if (phase === "over") {
          l1 = winner === i ? "WINNER" : "FINAL";
          l2 = scores[i] + " PTS";
          c1 = winner === i ? st.ink : "rgba(219,230,245,0.5)";
        } else if (phase === "resolve") {
          if (roundWinner === i) { l1 = "CLAIMED"; l2 = "+1"; l3 = Math.round(lastReaction) + " MS"; }
          else if (locked[i]) { l1 = "SCRAM"; l2 = "-1"; l3 = "LOCKED"; c1 = "#ff6b76"; }
          else { l1 = "MISSED"; l2 = "--"; c1 = "rgba(219,230,245,0.42)"; }
        } else {
          const T = TYPE[roundKind];
          l1 = T.name;
          l2 = roundKind === "count" ? "TAP ON " + countTarget : T.rule;
          c1 = locked[i] ? "#ff6b76" : rgba(T.rgb, 0.95);
          if (locked[i]) { l1 = "SCRAM"; l2 = "LOCKED OUT"; }
        }
        // At game over the summary card covers the middle 252pt of the screen,
        // which is the inboard third of a side seat's strip. Shifting the
        // column one row outboard keeps every word of it in the clear instead
        // of leaving the top line sliced in half by the card's edge.
        const r0 = phase === "over" ? 39 : 22;
        g.fillStyle = c1;
        tracked(g, l1, tx, y0 + r0, 10, 1.9, "left", tw);
        if (l2) {
          g.fillStyle = "rgba(219,230,245,0.62)";
          tracked(g, l2, tx, y0 + r0 + 17, 8.5, 1.2, "left", tw);
        }
        if (l3) {
          g.fillStyle = "rgba(219,230,245,0.40)";
          tracked(g, l3, tx, y0 + r0 + 32, 8.5, 1.2, "left", tw);
        }
        // Round counter, bottom right of the strip.
        if (phase !== "over" && phase !== "stations") {
          g.fillStyle = "rgba(219,230,245,0.26)";
          tracked(g, "R" + roundNo, tx, y0 + 70, 7.5, 1.5, "left", tw);
        }
      }
    }

    /** Content signature — the strip is only repainted when it would differ. */
    function stripKey(i) {
      return phase + "|" + roundNo + "|" + scores[i] + "|" + (locked[i] ? 1 : 0) + "|" +
        (zoneArmed[i] ? 1 : 0) + "|" + sigSerial + "|" + roundWinner + "|" + winner + "|" +
        Math.round(lastReaction) + "|" + settings.target;
    }
    function refreshStrip(i) {
      const k = stripKey(i);
      if (zoneKey[i] === k && zoneArt[i]) return;
      zoneKey[i] = k;
      const c = zoneArt[i] || surface(STRIP_W * ctx.dpr, STRIP_H * ctx.dpr);
      if (!c) { zoneArt[i] = null; return; }
      zoneArt[i] = c;
      const g = c.getContext("2d");
      g.setTransform(ctx.dpr, 0, 0, ctx.dpr, 0, 0);
      g.clearRect(0, 0, STRIP_W, STRIP_H);
      g.save();
      g.translate(STRIP_W / 2, STRIP_H / 2);
      paintStrip(g, i);
      g.restore();
    }

    /* =============================================================
     * STATE
     * ============================================================= */
    let phase = "menu";        // menu | stations | brief | charge | armed | resolve | over
    const scores = [0, 0, 0, 0];
    const locked = [false, false, false, false];
    const zoneArmed = [false, false, false, false];
    const zoneFlash = [0, 0, 0, 0];
    const zoneFlashCol = [null, null, null, null];

    let roundNo = 0, roundKind = "go", countTarget = 4;
    let sig = { kind: null, on: false };
    let sigSerial = 0;
    let phaseUntil = 0, armAt = 0, armedAt = 0, cycleAt = 0, cyclesLeft = 0;
    let holdUntil = 0, chargeFrom = 0, roundStart = 0, tickAt = 0;
    let roundWinner = -1, lastReaction = 0, bestReaction = Infinity;
    let winner = -1, matchStart = 0, falseStarts = 0, roundsPlayed = 0;
    let charge = 0, shake = 0, dischargeCol = null, stationsSince = 0;

    function setSignal(next) {
      sig = next;
      sigSerial++;
      if (sig.kind === "go" || !sig.kind) { plate.visible = false; }
      else { paintPlate(sig); plate.visible = !!plateTex; }
    }

    /* --- signal generators ------------------------------------------- */
    function makeMatch(want) {
      const a = rnd(6);
      let b = a;
      if (!want) { do { b = rnd(6); } while (b === a); }
      return { kind: "match", on: want, a, b };
    }
    function makeCount(want) {
      let n = countTarget;
      if (!want) { do { n = 2 + rnd(6); } while (n === countTarget); }
      return { kind: "count", on: want, n, target: countTarget };
    }
    function makeMath(want) {
      const ops = ["+", "-", "x"];
      const op = ops[rnd(3)];
      let A, B;
      if (op === "x") { A = 2 + rnd(7); B = 2 + rnd(7); }
      else {
        A = 2 + rnd(11); B = 2 + rnd(11);
        if (op === "-" && B > A) { const t = A; A = B; B = t; }
      }
      const real = op === "+" ? A + B : op === "-" ? A - B : A * B;
      let shown = real;
      if (!want) {
        const d = [1, -1, 2, -2, 3, -3][rnd(6)];
        shown = real + d;
        if (shown < 0 || shown === real) shown = real + 1 + rnd(2);
      }
      return { kind: "math", on: want, text: A + " " + op + " " + B + " = " + shown };
    }
    function makeSignal(want) {
      if (roundKind === "go") return { kind: "go", on: want };
      if (roundKind === "match") return makeMatch(want);
      if (roundKind === "count") return makeCount(want);
      return makeMath(want);
    }
    function cycleMs() {
      const base = roundKind === "math" ? 1180 : roundKind === "count" ? 800 : 720;
      return base * pace();
    }
    function holdMs() {
      return (roundKind === "math" ? 2000 : 1550) * pace();
    }

    /* --- round machine ------------------------------------------------ */
    function beginMatch() {
      scores.fill(0);
      locked.fill(false);
      roundNo = 0;
      roundWinner = -1;
      winner = -1;
      lastReaction = 0;
      bestReaction = Infinity;
      falseStarts = 0;
      roundsPlayed = 0;
      matchStart = now();
      shell.el("over").style.display = "none";
      beginRound();
    }

    function beginRound() {
      roundNo++;
      // Random, but a type rarely repeats back to back — the whole point is
      // that nobody settles into one reflex.
      let k = TYPES[rnd(4)];
      let guard = 0;
      while (k === roundKind && Math.random() < 0.8 && guard++ < 6) k = TYPES[rnd(4)];
      roundKind = k;
      if (k === "count") countTarget = 3 + rnd(4);
      locked.fill(false);
      roundWinner = -1;
      lastReaction = 0;
      setSignal({ kind: null, on: false });
      phase = "brief";
      roundStart = now();
      phaseUntil = roundStart + 2200 * pace();
      sound.sting("tap");
      sound.heat(0.2);
      updateChrome();
    }

    /** Swap the signal and tick. Same cue for a decoy and for the real one. */
    function cycleSignal(want) {
      setSignal(makeSignal(want));
      sound.sting("tap");
    }

    function beginCharge() {
      phase = "charge";
      chargeFrom = now();
      tickAt = chargeFrom + 420;                 // GO has no cycles of its own
      setSignal(makeSignal(false));
      if (roundKind === "go") {
        armAt = chargeFrom + (1150 + Math.random() * 2500) * pace();
      } else {
        cycleAt = chargeFrom + cycleMs();
        cyclesLeft = 2 + rnd(3);
      }
      updateChrome();
    }

    function arm() {
      phase = "armed";
      armedAt = now();
      if (roundKind === "go") {
        setSignal(makeSignal(true));
        flashWave(GREEN.hex, 1.0);
        sound.duck(0.4, 240);
      } else {
        cycleSignal(true);                       // indistinguishable from a decoy
      }
      holdUntil = armedAt + holdMs();
      updateChrome();
    }

    function disarm() {
      // Nobody took it inside the hold window: back to decoys, and it can come
      // true again. Without this a missed signal would freeze the round.
      phase = "charge";
      cycleSignal(false);
      cycleAt = now() + cycleMs();
      cyclesLeft = 2 + rnd(2);
    }

    function claim(i, t) {
      roundWinner = i;
      lastReaction = Math.max(0, t - armedAt);
      if (lastReaction < bestReaction) bestReaction = lastReaction;
      scores[i]++;
      roundsPlayed++;
      zoneFlash[i] = 1;
      zoneFlashCol[i] = STATIONS[i].rgb;
      dischargeCol = STATIONS[i];
      flashWave(STATIONS[i].hex, 1.4);
      blastMotes();
      shake = 0.028;
      phase = "resolve";
      phaseUntil = t + 1750;
      sound.duck(0.5, 320);
      sound.sting(scores[i] >= settings.target ? "win" : "coin");
      sound.haptic("medium");
      sound.heat(0.25);
      ctx.platform.setScore(Math.max.apply(null, scores.slice(0, crew)));
      ctx.platform.interact({ type: "claim", station: i, round: roundKind, ms: Math.round(lastReaction) });
      updateChrome();
    }

    function scram(i) {
      locked[i] = true;
      scores[i] = Math.max(0, scores[i] - 1);
      falseStarts++;
      zoneFlash[i] = 1;
      zoneFlashCol[i] = [255, 51, 68];
      shake = 0.016;
      sound.sting("fail");
      sound.haptic("error");
      ctx.platform.interact({ type: "scram", station: i, round: roundKind });
      // Everybody jumped: no point dragging the round out.
      let live = 0;
      for (let k = 0; k < crew; k++) if (!locked[k]) live++;
      if (live === 0) voidRound();
    }

    function voidRound() {
      roundWinner = -1;
      roundsPlayed++;
      phase = "resolve";
      phaseUntil = now() + 1450;
      dischargeCol = null;
      setSignal({ kind: null, on: false });
      updateChrome();
    }

    function afterResolve() {
      let best = -1;
      for (let i = 0; i < crew; i++) if (scores[i] >= settings.target && (best < 0 || scores[i] > scores[best])) best = i;
      if (best >= 0) return endMatch(best);
      beginRound();
    }

    async function endMatch(w) {
      phase = "over";
      winner = w;
      const st = STATIONS[w];
      const el = shell.el;
      el("over-name").textContent = st.name;
      el("over-name").style.color = st.ink;
      el("over-name").style.textShadow = "0 0 34px " + st.ink + "88";
      el("over-echo").textContent = st.name + " HOLDS THE CORE";
      el("over-echo").style.color = st.ink;
      const best = isFinite(bestReaction) ? Math.round(bestReaction) + " ms" : "—";
      el("over-stat").innerHTML =
        '<span style="opacity:.5">FASTEST REACTION</span> &nbsp;<b style="color:#eaf4ff">' +
        esc(best) + "</b>";
      el("over-rows").innerHTML = STATIONS.slice(0, crew).map((s, i) =>
        '<div style="display:flex;align-items:center;gap:10px;padding:7px 0;">' +
          '<span style="width:9px;height:9px;border-radius:3px;background:' + s.ink + ';"></span>' +
          '<span style="flex:1;font-size:12px;letter-spacing:0.16em;opacity:' + (i === w ? "1" : ".55") + ';">' +
            esc(s.name) + "</span>" +
          '<span style="font-size:19px;font-weight:800;color:' + (i === w ? s.ink : "rgba(219,230,245,.6)") + ';">' +
            scores[i] + "</span></div>").join("");
      el("over").style.background = "radial-gradient(circle at 50% 50%," +
        st.ink + "26 0%,rgba(4,7,13,0.88) 40%,rgba(3,5,10,0.96) 100%)";
      el("over").style.display = "flex";
      setSignal({ kind: null, on: false });      // no stale equation on the consoles
      dischargeCol = st;
      flashWave(st.hex, 1.8);
      blastMotes();
      sound.duck(0.6, 500);
      sound.sting("success");
      sound.haptic("heavy");
      sound.heat(0.15);
      updateChrome();
      ctx.platform.milestone("match", { winner: st.name, rounds: roundsPlayed });
      ctx.platform.complete({
        winner: st.name, crew, scores: scores.slice(0, crew),
        rounds: roundsPlayed, falseStarts,
        fastestMs: isFinite(bestReaction) ? Math.round(bestReaction) : null,
      });
      // The record belongs to the match, not to one of the people round the
      // table: the sharpest hand on this phone tonight.
      try {
        if (isFinite(bestReaction)) {
          await ctx.memory.record("fastest_reaction")
            .submit(Math.round(bestReaction), { label: Math.round(bestReaction) + " ms" });
        }
      } catch (_) { /* offline is fine; the duel still happened */ }
    }

    /* --- core effects -------------------------------------------------- */
    function flashWave(hex, power) {
      waveMat.color.setHex(hex);
      waveT = 1;
      wave.visible = true;
      wave.scale.setScalar(0.5);
      waveMat.opacity = 0.9 * Math.min(power, 1.4);
    }
    function blastMotes() {
      for (const m of moteState) {
        m.blast = 1;
        m.vr = K(1.1 + Math.random() * 2.4);
        m.vy = (Math.random() - 0.5) * K(2.0);
      }
    }

    /* =============================================================
     * OVERLAY — one markup string on the runtime-owned root.
     * ============================================================= */
    const ROUND_HELP = [
      ["GO", TYPE.go.hexStr, "The core burns red, then turns green. Slap on green."],
      ["MATCH", TYPE.match.hexStr, "Two glyphs cycle. Slap only when they are identical."],
      ["COUNT", TYPE.count.hexStr, "Dots flash. Slap only when exactly N are lit."],
      ["MATH", TYPE.math.hexStr, "An equation cycles. Slap only when it is correct."],
    ];
    const btn = "pointer-events:auto;width:34px;height:34px;border-radius:11px;border:none;" +
      "background:rgba(150,190,240,0.14);color:#dbe6f5;font-size:14px;line-height:1;" +
      "font-family:inherit;padding:0;";
    const bigBtn = (bg, fg) => "width:100%;box-sizing:border-box;padding:15px;border:none;border-radius:14px;font-family:inherit;" +
      "font-size:15px;font-weight:800;letter-spacing:0.10em;background:" + bg + ";color:" + fg + ";";
    const panel = "max-width:326px;width:100%;background:rgba(11,16,25,0.98);border-radius:20px;" +
      "padding:20px;border:1px solid rgba(150,190,240,0.14);pointer-events:auto;";
    const panelHead = (t) => '<div style="font-size:10px;letter-spacing:0.34em;font-family:' + MONO +
      ';color:' + STATIONS[0].ink + ';">' + esc(t) + "</div>" +
      '<div style="height:1px;background:linear-gradient(90deg,' + STATIONS[0].ink +
      '55,rgba(150,190,240,0.05));margin:9px 0 15px;"></div>';
    const sectionLabel = (t) => '<div style="font-size:9.5px;letter-spacing:0.26em;font-family:' + MONO +
      ';opacity:0.62;">' + esc(t) + "</div>";
    const modal = "position:absolute;inset:0;display:none;align-items:center;justify-content:center;" +
      "background:rgba(3,5,10,0.92);z-index:70;pointer-events:auto;padding:" +
      (safeT + 12) + "px 20px " + (safeB + 12) + "px;";
    const crewBtn = (n, cap) =>
      '<button data-el="crew" data-n="' + n + '" style="pointer-events:auto;flex:1;padding:13px 5px 10px;' +
      'border:1px solid rgba(150,190,240,0.16);border-radius:15px;background:rgba(10,15,24,0.82);' +
      'color:#eaf4ff;font-family:inherit;">' +
      '<div style="display:flex;gap:3px;justify-content:center;margin-bottom:8px;">' +
        STATIONS.slice(0, n).map((s) => '<span style="width:13px;height:4px;border-radius:2px;' +
          'background:' + s.ink + ';"></span>').join("") + "</div>" +
      '<div style="font-size:26px;font-weight:800;line-height:1;">' + n + "</div>" +
      '<div style="font-size:7.5px;letter-spacing:0.13em;opacity:0.5;margin-top:6px;font-family:' +
        MONO + ';">' + cap + "</div></button>";

    const root = ctx.createRoot({ touchAction: "none" });
    root.style.cssText += ";font-family:" + FONT + ";color:#dbe6f5;pointer-events:none;" +
      "-webkit-user-select:none;user-select:none;text-transform:lowercase;";

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
      /* --- chrome, faded out while a round is live so a corner slap still counts --- */
      '<div data-el="chrome" style="position:absolute;right:8px;top:' + (safeT + 4) + 'px;' +
        'display:flex;flex-direction:column;gap:6px;z-index:60;pointer-events:none;' +
        'transition:opacity .25s;">' +
        '<button data-el="mute" aria-label="Sound" style="' + btn + '">' + SPK(!settings.mute) + '</button>' +
        '<button data-el="cog" aria-label="Settings" style="' + btn + '">&#9881;</button>' +
        '<button data-el="help" aria-label="How to play" style="' + btn + '">?</button>' +
      "</div>" +

      /* --- title --- */
      // Title, hero, call to action — stacked so the reactor burns in the middle
      // band of its own screen instead of being wallpaper behind the wordmark.
      // The scrim is a vertical gradient that stays out of that band.
      '<div data-el="menu" style="position:absolute;inset:0;display:flex;flex-direction:column;' +
        'align-items:center;justify-content:space-between;z-index:50;text-align:center;' +
        'pointer-events:auto;padding:' + (safeT + 26) + 'px 24px ' + (safeB + 24) + 'px;' +
        'background:linear-gradient(180deg,rgba(3,5,10,0.96) 0%,rgba(3,5,10,0.90) 22%,' +
        'rgba(4,7,13,0.20) 38%,rgba(4,7,13,0.16) 60%,rgba(3,5,10,0.90) 76%,rgba(3,5,10,0.97) 100%);">' +
        "<div>" +
          '<div style="font-size:9.5px;letter-spacing:0.52em;text-transform:lowercase;opacity:0.56;' +
            'font-family:' + MONO + ';">Reaction Duel</div>' +
          '<div style="font-size:52px;font-weight:800;letter-spacing:-0.03em;line-height:0.95;margin-top:12px;' +
            'background:linear-gradient(102deg,' + STATIONS[0].ink + ',' + STATIONS[2].ink + ' 38%,' +
            STATIONS[3].ink + ' 66%,' + STATIONS[1].ink + ');-webkit-background-clip:text;background-clip:text;' +
            '-webkit-text-fill-color:transparent;">REACTOR<br>FOUR</div>' +
          // The scrim above deliberately clears the core's band, which is right
          // on a phone and wrong on the 306x517 card, where the reactor sits
          // directly behind this paragraph and pale blue lands on pale lilac.
          // The copy carries its own plate; on a tall screen it is the same
          // near-black as the scrim and disappears. Colour alpha rather than
          // element opacity, or the plate would fade along with the ink.
          '<div style="font-size:13px;color:rgba(219,230,245,0.72);max-width:288px;' +
            'box-sizing:border-box;line-height:1.6;margin-top:16px;padding:10px 12px;' +
            'border-radius:14px;background:rgba(4,7,13,0.72);">' +
            "Phone flat. Claim an edge. Slap your own wedge the instant the signal is true &mdash; " +
            "and not one beat before.</div>" +
        "</div>" +
        "<div>" +
          '<div style="font-size:9.5px;letter-spacing:0.36em;text-transform:lowercase;opacity:0.56;' +
            'font-family:' + MONO + ';">Crew</div>' +
          '<div style="display:flex;gap:9px;margin-top:12px;width:100%;max-width:300px;">' +
            crewBtn(2, "TOP&middot;BOT") + crewBtn(3, "+LEFT") + crewBtn(4, "ALL EDGES") +
          "</div>" +
          '<div style="font-size:10px;letter-spacing:0.14em;opacity:0.56;margin-top:14px;' +
            'font-family:' + MONO + ';">EACH STATION ARMS ITS OWN WEDGE</div>' +
        "</div>" +
      "</div>" +

      /* --- stations: a fallback if somebody is not at the table --- */
      '<div data-el="skip" style="position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);' +
        'display:none;z-index:45;"><button data-el="skipb" style="pointer-events:auto;padding:11px 18px;' +
        'border:1px solid rgba(150,190,240,0.3);border-radius:999px;background:rgba(8,12,20,0.92);' +
        'color:#dbe6f5;font-family:inherit;font-size:11px;font-weight:700;letter-spacing:0.18em;">START ANYWAY</button></div>' +

      /* --- match over. The banner is repeated upside down so the player at
             the far edge is not the last to know. --- */
      // The scrim used to reach 0.93 by mid-radius and 0.98 at the corners,
      // which buried the thing it was sitting on: every station's own strip
      // still reports its result, rotated to its seat, and at 5% visibility
      // nobody but the bottom player could read theirs. It is held low and
      // even now — the summary card and both buttons carry their own opaque
      // plates, so they do not need the whole screen blacked out behind them.
      '<div data-el="over" style="position:absolute;inset:0;display:none;flex-direction:column;' +
        'align-items:center;justify-content:center;z-index:55;text-align:center;padding:' +
        (safeT + 16) + 'px 24px ' + (safeB + 16) + 'px;' +
        'pointer-events:auto;background:radial-gradient(circle at 50% 50%,rgba(4,7,13,0.52) 0%,' +
        'rgba(4,7,13,0.60) 45%,rgba(3,5,10,0.66) 100%);">' +
        '<div data-el="over-echo" style="position:absolute;top:' + (safeT + 22) + 'px;left:0;right:0;' +
          'transform:rotate(180deg);font-size:12px;font-weight:800;letter-spacing:0.30em;opacity:0.85;"></div>' +
        '<div style="width:100%;max-width:252px;box-sizing:border-box;' +
          'background:rgba(9,13,21,0.975);border-radius:22px;' +
          'border:1px solid rgba(150,190,240,0.16);padding:22px 20px 18px;">' +
          '<div style="font-size:9.5px;letter-spacing:0.44em;text-transform:lowercase;opacity:0.6;">Core secured by</div>' +
          '<div data-el="over-name" style="font-size:42px;font-weight:800;letter-spacing:-0.01em;margin-top:4px;line-height:1.05;"></div>' +
          '<div data-el="over-stat" style="font-size:10.5px;letter-spacing:0.16em;margin-top:8px;"></div>' +
          '<div data-el="over-rows" style="width:100%;margin-top:16px;' +
            'border-top:1px solid rgba(150,190,240,0.14);"></div>' +
        "</div>" +
        '<div style="width:100%;max-width:252px;display:flex;flex-direction:column;gap:9px;margin-top:16px;">' +
          '<button data-el="again" style="' + bigBtn("linear-gradient(96deg," + STATIONS[0].ink + "," + STATIONS[1].ink + ")", "#050a12") + '">REMATCH</button>' +
          '<button data-el="newcrew" style="' + bigBtn("rgba(16,23,36,0.94)", "#dbe6f5") +
            'box-shadow:inset 0 0 0 1px rgba(150,190,240,0.24);">CHANGE CREW</button>' +
        "</div>" +
      "</div>" +

      /* --- settings --- */
      '<div data-el="cogp" style="' + modal + '"><div style="' + panel + '">' +
        panelHead("REACTOR CONTROL") +
        sectionLabel("ROUNDS TO WIN") +
        '<div data-el="targets" style="display:flex;gap:7px;margin:9px 0 17px;"></div>' +
        sectionLabel("SIGNAL PACE") +
        '<div data-el="paces" style="display:flex;gap:7px;margin:9px 0 17px;"></div>' +
        sectionLabel("SOUND") +
        '<div data-el="mutes" style="display:flex;gap:7px;margin:9px 0 4px;"></div>' +
        '<button data-el="cogp-close" style="' + bigBtn("rgba(150,190,240,0.14)", "#eaf4ff") + 'margin-top:20px;">DONE</button>' +
      "</div></div>" +

      /* --- how to play --- */
      '<div data-el="helpp" style="' + modal + '"><div style="' + panel + '">' +
        panelHead("OPERATING PROCEDURE") +
        '<ul style="font-size:12.5px;line-height:1.52;opacity:0.86;padding-left:15px;margin:0 0 13px;">' +
          "<li>Phone flat. Take an edge each &mdash; you own the wedge in front of you.</li>" +
          "<li>Tap your wedge once to arm your station.</li>" +
          "<li>The round type is announced, then the core charges. Your console repeats " +
            "the signal the right way up for your seat.</li>" +
          "<li>First slap on a <b>true</b> signal takes the round: <b>+1</b>.</li>" +
          "<li>Slap on a <b>false</b> one and you scram: <b>&minus;1</b>, locked out for the round.</li>" +
        "</ul>" +
        sectionLabel("THE FOUR ROUNDS") +
        '<div style="font-size:12.5px;line-height:1.5;color:rgba(219,230,245,0.88);margin:9px 0 12px;">' +
          ROUND_HELP.map((r) =>
            '<div style="display:flex;gap:8px;margin-bottom:5px;">' +
            '<b style="color:' + r[1] + ';min-width:52px;font-family:' + MONO +
              ';font-size:11px;letter-spacing:0.12em;padding-top:2px;">' + esc(r[0]) + "</b>" +
            "<span>" + esc(r[2]) + "</span></div>").join("") +
        "</div>" +
        '<div style="font-size:11.5px;line-height:1.5;opacity:0.62;border-top:1px solid ' +
          'rgba(150,190,240,0.12);padding-top:10px;">Only GO turns the core green. In the other ' +
          "rounds the colour tells you nothing &mdash; read the signal. First station to the " +
          "target holds the core; the fastest reaction at the table goes to the global board.</div>" +
        '<button data-el="helpp-close" style="' + bigBtn("rgba(150,190,240,0.14)", "#eaf4ff") + 'margin-top:15px;">GOT IT</button>' +
      "</div></div>";

    const shell = {
      el: (n) => root.querySelector('[data-el="' + n + '"]'),
      all: (n) => [...root.querySelectorAll('[data-el="' + n + '"]')],
      tap: (node, fn) => {
        if (!node) return;
        ctx.listen(node, "pointerdown", (e) => e.stopPropagation());
        ctx.listen(node, "click", (e) => { e.stopPropagation(); e.preventDefault(); fn(e); });
      },
    };

    /** Chrome must not eat a slap: during a live round it fades out and stops
     *  taking pointers, so a corner hit falls through to the station under it. */
    function updateChrome() {
      const live = phase === "charge" || phase === "armed";
      const c = shell.el("chrome");
      c.style.opacity = live ? "0" : "1";
      for (const b of c.querySelectorAll("button")) b.style.pointerEvents = live ? "none" : "auto";
      shell.el("skip").style.display =
        (phase === "stations" && now() - stationsSince > 4500) ? "block" : "none";
    }

    function pills(host, values, labels, get, set) {
      host.innerHTML = values.map((v, i) =>
        '<button data-v="' + v + '" style="pointer-events:auto;flex:1;padding:11px 0;border:none;' +
        "border-radius:11px;font-family:inherit;font-size:12px;font-weight:700;letter-spacing:0.08em;\">" +
        esc(labels[i]) + "</button>").join("");
      const paint = () => {
        for (const b of host.querySelectorAll("button")) {
          const on = String(get()) === b.dataset.v;
          b.style.background = on ? "rgba(34,220,255,0.20)" : "rgba(150,190,240,0.07)";
          // 0.50 landed the off state at 4.3:1 on its own panel. The live pill
          // is cyan and boxed, so the quiet one can afford to be readable.
          b.style.color = on ? STATIONS[0].ink : "rgba(219,230,245,0.62)";
          b.style.boxShadow = on ? "inset 0 0 0 1px rgba(34,220,255,0.55)" : "none";
        }
      };
      for (const b of host.querySelectorAll("button")) {
        shell.tap(b, () => { set(b.dataset.v); saveSettings(); paint(); sound.haptic("light"); });
      }
      paint();
      return paint;
    }
    const paintTargets = pills(shell.el("targets"), [5, 10, 15], ["5", "10", "15"],
      () => settings.target, (v) => { settings.target = Number(v); zoneKey.fill(""); });
    pills(shell.el("paces"), [0, 1, 2], ["CALM", "NORMAL", "BRUTAL"],
      () => settings.pace, (v) => { settings.pace = Number(v); });
    const paintMutes = pills(shell.el("mutes"), [0, 1], ["ON", "MUTED"],
      () => (settings.mute ? 1 : 0), (v) => {
        const wantMute = v === "1";
        if (wantMute !== sound.muted) sound.toggle();
        shell.el("mute").innerHTML = SPK(!sound.muted);
      });

    shell.tap(shell.el("mute"), () => {
      const m = sound.toggle();
      shell.el("mute").innerHTML = SPK(!m);
      paintMutes();
    });
    shell.tap(shell.el("cog"), () => { shell.el("cogp").style.display = "flex"; sound.haptic("light"); });
    shell.tap(shell.el("cogp-close"), () => {
      shell.el("cogp").style.display = "none";
      zoneKey.fill("");
      paintTargets();
    });
    shell.tap(shell.el("help"), () => { shell.el("helpp").style.display = "flex"; sound.haptic("light"); });
    shell.tap(shell.el("helpp-close"), () => { shell.el("helpp").style.display = "none"; });

    for (const b of shell.all("crew")) {
      shell.tap(b, async () => {
        crew = settings.crew = Number(b.dataset.n);
        saveSettings();
        sectors = sectorsFor(crew);
        platesOn = true;
        bakeFrame();
        zoneKey.fill("");
        ctx.platform.start({ crew });
        await sound.unlock();
        sound.haptic("light");
        shell.el("menu").style.display = "none";
        goStations();
      });
    }
    shell.tap(shell.el("again"), () => {
      shell.el("over").style.display = "none";
      ctx.platform.interact({ type: "rematch" });
      beginMatch();
    });
    shell.tap(shell.el("newcrew"), () => {
      shell.el("over").style.display = "none";
      phase = "menu";
      platesOn = false;
      bakeFrame();
      shell.el("menu").style.display = "flex";
      updateChrome();
    });
    shell.tap(shell.el("skipb"), () => {
      for (let i = 0; i < crew; i++) zoneArmed[i] = true;
      shell.el("skip").style.display = "none";
      beginMatch();
    });

    function goStations() {
      phase = "stations";
      zoneArmed.fill(false);
      stationsSince = now();
      scores.fill(0);
      locked.fill(false);
      roundNo = 0;
      winner = -1;
      roundWinner = -1;
      setSignal({ kind: null, on: false });
      zoneKey.fill("");
      updateChrome();
    }

    /* =============================================================
     * INPUT
     *
     * A pointer is bound to the wedge it landed in and keeps it until it
     * lifts, and a wedge holds one pointer at a time. On a phone four
     * hands are hovering over the same glass: without both rules a hand
     * that lands across a mitre line, or a player's second finger, fires
     * a station that is not theirs.
     * ============================================================= */
    const owners = new Map();                    // pointerId -> station index

    ctx.listen(fxc, "pointerdown", (e) => {
      const t = now();
      const i = zoneAt(e.offsetX, e.offsetY);
      if (i >= crew) return;
      for (const v of owners.values()) if (v === i) return;   // that station already has a hand on it
      owners.set(e.pointerId, i);
      e.preventDefault();

      if (phase === "stations") {
        if (!zoneArmed[i]) {
          zoneArmed[i] = true;
          zoneFlash[i] = 0.8;
          zoneFlashCol[i] = STATIONS[i].rgb;
          sound.unlock();
          sound.sting("tap");
          sound.haptic("light");
          let all = true;
          for (let k = 0; k < crew; k++) if (!zoneArmed[k]) all = false;
          if (all) ctx.timeout(() => { if (phase === "stations") beginMatch(); }, 260);
        }
        return;
      }
      if (phase === "armed" && sig.on && roundWinner < 0 && !locked[i]) return claim(i, t);
      if (phase === "charge" && !locked[i]) {
        zoneFlash[i] = 1;
        return scram(i);
      }
    }, { passive: false });

    const release = (e) => { owners.delete(e.pointerId); };
    ctx.listen(fxc, "pointerup", release);
    ctx.listen(fxc, "pointercancel", release);

    /* =============================================================
     * FRAME
     * ============================================================= */
    const tmpCol = new THREE.Color();
    const driftCol = new THREE.Color();
    const idleCol = new THREE.Color(IDLE.hex);

    function updateState(t) {
      if (phase === "stations") {
        if (now() - stationsSince > 4500 && shell.el("skip").style.display !== "block") updateChrome();
        return;
      }
      if (phase === "brief" && t >= phaseUntil) return beginCharge();

      if (phase === "charge") {
        if (roundKind === "go") {
          // GO has nothing cycling, so it gets a metronome of its own: the
          // wait has to be audible or the red hold is just dead air.
          if (t >= tickAt) { tickAt = t + 430; sound.sting("tap"); }
          if (t >= armAt) arm();
        } else if (t >= cycleAt) {
          cyclesLeft--;
          if (cyclesLeft <= 0) arm();
          else { cycleSignal(false); cycleAt = t + cycleMs(); }
        }
        if (t - roundStart > 30000) voidRound();
        return;
      }
      if (phase === "armed") {
        if (roundKind === "go") {
          if (t - armedAt > 6000) voidRound();
        } else if (t >= holdUntil) disarm();
        return;
      }
      if (phase === "resolve" && t >= phaseUntil) afterResolve();
    }

    function updateCharge(t) {
      let target = 0;
      if (phase === "brief") target = 0.10 + 0.12 * clamp((t - roundStart) / (phaseUntil - roundStart), 0, 1);
      else if (phase === "charge" || phase === "armed") {
        target = clamp(0.26 + (t - chargeFrom) / 4600, 0, 1);
        if (phase === "armed" && roundKind === "go") target = 1;
      } else if (phase === "stations") target = 0.34;
      else if (phase === "menu") target = 0.36 + Math.sin(t * 0.0009) * 0.09;
      else target = 0.10;
      charge += (target - charge) * 0.10;
      sound.heat(phase === "charge" || phase === "armed" ? 0.25 + charge * 0.7 : 0.2);
    }

    function updateCore(dt, t) {
      // Colour: the round's own hue, going green only where green means go.
      let want = idleCol;
      if (phase === "menu" || phase === "stations") {
        // Cycle the four station colours so the crew picker shows whose colour
        // is whose. It holds on each one and crosses over quickly: a slow even
        // lerp spends most of its time on the muddy midpoints between hues.
        const f = (t / 3400) % 4;
        const i0 = Math.floor(f);
        const A = STATIONS[i0 % 4], B = STATIONS[(i0 + 1) % 4];
        const raw = clamp((f - i0 - 0.72) / 0.28, 0, 1);
        tmpCol.setHex(A.hex).lerp(driftCol.setHex(B.hex), raw * raw * (3 - 2 * raw));
        want = tmpCol;
      } else if (phase === "brief") { tmpCol.setHex(TYPE[roundKind].hex); want = tmpCol; }
      else if (phase === "charge") { tmpCol.setHex(TYPE[roundKind].hex); want = tmpCol; }
      else if (phase === "armed") { tmpCol.setHex(roundKind === "go" ? GREEN.hex : TYPE[roundKind].hex); want = tmpCol; }
      else if (phase === "resolve" && dischargeCol) { tmpCol.setHex(dischargeCol.hex); want = tmpCol; }
      else if (phase === "over" && dischargeCol) { tmpCol.setHex(dischargeCol.hex); want = tmpCol; }
      const snap = (phase === "armed" && roundKind === "go") || phase === "resolve" ? 0.45 : 0.10;
      coreCol.lerp(want, snap);

      const pulse = Math.sin(t * 0.001 * (2.4 + charge * 16)) * 0.5 + 0.5;
      const heat = charge + pulse * 0.13 * charge;

      coreMat.emissive.copy(coreCol);
      if (plasmaTex) plasmaTex.offset.x = (plasmaTex.offset.x + dt * (0.006 + charge * 0.05)) % 1;
      coreMat.emissiveIntensity = 0.52 + heat * 2.5;
      core.scale.setScalar(1 + heat * 0.14);
      core.rotation.y += dt * (0.25 + charge * 1.1);
      core.rotation.x += dt * 0.12;

      cageMat.color.copy(coreCol);
      cageMat.opacity = 0.10 + charge * 0.26;
      cage.rotation.y -= dt * (0.35 + charge * 2.2);
      cage.rotation.z += dt * (0.2 + charge * 0.9);
      cage.scale.setScalar(1 + heat * 0.10);

      for (const h of halos) {
        h.mesh.material.color.copy(coreCol);
        h.mesh.material.opacity = h.base * (0.50 + heat * 0.95);
        h.mesh.scale.setScalar(1 + heat * 0.10);
      }
      bloomMat.color.copy(coreCol);
      bloomMat.opacity = 0.07 + heat * 0.30;
      bloom.scale.setScalar(0.62 + heat * 0.34);

      ringMat.emissive.copy(coreCol);
      ringMat.emissiveIntensity = 0.10 + charge * 0.75;
      const spin = 0.3 + charge * 3.6;
      rings[0].mesh.rotation.z += dt * spin * 0.9;
      rings[0].mesh.rotation.x += dt * spin * 0.35;
      rings[1].mesh.rotation.y += dt * spin * 1.25;
      rings[2].mesh.rotation.x += dt * spin * 0.75;
      rings[2].mesh.rotation.z -= dt * spin * 0.5;

      // Rods pull out as the core heats: the tension made mechanical.
      rodMat.emissive.copy(coreCol);
      rodMat.emissiveIntensity = 0.3 + charge * 1.1;
      const rr = K(0.71) + charge * K(0.21);
      for (const m of rods) {
        const a = m.userData.a + t * 0.00006 * (1 + charge * 4);
        m.position.set(Math.cos(a) * rr, Math.sin(a) * rr, 0);
        m.rotation.z = -a + Math.PI / 2;
      }

      // Motes: drawn inward while charging, thrown outward on discharge.
      moteMat.color.copy(coreCol);
      moteMat.opacity = 0.25 + charge * 0.45;
      const inner = K(0.42), outer = K(1.36);
      for (let k = 0; k < MOTES; k++) {
        const m = moteState[k];
        if (m.blast > 0) {
          m.blast -= dt * 1.5;
          m.r += m.vr * dt;
          m.y += m.vy * dt;
          m.vr *= 0.94; m.vy *= 0.94;
          if (m.r > K(2.3)) { m.r = inner + Math.random() * (outer - inner); m.blast = 0; m.y = (Math.random() - 0.5) * K(1.35); }
        } else {
          m.a += dt * m.sp * (0.35 + charge * 2.4);
          m.r -= dt * (0.02 + charge * 0.32) * m.sp;
          m.y *= 1 - dt * 0.25 * charge;
          if (m.r < inner) { m.r = outer * (0.8 + Math.random() * 0.45); m.y = (Math.random() - 0.5) * K(1.55); }
        }
        motePos[k * 3] = Math.cos(m.a) * m.r;
        motePos[k * 3 + 1] = Math.sin(m.a) * m.r * 0.85 + m.y * 0.25;
        motePos[k * 3 + 2] = Math.sin(m.a * 1.7) * m.r * 0.5;
      }
      moteGeo.attributes.position.needsUpdate = true;

      coreLight.color.copy(coreCol);
      coreLight.intensity = 0.7 + heat * 2.6;

      if (waveT > 0) {
        waveT -= dt * 1.9;
        const p = 1 - Math.max(waveT, 0);
        wave.scale.setScalar(0.5 + p * 2.6);
        waveMat.opacity = Math.max(0, waveT) * 0.85;
        if (waveT <= 0) wave.visible = false;
      }

      chamber.rotation.z += dt * (0.02 + charge * 0.14);

      if (shake > 0.0004) {
        shake *= Math.pow(0.004, dt);
        camera.position.x = (Math.random() - 0.5) * shake * camDist;
        camera.position.y = (Math.random() - 0.5) * shake * camDist;
        camera.lookAt(0, 0, 0);
      } else if (camera.position.x !== 0) {
        camera.position.set(0, 0, camDist);
        camera.lookAt(0, 0, 0);
      }
      // A high charge trembles the whole assembly a little.
      if (charge > 0.72 && phase === "charge") {
        const j = (charge - 0.72) * 0.010;
        camera.position.x += (Math.random() - 0.5) * j;
        camera.position.y += (Math.random() - 0.5) * j;
      }
    }

    /* --- 2D paint ------------------------------------------------------ */
    function paint2D(t, dt) {
      const pixScale = fxc.width / W || ctx.dpr;
      fx.setTransform(pixScale, 0, 0, pixScale, 0, 0);
      fx.clearRect(0, 0, W, H);

      if (frameArt) fx.drawImage(frameArt, 0, 0, W, H);
      else paintFrame(fx);

      // Station readouts, each turned to its own seat.
      if (phase !== "menu") {
        for (let i = 0; i < crew; i++) {
          const a = anchor(i);
          refreshStrip(i);
          fx.save();
          clipZone(fx, i);
          clipOutsidePort(fx);
          fx.translate(a.x, a.y);
          fx.rotate(a.rad);
          if (zoneArt[i]) fx.drawImage(zoneArt[i], -STRIP_W / 2, -STRIP_H / 2, STRIP_W, STRIP_H);
          else paintStrip(fx, i);
          fx.restore();
        }
      }

      // Score around the rim. Each station's slice of the collar fills with its
      // own colour as it takes rounds, so the running score is legible from the
      // middle of the table without reading anybody else's console.
      if (phase !== "menu") {
        for (let i = 0; i < crew; i++) {
          const frac = clamp(scores[i] / settings.target, 0, 1);
          if (frac <= 0) continue;
          const st = STATIONS[i];
          const s0 = sectors[i][0];
          let span = sectors[i][1] - s0;
          if (span <= 0) span += 360;
          const pad = span * 0.05;
          const mid = s0 + span / 2, halfSpan = (span / 2 - pad) * frac;
          const a0 = pixAng(mid - halfSpan), a1 = pixAng(mid + halfSpan);
          fx.save();
          clipZone(fx, i);
          for (const [w, al] of [[15, 0.10], [9, 0.20], [5, 0.55], [2.2, 1]]) {
            fx.strokeStyle = rgba(st.rgb, al);
            fx.lineWidth = w;
            fx.lineCap = "butt";
            fx.beginPath();
            fx.arc(cx, cy, portR + 9, a0, a1);
            fx.stroke();
          }
          fx.restore();
        }
      }

      // Impact tint on the wedge that just acted.
      for (let i = 0; i < crew; i++) {
        if (zoneFlash[i] <= 0.001) continue;
        zoneFlash[i] *= Math.pow(0.0035, dt);
        const col = zoneFlashCol[i] || STATIONS[i].rgb;
        fx.save();
        clipZone(fx, i);
        clipOutsidePort(fx);
        fx.globalCompositeOperation = "lighter";
        const gr = fx.createRadialGradient(cx, cy, portR, cx, cy, portR + 340);
        gr.addColorStop(0, rgba(col, 0.42 * zoneFlash[i]));
        gr.addColorStop(0.5, rgba(col, 0.16 * zoneFlash[i]));
        gr.addColorStop(1, rgba(col, 0));
        fx.fillStyle = gr;
        fx.fillRect(0, 0, W, H);
        fx.restore();
      }

      // Locked-out stations are struck through with hazard hatching.
      for (let i = 0; i < crew; i++) {
        if (!locked[i] || phase === "menu" || phase === "over") continue;
        fx.save();
        clipZone(fx, i);
        clipOutsidePort(fx);
        fx.strokeStyle = "rgba(255,51,68,0.11)";
        fx.lineWidth = 7;
        for (let k = -H; k < W + H; k += 30) {
          fx.beginPath();
          fx.moveTo(k, 0);
          fx.lineTo(k + H, H);
          fx.stroke();
        }
        fx.restore();
      }

      // The port's own light spilling onto the plating. The inner stop is fully
      // transparent, so the additive pass never paints over the port itself.
      const cc = [Math.round(coreCol.r * 255), Math.round(coreCol.g * 255), Math.round(coreCol.b * 255)];
      const pulse = 0.5 + 0.5 * Math.sin(t * 0.001 * (2.4 + charge * 16));
      const spillA = (0.055 + charge * 0.26) * (0.82 + pulse * 0.18);
      fx.save();
      clipOutsidePort(fx);
      fx.globalCompositeOperation = "lighter";
      const r1 = portR + 300;
      const gr = fx.createRadialGradient(cx, cy, portR * 0.98, cx, cy, r1);
      gr.addColorStop(0, rgba(cc, 0));
      gr.addColorStop(0.001, rgba(cc, spillA));
      gr.addColorStop(0.12, rgba(cc, spillA * 0.42));
      gr.addColorStop(0.45, rgba(cc, spillA * 0.10));
      gr.addColorStop(1, rgba(cc, 0));
      fx.fillStyle = gr;
      fx.fillRect(cx - r1, cy - r1, r1 * 2, r1 * 2);
      // Pulses running out of the port, faster as the core winds up. The whole
      // feel of the game is the build, and the plating has to carry it too.
      if (phase === "charge" || phase === "armed") {
        const period = 1500 - charge * 950;
        for (let k = 0; k < 2; k++) {
          const ph = (((t + k * period * 0.5) % period) + period) % period / period;
          const rr = portR + 4 + ph * Math.max(W, H) * 0.42;
          fx.strokeStyle = rgba(cc, (1 - ph) * (1 - ph) * 0.34 * charge);
          fx.lineWidth = 1.6 + ph * 5;
          fx.beginPath();
          fx.arc(cx, cy, rr, 0, TAU);
          fx.stroke();
        }
      }

      // A hot ring right at the bezel — concentric strokes, never a blur filter.
      for (const [w, al] of [[13, 0.09], [7, 0.18], [3, 0.42], [1.4, 0.9]]) {
        fx.strokeStyle = rgba(cc, al * (0.35 + charge * 0.65));
        fx.lineWidth = w;
        fx.beginPath();
        fx.arc(cx, cy, portR + 3, 0, TAU);
        fx.stroke();
      }
      fx.restore();
    }

    /* --- the loop ------------------------------------------------------- */
    ctx.onFrame((dtMs) => {
      const dt = Math.min(dtMs, 60) / 1000;
      const t = now();
      updateState(t);
      updateCharge(t);
      updateCore(dt, t);
      renderer.render(scene, camera);
      paint2D(t, dt);
    });

    /* --- resize --------------------------------------------------------- */
    ctx.listen(window, "resize", () => {
      if (ctx.width === W && ctx.height === H) return;
      measure();
      renderer.setSize(W, H, false);
      camera.aspect = W / H;
      camera.updateProjectionMatrix();
      rig.scale.setScalar(portR / R0);
      fxc.width = Math.round(W * ctx.dpr);
      fxc.height = Math.round(H * ctx.dpr);
      bakeFrame();
      zoneKey.fill("");
    });

    /* ---------------------------------------------------------------
     * A read-only window onto the duel so the local harness can drive a
     * real four-handed match and assert on what actually happened. It
     * exposes nothing the bit is not already drawing.
     * ------------------------------------------------------------- */
    window.__REACTOR__ = {
      get phase() { return phase; },
      get kind() { return roundKind; },
      get live() { return phase === "armed" && sig.on; },
      get round() { return roundNo; },
      get scores() { return scores.slice(0, crew); },
      get locked() { return locked.slice(0, crew); },
      get armedStations() { return zoneArmed.slice(0, crew); },
      get winner() { return winner; },
      get crew() { return crew; },
      get target() { return settings.target; },
      get bestReaction() { return isFinite(bestReaction) ? Math.round(bestReaction) : null; },
      get falseStarts() { return falseStarts; },
      taps: () => STATIONS.slice(0, crew).map((_, i) => tapPoint(i)),
      zoneAt,
    };
    ctx.onDestroy(() => { try { delete window.__REACTOR__; } catch (_) {} });

    /* --- first frame, before ready(), so the host never shows a blank bit --- */
    bakeFrame();
    updateCore(0.016, now());
    renderer.render(scene, camera);
    paint2D(now(), 0.016);
    updateChrome();
    ctx.markVisualReady("reactor lit");
    ctx.platform.ready();
  },
};
