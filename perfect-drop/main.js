/*
 * Perfect Drop — a Plethora Bit built for one sound.
 *
 * The sound is a water droplet falling into a still pool. It is synthesised
 * rather than sampled (packaged assets are disabled), and it is modelled on
 * what actually happens physically: the drop punches the surface (a short
 * broadband tick) and entrains a pocket of air underneath. That bubble
 * oscillates and, as it shrinks, its resonant pitch *rises* — which is the
 * whole reason a drip goes "plink" and not "thud".
 *
 * The mechanic exists to serve the sound. A drop swells while you hold; you
 * release when its edge exactly kisses the target ring. How close you were
 * becomes the timbre: a perfect release opens the filter, lengthens the
 * bubble's rising glide, and pushes it deep into the reverb. A sloppy one
 * comes back dull and short. You can hear your own precision.
 */

window.plethoraBit = {
  meta: {
    title: "Perfect Drop",
    runtime: "plethora-bit@2",
    tags: ["asmr", "sensory", "sound", "relaxing", "timing", "satisfying"],
    permissions: ["audio", "haptics", "storage"]
  },

  async init(ctx) {
    const canvas = ctx.createCanvas2D({ touchAction: "none" });
    const g = canvas.getContext("2d");
    const ui = ctx.createRoot({ touchAction: "none" });
    ui.style.pointerEvents = "none";

    const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
    const rand = (a, b) => a + Math.random() * (b - a);
    const now = () => performance.now();
    let destroyed = false;
    ctx.onDestroy(() => { destroyed = true; });

    // ======================================================================
    // Audio — a small physically-motivated droplet synth plus a stone room.
    // ======================================================================
    let ac = null, master = null, dry = null, verb = null, wetBus = null;
    let noiseBuf = null, roomNode = null;
    let audioBlocked = false, warnedAudio = false, muted = false;

    // Reverb impulse: decaying noise. This is what makes a drip sound like it
    // is happening in a cave instead of in a cardboard box, and it is the
    // single biggest contributor to the sound feeling "satisfying".
    function makeIR(seconds, decay) {
      const len = Math.max(1, Math.floor(ac.sampleRate * seconds));
      const buf = ac.createBuffer(2, len, ac.sampleRate);
      const pre = Math.floor(ac.sampleRate * 0.012); // small pre-delay
      for (let c = 0; c < 2; c++) {
        const d = buf.getChannelData(c);
        for (let i = pre; i < len; i++) {
          const t = (i - pre) / (len - pre);
          d[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, decay);
        }
      }
      return buf;
    }

    function buildAudio() {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) { audioBlocked = true; return null; }
      try { ac = new AC(); } catch (_) { audioBlocked = true; return null; }

      master = ac.createGain();
      master.gain.value = 0.92;
      const comp = ac.createDynamicsCompressor();
      comp.threshold.value = -16; comp.ratio.value = 2.6;
      comp.attack.value = 0.004; comp.release.value = 0.3;
      master.connect(comp); comp.connect(ac.destination);

      dry = ac.createGain(); dry.gain.value = 1; dry.connect(master);
      wetBus = ac.createGain(); wetBus.gain.value = 0.9;
      verb = ac.createConvolver();
      try { verb.buffer = makeIR(2.6, 3.2); } catch (_) {}
      // Roll the tail off up top so the reverb reads as stone, not as hiss.
      const wetCut = ac.createBiquadFilter();
      wetCut.type = "lowpass"; wetCut.frequency.value = 5200;
      verb.connect(wetCut); wetCut.connect(wetBus); wetBus.connect(master);

      noiseBuf = ac.createBuffer(1, Math.floor(ac.sampleRate), ac.sampleRate);
      const nd = noiseBuf.getChannelData(0);
      for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;

      startRoomTone();
      ctx.onDestroy(() => { try { ac.close(); } catch (_) {} });
      return ac;
    }

    // Barely-there air in the chamber. You notice it only when it stops.
    function startRoomTone() {
      const len = Math.floor(ac.sampleRate * 3);
      const buf = ac.createBuffer(1, len, ac.sampleRate);
      const d = buf.getChannelData(0);
      let last = 0;
      for (let i = 0; i < len; i++) {                 // brown-ish noise
        last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
        d[i] = last * 3.2;
      }
      const src = ac.createBufferSource();
      src.buffer = buf; src.loop = true;
      const lp = ac.createBiquadFilter();
      lp.type = "lowpass"; lp.frequency.value = 340;
      const gn = ac.createGain(); gn.gain.value = 0.028;
      src.connect(lp); lp.connect(gn); gn.connect(master);
      try { src.start(0); } catch (_) {}
      roomNode = gn;
    }

    let resuming = false;
    function tryResume() {
      if (!ac || ac.state === "running" || resuming) return;
      resuming = true;
      let p;
      try { p = ac.resume(); } catch (_) { resuming = false; return; }
      if (p && p.then) p.then(() => { resuming = false; }, () => { resuming = false; });
      else resuming = false;
    }

    // Mobile WebViews hand back a suspended context and only unlock it inside a
    // real gesture, so this runs on every press: resume, play a one-frame silent
    // buffer, then check we actually made it to "running".
    function unlockAudio() {
      if (!ac && !buildAudio()) return null;
      tryResume();
      try {
        const b = ac.createBuffer(1, 1, ac.sampleRate || 22050);
        const s = ac.createBufferSource();
        s.buffer = b; s.connect(ac.destination); s.start(0);
      } catch (_) {}
      if (ac.state !== "running" && !warnedAudio) {
        ctx.timeout(() => {
          tryResume();
          if (ac && ac.state !== "running" && !warnedAudio) {
            warnedAudio = true;
            toast("Turn the ringer switch off silent 🔊");
          }
        }, 320);
      }
      return ac;
    }
    const audioReady = () => !!(ac && ac.state === "running" && !audioBlocked && !muted);

    /*
     * One droplet.
     *   freq    – bubble's starting pitch
     *   q       – 0..1 quality; how close to perfect the release was
     *   gain    – overall level
     *   wet     – reverb send
     *   cut     – optional lowpass override (used to push drips into the dark)
     */
    function drip(o) {
      if (!ac || ac.state !== "running" || muted) return;
      const t0 = ac.currentTime + 0.001;
      const q = clamp(o.q == null ? 1 : o.q, 0, 1);
      const f0 = o.freq * rand(0.994, 1.006);   // never twice identical

      // Per-voice tone shaping. A miss is dull and closed; a perfect release
      // opens all the way up and lets the tick sparkle.
      const lp = ac.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = o.cut != null ? o.cut : 950 + 8600 * q * q;
      lp.Q.value = 0.6;

      const out = ac.createGain();
      out.gain.value = o.gain;
      lp.connect(out);
      out.connect(dry);
      const send = ac.createGain();
      send.gain.value = o.wet;
      out.connect(send); send.connect(verb);

      // 1. The bubble. Pitch glides upward as the trapped air pocket collapses
      //    — this rising sweep *is* the plink. A poor drop barely sweeps.
      const glide = 1.22 + 0.78 * q;
      const sweep = 0.045 + 0.105 * q;
      const decay = 0.15 + 0.44 * q;
      const osc = ac.createOscillator();
      osc.type = "sine";
      osc.frequency.setValueAtTime(f0, t0);
      osc.frequency.exponentialRampToValueAtTime(f0 * glide, t0 + sweep);
      const oe = ac.createGain();
      oe.gain.setValueAtTime(0.0001, t0);
      oe.gain.exponentialRampToValueAtTime(1, t0 + 0.004);
      oe.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.004 + decay);
      osc.connect(oe); oe.connect(lp);
      osc.start(t0); osc.stop(t0 + decay + 0.12);

      // 2. The surface breaking: a very short filtered noise tick.
      const n = ac.createBufferSource();
      n.buffer = noiseBuf;
      const bp = ac.createBiquadFilter();
      bp.type = "bandpass";
      bp.frequency.value = 1300 + 1900 * q;
      bp.Q.value = 1.0 + 2.4 * q;
      const ne = ac.createGain();
      ne.gain.setValueAtTime(0.0001, t0);
      ne.gain.exponentialRampToValueAtTime(0.3 + 0.4 * q, t0 + 0.002);
      ne.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.014 + 0.022 * q);
      n.connect(bp); bp.connect(ne); ne.connect(lp);
      n.start(t0, Math.random() * 0.8); n.stop(t0 + 0.1);

      // 3. Body — a soft octave-down that gives the pool some depth.
      const sub = ac.createOscillator();
      sub.type = "sine";
      sub.frequency.setValueAtTime(f0 * 0.5, t0);
      const se = ac.createGain();
      se.gain.setValueAtTime(0.0001, t0);
      se.gain.exponentialRampToValueAtTime(0.1 + 0.14 * q, t0 + 0.006);
      se.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.28);
      sub.connect(se); se.connect(lp);
      sub.start(t0); sub.stop(t0 + 0.4);

      // 4. Only a clean release rings the harmonics. This is the reward.
      if (q > 0.55) {
        const shine = (q - 0.55) / 0.45;
        [[2, 0.13], [3, 0.06]].forEach(([mult, amp]) => {
          const h = ac.createOscillator();
          h.type = "sine";
          h.frequency.setValueAtTime(f0 * mult, t0);
          const he = ac.createGain();
          he.gain.setValueAtTime(0.0001, t0);
          he.gain.exponentialRampToValueAtTime(Math.max(0.001, amp * shine), t0 + 0.02);
          he.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.15 + 0.5 * shine);
          h.connect(he); he.connect(lp);
          h.start(t0); h.stop(t0 + 0.8 + 0.5 * shine);
        });
      }
    }

    // Far-off drips somewhere else in the cave. Costs nothing — it is the same
    // voice pushed dark, quiet and soaking wet — and it makes the silence feel
    // like a place rather than an absence.
    let lastPlayerDrop = -9999;
    function scheduleDistant() {
      ctx.timeout(() => {
        if (destroyed) return;
        if (audioReady() && now() - lastPlayerDrop > 600) {
          drip({
            freq: rand(300, 700), q: rand(0.35, 0.7),
            gain: rand(0.05, 0.085), wet: 1.0, cut: rand(900, 1500)
          });
        }
        scheduleDistant();
      }, rand(2800, 7000));
    }

    // ======================================================================
    // Musical ladder — every perfect drop in a row steps one note higher, so a
    // good run turns into an ascending melody instead of the same note twice.
    // ======================================================================
    // Two octaves of G minor pentatonic, then back to the root. Kept in the
    // 390–1400Hz band on purpose: that is where real drips live, and a ladder
    // that climbed without limit would be shrieking by the tenth perfect drop.
    // The wrap lands on the streak-10 milestone, so it reads as a new verse.
    const ROOT = 392;                                      // G4
    const PENTA = [0, 3, 5, 7, 10, 12, 15, 17, 19, 22];
    const ladderFreq = (n) => ROOT * Math.pow(2, PENTA[((n % PENTA.length) + PENTA.length) % PENTA.length] / 12);

    // ======================================================================
    // State
    // ======================================================================
    const HANG = 0, FALLING = 1;
    let phase = HANG;
    let started = false;

    let ringR = 30, dropR = 8, growRate = 20, wobble = 0;
    let holding = false, inWindowTicked = false;
    let dropY = 0, dropVY = 0, releasedR = 0;
    let streak = 0, best = 0, submittedBest = 0;
    let judgeQueued = null;      // "overflow" when the drop fell of its own weight
    let attractDrop = false;     // this one is the cave dripping, not the player

    const ripples = [];          // { t, amp, speed, rings }
    let jet = null;              // Worthington column + the droplet it throws
    let judge = null;            // { text, t, good }
    let flash = 0;               // surface bloom on impact
    let autoTimer = rand(1.4, 2.6);   // attract-mode drips before first touch

    function newDrop() {
      const U = unit();
      ringR = rand(19, 27) * U;
      dropR = ringR * 0.16;
      growRate = ringR * rand(0.6, 1.05);
      wobble = 0;
      inWindowTicked = false;
      phase = HANG;
    }

    function unit() { return Math.min(ctx.width, ctx.height) / 390; }
    // The far edge of the pool, and the point where the drop actually lands —
    // nearer to us than the horizon, so ripples can spread in both directions
    // across the surface instead of half of them falling off the top of it.
    function horizonY() { return ctx.height * 0.5; }
    function impactY() { const h = horizonY(); return h + (ctx.height - h) * 0.32; }
    function spoutTip() { return Math.max(ctx.safeArea.top + 40, ctx.height * 0.125); }

    function release(auto) {
      releasedR = dropR;
      dropY = spoutTip() + dropR;
      dropVY = 0;
      phase = FALLING;
      judgeQueued = auto ? "overflow" : null;
      attractDrop = !started;
    }

    function impact() {
      const U = unit();
      const overflow = judgeQueued === "overflow";
      const off = Math.abs(releasedR - ringR);
      const perfect = !overflow && off <= ringR * 0.1;
      // acc: how dead-centre within the perfect window. q: the wider curve that
      // shapes a miss's timbre. A perfect release always gets the perfect sound
      // — that is the whole promise of the bit — while acc drives how big the
      // splash looks, so nailing it exactly still reads as better.
      const acc = clamp(1 - off / (ringR * 0.1), 0, 1);
      const q = overflow ? 0.06 : clamp(1 - off / (ringR * 0.26), 0, 1);

      lastPlayerDrop = now();

      if (perfect) {
        drip({ freq: ladderFreq(streak), q: 1, gain: 0.62, wet: 0.5 });
        streak += 1;
        judge = { text: "perfect", t: 0, good: true };
        if (ctx.capabilities.haptics) ctx.platform.haptic("success");
        if (streak > best) {
          best = streak;
          persistBest();
          submitBest();
        }
        if (streak === 3 || streak === 5 || streak === 10 || streak === 15) {
          ctx.platform.milestone("streak_" + streak, { streak });
        }
        jet = { t: 0, h: (26 + 24 * acc) * U, sec: null };
        flash = 1;
      } else {
        // A miss is still a drip — just a duller, shorter, closer one.
        drip({
          freq: ROOT * rand(0.68, 0.86), q: q * 0.72,
          gain: 0.42 + 0.12 * q, wet: 0.2 + 0.15 * q
        });
        if (streak > 0) streak = 0;
        judge = {
          text: overflow ? "overflowed"
            : off <= ringR * 0.26 ? (releasedR < ringR ? "a touch early" : "a touch late")
              : (releasedR < ringR ? "too small" : "too heavy"),
          t: 0, good: false
        };
        if (ctx.capabilities.haptics) ctx.platform.haptic(overflow ? "warning" : "light");
        flash = 0.45 + 0.3 * q;
      }

      ripples.push({
        t: 0, amp: perfect ? 1 : 0.45 + 0.5 * q,
        speed: (150 + 70 * q) * U, rings: perfect ? 4 : 3
      });
      ctx.platform.setScore(best, { streak });
      // offset is a percentage of the ring's radius: 0 is dead on, 10 is the
      // edge of the perfect window, 26 the edge of "a touch early/late".
      ctx.platform.interact({
        type: "drop", perfect, streak,
        offset: Math.round((off / ringR) * 100)
      });
      newDrop();
    }

    // Secondary droplet thrown back up by the collapsing crater — the little
    // "tick" it makes on the way down is the best part of a real drip.
    function jetSplash() {
      ripples.push({ t: 0, amp: 0.3, speed: 110 * unit(), rings: 2 });
      if (audioReady()) {
        drip({ freq: ladderFreq(Math.max(0, streak - 1)) * 1.5, q: 0.7, gain: 0.18, wet: 0.6 });
      }
    }

    // ======================================================================
    // Persistence + leaderboard
    // ======================================================================
    async function persistBest() {
      if (!ctx.capabilities.storage) return;
      try { await ctx.storage.set("best", best); } catch (_) {}
    }
    async function submitBest() {
      if (best <= submittedBest) return;
      submittedBest = best;
      try { await ctx.memory.record("streak").submit(best, { label: best + " in a row" }); }
      catch (_) {}
    }

    // ======================================================================
    // Rendering
    // ======================================================================
    const INK = "#05080d";

    function drawScene() {
      const W = ctx.width, H = ctx.height, U = unit();
      const hy = horizonY(), iy = impactY(), cx = W / 2, tip = spoutTip();

      // --- air ------------------------------------------------------------
      const sky = g.createLinearGradient(0, 0, 0, hy);
      sky.addColorStop(0, "#0a1622");
      sky.addColorStop(0.65, "#06101a");
      sky.addColorStop(1, "#040b13");
      g.fillStyle = sky;
      g.fillRect(0, 0, W, hy);

      // A haze of light hanging around the spout. Edgeless on purpose — a
      // hard-sided shaft reads as a grey triangle, not as air.
      const haze = g.createRadialGradient(cx, hy * 0.42, 0, cx, hy * 0.42, hy * 0.85);
      haze.addColorStop(0, "rgba(150,215,255,0.05)");
      haze.addColorStop(1, "rgba(150,215,255,0)");
      g.fillStyle = haze;
      g.fillRect(0, 0, W, hy);

      // --- pool ------------------------------------------------------------
      const pool = g.createLinearGradient(0, hy, 0, H);
      pool.addColorStop(0, "#0d2434");
      pool.addColorStop(0.3, "#081925");
      pool.addColorStop(1, INK);
      g.fillStyle = pool;
      g.fillRect(0, hy, W, H - hy);

      // light lying on the water just this side of the far edge
      const sheen = g.createLinearGradient(0, hy, 0, hy + 110 * U);
      sheen.addColorStop(0, "rgba(150,220,255,0.12)");
      sheen.addColorStop(1, "rgba(150,220,255,0)");
      g.fillStyle = sheen;
      g.fillRect(0, hy, W, 110 * U);

      g.save();
      g.beginPath(); g.rect(0, hy, W, H - hy); g.clip();
      drawFlash(cx, iy, U);
      drawRipples(cx, iy, U);
      g.restore();

      // the far edge itself
      g.beginPath();
      g.moveTo(0, hy); g.lineTo(W, hy);
      g.strokeStyle = "rgba(175,230,255,0.28)";
      g.lineWidth = 1;
      g.stroke();

      drawSpout(cx, tip, U);
      if (phase === HANG) drawHangingDrop(cx, tip, U);
      if (phase === FALLING) drawFallingDrop(cx, iy, U);
      if (jet) drawJet(cx, iy, U);
      if (judge) drawJudge(cx, iy, U);
    }

    function drawFlash(cx, iy, U) {
      if (flash <= 0.01) return;
      const r = 130 * U * (1 + (1 - flash) * 1.5);
      const bloom = g.createRadialGradient(cx, iy, 0, cx, iy, r);
      bloom.addColorStop(0, "rgba(200,242,255," + (0.36 * flash).toFixed(3) + ")");
      bloom.addColorStop(1, "rgba(200,242,255,0)");
      g.fillStyle = bloom;
      g.fillRect(cx - r, iy - r, r * 2, r * 2);
    }

    function drawRipples(cx, iy, U) {
      const SQ = 0.3;   // vertical squash — we are looking across the pool
      for (const r of ripples) {
        for (let i = 0; i < r.rings; i++) {
          const rt = r.t - i * 0.065;
          if (rt <= 0) continue;
          const rad = rt * r.speed;
          const fade = Math.exp(-rt * 1.25) * Math.exp(-i * 0.42);
          const a = r.amp * fade * clamp(1 - rad / (ctx.width * 1.1), 0, 1);
          if (a <= 0.004) continue;
          const lw = Math.max(0.7, (3.2 - i * 0.45) * U * clamp(1 - rad / (ctx.width * 0.9), 0.3, 1));

          g.beginPath();
          g.ellipse(cx, iy, rad, rad * SQ, 0, 0, Math.PI * 2);
          g.strokeStyle = "rgba(130,210,255," + (a * 0.85).toFixed(4) + ")";
          g.lineWidth = lw;
          g.stroke();

          // light comes from above, so the far lip of each ring catches it
          g.beginPath();
          g.ellipse(cx, iy - lw * 0.8, rad, rad * SQ, 0, Math.PI * 1.06, Math.PI * 1.94);
          g.strokeStyle = "rgba(232,250,255," + (a * 0.8).toFixed(4) + ")";
          g.lineWidth = lw * 0.75;
          g.stroke();
        }
      }
    }

    // Round-bottomed, tapering to a point where it clings to the spout.
    function dropPath(r, stretch) {
      g.beginPath();
      g.arc(0, 0, r, 0, Math.PI);
      g.quadraticCurveTo(-r * 0.6, -r * 1.05 * stretch, 0, -r * 1.95 * stretch);
      g.quadraticCurveTo(r * 0.6, -r * 1.05 * stretch, r, 0);
      g.closePath();
    }

    function fillDrop(r) {
      const dg = g.createRadialGradient(-r * 0.32, -r * 0.3, r * 0.08, 0, 0, r * 1.4);
      dg.addColorStop(0, "rgba(242,253,255,0.98)");
      dg.addColorStop(0.42, "rgba(158,222,250,0.86)");
      dg.addColorStop(1, "rgba(64,136,188,0.5)");
      g.fillStyle = dg;
      g.fill();
    }

    function drawSpout(cx, tip, U) {
      const w = 34 * U;
      g.beginPath();
      g.moveTo(cx - w, 0);
      g.lineTo(cx + w, 0);
      g.lineTo(cx + w * 0.42, tip - 12 * U);
      g.quadraticCurveTo(cx + w * 0.16, tip, cx, tip);
      g.quadraticCurveTo(cx - w * 0.16, tip, cx - w * 0.42, tip - 12 * U);
      g.closePath();
      const st = g.createLinearGradient(cx, 0, cx, tip);
      st.addColorStop(0, "#16222e");
      st.addColorStop(1, "#0a1119");
      g.fillStyle = st;
      g.fill();
      g.strokeStyle = "rgba(150,205,235,0.16)";
      g.lineWidth = 1;
      g.stroke();
    }

    function drawHangingDrop(cx, tip, U) {
      const off = Math.abs(dropR - ringR);
      const inWin = off <= ringR * 0.1;
      const near = clamp(1 - off / (ringR * 0.5), 0, 1);
      const y = tip + dropR * 0.72;

      // Target ring. Fill it exactly and let go.
      const pulse = 0.7 + 0.3 * Math.sin(wobble * 16);
      g.beginPath();
      g.arc(cx, y, ringR, 0, Math.PI * 2);
      g.strokeStyle = inWin
        ? "rgba(255,229,145,0.96)"
        : "rgba(155,218,255," + (0.34 + 0.42 * near).toFixed(3) + ")";
      g.lineWidth = (inWin ? 2.4 : 1.5) * U;
      if (inWin) {
        g.shadowColor = "rgba(255,214,120,0.95)";
        g.shadowBlur = 18 * U * pulse;
      }
      g.stroke();
      g.shadowBlur = 0;

      // The drop, stretching and going pear-shaped as it gets heavy.
      const stretch = 1 + clamp(dropR / ringR, 0, 1.5) * 0.2 + Math.sin(wobble * 9) * 0.02;
      g.save();
      g.translate(cx, y);
      dropPath(dropR, stretch);
      g.shadowColor = inWin ? "rgba(255,224,145,0.9)" : "rgba(140,210,255,0.5)";
      g.shadowBlur = (inWin ? 22 : 11) * U;
      fillDrop(dropR);
      g.restore();
      g.shadowBlur = 0;
    }

    function drawFallingDrop(cx, iy, U) {
      const speed = clamp(dropVY / (900 * U), 0, 1.6);
      g.save();
      g.translate(cx, dropY);
      g.scale(1 / (1 + speed * 0.16), 1 + speed * 0.3);
      dropPath(releasedR, 1 + speed * 0.5);
      g.shadowColor = "rgba(140,210,255,0.55)";
      g.shadowBlur = 11 * U;
      fillDrop(releasedR);
      g.restore();
      g.shadowBlur = 0;

      // A pool of light gathering under the drop as it closes on the water.
      const close = clamp(1 - (iy - dropY) / (140 * U), 0, 1);
      if (close > 0) {
        const r = releasedR * (3 + close * 2);
        const glow = g.createRadialGradient(cx, iy, 0, cx, iy, r);
        glow.addColorStop(0, "rgba(180,235,255," + (0.24 * close).toFixed(3) + ")");
        glow.addColorStop(1, "rgba(180,235,255,0)");
        g.fillStyle = glow;
        g.fillRect(cx - r, iy - r, r * 2, r * 2);
      }
    }

    function drawJet(cx, sy, U) {
      const t = jet.t;
      const rise = Math.sin(clamp(t / 0.22, 0, 1) * Math.PI * 0.5);
      const h = jet.h * rise * (t < 0.22 ? 1 : Math.max(0, 1 - (t - 0.22) / 0.3));
      if (h > 1) {
        const w = 4.5 * U * (1 - t * 0.9);
        g.beginPath();
        g.moveTo(cx - w, sy);
        g.quadraticCurveTo(cx - w * 0.5, sy - h, cx, sy - h - w);
        g.quadraticCurveTo(cx + w * 0.5, sy - h, cx + w, sy);
        g.closePath();
        const jg = g.createLinearGradient(0, sy - h, 0, sy);
        jg.addColorStop(0, "rgba(235,250,255,0.9)");
        jg.addColorStop(1, "rgba(120,190,230,0.15)");
        g.fillStyle = jg;
        g.fill();
      }
      if (jet.sec) {
        g.beginPath();
        g.arc(cx, jet.sec.y, jet.sec.r, 0, Math.PI * 2);
        g.fillStyle = "rgba(232,250,255,0.92)";
        g.shadowColor = "rgba(150,220,255,0.7)";
        g.shadowBlur = 8 * U;
        g.fill();
        g.shadowBlur = 0;
      }
    }

    function drawJudge(cx, sy, U) {
      const a = clamp(1 - judge.t / 1.15, 0, 1);
      if (a <= 0) return;
      const y = sy - (44 + judge.t * 26) * U;
      g.save();
      g.globalAlpha = a;
      g.textAlign = "center";
      g.textBaseline = "middle";
      if (judge.good) {
        g.font = "600 " + (17 * U).toFixed(1) + "px -apple-system,system-ui,sans-serif";
        g.fillStyle = "#ffe08a";
        g.shadowColor = "rgba(255,210,110,0.8)";
        g.shadowBlur = 14 * U;
      } else {
        g.font = "400 " + (14 * U).toFixed(1) + "px -apple-system,system-ui,sans-serif";
        g.fillStyle = "rgba(190,215,235,0.75)";
      }
      g.letterSpacing = "1.5px";
      g.fillText(judge.text, cx, y);
      g.restore();
      g.shadowBlur = 0;
    }

    // ======================================================================
    // Simulation
    // ======================================================================
    function step(dtMs) {
      const dt = Math.min(dtMs, 50) / 1000;
      const U = unit(), sy = impactY();
      wobble += dt;

      if (phase === HANG) {
        if (holding) {
          // Growth eases off as the drop gets heavy, so it rewards watching
          // rather than counting.
          const ease = 1 - 0.35 * clamp(dropR / (ringR * 1.45), 0, 1);
          dropR += growRate * ease * dt;
          const off = Math.abs(dropR - ringR);
          if (!inWindowTicked && off <= ringR * 0.1) {
            inWindowTicked = true;
            if (ctx.capabilities.haptics) ctx.platform.haptic("light");
          }
          if (dropR > ringR * 1.45) release(true);
        } else if (!started) {
          // Attract mode: the cave drips on its own so the first frame moves
          // and the pool is never a dead surface.
          autoTimer -= dt;
          if (autoTimer <= 0) {
            autoTimer = rand(1.8, 3.4);
            dropR = ringR * rand(0.5, 1.2);
            release(false);
          }
        }
      } else {
        dropVY += 2400 * U * dt;
        dropY += dropVY * dt;
        if (dropY >= sy) {
          if (!attractDrop) impact();
          else {
            // Silent attract drop — visuals only, audio is still locked.
            ripples.push({ t: 0, amp: 0.5, speed: 150 * U, rings: 3 });
            flash = 0.7;
            newDrop();
          }
        }
      }

      for (let i = ripples.length - 1; i >= 0; i--) {
        ripples[i].t += dt;
        if (ripples[i].t > 3) ripples.splice(i, 1);
      }
      if (flash > 0) flash = Math.max(0, flash - dt * 2.6);
      if (judge) { judge.t += dt; if (judge.t > 1.2) judge = null; }

      if (jet) {
        jet.t += dt;
        if (!jet.sec && jet.t >= 0.2) {
          jet.sec = { y: sy - jet.h, vy: -jet.h * 2.6, r: 3.4 * U };
        }
        if (jet.sec) {
          jet.sec.vy += 1600 * U * dt;
          jet.sec.y += jet.sec.vy * dt;
          if (jet.sec.y >= sy) { jetSplash(); jet = null; }
        } else if (jet.t > 0.6) jet = null;
      }
    }

    // ======================================================================
    // Input
    // ======================================================================
    function press(e) {
      if (e.cancelable) e.preventDefault();
      if (panelOpen()) return;
      unlockAudio();
      if (!started) {
        started = true;
        ctx.platform.start();
        hideHint();
      }
      // Held even mid-fall: the next drop starts swelling the instant this one
      // lands, so you can settle into a rhythm without waiting for the splash.
      holding = true;
    }
    function lift(e) {
      if (e && e.cancelable) e.preventDefault();
      if (!holding) return;
      holding = false;
      if (phase === HANG) release(false);
    }

    if (window.PointerEvent) {
      ctx.listen(canvas, "pointerdown", press, { passive: false });
      ctx.listen(window, "pointerup", lift, { passive: false });
      ctx.listen(window, "pointercancel", lift, { passive: false });
    } else {
      ctx.listen(canvas, "touchstart", press, { passive: false });
      ctx.listen(window, "touchend", lift, { passive: false });
      ctx.listen(window, "touchcancel", lift, { passive: false });
      ctx.listen(canvas, "mousedown", press, { passive: false });
      ctx.listen(window, "mouseup", lift, { passive: false });
    }

    // ======================================================================
    // Overlay UI — everything sits up top; the pool and the bottom safe area
    // stay clear so the money shot is never under a thumb.
    // ======================================================================
    const esc = (s) => String(s).replace(/[&<>"]/g,
      (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
    const FONT = "-apple-system,system-ui,'Segoe UI',sans-serif";

    const hud = document.createElement("div");
    hud.style.cssText =
      "position:absolute;left:14px;top:" + (ctx.safeArea.top + 12) + "px;pointer-events:none;" +
      "font-family:" + FONT + ";color:#cfe8fb;text-shadow:0 1px 6px rgba(0,0,0,0.7);";
    ui.appendChild(hud);

    const btnRow = document.createElement("div");
    btnRow.style.cssText =
      "position:absolute;right:12px;top:" + (ctx.safeArea.top + 10) + "px;" +
      "display:flex;gap:8px;pointer-events:none;";
    ui.appendChild(btnRow);

    function mkBtn(label, onTap) {
      const b = document.createElement("button");
      b.textContent = label;
      b.style.cssText =
        "pointer-events:auto;width:38px;height:38px;border-radius:12px;border:none;cursor:pointer;" +
        "background:rgba(20,38,54,0.66);color:#dcf0ff;font-size:16px;line-height:1;" +
        "backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);" +
        "box-shadow:0 2px 10px rgba(0,0,0,0.4);font-family:" + FONT + ";";
      ctx.listen(b, "pointerdown", (e) => { e.stopPropagation(); });
      ctx.listen(b, "click", (e) => { e.stopPropagation(); onTap(b); });
      btnRow.appendChild(b);
      return b;
    }

    const muteBtn = mkBtn("🔊", (b) => {
      muted = !muted;
      b.textContent = muted ? "🔇" : "🔊";
      if (roomNode && ac) {
        try { roomNode.gain.value = muted ? 0 : 0.028; } catch (_) {}
      }
      if (!muted) unlockAudio();
    });
    mkBtn("🏆", () => openBoard());
    mkBtn("?", () => openHelp());

    function updateHud() {
      hud.innerHTML =
        '<div style="font-size:26px;font-weight:700;letter-spacing:0.5px;line-height:1;">' +
        streak + '<span style="font-size:13px;font-weight:500;opacity:0.6;"> in a row</span></div>' +
        '<div style="font-size:12px;opacity:0.55;margin-top:5px;letter-spacing:0.4px;">best ' + best + "</div>";
    }

    // Hint that fades once they get it
    const hint = document.createElement("div");
    hint.style.cssText =
      "position:absolute;left:0;right:0;bottom:" + (ctx.safeArea.bottom + 34) + "px;text-align:center;" +
      "padding:0 20px;pointer-events:none;font-family:" + FONT + ";color:rgba(205,232,250,0.82);" +
      "font-size:13px;letter-spacing:0.2px;text-shadow:0 1px 8px rgba(0,0,0,0.8);transition:opacity 0.7s;";
    hint.textContent = "hold — let go when the drop fills the ring";
    ui.appendChild(hint);
    function hideHint() {
      ctx.timeout(() => { hint.style.opacity = "0"; }, 2600);
    }

    const toastEl = document.createElement("div");
    toastEl.style.cssText =
      "position:absolute;left:50%;transform:translateX(-50%);top:" + (ctx.safeArea.top + 62) + "px;" +
      "pointer-events:none;font-family:" + FONT + ";font-size:13px;color:#eaf6ff;opacity:0;" +
      "background:rgba(14,28,40,0.85);padding:8px 14px;border-radius:999px;transition:opacity 0.35s;";
    ui.appendChild(toastEl);
    function toast(msg) {
      toastEl.textContent = msg;
      toastEl.style.opacity = "1";
      ctx.timeout(() => { toastEl.style.opacity = "0"; }, 2800);
    }

    // ---- panels -----------------------------------------------------------
    const panel = document.createElement("div");
    panel.style.cssText =
      "position:absolute;inset:0;display:none;align-items:center;justify-content:center;" +
      "padding:22px;pointer-events:auto;background:rgba(3,8,14,0.78);" +
      "backdrop-filter:blur(3px);-webkit-backdrop-filter:blur(3px);";
    ui.appendChild(panel);
    ctx.listen(panel, "pointerdown", (e) => { e.stopPropagation(); });
    ctx.listen(panel, "click", (e) => { if (e.target === panel) closePanel(); });
    const panelOpen = () => panel.style.display !== "none";
    function closePanel() { panel.style.display = "none"; panel.innerHTML = ""; }

    function panelBox(html) {
      panel.innerHTML = "";
      const box = document.createElement("div");
      box.style.cssText =
        "width:100%;max-width:330px;max-height:78%;overflow:auto;padding:22px;border-radius:20px;" +
        "background:rgba(16,32,46,0.97);color:#e6f4ff;box-shadow:0 14px 44px rgba(0,0,0,0.6);" +
        "font-family:" + FONT + ";font-size:15px;line-height:1.6;";
      box.innerHTML = html +
        '<div style="text-align:center;margin-top:18px;opacity:0.5;font-size:12.5px;">Tap outside to close</div>';
      panel.appendChild(box);
      panel.style.display = "flex";
      return box;
    }

    function openHelp() {
      holding = false;
      if (ctx.capabilities.haptics) ctx.platform.haptic("light");
      panelBox(
        '<div style="font-size:19px;font-weight:700;margin-bottom:12px;">Perfect Drop 💧</div>' +
        '<ul style="margin:0;padding-left:19px;">' +
        "<li><b>Hold anywhere</b> — a drop swells on the spout.</li>" +
        "<li><b>Let go</b> the moment the drop fills the ring.</li>" +
        "<li>A perfect release makes a <b>perfect plink</b>. A rushed one lands dull and flat — you can hear the difference.</li>" +
        "<li>Every perfect drop in a row <b>climbs one note</b>.</li>" +
        "<li>Miss, and the ladder goes back to the bottom.</li>" +
        "<li>Hold too long and the drop overflows on its own.</li>" +
        "</ul>" +
        '<div style="margin-top:14px;opacity:0.65;font-size:13.5px;">Best with headphones, somewhere quiet.</div>'
      );
    }

    const bArr = (o) => !o ? [] : Array.isArray(o) ? o
      : (o.entries || o.rows || o.items || o.leaderboard || o.results ||
        (o.data && (o.data.entries || o.data.rows)) || []);
    const bSelf = (e) => !!(e && (e.self || e.isSelf || e.me || e.you || e.mine || e.isViewer || e.viewer));
    const bName = (e) => e.name || e.displayName || e.handle || e.username ||
      (e.user && (e.user.name || e.user.displayName || e.user.handle || e.user.username)) ||
      (bSelf(e) ? "You" : "Player");
    const bVal = (e) => e.label || e.formatted || e.valueLabel || e.display ||
      (e.value != null ? String(e.value) : "—");
    const bRank = (e, i) => e.rank != null ? e.rank : (e.position != null ? e.position : i + 1);
    function bRow(rank, name, val, self) {
      return '<div style="display:flex;align-items:center;gap:10px;padding:8px 9px;border-radius:10px;' +
        (self ? "background:rgba(255,224,138,0.16);" : "") + '">' +
        '<div style="width:24px;text-align:right;font-weight:800;opacity:0.7;">' + esc(rank) + "</div>" +
        '<div style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600;color:' +
        (self ? "#ffe08a" : "#e6f4ff") + ';">' + esc(name) + "</div>" +
        '<div style="flex:0 0 auto;font-variant-numeric:tabular-nums;font-weight:700;">' + esc(val) + "</div></div>";
    }
    function renderBoard(lb) {
      const arr = bArr(lb);
      if (!arr.length) return '<div style="opacity:0.8;text-align:center;padding:14px 0;">No streaks yet — be the first 💧</div>';
      const top = arr.slice(0, 8);
      let html = top.map((e, i) => bRow(bRank(e, i), bName(e), bVal(e), bSelf(e))).join("");
      const selfEntry = (lb && (lb.you || lb.self || lb.viewer || lb.me)) || arr.find(bSelf);
      if (selfEntry && !top.some(bSelf)) {
        html += '<div style="height:1px;background:rgba(255,255,255,0.12);margin:8px 2px;"></div>' +
          bRow(bRank(selfEntry, arr.indexOf(selfEntry)), bName(selfEntry), bVal(selfEntry), true);
      }
      return '<div style="display:flex;flex-direction:column;gap:2px;">' + html + "</div>";
    }

    async function openBoard() {
      holding = false;
      if (ctx.capabilities.haptics) ctx.platform.haptic("light");
      const head =
        '<div style="font-size:19px;font-weight:700;">🏆 Perfect Streak</div>' +
        '<div style="opacity:0.55;font-size:12.5px;margin-bottom:14px;">Global · all time</div>';
      const box = panelBox(head + '<div style="opacity:0.8;padding:8px 0;">Loading…</div>');
      let inner;
      try {
        const lb = await ctx.memory.record("streak").leaderboard({ scope: "global", period: "all_time" });
        inner = renderBoard(lb);
      } catch (_) {
        inner = '<div style="opacity:0.8;text-align:center;padding:12px 0;">Leaderboard isn\'t available right now.</div>';
      }
      if (!panelOpen()) return;
      box.innerHTML = head + inner +
        '<div style="text-align:center;margin-top:18px;opacity:0.5;font-size:12.5px;">Tap outside to close</div>';
    }

    // ======================================================================
    // Boot — draw a live frame before telling the host we are ready.
    // ======================================================================
    newDrop();
    dropR = ringR * 0.55;
    if (ctx.capabilities.storage) {
      try {
        const saved = await ctx.storage.get("best");
        if (typeof saved === "number" && saved > 0) { best = saved; submittedBest = saved; }
      } catch (_) {}
    }
    updateHud();

    let hudStreak = -1, hudBest = -1;
    ctx.onFrame((dtMs) => {
      step(dtMs);
      drawScene();
      if (streak !== hudStreak || best !== hudBest) {
        hudStreak = streak; hudBest = best;
        updateHud();
      }
    });

    drawScene();
    ctx.markVisualReady("first-pool");
    scheduleDistant();
    ctx.platform.ready();
  }
};
