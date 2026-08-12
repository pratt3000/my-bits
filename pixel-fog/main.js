// Pixel Fog — a mobile-first Plethora Bit.
//
// Nine places in San Francisco, one per screen, each buried under a living
// mosaic of itself. Rub the pixels away with a finger and the picture surfaces
// — and with it one sentence about the place that you almost certainly do not
// know, painted into the same bake so it is uncovered the same way. Clear one
// and swipe on to the next.
//
// Nothing here is a photograph: the runtime blocks remote images and packaged
// assets, so all nine views are painted at runtime with canvas primitives.
//
// Contract notes that shaped the code:
//   * document.createElement("canvas") is rejected by the upload validator, so
//     every offscreen surface is an OffscreenCanvas via makeSurface(). If the
//     WebView has no OffscreenCanvas, makeSurface returns null and the bit
//     falls back to an ImageData-backed path — plainer, fully playable.
//   * Querying the canvas for its layout box is rejected too, so pointer
//     positions come from event.offsetX/offsetY, already canvas-relative.
//     (The validator text-scans the source, so naming that rejected call here
//     -- even inside a comment -- is itself enough to fail the upload.)
//   * A local named `ph` initialised from a call is rejected as well. See
//     README.md; no local in this file is named that.

window.plethoraBit = {
  meta: {
    title: "Pixel Fog",
    runtime: "plethora-bit@2",
    tags: [
      "art", "history", "facts", "san-francisco", "mosaic", "pixel",
      "touch", "sensory", "generative", "relaxing", "reveal"
    ],
    permissions: ["audio", "backgroundMusic", "haptics", "storage"]
  },

  async init(ctx) {
    // ====================================================================== //
    // Small math helpers                                                     //
    // ====================================================================== //

    const TAU = Math.PI * 2;
    const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
    const lerp = (a, b, t) => a + (b - a) * t;
    const easeOut = (t) => 1 - Math.pow(1 - t, 3);
    const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

    // Deterministic PRNG so a scene paints identically at every size.
    function mulberry32(seed) {
      let a = seed >>> 0;
      return function () {
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    }

    // Sine lookup — the mosaic evaluates two waves per cell per frame, and a
    // table keeps that off the hot path.
    const LUT_N = 1024;
    const SIN = new Float32Array(LUT_N);
    for (let i = 0; i < LUT_N; i++) SIN[i] = Math.sin((i / LUT_N) * TAU);
    const fsin = (v) => SIN[((v * (LUT_N / TAU)) | 0) & (LUT_N - 1)];

    // ====================================================================== //
    // Painting toolkit shared by the nine scenes                             //
    // ====================================================================== //

    function vGrad(g, y0, y1, stops) {
      const gr = g.createLinearGradient(0, y0, 0, y1);
      for (let i = 0; i < stops.length; i++) gr.addColorStop(stops[i][0], stops[i][1]);
      return gr;
    }

    function band(g, W, y0, y1, stops) {
      g.fillStyle = vGrad(g, y0, y1, stops);
      g.fillRect(-1, y0, W + 2, y1 - y0 + 1);
    }

    function glowBall(g, cx, cy, r, inner, outer) {
      const gr = g.createRadialGradient(cx, cy, 0, cx, cy, r);
      gr.addColorStop(0, inner);
      gr.addColorStop(1, outer);
      g.fillStyle = gr;
      g.beginPath();
      g.arc(cx, cy, r, 0, TAU);
      g.fill();
    }

    // A drifting bank of fog: overlapping soft ellipses, denser in the middle.
    function fogBank(g, W, cy, h, rng, alpha, tint, count) {
      const n = count || 16;
      for (let i = 0; i < n; i++) {
        const x = rng() * W * 1.3 - W * 0.15;
        const rx = W * (0.16 + rng() * 0.3);
        const ry = h * (0.3 + rng() * 0.75);
        const y = cy + (rng() - 0.5) * h;
        const a = alpha * (0.35 + rng() * 0.8);
        const rad = Math.max(rx, ry);
        const gr = g.createRadialGradient(x, y, 0, x, y, rad);
        gr.addColorStop(0, tint(a));
        gr.addColorStop(0.55, tint(a * 0.5));
        gr.addColorStop(1, tint(0));
        g.fillStyle = gr;
        g.beginPath();
        g.ellipse(x, y, rx, ry, 0, 0, TAU);
        g.fill();
      }
    }

    // A hill/headland silhouette built from four stacked sine octaves.
    function ridge(g, W, H, baseY, amp, seed, fill) {
      const rng = mulberry32(seed);
      const phase = [rng() * TAU, rng() * TAU, rng() * TAU, rng() * TAU];
      const fr = [0.6 + rng() * 0.5, 1.5 + rng() * 0.9, 3.0 + rng() * 1.4, 6.0 + rng() * 2.2];
      const am = [amp, amp * 0.44, amp * 0.2, amp * 0.09];
      const step = Math.max(2, W / 150);
      g.beginPath();
      g.moveTo(-2, H + 2);
      for (let x = -2; x <= W + step; x += step) {
        const u = x / W;
        let y = baseY;
        for (let i = 0; i < 4; i++) y += fsin(u * TAU * fr[i] + phase[i]) * am[i];
        g.lineTo(x, y);
      }
      g.lineTo(W + 2, H + 2);
      g.closePath();
      g.fillStyle = fill;
      g.fill();
    }

    function starfield(g, W, hMax, count, rng, tint) {
      for (let i = 0; i < count; i++) {
        const x = rng() * W;
        const y = rng() * hMax;
        const r = (0.3 + rng() * 1.1) * (W / 400);
        const a = (0.2 + rng() * 0.75) * (1 - (y / hMax) * 0.7);
        g.fillStyle = tint ? tint(a) : "rgba(255,255,255," + a.toFixed(3) + ")";
        g.beginPath();
        g.arc(x, y, Math.max(0.4, r), 0, TAU);
        g.fill();
      }
    }

    // Broken horizontal glints on water.
    function shimmer(g, W, y0, y1, rng, tint, count) {
      const span = y1 - y0;
      for (let i = 0; i < count; i++) {
        const t = rng();
        const y = y0 + t * span;
        const w = W * (0.03 + rng() * 0.2) * (0.3 + t * 1.5);
        const x = rng() * W;
        const h = Math.max(0.7, span * 0.006 * (0.4 + t * 1.8));
        g.fillStyle = tint((0.04 + rng() * 0.2) * (0.35 + t));
        g.fillRect(x - w / 2, y, w, h);
      }
    }

    // A column of light dropped from a low sun onto the water.
    function sunPath(g, cx, y0, y1, rng, tint, count) {
      const span = y1 - y0;
      for (let i = 0; i < count; i++) {
        const t = rng();
        const y = y0 + t * span;
        const spread = span * (0.25 + t * 2.4);
        const w = spread * (0.25 + rng() * 0.85);
        const x = cx + (rng() - 0.5) * spread * 1.5;
        const h = Math.max(0.8, span * 0.008 * (0.5 + t * 2));
        g.fillStyle = tint((0.5 - t * 0.3) * (0.3 + rng() * 0.8));
        g.fillRect(x - w / 2, y, w, h);
      }
    }

    // Lit windows scattered over a building face.
    function windows(g, x, y, w, h, rng, warm, density, cell) {
      const c = cell || Math.max(2, w * 0.13);
      const gap = c * 0.6;
      for (let wy = y + c * 0.9; wy < y + h - c * 0.4; wy += c + gap) {
        for (let wx = x + c * 0.7; wx < x + w - c * 0.7; wx += c + gap) {
          if (rng() > density) continue;
          const a = 0.3 + rng() * 0.7;
          g.fillStyle = warm(a);
          g.fillRect(wx, wy, c, c * 1.25);
        }
      }
    }

    function roundRect(g, x, y, w, h, r) {
      const rr = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2);
      g.beginPath();
      g.moveTo(x + rr, y);
      g.arcTo(x + w, y, x + w, y + h, rr);
      g.arcTo(x + w, y + h, x, y + h, rr);
      g.arcTo(x, y + h, x, y, rr);
      g.arcTo(x, y, x + w, y, rr);
      g.closePath();
    }

    // A conifer/cypress silhouette — used as foreground punctuation.
    function cypress(g, x, baseY, h, fill, rng) {
      const w = h * (0.26 + rng() * 0.12);
      g.fillStyle = fill;
      g.beginPath();
      g.moveTo(x, baseY - h);
      const steps = 5;
      for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        const yy = baseY - h + h * t;
        const ww = w * t * (0.7 + 0.5 * fsin(t * 9 + x));
        g.lineTo(x + ww, yy - h * 0.05);
        g.lineTo(x + ww * 0.55, yy);
      }
      g.lineTo(x + w * 0.08, baseY);
      g.lineTo(x - w * 0.08, baseY);
      for (let i = steps; i >= 1; i--) {
        const t = i / steps;
        const yy = baseY - h + h * t;
        const ww = w * t * (0.7 + 0.5 * fsin(t * 9 + x));
        g.lineTo(x - ww * 0.55, yy);
        g.lineTo(x - ww, yy - h * 0.05);
      }
      g.closePath();
      g.fill();
    }

    const W_ = (a) => "rgba(255,255,255," + a.toFixed(3) + ")";

    // ====================================================================== //
    // The nine pictures                                                      //
    // ====================================================================== //

    // Golden Gate Bridge, sun going down behind the headlands.
    function sceneGoldenGate(g, W, H) {
      const rng = mulberry32(1017);
      const s = Math.min(W, H) / 400;
      const hz = H * 0.66;

      band(g, W, 0, hz, [
        [0, "#221046"], [0.2, "#5c2059"], [0.42, "#a83a54"],
        [0.62, "#d9603c"], [0.8, "#f0994c"], [1, "#ffd79a"]
      ]);

      const sx = W * 0.31, sy = hz - H * 0.055, sr = H * 0.05;
      glowBall(g, sx, sy, sr * 7, "rgba(255,206,130,0.5)", "rgba(255,180,110,0)");
      glowBall(g, sx, sy, sr * 1.5, "rgba(255,246,224,1)", "rgba(255,214,150,0)");

      // Cloud streaks, lit from below.
      for (let i = 0; i < 9; i++) {
        const y = H * 0.1 + rng() * H * 0.42;
        const w = W * (0.3 + rng() * 0.75);
        const x = rng() * W - w * 0.3;
        const h = H * (0.008 + rng() * 0.02);
        const a = 0.1 + rng() * 0.3;
        const warm = y > H * 0.34;
        g.fillStyle = warm
          ? "rgba(255,196,142," + a.toFixed(3) + ")"
          : "rgba(140,90,150," + (a * 0.85).toFixed(3) + ")";
        g.beginPath();
        g.ellipse(x, y, w * 0.5, h, 0, 0, TAU);
        g.fill();
      }

      // Marin headlands.
      ridge(g, W, hz + 1, hz - H * 0.045, H * 0.032, 55, "#3d2247");
      ridge(g, W, hz + 1, hz - H * 0.012, H * 0.018, 77, "#2b1733");

      // Water.
      band(g, W, hz, H, [
        [0, "#7c3a45"], [0.16, "#5a2b41"], [0.55, "#33203a"], [1, "#1a1226"]
      ]);
      sunPath(g, sx, hz, H, rng, (a) => "rgba(255,200,140," + clamp(a, 0, 1).toFixed(3) + ")", 90);
      shimmer(g, W, hz, H, rng, (a) => "rgba(255,190,175," + a.toFixed(3) + ")", 60);

      // --- the bridge ---------------------------------------------------- //
      const deckY = hz - H * 0.045;
      const towerTop = H * 0.13;
      const t1 = W * 0.3, t2 = W * 0.93;
      const legW = Math.max(2.2, 7 * s);
      const ORANGE = "#8f2f14";
      const ORANGE_LIT = "#d8551f";

      // Main cables: tower top → mid-span sag → tower top, plus the back stays.
      g.strokeStyle = ORANGE;
      g.lineWidth = Math.max(1.4, 3.4 * s);
      g.lineCap = "round";
      const sag = deckY - H * 0.01;
      g.beginPath();
      g.moveTo(-W * 0.1, deckY - H * 0.12);
      g.quadraticCurveTo(t1 * 0.5, deckY - H * 0.02, t1, towerTop + H * 0.02);
      g.moveTo(t1, towerTop + H * 0.02);
      g.quadraticCurveTo((t1 + t2) / 2, sag, t2, towerTop + H * 0.02);
      g.stroke();

      // Suspender ropes hanging from the sagging cable to the deck.
      g.lineWidth = Math.max(0.6, 1.2 * s);
      g.beginPath();
      const nSusp = 26;
      for (let i = 1; i < nSusp; i++) {
        const u = i / nSusp;
        const x = lerp(t1, t2, u);
        const cy = (1 - u) * (1 - u) * (towerTop + H * 0.02) +
          2 * (1 - u) * u * sag + u * u * (towerTop + H * 0.02);
        if (cy >= deckY - 1) continue;
        g.moveTo(x, cy);
        g.lineTo(x, deckY);
      }
      for (let i = 1; i < 8; i++) {
        const u = i / 8;
        const x = lerp(0, t1, u);
        const cy = (1 - u) * (1 - u) * (deckY - H * 0.12) +
          2 * (1 - u) * u * (deckY - H * 0.02) + u * u * (towerTop + H * 0.02);
        if (cy >= deckY - 1) continue;
        g.moveTo(x, cy);
        g.lineTo(x, deckY);
      }
      g.stroke();

      // Roadway.
      g.fillStyle = "#71250f";
      g.fillRect(-2, deckY, W + 4, Math.max(2.4, 6.5 * s));
      g.fillStyle = ORANGE_LIT;
      g.fillRect(-2, deckY, W + 4, Math.max(1, 1.8 * s));

      // Towers.
      function tower(tx) {
        const halfGap = Math.max(3, 12 * s);
        g.fillStyle = ORANGE;
        g.fillRect(tx - halfGap - legW, towerTop, legW, deckY - towerTop + H * 0.05);
        g.fillRect(tx + halfGap, towerTop, legW, deckY - towerTop + H * 0.05);
        // Sun-side rim light.
        g.fillStyle = ORANGE_LIT;
        g.fillRect(tx - halfGap - legW, towerTop, Math.max(0.8, 1.6 * s), deckY - towerTop + H * 0.05);
        g.fillRect(tx + halfGap, towerTop, Math.max(0.8, 1.6 * s), deckY - towerTop + H * 0.05);
        // Cross braces.
        g.fillStyle = ORANGE;
        const braces = [0.0, 0.16, 0.42, 0.72];
        for (const b of braces) {
          const by = towerTop + (deckY - towerTop) * b;
          g.fillRect(tx - halfGap - legW, by, halfGap * 2 + legW * 2, Math.max(1.6, 4.2 * s));
        }
      }
      tower(t1);
      tower(t2);

      // Fog snagged around the tower feet — the classic Golden Gate look.
      fogBank(g, W, deckY + H * 0.035, H * 0.075, rng,
        0.55, (a) => "rgba(228,214,222," + clamp(a, 0, 1).toFixed(3) + ")", 14);
    }

    // The downtown skyline at dusk, seen across the bay.
    function sceneDowntown(g, W, H) {
      const rng = mulberry32(2311);
      const s = Math.min(W, H) / 400;
      const hz = H * 0.79;

      band(g, W, 0, hz, [
        [0, "#0a1030"], [0.3, "#1d2454"], [0.58, "#4b3468"],
        [0.8, "#a4526a"], [0.93, "#e0865c"], [1, "#f7be86"]
      ]);
      starfield(g, W, H * 0.34, 90, rng);

      const warm = (a) => "rgba(255,214,150," + clamp(a, 0, 1).toFixed(3) + ")";
      const skyGlow = g.createRadialGradient(W * 0.5, hz, 0, W * 0.5, hz, W * 0.75);
      skyGlow.addColorStop(0, "rgba(255,180,120,0.3)");
      skyGlow.addColorStop(1, "rgba(255,180,120,0)");
      g.fillStyle = skyGlow;
      g.fillRect(0, 0, W, hz);

      // Far hills behind the city.
      ridge(g, W, hz, hz - H * 0.11, H * 0.03, 91, "#241b3f");

      // Skyline. Heights are fractions of H measured up from the waterline.
      const base = hz;
      const towers = [];
      let x = -W * 0.04;
      while (x < W * 1.02) {
        const w = W * (0.035 + rng() * 0.06);
        const h = H * (0.05 + rng() * 0.11);
        towers.push({ x, w, h, k: "box" });
        x += w * (0.92 + rng() * 0.5);
      }
      // Landmarks, dropped in at fixed spots.
      towers.push({ x: W * 0.3, w: W * 0.075, h: H * 0.26, k: "pyramid" });
      towers.push({ x: W * 0.54, w: W * 0.085, h: H * 0.36, k: "sales" });
      towers.sort((a, b) => a.h - b.h);

      for (const t of towers) {
        const top = base - t.h;
        if (t.k === "box") {
          g.fillStyle = "#161230";
          g.fillRect(t.x, top, t.w, t.h);
          windows(g, t.x, top, t.w, t.h, rng, warm, 0.4);
          g.fillStyle = "rgba(255,170,120,0.13)";
          g.fillRect(t.x, top, Math.max(0.8, 1.6 * s), t.h);
        } else if (t.k === "pyramid") {
          // Transamerica Pyramid.
          g.fillStyle = "#1a1636";
          g.beginPath();
          g.moveTo(t.x + t.w / 2, top);
          g.lineTo(t.x + t.w, base);
          g.lineTo(t.x, base);
          g.closePath();
          g.fill();
          g.strokeStyle = "rgba(255,196,140,0.35)";
          g.lineWidth = Math.max(0.7, 1.3 * s);
          g.stroke();
          g.fillStyle = warm(0.75);
          for (let i = 1; i < 9; i++) {
            const u = i / 9;
            const yy = lerp(top, base, u);
            const hw = (t.w / 2) * u;
            g.fillRect(t.x + t.w / 2 - hw * 0.5, yy, Math.max(1, hw * 0.35), Math.max(1, 1.6 * s));
          }
          // Crown light.
          glowBall(g, t.x + t.w / 2, top, H * 0.02, "rgba(255,240,200,0.85)", "rgba(255,220,160,0)");
        } else {
          // Salesforce Tower — tapering shaft, rounded crown.
          const cx = t.x + t.w / 2;
          g.fillStyle = "#1b1738";
          g.beginPath();
          g.moveTo(t.x, base);
          g.lineTo(t.x + t.w * 0.16, top + t.h * 0.06);
          g.quadraticCurveTo(cx, top - t.h * 0.02, t.x + t.w * 0.84, top + t.h * 0.06);
          g.lineTo(t.x + t.w, base);
          g.closePath();
          g.fill();
          windows(g, t.x + t.w * 0.2, top + t.h * 0.1, t.w * 0.6, t.h * 0.85, rng, warm, 0.32);
          glowBall(g, cx, top + t.h * 0.03, H * 0.045,
            "rgba(190,210,255,0.55)", "rgba(160,190,255,0)");
        }
      }

      // Bay.
      band(g, W, hz, H, [[0, "#20182f"], [0.4, "#141126"], [1, "#0a0817"]]);
      shimmer(g, W, hz, H, rng, (a) => "rgba(255,190,140," + a.toFixed(3) + ")", 70);

      // Vertical reflections under the lit skyline.
      g.save();
      g.globalAlpha = 0.4;
      for (let i = 0; i < 60; i++) {
        const rx = rng() * W;
        const rh = (H - hz) * (0.15 + rng() * 0.7);
        g.fillStyle = warm(0.05 + rng() * 0.2);
        g.fillRect(rx, hz, Math.max(1, W * 0.006), rh);
      }
      g.restore();

      fogBank(g, W, hz - H * 0.02, H * 0.05, rng,
        0.3, (a) => "rgba(210,200,220," + clamp(a, 0, 1).toFixed(3) + ")", 10);
    }

    // The Painted Ladies on Alamo Square, late afternoon.
    function scenePaintedLadies(g, W, H) {
      const rng = mulberry32(3607);
      const s = Math.min(W, H) / 400;
      const lawnY = H * 0.76;
      const streetY = H * 0.62;

      band(g, W, 0, streetY, [
        [0, "#3f7fc4"], [0.4, "#79b0dc"], [0.75, "#bcd8ea"], [1, "#f2e2cd"]
      ]);
      for (let i = 0; i < 7; i++) {
        const y = H * 0.05 + rng() * H * 0.28;
        const x = rng() * W;
        const w = W * (0.2 + rng() * 0.4);
        g.fillStyle = "rgba(255,255,255," + (0.16 + rng() * 0.3).toFixed(3) + ")";
        g.beginPath();
        g.ellipse(x, y, w * 0.5, H * (0.014 + rng() * 0.02), 0, 0, TAU);
        g.fill();
      }

      // Hazy downtown behind the roofline.
      const bh = H * 0.13;
      for (let i = 0; i < 16; i++) {
        const bw = W * (0.03 + rng() * 0.05);
        const x = rng() * W;
        const h = bh * (0.35 + rng() * 0.9);
        g.fillStyle = "rgba(120,150,180," + (0.3 + rng() * 0.28).toFixed(3) + ")";
        g.fillRect(x, streetY - h, bw, h);
      }
      g.fillStyle = "rgba(190,214,232,0.4)";
      g.fillRect(0, streetY - bh * 0.5, W, bh * 0.5);

      // --- the row of Victorians ------------------------------------------ //
      const bodyColors = ["#e8d6b4", "#d9a48c", "#cfd8c0", "#e6c4a8", "#c9bcd6", "#efe0c2", "#d6b8a0"];
      const trimColors = ["#8a5a3c", "#7d4a4a", "#5f7a5a", "#7a5a44", "#5e5478", "#9a7a4a", "#7a5a4a"];
      const n = 6;
      const hw = W / (n - 0.35);
      for (let i = 0; i < n; i++) {
        const x = -hw * 0.16 + i * hw * 0.985;
        const w = hw * 0.95;
        const topY = streetY - H * (0.2 + (i % 3) * 0.016);
        const bodyH = lawnY - topY;
        const c = bodyColors[i % bodyColors.length];
        const tc = trimColors[i % trimColors.length];

        // Gable roof.
        g.fillStyle = tc;
        g.beginPath();
        g.moveTo(x - w * 0.06, topY + bodyH * 0.16);
        g.lineTo(x + w * 0.5, topY - bodyH * 0.02);
        g.lineTo(x + w * 1.06, topY + bodyH * 0.16);
        g.closePath();
        g.fill();

        // Body.
        g.fillStyle = c;
        g.fillRect(x, topY + bodyH * 0.13, w, bodyH * 0.87);
        // Shaded right edge so the row reads three-dimensional.
        g.fillStyle = "rgba(0,0,0,0.12)";
        g.fillRect(x + w * 0.88, topY + bodyH * 0.13, w * 0.12, bodyH * 0.87);

        // Bay window bump.
        g.fillStyle = c;
        g.fillRect(x + w * 0.12, topY + bodyH * 0.3, w * 0.44, bodyH * 0.7);
        g.fillStyle = "rgba(255,255,255,0.22)";
        g.fillRect(x + w * 0.12, topY + bodyH * 0.3, w * 0.05, bodyH * 0.7);

        // Cornice bands.
        g.fillStyle = tc;
        for (const fy of [0.3, 0.55, 0.78]) {
          g.fillRect(x, topY + bodyH * fy, w, Math.max(1.2, 2.6 * s));
        }

        // Windows, warmly lit.
        const winW = w * 0.16, winH = bodyH * 0.16;
        for (let r = 0; r < 2; r++) {
          for (let cI = 0; cI < 3; cI++) {
            const wx = x + w * (0.14 + cI * 0.26);
            const wy = topY + bodyH * (0.34 + r * 0.24);
            g.fillStyle = tc;
            g.fillRect(wx - 1.5 * s, wy - 1.5 * s, winW + 3 * s, winH + 3 * s);
            const lit = rng() > 0.45;
            g.fillStyle = lit ? "rgba(255,224,168,0.95)" : "rgba(70,86,104,0.85)";
            g.fillRect(wx, wy, winW, winH);
            g.fillStyle = "rgba(255,255,255,0.25)";
            g.fillRect(wx, wy, winW, winH * 0.25);
          }
        }

        // Stoop.
        g.fillStyle = tc;
        g.fillRect(x + w * 0.66, lawnY - bodyH * 0.2, w * 0.2, bodyH * 0.2);
        g.fillStyle = "rgba(255,255,255,0.3)";
        g.fillRect(x + w * 0.66, lawnY - bodyH * 0.2, w * 0.2, Math.max(1.2, 2.4 * s));
      }

      // Sidewalk + lawn.
      g.fillStyle = "#b9b2a4";
      g.fillRect(0, lawnY - H * 0.012, W, H * 0.02);
      band(g, W, lawnY, H, [[0, "#6f9c4e"], [0.45, "#5b8a41"], [1, "#3f6b30"]]);
      // Grass texture.
      for (let i = 0; i < 260; i++) {
        const y = lawnY + rng() * (H - lawnY);
        const t = (y - lawnY) / (H - lawnY);
        g.fillStyle = "rgba(255,255,255," + (0.03 + rng() * 0.07).toFixed(3) + ")";
        g.fillRect(rng() * W, y, Math.max(1, W * 0.004 * (0.5 + t)), Math.max(1, H * 0.006 * (0.4 + t)));
      }
      // Two trees framing the row.
      cypress(g, W * 0.06, lawnY + H * 0.01, H * 0.16, "#2f5a2c", rng);
      cypress(g, W * 0.95, lawnY + H * 0.02, H * 0.19, "#2a5228", rng);
    }

    // Coit Tower on Telegraph Hill, bright midday.
    function sceneCoitTower(g, W, H) {
      const rng = mulberry32(4441);
      const s = Math.min(W, H) / 400;
      const bayY = H * 0.5;
      const hillY = H * 0.63;

      band(g, W, 0, bayY, [
        [0, "#2f6fbf"], [0.45, "#6ea8dd"], [0.82, "#a9cfe9"], [1, "#dcecf5"]
      ]);
      for (let i = 0; i < 10; i++) {
        const x = rng() * W, y = H * 0.04 + rng() * H * 0.3;
        const r = W * (0.05 + rng() * 0.09);
        g.fillStyle = "rgba(255,255,255," + (0.35 + rng() * 0.45).toFixed(3) + ")";
        g.beginPath();
        g.ellipse(x, y, r, r * (0.32 + rng() * 0.2), 0, 0, TAU);
        g.fill();
        g.beginPath();
        g.ellipse(x + r * 0.5, y + r * 0.1, r * 0.6, r * 0.26, 0, 0, TAU);
        g.fill();
      }

      // Marin hills across the water.
      ridge(g, W, bayY, bayY - H * 0.055, H * 0.03, 21, "#7d95a6");
      ridge(g, W, bayY, bayY - H * 0.02, H * 0.016, 33, "#5f7c90");

      // The bay.
      band(g, W, bayY, hillY, [[0, "#3f7098"], [0.5, "#2f5f8c"], [1, "#27527b"]]);
      shimmer(g, W, bayY, hillY, rng, W_, 55);

      // Alcatraz.
      const ax = W * 0.72, ay = bayY + (hillY - bayY) * 0.3;
      g.fillStyle = "#4d5b63";
      g.beginPath();
      g.ellipse(ax, ay, W * 0.085, H * 0.014, 0, 0, TAU);
      g.fill();
      g.fillStyle = "#d8d4cc";
      g.fillRect(ax - W * 0.03, ay - H * 0.022, W * 0.06, H * 0.022);
      g.fillStyle = "#b9b3a8";
      g.fillRect(ax + W * 0.012, ay - H * 0.034, W * 0.012, H * 0.034);

      // Telegraph Hill.
      ridge(g, W, H, hillY + H * 0.03, H * 0.028, 66, "#4e7a3f");
      band(g, W, hillY + H * 0.07, H, [[0, "#4a7539"], [0.5, "#3d6631"], [1, "#2b4a24"]]);

      // --- the tower ------------------------------------------------------- //
      const tx = W * 0.42;
      const tBase = hillY + H * 0.055;
      const tH = H * 0.32;
      const tW = W * 0.085;
      const tTop = tBase - tH;

      // Body, very slightly tapered.
      g.fillStyle = "#efe9dc";
      g.beginPath();
      g.moveTo(tx - tW * 0.5, tBase);
      g.lineTo(tx - tW * 0.43, tTop + tH * 0.14);
      g.lineTo(tx + tW * 0.43, tTop + tH * 0.14);
      g.lineTo(tx + tW * 0.5, tBase);
      g.closePath();
      g.fill();
      // Fluting.
      g.fillStyle = "rgba(150,140,120,0.32)";
      for (let i = 1; i < 6; i++) {
        const fx = tx - tW * 0.5 + (tW / 6) * i;
        g.fillRect(fx, tTop + tH * 0.15, Math.max(0.8, 1.5 * s), tH * 0.85);
      }
      // Shaded side.
      g.fillStyle = "rgba(120,110,95,0.2)";
      g.fillRect(tx + tW * 0.26, tTop + tH * 0.14, tW * 0.24, tH * 0.86);

      // Crown with arched openings.
      g.fillStyle = "#e4dccb";
      g.fillRect(tx - tW * 0.56, tTop, tW * 1.12, tH * 0.15);
      g.fillStyle = "#f5f0e4";
      g.fillRect(tx - tW * 0.6, tTop - tH * 0.025, tW * 1.2, tH * 0.03);
      g.fillStyle = "#3d4448";
      for (let i = 0; i < 4; i++) {
        const ox = tx - tW * 0.42 + i * (tW * 0.28);
        g.beginPath();
        g.moveTo(ox, tTop + tH * 0.13);
        g.lineTo(ox, tTop + tH * 0.055);
        g.arc(ox + tW * 0.075, tTop + tH * 0.055, tW * 0.075, Math.PI, 0);
        g.lineTo(ox + tW * 0.15, tTop + tH * 0.13);
        g.closePath();
        g.fill();
      }

      // Cypresses on the hill.
      for (let i = 0; i < 7; i++) {
        const cx = W * (0.05 + rng() * 0.9);
        const cy = hillY + H * (0.08 + rng() * 0.24);
        cypress(g, cx, cy, H * (0.07 + rng() * 0.07), "rgba(32,66,28,0.92)", rng);
      }
    }

    // The Bay Bridge, lit up after dark.
    function sceneBayBridge(g, W, H) {
      const rng = mulberry32(5153);
      const s = Math.min(W, H) / 400;
      const hz = H * 0.6;

      band(g, W, 0, hz, [
        [0, "#050818"], [0.4, "#0c1330"], [0.75, "#1b2447"], [1, "#39365c"]
      ]);
      starfield(g, W, H * 0.4, 130, rng);

      // City glow on the left horizon.
      const glow = g.createRadialGradient(W * 0.14, hz, 0, W * 0.14, hz, W * 0.55);
      glow.addColorStop(0, "rgba(255,190,130,0.34)");
      glow.addColorStop(1, "rgba(255,190,130,0)");
      g.fillStyle = glow;
      g.fillRect(0, 0, W, hz);

      const warm = (a) => "rgba(255,216,158," + clamp(a, 0, 1).toFixed(3) + ")";

      // Small skyline hugging the left edge.
      let bx = -W * 0.05;
      while (bx < W * 0.42) {
        const bw = W * (0.028 + rng() * 0.045);
        const bh = H * (0.04 + rng() * 0.13);
        g.fillStyle = "#0d1128";
        g.fillRect(bx, hz - bh, bw, bh);
        windows(g, bx, hz - bh, bw, bh, rng, warm, 0.45);
        bx += bw * (0.95 + rng() * 0.4);
      }

      // Water.
      band(g, W, hz, H, [[0, "#101832"], [0.5, "#0a1024"], [1, "#050813"]]);

      // --- the bridge ------------------------------------------------------ //
      const deckY = hz - H * 0.1;
      const towerTop = H * 0.19;
      const piers = [W * 0.12, W * 0.5, W * 0.88];

      // Suspension cables between the piers.
      g.strokeStyle = "rgba(150,170,200,0.55)";
      g.lineWidth = Math.max(1, 2.2 * s);
      for (let p = 0; p < piers.length - 1; p++) {
        g.beginPath();
        g.moveTo(piers[p], towerTop);
        g.quadraticCurveTo((piers[p] + piers[p + 1]) / 2, deckY + H * 0.005, piers[p + 1], towerTop);
        g.stroke();
      }

      // Cable lights — the thing that makes the bridge unmistakable at night.
      for (let p = 0; p < piers.length - 1; p++) {
        const n = 34;
        for (let i = 0; i <= n; i++) {
          const u = i / n;
          const x = lerp(piers[p], piers[p + 1], u);
          const y = (1 - u) * (1 - u) * towerTop +
            2 * (1 - u) * u * (deckY + H * 0.005) + u * u * towerTop;
          const a = 0.5 + 0.5 * rng();
          glowBall(g, x, y, Math.max(1.6, 4.5 * s),
            "rgba(220,232,255," + a.toFixed(3) + ")", "rgba(180,200,255,0)");
        }
      }

      // Suspenders.
      g.strokeStyle = "rgba(130,150,180,0.3)";
      g.lineWidth = Math.max(0.5, 1 * s);
      g.beginPath();
      for (let p = 0; p < piers.length - 1; p++) {
        for (let i = 1; i < 20; i++) {
          const u = i / 20;
          const x = lerp(piers[p], piers[p + 1], u);
          const y = (1 - u) * (1 - u) * towerTop +
            2 * (1 - u) * u * (deckY + H * 0.005) + u * u * towerTop;
          if (y >= deckY) continue;
          g.moveTo(x, y);
          g.lineTo(x, deckY);
        }
      }
      g.stroke();

      // Deck + traffic.
      g.fillStyle = "#151a2e";
      g.fillRect(-2, deckY, W + 4, Math.max(2.4, 6 * s));
      for (let i = 0; i < 40; i++) {
        const x = rng() * W;
        const white = rng() > 0.5;
        g.fillStyle = white ? "rgba(255,244,214,0.85)" : "rgba(255,90,70,0.8)";
        g.fillRect(x, deckY + (white ? 1 * s : 3 * s), Math.max(1.4, 3.4 * s), Math.max(1, 1.6 * s));
      }

      // Piers/towers.
      for (const px of piers) {
        const pw = Math.max(3, 9 * s);
        g.fillStyle = "#1a2038";
        g.fillRect(px - pw / 2, towerTop, pw, H - towerTop);
        g.fillStyle = "rgba(200,215,245,0.16)";
        g.fillRect(px - pw / 2, towerTop, Math.max(0.8, 1.6 * s), H - towerTop);
        for (const b of [0.06, 0.4, 0.72]) {
          g.fillStyle = "#1a2038";
          g.fillRect(px - pw * 1.15, towerTop + (deckY - towerTop) * b, pw * 2.3, Math.max(1.4, 3.4 * s));
        }
      }

      // Long reflections — the payoff of a night water scene.
      for (let i = 0; i < 150; i++) {
        const x = rng() * W;
        const y = hz + rng() * (H - hz);
        const t = (y - hz) / (H - hz);
        const w = Math.max(1, W * 0.004 * (1 + t * 3));
        const h = Math.max(1, H * 0.006 * (0.4 + t * 2.2));
        const near = Math.abs(x - piers[1]) < W * 0.4;
        g.fillStyle = near
          ? "rgba(190,210,255," + ((0.2 - t * 0.13) * rng()).toFixed(3) + ")"
          : warm((0.16 - t * 0.1) * rng());
        g.fillRect(x, y, w, h);
      }
    }

    // Looking down a steep Russian Hill street to the bay.
    function sceneHydeStreet(g, W, H) {
      const rng = mulberry32(7717);
      const s = Math.min(W, H) / 400;
      const vpY = H * 0.46;
      // On a tall phone the raw height would stretch this one-point view into
      // spikes, so vertical features are sized off a squarer reference frame.
      const R = Math.min(H, W * 1.7);
      const bayTop = H * 0.3;

      band(g, W, 0, bayTop, [[0, "#3d78bb"], [0.6, "#82b3dd"], [1, "#c4dcee"]]);
      ridge(g, W, bayTop, bayTop - H * 0.045, H * 0.025, 44, "#84a0ad");

      // The bay filling the gap at the bottom of the hill.
      band(g, W, bayTop, vpY, [[0, "#3a6e97"], [0.6, "#2e5d86"], [1, "#27527a"]]);
      shimmer(g, W, bayTop, vpY, rng, W_, 50);

      // Alcatraz sitting in the notch.
      const ax = W * 0.56, ay = bayTop + (vpY - bayTop) * 0.42;
      g.fillStyle = "#55636b";
      g.beginPath();
      g.ellipse(ax, ay, W * 0.075, H * 0.012, 0, 0, TAU);
      g.fill();
      g.fillStyle = "#d5d1c8";
      g.fillRect(ax - W * 0.025, ay - H * 0.018, W * 0.05, H * 0.018);

      // --- one-point perspective street ------------------------------------ //
      const vpX = W * 0.5;
      const roadHalfBottom = W * 0.34;
      const roadHalfTop = W * 0.045;

      g.fillStyle = "#5d5f63";
      g.beginPath();
      g.moveTo(vpX - roadHalfTop, vpY);
      g.lineTo(vpX + roadHalfTop, vpY);
      g.lineTo(vpX + roadHalfBottom, H);
      g.lineTo(vpX - roadHalfBottom, H);
      g.closePath();
      g.fill();
      // Asphalt sheen down the crown of the road.
      g.fillStyle = "rgba(255,255,255,0.05)";
      g.beginPath();
      g.moveTo(vpX - roadHalfTop * 0.3, vpY);
      g.lineTo(vpX + roadHalfTop * 0.3, vpY);
      g.lineTo(vpX + roadHalfBottom * 0.35, H);
      g.lineTo(vpX - roadHalfBottom * 0.35, H);
      g.closePath();
      g.fill();

      // Cable car tracks + the slot between them.
      g.strokeStyle = "rgba(210,215,220,0.55)";
      g.lineWidth = Math.max(1, 2 * s);
      for (const off of [-0.3, 0.3]) {
        g.beginPath();
        g.moveTo(vpX + roadHalfTop * off, vpY);
        g.lineTo(vpX + roadHalfBottom * off, H);
        g.stroke();
      }
      g.strokeStyle = "rgba(40,44,48,0.75)";
      g.beginPath();
      g.moveTo(vpX, vpY);
      g.lineTo(vpX, H);
      g.stroke();

      // Sidewalks.
      g.fillStyle = "#a9a599";
      for (const sgn of [-1, 1]) {
        g.beginPath();
        g.moveTo(vpX + sgn * roadHalfTop, vpY);
        g.lineTo(vpX + sgn * roadHalfTop * 1.5, vpY);
        g.lineTo(vpX + sgn * roadHalfBottom * 1.45, H);
        g.lineTo(vpX + sgn * roadHalfBottom, H);
        g.closePath();
        g.fill();
      }

      // Row houses stepping down both sides, nearest drawn last.
      const houseCols = ["#e6d7bd", "#cfa78e", "#c9d3c1", "#e0c2a6", "#bfb3d0", "#eadfc4"];
      for (let side = -1; side <= 1; side += 2) {
        for (let i = 7; i >= 0; i--) {
          const u0 = i / 8, u1 = (i + 1) / 8;
          const sc0 = Math.pow(u0, 1.45), sc1 = Math.pow(u1, 1.45);
          const x0 = vpX + side * lerp(roadHalfTop * 1.5, roadHalfBottom * 1.45, sc0);
          const x1 = vpX + side * lerp(roadHalfTop * 1.5, roadHalfBottom * 1.45, sc1);
          const yb0 = lerp(vpY, H, sc0);
          const yb1 = lerp(vpY, H, sc1);
          const hh = lerp(R * 0.09, R * 0.66, sc1);
          const col = houseCols[(i + (side > 0 ? 3 : 0)) % houseCols.length];

          g.fillStyle = col;
          g.beginPath();
          g.moveTo(x0, yb0);
          g.lineTo(x1, yb1);
          g.lineTo(x1, yb1 - hh);
          g.lineTo(x0, yb0 - hh * Math.pow((yb0 - vpY) / Math.max(1, yb1 - vpY), 0.72));
          g.closePath();
          g.fill();

          // Face shading so the near side reads darker toward the street.
          g.fillStyle = side < 0 ? "rgba(0,0,0,0.16)" : "rgba(0,0,0,0.06)";
          g.fill();

          // Window band.
          const wy = yb1 - hh * 0.62;
          const ww = Math.abs(x1 - x0) * 0.22;
          for (let k = 0; k < 3; k++) {
            const t = 0.2 + k * 0.3;
            const wx = lerp(x0, x1, t);
            const wh = hh * 0.16;
            g.fillStyle = rng() > 0.5 ? "rgba(255,226,172,0.9)" : "rgba(66,84,100,0.85)";
            g.fillRect(wx - ww / 2, wy, ww, wh);
          }
        }
      }

      // A cable car climbing toward us.
      const cu = 0.42;
      const cy = lerp(vpY, H, Math.pow(cu, 1.45));
      const cw = lerp(roadHalfTop, roadHalfBottom, Math.pow(cu, 1.45)) * 0.85;
      const ch = cw * 0.85;
      g.fillStyle = "#8d2f26";
      roundRect(g, vpX - cw / 2, cy - ch, cw, ch * 0.82, ch * 0.08);
      g.fill();
      g.fillStyle = "#f0e6d2";
      g.fillRect(vpX - cw / 2, cy - ch * 0.48, cw, ch * 0.1);
      g.fillStyle = "#2f3a42";
      for (let i = 0; i < 3; i++) {
        g.fillRect(vpX - cw * 0.4 + i * cw * 0.29, cy - ch * 0.86, cw * 0.2, ch * 0.3);
      }
      g.fillStyle = "#40352c";
      g.fillRect(vpX - cw * 0.56, cy - ch * 1.02, cw * 1.12, ch * 0.1);
      g.fillStyle = "rgba(0,0,0,0.28)";
      g.beginPath();
      g.ellipse(vpX, cy - ch * 0.02, cw * 0.55, ch * 0.07, 0, 0, TAU);
      g.fill();

      // Fog spilling over the far rooftops.
      fogBank(g, W, vpY - H * 0.01, H * 0.035, rng, 0.4,
        (a) => "rgba(232,238,244," + clamp(a, 0, 1).toFixed(3) + ")", 9);
    }

    // Ocean Beach, the sun going into the Pacific.
    function sceneOceanBeach(g, W, H) {
      const rng = mulberry32(9319);
      const s = Math.min(W, H) / 400;
      const hz = H * 0.52;
      const sandY = H * 0.78;

      band(g, W, 0, hz, [
        [0, "#3a2a6b"], [0.24, "#8c4374"], [0.48, "#d76a5c"],
        [0.7, "#f39a58"], [0.88, "#fbc878"], [1, "#ffeeb8"]
      ]);

      const sx = W * 0.52, sy = hz - H * 0.012, sr = H * 0.055;
      glowBall(g, sx, sy, sr * 8, "rgba(255,206,132,0.45)", "rgba(255,180,110,0)");
      // Half-sunk disc: clipped to the sky so it sits *in* the horizon.
      g.save();
      g.beginPath();
      g.rect(0, 0, W, hz);
      g.clip();
      glowBall(g, sx, sy, sr * 1.35, "rgba(255,252,238,1)", "rgba(255,220,150,0.15)");
      g.restore();

      for (let i = 0; i < 8; i++) {
        const y = H * 0.05 + rng() * H * 0.34;
        const w = W * (0.3 + rng() * 0.7);
        const x = rng() * W - w * 0.3;
        g.fillStyle = "rgba(120,70,110," + (0.12 + rng() * 0.25).toFixed(3) + ")";
        g.beginPath();
        g.ellipse(x, y, w * 0.5, H * (0.005 + rng() * 0.012), 0, 0, TAU);
        g.fill();
      }

      // Ocean.
      band(g, W, hz, sandY, [
        [0, "#c06a4e"], [0.15, "#7a4658"], [0.5, "#40354f"], [1, "#2b2942"]
      ]);
      sunPath(g, sx, hz, sandY, rng, (a) => "rgba(255,208,148," + clamp(a, 0, 1).toFixed(3) + ")", 110);
      shimmer(g, W, hz, sandY, rng, (a) => "rgba(255,200,180," + a.toFixed(3) + ")", 70);

      // Breaking waves — a few long foam curves parallel to the shore.
      for (let i = 0; i < 5; i++) {
        const t = 0.25 + i * 0.17;
        const y = lerp(hz, sandY, t);
        const th2 = Math.max(1, (sandY - hz) * 0.012 * (0.5 + t * 2));
        g.strokeStyle = "rgba(255,240,232," + (0.2 + t * 0.5).toFixed(3) + ")";
        g.lineWidth = th2;
        g.beginPath();
        for (let x = -10; x <= W + 10; x += Math.max(3, W / 60)) {
          const yy = y + fsin(x / W * TAU * (1.5 + i * 0.6) + i * 2.1) * (sandY - hz) * 0.012;
          if (x <= -10) g.moveTo(x, yy); else g.lineTo(x, yy);
        }
        g.stroke();
      }

      // Wet sand mirroring the sky.
      band(g, W, sandY, H, [
        [0, "#c89a72"], [0.2, "#b5865f"], [0.6, "#9c6f50"], [1, "#7d573e"]
      ]);
      g.save();
      g.globalAlpha = 0.3;
      band(g, W, sandY, H * 0.92, [
        [0, "rgba(255,206,140,0.9)"], [1, "rgba(255,180,120,0)"]
      ]);
      g.restore();
      // Foam edge.
      g.strokeStyle = "rgba(255,248,240,0.8)";
      g.lineWidth = Math.max(1.4, 3 * s);
      g.beginPath();
      for (let x = -10; x <= W + 10; x += Math.max(3, W / 70)) {
        const yy = sandY + fsin(x / W * TAU * 2.2) * (H * 0.006) + fsin(x / W * TAU * 5.3) * (H * 0.003);
        if (x <= -10) g.moveTo(x, yy); else g.lineTo(x, yy);
      }
      g.stroke();
      for (let i = 0; i < 90; i++) {
        const x = rng() * W;
        const y = sandY + (rng() - 0.3) * H * 0.03;
        g.fillStyle = "rgba(255,250,244," + (0.1 + rng() * 0.35).toFixed(3) + ")";
        g.beginPath();
        g.arc(x, y, Math.max(0.6, rng() * 2.2 * s), 0, TAU);
        g.fill();
      }
      // Sand sparkle.
      for (let i = 0; i < 120; i++) {
        const y = sandY + rng() * (H - sandY);
        g.fillStyle = "rgba(255,232,200," + (0.05 + rng() * 0.18).toFixed(3) + ")";
        g.fillRect(rng() * W, y, Math.max(1, 1.6 * s), Math.max(1, 1.2 * s));
      }

      // Gulls.
      g.strokeStyle = "rgba(40,32,48,0.55)";
      g.lineWidth = Math.max(1, 1.6 * s);
      for (let i = 0; i < 5; i++) {
        const x = W * (0.1 + rng() * 0.8);
        const y = H * (0.1 + rng() * 0.24);
        const w = W * (0.018 + rng() * 0.022);
        g.beginPath();
        g.moveTo(x - w, y);
        g.quadraticCurveTo(x - w * 0.5, y - w * 0.6, x, y);
        g.quadraticCurveTo(x + w * 0.5, y - w * 0.6, x + w, y);
        g.stroke();
      }
    }

    // Fort Point — the 1861 brick fort the bridge was re-drawn to vault over.
    function sceneFortPoint(g, W, H) {
      const rng = mulberry32(4477);
      const s = Math.min(W, H) / 400;
      const hz = H * 0.76;

      band(g, W, 0, hz, [
        [0, "#26365e"], [0.26, "#4f6288"], [0.52, "#93949f"],
        [0.78, "#d7a988"], [1, "#f3d5ab"]
      ]);
      glowBall(g, W * 0.18, hz - H * 0.05, H * 0.2,
        "rgba(255,224,182,0.5)", "rgba(255,200,150,0)");

      for (let i = 0; i < 7; i++) {
        const y = H * 0.04 + rng() * H * 0.3;
        const w = W * (0.3 + rng() * 0.7);
        g.fillStyle = "rgba(255,208,176," + (0.07 + rng() * 0.16).toFixed(3) + ")";
        g.beginPath();
        g.ellipse(rng() * W, y, w * 0.5, H * (0.005 + rng() * 0.012), 0, 0, TAU);
        g.fill();
      }

      // Marin, across the strait.
      ridge(g, W, hz, hz - H * 0.045, H * 0.026, 313, "#5b5870");
      ridge(g, W, hz, hz - H * 0.016, H * 0.013, 611, "#454258");

      band(g, W, hz, H, [[0, "#5b6072"], [0.4, "#3d4256"], [1, "#23283a"]]);
      shimmer(g, W, hz, H, rng, (a) => "rgba(255,226,202," + a.toFixed(3) + ")", 55);

      // ---- the bridge overhead ------------------------------------------ //
      const STEEL = "#7d2f17";
      const STEEL_LIT = "#bf4a20";
      const deckY = H * 0.135;
      const springY = H * 0.6;
      const apexY = H * 0.3;
      const archThick = H * 0.05;
      const ay = (x) => {
        const u = (2 * (x / W) - 1);
        return apexY + (springY - apexY) * u * u;
      };

      // Roadway across the very top, with the tower leg rising out of frame.
      g.fillStyle = "#5c2311";
      g.fillRect(-2, deckY, W + 4, Math.max(3.5, 10 * s));
      g.fillStyle = STEEL_LIT;
      g.fillRect(-2, deckY, W + 4, Math.max(1.2, 2.6 * s));

      const legX = W * 0.78;
      const legW = Math.max(4, 13 * s);
      g.fillStyle = STEEL;
      g.fillRect(legX - legW * 1.6, 0, legW, deckY);
      g.fillRect(legX + legW * 0.6, 0, legW, deckY);
      g.fillStyle = STEEL_LIT;
      g.fillRect(legX - legW * 1.6, 0, Math.max(1, 2 * s), deckY);
      g.fillRect(legX + legW * 0.6, 0, Math.max(1, 2 * s), deckY);
      g.fillStyle = STEEL;
      g.fillRect(legX - legW * 1.6, deckY * 0.42, legW * 3.2, Math.max(2, 5 * s));

      // Posts from the arch up to the roadway.
      g.strokeStyle = STEEL;
      g.lineWidth = Math.max(1.4, 3.4 * s);
      g.beginPath();
      for (let i = 1; i < 15; i++) {
        const x = (W * i) / 15;
        const top = ay(x);
        if (top <= deckY) continue;
        g.moveTo(x, top + archThick);
        g.lineTo(x, deckY);
      }
      g.stroke();

      // The arch itself: two ribs with lacing between them.
      function ribPath(off) {
        g.beginPath();
        const step = Math.max(3, W / 70);
        for (let x = -4; x <= W + step; x += step) {
          const y = ay(x) + off;
          if (x <= -4) g.moveTo(x, y);
          else g.lineTo(x, y);
        }
      }
      g.strokeStyle = STEEL;
      g.lineWidth = Math.max(2.6, 7 * s);
      ribPath(0);
      g.stroke();
      g.lineWidth = Math.max(2, 5.5 * s);
      ribPath(archThick);
      g.stroke();
      g.strokeStyle = STEEL;
      g.lineWidth = Math.max(0.8, 1.8 * s);
      g.beginPath();
      for (let i = 0; i <= 26; i++) {
        const x0 = (W * i) / 26;
        const x1 = (W * (i + 1)) / 26;
        g.moveTo(x0, ay(x0));
        g.lineTo(x1, ay(x1) + archThick);
        g.moveTo(x0, ay(x0) + archThick);
        g.lineTo(x1, ay(x1));
      }
      g.stroke();
      // Sun catching the top edge of the arch.
      g.strokeStyle = STEEL_LIT;
      g.lineWidth = Math.max(0.8, 1.8 * s);
      ribPath(-Math.max(1, 2 * s));
      g.stroke();

      // ---- the fort ------------------------------------------------------ //
      const fx = W * 0.1;
      const fw = W * 0.8;
      const fTop = H * 0.615;
      const fBot = H * 0.79;
      const fh = fBot - fTop;

      // Rock apron under the walls.
      g.fillStyle = "#3b3946";
      g.beginPath();
      g.moveTo(fx - W * 0.09, H);
      g.lineTo(fx - W * 0.05, fBot - fh * 0.06);
      g.lineTo(fx + fw + W * 0.05, fBot - fh * 0.06);
      g.lineTo(fx + fw + W * 0.09, H);
      g.closePath();
      g.fill();

      // Main brick mass, slightly battered walls.
      g.fillStyle = "#6d3f33";
      g.beginPath();
      g.moveTo(fx, fTop);
      g.lineTo(fx + fw, fTop);
      g.lineTo(fx + fw + fw * 0.02, fBot);
      g.lineTo(fx - fw * 0.02, fBot);
      g.closePath();
      g.fill();

      // Brick courses.
      g.fillStyle = "rgba(0,0,0,0.09)";
      for (let y = fTop + fh * 0.03; y < fBot; y += Math.max(2, fh * 0.045)) {
        g.fillRect(fx - fw * 0.02, y, fw * 1.04, Math.max(0.6, 1.1 * s));
      }
      // Shaded right flank.
      g.fillStyle = "rgba(0,0,0,0.2)";
      g.fillRect(fx + fw * 0.78, fTop, fw * 0.24, fh);
      // Warm light on the left flank.
      g.fillStyle = "rgba(255,190,140,0.14)";
      g.fillRect(fx, fTop, fw * 0.22, fh);

      // Three tiers of arched casemates.
      const cols = 8;
      for (let row = 0; row < 3; row++) {
        const oy = fTop + fh * (0.2 + row * 0.26);
        const ohHeight = fh * 0.17;
        for (let c = 0; c < cols; c++) {
          const ox = fx + fw * (0.06 + c * (0.88 / (cols - 1)));
          const ow = fw * 0.058;
          g.fillStyle = "#2a1c1c";
          g.beginPath();
          g.moveTo(ox, oy + ohHeight);
          g.lineTo(ox, oy + ow * 0.5);
          g.arc(ox + ow * 0.5, oy + ow * 0.5, ow * 0.5, Math.PI, 0);
          g.lineTo(ox + ow, oy + ohHeight);
          g.closePath();
          g.fill();
          // A little sky-glow catching the arch lip.
          g.fillStyle = "rgba(255,206,168,0.12)";
          g.fillRect(ox, oy + ow * 0.45, ow, Math.max(0.7, 1.3 * s));
        }
      }

      // Parapet along the top.
      g.fillStyle = "#7b4839";
      g.fillRect(fx - fw * 0.015, fTop - fh * 0.05, fw * 1.03, fh * 0.06);
      g.fillStyle = "rgba(255,214,176,0.16)";
      g.fillRect(fx - fw * 0.015, fTop - fh * 0.05, fw * 1.03, Math.max(1, 1.8 * s));

      // Fort Point's own little lighthouse, up on the roof.
      const lx = fx + fw * 0.84;
      const lBase = fTop - fh * 0.05;
      const lh = fh * 0.34;
      g.fillStyle = "#e8e2d6";
      g.fillRect(lx - fw * 0.016, lBase - lh, fw * 0.032, lh);
      g.fillStyle = "#2f3238";
      g.fillRect(lx - fw * 0.024, lBase - lh - fh * 0.05, fw * 0.048, fh * 0.05);
      glowBall(g, lx, lBase - lh - fh * 0.025, fh * 0.12,
        "rgba(255,236,190,0.75)", "rgba(255,220,150,0)");

      // Surf at the base.
      g.strokeStyle = "rgba(255,250,244,0.6)";
      g.lineWidth = Math.max(1.2, 2.6 * s);
      g.beginPath();
      for (let x = -6; x <= W + 6; x += Math.max(3, W / 60)) {
        const y = fBot + fh * 0.06 + fsin(x / W * TAU * 2.6) * H * 0.005;
        if (x <= -6) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      g.stroke();
      for (let i = 0; i < 60; i++) {
        const x = rng() * W;
        const y = fBot + fh * 0.02 + rng() * H * 0.06;
        g.fillStyle = "rgba(255,252,248," + (0.08 + rng() * 0.3).toFixed(3) + ")";
        g.beginPath();
        g.arc(x, y, Math.max(0.6, rng() * 2.4 * s), 0, TAU);
        g.fill();
      }

      fogBank(g, W, hz - H * 0.01, H * 0.04, rng, 0.35,
        (a) => "rgba(226,226,238," + clamp(a, 0, 1).toFixed(3) + ")", 9);
    }

    // Alcatraz — the rock, its cellhouse, and the light that came first.
    function sceneAlcatraz(g, W, H) {
      const rng = mulberry32(1854);
      const s = Math.min(W, H) / 400;
      const hz = H * 0.66;

      band(g, W, 0, hz, [
        [0, "#1b2448"], [0.26, "#3b4470"], [0.54, "#7d6b8e"],
        [0.78, "#c9849a"], [0.93, "#e9ab92"], [1, "#f6cfa8"]
      ]);
      starfield(g, W, H * 0.26, 60, rng);

      for (let i = 0; i < 8; i++) {
        const y = H * 0.06 + rng() * H * 0.34;
        const w = W * (0.3 + rng() * 0.7);
        g.fillStyle = "rgba(120,86,120," + (0.1 + rng() * 0.22).toFixed(3) + ")";
        g.beginPath();
        g.ellipse(rng() * W, y, w * 0.5, H * (0.005 + rng() * 0.012), 0, 0, TAU);
        g.fill();
      }

      // The far shore behind the island.
      ridge(g, W, hz, hz - H * 0.035, H * 0.02, 77, "#4a4763");

      band(g, W, hz, H, [[0, "#3d4463"], [0.35, "#2b3049"], [1, "#171a2b"]]);

      // ---- the island ----------------------------------------------------- //
      const ix = W * 0.5;
      const iw = W * 0.86;
      const rockTop = hz - H * 0.055;
      const rockBot = hz + H * 0.045;

      g.fillStyle = "#4a4450";
      g.beginPath();
      g.moveTo(ix - iw * 0.5, rockBot);
      g.lineTo(ix - iw * 0.42, rockTop + H * 0.018);
      g.lineTo(ix - iw * 0.2, rockTop);
      g.lineTo(ix + iw * 0.24, rockTop - H * 0.004);
      g.lineTo(ix + iw * 0.43, rockTop + H * 0.02);
      g.lineTo(ix + iw * 0.5, rockBot);
      g.closePath();
      g.fill();
      // Strata + a lit face on the sunset side.
      g.fillStyle = "rgba(0,0,0,0.16)";
      for (let i = 0; i < 5; i++) {
        const y = rockTop + (rockBot - rockTop) * (0.24 + i * 0.16);
        g.fillRect(ix - iw * 0.5, y, iw, Math.max(1, 2.2 * s));
      }
      g.fillStyle = "rgba(255,190,150,0.13)";
      g.beginPath();
      g.moveTo(ix - iw * 0.5, rockBot);
      g.lineTo(ix - iw * 0.42, rockTop + H * 0.018);
      g.lineTo(ix - iw * 0.24, rockTop + H * 0.004);
      g.lineTo(ix - iw * 0.28, rockBot);
      g.closePath();
      g.fill();

      // Cellhouse: a long, low block along the ridge.
      const chX = ix - iw * 0.34;
      const chW = iw * 0.62;
      const chH = H * 0.052;
      const chY = rockTop - chH;
      g.fillStyle = "#b9ad9d";
      g.fillRect(chX, chY, chW, chH);
      g.fillStyle = "rgba(0,0,0,0.22)";
      g.fillRect(chX + chW * 0.74, chY, chW * 0.26, chH);
      g.fillStyle = "#8e8375";
      g.fillRect(chX, chY - chH * 0.16, chW, chH * 0.17);
      // Cell windows, a few still lit.
      for (let i = 0; i < 16; i++) {
        const wx = chX + chW * (0.04 + i * 0.06);
        g.fillStyle = rng() > 0.72
          ? "rgba(255,224,168,0.9)"
          : "rgba(58,62,74,0.85)";
        g.fillRect(wx, chY + chH * 0.3, chW * 0.028, chH * 0.4);
      }

      // Water tower on its spindly legs.
      const wtX = ix - iw * 0.42;
      const wtY = rockTop - H * 0.052;
      g.strokeStyle = "#6d6660";
      g.lineWidth = Math.max(1, 2 * s);
      g.beginPath();
      g.moveTo(wtX - W * 0.02, rockTop);
      g.lineTo(wtX - W * 0.008, wtY);
      g.moveTo(wtX + W * 0.02, rockTop);
      g.lineTo(wtX + W * 0.008, wtY);
      g.stroke();
      g.fillStyle = "#9a9187";
      g.fillRect(wtX - W * 0.022, wtY - H * 0.022, W * 0.044, H * 0.024);

      // ---- the lighthouse: the reason this rock matters here --------------- //
      const gx = ix + iw * 0.2;
      const gBase = rockTop - chH * 0.2;
      const gh = H * 0.15;
      const gw = W * 0.036;

      // Keeper's house at the foot.
      g.fillStyle = "#c6bcae";
      g.fillRect(gx - gw * 1.5, gBase - gh * 0.2, gw * 3, gh * 0.2);
      g.fillStyle = "#8d8478";
      g.fillRect(gx - gw * 1.6, gBase - gh * 0.25, gw * 3.2, gh * 0.06);

      // Tapered white tower.
      g.fillStyle = "#f0ece2";
      g.beginPath();
      g.moveTo(gx - gw * 0.5, gBase);
      g.lineTo(gx - gw * 0.34, gBase - gh * 0.82);
      g.lineTo(gx + gw * 0.34, gBase - gh * 0.82);
      g.lineTo(gx + gw * 0.5, gBase);
      g.closePath();
      g.fill();
      g.fillStyle = "rgba(90,80,74,0.18)";
      g.beginPath();
      g.moveTo(gx + gw * 0.16, gBase);
      g.lineTo(gx + gw * 0.12, gBase - gh * 0.82);
      g.lineTo(gx + gw * 0.34, gBase - gh * 0.82);
      g.lineTo(gx + gw * 0.5, gBase);
      g.closePath();
      g.fill();

      // Gallery and lantern room.
      g.fillStyle = "#3a3d45";
      g.fillRect(gx - gw * 0.62, gBase - gh * 0.88, gw * 1.24, gh * 0.06);
      g.fillStyle = "#2f333c";
      g.fillRect(gx - gw * 0.42, gBase - gh * 1.0, gw * 0.84, gh * 0.13);
      g.fillStyle = "rgba(255,240,196,0.95)";
      g.fillRect(gx - gw * 0.3, gBase - gh * 0.98, gw * 0.6, gh * 0.09);
      g.fillStyle = "#3a3d45";
      g.beginPath();
      g.moveTo(gx - gw * 0.42, gBase - gh * 1.0);
      g.lineTo(gx, gBase - gh * 1.09);
      g.lineTo(gx + gw * 0.42, gBase - gh * 1.0);
      g.closePath();
      g.fill();

      // The light itself, and its beam out over the water.
      glowBall(g, gx, gBase - gh * 0.94, gh * 0.5,
        "rgba(255,238,186,0.7)", "rgba(255,220,150,0)");
      g.save();
      g.globalAlpha = 0.16;
      g.fillStyle = "rgba(255,240,200,1)";
      g.beginPath();
      g.moveTo(gx, gBase - gh * 0.94);
      g.lineTo(-W * 0.1, hz + H * 0.02);
      g.lineTo(-W * 0.1, hz + H * 0.13);
      g.closePath();
      g.fill();
      g.restore();

      // Reflections and chop.
      shimmer(g, W, hz + H * 0.05, H, rng, (a) => "rgba(255,214,180," + a.toFixed(3) + ")", 60);
      for (let i = 0; i < 70; i++) {
        const y = hz + H * 0.05 + rng() * (H - hz - H * 0.05);
        const t = (y - hz) / (H - hz);
        g.fillStyle = "rgba(255,232,190," + ((0.16 - t * 0.1) * rng()).toFixed(3) + ")";
        g.fillRect(gx + (rng() - 0.5) * W * 0.16 * (1 + t * 3), y,
          Math.max(1, W * 0.006 * (1 + t * 2)), Math.max(1, H * 0.004));
      }

      fogBank(g, W, rockBot + H * 0.01, H * 0.035, rng, 0.4,
        (a) => "rgba(226,224,238," + clamp(a, 0, 1).toFixed(3) + ")", 10);

      // Gulls.
      g.strokeStyle = "rgba(30,28,40,0.5)";
      g.lineWidth = Math.max(1, 1.5 * s);
      for (let i = 0; i < 4; i++) {
        const x = W * (0.12 + rng() * 0.76);
        const y = H * (0.12 + rng() * 0.22);
        const w = W * (0.016 + rng() * 0.02);
        g.beginPath();
        g.moveTo(x - w, y);
        g.quadraticCurveTo(x - w * 0.5, y - w * 0.62, x, y);
        g.quadraticCurveTo(x + w * 0.5, y - w * 0.62, x + w, y);
        g.stroke();
      }
    }

    // Each picture hides one fact. The rule for these: nothing a San Franciscan
    // would already trot out. No orange paint, no Rock escapes, no Karl.
    const PLACES = [
      {
        id: "golden_gate",
        name: "Golden Gate Bridge",
        paint: sceneGoldenGate,
        fact: "Charles Ellis did the engineering that holds this up. Strauss forced him off the job in 1931, took the credit, and the record was corrected only in 2007."
      },
      {
        id: "alcatraz",
        name: "Alcatraz Island",
        paint: sceneAlcatraz,
        fact: "Long before the cellhouse, this rock carried the first lighthouse ever lit on the Pacific coast, in 1854."
      },
      {
        id: "painted_ladies",
        name: "The Painted Ladies",
        paint: scenePaintedLadies,
        fact: "Surplus battleship grey covered these houses for decades. The colour returned only after 1963, when one artist defied the block."
      },
      {
        id: "bay_bridge",
        name: "Bay Bridge",
        paint: sceneBayBridge,
        fact: "Until 1958 the lower deck carried electric commuter trains rather than cars."
      },
      {
        id: "fort_point",
        name: "Fort Point",
        paint: sceneFortPoint,
        fact: "That arch exists for one reason: so the bridge could vault this 1861 fort instead of demolishing it."
      },
      {
        id: "hyde_street",
        name: "Hyde Street",
        paint: sceneHydeStreet,
        fact: "No cable car has an engine. Each grips a cable that never stops moving, at a flat 9.5 mph."
      },
      {
        id: "coit_tower",
        name: "Coit Tower",
        paint: sceneCoitTower,
        fact: "Its 1934 murals were branded communist, and a hammer and sickle was scrubbed off the wall before the doors could open."
      },
      {
        id: "ocean_beach",
        name: "Ocean Beach",
        paint: sceneOceanBeach,
        fact: "The clipper King Philip broke apart here in 1878 and still surfaces through the sand at the lowest tides."
      },
      {
        id: "downtown",
        name: "Financial District",
        paint: sceneDowntown,
        fact: "Dozens of Gold Rush ships lie buried under these streets, abandoned in 1849; construction crews still hit their hulls."
      }
    ];

    // ====================================================================== //
    // The fact, baked into the picture so rubbing uncovers it                //
    // ====================================================================== //

    function wrapLines(g2, text, maxWidth) {
      const words = text.split(" ");
      const out = [];
      let line = "";
      for (let i = 0; i < words.length; i++) {
        const test = line ? line + " " + words[i] : words[i];
        if (line && g2.measureText(test).width > maxWidth) {
          out.push(line);
          line = words[i];
        } else {
          line = test;
        }
      }
      if (line) out.push(line);
      return out;
    }

    function trackedText(g2, text, x, y, extra) {
      let cx = x;
      for (let i = 0; i < text.length; i++) {
        const ch = text.charAt(i);
        g2.fillText(ch, cx, y);
        cx += g2.measureText(ch).width + extra;
      }
      return cx - x;
    }

    /** The full picture: the scene, then its fact laid into the lower third. */
    function paintPage(g2, W, H, index, safeBottom) {
      const place = PLACES[index];
      place.paint(g2, W, H);

      const bodySize = clamp(W * 0.047, 13, 22);
      const nameSize = clamp(W * 0.032, 9.5, 14);
      const pad = Math.max(18, W * 0.075);
      const maxW = W - pad * 2;

      g2.font = "500 " + bodySize.toFixed(1) + "px -apple-system,system-ui,sans-serif";
      const lines = wrapLines(g2, place.fact, maxW);
      const lineH = bodySize * 1.46;
      const blockH = nameSize * 2.8 + lines.length * lineH;
      const bottom = H - safeBottom - Math.max(24, H * 0.04);
      const top = bottom - blockH;

      // A scrim, so the words hold up over a bright sky or a dark bay alike.
      const scrimTop = Math.max(0, top - H * 0.17);
      const scrim = g2.createLinearGradient(0, scrimTop, 0, H);
      scrim.addColorStop(0, "rgba(6,7,14,0)");
      scrim.addColorStop(0.38, "rgba(6,7,14,0.6)");
      scrim.addColorStop(0.7, "rgba(6,7,14,0.87)");
      scrim.addColorStop(1, "rgba(6,7,14,0.96)");
      g2.fillStyle = scrim;
      g2.fillRect(0, scrimTop, W, H - scrimTop);

      g2.textAlign = "left";
      g2.textBaseline = "alphabetic";

      g2.font = "700 " + nameSize.toFixed(1) + "px -apple-system,system-ui,sans-serif";
      g2.fillStyle = "rgba(255,206,150,0.96)";
      const nameY = top + nameSize;
      trackedText(g2, place.name.toUpperCase(), pad, nameY, nameSize * 0.19);

      g2.fillStyle = "rgba(255,206,150,0.4)";
      g2.fillRect(pad, nameY + nameSize * 0.72, W * 0.13, Math.max(1, W * 0.0035));

      g2.font = "500 " + bodySize.toFixed(1) + "px -apple-system,system-ui,sans-serif";
      g2.fillStyle = "rgba(247,243,237,0.98)";
      let y = top + nameSize * 2.8 + bodySize * 0.82;
      for (let i = 0; i < lines.length; i++) {
        g2.fillText(lines[i], pad, y);
        y += lineH;
      }
    }

    // ====================================================================== //
    // Surfaces                                                               //
    // ====================================================================== //

    const canvas = ctx.createCanvas2D({ touchAction: "none" });
    const g = canvas.getContext("2d");
    const ui = ctx.createRoot({ touchAction: "none" });
    ui.style.pointerEvents = "none";

    /**
     * Offscreen drawing surface. The runtime owns every canvas in the DOM and
     * document.createElement("canvas") is rejected at upload, so bakes go to an
     * OffscreenCanvas. Without one, makeSurface returns null and the bit runs
     * the plainer ImageData path below.
     */
    const CAN_BAKE = typeof OffscreenCanvas === "function";
    function makeSurface(w, h) {
      if (!CAN_BAKE) return null;
      try {
        const c = new OffscreenCanvas(Math.max(1, w | 0), Math.max(1, h | 0));
        return c.getContext("2d") ? c : null;
      } catch (_) {
        return null;
      }
    }

    const DP = () => (ctx.width > 0 ? canvas.width / ctx.width : 1);
    const PX = Math.min(ctx.dpr || 1, 2);   // supersampling for the baked picture
    const MASK_PX = 1;                      // the brush is soft; CSS res is plenty

    // ====================================================================== //
    // Layout — the picture is the whole screen                               //
    // ====================================================================== //

    let L = { W: ctx.width, H: ctx.height, top: 0, bot: 0 };

    function layout() {
      L = {
        W: ctx.width,
        H: ctx.height,
        top: (ctx.safeArea && ctx.safeArea.top) || 0,
        bot: (ctx.safeArea && ctx.safeArea.bottom) || 0
      };
      FCOLS = clamp(Math.round(L.W / 13), 18, 40);
      FROWS = Math.max(6, Math.round(FCOLS * (L.H / L.W)));
      CCOLS = Math.ceil(FCOLS / 3);
      CROWS = Math.ceil(FROWS / 3);
    }

    // ====================================================================== //
    // The mosaic grids                                                       //
    // ====================================================================== //

    let FCOLS = 0, FROWS = 0, CCOLS = 0, CROWS = 0;
    const SHADE_MUL = [0.72, 0.85, 0.95, 1.03, 1.13, 1.26];
    const SHADES = SHADE_MUL.length;
    const RCOLS = 20, RROWS = 40;
    const DONE_AT = 0.72;

    layout();

    function shadeTable(grid, count) {
      const out = new Array(count);
      for (let i = 0; i < count; i++) {
        const r = grid[i * 3], gg = grid[i * 3 + 1], b = grid[i * 3 + 2];
        const arr = new Array(SHADES);
        for (let k = 0; k < SHADES; k++) {
          const m = SHADE_MUL[k];
          arr[k] = "rgb(" + (clamp(r * m, 0, 255) | 0) + "," +
            (clamp(gg * m, 0, 255) | 0) + "," + (clamp(b * m, 0, 255) | 0) + ")";
        }
        out[i] = arr;
      }
      return out;
    }

    /** Average the baked picture into a fine grid, then fold that 3x3 into a
     *  coarse one. Every shade string is pre-built here so the frame loop never
     *  does string work per cell. */
    function buildGrids(page, img) {
      const iw = img.width, ih = img.height, data = img.data;
      const fine = new Float32Array(FCOLS * FROWS * 3);
      const step = 2;
      for (let cy = 0; cy < FROWS; cy++) {
        const y0 = Math.floor((cy * ih) / FROWS);
        const y1 = Math.max(y0 + 1, Math.floor(((cy + 1) * ih) / FROWS));
        for (let cx = 0; cx < FCOLS; cx++) {
          const x0 = Math.floor((cx * iw) / FCOLS);
          const x1 = Math.max(x0 + 1, Math.floor(((cx + 1) * iw) / FCOLS));
          let r = 0, gg = 0, b = 0, n = 0;
          for (let y = y0; y < y1; y += step) {
            let o = (y * iw + x0) * 4;
            for (let x = x0; x < x1; x += step) {
              r += data[o]; gg += data[o + 1]; b += data[o + 2]; n++;
              o += 4 * step;
            }
          }
          if (!n) n = 1;
          const k = (cy * FCOLS + cx) * 3;
          fine[k] = r / n; fine[k + 1] = gg / n; fine[k + 2] = b / n;
        }
      }

      const coarse = new Float32Array(CCOLS * CROWS * 3);
      for (let cy = 0; cy < CROWS; cy++) {
        for (let cx = 0; cx < CCOLS; cx++) {
          let r = 0, gg = 0, b = 0, n = 0;
          for (let y = cy * 3; y < Math.min(FROWS, cy * 3 + 3); y++) {
            for (let x = cx * 3; x < Math.min(FCOLS, cx * 3 + 3); x++) {
              const k = (y * FCOLS + x) * 3;
              r += fine[k]; gg += fine[k + 1]; b += fine[k + 2]; n++;
            }
          }
          if (!n) n = 1;
          const k2 = (cy * CCOLS + cx) * 3;
          coarse[k2] = r / n; coarse[k2 + 1] = gg / n; coarse[k2 + 2] = b / n;
        }
      }

      page.fineShades = shadeTable(fine, FCOLS * FROWS);
      page.coarseShades = shadeTable(coarse, CCOLS * CROWS);
      const rng = mulberry32(20260812);
      page.cellPhase = new Float32Array(FCOLS * FROWS);
      for (let i = 0; i < page.cellPhase.length; i++) page.cellPhase[i] = rng() * TAU;
      page.ready = true;
    }

    /** One frame of the living mosaic, drawn into g2 across (W, H). */
    function drawMosaic(g2, W, H, page, timeMs) {
      if (!page.ready) return;
      const t = timeMs * 0.001;

      const ccw = W / CCOLS, cch = H / CROWS;
      for (let y = 0; y < CROWS; y++) {
        for (let x = 0; x < CCOLS; x++) {
          const idx = clamp(2 + (fsin(t * 0.9 + (x * 3 + y * 5) * 0.5) * 2.2) | 0, 0, SHADES - 1);
          g2.fillStyle = page.coarseShades[y * CCOLS + x][idx];
          g2.fillRect(x * ccw, y * cch, ccw + 0.8, cch + 0.8);
        }
      }

      const cw = W / FCOLS, ch = H / FROWS;
      for (let y = 0; y < FROWS; y++) {
        const rowW = y * 0.1;
        for (let x = 0; x < FCOLS; x++) {
          const wv = 0.5 + 0.5 * fsin(x * 0.16 + rowW - t * 1.15);
          const a = 1 - wv * wv;
          if (a < 0.04) continue;
          const i = y * FCOLS + x;
          const phase = page.cellPhase[i];
          const idx = clamp((2 + (fsin(t * 1.7 + phase) * 2.6)) | 0, 0, SHADES - 1);
          g2.globalAlpha = a;
          g2.fillStyle = page.fineShades[i][idx];
          const k = 0.86 + 0.14 * (0.5 + 0.5 * fsin(t * 2.1 + phase * 1.7));
          const bw = cw * k, bh = ch * k;
          g2.fillRect(x * cw + (cw - bw) * 0.5, y * ch + (ch - bh) * 0.5, bw + 0.5, bh + 0.5);
        }
      }
      g2.globalAlpha = 1;
    }

    // ====================================================================== //
    // Pages                                                                  //
    // ====================================================================== //

    const revealedSet = new Set();
    let storageOk = !!(ctx.capabilities && ctx.capabilities.storage);
    if (storageOk) {
      try {
        const saved = await ctx.storage.get("revealed_v2");
        if (Array.isArray(saved)) for (const id of saved) revealedSet.add(id);
      } catch (_) {
        storageOk = false;
      }
    }
    function persistRevealed() {
      if (!storageOk) return;
      try { ctx.storage.set("revealed_v2", Array.from(revealedSet)); } catch (_) { /* non-fatal */ }
    }

    let brush = null;
    function brushRadius() {
      return clamp(Math.min(L.W, L.H) * 0.1, 24, 62);
    }
    function makeBrush(r) {
      const size = Math.max(4, Math.round(r * 2 * MASK_PX));
      const sf = makeSurface(size, size);
      if (!sf) return null;
      const bg = sf.getContext("2d");
      const c = size / 2;
      const grad = bg.createRadialGradient(c, c, 0, c, c, c);
      grad.addColorStop(0, "rgba(255,255,255,1)");
      grad.addColorStop(0.45, "rgba(255,255,255,0.93)");
      grad.addColorStop(0.78, "rgba(255,255,255,0.42)");
      grad.addColorStop(1, "rgba(255,255,255,0)");
      bg.fillStyle = grad;
      bg.beginPath();
      bg.arc(c, c, c, 0, TAU);
      bg.fill();
      return sf;
    }

    const pages = new Map();

    function makePage(i) {
      const W = L.W, H = L.H;
      const page = {
        i: i,
        crisp: null,
        mask: null,
        crispData: null,      // fallback path only
        painted: false,       // fallback path only
        finalPainted: false,  // fallback path only
        fineShades: null,
        coarseShades: null,
        cellPhase: null,
        ready: false,
        revealCells: new Uint8Array(RCOLS * RROWS),
        revealCount: 0,
        revealBox: null,
        stamps: [],
        done: revealedSet.has(PLACES[i].id) ? false : false,
        autoFill: 0,
        everRubbed: false
      };

      if (CAN_BAKE) {
        page.crisp = makeSurface(W * PX, H * PX);
        if (page.crisp) {
          const cg = page.crisp.getContext("2d");
          cg.save();
          cg.scale(PX, PX);
          paintPage(cg, W, H, i, L.bot);
          cg.restore();
          try {
            buildGrids(page, cg.getImageData(0, 0, page.crisp.width, page.crisp.height));
          } catch (_) {
            page.ready = false;
          }
        }
        page.mask = makeSurface(W * MASK_PX, H * MASK_PX);
      }
      return page;
    }

    function getPage(i) {
      const k = ((i % PLACES.length) + PLACES.length) % PLACES.length;
      if (!pages.has(k)) pages.set(k, makePage(k));
      return pages.get(k);
    }

    function trimPages(center) {
      const keep = new Set([wrapIndex(center - 1), center, wrapIndex(center + 1)]);
      for (const k of Array.from(pages.keys())) {
        if (!keep.has(k)) pages.delete(k);
      }
    }

    function wrapIndex(i) {
      return ((i % PLACES.length) + PLACES.length) % PLACES.length;
    }

    let index = 0;
    let dragX = 0;            // live horizontal offset while swiping
    let slide = null;         // { from, to, dir } settle animation

    // ====================================================================== //
    // Rubbing                                                                //
    // ====================================================================== //

    function markReveal(page, x, y, r) {
      const c0 = clamp(Math.floor(((x - r) / L.W) * RCOLS), 0, RCOLS - 1);
      const c1 = clamp(Math.floor(((x + r) / L.W) * RCOLS), 0, RCOLS - 1);
      const r0 = clamp(Math.floor(((y - r) / L.H) * RROWS), 0, RROWS - 1);
      const r1 = clamp(Math.floor(((y + r) / L.H) * RROWS), 0, RROWS - 1);
      for (let ry = r0; ry <= r1; ry++) {
        for (let rx = c0; rx <= c1; rx++) {
          const i = ry * RCOLS + rx;
          if (!page.revealCells[i]) { page.revealCells[i] = 1; page.revealCount++; }
        }
      }
      const b = page.revealBox;
      if (!b) {
        page.revealBox = { x0: x - r, y0: y - r, x1: x + r, y1: y + r };
      } else {
        if (x - r < b.x0) b.x0 = x - r;
        if (y - r < b.y0) b.y0 = y - r;
        if (x + r > b.x1) b.x1 = x + r;
        if (y + r > b.y1) b.y1 = y + r;
      }
    }

    function stampAt(page, x, y) {
      const r = brushRadius();
      if (page.mask) {
        const mg = page.mask.getContext("2d");
        if (brush) {
          mg.drawImage(brush, (x - r) * MASK_PX, (y - r) * MASK_PX,
            r * 2 * MASK_PX, r * 2 * MASK_PX);
        } else {
          mg.fillStyle = "#fff";
          mg.beginPath();
          mg.arc(x * MASK_PX, y * MASK_PX, r * MASK_PX, 0, TAU);
          mg.fill();
        }
      } else if (page.stamps.length < 700) {
        page.stamps.push({ x: x, y: y, r: r * 0.85 });
      }
      markReveal(page, x, y, r * 0.78);
    }

    function revealFraction(page) {
      return page.revealCount / (RCOLS * RROWS);
    }

    // ====================================================================== //
    // Audio                                                                  //
    // ====================================================================== //

    let music = null;
    let started = false;
    const canMusic = !!(ctx.capabilities && ctx.capabilities.backgroundMusic);
    const canHaptic = !!(ctx.capabilities && ctx.capabilities.haptics);
    const canAudio = !!(ctx.capabilities && ctx.capabilities.audio);

    function haptic(kind) {
      if (canHaptic) { try { ctx.platform.haptic(kind); } catch (_) { /* ignore */ } }
    }
    function sting(name) {
      if (!canMusic) return;
      try { ctx.music.sting(name); } catch (_) { /* ignore */ }
    }

    // ---- synthesis -------------------------------------------------------- //
    // The rub is the whole interaction and ctx.music has no gesture-following
    // texture, so this one bed is synthesised: looping noise through a bandpass
    // whose gain and cutoff track how fast the finger is actually moving. It is
    // all filtered noise — no oscillators — apart from the clearing shimmer.

    let ac = null, master = null, noiseBuf = null, audioDead = false;
    let rubSrc = null, rubFilter = null, rubGain = null;
    let bodySrc = null, bodyFilter = null, bodyGain = null;

    function buildAudio() {
      if (ac || audioDead || !canAudio) return ac;
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) { audioDead = true; return null; }
      try { ac = new AC(); } catch (_) { audioDead = true; return null; }

      master = ac.createGain();
      master.gain.value = 0.9;
      const comp = ac.createDynamicsCompressor();
      comp.threshold.value = -18; comp.ratio.value = 3.5;
      comp.attack.value = 0.004; comp.release.value = 0.25;
      master.connect(comp);
      comp.connect(ac.destination);

      noiseBuf = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate);
      const nd = noiseBuf.getChannelData(0);
      for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;

      // The rasp you hear directly under the fingertip.
      rubFilter = ac.createBiquadFilter();
      rubFilter.type = "bandpass";
      rubFilter.frequency.value = 900;
      rubFilter.Q.value = 1.1;
      rubGain = ac.createGain();
      rubGain.gain.value = 0;
      rubSrc = ac.createBufferSource();
      rubSrc.buffer = noiseBuf; rubSrc.loop = true;
      rubSrc.connect(rubFilter); rubFilter.connect(rubGain); rubGain.connect(master);
      try { rubSrc.start(0); } catch (_) { /* ignore */ }

      // A little low body under it, so it reads as weight rather than hiss.
      bodyFilter = ac.createBiquadFilter();
      bodyFilter.type = "lowpass";
      bodyFilter.frequency.value = 320;
      bodyFilter.Q.value = 0.7;
      bodyGain = ac.createGain();
      bodyGain.gain.value = 0;
      bodySrc = ac.createBufferSource();
      bodySrc.buffer = noiseBuf; bodySrc.loop = true;
      bodySrc.connect(bodyFilter); bodyFilter.connect(bodyGain); bodyGain.connect(master);
      try { bodySrc.start(0); } catch (_) { /* ignore */ }

      ctx.onDestroy(() => { try { ac.close(); } catch (_) { /* ignore */ } });
      return ac;
    }

    let resuming = false;
    function unlockAudio() {
      if (!buildAudio()) return;
      if (ac.state !== "running" && !resuming) {
        resuming = true;
        let p;
        try { p = ac.resume(); } catch (_) { resuming = false; }
        if (p && p.then) p.then(() => { resuming = false; }, () => { resuming = false; });
        else resuming = false;
      }
      try {
        const s = ac.createBufferSource();
        s.buffer = ac.createBuffer(1, 1, ac.sampleRate || 22050);
        s.connect(ac.destination);
        s.start(0);
      } catch (_) { /* ignore */ }
    }

    let rubSpeed = 0;        // smoothed finger speed, CSS px per ms
    let rubActive = false;

    /** Drive the rub bed. `bright` (0..1) opens the filter as more is cleared,
     *  so the texture thins out as the picture comes up. */
    function updateRubAudio(bright) {
      if (!ac || !rubGain) return;
      const t = ac.currentTime;
      const s = clamp(rubSpeed / 1.1, 0, 1);   // ~1100 px/s reads as a full scrub
      const on = rubActive ? 1 : 0;
      rubGain.gain.setTargetAtTime(on * (0.012 + 0.16 * s), t, rubActive ? 0.02 : 0.07);
      bodyGain.gain.setTargetAtTime(on * (0.006 + 0.05 * s), t, rubActive ? 0.03 : 0.09);
      rubFilter.frequency.setTargetAtTime(620 + 2100 * s + 700 * bright, t, 0.05);
      rubFilter.Q.setTargetAtTime(1.1 + 1.6 * s, t, 0.08);
    }

    /** A short filtered-noise sweep for turning to the next place. */
    function whoosh(dir) {
      if (!buildAudio() || ac.state !== "running") return;
      const t = ac.currentTime;
      const src = ac.createBufferSource();
      src.buffer = noiseBuf;
      const bp = ac.createBiquadFilter();
      bp.type = "bandpass";
      bp.Q.value = 1.4;
      bp.frequency.setValueAtTime(dir > 0 ? 380 : 2000, t);
      bp.frequency.exponentialRampToValueAtTime(dir > 0 ? 2000 : 380, t + 0.3);
      const out = ac.createGain();
      out.gain.setValueAtTime(0.0001, t);
      out.gain.linearRampToValueAtTime(0.1, t + 0.05);
      out.gain.exponentialRampToValueAtTime(0.0001, t + 0.34);
      src.connect(bp); bp.connect(out); out.connect(master);
      try { src.start(t); src.stop(t + 0.36); } catch (_) { /* ignore */ }
    }

    /** A soft click for tapping a dot. */
    function tick() {
      if (!buildAudio() || ac.state !== "running") return;
      const t = ac.currentTime;
      const src = ac.createBufferSource();
      src.buffer = noiseBuf;
      const hp = ac.createBiquadFilter();
      hp.type = "highpass";
      hp.frequency.value = 1800;
      const out = ac.createGain();
      out.gain.setValueAtTime(0.06, t);
      out.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);
      src.connect(hp); hp.connect(out); out.connect(master);
      try { src.start(t); src.stop(t + 0.08); } catch (_) { /* ignore */ }
    }

    /** The picture is clear: a small rising shimmer, four partials staggered. */
    function shimmer() {
      if (!buildAudio() || ac.state !== "running") return;
      const t = ac.currentTime;
      const partials = [523.25, 659.25, 783.99, 1046.5];
      for (let i = 0; i < partials.length; i++) {
        const osc = ac.createOscillator();
        osc.type = "sine";
        osc.frequency.value = partials[i];
        const out = ac.createGain();
        const at = t + i * 0.075;
        out.gain.setValueAtTime(0.0001, at);
        out.gain.linearRampToValueAtTime(0.075 - i * 0.011, at + 0.03);
        out.gain.exponentialRampToValueAtTime(0.0001, at + 1.5);
        osc.connect(out); out.connect(master);
        try { osc.start(at); osc.stop(at + 1.6); } catch (_) { /* ignore */ }
      }
      if (canMusic) { try { ctx.music.duck(0.35, 900); } catch (_) { /* ignore */ } }
    }

    async function firstGesture() {
      if (started) return;
      started = true;
      ctx.platform.start();
      unlockAudio();
      if (!canMusic) return;
      try {
        await ctx.music.unlock();
        music = ctx.music.play({
          preset: "drift", volume: 0.28, tempo: 62,
          intensity: 0.28, scale: "pentatonic", fadeInMs: 2400
        });
      } catch (_) {
        music = null;
      }
    }

    // ====================================================================== //
    // Chrome                                                                 //
    // ====================================================================== //

    function el(tag, css, html) {
      const n = tag === "button" ? document.createElement("button") : document.createElement("div");
      if (css) n.style.cssText = css;
      if (html != null) n.innerHTML = html;
      return n;
    }

    const FONT = "font-family:inherit;-webkit-tap-highlight-color:transparent;";
    const CHIP = FONT + "pointer-events:auto;border:0;cursor:pointer;color:#f3eee8;" +
      "background:rgba(16,16,24,0.5);border:1px solid rgba(255,255,255,0.16);" +
      "backdrop-filter:blur(9px);-webkit-backdrop-filter:blur(9px);" +
      "border-radius:999px;font-weight:700;";

    const dots = el("div", "position:absolute;left:0;right:0;display:flex;gap:2px;" +
      "justify-content:center;align-items:center;pointer-events:none;");
    ui.appendChild(dots);
    const dotEls = [];
    for (let i = 0; i < PLACES.length; i++) {
      // Each dot is a padded hit target wrapping the visible pip, so jumping
      // straight to a place is always possible without any gesture at all.
      const hit = el("div", FONT + "pointer-events:auto;cursor:pointer;padding:9px 4px;" +
        "display:flex;align-items:center;justify-content:center;");
      const pip = el("div", "width:6px;height:6px;border-radius:99px;" +
        "background:rgba(255,255,255,0.3);transition:width 0.25s,background 0.25s;");
      hit.appendChild(pip);
      dots.appendChild(hit);
      dotEls.push(pip);
      ctx.listen(hit, "click", () => {
        if (slide || i === index) return;
        firstGesture();
        index = i;
        dragX = 0;
        trimPages(index);
        haptic("light");
        tick();
        ctx.platform.interact({ type: "jump", place: PLACES[index].id });
        syncChrome();
      });
    }

    const hint = el("div", "position:absolute;left:58px;right:58px;text-align:center;pointer-events:none;" +
      "color:#f4efe8;font-size:12px;font-weight:600;letter-spacing:0.06em;opacity:0.85;" +
      "text-shadow:0 2px 12px rgba(0,0,0,0.8);transition:opacity 0.6s;");
    ui.appendChild(hint);

    const helpBtn = el("button", CHIP + "position:absolute;width:29px;height:29px;font-size:14px;" +
      "display:flex;align-items:center;justify-content:center;padding:0;opacity:0.75;", "?");
    ui.appendChild(helpBtn);

    const panel = el("div", "position:absolute;left:0;right:0;top:0;bottom:0;display:none;" +
      "align-items:center;justify-content:center;padding:24px;pointer-events:auto;" +
      "background:rgba(8,8,14,0.74);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);");
    const card = el("div", FONT + "max-width:330px;color:#f2ede6;background:rgba(24,22,32,0.96);" +
      "border:1px solid rgba(255,255,255,0.1);border-radius:22px;padding:22px 20px 18px;" +
      "box-shadow:0 20px 60px rgba(0,0,0,0.55);");
    card.innerHTML =
      '<div style="font-size:16px;font-weight:800;margin-bottom:12px;">How it works</div>' +
      '<div style="font-size:13.5px;line-height:1.75;opacity:0.9;">' +
      '&bull;&nbsp; Every picture starts buried under living pixels.<br>' +
      '&bull;&nbsp; Rub with your finger to clear them away.<br>' +
      '&bull;&nbsp; Underneath is a place in San Francisco — and one fact about it you almost certainly do not know.<br>' +
      '&bull;&nbsp; Clear most of it and the rest falls away on its own.<br>' +
      '&bull;&nbsp; Once it is clear, swipe sideways for the next place.<br>' +
      '&bull;&nbsp; To leave one early, tap a dot at the top. There are nine.' +
      '</div>';
    const cardBtn = el("button", CHIP + "margin-top:16px;width:100%;padding:11px 0;font-size:14px;" +
      "background:rgba(255,255,255,0.14);", "Got it");
    card.appendChild(cardBtn);
    panel.appendChild(card);
    ui.appendChild(panel);

    function placeChrome() {
      dots.style.top = (L.top + 8) + "px";
      hint.style.top = (L.top + 42) + "px";
      helpBtn.style.top = (L.top + 10) + "px";
      helpBtn.style.right = Math.max(12, L.W * 0.04) + "px";
    }

    function syncChrome() {
      for (let i = 0; i < dotEls.length; i++) {
        const on = i === index;
        dotEls[i].style.width = on ? "18px" : "6px";
        dotEls[i].style.background = on
          ? "rgba(255,214,150,0.95)"
          : (revealedSet.has(PLACES[i].id) ? "rgba(255,214,150,0.45)" : "rgba(255,255,255,0.28)");
      }
      const page = getPage(index);
      if (page.done) hint.textContent = "swipe for the next place";
      else if (page.everRubbed) hint.textContent = "";
      else hint.textContent = "rub away the pixels";
      hint.style.opacity = hint.textContent ? "0.85" : "0";
    }

    ctx.listen(helpBtn, "click", () => { panel.style.display = "flex"; haptic("light"); });
    ctx.listen(cardBtn, "click", () => { panel.style.display = "none"; haptic("light"); });

    // ====================================================================== //
    // Gestures — one drag is either a rub or a swipe, never both             //
    // ====================================================================== //

    // offsetX/offsetY are already canvas-relative, which keeps us off the
    // layout-box query the upload validator rejects and avoids a forced reflow
    // on every pointer sample.
    function localPoint(e) {
      if (typeof e.offsetX === "number" && typeof e.offsetY === "number") {
        return { x: e.offsetX, y: e.offsetY };
      }
      return { x: e.clientX, y: e.clientY };
    }

    let gesture = null;
    let lastInteract = 0;
    let lastRubHaptic = 0;

    ctx.listen(canvas, "pointerdown", (e) => {
      if (panel.style.display === "flex") return;
      if (slide) return;
      const p = localPoint(e);
      firstGesture();
      if (canvas.setPointerCapture) {
        try { canvas.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
      }
      gesture = {
        x0: p.x, y0: p.y, t0: e.timeStamp || 0,
        lx: p.x, ly: p.y,
        kind: null,                 // null until the drag declares itself
        buffer: [{ x: p.x, y: p.y }],
        dist: 0
      };
    });

    ctx.listen(canvas, "pointermove", (e) => {
      if (!gesture || panel.style.display === "flex") return;
      const p = localPoint(e);
      const dx = p.x - gesture.x0;
      const dy = p.y - gesture.y0;
      const adx = Math.abs(dx), ady = Math.abs(dy);
      const dt = Math.max(1, (e.timeStamp || 0) - gesture.t0);
      gesture.dist += Math.hypot(p.x - gesture.lx, p.y - gesture.ly);

      if (gesture.kind === null) {
        const page = getPage(index);
        // Rubbing a picture clean *is* a fast horizontal scrub, so no mix of
        // velocity, straightness or direction can tell a rub from a swipe.
        // Nor can a screen-edge zone: rubbing edge to edge starts there too.
        // So the rule is binary and has no false positives — while pixels
        // remain, every drag rubs; once the picture is clear there is nothing
        // left to rub and any sideways drag pages. To leave a picture early,
        // tap a dot at the top.
        const horizontal = adx >= 1.8 * ady;
        const canSwipe = page.done;

        const needDx = page.done ? 30 : 44;
        if (canSwipe && horizontal && adx >= needDx) {
          gesture.kind = "swipe";
          gesture.buffer = null;
        } else if (canSwipe && horizontal && dt <= 320) {
          // Still short of the threshold but travelling like a swipe — keep
          // buffering rather than committing to a rub we would have to undo.
          gesture.buffer.push({ x: p.x, y: p.y });
          gesture.lx = p.x; gesture.ly = p.y;
          return;
        } else if (gesture.dist > 14 || dt > 90) {
          gesture.kind = "rub";
          for (const q of gesture.buffer) stampAt(page, q.x, q.y);
          gesture.buffer = null;
          page.everRubbed = true;
          rubActive = true;
          gesture.lt = (e.timeStamp || 0);
          syncChrome();
        } else {
          gesture.buffer.push({ x: p.x, y: p.y });
          gesture.lx = p.x; gesture.ly = p.y;
          return;
        }
      }

      if (gesture.kind === "swipe") {
        dragX = dx;
        gesture.lx = p.x; gesture.ly = p.y;
        return;
      }

      // Rubbing: stamp along the segment so a fast sweep stays continuous.
      const page = getPage(index);
      if (!page.done) {
        const r = brushRadius();
        const sdx = p.x - gesture.lx, sdy = p.y - gesture.ly;
        const dist = Math.hypot(sdx, sdy);
        const n = Math.min(40, Math.floor(dist / Math.max(2, r * 0.3)));
        for (let i = 1; i <= n; i++) {
          stampAt(page, gesture.lx + (sdx * i) / n, gesture.ly + (sdy * i) / n);
        }
        if (n === 0 && dist > 0.5) stampAt(page, p.x, p.y);

        const now = e.timeStamp || 0;
        const gap = Math.max(1, now - (gesture.lt || gesture.t0));
        rubSpeed = rubSpeed * 0.55 + clamp(dist / gap, 0, 3) * 0.45;
        rubActive = true;
        gesture.lt = now;
        if (now - lastInteract > 400) {
          lastInteract = now;
          ctx.platform.interact({ type: "rub", place: PLACES[index].id });
        }
        if (now - lastRubHaptic > 130) {
          lastRubHaptic = now;
          haptic("light");
        }
      }
      gesture.lx = p.x; gesture.ly = p.y;
    }, { passive: true });

    function endGesture(e) {
      rubActive = false;
      if (!gesture) return;
      const kind = gesture.kind;
      const dx = e ? localPoint(e).x - gesture.x0 : dragX;
      const dt = Math.max(1, ((e && e.timeStamp) || 0) - gesture.t0);

      if (kind === "swipe") {
        const speed = Math.abs(dx) / dt;
        const commit = Math.abs(dx) > L.W * 0.22 || speed > 0.5;
        if (commit) {
          const dir = dx < 0 ? 1 : -1;
          slide = { dir: dir, target: dir > 0 ? -L.W : L.W };
          haptic("light");
          whoosh(dir);
        } else {
          slide = { dir: 0, target: 0 };
        }
      } else if (kind === null && gesture.buffer) {
        // A tap: dab a small opening rather than doing nothing.
        const page = getPage(index);
        if (!page.done) {
          stampAt(page, gesture.x0, gesture.y0);
          page.everRubbed = true;
          haptic("light");
          syncChrome();
        }
      }
      gesture = null;
    }
    ctx.listen(canvas, "pointerup", endGesture);
    ctx.listen(canvas, "pointercancel", () => {
      gesture = null; rubActive = false;
      if (dragX) slide = { dir: 0, target: 0 };
    });
    ctx.listen(canvas, "lostpointercapture", () => { gesture = null; rubActive = false; });

    // ====================================================================== //
    // Rendering                                                              //
    // ====================================================================== //

    let scratch = null;
    function ensureScratch() {
      const want = Math.round(L.W * PX);
      if (!scratch || scratch.width !== want) {
        scratch = makeSurface(L.W * PX, L.H * PX);
      }
      return scratch;
    }

    /** Mosaic, then the crisp picture showing through wherever it was rubbed. */
    function renderPage(page, ox, timeMs) {
      const W = L.W, H = L.H;
      g.save();
      g.translate(ox, 0);
      g.beginPath();
      g.rect(0, 0, W, H);
      g.clip();

      if (page.crisp) {
        if (page.done && page.autoFill >= 1) {
          g.drawImage(page.crisp, 0, 0, W, H);
        } else {
          drawMosaic(g, W, H, page, timeMs);
          const sc = ensureScratch();
          if (sc && page.mask && (page.revealBox || page.autoFill > 0)) {
            const sg = sc.getContext("2d");
            sg.setTransform(1, 0, 0, 1, 0, 0);
            sg.clearRect(0, 0, sc.width, sc.height);
            sg.drawImage(page.crisp, 0, 0, sc.width, sc.height);
            sg.globalCompositeOperation = "destination-in";
            sg.drawImage(page.mask, 0, 0, sc.width, sc.height);
            sg.globalCompositeOperation = "source-over";
            g.drawImage(sc, 0, 0, W, H);
          }
        }
      } else {
        // Fallback: the picture was painted once and kept as ImageData. Restore
        // the rubbed box, then lay the mosaic over everything *except* the rub
        // stamps, so cleared areas keep showing the picture underneath.
        const dp = DP();
        if (page.done) {
          if (!page.finalPainted && page.crispData) {
            g.setTransform(1, 0, 0, 1, 0, 0);
            g.putImageData(page.crispData, ox * dp, 0);
            g.setTransform(dp, 0, 0, dp, 0, 0);
            page.finalPainted = true;
          }
        } else {
          if (page.crispData && page.revealBox) {
            const b = page.revealBox;
            const bx = clamp(Math.floor((b.x0 - 4) * dp), 0, page.crispData.width);
            const by = clamp(Math.floor((b.y0 - 4) * dp), 0, page.crispData.height);
            const bw = clamp(Math.ceil((b.x1 - b.x0 + 8) * dp), 1, page.crispData.width - bx);
            const bh = clamp(Math.ceil((b.y1 - b.y0 + 8) * dp), 1, page.crispData.height - by);
            g.setTransform(1, 0, 0, 1, 0, 0);
            g.putImageData(page.crispData, ox * dp, 0, bx, by, bw, bh);
            g.setTransform(dp, 0, 0, dp, 0, 0);
            g.save();
            g.translate(ox, 0);
            g.beginPath();
            g.rect(0, 0, W, H);
            g.clip();
          }
          g.beginPath();
          g.rect(0, 0, W, H);
          for (const st of page.stamps) {
            g.moveTo(st.x + st.r, st.y);
            g.arc(st.x, st.y, st.r, 0, TAU);
          }
          g.clip("evenodd");
          drawMosaic(g, W, H, page, timeMs);
          if (page.crispData && page.revealBox) g.restore();
        }
      }
      g.restore();
    }

    function draw(timeMs) {
      const W = L.W, H = L.H;
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.scale(DP(), DP());
      g.fillStyle = "#08080e";
      g.fillRect(0, 0, W, H);

      const cur = getPage(index);
      renderPage(cur, dragX, timeMs);

      if (dragX !== 0) {
        const nb = dragX < 0 ? getPage(index + 1) : getPage(index - 1);
        renderPage(nb, dragX < 0 ? dragX + W : dragX - W, timeMs);
      }
    }

    // ====================================================================== //
    // Frame loop                                                             //
    // ====================================================================== //

    let lastW = ctx.width, lastH = ctx.height;
    let readyCalled = false;

    layout();
    brush = makeBrush(brushRadius());
    getPage(0);
    placeChrome();
    syncChrome();

    ctx.onFrame((dtMs, timeMs) => {
      if (ctx.width !== lastW || ctx.height !== lastH) {
        lastW = ctx.width;
        lastH = ctx.height;
        layout();
        pages.clear();
        scratch = null;
        brush = makeBrush(brushRadius());
        dragX = 0;
        slide = null;
        placeChrome();
        syncChrome();
      }

      // Settle a swipe.
      if (slide) {
        const step = (L.W / 260) * dtMs;
        if (slide.target === 0) {
          dragX = dragX > 0 ? Math.max(0, dragX - step) : Math.min(0, dragX + step);
          if (dragX === 0) slide = null;
        } else {
          dragX += slide.dir > 0 ? -step : step;
          if ((slide.dir > 0 && dragX <= slide.target) || (slide.dir < 0 && dragX >= slide.target)) {
            index = wrapIndex(index + slide.dir);
            dragX = 0;
            slide = null;
            trimPages(index);
            ctx.platform.interact({ type: "page", place: PLACES[index].id });
            syncChrome();
          }
        }
      }

      const page = getPage(index);

      // The fallback path paints its picture once, straight to the canvas, and
      // keeps it as ImageData before the mosaic ever covers it.
      if (!page.crisp && !page.painted) {
        const dp = DP();
        g.setTransform(1, 0, 0, 1, 0, 0);
        g.scale(dp, dp);
        paintPage(g, L.W, L.H, page.i, L.bot);
        g.setTransform(1, 0, 0, 1, 0, 0);
        try {
          page.crispData = g.getImageData(0, 0, Math.round(L.W * dp), Math.round(L.H * dp));
          buildGrids(page, page.crispData);
        } catch (_) {
          page.ready = false;
        }
        page.painted = true;
      }

      // Finish the reveal once most of it is gone.
      if (!page.done && page.ready && revealFraction(page) >= DONE_AT) {
        page.done = true;
        haptic("success");
        sting("success");
        shimmer();
        const id = PLACES[page.i].id;
        if (!revealedSet.has(id)) {
          revealedSet.add(id);
          persistRevealed();
          ctx.platform.milestone("place_revealed", { place: id });
        }
        ctx.platform.setProgress(clamp(revealedSet.size / PLACES.length, 0, 1));
        if (revealedSet.size >= PLACES.length) ctx.platform.complete({ places: PLACES.length });
        syncChrome();
      }
      if (page.done && page.autoFill < 1) {
        page.autoFill = clamp(page.autoFill + dtMs / 620, 0, 1);
        if (page.mask) {
          const mg = page.mask.getContext("2d");
          mg.globalAlpha = clamp(dtMs / 620, 0, 1) * 1.5;
          mg.fillStyle = "#fff";
          mg.fillRect(0, 0, page.mask.width, page.mask.height);
          mg.globalAlpha = 1;
        }
        if (page.autoFill >= 1) page.revealBox = { x0: 0, y0: 0, x1: L.W, y1: L.H };
      }

      if (!rubActive) rubSpeed *= Math.exp(-dtMs / 90);
      updateRubAudio(page.ready ? clamp(revealFraction(page) / DONE_AT, 0, 1) : 0);

      draw(timeMs);

      if (!readyCalled) {
        readyCalled = true;
        ctx.markVisualReady("first_page_frame");
        ctx.platform.ready();
      }
    });

    ctx.onDestroy(() => {
      if (music) { try { music.stop({ fadeOutMs: 400 }); } catch (_) { /* ignore */ } }
    });
  }
};
