/**
 * Boss Simulator — you are the boss, and the computer is dodging.
 *
 * The usual arrangement, inverted. A target moves inside a white box and tries
 * very hard to stay alive; you have nine attacks along the bottom and sixty
 * seconds to take a thousand hit points off it. No cooldowns. Press whatever
 * you like as fast as you like.
 *
 * What makes it a game rather than a button-masher is that the target is
 * genuinely good. Every frame it scores sixteen directions for danger — walls,
 * every projectile in flight and where that projectile will be fifteen frames
 * from now, the footprint of any telegraphed zone, plus a slight pull toward
 * the middle so it does not hug a wall forever — and walks down the steepest
 * gradient it can find. Fire one bone at it and it simply steps aside. You have
 * to close the exits: a wave to herd it, a void to take half the arena away, a
 * freeze to pin it, and then something heavy while it cannot move.
 *
 * Ported from a standalone Sekai build. The dodging AI, all nine attacks, the
 * damage numbers and the sixty-second limit are the original's, unchanged. The
 * art is not — see "Divergence" in the README. A Fastest Clear leaderboard was
 * added at the repository owner's request.
 */
window.plethoraBit = {
  meta: {
    title: "Boss Simulator",
    runtime: "plethora-bit@2",
    tags: ["game", "action", "arcade", "leaderboard", "boss"],
    permissions: ["audio", "haptics", "storage"]
  },

  async init(ctx) {
    // ===================================================================== //
    // 0. Look                                                               //
    // ===================================================================== //
    const BG = "#000000";
    const BOX = "#ffffff";
    const TARGET = "#ff0000";      // the original's heart colour
    const BONE = "#ffffff";
    const VOID_C = "#7c3aed";
    const BEAM = "#e0f2fe";
    const FREEZE_C = "#38bdf8";
    const GRAB_C = "#f472b6";
    const INK = "#f4f4f5";
    const DIM = "#71717a";
    const FONT = "Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif";

    // Shipped tune values.
    const TIME_LIMIT = 60;
    const BOT_SPEED = 8.0;
    const MAX_HP = 1000;
    const PAD_H = 132;             // the attack keypad along the bottom

    const ABILITIES = [
      { id: "bone", name: "Bone", hint: "one fast shot" },
      { id: "wave", name: "Wave", hint: "wall, gap on it" },
      { id: "void", name: "Void", hint: "half the arena" },
      { id: "swarm", name: "Swarm", hint: "16 outward" },
      { id: "blaster", name: "Beam", hint: "vertical, aimed" },
      { id: "twowaves", name: "Pincer", hint: "both sides" },
      { id: "freeze", name: "Freeze", hint: "pins it 1.5s" },
      { id: "grab", name: "Grab", hint: "drags to centre" },
      { id: "crusher", name: "Crush", hint: "walls close in" }
    ];

    const state = {
      status: "ready",              // ready | playing | won | lost
      timeRemaining: TIME_LIMIT,
      elapsed: 0,
      box: { x: 0, y: 0, w: 1, h: 1 },
      bot: { x: 0, y: 0, size: 16, hp: MAX_HP, frozenTimer: 0, grabbedTimer: 0, invulnTimer: 0 },
      attacks: [],
      best: 0,
      shake: 0
    };

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

    function layout() {
      W = Math.max(1, ctx.width);
      H = Math.max(1, ctx.height);
      const bw = Math.round(W * ctx.dpr), bh = Math.round(H * ctx.dpr);
      if (view.width !== bw || view.height !== bh) { view.width = bw; view.height = bh; }
      g.setTransform(ctx.dpr, 0, 0, ctx.dpr, 0, 0);

      const top = SAFE_T + 66;
      const bottom = H - SAFE_B - PAD_H - 12;
      state.box.x = 22;
      state.box.w = Math.max(60, W - 44);
      state.box.y = top;
      state.box.h = Math.max(80, bottom - top);

      hud.style.top = SAFE_T + "px";
      pad.style.bottom = SAFE_B + "px";
      clampBot();
    }

    let padHtml = "";
    for (const a of ABILITIES) {
      padHtml +=
        '<button data-ab="' + a.id + '" style="pointer-events:auto;display:flex;flex-direction:column;' +
        'align-items:center;justify-content:center;gap:1px;height:40px;border-radius:9px;border:0;' +
        'background:rgba(255,255,255,0.09);font-family:inherit;padding:0 3px;overflow:hidden;' +
        'touch-action:manipulation;">' +
        '<span style="font-size:11px;font-weight:800;color:' + INK + ';letter-spacing:0.3px;">' +
        a.name + "</span>" +
        '<span style="font-size:7.5px;color:' + DIM + ';white-space:nowrap;">' + a.hint + "</span>" +
        "</button>";
    }

    ui.innerHTML =
      '<div style="position:absolute;inset:0;font-family:' + FONT + ";color:" + INK + ";" +
      '-webkit-user-select:none;user-select:none;-webkit-tap-highlight-color:transparent;">' +

      '<div data-el="hud" style="position:absolute;left:0;right:0;padding:0 22px;">' +
        '<div style="display:flex;align-items:baseline;justify-content:space-between;margin-bottom:6px;">' +
          '<div style="font-size:11px;letter-spacing:2px;text-transform:uppercase;color:' + DIM + ';">' +
          "Target</div>" +
          '<div data-el="timer" style="font-size:20px;font-weight:800;letter-spacing:-0.5px;">60.0</div>' +
        "</div>" +
        '<div style="height:9px;border-radius:5px;background:rgba(255,255,255,0.13);overflow:hidden;">' +
          '<div data-el="hpbar" style="height:100%;width:100%;background:' + TARGET + ";" +
          'transition:width 90ms linear;"></div>' +
        "</div>" +
        '<div data-el="hptext" style="font-size:10.5px;color:' + DIM + ';margin-top:4px;">1000 / 1000</div>' +
      "</div>" +

      '<div data-el="pad" style="position:absolute;left:0;right:0;padding:0 12px;display:grid;' +
      'grid-template-columns:repeat(3,1fr);gap:7px;pointer-events:auto;">' + padHtml + "</div>" +

      // start / end curtain
      '<div data-el="curtain" style="position:absolute;inset:0;display:flex;align-items:center;' +
      'justify-content:center;background:rgba(0,0,0,0.88);z-index:9;pointer-events:auto;padding:26px;">' +
        '<div style="text-align:center;max-width:320px;width:100%;">' +
          '<div data-el="title" style="font-size:27px;font-weight:800;letter-spacing:-0.5px;">' +
          "Boss Simulator</div>" +
          '<div data-el="blurb" style="font-size:13.5px;color:#a1a1aa;line-height:1.6;margin:12px 0 20px;">' +
          "You are the boss. Sixty seconds to take a thousand points off a target " +
          "that dodges properly.<br><br>One attack will not do it. Corner it.</div>" +
          '<div data-el="board" style="text-align:left;margin-bottom:18px;"></div>' +
          '<button data-el="go" style="pointer-events:auto;width:100%;height:54px;border-radius:27px;' +
          'border:0;background:' + TARGET + ';color:#fff;font-size:16px;font-weight:800;' +
          'font-family:inherit;letter-spacing:1px;">BEGIN</button>' +
          '<button data-el="showboard" style="pointer-events:auto;width:100%;height:44px;border-radius:22px;' +
          'border:0;background:rgba(255,255,255,0.09);color:' + INK + ';font-size:13px;font-weight:700;' +
          'font-family:inherit;margin-top:9px;">Leaderboard</button>' +
        "</div>" +
      "</div>" +
      "</div>";

    const nodes = {};
    for (const el of ui.querySelectorAll("[data-el]")) nodes[el.getAttribute("data-el")] = el;
    const hud = nodes.hud, pad = nodes.pad;

    // ===================================================================== //
    // 2. Sound — all of it synthesised                                      //
    // ===================================================================== //
    // The original had five sound files with a procedural fallback for some.
    // None could travel, so every noise here is generated: a short noise burst
    // for a bone, a descending sweep for the heavy attacks, a click on a hit.
    const Audio = {
      ac: null,
      init() {
        if (this.ac) return;
        const AC = window.AudioContext || window.webkitAudioContext;
        if (AC) this.ac = new AC();
      },
      noise(duration, hp, vol) {
        if (!this.ac) return;
        const n = Math.floor(this.ac.sampleRate * duration);
        const buf = this.ac.createBuffer(1, n, this.ac.sampleRate);
        const d = buf.getChannelData(0);
        for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
        const src = this.ac.createBufferSource();
        src.buffer = buf;
        const f = this.ac.createBiquadFilter();
        f.type = "highpass";
        f.frequency.value = hp;
        const gn = this.ac.createGain();
        gn.gain.value = vol;
        src.connect(f); f.connect(gn); gn.connect(this.ac.destination);
        try { src.start(); } catch (_) {}
      },
      sweep(from, to, duration, type, vol) {
        if (!this.ac) return;
        const t = this.ac.currentTime;
        const osc = this.ac.createOscillator();
        const gn = this.ac.createGain();
        osc.type = type;
        osc.frequency.setValueAtTime(from, t);
        osc.frequency.exponentialRampToValueAtTime(Math.max(1, to), t + duration);
        gn.gain.setValueAtTime(vol, t);
        gn.gain.exponentialRampToValueAtTime(0.0001, t + duration);
        osc.connect(gn); gn.connect(this.ac.destination);
        try { osc.start(t); osc.stop(t + duration); } catch (_) {}
      },
      bone() { this.init(); this.noise(0.09, 1800, 0.10); },
      heavy() { this.init(); this.sweep(320, 40, 0.42, "sawtooth", 0.14); },
      hit() { this.init(); this.noise(0.05, 900, 0.07); },
      win() {
        this.init();
        this.sweep(440, 880, 0.18, "square", 0.12);
        ctx.timeout(() => this.sweep(660, 1320, 0.3, "square", 0.12), 170);
      },
      lose() { this.init(); this.sweep(240, 60, 0.8, "triangle", 0.14); },
      close() { if (this.ac) { try { this.ac.close(); } catch (_) {} } this.ac = null; }
    };

    // ===================================================================== //
    // 3. The nine attacks — patterns exactly as the original had them        //
    // ===================================================================== //
    function useAbility(type) {
      if (state.status !== "playing") return;
      // A hard cap, so a mashed button cannot bury the frame rate.
      if (state.attacks.length > 400) return;

      const b = state.box;
      const bot = state.bot;

      if (type === "bone") {
        Audio.bone();
        const edge = Math.floor(Math.random() * 4);
        let sx, sy;
        if (edge === 0) { sx = b.x + Math.random() * b.w; sy = b.y - 20; }
        else if (edge === 1) { sx = b.x + b.w + 20; sy = b.y + Math.random() * b.h; }
        else if (edge === 2) { sx = b.x + Math.random() * b.w; sy = b.y + b.h + 20; }
        else { sx = b.x - 20; sy = b.y + Math.random() * b.h; }
        const angle = Math.atan2(bot.y - sy, bot.x - sx);
        state.attacks.push({
          type: "bone", x: sx, y: sy, w: 10, h: 10,
          vx: Math.cos(angle) * 8, vy: Math.sin(angle) * 8, dmg: 2, active: true
        });
      } else if (type === "wave") {
        Audio.bone();
        // A wall with the gap left exactly where the target is standing — so it
        // only works if you make it move first.
        const gapY = bot.y;
        for (let yy = b.y; yy < b.y + b.h; yy += 25) {
          if (Math.abs(yy - gapY) > 35) {
            state.attacks.push({
              type: "bone", x: b.x + b.w + 20, y: yy, w: 10, h: 40,
              vx: -4, vy: 0, dmg: 3, active: true
            });
          }
        }
      } else if (type === "void") {
        Audio.heavy();
        const vertical = Math.random() > 0.5;
        const firstHalf = Math.random() > 0.5;
        const r = vertical
          ? { x: firstHalf ? b.x : b.x + b.w / 2, y: b.y, w: b.w / 2, h: b.h }
          : { x: b.x, y: firstHalf ? b.y : b.y + b.h / 2, w: b.w, h: b.h / 2 };
        state.attacks.push({
          type: "void", x: r.x, y: r.y, w: r.w, h: r.h,
          dmg: 4, active: false, warning: 0.8, lifetime: 0.3
        });
      } else if (type === "swarm") {
        Audio.bone();
        const count = 16;
        for (let i = 0; i < count; i++) {
          const angle = (Math.PI * 2 / count) * i;
          const speed = 4 + Math.random() * 4;
          state.attacks.push({
            type: "bone", x: b.x + b.w / 2, y: b.y + b.h / 2, w: 12, h: 12,
            vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, dmg: 2, active: true
          });
        }
      } else if (type === "blaster") {
        Audio.heavy();
        state.attacks.push({
          type: "blaster", x: bot.x - 40, y: bot.y - 150, w: 80, h: 80,
          targetX: bot.x, targetY: bot.y,
          dmg: 8, active: false, warning: 0.3, lifetime: 0.4
        });
      } else if (type === "twowaves") {
        Audio.bone();
        const gap1 = b.y + b.h * (Math.random() * 0.4 + 0.1);
        const gap2 = b.y + b.h * (Math.random() * 0.4 + 0.5);
        for (let yy = b.y; yy < b.y + b.h; yy += 25) {
          if (Math.abs(yy - gap1) > 40) {
            state.attacks.push({ type: "bone", x: b.x - 20, y: yy, w: 10, h: 40, vx: 6, vy: 0, dmg: 3, active: true });
          }
          if (Math.abs(yy - gap2) > 40) {
            state.attacks.push({ type: "bone", x: b.x + b.w + 20, y: yy, w: 10, h: 40, vx: -6, vy: 0, dmg: 3, active: true });
          }
        }
      } else if (type === "freeze") {
        Audio.heavy();
        const angle = Math.atan2(bot.y - (b.y - 50), bot.x - (b.x + b.w / 2));
        state.attacks.push({
          type: "freeze", x: b.x + b.w / 2, y: b.y - 50, w: 30, h: 30,
          vx: Math.cos(angle) * 12, vy: Math.sin(angle) * 12, dmg: 2, active: true, effect: "freeze"
        });
      } else if (type === "grab") {
        Audio.heavy();
        const angle = Math.atan2(bot.y - (b.y + b.h + 50), bot.x - (b.x + b.w / 2));
        state.attacks.push({
          type: "grab", x: b.x + b.w / 2, y: b.y + b.h + 50, w: 30, h: 30,
          vx: Math.cos(angle) * 12, vy: Math.sin(angle) * 12, dmg: 2, active: true, effect: "grab"
        });
      } else if (type === "crusher") {
        Audio.heavy();
        state.attacks.push({
          type: "crusher", dmg: 20, active: false,
          warning: 0.8, lifetime: 0.5, maxLifetime: 0.5, effect: "crush"
        });
      }
    }

    // ===================================================================== //
    // 4. The target's dodging — carried over line for line                   //
    // ===================================================================== //
    function clampBot() {
      const b = state.bot, box = state.box;
      b.x = Math.max(box.x + b.size / 2, Math.min(b.x, box.x + box.w - b.size / 2));
      b.y = Math.max(box.y + b.size / 2, Math.min(b.y, box.y + box.h - b.size / 2));
    }

    function evaluatePos(tx, ty) {
      const b = state.bot, box = state.box;
      let danger = 0;

      if (tx < box.x + b.size / 2) danger += 1000 * (box.x + b.size / 2 - tx);
      if (tx > box.x + box.w - b.size / 2) danger += 1000 * (tx - (box.x + box.w - b.size / 2));
      if (ty < box.y + b.size / 2) danger += 1000 * (box.y + b.size / 2 - ty);
      if (ty > box.y + box.h - b.size / 2) danger += 1000 * (ty - (box.y + box.h - b.size / 2));

      for (const att of state.attacks) {
        const ax = att.x + (att.w || 0) / 2;
        const ay = att.y + (att.h || 0) / 2;
        const dist = Math.hypot(tx - ax, ty - ay);

        if (att.type === "void" || att.type === "blaster" || att.type === "crusher") {
          let inZone = false;
          if (att.type === "void") {
            inZone = tx > att.x - 10 && tx < att.x + att.w + 10 && ty > att.y - 10 && ty < att.y + att.h + 10;
          } else if (att.type === "blaster") {
            inZone = Math.abs(tx - att.targetX) < 40;
          } else if (att.type === "crusher") {
            const progress = att.active ? Math.pow(1 - att.lifetime / att.maxLifetime, 2) : 0;
            const left = box.x + (box.w / 2 * progress) + 40;
            const right = (box.x + box.w) - (box.w / 2 * progress) - 40;
            inZone = tx < left || tx > right;
          }
          if ((att.warning > 0 || att.active) && inZone) {
            danger += 25000 / (Math.max(0, att.warning) + 0.05);
            // A gradient, so it can see its way out of a large zone rather than
            // sitting in the middle of one because every step looks equally bad.
            if (att.type === "void") {
              const distToEdge = Math.min(tx - att.x, att.x + att.w - tx, ty - att.y, att.y + att.h - ty);
              danger += distToEdge * 150;
            } else if (att.type === "blaster") {
              danger += (40 - Math.abs(tx - att.targetX)) * 300;
            } else if (att.type === "crusher") {
              danger += Math.abs(tx - (box.x + box.w / 2)) * 150;
            }
          }
        } else {
          if (dist < (b.size / 2 + Math.max(att.w || 10, att.h || 10))) danger += 1000;
          else danger += 100 / Math.max(1, dist - b.size);
          // Where will this be in fifteen frames?
          if (att.vx || att.vy) {
            const pDist = Math.hypot(tx - (ax + att.vx * 15), ty - (ay + att.vy * 15));
            if (pDist < b.size) danger += 1000;
          }
        }
      }

      danger += Math.hypot(tx - (box.x + box.w / 2), ty - (box.y + box.h / 2)) * 0.1;
      return danger;
    }

    function updateBot(dt) {
      const b = state.bot, box = state.box;
      if (b.invulnTimer > 0) b.invulnTimer -= dt;
      if (b.frozenTimer > 0) { b.frozenTimer -= dt; return; }

      if (b.grabbedTimer > 0) {
        b.grabbedTimer -= dt;
        b.x += (box.x + box.w / 2 - b.x) * 0.1;
        b.y += (box.y + box.h / 2 - b.y) * 0.1;
        return;
      }

      const speed = BOT_SPEED * 60 * dt;
      let lowest = evaluatePos(b.x, b.y);
      let moveX = 0, moveY = 0;
      for (let i = 0; i < 16; i++) {
        const ang = (Math.PI * 2 / 16) * i;
        const tx = b.x + Math.cos(ang) * speed;
        const ty = b.y + Math.sin(ang) * speed;
        const d = evaluatePos(tx, ty);
        if (d < lowest - 1) {          // the -1 keeps it from twitching
          lowest = d;
          moveX = Math.cos(ang) * speed;
          moveY = Math.sin(ang) * speed;
        }
      }
      b.x += moveX;
      b.y += moveY;
      clampBot();
    }

    // ===================================================================== //
    // 5. Update                                                             //
    // ===================================================================== //
    function update(dt) {
      if (state.status !== "playing") return;

      state.timeRemaining -= dt;
      state.elapsed += dt;
      if (state.timeRemaining <= 0) { state.timeRemaining = 0; endGame(false); return; }

      updateBot(dt);

      const b = state.bot;
      for (let i = state.attacks.length - 1; i >= 0; i--) {
        const att = state.attacks[i];
        let remove = false;

        if (att.type === "void" || att.type === "blaster" || att.type === "crusher") {
          if (att.warning > 0) {
            att.warning -= dt;
            if (att.warning <= 0) { att.active = true; state.shake = 0.22; }
          } else if (att.active) {
            att.lifetime -= dt;
            if (att.lifetime <= 0) remove = true;
          }
        } else {
          att.x += att.vx * 60 * dt;
          att.y += att.vy * 60 * dt;
          const box = state.box;
          if (att.x < box.x - 200 || att.x > box.x + box.w + 200 ||
              att.y < box.y - 200 || att.y > box.y + box.h + 200) remove = true;
        }

        if (att.active && b.invulnTimer <= 0) {
          let hit = false;
          if (att.type === "void") {
            hit = (b.x + b.size / 2 > att.x && b.x - b.size / 2 < att.x + att.w &&
                   b.y + b.size / 2 > att.y && b.y - b.size / 2 < att.y + att.h);
          } else if (att.type === "blaster") {
            hit = Math.abs(b.x - att.targetX) < 30;
          } else if (att.type === "crusher") {
            const box = state.box;
            const progress = Math.pow(1 - att.lifetime / att.maxLifetime, 2);
            hit = (b.x - b.size / 2 < box.x + (box.w / 2 * progress) ||
                   b.x + b.size / 2 > (box.x + box.w) - (box.w / 2 * progress));
          } else {
            const rx = b.x - b.size / 2, ry = b.y - b.size / 2;
            hit = (rx < att.x + att.w && rx + b.size > att.x &&
                   ry < att.y + att.h && ry + b.size > att.y);
          }

          if (hit) {
            b.hp -= att.dmg;
            // Damage on every touch — projectiles do not vanish on contact,
            // which is what makes a sustained wave worth so much.
            b.invulnTimer = 0;
            if (att.effect === "freeze") b.frozenTimer = 1.5;
            else if (att.effect === "grab") b.grabbedTimer = 1.0;
            else if (att.effect === "crush") {
              b.frozenTimer = 1.5;
              b.y = state.box.y + state.box.h - b.size / 2;
            }
            Audio.hit();
            state.shake = Math.max(state.shake, 0.1);
            if (att.dmg > 0) floaters.push({ x: b.x, y: b.y - 20, life: 1, text: "-" + att.dmg });
            if (b.hp <= 0) { b.hp = 0; endGame(true); }
          }
        }

        if (remove) state.attacks.splice(i, 1);
      }

      if (state.shake > 0) state.shake -= dt;
      paintHud();
    }

    function paintHud() {
      nodes.timer.textContent = state.timeRemaining.toFixed(1);
      const pct = Math.max(0, state.bot.hp / MAX_HP * 100);
      nodes.hpbar.style.width = pct + "%";
      nodes.hptext.textContent = Math.max(0, Math.ceil(state.bot.hp)) + " / " + MAX_HP;
    }

    // ===================================================================== //
    // 6. Drawing — abstract stand-ins, not the original's sprites            //
    // ===================================================================== //
    function draw() {
      g.setTransform(ctx.dpr, 0, 0, ctx.dpr, 0, 0);
      g.fillStyle = BG;
      g.fillRect(0, 0, W, H);

      if (state.shake > 0) {
        g.translate((Math.random() - 0.5) * 7, (Math.random() - 0.5) * 7);
      }

      const box = state.box;
      g.strokeStyle = BOX;
      g.lineWidth = 4;
      g.strokeRect(box.x, box.y, box.w, box.h);

      g.save();
      g.beginPath();
      g.rect(box.x - 2, box.y - 2, box.w + 4, box.h + 4);
      g.clip();

      for (const att of state.attacks) {
        if (att.type === "void") {
          if (att.warning > 0) {
            const pulse = 0.25 + 0.25 * Math.sin(att.warning * 30);
            g.fillStyle = "rgba(124,58,237," + pulse.toFixed(3) + ")";
            g.fillRect(att.x, att.y, att.w, att.h);
            g.strokeStyle = VOID_C;
            g.lineWidth = 2;
            g.strokeRect(att.x, att.y, att.w, att.h);
          } else if (att.active) {
            g.fillStyle = VOID_C;
            g.fillRect(att.x, att.y, att.w, att.h);
          }
        } else if (att.type === "blaster") {
          // An emitter above the target, then a vertical beam through it.
          const ex = att.targetX, ey = att.y + 40;
          g.save();
          g.translate(ex, ey);
          g.strokeStyle = BEAM;
          g.lineWidth = 3;
          g.beginPath();
          g.moveTo(-22, -14); g.lineTo(0, 6); g.lineTo(22, -14);
          g.stroke();
          g.beginPath();
          g.moveTo(-13, 2); g.lineTo(0, 18); g.lineTo(13, 2);
          g.stroke();
          g.restore();
          if (att.warning > 0) {
            g.strokeStyle = "rgba(224,242,254,0.5)";
            g.lineWidth = 2;
            g.setLineDash([7, 7]);
            g.beginPath();
            g.moveTo(ex, ey + 18); g.lineTo(ex, box.y + box.h);
            g.stroke();
            g.setLineDash([]);
          } else if (att.active) {
            const grad = g.createLinearGradient(ex - 28, 0, ex + 28, 0);
            grad.addColorStop(0, "rgba(224,242,254,0)");
            grad.addColorStop(0.5, BEAM);
            grad.addColorStop(1, "rgba(224,242,254,0)");
            g.fillStyle = grad;
            g.fillRect(ex - 28, ey + 14, 56, box.y + box.h - (ey + 14));
          }
        } else if (att.type === "crusher") {
          const progress = att.active ? Math.pow(1 - att.lifetime / att.maxLifetime, 2) : 0;
          const inset = box.w / 2 * progress;
          g.fillStyle = att.active ? "#ffffff" : "rgba(255,255,255,0.22)";
          g.fillRect(box.x, box.y, inset, box.h);
          g.fillRect(box.x + box.w - inset, box.y, inset, box.h);
        } else if (att.type === "freeze" || att.type === "grab") {
          const c = att.type === "freeze" ? FREEZE_C : GRAB_C;
          g.fillStyle = c;
          g.shadowColor = c;
          g.shadowBlur = 14;
          g.beginPath();
          g.arc(att.x + att.w / 2, att.y + att.h / 2, att.w / 2, 0, Math.PI * 2);
          g.fill();
          g.shadowBlur = 0;
        } else {
          // A plain white capsule where the original drew a bone sprite.
          g.fillStyle = BONE;
          g.shadowColor = BONE;
          g.shadowBlur = 6;
          const r = Math.min(att.w, att.h) / 2;
          g.beginPath();
          roundRect(att.x, att.y, att.w, att.h, r);
          g.fill();
          g.shadowBlur = 0;
        }
      }

      // The target: a diamond with a pale core, standing in for the original's
      // heart sprite. Flashes while frozen or grabbed.
      const b = state.bot;
      if (b.hp > 0) {
        const held = b.frozenTimer > 0 || b.grabbedTimer > 0;
        const s = b.size;
        g.save();
        g.translate(b.x, b.y);
        g.rotate(Math.PI / 4);
        g.fillStyle = held ? FREEZE_C : TARGET;
        g.shadowColor = held ? FREEZE_C : TARGET;
        g.shadowBlur = 16;
        g.fillRect(-s / 2, -s / 2, s, s);
        g.shadowBlur = 0;
        g.fillStyle = "rgba(255,255,255,0.85)";
        g.fillRect(-s / 6, -s / 6, s / 3, s / 3);
        g.restore();
      }

      g.restore();

      g.textAlign = "center";
      g.font = "800 14px " + FONT;
      for (let i = floaters.length - 1; i >= 0; i--) {
        const f = floaters[i];
        f.y -= 1.2;
        f.life -= 0.022;
        if (f.life <= 0) { floaters.splice(i, 1); continue; }
        g.globalAlpha = Math.max(0, f.life);
        g.fillStyle = "#fca5a5";
        g.fillText(f.text, f.x, f.y);
      }
      g.globalAlpha = 1;
    }

    function roundRect(x, y, w, h, r) {
      const rr = Math.min(r, w / 2, h / 2);
      g.moveTo(x + rr, y);
      g.arcTo(x + w, y, x + w, y + h, rr);
      g.arcTo(x + w, y + h, x, y + h, rr);
      g.arcTo(x, y + h, x, y, rr);
      g.arcTo(x, y, x + w, y, rr);
      g.closePath();
    }

    // ===================================================================== //
    // 7. Starting and finishing                                             //
    // ===================================================================== //
    const records = ctx.memory && ctx.memory.record ? ctx.memory.record("clear_time") : null;

    function startGame() {
      state.status = "playing";
      state.timeRemaining = TIME_LIMIT;
      state.elapsed = 0;
      state.attacks.length = 0;
      floaters.length = 0;
      state.bot.hp = MAX_HP;
      state.bot.frozenTimer = 0;
      state.bot.grabbedTimer = 0;
      state.bot.invulnTimer = 0;
      state.bot.x = state.box.x + state.box.w / 2;
      state.bot.y = state.box.y + state.box.h / 2;
      nodes.curtain.style.display = "none";
      paintHud();
      ctx.platform.start();
    }

    async function endGame(won) {
      state.status = won ? "won" : "lost";
      const secs = state.elapsed;
      if (won) { Audio.win(); ctx.platform.haptic("success"); }
      else { Audio.lose(); ctx.platform.haptic("error"); }

      nodes.title.textContent = won ? "Down in " + secs.toFixed(1) + "s" : "It survived";
      nodes.blurb.innerHTML = won
        ? "A thousand points, gone. Faster next time?"
        : "Sixty seconds up with " + Math.ceil(state.bot.hp) + " points still on it. " +
          "One attack at a time will never work — freeze it, then hit it with everything.";
      nodes.go.textContent = "AGAIN";
      nodes.curtain.style.display = "flex";
      nodes.board.innerHTML = "";

      if (won) {
        ctx.platform.complete({ seconds: +secs.toFixed(1) });
        if (state.best === 0 || secs < state.best) { state.best = secs; remember(); }
        if (records) {
          try { await records.submit(Math.round(secs * 1000), { label: secs.toFixed(1) + "s" }); }
          catch (_) { /* board unavailable */ }
        }
      } else {
        ctx.platform.fail({ remainingHp: Math.ceil(state.bot.hp) });
      }
    }

    async function showBoard() {
      nodes.board.innerHTML = '<div style="color:' + DIM + ';padding:12px 0;text-align:center;">Loading…</div>';
      if (!records) {
        nodes.board.innerHTML = '<div style="color:' + DIM +
          ';padding:12px 0;text-align:center;">No leaderboard here.</div>';
        return;
      }
      try {
        const data = await records.leaderboard();
        const entries = (data && data.entries) || [];
        if (!entries.length) {
          nodes.board.innerHTML = '<div style="color:' + DIM + ';padding:12px 0;text-align:center;">' +
            "Nobody has put it down yet.</div>";
          return;
        }
        let html = "";
        for (const e of entries.slice(0, 8)) {
          html += '<div style="display:flex;align-items:center;gap:10px;padding:7px 0;' +
            'border-bottom:1px solid rgba(255,255,255,0.07);font-size:13px;">' +
            '<div style="width:22px;color:' + DIM + ';font-weight:800;">' + (e.rank || "") + "</div>" +
            '<div style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;' +
            (e.self ? "color:" + TARGET + ";font-weight:700;" : "") + '">' +
            ((e.user && e.user.handle) || "someone") + (e.self ? " (you)" : "") + "</div>" +
            '<div style="font-weight:800;">' + (e.label || ((e.value / 1000).toFixed(1) + "s")) + "</div>" +
            "</div>";
        }
        nodes.board.innerHTML = html;
      } catch (_) {
        nodes.board.innerHTML = '<div style="color:#fca5a5;padding:12px 0;text-align:center;">' +
          "Could not reach the leaderboard.</div>";
      }
    }

    // ===================================================================== //
    // 8. Hands on it                                                        //
    // ===================================================================== //
    for (const b of pad.querySelectorAll("[data-ab]")) {
      const id = b.getAttribute("data-ab");
      ctx.listen(b, "pointerdown", (e) => {
        e.preventDefault();
        Audio.init();
        useAbility(id);
        ctx.platform.haptic("light");
        ctx.platform.interact({ kind: "attack", ability: id });
      });
    }
    ctx.listen(nodes.go, "pointerdown", (e) => { e.preventDefault(); Audio.init(); startGame(); });
    ctx.listen(nodes.showboard, "pointerdown", (e) => { e.preventDefault(); showBoard(); });

    // ===================================================================== //
    // 9. Remembering                                                        //
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
        fireAndForget(() => ctx.storage.set("bosssim", { best: state.best }));
      }, 400);
    }
    if (canStore) {
      try {
        const s = await ctx.storage.get("bosssim");
        if (s && typeof s.best === "number") state.best = s.best;
      } catch (_) { /* first run */ }
    }

    // ===================================================================== //
    // 10. Go                                                                //
    // ===================================================================== //
    ctx.onDestroy(() => { Audio.close(); });

    layout();
    state.bot.x = state.box.x + state.box.w / 2;
    state.bot.y = state.box.y + state.box.h / 2;
    paintHud();
    draw();
    ctx.markVisualReady("arena drawn");
    ctx.platform.ready();

    ctx.onFrame((dt) => {
      if (ctx.width !== W || ctx.height !== H) layout();
      update(Math.min(0.05, dt / 1000));
      draw();
    });
  }
};
