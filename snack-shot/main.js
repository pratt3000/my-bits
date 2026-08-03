/**
 * Snack Shot — a back-camera AR shooting gallery Plethora Bit.
 *
 * Fruit targets are placed at fixed directions "in the room" around the player.
 * The player turns their body (device motion) or swipes (fallback) to bring a
 * fruit under the centre crosshair, then taps SHOOT to blast it.
 *
 * The whole thing is procedural — no packaged assets. The camera feed is drawn
 * to a 2D canvas as the background; if the camera is denied it falls back to an
 * animated backdrop. Motion is optional: swipe-to-look always works, so the bit
 * stays playable on a desktop preview too.
 */
window.plethoraBit = {
  meta: {
    title: "Snack Shot",
    runtime: "plethora-bit@2",
    tags: ["ar", "camera", "shooter", "game", "arcade", "motion"],
    permissions: ["camera", "motion", "haptics", "backgroundMusic", "storage"]
  },

  async init(ctx) {
    // ---- constants -------------------------------------------------------
    const FOV = 66;                 // approx horizontal field of view (deg)
    const ROUND_MS = 60000;         // length of a round
    const MAX_LIVE = 6;             // live targets on the board at once
    const SPAWN_EVERY = 650;        // ms between top-ups
    const TARGET_LIFE = 8600;       // ms a fruit lingers before it flees
    const HIT_ASSIST = 2.6;         // extra aim-assist in degrees
    const FRUITS = ["🍎", "🍌", "🍊", "🍇", "🍓", "🍉", "🍑", "🥝", "🍍", "🥭", "🍏", "🫐"];
    const JUICE = ["#ff5a5f", "#ffd23f", "#ff8f3f", "#a06bff", "#ff5aa8", "#59d97a", "#29e3ff"];
    const ACCENT = "#ff3b6b";
    const GOLD = "#ffd23f";

    // ---- surfaces --------------------------------------------------------
    const canvas = ctx.createCanvas2D({ touchAction: "none" });
    const g = canvas.getContext("2d");
    const ui = ctx.createRoot();
    ui.style.pointerEvents = "none";

    const safe = () => ctx.safeArea || { top: 0, bottom: 0, left: 0, right: 0 };

    // ---- tiny DOM helpers ------------------------------------------------
    function css(el, s) { for (const k in s) el.style[k] = s[k]; return el; }
    function el(tag, style, text) {
      const n = document.createElement(tag);
      if (style) css(n, style);
      if (text != null) n.textContent = text;
      return n;
    }
    const SHADOW = "0 2px 8px rgba(0,0,0,.55)";
    function tap(node, fn) {
      node.style.pointerEvents = "auto";
      node.style.touchAction = "manipulation";
      let down = false;
      ctx.listen(node, "pointerdown", (e) => {
        down = true; e.stopPropagation();
        node.style.transform = (node.dataset.baseTransform || "") + " scale(0.94)";
      });
      ctx.listen(node, "pointerup", (e) => {
        node.style.transform = node.dataset.baseTransform || "";
        if (down) { down = false; e.stopPropagation(); e.preventDefault(); fn(e); }
      });
      ctx.listen(node, "pointercancel", () => { down = false; node.style.transform = node.dataset.baseTransform || ""; });
      ctx.listen(node, "pointerleave", () => { down = false; node.style.transform = node.dataset.baseTransform || ""; });
    }

    // ---- state -----------------------------------------------------------
    let state = "menu";             // menu | countdown | playing | over
    let now = 0;
    let score = 0, best = 0, combo = 1, comboBest = 1, hits = 0, shots = 0;
    let roundLeft = ROUND_MS;
    let lastComboAt = 0, rampDone = false;

    const targets = [];
    const particles = [];
    const floaters = [];
    let camShake = 0, muzzle = 0, lockPulse = 0, lastLockHaptic = 0;
    let countdownEndsAt = 0;

    // view / look
    let dragYaw = 0, dragPitch = 0;
    let baseYaw = null, basePitch = null, needBase = true;
    let viewYaw = 0, viewPitch = 0, ppd = 10, cx = 0, cy = 0, W = 0, H = 0;

    // capabilities / hardware
    let camOK = false, camVideo = null, motionOK = false;
    let music = null, muted = false;

    // firing
    let firing = false, shootQueued = false, lastShotAt = -999;

    // ---- utils -----------------------------------------------------------
    const wrap = (a) => { a = ((a + 180) % 360 + 360) % 360 - 180; return a; };
    const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
    const rand = (a, b) => a + Math.random() * (b - a);

    // ---- storage ---------------------------------------------------------
    async function loadPrefs() {
      if (!ctx.capabilities.storage) return;
      try {
        const b = await ctx.storage.get("best"); if (typeof b === "number") best = b;
        const m = await ctx.storage.get("muted"); if (typeof m === "boolean") muted = m;
      } catch (e) { /* ignore */ }
    }
    async function saveBest() {
      if (!ctx.capabilities.storage) return;
      try { await ctx.storage.set("best", best); } catch (e) { /* ignore */ }
    }
    async function saveMuted() {
      if (!ctx.capabilities.storage) return;
      try { await ctx.storage.set("muted", muted); } catch (e) { /* ignore */ }
    }

    // ---- hardware bring-up (from a user gesture) -------------------------
    async function startCamera() {
      if (!ctx.capabilities.camera) return false;
      try {
        camVideo = await ctx.camera.start({ facing: "environment" });
        camOK = !!camVideo;
      } catch (e) { camOK = false; }
      return camOK;
    }
    async function startMotion() {
      if (!ctx.capabilities.motion) return false;
      try { motionOK = !!(await ctx.motion.start()); } catch (e) { motionOK = false; }
      return motionOK;
    }
    async function startMusic() {
      if (!ctx.capabilities.backgroundMusic) return;
      try {
        await ctx.music.unlock();
        if (!muted) {
          music = ctx.music.play({ preset: "arcade", volume: 0.5, intensity: 0.55 });
        }
      } catch (e) { /* ignore */ }
    }
    function sting(name) {
      if (!ctx.capabilities.backgroundMusic || muted) return;
      try { ctx.music.sting(name); } catch (e) { /* ignore */ }
    }
    function haptic(kind) {
      if (!ctx.capabilities.haptics) return;
      try { ctx.platform.haptic(kind); } catch (e) { /* ignore */ }
    }

    // ---- view maths ------------------------------------------------------
    function updateView() {
      W = ctx.width; H = ctx.height; cx = W / 2; cy = H / 2;
      ppd = W / FOV;
      let mYaw = 0, mPitch = 0;
      if (motionOK && ctx.motion.active) {
        const t = ctx.motion.tilt || {};
        const alpha = t.z, beta = t.x;
        const rawYaw = (alpha == null ? 0 : alpha);
        const rawPitch = (beta == null ? 0 : 90 - beta);
        if (needBase) { baseYaw = rawYaw; basePitch = rawPitch; needBase = false; }
        mYaw = wrap(rawYaw - baseYaw);
        mPitch = rawPitch - basePitch;
      }
      viewYaw = wrap(mYaw + dragYaw);
      viewPitch = clamp(mPitch + dragPitch, -85, 85);
    }
    function project(tgt) {
      const dyaw = wrap(tgt.yaw - viewYaw);
      const dP = tgt.pitch - viewPitch;
      return { dyaw, dP, sx: cx + dyaw * ppd, sy: cy - dP * ppd };
    }

    // ---- targets ---------------------------------------------------------
    function spawnTarget() {
      const gold = Math.random() < 0.12;
      // place around the player but away from the current crosshair
      let off;
      do { off = rand(-165, 165); } while (Math.abs(off) < 16);
      targets.push({
        yaw: wrap(viewYaw + off),
        pitch: clamp(viewPitch + rand(-26, 26), -60, 60),
        fruit: FRUITS[(Math.random() * FRUITS.length) | 0],
        gold,
        scale: gold ? 1.05 : rand(0.8, 1.25),
        born: now,
        phase: rand(0, Math.PI * 2),
        alive: true,
        pop: 0
      });
    }
    function topUp() {
      let live = 0;
      for (const t of targets) if (t.alive) live++;
      if (live < MAX_LIVE) spawnTarget();
    }

    function baseRadius() { return Math.min(W, H) * 0.086; }

    // ---- shooting --------------------------------------------------------
    function shoot() {
      if (state !== "playing") return;
      shots++;
      muzzle = 1;
      camShake = Math.max(camShake, 7);
      haptic("light");
      lastShotAt = now;

      // find the target closest to the crosshair within its angular radius
      const R = baseRadius();
      let best = null, bestAng = 1e9;
      for (const t of targets) {
        if (!t.alive) continue;
        const p = project(t);
        if (Math.abs(p.dyaw) > FOV) continue;
        const ang = Math.hypot(p.dyaw, p.dP);
        const angR = (R * t.scale) / ppd + HIT_ASSIST;
        if (ang < angR && ang < bestAng) { bestAng = ang; best = t; }
      }

      if (best) {
        hit(best);
      } else {
        // clean miss — break the combo
        if (combo > 1) { combo = 1; }
        floaters.push({ x: cx, y: cy - 46, text: "miss", color: "#cfd6e6", born: now, life: 620, vy: -0.02 });
        sting("fail");
      }
    }

    function hit(t) {
      t.alive = false;
      hits++;
      if (now - lastComboAt < 2800) combo = Math.min(combo + 1, 9); else combo = 2;
      lastComboAt = now;
      comboBest = Math.max(comboBest, combo);
      const p = project(t);
      const val = Math.round((t.gold ? 300 : 100) * combo);
      score += val;
      ctx.platform.setScore(score);
      ctx.platform.interact({ type: "hit", gold: t.gold, combo });
      if (combo === 3 || combo === 5 || combo === 7) ctx.platform.milestone("combo_" + combo);

      floaters.push({ x: p.sx, y: p.sy - 8, text: "+" + val, color: t.gold ? GOLD : "#ffffff", born: now, life: 780, vy: -0.05 });
      if (combo >= 3) floaters.push({ x: p.sx, y: p.sy + 22, text: "x" + combo, color: ACCENT, born: now, life: 620, vy: -0.03 });

      burst(p.sx, p.sy, t.gold);
      camShake = Math.max(camShake, t.gold ? 12 : 8);
      haptic(t.gold ? "heavy" : "success");
      sting(t.gold ? "powerup" : "coin");
    }

    function burst(x, y, gold) {
      const n = gold ? 22 : 14;
      for (let i = 0; i < n; i++) {
        const a = rand(0, Math.PI * 2), sp = rand(0.08, 0.42) * Math.min(W, H) / 100;
        particles.push({
          x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 0.06,
          r: rand(2.5, 6.5), life: rand(420, 820), born: now,
          color: gold ? GOLD : JUICE[(Math.random() * JUICE.length) | 0]
        });
      }
    }

    // ---- rendering: background ------------------------------------------
    function drawCamera() {
      const vw = camVideo && camVideo.videoWidth, vh = camVideo && camVideo.videoHeight;
      if (camOK && vw && vh) {
        const scale = Math.max(W / vw, H / vh);
        const dw = vw * scale, dh = vh * scale;
        g.drawImage(camVideo, (W - dw) / 2, (H - dh) / 2, dw, dh);
        // subtle vignette so HUD/targets stay legible over any scene
        const vg = g.createRadialGradient(cx, cy, Math.min(W, H) * 0.2, cx, cy, Math.max(W, H) * 0.72);
        vg.addColorStop(0, "rgba(0,0,0,0)");
        vg.addColorStop(1, "rgba(0,0,0,0.42)");
        g.fillStyle = vg; g.fillRect(0, 0, W, H);
      } else {
        drawBackdrop();
      }
    }
    function drawBackdrop() {
      const grd = g.createLinearGradient(0, 0, W, H);
      grd.addColorStop(0, "#141a2e");
      grd.addColorStop(1, "#050711");
      g.fillStyle = grd; g.fillRect(0, 0, W, H);
      // drifting glow blobs that parallax with the view for a faux-room feel
      const blobs = 5;
      for (let i = 0; i < blobs; i++) {
        const bx = ((i * 137.5 - viewYaw * ppd * 0.6) % (W + 260) + (W + 260)) % (W + 260) - 130;
        const by = cy + Math.sin(now / 2600 + i) * H * 0.16 - viewPitch * ppd * 0.4 + (i - 2) * 40;
        const rg = g.createRadialGradient(bx, by, 0, bx, by, 150);
        const c = JUICE[i % JUICE.length];
        rg.addColorStop(0, c + "44"); rg.addColorStop(1, c + "00");
        g.fillStyle = rg; g.beginPath(); g.arc(bx, by, 150, 0, Math.PI * 2); g.fill();
      }
    }

    // ---- rendering: targets ---------------------------------------------
    function drawTargets() {
      const R = baseRadius();
      for (const t of targets) {
        if (!t.alive) continue;
        const p = project(t);
        if (Math.abs(p.dyaw) > FOV * 0.62 || p.sx < -80 || p.sx > W + 80) continue;
        const r = R * t.scale;
        const bob = Math.sin(now / 520 + t.phase) * 4;
        const y = p.sy + bob;
        const lifeFrac = clamp(1 - (now - t.born) / TARGET_LIFE, 0, 1);

        // glow halo
        const gl = g.createRadialGradient(p.sx, y, 0, p.sx, y, r * 1.5);
        const glc = t.gold ? GOLD : "#ffffff";
        gl.addColorStop(0, glc + (t.gold ? "aa" : "66"));
        gl.addColorStop(1, glc + "00");
        g.fillStyle = gl; g.beginPath(); g.arc(p.sx, y, r * 1.5, 0, Math.PI * 2); g.fill();

        // lifespan ring
        g.lineWidth = Math.max(2, r * 0.09);
        g.strokeStyle = lifeFrac > 0.3 ? (t.gold ? GOLD : "rgba(255,255,255,.85)") : ACCENT;
        g.beginPath();
        g.arc(p.sx, y, r * 1.12, -Math.PI / 2, -Math.PI / 2 + lifeFrac * Math.PI * 2);
        g.stroke();

        // the fruit
        g.font = (r * 1.7) + "px system-ui, 'Apple Color Emoji', 'Segoe UI Emoji', sans-serif";
        g.textAlign = "center"; g.textBaseline = "middle";
        g.fillText(t.fruit, p.sx, y + r * 0.04);

        if (t.gold) {
          g.font = (r * 0.7) + "px system-ui, sans-serif";
          g.fillText("✨", p.sx + r * 0.72, y - r * 0.72);
        }
      }
    }

    // ---- rendering: effects ---------------------------------------------
    function drawParticles() {
      for (const p of particles) {
        const a = clamp(1 - (now - p.born) / p.life, 0, 1);
        g.globalAlpha = a;
        g.fillStyle = p.color;
        g.beginPath(); g.arc(p.x, p.y, p.r * (0.5 + a * 0.5), 0, Math.PI * 2); g.fill();
      }
      g.globalAlpha = 1;
    }
    function drawMuzzle() {
      if (muzzle <= 0.02) return;
      const r = (1 - muzzle) * baseRadius() * 2.4 + 8;
      g.globalAlpha = muzzle * 0.8;
      g.strokeStyle = "#fff"; g.lineWidth = 6 * muzzle;
      g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.stroke();
      g.globalAlpha = 1;
    }

    // ---- rendering: crosshair, arrows, HUD ------------------------------
    function nearestLive() {
      let best = null, bestAng = 1e9;
      for (const t of targets) {
        if (!t.alive) continue;
        const p = project(t);
        const ang = Math.hypot(p.dyaw, p.dP);
        if (ang < bestAng) { bestAng = ang; best = { t, p, ang }; }
      }
      return best;
    }

    function drawCrosshair(locked) {
      const r = 26 + (locked ? Math.sin(now / 90) * 3 : 0);
      g.save();
      g.translate(cx, cy);
      g.strokeStyle = locked ? ACCENT : "rgba(255,255,255,.9)";
      g.lineWidth = 3;
      g.beginPath(); g.arc(0, 0, r, 0, Math.PI * 2); g.stroke();
      for (let i = 0; i < 4; i++) {
        g.rotate(Math.PI / 2);
        g.beginPath(); g.moveTo(0, -r - 3); g.lineTo(0, -r - 12); g.stroke();
      }
      g.fillStyle = locked ? ACCENT : "rgba(255,255,255,.9)";
      g.beginPath(); g.arc(0, 0, 3, 0, Math.PI * 2); g.fill();
      g.restore();
    }

    function drawOffscreenArrow() {
      const near = nearestLive();
      if (!near) return;
      const onScreen = Math.abs(near.p.dyaw) < FOV * 0.5 &&
        near.p.sx > 30 && near.p.sx < W - 30 && near.p.sy > 90 && near.p.sy < H - 150;
      if (onScreen) return;
      // point toward it around a ring near the crosshair
      const ang = Math.atan2(-(near.t.pitch - viewPitch), wrap(near.t.yaw - viewYaw));
      const rad = Math.min(W, H) * 0.34;
      const ax = cx + Math.cos(ang) * rad, ay = cy - Math.sin(ang) * rad;
      g.save();
      g.translate(ax, ay); g.rotate(-ang);
      g.globalAlpha = 0.85 + Math.sin(now / 220) * 0.15;
      g.fillStyle = near.t.gold ? GOLD : ACCENT;
      g.beginPath(); g.moveTo(16, 0); g.lineTo(-10, -11); g.lineTo(-10, 11); g.closePath(); g.fill();
      g.restore();
      g.globalAlpha = 1;
      g.font = "600 13px system-ui, sans-serif";
      g.fillStyle = "rgba(255,255,255,.85)";
      g.textAlign = "center"; g.textBaseline = "middle";
      g.fillText("turn", cx + Math.cos(ang) * (rad - 26), cy - Math.sin(ang) * (rad - 26));
    }

    function drawFloaters() {
      g.textAlign = "center"; g.textBaseline = "middle";
      for (const f of floaters) {
        const a = clamp(1 - (now - f.born) / f.life, 0, 1);
        g.globalAlpha = a;
        g.font = "800 22px system-ui, sans-serif";
        g.fillStyle = f.color;
        g.shadowColor = "rgba(0,0,0,.6)"; g.shadowBlur = 6;
        g.fillText(f.text, f.x, f.y);
        g.shadowBlur = 0;
      }
      g.globalAlpha = 1;
    }

    function drawHUD() {
      const st = safe();
      const top = st.top + 14;
      g.textBaseline = "top";
      // score (left)
      g.textAlign = "left";
      g.shadowColor = "rgba(0,0,0,.6)"; g.shadowBlur = 6;
      g.fillStyle = "#fff"; g.font = "800 30px system-ui, sans-serif";
      g.fillText(String(score), 18, top);
      g.font = "600 12px system-ui, sans-serif"; g.fillStyle = "rgba(255,255,255,.75)";
      g.fillText("SCORE", 20, top + 34);

      // timer (centre)
      const secs = Math.max(0, Math.ceil(roundLeft / 1000));
      const low = secs <= 10;
      g.textAlign = "center";
      g.fillStyle = low ? ACCENT : "#fff";
      g.font = "800 30px system-ui, sans-serif";
      const pulse = low ? 1 + Math.sin(now / 140) * 0.06 : 1;
      g.save(); g.translate(cx, top); g.scale(pulse, pulse);
      g.fillText(secs + "s", 0, 0); g.restore();

      // combo (right)
      g.textAlign = "right";
      if (combo >= 2) {
        g.fillStyle = ACCENT; g.font = "800 26px system-ui, sans-serif";
        g.fillText("x" + combo, W - 18, top + 2);
        g.font = "600 12px system-ui, sans-serif"; g.fillStyle = "rgba(255,255,255,.75)";
        g.fillText("COMBO", W - 20, top + 32);
      }
      g.shadowBlur = 0;
    }

    function drawCountdown() {
      const rem = countdownEndsAt - now;
      const n = Math.ceil(rem / 1000);
      const label = n <= 0 ? "GO!" : String(n);
      const frac = 1 - (rem % 1000) / 1000; // 0..1 within the second
      g.textAlign = "center"; g.textBaseline = "middle";
      g.globalAlpha = clamp(1 - frac * 0.4, 0, 1);
      g.font = "900 " + (Math.min(W, H) * (0.28 + frac * 0.08)) + "px system-ui, sans-serif";
      g.fillStyle = n <= 0 ? GOLD : "#fff";
      g.shadowColor = "rgba(0,0,0,.6)"; g.shadowBlur = 12;
      g.fillText(label, cx, cy);
      g.shadowBlur = 0; g.globalAlpha = 1;
    }

    // ---- update ----------------------------------------------------------
    let spawnAccum = 0;
    function update(dt) {
      // effects decay
      muzzle *= Math.pow(0.82, dt / 16);
      camShake *= Math.pow(0.86, dt / 16);
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 0.0012 * dt;
        if (now - p.born > p.life) particles.splice(i, 1);
      }
      for (let i = floaters.length - 1; i >= 0; i--) {
        const f = floaters[i]; f.y += f.vy * dt;
        if (now - f.born > f.life) floaters.splice(i, 1);
      }

      if (state !== "playing") return;

      // combo timeout
      if (combo > 1 && now - lastComboAt > 2800) combo = 1;

      // targets flee at end of life
      for (let i = targets.length - 1; i >= 0; i--) {
        const t = targets[i];
        if (t.alive && now - t.born > TARGET_LIFE) t.alive = false;
        if (!t.alive && now - t.born > TARGET_LIFE + 400) targets.splice(i, 1);
      }
      spawnAccum += dt;
      if (spawnAccum > SPAWN_EVERY) { spawnAccum = 0; topUp(); }

      // clock
      roundLeft -= dt;
      if (!rampDone && roundLeft <= 10000) {
        rampDone = true;
        try { music && music.setIntensity && music.setIntensity(0.85); music && music.setTempo && music.setTempo(132); } catch (e) { /* ignore */ }
      }
      if (roundLeft <= 0) { roundLeft = 0; endRound(); }
    }

    // ---- frame -----------------------------------------------------------
    ctx.onFrame((dt, t) => {
      now = t;
      dt = Math.min(dt, 50);
      updateView();

      // queued / held fire
      if (state === "playing") {
        if (shootQueued) { shootQueued = false; shoot(); }
        else if (firing && now - lastShotAt > 235) shoot();
      }

      if (state === "countdown" && now >= countdownEndsAt + 500) beginPlaying();

      update(dt);

      // ---- draw ----
      g.clearRect(0, 0, W, H);
      g.save();
      if (camShake > 0.3) g.translate((Math.random() * 2 - 1) * camShake, (Math.random() * 2 - 1) * camShake);
      drawCamera();
      if (state === "playing" || state === "countdown") { drawTargets(); }
      drawParticles();
      drawMuzzle();
      g.restore();

      if (state === "playing") {
        const near = nearestLive();
        const R = baseRadius();
        let locked = false;
        if (near) {
          const angR = (R * near.t.scale) / ppd + HIT_ASSIST;
          locked = near.ang < angR;
        }
        if (locked && now - lastLockHaptic > 400) { lastLockHaptic = now; haptic("light"); }
        drawOffscreenArrow();
        drawCrosshair(locked);
        drawFloaters();
        drawHUD();
      } else if (state === "countdown") {
        drawCrosshair(false);
        drawCountdown();
      } else {
        drawFloaters();
      }
    });

    // =====================================================================
    //  UI overlay (DOM): menu, HUD buttons, instructions, game over, board
    // =====================================================================
    const panelBase = {
      position: "absolute", inset: "0", display: "none",
      alignItems: "center", justifyContent: "center", flexDirection: "column",
      textAlign: "center", padding: "24px", boxSizing: "border-box",
      fontFamily: "system-ui, sans-serif", color: "#fff", gap: "14px",
      background: "rgba(6,9,20,.72)", backdropFilter: "blur(6px)",
      WebkitBackdropFilter: "blur(6px)", pointerEvents: "auto"
    };
    function button(label, bg, big) {
      const b = el("button", {
        pointerEvents: "auto", border: "none", cursor: "pointer",
        borderRadius: "999px", fontWeight: "800",
        fontSize: big ? "22px" : "16px",
        padding: big ? "16px 44px" : "12px 26px",
        color: bg === "ghost" ? "#fff" : "#0a0d1a",
        background: bg === "ghost" ? "rgba(255,255,255,.14)" : bg,
        boxShadow: bg === "ghost" ? "none" : "0 8px 22px rgba(0,0,0,.35)",
        fontFamily: "system-ui, sans-serif",
        WebkitTapHighlightColor: "transparent"
      }, label);
      if (bg === "ghost") b.style.border = "1.5px solid rgba(255,255,255,.32)";
      return b;
    }

    // --- MENU ---
    const menu = css(el("div"), panelBase);
    const title = el("div", { fontSize: "clamp(40px,13vw,72px)", fontWeight: "900", letterSpacing: "1px", textShadow: SHADOW }, "SNACK SHOT");
    const subtitle = el("div", { fontSize: "16px", opacity: ".85", marginTop: "-6px", textShadow: SHADOW }, "🍎 back-camera AR fruit blaster 🍌");
    const bestLine = el("div", { fontSize: "15px", opacity: ".8", marginTop: "2px" }, "");
    const startBtn = button("START", ACCENT, true);
    const howBtn = button("How to play", "ghost", false);
    const permNote = el("div", { fontSize: "12.5px", opacity: ".7", maxWidth: "300px", lineHeight: "1.4", marginTop: "6px" },
      "Point your phone's back camera at the room. We'll ask for camera + motion — you can still play with a demo backdrop and swipe controls if you say no.");
    menu.append(title, subtitle, bestLine, startBtn, howBtn, permNote);

    // --- INSTRUCTIONS ---
    const instr = css(el("div"), panelBase);
    const instrCard = el("div", { maxWidth: "340px", textAlign: "left", lineHeight: "1.6", fontSize: "15.5px" });
    instrCard.innerHTML =
      '<div style="font-weight:900;font-size:24px;text-align:center;margin-bottom:12px">How to play</div>' +
      '<div>🔄 &nbsp;Turn your body — or swipe — to look around the room.</div>' +
      '<div>🎯 &nbsp;Line a fruit up inside the centre crosshair.</div>' +
      '<div>🔫 &nbsp;Tap <b>SHOOT</b> to blast it. Hold to rapid-fire.</div>' +
      '<div>🔥 &nbsp;Hit fruit back-to-back to build a combo multiplier.</div>' +
      '<div>✨ &nbsp;Golden fruit is worth <b>3×</b> — grab it fast, it flees!</div>' +
      '<div>⏱️ &nbsp;Rack up the biggest score before 60s runs out.</div>';
    const instrClose = button("Got it", ACCENT, false);
    instr.append(instrCard, instrClose);

    // --- GAME OVER ---
    const over = css(el("div"), panelBase);
    const overTitle = el("div", { fontSize: "34px", fontWeight: "900", textShadow: SHADOW }, "Time!");
    const overScore = el("div", { fontSize: "clamp(52px,18vw,84px)", fontWeight: "900", color: GOLD, lineHeight: "1", textShadow: SHADOW }, "0");
    const overStats = el("div", { fontSize: "15px", opacity: ".85", lineHeight: "1.5" }, "");
    const overBestLine = el("div", { fontSize: "15px", opacity: ".85" }, "");
    const replayBtn = button("Play again", ACCENT, true);
    const boardBtn = button("🏆 Leaderboard", "ghost", false);
    over.append(overTitle, overScore, overStats, overBestLine, replayBtn, boardBtn);

    // --- LEADERBOARD ---
    const board = css(el("div"), panelBase);
    const boardTitle = el("div", { fontSize: "26px", fontWeight: "900", textShadow: SHADOW }, "🏆 Top Blasters");
    const boardList = el("div", { fontSize: "15px", lineHeight: "1.7", minHeight: "120px", width: "min(360px,90%)", textAlign: "left" }, "Loading…");
    const boardClose = button("Back", "ghost", false);
    board.append(boardTitle, boardList, boardClose);

    // --- HUD buttons (shoot / mute / info) ---
    const st0 = safe();
    const shootBtn = el("button", {
      position: "absolute", left: "50%", transform: "translateX(-50%)",
      bottom: "calc(" + (st0.bottom || 0) + "px + 26px)",
      width: "94px", height: "94px", borderRadius: "50%", border: "3px solid rgba(255,255,255,.9)",
      background: "radial-gradient(circle at 50% 38%, #ff5f7a, " + ACCENT + ")",
      color: "#fff", fontWeight: "900", fontSize: "17px", letterSpacing: ".5px",
      boxShadow: "0 10px 30px rgba(255,59,107,.5)", display: "none",
      pointerEvents: "auto", touchAction: "none", WebkitTapHighlightColor: "transparent",
      fontFamily: "system-ui, sans-serif"
    }, "SHOOT");
    shootBtn.dataset.baseTransform = "translateX(-50%)";

    const muteBtn = el("button", {
      position: "absolute", top: "calc(" + (st0.top || 0) + "px + 12px)", right: "12px",
      width: "44px", height: "44px", borderRadius: "50%", border: "none",
      background: "rgba(6,9,20,.5)", color: "#fff", fontSize: "20px",
      display: "none", pointerEvents: "auto", WebkitTapHighlightColor: "transparent"
    }, "🔊");

    const infoBtn = el("button", {
      position: "absolute", top: "calc(" + (st0.top || 0) + "px + 12px)", left: "12px",
      width: "44px", height: "44px", borderRadius: "50%", border: "none",
      background: "rgba(6,9,20,.5)", color: "#fff", fontSize: "20px", fontWeight: "800",
      display: "none", pointerEvents: "auto", WebkitTapHighlightColor: "transparent"
    }, "ⓘ");

    ui.append(menu, instr, over, board, shootBtn, muteBtn, infoBtn);

    // ---- panel helpers ---------------------------------------------------
    function show(panel, on) { panel.style.display = on ? "flex" : "none"; }
    function showHUD(on) {
      shootBtn.style.display = on ? "block" : "none";
      muteBtn.style.display = on ? "block" : "none";
      infoBtn.style.display = on ? "block" : "none";
    }
    function refreshMute() { muteBtn.textContent = muted ? "🔇" : "🔊"; }

    // ---- look controls (swipe fallback, always on) ----------------------
    let dragId = null, lastX = 0, lastY = 0;
    ctx.listen(canvas, "pointerdown", (e) => {
      if (state !== "playing" && state !== "countdown") return;
      dragId = e.pointerId; lastX = e.clientX; lastY = e.clientY;
      if (canvas.setPointerCapture) { try { canvas.setPointerCapture(e.pointerId); } catch (er) { /* ignore */ } }
    });
    ctx.listen(canvas, "pointermove", (e) => {
      if (e.pointerId !== dragId) return;
      const dpp = FOV / Math.max(1, ctx.width);
      dragYaw = wrap(dragYaw + (e.clientX - lastX) * dpp);
      dragPitch = clamp(dragPitch - (e.clientY - lastY) * dpp, -85, 85);
      lastX = e.clientX; lastY = e.clientY;
    });
    const endDrag = (e) => { if (e.pointerId === dragId) dragId = null; };
    ctx.listen(canvas, "pointerup", endDrag);
    ctx.listen(canvas, "pointercancel", endDrag);

    // ---- shoot button behaviour (tap + hold to auto-fire) ---------------
    shootBtn.style.touchAction = "none";
    ctx.listen(shootBtn, "pointerdown", (e) => {
      e.stopPropagation(); e.preventDefault();
      if (state !== "playing") return;
      shootQueued = true; firing = true;
      shootBtn.style.transform = "translateX(-50%) scale(0.9)";
    });
    const releaseShoot = (e) => {
      firing = false;
      shootBtn.style.transform = "translateX(-50%)";
    };
    ctx.listen(shootBtn, "pointerup", releaseShoot);
    ctx.listen(shootBtn, "pointercancel", releaseShoot);
    ctx.listen(shootBtn, "pointerleave", releaseShoot);

    // ---- button wiring ---------------------------------------------------
    tap(muteBtn, async () => {
      muted = !muted; refreshMute(); await saveMuted();
      try {
        if (muted) { music && music.stop ? music.stop({ fadeOutMs: 200 }) : ctx.music.stop({ fadeOutMs: 200 }); music = null; }
        else if (ctx.capabilities.backgroundMusic) { music = ctx.music.play({ preset: "arcade", volume: 0.5, intensity: rampDone ? 0.85 : 0.55 }); }
      } catch (e) { /* ignore */ }
    });
    tap(infoBtn, () => { show(instr, true); });
    tap(instrClose, () => { show(instr, false); });
    tap(howBtn, () => { show(instr, true); });
    tap(startBtn, () => beginSession());
    tap(replayBtn, () => startRound());
    tap(boardBtn, () => openBoard());
    tap(boardClose, () => { show(board, false); if (state === "over") show(over, true); });

    // ---- flow ------------------------------------------------------------
    let hardwareStarted = false;
    async function beginSession() {
      // this runs inside the START tap → the required user gesture
      ctx.platform.start();
      show(menu, false);
      if (!hardwareStarted) {
        hardwareStarted = true;
        await Promise.all([startCamera(), startMotion(), startMusic()]);
        refreshMute();
      }
      startRound();
    }

    function startRound() {
      show(over, false); show(board, false);
      targets.length = 0; particles.length = 0; floaters.length = 0;
      score = 0; combo = 1; comboBest = 1; hits = 0; shots = 0;
      roundLeft = ROUND_MS; rampDone = false; spawnAccum = 0;
      dragYaw = 0; dragPitch = 0; needBase = true;
      ctx.platform.setScore(0);
      // reset music energy
      try { music && music.setIntensity && music.setIntensity(0.55); music && music.setTempo && music.setTempo(120); } catch (e) { /* ignore */ }
      showHUD(true);
      // seed a few targets so there's something to find immediately
      updateView();
      for (let i = 0; i < 4; i++) spawnTarget();
      state = "countdown";
      countdownEndsAt = now + 3000;
    }

    function beginPlaying() {
      state = "playing";
      needBase = true; // re-anchor forward direction now that play starts
    }

    async function endRound() {
      state = "over";
      firing = false;
      showHUD(false);
      const acc = shots ? Math.round((hits / shots) * 100) : 0;
      const isRecord = score > best;
      if (isRecord) { best = score; await saveBest(); }
      overScore.textContent = String(score);
      overStats.textContent = "🎯 " + hits + " hits · " + acc + "% accuracy · best combo x" + comboBest;
      overBestLine.textContent = isRecord ? "🎉 New personal best!" : ("Personal best: " + best);
      overTitle.textContent = isRecord ? "New Best!" : "Time!";
      ctx.platform.complete({ score, hits, accuracy: acc, bestCombo: comboBest });
      sting(score > 0 ? "win" : "lose");
      haptic(isRecord ? "success" : "warning");
      show(over, true);
      // submit to the global leaderboard (best_per_user handles dedupe)
      submitScore(score);
    }

    async function submitScore(value) {
      if (value <= 0 || !ctx.memory || !ctx.memory.record) return;
      try {
        await ctx.memory.record("score").submit(value, { label: value + " pts" });
      } catch (e) { /* offline / rejected — leaderboard just won't update */ }
    }

    async function openBoard() {
      show(over, false); show(board, true);
      boardList.textContent = "Loading…";
      if (!ctx.memory || !ctx.memory.record) { boardList.textContent = "Leaderboard unavailable."; return; }
      try {
        const lb = await ctx.memory.record("score").leaderboard({ scope: "global", period: "all_time" });
        const rows = (lb && (lb.entries || lb.rows || lb.leaderboard || lb.items)) || [];
        if (!rows.length) { boardList.textContent = "No scores yet — be the first! 🏆"; return; }
        boardList.innerHTML = "";
        rows.slice(0, 10).forEach((r, i) => {
          const rank = r.rank != null ? r.rank : i + 1;
          const name = r.name || r.username || (r.user && (r.user.name || r.user.username)) || "Player";
          const val = r.value != null ? r.value : (r.score != null ? r.score : (r.formatted || "—"));
          const me = r.isSelf || r.self || (r.user && r.user.isSelf);
          const row = el("div", {
            display: "flex", justifyContent: "space-between", gap: "12px",
            padding: "6px 12px", borderRadius: "10px",
            background: me ? "rgba(255,59,107,.22)" : "transparent"
          });
          row.append(
            el("span", { opacity: ".9" }, "#" + rank + "  " + name),
            el("span", { fontWeight: "800", color: GOLD }, String(val))
          );
          boardList.append(row);
        });
      } catch (e) { boardList.textContent = "Couldn't load the leaderboard."; }
    }

    // ---- boot ------------------------------------------------------------
    await loadPrefs();
    refreshMute();
    bestLine.textContent = best > 0 ? ("Your best: " + best) : "";
    show(menu, true);

    // first visible frame is the menu over a live backdrop
    ctx.markVisualReady && ctx.markVisualReady("menu");
    ctx.platform.ready();
  }
};
