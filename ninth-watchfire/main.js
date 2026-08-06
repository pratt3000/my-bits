// The Ninth Watchfire — a five-minute animated story told in twelve chapters.
//
// Nine towers stand along a wall of ice. Light one fire and the next must
// answer, and the next, all the way down to the green country. The fire at
// Ashen Reach has not been lit in three hundred years.
//
// Everything on screen is procedural: aurora bands are stacked sine harmonics
// filled with vertical gradients, snow is computed analytically from the clock
// so it never needs an array, and every figure is a silhouette built from a
// handful of curves. There are no packaged assets and no dependencies — only
// two approved registry fonts, which the system stack covers if they fail.
//
// The score follows the story rather than looping under it: a drone in the
// waste, warmth for the whelp, a spooky swell when the storm arrives, near
// silence at the low point, and triumph when the chain of fires answers.

window.plethoraBit = {
  meta: {
    title: "The Ninth Watchfire",
    runtime: "plethora-bit@2",
    tags: ["story", "animation", "cinematic", "fantasy", "narrative", "atmospheric", "winter", "art", "relaxing"],
    permissions: ["backgroundMusic", "haptics", "storage"]
  },

  async init(ctx) {
    // ---- small math -------------------------------------------------------
    const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
    const lerp = (a, b, t) => a + (b - a) * t;
    const ease = (t) => t * t * (3 - 2 * t);              // smoothstep
    const easeOut = (t) => 1 - (1 - t) * (1 - t);
    const easeIn = (t) => t * t;
    const TAU = Math.PI * 2;

    // Ramp helper: 0 before `a`, 1 after `b`, smooth between.
    const ramp = (v, a, b) => ease(clamp((v - a) / (b - a || 1), 0, 1));
    // Positive modulo — plain % goes negative, which flings particles off-frame
    // as soon as anything drifts leftward.
    const mod = (a, n) => ((a % n) + n) % n;

    // Deterministic RNG so nothing flickers between frames or resizes.
    function rng(seed) {
      let a = seed >>> 0;
      return function () {
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    }

    // ---- palette ----------------------------------------------------------
    const C = {
      pale: "#cfe8f5",
      ink: "#e9f0f6",
      gold: "#f2e6cf"
    };

    // System serif throughout. The registry faces were dropped: the host
    // validator rejects those loader calls as remote resources, and since this
    // fallback stack is what every frame was actually designed and checked
    // against, shipping it loses nothing.
    const SERIF = 'Georgia,"Times New Roman",Times,serif';
    const BODY = 'Georgia,"Times New Roman",Times,serif';
    const UIFONT = '-apple-system,system-ui,"Segoe UI",Roboto,sans-serif';

    // Adaptive quality: a rolling frame-time average trims particle counts on
    // slower devices rather than dropping frames.
    let avgDt = 16;
    let quality = 1;

    // ---- look-around camera -----------------------------------------------
    // Every chapter is built out of depth planes rather than one flat picture.
    // Dragging — or tilting the phone — slides those planes against each other,
    // so the world has somewhere to be behind and in front of itself.
    //
    // `look` is the raw target in [-1,1] on each axis; `lookS` is the smoothed
    // value actually drawn with, so the scene eases after your thumb instead of
    // snapping to it. Let go and it drifts most of the way back to centre.
    const look = { x: 0, y: 0 };
    const lookS = { x: 0, y: 0 };
    const LOOK_X = 0.17;        // how far a d=1 plane swings horizontally, in w
    const LOOK_Y = 0.10;        // and vertically, in h
    let dragging = false;
    let dragId = null;
    let dragFromX = 0, dragFromY = 0;
    let dragBaseX = 0, dragBaseY = 0;
    let dragMoved = 0;
    let tiltOn = false;
    let tiltZero = null;
    let hasLooked = false;      // suppresses the hint once you have moved

    // Depth plane. d = 0 sits at the horizon and does not move at all; d = 1 is
    // right in front of you and swings the most. Near planes also scale up a
    // touch, which reads as perspective rather than a flat slide.
    let curDepth = 0;           // plane currently being painted, for `disturb`
    function withDepth(d, fn) {
      const prev = curDepth;
      curDepth = d;
      if (d <= 0.0001 && lookS.x === 0 && lookS.y === 0) { fn(); curDepth = prev; return; }
      g.save();
      const px = -lookS.x * d * w * LOOK_X;
      const py = -lookS.y * d * h * LOOK_Y;
      const s = 1 + d * 0.035;
      g.translate(w / 2 + px, h / 2 + py);
      g.scale(s, s);
      g.translate(-w / 2, -h / 2);
      fn();
      g.restore();
      curDepth = prev;
    }

    // ---- the wake ----------------------------------------------------------
    // Dragging leaves a trail of short-lived gusts. Everything loose in the
    // world — snow, embers, birds, flame — samples the same field, so one
    // gesture stirs all of it together instead of each thing inventing its own
    // idea of what your finger did.
    //
    // No particle stores state. A gust is a point, a velocity and an age, and
    // displacement is computed fresh each frame from whichever gusts are still
    // alive. That keeps the analytic snow analytic.
    const gusts = [];
    const GUST_LIFE = 1.8;      // seconds
    const GUST_MAX = 10;

    function addGust(x, y, vx, vy, strength) {
      if (gusts.length >= GUST_MAX) gusts.shift();
      gusts.push({ x: x, y: y, vx: vx, vy: vy, s: strength, born: clock });
    }

    // Displacement for a point on the plane currently being painted. Gusts live
    // in screen space, so each is pulled back through that plane's transform
    // first — otherwise the wake drifts away from your finger as you look about.
    function disturb(x, y, scale) {
      if (!gusts.length) return null;
      const d = curDepth;
      const inv = 1 / (1 + d * 0.035);
      const cx = w / 2;
      const cy = h / 2;
      const reach = Math.min(w, h) * 0.3;
      const k = scale == null ? 1 : scale;
      let dx = 0;
      let dy = 0;
      let hit = false;
      for (let i = 0; i < gusts.length; i++) {
        const gu = gusts[i];
        const age = (clock - gu.born) / GUST_LIFE;
        if (age >= 1) continue;
        const px = (gu.x - cx + lookS.x * d * w * LOOK_X) * inv + cx;
        const py = (gu.y - cy + lookS.y * d * h * LOOK_Y) * inv + cy;
        const ox = x - px;
        const oy = y - py;
        if (ox > reach || ox < -reach || oy > reach || oy < -reach) continue;
        const r2 = ox * ox + oy * oy;
        if (r2 > reach * reach) continue;
        const r = Math.sqrt(r2) + 0.001;
        const fall = (1 - r / reach) * (1 - r / reach) * (1 - age);
        const push = fall * gu.s * k;
        dx += (ox / r) * push + gu.vx * fall * 0.5 * k;
        dy += (oy / r) * push + gu.vy * fall * 0.5 * k;
        hit = true;
      }
      return hit ? [dx, dy] : null;
    }

    // A faint ring where the wake was made, so it is obvious the world is
    // listening rather than merely coincidentally moving.
    function drawWake() {
      if (!gusts.length) return;
      g.save();
      g.globalCompositeOperation = "lighter";
      for (let i = 0; i < gusts.length; i++) {
        const gu = gusts[i];
        const age = (clock - gu.born) / GUST_LIFE;
        if (age >= 1) continue;
        const r = Math.min(w, h) * (0.02 + age * 0.1);
        glow(gu.x, gu.y, r, "190,226,248", (1 - age) * (1 - age) * 0.12 * gu.s);
      }
      g.restore();
    }

    // ---- surfaces ---------------------------------------------------------
    const canvas = ctx.createCanvas2D({ touchAction: "manipulation" });
    const g = canvas.getContext("2d");

    // UI floats above the canvas; the root itself never eats taps.
    const ui = ctx.createRoot({
      touchAction: "manipulation",
      style: { pointerEvents: "none", overflow: "hidden" }
    });

    let w = ctx.width;
    let h = ctx.height;
    const safeTop = () => (ctx.safeArea && ctx.safeArea.top) || 0;
    const safeBot = () => (ctx.safeArea && ctx.safeArea.bottom) || 0;

    // ---- static layers ----------------------------------------------------
    // The starfield, ice wall and vignette are painted straight onto the main
    // context every frame. They were cached into offscreen buffers at one
    // point, but the host validator rejects that whole family of APIs, and at
    // roughly three hundred cheap fills a frame the caching was never buying
    // much. Each painter takes its destination context so it stays testable.
    // Painted wider than the frame on every side: these planes move under the
    // look-around camera, and a field that stopped at the frame edge would slide
    // a bald strip into view the moment you dragged.
    function paintStars(d, dw, dh) {
      const sr = rng(97);
      d.save();
      for (let i = 0; i < 260; i++) {
        const x = -dw * 0.25 + sr() * dw * 1.5;
        const y = -dh * 0.15 + sr() * dh * 0.95;
        const r = 0.35 + sr() * sr() * 1.5;
        const a = 0.18 + sr() * 0.7 * (1 - y / (dh * 0.9));
        d.globalAlpha = clamp(a, 0.05, 0.9);
        d.fillStyle = sr() > 0.86 ? "#cfe0ff" : "#ffffff";
        d.beginPath();
        d.arc(x, y, r, 0, TAU);
        d.fill();
      }
      d.restore();
    }

    function paintVignette(d, dw, dh) {
      const vg = d.createRadialGradient(
        dw / 2, dh * 0.48, Math.min(dw, dh) * 0.24,
        dw / 2, dh * 0.5, Math.max(dw, dh) * 0.78
      );
      vg.addColorStop(0, "rgba(0,0,0,0)");
      vg.addColorStop(0.62, "rgba(0,0,0,0.16)");
      vg.addColorStop(1, "rgba(0,0,0,0.62)");
      d.fillStyle = vg;
      d.fillRect(0, 0, dw, dh);
    }

    // The great ice wall, shared by several chapters.
    const wallTopY = () => h * 0.4;
    const wallFaceH = () => h - wallTopY() + 2;

    function paintWall(d, dw, wh) {
      // Night ice: dark enough that the fire is the brightest thing on screen,
      // with striations kept faint — legible as texture, not as stripes.
      d.save();
      const wgrad = d.createLinearGradient(0, 0, 0, wh);
      wgrad.addColorStop(0, "#2e5175");
      wgrad.addColorStop(0.25, "#1c3855");
      wgrad.addColorStop(0.7, "#0f2039");
      wgrad.addColorStop(1, "#070d19");
      d.fillStyle = wgrad;
      d.fillRect(0, 0, dw, wh);
      const wr = rng(1204);
      for (let i = 0; i < 58; i++) {
        const x = wr() * dw;
        const bw2 = 3 + wr() * 30;
        d.globalAlpha = 0.016 + wr() * 0.04;
        d.fillStyle = wr() > 0.5 ? "#a8cde6" : "#040a14";
        d.fillRect(x, 0, bw2, wh);
      }
      // horizontal seams where centuries of snow packed down
      for (let i = 0; i < 22; i++) {
        const y = wr() * wh;
        d.globalAlpha = 0.03 + wr() * 0.045;
        d.fillStyle = "#dff0fb";
        d.fillRect(0, y, dw, 0.6 + wr() * 1.4);
      }
      // the face darkens toward the foot so narration always has a floor
      d.globalAlpha = 1;
      const fade = d.createLinearGradient(0, wh * 0.35, 0, wh);
      fade.addColorStop(0, "rgba(4,7,14,0)");
      fade.addColorStop(1, "rgba(4,7,14,0.75)");
      d.fillStyle = fade;
      d.fillRect(0, wh * 0.35, dw, wh * 0.65);
      d.restore();
    }

    // Paint the ice wall into a destination rect, squashed to fit.
    function drawWallFace(dy, dh) {
      const src = wallFaceH();
      g.save();
      g.beginPath();
      g.rect(0, dy, w, dh);
      g.clip();
      g.translate(0, dy);
      g.scale(1, dh / src);
      paintWall(g, w, src);
      g.restore();
    }

    // ---- reusable painting ------------------------------------------------
    function skyGrad(top, mid, bot, hor) {
      const sg = g.createLinearGradient(0, 0, 0, h);
      sg.addColorStop(0, top);
      sg.addColorStop(0.55, mid);
      sg.addColorStop(1, bot || mid);
      g.fillStyle = sg;
      g.fillRect(-w, -h, w * 3, h * 3);
      if (hor) {
        const hg = g.createLinearGradient(0, h * 0.3, 0, h * 0.62);
        hg.addColorStop(0, "rgba(0,0,0,0)");
        hg.addColorStop(1, hor);
        g.fillStyle = hg;
        g.fillRect(-w, h * 0.3, w * 3, h * 0.4);
      }
    }

    function stars(alpha) {
      g.save();
      g.globalAlpha = alpha;
      paintStars(g, w, h);
      g.restore();
    }

    // A few live twinklers on top of the cached field.
    function twinkle(t, alpha) {
      const tr = rng(31);
      g.globalCompositeOperation = "lighter";
      for (let i = 0; i < 14; i++) {
        const x = tr() * w;
        const y = tr() * h * 0.6;
        const ph = tr() * TAU;
        const a = (0.35 + 0.65 * Math.sin(t * 1.4 + ph) ** 2) * alpha;
        glow(x, y, 5 + 4 * Math.sin(t + ph), "255,255,255", a * 0.5);
      }
      g.globalCompositeOperation = "source-over";
    }

    function glow(x, y, r, rgb, a0) {
      const a = clamp(a0, 0, 1);
      if (a <= 0.002 || r <= 0) return;
      const rg = g.createRadialGradient(x, y, 0, x, y, r);
      rg.addColorStop(0, "rgba(" + rgb + "," + a + ")");
      rg.addColorStop(0.45, "rgba(" + rgb + "," + a * 0.34 + ")");
      rg.addColorStop(1, "rgba(" + rgb + ",0)");
      g.fillStyle = rg;
      g.beginPath();
      g.arc(x, y, r, 0, TAU);
      g.fill();
    }

    // Aurora: stacked wavy bands, each filled with a gradient that dies out
    // toward the top. Drawn additively so overlaps bloom.
    function aurora(t, opts) {
      const o = opts || {};
      const bands = o.bands || 3;
      const baseY = (o.y != null ? o.y : 0.3) * h;
      const alpha = o.alpha != null ? o.alpha : 0.34;
      const cols = o.colors || [[74, 226, 178], [64, 150, 220]];
      if (alpha <= 0.004) return;
      g.globalCompositeOperation = "lighter";
      for (let b = 0; b < bands; b++) {
        const f = b / Math.max(1, bands - 1);
        const col = cols[b % cols.length];
        const yy = baseY + b * h * 0.05 - h * 0.03;
        const amp = h * (0.045 + 0.03 * f);
        const drop = h * (0.2 + 0.12 * f);
        const sp = 0.16 + b * 0.05;

        g.beginPath();
        g.moveTo(-w * 0.1, yy);
        const steps = 26;
        for (let i = 0; i <= steps; i++) {
          const x = -w * 0.1 + (w * 1.2 * i) / steps;
          const u = x / w;
          let y =
            yy +
            Math.sin(u * 3.1 + t * sp + b) * amp +
            Math.sin(u * 7.3 - t * sp * 1.7 + b * 2) * amp * 0.42 +
            Math.sin(u * 1.4 + t * 0.09) * amp * 0.7;
          // The curtain bows where you touch it. Vertical only — pushing the
          // band sideways just smears it, but a dent reads as cloth.
          const dsp = disturb(x, y, 0.35);
          if (dsp) y += dsp[1];
          g.lineTo(x, y);
        }
        for (let i = steps; i >= 0; i--) {
          const x = -w * 0.1 + (w * 1.2 * i) / steps;
          const u = x / w;
          const y =
            yy +
            Math.sin(u * 3.1 + t * sp + b) * amp +
            Math.sin(u * 7.3 - t * sp * 1.7 + b * 2) * amp * 0.42 +
            Math.sin(u * 1.4 + t * 0.09) * amp * 0.7;
          g.lineTo(x, y + drop * (0.6 + 0.4 * Math.sin(u * 2.2 + t * 0.2)));
        }
        g.closePath();

        const ag = g.createLinearGradient(0, yy - amp, 0, yy + drop);
        const cs = col[0] + "," + col[1] + "," + col[2];
        ag.addColorStop(0, "rgba(" + cs + ",0)");
        ag.addColorStop(0.22, "rgba(" + cs + "," + alpha * (1 - f * 0.35) + ")");
        ag.addColorStop(0.6, "rgba(" + cs + "," + alpha * 0.4 + ")");
        ag.addColorStop(1, "rgba(" + cs + ",0)");
        g.fillStyle = ag;
        g.fill();
      }
      g.globalCompositeOperation = "source-over";
    }

    // Snow computed straight from the clock — no particle array, no drift on
    // resize, and identical every playthrough.
    function snow(t, count, opts) {
      const o = opts || {};
      const speed = o.speed || 1;
      const wind = o.wind || 0.18;
      const size = o.size || 1;
      const alpha = o.alpha != null ? o.alpha : 0.75;
      const sr = rng(o.seed || 7);
      const n = Math.max(6, Math.round(count * quality));
      g.fillStyle = o.color || "rgba(232,242,248,1)";
      for (let i = 0; i < n; i++) {
        const sx = sr() * w;
        const ph = sr() * TAU;
        const depth = 0.35 + sr() * 0.65;
        const fall = (h * 0.075 * speed) * depth;
        let y = mod(sr() * h + t * fall, h + 40) - 20;
        let x =
          mod(sx + t * w * wind * depth * 0.16 + Math.sin(t * 0.7 * depth + ph) * 22 * depth, w + 60) - 30;
        // Lighter flakes are thrown further by the same gust.
        const dsp = disturb(x, y, 0.5 + (1 - depth) * 0.8);
        if (dsp) { x += dsp[0]; y += dsp[1]; }
        const r = (0.7 + depth * 1.9) * size;
        g.globalAlpha = alpha * (0.28 + depth * 0.72);
        g.beginPath();
        g.arc(x, y, r, 0, TAU);
        g.fill();
      }
      g.globalAlpha = 1;
    }

    // A snow ridge: layered sine harmonics, filled to the bottom of frame.
    function ridge(baseY, amp, freq, phase, color) {
      const x0 = -w * 0.3;
      const x1 = w * 1.3;
      g.beginPath();
      g.moveTo(x0, h * 1.4);
      for (let x = x0; x <= x1; x += 8) {
        const u = x / w;
        const y =
          baseY +
          Math.sin(u * freq + phase) * amp +
          Math.sin(u * freq * 2.3 + phase * 1.7) * amp * 0.36 +
          Math.sin(u * freq * 0.6 - phase * 0.5) * amp * 0.6;
        g.lineTo(x, y);
      }
      g.lineTo(x1, h * 1.4);
      g.closePath();
      g.fillStyle = color;
      g.fill();
    }

    // A cloaked figure. Silhouettes read better than detail at this scale, and
    // they hide the fact that nobody here has a face.
    function figure(x, y, ht, o) {
      const op = o || {};
      const bob = op.bob || 0;
      const yy = y + bob;
      const bw2 = ht * 0.34;
      g.fillStyle = op.color || "#05090f";
      g.beginPath();
      g.moveTo(x - bw2 * 0.55, yy);                                   // hem left
      g.quadraticCurveTo(x - bw2 * 0.62, yy - ht * 0.45, x - bw2 * 0.34, yy - ht * 0.7);
      g.quadraticCurveTo(x - bw2 * 0.4, yy - ht * 0.92, x, yy - ht);   // hood
      g.quadraticCurveTo(x + bw2 * 0.4, yy - ht * 0.92, x + bw2 * 0.34, yy - ht * 0.7);
      g.quadraticCurveTo(x + bw2 * 0.62, yy - ht * 0.45, x + bw2 * 0.55, yy);
      g.closePath();
      g.fill();
      if (op.rim) {
        g.save();
        g.globalCompositeOperation = "lighter";
        g.strokeStyle = op.rim;
        g.lineWidth = Math.max(0.8, ht * 0.022);
        g.globalAlpha = op.rimAlpha != null ? op.rimAlpha : 0.5;
        g.beginPath();
        g.moveTo(x + bw2 * 0.55, yy);
        g.quadraticCurveTo(x + bw2 * 0.62, yy - ht * 0.45, x + bw2 * 0.34, yy - ht * 0.7);
        g.quadraticCurveTo(x + bw2 * 0.4, yy - ht * 0.92, x, yy - ht);
        g.stroke();
        g.restore();
      }
    }

    // Kneeling: wider at the hem, head bowed forward. Reads as a person
    // crouched over something, which the standing cloak never did.
    function kneeler(x, y, ht, o) {
      const op = o || {};
      const face = op.face || 1;                 // 1 faces right, -1 faces left
      g.save();
      g.translate(x, y);
      g.scale(face, 1);
      g.fillStyle = op.color || "#05090f";
      // Cloak: hem spread on the snow, shoulders pitched forward over the work.
      g.beginPath();
      g.moveTo(-ht * 0.42, 0);
      g.quadraticCurveTo(-ht * 0.46, -ht * 0.28, -ht * 0.3, -ht * 0.46);
      g.quadraticCurveTo(-ht * 0.18, -ht * 0.64, ht * 0.02, -ht * 0.64);
      g.quadraticCurveTo(ht * 0.24, -ht * 0.6, ht * 0.3, -ht * 0.4);
      g.quadraticCurveTo(ht * 0.4, -ht * 0.18, ht * 0.38, 0);
      g.closePath();
      g.fill();
      // Head as its own mass, tipped down. The notch of neck between the two
      // is the whole reason this reads as a person and not a boulder.
      g.beginPath();
      g.ellipse(ht * 0.14, -ht * 0.76, ht * 0.135, ht * 0.16, -0.38, 0, TAU);
      g.fill();
      if (op.rim) {
        g.save();
        g.globalCompositeOperation = "lighter";
        g.strokeStyle = op.rim;
        g.lineWidth = Math.max(0.9, ht * 0.026);
        g.globalAlpha = clamp(op.rimAlpha != null ? op.rimAlpha : 0.45, 0, 1);
        g.beginPath();
        g.ellipse(ht * 0.14, -ht * 0.76, ht * 0.135, ht * 0.16, -0.38, Math.PI * 0.9, Math.PI * 1.85);
        g.stroke();
        g.beginPath();
        g.moveTo(-ht * 0.3, -ht * 0.46);
        g.quadraticCurveTo(-ht * 0.18, -ht * 0.64, ht * 0.02, -ht * 0.64);
        g.stroke();
        g.restore();
      }
      g.restore();
    }

    // A standing hound — Ember, mostly. Unit coords put the feet on y=0 and
    // the head up and to the right; `face: -1` mirrors her.
    function hound(x, y, s, o) {
      const op = o || {};
      const breathe = 1 + Math.sin((op.t || 0) * 2.1) * 0.025;
      // She notices a hand near her: head comes up, tail goes faster. This is
      // the one thing in the story that looks back at you.
      const gd = disturb(x, y - s, 0.1);
      const perk = gd ? clamp((Math.abs(gd[0]) + Math.abs(gd[1])) / (s * 0.9), 0, 1) : 0;
      g.save();
      g.translate(x, y);
      g.scale(s * (op.face === -1 ? -1 : 1), s * breathe);
      g.fillStyle = op.color || "#0a1017";

      const leg = (lx, lw, lh) => {
        g.beginPath();
        g.moveTo(lx - lw / 2, -0.54);
        g.lineTo(lx + lw / 2, -0.54);
        g.lineTo(lx + lw * 0.34, -0.54 + lh);
        g.lineTo(lx - lw * 0.44, -0.54 + lh);
        g.closePath();
        g.fill();
      };
      leg(-0.92, 0.17, 0.56);
      leg(-0.66, 0.15, 0.54);
      leg(0.46, 0.15, 0.55);
      leg(0.72, 0.17, 0.54);

      // barrel of the body
      g.beginPath();
      g.moveTo(-1.14, -0.58);
      g.bezierCurveTo(-1.26, -0.96, -0.82, -1.1, -0.2, -1.08);
      g.bezierCurveTo(0.3, -1.07, 0.6, -1.02, 0.8, -0.97);
      g.bezierCurveTo(0.94, -0.94, 0.98, -0.72, 0.88, -0.56);
      g.bezierCurveTo(0.5, -0.44, -0.6, -0.44, -1.14, -0.58);
      g.closePath();
      g.fill();

      // neck, skull and muzzle — lifted when she has noticed something
      g.save();
      g.translate(0.62, -1.0);
      g.rotate(-perk * 0.3);
      g.translate(-0.62, 1.0);
      g.beginPath();
      g.moveTo(0.62, -1.0);
      g.bezierCurveTo(0.8, -1.22, 0.94, -1.36, 1.08, -1.48);
      g.bezierCurveTo(1.24, -1.62, 1.46, -1.58, 1.5, -1.42);
      g.bezierCurveTo(1.74, -1.38, 1.84, -1.28, 1.8, -1.17);
      g.bezierCurveTo(1.62, -1.11, 1.42, -1.13, 1.3, -1.15);
      g.bezierCurveTo(1.14, -1.11, 1.0, -1.02, 0.9, -0.95);
      g.closePath();
      g.fill();

      // pricked ear — rides with the head, and pricks further when alert
      g.beginPath();
      g.moveTo(1.2, -1.52);
      g.lineTo(1.15, -1.82 - perk * 0.16);
      g.lineTo(1.4, -1.58);
      g.closePath();
      g.fill();
      g.restore();

      // tail, carried up — wags faster once she has noticed you
      const wag = Math.sin((op.t || 0) * (3 + perk * 14)) * (0.05 + perk * 0.22);
      g.save();
      g.translate(-1.02, -0.9);
      g.rotate(wag);
      g.translate(1.02, 0.9);
      g.beginPath();
      g.moveTo(-1.08, -0.94);
      g.bezierCurveTo(-1.5, -1.04, -1.68, -1.38, -1.56, -1.62);
      g.lineTo(-1.38, -1.53);
      g.bezierCurveTo(-1.46, -1.32, -1.3, -1.06, -0.98, -0.84);
      g.closePath();
      g.fill();
      g.restore();

      g.restore();
    }

    // Fire built from overlapping teardrops plus an additive core.
    function flame(x, y, s, t, o) {
      const op = o || {};
      const n = op.tongues || 5;
      // A gust across a fire bends it and makes it gutter — fan the brazier
      // with your finger and the flame leans away and flares.
      // Kept deliberately small: a draught bends a fire, it does not detonate
      // one. A wider clamp splayed the tongues into flat translucent triangles.
      const gd = disturb(x, y - s * 0.4, 0.12);
      const lean = gd ? clamp(gd[0], -s * 0.3, s * 0.3) : 0;
      const gutter = gd ? 1 + clamp(Math.abs(gd[0]) / (s + 1), 0, 1) * 0.14 : 1;
      g.save();
      g.globalCompositeOperation = "lighter";
      for (let i = 0; i < n; i++) {
        const ph = i * 1.9;
        const sway = Math.sin(t * 3.1 + ph) * s * 0.16 + lean * (0.5 + i * 0.12);
        const hgt = s * (0.72 + 0.5 * (0.5 + 0.5 * Math.sin(t * 4.3 + ph * 1.7))) * gutter;
        const wid = s * (0.34 - i * 0.03) * (0.85 + 0.3 * Math.sin(t * 2.3 + ph));
        const a = (0.2 + 0.16 * Math.sin(t * 5 + ph)) * (op.alpha != null ? op.alpha : 1);
        const fg = g.createLinearGradient(x, y - hgt, x, y);
        fg.addColorStop(0, "rgba(255,236,190,0)");
        fg.addColorStop(0.35, "rgba(255,190,90," + a * 0.9 + ")");
        fg.addColorStop(1, "rgba(255,110,30," + a + ")");
        g.fillStyle = fg;
        g.beginPath();
        g.moveTo(x - wid, y);
        g.quadraticCurveTo(x - wid * 0.9 + sway, y - hgt * 0.55, x + sway * 1.4, y - hgt);
        g.quadraticCurveTo(x + wid * 0.9 + sway, y - hgt * 0.55, x + wid, y);
        g.closePath();
        g.fill();
      }
      const core = (op.alpha != null ? op.alpha : 1);
      glow(x, y - s * 0.28, s * 1.5, "255,150,50", 0.34 * core);
      glow(x, y - s * 0.18, s * 0.62, "255,226,170", 0.5 * core);
      g.restore();
    }

    // Embers rise analytically, same trick as the snow.
    function embers(x, y, t, count, spread, rise, o) {
      const op = o || {};
      const er = rng(op.seed || 88);
      g.save();
      g.globalCompositeOperation = "lighter";
      for (let i = 0; i < count; i++) {
        const ph = er() * TAU;
        const life = 1.6 + er() * 2.6;
        const k = ((t + ph) % life) / life;
        let ex = x + (er() - 0.5) * spread + Math.sin(t * 1.6 + ph) * spread * 0.24 * k;
        let ey = y - k * rise;
        // Embers are the lightest thing in the story and scatter the furthest.
        const dsp = disturb(ex, ey, 1.5);
        if (dsp) { ex += dsp[0]; ey += dsp[1]; }
        const a = (1 - k) * (0.5 + er() * 0.5) * (op.alpha != null ? op.alpha : 1);
        const r = (0.9 + er() * 1.5) * (1 - k * 0.4);
        g.fillStyle = "rgba(255," + Math.round(150 + er() * 80) + ",70," + a + ")";
        g.beginPath();
        g.arc(ex, ey, r, 0, TAU);
        g.fill();
      }
      g.restore();
    }

    // A stone tower, crenellated, with one warm window.
    function tower(x, baseY, ht, wid, o) {
      const op = o || {};
      const col = op.color || "#070c14";
      g.fillStyle = col;
      const topW = wid * 0.82;
      g.beginPath();
      g.moveTo(x - wid / 2, baseY);
      g.lineTo(x - topW / 2, baseY - ht);
      g.lineTo(x + topW / 2, baseY - ht);
      g.lineTo(x + wid / 2, baseY);
      g.closePath();
      g.fill();
      // merlons
      const merl = Math.max(2, Math.round(topW / 5));
      const mw = topW / (merl * 2 - 1);
      for (let i = 0; i < merl; i++) {
        g.fillRect(x - topW / 2 + i * mw * 2, baseY - ht - wid * 0.16, mw, wid * 0.17);
      }
      if (op.window) {
        const wx = x;
        const wy = baseY - ht * 0.52;
        const ww = Math.max(1.4, wid * 0.15);
        const flick = 0.72 + 0.28 * Math.sin((op.t || 0) * 6.1) * Math.sin((op.t || 0) * 2.3);
        g.fillStyle = "rgba(255,178,90," + 0.92 * flick + ")";
        g.fillRect(wx - ww / 2, wy - ww * 1.5, ww, ww * 2.4);
        g.save();
        g.globalCompositeOperation = "lighter";
        glow(wx, wy, wid * 1.5, "255,160,70", 0.3 * flick);
        g.restore();
      }
    }

    function vignette(a) {
      g.save();
      g.globalAlpha = a != null ? a : 1;
      paintVignette(g, w, h);
      g.restore();
    }

    // ---- the story --------------------------------------------------------
    // Each chapter owns its own duration, music cue, timed lines and painter.
    // Timings are in seconds from the start of the chapter.

    const CHOICE_AT = 21.5;

    const SCENES = [
      {
        id: "waste", num: "I", name: "THE WASTE", dur: 26,
        music: { preset: "drone", intensity: 0.24, tempo: 58 },
        lines: [
          [1.5, "Three rangers went out past the Rime, where the maps give up and go white."],
          [7.5, "They were looking for a village that had stopped sending smoke."],
          [13.0, "They found it. Every door stood open. Every hearth was cold, and swept, and set for supper."],
          [19.5, "Something followed them home. Only two lanterns came back."]
        ],
        draw: drawWaste
      },
      {
        id: "reach", num: "II", name: "ASHEN REACH", dur: 25,
        music: { preset: "ambient", intensity: 0.3, tempo: 62 },
        lines: [
          [1.5, "Ashen Reach is the ninth tower on the wall of ice — the last one anybody still knows the name of."],
          [8.0, "Nine towers, nine fires. Light one and the next must answer, and the next, all the way down to the green country."],
          [15.0, "The fire at Ashen Reach had not been lit in three hundred years."],
          [20.0, "Wren Coldhalt had tended it since she was eleven. She had never once seen it burn."]
        ],
        draw: drawReach
      },
      {
        id: "return", num: "III", name: "THE RANGER", dur: 25,
        music: { preset: "spooky", intensity: 0.34, tempo: 60 },
        lines: [
          [1.5, "Hessk came back at first light, walking, with frost grown through his beard like roots."],
          [8.0, "He would not go near the hearth. He said the warmth was too loud."],
          [14.0, "Captain Calder asked him what he had found out there."],
          [19.0, "Hessk said one word. Nobody knew the language. Everybody understood it."]
        ],
        draw: drawReturn
      },
      {
        id: "sky", num: "IV", name: "THE OMEN", dur: 23,
        music: { preset: "spooky", intensity: 0.5, tempo: 66 },
        lines: [
          [1.5, "That night the lights above the Rime came in red — which the old books say has happened twice."],
          [8.0, "Both times, the books stop shortly after."],
          [12.5, "Every raven at Ashen Reach left the cote at once, went south, and did not circle."],
          [18.0, "Birds know the difference between weather and news."]
        ],
        draw: drawSky
      },
      {
        id: "whelp", num: "V", name: "THE WHELP", dur: 25,
        music: { preset: "cozy", intensity: 0.3, tempo: 64 },
        lines: [
          [1.5, "Wren found her in the drift below the ice: a white hound the size of a pony. Dead. Stiff. Curled."],
          [8.5, "Curled around something still breathing."],
          [13.0, "One whelp. Grey as ash, eyes not yet open, and furious about the cold."],
          [18.5, "Wren put her inside her coat and called her Ember — a hopeful sort of name, for that winter."]
        ],
        draw: drawWhelp
      },
      {
        id: "council", num: "VI", name: "THE COUNCIL", dur: 32,
        music: { preset: "ambient", intensity: 0.42, tempo: 68 },
        lines: [
          [1.5, "Calder called the watch together. It did not take long. There were nine of them left."],
          [7.5, "Light the fire, and every lord in the green country marches north on the word of one frozen man."],
          [14.0, "Wait for proof, and the proof may be the thing that comes through the gate."],
          [19.0, "Calder was sixty-one years old, and had never made a decision that mattered."]
        ],
        draw: drawCouncil
      },
      {
        id: "quiet", num: "VII", name: "THE QUIET", dur: 26,
        music: { preset: "spooky", intensity: 0.85, tempo: 78 },
        lines: [
          [1.5, {
            light: "Calder chose to wait. He was not a coward. He was only certain there would be time.",
            wait: "Calder chose to wait, as you would have. There is no shame in it. There was simply no time.",
            ride: "Calder sent a rider south, as you would have. She made four miles.",
            none: "Calder chose to wait. He was not a coward. He was only certain there would be time."
          }],
          [8.0, "The storm came in without wind — the part nobody believes until they have stood in it."],
          [14.5, "They walked out of the white on the fourth night. Tall. Unhurried. Patient as a season."],
          [20.5, "The gate held for less than an hour."]
        ],
        draw: drawQuiet
      },
      {
        id: "climb", num: "VIII", name: "TWO HUNDRED AND SIX", dur: 23,
        music: { preset: "pulse", intensity: 0.68, tempo: 96 },
        lines: [
          [1.5, "Wren went up. Two hundred and six steps, and a dog too young to know better coming up behind her."],
          [8.0, "Below her the yard went quiet. Not silent — quiet. Quiet is something you do on purpose."],
          [14.5, "The oil had frozen. She burned her gloves. She burned the flag."],
          [18.5, "She burned the roll of every soul who had ever kept that tower, and thought they would not mind."]
        ],
        draw: drawClimb
      },
      {
        id: "fire", num: "IX", name: "THE NINTH FIRE", dur: 21,
        music: { preset: "triumph", intensity: 0.8, tempo: 92 },
        lines: [
          [1.5, "It caught."],
          [5.0, "Three hundred years of waiting went up in one orange breath, and the ice turned the colour of a hearth."],
          [12.0, "Wren stood in the heat with her hands ruined, and watched the south."],
          [17.5, "Nothing."]
        ],
        draw: drawFire
      },
      {
        id: "silence", num: "X", name: "THE SILENCE", dur: 25,
        music: { preset: "drone", intensity: 0.12, tempo: 52 },
        lines: [
          [2.0, "The eighth tower did not answer."],
          [6.5, "She counted to a hundred. Then to a thousand. Ember leaned against her leg and shook, and it was not the cold."],
          [13.5, "The eighth tower had stood dark for eleven years. Nobody had thought to tell Ashen Reach."],
          [19.5, "So that was that. A fire nobody would ever see, burning on the roof of the world."]
        ],
        draw: drawSilence
      },
      {
        id: "answer", num: "XI", name: "THE ANSWER", dur: 27,
        music: { preset: "triumph", intensity: 0.9, tempo: 104 },
        lines: [
          [1.5, "Except."],
          [4.5, "Twelve miles on, in a tower with no name and no roster, a fisherman's daughter had climbed up to be alone."],
          [11.5, "She saw an orange star that had not been there the night before — and she had nothing to burn but her boat."],
          [19.0, "She burned her boat. The seventh answered her. The sixth answered the seventh."]
        ],
        draw: drawAnswer
      },
      {
        id: "coda", num: "XII", name: "THE GREEN COUNTRY", dur: 24,
        music: { preset: "cozy", intensity: 0.38, tempo: 72 },
        lines: [
          [1.5, "By morning the Rime was a necklace of fire from the sea to the mountains, and every lord in the green country woke to a sky the wrong colour."],
          [9.5, "They came. Late, and badly, and arguing the whole way. But they came."],
          [15.5, "What happened after is a longer story, and not a kind one. It begins here —"],
          [19.0, "with a girl who burned everything she had for a signal she was almost certain no one would see."]
        ],
        draw: drawCoda
      }
    ];

    const TOTAL = SCENES.reduce((a, s) => a + s.dur, 0);

    const CHOICES = [
      { key: "light", label: "Light the fire", sub: "Call the realm on one man's word." },
      { key: "wait", label: "Wait for proof", sub: "Be certain before you cry wolf." },
      { key: "ride", label: "Ride south yourself", sub: "Carry the warning by hand." }
    ];

    // ---- state ------------------------------------------------------------
    const MODE = { TITLE: 0, STORY: 1, END: 2 };
    let mode = MODE.TITLE;
    let scene = 0;
    let st = 0;                 // seconds into the current chapter
    let clock = 0;              // free-running seconds, for idle animation
    let paused = false;
    let muted = false;
    let held = false;           // timeline paused at the council choice
    let heldFor = 0;            // seconds the council has been waiting
    let choice = null;
    let tallyRows = null;
    let tallyState = "none";    // none | sending | ok | fail
    let resultsAt = -1;
    let furthest = 0;
    let music = null;
    let endAt = 0;
    let started = false;

    // ---- narration --------------------------------------------------------
    const wrapCache = new Map();

    function wrapText(text, font, maxW) {
      const key = font + "|" + Math.round(maxW) + "|" + text;
      const hit = wrapCache.get(key);
      if (hit) return hit;
      g.font = font;
      const words = String(text).split(" ");
      const out = [];
      let line = "";
      for (let i = 0; i < words.length; i++) {
        const next = line ? line + " " + words[i] : words[i];
        if (g.measureText(next).width > maxW && line) {
          out.push(line);
          line = words[i];
        } else line = next;
      }
      if (line) out.push(line);
      if (wrapCache.size > 400) wrapCache.clear();
      wrapCache.set(key, out);
      return out;
    }

    // Letter-spaced text, drawn by hand so it works everywhere.
    function tracked(text, x, y, spacing, align) {
      const chars = String(text).split("");
      let total = 0;
      for (let i = 0; i < chars.length; i++) {
        total += g.measureText(chars[i]).width + (i < chars.length - 1 ? spacing : 0);
      }
      let cx = align === "center" ? x - total / 2 : align === "right" ? x - total : x;
      const prev = g.textAlign;
      g.textAlign = "left";
      for (let i = 0; i < chars.length; i++) {
        g.fillText(chars[i], cx, y);
        cx += g.measureText(chars[i]).width + spacing;
      }
      g.textAlign = prev;
    }

    function lineTextOf(entry) {
      const v = entry[1];
      if (typeof v === "string") return v;
      return v[choice || "none"] || v.none;
    }

    function drawNarration(s, fade) {
      const size = clamp(Math.round(Math.min(w, h * 0.62) / 19), 17, 27);
      const font = "300 " + size + "px " + BODY;
      const lh = Math.round(size * 1.38);
      const maxW = Math.min(w - 46, 620);
      const bottom = h - safeBot() - Math.max(26, h * 0.045);

      // Which lines have appeared, newest last, capped so the block stays calm.
      const groups = [];
      for (let i = 0; i < s.lines.length; i++) {
        if (st >= s.lines[i][0]) {
          groups.push({ at: s.lines[i][0], rows: wrapText(lineTextOf(s.lines[i]), font, maxW) });
        }
      }
      // Three at a time. Four fills nearly half the screen and starts burying
      // whatever the chapter is actually showing you.
      while (groups.length > 3) groups.shift();
      if (!groups.length) return;

      let rows = 0;
      for (let i = 0; i < groups.length; i++) rows += groups[i].rows.length;
      const blockH = rows * lh + (groups.length - 1) * Math.round(size * 0.5);
      const top = bottom - blockH;

      // Scrim so text is legible over any chapter.
      const sg = g.createLinearGradient(0, top - size * 3.4, 0, h);
      sg.addColorStop(0, "rgba(4,7,14,0)");
      sg.addColorStop(0.42, "rgba(4,7,14,0.5)");
      sg.addColorStop(1, "rgba(4,7,14,0.88)");
      g.globalAlpha = fade;
      g.fillStyle = sg;
      g.fillRect(0, top - size * 3.4, w, h - top + size * 3.4);
      g.globalAlpha = 1;

      g.font = font;
      g.textAlign = "center";
      g.textBaseline = "alphabetic";
      let y = top + size;
      for (let i = 0; i < groups.length; i++) {
        const grp = groups[i];
        const app = clamp((st - grp.at) / 0.75, 0, 1);
        const dist = groups.length - 1 - i;
        const dim = clamp(1 - dist * 0.24, 0.34, 1);
        const a = easeOut(app) * dim * fade;
        const rise = (1 - easeOut(app)) * 12;
        g.globalAlpha = a;
        g.fillStyle = C.ink;
        for (let r = 0; r < grp.rows.length; r++) {
          g.fillText(grp.rows[r], w / 2, y + r * lh + rise);
        }
        y += grp.rows.length * lh + Math.round(size * 0.5);
      }
      g.globalAlpha = 1;
    }

    function drawChapterCard(s) {
      const a = ramp(st, 0.3, 1.4) * (1 - ramp(st, 5.0, 6.4));
      if (a <= 0.01) return;
      const y = safeTop() + Math.max(44, h * 0.075);
      const size = clamp(Math.round(w / 30), 11, 16);
      g.globalAlpha = a * 0.62;
      g.fillStyle = C.pale;
      g.font = size + "px " + SERIF;
      tracked(s.num, w / 2, y, size * 0.34, "center");
      g.globalAlpha = a * 0.9;
      g.font = Math.round(size * 1.18) + "px " + SERIF;
      tracked(s.name, w / 2, y + size * 1.85, size * 0.3, "center");
      // hairline rules either side
      const tw = g.measureText(s.name).width * 1.35;
      g.globalAlpha = a * 0.3;
      g.strokeStyle = C.pale;
      g.lineWidth = 0.7;
      g.beginPath();
      g.moveTo(w / 2 - tw, y + size * 1.85 - size * 0.34);
      g.lineTo(w / 2 - tw * 0.62, y + size * 1.85 - size * 0.34);
      g.moveTo(w / 2 + tw * 0.62, y + size * 1.85 - size * 0.34);
      g.lineTo(w / 2 + tw, y + size * 1.85 - size * 0.34);
      g.stroke();
      g.globalAlpha = 1;
    }

    function drawProgress() {
      const done = SCENES.slice(0, scene).reduce((a, s) => a + s.dur, 0) + st;
      const p = clamp(done / TOTAL, 0, 1);
      const y = safeTop() + 8;
      g.fillStyle = "rgba(255,255,255,0.1)";
      g.fillRect(14, y, w - 28, 1.6);
      g.fillStyle = "rgba(207,232,245,0.62)";
      g.fillRect(14, y, (w - 28) * p, 1.6);
    }

    // ======================================================================
    // CHAPTER PAINTERS
    // Each takes p (0..1 through the chapter) and t (seconds, free-running).
    // ======================================================================

    // I — three lanterns crossing the waste, and the thing behind them.
    function drawWaste(p, t) {
      skyGrad("#03050c", "#071021", "#0c1a2c");
      withDepth(0.06, () => { stars(0.85); twinkle(t, 0.7); });
      withDepth(0.13, () => {
        aurora(t, { y: 0.24, bands: 3, alpha: 0.3, colors: [[64, 220, 172], [56, 150, 210], [96, 200, 190]] });
      });

      withDepth(0.22, () => {
        ridge(h * 0.4, h * 0.028, 5.2, 0.4, "#0a1425");
        ridge(h * 0.48, h * 0.034, 3.4, 2.1, "#0e1b2e");
      });

      // The pale ground catches the aurora a little.
      withDepth(0.34, () => {
        const gg = g.createLinearGradient(0, h * 0.5, 0, h);
        gg.addColorStop(0, "#16273d");
        gg.addColorStop(1, "#0a1526");
        g.fillStyle = gg;
        g.fillRect(-w * 0.3, h * 0.53, w * 1.6, h * 0.7);
        ridge(h * 0.62, h * 0.022, 7.1, 5.0, "#1b3049");
      });

      const walkP = ramp(p, 0.05, 0.95);
      const baseX = lerp(-w * 0.12, w * 0.95, walkP);
      const groundY = h * 0.575;

      // The thing sits behind the rangers, so it gets the shallower plane —
      // drag left and it slides out from behind them.
      const rise = ramp(p, 0.5, 0.86);
      if (rise > 0.01) withDepth(0.5, () => {
        const sx = baseX - w * 0.28;
        const sh = h * 0.16 * rise;
        g.save();
        g.globalAlpha = 0.5 * rise;
        g.fillStyle = "#02040a";
        g.beginPath();
        g.moveTo(sx - h * 0.03, groundY + 4);
        g.quadraticCurveTo(sx - h * 0.028, groundY - sh * 0.7, sx, groundY - sh);
        g.quadraticCurveTo(sx + h * 0.028, groundY - sh * 0.7, sx + h * 0.03, groundY + 4);
        g.closePath();
        g.fill();
        g.restore();
        const eyes = ramp(p, 0.62, 0.8);
        g.save();
        g.globalCompositeOperation = "lighter";
        glow(sx - h * 0.008, groundY - sh * 0.86, h * 0.02, "180,238,255", 0.65 * eyes);
        glow(sx + h * 0.008, groundY - sh * 0.86, h * 0.02, "180,238,255", 0.65 * eyes);
        g.restore();
      });

      // Three rangers, walking right, tiny against all of it.
      const lost = ramp(p, 0.78, 0.9);            // the third lantern goes out
      withDepth(0.68, () => {
        for (let i = 0; i < 3; i++) {
          const x = baseX - i * w * 0.075;
          const bob = Math.sin(t * 3.4 + i * 1.7) * 1.4;
          const ht = h * 0.062;
          const alive = i === 2 ? 1 - lost : 1;
          // lantern first so the body reads against it
          const lx = x + ht * 0.3;
          const ly = groundY - ht * 0.42 + bob;
          if (alive > 0.01) {
            g.save();
            g.globalCompositeOperation = "lighter";
            glow(lx, ly, ht * 1.5, "255,186,96", 0.5 * alive);
            glow(lx, ly, ht * 0.34, "255,232,190", 0.75 * alive);
            g.restore();
          }
          figure(x, groundY + bob, ht, { bob: 0, color: "#04070d" });
        }
      });

      withDepth(1, () => snow(t, 90, { speed: 0.75, wind: 0.6, alpha: 0.5, seed: 3 }));
    }

    // II — the wall, the tower, one lit window.
    function drawReach(p, t) {
      skyGrad("#04070f", "#0a1426", "#12213a");
      withDepth(0.06, () => { stars(0.9); twinkle(t, 0.55); });
      withDepth(0.13, () => {
        aurora(t, { y: 0.14, bands: 2, alpha: 0.17, colors: [[70, 190, 200], [60, 130, 200]] });
      });

      const top = wallTopY();
      // The wall and its tower ride one mid plane together, so the crest keeps
      // its horizon and the tower stays planted on it.
      withDepth(0.3, () => drawReachWall(p, t, top));
      withDepth(1, () => snow(t, 110, { speed: 0.55, wind: 0.25, alpha: 0.6, seed: 12 }));
    }

    function drawReachWall(p, t, top) {
      // wavy crest of the wall
      g.save();
      g.beginPath();
      g.moveTo(0, h);
      g.lineTo(0, top + 6);
      for (let x = 0; x <= w; x += 10) {
        const u = x / w;
        g.lineTo(x, top + Math.sin(u * 6.2) * h * 0.008 + Math.sin(u * 13.4 + 1) * h * 0.004);
      }
      g.lineTo(w, h);
      g.closePath();
      g.clip();
      drawWallFace(top - 2, wallFaceH());

      // light living inside old ice
      g.globalCompositeOperation = "lighter";
      for (let i = 0; i < 3; i++) {
        const x = ((t * 9 + i * w * 0.37) % (w * 1.3)) - w * 0.15;
        const lg = g.createLinearGradient(x - w * 0.09, 0, x + w * 0.09, 0);
        lg.addColorStop(0, "rgba(150,214,244,0)");
        lg.addColorStop(0.5, "rgba(150,214,244,0.075)");
        lg.addColorStop(1, "rgba(150,214,244,0)");
        g.fillStyle = lg;
        g.fillRect(x - w * 0.09, top, w * 0.18, h);
      }
      g.restore();

      // bright crest line
      g.strokeStyle = "rgba(190,228,248,0.75)";
      g.lineWidth = 1.6;
      g.beginPath();
      for (let x = 0; x <= w; x += 10) {
        const u = x / w;
        const y = top + Math.sin(u * 6.2) * h * 0.008 + Math.sin(u * 13.4 + 1) * h * 0.004;
        if (x === 0) g.moveTo(x, y); else g.lineTo(x, y);
      }
      g.stroke();

      // Ashen Reach itself, with a figure on the parapet.
      const tx = w * 0.66;
      const ty = top + Math.sin((tx / w) * 6.2) * h * 0.008 + Math.sin((tx / w) * 13.4 + 1) * h * 0.004 + 2;
      const th = h * 0.2;
      tower(tx, ty, th, h * 0.07, { window: true, t: t, color: "#060a12" });
      // the brazier, cold and waiting
      g.fillStyle = "#0a1019";
      g.fillRect(tx - h * 0.018, ty - th - h * 0.048, h * 0.036, h * 0.026);
      const pfig = ramp(p, 0.25, 0.6);
      if (pfig > 0.01) {
        g.globalAlpha = pfig;
        figure(tx + h * 0.032, ty - th - h * 0.02, h * 0.032, { color: "#04070d" });
        g.globalAlpha = 1;
      }
    }

    // III — a ranger comes home wrong.
    function drawReturn(p, t) {
      // gate arch cut out of the dark
      const gx = w * 0.5;
      const gy = h * 0.6;
      const gw = Math.min(w * 0.74, h * 0.36);
      g.fillStyle = "#070b13";
      g.fillRect(0, 0, w, h);
      g.save();
      g.beginPath();
      g.moveTo(gx - gw / 2, gy);
      g.lineTo(gx - gw / 2, gy - gw * 0.62);
      g.quadraticCurveTo(gx, gy - gw * 1.28, gx + gw / 2, gy - gw * 0.62);
      g.lineTo(gx + gw / 2, gy);
      g.closePath();
      g.clip();
      const ag = g.createLinearGradient(0, gy - gw, 0, gy);
      ag.addColorStop(0, "#152a44");
      ag.addColorStop(1, "#0b1728");
      g.fillStyle = ag;
      g.fillRect(gx - gw, gy - gw * 1.4, gw * 2, gw * 1.5);
      // The night beyond the gate sits deepest, so it shifts inside the arch
      // like a real view through an opening.
      withDepth(0.12, () => snow(t, 46, { speed: 1.5, wind: 1.5, alpha: 0.5, seed: 21 }));
      g.restore();

      // two torches, warm, one each side
      const flick = 0.82 + 0.18 * Math.sin(t * 7.3) * Math.sin(t * 3.1);
      const tly = h * 0.34;
      const try_ = h * 0.4;
      g.save();
      g.globalCompositeOperation = "lighter";
      glow(w * 0.14, tly, Math.max(w, h) * 0.4, "255,142,54", 0.2 * flick);
      glow(w * 0.88, try_, Math.max(w, h) * 0.28, "255,132,48", 0.12 * flick);
      g.restore();

      // Hessk, kneeling, lit orange on one side and ice-blue on the other.
      const kh = h * 0.19;
      withDepth(0.4, () => {
        kneeler(gx + kh * 0.1, gy, kh, { face: -1, color: "#04070d" });
        g.save();
        g.globalCompositeOperation = "lighter";
        g.strokeStyle = "rgba(150,214,244,0.42)";
        g.lineWidth = 2;
        g.beginPath();
        g.moveTo(gx + kh * 0.44, gy - kh * 0.5);
        g.quadraticCurveTo(gx + kh * 0.4, gy - kh * 0.74, gx + kh * 0.18, gy - kh * 0.8);
        g.stroke();
        g.restore();

        // breath — the one warm thing still working
        g.save();
        g.globalCompositeOperation = "lighter";
        for (let i = 0; i < 4; i++) {
          const k = (t * 0.42 + i * 0.25) % 1;
          const bx = gx - kh * 0.16 - k * kh * 0.42;
          const by = gy - kh * 0.56 - k * kh * 0.4;
          glow(bx, by, kh * (0.07 + k * 0.18), "200,226,245", (1 - k) * 0.18);
        }
        g.restore();
      });

      // The torches and watchers are nearest — they swing across the kneeling
      // figure as you look about the gateyard.
      const seen = ramp(p, 0.3, 0.6);
      withDepth(0.85, () => {
        flame(w * 0.14, tly, h * 0.045, t, {});
        flame(w * 0.88, try_, h * 0.036, t + 3, {});
        g.globalAlpha = seen * 0.9;
        figure(w * 0.17, gy + h * 0.02, h * 0.21, { color: "#03060b", rim: "#ff9a44", rimAlpha: 0.3 });
        figure(w * 0.84, gy + h * 0.035, h * 0.195, { color: "#03060b", rim: "#ff9a44", rimAlpha: 0.2 });
        g.globalAlpha = 1;
      });

      embers(w * 0.14, tly, t, 16, w * 0.1, h * 0.34, { seed: 5, alpha: 0.7 });
      embers(w * 0.88, try_, t + 2, 10, w * 0.08, h * 0.26, { seed: 9, alpha: 0.5 });
    }

    // IV — the lights come in red, and the ravens leave.
    function drawSky(p, t) {
      const red = ramp(p, 0.16, 0.46);
      skyGrad("#04060e", lerpRgb([10, 20, 38], [23, 11, 18], red), lerpRgb([14, 28, 48], [34, 16, 26], red));
      withDepth(0.06, () => { stars(0.95); twinkle(t, 0.6); });

      withDepth(0.14, () => {
        aurora(t, {
          y: 0.2, bands: 3, alpha: 0.34,
          colors: [
            mixCol([70, 220, 176], [226, 66, 52], red),
            mixCol([60, 150, 210], [180, 40, 60], red),
            mixCol([100, 200, 190], [255, 110, 74], red)
          ]
        });
        if (red > 0.2) {
          g.save();
          g.globalCompositeOperation = "lighter";
          glow(w * 0.5, h * 0.24, Math.max(w, h) * 0.5, "200,50,44", 0.075 * red);
          g.restore();
        }
      });

      // the wall, low and dark, so the sky owns the frame
      const top = h * 0.6;
      withDepth(0.26, () => {
        g.fillStyle = "#080f1c";
        g.fillRect(-w * 0.3, top, w * 1.6, h * 0.8);
        g.strokeStyle = "rgba(150,190,220," + (0.3 + 0.3 * red) + ")";
        g.lineWidth = 1.4;
        g.beginPath();
        g.moveTo(-w * 0.3, top);
        g.lineTo(w * 1.3, top);
        g.stroke();
        tower(w * 0.2, top + 1, h * 0.09, h * 0.035, { color: "#060a14" });
        tower(w * 0.74, top + 1, h * 0.07, h * 0.028, { color: "#060a14" });
      });

      // Every raven at once, south, no circling. The flock already carries its
      // own per-bird depth, so each bird rides a plane matched to its size —
      // look around and the near birds sweep past the far ones.
      const fly = ramp(p, 0.34, 1.0);
      const br = rng(66);
      g.lineCap = "round";
      const n = 46;
      for (let i = 0; i < n; i++) {
        const lane = br();
        const depth = 0.4 + br() * 0.6;
        const ph = br() * TAU;
        const speed = (0.16 + br() * 0.1) * depth;
        const travel = (fly * 1.5 + br() * 0.5) % 1.6;
        if (travel <= 0.02) continue;
        const x0 = w * 1.15 - travel * w * 1.5 * (0.7 + depth * 0.5);
        if (x0 < -w * 0.1) continue;
        const y0 = h * (0.12 + lane * 0.5) + Math.sin(t * 1.1 + ph) * h * 0.02;
        const s = (3 + depth * 9) * (h / 720 + 0.55);
        withDepth(0.3 + depth * 0.6, () => {
          // Startled birds break formation and beat harder for a moment.
          const dsp = disturb(x0, y0, 1.1);
          const x = x0 + (dsp ? dsp[0] : 0);
          const y = y0 + (dsp ? dsp[1] : 0);
          const panic = dsp ? clamp((Math.abs(dsp[0]) + Math.abs(dsp[1])) / (s * 4), 0, 1) : 0;
          const tip = Math.sin(t * (6 + speed * 20 + panic * 26) + ph) * s * (0.75 + panic * 0.5);
          g.save();
          // and bank into the turn
          g.translate(x, y);
          g.rotate(clamp((dsp ? dsp[1] : 0) / (s * 8), -0.5, 0.5));
          g.translate(-x, -y);
          g.strokeStyle = "rgba(6,9,16,0.92)";
          g.lineWidth = Math.max(1, s * 0.19);
          g.globalAlpha = clamp(depth * 1.2, 0.3, 1) * clamp(fly * 2, 0, 1);
          g.beginPath();
          g.moveTo(x - s, y - tip);
          g.quadraticCurveTo(x - s * 0.45, y + s * 0.18, x, y);
          g.quadraticCurveTo(x + s * 0.45, y + s * 0.18, x + s, y - tip);
          g.stroke();
          g.restore();
          g.globalAlpha = 1;
        });
      }
      withDepth(1, () => snow(t, 40, { speed: 0.5, wind: -0.8, alpha: 0.3, seed: 44 }));
    }

    // V — a dead white hound, and one thing still breathing.
    function drawWhelp(p, t) {
      // First light, and the only warm sky in the story so far.
      skyGrad("#16203e", "#463a5a", "#8a5f66");
      const hg = g.createLinearGradient(0, h * 0.12, 0, h * 0.42);
      hg.addColorStop(0, "rgba(232,150,120,0)");
      hg.addColorStop(1, "rgba(242,172,136,0.46)");
      g.fillStyle = hg;
      g.fillRect(0, h * 0.12, w, h * 0.3);
      withDepth(0.05, () => stars(0.22 * (1 - p * 0.6)));

      // The wall above, in shadow, its crest catching the sun first.
      const wallBase = h * 0.2;
      withDepth(0.16, () => {
        const wg = g.createLinearGradient(0, 0, 0, wallBase);
        wg.addColorStop(0, "#33486d");
        wg.addColorStop(1, "#1e2c46");
        g.fillStyle = wg;
        g.fillRect(-w * 0.3, -h * 0.2, w * 1.6, wallBase + h * 0.2);
        const blend = g.createLinearGradient(0, wallBase - h * 0.05, 0, wallBase + h * 0.02);
        blend.addColorStop(0, "rgba(30,44,70,0)");
        blend.addColorStop(0.7, "rgba(255,190,158,0.16)");
        blend.addColorStop(1, "rgba(70,58,90,0)");
        g.fillStyle = blend;
        g.fillRect(-w * 0.3, wallBase - h * 0.05, w * 1.6, h * 0.07);
      });

      // Drifts, stacked toward the viewer — each one a plane further forward,
      // so looking about opens real space between them.
      withDepth(0.24, () => ridge(h * 0.36, h * 0.022, 4.1, 1.2, "#9db0c9"));
      withDepth(0.36, () => ridge(h * 0.46, h * 0.026, 2.8, 3.4, "#c3d2e2"));
      withDepth(0.78, () => ridge(h * 0.68, h * 0.03, 5.6, 0.6, "#e4edf5"));

      // The mother. Most of her is under the drift — what shows is the long
      // head laid flat, one ear, and the foreleg curled around a hollow. Half
      // buried reads as a hound where a whole body only ever read as a lump.
      const cx = w * 0.44;
      const cy = h * 0.56;
      const ms = Math.min(w, h) * 0.15;
      const wx = cx - ms * 0.1;
      const wy = cy + ms * 0.34;
      const found = ramp(p, 0.2, 0.48);

      withDepth(0.55, () => paintMother(cx, cy, ms));
      withDepth(0.6, () => {
        g.save();
        g.globalCompositeOperation = "lighter";
        glow(wx, wy - ms * 0.16, ms * 0.7, "255,196,150", 0.3 * found);
        g.restore();
        hound(wx, wy, ms * 0.19, { t: t, color: "#616b7a", face: -1 });
      });

      // Wren, kneeling in from the right — small, so the hound stays the shot.
      const kneel = ramp(p, 0.36, 0.68);
      if (kneel > 0.01) withDepth(0.74, () => {
        const fx = lerp(w * 1.06, w * 0.83, kneel);
        g.globalAlpha = kneel;
        kneeler(fx, cy + ms * 0.44, h * 0.115, {
          face: 1, color: "#2c3550", rim: "#ffcaa2", rimAlpha: 0.45
        });
        g.globalAlpha = 1;
      });

      withDepth(1, () => snow(t, 46, { speed: 0.32, wind: 0.12, alpha: 0.6, size: 1.15, seed: 71 }));
    }

    function paintMother(cx, cy, ms) {
      g.save();
      g.translate(cx, cy);
      g.rotate(-0.05);
      g.scale(ms, ms);

      // the buried bulk of her, barely proud of the drift
      g.fillStyle = "#e8f1f9";
      g.beginPath();
      g.moveTo(-1.5, 0.3);
      g.bezierCurveTo(-1.58, -0.1, -1.14, -0.34, -0.5, -0.34);
      g.bezierCurveTo(0.0, -0.34, 0.34, -0.24, 0.54, -0.1);
      g.bezierCurveTo(0.3, 0.14, -0.7, 0.32, -1.5, 0.3);
      g.closePath();
      g.fill();
      // a shadow where the neck leaves the drift, so head and body separate
      g.fillStyle = "rgba(126,156,192,0.5)";
      g.beginPath();
      g.ellipse(0.62, -0.06, 0.2, 0.16, 0.2, 0, TAU);
      g.fill();

      // the long head, laid flat out along the snow
      g.fillStyle = "#fbfdff";
      g.beginPath();
      g.moveTo(0.5, -0.12);
      g.bezierCurveTo(0.86, -0.34, 1.16, -0.4, 1.4, -0.34);    // neck
      g.bezierCurveTo(1.64, -0.28, 1.76, -0.12, 1.7, 0.02);    // skull
      g.bezierCurveTo(2.06, 0.04, 2.3, 0.12, 2.26, 0.22);      // muzzle, long and tapered
      g.bezierCurveTo(2.0, 0.3, 1.52, 0.28, 1.22, 0.24);       // jaw
      g.bezierCurveTo(0.9, 0.2, 0.62, 0.08, 0.5, -0.02);
      g.closePath();
      g.fill();

      // one ear, folded over
      g.beginPath();
      g.moveTo(1.38, -0.3);
      g.bezierCurveTo(1.3, -0.62, 1.58, -0.7, 1.7, -0.46);
      g.bezierCurveTo(1.72, -0.34, 1.54, -0.26, 1.38, -0.3);
      g.closePath();
      g.fill();

      // the foreleg, stretched around what she was keeping warm
      g.beginPath();
      g.moveTo(0.72, -0.04);
      g.bezierCurveTo(0.86, 0.34, 0.4, 0.56, -0.32, 0.52);
      g.bezierCurveTo(-0.5, 0.5, -0.52, 0.36, -0.34, 0.34);
      g.bezierCurveTo(0.22, 0.36, 0.56, 0.24, 0.48, -0.02);
      g.closePath();
      g.fill();

      // cool shadow so she sits in the snow instead of floating on it
      g.fillStyle = "rgba(112,144,184,0.34)";
      g.beginPath();
      g.moveTo(-1.46, 0.3);
      g.bezierCurveTo(-0.6, 0.46, 0.6, 0.42, 1.3, 0.22);
      g.bezierCurveTo(0.7, 0.52, -0.7, 0.54, -1.46, 0.3);
      g.closePath();
      g.fill();
      g.restore();
    }

    // VI — nine people and one decision.
    function drawCouncil(p, t) {
      g.fillStyle = "#070a11";
      g.fillRect(0, 0, w, h);

      // stone hall: three arches receding into dark
      const flick = 0.8 + 0.2 * Math.sin(t * 6.7) * Math.sin(t * 2.9) + 0.06 * Math.sin(t * 11.3);
      // Nested arch openings, widest first and each one darker, so the hall
      // recedes instead of stacking into one pale dome. Each arch also gets its
      // own plane: the near opening swings most and the far one barely moves,
      // which is what makes looking about feel like standing in a corridor.
      for (let i = 0; i <= 2; i++) {
        const k = i / 2;
        withDepth(0.3 - k * 0.2, () => {
          const aw = lerp(w * 0.95, w * 0.32, k);
          const ah = lerp(h * 0.5, h * 0.24, k);
          const ay = h * 0.6 - k * h * 0.05;
          g.fillStyle = "rgb(" + Math.round(lerp(34, 7, k)) + "," + Math.round(lerp(41, 11, k)) + "," + Math.round(lerp(55, 19, k)) + ")";
          g.beginPath();
          g.moveTo(w / 2 - aw / 2, ay);
          g.lineTo(w / 2 - aw / 2, ay - ah * 0.55);
          g.quadraticCurveTo(w / 2, ay - ah * 1.15, w / 2 + aw / 2, ay - ah * 0.55);
          g.lineTo(w / 2 + aw / 2, ay);
          g.closePath();
          g.fill();
        });
      }

      // hearth on the left throwing the only light in the room
      const fx = w * 0.13;
      const fy = h * 0.545;
      g.save();
      g.globalCompositeOperation = "lighter";
      glow(fx, fy - h * 0.04, Math.max(w, h) * 0.58, "255,146,58", 0.17 * flick);
      g.restore();

      const ty = h * 0.615;
      withDepth(0.55, () => {
        g.fillStyle = "#05080e";
        g.fillRect(fx - w * 0.09, fy, w * 0.18, h * 0.05);
        flame(fx, fy, h * 0.065, t, {});
        embers(fx, fy - h * 0.02, t, 20, w * 0.09, h * 0.36, { seed: 15, alpha: 0.65 });

        // the table, and what is left of the watch
        g.fillStyle = "#04070c";
        g.beginPath();
        g.moveTo(w * 0.04, ty + h * 0.055);
        g.lineTo(w * 0.16, ty);
        g.lineTo(w * 0.86, ty);
        g.lineTo(w * 0.98, ty + h * 0.055);
        g.closePath();
        g.fill();
        g.fillStyle = "rgba(255,168,84,0.1)";
        g.fillRect(w * 0.16, ty, w * 0.7, 1.5);
      });

      const seats = [0.26, 0.37, 0.48, 0.59, 0.7, 0.8];
      for (let i = 0; i < seats.length; i++) {
        const x = w * seats[i];
        const shift = Math.sin(t * 0.5 + i * 2.1) * 1.2;
        const ht = h * (0.13 + (i % 2) * 0.011);
        // Seats further along the table sit a little deeper into the room.
        withDepth(0.78 - (i / seats.length) * 0.16, () => {
          figure(x + shift, ty + h * 0.006, ht, {
            color: "#03060b",
            rim: "#ff9a44",
            rimAlpha: 0.2 * flick * (1 - i / (seats.length + 2))
          });
        });
      }
      // Calder at the head, nearest the fire, largest
      withDepth(0.92, () => {
        figure(w * 0.14, ty + h * 0.026, h * 0.17, { color: "#02050a", rim: "#ffab55", rimAlpha: 0.42 * flick });
      });

      // warm wash over everything
      g.save();
      g.globalCompositeOperation = "lighter";
      const og = g.createLinearGradient(0, h * 0.4, w * 0.7, h);
      og.addColorStop(0, "rgba(255,140,54,0.09)");
      og.addColorStop(1, "rgba(255,120,40,0)");
      g.fillStyle = og;
      g.fillRect(0, 0, w, h);
      g.restore();
    }

    // VII — the storm with no wind, and what walks out of it.
    function drawQuiet(p, t) {
      const white = ramp(p, 0.12, 0.55);
      skyGrad(
        lerpRgb([10, 18, 32], [127, 151, 171], white),
        lerpRgb([16, 28, 46], [163, 184, 200], white),
        lerpRgb([12, 22, 38], [185, 203, 216], white)
      );

      // Fog banks rolling through, each on its own plane — this is the chapter
      // where depth does the most work, because the whole threat is a question
      // of how far away something is.
      for (let i = 0; i < 5; i++) {
        withDepth(0.1 + i * 0.14, () => {
          const ph = i * 1.37;
          const y = h * (0.2 + i * 0.16) + Math.sin(t * 0.4 + ph) * h * 0.03;
          const x = mod(t * (26 + i * 12) + i * w * 0.4, w * 1.8) - w * 0.4;
          const rw = w * (0.5 + i * 0.12);
          const fg = g.createLinearGradient(x - rw / 2, 0, x + rw / 2, 0);
          fg.addColorStop(0, "rgba(226,238,246,0)");
          fg.addColorStop(0.5, "rgba(226,238,246," + (0.1 + 0.14 * white) + ")");
          fg.addColorStop(1, "rgba(226,238,246,0)");
          g.fillStyle = fg;
          g.fillRect(x - rw / 2, y - h * 0.14, rw, h * 0.28);
        });
      }

      // ground
      withDepth(0.3, () => {
        g.fillStyle = lerpRgb([22, 38, 60], [215, 228, 236], white * 0.9);
        g.fillRect(-w * 0.3, h * 0.56, w * 1.6, h * 0.7);
        ridge(h * 0.6, h * 0.014, 6.3, 2.2, lerpRgb([29, 48, 73], [234, 242, 248], white * 0.9));
      });

      // They come out of the white — barely there, which is the point.
      const come = ramp(p, 0.3, 0.86);
      const fr = rng(303);
      for (let i = 0; i < 7; i++) {
        const lane = fr();
        const depth = 0.3 + fr() * 0.7;
        const ph = fr() * TAU;
        const x = w * (0.08 + lane * 0.84) + Math.sin(t * 0.3 + ph) * w * 0.01;
        const ht = h * (0.13 + depth * 0.2);
        const y = h * (0.55 + depth * 0.1);
        const app = clamp((come - i * 0.09) * 2.2, 0, 1);
        if (app <= 0.01) continue;
        // Each one stands at its own distance, so looking about walks them past
        // each other instead of sliding a flat sheet of ghosts.
        withDepth(0.28 + depth * 0.62, () => {
          // Darker than the whiteout, not paler — a pale figure on a pale field
          // is simply invisible. They fade off at head and hem into the fog.
          g.save();
          g.globalAlpha = app * (0.22 + depth * 0.5);
          const fgr = g.createLinearGradient(x, y - ht, x, y);
          fgr.addColorStop(0, "rgba(72,98,124,0)");
          fgr.addColorStop(0.3, "rgba(44,66,92,0.86)");
          fgr.addColorStop(0.8, "rgba(38,58,82,0.7)");
          fgr.addColorStop(1, "rgba(60,86,112,0.12)");
          g.fillStyle = fgr;
          g.beginPath();
          g.moveTo(x - ht * 0.11, y);
          g.quadraticCurveTo(x - ht * 0.13, y - ht * 0.6, x - ht * 0.06, y - ht * 0.88);
          g.quadraticCurveTo(x, y - ht * 1.02, x + ht * 0.06, y - ht * 0.88);
          g.quadraticCurveTo(x + ht * 0.13, y - ht * 0.6, x + ht * 0.11, y);
          g.closePath();
          g.fill();
          g.restore();
          // eyes: the only saturated thing in a white frame, kept small so they
          // read as eyes rather than as headlights
          g.save();
          g.globalCompositeOperation = "lighter";
          const ea = app * (0.4 + depth * 0.5);
          glow(x - ht * 0.032, y - ht * 0.87, ht * 0.045, "150,240,255", ea * 0.8);
          glow(x + ht * 0.032, y - ht * 0.87, ht * 0.045, "150,240,255", ea * 0.8);
          g.fillStyle = "rgba(226,250,255," + clamp(ea, 0, 1) + ")";
          g.beginPath();
          g.arc(x - ht * 0.032, y - ht * 0.87, Math.max(0.7, ht * 0.011), 0, TAU);
          g.arc(x + ht * 0.032, y - ht * 0.87, Math.max(0.7, ht * 0.011), 0, TAU);
          g.fill();
          g.restore();
        });
      }

      // ice cracking under all of it
      const cr = ramp(p, 0.62, 1.0);
      if (cr > 0.01) withDepth(0.55, () => {
        g.save();
        g.strokeStyle = "rgba(20,40,64," + 0.5 * cr + ")";
        g.lineWidth = 1.4;
        const kr = rng(808);
        for (let b = 0; b < 5; b++) {
          let x = w * (0.1 + kr() * 0.8);
          let y = h * (0.6 + kr() * 0.1);
          let ang = -0.6 + kr() * 1.2;
          g.beginPath();
          g.moveTo(x, y);
          const segs = Math.floor(cr * 11) + 2;
          for (let i = 0; i < segs; i++) {
            ang += (kr() - 0.5) * 1.5;
            x += Math.cos(ang) * w * 0.045;
            y += Math.sin(ang) * h * 0.012;
            g.lineTo(x, y);
          }
          g.stroke();
        }
        g.restore();
      });

      withDepth(0.85, () => snow(t, 150, { speed: 2.6, wind: 3.4, alpha: 0.7, seed: 55 }));
      withDepth(1, () => snow(t * 1.4, 70, { speed: 3.4, wind: 4.6, alpha: 0.5, size: 1.5, seed: 56 }));
    }

    // VIII — two hundred and six steps.
    function drawClimb(p, t) {
      g.fillStyle = "#080b12";
      g.fillRect(0, 0, w, h);

      const speed = h * 0.19;
      const off = (t * speed) % (h * 0.09);

      // wall courses scrolling down past her
      withDepth(0.18, () => {
        for (let i = -1; i < 14; i++) {
          const y = i * h * 0.09 + off;
          const shade = 16 + ((i % 3) + 3) % 3 * 5;
          g.fillStyle = "rgb(" + shade + "," + (shade + 5) + "," + (shade + 12) + ")";
          g.fillRect(-w * 0.3, y, w * 1.6, h * 0.09 + 1);
          g.fillStyle = "rgba(0,0,0,0.28)";
          g.fillRect(-w * 0.3, y, w * 1.6, 2);
        }
      });

      // Window slits, with night and snow beyond. These sit deeper than the
      // wall face, so looking about lets you see along the embrasure.
      for (let i = -1; i < 5; i++) {
        withDepth(0.1, () => {
          const y = i * h * 0.31 + ((t * speed) % (h * 0.31));
          const x = i % 2 === 0 ? w * 0.15 : w * 0.83;
          const sw = w * 0.055;
          const sh = h * 0.16;
          g.save();
          g.beginPath();
          g.moveTo(x - sw / 2, y + sh);
          g.lineTo(x - sw / 2, y + sh * 0.35);
          g.quadraticCurveTo(x, y - sh * 0.1, x + sw / 2, y + sh * 0.35);
          g.lineTo(x + sw / 2, y + sh);
          g.closePath();
          g.clip();
          g.fillStyle = "#16304f";
          g.fillRect(x - sw, y - sh, sw * 2, sh * 2.4);
          snow(t * 2.2, 26, { speed: 2.2, wind: 4, alpha: 0.85, seed: 90 + i });
          g.restore();
          g.save();
          g.globalCompositeOperation = "lighter";
          glow(x, y + sh * 0.45, sw * 2.6, "110,170,225", 0.16);
          g.restore();
        });
      }

      // Treads. Narrow, strongly raked and with a dark riser under each one —
      // full-width bands just read as a floor, not a stair.
      for (let i = -1; i < 12; i++) {
        const y = i * h * 0.105 + ((t * speed) % (h * 0.105));
        const rake = h * 0.05;
        g.fillStyle = "#0b1018";
        g.beginPath();
        g.moveTo(w * 0.2, y);
        g.lineTo(w * 0.82, y - rake);
        g.lineTo(w * 0.82, y - rake + h * 0.034);
        g.lineTo(w * 0.2, y + h * 0.034);
        g.closePath();
        g.fill();
        // lit nose of the tread
        g.strokeStyle = "rgba(198,224,244,0.16)";
        g.lineWidth = 1.4;
        g.beginPath();
        g.moveTo(w * 0.2, y);
        g.lineTo(w * 0.82, y - rake);
        g.stroke();
        // riser in shadow
        g.fillStyle = "rgba(0,0,0,0.34)";
        g.beginPath();
        g.moveTo(w * 0.2, y + h * 0.034);
        g.lineTo(w * 0.82, y - rake + h * 0.034);
        g.lineTo(w * 0.82, y - rake + h * 0.05);
        g.lineTo(w * 0.2, y + h * 0.05);
        g.closePath();
        g.fill();
      }

      // Wren and her lantern, climbing on the spot
      const step = Math.abs(Math.sin(t * 4.6));
      const cx = w * 0.5;
      const cy = h * 0.47 - step * h * 0.012;
      const lx = cx + w * 0.15;
      g.save();
      g.globalCompositeOperation = "lighter";
      glow(lx, cy - h * 0.06, Math.max(w, h) * 0.32, "255,168,80", 0.22);
      g.restore();
      withDepth(0.62, () => {
        figure(cx, cy, h * 0.17, { color: "#03060c", rim: "#ffb668", rimAlpha: 0.5 });
        // the lantern itself, held out clear of her body
        g.save();
        g.globalCompositeOperation = "lighter";
        glow(lx, cy - h * 0.062, h * 0.026, "255,232,180", 0.9);
        g.restore();
        g.strokeStyle = "rgba(255,196,120,0.5)";
        g.lineWidth = 1.2;
        g.beginPath();
        g.moveTo(cx + h * 0.03, cy - h * 0.1);
        g.lineTo(lx, cy - h * 0.072);
        g.stroke();
      });

      // Ember, coming up behind — a few steps nearer than Wren.
      const dogStep = Math.abs(Math.sin(t * 4.6 + 1.1));
      withDepth(0.86, () => {
        hound(cx - w * 0.2, h * 0.6 - dogStep * h * 0.01, Math.min(w, h) * 0.05, { t: t * 2, color: "#0b1119" });
      });

      // wind through the stair
      withDepth(1, () => snow(t, 60, { speed: 2.2, wind: 5.5, alpha: 0.35, seed: 77 }));
      vignette(0.6);
    }

    // IX — the ninth fire.
    function drawFire(p, t) {
      const grow = ramp(p, 0.02, 0.42);
      const wash = ramp(p, 0.08, 0.62);

      skyGrad(lerpRgb([4, 7, 15], [24, 13, 12], wash * 0.7), lerpRgb([10, 20, 38], [42, 20, 16], wash * 0.7), "#120b12");
      withDepth(0.06, () => stars(0.6 * (1 - wash * 0.5)));

      // the wall below, catching the new light
      const top = h * 0.56;
      withDepth(0.28, () => {
        drawWallFace(top, h - top);
        g.save();
        g.globalCompositeOperation = "lighter";
        const ig = g.createLinearGradient(0, top, 0, h);
        ig.addColorStop(0, "rgba(255,146,52," + 0.4 * wash + ")");
        ig.addColorStop(1, "rgba(255,90,30," + 0.06 * wash + ")");
        g.fillStyle = ig;
        g.fillRect(-w * 0.3, top, w * 1.6, h - top);
        g.restore();
        g.strokeStyle = "rgba(255,196,140," + (0.4 + 0.5 * wash) + ")";
        g.lineWidth = 1.8;
        g.beginPath();
        g.moveTo(-w * 0.3, top);
        g.lineTo(w * 1.3, top);
        g.stroke();
      });

      // brazier and the fire itself
      const bx = w * 0.5;
      const by = top + h * 0.005;
      const size = h * (0.04 + grow * 0.3);
      g.save();
      g.globalCompositeOperation = "lighter";
      glow(bx, by - size * 0.5, Math.max(w, h) * (0.2 + grow * 0.85), "255,140,50", 0.3 * grow);
      g.restore();

      withDepth(0.6, () => {
        g.fillStyle = "#0a0d14";
        g.fillRect(bx - w * 0.085, by, w * 0.17, h * 0.045);
        g.beginPath();
        g.moveTo(bx - w * 0.085, by);
        g.lineTo(bx - w * 0.055, by - h * 0.03);
        g.lineTo(bx + w * 0.055, by - h * 0.03);
        g.lineTo(bx + w * 0.085, by);
        g.closePath();
        g.fill();

        g.save();
        g.globalCompositeOperation = "lighter";
        glow(bx, by - size * 0.4, size * 2.2, "255,190,110", 0.32 * grow);
        g.restore();
        flame(bx, by - h * 0.02, size, t, { tongues: 7 });
        embers(bx, by - size * 0.4, t, 60, w * 0.2, h * 0.8, { seed: 4, alpha: grow });
      });

      // Wren at the foot of it, nearest of all
      withDepth(0.88, () => {
        figure(bx - w * 0.15, by + h * 0.02, h * 0.11, { color: "#0b0703", rim: "#ffcf90", rimAlpha: 0.75 * grow });
        hound(bx - w * 0.22, by + h * 0.02, Math.min(w, h) * 0.032, { t: t, color: "#120a06" });
      });
    }

    // X — nothing answers.
    function drawSilence(p, t) {
      skyGrad("#03050b", "#060c18", "#080f1c");
      withDepth(0.05, () => { stars(1); twinkle(t, 0.9); });

      drawWallRun(t, -1, 0);

      // Wren and Ember, very small, at the near end of the wall.
      withDepth(0.9, () => {
        figure(w * 0.13, h * 0.66, h * 0.09, { color: "#03060c", rim: "#ff9a44", rimAlpha: 0.3 });
        hound(w * 0.185, h * 0.665, Math.min(w, h) * 0.026, { t: t * 0.6, color: "#050a11" });
      });

      withDepth(1, () => snow(t, 45, { speed: 0.4, wind: 0.2, alpha: 0.35, seed: 121 }));
    }

    // XI — one by one, all the way to the sea.
    function drawAnswer(p, t) {
      const dawn = ramp(p, 0.55, 1);
      skyGrad(
        lerpRgb([3, 5, 11], [13, 26, 51], dawn),
        lerpRgb([6, 12, 24], [38, 48, 79], dawn),
        lerpRgb([8, 15, 28], [60, 53, 80], dawn)
      );
      withDepth(0.05, () => stars(1 - dawn * 0.7));

      // Ignition marches outward from the second tower to the horizon.
      const lit = ramp(p, 0.06, 0.72);
      drawWallRun(t, lit, dawn);

      // and behind, in the green country, hearth after hearth
      const valley = ramp(p, 0.5, 1);
      if (valley > 0.01) withDepth(0.72, () => {
        const vr = rng(2024);
        g.save();
        g.globalCompositeOperation = "lighter";
        for (let i = 0; i < 60; i++) {
          const vx = -w * 0.2 + vr() * w * 1.4;
          const vy = h * (0.9 + vr() * 0.1);
          const when = vr();
          const a = clamp((valley - when) * 3, 0, 1);
          if (a <= 0.01) continue;
          const tw = 0.7 + 0.3 * Math.sin(t * 3 + i);
          glow(vx, vy, h * 0.018 * (0.6 + a), "255,180,90", a * 0.5 * tw);
        }
        g.restore();
      });

      withDepth(0.9, () => {
        figure(w * 0.13, h * 0.66, h * 0.09, { color: "#04070d", rim: "#ffb066", rimAlpha: 0.55 });
        hound(w * 0.185, h * 0.665, Math.min(w, h) * 0.026, { t: t * 0.6, color: "#060b12" });
      });
      withDepth(1, () => snow(t, 40, { speed: 0.35, wind: 0.2, alpha: 0.3, seed: 121 }));
    }

    // Shared money shot: the Rime running away to the horizon, towers on it.
    // `lit` is how far the chain has answered: -1 nothing, 0..1 outward.
    const TOWERS = [0.12, 0.3, 0.45, 0.575, 0.675, 0.755, 0.82, 0.874, 0.917, 0.95];

    // The run is one perspective drawing, so it gets one plane. Giving each
    // tower its own depth sheared the towers off the crest they stand on and
    // slid every firelight reflection sideways off its own tower — perspective
    // and per-object parallax are two different projections, and mixing them
    // pulls the geometry apart.
    function drawWallRun(t, lit, dawn) {
      withDepth(0.34, () => paintWallRun(t, lit, dawn));
    }

    function paintWallRun(t, lit, dawn) {
      const nearTop = h * 0.5;
      const farTop = h * 0.435;
      const nearBot = h * 0.96;
      const farBot = h * 0.452;

      const topAt = (u) => lerp(nearTop, farTop, easeIn(u));
      const botAt = (u) => lerp(nearBot, farBot, easeIn(u));

      // the wall face, receding
      g.beginPath();
      g.moveTo(0, topAt(0));
      for (let i = 0; i <= 40; i++) g.lineTo((w * i) / 40, topAt(i / 40));
      for (let i = 40; i >= 0; i--) g.lineTo((w * i) / 40, botAt(i / 40));
      g.closePath();
      const fg = g.createLinearGradient(0, farTop, 0, nearBot);
      fg.addColorStop(0, lerpRgb([14, 28, 48], [34, 52, 79], dawn || 0));
      fg.addColorStop(1, lerpRgb([5, 10, 20], [16, 26, 44], dawn || 0));
      g.fillStyle = fg;
      g.fill();

      // crest highlight
      g.strokeStyle = "rgba(150,196,228," + (0.3 + 0.25 * (dawn || 0)) + ")";
      g.lineWidth = 1.2;
      g.beginPath();
      for (let i = 0; i <= 40; i++) {
        const x = (w * i) / 40;
        const y = topAt(i / 40);
        if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
      }
      g.stroke();

      // the land south of it
      g.fillStyle = lerpRgb([4, 7, 14], [11, 18, 32], dawn || 0);
      g.beginPath();
      g.moveTo(0, nearBot);
      for (let i = 0; i <= 40; i++) g.lineTo((w * i) / 40, botAt(i / 40));
      g.lineTo(w, h);
      g.lineTo(0, h);
      g.closePath();
      g.fill();

      // towers, near to far, all on the run's own plane
      for (let i = 0; i < TOWERS.length; i++) {
        const u = TOWERS[i];
        const y = topAt(u) + 1;
        const scale = lerp(1, 0.1, easeIn(u));
        const th = h * 0.115 * scale;
        const tw = h * 0.042 * scale;
        tower(w * u, y, th, Math.max(1.2, tw), { color: "#03060c" });

        // is this one burning?
        let a = 0;
        if (i === 0) a = 1;                                   // Ashen Reach, always
        else if (lit >= 0) a = clamp((lit - (i - 1) / (TOWERS.length - 1)) * 4.5, 0, 1);
        if (a <= 0.01) continue;

        const fx = w * u;
        const fy = y - th - tw * 0.1;
        const fs = Math.max(2.5, h * 0.03 * scale);
        g.save();
        g.globalCompositeOperation = "lighter";
        glow(fx, fy, fs * (6 + 8 * a), "255,140,50", 0.2 * a);
        glow(fx, fy, fs * 2.2, "255,206,140", 0.44 * a);
        g.restore();
        // Only the near towers get real flames; the far ones are pure bloom,
        // which is both cheaper and more convincing at that size.
        if (scale > 0.6) {
          flame(fx, fy + fs * 0.6, fs * 1.5, t + i, { alpha: a, tongues: 4 });
          embers(fx, fy, t + i, Math.round(10 * scale * quality), fs * 3, h * 0.2 * scale, { seed: 30 + i, alpha: a });
        }
        // A short bleed of firelight down the ice face. Drawn as a squashed
        // radial rather than a rect — a vertical gradient in a fillRect still
        // has hard left and right edges, which read as pasted-on bands.
        g.save();
        g.globalCompositeOperation = "lighter";
        const fall = (botAt(u) - y) * 0.34;
        const rw2 = Math.max(2, tw * 1.6);
        g.translate(fx, y);
        g.scale(1, Math.max(0.2, fall / rw2));
        glow(0, 0, rw2, "255,150,60", 0.16 * a);
        g.restore();
      }
    }

    // XII — the green country wakes up.
    function drawCoda(p, t) {
      const lift = ramp(p, 0, 1);
      skyGrad(
        lerpRgb([12, 26, 51], [27, 42, 74], lift),
        lerpRgb([38, 48, 79], [74, 68, 103], lift),
        lerpRgb([60, 53, 80], [122, 85, 96], lift)
      );
      const hg = g.createLinearGradient(0, h * 0.3, 0, h * 0.55);
      hg.addColorStop(0, "rgba(240,168,132,0)");
      hg.addColorStop(1, "rgba(246,182,140," + (0.16 + 0.28 * lift) + ")");
      g.fillStyle = hg;
      g.fillRect(0, h * 0.3, w, h * 0.3);
      withDepth(0.05, () => stars(0.35 * (1 - lift)));

      drawWallRun(t, 1, 0.55 + lift * 0.45);

      // Wren and Ember in the foreground, backlit, watching it all light up.
      // They are the nearest thing in the story's last shot, so they carry the
      // strongest swing — the whole lit Rime slides behind them as you look.
      const fx = w * 0.24;
      const fy = h * 0.74;
      g.save();
      g.globalCompositeOperation = "lighter";
      glow(fx + h * 0.05, fy - h * 0.16, h * 0.26, "255,168,90", 0.16);
      g.restore();
      withDepth(1, () => {
        figure(fx, fy, h * 0.28, { color: "#04060c", rim: "#ffc48a", rimAlpha: 0.6 });
        hound(fx + h * 0.1, fy, Math.min(w, h) * 0.058, { t: t * 0.7, color: "#05080e" });
        snow(t, 55, { speed: 0.3, wind: 0.15, alpha: 0.45, size: 1.2, seed: 200 });
      });
    }

    // ---- colour helpers ---------------------------------------------------
    // Colours interpolate as numeric [r,g,b] triples, never as hex strings.
    // Slicing a string, re-parsing it and reassembling the result by
    // concatenation is the shape of dynamically built URL obfuscation, and the
    // host validator rejects the whole bit for it — so no hex is parsed here.
    function lerpRgb(a, b, t) {
      return "rgb(" + Math.round(lerp(a[0], b[0], t)) + "," +
        Math.round(lerp(a[1], b[1], t)) + "," + Math.round(lerp(a[2], b[2], t)) + ")";
    }
    function mixCol(a, b, t) {
      return [Math.round(lerp(a[0], b[0], t)), Math.round(lerp(a[1], b[1], t)), Math.round(lerp(a[2], b[2], t))];
    }

    // ---- title & end cards ------------------------------------------------
    function drawTitleArt(t) {
      skyGrad("#03050c", "#071021", "#0a1524");
      stars(0.9);
      twinkle(t, 0.8);
      aurora(t, { y: 0.26, bands: 3, alpha: 0.28, colors: [[64, 220, 172], [56, 150, 210], [96, 200, 190]] });
      ridge(h * 0.72, h * 0.03, 4.2, 1.1, "#0a1425");
      ridge(h * 0.82, h * 0.022, 6.6, 3.9, "#101d31");
      // a single far tower with a cold, unlit brazier
      const tx = w * 0.78;
      const ty = h * 0.735;
      tower(tx, ty, h * 0.1, h * 0.035, { color: "#05080f", window: true, t: t });
      snow(t, 80, { speed: 0.6, wind: 0.5, alpha: 0.5, seed: 3 });
      vignette(1);
    }

    function drawEndArt(t) {
      const p = clamp((clock - endAt) / 6, 0, 1);
      skyGrad("#0c1a33", "#2a3350", "#5a4358");
      stars(0.3);
      drawWallRun(t, 1, 0.8);
      figure(w * 0.15, h * 0.99, h * 0.24, { color: "#04060c", rim: "#ffc48a", rimAlpha: 0.5 });
      hound(w * 0.15 + h * 0.085, h * 0.99, Math.min(w, h) * 0.05, { t: t * 0.7, color: "#05080e" });
      snow(t, 50, { speed: 0.3, wind: 0.15, alpha: 0.4, seed: 200 });
      g.globalAlpha = 0.55 * p;
      g.fillStyle = "#05080f";
      g.fillRect(0, 0, w, h);
      g.globalAlpha = 1;
      vignette(1);
    }

    // ---- ui ---------------------------------------------------------------
    // Markup goes in through innerHTML on the runtime-owned root and comes back
    // out through querySelector. That is the sanctioned pattern — the host
    // rejects direct global-DOM access outright.
    //
    // Font stacks are quoted with ' here: UIFONT and BODY carry double quotes,
    // which would close a double-quoted style attribute early.
    const UIFONT_H = UIFONT.replace(/"/g, "'");
    const BODY_H = BODY.replace(/"/g, "'");

    const BTN =
      "pointer-events:auto;display:block;width:100%;box-sizing:border-box;" +
      "margin:0 0 10px 0;padding:13px 16px;border:1px solid rgba(180,215,238,0.28);" +
      "border-radius:13px;color:#e9f0f6;letter-spacing:0.2px;text-align:left;" +
      "background:linear-gradient(180deg,rgba(22,38,58,0.86),rgba(10,18,30,0.9));" +
      "font:600 15px " + UIFONT_H + ";cursor:pointer;" +
      "-webkit-tap-highlight-color:transparent;" +
      "transition:transform .12s ease,border-color .18s ease,opacity .18s ease;" +
      "backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);";

    const BTN_WARM = BTN +
      "text-align:center;font:600 16px " + UIFONT_H + ";" +
      "border:1px solid rgba(255,186,110,0.5);" +
      "background:linear-gradient(180deg,rgba(58,36,20,0.9),rgba(24,15,10,0.92));";

    const PANEL =
      "position:absolute;left:0;right:0;bottom:0;flex-direction:column;" +
      "align-items:center;pointer-events:none;box-sizing:border-box;";

    const ROUND =
      "pointer-events:auto;width:38px;height:38px;padding:0;border-radius:50%;" +
      "border:1px solid rgba(180,215,238,0.22);background:rgba(8,14,24,0.55);" +
      "color:#dbe7f0;font:15px " + UIFONT_H + ";cursor:pointer;display:block;" +
      "-webkit-tap-highlight-color:transparent;backdrop-filter:blur(6px);" +
      "-webkit-backdrop-filter:blur(6px);transition:transform .12s ease;";

    function press(node, fn) {
      ctx.listen(node, "pointerdown", (e) => {
        e.preventDefault();
        e.stopPropagation();
        node.style.transform = "scale(0.975)";
      });
      const up = (e) => {
        e.preventDefault();
        e.stopPropagation();
        node.style.transform = "scale(1)";
        fn();
      };
      ctx.listen(node, "pointerup", up);
      ctx.listen(node, "pointercancel", () => { node.style.transform = "scale(1)"; });
    }

    let choiceMarkup = "";
    for (let i = 0; i < CHOICES.length; i++) {
      const c = CHOICES[i];
      choiceMarkup +=
        '<button data-choice="' + c.key + '" style="' + BTN + '">' +
          '<div style="font:600 15px ' + UIFONT_H + '">' + c.label + '</div>' +
          '<div style="font:400 12.5px ' + UIFONT_H + ';opacity:0.62;margin-top:3px">' + c.sub + '</div>' +
        '</button>';
    }

    ui.innerHTML =
      '<div data-ui="title" style="' + PANEL + 'top:0;display:flex;justify-content:flex-end">' +
        '<div style="width:100%;max-width:340px;pointer-events:none">' +
          '<button data-ui="begin" style="' + BTN_WARM + '">Begin the story</button>' +
          '<button data-ui="resume" style="' + BTN + 'text-align:center;opacity:0.9;display:none">Resume</button>' +
        '</div>' +
      '</div>' +
      '<div data-ui="choice" style="' + PANEL + 'display:none">' +
        '<div style="width:100%;max-width:360px;pointer-events:none">' +
          '<div style="font:400 19px ' + BODY_H + ';color:#f0e2c8;text-align:center;' +
            'margin:0 0 14px 0;letter-spacing:0.3px">What would you have done?</div>' +
          choiceMarkup +
        '</div>' +
      '</div>' +
      '<div data-ui="end" style="' + PANEL + 'display:none">' +
        '<div style="width:100%;max-width:340px;pointer-events:none">' +
          '<button data-ui="again" style="' + BTN_WARM + '">Watch again</button>' +
        '</div>' +
      '</div>' +
      '<div data-ui="tools" style="position:absolute;right:12px;display:none;pointer-events:none">' +
        '<button data-ui="sound" style="' + ROUND + 'margin-bottom:8px">&#9834;</button>' +
        '<button data-ui="tilt" style="' + ROUND + 'margin-bottom:8px;opacity:0.55">&#9673;</button>' +
        '<button data-ui="pause" style="' + ROUND + '">&#10074;&#10074;</button>' +
      '</div>';

    const pick = (sel) => ui.querySelector(sel);
    const titleWrap = pick('[data-ui="title"]');
    const beginBtn = pick('[data-ui="begin"]');
    const resumeBtn = pick('[data-ui="resume"]');
    const choiceWrap = pick('[data-ui="choice"]');
    const endWrap = pick('[data-ui="end"]');
    const againBtn = pick('[data-ui="again"]');
    const tools = pick('[data-ui="tools"]');
    const soundBtn = pick('[data-ui="sound"]');
    const tiltBtn = pick('[data-ui="tilt"]');
    const pauseBtn = pick('[data-ui="pause"]');
    const choiceBtns = CHOICES.map((c) => pick('[data-choice="' + c.key + '"]'));

    // Safe-area padding lives here so a rotation or a host inset change moves
    // every panel at once, and nothing ends up under the home indicator.
    function layoutUi() {
      const bot = Math.round(safeBot());
      titleWrap.style.padding = "0 24px " + (bot + 34) + "px";
      choiceWrap.style.padding = "0 20px " + (bot + 26) + "px";
      endWrap.style.padding = "0 24px " + (bot + 30) + "px";
      tools.style.top = Math.round(safeTop() + 22) + "px";
    }
    layoutUi();

    // ---- results panel (drawn on canvas, over the council) ------------------
    function drawResults(alpha) {
      if (alpha <= 0.01) return;
      const maxW = Math.min(w - 48, 360);
      const x0 = (w - maxW) / 2;
      const rowH = 34;
      const top = h * 0.5 - (CHOICES.length * rowH) / 2;

      g.globalAlpha = alpha;
      g.fillStyle = "rgba(5,9,16,0.72)";
      roundRect(x0 - 14, top - 46, maxW + 28, CHOICES.length * rowH + 74, 14);
      g.fill();
      g.strokeStyle = "rgba(180,215,238,0.16)";
      g.lineWidth = 1;
      g.stroke();

      g.textAlign = "center";
      g.fillStyle = "#e6d6b6";
      g.font = "400 15px " + BODY;
      const head = tallyState === "ok" ? "The watch, and everyone else"
        : tallyState === "fail" ? "Your answer is noted" : "Counting…";
      g.fillText(head, w / 2, top - 24);

      const total = tallyRows ? tallyRows.reduce((a, r) => a + r.count, 0) : 0;
      g.textAlign = "left";
      for (let i = 0; i < CHOICES.length; i++) {
        const c = CHOICES[i];
        const row = tallyRows ? tallyRows.find((r) => r.value === c.key) : null;
        const share = total > 0 && row ? row.count / total : 0;
        const y = top + i * rowH;
        const mine = choice === c.key;

        g.fillStyle = "rgba(255,255,255,0.06)";
        roundRect(x0, y + 12, maxW, 9, 4.5);
        g.fill();
        if (total > 0) {
          g.fillStyle = mine ? "rgba(255,168,84,0.85)" : "rgba(150,200,232,0.5)";
          roundRect(x0, y + 12, Math.max(4, maxW * share * clamp(alpha * 1.6, 0, 1)), 9, 4.5);
          g.fill();
        }
        g.fillStyle = mine ? "#ffd9a4" : "rgba(226,238,246,0.78)";
        g.font = (mine ? "600 " : "400 ") + "13px " + UIFONT;
        g.fillText(c.label + (mine ? "  ·  you" : ""), x0, y + 6);
        if (total > 0) {
          g.textAlign = "right";
          g.fillText(Math.round(share * 100) + "%", x0 + maxW, y + 6);
          g.textAlign = "left";
        }
      }
      g.globalAlpha = 1;
      g.textAlign = "center";
    }

    function roundRect(x, y, rw, rh, r) {
      const rr = Math.min(r, rw / 2, rh / 2);
      g.beginPath();
      g.moveTo(x + rr, y);
      g.arcTo(x + rw, y, x + rw, y + rh, rr);
      g.arcTo(x + rw, y + rh, x, y + rh, rr);
      g.arcTo(x, y + rh, x, y, rr);
      g.arcTo(x, y, x + rw, y, rr);
      g.closePath();
    }

    // Tally results come back in more than one shape depending on the channel,
    // so read defensively and fall back to just showing the viewer's own pick.
    function parseTally(res) {
      const out = [];
      const push = (value, count) => {
        if (value == null) return;
        out.push({ value: String(value), count: Number(count) || 0 });
      };
      const src = res && (res.results || res.options || res.counts || res.tally || res.data) || res;
      if (Array.isArray(src)) {
        for (const row of src) {
          if (row && typeof row === "object") push(row.value || row.option || row.key || row.id, row.count != null ? row.count : row.votes || row.total || 0);
        }
      } else if (src && typeof src === "object") {
        for (const k of Object.keys(src)) {
          const v = src[k];
          if (typeof v === "number") push(k, v);
          else if (v && typeof v === "object") push(k, v.count != null ? v.count : v.votes || v.total || 0);
        }
      }
      return out.length ? out : null;
    }

    // ---- audio ------------------------------------------------------------
    async function startMusic() {
      if (!ctx.capabilities || !ctx.capabilities.backgroundMusic) return;
      try { await ctx.music.unlock(); } catch (e) { /* stays locked, fine */ }
      try {
        music = await ctx.music.play({
          preset: SCENES[0].music.preset,
          volume: 0.5,
          intensity: SCENES[0].music.intensity,
          tempo: SCENES[0].music.tempo,
          scale: "minor",
          fadeInMs: 2600
        });
      } catch (e) { music = null; }
    }

    function cueMusic(s) {
      if (!music || muted) return;
      try { music.setPreset(s.music.preset, { fadeMs: 1400 }); } catch (e) {}
      try { music.setIntensity(s.music.intensity); } catch (e) {}
      try { music.setTempo(s.music.tempo); } catch (e) {}
    }

    function sting(name) {
      if (muted) return;
      try { ctx.music.sting(name); } catch (e) {}
    }

    function haptic(kind) {
      if (!ctx.capabilities || !ctx.capabilities.haptics) return;
      try { ctx.platform.haptic(kind); } catch (e) {}
    }

    // ---- storage ----------------------------------------------------------
    async function loadSaved() {
      if (!ctx.capabilities || !ctx.capabilities.storage) return;
      try {
        const v = await ctx.storage.get("progress");
        if (v && typeof v === "object") {
          furthest = clamp(Number(v.furthest) || 0, 0, SCENES.length - 1);
          if (typeof v.choice === "string") choice = v.choice;
          if (furthest > 0) {
            resumeBtn.style.display = "block";
            resumeBtn.textContent = "Resume — " + SCENES[furthest].num + ". " + titleCase(SCENES[furthest].name);
          }
        }
      } catch (e) { /* first visit */ }
    }

    function titleCase(s) {
      return s.toLowerCase().replace(/(^|\s)([a-z])/g, (m, a, b) => a + b.toUpperCase());
    }

    function save() {
      if (!ctx.capabilities || !ctx.capabilities.storage) return;
      try { ctx.storage.set("progress", { furthest: furthest, choice: choice }); } catch (e) {}
    }

    // ---- flow -------------------------------------------------------------
    function showTools(on) {
      tools.style.display = on ? "block" : "none";
    }

    function beginStory(from) {
      mode = MODE.STORY;
      scene = clamp(from || 0, 0, SCENES.length - 1);
      st = 0;
      held = false;
      heldFor = 0;
      resultsAt = -1;
      // A rewatch is a fresh council: the tally replaces the previous vote.
      if (!from) { choice = null; tallyRows = null; tallyState = "none"; }
      paused = false;
      pauseBtn.textContent = "❚❚";
      titleWrap.style.display = "none";
      endWrap.style.display = "none";
      showTools(true);
      if (!started) {
        started = true;
        try { ctx.platform.start({ from: scene }); } catch (e) {}
        startMusic();
      } else {
        cueMusic(SCENES[scene]);
      }
      try { ctx.platform.milestone("chapter_" + SCENES[scene].id); } catch (e) {}
    }

    function gotoScene(i) {
      if (i >= SCENES.length) return finish();
      scene = i;
      st = 0;
      held = false;
      if (scene > furthest) { furthest = scene; save(); }
      cueMusic(SCENES[scene]);
      try { ctx.platform.milestone("chapter_" + SCENES[scene].id); } catch (e) {}
      // punctuation for the biggest turns
      if (SCENES[scene].id === "quiet") { sting("danger"); haptic("heavy"); }
      if (SCENES[scene].id === "fire") { sting("powerup"); haptic("success"); }
      if (SCENES[scene].id === "answer") { sting("win"); haptic("success"); }
    }

    function finish() {
      mode = MODE.END;
      endAt = clock;
      showTools(false);
      choiceWrap.style.display = "none";
      endWrap.style.display = "flex";
      furthest = 0;
      save();
      try { ctx.music.setPreset("cozy", { fadeMs: 2000 }); ctx.music.setIntensity(0.3); } catch (e) {}
      try { ctx.platform.setProgress(1); } catch (e) {}
      try { ctx.platform.complete({ choice: choice || "none" }); } catch (e) {}
    }

    function showChoice() {
      held = true;
      choiceWrap.style.display = "flex";
      haptic("light");
    }

    async function pickChoice(key) {
      choice = key;
      choiceWrap.style.display = "none";
      held = false;
      resultsAt = st;
      tallyState = "sending";
      save();
      haptic("medium");
      sting("tap");
      try { ctx.platform.interact({ type: "vote", choice: key }); } catch (e) {}
      try {
        await ctx.memory.tally("council").choose(key);
        const res = await ctx.memory.tally("council").results();
        tallyRows = parseTally(res);
        tallyState = tallyRows ? "ok" : "fail";
      } catch (e) {
        tallyRows = null;
        tallyState = "fail";
      }
    }

    for (let i = 0; i < choiceBtns.length; i++) {
      const key = CHOICES[i].key;
      press(choiceBtns[i], () => pickChoice(key));
    }
    press(beginBtn, () => beginStory(0));
    press(resumeBtn, () => beginStory(furthest));
    press(againBtn, () => beginStory(0));
    press(soundBtn, () => {
      muted = !muted;
      soundBtn.textContent = muted ? "✕" : "♪";
      soundBtn.style.opacity = muted ? "0.55" : "1";
      applyAudio();
    });
    press(pauseBtn, () => {
      paused = !paused;
      pauseBtn.textContent = paused ? "▶" : "❚❚";
      applyAudio();
    });

    // Tilt is opt-in and off by default: it is lovely held up, and unusable
    // lying down or on a moving bus. Drag always works regardless.
    press(tiltBtn, async () => {
      if (tiltOn) {
        tiltOn = false;
        tiltZero = null;
        tiltBtn.style.opacity = "0.55";
        return;
      }
      if (!ctx.capabilities || !ctx.capabilities.motion) {
        tiltBtn.style.opacity = "0.25";
        return;
      }
      let granted = false;
      try { granted = await ctx.motion.start(); } catch (e) { granted = false; }
      if (granted) {
        tiltOn = true;
        tiltZero = null;                 // recentre on whatever pose you hold now
        tiltBtn.style.opacity = "1";
        haptic("light");
      } else {
        tiltBtn.style.opacity = "0.25";  // denied; drag still covers everything
      }
    });

    // Mute and pause both silence the bed; unmuting while paused keeps it quiet.
    function applyAudio() {
      try {
        if (muted || paused) ctx.music.pause();
        else { ctx.music.resume(); cueMusic(SCENES[scene]); }
      } catch (e) {}
    }

    // The canvas carries two gestures at once: drag to look around, tap to move
    // the story on. They are told apart by distance travelled, so a look never
    // skips a chapter by accident and a tap still lands instantly.
    const TAP_SLOP = 12;        // px of travel still counted as a tap

    // Where the pointer was last frame, for the wake's direction.
    let lastPX = 0;
    let lastPY = 0;
    let lastGustAt = -1;

    const localXY = (e) => {
      const r = canvas.getBoundingClientRect();
      return [e.clientX - r.left, e.clientY - r.top];
    };

    ctx.listen(canvas, "pointerdown", (e) => {
      dragging = true;
      dragId = e.pointerId;
      dragFromX = e.clientX;
      dragFromY = e.clientY;
      dragBaseX = look.x;
      dragBaseY = look.y;
      dragMoved = 0;
      const lp = localXY(e);
      lastPX = lp[0];
      lastPY = lp[1];
      addGust(lp[0], lp[1], 0, 0, 0.9);
      lastGustAt = clock;
      if (canvas.setPointerCapture) {
        try { canvas.setPointerCapture(e.pointerId); } catch (err) {}
      }
    });

    ctx.listen(canvas, "pointermove", (e) => {
      const lp = localXY(e);
      // Stir the world whether or not a look is in progress, and whether or not
      // the pointer is down — a passing cursor should disturb the snow too.
      if (clock - lastGustAt > 0.045) {
        const vx = lp[0] - lastPX;
        const vy = lp[1] - lastPY;
        const sp = Math.min(1, Math.sqrt(vx * vx + vy * vy) / 26);
        if (sp > 0.05 || dragging) addGust(lp[0], lp[1], vx, vy, 0.5 + sp * 1.3);
        lastGustAt = clock;
      }
      lastPX = lp[0];
      lastPY = lp[1];

      if (!dragging || e.pointerId !== dragId) return;
      const dx = e.clientX - dragFromX;
      const dy = e.clientY - dragFromY;
      dragMoved = Math.max(dragMoved, Math.abs(dx) + Math.abs(dy));
      if (dragMoved > TAP_SLOP) {
        hasLooked = true;
        // A full frame-width drag sweeps the whole look range.
        look.x = clamp(dragBaseX - dx / (w * 0.55), -1, 1);
        look.y = clamp(dragBaseY - dy / (h * 0.55), -1, 1);
      }
    });

    const endDrag = (e) => {
      if (!dragging || (e.pointerId != null && e.pointerId !== dragId)) return;
      dragging = false;
      dragId = null;
      if (dragMoved > TAP_SLOP) return;        // that was a look, not a tap

      if (mode === MODE.TITLE) { beginStory(0); return; }
      if (mode === MODE.END) return;
      if (held) return;                        // the council is waiting on you
      const s = SCENES[scene];
      const last = s.lines[s.lines.length - 1][0];
      if (st < last) {
        st = last + 0.05;
        haptic("light");
      } else {
        haptic("light");
        gotoScene(scene + 1);
      }
      try { ctx.platform.interact({ type: "skip", chapter: SCENES[scene].id }); } catch (e2) {}
    };
    ctx.listen(canvas, "pointerup", endDrag);
    ctx.listen(canvas, "pointercancel", endDrag);

    // ---- frame ------------------------------------------------------------
    let progressAt = 0;

    ctx.onFrame((dtMs) => {
      const dt = Math.min(dtMs || 16, 50) / 1000;
      clock += dt;

      // Trim detail rather than drop frames on slower hardware.
      avgDt = avgDt * 0.94 + (dtMs || 16) * 0.06;
      quality = avgDt > 34 ? 0.35 : avgDt > 25 ? 0.62 : 1;

      // Camera. While a finger is down it leads; otherwise tilt takes over if
      // it was granted, and failing that the view drifts back toward centre so
      // the composition always recovers on its own.
      if (!dragging) {
        if (tiltOn && ctx.motion && ctx.motion.active) {
          const tl = ctx.motion.tilt || {};
          const tx = tl.x || 0;
          const ty = tl.y || 0;
          if (!tiltZero) tiltZero = { x: tx, y: ty };
          look.x = clamp((ty - tiltZero.y) / 24, -1, 1);
          look.y = clamp((tx - tiltZero.x) / 24, -1, 1);
        } else {
          look.x *= 0.96;
          look.y *= 0.96;
        }
      }
      // Frame-rate independent easing, so the drift feels the same at 30 or 60.
      const ease2 = 1 - Math.pow(0.0015, dt);
      lookS.x += (look.x - lookS.x) * ease2;
      lookS.y += (look.y - lookS.y) * ease2;

      // Retire spent gusts.
      for (let i = gusts.length - 1; i >= 0; i--) {
        if (clock - gusts[i].born > GUST_LIFE) gusts.splice(i, 1);
      }

      if (w !== ctx.width || h !== ctx.height) {
        w = ctx.width;
        h = ctx.height;
        wrapCache.clear();
        layerKey = "";
        layoutUi();
      }

      // NB: never setTransform here. createCanvas2D hands back a context that
      // is already scaled to CSS pixels for the device DPR, and resetting the
      // matrix would throw that away — everything would render at 1/dpr size
      // in the top-left corner. Balanced save/restore only.
      g.save();
      g.clearRect(0, 0, w, h);
      paint(dt);
      g.restore();
    });

    function paint(dt) {
      if (mode === MODE.TITLE) {
        drawTitleArt(clock);
        const a = clamp(clock / 1.6, 0, 1);
        g.textAlign = "center";
        g.globalAlpha = a;
        const ts = clamp(Math.round(Math.min(w, h * 0.7) / 8.2), 30, 62);
        g.fillStyle = "#f2e6cf";
        g.font = ts + "px " + SERIF;
        g.fillText("The Ninth", w / 2, h * 0.34);
        g.fillText("Watchfire", w / 2, h * 0.34 + ts * 1.02);
        g.globalAlpha = a * 0.62;
        g.fillStyle = C.pale;
        g.font = clamp(Math.round(w / 32), 11, 15) + "px " + SERIF;
        tracked("A STORY OF THE RIME", w / 2, h * 0.34 + ts * 1.9, clamp(w / 180, 1.6, 3.4), "center");
        g.globalAlpha = a * 0.4;
        g.font = "300 " + clamp(Math.round(w / 26), 13, 18) + "px " + BODY;
        g.fillText("five minutes · drag to look · tap to go on", w / 2, h * 0.34 + ts * 2.6);
        g.globalAlpha = 1;
        return;
      }

      if (mode === MODE.END) {
        drawEndArt(clock);
        const p = clamp((clock - endAt) / 1.4, 0, 1);
        g.textAlign = "center";
        g.globalAlpha = p;
        const ts = clamp(Math.round(Math.min(w, h * 0.7) / 11), 22, 44);
        g.fillStyle = "#f2e6cf";
        g.font = ts + "px " + SERIF;
        g.fillText("The Ninth Watchfire", w / 2, h * 0.28);
        g.globalAlpha = p * clamp((clock - endAt - 0.8) / 1.6, 0, 1);
        g.fillStyle = "#e9dcc4";
        g.font = "300 " + clamp(Math.round(w / 17), 19, 30) + "px " + BODY;
        g.fillText("You light it anyway.", w / 2, h * 0.28 + ts * 1.5);
        g.globalAlpha = 1;
        if (choice) drawResults(clamp((clock - endAt - 1.6) / 1.2, 0, 1) * 0.96);
        return;
      }

      // --- story ---
      const s = SCENES[scene];
      if (!paused && !held) st += dt;

      // The council waits on you — but not forever. After 40 seconds the story
      // moves on without a vote, and chapter VII uses its neutral opening.
      if (s.id === "council") {
        if (!held && choice == null && st >= CHOICE_AT && resultsAt < 0) showChoice();
        if (held) {
          heldFor += dt;
          if (heldFor > 40) {
            held = false;
            choiceWrap.style.display = "none";
          }
        }
      }

      // Camera: a slow push and drift so no chapter is ever quite static, plus
      // a shake when the gate goes. Both fold into one transform around the
      // scene painter — shaking the vignette instead of the art fools nobody.
      const p = clamp(st / s.dur, 0, 1);
      const camZ = 1.02 + 0.05 * (s.id === "silence" ? 0.2 : 1) * ease(p);
      const camX = Math.sin(p * 1.2 + scene) * w * 0.012;
      const camY = -ease(p) * h * 0.012;
      let shx = 0;
      let shy = 0;
      if (s.id === "quiet") {
        const sh = ramp(p, 0.74, 0.86) * (1 - ramp(p, 0.93, 1)) * 5;
        if (sh > 0.05) {
          shx = (Math.random() - 0.5) * sh;
          shy = (Math.random() - 0.5) * sh;
        }
      }
      g.save();
      g.translate(w / 2 + camX + shx, h / 2 + camY + shy);
      g.scale(camZ, camZ);
      g.translate(-w / 2, -h / 2);
      s.draw(p, clock);
      g.restore();

      drawWake();
      vignette(0.85);

      drawChapterCard(s);

      // A one-time nudge that you can move the world, shown only in the first
      // chapter and only until you actually do it.
      if (!hasLooked && scene === 0) {
        const ha = ramp(st, 3.2, 4.4) * (1 - ramp(st, 11, 13));
        if (ha > 0.01) {
          const hs = clamp(Math.round(w / 28), 12, 17);
          g.save();
          g.globalAlpha = ha * 0.62;
          g.textAlign = "center";
          g.fillStyle = C.pale;
          g.font = "300 " + hs + "px " + BODY;
          const hy = h * 0.5 + Math.sin(clock * 1.6) * 3;
          g.fillText("drag to look around", w / 2, hy);
          // a pair of chevrons either side, breathing outward
          const sw = Math.sin(clock * 1.6) * 3;
          g.strokeStyle = C.pale;
          g.lineWidth = 1.3;
          g.globalAlpha = ha * 0.4;
          for (const dir of [-1, 1]) {
            const bx = w / 2 + dir * (g.measureText("drag to look around").width / 2 + 16 + sw);
            g.beginPath();
            g.moveTo(bx - dir * 4, hy - 9);
            g.lineTo(bx + dir * 4, hy - 4.5);
            g.lineTo(bx - dir * 4, hy);
            g.stroke();
          }
          g.restore();
        }
      }

      const fade = 1 - ramp(st, s.dur - 1.3, s.dur);
      if (!held) drawNarration(s, fade);
      if (s.id === "council" && resultsAt >= 0) {
        const ra = clamp((st - resultsAt) / 0.8, 0, 1) * (1 - ramp(st, s.dur - 1.2, s.dur));
        drawResults(ra);
      }
      drawProgress();

      if (paused) {
        g.globalAlpha = 0.55;
        g.fillStyle = "#04070e";
        g.fillRect(0, 0, w, h);
        g.globalAlpha = 0.85;
        g.textAlign = "center";
        g.fillStyle = C.ink;
        g.font = "300 " + clamp(Math.round(w / 22), 16, 24) + "px " + BODY;
        g.fillText("paused", w / 2, h / 2);
        g.globalAlpha = 1;
      }

      if (clock - progressAt > 0.4) {
        progressAt = clock;
        const done = SCENES.slice(0, scene).reduce((a, x) => a + x.dur, 0) + st;
        try { ctx.platform.setProgress(clamp(done / TOTAL, 0, 1)); } catch (e) {}
      }

      if (st >= s.dur) gotoScene(scene + 1);
    }

    // First frame before anything else, then tell the host we are up.
    drawTitleArt(0);
    ctx.markVisualReady("title");
    ctx.platform.ready();

    await loadSaved();
  }
};
