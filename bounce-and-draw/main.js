/**
 * Bounce & Draw — draw the walls, let the balls pay you.
 *
 * A ball falls from the top of a dark screen. Draw a line anywhere and it
 * becomes a solid bar the ball ricochets off, and every bounce pays. Spend what
 * you earn on a better ball — brighter, faster, worth more per hit — or on
 * another ball entirely, and the screen slowly fills with neon ricocheting off
 * whatever geometry you left lying around.
 *
 * The whole thing is one idea done honestly: a bounce is worth money, so the
 * game is building a machine that maximises bounces. A funnel. A staircase. A
 * long shallow ramp that keeps a ball skimming. There is no goal beyond the
 * number going up, which is the genre.
 *
 * Every stroke is a straight bar, not a freehand curve — press, drag to set the
 * far end, release. A hundred of them at once; the oldest falls off the end.
 *
 * Ported from a standalone Sekai build. The physics, the economy, the ball
 * colours and the drawing are the original's, unchanged. The shell was rebuilt
 * for plethora-bit@2, and a Peak Earnings leaderboard was added at the
 * repository owner's request.
 *
 * Icon geometry is lucide (ISC licence), inlined as SVG.
 */
window.plethoraBit = {
  meta: {
    title: "Bounce & Draw",
    runtime: "plethora-bit@2",
    tags: ["game", "physics", "idle", "drawing", "leaderboard"],
    permissions: ["audio", "backgroundMusic", "haptics", "storage"]
  },

  async init(ctx) {
    // ===================================================================== //
    // 0. Look — the palette the original shipped                            //
    // ===================================================================== //
    const BG_TOP = "#0a0a1a";
    const BG_BOTTOM = "#1a1a2e";
    const LINE_COLOUR = "#ff00ff";
    const INK = "#e8e8f0";
    const DIM = "#8b8ba7";
    const GOLD = "#ffd93d";
    const FONT = "Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif";

    // Shipped tune values.
    const GRAVITY = 0.4;
    const RESTITUTION = 0.9;
    const MONEY_PER_BOUNCE = 1;
    const BALL_RADIUS = 15;
    const LINE_WIDTH = 12;
    const MAX_LINES = 100;

    // Ball colour by upgrade level, cycling.
    const BALL_COLOURS = ["#00f3ff", "#39ff14", "#ffff00", "#ff00ff", "#ff0000", "#ff8800", "#ffffff"];

    const ICONS = {
      "circle-dollar-sign": '<circle cx="12" cy="12" r="10"/><path d="M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8"/><path d="M12 18V6"/>',
      "arrow-big-up-dash": '<path d="M14 16a1 1 0 0 0 1-1v-2a1 1 0 0 1 1-1h3.293a.707.707 0 0 0 .5-1.207l-6.939-6.939a1.207 1.207 0 0 0-1.708 0l-6.94 6.94a.707.707 0 0 0 .5 1.206H8a1 1 0 0 1 1 1v2a1 1 0 0 0 1 1z"/><path d="M9 20h6"/>',
      "plus": '<path d="M5 12h14"/><path d="M12 5v14"/>',
      "circle-x": '<circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/>',
      "music": '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
      "trophy": '<path d="M10 14.66V17a1 1 0 0 1-1 1 2 2 0 0 0-2 2v2"/><path d="M14 14.66V17a1 1 0 0 0 1 1 2 2 0 0 1 2 2v2"/><path d="M17.916 10H19.5A2.5 2.5 0 0 0 22 7.5V5a1 1 0 0 0-1-1h-3"/><path d="M4 22h16"/><path d="M6 9a6 6 0 0 0 12 0V3a1 1 0 0 0-1-1H7a1 1 0 0 0-1 1z"/><path d="M6.084 10H4.5A2.5 2.5 0 0 1 2 7.5V5a1 1 0 0 1 1-1h3"/>'
    };
    function svg(name, size, colour) {
      return '<svg viewBox="0 0 24 24" width="' + size + '" height="' + size + '" fill="none" ' +
        'stroke="' + colour + '" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" ' +
        'style="display:block;pointer-events:none;flex-shrink:0;">' + (ICONS[name] || "") + "</svg>";
    }

    // Plethora's own generative beds, standing in for the original's track list.
    const BEDS = [
      { id: "none", name: "Silence" },
      { id: "lofi", name: "Lo-fi" },
      { id: "synthwave", name: "Synthwave" },
      { id: "arcade", name: "Arcade" },
      { id: "chiptune", name: "Chiptune" },
      { id: "drift", name: "Drift" },
      { id: "techno", name: "Techno" },
      { id: "cozy", name: "Cozy" }
    ];

    const state = {
      money: 0,
      lifetime: 0,        // never spent down — this is what the board ranks
      peakSubmitted: 0,
      ballsCount: 1,
      ballLevel: 1,
      upgradeCost: 50,
      ballCost: 100,
      bed: "lofi"
    };

    let balls = [];
    let lines = [];
    let currentStroke = null;
    const particles = [];
    const floaters = [];

    // ===================================================================== //
    // 1. Surfaces                                                           //
    // ===================================================================== //
    const view = ctx.createCanvas2D({ touchAction: "none" });
    const g = view.getContext("2d");
    const ui = ctx.createRoot({ touchAction: "none" });
    ui.style.zIndex = "3";
    ui.style.pointerEvents = "none";

    const SAFE_T = Math.max((ctx.safeArea && ctx.safeArea.top) || 0, 8);
    const SAFE_B = Math.max((ctx.safeArea && ctx.safeArea.bottom) || 0, 10);

    let W = Math.max(1, ctx.width), H = Math.max(1, ctx.height);
    let sky = null;

    function layout() {
      W = Math.max(1, ctx.width);
      H = Math.max(1, ctx.height);
      const bw = Math.round(W * ctx.dpr), bh = Math.round(H * ctx.dpr);
      if (view.width !== bw || view.height !== bh) { view.width = bw; view.height = bh; }
      g.setTransform(ctx.dpr, 0, 0, ctx.dpr, 0, 0);
      sky = g.createLinearGradient(0, 0, 0, H);
      sky.addColorStop(0, BG_TOP);
      sky.addColorStop(1, BG_BOTTOM);
      top.style.top = SAFE_T + "px";
      shop.style.bottom = SAFE_B + "px";
    }

    const shopBtn = (el, icon, title, costEl) =>
      '<button data-el="' + el + '" style="pointer-events:auto;flex:1;display:flex;flex-direction:column;' +
      'align-items:center;justify-content:center;gap:3px;height:60px;border-radius:15px;border:0;' +
      'background:rgba(255,255,255,0.07);font-family:inherit;padding:0 6px;transition:background 150ms;">' +
      svg(icon, 17, INK) +
      '<span style="font-size:9.5px;font-weight:700;letter-spacing:0.5px;color:' + INK + ';' +
      'text-transform:uppercase;">' + title + "</span>" +
      '<span data-el="' + costEl + '" style="font-size:11px;font-weight:800;color:' + GOLD + ';">$0</span>' +
      "</button>";

    ui.innerHTML =
      '<div style="position:absolute;inset:0;font-family:' + FONT + ";color:" + INK + ";" +
      '-webkit-user-select:none;user-select:none;-webkit-tap-highlight-color:transparent;">' +

      // money + board
      '<div data-el="top" style="position:absolute;left:0;right:0;display:flex;align-items:center;' +
      'justify-content:space-between;padding:0 14px;">' +
        '<div data-el="badge" style="display:flex;align-items:center;gap:7px;background:rgba(0,0,0,0.5);' +
        'border:1px solid rgba(255,217,61,0.35);border-radius:20px;padding:8px 15px;' +
        'transition:transform 120ms ease;">' +
          svg("circle-dollar-sign", 17, GOLD) +
          '<span data-el="money" style="font-size:19px;font-weight:800;color:' + GOLD + ';' +
          'letter-spacing:-0.3px;">0</span>' +
        "</div>" +
        '<div style="display:flex;gap:7px;">' +
          '<button data-el="board_btn" style="pointer-events:auto;width:38px;height:38px;border-radius:19px;' +
          'border:0;background:rgba(255,255,255,0.08);display:flex;align-items:center;justify-content:center;' +
          'padding:0;">' + svg("trophy", 16, INK) + "</button>" +
          '<button data-el="music_btn" style="pointer-events:auto;width:38px;height:38px;border-radius:19px;' +
          'border:0;background:rgba(255,255,255,0.08);display:flex;align-items:center;justify-content:center;' +
          'padding:0;">' + svg("music", 16, INK) + "</button>" +
        "</div>" +
      "</div>" +

      // onboarding
      '<div data-el="hint" style="position:absolute;left:0;right:0;top:44%;text-align:center;' +
      'pointer-events:none;transition:opacity 400ms ease;padding:0 30px;">' +
        '<div style="font-size:17px;font-weight:700;">Draw a bar</div>' +
        '<div style="font-size:13px;color:' + DIM + ';margin-top:6px;line-height:1.5;">' +
        "press and drag to set its length.<br>every bounce pays.</div>" +
      "</div>" +

      // shop
      '<div data-el="shop" style="position:absolute;left:0;right:0;display:flex;gap:9px;padding:0 12px;' +
      'pointer-events:auto;">' +
        shopBtn("upgrade", "arrow-big-up-dash", "Upgrade", "cost_up") +
        shopBtn("buyball", "plus", "New ball", "cost_ball") +
        '<button data-el="clear" style="pointer-events:auto;flex:1;display:flex;flex-direction:column;' +
        'align-items:center;justify-content:center;gap:3px;height:60px;border-radius:15px;border:0;' +
        'background:rgba(255,255,255,0.07);font-family:inherit;">' + svg("circle-x", 17, INK) +
        '<span style="font-size:9.5px;font-weight:700;letter-spacing:0.5px;text-transform:uppercase;">' +
        "Clear</span></button>" +
      "</div>" +

      // sheets
      '<div data-el="sheet" style="position:absolute;inset:0;display:none;background:rgba(8,8,18,0.95);' +
      '-webkit-backdrop-filter:blur(10px);backdrop-filter:blur(10px);z-index:9;pointer-events:auto;' +
      'padding:26px 20px;overflow-y:auto;touch-action:pan-y;">' +
        '<div style="max-width:330px;margin:0 auto;">' +
          '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;">' +
            '<div data-el="sheet_title" style="font-size:18px;font-weight:800;">Leaderboard</div>' +
            '<button data-el="sheet_close" style="pointer-events:auto;width:34px;height:34px;' +
            'border-radius:17px;border:0;background:rgba(255,255,255,0.1);color:' + INK + ';' +
            'font-size:17px;padding:0;font-family:inherit;">×</button>' +
          "</div>" +
          '<div data-el="sheet_body"></div>' +
        "</div>" +
      "</div>" +
      "</div>";

    const nodes = {};
    for (const el of ui.querySelectorAll("[data-el]")) nodes[el.getAttribute("data-el")] = el;
    const top = nodes.top, shop = nodes.shop;

    // ===================================================================== //
    // 2. Sound                                                              //
    // ===================================================================== //
    // The original synthesised these itself and only played a file if one was
    // attached. The generators are carried over exactly; the files are gone, so
    // these three tones are the whole sound of the game — and they always were,
    // for anyone whose asset slots were empty.
    const Audio = {
      ac: null,
      init() {
        if (this.ac) return;
        const AC = window.AudioContext || window.webkitAudioContext;
        if (AC) this.ac = new AC();
      },
      tone(freq, type, duration, vol) {
        if (!this.ac) return;
        if (this.ac.state === "suspended") { try { this.ac.resume(); } catch (_) {} }
        const osc = this.ac.createOscillator();
        const gain = this.ac.createGain();
        osc.type = type;
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(vol, this.ac.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.0001, this.ac.currentTime + duration);
        osc.connect(gain);
        gain.connect(this.ac.destination);
        try { osc.start(); osc.stop(this.ac.currentTime + duration); } catch (_) {}
      },
      boing() { this.init(); this.tone(400, "sine", 0.3, 0.2); },
      coin() {
        this.init();
        this.tone(1200, "square", 0.1, 0.1);
        ctx.timeout(() => this.tone(1600, "square", 0.2, 0.1), 100);
      },
      upgrade() {
        this.init();
        this.tone(300, "triangle", 0.1, 0.2);
        ctx.timeout(() => this.tone(400, "triangle", 0.1, 0.2), 100);
        ctx.timeout(() => this.tone(600, "triangle", 0.3, 0.2), 200);
      },
      close() { if (this.ac) { try { this.ac.close(); } catch (_) {} } this.ac = null; }
    };

    let music = null;
    function setBed(id) {
      state.bed = id;
      if (!ctx.capabilities.backgroundMusic || !ctx.music) return;
      try {
        if (id === "none") { ctx.music.stop({ fadeOutMs: 400 }); music = null; return; }
        ctx.music.unlock();
        music = ctx.music.play({ preset: id, volume: 0.3, intensity: 0.45 });
      } catch (_) { music = null; }
    }

    // ===================================================================== //
    // 3. Balls and bars                                                     //
    // ===================================================================== //
    function ballColour() {
      return state.ballLevel > 1
        ? BALL_COLOURS[(state.ballLevel - 1) % BALL_COLOURS.length]
        : BALL_COLOURS[0];
    }

    function spawnBall(delay) {
      const push = () => balls.push({
        x: Math.random() * Math.max(1, W - 100) + 50,
        y: -50,
        vx: (Math.random() - 0.5) * 4,
        vy: 0,
        radius: BALL_RADIUS,
        colour: ballColour()
      });
      if (delay) ctx.timeout(push, delay); else push();
    }

    function distanceToSegment(p, v, w) {
      const l2 = (w.x - v.x) * (w.x - v.x) + (w.y - v.y) * (w.y - v.y);
      if (l2 === 0) {
        return { distSq: (p.x - v.x) * (p.x - v.x) + (p.y - v.y) * (p.y - v.y), cx: v.x, cy: v.y };
      }
      let t = ((p.x - v.x) * (w.x - v.x) + (p.y - v.y) * (w.y - v.y)) / l2;
      t = Math.max(0, Math.min(1, t));
      const cx = v.x + t * (w.x - v.x);
      const cy = v.y + t * (w.y - v.y);
      return { distSq: (p.x - cx) * (p.x - cx) + (p.y - cy) * (p.y - cy), cx: cx, cy: cy };
    }

    function addMoney(amount) {
      state.money += amount;
      state.lifetime += amount;
      nodes.money.textContent = state.money;
      nodes.badge.style.transform = "scale(1.06)";
      ctx.timeout(() => { nodes.badge.style.transform = ""; }, 130);
      paintShop();
      remember();
      submitPeak();
    }

    function checkCollisions() {
      // Cap velocity so a fast ball cannot tunnel through a thin bar.
      const level = state.ballLevel;
      const maxV = Math.min(BALL_RADIUS * 1.5, BALL_RADIUS * (0.9 + level * 0.05));

      for (let i = 0; i < balls.length; i++) {
        const b = balls[i];

        if (b.x - b.radius < 0) { b.x = b.radius; b.vx *= -0.8; }
        else if (b.x + b.radius > W) { b.x = W - b.radius; b.vx *= -0.8; }

        if (b.y > H + 100) {
          balls.splice(i, 1);
          i--;
          spawnBall(500);
          continue;
        }

        if (Math.abs(b.vx) > maxV) b.vx = Math.sign(b.vx) * maxV;
        if (Math.abs(b.vy) > maxV) b.vy = Math.sign(b.vy) * maxV;

        let bounced = false;
        const minDist = b.radius + LINE_WIDTH / 2;
        for (const stroke of lines) {
          for (let j = 0; j < stroke.length - 1; j++) {
            const d = distanceToSegment(b, stroke[j], stroke[j + 1]);
            if (d.distSq >= minDist * minDist) continue;

            let dist = Math.sqrt(d.distSq);
            if (dist <= 0) dist = 0.001;
            const nx = (b.x - d.cx) / dist;
            const ny = (b.y - d.cy) / dist;

            const overlap = minDist - dist;
            b.x += nx * overlap;
            b.y += ny * overlap;

            const dot = b.vx * nx + b.vy * ny;
            if (dot < 0) {
              b.vx = b.vx - (1 + RESTITUTION) * dot * nx;
              b.vy = b.vy - (1 + RESTITUTION) * dot * ny;
              // A nudge, so a ball cannot settle into a perfect repeating orbit.
              const speedMult = 1 + level * 0.1;
              b.vx += (Math.random() - 0.5) * 1.5 * speedMult;
              b.vy -= 1 * speedMult;
              bounced = true;
            }
          }
        }

        if (bounced) {
          ctx.platform.haptic("light");
          spawnParticles(b.x, b.y + b.radius, b.colour);
          const earning = MONEY_PER_BOUNCE * level;
          addMoney(earning);
          floaters.push({ x: b.x, y: b.y - b.radius, life: 1, text: "+$" + earning });
          Audio.boing();
        }
      }
    }

    function spawnParticles(x, y, colour) {
      for (let i = 0; i < 6; i++) {
        const a = Math.random() * Math.PI * 2;
        const sp = Math.random() * 3 + 1;
        particles.push({
          x: x, y: y,
          vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
          life: 1, colour: colour
        });
      }
    }

    // ===================================================================== //
    // 4. Drawing it                                                         //
    // ===================================================================== //
    function render(dt) {
      g.fillStyle = sky;
      g.fillRect(0, 0, W, H);

      // the aura grows with your ball level
      const auraScale = Math.min(2.5, (state.ballLevel - 1) * 0.3);
      if (auraScale > 0) {
        const r = Math.max(W, H) * 0.35 * (0.6 + auraScale * 0.4);
        const aura = g.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, r);
        aura.addColorStop(0, "rgba(120,60,220,0.20)");
        aura.addColorStop(1, "rgba(120,60,220,0)");
        g.fillStyle = aura;
        g.fillRect(0, 0, W, H);
      }

      g.lineCap = "round";
      g.lineJoin = "round";
      g.lineWidth = LINE_WIDTH;
      g.strokeStyle = LINE_COLOUR;
      g.shadowColor = LINE_COLOUR;
      for (const stroke of lines) {
        if (stroke.length < 2) continue;
        g.shadowBlur = 12;
        g.beginPath();
        g.moveTo(stroke[0].x, stroke[0].y);
        for (let j = 1; j < stroke.length; j++) g.lineTo(stroke[j].x, stroke[j].y);
        g.stroke();
      }
      g.shadowBlur = 0;

      for (const b of balls) {
        g.beginPath();
        g.arc(b.x, b.y, b.radius, 0, Math.PI * 2);
        g.fillStyle = b.colour;
        g.shadowColor = b.colour;
        g.shadowBlur = 15;
        g.fill();
        g.shadowBlur = 0;

        const grad = g.createRadialGradient(
          b.x - b.radius * 0.3, b.y - b.radius * 0.3, b.radius * 0.1, b.x, b.y, b.radius);
        grad.addColorStop(0, "rgba(255,255,255,0.8)");
        grad.addColorStop(1, "rgba(255,255,255,0)");
        g.fillStyle = grad;
        g.fill();

        g.lineWidth = 2;
        g.strokeStyle = "rgba(255,255,255,0.9)";
        g.stroke();
        g.lineWidth = LINE_WIDTH;
      }

      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.x += p.vx; p.y += p.vy; p.life -= 0.05;
        if (p.life <= 0) { particles.splice(i, 1); continue; }
        g.globalAlpha = p.life;
        g.fillStyle = p.colour;
        g.beginPath();
        g.arc(p.x, p.y, p.life * 5 + 2, 0, Math.PI * 2);
        g.fill();
      }
      g.globalAlpha = 1;

      g.textAlign = "center";
      g.font = "700 15px " + FONT;
      for (let i = floaters.length - 1; i >= 0; i--) {
        const f = floaters[i];
        f.y -= 1.1;
        f.life -= 0.02;
        if (f.life <= 0) { floaters.splice(i, 1); continue; }
        g.globalAlpha = Math.max(0, f.life);
        g.fillStyle = GOLD;
        g.fillText(f.text, f.x, f.y);
      }
      g.globalAlpha = 1;
    }

    // ===================================================================== //
    // 5. Shop                                                               //
    // ===================================================================== //
    function paintShop() {
      nodes.money.textContent = state.money;
      nodes.cost_up.textContent = "$" + state.upgradeCost;
      nodes.cost_ball.textContent = "$" + state.ballCost;
      const affordUp = state.money >= state.upgradeCost;
      const affordBall = state.money >= state.ballCost;
      nodes.upgrade.style.background = affordUp ? "rgba(255,217,61,0.18)" : "rgba(255,255,255,0.07)";
      nodes.upgrade.style.opacity = affordUp ? "1" : "0.55";
      nodes.buyball.style.background = affordBall ? "rgba(255,217,61,0.18)" : "rgba(255,255,255,0.07)";
      nodes.buyball.style.opacity = affordBall ? "1" : "0.55";
    }

    function doUpgrade() {
      if (state.money < state.upgradeCost) return;
      state.money -= state.upgradeCost;
      state.ballLevel += 1;
      state.upgradeCost = Math.floor(state.upgradeCost * 2.2);
      const c = ballColour();
      for (const b of balls) b.colour = c;
      Audio.upgrade();
      ctx.platform.haptic("medium");
      ctx.platform.interact({ kind: "upgrade", level: state.ballLevel });
      ctx.platform.milestone("ball_level_" + state.ballLevel);
      paintShop();
      remember();
    }

    function doBuyBall() {
      if (state.money < state.ballCost) return;
      state.money -= state.ballCost;
      state.ballsCount += 1;
      state.ballCost = Math.floor(state.ballCost * 2.5);
      spawnBall(0);
      Audio.upgrade();
      ctx.platform.haptic("medium");
      ctx.platform.interact({ kind: "buy_ball", balls: state.ballsCount });
      paintShop();
      remember();
    }

    // ===================================================================== //
    // 6. Board and music                                                    //
    // ===================================================================== //
    const records = ctx.memory && ctx.memory.record ? ctx.memory.record("earnings") : null;

    // Lifetime earnings only ever climb, so the board is submitted as it grows
    // rather than at some end that never comes. Throttled to whole hundreds so
    // an idle game does not hammer the channel on every bounce.
    let submitting = false;
    function submitPeak() {
      if (!records || submitting) return;
      if (state.lifetime < state.peakSubmitted + 100) return;
      submitting = true;
      state.peakSubmitted = state.lifetime;
      Promise.resolve(records.submit(state.lifetime, { label: "$" + state.lifetime }))
        .catch(() => {})
        .then(() => { submitting = false; });
    }

    function openSheet(title, html) {
      nodes.sheet_title.textContent = title;
      nodes.sheet_body.innerHTML = html;
      nodes.sheet.style.display = "block";
    }

    async function showBoard() {
      openSheet("Peak Earnings",
        '<div style="color:' + DIM + ';padding:18px 0;text-align:center;">Loading…</div>');
      if (!records) {
        nodes.sheet_body.innerHTML = '<div style="color:' + DIM +
          ';padding:18px 0;text-align:center;">No leaderboard here.</div>';
        return;
      }
      try {
        const data = await records.leaderboard();
        const entries = (data && data.entries) || [];
        if (!entries.length) {
          nodes.sheet_body.innerHTML = '<div style="color:' + DIM +
            ';padding:18px 0;text-align:center;">Nobody has earned anything yet.<br>' +
            "Go bounce something.</div>";
          return;
        }
        let html = "";
        for (const e of entries) {
          const rank = e.rank || 0;
          const medal = rank === 1 ? "#ffd93d" : rank === 2 ? "#d1d5db" : rank === 3 ? "#d97706"
            : "rgba(255,255,255,0.12)";
          const fg = rank <= 3 ? "#111827" : INK;
          html += '<div style="display:flex;align-items:center;gap:11px;padding:9px 0;' +
            'border-bottom:1px solid rgba(255,255,255,0.07);">' +
            '<div style="width:26px;height:26px;border-radius:13px;background:' + medal + ";color:" + fg +
            ';display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:800;' +
            'flex-shrink:0;">' + rank + "</div>" +
            '<div style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;' +
            (e.self ? "font-weight:700;color:" + GOLD + ";" : "") + '">' +
            ((e.user && e.user.handle) || "someone") + (e.self ? " (you)" : "") + "</div>" +
            '<div style="font-weight:800;color:' + GOLD + ';">' + (e.label || ("$" + e.value)) + "</div>" +
            "</div>";
        }
        nodes.sheet_body.innerHTML = html;
      } catch (_) {
        nodes.sheet_body.innerHTML = '<div style="color:#fca5a5;padding:18px 0;text-align:center;">' +
          "Could not reach the leaderboard.</div>";
      }
    }

    function showMusic() {
      let html = '<div style="font-size:12px;color:' + DIM + ';margin-bottom:12px;line-height:1.5;">' +
        "The original's twelve tracks could not come across — a bit cannot package audio. " +
        "These are Plethora's own generative beds instead.</div>";
      for (const b of BEDS) {
        const on = b.id === state.bed;
        html += '<button data-bed="' + b.id + '" style="pointer-events:auto;width:100%;text-align:left;' +
          "height:46px;border-radius:12px;border:1px solid " +
          (on ? "rgba(255,217,61,0.5)" : "rgba(255,255,255,0.08)") + ";" +
          "background:" + (on ? "rgba(255,217,61,0.14)" : "rgba(255,255,255,0.05)") + ";" +
          "color:" + (on ? GOLD : INK) + ';font-family:inherit;font-size:14px;font-weight:600;' +
          'padding:0 15px;margin-bottom:7px;display:flex;align-items:center;justify-content:space-between;">' +
          "<span>" + b.name + "</span>" + (on ? "<span>playing</span>" : "") + "</button>";
      }
      openSheet("Music", html);
      for (const btn of nodes.sheet_body.querySelectorAll("[data-bed]")) {
        ctx.listen(btn, "pointerdown", (e) => {
          e.preventDefault();
          setBed(btn.getAttribute("data-bed"));
          remember();
          showMusic();
          ctx.platform.haptic("light");
        });
      }
    }

    // ===================================================================== //
    // 7. Hands on it                                                        //
    // ===================================================================== //
    let started = false;
    function firstGesture() {
      if (started) return;
      started = true;
      Audio.init();
      ctx.platform.start();
      nodes.hint.style.opacity = "0";
      setBed(state.bed);
    }

    ctx.listen(view, "pointerdown", (e) => {
      firstGesture();
      if (view.setPointerCapture) { try { view.setPointerCapture(e.pointerId); } catch (_) {} }
      const p = { x: e.offsetX, y: e.offsetY };
      // A stroke is a straight bar: both ends start together, the far end
      // follows the finger.
      currentStroke = [p, { x: p.x, y: p.y }];
      lines.push(currentStroke);
      if (lines.length > MAX_LINES) lines.shift();
    });

    ctx.listen(view, "pointermove", (e) => {
      if (!currentStroke) return;
      currentStroke[1].x = e.offsetX;
      currentStroke[1].y = e.offsetY;
    });

    const endStroke = () => { currentStroke = null; };
    ctx.listen(view, "pointerup", endStroke);
    ctx.listen(view, "pointercancel", endStroke);
    ctx.listen(view, "lostpointercapture", endStroke);

    const tap = (el, fn) => ctx.listen(el, "pointerdown", (e) => { e.preventDefault(); firstGesture(); fn(); });
    tap(nodes.upgrade, doUpgrade);
    tap(nodes.buyball, doBuyBall);
    tap(nodes.clear, () => { lines.length = 0; ctx.platform.haptic("light"); });
    tap(nodes.board_btn, showBoard);
    tap(nodes.music_btn, showMusic);
    ctx.listen(nodes.sheet_close, "pointerdown", (e) => {
      e.preventDefault();
      nodes.sheet.style.display = "none";
    });

    // ===================================================================== //
    // 8. Remembering                                                        //
    // ===================================================================== //
    function fireAndForget(thunk) {
      try {
        const r = thunk();
        if (r && typeof r.catch === "function") r.catch(() => {});
      } catch (err) { /* not supported on this runtime */ }
    }
    const canStore = !!(ctx.capabilities && ctx.capabilities.storage && ctx.storage);
    let saveTimer = 0;
    function remember() {
      if (!canStore || saveTimer) return;
      saveTimer = ctx.timeout(() => {
        saveTimer = 0;
        fireAndForget(() => ctx.storage.set("bounce", {
          money: state.money, lifetime: state.lifetime, ballsCount: state.ballsCount,
          ballLevel: state.ballLevel, upgradeCost: state.upgradeCost,
          ballCost: state.ballCost, bed: state.bed
        }));
      }, 700);
    }
    if (canStore) {
      try {
        const s = await ctx.storage.get("bounce");
        if (s && typeof s === "object") {
          if (typeof s.money === "number") state.money = s.money;
          if (typeof s.lifetime === "number") state.lifetime = s.lifetime;
          if (typeof s.ballsCount === "number") state.ballsCount = Math.max(1, s.ballsCount);
          if (typeof s.ballLevel === "number") state.ballLevel = Math.max(1, s.ballLevel);
          if (typeof s.upgradeCost === "number") state.upgradeCost = s.upgradeCost;
          if (typeof s.ballCost === "number") state.ballCost = s.ballCost;
          if (BEDS.some((b) => b.id === s.bed)) state.bed = s.bed;
          state.peakSubmitted = state.lifetime;
        }
      } catch (_) { /* first run */ }
    }

    // ===================================================================== //
    // 9. Go                                                                 //
    // ===================================================================== //
    ctx.onDestroy(() => {
      Audio.close();
      try { ctx.music.stop({ fadeOutMs: 300 }); } catch (_) {}
    });

    layout();
    paintShop();
    for (let i = 0; i < state.ballsCount; i++) spawnBall(i * 500);
    render(16);
    ctx.markVisualReady("field drawn");
    ctx.platform.ready();

    ctx.onFrame((dt) => {
      if (ctx.width !== W || ctx.height !== H) layout();
      // The original stepped per frame and clamped a huge stutter to one frame.
      const k = Math.min(3, (dt > 100 ? 16 : dt) / (1000 / 60));
      for (const b of balls) {
        b.vy += GRAVITY * k;
        b.x += b.vx * k;
        b.y += b.vy * k;
      }
      checkCollisions();
      render(dt);
    });
  }
};
