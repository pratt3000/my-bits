/*
 * Nullpoint
 * A wobbly ring of an arena, a tiny ship, and one rule: every shot goes
 * through the dead centre. Bullets bounce off the wall and come back, and
 * your own bullet will kill you. Red rings drift in; pop them before they
 * touch you. Chain kills for a combo, bank shots off the wall for more.
 *
 * In the spirit of the one-kilobyte "dead_center" by Mors (pico-1k jam);
 * original code, name and art.
 *
 * Runtime: plethora-bit@2 (window.plethoraBit) · 2D canvas · synth audio
 */

window.plethoraBit = {
  meta: {
    title: "Nullpoint",
    runtime: "plethora-bit@2",
    tags: ["arcade", "shooter", "score", "minimal", "neon", "mobile"],
    permissions: ["haptics", "backgroundMusic", "audio", "storage"]
  },

  async init(ctx) {
    "use strict";
    const canvas = ctx.createCanvas2D({ touchAction: "none" });
    const g = canvas.getContext("2d");
    const root = ctx.createRoot({ touchAction: "none" });
    root.style.pointerEvents = "none";
    const sa = ctx.safeArea || { top: 0, bottom: 0, left: 0, right: 0 };

    // ---- helpers -------------------------------------------------------------
    const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
    const rnd = (a, b) => a + Math.random() * (b - a);
    const TAU = Math.PI * 2;
    const fmt = (n) => Math.floor(n).toLocaleString("en-US");
    const canStore = !!(ctx.capabilities && ctx.capabilities.storage);
    const memStore = {};
    const store = {
      get(k, d) { try { const v = canStore ? ctx.storage.get("np_" + k) : memStore[k]; return v == null ? d : v; } catch (_) { return d; } },
      set(k, v) { try { if (canStore) ctx.storage.set("np_" + k, v); else memStore[k] = v; } catch (_) {} }
    };
    const canMusic = !!(ctx.capabilities && ctx.capabilities.backgroundMusic);
    const canAudio = !!(ctx.capabilities && ctx.capabilities.audio);
    const canHaptic = !!(ctx.capabilities && ctx.capabilities.haptics);
    let muted = !!store.get("muted", false);
    function haptic(k) { if (canHaptic) { try { ctx.platform.haptic(k); } catch (_) {} } }

    // ---- audio ----------------------------------------------------------------
    let AC = null, master = null;
    function ensureAC() {
      if (AC || !canAudio) return;
      const C = window.AudioContext || window.webkitAudioContext; if (!C) return;
      try { AC = new C(); master = AC.createGain(); master.gain.value = muted ? 0 : 0.8; master.connect(AC.destination); } catch (_) { AC = null; }
    }
    function resumeAC() { if (AC && AC.state === "suspended") { try { AC.resume(); } catch (_) {} } }
    function tone(freq, delay, dur, type, peak, glide) {
      ensureAC(); resumeAC(); if (!AC || muted) return;
      try {
        const o = AC.createOscillator(), gn = AC.createGain(); o.type = type || "square";
        const t = AC.currentTime + (delay || 0);
        o.frequency.setValueAtTime(freq, t); if (glide) o.frequency.exponentialRampToValueAtTime(Math.max(20, glide), t + dur * 0.9);
        o.connect(gn); gn.connect(master);
        gn.gain.setValueAtTime(0.0001, t); gn.gain.linearRampToValueAtTime(peak || 0.1, t + 0.006); gn.gain.exponentialRampToValueAtTime(0.0005, t + dur);
        o.start(t); o.stop(t + dur + 0.03);
      } catch (_) {}
    }
    function noise(dur, cutoff, peak, type) {
      ensureAC(); resumeAC(); if (!AC || muted) return;
      try {
        const n = Math.max(1, (AC.sampleRate * dur) | 0), buf = AC.createBuffer(1, n, AC.sampleRate), d = buf.getChannelData(0);
        for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
        const src = AC.createBufferSource(); src.buffer = buf;
        const f = AC.createBiquadFilter(); f.type = type || "bandpass"; f.frequency.value = cutoff || 1000; f.Q.value = 0.8;
        const gn = AC.createGain(); gn.gain.value = peak || 0.2; src.connect(f); f.connect(gn); gn.connect(master); src.start();
      } catch (_) {}
    }
    function fbSting(name) { if (AC || muted || !canMusic || !ctx.music || !ctx.music.sting) return; try { ctx.music.sting(name); } catch (_) {} }
    const sfx = {
      shoot() { tone(920, 0, 0.09, "square", 0.07, 380); },
      bounce() { tone(260, 0, 0.05, "square", 0.06, 200); noise(0.04, 2400, 0.05, "highpass"); },
      fizz() { noise(0.12, 1800, 0.06, "highpass"); },
      kill(combo) { if (!AC) { fbSting("coin"); return; } noise(0.14, 1200, 0.18); tone(520 + combo * 60, 0, 0.12, "square", 0.08, 160); tone(1040 + combo * 90, 0.03, 0.14, "triangle", 0.06); },
      split() { tone(300, 0, 0.16, "sawtooth", 0.06, 120); },
      death() { if (!AC) { fbSting("lose"); return; } noise(0.6, 400, 0.3, "lowpass"); [440, 330, 220, 110].forEach((f, i) => tone(f, i * 0.12, 0.3, "square", 0.08)); },
      ui() { tone(700, 0, 0.05, "square", 0.06); if (!AC) fbSting("tap"); },
      wave() { [523, 659, 784].forEach((f, i) => tone(f, i * 0.07, 0.14, "square", 0.06)); },
      best() { if (!AC) { fbSting("win"); return; } [659, 784, 1047, 1319].forEach((f, i) => tone(f, i * 0.08, 0.2, "triangle", 0.08)); }
    };
    let musicOn = false;
    function bed(vol) {
      if (!canMusic || !ctx.music) return;
      try {
        if (muted) { if (musicOn) { ctx.music.pause(); musicOn = false; } return; }
        const st = ctx.music.state && ctx.music.state();
        if (!musicOn && st === "paused") { ctx.music.resume(); ctx.music.setVolume(vol, { fadeMs: 400 }); musicOn = true; }
        else if (!musicOn || st === "stopped") { ctx.music.unlock(); ctx.music.play({ preset: "techno", volume: vol, fadeInMs: 600, tempo: 128, intensity: 0.4 }); musicOn = true; }
        else ctx.music.setVolume(vol, { fadeMs: 400 });
      } catch (_) {}
    }
    function bedIntensity(v) { if (!canMusic || !ctx.music || !musicOn || muted) return; try { ctx.music.setIntensity(v, { fadeMs: 800 }); } catch (_) {} }

    // ---- state ----------------------------------------------------------------
    let W = ctx.width, Hh = ctx.height, cx = W / 2, cy = Hh / 2, R = 100;
    let state = "title";   // title | play | dead
    function layout() {
      W = ctx.width; Hh = ctx.height; cx = W / 2;
      const avail = Hh - sa.top - sa.bottom;
      const base = Math.min(W - 40, avail - 180) / 2;
      if (state === "title") {
        // on the title the arena sits in the upper third so the copy below never covers it
        R = base * 0.62; cy = sa.top + avail * 0.3;
      } else { R = base; cy = sa.top + avail / 2; }
    }
    layout();
    let started = false, timeNow = 0, runT = 0;
    let score = 0, kills = 0, combo = 0, comboT = 0, bestCombo = 0, wave = 1;
    let best = store.get("best", 0), plays = store.get("plays", 0);
    const P = { x: 0, y: 0, alive: true, deadT: 0, cd: 0, vx: 0, vy: 0 };
    const bullets = [], enemies = [], parts = [], pops = [];
    let shake = 0, pulse = 0, flashT = 0, spawnT = 0;

    // The arena wall: a circle that breathes and wobbles. Physics uses the same function as the drawing.
    function wallR(a, t) { return R * (1 + 0.035 * Math.sin(3 * a + t * 0.35) + 0.02 * Math.sin(7 * a - t * 0.5 + 1.2) + 0.012 * Math.sin(11 * a + t * 0.2) + pulse * 0.03); }
    function wallNormal(a, t) {
      const r = wallR(a, t), dr = (wallR(a + 0.01, t) - wallR(a - 0.01, t)) / 0.02;
      // tangent of r(θ): (r' cosθ - r sinθ, r' sinθ + r cosθ); normal points inward
      const tx = dr * Math.cos(a) - r * Math.sin(a), ty = dr * Math.sin(a) + r * Math.cos(a);
      const len = Math.hypot(tx, ty) || 1;
      return { x: -ty / len, y: tx / len };   // inward-facing (rotate tangent by -90°)
    }
    function insideDist(x, y, t) { const a = Math.atan2(y - cy, x - cx); return wallR(a, t) - Math.hypot(x - cx, y - cy); }

    // ---- entities ---------------------------------------------------------------
    const TYPES = {
      drifter: { r: 11, color: "#ff2d55", speed: 0.09, pts: 100 },
      seeker: { r: 9, color: "#ff8a3d", speed: 0.16, pts: 150 },
      big: { r: 19, color: "#c0143c", speed: 0.06, pts: 250 },
      orbiter: { r: 9, color: "#ff4fd8", speed: 0.5, pts: 200 }
    };
    function spawnEnemy(type, x, y) {
      const T = TYPES[type];
      const a = rnd(0, TAU);
      const ex = x != null ? x : cx + Math.cos(a) * (R * 0.97), ey = y != null ? y : cy + Math.sin(a) * (R * 0.97);
      let dir = Math.atan2(cy - ey, cx - ex) + rnd(-0.7, 0.7);
      const e = { type, x: ex, y: ey, r: T.r, vx: Math.cos(dir) * T.speed * R, vy: Math.sin(dir) * T.speed * R, born: 0, t: rnd(0, 6), orbit: Math.hypot(ex - cx, ey - cy), ang: a, alive: true };
      enemies.push(e);
      return e;
    }
    function fire() {
      if (state !== "play" || !P.alive || P.cd > 0) return;
      const dx = cx - P.x, dy = cy - P.y, d = Math.hypot(dx, dy);
      if (d < 4) { toast("Move off the centre to fire"); return; }
      const sp = R * 1.7;
      bullets.push({ x: P.x, y: P.y, vx: dx / d * sp, vy: dy / d * sp, bounces: 0, age: 0, trail: [], alive: true });
      P.cd = 0.24;
      // recoil
      P.vx -= dx / d * 40; P.vy -= dy / d * 40;
      sfx.shoot(); haptic("light");
      try { ctx.platform.interact({ type: "shoot" }); } catch (_) {}
    }
    function burst(x, y, color, n, speed, life) {
      for (let i = 0; i < n; i++) { const a = rnd(0, TAU), s = rnd(speed * 0.3, speed); parts.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: rnd(life * 0.6, life), max: life, color }); }
    }
    function killEnemy(e, b) {
      e.alive = false; kills += 1;
      const T = TYPES[e.type];
      combo = comboT > 0 ? combo + 1 : 1; comboT = 2.4; bestCombo = Math.max(bestCombo, combo);
      const bank = b ? b.bounces : 0;
      const pts = T.pts * (1 + bank) * Math.min(8, combo);
      score += pts;
      pops.push({ x: e.x, y: e.y - 10, text: "+" + fmt(pts) + (bank ? " ×" + (1 + bank) + " bank" : ""), t: 0, color: bank ? "#ffe066" : "#ffffff" });
      burst(e.x, e.y, T.color, 14, R * 0.9, 0.5);
      pops.push({ ring: true, x: e.x, y: e.y, t: 0, color: T.color, r: e.r });
      shake = Math.max(shake, 0.35 + bank * 0.15); pulse = 1;
      sfx.kill(combo); haptic(bank ? "medium" : "light");
      if (e.type === "big") { sfx.split(); for (let i = 0; i < 2; i++) { const s = spawnEnemy("drifter", e.x + rnd(-8, 8), e.y + rnd(-8, 8)); s.born = 0.6; } }
      if (combo >= 3 && combo % 3 === 0) toast("COMBO ×" + Math.min(8, combo), 700);
      try { ctx.platform.setScore(Math.floor(score)); } catch (_) {}
    }
    function die(cause) {
      if (!P.alive) return;
      P.alive = false; P.deadT = 0; state = "dead";
      burst(P.x, P.y, "#ffffff", 30, R * 1.2, 0.9); burst(P.x, P.y, "#ff2d55", 16, R * 0.8, 0.7);
      shake = 1.2; flashT = 0.35;
      sfx.death(); haptic("error");
      plays += 1; store.set("plays", plays);
      const isBest = score > best;
      if (isBest) { best = score; store.set("best", best); }
      store.set("bestCombo", Math.max(store.get("bestCombo", 0), bestCombo));
      try {
        ctx.platform.setScore(Math.floor(score));
        ctx.memory.record("score").submit(Math.floor(score), { label: fmt(score) + " pts" }).catch(() => {});
        ctx.memory.record("kills").submit(kills, { label: kills + " rings" }).catch(() => {});
        ctx.platform.fail({ cause, score: Math.floor(score), kills, combo: bestCombo, wave });
      } catch (_) {}
      ctx.timeout(() => { showDead(isBest, cause); }, 900);
    }
    function startRun() {
      state = "play"; layout(); runT = 0; score = 0; kills = 0; combo = 0; comboT = 0; bestCombo = 0; wave = 1; spawnT = 1.2;
      P.x = cx; P.y = cy + R * 0.6; P.alive = true; P.cd = 0.3; P.vx = 0; P.vy = 0;
      bullets.length = 0; enemies.length = 0; parts.length = 0; pops.length = 0;
      ui.title.classList.add("np-hidden"); ui.dead.classList.add("np-hidden"); ui.hud.classList.remove("np-hidden");
      bed(0.22); bedIntensity(0.4);
      for (let i = 0; i < 2; i++) spawnEnemy("drifter");
      try { ctx.platform.interact({ type: "run_start" }); } catch (_) {}
    }

    // ---- difficulty ---------------------------------------------------------------
    // Everything ramps on run time: spawn interval, cap, speed, and which rings show up.
    function diff() {
      const t = runT;
      return {
        interval: clamp(2.3 - t * 0.012, 0.55, 2.3),
        cap: Math.min(14, 3 + Math.floor(t / 12)),
        speedMul: 1 + Math.min(1.1, t * 0.008),
        seeker: t > 18 ? clamp((t - 18) / 60, 0.1, 0.35) : 0,
        big: t > 40 ? clamp((t - 40) / 80, 0.08, 0.22) : 0,
        orbiter: t > 65 ? clamp((t - 65) / 80, 0.08, 0.2) : 0
      };
    }
    function pickType(d) { const r = Math.random(); if (r < d.orbiter) return "orbiter"; if (r < d.orbiter + d.big) return "big"; if (r < d.orbiter + d.big + d.seeker) return "seeker"; return "drifter"; }

    // ---- input: drag moves the ship relative to the finger, a tap fires -------------
    let touch = null;
    ctx.listen(canvas, "pointerdown", (e) => {
      if (!started) { started = true; try { ctx.platform.start(); } catch (_) {} if (canMusic && ctx.music) { try { ctx.music.unlock(); } catch (_) {} } }
      ensureAC(); resumeAC();
      if (state === "title") { startRun(); return; }
      if (state !== "play") return;
      touch = { id: e.pointerId, x: e.clientX, y: e.clientY, px: P.x, py: P.y, t: performance.now(), moved: false };
    });
    ctx.listen(canvas, "pointermove", (e) => {
      if (!touch || e.pointerId !== touch.id || state !== "play") return;
      const dx = e.clientX - touch.x, dy = e.clientY - touch.y;
      if (!touch.moved && Math.hypot(dx, dy) < 6) return;
      touch.moved = true;
      P.tx = touch.px + dx * 1.3; P.ty = touch.py + dy * 1.3;
    });
    const up = (e) => {
      if (!touch || e.pointerId !== touch.id) return;
      const held = performance.now() - touch.t;
      if (!touch.moved && held < 260) fire();
      touch = null; P.tx = null; P.ty = null;
    };
    ctx.listen(canvas, "pointerup", up); ctx.listen(canvas, "pointercancel", up);

    // ---- DOM overlays ----------------------------------------------------------
    const style = document.createElement("style");
    style.textContent = `
      .np-ui { position:absolute; inset:0; overflow:hidden; color:#fff; font-family:ui-monospace,Menlo,Consolas,'Courier New',monospace; -webkit-user-select:none; user-select:none; -webkit-tap-highlight-color:transparent; }
      .np-ui * { box-sizing:border-box; }
      .np-hidden { display:none !important; }
      .np-title { position:absolute; inset:0; display:flex; flex-direction:column; align-items:center; justify-content:flex-end; text-align:center; padding:0 24px calc(${sa.bottom}px + 12%); pointer-events:none; }
      .np-logo { font-size:38px; font-weight:800; letter-spacing:6px; color:#fff; text-shadow:0 0 18px rgba(255,45,85,.8), 2px 0 #ff2d55, -2px 0 #33e0ff; animation:npFlick 4s steps(1) infinite; }
      @keyframes npFlick { 0%,92%,100% { opacity:1; } 93% { opacity:.6; } 95% { opacity:1; } 97% { opacity:.75; } }
      .np-sub { font-size:12px; letter-spacing:3px; opacity:.85; margin-top:10px; color:#ff2d55; }
      .np-rules { margin-top:18px; font-size:12.5px; line-height:1.9; opacity:.85; max-width:300px; }
      .np-rules b { color:#ffe066; }
      .np-tap { margin-top:22px; font-size:13px; letter-spacing:3px; animation:npBlink 1.1s steps(2) infinite; }
      @keyframes npBlink { 50% { opacity:.25; } }
      .np-best { font-size:11px; letter-spacing:2px; opacity:.7; margin-top:8px; }
      .np-hud { position:absolute; left:0; right:0; top:calc(${sa.top}px + 12px); display:flex; justify-content:space-between; padding:0 16px; font-size:12px; letter-spacing:2px; pointer-events:none; }
      .np-hud span { opacity:.85; } .np-hud b { color:#ffe066; }
      .np-combo { position:absolute; left:50%; top:calc(${sa.top}px + 40px); transform:translateX(-50%); font-size:13px; letter-spacing:3px; color:#ff2d55; opacity:0; transition:opacity .2s; text-shadow:0 0 10px rgba(255,45,85,.8); }
      .np-combo.on { opacity:1; }
      .np-toast { position:absolute; left:50%; top:calc(${sa.top}px + 70px); transform:translateX(-50%); font-size:12px; letter-spacing:2px; color:#fff; opacity:0; transition:opacity .2s; white-space:nowrap; text-shadow:0 0 8px #33e0ff; }
      .np-toast.show { opacity:1; }
      .np-dead { position:absolute; inset:0; display:flex; flex-direction:column; align-items:center; justify-content:center; text-align:center; padding:24px; pointer-events:auto; background:rgba(5,6,10,.55); }
      .np-panel { width:100%; max-width:320px; padding:20px 18px; border:2px solid #fff; background:#05060a; box-shadow:0 0 0 4px #05060a, 0 0 30px rgba(255,45,85,.35); }
      .np-panel h2 { margin:0 0 4px; font-size:20px; letter-spacing:5px; }
      .np-panel .c { font-size:11px; letter-spacing:2px; color:#ff2d55; margin-bottom:12px; }
      .np-row { display:flex; justify-content:space-between; font-size:12.5px; letter-spacing:1.5px; padding:6px 0; border-bottom:1px dashed rgba(255,255,255,.2); }
      .np-row b { color:#ffe066; }
      .np-btn { pointer-events:auto; display:block; width:100%; margin-top:14px; padding:12px; border:2px solid #fff; background:#fff; color:#05060a; font-family:inherit; font-size:14px; font-weight:800; letter-spacing:4px; cursor:pointer; }
      .np-btn:active { background:#ff2d55; border-color:#ff2d55; color:#fff; }
      .np-btn.ghost { background:transparent; color:#fff; margin-top:8px; }
      .np-mute { position:absolute; right:calc(${sa.right}px + 14px); bottom:calc(${sa.bottom}px + 14px); pointer-events:auto; width:38px; height:38px; border:1.5px solid rgba(255,255,255,.5); background:rgba(5,6,10,.6); color:#fff; font-size:15px; display:flex; align-items:center; justify-content:center; cursor:pointer; }
    `;
    root.appendChild(style);
    const dom = document.createElement("div"); dom.className = "np-ui";
    dom.innerHTML = `
      <div class="np-title" id="title">
        <div class="np-logo">NULLPOINT</div>
        <div class="np-sub">EVERY SHOT GOES THROUGH THE CENTRE</div>
        <div class="np-rules"><b>drag</b> to move · <b>tap</b> to fire<br>shots always aim at the <b>dead centre</b><br>bullets <b>bounce</b> off the wall and come back<br>your own bullet <b>kills you</b><br>bank shots and combos pay more</div>
        <div class="np-tap">TAP TO START</div>
        <div class="np-best">BEST <span id="tBest">0</span></div>
      </div>
      <div class="np-hud np-hidden" id="hud"><span>RINGS <b id="hKills">0</b></span><span>WAVE <b id="hWave">1</b></span><span>BEST <b id="hBest">0</b></span></div>
      <div class="np-combo" id="combo"></div>
      <div class="np-toast" id="toast"></div>
      <div class="np-dead np-hidden" id="dead"><div class="np-panel" id="deadPanel"></div></div>
      <button class="np-mute" id="mute">🔊</button>`;
    root.appendChild(dom);
    const $ = (id) => dom.querySelector("#" + id);
    const ui = { title: $("title"), hud: $("hud"), dead: $("dead"), deadPanel: $("deadPanel"), combo: $("combo"), toast: $("toast"), tBest: $("tBest"), hKills: $("hKills"), hWave: $("hWave"), hBest: $("hBest"), mute: $("mute") };
    ui.tBest.textContent = fmt(best); ui.hBest.textContent = fmt(best);
    let toastTok = 0;
    function toast(msg, ms) { ui.toast.textContent = msg; ui.toast.classList.add("show"); const tok = ++toastTok; ctx.timeout(() => { if (tok === toastTok) ui.toast.classList.remove("show"); }, ms || 1200); }
    function applyMute() { ui.mute.textContent = muted ? "🔇" : "🔊"; if (master) master.gain.value = muted ? 0 : 0.8; try { if (canMusic && ctx.music) { if (muted && musicOn) { ctx.music.pause(); musicOn = false; } else if (!muted && started && state === "play") bed(0.22); } } catch (_) {} }
    ctx.listen(ui.mute, "click", () => { muted = !muted; store.set("muted", muted); applyMute(); sfx.ui(); });
    applyMute();
    function showDead(isBest, cause) {
      const why = cause === "self" ? "shot by your own bullet, like a fool" : cause === "big" ? "flattened by a big ring" : cause === "seeker" ? "caught by a seeker" : cause === "orbiter" ? "clipped by an orbiter" : "touched by a ring";
      ui.hud.classList.add("np-hidden");
      ui.deadPanel.innerHTML = `<h2>${isBest ? "NEW BEST" : "NULLED"}</h2><div class="c">${why}</div>
        <div class="np-row"><span>SCORE</span><b>${fmt(score)}</b></div><div class="np-row"><span>RINGS</span><b>${kills}</b></div>
        <div class="np-row"><span>BEST COMBO</span><b>×${Math.min(8, bestCombo)}</b></div><div class="np-row"><span>SURVIVED</span><b>${Math.floor(runT)}s · wave ${wave}</b></div>
        <div class="np-row"><span>BEST</span><b>${fmt(best)}</b></div>
        <button class="np-btn" id="btnAgain">AGAIN</button>`;
      ui.dead.classList.remove("np-hidden");
      ctx.listen(ui.deadPanel.querySelector("#btnAgain"), "click", () => { sfx.ui(); haptic("light"); startRun(); });
      if (isBest) { sfx.best(); }
      try { ctx.platform.complete({ score: Math.floor(score), kills }); } catch (_) {}
    }

    // ---- update ---------------------------------------------------------------------
    function update(dt) {
      const d = diff();
      // player
      if (P.alive) {
        P.cd = Math.max(0, P.cd - dt);
        if (P.tx != null) { P.vx += (P.tx - P.x) * 26 * dt; P.vy += (P.ty - P.y) * 26 * dt; P.vx *= Math.max(0, 1 - dt * 12); P.vy *= Math.max(0, 1 - dt * 12); }
        else { P.vx *= Math.max(0, 1 - dt * 6); P.vy *= Math.max(0, 1 - dt * 6); }
        P.x += P.vx * dt; P.y += P.vy * dt;
        const inD = insideDist(P.x, P.y, timeNow);
        if (inD < 14) { const a = Math.atan2(P.y - cy, P.x - cx); const rr = wallR(a, timeNow) - 14; P.x = cx + Math.cos(a) * rr; P.y = cy + Math.sin(a) * rr; P.vx *= 0.5; P.vy *= 0.5; if (P.tx != null) { P.tx = P.x + (P.tx - P.x) * 0.5; P.ty = P.y + (P.ty - P.y) * 0.5; } }
      }
      // bullets
      for (let i = bullets.length - 1; i >= 0; i--) {
        const b = bullets[i];
        b.age += dt;
        const steps = 3, sdt = dt / steps;
        for (let k = 0; k < steps && b.alive; k++) {
          b.x += b.vx * sdt; b.y += b.vy * sdt;
          const inD = insideDist(b.x, b.y, timeNow);
          if (inD < 3) {
            const a = Math.atan2(b.y - cy, b.x - cx);
            const n = wallNormal(a, timeNow);
            const dot = b.vx * n.x + b.vy * n.y;
            if (dot < 0) { b.vx -= 2 * dot * n.x; b.vy -= 2 * dot * n.y; }
            const rr = wallR(a, timeNow) - 4; b.x = cx + Math.cos(a) * rr; b.y = cy + Math.sin(a) * rr;
            b.bounces += 1;
            burst(b.x, b.y, "#ffffff", 5, R * 0.5, 0.3);
            if (b.bounces >= 3) { b.alive = false; sfx.fizz(); burst(b.x, b.y, "#ff2d55", 8, R * 0.4, 0.4); }
            else { sfx.bounce(); shake = Math.max(shake, 0.12); }
          }
          // enemies
          for (const e of enemies) { if (!e.alive || e.born > 0) continue; if (Math.hypot(e.x - b.x, e.y - b.y) < e.r + 4) { killEnemy(e, b); b.alive = false; break; } }
          // the player
          if (b.alive && P.alive && b.age > 0.18 && Math.hypot(P.x - b.x, P.y - b.y) < 10) { die("self"); }
        }
        b.trail.push(b.x, b.y); if (b.trail.length > 16) b.trail.splice(0, 2);
        if (!b.alive) bullets.splice(i, 1);
      }
      // enemies
      for (let i = enemies.length - 1; i >= 0; i--) {
        const e = enemies[i];
        if (!e.alive) { enemies.splice(i, 1); continue; }
        e.t += dt; if (e.born > 0) e.born -= dt;
        const T = TYPES[e.type], sm = d.speedMul;
        if (e.type === "seeker" && P.alive) { const a = Math.atan2(P.y - e.y, P.x - e.x); const sp = T.speed * R * sm; e.vx += (Math.cos(a) * sp - e.vx) * Math.min(1, dt * 1.5); e.vy += (Math.sin(a) * sp - e.vy) * Math.min(1, dt * 1.5); e.x += e.vx * dt; e.y += e.vy * dt; }
        else if (e.type === "orbiter") { e.ang += T.speed * sm * dt * (e.t % 2 < 1 ? 1 : 1); e.orbit += Math.sin(e.t * 0.7) * 6 * dt; e.orbit = clamp(e.orbit, R * 0.25, R * 0.9); e.x = cx + Math.cos(e.ang) * e.orbit; e.y = cy + Math.sin(e.ang) * e.orbit; }
        else { e.x += e.vx * sm * dt; e.y += e.vy * sm * dt; }
        const inD = insideDist(e.x, e.y, timeNow);
        if (inD < e.r && e.type !== "orbiter") { const a = Math.atan2(e.y - cy, e.x - cx); const n = wallNormal(a, timeNow); const dot = e.vx * n.x + e.vy * n.y; if (dot < 0) { e.vx -= 2 * dot * n.x; e.vy -= 2 * dot * n.y; } const rr = wallR(a, timeNow) - e.r - 1; e.x = cx + Math.cos(a) * rr; e.y = cy + Math.sin(a) * rr; }
        if (P.alive && e.born <= 0 && Math.hypot(P.x - e.x, P.y - e.y) < e.r + 7) die(e.type);
      }
      // spawning and waves
      if (P.alive) {
        runT += dt; spawnT -= dt;
        const nw = 1 + Math.floor(runT / 20);
        if (nw !== wave) { wave = nw; sfx.wave(); toast("WAVE " + wave, 900); pulse = 1; bedIntensity(clamp(0.4 + wave * 0.08, 0.4, 1)); try { ctx.platform.milestone("wave", { wave }); } catch (_) {} }
        if (spawnT <= 0 && enemies.length < d.cap) { spawnEnemy(pickType(d)); spawnT = d.interval * rnd(0.8, 1.2); }
        comboT -= dt; if (comboT <= 0 && combo > 0) { combo = 0; }
      }
      // combo hud
      ui.combo.textContent = combo >= 2 ? "COMBO ×" + Math.min(8, combo) : "";
      ui.combo.classList.toggle("on", combo >= 2 && comboT > 0);
      // particles / pops
      for (let i = parts.length - 1; i >= 0; i--) { const p = parts[i]; p.life -= dt; if (p.life <= 0) { parts.splice(i, 1); continue; } p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= Math.max(0, 1 - dt * 3); p.vy *= Math.max(0, 1 - dt * 3); }
      for (let i = pops.length - 1; i >= 0; i--) { const p = pops[i]; p.t += dt; if (p.t > (p.ring ? 0.5 : 1)) pops.splice(i, 1); }
      shake = Math.max(0, shake - dt * 3); pulse = Math.max(0, pulse - dt * 2.5); flashT = Math.max(0, flashT - dt);
      if (!P.alive) P.deadT += dt;
    }

    // ---- draw ------------------------------------------------------------------------
    let hudT = 0;
    function draw() {
      g.save();
      g.fillStyle = "#05060a"; g.fillRect(0, 0, W, Hh);
      const sx = (Math.random() - 0.5) * shake * 10, sy = (Math.random() - 0.5) * shake * 10;
      g.translate(sx, sy);
      // faint centre glow and score
      const grad = g.createRadialGradient(cx, cy, 0, cx, cy, R);
      grad.addColorStop(0, "rgba(255,45,85,0.10)"); grad.addColorStop(1, "rgba(255,45,85,0)");
      g.fillStyle = grad; g.fillRect(cx - R, cy - R, R * 2, R * 2);
      g.fillStyle = state === "play" || state === "dead" ? "#232c55" : "#1a2040";
      g.font = "800 " + Math.round(R * 0.34) + "px ui-monospace,Menlo,Consolas,monospace";
      g.textAlign = "center"; g.textBaseline = "middle";
      g.fillText(state === "title" ? fmt(best) : fmt(score), cx, cy);
      // dead centre marker
      g.strokeStyle = "rgba(255,255,255,0.35)"; g.lineWidth = 1;
      g.beginPath(); g.moveTo(cx - 6, cy); g.lineTo(cx + 6, cy); g.moveTo(cx, cy - 6); g.lineTo(cx, cy + 6); g.stroke();
      // the wall: a hand-drawn, jittering ring
      g.strokeStyle = "#f2f2f2"; g.lineWidth = 2.2; g.lineJoin = "round";
      g.shadowColor = "rgba(255,255,255,0.5)"; g.shadowBlur = 6;
      g.beginPath();
      const N = 96;
      const jit = Math.floor(timeNow * 8);
      for (let i = 0; i <= N; i++) {
        const a = i / N * TAU, r = wallR(a, timeNow) + Math.sin(i * 12.9898 + jit * 78.233) * 0.9;
        const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
        if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
      }
      g.stroke(); g.shadowBlur = 0;
      // aim line from the ship through the centre
      if (state === "play" && P.alive) {
        g.strokeStyle = "rgba(255,255,255,0.12)"; g.lineWidth = 1; g.setLineDash([4, 6]);
        const dx = cx - P.x, dy = cy - P.y, dd = Math.hypot(dx, dy) || 1;
        let ex = cx, ey = cy; for (let k = 0; k < 40; k++) { const nx = ex + dx / dd * R * 0.04, ny = ey + dy / dd * R * 0.04; if (insideDist(nx, ny, timeNow) < 0) break; ex = nx; ey = ny; }
        g.beginPath(); g.moveTo(P.x, P.y); g.lineTo(ex, ey); g.stroke(); g.setLineDash([]);
      }
      // enemies
      for (const e of enemies) {
        const T = TYPES[e.type];
        g.strokeStyle = T.color; g.lineWidth = e.type === "big" ? 3 : 2.2;
        g.shadowColor = T.color; g.shadowBlur = 10;
        g.globalAlpha = e.born > 0 ? 0.4 : 1;
        g.beginPath(); g.arc(e.x, e.y, e.r + Math.sin(e.t * 5) * 0.8, 0, TAU); g.stroke();
        if (e.type === "seeker") { const a = Math.atan2(P.y - e.y, P.x - e.x); g.beginPath(); g.moveTo(e.x + Math.cos(a) * e.r, e.y + Math.sin(a) * e.r); g.lineTo(e.x + Math.cos(a) * (e.r + 6), e.y + Math.sin(a) * (e.r + 6)); g.stroke(); }
        if (e.type === "orbiter") { g.beginPath(); g.arc(e.x, e.y, e.r * 0.45, 0, TAU); g.stroke(); }
        g.globalAlpha = 1;
      }
      g.shadowBlur = 0;
      // bullets
      for (const b of bullets) {
        g.strokeStyle = "rgba(255,45,85,0.5)"; g.lineWidth = 2; g.beginPath();
        for (let i = 0; i < b.trail.length; i += 2) { if (i === 0) g.moveTo(b.trail[i], b.trail[i + 1]); else g.lineTo(b.trail[i], b.trail[i + 1]); }
        g.stroke();
        g.fillStyle = b.bounces ? "#ffe066" : "#ff2d55"; g.shadowColor = g.fillStyle; g.shadowBlur = 12;
        g.beginPath(); g.arc(b.x, b.y, 4, 0, TAU); g.fill();
        g.fillStyle = "#fff"; g.beginPath(); g.arc(b.x, b.y, 1.8, 0, TAU); g.fill();
        g.shadowBlur = 0;
      }
      // particles
      for (const p of parts) { g.globalAlpha = clamp(p.life / p.max, 0, 1); g.fillStyle = p.color; g.fillRect(p.x - 1.5, p.y - 1.5, 3, 3); }
      g.globalAlpha = 1;
      // pops
      for (const p of pops) {
        if (p.ring) { g.strokeStyle = p.color; g.globalAlpha = 1 - p.t / 0.5; g.lineWidth = 2; g.beginPath(); g.arc(p.x, p.y, p.r + p.t * R * 0.6, 0, TAU); g.stroke(); g.globalAlpha = 1; continue; }
        g.fillStyle = p.color; g.globalAlpha = 1 - p.t; g.font = "800 13px ui-monospace,Menlo,Consolas,monospace"; g.textAlign = "center";
        g.fillText(p.text, p.x, p.y - p.t * 30); g.globalAlpha = 1;
      }
      // ship: a hollow triangle pointing at the centre
      if (P.alive && state !== "title") {
        const a = Math.atan2(cy - P.y, cx - P.x);
        g.save(); g.translate(P.x, P.y); g.rotate(a);
        g.strokeStyle = "#ffffff"; g.lineWidth = 2; g.shadowColor = "#33e0ff"; g.shadowBlur = 10;
        g.beginPath(); g.moveTo(9, 0); g.lineTo(-7, -6); g.lineTo(-4, 0); g.lineTo(-7, 6); g.closePath(); g.stroke();
        if (P.cd > 0.12) { g.fillStyle = "rgba(255,255,255,0.6)"; g.beginPath(); g.arc(-7, 0, 2 + (P.cd - 0.12) * 20, 0, TAU); g.fill(); }
        g.restore(); g.shadowBlur = 0;
      } else if (state === "title") {
        // an idle ship circling the centre on the title
        const a = timeNow * 0.5; const px = cx + Math.cos(a) * R * 0.6, py = cy + Math.sin(a) * R * 0.6;
        g.save(); g.translate(px, py); g.rotate(a + Math.PI); g.strokeStyle = "#fff"; g.lineWidth = 2; g.beginPath(); g.moveTo(9, 0); g.lineTo(-7, -6); g.lineTo(-4, 0); g.lineTo(-7, 6); g.closePath(); g.stroke(); g.restore();
      }
      g.restore();
      // death flash and scanlines
      if (flashT > 0) { g.fillStyle = "rgba(255,45,85," + (flashT * 1.5).toFixed(2) + ")"; g.fillRect(0, 0, W, Hh); }
      g.fillStyle = "rgba(0,0,0,0.12)"; for (let y = 0; y < Hh; y += 3) g.fillRect(0, y, W, 1);
      const vg = g.createRadialGradient(cx, cy, R * 0.9, cx, cy, Math.max(W, Hh) * 0.8);
      vg.addColorStop(0, "rgba(0,0,0,0)"); vg.addColorStop(1, "rgba(0,0,0,0.65)");
      g.fillStyle = vg; g.fillRect(0, 0, W, Hh);
    }

    let last = ctx.width + "x" + ctx.height;
    ctx.onFrame((dtMs) => {
      const dt = Math.min(dtMs, 50) / 1000;
      timeNow += dt;
      const now = ctx.width + "x" + ctx.height; if (now !== last) { last = now; layout(); }
      if (state === "play" || state === "dead") update(dt);
      draw();
      hudT += dt; if (hudT > 0.2) { hudT = 0; ui.hKills.textContent = String(kills); ui.hWave.textContent = String(wave); ui.hBest.textContent = fmt(Math.max(best, score)); }
    });
    draw();
    try { ctx.markVisualReady("title"); } catch (_) {}
    ctx.platform.ready();

    if (typeof window !== "undefined") {
      window.__npDebug = () => ({ state, score, kills, combo, wave, runT: Math.round(runT), enemies: enemies.length, bullets: bullets.length, px: Math.round(P.x), py: Math.round(P.y), cx, cy, R: Math.round(R), alive: P.alive });
      window.__npStart = () => { started = true; startRun(); };
      window.__npFire = () => fire();
      window.__npSpawn = (t, x, y) => spawnEnemy(t || "drifter", x, y);
      window.__npMove = (x, y) => { P.x = x; P.y = y; };
      window.__npKill = () => die("test");
    }

    ctx.onDestroy(() => { try { if (canMusic && ctx.music && musicOn) ctx.music.stop({ fadeOutMs: 200 }); } catch (_) {} if (AC) { try { AC.close(); } catch (_) {} } });
  }
};
