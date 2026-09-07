
    // ---- audio -----------------------------------------------------------------------------------
    let AC = null, master = null;
    function ensureAC() {
      if (AC || !canAudio) return;
      const Ctor = window.AudioContext || window.webkitAudioContext; if (!Ctor) return;
      try { AC = new Ctor(); master = AC.createGain(); master.gain.value = muted ? 0 : 0.6; master.connect(AC.destination); } catch (_) { AC = null; }
    }
    function resumeAC() { if (AC && AC.state === "suspended") { try { AC.resume(); } catch (_) {} } }
    function tone(freq, delay, dur, type, peak, glide) {
      ensureAC(); resumeAC(); if (!AC || muted) return;
      try {
        const o = AC.createOscillator(), gn = AC.createGain(); o.type = type || "square";
        const t = AC.currentTime + (delay || 0);
        o.frequency.setValueAtTime(freq, t); if (glide) o.frequency.exponentialRampToValueAtTime(Math.max(20, glide), t + dur * 0.9);
        gn.gain.setValueAtTime(0.0001, t); gn.gain.exponentialRampToValueAtTime(peak || 0.2, t + 0.01); gn.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        o.connect(gn); gn.connect(master); o.start(t); o.stop(t + dur + 0.02);
      } catch (_) {}
    }
    const sfx = {
      charge(c) { tone(160 + c * 380, 0, 0.05, "triangle", 0.08); },
      jump(c) { tone(260 + 120 * c, 0, 0.16, "sine", 0.22, 620 + 200 * c); },
      flap() { tone(420, 0, 0.07, "sawtooth", 0.1, 160); tone(700, 0.03, 0.05, "triangle", 0.08, 300); },
      land() { tone(140, 0, 0.09, "triangle", 0.22, 70); },
      bounce() { tone(520, 0, 0.05, "square", 0.1, 300); },
      thud() { tone(90, 0, 0.25, "sine", 0.3, 40); tone(60, 0.02, 0.2, "sawtooth", 0.12, 30); },
      collect() { tone(1046, 0, 0.06, "square", 0.1); tone(1568, 0.06, 0.1, "square", 0.1); },
      hurt() { tone(330, 0, 0.12, "sawtooth", 0.16, 120); tone(220, 0.1, 0.12, "square", 0.12, 90); },
      win() { [523, 659, 784, 1047, 784, 1047, 1319, 1568].forEach((f, i) => tone(f, i * 0.1, 0.14, "square", 0.12)); },
      ui() { tone(880, 0, 0.05, "square", 0.08); }
    };
    function applyMute() { if (master) master.gain.value = muted ? 0 : 0.6; }

    // ---- state -------------------------------------------------------------------------------------
    let state = "title";   // title | play | won
    let frames = 0, started = false, runT = 0, runStarted = false, bestT = store.get("bestT", 0), bestH = store.get("bestH", 0);
    const P = { x: LW / 2, y: -R, vx: 0, vy: 0, grounded: true, flaps: MAX_FLAPS, dir: 1, face: 1, charging: false, charge: 0, aim: 0, stun: 0, hurt: 0, fallFrom: 0, wing: 0, wingT: 0, land: 0 };
    let progress = 0, feathersGot = 0, falls = 0, bigFall = 0, camY = 0, shake = 0, stars = [], puffs = [], lastSubmitH = 0;
    let coachT = 0, plays = store.get("plays", 0);
    const fmtT = (ms) => { const m = Math.floor(ms / 60000), s = Math.floor(ms / 1000) % 60, c = Math.floor(ms / 10) % 100; return String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0") + "." + String(c).padStart(2, "0"); };

    function reset() {
      P.x = LW / 2; P.y = -R; P.vx = 0; P.vy = 0; P.grounded = true; P.flaps = MAX_FLAPS; P.charging = false; P.charge = 0; P.aim = 0; P.stun = 0; P.hurt = 0; P.face = 1; P.fallFrom = -R;
      progress = 0; feathersGot = 0; falls = 0; runT = 0; runStarted = false; stars = []; puffs = []; lastSubmitH = 0;
      for (const f of feathers) f.taken = false;
      camY = P.y - viewH * 0.6;
    }

    // ---- collision against the pixel mask ------------------------------------------------------------
    const SAMPLES = 16;
    function contact(x, y) {
      let nx = 0, ny = 0, n = 0, grass = 0;
      for (let i = 0; i < SAMPLES; i++) {
        const a = i / SAMPLES * Math.PI * 2, sx = x + Math.cos(a) * R, sy = y + Math.sin(a) * R;
        const px = Math.floor(sx), py = Math.floor(sy);
        if (solid(px, py)) { nx -= Math.cos(a); ny -= Math.sin(a); n++; if (grassAt(px, py)) grass++; }
      }
      if (!n) return null;
      const len = Math.hypot(nx, ny) || 1;
      return { nx: nx / len, ny: ny / len, n, grass };
    }
    function stepPhysics(dt) {
      if (P.stun > 0) P.stun -= dt;
      if (P.hurt > 0) P.hurt -= dt;
      if (P.grounded) {
        // still grounded? (ledge could be left only by jumping)
        return;
      }
      P.vy += GRAV * dt;
      P.vy = Math.min(P.vy, 380);
      // sub-steps so fast falls never tunnel
      const steps = Math.max(1, Math.ceil(Math.hypot(P.vx, P.vy) * dt / 3));
      for (let s = 0; s < steps; s++) {
        P.x += P.vx * dt / steps; P.y += P.vy * dt / steps;
        if (P.x < R) { P.x = R; P.vx = Math.abs(P.vx) * 0.5; }
        if (P.x > LW - R) { P.x = LW - R; P.vx = -Math.abs(P.vx) * 0.5; }
        let c = contact(P.x, P.y), guard = 0;
        while (c && guard++ < 12) {
          // push out along the normal
          P.x += c.nx * 0.6; P.y += c.ny * 0.6;
          const vn = P.vx * c.nx + P.vy * c.ny;
          if (guard === 1) {
            const landing = c.ny < -0.6 && c.grass >= 1 && P.vy > -10;
            if (landing) { landOn(c); return; }
            if (vn < 0) {
              // bounce off rock: lose most of the normal speed, keep some slide
              const e = 0.32; const tx = -c.ny, ty = c.nx; const vt = P.vx * tx + P.vy * ty;
              P.vx = tx * vt * 0.86 - c.nx * vn * e; P.vy = ty * vt * 0.86 - c.ny * vn * e;
              if (-vn > 60) { sfx.bounce(); haptic("light"); }
              if (c.ny < -0.85 && Math.abs(vt) < 30) { P.vx += (rand() < 0.5 ? -1 : 1) * 20; }   // never rest on bare rock
            }
          }
          c = contact(P.x, P.y);
        }
      }
      if (P.y > 60) { P.y = -R; P.x = LW / 2; P.vx = 0; P.vy = 0; }   // safety
    }
    function landOn(c) {
      const fall = P.y - P.fallFrom;
      P.grounded = true; P.vx = 0; P.vy = 0; P.flaps = MAX_FLAPS; P.land = 0.18;
      // settle exactly on the ledge top
      for (let k = 0; k < 8 && contact(P.x, P.y); k++) P.y -= 0.5;
      P.y = Math.round(P.y + R) - R - 0.01;
      // a ledge is only home if the feet are on grass
      if (fall > 90) { P.stun = 0.9; falls++; bigFall = fall; sfx.thud(); haptic("heavy"); shake = 5; for (let i = 0; i < 6; i++) stars.push({ x: P.x + rr(-6, 6), y: P.y - 8 - rr(0, 6), t: 0 }); }
      else { sfx.land(); haptic("light"); for (let i = 0; i < 4; i++) puffs.push({ x: P.x + rr(-5, 5), y: P.y + 3, vx: rr(-14, 14), t: 0 }); }
      const ledge = ledges.find((L) => Math.abs(L.y - (P.y + R)) < 3 && P.x >= L.x0 - 2 && P.x <= L.x1 + 2);
      if (ledge && ledge.summit && state === "play") win();
      void c;
    }
    function doJump() {
      const c = clamp(P.charge, 0.2, 1);
      const v = launch(P.aim, c); P.vx = v.vx; P.vy = v.vy; P.grounded = false; P.charging = false; P.charge = 0;
      P.fallFrom = P.y; P.face = P.aim || P.face; P.y -= 1;
      if (!runStarted) { runStarted = true; try { ctx.platform.interact(); } catch (_) {} }
      sfx.jump(c); haptic("medium"); for (let i = 0; i < 3; i++) puffs.push({ x: P.x + rr(-4, 4), y: P.y + 4, vx: rr(-10, 10), t: 0 });
    }
    function doFlap(dir) {
      if (P.grounded || P.flaps <= 0 || P.stun > 0) return;
      P.flaps--; P.vy = Math.min(P.vy, 40) - FLAP_VY; P.vx += dir * FLAP_VX; if (dir) P.face = dir;
      P.fallFrom = Math.min(P.fallFrom, P.y); P.wing = 0.22; sfx.flap(); haptic("light");
    }
    function win() {
      state = "won"; stateT = 0; sfx.win(); haptic("success"); shake = 4;
      const ms = Math.round(runT * 1000);
      if (!bestT || ms < bestT) { bestT = ms; store.set("bestT", bestT); }
      bestH = 100; store.set("bestH", 100);
      try {
        ctx.memory.record("time").submit(ms, { label: fmtT(ms) }).catch(() => {});
        ctx.memory.record("height").submit(100, { label: "100%" }).catch(() => {});
        ctx.memory.record("feathers").submit(feathersGot, { label: feathersGot + "/" + TOTAL_FEATHERS }).catch(() => {});
        ctx.platform.milestone("summit", { timeMs: ms, falls, feathers: feathersGot });
        ctx.platform.complete({ timeMs: ms, falls, feathers: feathersGot, height: 100 });
      } catch (_) {}
    }
    let stateT = 0;
    function tick(dt) {
      frames++; stateT += dt;
      if (shake > 0) shake -= dt * 20;
      for (const s of stars) s.t += dt; stars = stars.filter((s) => s.t < 0.9);
      for (const p of puffs) { p.t += dt; p.x += p.vx * dt; } puffs = puffs.filter((p) => p.t < 0.4);
      for (const h of hazards) { h.t += dt; h.x += h.sp * dt; if (h.x < h.x0) { h.x = h.x0; h.sp = Math.abs(h.sp); } if (h.x > h.x1) { h.x = h.x1; h.sp = -Math.abs(h.sp); } }
      for (const f of feathers) f.t += dt;
      if (state === "title") { P.wingT += dt; return; }
      if (state === "play" && runStarted) runT += dt;
      if (P.charging) { P.charge = clamp(P.charge + dt / CHARGE_T, 0, 1); if (frames % 6 === 0) sfx.charge(P.charge); }
      if (P.wing > 0) P.wing -= dt; if (P.land > 0) P.land -= dt;
      if (state !== "won") stepPhysics(dt);
      // pickups and hazards
      for (const f of feathers) if (!f.taken && Math.abs(f.x - P.x) < 7 && Math.abs(f.y - P.y) < 8) { f.taken = true; feathersGot++; sfx.collect(); haptic("light"); }
      if (P.hurt <= 0 && state === "play") for (const h of hazards) if (Math.abs(h.x - P.x) < 7 && Math.abs(h.y - P.y) < 7) {
        P.hurt = 1.0; P.grounded = false; P.vx = (P.x < h.x ? -1 : 1) * 110; P.vy = -70; P.flaps = 0; P.fallFrom = Math.min(P.fallFrom, P.y); P.charging = false; sfx.hurt(); haptic("heavy"); shake = 4;
      }
      // progress
      const pr = clamp((0 - (P.y + R)) / (0 - topY), 0, 1);
      if (pr > progress) { progress = pr; if (progress * 100 > bestH) { bestH = Math.floor(progress * 100); store.set("bestH", bestH); } if (progress - lastSubmitH >= 0.05 && state === "play") { lastSubmitH = progress; try { ctx.memory.record("height").submit(Math.floor(progress * 100), { label: Math.floor(progress * 100) + "%" }).catch(() => {}); ctx.platform.setScore(Math.floor(progress * 100)); } catch (_) {} } }
      // camera
      const target = P.y - viewH * 0.58;
      camY += (target - camY) * Math.min(1, dt * 5);
      camY = clamp(camY, Y_TOP + 8, 60 - viewH + 2);
    }
