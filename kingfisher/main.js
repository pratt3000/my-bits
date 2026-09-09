/**
 * Kingfisher — the original one-tap bird, rebuilt faithfully.
 *
 * The rules are the ones the well-known faithful clones carry (FlapPyBird
 * and its descendants): a 288×512 world run at 30 ticks a second, gravity of
 * one pixel a tick squared, a flap that sets the fall to minus nine, a fall
 * capped at ten, pipes 52 wide moving four pixels a tick with a 100-pixel
 * gap whose top is uniform over [80, 221], a new pipe at x = 298 the moment
 * the first one crosses x < 5, a point when the bird's middle passes the
 * pipe's middle, and a nose that holds 20° up for a third of a second after
 * every tap and then pitches to −90°. Difficulty is constant, like the
 * original: the randomness is the difficulty.
 *
 * The model is pure and runs in Node, where a planner has to clear two
 * hundred pipes on every seed. The art is drawn here, pixel by pixel, in the
 * original's language: two-by-two pixels on a 144×256 grid, a dark outline
 * on everything, green pipes, a tan ground with a striped verge.
 */
window.plethoraBit = {
  meta: {
    title: "Kingfisher",
    runtime: "plethora-bit@2",
    tags: ["game", "arcade", "pixel", "bird", "flappy", "retro"],
    permissions: ["haptics", "audio", "storage"]
  },

  async init(ctx) {
    const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
    const lerp = (a, b, t) => a + (b - a) * t;
    const easeOut = (t) => 1 - Math.pow(1 - t, 3);
    let seed = 0x1f2e3d4c;
    function rnd() {
      seed ^= seed << 13; seed >>>= 0;
      seed ^= seed >> 17;
      seed ^= seed << 5; seed >>>= 0;
      return seed / 4294967296;
    }
    function fireAndForget(thunk) {
      try {
        const r = thunk();
        if (r && typeof r.catch === "function") r.catch(() => {});
      } catch (err) { /* storage unsupported here */ }
    }

    // === MODEL BEGIN
    // Pure: no ctx, DOM or canvas. Units are the original's logical pixels
    // (288×512) and ticks (30 a second). y grows downward, as on a screen.
    const MODEL = (function () {
      const W = 288, H = 512, TPS = 30;
      const BIRD_W = 34, BIRD_H = 24, BIRD_X = Math.floor(W * 0.2);     // 57
      const PIPE_W = 52, GAP = 100, BASE_Y = Math.floor(H * 0.79);      // 404
      const SPEED = 4;                                                  // px a tick
      const ACC = 1, FLAP = -9, VMAX = 10;                              // px a tick
      const ROT_FLAP = 45, ROT_VEL = 3, ROT_THR = 20, ROT_MIN = -90;    // degrees
      const DEAD_ACC = 2, DEAD_VMAX = 15, DEAD_ROT_VEL = 7;
      const GAP_MIN = Math.floor(BASE_Y * 0.2);                         // 80
      const GAP_RANGE = Math.floor(BASE_Y * 0.6 - GAP);                 // 142
      const FIRST_X = W + 200, SPAWN_X = W + 10, INSET = 2;
      const START_Y = Math.floor((H - BIRD_H) / 2);                     // 244

      function rand(run) {
        let s = run.rng;
        s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0;
        run.rng = s;
        return s / 4294967296;
      }
      function gapFor(run) { return GAP_MIN + Math.floor(rand(run) * GAP_RANGE); }
      function newRun(seedValue) {
        const run = {
          tick: 0, y: START_Y, vy: -9, rot: ROT_FLAP, flapped: false,
          started: false, alive: true, landed: false, cause: null, score: 0,
          bob: 0, bobDir: 1, wing: 0, wingT: 0,
          pipes: [], nextId: 1, rng: (seedValue >>> 0) || 0x9e3779b9
        };
        run.pipes.push({ id: run.nextId++, x: FIRST_X, gapY: gapFor(run), passed: false });
        run.pipes.push({ id: run.nextId++, x: FIRST_X + W / 2, gapY: gapFor(run), passed: false });
        return run;
      }
      function flap(run) {
        if (!run.alive) return false;
        if (run.y <= -2 * BIRD_H) return false;            // too far above the top
        run.started = true;
        run.vy = FLAP;
        run.flapped = true;
        return true;
      }
      function visibleRot(run) { return run.rot > ROT_THR ? ROT_THR : run.rot; }
      function birdRect(run) { return [BIRD_X + INSET, run.y + INSET, BIRD_W - 2 * INSET, BIRD_H - 2 * INSET]; }
      function hitsPipe(run, p) {
        const [bx, by, bw, bh] = birdRect(run);
        if (bx + bw <= p.x || bx >= p.x + PIPE_W) return false;
        return by < p.gapY || by + bh > p.gapY + GAP;
      }
      function wingStep(run) {
        // frames cycle 0,1,2,1 and change every third tick, like the original
        run.wingT++;
        if (run.wingT % 3 === 0) run.wing = [0, 1, 2, 1][(run.wingT / 3) % 4];
      }
      /** One tick. Returns an event string or null. */
      function step(run) {
        run.tick++;
        wingStep(run);
        if (!run.started) {
          // the welcome bob: ±8 px, one pixel a tick
          if (Math.abs(run.bob) === 8) run.bobDir = -run.bobDir;
          run.bob += run.bobDir;
          return null;
        }
        if (!run.alive) {
          if (run.landed) return null;
          if (run.cause !== "ground" && run.rot > ROT_MIN) run.rot = Math.max(ROT_MIN, run.rot - DEAD_ROT_VEL);
          if (run.vy < DEAD_VMAX) run.vy += DEAD_ACC;
          run.y += Math.min(run.vy, BASE_Y - run.y - BIRD_H);
          if (run.y + BIRD_H >= BASE_Y - 1) { run.landed = true; return "land"; }
          return null;
        }
        // rotation, then velocity, then position — the original's order
        if (run.rot > ROT_MIN) run.rot -= ROT_VEL;
        if (run.vy < VMAX && !run.flapped) run.vy += ACC;
        if (run.flapped) { run.flapped = false; run.rot = ROT_FLAP; }
        run.y += Math.min(run.vy, BASE_Y - run.y - BIRD_H);
        for (const p of run.pipes) p.x -= SPEED;
        if (run.pipes.length && run.pipes[0].x > 0 && run.pipes[0].x < 5) {
          run.pipes.push({ id: run.nextId++, x: SPAWN_X, gapY: gapFor(run), passed: false });
        }
        while (run.pipes.length && run.pipes[0].x < -PIPE_W) run.pipes.shift();
        let ev = null;
        const mid = BIRD_X + BIRD_W / 2;
        for (const p of run.pipes) {
          const pm = p.x + PIPE_W / 2;
          if (!p.passed && pm <= mid && mid < pm + SPEED) { p.passed = true; run.score++; ev = "score"; }
        }
        if (run.y + BIRD_H >= BASE_Y - 1) { run.alive = false; run.cause = "ground"; run.landed = true; return "die:ground"; }
        for (const p of run.pipes) {
          if (hitsPipe(run, p)) { run.alive = false; run.cause = "pipe"; return "die:pipe"; }
        }
        return ev;
      }
      function medal(score) {
        return score >= 40 ? "platinum" : score >= 30 ? "gold" : score >= 20 ? "silver" : score >= 10 ? "bronze" : null;
      }
      return { W, H, TPS, BIRD_W, BIRD_H, BIRD_X, PIPE_W, GAP, BASE_Y, SPEED, ACC, FLAP, VMAX,
               ROT_THR, ROT_MIN, GAP_MIN, GAP_RANGE, FIRST_X, SPAWN_X, START_Y,
               newRun, rand, flap, step, hitsPipe, birdRect, visibleRot, medal };
    })();
    // === MODEL END

    // ===================================================================
    // Sound. Wing, point, hit, die, swoosh — synthesised to sit where the
    // original's five sounds sat.
    // ===================================================================
    let ac = null, master = null, noiseBuf = null, audioOn = false;
    function initAudio() {
      if (ac || !ctx.capabilities.audio) return;
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      try {
        ac = new AC();
        master = ac.createGain();
        master.gain.value = 0.7;
        master.connect(ac.destination);
        const n = ac.sampleRate * 0.6;
        noiseBuf = ac.createBuffer(1, n, ac.sampleRate);
        const d = noiseBuf.getChannelData(0);
        for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
        audioOn = true;
      } catch (err) { audioOn = false; }
    }
    ctx.onDestroy(() => { try { if (ac) ac.close(); } catch (err) { /* gone */ } });
    function env(node, at, peak, attack, decay) {
      const gn = ac.createGain();
      gn.gain.setValueAtTime(0.0001, at);
      gn.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), at + attack);
      gn.gain.exponentialRampToValueAtTime(0.0001, at + attack + decay);
      node.connect(gn); gn.connect(master);
    }
    function noise(at, dur, type, f0, f1, q, peak, attack) {
      const src = ac.createBufferSource();
      src.buffer = noiseBuf; src.loop = true;
      const f = ac.createBiquadFilter();
      f.type = type; f.Q.value = q;
      f.frequency.setValueAtTime(f0, at);
      if (f1 && f1 !== f0) f.frequency.exponentialRampToValueAtTime(f1, at + dur);
      src.connect(f);
      env(f, at, peak, attack || 0.005, dur);
      src.start(at); src.stop(at + dur + (attack || 0) + 0.05);
    }
    function tone(at, type, f0, f1, dur, peak, attack) {
      const o = ac.createOscillator();
      o.type = type;
      o.frequency.setValueAtTime(f0, at);
      if (f1 && f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, at + dur);
      env(o, at, peak, attack || 0.004, dur);
      o.start(at); o.stop(at + dur + (attack || 0) + 0.05);
    }
    function sfxWing() {
      if (!audioOn) return;
      const at = ac.currentTime + 0.002;
      noise(at, 0.09, "bandpass", 1500, 500, 1.1, 0.16, 0.012);
      tone(at, "sine", 520, 300, 0.06, 0.03);
    }
    function sfxPoint() {
      if (!audioOn) return;
      const at = ac.currentTime + 0.002;
      tone(at, "triangle", 1318.5, 1318.5, 0.05, 0.16);
      tone(at + 0.055, "triangle", 1760, 1760, 0.16, 0.16);
      tone(at + 0.055, "sine", 3520, 3520, 0.08, 0.03);
    }
    function sfxHit() {
      if (!audioOn) return;
      const at = ac.currentTime + 0.002;
      noise(at, 0.16, "lowpass", 900, 200, 0.7, 0.5);
      tone(at, "square", 140, 55, 0.14, 0.22);
    }
    function sfxDie() {
      if (!audioOn) return;
      const at = ac.currentTime + 0.002;
      tone(at, "sawtooth", 620, 140, 0.36, 0.12, 0.01);
      tone(at, "square", 310, 70, 0.36, 0.05, 0.01);
    }
    function sfxSwoosh() {
      if (!audioOn) return;
      const at = ac.currentTime + 0.002;
      noise(at, 0.28, "bandpass", 500, 2400, 0.8, 0.12, 0.08);
    }
    function haptic(kind) { try { ctx.platform.haptic(kind); } catch (err) { /* none */ } }

    // ===================================================================
    // Pixel art. Everything is drawn on a 144×256 grid of two-by-two
    // pixels, the way the original's sheet was, with a dark outline on
    // every shape. Sprites are baked once into OffscreenCanvases.
    // ===================================================================
    const canvas = ctx.createCanvas2D({ touchAction: "none" });
    const g = canvas.getContext("2d");
    const CAN_BAKE = typeof OffscreenCanvas === "function";
    const K = "#533847";                      // the outline everything shares
    function bake(w, h, draw) {
      const oc = CAN_BAKE ? new OffscreenCanvas(w, h) : null;
      if (!oc) return null;
      const c = oc.getContext("2d");
      c.imageSmoothingEnabled = false;
      draw(c, w, h);
      return oc;
    }
    // rows of characters → sprite, each character a 2×2 block of a palette colour
    function sprite(rows, pal) {
      const w = rows[0].length * 2, h = rows.length * 2;
      return bake(w, h, (c) => {
        for (let y = 0; y < rows.length; y++) {
          const row = rows[y];
          for (let x = 0; x < row.length; x++) {
            const ch = row[x];
            if (ch === "." || !pal[ch]) continue;
            c.fillStyle = pal[ch];
            c.fillRect(x * 2, y * 2, 2, 2);
          }
        }
      });
    }

    // ---- the bird: 17×12, three wing frames, three plumages
    const BIRD_BODY = [
      ".....kkkkkkk.....",
      "...kkyyyyyykkk...",
      "..kyyyyyyyykwwwk.",
      ".kyyyyyyyyykwwwwk",
      ".kyyyyyyyyykwwbwk",
      "kyyyyyyyyyyykwwwk",
      "kyyyyyyyyyyyckkkk",
      "kyyyyyyyyyyckrrrk",
      "kyyyyyyyyycckkkkk",
      ".kyyyyyyycccckRRk",
      "..kyyyyycccccckkk",
      "...kkkkkkkkkkk..."
    ];
    const BIRD_WING = [
      ".kkkkk.",
      "kWWWWWk",
      ".kWWWk.",
      "..kkk.."
    ];
    const WING_Y = [3, 5, 7];                   // up, mid, down — frames 0, 1, 2
    const PLUMAGE = {
      yellow: { y: "#f8d448", W: "#e9b93a", c: "#f8f0c8" },
      blue: { y: "#52bdf5", W: "#3e97cc", c: "#eef6fb" },
      red: { y: "#ee5b46", W: "#c93f2f", c: "#f9e0d4" }
    };
    const birdSprites = {};
    for (const name in PLUMAGE) {
      const p = PLUMAGE[name];
      const pal = { k: K, y: p.y, c: p.c, w: "#ffffff", b: "#101010", r: "#f0562a", R: "#c43b15", W: p.W };
      birdSprites[name] = WING_Y.map((wy) => {
        const rows = BIRD_BODY.map((r) => r.split(""));
        for (let j = 0; j < BIRD_WING.length; j++) {
          for (let i = 0; i < BIRD_WING[j].length; i++) {
            const ch = BIRD_WING[j][i];
            if (ch !== ".") rows[wy + j][2 + i] = ch;
          }
        }
        return sprite(rows.map((r) => r.join("")), pal);
      });
    }

    // ---- pipes: a 26-wide cap and a 24-wide body, lit from the left
    const PIPE = { L: "#9de85a", G: "#73bf2e", D: "#4e8c22" };
    function pipeRow(width) {
      const row = [];
      row.push("k", "L", "L");
      for (let i = 0; i < width - 7; i++) row.push("G");
      row.push("D", "D", "D", "k");
      return row.join("");
    }
    const pipeCap = sprite(["k".repeat(26)].concat(Array(11).fill(pipeRow(26))).concat(["k".repeat(26)]), { k: K, L: PIPE.L, G: PIPE.G, D: PIPE.D });
    const pipeBody = sprite([pipeRow(24)], { k: K, L: PIPE.L, G: PIPE.G, D: PIPE.D });

    // ---- the ground: a striped verge over sand, 168 wide so it tiles
    const groundSprite = bake(336, 112, (c) => {
      c.fillStyle = "#ded895"; c.fillRect(0, 0, 336, 112);
      c.fillStyle = K; c.fillRect(0, 0, 336, 2);
      for (let x = 0; x < 168; x++) {
        for (let y = 1; y <= 6; y++) {
          c.fillStyle = ((x + y) % 12) < 6 ? "#9de85a" : "#73bf2e";
          c.fillRect(x * 2, y * 2, 2, 2);
        }
      }
      c.fillStyle = "#5a8f2a"; c.fillRect(0, 14, 336, 2);
      c.fillStyle = "#d3c26f"; c.fillRect(0, 16, 336, 2);
      c.fillStyle = "#f1e8b6"; c.fillRect(0, 18, 336, 4);
    });

    // ---- backgrounds: day and night, 288 wide so they tile sideways
    const SKIES = {
      day: { sky: "#4ec0ca", cloud: "#e8f9f6", cloudLo: "#cdeeed", city: "#cbe9dc", cityLo: "#b4dcc9", win: "#a2d0be", bush: "#8fd44b", bushLo: "#66b32c", star: null },
      night: { sky: "#12283a", cloud: "#365b6a", cloudLo: "#2b4a58", city: "#22404f", cityLo: "#1b3442", win: "#f0d27a", bush: "#2f7d2b", bushLo: "#215e22", star: "#e9f2ff" }
    };
    function bakeBackground(sk) {
      let s0 = 0x51ab3c7e;
      const r = () => { s0 ^= s0 << 13; s0 >>>= 0; s0 ^= s0 >> 17; s0 ^= s0 << 5; s0 >>>= 0; return s0 / 4294967296; };
      return bake(288, 512, (c) => {
        c.fillStyle = sk.sky; c.fillRect(0, 0, 288, 512);
        if (sk.star) {
          c.fillStyle = sk.star;
          for (let i = 0; i < 46; i++) { const x = Math.floor(r() * 144) * 2, y = Math.floor(r() * 150) * 2; c.fillRect(x, y, 2, 2); }
        }
        // clouds: a band of soft humps
        const bumps = (y0, colTop, colLo, n, rmin, rmax) => {
          for (let i = 0; i < n; i++) {
            const cx = Math.floor((i / n) * 144 + r() * 10) * 2, rad = Math.floor(rmin + r() * (rmax - rmin));
            for (let dy = -rad; dy <= 0; dy++) {
              const half = Math.floor(Math.sqrt(rad * rad - dy * dy));
              c.fillStyle = dy < -rad * 0.45 ? colTop : colLo;
              c.fillRect(cx - half * 2, y0 + dy * 2, half * 4 + 2, 2);
            }
          }
        };
        c.fillStyle = sk.cloud; c.fillRect(0, 352, 288, 30);
        bumps(352, sk.cloud, sk.cloud, 9, 7, 13);
        // the city: blocks with windows
        let x = 0;
        while (x < 144) {
          const w = 6 + Math.floor(r() * 10), h = 10 + Math.floor(r() * 22);
          c.fillStyle = sk.city; c.fillRect(x * 2, 372 - h * 2, w * 2, h * 2);
          c.fillStyle = sk.cityLo; c.fillRect(x * 2 + w * 2 - 2, 372 - h * 2, 2, h * 2);
          c.fillStyle = sk.win;
          for (let wy = 2; wy < h - 1; wy += 3) for (let wx = 1; wx < w - 1; wx += 3) if (r() < 0.7) c.fillRect((x + wx) * 2, 372 - h * 2 + wy * 2, 2, 2);
          x += w + 1 + Math.floor(r() * 2);
        }
        // bushes
        c.fillStyle = sk.bushLo; c.fillRect(0, 372, 288, 32);
        bumps(376, sk.bush, sk.bushLo, 12, 6, 11);
        c.fillStyle = sk.bush; c.fillRect(0, 384, 288, 20);
        c.fillStyle = sk.bushLo; c.fillRect(0, 400, 288, 4);
      });
    }
    const backgrounds = { day: bakeBackground(SKIES.day), night: bakeBackground(SKIES.night) };

    // ---- type: a 5×7 face for words, a 5×8 face for the score
    const FONT = {
      A: [".###.", "#...#", "#...#", "#####", "#...#", "#...#", "#...#"],
      B: ["####.", "#...#", "#...#", "####.", "#...#", "#...#", "####."],
      C: [".###.", "#...#", "#....", "#....", "#....", "#...#", ".###."],
      D: ["####.", "#...#", "#...#", "#...#", "#...#", "#...#", "####."],
      E: ["#####", "#....", "#....", "####.", "#....", "#....", "#####"],
      F: ["#####", "#....", "#....", "####.", "#....", "#....", "#...."],
      G: [".###.", "#...#", "#....", "#.###", "#...#", "#...#", ".####"],
      H: ["#...#", "#...#", "#...#", "#####", "#...#", "#...#", "#...#"],
      I: [".###.", "..#..", "..#..", "..#..", "..#..", "..#..", ".###."],
      J: ["..###", "...#.", "...#.", "...#.", "...#.", "#..#.", ".##.."],
      K: ["#...#", "#..#.", "#.#..", "##...", "#.#..", "#..#.", "#...#"],
      L: ["#....", "#....", "#....", "#....", "#....", "#....", "#####"],
      M: ["#...#", "##.##", "#.#.#", "#.#.#", "#...#", "#...#", "#...#"],
      N: ["#...#", "##..#", "#.#.#", "#..##", "#...#", "#...#", "#...#"],
      O: [".###.", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."],
      P: ["####.", "#...#", "#...#", "####.", "#....", "#....", "#...."],
      Q: [".###.", "#...#", "#...#", "#...#", "#.#.#", "#..#.", ".##.#"],
      R: ["####.", "#...#", "#...#", "####.", "#.#..", "#..#.", "#...#"],
      S: [".####", "#....", "#....", ".###.", "....#", "....#", "####."],
      T: ["#####", "..#..", "..#..", "..#..", "..#..", "..#..", "..#.."],
      U: ["#...#", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."],
      V: ["#...#", "#...#", "#...#", "#...#", "#...#", ".#.#.", "..#.."],
      W: ["#...#", "#...#", "#...#", "#.#.#", "#.#.#", "##.##", "#...#"],
      X: ["#...#", "#...#", ".#.#.", "..#..", ".#.#.", "#...#", "#...#"],
      Y: ["#...#", "#...#", ".#.#.", "..#..", "..#..", "..#..", "..#.."],
      Z: ["#####", "....#", "...#.", "..#..", ".#...", "#....", "#####"],
      "0": [".###.", "#...#", "#..##", "#.#.#", "##..#", "#...#", ".###."],
      "1": ["..#..", ".##..", "..#..", "..#..", "..#..", "..#..", ".###."],
      "2": [".###.", "#...#", "....#", "...#.", "..#..", ".#...", "#####"],
      "3": ["#####", "...#.", "..#..", "...#.", "....#", "#...#", ".###."],
      "4": ["...#.", "..##.", ".#.#.", "#..#.", "#####", "...#.", "...#."],
      "5": ["#####", "#....", "####.", "....#", "....#", "#...#", ".###."],
      "6": ["..##.", ".#...", "#....", "####.", "#...#", "#...#", ".###."],
      "7": ["#####", "....#", "...#.", "..#..", ".#...", ".#...", ".#..."],
      "8": [".###.", "#...#", "#...#", ".###.", "#...#", "#...#", ".###."],
      "9": [".###.", "#...#", "#...#", ".####", "....#", "...#.", ".##.."],
      "!": ["..#..", "..#..", "..#..", "..#..", "..#..", ".....", "..#.."],
      ".": [".....", ".....", ".....", ".....", ".....", ".##..", ".##.."],
      "-": [".....", ".....", ".....", ".###.", ".....", ".....", "....."],
      "'": ["..#..", "..#..", ".....", ".....", ".....", ".....", "....."],
      " ": [".....", ".....", ".....", ".....", ".....", ".....", "....."]
    };
    const DIGITS = [
      [".###.", "#...#", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."],
      ["..#..", ".##..", "..#..", "..#..", "..#..", "..#..", "..#..", ".###."],
      [".###.", "#...#", "....#", "...#.", "..#..", ".#...", "#....", "#####"],
      [".###.", "#...#", "....#", "..##.", "....#", "....#", "#...#", ".###."],
      ["...#.", "..##.", ".#.#.", "#..#.", "#####", "...#.", "...#.", "...#."],
      ["#####", "#....", "#....", "####.", "....#", "....#", "#...#", ".###."],
      [".###.", "#...#", "#....", "####.", "#...#", "#...#", "#...#", ".###."],
      ["#####", "....#", "...#.", "..#..", "..#..", "..#..", "..#..", "..#.."],
      [".###.", "#...#", "#...#", ".###.", "#...#", "#...#", "#...#", ".###."],
      [".###.", "#...#", "#...#", "#...#", ".####", "....#", "#...#", ".###."]
    ];
    const textCache = new Map();
    // A word as a sprite: cells of `cell` px, an outline one cell thick, a
    // shadow one cell down. Cached by everything that shapes it.
    function textSprite(str, cell, fill, outline, shadow) {
      const key = str + "|" + cell + "|" + fill + "|" + outline + "|" + shadow;
      const hit = textCache.get(key);
      if (hit) return hit;
      const glyphs = str.toUpperCase().split("").map((ch) => FONT[ch] || FONT["."]);
      const cols = glyphs.length * 6 - 1;
      const pad = outline ? 1 : 0;
      const w = (cols + 2 * pad) * cell, h = (7 + 2 * pad + (shadow ? 1 : 0)) * cell;
      const sp = bake(w, h, (c) => {
        const plot = (col, dx, dy) => {
          c.fillStyle = col;
          let x = pad + dx;
          for (const gl of glyphs) {
            for (let r = 0; r < 7; r++) for (let q = 0; q < 5; q++) if (gl[r][q] === "#") c.fillRect((x + q) * cell, (pad + r + dy) * cell, cell, cell);
            x += 6;
          }
        };
        if (shadow) { plot(shadow, 0, 1); if (outline) { plot(shadow, 1, 1); plot(shadow, -1, 1); plot(shadow, 0, 2); } }
        if (outline) for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]]) plot(outline, dx, dy);
        plot(fill, 0, 0);
      });
      const out = { sp, w, h };
      textCache.set(key, out);
      return out;
    }
    // Score digits: 24×36 like the original's, a body of 4 px cells with a
    // 2 px outline. Also a half-size set for the score board.
    function digitSet(cell, edge) {
      return DIGITS.map((rows) => {
        const w = 5 * cell + 2 * edge, h = 8 * cell + 2 * edge;
        return { w, h, sp: bake(w, h, (c) => {
          const plot = (col, dx, dy) => {
            c.fillStyle = col;
            for (let r = 0; r < 8; r++) for (let q = 0; q < 5; q++) if (rows[r][q] === "#") c.fillRect(edge + q * cell + dx, edge + r * cell + dy, cell, cell);
          };
          for (const [dx, dy] of [[-edge, 0], [edge, 0], [0, -edge], [0, edge], [-edge, -edge], [edge, -edge], [-edge, edge], [edge, edge]]) plot(K, dx, dy);
          plot("#ffffff", 0, 0);
        }) };
      });
    }
    const bigDigits = digitSet(4, 2), smallDigits = digitSet(2, 2);
    function drawNumber(set, n, x, y, align) {
      const s = String(Math.max(0, Math.floor(n)));
      const gap = set === bigDigits ? 2 : 1;
      let w = 0;
      for (let i = 0; i < s.length; i++) w += set[+s[i]].w + (i ? gap : 0);
      let cx = align === "center" ? Math.round(x - w / 2) : align === "right" ? x - w : x;
      for (let i = 0; i < s.length; i++) {
        const d = set[+s[i]];
        if (d.sp) g.drawImage(d.sp, cx, y);
        cx += d.w + gap;
      }
    }
    function drawText(str, cell, x, y, style, align) {
      const t = textSprite(str, cell, style.fill, style.outline, style.shadow);
      if (!t.sp) return;
      const dx = align === "center" ? Math.round(x - t.w / 2) : align === "right" ? x - t.w : x;
      g.drawImage(t.sp, dx, y);
    }
    const STYLE = {
      logo: { fill: "#ffffff", outline: K, shadow: "#f5a623" },
      title: { fill: "#f8a62a", outline: "#ffffff", shadow: K },
      label: { fill: "#e8702a", outline: null, shadow: "#f6efc5" },
      button: { fill: "#ffffff", outline: K, shadow: null },
      plain: { fill: "#ffffff", outline: K, shadow: null },
      tag: { fill: "#ffffff", outline: null, shadow: null }
    };

    // ---- the score board's pieces
    function medalSprite(kind) {
      const c1 = { bronze: "#d0894c", silver: "#dbe2e8", gold: "#f7c948", platinum: "#eef6f9" }[kind];
      const c2 = { bronze: "#8a5330", silver: "#8e9aa8", gold: "#c48d1c", platinum: "#9bb6c4" }[kind];
      return bake(44, 44, (c) => {
        const disc = (r, col) => {
          c.fillStyle = col;
          for (let dy = -r; dy <= r; dy++) {
            const half = Math.floor(Math.sqrt(r * r - dy * dy + 0.5));
            c.fillRect(22 - half * 2, 22 + dy * 2 - 2, half * 4, 2);
          }
        };
        disc(11, K); disc(10, c1); disc(8, c2); disc(7, c1);
        // a small star
        const star = [".....#.....", "....###....", "#####.#####", ".#########.", "..#######..", "...#####...", "..###.###..", ".##.....##."];
        c.fillStyle = c2;
        for (let r = 0; r < star.length; r++) for (let q = 0; q < 11; q++) if (star[r][q] === "#") c.fillRect(11 + q * 2, 14 + r * 2, 2, 2);
        c.fillStyle = "#ffffff";
        c.fillRect(12, 10, 2, 2); c.fillRect(14, 8, 2, 2);
      });
    }
    const medals = { bronze: medalSprite("bronze"), silver: medalSprite("silver"), gold: medalSprite("gold"), platinum: medalSprite("platinum") };
    function panelSprite(w, h, fill, edge, line) {
      return bake(w, h, (c) => {
        const box = (x, y, bw, bh, col) => { c.fillStyle = col; c.fillRect(x, y, bw, bh); };
        box(4, 0, w - 8, h, line); box(0, 4, w, h - 8, line); box(2, 2, w - 4, h - 4, line);
        box(4, 2, w - 8, h - 4, edge); box(2, 4, w - 4, h - 8, edge);
        box(6, 4, w - 12, h - 8, fill); box(4, 6, w - 8, h - 12, fill);
      });
    }
    const board = panelSprite(226, 116, "#ded895", "#f7f1c8", K);
    const newTag = panelSprite(32, 14, "#f45c4a", "#f45c4a", K);
    function buttonSprite(label, w, h) {
      return bake(w, h, (c) => {
        const box = (x, y, bw, bh, col) => { c.fillStyle = col; c.fillRect(x, y, bw, bh); };
        box(2, 0, w - 4, h, K); box(0, 2, w, h - 4, K);
        box(4, 2, w - 8, h - 8, "#f7b32b"); box(2, 4, w - 4, h - 12, "#f7b32b");
        box(4, h - 6, w - 8, 2, "#c67f1e"); box(2, h - 8, w - 4, 2, "#c67f1e");
        const t = textSprite(label, 2, "#ffffff", K, null);
        if (t.sp) c.drawImage(t.sp, Math.round((w - t.w) / 2), Math.round((h - 4 - t.h) / 2));
      });
    }
    const playButton = buttonSprite("PLAY", 104, 40), okButton = buttonSprite("OK", 80, 28);
    const hand = sprite([
      "....kk.....",
      "...kwwk....",
      "...kwwk....",
      "...kwwk....",
      ".kkkwwkkk..",
      "kwwkwwkwwk.",
      "kwwwwwwwwwk",
      "kwwwwwwwwwk",
      ".kwwwwwwwk.",
      "..kwwwwwk..",
      "..kkkkkkk.."
    ], { k: K, w: "#ffffff" });
    const tapBubble = panelSprite(34, 16, "#ffffff", "#ffffff", K);

    // ===================================================================
    // State
    // ===================================================================
    const KEY_BEST = "kingfisher.best.v2";
    const UI = { state: "title", best: 0, newBest: false, overT: 0, landedT: -1, flash: 0, sky: "day", plumage: "yellow", shownScore: 0 };
    let run = MODEL.newRun(1);
    let prevY = run.y, prevBob = 0, groundScroll = 0, started = false;
    const input = { flaps: 0 };
    let W = 1, H = 1, S = 1, VW = 288, VH = 512, fx = 0, fy = 0, lastW = 0, lastH = 0;

    function setState(s) {
      UI.state = s;
      canvas.setAttribute("data-state", s);
    }
    async function loadBest() {
      try {
        const v = await Promise.race([ctx.storage.get(KEY_BEST), new Promise((res) => ctx.timeout(() => res(null), 1500))]);
        if (typeof v === "number" && v > 0) UI.best = Math.floor(v);
      } catch (err) { /* no storage here */ }
    }
    function firstGesture() {
      if (started) return;
      started = true;
      initAudio();
      if (ac && ac.state === "suspended") { try { ac.resume(); } catch (err) { /* blocked */ } }
      ctx.platform.start();
    }
    const PLUMAGES = ["yellow", "blue", "red"];
    function newRun() {
      const seedValue = ((Date.now() & 0xffffff) ^ Math.floor(Math.random() * 0x7fffffff)) >>> 0;
      run = MODEL.newRun(seedValue || 1);
      prevY = run.y; prevBob = 0;
      input.flaps = 0;
      UI.newBest = false; UI.overT = 0; UI.landedT = -1; UI.flash = 0; UI.shownScore = 0;
      UI.plumage = PLUMAGES[Math.floor(rnd() * 3)];
      UI.sky = rnd() < 0.5 ? "day" : "night";
      canvas.setAttribute("data-score", "0");
    }
    function onTap() {
      if (UI.state === "title") {
        firstGesture();
        sfxSwoosh();
        newRun();
        setState("ready");
        return;
      }
      if (UI.state === "ready" || UI.state === "play") {
        firstGesture();
        input.flaps++;
        return;
      }
      if (UI.state === "over" && UI.landedT >= 0 && UI.overT - UI.landedT > 1.9) {
        sfxSwoosh();
        newRun();
        setState("ready");
      }
    }
    function onDeath(cause) {
      UI.flash = 1;
      sfxHit(); haptic("heavy");
      if (cause !== "ground") ctx.timeout(sfxDie, 120);
      UI.overT = 0; UI.landedT = run.landed ? 0 : -1;
      UI.newBest = run.score > UI.best;
      if (UI.newBest) {
        UI.best = run.score;
        fireAndForget(() => ctx.storage.set(KEY_BEST, UI.best));
        fireAndForget(() => ctx.memory.record("score").submit(UI.best, { label: UI.best + " pipes" }));
      }
      ctx.platform.fail({ score: run.score, cause, best: UI.best });
      setState("over");
    }
    let lastMedal = null;
    function onEvent(ev) {
      if (ev === "score") {
        sfxPoint(); haptic("light");
        canvas.setAttribute("data-score", String(run.score));
        ctx.platform.setScore(run.score, { score: run.score });
        const m = MODEL.medal(run.score);
        if (m && m !== lastMedal) { lastMedal = m; ctx.platform.milestone("medal_" + m, { score: run.score }); }
      } else if (ev === "die:pipe") onDeath("pipe");
      else if (ev === "die:ground") onDeath("ground");
      else if (ev === "land") { if (UI.landedT < 0) UI.landedT = UI.overT; }
    }

    // ===================================================================
    // Input: the whole screen, or space on a keyboard
    // ===================================================================
    ctx.listen(canvas, "pointerdown", (e) => {
      if (typeof e.button === "number" && e.button > 0) return;
      onTap();
    });
    ctx.listen(window, "keydown", (e) => {
      if (e.repeat) return;
      if (e.code === "Space" || e.code === "ArrowUp" || e.code === "KeyW") { e.preventDefault(); onTap(); }
    });

    // ===================================================================
    // Ticks: thirty a second, like the original, from an accumulator that
    // never spirals. Taps are queued so none is lost between frames.
    // ===================================================================
    const TICK = 1 / 30;
    let acc = 0;
    function tick() {
      if (input.flaps > 0) {
        input.flaps = 0;
        if ((UI.state === "ready" || UI.state === "play") && MODEL.flap(run)) {
          sfxWing();
          if (UI.state === "ready") {
            lastMedal = null;
            ctx.platform.interact({ kind: "start" });
            setState("play");
          }
        }
      }
      prevY = run.y; prevBob = run.bob;
      const ev = MODEL.step(run);
      if (ev) onEvent(ev);
      if (UI.state !== "over") groundScroll = (groundScroll + MODEL.SPEED) % 336;
      if (UI.state === "over") UI.overT += TICK;
      if (UI.flash > 0) UI.flash = Math.max(0, UI.flash - 0.34);
    }

    // ===================================================================
    // Drawing, in the original's 288×512 units. The scale is chosen so a
    // logical pixel is a whole number of device pixels and stays crisp.
    // ===================================================================
    function resize() {
      W = ctx.width; H = ctx.height;
      const dpr = ctx.dpr || window.devicePixelRatio || 1;
      // the runtime owns the backing store; if a resize left it behind, bring
      // it along and put back the same CSS-pixel transform it uses
      const bw = Math.round(W * dpr), bh = Math.round(H * dpr);
      if (canvas.width !== bw || canvas.height !== bh) {
        canvas.width = bw; canvas.height = bh;
        g.setTransform(dpr, 0, 0, dpr, 0, 0);
      }
      const fit = Math.min(W / MODEL.W, H / MODEL.H);
      S = Math.max(1 / dpr, Math.floor(fit * dpr) / dpr);
      if (fit * dpr < 1) S = fit;
      VW = W / S; VH = H / S;
      fx = Math.floor((VW - MODEL.W) / 2);
      fy = Math.floor((VH - MODEL.H) * 0.72);
      canvas.setAttribute("data-layout", [W, H, S.toFixed(3), fx, fy].join(","));
    }
    function drawImg(sp, x, y, w, h) {
      if (!sp) return;
      if (w === undefined) g.drawImage(sp, Math.round(x), Math.round(y));
      else g.drawImage(sp, Math.round(x), Math.round(y), w, h);
    }
    function drawPipe(px, gapY) {
      const top = -fy, capH = 26;
      // the pipe above: body from the top of the screen down to its cap
      const upperBodyH = gapY - capH - top;
      if (upperBodyH > 0) drawImg(pipeBody, px + 2, top, 48, upperBodyH);
      drawImg(pipeCap, px, gapY - capH);
      // the pipe below: cap, then body down to the ground
      drawImg(pipeCap, px, gapY + MODEL.GAP);
      const lowerBodyH = MODEL.BASE_Y - (gapY + MODEL.GAP + capH);
      if (lowerBodyH > 0) drawImg(pipeBody, px + 2, gapY + MODEL.GAP + capH, 48, lowerBodyH);
    }
    function drawBird(x, y, rotDeg, frame) {
      const sp = birdSprites[UI.plumage][frame];
      if (!sp) return;
      g.save();
      g.translate(Math.round(x) + 17, Math.round(y) + 12);
      g.rotate(-rotDeg * Math.PI / 180);
      g.drawImage(sp, -17, -12);
      g.restore();
    }
    function render(alpha) {
      g.save();
      g.imageSmoothingEnabled = false;
      g.translate(fx * S, fy * S);
      g.scale(S, S);
      const sky = SKIES[UI.sky];
      // sky beyond the frame, then the frame's backdrop tiled sideways
      g.fillStyle = sky.sky;
      g.fillRect(-fx, -fy, VW, VH);
      const bg = backgrounds[UI.sky];
      for (let x = -fx - ((-fx) % 288 + 288) % 288 - 288; x < VW - fx; x += 288) drawImg(bg, x, 0);
      // pipes, interpolated between ticks while they move
      const moving = run.started && run.alive;
      for (const p of run.pipes) {
        const px = p.x + (moving ? MODEL.SPEED * (1 - alpha) : 0);
        if (px > VW - fx || px + MODEL.PIPE_W < -fx) continue;
        drawPipe(px, p.gapY);
      }
      // the ground, scrolling, and the sand under it to the bottom of the screen
      const scroll = (groundScroll + (UI.state !== "over" ? MODEL.SPEED * alpha : 0)) % 336;
      for (let x = -fx - ((scroll + fx) % 336 + 336) % 336 - 336; x < VW - fx; x += 336) drawImg(groundSprite, x, MODEL.BASE_Y);
      g.fillStyle = "#ded895";
      g.fillRect(-fx, MODEL.BASE_Y + 112, VW, VH);
      // the bird
      const bob = run.started ? 0 : lerp(prevBob, run.bob, alpha);
      const by = run.started ? lerp(prevY, run.y, alpha) : run.y + bob;
      const rot = run.started ? MODEL.visibleRot(run) : 0;
      if (UI.state === "title") {
        // beside the name, flapping in place
        const t = textSprite("KINGFISHER", 3, STYLE.logo.fill, STYLE.logo.outline, STYLE.logo.shadow);
        const total = t.w + 10 + MODEL.BIRD_W;
        const x0 = Math.round((MODEL.W - total) / 2);
        drawImg(t.sp, x0, 118);
        drawBird(x0 + t.w + 10, 118 + Math.round((t.h - MODEL.BIRD_H) / 2) + bob, 0, run.wing);
        drawImg(playButton, (MODEL.W - 104) / 2, 330);
        if (UI.best > 0) drawText("BEST " + UI.best, 2, MODEL.W / 2, 386, STYLE.plain, "center");
      } else {
        drawBird(MODEL.BIRD_X, by, rot, run.alive ? run.wing : 1);
      }
      // chrome by state
      if (UI.state === "ready") {
        drawNumber(bigDigits, run.score, MODEL.W / 2, 40, "center");
        drawText("GET READY!", 4, MODEL.W / 2, 130, STYLE.title, "center");
        // the tap hint, to the right of the bird: a hand and two taps
        const hx = MODEL.W / 2 + 22;
        drawImg(hand, hx - 11, 262);
        const tapAt = (x, y) => { drawImg(tapBubble, x, y); drawText("TAP", 1, x + 17, y + 5, STYLE.plain, "center"); };
        tapAt(hx - 62, 246); tapAt(hx + 28, 246);
        drawText("TAP TO FLY", 1, MODEL.W / 2, 300, STYLE.plain, "center");
      } else if (UI.state === "play") {
        drawNumber(bigDigits, run.score, MODEL.W / 2, 40, "center");
      } else if (UI.state === "over") {
        drawOver();
      }
      if (UI.flash > 0) {
        g.fillStyle = "rgba(255,255,255," + UI.flash.toFixed(2) + ")";
        g.fillRect(-fx, -fy, VW, VH);
      }
      g.restore();
    }
    function drawOver() {
      if (UI.landedT < 0) { drawNumber(bigDigits, run.score, MODEL.W / 2, 40, "center"); return; }
      const t = UI.overT - UI.landedT;
      // "GAME OVER" drops in
      const t1 = clamp(t / 0.35, 0, 1);
      drawText("GAME OVER", 4, MODEL.W / 2, Math.round(lerp(60, 128, easeOut(t1))), STYLE.title, "center");
      // the board slides up from below the screen
      const t2 = clamp((t - 0.5) / 0.45, 0, 1);
      if (t2 <= 0) return;
      const bx = (MODEL.W - 226) / 2, byy = Math.round(lerp(VH - fy + 10, 186, easeOut(t2)));
      drawImg(board, bx, byy);
      drawText("SCORE", 2, bx + 206, byy + 14, STYLE.label, "right");
      drawText("BEST", 2, bx + 206, byy + 64, STYLE.label, "right");
      drawText("MEDAL", 2, bx + 48, byy + 14, STYLE.label, "center");
      // the score counts up once the board has settled
      const t3 = clamp((t - 1.0) / 0.5, 0, 1);
      const shown = t2 >= 1 ? Math.round(run.score * t3) : 0;
      drawNumber(smallDigits, shown, bx + 206, byy + 32, "right");
      drawNumber(smallDigits, UI.best, bx + 206, byy + 82, "right");
      if (t3 >= 1) {
        const m = MODEL.medal(run.score);
        if (m) drawImg(medals[m], bx + 26, byy + 42);
        if (UI.newBest) { drawImg(newTag, bx + 130, byy + 66); drawText("NEW", 1, bx + 146, byy + 70, STYLE.tag, "center"); }
      }
      if (t > 1.9) drawImg(okButton, (MODEL.W - 80) / 2, 330);
    }

    // ===================================================================
    // Frame and boot
    // ===================================================================
    ctx.onFrame((dtMs) => {
      const dt = clamp(dtMs / 1000, 0.001, 0.25);
      if (ctx.width !== lastW || ctx.height !== lastH) { lastW = ctx.width; lastH = ctx.height; resize(); }
      acc += dt;
      while (acc >= TICK) { acc -= TICK; tick(); }
      render(clamp(acc / TICK, 0, 1));
    });

    await loadBest();
    newRun();
    setState("title");
    lastW = ctx.width; lastH = ctx.height;
    resize();
    render(0);
    ctx.markVisualReady("first frame");
    ctx.platform.ready();
  }
};
