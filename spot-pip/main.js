// Spot Pip — a hidden-object search Bit for Plethora.
//
// Pinch / drag / use the +- buttons to move around a busy, procedurally
// generated crowd and tap Pip: the character in the red-and-white striped
// hat with round glasses. Three levels ramp from easy to hard. The faster
// you find him, the more stars you earn; the total clear time is submitted
// to a "Fastest Clear" leaderboard.
//
// Everything is drawn procedurally — the runtime disables packaged assets
// (maxAssets: 0), so there are no external images.

window.plethoraBit = {
  meta: {
    title: "Spot Pip",
    runtime: "plethora-bit@2",
    tags: ["puzzle", "hidden-object", "game", "search", "zoom", "kids"],
    permissions: ["haptics", "backgroundMusic"]
  },

  async init(ctx) {
    // ---- palette -----------------------------------------------------------
    const PAPER_TOP = "#f6e7c4";
    const PAPER_BOT = "#e7cfa0";
    const LETTERBOX = "#15111c";
    const PIP = {
      skin: "#f2c9a0", hair: "#5a3a22",
      stripeA: "#e8352e", stripeB: "#f7f7f7",
      hat: "#e8352e", pants: "#2b3a67"
    };
    const SKINS = ["#f2c9a0", "#e8b98c", "#c68642", "#8d5524", "#ffd9b3"];
    const HAIRS = ["#2c1b0e", "#5a3a22", "#8a5a2b", "#111111", "#a8611f", "#754c99"];
    const SHIRTS = ["#2b7de9", "#27ae60", "#8e44ad", "#e67e22", "#16a085",
                    "#2c3e50", "#d35400", "#5f6b7a", "#e84393", "#f1c40f"];
    const HATS = ["#c0392b", "#2980b9", "#27ae60", "#8e44ad", "#e67e22", "#34495e"];

    // ---- level design ------------------------------------------------------
    // stripeChance/redChance/hatChance/glassesChance control how many
    // decoys share Pip's features → higher = harder to spot.
    const LEVELS = [
      { world: 1300, count: 55,  stripe: 0.10, red: 0.06, hat: 0.35, pom: 0.25, glass: 0.10, star3: 6,  star2: 14 },
      { world: 1950, count: 130, stripe: 0.32, red: 0.18, hat: 0.55, pom: 0.45, glass: 0.28, star3: 12, star2: 26 },
      { world: 2550, count: 240, stripe: 0.55, red: 0.34, hat: 0.70, pom: 0.62, glass: 0.45, star3: 20, star2: 42 }
    ];
    const BASE_SCORE = [1000, 1600, 2400];

    // ---- surfaces ----------------------------------------------------------
    const canvas = ctx.createCanvas2D({ touchAction: "none" });
    const g = canvas.getContext("2d");
    const ui = ctx.createRoot({ touchAction: "none" });
    ui.style.pointerEvents = "none";

    // ---- helpers -----------------------------------------------------------
    const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
    const lerp = (a, b, t) => a + (b - a) * t;
    const rnd = (a, b) => a + Math.random() * (b - a);
    const pick = (arr) => arr[(Math.random() * arr.length) | 0];
    const fmt = (ms) => (ms / 1000).toFixed(1) + "s";

    // ---- state -------------------------------------------------------------
    const cam = { x: 0, y: 0, scale: 1 };   // world point at screen centre + zoom
    let fitScale = 1, maxScale = 1, worldW = LEVELS[0].world, worldH = LEVELS[0].world;
    let chars = [], pip = null;
    let levelIndex = 0;
    let phase = "intro";                    // intro | search | found | done
    let started = false;
    let timing = false, levelMs = 0, totalMs = 0, misses = 0, totalScore = 0;
    const stars = [];                        // stars earned per level
    const ripples = [];                      // tap feedback rings (world coords)
    let focus = null;                        // camera tween target for animations
    let music = null;
    let lastInteract = -1e9;

    // ---- camera math -------------------------------------------------------
    function computeScaleBounds() {
      // World matches the screen aspect, so fit shows the whole crowd AND
      // fills the screen with no letterbox.
      fitScale = Math.min(ctx.width / worldW, ctx.height / worldH) * 0.999;
      maxScale = fitScale * 6.5;
    }
    function clampCam() {
      cam.scale = clamp(cam.scale, fitScale, maxScale);
      const hw = ctx.width / 2 / cam.scale;
      const hh = ctx.height / 2 / cam.scale;
      cam.x = worldW <= hw * 2 ? worldW / 2 : clamp(cam.x, hw, worldW - hw);
      cam.y = worldH <= hh * 2 ? worldH / 2 : clamp(cam.y, hh, worldH - hh);
    }
    const screenToWorld = (sx, sy) => ({
      x: cam.x + (sx - ctx.width / 2) / cam.scale,
      y: cam.y + (sy - ctx.height / 2) / cam.scale
    });

    // ---- world generation --------------------------------------------------
    function makeChar(cfg, x, y, r) {
      const stripes = Math.random() < cfg.stripe;
      let shirtA = pick(SHIRTS);
      let shirtB = stripes ? (Math.random() < 0.6 ? "#f7f7f7" : pick(SHIRTS)) : null;
      if (Math.random() < cfg.red) { shirtA = "#e8352e"; if (stripes) shirtB = "#f7f7f7"; }
      const hasHat = Math.random() < cfg.hat;
      const hatColor = Math.random() < cfg.red ? "#e8352e" : pick(HATS);
      const hasPom = hasHat && Math.random() < cfg.pom;
      let hasGlasses = Math.random() < cfg.glass;
      // Never let a decoy be a perfect Pip (all four tell-tale features).
      if (stripes && shirtA === "#e8352e" && shirtB === "#f7f7f7" &&
          hasHat && hatColor === "#e8352e" && hasPom && hasGlasses) {
        hasGlasses = false;
      }
      return {
        x, y, r, isWaldo: false,
        skin: pick(SKINS), hair: pick(HAIRS),
        stripes, shirtA, shirtB, hasHat, hatColor, hasPom, hasGlasses
      };
    }

    function buildLevel() {
      const cfg = LEVELS[levelIndex];
      worldW = cfg.world;
      worldH = cfg.world * (ctx.height / ctx.width);
      computeScaleBounds();
      chars = [];
      const cols = Math.max(3, Math.round(Math.sqrt(cfg.count * worldW / worldH)));
      const rows = Math.ceil(cfg.count / cols);
      const cw = worldW / cols, ch = worldH / rows;
      const r = Math.min(cw, ch) * 0.42;
      for (let i = 0; i < cfg.count; i++) {
        const col = i % cols, row = (i / cols) | 0;
        const x = (col + 0.5) * cw + rnd(-cw * 0.26, cw * 0.26);
        const y = (row + 0.5) * ch + rnd(-ch * 0.26, ch * 0.26);
        chars.push(makeChar(cfg, x, y, r * rnd(0.9, 1.05)));
      }
      // Drop Pip onto a random interior character's slot.
      const interior = chars.filter(c =>
        c.x > worldW * 0.12 && c.x < worldW * 0.88 &&
        c.y > worldH * 0.10 && c.y < worldH * 0.90);
      const host = interior.length ? pick(interior) : pick(chars);
      Object.assign(host, {
        isWaldo: true, skin: PIP.skin, hair: PIP.hair,
        stripes: true, shirtA: PIP.stripeA, shirtB: PIP.stripeB,
        hasHat: true, hatColor: PIP.hat, hasPom: true, hasGlasses: true
      });
      pip = host;
      // Start zoomed out so the whole crowd is visible; Pip is tiny.
      cam.scale = fitScale; cam.x = worldW / 2; cam.y = worldH / 2;
      clampCam();
    }

    // ---- character drawing -------------------------------------------------
    function drawChar(gg, c, forceFull) {
      const r = c.r;
      const apparent = forceFull ? 999 : r * cam.scale;
      const full = apparent > 15;
      const tw = r * 1.3, th = r * 1.55;         // torso
      const topY = c.y - r * 0.15;

      // legs / pants
      if (full) {
        gg.fillStyle = c.isWaldo ? PIP.pants : "#3a3f4b";
        gg.fillRect(c.x - tw * 0.34, topY + th * 0.72, tw * 0.24, r * 0.7);
        gg.fillRect(c.x + tw * 0.10, topY + th * 0.72, tw * 0.24, r * 0.7);
      }

      // torso (with optional horizontal stripes)
      const tx = c.x - tw / 2;
      roundRect(gg, tx, topY, tw, th, r * 0.28);
      if (c.stripes && c.shirtB) {
        const bands = 5;
        for (let i = 0; i < bands; i++) {
          gg.fillStyle = i % 2 === 0 ? c.shirtA : c.shirtB;
          gg.fillRect(tx, topY + (th / bands) * i, tw, th / bands + 0.6);
        }
      } else {
        gg.fillStyle = c.shirtA;
        gg.fill();
      }

      // arms
      if (full) {
        gg.fillStyle = c.stripes ? c.shirtA : c.shirtA;
        roundRect(gg, tx - r * 0.28, topY + th * 0.08, r * 0.3, th * 0.6, r * 0.15); gg.fill();
        roundRect(gg, tx + tw - r * 0.02, topY + th * 0.08, r * 0.3, th * 0.6, r * 0.15); gg.fill();
      }

      // head
      const hx = c.x, hy = topY - r * 0.28, hr = r * 0.55;
      gg.fillStyle = c.skin;
      gg.beginPath(); gg.arc(hx, hy, hr, 0, Math.PI * 2); gg.fill();

      // hair fringe
      if (full && !c.hasHat) {
        gg.fillStyle = c.hair;
        gg.beginPath(); gg.arc(hx, hy - hr * 0.15, hr, Math.PI * 1.05, Math.PI * 1.95); gg.fill();
      }

      // face — glasses or simple eyes + smile
      if (full) {
        if (c.hasGlasses) {
          gg.strokeStyle = "#111"; gg.lineWidth = Math.max(1, hr * 0.14);
          const ey = hy - hr * 0.05, ex = hr * 0.42, er = hr * 0.34;
          gg.beginPath(); gg.arc(hx - ex, ey, er, 0, Math.PI * 2); gg.stroke();
          gg.beginPath(); gg.arc(hx + ex, ey, er, 0, Math.PI * 2); gg.stroke();
          gg.beginPath(); gg.moveTo(hx - ex + er, ey); gg.lineTo(hx + ex - er, ey); gg.stroke();
        } else {
          gg.fillStyle = "#20242c";
          gg.beginPath(); gg.arc(hx - hr * 0.35, hy - hr * 0.05, hr * 0.12, 0, 6.29); gg.fill();
          gg.beginPath(); gg.arc(hx + hr * 0.35, hy - hr * 0.05, hr * 0.12, 0, 6.29); gg.fill();
        }
      }

      // hat (beanie + optional pom); Pip also gets a striped scarf
      if (c.hasHat) {
        gg.fillStyle = c.hatColor;
        gg.beginPath();
        gg.arc(hx, hy - hr * 0.1, hr * 1.02, Math.PI * 1.02, Math.PI * 1.98);
        gg.closePath(); gg.fill();
        gg.fillRect(hx - hr * 1.0, hy - hr * 0.12, hr * 2.0, hr * 0.3);
        if (c.isWaldo) { // white band accent
          gg.fillStyle = "#f7f7f7";
          gg.fillRect(hx - hr * 1.0, hy - hr * 0.42, hr * 2.0, hr * 0.3);
          gg.fillStyle = c.hatColor;
        }
        if (c.hasPom) {
          gg.fillStyle = c.isWaldo ? "#f7f7f7" : "#f7f7f7";
          gg.beginPath(); gg.arc(hx, hy - hr * 1.15, hr * 0.28, 0, 6.29); gg.fill();
        }
      }
      if (full && c.isWaldo) { // striped scarf
        gg.fillStyle = PIP.stripeA;
        gg.fillRect(c.x - tw * 0.5, topY - r * 0.02, tw, r * 0.22);
        gg.fillStyle = PIP.stripeB;
        gg.fillRect(c.x - tw * 0.5, topY + r * 0.08, tw, r * 0.12);
      }
    }

    function roundRect(gg, x, y, w, h, r) {
      gg.beginPath();
      gg.moveTo(x + r, y);
      gg.arcTo(x + w, y, x + w, y + h, r);
      gg.arcTo(x + w, y + h, x, y + h, r);
      gg.arcTo(x, y + h, x, y, r);
      gg.arcTo(x, y, x + w, y, r);
      gg.closePath();
    }

    // ---- scene render ------------------------------------------------------
    let paperGrad = null;
    function render(timeMs) {
      // Draw under the runtime's base (DPR-scaled) transform — never reset to
      // identity, or the device-pixel-ratio scaling the runtime set up is lost.
      g.fillStyle = LETTERBOX;
      g.fillRect(0, 0, ctx.width, ctx.height);

      g.save();
      g.translate(ctx.width / 2, ctx.height / 2);
      g.scale(cam.scale, cam.scale);
      g.translate(-cam.x, -cam.y);

      if (!paperGrad || paperGrad._w !== worldW || paperGrad._h !== worldH) {
        paperGrad = g.createLinearGradient(0, 0, 0, worldH);
        paperGrad.addColorStop(0, PAPER_TOP);
        paperGrad.addColorStop(1, PAPER_BOT);
        paperGrad._w = worldW; paperGrad._h = worldH;
      }
      g.fillStyle = paperGrad;
      g.fillRect(0, 0, worldW, worldH);

      // cull to viewport (+margin) so zoomed-in frames stay cheap
      const hw = ctx.width / 2 / cam.scale + 60;
      const hh = ctx.height / 2 / cam.scale + 60;
      for (const c of chars) {
        if (Math.abs(c.x - cam.x) > hw || Math.abs(c.y - cam.y) > hh) continue;
        drawChar(g, c, false);
      }

      // tap ripples
      for (let i = ripples.length - 1; i >= 0; i--) {
        const rp = ripples[i];
        const age = (timeMs - rp.t) / 550;
        if (age >= 1) { ripples.splice(i, 1); continue; }
        g.strokeStyle = rp.color;
        g.globalAlpha = 1 - age;
        g.lineWidth = 4 / cam.scale;
        g.beginPath();
        g.arc(rp.x, rp.y, (14 + age * 46) / cam.scale, 0, 6.29);
        g.stroke();
        g.globalAlpha = 1;
      }

      // found highlight around Pip
      if (phase === "found" && pip) {
        const pulse = 1 + 0.12 * Math.sin(timeMs / 140);
        g.strokeStyle = "#ffd23f";
        g.lineWidth = 5 / cam.scale;
        g.beginPath();
        g.arc(pip.x, pip.y - pip.r * 0.2, pip.r * 1.7 * pulse, 0, 6.29);
        g.stroke();
      }

      g.restore();
    }

    // ---- game flow ---------------------------------------------------------
    function startLevel(i) {
      levelIndex = i;
      buildLevel();
      levelMs = 0; misses = 0;
      phase = "search"; timing = true;
      focus = null;
      hud.level.textContent = "Level " + (i + 1) + "/3";
      hideOverlay();
      ctx.platform.milestone("level_start", { level: i + 1 });
    }

    function starsFor(sec, cfg) { return sec <= cfg.star3 ? 3 : sec <= cfg.star2 ? 2 : 1; }

    function win() {
      phase = "found"; timing = false;
      const cfg = LEVELS[levelIndex];
      const sec = levelMs / 1000;
      const s = starsFor(sec, cfg);
      stars[levelIndex] = s;
      totalMs += levelMs;
      const gained = Math.max(50, Math.round(BASE_SCORE[levelIndex] - sec * 30 - misses * 40));
      totalScore += gained;
      ctx.platform.setScore(totalScore);
      ctx.platform.setProgress((levelIndex + 1) / 3);
      ctx.platform.milestone("level_clear", { level: levelIndex + 1, ms: Math.round(levelMs), stars: s });
      if (ctx.capabilities.haptics) ctx.platform.haptic("success");
      sting(levelIndex === 2 ? "win" : "success");

      // Zoom the camera in on Pip — the reveal / "here he is" moment.
      focus = { x: pip.x, y: pip.y - pip.r * 0.2, scale: clamp(maxScale * 0.85, fitScale, maxScale) };

      const last = levelIndex === 2;
      ctx.timeout(() => {
        showCard({
          title: last ? "You found them all!" : "Found Pip!",
          stars: s,
          lines: last
            ? ["Total time  " + fmt(totalMs), "Score  " + totalScore]
            : ["Time  " + fmt(levelMs), "+" + gained + " pts"],
          button: last ? "Play again" : "Next level",
          onButton: last ? finish : () => startLevel(levelIndex + 1)
        });
        if (last) submitTime();
      }, 900);
    }

    function finish() {
      // "Play again" — reshuffle every level from scratch.
      phase = "intro";
      totalMs = 0; totalScore = 0; misses = 0; stars.length = 0;
      startLevel(0);
    }

    async function submitTime() {
      try {
        await ctx.memory.record("best_time").submit(Math.round(totalMs), { label: fmt(totalMs) });
        ctx.platform.complete({ totalMs: Math.round(totalMs), score: totalScore });
      } catch (err) {
        ctx.platform.complete({ totalMs: Math.round(totalMs), score: totalScore, submitted: false });
      }
    }

    function handleTap(sx, sy) {
      if (phase !== "search") return;
      const w = screenToWorld(sx, sy);
      let best = null, bestD = Infinity;
      for (const c of chars) {
        const d = Math.hypot(c.x - w.x, c.y - w.y);
        if (d < c.r * 1.35 && d < bestD) { bestD = d; best = c; }
      }
      ctx.platform.interact({ type: "tap" });
      if (best && best.isWaldo) {
        win();
      } else {
        misses++;
        ripples.push({ x: w.x, y: w.y, t: perf, color: "#e8352e" });
        if (ctx.capabilities.haptics) ctx.platform.haptic("warning");
        sting("fail");
      }
    }

    // ---- input (pan / pinch / tap) ----------------------------------------
    const pointers = new Map();
    let panLast = null, pinch = null, downPos = null, downTime = 0, moved = 0, gestured = false;

    function firstGesture() {
      if (started) return;
      started = true;
      ctx.platform.start();
      startMusic();
      if (phase === "intro") startLevel(0);
    }

    ctx.listen(canvas, "pointerdown", (e) => {
      e.preventDefault();
      try { canvas.setPointerCapture && canvas.setPointerCapture(e.pointerId); } catch (_) {}
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      focus = null;
      if (pointers.size === 1) {
        panLast = { x: e.clientX, y: e.clientY };
        downPos = { x: e.clientX, y: e.clientY };
        downTime = perf; moved = 0; gestured = false;
      } else if (pointers.size === 2) {
        beginPinch();
        gestured = true;
      }
    }, { passive: false });

    ctx.listen(canvas, "pointermove", (e) => {
      if (!pointers.has(e.pointerId)) return;
      e.preventDefault();
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size >= 2) { updatePinch(); return; }
      if (panLast) {
        const dx = e.clientX - panLast.x, dy = e.clientY - panLast.y;
        moved += Math.hypot(dx, dy);
        cam.x -= dx / cam.scale; cam.y -= dy / cam.scale;
        clampCam();
        panLast = { x: e.clientX, y: e.clientY };
      }
    }, { passive: false });

    function endPointer(e) {
      if (!pointers.has(e.pointerId)) return;
      const wasTap = pointers.size === 1 && !gestured &&
        moved < 12 && perf - downTime < 450;
      pointers.delete(e.pointerId);
      if (pointers.size === 1) {
        // dropped from pinch to one finger — rebase pan, no tap
        const p = [...pointers.values()][0];
        panLast = { x: p.x, y: p.y };
        pinch = null; gestured = true;
      } else if (pointers.size === 0) {
        const wasStarted = started;
        firstGesture();
        if (wasStarted && wasTap && downPos) handleTap(downPos.x, downPos.y);
        panLast = null; pinch = null;
      }
    }
    ctx.listen(canvas, "pointerup", endPointer);
    ctx.listen(canvas, "pointercancel", endPointer);

    function twoPointers() { return [...pointers.values()]; }
    function beginPinch() {
      const [a, b] = twoPointers();
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      pinch = {
        dist: Math.hypot(a.x - b.x, a.y - b.y),
        scale: cam.scale,
        world: screenToWorld(mid.x, mid.y)
      };
    }
    function updatePinch() {
      if (!pinch) { beginPinch(); return; }
      const [a, b] = twoPointers();
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      cam.scale = clamp(pinch.scale * (dist / pinch.dist), fitScale, maxScale);
      // keep the world point that was under the pinch anchored to the fingers
      cam.x = pinch.world.x - (mid.x - ctx.width / 2) / cam.scale;
      cam.y = pinch.world.y - (mid.y - ctx.height / 2) / cam.scale;
      clampCam();
    }

    function zoomBy(factor) {
      focus = {
        x: cam.x, y: cam.y,
        scale: clamp(cam.scale * factor, fitScale, maxScale)
      };
      if (ctx.capabilities.haptics) ctx.platform.haptic("light");
      ctx.platform.interact({ type: "zoom" });
    }

    // ---- music -------------------------------------------------------------
    async function startMusic() {
      if (music || !ctx.capabilities.backgroundMusic) return;
      try {
        await ctx.music.unlock();
        music = await ctx.music.play({ preset: "bubble", volume: 0.4, fadeInMs: 900 });
      } catch (err) { ctx.platform.error({ where: "music", message: String(err) }); }
    }
    function sting(name) {
      if (!music) return;
      try { music.sting(name); } catch (e) {}
    }

    // ---- HUD ---------------------------------------------------------------
    const hud = {};
    function chip(label, aria, big) {
      const b = document.createElement("button");
      b.textContent = label;
      b.setAttribute("aria-label", aria);
      b.style.cssText =
        "pointer-events:auto;border:none;color:#f4f1ff;cursor:pointer;" +
        "font:700 " + (big ? "26px" : "17px") + "/1 -apple-system,system-ui,sans-serif;" +
        "width:" + (big ? "52px" : "44px") + ";height:" + (big ? "52px" : "44px") + ";" +
        "border-radius:16px;background:rgba(30,26,44,0.6);backdrop-filter:blur(9px);" +
        "-webkit-backdrop-filter:blur(9px);display:flex;align-items:center;" +
        "justify-content:center;touch-action:manipulation;box-shadow:0 3px 12px rgba(0,0,0,0.4);";
      return b;
    }

    // top bar: "Find" card + level + timer + help
    const top = document.createElement("div");
    top.style.cssText =
      "position:absolute;left:12px;right:12px;top:calc(" + ctx.safeArea.top + "px + 10px);" +
      "display:flex;align-items:flex-start;gap:10px;pointer-events:none;";
    ui.appendChild(top);

    // "Find this" card with a mini Pip drawn on an aux canvas
    const card = document.createElement("div");
    card.style.cssText =
      "display:flex;align-items:center;gap:8px;padding:7px 12px 7px 7px;" +
      "background:rgba(30,26,44,0.62);backdrop-filter:blur(9px);" +
      "-webkit-backdrop-filter:blur(9px);border-radius:16px;color:#f4f1ff;" +
      "font:700 14px/1.1 -apple-system,system-ui,sans-serif;box-shadow:0 3px 12px rgba(0,0,0,0.4);";
    // Mini Pip preview, drawn as inline SVG (no aux canvas needed).
    const PIP_SVG =
      '<svg viewBox="0 0 46 46" width="46" height="46" xmlns="http://www.w3.org/2000/svg">' +
      '<rect x="17" y="41" width="4" height="5" fill="#2b3a67"/>' +
      '<rect x="25" y="41" width="4" height="5" fill="#2b3a67"/>' +
      '<rect x="9" y="30" width="4.5" height="10" rx="2.2" fill="#e8352e"/>' +
      '<rect x="32" y="30" width="4.5" height="10" rx="2.2" fill="#e8352e"/>' +
      '<clipPath id="pipbod"><rect x="13.5" y="28.5" width="19" height="15" rx="4"/></clipPath>' +
      '<g clip-path="url(#pipbod)">' +
      '<rect x="13" y="28" width="20" height="16" fill="#e8352e"/>' +
      '<rect x="13" y="30.4" width="20" height="2.9" fill="#f7f7f7"/>' +
      '<rect x="13" y="36" width="20" height="2.9" fill="#f7f7f7"/>' +
      '<rect x="13" y="41.6" width="20" height="2.9" fill="#f7f7f7"/></g>' +
      '<circle cx="23" cy="19" r="7.5" fill="#f2c9a0"/>' +
      '<circle cx="19.4" cy="20" r="2.5" fill="none" stroke="#111" stroke-width="1.1"/>' +
      '<circle cx="26.6" cy="20" r="2.5" fill="none" stroke="#111" stroke-width="1.1"/>' +
      '<line x1="21.9" y1="20" x2="24.1" y2="20" stroke="#111" stroke-width="1.1"/>' +
      '<path d="M14.5 19 Q23 5 31.5 19 Z" fill="#e8352e"/>' +
      '<rect x="14" y="16.4" width="18" height="3" fill="#f7f7f7"/>' +
      '<circle cx="23" cy="7" r="2.4" fill="#f7f7f7"/></svg>';
    const icon = document.createElement("div");
    icon.style.cssText = "width:46px;height:46px;flex:0 0 auto;border-radius:12px;overflow:hidden;background:#f0dcb4;";
    icon.innerHTML = PIP_SVG;
    const cardLabel = document.createElement("div");
    cardLabel.innerHTML = "Find<br>Pip";
    card.append(icon, cardLabel);

    hud.level = document.createElement("div");
    hud.level.textContent = "Level 1/3";
    hud.timer = document.createElement("div");
    hud.timer.textContent = "0.0s";
    hud.timer.style.cssText = "font-size:22px;";
    const pill = document.createElement("div");
    pill.style.cssText =
      "display:flex;flex-direction:column;align-items:center;gap:1px;color:#f4f1ff;" +
      "font:700 14px/1.1 -apple-system,system-ui,sans-serif;padding:7px 16px;border-radius:16px;" +
      "background:rgba(30,26,44,0.6);backdrop-filter:blur(9px);-webkit-backdrop-filter:blur(9px);" +
      "box-shadow:0 3px 12px rgba(0,0,0,0.4);";
    pill.append(hud.level, hud.timer);
    const meta = document.createElement("div");
    meta.style.cssText = "flex:1;display:flex;justify-content:center;";
    meta.appendChild(pill);

    const help = chip("?", "How to play");
    ctx.listen(help, "click", () => toggleHelp());
    top.append(card, meta, help);

    // right-side zoom controls (kept off the bottom safe area)
    const zoomCol = document.createElement("div");
    zoomCol.style.cssText =
      "position:absolute;right:14px;top:50%;transform:translateY(-50%);" +
      "display:flex;flex-direction:column;gap:12px;pointer-events:none;";
    const zin = chip("+", "Zoom in", true);
    const zout = chip("−", "Zoom out", true);
    ctx.listen(zin, "click", () => zoomBy(1.6));
    ctx.listen(zout, "click", () => zoomBy(1 / 1.6));
    zoomCol.append(zin, zout);
    ui.appendChild(zoomCol);

    // result card overlay
    const overlay = document.createElement("div");
    overlay.style.cssText =
      "position:absolute;inset:0;display:none;align-items:center;justify-content:center;" +
      "padding:24px;pointer-events:auto;background:rgba(10,8,16,0.5);";
    ui.appendChild(overlay);
    function hideOverlay() { overlay.style.display = "none"; overlay.innerHTML = ""; }
    function showCard({ title, stars, lines, button, onButton }) {
      overlay.innerHTML = "";
      const box = document.createElement("div");
      box.style.cssText =
        "min-width:220px;max-width:320px;text-align:center;padding:24px;border-radius:22px;" +
        "background:rgba(28,24,42,0.92);color:#f4f1ff;box-shadow:0 12px 40px rgba(0,0,0,0.5);" +
        "font-family:-apple-system,system-ui,sans-serif;";
      box.innerHTML =
        '<div style="font-size:22px;font-weight:800;margin-bottom:8px;">' + title + "</div>" +
        (typeof stars === "number"
          ? '<div style="font-size:30px;margin-bottom:10px;letter-spacing:4px;">' +
            "⭐".repeat(stars) + '<span style="opacity:0.25;">' + "⭐".repeat(3 - stars) + "</span></div>"
          : "") +
        lines.map(l => '<div style="font-size:16px;opacity:0.9;margin:2px 0;">' + l + "</div>").join("");
      const btn = document.createElement("button");
      btn.textContent = button;
      btn.style.cssText =
        "margin-top:18px;pointer-events:auto;border:none;cursor:pointer;color:#1a1522;" +
        "background:#ffd23f;font:800 17px/1 -apple-system,system-ui,sans-serif;" +
        "padding:14px 26px;border-radius:14px;touch-action:manipulation;box-shadow:0 4px 14px rgba(0,0,0,0.4);";
      ctx.listen(btn, "click", () => { if (ctx.capabilities.haptics) ctx.platform.haptic("light"); onButton(); });
      box.appendChild(btn);
      overlay.appendChild(box);
      overlay.style.display = "flex";
    }

    // instructions panel
    const helpPanel = document.createElement("div");
    helpPanel.style.cssText =
      "position:absolute;inset:0;display:none;align-items:center;justify-content:center;" +
      "padding:26px;pointer-events:auto;background:rgba(10,8,16,0.72);" +
      "backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px);";
    helpPanel.innerHTML =
      '<div style="max-width:320px;color:#f4f1ff;font:400 16px/1.55 -apple-system,system-ui,sans-serif;">' +
      '<h2 style="font-size:22px;margin-bottom:14px;">How to play</h2>' +
      '<ul style="list-style:none;display:grid;gap:10px;">' +
      "<li>• Find <b>Pip</b> — red &amp; white striped hat, round glasses (see the card, top-left).</li>" +
      "<li>• <b>Drag</b> to move around the crowd.</li>" +
      "<li>• <b>Pinch</b> or use <b>+ / −</b> to zoom in and out.</li>" +
      "<li>• <b>Tap</b> Pip when you spot him.</li>" +
      "<li>• Faster finds earn more ⭐. Clear all three levels for the leaderboard.</li>" +
      "</ul>" +
      '<p style="margin-top:16px;opacity:0.7;">Tap anywhere to close.</p></div>';
    ui.appendChild(helpPanel);
    function toggleHelp() {
      helpPanel.style.display = helpPanel.style.display === "none" ? "flex" : "none";
    }
    ctx.listen(helpPanel, "click", () => (helpPanel.style.display = "none"));

    // ---- boot --------------------------------------------------------------
    let perf = 0;                         // running clock fed by onFrame timeMs
    buildLevel();                          // build level 1 immediately for a live first frame
    render(0);
    ctx.markVisualReady("first-scene");

    ctx.onFrame((dtMs, timeMs) => {
      perf = timeMs;

      if (timing) {
        levelMs += dtMs;
        hud.timer.textContent = fmt(levelMs);
      }

      // camera tween toward focus (zoom buttons + found reveal)
      if (focus) {
        const k = clamp(dtMs / 1000 * 7, 0, 1);
        cam.x = lerp(cam.x, focus.x, k);
        cam.y = lerp(cam.y, focus.y, k);
        cam.scale = lerp(cam.scale, focus.scale, k);
        clampCam();
        if (Math.abs(cam.scale - focus.scale) < 0.002 &&
            Math.abs(cam.x - focus.x) < 0.5 && Math.abs(cam.y - focus.y) < 0.5) {
          focus = null;
        }
      }

      render(timeMs);
    });

    ctx.platform.ready();
  }
};
