// Pixel Fog — a mobile-first Plethora Bit.
//
// Nine views of San Francisco, each one painted procedurally at runtime (the
// bit runtime blocks remote images and packaged assets, so every "photograph"
// here is drawn with canvas primitives). Tap a picture to open it, then rub it
// with a finger: wherever you rub, a living mosaic of that same picture blooms
// through — pixel blocks that breathe, shimmer, and ride a slow wave of
// coarseness across the frame. Rub most of it away and the whole picture gives
// itself over to pixels.
//
// Contract notes that shaped the code:
//   * document.createElement("canvas") is rejected by the upload validator, so
//     every offscreen surface is an OffscreenCanvas via makeSurface(). If the
//     WebView has no OffscreenCanvas, makeSurface returns null and the bit
//     falls back to an ImageData-backed path — plainer, fully playable.
//   * canvas.getBoundingClientRect() is rejected too, so pointer positions come
//     from event.offsetX/offsetY, which are already canvas-relative.

window.plethoraBit = {
  meta: {
    title: "Pixel Fog",
    runtime: "plethora-bit@2",
    tags: [
      "art", "photo", "san-francisco", "mosaic", "pixel",
      "touch", "sensory", "generative", "relaxing", "reveal"
    ],
    permissions: ["backgroundMusic", "haptics", "storage"]
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
      const ph = [rng() * TAU, rng() * TAU, rng() * TAU, rng() * TAU];
      const fr = [0.6 + rng() * 0.5, 1.5 + rng() * 0.9, 3.0 + rng() * 1.4, 6.0 + rng() * 2.2];
      const am = [amp, amp * 0.44, amp * 0.2, amp * 0.09];
      const step = Math.max(2, W / 150);
      g.beginPath();
      g.moveTo(-2, H + 2);
      for (let x = -2; x <= W + step; x += step) {
        const u = x / W;
        let y = baseY;
        for (let i = 0; i < 4; i++) y += fsin(u * TAU * fr[i] + ph[i]) * am[i];
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

    // 1 — Golden Gate Bridge, sun going down behind the headlands.
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

    // 2 — The downtown skyline at dusk, seen across the bay.
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

    // 3 — The Painted Ladies on Alamo Square, late afternoon.
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

    // 4 — Coit Tower on Telegraph Hill, bright midday.
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

    // 5 — The Bay Bridge, lit up after dark.
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

    // 6 — Karl the Fog pouring over the hills at dawn.
    function sceneKarlTheFog(g, W, H) {
      const rng = mulberry32(6271);
      const hz = H * 0.42;

      band(g, W, 0, H * 0.75, [
        [0, "#48407f"], [0.28, "#8a6a9c"], [0.55, "#d093a0"],
        [0.78, "#f2b899"], [1, "#fbdcbe"]
      ]);
      glowBall(g, W * 0.68, hz - H * 0.06, H * 0.3,
        "rgba(255,226,190,0.65)", "rgba(255,206,170,0)");
      glowBall(g, W * 0.68, hz - H * 0.06, H * 0.035,
        "rgba(255,250,238,0.95)", "rgba(255,232,196,0)");

      // Four ridges receding into haze, fog rivers pooling between them.
      const layers = [
        { y: hz + H * 0.04, amp: H * 0.035, fill: "#9a86a8", fog: 0.55 },
        { y: hz + H * 0.14, amp: H * 0.045, fill: "#7b6690", fog: 0.6 },
        { y: hz + H * 0.28, amp: H * 0.055, fill: "#584a72", fog: 0.65 },
        { y: hz + H * 0.46, amp: H * 0.07, fill: "#38304f", fog: 0.7 }
      ];
      for (let i = 0; i < layers.length; i++) {
        const L2 = layers[i];
        ridge(g, W, H, L2.y, L2.amp, 700 + i * 37, L2.fill);
        fogBank(g, W, L2.y + H * 0.045, H * 0.06, rng, L2.fog,
          (a) => "rgba(240,232,240," + clamp(a, 0, 1).toFixed(3) + ")", 13);
      }

      // Foreground ridge with a few trees breaking the skyline.
      ridge(g, W, H, H * 0.9, H * 0.05, 909, "#241f38");
      for (let i = 0; i < 5; i++) {
        const cx = W * (0.08 + rng() * 0.85);
        cypress(g, cx, H * (0.9 + rng() * 0.05), H * (0.07 + rng() * 0.06), "#191529", rng);
      }
      fogBank(g, W, H * 0.86, H * 0.05, rng, 0.5,
        (a) => "rgba(226,220,232," + clamp(a, 0, 1).toFixed(3) + ")", 9);
    }

    // 7 — Looking down a steep Russian Hill street to the bay.
    function sceneHydeStreet(g, W, H) {
      const rng = mulberry32(7717);
      const s = Math.min(W, H) / 400;
      const vpY = H * 0.46;
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
          const sc0 = Math.pow(u0, 1.7), sc1 = Math.pow(u1, 1.7);
          const x0 = vpX + side * lerp(roadHalfTop * 1.5, roadHalfBottom * 1.45, sc0);
          const x1 = vpX + side * lerp(roadHalfTop * 1.5, roadHalfBottom * 1.45, sc1);
          const yb0 = lerp(vpY, H, sc0);
          const yb1 = lerp(vpY, H, sc1);
          const hh = lerp(H * 0.07, H * 0.72, sc1);
          const col = houseCols[(i + (side > 0 ? 3 : 0)) % houseCols.length];

          g.fillStyle = col;
          g.beginPath();
          g.moveTo(x0, yb0);
          g.lineTo(x1, yb1);
          g.lineTo(x1, yb1 - hh);
          g.lineTo(x0, yb0 - hh * (yb0 - vpY) / Math.max(1, yb1 - vpY));
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
      const cy = lerp(vpY, H, Math.pow(cu, 1.7));
      const cw = lerp(roadHalfTop, roadHalfBottom, Math.pow(cu, 1.7)) * 0.85;
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

    // 8 — Sutro Tower standing above a sea of fog.
    function sceneSutroTower(g, W, H) {
      const rng = mulberry32(8837);
      const s = Math.min(W, H) / 400;
      const fogTop = H * 0.55;

      band(g, W, 0, fogTop + H * 0.1, [
        [0, "#2b1a4d"], [0.26, "#6b2f61"], [0.5, "#b84a55"],
        [0.72, "#e8834a"], [0.9, "#f7b56d"], [1, "#fdd9a4"]
      ]);
      for (let i = 0; i < 8; i++) {
        const y = H * 0.06 + rng() * H * 0.34;
        const w = W * (0.35 + rng() * 0.7);
        const x = rng() * W - w * 0.3;
        g.fillStyle = "rgba(255,180,140," + (0.08 + rng() * 0.2).toFixed(3) + ")";
        g.beginPath();
        g.ellipse(x, y, w * 0.5, H * (0.006 + rng() * 0.014), 0, 0, TAU);
        g.fill();
      }

      // Hills half-drowned in fog.
      ridge(g, W, H, fogTop - H * 0.01, H * 0.04, 88, "#4a2f52");
      ridge(g, W, H, fogTop + H * 0.06, H * 0.05, 99, "#33223d");

      // --- the tower ------------------------------------------------------- //
      const tx = W * 0.5;
      const baseY = fogTop + H * 0.12;
      const topY = H * 0.06;
      const th = baseY - topY;
      const halfW = W * 0.15;
      const RED = "#a8341f";
      const WHT = "#e9e2d6";
      const lw = Math.max(1.4, 3.6 * s);

      // Three legs: the outer pair splay outward, the centre one runs straight.
      const legs = [
        { x0: tx - halfW, x1: tx - halfW * 0.2 },
        { x0: tx, x1: tx },
        { x0: tx + halfW, x1: tx + halfW * 0.2 }
      ];

      // Cross bracing between adjacent legs, banded red/white by height.
      const bands = 9;
      for (let b = 0; b < bands; b++) {
        const u0 = b / bands, u1 = (b + 1) / bands;
        g.strokeStyle = b % 2 === 0 ? RED : WHT;
        g.lineWidth = lw * 0.5;
        for (let i = 0; i < legs.length - 1; i++) {
          const a0 = lerp(legs[i].x0, legs[i].x1, u0), a1 = lerp(legs[i].x0, legs[i].x1, u1);
          const c0 = lerp(legs[i + 1].x0, legs[i + 1].x1, u0), c1 = lerp(legs[i + 1].x0, legs[i + 1].x1, u1);
          const y0 = baseY - th * u0, y1 = baseY - th * u1;
          g.beginPath();
          g.moveTo(a0, y0); g.lineTo(c1, y1);
          g.moveTo(c0, y0); g.lineTo(a1, y1);
          g.moveTo(a1, y1); g.lineTo(c1, y1);
          g.stroke();
        }
      }

      // The legs themselves.
      for (const leg of legs) {
        for (let b = 0; b < bands; b++) {
          const u0 = b / bands, u1 = (b + 1) / bands;
          g.strokeStyle = b % 2 === 0 ? RED : WHT;
          g.lineWidth = lw;
          g.beginPath();
          g.moveTo(lerp(leg.x0, leg.x1, u0), baseY - th * u0);
          g.lineTo(lerp(leg.x0, leg.x1, u1), baseY - th * u1);
          g.stroke();
        }
      }

      // The three prongs at the crown.
      g.strokeStyle = RED;
      g.lineWidth = lw * 0.8;
      for (const leg of legs) {
        const x = leg.x1;
        g.beginPath();
        g.moveTo(x, topY);
        g.lineTo(x, topY - th * 0.14);
        g.stroke();
      }
      g.strokeStyle = WHT;
      g.lineWidth = lw * 0.45;
      g.beginPath();
      g.moveTo(legs[0].x1, topY - th * 0.05);
      g.lineTo(legs[2].x1, topY - th * 0.05);
      g.stroke();
      // Aircraft warning light.
      glowBall(g, tx, topY - th * 0.15, H * 0.02, "rgba(255,90,70,0.95)", "rgba(255,60,40,0)");

      // The fog sea, thick and luminous where the sun hits it.
      band(g, W, fogTop, H, [
        [0, "rgba(255,214,180,0.0)"], [0.18, "rgba(248,214,196,0.85)"],
        [0.5, "rgba(232,214,214,0.97)"], [1, "rgba(196,192,208,1)"]
      ]);
      fogBank(g, W, fogTop + H * 0.06, H * 0.1, rng, 0.85,
        (a) => "rgba(255,236,220," + clamp(a, 0, 1).toFixed(3) + ")", 18);
      fogBank(g, W, fogTop + H * 0.26, H * 0.14, rng, 0.7,
        (a) => "rgba(228,222,236," + clamp(a, 0, 1).toFixed(3) + ")", 14);
    }

    // 9 — Ocean Beach, the sun going into the Pacific.
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

    const SCENES = [
      { id: "golden_gate", label: "Golden Gate", paint: sceneGoldenGate },
      { id: "downtown", label: "Downtown Dusk", paint: sceneDowntown },
      { id: "painted_ladies", label: "Painted Ladies", paint: scenePaintedLadies },
      { id: "coit_tower", label: "Coit Tower", paint: sceneCoitTower },
      { id: "bay_bridge", label: "Bay Bridge", paint: sceneBayBridge },
      { id: "karl", label: "Karl the Fog", paint: sceneKarlTheFog },
      { id: "hyde_street", label: "Hyde Street", paint: sceneHydeStreet },
      { id: "sutro", label: "Sutro Tower", paint: sceneSutroTower },
      { id: "ocean_beach", label: "Ocean Beach", paint: sceneOceanBeach }
    ];

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
     * OffscreenCanvas. Without one we return null and the bit runs the plainer
     * ImageData path below.
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

    // Device pixels per CSS pixel on the display canvas, derived rather than
    // assumed so the ImageData fallback lines up exactly.
    const DP = () => (ctx.width > 0 ? canvas.width / ctx.width : 1);
    const PX = Math.min(ctx.dpr || 1, 2);   // supersampling for baked surfaces

    // ====================================================================== //
    // Layout                                                                 //
    // ====================================================================== //

    let L = null;

    function layout() {
      const W = ctx.width, H = ctx.height;
      const top = (ctx.safeArea && ctx.safeArea.top) || 0;
      const bot = (ctx.safeArea && ctx.safeArea.bottom) || 0;
      const padX = Math.max(12, W * 0.04);

      const headerH = top + Math.min(84, H * 0.13);
      const footerH = bot + Math.min(56, H * 0.08);
      const availH = Math.max(60, H - headerH - footerH);
      const availW = W - padX * 2;
      const gap = Math.max(7, W * 0.025);

      // Tiles are portrait, and stretch toward the height the screen actually
      // has — square tiles leave a third of a tall phone empty. The picture
      // frame below uses the same aspect, so opening a tile is a pure scale
      // with nothing to distort.
      const cellW = Math.max(24, (availW - gap * 2) / 3);
      const maxCellH = (availH - gap * 2) / 3;
      const aspect = clamp(maxCellH / cellW, 1, 1.6);
      const cellH = cellW * aspect;

      const gw = cellW * 3 + gap * 2;
      const gh = cellH * 3 + gap * 2;
      const gx = (W - gw) / 2;
      const gy = headerH + (availH - gh) / 2;

      const cells = [];
      for (let i = 0; i < 9; i++) {
        cells.push({
          x: gx + (i % 3) * (cellW + gap),
          y: gy + ((i / 3) | 0) * (cellH + gap),
          w: cellW,
          h: cellH
        });
      }

      const dTop = top + 56;
      const dBot = H - bot - 52;
      const maxW = W - Math.max(10, W * 0.035) * 2;
      const maxH = Math.max(80, dBot - dTop);
      let dw = maxW, dh = dw * aspect;
      if (dh > maxH) { dh = maxH; dw = dh / aspect; }
      const detail = { x: (W - dw) / 2, y: dTop + (maxH - dh) / 2, w: dw, h: dh };

      L = { W, H, top, bot, padX, headerH, footerH, cells, cellW, cellH, aspect, gap, detail };
    }
    layout();

    // ====================================================================== //
    // Thumbnails — baked one per frame so the first frame is never blank      //
    // ====================================================================== //

    const THUMB_SCALE = 1.6;             // supersample the small tiles a little
    let thumbs = new Array(9).fill(null);
    let thumbW = 0, thumbH = 0;
    let bakeQueue = [];

    function queueThumbs() {
      const w = Math.round(Math.min(240, L.cellW * THUMB_SCALE));
      const h = Math.round(w * L.aspect);
      if (!CAN_BAKE || (w === thumbW && h === thumbH)) return;
      thumbW = w;
      thumbH = h;
      thumbs = new Array(9).fill(null);
      bakeQueue = [0, 1, 2, 3, 4, 5, 6, 7, 8];
    }

    function bakeStep() {
      if (!bakeQueue.length) return false;
      const i = bakeQueue.shift();
      const sf = makeSurface(thumbW, thumbH);
      if (sf) {
        const sg = sf.getContext("2d");
        sg.save();
        SCENES[i].paint(sg, thumbW, thumbH);
        sg.restore();
        thumbs[i] = sf;
      }
      return true;
    }
    queueThumbs();

    // ====================================================================== //
    // Persistent state                                                       //
    // ====================================================================== //

    const revealedSet = new Set();
    let storageOk = !!(ctx.capabilities && ctx.capabilities.storage);
    if (storageOk) {
      try {
        const saved = await ctx.storage.get("revealed");
        if (Array.isArray(saved)) for (const id of saved) revealedSet.add(id);
      } catch (_) {
        storageOk = false;
      }
    }
    function persistRevealed() {
      if (!storageOk) return;
      try { ctx.storage.set("revealed", Array.from(revealedSet)); } catch (_) { /* non-fatal */ }
    }

    // ====================================================================== //
    // Detail state — the crisp bake, the mosaic grids, the rub mask           //
    // ====================================================================== //

    let view = "grid";          // "grid" | "detail"
    let trans = null;           // { i, t, dir } while zooming in/out
    let selected = -1;

    let crisp = null;           // OffscreenCanvas of the scene at detail size
    let pixelSurf = null;       // mosaic layer, masked before it is composited
    let maskSurf = null;        // accumulated rub strokes (white = revealed)
    let brush = null;           // pre-baked soft brush stamp

    // Fallback path (no OffscreenCanvas): the crisp picture lives as ImageData
    // captured straight off the display canvas, and the reveal is a clip path.
    let baseImg = null;
    let baseImgOrigin = { x: 0, y: 0 };
    let clipStamps = [];

    // Mosaic grids.
    let FCOLS = 0, FROWS = 0, CCOLS = 0, CROWS = 0;
    let fineShades = null, coarseShades = null, cellPhase = null;
    let gridsReady = false;
    let gridsPending = false;

    // Reveal bookkeeping.
    const RCOLS = 24, RROWS = 30;
    let revealCells = new Uint8Array(RCOLS * RROWS);
    let revealCount = 0;
    let revealBox = null;       // {x0,y0,x1,y1} in detail-local CSS px
    let sceneDone = false;
    let autoFill = 0;           // 0..1 sweep that finishes the reveal
    let rubbing = false;
    let everRubbed = false;

    const SHADE_MUL = [0.72, 0.85, 0.95, 1.03, 1.13, 1.26];
    const SHADES = SHADE_MUL.length;

    function makeBrush(r) {
      const size = Math.max(4, Math.round(r * 2 * PX));
      const sf = makeSurface(size, size);
      if (!sf) return null;
      const bg = sf.getContext("2d");
      const c = size / 2;
      const gr = bg.createRadialGradient(c, c, 0, c, c, c);
      gr.addColorStop(0, "rgba(255,255,255,1)");
      gr.addColorStop(0.45, "rgba(255,255,255,0.92)");
      gr.addColorStop(0.78, "rgba(255,255,255,0.4)");
      gr.addColorStop(1, "rgba(255,255,255,0)");
      bg.fillStyle = gr;
      bg.beginPath();
      bg.arc(c, c, c, 0, TAU);
      bg.fill();
      return sf;
    }

    function brushRadius() {
      return clamp(Math.min(L.detail.w, L.detail.h) * 0.115, 22, 58);
    }

    // Average the baked picture down into a fine grid, then fold the fine grid
    // into a coarse one. Two resolutions is all the mosaic animation needs.
    function buildGrids(img) {
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

      CCOLS = Math.ceil(FCOLS / 3);
      CROWS = Math.ceil(FROWS / 3);
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

      // Pre-build the shade strings once: the frame loop must never do string
      // work per cell.
      function shadeTable(grid, count) {
        const out = new Array(count);
        for (let i = 0; i < count; i++) {
          const r = grid[i * 3], gg = grid[i * 3 + 1], b = grid[i * 3 + 2];
          const arr = new Array(SHADES);
          for (let s2 = 0; s2 < SHADES; s2++) {
            const m = SHADE_MUL[s2];
            arr[s2] = "rgb(" + (clamp(r * m, 0, 255) | 0) + "," +
              (clamp(gg * m, 0, 255) | 0) + "," + (clamp(b * m, 0, 255) | 0) + ")";
          }
          out[i] = arr;
        }
        return out;
      }
      fineShades = shadeTable(fine, FCOLS * FROWS);
      coarseShades = shadeTable(coarse, CCOLS * CROWS);

      const rng = mulberry32(20260811);
      cellPhase = new Float32Array(FCOLS * FROWS);
      for (let i = 0; i < cellPhase.length; i++) cellPhase[i] = rng() * TAU;
      gridsReady = true;
    }

    // Paint one frame of the mosaic into `pg`, sized (w, h) in CSS px.
    function drawMosaic(pg, w, h, timeMs) {
      if (!gridsReady) return;
      const t = timeMs * 0.001;

      // Coarse base — the big blocks that show through in the wave crests.
      const ccw = w / CCOLS, cch = h / CROWS;
      for (let y = 0; y < CROWS; y++) {
        for (let x = 0; x < CCOLS; x++) {
          const i = y * CCOLS + x;
          const sI = clamp(2 + (fsin(t * 0.9 + (x * 3 + y * 5) * 0.5) * 2.2) | 0, 0, SHADES - 1);
          pg.fillStyle = coarseShades[i][sI];
          pg.fillRect(x * ccw, y * cch, ccw + 0.7, cch + 0.7);
        }
      }

      // Fine detail on top, faded out along a slow diagonal wave so the mosaic
      // visibly coarsens and refines in travelling bands.
      const cw = w / FCOLS, ch = h / FROWS;
      for (let y = 0; y < FROWS; y++) {
        const rowW = y * 0.1;
        for (let x = 0; x < FCOLS; x++) {
          const wv = 0.5 + 0.5 * fsin(x * 0.16 + rowW - t * 1.15);
          const a = 1 - wv * wv;
          if (a < 0.04) continue;
          const i = y * FCOLS + x;
          const ph = cellPhase[i];
          const sI = clamp((2 + (fsin(t * 1.7 + ph) * 2.6)) | 0, 0, SHADES - 1);
          pg.globalAlpha = a;
          pg.fillStyle = fineShades[i][sI];
          // Each block breathes a touch, so grout lines pulse between them.
          const k = 0.86 + 0.14 * (0.5 + 0.5 * fsin(t * 2.1 + ph * 1.7));
          const bw = cw * k, bh = ch * k;
          pg.fillRect(x * cw + (cw - bw) * 0.5, y * ch + (ch - bh) * 0.5, bw + 0.4, bh + 0.4);
        }
      }
      pg.globalAlpha = 1;
    }

    function resetReveal() {
      revealCells = new Uint8Array(RCOLS * RROWS);
      revealCount = 0;
      revealBox = null;
      sceneDone = false;
      autoFill = 0;
      everRubbed = false;
      clipStamps = [];
    }

    function markReveal(x, y, r) {
      const d = L.detail;
      const c0 = clamp(Math.floor(((x - r) / d.w) * RCOLS), 0, RCOLS - 1);
      const c1 = clamp(Math.floor(((x + r) / d.w) * RCOLS), 0, RCOLS - 1);
      const r0 = clamp(Math.floor(((y - r) / d.h) * RROWS), 0, RROWS - 1);
      const r1 = clamp(Math.floor(((y + r) / d.h) * RROWS), 0, RROWS - 1);
      for (let ry = r0; ry <= r1; ry++) {
        for (let rx = c0; rx <= c1; rx++) {
          const i = ry * RCOLS + rx;
          if (!revealCells[i]) { revealCells[i] = 1; revealCount++; }
        }
      }
      const b = revealBox;
      if (!b) {
        revealBox = { x0: x - r, y0: y - r, x1: x + r, y1: y + r };
      } else {
        if (x - r < b.x0) b.x0 = x - r;
        if (y - r < b.y0) b.y0 = y - r;
        if (x + r > b.x1) b.x1 = x + r;
        if (y + r > b.y1) b.y1 = y + r;
      }
    }

    function revealFraction() {
      return revealCount / (RCOLS * RROWS);
    }

    function stampAt(x, y) {
      const r = brushRadius();
      if (maskSurf) {
        const mg = maskSurf.getContext("2d");
        if (brush) {
          mg.drawImage(brush, (x - r) * PX, (y - r) * PX, r * 2 * PX, r * 2 * PX);
        } else {
          mg.fillStyle = "#fff";
          mg.beginPath();
          mg.arc(x * PX, y * PX, r * PX, 0, TAU);
          mg.fill();
        }
      } else if (clipStamps.length < 900) {
        clipStamps.push({ x, y, r: r * 0.85 });
      }
      markReveal(x, y, r * 0.78);
    }

    // ====================================================================== //
    // Opening and closing a picture                                          //
    // ====================================================================== //

    function openScene(i) {
      selected = i;
      resetReveal();
      const d = L.detail;

      if (CAN_BAKE) {
        const pw = Math.round(d.w * PX), ph = Math.round(d.h * PX);
        crisp = makeSurface(pw, ph);
        if (crisp) {
          const cg = crisp.getContext("2d");
          cg.save();
          cg.scale(PX, PX);
          SCENES[i].paint(cg, d.w, d.h);
          cg.restore();
        }
        pixelSurf = makeSurface(pw, ph);
        maskSurf = makeSurface(pw, ph);
        brush = makeBrush(brushRadius());
      }

      // Mosaic resolution: ~11 CSS px blocks, clamped so tiny/huge screens
      // both land somewhere sensible.
      FCOLS = clamp(Math.round(d.w / 11), 20, 46);
      FROWS = Math.max(4, Math.round(FCOLS * (d.h / d.w)));
      gridsReady = false;
      gridsPending = true;   // built on a later frame; the zoom covers the cost

      if (CAN_BAKE) {
        trans = { i, t: 0, dir: 1 };
      } else {
        // Nothing baked to zoom, and repainting nine scenes per frame would
        // stutter — open straight into the picture instead.
        trans = null;
        view = "detail";
        fallbackNeedsBase = true;
      }
    }

    function buildGridsNow() {
      gridsPending = false;
      try {
        if (crisp) {
          const cg = crisp.getContext("2d");
          buildGrids(cg.getImageData(0, 0, crisp.width, crisp.height));
        } else if (baseImg) {
          buildGrids(baseImg);
        }
      } catch (_) {
        gridsReady = false;   // readback blocked: the picture simply stays crisp
      }
    }

    function closeScene() {
      if (selected < 0) return;
      if (CAN_BAKE) {
        trans = { i: selected, t: 1, dir: -1 };
      } else {
        trans = null;
        view = "grid";
        releaseDetail();
        resetReveal();
        fallbackGridDrawn = false;
        syncChrome();
      }
    }

    function releaseDetail() {
      crisp = null;
      pixelSurf = null;
      maskSurf = null;
      brush = null;
      baseImg = null;
      fineShades = null;
      coarseShades = null;
      cellPhase = null;
      gridsReady = false;
      gridsPending = false;
      selected = -1;
    }

    // ====================================================================== //
    // Audio                                                                  //
    // ====================================================================== //

    let music = null;
    let started = false;
    const canMusic = !!(ctx.capabilities && ctx.capabilities.backgroundMusic);
    const canHaptic = !!(ctx.capabilities && ctx.capabilities.haptics);

    function haptic(kind) {
      if (canHaptic) { try { ctx.platform.haptic(kind); } catch (_) { /* ignore */ } }
    }

    async function firstGesture() {
      if (started) return;
      started = true;
      ctx.platform.start();
      if (!canMusic) return;
      try {
        await ctx.music.unlock();
        music = ctx.music.play({
          preset: "drift",
          volume: 0.3,
          tempo: 64,
          intensity: 0.3,
          scale: "pentatonic",
          fadeInMs: 2200
        });
      } catch (_) {
        music = null;
      }
    }

    function sting(name) {
      if (!canMusic) return;
      try { ctx.music.sting(name); } catch (_) { /* ignore */ }
    }

    // ====================================================================== //
    // UI chrome                                                              //
    // ====================================================================== //

    function el(tag, css, html) {
      const n = tag === "button" ? document.createElement("button") : document.createElement("div");
      if (css) n.style.cssText = css;
      if (html != null) n.innerHTML = html;
      return n;
    }

    const FONT = "font-family:inherit;-webkit-tap-highlight-color:transparent;";
    const CHIP = FONT + "pointer-events:auto;border:0;cursor:pointer;color:#f3eee8;" +
      "background:rgba(22,20,30,0.62);border:1px solid rgba(255,255,255,0.14);" +
      "backdrop-filter:blur(9px);-webkit-backdrop-filter:blur(9px);" +
      "border-radius:999px;font-weight:700;letter-spacing:0.01em;";

    // Grid header.
    const header = el("div", "position:absolute;left:0;right:0;top:0;text-align:center;" +
      "pointer-events:none;color:#f4efe8;");
    header.innerHTML =
      '<div id="pfTitle" style="font-size:19px;font-weight:800;letter-spacing:0.02em;">Pixel Fog</div>' +
      '<div id="pfSub" style="font-size:11.5px;opacity:0.62;margin-top:3px;letter-spacing:0.16em;' +
      'text-transform:uppercase;">nine views of san francisco</div>';
    ui.appendChild(header);

    const helpBtn = el("button", CHIP + "position:absolute;width:32px;height:32px;font-size:15px;" +
      "display:flex;align-items:center;justify-content:center;padding:0;", "?");
    ui.appendChild(helpBtn);

    // Detail chrome.
    const backBtn = el("button", CHIP + "position:absolute;padding:8px 15px 8px 12px;font-size:14px;" +
      "display:none;align-items:center;gap:5px;", "&#8249;&nbsp;Back");
    ui.appendChild(backBtn);

    const detailTitle = el("div", "position:absolute;left:0;right:0;text-align:center;" +
      "pointer-events:none;color:#f4efe8;font-size:14px;font-weight:700;display:none;" +
      "text-shadow:0 2px 12px rgba(0,0,0,0.6);letter-spacing:0.03em;");
    ui.appendChild(detailTitle);

    const hint = el("div", "position:absolute;left:0;right:0;text-align:center;pointer-events:none;" +
      "color:#f4efe8;font-size:12.5px;font-weight:600;display:none;opacity:0.85;" +
      "text-shadow:0 2px 12px rgba(0,0,0,0.7);letter-spacing:0.05em;transition:opacity 0.5s;");
    ui.appendChild(hint);

    // Instructions panel.
    const panel = el("div", "position:absolute;left:0;right:0;top:0;bottom:0;display:none;" +
      "align-items:center;justify-content:center;padding:24px;pointer-events:auto;" +
      "background:rgba(8,8,14,0.72);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);");
    const panelCard = el("div", FONT + "max-width:330px;color:#f2ede6;background:rgba(24,22,32,0.96);" +
      "border:1px solid rgba(255,255,255,0.1);border-radius:22px;padding:22px 20px 18px;" +
      "box-shadow:0 20px 60px rgba(0,0,0,0.55);");
    panelCard.innerHTML =
      '<div style="font-size:16px;font-weight:800;margin-bottom:12px;">How it works</div>' +
      '<div style="font-size:13.5px;line-height:1.75;opacity:0.9;">' +
      '&bull;&nbsp; Tap any of the nine views to open it.<br>' +
      '&bull;&nbsp; Rub the picture with your finger.<br>' +
      '&bull;&nbsp; A living mosaic of that same picture blooms wherever you rub.<br>' +
      '&bull;&nbsp; Clear most of it and the whole picture turns to pixels.<br>' +
      '&bull;&nbsp; <b>Back</b> returns to the nine views.' +
      '</div>';
    const panelBtn = el("button", CHIP + "margin-top:16px;width:100%;padding:11px 0;font-size:14px;" +
      "background:rgba(255,255,255,0.14);", "Got it");
    panelCard.appendChild(panelBtn);
    panel.appendChild(panelCard);
    ui.appendChild(panel);

    function placeChrome() {
      const top = L.top;
      header.style.top = (top + 12) + "px";
      helpBtn.style.top = (top + 12) + "px";
      helpBtn.style.right = L.padX + "px";
      backBtn.style.top = (top + 10) + "px";
      backBtn.style.left = L.padX + "px";
      detailTitle.style.top = (top + 18) + "px";
      hint.style.bottom = (L.bot + 16) + "px";
    }
    placeChrome();

    function syncChrome() {
      const detailish = view === "detail" || (trans && trans.dir > 0);
      header.style.display = detailish ? "none" : "";
      helpBtn.style.display = detailish ? "none" : "";
      backBtn.style.display = view === "detail" ? "flex" : "none";
      detailTitle.style.display = view === "detail" ? "" : "none";
      hint.style.display = view === "detail" ? "" : "none";
      if (view === "detail" && selected >= 0) {
        detailTitle.textContent = SCENES[selected].label;
        hint.textContent = sceneDone
          ? "all pixels ✦  —  go back for another"
          : (everRubbed ? "" : "rub the picture");
        hint.style.opacity = sceneDone ? "0.9" : (everRubbed ? "0" : "0.85");
      }
    }
    syncChrome();

    ctx.listen(helpBtn, "click", () => { panel.style.display = "flex"; haptic("light"); });
    ctx.listen(panelBtn, "click", () => { panel.style.display = "none"; haptic("light"); });
    ctx.listen(backBtn, "click", () => {
      if (view !== "detail") return;
      haptic("light");
      sting("tap");
      closeScene();
    });

    // ====================================================================== //
    // Pointer handling                                                       //
    // ====================================================================== //

    // offsetX/offsetY are already canvas-relative, which keeps us off
    // getBoundingClientRect (rejected by the upload validator) and avoids a
    // forced reflow on every pointer sample.
    function localPoint(e) {
      if (typeof e.offsetX === "number" && typeof e.offsetY === "number") {
        return { x: e.offsetX, y: e.offsetY };
      }
      return { x: e.clientX, y: e.clientY };
    }

    let lastRub = null;
    let lastInteract = 0;
    let lastRubHaptic = 0;
    let pressCell = -1;
    let pressPt = null;

    function cellAt(x, y) {
      for (let i = 0; i < 9; i++) {
        const c = L.cells[i];
        if (x >= c.x && x <= c.x + c.w && y >= c.y && y <= c.y + c.h) return i;
      }
      return -1;
    }

    ctx.listen(canvas, "pointerdown", (e) => {
      if (panel.style.display === "flex") return;
      const p = localPoint(e);
      firstGesture();

      if (view === "grid" && !trans) {
        pressCell = cellAt(p.x, p.y);
        pressPt = p;
        if (pressCell >= 0) haptic("light");
        return;
      }

      if (view === "detail") {
        const d = L.detail;
        const lx = p.x - d.x, ly = p.y - d.y;
        if (lx < -12 || ly < -12 || lx > d.w + 12 || ly > d.h + 12) return;
        rubbing = true;
        everRubbed = true;
        if (canvas.setPointerCapture) {
          try { canvas.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
        }
        lastRub = { x: clamp(lx, 0, d.w), y: clamp(ly, 0, d.h) };
        stampAt(lastRub.x, lastRub.y);
        syncChrome();
        haptic("light");
      }
    });

    ctx.listen(canvas, "pointermove", (e) => {
      if (!rubbing || view !== "detail") return;
      const p = localPoint(e);
      const d = L.detail;
      const x = clamp(p.x - d.x, 0, d.w);
      const y = clamp(p.y - d.y, 0, d.h);
      if (!lastRub) { lastRub = { x, y }; stampAt(x, y); return; }

      // Stamp along the segment so a fast swipe stays continuous.
      const r = brushRadius();
      const dx = x - lastRub.x, dy = y - lastRub.y;
      const dist = Math.hypot(dx, dy);
      const step = Math.max(2, r * 0.3);
      const n = Math.min(40, Math.floor(dist / step));
      for (let i = 1; i <= n; i++) {
        stampAt(lastRub.x + (dx * i) / n, lastRub.y + (dy * i) / n);
      }
      if (n === 0 && dist > 0.5) stampAt(x, y);
      lastRub = { x, y };

      const now = e.timeStamp || 0;
      if (now - lastInteract > 400) {
        lastInteract = now;
        ctx.platform.interact({ type: "rub", scene: SCENES[selected].id });
      }
      if (now - lastRubHaptic > 130) {
        lastRubHaptic = now;
        haptic("light");
      }
    }, { passive: true });

    function endRub(e) {
      if (view === "grid" && pressCell >= 0 && !trans) {
        const p = e ? localPoint(e) : pressPt;
        const still = !p || !pressPt || Math.hypot(p.x - pressPt.x, p.y - pressPt.y) < 14;
        if (still && cellAt(p.x, p.y) === pressCell) {
          sting("tap");
          ctx.platform.interact({ type: "open", scene: SCENES[pressCell].id });
          openScene(pressCell);
          syncChrome();
        }
      }
      pressCell = -1;
      pressPt = null;
      rubbing = false;
      lastRub = null;
    }
    ctx.listen(canvas, "pointerup", endRub);
    ctx.listen(canvas, "pointercancel", () => { pressCell = -1; rubbing = false; lastRub = null; });
    ctx.listen(canvas, "lostpointercapture", () => { rubbing = false; lastRub = null; });

    // ====================================================================== //
    // Rendering                                                              //
    // ====================================================================== //

    function backdrop(timeMs) {
      const W = L.W, H = L.H;
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.scale(DP(), DP());
      g.fillStyle = "#0b0a12";
      g.fillRect(0, 0, W, H);
      const t = timeMs * 0.00006;
      const g1 = g.createRadialGradient(
        W * (0.3 + 0.22 * Math.sin(t)), H * (0.22 + 0.1 * Math.cos(t * 1.3)), 0,
        W * 0.5, H * 0.4, Math.max(W, H) * 0.85
      );
      g1.addColorStop(0, "rgba(72,60,110,0.55)");
      g1.addColorStop(1, "rgba(10,9,18,0)");
      g.fillStyle = g1;
      g.fillRect(0, 0, W, H);
      const g2 = g.createRadialGradient(
        W * (0.7 - 0.2 * Math.cos(t * 0.8)), H * (0.82 + 0.08 * Math.sin(t * 1.1)), 0,
        W * 0.5, H * 0.7, Math.max(W, H) * 0.7
      );
      g2.addColorStop(0, "rgba(122,74,96,0.35)");
      g2.addColorStop(1, "rgba(10,9,18,0)");
      g.fillStyle = g2;
      g.fillRect(0, 0, W, H);
    }

    /**
     * One grid tile. `skipImage` is for the no-OffscreenCanvas path, where the
     * scene has already been painted live into the same rect and only the
     * scrim, label and hairline are still owed.
     */
    function drawTile(i, rect, radius, alpha, skipImage) {
      const sf = thumbs[i];
      g.save();
      g.globalAlpha = alpha;

      if (!skipImage) {
        // Cheap drop shadow: a dark rounded rect nudged down behind the tile.
        g.fillStyle = "rgba(0,0,0,0.4)";
        roundRect(g, rect.x, rect.y + rect.h * 0.03, rect.w, rect.h, radius);
        g.fill();
      }

      roundRect(g, rect.x, rect.y, rect.w, rect.h, radius);
      g.save();
      g.clip();
      if (skipImage) {
        // already painted
      } else if (sf) {
        g.drawImage(sf, rect.x, rect.y, rect.w, rect.h);
      } else {
        // Not baked yet — a soft placeholder so the grid is never empty.
        const ph = g.createLinearGradient(rect.x, rect.y, rect.x, rect.y + rect.h);
        ph.addColorStop(0, "#2a2740");
        ph.addColorStop(1, "#171525");
        g.fillStyle = ph;
        g.fillRect(rect.x, rect.y, rect.w, rect.h);
      }
      // Label scrim.
      const sc = g.createLinearGradient(0, rect.y + rect.h * 0.55, 0, rect.y + rect.h);
      sc.addColorStop(0, "rgba(0,0,0,0)");
      sc.addColorStop(1, "rgba(0,0,0,0.6)");
      g.fillStyle = sc;
      g.fillRect(rect.x, rect.y + rect.h * 0.55, rect.w, rect.h * 0.45);
      g.restore();

      // Label + revealed marker.
      const fs = clamp(rect.w * 0.098, 7.5, 12);
      g.fillStyle = "rgba(245,240,232,0.94)";
      g.font = "600 " + fs.toFixed(1) + "px -apple-system, system-ui, sans-serif";
      g.textAlign = "left";
      g.textBaseline = "alphabetic";
      g.fillText(SCENES[i].label, rect.x + rect.w * 0.075, rect.y + rect.h - rect.h * 0.072);
      if (revealedSet.has(SCENES[i].id)) {
        g.fillStyle = "rgba(255,214,150,0.95)";
        g.beginPath();
        g.arc(rect.x + rect.w - rect.w * 0.09, rect.y + rect.h * 0.1, Math.max(2, rect.w * 0.026), 0, TAU);
        g.fill();
      }

      // Inner hairline.
      roundRect(g, rect.x + 0.5, rect.y + 0.5, rect.w - 1, rect.h - 1, radius);
      g.strokeStyle = "rgba(255,255,255,0.13)";
      g.lineWidth = 1;
      g.stroke();
      g.restore();
    }

    function drawGrid(timeMs, dimFor) {
      backdrop(timeMs);
      for (let i = 0; i < 9; i++) {
        if (dimFor === i) continue;
        const c = L.cells[i];
        const pressed = pressCell === i;
        const k = pressed ? 0.965 : 1;
        const rect = {
          x: c.x + (c.w * (1 - k)) / 2,
          y: c.y + (c.h * (1 - k)) / 2,
          w: c.w * k,
          h: c.h * k
        };
        drawTile(i, rect, Math.max(7, c.w * 0.1), dimFor != null ? 0.35 : 1);
      }
    }

    // Composite the detail view: crisp picture, mosaic showing through the rub.
    function drawDetail(timeMs) {
      const d = L.detail;
      const radius = Math.max(10, d.w * 0.035);

      if (crisp) {
        backdrop(timeMs);

        // Frame shadow.
        g.fillStyle = "rgba(0,0,0,0.45)";
        roundRect(g, d.x, d.y + d.h * 0.012, d.w, d.h, radius);
        g.fill();

        g.save();
        roundRect(g, d.x, d.y, d.w, d.h, radius);
        g.clip();
        g.drawImage(crisp, d.x, d.y, d.w, d.h);

        if (gridsReady && (revealBox || autoFill > 0) && pixelSurf && maskSurf) {
          const pg = pixelSurf.getContext("2d");
          pg.setTransform(1, 0, 0, 1, 0, 0);
          pg.clearRect(0, 0, pixelSurf.width, pixelSurf.height);
          pg.setTransform(PX, 0, 0, PX, 0, 0);
          drawMosaic(pg, d.w, d.h, timeMs);
          pg.setTransform(1, 0, 0, 1, 0, 0);
          pg.globalCompositeOperation = "destination-in";
          pg.drawImage(maskSurf, 0, 0);
          pg.globalCompositeOperation = "source-over";
          g.drawImage(pixelSurf, d.x, d.y, d.w, d.h);
        }
        g.restore();

        g.save();
        roundRect(g, d.x + 0.5, d.y + 0.5, d.w - 1, d.h - 1, radius);
        g.strokeStyle = "rgba(255,255,255,0.16)";
        g.lineWidth = 1;
        g.stroke();
        g.restore();
      } else {
        // Fallback: the backdrop and the crisp picture were painted once when
        // the view opened, so this path must NOT repaint them — it only
        // restores the rubbed region from the captured picture and redraws the
        // mosaic inside a clip built from the rub stamps.
        const dp = DP();
        g.setTransform(1, 0, 0, 1, 0, 0);
        const b = revealBox;
        if (baseImg && b) {
          const bx = clamp(Math.floor((b.x0 - 4) * dp), 0, baseImg.width);
          const by = clamp(Math.floor((b.y0 - 4) * dp), 0, baseImg.height);
          const bw = clamp(Math.ceil((b.x1 - b.x0 + 8) * dp), 1, baseImg.width - bx);
          const bh = clamp(Math.ceil((b.y1 - b.y0 + 8) * dp), 1, baseImg.height - by);
          g.putImageData(baseImg, baseImgOrigin.x, baseImgOrigin.y, bx, by, bw, bh);
        }
        g.scale(dp, dp);
        if (gridsReady && (clipStamps.length || autoFill > 0)) {
          g.save();
          g.beginPath();
          if (autoFill > 0) {
            g.rect(d.x, d.y, d.w, d.h);
          } else {
            for (const s2 of clipStamps) {
              g.moveTo(d.x + s2.x + s2.r, d.y + s2.y);
              g.arc(d.x + s2.x, d.y + s2.y, s2.r, 0, TAU);
            }
          }
          g.clip();
          g.translate(d.x, d.y);
          drawMosaic(g, d.w, d.h, timeMs);
          g.restore();
        }
      }

      // Progress line. Only on the baked path: the fallback never repaints its
      // backdrop, so redrawing a translucent bar over itself every frame would
      // accumulate to solid white.
      const frac = clamp(revealFraction() / 0.88, 0, 1);
      if (crisp && frac > 0.002) {
        const bw = d.w * 0.44;
        const bx = d.x + (d.w - bw) / 2;
        const by = d.y + d.h + Math.min(16, L.footerH * 0.3);
        g.fillStyle = "rgba(255,255,255,0.14)";
        roundRect(g, bx, by, bw, 3, 1.5);
        g.fill();
        g.fillStyle = sceneDone ? "rgba(255,214,150,0.95)" : "rgba(255,236,208,0.8)";
        roundRect(g, bx, by, Math.max(3, bw * frac), 3, 1.5);
        g.fill();
      }
    }

    // Zoom between a grid cell and the detail frame.
    function drawTransition(timeMs) {
      const tr = trans;
      const e = easeInOut(clamp(tr.t, 0, 1));
      const c = L.cells[tr.i];
      const d = L.detail;
      const rect = {
        x: lerp(c.x, d.x, e),
        y: lerp(c.y, d.y, e),
        w: lerp(c.w, d.w, e),
        h: lerp(c.h, d.h, e)
      };
      const radius = lerp(Math.max(7, c.w * 0.1), Math.max(10, d.w * 0.035), e);

      drawGrid(timeMs, tr.i);
      g.save();
      g.globalAlpha = 1;
      g.fillStyle = "rgba(0,0,0,0.45)";
      roundRect(g, rect.x, rect.y + rect.h * 0.015, rect.w, rect.h, radius);
      g.fill();
      roundRect(g, rect.x, rect.y, rect.w, rect.h, radius);
      g.clip();
      if (thumbs[tr.i]) g.drawImage(thumbs[tr.i], rect.x, rect.y, rect.w, rect.h);
      if (crisp) {
        g.globalAlpha = e;
        g.drawImage(crisp, rect.x, rect.y, rect.w, rect.h);
        g.globalAlpha = 1;
      }
      g.restore();
    }

    // In the fallback path the picture must exist on the display canvas before
    // it can be captured, so paint it once and read it straight back.
    function captureFallbackBase(timeMs) {
      const d = L.detail;
      const dp = DP();
      const radius = Math.max(10, d.w * 0.035);
      backdrop(timeMs);
      g.fillStyle = "rgba(0,0,0,0.45)";
      roundRect(g, d.x, d.y + d.h * 0.012, d.w, d.h, radius);
      g.fill();
      g.save();
      roundRect(g, d.x, d.y, d.w, d.h, radius);
      g.clip();
      g.translate(d.x, d.y);
      SCENES[selected].paint(g, d.w, d.h);
      g.restore();
      g.save();
      roundRect(g, d.x + 0.5, d.y + 0.5, d.w - 1, d.h - 1, radius);
      g.strokeStyle = "rgba(255,255,255,0.16)";
      g.lineWidth = 1;
      g.stroke();
      g.restore();
      g.setTransform(1, 0, 0, 1, 0, 0);
      try {
        const ox = Math.floor(d.x * dp), oy = Math.floor(d.y * dp);
        baseImg = g.getImageData(ox, oy, Math.ceil(d.w * dp), Math.ceil(d.h * dp));
        baseImgOrigin = { x: ox, y: oy };
      } catch (_) {
        baseImg = null;
      }
    }

    // ====================================================================== //
    // Frame loop                                                             //
    // ====================================================================== //

    let lastW = L.W, lastH = L.H;
    let readyCalled = false;
    let fallbackNeedsBase = false;
    let fallbackGridDrawn = false;

    ctx.onFrame((dtMs, timeMs) => {
      // Re-layout without a resize listener: the runtime keeps ctx.width/height
      // current, so a cheap compare each frame is enough.
      if (ctx.width !== lastW || ctx.height !== lastH) {
        lastW = ctx.width;
        lastH = ctx.height;
        layout();
        placeChrome();
        queueThumbs();
        fallbackGridDrawn = false;
        if (view === "detail" && selected >= 0) {
          const keep = selected;
          releaseDetail();
          openScene(keep);
          trans = null;
          view = "detail";
          if (!CAN_BAKE) fallbackNeedsBase = true;
        }
      }

      // Bake up to two thumbnails per frame; the grid develops in front of you.
      if (bakeQueue.length) { bakeStep(); bakeStep(); }

      // Build the mosaic tables once the zoom is under way.
      if (gridsPending && (!trans || trans.t > 0.35)) {
        if (CAN_BAKE) buildGridsNow();
        else if (baseImg) buildGridsNow();
      }

      // Transition stepping.
      if (trans) {
        const speed = dtMs / 380;
        trans.t += trans.dir > 0 ? speed : -speed;
        if (trans.dir > 0 && trans.t >= 1) {
          trans.t = 1;
          const i = trans.i;
          trans = null;
          view = "detail";
          selected = i;
          if (!CAN_BAKE) fallbackNeedsBase = true;
          syncChrome();
        } else if (trans.dir < 0 && trans.t <= 0) {
          trans = null;
          view = "grid";
          releaseDetail();
          resetReveal();
          fallbackGridDrawn = false;
          syncChrome();
        }
      }

      // Reveal completion: sweep the rest away, then mark the picture done.
      if (view === "detail" && !sceneDone && revealFraction() >= 0.88) {
        sceneDone = true;
        haptic("success");
        sting("success");
        const id = SCENES[selected].id;
        if (!revealedSet.has(id)) {
          revealedSet.add(id);
          persistRevealed();
          ctx.platform.milestone("scene_revealed", { scene: id });
        }
        ctx.platform.setProgress(clamp(revealedSet.size / SCENES.length, 0, 1));
        if (revealedSet.size >= SCENES.length) ctx.platform.complete({ scenes: SCENES.length });
        syncChrome();
      }
      if (sceneDone && autoFill < 1) {
        autoFill = clamp(autoFill + dtMs / 700, 0, 1);
        if (maskSurf) {
          const mg = maskSurf.getContext("2d");
          mg.globalAlpha = clamp(dtMs / 700, 0, 1) * 1.4;
          mg.fillStyle = "#fff";
          mg.fillRect(0, 0, maskSurf.width, maskSurf.height);
          mg.globalAlpha = 1;
        }
        if (autoFill >= 1) {
          revealBox = { x0: 0, y0: 0, x1: L.detail.w, y1: L.detail.h };
        }
      }

      // Draw.
      if (trans) {
        drawTransition(timeMs);
      } else if (view === "detail") {
        if (!CAN_BAKE && fallbackNeedsBase) {
          captureFallbackBase(timeMs);
          fallbackNeedsBase = false;
          if (gridsPending) buildGridsNow();
        }
        drawDetail(timeMs);
      } else if (CAN_BAKE) {
        drawGrid(timeMs, null);
      } else if (!fallbackGridDrawn) {
        // No baked thumbnails to blit, so the nine scenes are painted live —
        // once, not per frame.
        backdrop(timeMs);
        for (let i = 0; i < 9; i++) {
          const c = L.cells[i];
          const radius = Math.max(7, c.w * 0.1);
          g.save();
          g.fillStyle = "rgba(0,0,0,0.4)";
          roundRect(g, c.x, c.y + c.h * 0.03, c.w, c.h, radius);
          g.fill();
          roundRect(g, c.x, c.y, c.w, c.h, radius);
          g.clip();
          g.translate(c.x, c.y);
          SCENES[i].paint(g, c.w, c.h);
          g.restore();
          drawTile(i, c, radius, 1, true);
        }
        fallbackGridDrawn = true;
      }

      if (!readyCalled) {
        readyCalled = true;
        ctx.markVisualReady("first_grid_frame");
        ctx.platform.ready();
      }
    });

    ctx.onDestroy(() => {
      if (music) { try { music.stop({ fadeOutMs: 400 }); } catch (_) { /* ignore */ } }
    });
  }
};
