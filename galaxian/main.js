/*
 * Convoy Charge — a faithful reconstruction of Namco's Galaxian (1979).
 *
 * Everything the arcade board did in silicon is rebuilt in code here, because
 * packaged assets are disabled (maxAssets: 0): the 5x7 character ROM, every
 * 12x12 alien, the scrolling colour starfield, and a re-creation of the
 * Galaxian sound board — analog fire, analog explosion, three analog "rack
 * noise" drones and the monophonic digital oscillator that plays the intro
 * tune and the alien-destroyed blip.
 *
 * The rules are the arcade's: 46 aliens in a five-row convoy, one missile on
 * screen at a time, and a flagship worth 150/200/300 depending on how many
 * escorts still fly beside it — or 800 if you take both escorts first.
 */

window.plethoraBit = {
  meta: {
    title: "Convoy Charge",
    runtime: "plethora-bit@2",
    tags: [
      "arcade", "game", "shooter", "shmup", "retro",
      "space", "aliens", "pixel-art", "leaderboard", "one-hand"
    ],
    permissions: ["audio", "haptics", "storage"]
  },

  async init(ctx) {
    /* ================================================================ *
     * PALETTE
     * Galaxian drove an RGB monitor from a tiny colour PROM, so the set
     * is near-primary and unshaded. Nothing here is a gradient.
     * ================================================================ */
    const BLACK = "#000000";
    const WHITE = "#fcfcfc";
    const RED = "#f83800";
    const BLUE = "#3cbcfc";
    const PURPLE = "#c84cf8";
    const YELLOW = "#fcd800";
    const CYAN = "#3cf8f8";
    const GREY = "#909090";

    /* ================================================================ *
     * SMALL MATH
     * ================================================================ */
    const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
    const TAU = Math.PI * 2;

    // Wrap an angle into -PI..PI so heading errors steer the short way.
    function wrapAngle(a) {
      while (a > Math.PI) a -= TAU;
      while (a < -Math.PI) a += TAU;
      return a;
    }

    // xorshift, so the starfield and dive jitter are reproducible per seed.
    function makeRng(seed) {
      let s = (seed >>> 0) || 1;
      return function rng() {
        s ^= s << 13; s >>>= 0;
        s ^= s >> 17;
        s ^= s << 5; s >>>= 0;
        return s / 4294967296;
      };
    }
    const rand = makeRng(0x9a1a1a);

    /* ================================================================ *
     * OFFSCREEN BAKERY
     * Every sprite is baked once to an OffscreenCanvas and blitted after
     * that. document.createElement("canvas") is refused by the upload
     * validator; OffscreenCanvas is the accepted route, and where a
     * WebView lacks it makeSurface returns null and the renderer falls
     * back to painting each sprite's pixels live.
     * ================================================================ */
    const HAS_OFFSCREEN = typeof OffscreenCanvas === "function";
    function makeSurface(w, h) {
      if (!HAS_OFFSCREEN) return null;
      try {
        const s = new OffscreenCanvas(Math.max(1, Math.ceil(w)), Math.max(1, Math.ceil(h)));
        const gg = s.getContext("2d");
        if (!gg) return null;
        return { canvas: s, g: gg };
      } catch (err) {
        return null;
      }
    }

    /* ================================================================ *
     * CHARACTER ROM
     * 5x7 glyphs, one line each, rows separated by spaces. Drawn at an
     * integer pixel size so the letterforms stay square at any scale.
     * ================================================================ */
    const FONT = {
      " ": "00000 00000 00000 00000 00000 00000 00000",
      "0": "01110 10001 10011 10101 11001 10001 01110",
      "1": "00100 01100 00100 00100 00100 00100 01110",
      "2": "01110 10001 00001 00010 00100 01000 11111",
      "3": "11111 00010 00100 00010 00001 10001 01110",
      "4": "00010 00110 01010 10010 11111 00010 00010",
      "5": "11111 10000 11110 00001 00001 10001 01110",
      "6": "00110 01000 10000 11110 10001 10001 01110",
      "7": "11111 00001 00010 00100 01000 01000 01000",
      "8": "01110 10001 10001 01110 10001 10001 01110",
      "9": "01110 10001 10001 01111 00001 00010 01100",
      "A": "01110 10001 10001 11111 10001 10001 10001",
      "B": "11110 10001 10001 11110 10001 10001 11110",
      "C": "01110 10001 10000 10000 10000 10001 01110",
      "D": "11100 10010 10001 10001 10001 10010 11100",
      "E": "11111 10000 10000 11110 10000 10000 11111",
      "F": "11111 10000 10000 11110 10000 10000 10000",
      "G": "01110 10001 10000 10111 10001 10001 01111",
      "H": "10001 10001 10001 11111 10001 10001 10001",
      "I": "01110 00100 00100 00100 00100 00100 01110",
      "J": "00111 00010 00010 00010 00010 10010 01100",
      "K": "10001 10010 10100 11000 10100 10010 10001",
      "L": "10000 10000 10000 10000 10000 10000 11111",
      "M": "10001 11011 10101 10101 10001 10001 10001",
      "N": "10001 11001 11001 10101 10011 10011 10001",
      "O": "01110 10001 10001 10001 10001 10001 01110",
      "P": "11110 10001 10001 11110 10000 10000 10000",
      "Q": "01110 10001 10001 10001 10101 10010 01101",
      "R": "11110 10001 10001 11110 10100 10010 10001",
      "S": "01111 10000 10000 01110 00001 00001 11110",
      "T": "11111 00100 00100 00100 00100 00100 00100",
      "U": "10001 10001 10001 10001 10001 10001 01110",
      "V": "10001 10001 10001 10001 10001 01010 00100",
      "W": "10001 10001 10001 10101 10101 11011 10001",
      "X": "10001 10001 01010 00100 01010 10001 10001",
      "Y": "10001 10001 01010 00100 00100 00100 00100",
      "Z": "11111 00001 00010 00100 01000 10000 11111",
      "-": "00000 00000 00000 11111 00000 00000 00000",
      "_": "00000 00000 00000 00000 00000 00000 11111",
      ".": "00000 00000 00000 00000 00000 01100 01100",
      ",": "00000 00000 00000 00000 01100 00100 01000",
      ":": "00000 01100 01100 00000 01100 01100 00000",
      "/": "00001 00010 00010 00100 01000 01000 10000",
      "!": "00100 00100 00100 00100 00100 00000 00100",
      "?": "01110 10001 00001 00110 00100 00000 00100",
      "'": "00100 00100 01000 00000 00000 00000 00000",
      "(": "00010 00100 01000 01000 01000 00100 00010",
      ")": "01000 00100 00010 00010 00010 00100 01000",
      "+": "00000 00100 00100 11111 00100 00100 00000",
      "=": "00000 00000 11111 00000 11111 00000 00000",
      "*": "00000 10101 01110 11111 01110 10101 00000",
      "<": "00010 00100 01000 10000 01000 00100 00010",
      ">": "01000 00100 00010 00001 00010 00100 01000",
      "%": "11001 11010 00010 00100 01000 01011 10011"
    };

    // Pre-split every glyph once; string.split in a text loop is the kind
    // of per-frame garbage that shows up on a phone.
    const GLYPHS = {};
    for (const key in FONT) {
      if (!Object.prototype.hasOwnProperty.call(FONT, key)) continue;
      GLYPHS[key] = FONT[key].split(" ");
    }
    const GLYPH_W = 5;
    const GLYPH_H = 7;

    function textWidth(str, px) {
      const n = str.length;
      if (n === 0) return 0;
      return n * (GLYPH_W + 1) * px - px;
    }

    // align: -1 left, 0 centre, 1 right. y is the top of the cap height.
    function drawText(g, str, x, y, px, color, align) {
      const text = String(str).toUpperCase();
      const w = textWidth(text, px);
      let cx = align === 0 ? Math.round(x - w / 2) : align === 1 ? Math.round(x - w) : Math.round(x);
      const cy = Math.round(y);
      g.fillStyle = color;
      for (let i = 0; i < text.length; i++) {
        const rows = GLYPHS[text.charAt(i)];
        if (rows) {
          for (let r = 0; r < GLYPH_H; r++) {
            const row = rows[r];
            let run = -1;
            for (let c = 0; c <= GLYPH_W; c++) {
              const on = c < GLYPH_W && row.charAt(c) === "1";
              if (on && run < 0) run = c;
              // Emit each horizontal run as one rect instead of per pixel.
              if (!on && run >= 0) {
                g.fillRect(cx + run * px, cy + r * px, (c - run) * px, px);
                run = -1;
              }
            }
          }
        }
        cx += (GLYPH_W + 1) * px;
      }
    }

    /* ================================================================ *
     * SPRITE ROM
     * Grids of colour slots: "." is transparent, "1"/"2"/"3" index the
     * three colours a Galaxian sprite was allowed. The aliens share one
     * silhouette across blue, purple and red exactly as the arcade did —
     * only the palette entry changed — while the flagship gets its own
     * wider, three-colour bird.
     * ================================================================ */

    // Drone / emissary / hornet, wings held level in the convoy.
    const ALIEN_A = [
      "..2......2..",
      "...2....2...",
      "....1111....",
      "...131131...",
      "...111111...",
      "11.111111.11",
      "111111111111",
      "111.1111.111",
      "11...11...11",
      ".1...11...1."
    ];

    // Same alien mid-flap, wings beaten down. Divers alternate the two.
    const ALIEN_B = [
      "11.2....2.11",
      "111.2..2.111",
      "111.1111.111",
      "11.131131.11",
      "...111111...",
      "...111111...",
      "....1111....",
      "....1111....",
      "...11..11...",
      "..1......1.."
    ];

    // The flagship: a wide pterodactyl in yellow, red and blue, wings out.
    const FLAG_A = [
      ".......11.......",
      "......1111......",
      ".....131131.....",
      ".....111111.....",
      "....11111111....",
      "...3311111133...",
      ".22331111113322.",
      "2223311111133222",
      "2233..1111..3322",
      "22....1111....22",
      "......3333......",
      "......3..3......"
    ];

    // Flagship with the wings swept up, which is what it does while diving.
    const FLAG_B = [
      "22............22",
      "223..........322",
      ".2233......3322.",
      "..2233....3322..",
      "...233.11.332...",
      "....3.1111.3....",
      ".....131131.....",
      "....11111111....",
      "....11111111....",
      ".....111111.....",
      "......3333......",
      "......3..3......"
    ];

    // The Galaxip. White hull, cyan wing edges, one red pixel on the nose.
    const SHIP = [
      "......33......",
      "......11......",
      "......11......",
      ".....1111.....",
      ".....1111.....",
      ".....1111.....",
      "..22.1111.22..",
      ".222.1111.222.",
      "22221111112222",
      "222.111111.222",
      "22...1111...22"
    ];

    // Stage flag for the bottom-right rack.
    const FLAG_PIP = [
      "3111111.",
      "3122211.",
      "3111111.",
      "3122211.",
      "3111111.",
      "3.......",
      "3.......",
      "3......."
    ];

    /* ---------------------------------------------------------------- *
     * Baking. Each (grid, palette) pair becomes one OffscreenCanvas that
     * later frames blit; without OffscreenCanvas the sprite keeps its
     * grid and paints itself a rect at a time, which is slower but never
     * blank.
     * ---------------------------------------------------------------- */
    function bake(rows, c1, c2, c3) {
      const h = rows.length;
      const w = rows[0].length;
      const colors = ["", c1, c2 || c1, c3 || c1];
      const surf = makeSurface(w, h);
      if (!surf) return { rows, colors, w, h, canvas: null };
      for (let y = 0; y < h; y++) {
        const row = rows[y];
        for (let x = 0; x < w; x++) {
          const ch = row.charAt(x);
          if (ch === ".") continue;
          surf.g.fillStyle = colors[ch.charCodeAt(0) - 48] || c1;
          surf.g.fillRect(x, y, 1, 1);
        }
      }
      return { rows, colors, w, h, canvas: surf.canvas };
    }

    // Draw centred on (cx, cy), snapped to the virtual pixel grid.
    function blit(g, spr, cx, cy) {
      const x = Math.round(cx - spr.w / 2);
      const y = Math.round(cy - spr.h / 2);
      if (spr.canvas) {
        g.drawImage(spr.canvas, x, y);
        return;
      }
      for (let ry = 0; ry < spr.h; ry++) {
        const row = spr.rows[ry];
        for (let rx = 0; rx < spr.w; rx++) {
          const ch = row.charAt(rx);
          if (ch === ".") continue;
          g.fillStyle = spr.colors[ch.charCodeAt(0) - 48] || spr.colors[1];
          g.fillRect(x + rx, y + ry, 1, 1);
        }
      }
    }

    /* ---------------------------------------------------------------- *
     * The four alien classes, in the order they sit in the convoy.
     * Formation and diving values are the arcade's; the flagship's are
     * decided per dive by how many escorts are still flying.
     * ---------------------------------------------------------------- */
    const DRONE = 0;      // blue, bottom three rows, 30 in convoy / 60 diving
    const EMISSARY = 1;   // purple, 40 / 80
    const HORNET = 2;     // red, escorts the flagship, 50 / 100
    const FLAGSHIP = 3;   // 60 in convoy, 150-800 diving

    const KIND_COLOR = [BLUE, PURPLE, RED, YELLOW];
    const CONVOY_VALUE = [30, 40, 50, 60];
    const DIVING_VALUE = [60, 80, 100, 150];
    const KIND_NAME = ["drone", "emissary", "hornet", "flagship"];

    const SPRITES = {
      alien: [
        [bake(ALIEN_A, BLUE, WHITE, WHITE), bake(ALIEN_B, BLUE, WHITE, WHITE)],
        [bake(ALIEN_A, PURPLE, WHITE, WHITE), bake(ALIEN_B, PURPLE, WHITE, WHITE)],
        [bake(ALIEN_A, RED, WHITE, WHITE), bake(ALIEN_B, RED, WHITE, WHITE)],
        [bake(FLAG_A, YELLOW, RED, BLUE), bake(FLAG_B, YELLOW, RED, BLUE)]
      ],
      // A one-frame white silhouette, flashed the instant a shot connects.
      flash: [
        bake(ALIEN_A, WHITE, WHITE, WHITE),
        bake(ALIEN_A, WHITE, WHITE, WHITE),
        bake(ALIEN_A, WHITE, WHITE, WHITE),
        bake(FLAG_A, WHITE, WHITE, WHITE)
      ],
      ship: bake(SHIP, WHITE, CYAN, RED),
      flag: bake(FLAG_PIP, RED, WHITE, YELLOW)
    };

    /* ================================================================ *
     * VIEWPORT
     * The cabinet ran a 224x256 portrait monitor. The virtual screen
     * keeps that 224 width exactly and stretches vertically to suit the
     * phone, capped so a very tall device letterboxes instead of turning
     * the playfield into a corridor. Everything downstream is drawn in
     * these virtual pixels.
     * ================================================================ */
    const VW = 224;
    const VH_MIN = 256;
    const VH_MAX = 380;

    const canvas = ctx.createCanvas2D({ touchAction: "none" });
    const g = canvas.getContext("2d");
    g.imageSmoothingEnabled = false;

    const view = { vh: 288, scale: 1, ox: 0, oy: 0, cw: 0, ch: 0 };

    function layout() {
      const sa = ctx.safeArea || { top: 0, bottom: 0, left: 0, right: 0 };
      const cw = Math.max(1, ctx.width);
      const ch = Math.max(1, ctx.height);
      const availW = Math.max(1, cw - sa.left - sa.right);
      const availH = Math.max(1, ch - sa.top - sa.bottom);
      view.vh = clamp(Math.round(VW * availH / availW), VH_MIN, VH_MAX);
      view.scale = Math.min(availW / VW, availH / view.vh);
      view.ox = sa.left + (availW - VW * view.scale) / 2;
      view.oy = sa.top + (availH - view.vh * view.scale) / 2;
      view.cw = cw;
      view.ch = ch;
    }
    layout();

    // Control scheme decides whether the layout reserves a band of screen
    // for on-screen pads, so it has to be known before the first measure.
    let scheme = "drag";          // "drag" | "pads"
    const PAD_BAND = 44;

    // Playfield bands, recomputed whenever the virtual height changes.
    const zone = { hudTop: 0, top: 0, bottom: 0, shipY: 0, formTop: 0, pace: 1, rowPitch: 15 };
    function measure() {
      const band = scheme === "pads" ? PAD_BAND : 0;
      zone.hudTop = 2;
      zone.top = 24;
      zone.bottom = view.vh - 20 - band;
      zone.shipY = zone.bottom - 10;
      zone.formTop = zone.top + 12 + Math.round((zone.bottom - zone.top) * 0.12);
      // A phone is far taller than a 224x256 cabinet, so a dive would take
      // half again as long to arrive. Scale flight speeds by the extra
      // airspace and the arcade's pacing survives the aspect ratio.
      zone.pace = clamp((zone.bottom - zone.top) / 212, 1, 1.6);
      zone.rowPitch = clamp(Math.round(14 + (zone.pace - 1) * 9), 14, 17);
    }
    measure();

    const toVirtualX = px => (px - view.ox) / view.scale;
    const toVirtualY = py => (py - view.oy) / view.scale;

    /* ================================================================ *
     * STARFIELD
     * A black sky with bright dots that scroll down and blink in six
     * colours — the first thing anyone recognises about a Galaxian
     * cabinet, and cheap: 96 dots, one rect each.
     * ================================================================ */
    const STAR_COLORS = [WHITE, RED, CYAN, YELLOW, BLUE, PURPLE];
    const stars = [];
    for (let i = 0; i < 96; i++) {
      stars.push({
        x: Math.floor(rand() * VW),
        y: rand() * VH_MAX,
        c: STAR_COLORS[Math.floor(rand() * STAR_COLORS.length)],
        // Blink period and phase, so no two dots pulse together.
        period: 900 + rand() * 2600,
        phase: rand() * 3000,
        duty: 0.45 + rand() * 0.35
      });
    }

    const STAR_SCROLL = 0.34;
    function updateStars(dt) {
      const step = STAR_SCROLL * dt * 0.06;
      for (let i = 0; i < stars.length; i++) {
        const s = stars[i];
        s.y += step;
        if (s.y > view.vh) {
          s.y -= view.vh;
          s.x = Math.floor(rand() * VW);
          s.c = STAR_COLORS[Math.floor(rand() * STAR_COLORS.length)];
        }
      }
    }

    function drawStars(now) {
      for (let i = 0; i < stars.length; i++) {
        const s = stars[i];
        const t = ((now + s.phase) % s.period) / s.period;
        if (t > s.duty) continue;
        g.fillStyle = s.c;
        g.fillRect(s.x, Math.floor(s.y), 1, 1);
      }
    }

    /* ================================================================ *
     * SOUND BOARD
     * The Galaxian PCB made four kinds of noise, and this rebuilds each
     * one rather than reaching for a generic sting:
     *
     *   - analog fire       a short falling zap on every missile
     *   - analog explosion  filtered noise, swept down, for a death
     *   - three rack noises the swirling convoy drone, which climbs as
     *                       the rack thins out and the survivors speed up
     *   - digital oscillator a monophonic stepped voice that plays the
     *                       intro tune and the alien-destroyed blip
     * ================================================================ */
    let AC = null;
    let master = null;
    let noiseBuf = null;
    let sfxOn = true;
    let hapticsOn = true;

    function audioReady() {
      if (!ctx.capabilities || !ctx.capabilities.audio) return null;
      if (AC) return AC;
      try {
        const Ctor = window.AudioContext || window.webkitAudioContext;
        if (!Ctor) return null;
        AC = new Ctor();
        master = AC.createGain();
        master.gain.value = 0.5;
        master.connect(AC.destination);
        const len = Math.floor(AC.sampleRate);
        noiseBuf = AC.createBuffer(1, len, AC.sampleRate);
        const d = noiseBuf.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
        ctx.onDestroy(() => { try { AC && AC.close(); } catch (e) { /* already gone */ } });
      } catch (err) {
        AC = null;
      }
      return AC;
    }

    function resumeAudio() {
      const ac = audioReady();
      if (ac && ac.state === "suspended") ac.resume().catch(() => {});
      return ac;
    }

    function envTo(node, t0, peak, attack, decay) {
      const gain = AC.createGain();
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t0 + attack);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + attack + decay);
      node.connect(gain);
      gain.connect(master);
      return gain;
    }

    function tone(type, f0, f1, dur, peak, delay) {
      if (!AC || !sfxOn) return;
      const t0 = AC.currentTime + (delay || 0);
      const o = AC.createOscillator();
      o.type = type;
      o.frequency.setValueAtTime(Math.max(20, f0), t0);
      if (f1 && f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t0 + dur);
      envTo(o, t0, peak, Math.min(0.01, dur * 0.25), dur);
      o.start(t0);
      o.stop(t0 + dur + 0.06);
    }

    function noiseBurst(dur, peak, f0, f1, q, delay) {
      if (!AC || !sfxOn || !noiseBuf) return;
      const t0 = AC.currentTime + (delay || 0);
      const src = AC.createBufferSource();
      src.buffer = noiseBuf;
      src.loop = true;
      const filt = AC.createBiquadFilter();
      filt.type = "bandpass";
      filt.frequency.setValueAtTime(f0, t0);
      if (f1 && f1 !== f0) filt.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t0 + dur);
      filt.Q.value = q || 1;
      src.connect(filt);
      envTo(filt, t0, peak, 0.004, dur);
      src.start(t0);
      src.stop(t0 + dur + 0.06);
    }

    /* ---------------------------------------------------------------- *
     * The digital oscillator. One voice, stepped in pitch, sounding a
     * little raw because on the real board only three of a counter's
     * four output bits reached the resistor ladder.
     * ---------------------------------------------------------------- */
    let digitalWave = null;
    function digitalVoice(steps, stepMs, peak) {
      if (!AC || !sfxOn || !steps.length) return;
      if (!digitalWave) {
        // A duty-ish pulse built from a handful of harmonics: bright and
        // hollow, the way a divided-down counter sounds.
        const real = new Float32Array([0, 0, 0, 0, 0, 0, 0, 0]);
        const imag = new Float32Array([0, 1, 0, 0.55, 0, 0.32, 0, 0.2]);
        try {
          digitalWave = AC.createPeriodicWave(real, imag, { disableNormalization: false });
        } catch (err) {
          digitalWave = null;
        }
      }
      const t0 = AC.currentTime;
      const dur = steps.length * stepMs / 1000;
      const o = AC.createOscillator();
      if (digitalWave) o.setPeriodicWave(digitalWave); else o.type = "square";
      o.frequency.setValueAtTime(Math.max(20, steps[0]), t0);
      for (let i = 1; i < steps.length; i++) {
        // setValueAtTime, not a ramp: the board stepped, it never glided.
        o.frequency.setValueAtTime(Math.max(20, steps[i]), t0 + i * stepMs / 1000);
      }
      const gain = AC.createGain();
      gain.gain.setValueAtTime(peak, t0);
      gain.gain.setValueAtTime(peak, t0 + dur * 0.82);
      gain.gain.exponentialRampToValueAtTime(0.0002, t0 + dur);
      o.connect(gain);
      gain.connect(master);
      o.start(t0);
      o.stop(t0 + dur + 0.05);
    }

    /* ---------------------------------------------------------------- *
     * The three rack noises: the convoy's idling hum. Each is a detuned
     * saw through a lowpass, all three swept by one shared LFO, so the
     * bed swirls rather than sits. setRack() raises pitch and sweep rate
     * as the rack thins — the arcade's way of telling you the survivors
     * have sped up.
     * ---------------------------------------------------------------- */
    const rack = { nodes: [], lfo: null, lfoGain: null, gain: null, running: false, level: 0 };

    function startRack() {
      const ac = audioReady();
      if (!ac || rack.running) return;
      try {
        rack.gain = ac.createGain();
        rack.gain.gain.value = 0;
        const filt = ac.createBiquadFilter();
        filt.type = "lowpass";
        filt.frequency.value = 900;
        filt.Q.value = 4;
        filt.connect(rack.gain);
        rack.gain.connect(master);
        rack.filter = filt;

        rack.lfo = ac.createOscillator();
        rack.lfo.type = "triangle";
        rack.lfo.frequency.value = 2.2;
        rack.lfoGain = ac.createGain();
        rack.lfoGain.gain.value = 26;
        rack.lfo.connect(rack.lfoGain);
        rack.lfo.start();

        const bases = [58, 77, 103];
        for (let i = 0; i < 3; i++) {
          const o = ac.createOscillator();
          o.type = i === 2 ? "square" : "sawtooth";
          o.frequency.value = bases[i];
          rack.lfoGain.connect(o.frequency);
          const gg = ac.createGain();
          gg.gain.value = i === 2 ? 0.1 : 0.16;
          o.connect(gg);
          gg.connect(filt);
          o.start();
          rack.nodes.push({ osc: o, gain: gg, base: bases[i] });
        }
        rack.running = true;
        ctx.onDestroy(() => stopRack());
      } catch (err) {
        rack.running = false;
      }
    }

    function stopRack() {
      if (!rack.running) return;
      try {
        for (const n of rack.nodes) { try { n.osc.stop(); } catch (e) { /* already stopped */ } }
        if (rack.lfo) { try { rack.lfo.stop(); } catch (e) { /* already stopped */ } }
      } catch (err) { /* context already torn down */ }
      rack.nodes = [];
      rack.lfo = null;
      rack.running = false;
    }

    // level 0..1 — how far through the rack the player has eaten.
    function setRack(level, volume) {
      rack.level = level;
      if (!rack.running || !AC) return;
      const t = AC.currentTime;
      try {
        rack.gain.gain.setTargetAtTime(sfxOn ? (volume === undefined ? 0.3 : volume) : 0, t, 0.12);
        rack.lfo.frequency.setTargetAtTime(1.8 + level * 6.5, t, 0.2);
        rack.lfoGain.gain.setTargetAtTime(22 + level * 40, t, 0.2);
        rack.filter.frequency.setTargetAtTime(750 + level * 1100, t, 0.2);
        for (const n of rack.nodes) {
          n.osc.frequency.setTargetAtTime(n.base * (1 + level * 0.55), t, 0.2);
        }
      } catch (err) { /* nodes gone */ }
    }

    /* ---------------------------------------------------------------- *
     * The named effects.
     * ---------------------------------------------------------------- */
    let sirenNode = null;
    const sfx = {
      // Analog fire: a fast fall with a click of noise on the front.
      fire() {
        if (!AC || !sfxOn) return;
        tone("square", 1180, 260, 0.1, 0.16);
        noiseBurst(0.05, 0.08, 2600, 700, 1.2);
      },
      // The digital oscillator's alien-destroyed blip: a stepped tumble.
      alienDie(kind) {
        const top = kind === FLAGSHIP ? 1080 : 840;
        const steps = [];
        for (let i = 0; i < 10; i++) steps.push(top * Math.pow(0.82, i) * (i % 2 ? 1.22 : 1));
        digitalVoice(steps, 22, kind === FLAGSHIP ? 0.2 : 0.15);
        noiseBurst(0.13, 0.09, 1700, 380, 0.9);
      },
      // Analog explosion: the Galaxip going up, long and broad.
      shipDie() {
        if (!AC || !sfxOn) return;
        noiseBurst(0.75, 0.3, 1500, 90, 0.6);
        noiseBurst(0.5, 0.18, 420, 60, 1.4, 0.04);
        tone("sawtooth", 190, 34, 0.6, 0.14, 0.02);
      },
      // Convoy siren: the warble a flagship makes on the way down.
      sirenOn() {
        const ac = audioReady();
        if (!ac || !sfxOn || sirenNode) return;
        try {
          const o = ac.createOscillator();
          o.type = "square";
          o.frequency.value = 520;
          const lfo = ac.createOscillator();
          lfo.type = "sine";
          lfo.frequency.value = 11;
          const lg = ac.createGain();
          lg.gain.value = 190;
          lfo.connect(lg);
          lg.connect(o.frequency);
          const gg = ac.createGain();
          gg.gain.value = 0;
          gg.gain.setTargetAtTime(0.1, ac.currentTime, 0.05);
          o.connect(gg);
          gg.connect(master);
          o.start();
          lfo.start();
          sirenNode = { o, lfo, gg };
        } catch (err) {
          sirenNode = null;
        }
      },
      sirenOff() {
        if (!sirenNode || !AC) return;
        const n = sirenNode;
        sirenNode = null;
        try {
          n.gg.gain.setTargetAtTime(0, AC.currentTime, 0.04);
          n.o.stop(AC.currentTime + 0.25);
          n.lfo.stop(AC.currentTime + 0.25);
        } catch (err) { /* already stopped */ }
      },
      // The quirky little tune the board plays as a rack drops in.
      intro() {
        digitalVoice([392, 523, 659, 784, 659, 784, 1047], 78, 0.16);
      },
      waveClear() {
        digitalVoice([523, 659, 784, 1047, 1319], 70, 0.17);
      },
      extraShip() {
        digitalVoice([784, 1047, 784, 1047, 1319, 1568], 64, 0.18);
      },
      gameOver() {
        digitalVoice([392, 349, 311, 294, 262, 233, 196], 110, 0.16);
      },
      coin() {
        digitalVoice([880, 1319], 60, 0.16);
      }
    };

    function haptic(kind) {
      if (!hapticsOn) return;
      try { ctx.platform.haptic(kind); } catch (err) { /* host without haptics */ }
    }

    /* ================================================================ *
     * THE CONVOY
     * Forty-six aliens in five rows: two flagships at the tip, six red
     * hornets under them, eight purple emissaries under those, and three
     * rows of ten blue drones. A flagship that gets away joins the next
     * rack, up to four in all.
     * ================================================================ */
    const COLS = 10;
    const COL_PITCH = 16;
    const SWAY = 16;

    const FORMATION = 0;
    const DIVING = 1;
    const RETURNING = 2;

    const HORNET_COLS = [2, 3, 4, 5, 6, 7];
    const EMISSARY_COLS = [1, 2, 3, 4, 5, 6, 7, 8];
    const FLAG_COLS = { 2: [3.5, 5.5], 3: [2.5, 4.5, 6.5], 4: [1.5, 3.5, 5.5, 7.5] };

    const aliens = [];
    const convoys = [];
    const bullets = [];       // alien fire
    const bursts = [];        // explosions
    const pops = [];          // floating score numbers

    const missile = { x: 0, y: 0, live: false };
    const ship = { x: VW / 2, targetX: VW / 2, alive: true, visible: true, blinkT: 0 };

    const game = {
      screen: "attract",     // attract | ready | play | dying | clear | over
      score: 0,
      best: 0,
      lives: 3,
      stage: 1,
      aliveCount: 0,
      rackCount: 46,
      escapedFlagships: 0,
      bonusGiven: false,
      timer: 0,
      diveTimer: 0,
      formX: VW / 2,
      formDir: 1,
      lastRunStage: 1
    };

    const BONUS_AT = 7000;    // "1ST BONUS FOR 7000 PTS", as the marquee had it
    const MAX_BULLETS = 3;
    const MAX_FLAGSHIPS = 4;

    /* ---------------------------------------------------------------- *
     * Per-stage difficulty. The arcade tightened the screws steadily
     * rather than in jumps: more of the rack in the air at once, faster
     * dives, more shots.
     * ---------------------------------------------------------------- */
    function tuning() {
      const w = game.stage;
      return {
        speed: Math.min(1 + 0.055 * (w - 1), 1.9),
        maxDivers: Math.min(2 + Math.floor((w + 1) / 2), 8),
        gapMs: Math.max(260, 1350 - 95 * (w - 1)),
        fireRate: Math.min(0.45 + 0.13 * (w - 1), 1.7),
        convoyChance: Math.min(0.24 + 0.055 * (w - 1), 0.62),
        escapeChance: Math.min(0.22 + 0.03 * (w - 1), 0.45)
      };
    }

    function slotX(col) { return game.formX + (col - (COLS - 1) / 2) * COL_PITCH; }
    function slotY(row) { return zone.formTop + row * zone.rowPitch; }

    function addAlien(kind, col, row) {
      aliens.push({
        kind, col, row,
        alive: true,
        state: FORMATION,
        x: slotX(col), y: slotY(row),
        ang: 0, spd: 0,
        flap: 0, flapT: 0,
        weaveT: 0, weaveAmp: 0, weaveHz: 1,
        convoy: null, escort: false, side: 0,
        entryT: 0,
        fireCool: 0
      });
      return aliens[aliens.length - 1];
    }

    function buildRack() {
      aliens.length = 0;
      convoys.length = 0;
      bullets.length = 0;
      const flagCount = clamp(2 + game.escapedFlagships, 2, MAX_FLAGSHIPS);
      game.escapedFlagships = 0;
      for (const col of FLAG_COLS[flagCount] || FLAG_COLS[2]) addAlien(FLAGSHIP, col, 0);
      for (const col of HORNET_COLS) addAlien(HORNET, col, 1);
      for (const col of EMISSARY_COLS) addAlien(EMISSARY, col, 2);
      for (let row = 3; row <= 5; row++) {
        for (let col = 0; col < COLS; col++) addAlien(DRONE, col, row);
      }
      // Rows drop in one after another, so the rack assembles on screen
      // instead of simply existing.
      for (const a of aliens) a.entryT = 90 + a.row * 110;
      game.aliveCount = aliens.length;
      game.rackCount = aliens.length;
      game.formX = VW / 2;
      game.formDir = 1;
      game.diveTimer = 1400;
    }

    function countAlive() {
      let n = 0;
      for (const a of aliens) if (a.alive) n++;
      return n;
    }

    /* ================================================================ *
     * DIVES
     * A diver is a steered agent rather than a canned spline: it peels
     * out of the rack sideways, then turns over and hunts the Galaxip,
     * weaving on the way down. Drones come almost straight at you,
     * emissaries slew about, and a flagship charges with a hornet off
     * each wingtip.
     * ================================================================ */
    const DIVE_PROFILE = [
      { spd: 62, turn: 3.1, weave: 0.30, hz: 1.5, lead: 0.30 },  // drone
      { spd: 66, turn: 3.6, weave: 0.85, hz: 2.4, lead: 0.16 },  // emissary
      { spd: 64, turn: 2.9, weave: 0.42, hz: 1.7, lead: 0.26 },  // hornet
      { spd: 56, turn: 2.4, weave: 0.28, hz: 1.2, lead: 0.34 }   // flagship
    ];

    function launchDive(a, dirHint) {
      const p = DIVE_PROFILE[a.kind];
      const t = tuning();
      a.state = DIVING;
      // Peel outward, away from the middle of the rack, unless told
      // otherwise — that is the sideways flick before the swoop.
      const dir = dirHint !== undefined ? dirHint : (a.x < VW / 2 ? -1 : 1);
      a.ang = dir * 2.0;
      a.spd = p.spd * t.speed * zone.pace;
      a.weaveT = rand() * TAU;
      a.weaveAmp = p.weave;
      a.weaveHz = p.hz;
      a.fireCool = 220 + rand() * 460;
    }

    function launchConvoy(leader) {
      // Two hornets still sitting in the rack ride down as escorts. Take
      // the closest, so the V looks like it formed rather than teleported.
      const pool = aliens.filter(a => a.alive && a.kind === HORNET && a.state === FORMATION);
      pool.sort((p, q) => Math.abs(p.x - leader.x) - Math.abs(q.x - leader.x));
      const escorts = pool.slice(0, 2);
      const convoy = { leader, escorts, startCount: escorts.length, killed: 0, alive: true };
      convoys.push(convoy);
      leader.convoy = convoy;
      leader.escort = false;
      launchDive(leader, leader.x < VW / 2 ? -1 : 1);
      for (let i = 0; i < escorts.length; i++) {
        const e = escorts[i];
        e.convoy = convoy;
        e.escort = true;
        e.side = i === 0 ? -1 : 1;
        e.state = DIVING;
        e.ang = leader.ang;
        e.spd = leader.spd;
        e.fireCool = 500 + rand() * 700;
      }
      sfx.sirenOn();
      ctx.platform.milestone("convoy_charge", { escorts: escorts.length, stage: game.stage });
      return convoy;
    }

    function convoyActive() {
      for (const c of convoys) if (c.alive) return true;
      return false;
    }

    // An escort whose flagship is gone finishes the dive on its own.
    function orphanEscorts(convoy) {
      for (const e of convoy.escorts) {
        if (e.alive && e.state === DIVING && e.escort) {
          e.escort = false;
          const p = DIVE_PROFILE[e.kind];
          e.weaveAmp = p.weave;
          e.weaveHz = p.hz;
        }
      }
    }

    function closeConvoy(convoy) {
      convoy.alive = false;
      if (!convoyActive()) sfx.sirenOff();
    }

    /* ---------------------------------------------------------------- *
     * What a flagship is worth when it dies. Straight from the arcade
     * table: 150 unescorted, 200 with one escort still flying, 300 with
     * two — and 800 if you took both escorts down before the flagship.
     * ---------------------------------------------------------------- */
    function flagshipValue(convoy) {
      if (!convoy || convoy.startCount === 0) return 150;
      const alive = convoy.startCount - convoy.killed;
      if (alive <= 0) return convoy.startCount >= 2 ? 800 : 200;
      if (alive >= 2) return 300;
      return 200;
    }

    function chooseDivers(dt) {
      if (game.screen !== "play") return;
      const t = tuning();
      let flying = 0;
      for (const a of aliens) if (a.alive && a.state === DIVING) flying++;
      game.diveTimer -= dt;
      if (game.diveTimer > 0 || flying >= t.maxDivers) return;
      game.diveTimer = t.gapMs * (0.7 + rand() * 0.6);

      // A flagship charge takes priority when one is due and the rack
      // still has a flagship sitting in it.
      const flagsReady = aliens.filter(a => a.alive && a.kind === FLAGSHIP && a.state === FORMATION && a.entryT <= 0);
      if (flagsReady.length && rand() < t.convoyChance && flying + 3 <= t.maxDivers + 1) {
        launchConvoy(flagsReady[Math.floor(rand() * flagsReady.length)]);
        return;
      }
      const ready = aliens.filter(a => a.alive && a.state === FORMATION && a.entryT <= 0 && a.kind !== FLAGSHIP);
      if (!ready.length) {
        if (flagsReady.length) launchConvoy(flagsReady[0]);
        return;
      }
      launchDive(ready[Math.floor(rand() * ready.length)]);
    }

    function alienFires(a, dt) {
      if (bullets.length >= MAX_BULLETS) return;
      const t = tuning();
      a.fireCool -= dt;
      if (a.fireCool > 0) return;
      a.fireCool = 460 + rand() * 900;
      if (rand() > t.fireRate * 0.72) return;
      if (a.y > ship.y - 26) return;
      const fx = Math.sin(a.ang);
      bullets.push({
        x: a.x, y: a.y + 5,
        // Shots drop, taking a little of the diver's sideways momentum
        // with them, which is why a weaving alien sprays.
        vx: fx * 22 * zone.pace,
        vy: (118 + rand() * 26) * t.speed * zone.pace
      });
    }

    /* ================================================================ *
     * SIMULATION
     * ================================================================ */
    function explode(x, y, big, color, kind) {
      bursts.push({
        x, y, t: 0,
        dur: big ? 720 : 320,
        big: !!big,
        color: color || WHITE,
        // A white silhouette of whatever just died, held for two frames —
        // the arcade's hit flash before the sprite breaks up.
        flash: kind === undefined ? -1 : kind,
        seed: Math.floor(rand() * 65535)
      });
    }

    function addPop(x, y, text, color) {
      pops.push({ x, y, text: String(text), t: 0, dur: 900, color: color || WHITE });
    }

    function addScore(n) {
      game.score += n;
      ctx.platform.setScore(game.score);
      if (!game.bonusGiven && game.score >= BONUS_AT) {
        game.bonusGiven = true;
        game.lives++;
        sfx.extraShip();
        haptic("success");
        addPop(VW / 2, zone.shipY - 40, "extra galaxip", CYAN);
        ctx.platform.milestone("extra_ship", { score: game.score });
      }
    }

    function killAlien(a) {
      a.alive = false;
      const diving = a.state !== FORMATION;
      let value;
      if (a.kind === FLAGSHIP) {
        value = diving ? flagshipValue(a.convoy) : CONVOY_VALUE[FLAGSHIP];
      } else {
        value = diving ? DIVING_VALUE[a.kind] : CONVOY_VALUE[a.kind];
      }
      // Escort bookkeeping runs whether or not the hornet is still tucked
      // in beside the flagship — the 800 needs both of them gone first.
      if (a.kind === HORNET && a.convoy && a.convoy.alive) a.convoy.killed++;
      if (a.kind === FLAGSHIP && a.convoy) {
        orphanEscorts(a.convoy);
        closeConvoy(a.convoy);
      }
      addScore(value);
      explode(a.x, a.y, false, KIND_COLOR[a.kind], a.kind);
      sfx.alienDie(a.kind);
      haptic(a.kind === FLAGSHIP ? "medium" : "light");
      if (value >= 150) addPop(a.x, a.y, value, value >= 800 ? CYAN : YELLOW);
      if (value >= 800) ctx.platform.milestone("convoy_wipe", { value, stage: game.stage });
      ctx.platform.interact({ type: "kill", target: KIND_NAME[a.kind], value });
      game.aliveCount = countAlive();
    }

    function reenterFromTop(a) {
      a.state = RETURNING;
      a.y = zone.top - 18;
      a.x = clamp(a.x, 14, VW - 14);
      a.ang = 0;
      a.spd = DIVE_PROFILE[a.kind].spd * tuning().speed * zone.pace * 0.95;
    }

    function leftTheField(a) {
      // A flagship that clears the bottom of the screen may simply keep
      // going. It is worth nothing, it thins this rack — and it comes
      // back at the head of the next one.
      if (a.kind === FLAGSHIP && !a.escort && rand() < tuning().escapeChance
          && game.escapedFlagships < MAX_FLAGSHIPS - 2) {
        a.alive = false;
        game.escapedFlagships++;
        if (a.convoy) { orphanEscorts(a.convoy); closeConvoy(a.convoy); }
        addPop(a.x, view.vh - 46, "escaped", RED);
        game.aliveCount = countAlive();
        ctx.platform.milestone("flagship_escaped", { stage: game.stage });
        return;
      }
      if (a.convoy && a.kind === FLAGSHIP) { orphanEscorts(a.convoy); closeConvoy(a.convoy); }
      reenterFromTop(a);
    }

    function steer(a, aimX, aimY, turnRate, dt) {
      const want = Math.atan2(aimX - a.x, aimY - a.y);
      const err = wrapAngle(want - a.ang);
      const maxTurn = turnRate * dt / 1000;
      a.ang += clamp(err, -maxTurn, maxTurn);
    }

    function updateAliens(dt) {
      const sec = dt / 1000;
      const t = tuning();
      for (let i = 0; i < aliens.length; i++) {
        const a = aliens[i];
        if (!a.alive) continue;
        if (a.entryT > 0) {
          a.entryT -= dt;
          a.x = slotX(a.col);
          a.y = slotY(a.row);
          continue;
        }

        if (a.state === FORMATION) {
          a.x = slotX(a.col);
          a.y = slotY(a.row);
          a.flap = 0;
          continue;
        }

        // Wings beat while off the rack, faster the faster you are moving.
        a.flapT += dt;
        if (a.flapT > 110) { a.flapT = 0; a.flap = a.flap ? 0 : 1; }

        if (a.state === DIVING) {
          const p = DIVE_PROFILE[a.kind];
          const leader = a.escort && a.convoy ? a.convoy.leader : null;
          if (leader && leader.alive && leader.state === DIVING) {
            // Ride the flagship's frame: beside the wingtip, a little back.
            const fx = Math.sin(leader.ang);
            const fy = Math.cos(leader.ang);
            a.ang = leader.ang;
            a.x = leader.x + Math.cos(leader.ang) * a.side * 16 - fx * 9;
            a.y = leader.y - Math.sin(leader.ang) * a.side * 16 - fy * 9;
          } else {
            if (a.escort) { a.escort = false; a.weaveAmp = p.weave; a.weaveHz = p.hz; }
            a.weaveT += sec * a.weaveHz * TAU;
            const aimY = view.vh + 30;
            let aimX = ship.x;
            // Lead the Galaxip a touch, so a moving target still gets hunted.
            aimX += (ship.targetX - ship.x) * p.lead * 6;
            // Push away from the walls before the alien pins itself there.
            if (a.x < 28) aimX = Math.max(aimX, 56);
            if (a.x > VW - 28) aimX = Math.min(aimX, VW - 56);
            steer(a, aimX, aimY, p.turn, dt);
            a.ang += Math.sin(a.weaveT) * a.weaveAmp * sec * 2.4;
            a.x += Math.sin(a.ang) * a.spd * sec;
            a.y += Math.cos(a.ang) * a.spd * sec;
          }
          if (game.screen === "play") alienFires(a, dt);
          if (a.y > view.vh + 16) leftTheField(a);
          else if (a.y < zone.top - 40 && Math.cos(a.ang) < 0) {
            // Flew off the top mid-peel; turn it over and come back down.
            a.ang = Math.PI - a.ang;
          }
          // Bank off the walls rather than leaving the screen. Reflecting
          // the heading flips the sideways component and keeps the descent.
          if (a.x < 8) { a.x = 8; if (Math.sin(a.ang) < 0) a.ang = -a.ang; }
          else if (a.x > VW - 8) { a.x = VW - 8; if (Math.sin(a.ang) > 0) a.ang = -a.ang; }
          continue;
        }

        if (a.state === RETURNING) {
          const hx = slotX(a.col);
          const hy = slotY(a.row);
          steer(a, hx, hy, 5.2, dt);
          a.x += Math.sin(a.ang) * a.spd * sec;
          a.y += Math.cos(a.ang) * a.spd * sec;
          const dx = hx - a.x;
          const dy = hy - a.y;
          if (dx * dx + dy * dy < 30) {
            a.state = FORMATION;
            a.convoy = null;
            a.escort = false;
            a.flap = 0;
          }
          if (a.y > view.vh + 16) reenterFromTop(a);
        }
      }
      // Retire convoy records once the charge is over, so a long game does
      // not accumulate one per flagship dive.
      for (let i = convoys.length - 1; i >= 0; i--) {
        const c = convoys[i];
        if (c.alive) continue;
        let busy = false;
        for (const e of c.escorts) if (e.alive && e.state === DIVING) busy = true;
        if (!busy) convoys.splice(i, 1);
      }
      // Rack sway. Every alien lost speeds the survivors up, which is
      // what makes the last two drones feel like the hardest two.
      const thinned = 1 - game.aliveCount / Math.max(1, game.rackCount);
      const swaySpeed = 9 * (1 + thinned * 2.4) * t.speed;
      game.formX += game.formDir * swaySpeed * sec;
      const limit = SWAY;
      if (game.formX > VW / 2 + limit) { game.formX = VW / 2 + limit; game.formDir = -1; }
      if (game.formX < VW / 2 - limit) { game.formX = VW / 2 - limit; game.formDir = 1; }
      setRack(thinned, game.screen === "play" || game.screen === "ready" ? 0.26 : 0.12);
    }

    /* ---------------------------------------------------------------- *
     * Shots. One missile at a time, exactly as the hardware allowed —
     * you cannot fire again until this one hits or leaves the screen.
     * ---------------------------------------------------------------- */
    function fireMissile() {
      if (missile.live || !ship.alive || game.screen !== "play") return;
      missile.live = true;
      missile.x = ship.x;
      missile.y = zone.shipY - 8;
      sfx.fire();
      haptic("light");
      ctx.platform.interact({ type: "fire" });
    }

    function updateShots(dt) {
      const sec = dt / 1000;
      if (missile.live) {
        missile.y -= 300 * zone.pace * sec;
        if (missile.y < zone.top - 6) missile.live = false;
      }
      for (let i = bullets.length - 1; i >= 0; i--) {
        const b = bullets[i];
        b.x += b.vx * sec;
        b.y += b.vy * sec;
        if (b.y > view.vh || b.x < -6 || b.x > VW + 6) bullets.splice(i, 1);
      }
    }

    function collide(dt) {
      // Missile against the rack.
      if (missile.live) {
        for (let i = 0; i < aliens.length; i++) {
          const a = aliens[i];
          if (!a.alive || a.entryT > 0) continue;
          const r = a.kind === FLAGSHIP ? 8 : 6;
          if (Math.abs(a.x - missile.x) <= r + 1 && Math.abs(a.y - missile.y) <= r + 4) {
            missile.live = false;
            killAlien(a);
            break;
          }
        }
      }
      if (!ship.alive || game.screen !== "play") return;
      // Alien fire against the Galaxip.
      for (let i = bullets.length - 1; i >= 0; i--) {
        const b = bullets[i];
        if (Math.abs(b.x - ship.x) <= 6 && Math.abs(b.y - zone.shipY) <= 6) {
          bullets.splice(i, 1);
          playerHit();
          return;
        }
      }
      // Ramming. A diver that reaches you is as fatal as its shot.
      for (let i = 0; i < aliens.length; i++) {
        const a = aliens[i];
        if (!a.alive || a.state === FORMATION || a.entryT > 0) continue;
        if (Math.abs(a.x - ship.x) <= 9 && Math.abs(a.y - zone.shipY) <= 8) {
          killAlien(a);
          playerHit();
          return;
        }
      }
    }

    function playerHit() {
      ship.alive = false;
      game.lives--;
      explode(ship.x, zone.shipY, true, WHITE);
      sfx.shipDie();
      sfx.sirenOff();
      haptic("heavy");
      bullets.length = 0;
      missile.live = false;
      game.screen = "dying";
      game.timer = 1500;
      ctx.platform.emit("galaxip_lost", { score: game.score, stage: game.stage, lives: game.lives });
    }

    // After a death the rack re-forms, which is the arcade's own reset.
    function recallRack() {
      for (const a of aliens) {
        if (!a.alive) continue;
        a.state = FORMATION;
        a.convoy = null;
        a.escort = false;
        a.flap = 0;
        a.x = slotX(a.col);
        a.y = slotY(a.row);
      }
      convoys.length = 0;
      sfx.sirenOff();
      game.diveTimer = 1300;
    }

    /* ================================================================ *
     * RENDERING
     * ================================================================ */

    // Buttons are painted, not DOM. Each frame rebuilds the hit list.
    let hotspots = [];
    function hotspot(id, x, y, w, h) { hotspots.push({ id, x, y, w, h }); }

    function drawPanel(x, y, w, h, edge) {
      g.fillStyle = BLACK;
      g.fillRect(x, y, w, h);
      g.fillStyle = edge || BLUE;
      g.fillRect(x, y, w, 1);
      g.fillRect(x, y + h - 1, w, 1);
      g.fillRect(x, y, 1, h);
      g.fillRect(x + w - 1, y, 1, h);
    }

    function drawButton(id, label, x, y, w, h, tint, on) {
      const color = tint || CYAN;
      drawPanel(x, y, w, h, color);
      if (on) {
        g.fillStyle = color;
        g.fillRect(x + 2, y + 2, w - 4, h - 4);
      }
      drawText(g, label, x + w / 2, y + (h - 7) / 2, 1, on ? BLACK : color, 0);
      hotspot(id, x, y, w, h);
    }

    function drawBurst(b) {
      const t = clamp(b.t / b.dur, 0, 1);
      const spokes = b.big ? 16 : 9;
      const reach = b.big ? 22 : 10;
      const core = b.big ? 4 : 2;
      if (b.flash >= 0 && b.t < 70) {
        blit(g, SPRITES.flash[b.flash], b.x, b.y);
      } else if (t < 0.4) {
        // Core as a cross, the shape the first explosion frame had.
        g.fillStyle = t < 0.2 ? WHITE : b.color;
        const c = Math.max(1, Math.round(core * (1 - t / 0.4)) + 1);
        g.fillRect(Math.round(b.x - c), Math.round(b.y), c * 2 + 1, 1);
        g.fillRect(Math.round(b.x), Math.round(b.y - c), 1, c * 2 + 1);
        if (b.big) {
          g.fillRect(Math.round(b.x - c + 1), Math.round(b.y - c + 1), 1, 1);
          g.fillRect(Math.round(b.x + c - 1), Math.round(b.y - c + 1), 1, 1);
          g.fillRect(Math.round(b.x - c + 1), Math.round(b.y + c - 1), 1, 1);
          g.fillRect(Math.round(b.x + c - 1), Math.round(b.y + c - 1), 1, 1);
        }
      }
      for (let i = 0; i < spokes; i++) {
        // Cheap deterministic jitter per spoke; no allocation per frame.
        const hash = ((b.seed + i * 2654435761) >>> 0) / 4294967296;
        const ang = (i / spokes) * TAU + (hash - 0.5) * 0.6;
        const speed = 0.55 + hash * 0.75;
        const dist = t * reach * speed;
        const fade = 1 - t;
        if (fade <= 0.06) continue;
        const px = Math.round(b.x + Math.cos(ang) * dist);
        const py = Math.round(b.y + Math.sin(ang) * dist);
        g.fillStyle = b.big
          ? (t < 0.25 ? WHITE : t < 0.6 ? YELLOW : RED)
          : (t < 0.4 ? WHITE : b.color);
        const size = b.big ? (t < 0.5 ? 2 : 1) : 1;
        g.fillRect(px, py, size, size);
        if (b.big && i % 2 === 0) {
          const d2 = dist * 0.6;
          g.fillRect(Math.round(b.x + Math.cos(ang) * d2), Math.round(b.y + Math.sin(ang) * d2), 1, 1);
        }
      }
    }

    function drawAliens(now) {
      for (let i = 0; i < aliens.length; i++) {
        const a = aliens[i];
        if (!a.alive) continue;
        if (a.entryT > 0) {
          // Dropping in: blink until the row settles.
          if (Math.floor(now / 70) % 2 === 0) continue;
        }
        const frame = a.state === FORMATION ? 0 : a.flap;
        blit(g, SPRITES.alien[a.kind][frame], a.x, a.y);
      }
    }

    function drawShots() {
      if (missile.live) {
        g.fillStyle = WHITE;
        g.fillRect(Math.round(missile.x), Math.round(missile.y), 1, 6);
        g.fillStyle = YELLOW;
        g.fillRect(Math.round(missile.x), Math.round(missile.y + 2), 1, 3);
      }
      for (let i = 0; i < bullets.length; i++) {
        const b = bullets[i];
        g.fillStyle = WHITE;
        g.fillRect(Math.round(b.x), Math.round(b.y), 1, 3);
        g.fillStyle = RED;
        g.fillRect(Math.round(b.x), Math.round(b.y + 3), 1, 1);
      }
    }

    function drawShip(now) {
      if (!ship.alive || !ship.visible) return;
      if (ship.blinkT > 0 && Math.floor(now / 80) % 2 === 0) return;
      blit(g, SPRITES.ship, ship.x, zone.shipY);
    }

    function scoreText(n) { return n === 0 ? "00" : String(n); }

    function drawHud(now) {
      // "1UP" flashes for whoever is at the controls, as the board did.
      const flash = Math.floor(now / 320) % 2 === 0;
      drawText(g, "1up", 16, zone.hudTop, 1, flash || game.screen === "attract" ? RED : BLACK, -1);
      drawText(g, "high score", VW / 2, zone.hudTop, 1, RED, 0);
      drawText(g, scoreText(game.score), 16, zone.hudTop + 9, 1, WHITE, -1);
      drawText(g, scoreText(Math.max(game.best, game.score)), VW / 2, zone.hudTop + 9, 1, WHITE, 0);

      if (game.screen === "attract") return;

      // Reserve Galaxips, bottom left.
      const reserve = Math.max(0, Math.min(game.lives - 1, 6));
      for (let i = 0; i < reserve; i++) blit(g, SPRITES.ship, 12 + i * 16, view.vh - 10);

      // Stage flags, bottom right.
      const shown = Math.min(game.stage, 10);
      for (let i = 0; i < shown; i++) {
        blit(g, SPRITES.flag, VW - 10 - i * 10, view.vh - 10);
      }
      if (game.stage > 10) {
        drawText(g, "x" + game.stage, VW - 12 - shown * 10, view.vh - 13, 1, WHITE, 1);
      }
    }

    function drawPops() {
      for (let i = 0; i < pops.length; i++) {
        const p = pops[i];
        const t = p.t / p.dur;
        if (t > 0.75 && Math.floor(p.t / 60) % 2 === 0) continue;
        drawText(g, p.text, p.x, p.y - t * 8, 1, p.color, 0);
      }
    }

    /* ---------------------------------------------------------------- *
     * The score chart from the attract screen: every alien beside what
     * it is worth sitting in the rack and what it is worth diving.
     * ---------------------------------------------------------------- */
    function drawScoreTable(top, now) {
      const x = 40;
      let y = top;
      drawText(g, "score advance table", VW / 2, y, 1, CYAN, 0);
      y += 14;
      const beat = Math.floor(now / 240) % 2;
      for (let kind = FLAGSHIP; kind >= DRONE; kind--) {
        blit(g, SPRITES.alien[kind][beat], x, y + 4);
        if (kind === FLAGSHIP) {
          drawText(g, "150 200 300", x + 18, y, 1, YELLOW, -1);
          drawText(g, "800 both escorts", x + 18, y + 9, 1, CYAN, -1);
          y += 22;
        } else {
          drawText(g, CONVOY_VALUE[kind] + " convoy", x + 18, y, 1, WHITE, -1);
          drawText(g, DIVING_VALUE[kind] + " charging", x + 18, y + 8, 1, GREY, -1);
          y += 20;
        }
      }
      return y;
    }

    function drawAttract(now) {
      const cy = Math.max(30, view.vh * 0.10);
      drawText(g, "convoy", VW / 2, cy, 4, YELLOW, 0);
      drawText(g, "charge", VW / 2, cy + 34, 4, YELLOW, 0);
      drawText(g, "we are the galaxians", VW / 2, cy + 68, 1, CYAN, 0);
      drawText(g, "mission: destroy aliens", VW / 2, cy + 78, 1, WHITE, 0);
      const tableEnd = drawScoreTable(cy + 96, now);
      // Push the start prompt and the buttons to the foot of the screen so
      // a tall phone does not leave a dead band under the score table.
      const by = Math.max(tableEnd + 14, view.vh - 88);
      if (Math.floor(now / 400) % 2 === 0) {
        drawText(g, "tap to start", VW / 2, by, 2, WHITE, 0);
      }
      drawButton("help", "how to play", 20, by + 22, 84, 14, CYAN, false);
      drawButton("settings", "settings", VW - 104, by + 22, 84, 14, CYAN, false);
      drawText(g, "1st bonus galaxip for 7000 pts", VW / 2, by + 42, 1, GREY, 0);
    }

    function drawReady(now) {
      const flash = Math.floor(now / 260) % 2 === 0;
      if (flash) drawText(g, "player one", VW / 2, view.vh * 0.42, 2, CYAN, 0);
      drawText(g, "stage " + game.stage, VW / 2, view.vh * 0.42 + 20, 1, WHITE, 0);
    }

    function drawClear() {
      drawText(g, "stage " + (game.stage - 1) + " cleared", VW / 2, view.vh * 0.42, 2, YELLOW, 0);
      if (game.escapedFlagships > 0) {
        drawText(g, game.escapedFlagships + " flagship escaped", VW / 2, view.vh * 0.42 + 20, 1, RED, 0);
      }
    }

    function drawGameOver(now) {
      const w = 176;
      const h = 104;
      const x = (VW - w) / 2;
      const y = Math.max(zone.top + 6, view.vh * 0.3);
      drawPanel(x, y, w, h, RED);
      drawText(g, "game over", VW / 2, y + 10, 2, RED, 0);
      drawText(g, "score", x + 12, y + 32, 1, GREY, -1);
      drawText(g, scoreText(game.score), x + w - 12, y + 32, 1, WHITE, 1);
      drawText(g, "best", x + 12, y + 44, 1, GREY, -1);
      drawText(g, scoreText(game.best), x + w - 12, y + 44, 1, YELLOW, 1);
      drawText(g, "stage", x + 12, y + 56, 1, GREY, -1);
      drawText(g, String(game.lastRunStage), x + w - 12, y + 56, 1, WHITE, 1);
      drawButton("replay", "play again", x + 12, y + 70, w - 24, 16, CYAN, Math.floor(now / 400) % 2 === 0);
      drawText(g, "score sent to the leaderboard", VW / 2, y + h + 8, 1, GREY, 0);
    }

    /* ================================================================ *
     * OVERLAYS
     * ================================================================ */
    let overlay = null;      // null | "help" | "settings"
    let autoFire = false;

    const HELP_LINES = [
      "drag anywhere to steer the",
      "galaxip. tap to fire.",
      "",
      "only one missile may be on",
      "screen at a time, so make",
      "each one count.",
      "",
      "the convoy dives at you in",
      "swoops. an alien is worth",
      "double once it leaves the rack.",
      "",
      "a flagship charges with two red",
      "hornets. shoot it for 300, or",
      "take both escorts first and the",
      "flagship is worth 800.",
      "",
      "a flagship that reaches the",
      "bottom escapes, and leads the",
      "next rack.",
      "",
      "extra galaxip at 7000 points."
    ];

    function drawHelp() {
      const w = 210;
      let body = 0;
      for (const line of HELP_LINES) body += line ? 9 : 5;
      const h = 30 + body + 24;
      const x = (VW - w) / 2;
      const y = clamp((view.vh - h) / 2 - 6, zone.top + 4, view.vh - h - 24);
      drawPanel(x, y, w, h, CYAN);
      drawText(g, "how to play", VW / 2, y + 8, 2, CYAN, 0);
      let ly = y + 28;
      for (const line of HELP_LINES) {
        if (line) drawText(g, line, x + 8, ly, 1, WHITE, -1);
        ly += line ? 9 : 5;
      }
      drawButton("close", "back", x + w / 2 - 32, y + h - 20, 64, 14, CYAN, false);
    }

    function drawSettings() {
      const w = 200;
      const h = 150;
      const x = (VW - w) / 2;
      const y = Math.max(zone.top + 4, (view.vh - h) / 2 - 8);
      drawPanel(x, y, w, h, CYAN);
      drawText(g, "settings", VW / 2, y + 8, 2, CYAN, 0);
      let ry = y + 28;
      drawText(g, "controls", x + 10, ry + 4, 1, GREY, -1);
      drawButton("scheme_drag", "drag", x + 88, ry, 48, 14, CYAN, scheme === "drag");
      drawButton("scheme_pads", "pads", x + 142, ry, 48, 14, CYAN, scheme === "pads");
      ry += 22;
      drawText(g, "auto fire", x + 10, ry + 4, 1, GREY, -1);
      drawButton("autofire", autoFire ? "on" : "off", x + 142, ry, 48, 14, YELLOW, autoFire);
      ry += 22;
      drawText(g, "sound", x + 10, ry + 4, 1, GREY, -1);
      drawButton("sound", sfxOn ? "on" : "off", x + 142, ry, 48, 14, YELLOW, sfxOn);
      ry += 22;
      drawText(g, "haptics", x + 10, ry + 4, 1, GREY, -1);
      drawButton("haptics", hapticsOn ? "on" : "off", x + 142, ry, 48, 14, YELLOW, hapticsOn);
      ry += 24;
      drawButton("resetbest", "reset best", x + 10, ry, 88, 14, RED, false);
      drawButton("close", "back", x + 142, ry, 48, 14, CYAN, false);
    }

    /* ---------------------------------------------------------------- *
     * The on-screen pads, for players who would rather have a stick and
     * a button than drag. They live in their own band so the Galaxip is
     * never underneath a thumb.
     * ---------------------------------------------------------------- */
    function padRects() {
      const bandTop = view.vh - 20 - PAD_BAND + 2;
      const hgt = PAD_BAND - 6;
      return {
        left: { x: 6, y: bandTop, w: 42, h: hgt },
        right: { x: 52, y: bandTop, w: 42, h: hgt },
        fire: { x: VW - 76, y: bandTop, w: 70, h: hgt }
      };
    }

    function drawPads() {
      const r = padRects();
      const cells = [["left", r.left, "<"], ["right", r.right, ">"], ["fire", r.fire, "fire"]];
      for (const cell of cells) {
        const held = padHeld[cell[0]];
        const box = cell[1];
        drawPanel(box.x, box.y, box.w, box.h, held ? WHITE : CYAN);
        if (held) {
          g.fillStyle = CYAN;
          g.fillRect(box.x + 2, box.y + 2, box.w - 4, box.h - 4);
        }
        drawText(g, cell[2], box.x + box.w / 2, box.y + (box.h - 7) / 2,
          cell[2] === "fire" ? 1 : 2, held ? BLACK : CYAN, 0);
      }
    }

    /* ================================================================ *
     * INPUT
     * ================================================================ */
    const padHeld = { left: false, right: false, fire: false };
    const pointerRole = new Map();
    let steerPointer = null;
    let steerRefX = 0;
    let steerRefShip = 0;
    let holdingFire = false;
    let started = false;
    const keys = { left: false, right: false, fire: false };

    function firstGesture() {
      resumeAudio();
      startRack();
      if (!started) {
        started = true;
        ctx.platform.start();
      }
    }

    function hitHotspot(vx, vy) {
      for (let i = hotspots.length - 1; i >= 0; i--) {
        const s = hotspots[i];
        if (vx >= s.x && vx <= s.x + s.w && vy >= s.y && vy <= s.y + s.h) return s.id;
      }
      return null;
    }

    function padAt(vx, vy) {
      if (scheme !== "pads" || game.screen !== "play") return null;
      const r = padRects();
      for (const key in r) {
        if (!Object.prototype.hasOwnProperty.call(r, key)) continue;
        const b = r[key];
        // Generous vertical slop: thumbs land short of a small target.
        if (vx >= b.x - 4 && vx <= b.x + b.w + 4 && vy >= b.y - 8 && vy <= b.y + b.h + 8) return key;
      }
      return null;
    }

    function handleButton(id) {
      if (id === "close") { overlay = null; return true; }
      if (id === "help") { overlay = "help"; return true; }
      if (id === "settings") { overlay = "settings"; return true; }
      if (id === "scheme_drag" || id === "scheme_pads") {
        scheme = id === "scheme_pads" ? "pads" : "drag";
        padHeld.left = padHeld.right = padHeld.fire = false;
        measure();
        saveSettings();
        return true;
      }
      if (id === "autofire") { autoFire = !autoFire; saveSettings(); return true; }
      if (id === "sound") {
        sfxOn = !sfxOn;
        if (!sfxOn) sfx.sirenOff();
        setRack(rack.level, sfxOn ? 0.26 : 0);
        saveSettings();
        return true;
      }
      if (id === "haptics") { hapticsOn = !hapticsOn; saveSettings(); return true; }
      if (id === "resetbest") { game.best = 0; saveBest(); return true; }
      if (id === "replay") { startGame(); return true; }
      return false;
    }

    function onDown(event) {
      event.preventDefault();
      firstGesture();
      const vx = toVirtualX(event.offsetX);
      const vy = toVirtualY(event.offsetY);
      const id = hitHotspot(vx, vy);
      if (id) {
        sfx.coin();
        haptic("light");
        handleButton(id);
        return;
      }
      if (overlay) { overlay = null; return; }
      if (game.screen === "attract") { startGame(); return; }
      if (game.screen === "over") { startGame(); return; }
      if (game.screen !== "play") return;

      const pad = padAt(vx, vy);
      if (pad) {
        pointerRole.set(event.pointerId, pad);
        padHeld[pad] = true;
        if (pad === "fire") fireMissile();
        return;
      }
      if (scheme === "pads") return;
      pointerRole.set(event.pointerId, "steer");
      if (steerPointer === null) {
        steerPointer = event.pointerId;
        steerRefX = vx;
        steerRefShip = ship.targetX;
      }
      holdingFire = true;
      fireMissile();
    }

    function onMove(event) {
      const role = pointerRole.get(event.pointerId);
      if (!role) return;
      event.preventDefault();
      const vx = toVirtualX(event.offsetX);
      const vy = toVirtualY(event.offsetY);
      if (role === "steer" && event.pointerId === steerPointer) {
        // Relative drag, so the Galaxip never hides under the thumb.
        ship.targetX = clamp(steerRefShip + (vx - steerRefX), 10, VW - 10);
        return;
      }
      if (role === "left" || role === "right" || role === "fire") {
        const pad = padAt(vx, vy);
        if (pad !== role) {
          padHeld[role] = false;
          if (pad) {
            pointerRole.set(event.pointerId, pad);
            padHeld[pad] = true;
            if (pad === "fire") fireMissile();
          } else {
            pointerRole.delete(event.pointerId);
          }
        }
      }
    }

    function onUp(event) {
      const role = pointerRole.get(event.pointerId);
      pointerRole.delete(event.pointerId);
      if (!role) return;
      if (role === "steer") {
        if (event.pointerId === steerPointer) steerPointer = null;
        let anySteer = false;
        pointerRole.forEach(v => { if (v === "steer") anySteer = true; });
        holdingFire = anySteer;
      } else {
        padHeld[role] = false;
      }
    }

    ctx.listen(canvas, "pointerdown", onDown, { passive: false });
    ctx.listen(canvas, "pointermove", onMove, { passive: false });
    ctx.listen(canvas, "pointerup", event => { event.preventDefault(); onUp(event); }, { passive: false });
    ctx.listen(canvas, "pointercancel", onUp, { passive: true });
    ctx.listen(canvas, "contextmenu", event => event.preventDefault(), { passive: false });

    // Desktop players get the cabinet layout: stick left and right, fire.
    ctx.listen(window, "keydown", event => {
      const k = event.key;
      if (k === "ArrowLeft" || k === "a" || k === "A") keys.left = true;
      else if (k === "ArrowRight" || k === "d" || k === "D") keys.right = true;
      else if (k === " " || k === "ArrowUp" || k === "w" || k === "W") {
        if (!keys.fire) {
          firstGesture();
          if (game.screen === "attract" || game.screen === "over") startGame();
          else fireMissile();
        }
        keys.fire = true;
      } else return;
      event.preventDefault();
    }, { passive: false });

    ctx.listen(window, "keyup", event => {
      const k = event.key;
      if (k === "ArrowLeft" || k === "a" || k === "A") keys.left = false;
      else if (k === "ArrowRight" || k === "d" || k === "D") keys.right = false;
      else if (k === " " || k === "ArrowUp" || k === "w" || k === "W") keys.fire = false;
    }, { passive: true });

    /* ================================================================ *
     * STORAGE AND LEADERBOARD
     * ================================================================ */
    function canStore() { return !!(ctx.capabilities && ctx.capabilities.storage); }

    async function loadSaved() {
      if (!canStore()) return;
      try {
        const b = await ctx.storage.get("best");
        if (typeof b === "number" && isFinite(b)) game.best = Math.max(0, Math.floor(b));
      } catch (err) { /* storage denied */ }
      try {
        const s = await ctx.storage.get("settings");
        if (s && typeof s === "object") {
          if (s.scheme === "pads" || s.scheme === "drag") scheme = s.scheme;
          if (typeof s.autoFire === "boolean") autoFire = s.autoFire;
          if (typeof s.sfxOn === "boolean") sfxOn = s.sfxOn;
          if (typeof s.hapticsOn === "boolean") hapticsOn = s.hapticsOn;
          measure();
        }
      } catch (err) { /* storage denied */ }
    }

    async function saveSettings() {
      if (!canStore()) return;
      try {
        await ctx.storage.set("settings", { scheme, autoFire, sfxOn, hapticsOn });
      } catch (err) { /* storage denied */ }
    }

    async function saveBest() {
      if (!canStore()) return;
      try { await ctx.storage.set("best", game.best); } catch (err) { /* storage denied */ }
    }

    async function submitScore() {
      if (game.score <= 0) return;
      try {
        await ctx.memory.record("score").submit(game.score, { label: game.score + " pts" });
      } catch (err) {
        ctx.platform.error({ where: "record_submit" });
      }
    }

    /* ================================================================ *
     * RUN CONTROL
     * ================================================================ */
    function startGame() {
      game.score = 0;
      game.lives = 3;
      game.stage = 1;
      game.lastRunStage = 1;
      game.bonusGiven = false;
      game.escapedFlagships = 0;
      bursts.length = 0;
      pops.length = 0;
      bullets.length = 0;
      missile.live = false;
      ship.x = VW / 2;
      ship.targetX = VW / 2;
      ship.alive = true;
      ship.visible = true;
      ship.blinkT = 0;
      overlay = null;
      buildRack();
      game.screen = "ready";
      game.timer = 1700;
      ctx.platform.setScore(0);
      sfx.intro();
      ctx.platform.emit("run_start", { best: game.best });
    }

    function gameOver() {
      game.screen = "over";
      ship.alive = false;
      sfx.sirenOff();
      sfx.gameOver();
      recallRack();
      if (game.score > game.best) { game.best = game.score; saveBest(); }
      ctx.platform.setScore(game.score);
      ctx.platform.fail({ score: game.score, stage: game.lastRunStage });
      submitScore();
    }

    function clearWave() {
      game.lastRunStage = game.stage;
      game.stage++;
      game.screen = "clear";
      game.timer = 1600;
      bullets.length = 0;
      missile.live = false;
      sfx.sirenOff();
      sfx.waveClear();
      haptic("success");
      ctx.platform.milestone("stage_clear", { stage: game.lastRunStage, score: game.score });
    }

    function updateShip(dt) {
      if (!ship.alive) return;
      const sec = dt / 1000;
      let dir = 0;
      if (padHeld.left || keys.left) dir -= 1;
      if (padHeld.right || keys.right) dir += 1;
      if (dir !== 0) ship.targetX = clamp(ship.targetX + dir * 155 * sec, 10, VW - 10);
      const step = 280 * sec;
      ship.x += clamp(ship.targetX - ship.x, -step, step);
      ship.x = clamp(ship.x, 10, VW - 10);
      if (ship.blinkT > 0) ship.blinkT -= dt;
      // With one missile allowed at a time, auto fire is simply "always
      // reloading"; fireMissile no-ops while a shot is still in flight.
      if (autoFire || padHeld.fire || keys.fire) fireMissile();
    }

    /* ================================================================ *
     * FRAME
     * ================================================================ */
    function frame(dtMs, timeMs) {
      const dt = Math.min(dtMs || 16, 48);
      const now = timeMs || 0;
      if (ctx.width !== view.cw || ctx.height !== view.ch) { layout(); measure(); }

      updateStars(dt);
      for (let i = bursts.length - 1; i >= 0; i--) {
        bursts[i].t += dt;
        if (bursts[i].t >= bursts[i].dur) bursts.splice(i, 1);
      }
      for (let i = pops.length - 1; i >= 0; i--) {
        pops[i].t += dt;
        if (pops[i].t >= pops[i].dur) pops.splice(i, 1);
      }

      if (!overlay) {
        if (game.screen === "attract") {
          setRack(0.12, 0.1);
        } else if (game.screen === "ready") {
          game.timer -= dt;
          updateAliens(dt);
          if (game.timer <= 0) { game.screen = "play"; ship.blinkT = 600; }
        } else if (game.screen === "play") {
          updateShip(dt);
          updateAliens(dt);
          chooseDivers(dt);
          updateShots(dt);
          collide(dt);
          if (game.screen === "play" && countAlive() === 0) clearWave();
        } else if (game.screen === "dying") {
          game.timer -= dt;
          updateAliens(dt);
          updateShots(dt);
          if (game.timer <= 0) {
            if (game.lives <= 0) {
              gameOver();
            } else {
              recallRack();
              ship.alive = true;
              ship.visible = true;
              ship.blinkT = 1000;
              ship.x = VW / 2;
              ship.targetX = VW / 2;
              game.screen = "play";
            }
          }
        } else if (game.screen === "clear") {
          game.timer -= dt;
          updateAliens(dt);
          if (game.timer <= 0) {
            buildRack();
            game.screen = "ready";
            game.timer = 1500;
            sfx.intro();
          }
        } else if (game.screen === "over") {
          updateAliens(dt);
        }
      }

      /* ---- paint ---- */
      hotspots = [];
      g.save();
      g.imageSmoothingEnabled = false;
      g.fillStyle = BLACK;
      g.fillRect(0, 0, ctx.width, ctx.height);
      g.translate(view.ox, view.oy);
      g.scale(view.scale, view.scale);
      g.beginPath();
      g.rect(0, 0, VW, view.vh);
      g.clip();
      g.fillStyle = BLACK;
      g.fillRect(0, 0, VW, view.vh);

      drawStars(now);
      if (game.screen !== "attract") {
        drawAliens(now);
        drawShots();
        drawShip(now);
      }
      for (let i = 0; i < bursts.length; i++) drawBurst(bursts[i]);
      drawPops();
      drawHud(now);
      if (scheme === "pads" && !overlay
          && (game.screen === "play" || game.screen === "ready" || game.screen === "dying")) {
        drawPads();
      }

      if (game.screen === "attract") drawAttract(now);
      else if (game.screen === "ready") drawReady(now);
      else if (game.screen === "clear") drawClear();
      else if (game.screen === "over") drawGameOver(now);

      if (overlay === "help") drawHelp();
      else if (overlay === "settings") drawSettings();

      g.restore();
    }

    /* ================================================================ *
     * BOOT
     * ================================================================ */
    await loadSaved();
    layout();
    measure();
    frame(16, 0);
    ctx.markVisualReady("attract");
    ctx.onFrame(frame);
    ctx.platform.ready({ title: "Convoy Charge" });
  }
};
