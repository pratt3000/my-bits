// Whirligig -- a mobile-first Plethora Bit.
//
// A paper disc packed with hundreds of concentric-ring discs, all meshed into
// one machine. Flick it and the whole plate spins; every packed disc rolls
// against the discs it touches, and the small circles nested inside the big
// ones orbit their hosts while spinning on their own axes. The plate itself
// is a flat plane in 3D that precesses about two more axes, so the assembly
// turns on several axes at once.
//
// The motion is a real rolling-contact gear train, not decoration:
//
//   external mesh (two discs touching side by side)
//     omega_b = -omega_a * (r_a / r_b)
//   internal mesh (a disc rolling inside its host's rim)
//     omega_child = +omega_host * (r_host / r_child)
//
// Rates are solved once at build time by breadth-first search over the
// tangency graph, rooted at the largest disc, which the plate's rim drives.
// Every rate is stored per unit of plate speed, so one flick drives the
// entire train and the ratios hold at any speed.

window.plethoraBit = {
  meta: {
    title: "Whirligig",
    runtime: "plethora-bit@2",
    tags: ["fidget", "generative", "art", "sensory", "toy", "kinetic"],
    permissions: ["haptics", "backgroundMusic"]
  },

  async init(ctx) {
    const TAU = Math.PI * 2;
    const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

    // Palette sampled from the reference artwork: primary red/blue/gold on a
    // speckled cream plate, with near-black ink for spokes and hubs.
    const C = {
      bg: "#141317",
      paper: "#F2EDE1",
      paperDark: "#E4DCCA",
      white: "#FCF8F0",
      cream: "#EFDCB0",
      yellow: "#F5B72B",
      red: "#E23B36",
      blue: "#2F6AD0",
      ink: "#26221F",
      hub: "#17161B"
    };
    const FILLS = [C.white, C.cream, C.yellow, C.red, C.blue];
    // Large discs lean saturated the way the reference's big forms do.
    const BOLD = [C.red, C.red, C.blue, C.blue, C.yellow, C.yellow, C.white, C.cream];

    const MAX_OMEGA = 15.5;   // rad/s ceiling for the plate
    const IDLE_OMEGA = 0.26;  // the plate never fully dies; it drifts
    const SPIN_UP = 6.0;      // rad/s that counts as "really going"

    // ---- deterministic noise -------------------------------------------
    function makeRng(seed) {
      let a = seed >>> 0;
      return function () {
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    }

    // ---- surfaces --------------------------------------------------------
    const canvas = ctx.createCanvas2D({ touchAction: "none" });
    const g = canvas.getContext("2d");
    const ui = ctx.createRoot({ touchAction: "none" });
    ui.style.pointerEvents = "none";

    // =====================================================================
    // BUILD: pack the plate, then solve the gear train
    // =====================================================================

    // Greedy circle packing in the unit disc. Each new disc grows until it
    // touches its nearest neighbour or the rim, which is what makes the
    // tangency graph dense enough to behave like a real gear train.
    function packPlate(rng) {
      const RIM = 0.935;
      const R_MIN = 0.022;
      const TRIES = 9000;
      const discs = [];

      // Anchor disc, slightly off-centre like the reference composition.
      discs.push({
        x: (rng() - 0.5) * 0.20,
        y: (rng() - 0.5) * 0.20,
        r: 0.235 + rng() * 0.045
      });

      for (let i = 0; i < TRIES; i++) {
        const t = i / TRIES;
        // Allowed radius shrinks over the run: a few big discs first, then
        // progressively finer ones filling the interstices.
        const rMax = 0.185 * (1 - t) * (1 - t) + 0.048;

        const a = rng() * TAU;
        const rad = Math.sqrt(rng()) * RIM;
        const x = Math.cos(a) * rad;
        const y = Math.sin(a) * rad;

        let best = Math.min(rMax, RIM - Math.hypot(x, y));
        if (best >= R_MIN) {
          for (let j = 0; j < discs.length; j++) {
            const d = discs[j];
            const gap = Math.hypot(x - d.x, y - d.y) - d.r;
            if (gap < best) best = gap;
            if (best < R_MIN) break;
          }
        }
        if (best >= R_MIN) discs.push({ x, y, r: best });
      }
      return discs;
    }

    // Two discs mesh when their centres sit a hair from r_a + r_b apart.
    function buildContacts(discs) {
      const adj = discs.map(() => []);
      for (let i = 0; i < discs.length; i++) {
        const a = discs[i];
        for (let j = i + 1; j < discs.length; j++) {
          const b = discs[j];
          const sum = a.r + b.r;
          const dx = a.x - b.x;
          const dy = a.y - b.y;
          if (Math.abs(dx) > sum * 1.1 || Math.abs(dy) > sum * 1.1) continue;
          const d = Math.hypot(dx, dy);
          if (Math.abs(d - sum) <= sum * 0.045 + 0.0035) {
            adj[i].push(j);
            adj[j].push(i);
          }
        }
      }
      return adj;
    }

    // Solve spin rates by BFS over the tangency graph. The plate's rim drives
    // the largest disc through internal contact; every mesh after that flips
    // sign and scales by the inverse radius ratio, exactly as gears do.
    function solveRates(discs, adj) {
      const rate = new Float64Array(discs.length);
      const seen = new Uint8Array(discs.length);

      let root = 0;
      for (let i = 1; i < discs.length; i++) {
        if (discs[i].r > discs[root].r) root = i;
      }

      const queue = [root];
      rate[root] = 1 / discs[root].r; // internal drive from the rim (R = 1)
      seen[root] = 1;

      for (let head = 0; head < queue.length; head++) {
        const i = queue[head];
        const neighbours = adj[i];
        for (let k = 0; k < neighbours.length; k++) {
          const j = neighbours[k];
          if (seen[j]) continue;
          seen[j] = 1;
          rate[j] = -rate[i] * (discs[i].r / discs[j].r);
          queue.push(j);
        }
      }

      // Discs that touch nothing still ride the plate; drive them off the rim.
      for (let i = 0; i < discs.length; i++) {
        if (!seen[i]) rate[i] = (i % 2 ? -1 : 1) / discs[i].r;
      }

      // Exact ratios span three orders of magnitude, which reads as noise once
      // the plate is moving. Compress magnitudes toward the median while
      // keeping every sign and the strict big-slow / small-fast ordering.
      const mags = Array.from(rate, Math.abs).sort((a, b) => a - b);
      const median = mags[mags.length >> 1] || 1;
      for (let i = 0; i < rate.length; i++) {
        const norm = Math.abs(rate[i]) / median;
        const squashed = Math.pow(norm, 0.62);
        rate[i] = Math.sign(rate[i]) * Math.min(squashed, 4.6);
      }
      return rate;
    }

    // Concentric-ring livery for one disc, in the reference's idiom: a filled
    // outer disc, one to three contrasting rings, an ink hub and a spoke.
    function makeLivery(r, rng) {
      const rings = [];
      // Outline-only discs stay small: a large one reads as a hole in the
      // plate rather than as a drawn ring.
      const outlineOnly = rng() < 0.13 && r > 0.030 && r < 0.095;

      if (outlineOnly) {
        rings.push({ k: 1, color: C.ink, stroke: true, w: 1.2 });
        if (rng() < 0.7) {
          rings.push({ k: 0.4 + rng() * 0.25, color: C.ink, stroke: true, w: 1 });
        }
      } else {
        const outer = r > 0.085 ? BOLD : FILLS;
        let prev = outer[(rng() * outer.length) | 0];
        rings.push({ k: 1, color: prev, stroke: false });

        // Bigger discs carry more rings, matching the reference's hierarchy.
        const count = r > 0.11 ? 2 + ((rng() * 2) | 0) : r > 0.055 ? 1 + ((rng() * 2) | 0) : rng() < 0.62 ? 1 : 0;
        let k = 1;
        for (let i = 0; i < count; i++) {
          k *= 0.42 + rng() * 0.25;
          if (k < 0.16) break;
          // Paper occasionally shows through, turning the disc into an annulus.
          const pool = rng() < 0.16 ? [C.paper] : FILLS.filter(c => c !== prev);
          const color = pool[(rng() * pool.length) | 0];
          rings.push({ k, color, stroke: false });
          prev = color;
        }
      }

      return {
        rings,
        hub: r > 0.026 ? clamp(0.1 + rng() * 0.07, 0.06, 0.2) : 0,
        spoke: r > 0.022,
        rimInk: !outlineOnly && rng() < 0.55
      };
    }

    // Small discs nested inside a host. Their centres live in the host's
    // rotating frame, so they orbit as it turns; internal rolling contact
    // gives them their own, faster spin on top of that orbit.
    function makePlanets(host, rate, rng) {
      if (host.r < 0.075) return [];
      const n = rng() < 0.45 ? 1 : rng() < 0.8 ? 2 : 3;
      const out = [];
      for (let i = 0; i < n; i++) {
        const pr = host.r * (0.13 + rng() * 0.16);
        const d = host.r * (0.42 + rng() * 0.38);
        if (d + pr > host.r * 0.94) continue;
        const a = rng() * TAU;
        const livery = makeLivery(pr, rng);
        out.push({
          x: Math.cos(a) * d,
          y: Math.sin(a) * d,
          r: pr,
          // internal contact with the host rim: same sign, inverse ratio
          rate: rate * (host.r / pr) * 0.5,
          spin: rng() * TAU,
          livery,
          planets: []
        });
      }
      return out;
    }

    function buildAssembly(seed) {
      const rng = makeRng(seed);
      const discs = packPlate(rng);
      const adj = buildContacts(discs);
      const rates = solveRates(discs, adj);

      // Draw order: largest first so the fine discs stay legible on top.
      const order = discs.map((d, i) => i).sort((a, b) => discs[b].r - discs[a].r);

      const gears = order.map(i => {
        const d = discs[i];
        const livery = makeLivery(d.r, rng);
        return {
          x: d.x,
          y: d.y,
          r: d.r,
          rate: rates[i],
          spin: rng() * TAU,
          livery,
          planets: makePlanets(d, rates[i], rng)
        };
      });

      // Free-floating draughtsman's rings, drawn over everything.
      const overlays = [];
      for (let i = 0; i < 7; i++) {
        const a = rng() * TAU;
        const d = Math.sqrt(rng()) * 0.72;
        const r = 0.05 + rng() * 0.1;
        overlays.push({
          x: Math.cos(a) * d,
          y: Math.sin(a) * d,
          r,
          rate: (rng() < 0.5 ? -1 : 1) * (0.25 + rng() * 0.9),
          spin: rng() * TAU,
          livery: {
            rings: [{ k: 1, color: C.ink, stroke: true, w: 0.9 }],
            hub: 0.03,
            spoke: false,
            rimInk: false
          },
          planets: []
        });
      }

      let count = gears.length + overlays.length;
      for (const gear of gears) count += gear.planets.length;

      return { gears, overlays, count, contacts: adj.reduce((n, a) => n + a.length, 0) / 2 };
    }

    let seed = (Math.random() * 0xffffffff) >>> 0;
    let assembly = buildAssembly(seed);

    // =====================================================================
    // PLATE TEXTURE
    // =====================================================================

    // Speckled paper, pre-rendered once in plate-local space so it turns with
    // the plate and reads as a real rotating object rather than a flat fill.
    let paper = null;
    let paperSize = 0;

    function makePaper(px) {
      const size = clamp(Math.round(px * 2), 128, 1024);
      if (paper && paperSize === size) return;
      const c =
        typeof OffscreenCanvas === "function"
          ? new OffscreenCanvas(size, size)
          : Object.assign(document.createElement("canvas"), { width: size, height: size });
      c.width = size;
      c.height = size;
      const p = c.getContext("2d");
      const h = size / 2;

      p.fillStyle = C.paper;
      p.beginPath();
      p.arc(h, h, h, 0, TAU);
      p.fill();

      const rng = makeRng(0x9e3779b9);
      p.globalAlpha = 0.5;
      const flecks = Math.round(size * 3.2);
      for (let i = 0; i < flecks; i++) {
        const a = rng() * TAU;
        const d = Math.sqrt(rng()) * h;
        const x = h + Math.cos(a) * d;
        const y = h + Math.sin(a) * d;
        p.fillStyle = rng() < 0.62 ? C.paperDark : "#CFC3A9";
        p.beginPath();
        p.arc(x, y, rng() * (size / 900) + size / 1400, 0, TAU);
        p.fill();
      }
      p.globalAlpha = 1;

      // Faint inner shading so the plate reads as a physical object.
      const grad = p.createRadialGradient(h * 0.82, h * 0.78, h * 0.1, h, h, h);
      grad.addColorStop(0, "rgba(255,255,255,0.35)");
      grad.addColorStop(0.72, "rgba(255,255,255,0)");
      grad.addColorStop(1, "rgba(120,104,80,0.16)");
      p.fillStyle = grad;
      p.beginPath();
      p.arc(h, h, h, 0, TAU);
      p.fill();

      paper = c;
      paperSize = size;
    }

    // =====================================================================
    // STATE
    // =====================================================================

    let theta = 0;          // plate angle about its own axis
    let omega = 1.15;       // rad/s -- alive on the very first frame
    let tiltA = 0;          // extra precession from a flick, decays
    let peakRpm = 0;
    let started = false;
    let dragging = false;
    let dragId = null;
    let dragAngle = 0;      // pointer angle at grab, relative to theta
    let lastMoveAt = 0;
    let pointerOmega = 0;
    let tickAcc = 0;
    let lastTickAt = 0;
    let lastStingAt = 0;
    let lastMusicAt = 0;
    let wasFast = false;
    let music = null;
    let detail = 1;         // adaptive quality, 1 = full
    let frameCost = 16;

    const layout = { cx: 0, cy: 0, R: 1 };

    function relayout() {
      const top = (ctx.safeArea?.top || 0) + 58;
      const bottom = (ctx.safeArea?.bottom || 0) + 30;
      const band = Math.max(80, ctx.height - top - bottom);
      layout.cx = ctx.width / 2;
      layout.cy = top + band / 2;
      layout.R = Math.min(ctx.width * 0.465, band * 0.475);
      makePaper(layout.R * (ctx.dpr || 1));
    }
    relayout();

    // =====================================================================
    // RENDER
    // =====================================================================

    // 2x3 affine helper. A matrix {a,b,c,d,e,f} maps (u,v) to
    // (a*u + c*v + e, b*u + d*v + f).
    function chain(p, cos, sin, tx, ty) {
      return {
        a: p.a * cos + p.c * sin,
        b: p.b * cos + p.d * sin,
        c: -p.a * sin + p.c * cos,
        d: -p.b * sin + p.d * cos,
        e: p.a * tx + p.c * ty + p.e,
        f: p.b * tx + p.d * ty + p.f
      };
    }

    function drawGear(gear, parent, R, spokeAlpha, depth) {
      const cos = Math.cos(gear.spin);
      const sin = Math.sin(gear.spin);
      const frame = chain(parent, cos, sin, gear.x, gear.y);

      const r = gear.r;
      const m = {
        a: frame.a * r,
        b: frame.b * r,
        c: frame.c * r,
        d: frame.d * r,
        e: frame.e,
        f: frame.f
      };

      // Screen radius along the major axis, for culling and detail decisions.
      const screenR = Math.max(Math.hypot(m.a, m.b), Math.hypot(m.c, m.d));
      if (screenR < 0.8) return;

      g.setTransform(m.a, m.b, m.c, m.d, m.e, m.f);
      const unit = 1 / (r * R); // one CSS pixel, in this gear's local units

      const rings = gear.livery.rings;
      const thin = screenR < 9 * (ctx.dpr || 1);
      for (let i = 0; i < rings.length; i++) {
        const ring = rings[i];
        if (i > 0 && thin && detail < 1) break;
        g.beginPath();
        g.arc(0, 0, ring.k, 0, TAU);
        if (ring.stroke) {
          g.strokeStyle = ring.color;
          g.lineWidth = (ring.w || 1) * unit;
          g.stroke();
        } else {
          g.fillStyle = ring.color;
          g.fill();
        }
      }

      if (gear.livery.rimInk && screenR > 7) {
        g.beginPath();
        g.arc(0, 0, 1, 0, TAU);
        g.strokeStyle = "rgba(38,34,31,0.5)";
        g.lineWidth = 0.9 * unit;
        g.stroke();
      }

      // The spoke is the only cue to a disc's phase, so it fades out as the
      // machine speeds up -- the same way real spokes blur away.
      if (gear.livery.spoke && spokeAlpha > 0.02 && screenR > 4) {
        g.beginPath();
        g.moveTo(0, 0);
        g.lineTo(0.97, 0);
        g.strokeStyle = C.ink;
        g.globalAlpha = spokeAlpha;
        g.lineWidth = 1.05 * unit;
        g.stroke();
        g.globalAlpha = 1;
      }

      if (gear.livery.hub > 0 && screenR > 3) {
        g.beginPath();
        g.arc(0, 0, gear.livery.hub, 0, TAU);
        g.fillStyle = C.hub;
        g.fill();
      }

      // Nested discs ride the host's frame, so they orbit as it turns.
      if (depth < 2 && gear.planets.length && screenR > 12) {
        for (let i = 0; i < gear.planets.length; i++) {
          drawGear(gear.planets[i], frame, R, spokeAlpha, depth + 1);
        }
      }
    }

    function render(timeMs) {
      const S = ctx.dpr || 1;
      const R = layout.R;
      const speed = Math.abs(omega);
      const n = clamp(speed / MAX_OMEGA, 0, 1);

      g.setTransform(S, 0, 0, S, 0, 0);
      g.fillStyle = C.bg;
      g.fillRect(0, 0, ctx.width, ctx.height);

      // Multi-axis precession. A fast plate stands up gyroscopically; a slow
      // one leans and wanders, like a coin settling.
      const t = timeMs / 1000;
      const wob = 0.44 * (1 - 0.70 * n) + tiltA;
      const ax = wob * Math.sin(t * 0.31);
      const ay = wob * Math.sin(t * 0.19 + 1.1);

      // Orthographic projection of the plate's plane: an in-plane vector
      // (u, v) lands at (u*cos(ay) + v*sin(ax)*sin(ay), v*cos(ax)).
      const P = {
        a: Math.cos(ay),
        b: 0,
        c: Math.sin(ax) * Math.sin(ay),
        d: Math.cos(ax)
      };

      const screen = {
        a: S * P.a,
        b: S * P.b,
        c: S * P.c,
        d: S * P.d,
        e: S * layout.cx,
        f: S * layout.cy
      };

      // Soft contact shadow under the plate.
      g.setTransform(S, 0, 0, S, 0, 0);
      const sh = g.createRadialGradient(
        layout.cx, layout.cy + R * 0.06, R * 0.55,
        layout.cx, layout.cy + R * 0.06, R * 1.22
      );
      sh.addColorStop(0, "rgba(0,0,0,0.55)");
      sh.addColorStop(1, "rgba(0,0,0,0)");
      g.fillStyle = sh;
      g.fillRect(0, 0, ctx.width, ctx.height);

      const plate = chain(screen, Math.cos(theta), Math.sin(theta), 0, 0);
      const plateM = {
        a: plate.a * R, b: plate.b * R,
        c: plate.c * R, d: plate.d * R,
        e: plate.e, f: plate.f
      };

      // Paper, drawn in plate-local space so the speckle turns with it.
      if (paper) {
        g.setTransform(plateM.a, plateM.b, plateM.c, plateM.d, plateM.e, plateM.f);
        g.drawImage(paper, -1, -1, 2, 2);
      }

      const spokeAlpha = clamp(0.9 / (1 + speed * 0.42), 0, 0.85);

      for (let i = 0; i < assembly.gears.length; i++) {
        drawGear(assembly.gears[i], plateM, R, spokeAlpha, 0);
      }

      g.globalAlpha = 0.34;
      for (let i = 0; i < assembly.overlays.length; i++) {
        drawGear(assembly.overlays[i], plateM, R, spokeAlpha * 0.8, 0);
      }
      g.globalAlpha = 1;

      // Plate edge.
      g.setTransform(plateM.a, plateM.b, plateM.c, plateM.d, plateM.e, plateM.f);
      g.beginPath();
      g.arc(0, 0, 1, 0, TAU);
      g.strokeStyle = "rgba(38,34,31,0.28)";
      g.lineWidth = 1.4 / R;
      g.stroke();

      g.setTransform(S, 0, 0, S, 0, 0);
    }

    // =====================================================================
    // AUDIO
    // =====================================================================

    async function startAudio() {
      if (music || !ctx.capabilities?.backgroundMusic) return;
      try {
        await ctx.music.unlock();
        music = await ctx.music.play({
          preset: "drift",
          volume: 0.42,
          tempo: 68,
          intensity: 0.26,
          density: 0.4,
          scale: "minorPentatonic",
          fadeInMs: 1400
        });
      } catch (err) {
        music = null;
      }
    }

    // The bed tracks the machine: faster plate, faster and denser music.
    function updateAudio(nowMs) {
      if (!music || nowMs - lastMusicAt < 240) return;
      lastMusicAt = nowMs;
      const n = clamp(Math.abs(omega) / MAX_OMEGA, 0, 1);
      try {
        ctx.music.setTempo(66 + n * 54);
        ctx.music.setIntensity(0.22 + n * 0.66);
        ctx.music.setVolume(0.36 + n * 0.24);
      } catch (err) {
        /* host paused or not ready; ignore */
      }
    }

    function sting(name, nowMs, gap) {
      if (!music || nowMs - lastStingAt < gap) return;
      lastStingAt = nowMs;
      try {
        ctx.music.sting(name);
      } catch (err) {
        /* ignore */
      }
    }

    function haptic(kind) {
      if (!ctx.capabilities?.haptics) return;
      try {
        ctx.platform.haptic(kind);
      } catch (err) {
        /* ignore */
      }
    }

    // =====================================================================
    // UI
    // =====================================================================

    const style = document.createElement("style");
    style.textContent = [
      ".wg-bar{position:absolute;left:0;right:0;display:flex;align-items:center;",
      "justify-content:space-between;gap:8px;padding:0 14px;box-sizing:border-box;",
      "font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;}",
      ".wg-read{color:#EFDCB0;font-size:12px;letter-spacing:.14em;text-transform:uppercase;",
      "opacity:.85;text-shadow:0 1px 3px rgba(0,0,0,.6);white-space:nowrap;}",
      ".wg-read b{color:#F5B72B;font-weight:600;}",
      ".wg-btns{display:flex;gap:8px;pointer-events:auto;}",
      ".wg-btn{width:34px;height:34px;border-radius:50%;border:1px solid rgba(239,220,176,.32);",
      "background:rgba(28,26,30,.72);color:#EFDCB0;font-size:15px;line-height:1;cursor:pointer;",
      "display:flex;align-items:center;justify-content:center;padding:0;",
      "-webkit-tap-highlight-color:transparent;font-family:inherit;}",
      ".wg-btn:active{background:rgba(245,183,43,.28);}",
      ".wg-panel{position:absolute;left:16px;right:16px;border-radius:16px;padding:16px 18px;",
      "background:rgba(20,19,23,.94);border:1px solid rgba(239,220,176,.22);color:#F2EDE1;",
      "font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:13px;",
      "line-height:1.55;pointer-events:auto;display:none;box-shadow:0 12px 40px rgba(0,0,0,.55);}",
      ".wg-panel.on{display:block;}",
      ".wg-panel h2{margin:0 0 8px;font-size:13px;letter-spacing:.16em;text-transform:uppercase;color:#F5B72B;}",
      ".wg-panel ul{margin:0;padding-left:17px;}",
      ".wg-panel li{margin:5px 0;}",
      ".wg-hint{position:absolute;left:0;right:0;text-align:center;color:#EFDCB0;opacity:.62;",
      "font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px;",
      "letter-spacing:.18em;text-transform:uppercase;transition:opacity .5s;",
      "text-shadow:0 1px 3px rgba(0,0,0,.6);}"
    ].join("");
    ui.appendChild(style);

    const bar = document.createElement("div");
    bar.className = "wg-bar";
    bar.style.top = ((ctx.safeArea?.top || 0) + 12) + "px";

    const readout = document.createElement("div");
    readout.className = "wg-read";
    readout.innerHTML = "<b>0</b> rpm";

    const btns = document.createElement("div");
    btns.className = "wg-btns";

    const shuffleBtn = document.createElement("button");
    shuffleBtn.className = "wg-btn";
    shuffleBtn.type = "button";
    shuffleBtn.textContent = "\u21bb";
    shuffleBtn.setAttribute("aria-label", "New arrangement");

    const helpBtn = document.createElement("button");
    helpBtn.className = "wg-btn";
    helpBtn.type = "button";
    helpBtn.textContent = "?";
    helpBtn.setAttribute("aria-label", "How it works");

    btns.appendChild(shuffleBtn);
    btns.appendChild(helpBtn);
    bar.appendChild(readout);
    bar.appendChild(btns);
    ui.appendChild(bar);

    const panel = document.createElement("div");
    panel.className = "wg-panel";
    panel.style.top = ((ctx.safeArea?.top || 0) + 56) + "px";
    panel.innerHTML = [
      "<h2>Whirligig</h2>",
      "<ul>",
      "<li>Drag anywhere to turn the plate; flick and let go to send it.</li>",
      "<li>Every disc touching another rolls against it, so they turn opposite ways at inverse-radius speeds.</li>",
      "<li>Small discs nested inside big ones orbit their host and spin at the same time.</li>",
      "<li>The plate leans and wanders as it slows, and stands up when it is really going.</li>",
      "<li>Spokes fade out at speed and sharpen as it settles.</li>",
      "<li>\u21bb packs a brand-new machine.</li>",
      "</ul>"
    ].join("");
    ui.appendChild(panel);

    const hint = document.createElement("div");
    hint.className = "wg-hint";
    hint.style.bottom = ((ctx.safeArea?.bottom || 0) + 18) + "px";
    hint.textContent = "flick to spin";
    ui.appendChild(hint);

    function placeUi() {
      bar.style.top = ((ctx.safeArea?.top || 0) + 12) + "px";
      panel.style.top = ((ctx.safeArea?.top || 0) + 56) + "px";
      hint.style.bottom = ((ctx.safeArea?.bottom || 0) + 18) + "px";
    }

    ctx.listen(helpBtn, "click", () => {
      panel.classList.toggle("on");
      haptic("light");
      ctx.platform.interact({ type: "help" });
    });

    ctx.listen(shuffleBtn, "click", () => {
      seed = (Math.random() * 0xffffffff) >>> 0;
      assembly = buildAssembly(seed);
      omega = Math.max(Math.abs(omega), 3.4) * (omega < 0 ? -1 : 1);
      haptic("medium");
      sting("powerup", performance.now(), 260);
      ctx.platform.interact({ type: "shuffle", parts: assembly.count });
      ctx.platform.emit("rebuild", { parts: assembly.count, contacts: assembly.contacts });
    });

    // =====================================================================
    // INPUT
    // =====================================================================

    function angleAt(clientX, clientY) {
      const rect = canvas.getBoundingClientRect();
      return Math.atan2(
        clientY - rect.top - layout.cy,
        clientX - rect.left - layout.cx
      );
    }

    function firstGesture() {
      if (started) return;
      started = true;
      ctx.platform.start();
      startAudio();
      hint.style.opacity = "0";
    }

    ctx.listen(canvas, "pointerdown", ev => {
      if (dragging) return;
      ev.preventDefault();
      firstGesture();
      dragging = true;
      dragId = ev.pointerId;
      dragAngle = angleAt(ev.clientX, ev.clientY) - theta;
      pointerOmega = 0;
      lastMoveAt = performance.now();
      if (canvas.setPointerCapture) {
        try { canvas.setPointerCapture(ev.pointerId); } catch (err) { /* ignore */ }
      }
      haptic("light");
    }, { passive: false });

    ctx.listen(canvas, "pointermove", ev => {
      if (!dragging || ev.pointerId !== dragId) return;
      ev.preventDefault();
      const now = performance.now();
      const dt = Math.max(1, now - lastMoveAt) / 1000;
      lastMoveAt = now;

      const target = angleAt(ev.clientX, ev.clientY) - dragAngle;
      // Shortest-arc delta so crossing +/-pi does not fling the plate.
      let delta = target - theta;
      while (delta > Math.PI) delta -= TAU;
      while (delta < -Math.PI) delta += TAU;

      theta += delta;
      const inst = clamp(delta / dt, -MAX_OMEGA * 1.6, MAX_OMEGA * 1.6);
      pointerOmega = pointerOmega * 0.6 + inst * 0.4;
      omega = pointerOmega;
      ctx.platform.interact({ type: "drag" });
    }, { passive: false });

    function release(ev) {
      if (!dragging || (ev && ev.pointerId !== dragId)) return;
      dragging = false;
      dragId = null;
      const now = performance.now();
      // A stalled finger means "hold", not "throw".
      if (now - lastMoveAt > 130) pointerOmega *= 0.25;
      omega = clamp(pointerOmega, -MAX_OMEGA, MAX_OMEGA);

      const speed = Math.abs(omega);
      if (speed > 1.2) {
        tiltA = Math.min(0.16, tiltA + speed * 0.006);
        haptic(speed > SPIN_UP ? "medium" : "light");
        sting("tap", now, 200);
        ctx.platform.interact({ type: "flick", rpm: Math.round((speed / TAU) * 60) });
      }
    }

    ctx.listen(canvas, "pointerup", release);
    ctx.listen(canvas, "pointercancel", release);
    ctx.listen(canvas, "lostpointercapture", release);

    // =====================================================================
    // FRAME
    // =====================================================================

    let lastW = ctx.width;
    let lastH = ctx.height;

    ctx.onFrame((dtMs, timeMs) => {
      const t0 = performance.now();
      const dt = clamp(dtMs, 0, 64) / 1000;

      if (ctx.width !== lastW || ctx.height !== lastH) {
        lastW = ctx.width;
        lastH = ctx.height;
        relayout();
        placeUi();
      }

      if (!dragging) {
        // Bearing drag (viscous) plus a small constant loss, so the plate
        // coasts for a long time but still settles.
        omega *= Math.exp(-0.085 * dt);
        const drag = 0.34 * dt;
        if (Math.abs(omega) > drag) omega -= Math.sign(omega) * drag;
        else omega = 0;

        // It never dies completely; the machine keeps breathing.
        const idle = omega < 0 ? -IDLE_OMEGA : IDLE_OMEGA;
        if (Math.abs(omega) < IDLE_OMEGA) omega += (idle - omega) * Math.min(1, dt * 0.6);

        theta += omega * dt;
      }

      tiltA *= Math.exp(-0.9 * dt);

      // Advance every disc by its own solved rate.
      const step = omega * dt;
      for (let i = 0; i < assembly.gears.length; i++) {
        const gear = assembly.gears[i];
        gear.spin += gear.rate * step;
        for (let j = 0; j < gear.planets.length; j++) {
          gear.planets[j].spin += gear.planets[j].rate * step;
        }
      }
      for (let i = 0; i < assembly.overlays.length; i++) {
        assembly.overlays[i].spin += assembly.overlays[i].rate * step;
      }

      render(timeMs);

      // Readout + milestones.
      const rpm = Math.abs(omega) / TAU * 60;
      if (rpm > peakRpm) peakRpm = rpm;
      readout.innerHTML =
        "<b>" + Math.round(rpm) + "</b> rpm &nbsp;&middot;&nbsp; peak <b>" +
        Math.round(peakRpm) + "</b>";

      const fast = Math.abs(omega) > SPIN_UP;
      if (fast && !wasFast) {
        sting("powerup", timeMs, 700);
        ctx.platform.milestone("spun_up", { rpm: Math.round(rpm) });
      }
      wasFast = fast;

      // A soft ratchet tick every quarter turn, rate-limited so it stays a
      // texture rather than a buzz.
      tickAcc += Math.abs(omega) * dt;
      if (tickAcc > Math.PI / 2) {
        tickAcc = 0;
        if (timeMs - lastTickAt > 95 && Math.abs(omega) > 0.7) {
          lastTickAt = timeMs;
          haptic("light");
        }
      }

      updateAudio(timeMs);

      // Adaptive detail: drop the inner rings on tiny discs if we are slow.
      frameCost = frameCost * 0.9 + (performance.now() - t0) * 0.1;
      detail = frameCost > 21 ? 0 : 1;
    });

    // First frame before ready(), so the bit is never blank.
    render(0);
    ctx.markVisualReady("first-plate");
    ctx.platform.ready({ parts: assembly.count });
  }
};
