// Kaleido Bloom — a mobile-first Plethora Bit.
// Drag a finger across the canvas to paint radially-symmetric, glowing
// mandalas. Strokes are mirrored around the centre (dihedral symmetry) and
// slowly breathe/fade so the pattern feels alive. Before the first touch an
// "attract" autopilot paints on its own so the first frame is never blank.

window.plethoraBit = {
  meta: {
    title: "Kaleido Bloom",
    runtime: "plethora-bit@2",
    tags: ["art", "creative", "fidget", "touch", "generative", "sensory"],
    permissions: ["haptics", "backgroundMusic"]
  },

  async init(ctx) {
    const BG = "#0a0a12";               // deep base colour used for the slow fade
    const SYMMETRIES = [6, 8, 12, 16];  // wedge counts the ✦ button cycles through

    // ---- surfaces ----------------------------------------------------------
    const canvas = ctx.createCanvas2D({ touchAction: "none" });
    const g = canvas.getContext("2d");

    // A DOM overlay hosts the small control chips and the instructions panel.
    const ui = ctx.createRoot({ touchAction: "none" });
    ui.style.pointerEvents = "none"; // let paint gestures pass through empty areas

    // ---- state -------------------------------------------------------------
    let symIndex = 1;                   // start on 8-fold symmetry
    let started = false;                // becomes true on first real gesture
    let autopilot = true;               // attract-mode painter, off after touch
    let autoPhase = 0;                  // drives the attract-mode rose curve
    let painting = false;
    let last = null;                    // previous pointer sample {x, y}
    let lastInteract = 0;               // throttle for platform.interact()
    let music = null;
    const queue = [];                   // pointer segments processed each frame

    // Fill the whole canvas once so the very first frame shows something.
    function wash(alpha) {
      g.globalCompositeOperation = "source-over";
      g.globalAlpha = alpha;
      g.fillStyle = BG;
      g.fillRect(0, 0, ctx.width, ctx.height);
      g.globalAlpha = 1;
    }
    wash(1);

    // ---- painting ----------------------------------------------------------
    // Draw one segment, replicated across every wedge and its mirror, using
    // additive blending so overlapping strokes bloom toward white.
    function paint(x0, y0, x1, y1, speed, timeMs) {
      const cx = ctx.width / 2;
      const cy = ctx.height / 2;
      const n = SYMMETRIES[symIndex];
      const step = (Math.PI * 2) / n;

      const r = Math.hypot(x1 - cx, y1 - cy);
      const hue = (timeMs * 0.03 + r * 0.6) % 360;
      const width = Math.max(1.5, 9 - speed * 0.9);

      g.globalCompositeOperation = "lighter";
      g.globalAlpha = 0.85;
      g.strokeStyle = `hsl(${hue}, 90%, 60%)`;
      g.fillStyle = `hsl(${(hue + 40) % 360}, 95%, 65%)`;
      g.lineCap = "round";
      g.lineWidth = width;

      g.save();
      g.translate(cx, cy);
      for (let k = 0; k < n; k++) {
        g.save();
        g.rotate(step * k);
        for (const flip of [1, -1]) {
          g.save();
          g.scale(1, flip);
          g.beginPath();
          g.moveTo(x0 - cx, y0 - cy);
          g.lineTo(x1 - cx, y1 - cy);
          g.stroke();
          // A soft dot at the leading end adds a jewel-like highlight.
          g.beginPath();
          g.arc(x1 - cx, y1 - cy, width * 0.55, 0, Math.PI * 2);
          g.fill();
          g.restore();
        }
        g.restore();
      }
      g.restore();
      g.globalAlpha = 1;
    }

    // ---- pointer input -----------------------------------------------------
    function localPoint(e) {
      const rect = canvas.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    }

    function begin(e) {
      e.preventDefault();
      painting = true;
      autopilot = false;
      last = localPoint(e);
      if (!started) {
        started = true;
        ctx.platform.start();
        startMusic();
      }
      if (ctx.capabilities.haptics) ctx.platform.haptic("light");
    }

    function move(e) {
      if (!painting) return;
      e.preventDefault();
      const p = localPoint(e);
      const speed = Math.hypot(p.x - last.x, p.y - last.y);
      queue.push({ x0: last.x, y0: last.y, x1: p.x, y1: p.y, speed });
      last = p;
    }

    function end() {
      painting = false;
      last = null;
    }

    ctx.listen(canvas, "pointerdown", begin, { passive: false });
    ctx.listen(canvas, "pointermove", move, { passive: false });
    ctx.listen(canvas, "pointerup", end);
    ctx.listen(canvas, "pointercancel", end);

    // ---- music -------------------------------------------------------------
    async function startMusic() {
      if (music || !ctx.capabilities.backgroundMusic) return;
      try {
        await ctx.music.unlock();
        music = await ctx.music.play({ preset: "drift", volume: 0.45, fadeInMs: 1200 });
      } catch (err) {
        ctx.platform.error({ where: "music", message: String(err) });
      }
    }

    // ---- controls ----------------------------------------------------------
    function chip(label, title) {
      const b = document.createElement("button");
      b.textContent = label;
      b.setAttribute("aria-label", title);
      b.style.cssText =
        "pointer-events:auto;width:44px;height:44px;border-radius:14px;border:none;" +
        "font:600 18px/1 -apple-system,system-ui,sans-serif;color:#eef;" +
        "background:rgba(255,255,255,0.10);backdrop-filter:blur(8px);" +
        "-webkit-backdrop-filter:blur(8px);display:flex;align-items:center;" +
        "justify-content:center;cursor:pointer;touch-action:manipulation;" +
        "box-shadow:0 2px 10px rgba(0,0,0,0.35);";
      return b;
    }

    const bar = document.createElement("div");
    bar.style.cssText =
      `position:absolute;left:0;right:0;top:calc(${ctx.safeArea.top}px + 12px);` +
      "display:flex;gap:12px;justify-content:center;pointer-events:none;";
    ui.appendChild(bar);

    const symBtn = chip("✦" + SYMMETRIES[symIndex], "Change symmetry");
    ctx.listen(symBtn, "click", () => {
      symIndex = (symIndex + 1) % SYMMETRIES.length;
      symBtn.textContent = "✦" + SYMMETRIES[symIndex];
      if (ctx.capabilities.haptics) ctx.platform.haptic("light");
      ctx.platform.interact({ type: "symmetry", value: SYMMETRIES[symIndex] });
    });

    const clearBtn = chip("⟲", "Clear canvas");
    ctx.listen(clearBtn, "click", () => {
      wash(1);
      autopilot = true;
      autoPhase = 0;
      if (ctx.capabilities.haptics) ctx.platform.haptic("medium");
      if (music) { try { music.sting("tap"); } catch (e) {} }
      ctx.platform.interact({ type: "clear" });
    });

    const helpBtn = chip("?", "How to play");
    ctx.listen(helpBtn, "click", () => togglePanel());
    bar.append(helpBtn, symBtn, clearBtn);

    // Instructions panel (hidden until "?" is tapped).
    const panel = document.createElement("div");
    panel.style.cssText =
      "position:absolute;inset:0;display:none;align-items:center;justify-content:center;" +
      "padding:28px;pointer-events:auto;background:rgba(6,6,14,0.72);" +
      "backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px);";
    panel.innerHTML =
      '<div style="max-width:320px;color:#eef;font:400 16px/1.55 -apple-system,system-ui,sans-serif;">' +
      '<h2 style="font-size:22px;margin-bottom:14px;">Kaleido Bloom</h2>' +
      '<ul style="list-style:none;display:grid;gap:10px;">' +
      '<li>• Drag a finger to paint glowing mandalas.</li>' +
      '<li>• Move fast for thin threads, slow for bold blooms.</li>' +
      '<li>• Tap <b>✦</b> to change how many ways your stroke mirrors.</li>' +
      '<li>• Tap <b>⟲</b> to clear and start fresh.</li>' +
      '</ul>' +
      '<p style="margin-top:16px;opacity:0.7;">Tap anywhere to close.</p></div>';
    ui.appendChild(panel);
    function togglePanel() {
      panel.style.display = panel.style.display === "none" ? "flex" : "none";
    }
    ctx.listen(panel, "click", () => (panel.style.display = "none"));

    // ---- frame loop --------------------------------------------------------
    ctx.onFrame((dtMs, timeMs) => {
      // Gentle phosphor fade so old strokes breathe out over a few seconds.
      wash(0.014);

      // Attract mode: paint a slowly evolving rose curve until the first touch.
      if (autopilot) {
        autoPhase += dtMs * 0.0016;
        const cx = ctx.width / 2;
        const cy = ctx.height / 2;
        const reach = Math.min(ctx.width, ctx.height) * 0.42;
        const r = reach * (0.35 + 0.55 * Math.abs(Math.sin(autoPhase * 1.7)));
        const a = autoPhase;
        const x = cx + Math.cos(a) * r;
        const y = cy + Math.sin(a) * r;
        if (last) paint(last.x, last.y, x, y, 3, timeMs);
        last = { x, y };
      }

      // Drain queued finger segments.
      for (const s of queue) paint(s.x0, s.y0, s.x1, s.y1, s.speed, timeMs);
      if (queue.length) {
        queue.length = 0;
        if (timeMs - lastInteract > 400) {
          lastInteract = timeMs;
          ctx.platform.interact({ type: "paint" });
        }
      }
    });

    ctx.platform.ready();
  }
};
