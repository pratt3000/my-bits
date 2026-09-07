
    // ---- sprites + font ------------------------------------------------------------------------------
    const PAL = { W: C.white, R: C.red, O: C.beak, K: C.black, S: C.shade, Y: C.gold, D: C.dark, E: C.edge, G: "#c9a227" };
    function raster(rows, flip) {
      const h = rows.length, w = rows[0].length, oc = new OffscreenCanvas(w, h), c = oc.getContext("2d");
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const ch = rows[y][x]; if (ch === ".") continue; c.fillStyle = PAL[ch] || "#f0f"; c.fillRect(flip ? w - 1 - x : x, y, 1, 1); }
      return oc;
    }
    const SPR = {};
    function def(name, rows) { SPR[name] = raster(rows, false); SPR[name + "_f"] = raster(rows, true); }
    def("idle", [".....RR.....", "....RRR.....", "....WWWW....", "...WWKWWWO..", "...WWWWWWO..", "..WWWWWWWW..", ".WWWWWWWWW..", ".WSWWWWWWW..", "..WWWWWWW...", "...WWWWW....", "....O..O....", "...OO..OO..."]);
    def("up", [".....RR.....", "....RRR.....", "WW..WWWW..WW", ".WWWWKWWWO..", "..WWWWWWWO..", "..WWWWWWWW..", ".WWWWWWWWW..", ".WSWWWWWWW..", "..WWWWWWW...", "...WWWWW....", "....O..O....", "...OO..OO..."]);
    def("down", [".....RR.....", "....RRR.....", "....WWWW....", "...WWKWWWO..", "...WWWWWWO..", "..WWWWWWWW..", "WWWWWWWWWWW.", ".WSWWWWWWWW.", "..WWWWWWW...", "...WWWWW....", "....O..O....", "...OO..OO..."]);
    def("dizzy", [".....RR.....", "....RRR.....", "....WWWW....", "...WWSWWWO..", "...WWKWWWO..", "..WWWWWWWW..", ".WWWWWWWWW..", ".WSWWWWWWW..", "..WWWWWWW...", "...WWWWW....", "....O..O....", "...OO..OO..."]);
    def("cup", ["G........G", "GYYYYYYYYG", "GYYYYYYYYG", ".GYYYYYYG.", "..GYYYYG..", "...GYYG...", "....YY....", "....YY....", "..YYYYYY..", ".YYYYYYYY."]);
    def("nest", ["..EEEEEEEEEE..", ".EDEDEDEDEDEDE", "DEDEDEDEDEDEDED", ".DDDDDDDDDDDDD.", "..DDDDDDDDDDD.."]);
    def("star", ["..Y..", ".YYY.", "YYYYY", ".YYY.", "..Y.."]);
    def("star2", [".....", "..Y..", ".YYY.", "..Y..", "....."]);
    def("flapdot", ["..W..", ".WWW.", "..W.."]);
    const FONT = {
      A: "0E,11,11,1F,11,11,11", B: "1E,11,11,1E,11,11,1E", C: "0E,11,10,10,10,11,0E", D: "1E,11,11,11,11,11,1E", E: "1F,10,10,1E,10,10,1F", F: "1F,10,10,1E,10,10,10",
      G: "0E,11,10,17,11,11,0F", H: "11,11,11,1F,11,11,11", I: "0E,04,04,04,04,04,0E", J: "07,02,02,02,02,12,0C", K: "11,12,14,18,14,12,11", L: "10,10,10,10,10,10,1F",
      M: "11,1B,15,15,11,11,11", N: "11,11,19,15,13,11,11", O: "0E,11,11,11,11,11,0E", P: "1E,11,11,1E,10,10,10", Q: "0E,11,11,11,15,12,0D", R: "1E,11,11,1E,14,12,11",
      S: "0F,10,10,0E,01,01,1E", T: "1F,04,04,04,04,04,04", U: "11,11,11,11,11,11,0E", V: "11,11,11,11,11,0A,04", W: "11,11,11,15,15,15,0A", X: "11,11,0A,04,0A,11,11",
      Y: "11,11,11,0A,04,04,04", Z: "1F,01,02,04,08,10,1F", "0": "0E,11,13,15,19,11,0E", "1": "04,0C,04,04,04,04,0E", "2": "0E,11,01,02,04,08,1F", "3": "1F,02,04,02,01,11,0E",
      "4": "02,06,0A,12,1F,02,02", "5": "1F,10,1E,01,01,11,0E", "6": "06,08,10,1E,11,11,0E", "7": "1F,01,02,04,08,08,08", "8": "0E,11,11,0E,11,11,0E", "9": "0E,11,11,0F,01,02,0C",
      " ": "00,00,00,00,00,00,00", ":": "00,0C,0C,00,0C,0C,00", ".": "00,00,00,00,00,0C,0C", "%": "19,1A,02,04,08,0B,13", "!": "04,04,04,04,04,00,04", "/": "01,02,02,04,08,08,10", "-": "00,00,00,1F,00,00,00", "(": "02,04,08,08,08,04,02", ")": "08,04,02,02,02,04,08"
    };
    const glyphCache = {};
    function glyph(ch, color) {
      const key = ch + color; let c = glyphCache[key]; if (c) return c;
      const rows = (FONT[ch] || FONT["-"]).split(",");
      const oc = new OffscreenCanvas(6, 8), cc = oc.getContext("2d"); cc.fillStyle = color;
      for (let y = 0; y < 7; y++) { const bits = parseInt(rows[y], 16); for (let x = 0; x < 5; x++) if (bits & (16 >> x)) cc.fillRect(x, y, 1, 1); }
      glyphCache[key] = oc; return oc;
    }
    let fb = null, fbc = null, viewH = 200, S = 1, ox = 0;
    function text(s, x, y, color, scale) {
      scale = scale || 1;
      for (let i = 0; i < s.length; i++) { if (s[i] === " ") continue; fb.drawImage(glyph(s[i], color || C.white), x + i * 6 * scale, y, 6 * scale, 8 * scale); }
    }
    function otext(s, x, y, color, scale) {   // outlined
      scale = scale || 1;
      for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, 1], [-1, 1], [1, -1]]) text(s, x + dx * scale, y + dy * scale, C.black, scale);
      text(s, x, y, color, scale);
    }
    const tw = (s, scale) => s.length * 6 * (scale || 1) - (scale || 1);
    function otextC(s, cx, y, color, scale) { otext(s, Math.round(cx - tw(s, scale) / 2), y, color, scale); }

    // ---- drawing ---------------------------------------------------------------------------------------
    function drawWorld() {
      const cy = Math.round(camY), sx = shake > 0 ? Math.round(rr(-1, 1) * shake * 0.3) : 0;
      // sky
      const grad = fb.createLinearGradient(0, 0, 0, viewH); grad.addColorStop(0, "#1a9cec"); grad.addColorStop(1, "#33b8ff");
      fb.fillStyle = grad; fb.fillRect(0, 0, LW, viewH);
      // clouds, parallax
      fb.fillStyle = C.cloud;
      for (const cl of clouds) {
        const y = cl.y * 0.6 + cy * 0.4 - cy + viewH * 0.1; if (y < -20 || y > viewH + 20) continue;
        const x = cl.x + sx;
        fb.fillRect(Math.round(x - cl.w / 2), Math.round(y), Math.round(cl.w), Math.round(cl.h));
        fb.fillRect(Math.round(x - cl.w / 4), Math.round(y - cl.h * 0.6), Math.round(cl.w / 2), Math.round(cl.h * 0.6));
        fb.fillRect(Math.round(x - cl.w / 2 + 3), Math.round(y + cl.h), Math.round(cl.w - 6), 2);
      }
      // rock
      fb.drawImage(levelC, 0, cy - Y_TOP, LW, viewH, sx, 0, LW, viewH);
      // nest + cup at the summit
      fb.drawImage(SPR.nest, Math.round(LW / 2 - 7) + sx, summit.y - 4 - cy); fb.drawImage(SPR.cup, Math.round(LW / 2 - 5) + sx, summit.y - 13 - cy);
      // feathers
      for (const f of feathers) { if (f.taken) continue; const y = f.y - cy; if (y < -8 || y > viewH + 8) continue; fb.drawImage(Math.floor(f.t * 4) % 2 ? SPR.star : SPR.star2, f.x - 2 + sx, Math.round(y - 2 + Math.sin(f.t * 3) * 1.5)); }
      // hazards: spinning orange diamonds with a plum outline
      for (const h of hazards) {
        const y = h.y - cy; if (y < -10 || y > viewH + 10) continue;
        fb.save(); fb.translate(Math.round(h.x) + sx, Math.round(y)); fb.rotate(h.t * 3);
        fb.fillStyle = C.dark; fb.fillRect(-5, -5, 10, 10); fb.fillStyle = C.edge; fb.fillRect(-4, -4, 8, 8); fb.fillStyle = C.gold; fb.fillRect(-2, -2, 4, 4);
        fb.restore();
      }
      // puffs and stars
      fb.fillStyle = C.cloud; for (const p of puffs) fb.fillRect(Math.round(p.x) + sx, Math.round(p.y - cy - p.t * 12), 2, 2);
      for (const s of stars) fb.drawImage(SPR.star2, Math.round(s.x + Math.sin(s.t * 8 + s.x) * 3) + sx - 2, Math.round(s.y - cy - s.t * 6) - 2);
      // trajectory preview while charging
      if (P.charging) {
        const c = clamp(P.charge, 0.2, 1), v = launch(P.aim, c); let x = P.x, y = P.y, vx = v.vx, vy = v.vy;
        fb.fillStyle = "rgba(255,255,255,0.85)";
        for (let i = 0; i < 40; i++) { const dt = 1 / 60; x += vx * dt; y += vy * dt; vy += GRAV * dt; if (i % 5 === 4) fb.fillRect(Math.round(x) - 1 + sx, Math.round(y - cy) - 1, 2, 2); if (solid(Math.floor(x), Math.floor(y))) break; }
      }
      // the chicken
      const px = Math.round(P.x) - 6 + sx, py = Math.round(P.y) - 7 - cy, flip = P.face < 0;
      const name = P.stun > 0 ? "dizzy" : P.wing > 0.1 ? "up" : P.wing > 0 ? "down" : (!P.grounded && P.vy > 60) ? "down" : "idle";
      const sp = SPR[flip ? name + "_f" : name];
      if (P.hurt > 0 && Math.floor(frames / 3) % 2) { /* blink */ }
      else if (P.charging) { const sq = 1 - P.charge * 0.35; fb.drawImage(sp, px, py + Math.round(12 * (1 - sq)), 12, Math.round(12 * sq)); }
      else if (P.land > 0) { fb.drawImage(sp, px - 1, py + 2, 14, 10); }
      else fb.drawImage(sp, px, py);
      // flap pips under the chicken (only in the air)
      if (!P.grounded) for (let i = 0; i < P.flaps; i++) fb.drawImage(SPR.flapdot, Math.round(P.x) - 2 + (i - (P.flaps - 1) / 2) * 6 + sx, py + 14);
      if (P.stun > 0) for (let i = 0; i < 3; i++) { const a = frames * 0.15 + i * 2.1; fb.drawImage(SPR.star2, px + 6 + Math.round(Math.cos(a) * 7) - 2, py - 3 + Math.round(Math.sin(a) * 2) - 2); }
    }
    function drawHUD() {
      const top = Math.ceil(sa.top * dpr / S) + 3;
      otext(fmtT(Math.round(runT * 1000)), 3, top, C.white);
      const pc = Math.floor(progress * 100) + "%"; otext(pc, LW - 3 - tw(pc), top, C.white);
      if (feathersGot > 0) { fb.drawImage(SPR.star, 3, top + 11); otext(String(feathersGot), 10, top + 10, C.gold); }
      if (state === "play" && plays <= 2) {
        const bottom = viewH - Math.ceil(sa.bottom * dpr / S) - 14;
        if (P.grounded && !P.charging && !runStarted) otextC("HOLD TO CHARGE A JUMP", LW / 2, bottom, C.white);
        else if (P.charging) otextC("DRAG LEFT OR RIGHT TO AIM", LW / 2, bottom, C.white);
        else if (!P.grounded && P.flaps === MAX_FLAPS && runT < 30) otextC("TAP IN THE AIR TO FLAP", LW / 2, bottom, C.white);
        else if (P.grounded && falls === 0 && runT < 40 && runStarted) otextC("ONLY GREEN LEDGES HOLD", LW / 2, bottom, C.white);
      }
    }
    function drawTitle() {
      const top = Math.ceil(sa.top * dpr / S) + 14;
      otextC("CLUCK", LW / 2, top + 8, C.gold, 3); otextC("CLIMB", LW / 2, top + 34, C.white, 3);
      otextC("A PRECISION CLIMB", LW / 2, top + 64, C.cloud);
      const y = Math.round(viewH * 0.5);
      otextC("HOLD TO CHARGE", LW / 2, y, C.white); otextC("RELEASE TO JUMP", LW / 2, y + 12, C.white); otextC("TAP IN THE AIR TO FLAP", LW / 2, y + 24, C.white);
      otextC("ONLY GREEN LEDGES HOLD", LW / 2, y + 40, C.grassHi); otextC("MISS AND YOU FALL", LW / 2, y + 52, C.edge);
      if (bestT) otextC("BEST " + fmtT(bestT), LW / 2, y + 72, C.gold); else if (bestH) otextC("BEST HEIGHT " + bestH + "%", LW / 2, y + 72, C.gold);
      if (Math.floor(frames / 25) % 2) otextC("TAP TO START", LW / 2, viewH - Math.ceil(sa.bottom * dpr / S) - 40, C.gold);
    }
    function drawWon() {
      const y = Math.round(viewH * 0.3);
      fb.fillStyle = "rgba(20,10,30,0.7)"; fb.fillRect(10, y - 10, LW - 20, 84);
      otextC("BRAVEST!", LW / 2, y, C.gold, 2);
      otextC("TIME " + fmtT(Math.round(runT * 1000)), LW / 2, y + 24, C.white);
      otextC("FALLS " + falls + "   FEATHERS " + feathersGot + "/" + TOTAL_FEATHERS, LW / 2, y + 36, C.white);
      if (bestT) otextC("BEST " + fmtT(bestT), LW / 2, y + 48, C.gold);
      if (stateT > 1.5 && Math.floor(frames / 25) % 2) otextC("TAP TO PLAY AGAIN", LW / 2, y + 64, C.white);
    }
    function drawFrame() {
      drawWorld();
      if (state === "title") drawTitle(); else drawHUD();
      if (state === "won") drawWon();
    }

    // ---- layout + present --------------------------------------------------------------------------------
    const dpr = ctx.dpr || 1;
    let W = ctx.width, Hh = ctx.height;
    function layout() {
      W = ctx.width; Hh = ctx.height;
      S = Math.max(1, Math.floor(canvas.width / LW)); viewH = Math.ceil(canvas.height / S); ox = Math.floor((canvas.width - LW * S) / 2);
      fbc = new OffscreenCanvas(LW, viewH); fb = fbc.getContext("2d"); fb.imageSmoothingEnabled = false;
    }
    layout(); camY = P.y - viewH * 0.6;
    function present() {
      g.setTransform(1, 0, 0, 1, 0, 0); g.fillStyle = "#12203a"; g.fillRect(0, 0, canvas.width, canvas.height);
      g.imageSmoothingEnabled = false; g.drawImage(fbc, ox, 0, LW * S, viewH * S);
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.font = "16px ui-monospace,Menlo,Consolas,monospace"; g.fillStyle = "rgba(255,255,255,0.8)"; g.textAlign = "right"; g.textBaseline = "middle";
      g.fillText(muted ? "🔇" : "🔊", W - sa.right - 12, sa.top + 18);
    }

    // ---- input ----------------------------------------------------------------------------------------------
    let touch = null;
    function anyStart() {
      if (!started) { started = true; try { ctx.platform.start(); } catch (_) {} }
      ensureAC(); resumeAC();
      if (state === "title") { reset(); state = "play"; stateT = 0; plays++; store.set("plays", plays); return true; }
      if (state === "won" && stateT > 1.5) { state = "title"; stateT = 0; reset(); return true; }
      return false;
    }
    function worldX(clientX) { return (clientX * dpr - ox) / S; }
    function pressAt(cx) {
      if (P.stun > 0) return;
      if (P.grounded) { P.charging = true; P.charge = 0; P.aim = 0; }
      else { const dx = worldX(cx) - P.x; doFlap(Math.abs(dx) > 10 ? Math.sign(dx) : 0); }
    }
    ctx.listen(canvas, "pointerdown", (e) => {
      if (e.clientX > W - sa.right - 44 && e.clientY < sa.top + 34) { muted = !muted; store.set("muted", muted); applyMute(); sfx.ui(); return; }
      if (anyStart()) return;
      if (touch) return;
      touch = { id: e.pointerId, x: e.clientX, y: e.clientY };
      pressAt(e.clientX);
    });
    ctx.listen(canvas, "pointermove", (e) => {
      if (!touch || e.pointerId !== touch.id || !P.charging) return;
      const dx = e.clientX - touch.x; P.aim = dx > 14 ? 1 : dx < -14 ? -1 : 0; if (P.aim) P.face = P.aim;
    });
    const up = (e) => { if (!touch || e.pointerId !== touch.id) return; touch = null; if (P.charging && P.grounded) doJump(); P.charging = false; };
    ctx.listen(canvas, "pointerup", up); ctx.listen(canvas, "pointercancel", up);
    let keyAim = 0;
    ctx.listen(document, "keydown", (e) => {
      if (e.repeat) return;
      if (e.code === "ArrowLeft" || e.code === "KeyA") { keyAim = -1; if (P.charging) { P.aim = -1; P.face = -1; } e.preventDefault(); }
      if (e.code === "ArrowRight" || e.code === "KeyD") { keyAim = 1; if (P.charging) { P.aim = 1; P.face = 1; } e.preventDefault(); }
      if (e.code === "Space" || e.code === "ArrowUp" || e.code === "KeyW") {
        e.preventDefault(); if (anyStart()) return;
        if (P.grounded) { if (P.stun <= 0) { P.charging = true; P.charge = 0; P.aim = keyAim; } } else doFlap(keyAim);
      }
    });
    ctx.listen(document, "keyup", (e) => {
      if (e.code === "ArrowLeft" || e.code === "KeyA" || e.code === "ArrowRight" || e.code === "KeyD") { keyAim = 0; if (P.charging) P.aim = 0; }
      if (e.code === "Space" || e.code === "ArrowUp" || e.code === "KeyW") { if (P.charging && P.grounded) doJump(); P.charging = false; }
    });

    // ---- main loop --------------------------------------------------------------------------------------------
    let acc = 0, last = ctx.width + "x" + ctx.height;
    ctx.onFrame((dtMs) => {
      const now = ctx.width + "x" + ctx.height; if (now !== last) { last = now; layout(); }
      acc += Math.min(dtMs, 100);
      let n = 0; while (acc >= 1000 / 60 && n < 6) { acc -= 1000 / 60; tick(1 / 60); n++; }
      if (n === 6) acc = 0;
      drawFrame(); present();
    });

    // debug hooks for the headless harness
    window.__ccInfo = () => ({ state, x: Math.round(P.x * 10) / 10, y: Math.round(P.y * 10) / 10, vx: Math.round(P.vx), vy: Math.round(P.vy), grounded: P.grounded, flaps: P.flaps, charging: P.charging, progress: Math.round(progress * 1000) / 10, runT: Math.round(runT * 10) / 10, falls, feathers: feathersGot, total: TOTAL_FEATHERS, ledges: ledges.length, topY, hazards: hazards.length, S, viewH, camY: Math.round(camY) });
    window.__ccStart = () => anyStart();
    window.__ccJump = (dir, c) => { if (!P.grounded) return false; P.aim = dir; P.charge = c; P.charging = true; doJump(); return true; };
    window.__ccFlap = (dir) => doFlap(dir);
    window.__ccStep = (n) => { for (let i = 0; i < n; i++) tick(1 / 60); };
    window.__ccWarp = (x, y) => { P.x = x; P.y = y; P.vx = 0; P.vy = 0; P.grounded = true; P.flaps = MAX_FLAPS; camY = P.y - viewH * 0.58; };
    window.__ccLedge = (i) => { const L = ledges[i]; return L ? { x0: L.x0, x1: L.x1, y: L.y, w: L.w } : null; };
    window.__ccHold = (on) => { if (on) { P.charging = true; P.charge = 0.6; P.aim = 1; } else { P.charging = false; } };

    drawFrame(); present();
    try { ctx.markVisualReady("title"); } catch (_) {}
    ctx.platform.ready();
  }
};
