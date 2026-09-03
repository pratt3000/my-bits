/**
 * Unbreakable — tie a knot, and find out whether it is one.
 *
 * Rakshabandhan is a bond you make out of string, so this bit takes that
 * literally: tie a knot in a real rope, close it into a loop the way a rakhi is
 * a loop, and then let physics and knot theory decide together whether what you
 * tied can be undone.
 *
 * The rope is a Verlet chain with distance constraints and genuine
 * self-collision — it cannot pass through itself, which is the whole point.
 * Drag any part of it; the section under your finger lifts toward you or dives
 * away depending on the OVER/UNDER switch, so you author the crossings yourself
 * rather than hoping the simulation guesses right.
 *
 * Closing the loop starts the proof, and the proof is the tightening. Rest
 * lengths shrink; an unknotted loop has nowhere to hide and collapses into a
 * clean ring, while a real knot jams against itself and stops. That is not an
 * animation of a result — it is the result, happening.
 *
 * Then the diagram is read off the settled rope:
 *
 *   1. Project to the plane, find every crossing between non-adjacent segments,
 *      record which strand is nearer the camera and the sign of the crossing.
 *   2. Walk the rope to build the Gauss code.
 *   3. Reduce it with Reidemeister I (a kink: the same crossing twice in a row)
 *      and Reidemeister II (two crossings that can be slid apart), repeatedly,
 *      until nothing more comes out.
 *   4. Identify what is left by crossing number and p-colourability — solve
 *      2*over - under1 - under2 = 0 (mod p) over the arcs by Gaussian
 *      elimination, and the nullity says whether it is p-colourable.
 *
 * Which is enough to tell the unknot from the trefoil from the figure-eight
 * from the cinquefoil from the three-twist, and to be honest about anything
 * bigger by naming its crossing number instead of guessing.
 *
 * Renderer: three@0.164.1 (ES module via ctx.importModule). Every texture and
 * every sound is generated in-file — packaged assets are disabled.
 */
window.plethoraBit = {
  meta: {
    title: "Unbreakable",
    runtime: "plethora-bit@2",
    tags: ["3d", "puzzle", "physics", "maths", "art"],
    permissions: ["audio", "backgroundMusic", "haptics", "storage"]
  },

  async init(ctx) {
    // ===================================================================== //
    // 0. Helpers                                                            //
    // ===================================================================== //
    const TAU = Math.PI * 2;
    const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
    const lerp = (a, b, t) => a + (b - a) * t;
    const rnd = (a, b) => a + Math.random() * (b - a);

    const CAN_BAKE = typeof OffscreenCanvas === "function";
    function surface(w, h) {
      w = Math.max(1, w | 0); h = Math.max(1, h | 0);
      if (CAN_BAKE) {
        try { return new OffscreenCanvas(w, h); } catch (_) { /* fall through */ }
      }
      const c = ctx.createCanvas2D();
      c.style.display = "none";
      c.width = w; c.height = h;
      return c;
    }

    // ===================================================================== //
    // 1. First frame                                                        //
    // ===================================================================== //
    const view = ctx.createCanvas({ touchAction: "none" });
    const ui = ctx.createRoot({ touchAction: "none" });
    ui.style.zIndex = "4";
    ui.style.pointerEvents = "none";

    const SAFE_T = Math.max((ctx.safeArea && ctx.safeArea.top) || 0, 8);
    const SAFE_B = Math.max((ctx.safeArea && ctx.safeArea.bottom) || 0, 10);

    const INK = "#f6ead6";
    const DIM = "rgba(246,234,214,0.56)";
    const GOLD = "#f3c65e";
    const FONT = "Inter,-apple-system,BlinkMacSystemFont,'Segoe UI','Noto Sans Devanagari',sans-serif";

    ui.innerHTML =
      '<div style="position:absolute;inset:0;overflow:hidden;pointer-events:none;font-family:' + FONT + ';' +
      '-webkit-user-select:none;user-select:none;-webkit-tap-highlight-color:transparent;color:' + INK + ';">' +

      '<div data-el="top" style="position:absolute;left:0;right:0;top:' + (SAFE_T + 6) + 'px;padding:0 18px;' +
      'display:flex;align-items:flex-start;justify-content:space-between;gap:10px;transition:opacity 400ms ease;">' +
        '<div>' +
          '<div style="font-size:19px;font-weight:700;letter-spacing:0.3px;line-height:1.05;">Unbreakable</div>' +
          '<div style="font-size:11px;letter-spacing:1.6px;color:' + DIM + ';margin-top:3px;">गाँठ</div>' +
        '</div>' +
        '<div style="display:flex;align-items:center;gap:9px;">' +
          '<div data-el="cross" style="font-size:12px;letter-spacing:1.1px;color:' + INK + ';' +
          'padding:7px 11px;border-radius:13px;background:rgba(22,12,10,0.6);' +
          'border:1px solid rgba(243,198,94,0.25);transition:opacity 300ms ease;">0 crossings</div>' +
          '<button data-el="help" style="pointer-events:auto;width:34px;height:34px;border-radius:17px;' +
          'border:1px solid rgba(243,198,94,0.45);background:rgba(22,12,10,0.55);color:' + GOLD + ';' +
          'font-size:15px;font-weight:600;font-family:inherit;padding:0;">?</button>' +
        '</div>' +
      '</div>' +

      // the verdict
      '<div data-el="card" style="position:absolute;left:18px;right:18px;top:' + (SAFE_T + 54) + 'px;' +
      'text-align:center;opacity:0;transition:opacity 500ms ease;pointer-events:none;">' +
        '<div data-el="cardname" style="font-size:29px;font-weight:800;letter-spacing:0.5px;line-height:1.1;"></div>' +
        '<div data-el="cardsub" style="font-size:12.5px;letter-spacing:1.4px;text-transform:uppercase;' +
        'color:' + DIM + ';margin-top:8px;"></div>' +
        '<div data-el="cardnote" style="font-size:13px;line-height:1.5;color:rgba(246,234,214,0.8);' +
        'margin-top:12px;max-width:300px;margin-left:auto;margin-right:auto;"></div>' +
      '</div>' +

      '<div data-el="bottom" style="position:absolute;left:0;right:0;bottom:' + (SAFE_B + 14) + 'px;' +
      'padding:0 16px;display:flex;flex-direction:column;align-items:center;gap:11px;">' +
        '<div data-el="hint" style="font-size:12.5px;letter-spacing:0.4px;color:' + DIM + ';text-align:center;' +
        'transition:opacity 300ms ease;">drag the rope across itself</div>' +

        '<button data-el="ou" style="pointer-events:auto;display:flex;align-items:center;justify-content:center;' +
        'gap:9px;height:52px;padding:0 22px;border-radius:26px;border:1px solid rgba(243,198,94,0.5);' +
        'background:rgba(243,198,94,0.14);color:' + INK + ';font-size:15px;font-weight:700;font-family:inherit;">' +
          '<span data-el="ouicon" style="font-size:17px;">↑</span><span data-el="outext">passing OVER</span>' +
        '</button>' +

        '<button data-el="close" style="pointer-events:auto;display:none;width:100%;max-width:320px;height:52px;' +
        'border-radius:26px;border:0;background:' + GOLD + ';color:#2a1606;font-size:16px;font-weight:700;' +
        'font-family:inherit;box-shadow:0 8px 26px rgba(243,198,94,0.3);">Close the loop</button>' +

        '<div data-el="endrow" style="display:none;gap:10px;width:100%;max-width:340px;">' +
          '<button data-el="again" style="pointer-events:auto;flex:1.3;height:48px;border-radius:24px;border:0;' +
          'background:' + GOLD + ';color:#2a1606;font-size:14.5px;font-weight:700;font-family:inherit;">Tie another</button>' +
          '<button data-el="board" style="pointer-events:auto;flex:1;height:48px;border-radius:24px;' +
          'border:1px solid rgba(246,234,214,0.3);background:rgba(22,12,10,0.55);color:' + INK + ';' +
          'font-size:14.5px;font-weight:600;font-family:inherit;">Knots</button>' +
        '</div>' +
      '</div>' +

      '<div data-el="sheet" style="position:absolute;inset:0;display:none;pointer-events:auto;' +
      'background:rgba(9,5,4,0.92);-webkit-backdrop-filter:blur(9px);backdrop-filter:blur(9px);' +
      'align-items:center;justify-content:center;padding:26px;">' +
        '<div data-el="sheetbody" style="max-width:335px;width:100%;"></div>' +
      '</div>' +

      '<div data-el="curtain" style="position:absolute;inset:0;pointer-events:auto;display:flex;' +
      'align-items:center;justify-content:center;flex-direction:column;gap:16px;' +
      'background:radial-gradient(120% 90% at 50% 42%, #43171b 0%, #200a0c 55%, #0a0405 100%);">' +
        '<div style="font-size:30px;font-weight:700;letter-spacing:0.5px;">Unbreakable</div>' +
        '<div style="font-size:12px;letter-spacing:2.4px;text-transform:uppercase;color:' + DIM + ';">' +
        'laying out the rope</div>' +
      '</div>' +
      '</div>';

    const el = (n) => ui.querySelector('[data-el="' + n + '"]');
    const nodes = {
      top: el("top"), cross: el("cross"), help: el("help"),
      card: el("card"), cardname: el("cardname"), cardsub: el("cardsub"), cardnote: el("cardnote"),
      hint: el("hint"), ou: el("ou"), ouicon: el("ouicon"), outext: el("outext"),
      close: el("close"), endrow: el("endrow"), again: el("again"), board: el("board"),
      sheet: el("sheet"), sheetbody: el("sheetbody"), curtain: el("curtain")
    };

    ctx.markVisualReady("title");
    ctx.platform.ready();

    // ===================================================================== //
    // 2. Sound                                                              //
    // ===================================================================== //
    const AC = (window.AudioContext || window.webkitAudioContext) || null;
    const canAudio = !!AC && ctx.capabilities.audio !== false;
    const canMusic = ctx.capabilities.backgroundMusic !== false;
    let ac = null, master = null, verb = null, bus = null;
    let rubGain = null, rubFilter = null, rubSrc = null, droneGain = null;
    let creakGain = null, creakFilter = null, creakSrc = null;
    let muted = false;

    function noiseBuffer(seconds, brown) {
      const sr = ac.sampleRate;
      const len = Math.ceil(sr * seconds);
      const buf = ac.createBuffer(1, len, sr);
      const d = buf.getChannelData(0);
      let lp = 0;
      for (let i = 0; i < len; i++) {
        const w = Math.random() * 2 - 1;
        if (brown) { lp += (w - lp) * 0.18; d[i] = lp * 2.6; } else d[i] = w;
      }
      return buf;
    }

    function startAudio() {
      if (ac || !canAudio) return;
      try { ac = new AC(); } catch (_) { ac = null; return; }

      master = ac.createGain();
      master.gain.value = 0;
      master.connect(ac.destination);
      master.gain.setTargetAtTime(0.88, ac.currentTime, 1.1);

      // One delay in the feedback path, so the loop gain is exactly this and
      // the network cannot run away.
      verb = ac.createGain();
      verb.gain.value = 0.4;
      const dl = ac.createDelay(1.0);
      dl.delayTime.value = 0.187;
      const fb = ac.createGain();
      fb.gain.value = 0.46;
      const damp = ac.createBiquadFilter();
      damp.type = "lowpass";
      damp.frequency.value = 2200;
      verb.connect(dl); dl.connect(damp); damp.connect(fb); fb.connect(dl);
      damp.connect(master);

      bus = ac.createGain();
      bus.gain.value = 1;
      bus.connect(master);
      bus.connect(verb);

      // rope sliding on rope
      rubSrc = ac.createBufferSource();
      rubSrc.buffer = noiseBuffer(3, true);
      rubSrc.loop = true;
      rubFilter = ac.createBiquadFilter();
      rubFilter.type = "bandpass";
      rubFilter.frequency.value = 760;
      rubFilter.Q.value = 0.8;
      rubGain = ac.createGain();
      rubGain.gain.value = 0;
      rubSrc.connect(rubFilter); rubFilter.connect(rubGain); rubGain.connect(master);
      try { rubSrc.start(); } catch (_) {}

      // the groan of a rope under load, used while it tightens
      creakSrc = ac.createBufferSource();
      creakSrc.buffer = noiseBuffer(3, true);
      creakSrc.loop = true;
      creakFilter = ac.createBiquadFilter();
      creakFilter.type = "bandpass";
      creakFilter.frequency.value = 220;
      creakFilter.Q.value = 7;
      creakGain = ac.createGain();
      creakGain.gain.value = 0;
      creakSrc.connect(creakFilter); creakFilter.connect(creakGain); creakGain.connect(master);
      try { creakSrc.start(); } catch (_) {}

      droneGain = ac.createGain();
      droneGain.gain.value = 0;
      const df = ac.createBiquadFilter();
      df.type = "lowpass";
      df.frequency.value = 380;
      droneGain.connect(df); df.connect(master);
      for (const [f, a, d] of [[55, 0.5, 0], [82.4, 0.3, 4], [110, 0.18, -5]]) {
        const o = ac.createOscillator();
        o.type = "sine"; o.frequency.value = f; o.detune.value = d;
        const g = ac.createGain(); g.gain.value = a;
        o.connect(g); g.connect(droneGain);
        try { o.start(); } catch (_) {}
      }
      droneGain.gain.setTargetAtTime(0.07, ac.currentTime, 2.5);
    }

    function resumeAudio() {
      if (!ac) { startAudio(); return; }
      if (ac.state === "suspended") { try { ac.resume(); } catch (_) {} }
    }

    // a small wooden tick, one per new crossing, climbing as they stack up
    function tick(n) {
      if (!ac || muted) return;
      const t = ac.currentTime;
      const f = 300 * Math.pow(2, Math.min(n, 12) / 12);
      const o = ac.createOscillator();
      o.type = "triangle";
      o.frequency.setValueAtTime(f * 1.6, t);
      o.frequency.exponentialRampToValueAtTime(f, t + 0.05);
      const g = ac.createGain();
      g.gain.setValueAtTime(0.14, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
      o.connect(g); g.connect(bus);
      o.start(t); o.stop(t + 0.2);
    }

    function snap() {
      if (!ac || muted) return;
      const t = ac.currentTime;
      const n = ac.createBufferSource();
      n.buffer = noiseBuffer(0.12, false);
      const f = ac.createBiquadFilter();
      f.type = "bandpass"; f.frequency.value = 1900; f.Q.value = 1.2;
      const g = ac.createGain();
      g.gain.setValueAtTime(0.3, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.13);
      n.connect(f); f.connect(g); g.connect(master);
      n.start(t); n.stop(t + 0.15);
    }

    // a struck gong: many inharmonic partials, the high ones dying first
    const GONG = [[1, 1, 6], [1.52, 0.6, 4.2], [2.13, 0.45, 3.2], [2.97, 0.3, 2.2],
                  [4.1, 0.2, 1.5], [5.4, 0.12, 1.0], [7.2, 0.07, 0.7]];
    function gong(freq, gain) {
      if (!ac || muted) return;
      const t = ac.currentTime;
      const out = ac.createGain();
      out.gain.value = gain;
      out.connect(bus); out.connect(verb);
      for (const [mult, amp, life] of GONG) {
        const o = ac.createOscillator();
        o.type = "sine";
        o.frequency.value = freq * mult * (1 + rnd(-0.005, 0.005));
        const g = ac.createGain();
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(amp, t + 0.006);
        g.gain.exponentialRampToValueAtTime(0.0001, t + life);
        o.connect(g); g.connect(out);
        o.start(t); o.stop(t + life + 0.1);
      }
      const n = ac.createBufferSource();
      n.buffer = noiseBuffer(0.1, false);
      const nf = ac.createBiquadFilter();
      nf.type = "bandpass"; nf.frequency.value = freq * 4; nf.Q.value = 1.1;
      const ng = ac.createGain();
      ng.gain.setValueAtTime(gain * 0.6, t);
      ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.11);
      n.connect(nf); nf.connect(ng); ng.connect(bus);
      n.start(t); n.stop(t + 0.12);
    }

    // the sound of a loop giving up: a tone that slides down and lets go
    function slump() {
      if (!ac || muted) return;
      const t = ac.currentTime;
      const o = ac.createOscillator();
      o.type = "sine";
      o.frequency.setValueAtTime(330, t);
      o.frequency.exponentialRampToValueAtTime(88, t + 0.8);
      const g = ac.createGain();
      g.gain.setValueAtTime(0.18, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
      o.connect(g); g.connect(bus); g.connect(verb);
      o.start(t); o.stop(t + 1);
      const n = ac.createBufferSource();
      n.buffer = noiseBuffer(0.7, true);
      const nf = ac.createBiquadFilter();
      nf.type = "lowpass";
      nf.frequency.setValueAtTime(1400, t);
      nf.frequency.exponentialRampToValueAtTime(300, t + 0.6);
      const ng = ac.createGain();
      ng.gain.setValueAtTime(0.1, t);
      ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.7);
      n.connect(nf); nf.connect(ng); ng.connect(master);
      n.start(t); n.stop(t + 0.75);
    }

    let rubAt = 0, rubFreqSm = 760;
    function setRub(level) {
      if (!ac || muted || !rubGain) return;
      const t = ac.currentTime;
      rubFreqSm += (620 + level * 1500 - rubFreqSm) * 0.2;
      if (t - rubAt < 0.08) return;
      rubAt = t;
      rubGain.gain.setTargetAtTime(0.035 * level, t, 0.07);
      rubFilter.frequency.value = rubFreqSm;
    }

    let creakAt = 0, creakFreqSm = 220;
    function setCreak(level, pitch) {
      if (!ac || muted || !creakGain) return;
      const t = ac.currentTime;
      creakFreqSm += (180 + pitch * 420 - creakFreqSm) * 0.15;
      if (t - creakAt < 0.09) return;
      creakAt = t;
      creakGain.gain.setTargetAtTime(0.07 * level, t, 0.12);
      creakFilter.frequency.value = creakFreqSm;
    }

    function sting(name) {
      if (ac || muted || !canMusic || !ctx.music || !ctx.music.sting) return;
      try { ctx.music.sting(name); } catch (_) {}
    }

    ctx.onDestroy(() => {
      try { if (rubSrc) rubSrc.stop(); } catch (_) {}
      try { if (creakSrc) creakSrc.stop(); } catch (_) {}
      try { if (ac) ac.close(); } catch (_) {}
      try { ctx.music.stop({ fadeOutMs: 400 }); } catch (_) {}
    });

    // ===================================================================== //
    // 3. Three, and the rope                                                //
    // ===================================================================== //
    const THREE_URL = "https://libs.plethora.studio/three/0.164.1/three.module.js";
    let THREE = null;
    try {
      THREE = await ctx.importModule("three", "0.164.1");
    } catch (_) {
      try { THREE = await ctx.importModule(THREE_URL); } catch (e2) { THREE = null; }
    }

    if (!THREE) {
      nodes.curtain.innerHTML =
        '<div style="text-align:center;padding:30px;font-family:' + FONT + ';color:' + INK + ';">' +
        '<div style="font-size:19px;font-weight:700;margin-bottom:10px;">Unbreakable</div>' +
        '<div style="font-size:13.5px;line-height:1.6;opacity:0.8;">This bit needs 3D, and it could not ' +
        'start here. Try opening it again in the Plethora app.</div></div>';
      ctx.platform.error({ where: "three_import" });
      return;
    }

    let W = Math.max(1, ctx.width), H = Math.max(1, ctx.height);

    const renderer = new THREE.WebGLRenderer({ canvas: view, antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(ctx.nativeDpr || window.devicePixelRatio || 1, 2));
    renderer.setSize(W, H, false);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(46, W / H, 0.1, 120);
    ctx.onDestroy(() => { try { renderer.dispose(); } catch (_) {} });

    // ---- textures -----------------------------------------------------------
    function bakeGlow(size, hardness, r, g, b) {
      const cv = surface(size, size);
      if (!cv) return null;
      const g2 = cv.getContext("2d");
      const img = g2.createImageData(size, size);
      const d = img.data;
      const c = (size - 1) / 2;
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const dx = (x - c) / c, dy = (y - c) / c;
          const rad = Math.sqrt(dx * dx + dy * dy);
          const i = (y * size + x) * 4;
          d[i] = r; d[i + 1] = g; d[i + 2] = b;
          d[i + 3] = Math.round(Math.pow(Math.max(0, 1 - rad), hardness) * 255);
        }
      }
      g2.putImageData(img, 0, 0);
      const t = new THREE.CanvasTexture(cv);
      t.colorSpace = THREE.SRGBColorSpace;
      t.needsUpdate = true;
      return t;
    }

    // a ring, for marking a crossing
    function bakeRing(size, inner, outer) {
      const cv = surface(size, size);
      if (!cv) return null;
      const g2 = cv.getContext("2d");
      const img = g2.createImageData(size, size);
      const d = img.data;
      const c = (size - 1) / 2;
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const dx = (x - c) / c, dy = (y - c) / c;
          const rad = Math.sqrt(dx * dx + dy * dy);
          const band = Math.min((rad - inner) / 0.14, (outer - rad) / 0.14);
          const a = clamp(band, 0, 1);
          const i = (y * size + x) * 4;
          d[i] = 255; d[i + 1] = 245; d[i + 2] = 225;
          d[i + 3] = Math.round(a * 255);
        }
      }
      g2.putImageData(img, 0, 0);
      const t = new THREE.CanvasTexture(cv);
      t.colorSpace = THREE.SRGBColorSpace;
      t.needsUpdate = true;
      return t;
    }

    // the twist of a laid rope, as a normal map
    function bakeRopeNormal(size) {
      const cv = surface(size, size);
      if (!cv) return null;
      const g2 = cv.getContext("2d");
      const img = g2.createImageData(size, size);
      const d = img.data;
      const hf = new Float32Array(size * size);
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          // three strands laid in a helix, plus fibre
          const s = Math.sin((x * 3 + y * 1.0) * (TAU / size) * 3);
          const f = Math.sin((x * 1 - y * 4) * (TAU / size) * 11) * 0.18;
          hf[y * size + x] = s + f;
        }
      }
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const l = hf[y * size + ((x - 1 + size) % size)];
          const r = hf[y * size + ((x + 1) % size)];
          const u = hf[((y - 1 + size) % size) * size + x];
          const dn = hf[((y + 1) % size) * size + x];
          let nx = (l - r) * 1.5, ny = (u - dn) * 1.5, nz = 1;
          const inv = 1 / Math.sqrt(nx * nx + ny * ny + nz * nz);
          const i = (y * size + x) * 4;
          d[i] = (nx * inv * 0.5 + 0.5) * 255;
          d[i + 1] = (ny * inv * 0.5 + 0.5) * 255;
          d[i + 2] = (nz * inv * 0.5 + 0.5) * 255;
          d[i + 3] = 255;
        }
      }
      g2.putImageData(img, 0, 0);
      const t = new THREE.CanvasTexture(cv);
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.needsUpdate = true;
      return t;
    }

    function bakeRoom() {
      const w = 512, h = 256;
      const cv = surface(w, h);
      if (!cv) return null;
      const g2 = cv.getContext("2d");
      const grad = g2.createLinearGradient(0, 0, 0, h);
      grad.addColorStop(0, "#2a0d12");
      grad.addColorStop(0.4, "#4a1a18");
      grad.addColorStop(0.72, "#1d0a0b");
      grad.addColorStop(1, "#070304");
      g2.fillStyle = grad;
      g2.fillRect(0, 0, w, h);
      const lamp = (cx, cy, r, inner, mid) => {
        for (const ox of [-w, 0, w]) {
          const rg = g2.createRadialGradient(cx + ox, cy, 1, cx + ox, cy, r);
          rg.addColorStop(0, inner);
          rg.addColorStop(0.45, mid);
          rg.addColorStop(1, "rgba(0,0,0,0)");
          g2.fillStyle = rg;
          g2.fillRect(0, 0, w, h);
        }
      };
      lamp(w * 0.28, h * 0.3, w * 0.2, "#ffd7a0", "#7a4726");
      lamp(w * 0.72, h * 0.36, w * 0.14, "#ff9d6a", "#5a2a1c");
      lamp(w * 0.5, h * 0.75, w * 0.18, "#3d3f6b", "#161528");
      const t = new THREE.CanvasTexture(cv);
      t.mapping = THREE.EquirectangularReflectionMapping;
      t.colorSpace = THREE.SRGBColorSpace;
      t.minFilter = THREE.LinearFilter;
      t.generateMipmaps = false;
      return t;
    }

    const texGlow = bakeGlow(64, 2.4, 255, 220, 170);
    const texRing = bakeRing(64, 0.5, 0.92);
    const texRope = bakeRopeNormal(128);
    const roomTex = bakeRoom();

    scene.background = new THREE.Color(0x120607);
    if (roomTex) {
      try {
        const pmrem = new THREE.PMREMGenerator(renderer);
        pmrem.compileEquirectangularShader();
        scene.environment = pmrem.fromEquirectangular(roomTex).texture;
        scene.environmentIntensity = 1.1;
        pmrem.dispose();
      } catch (_) {
        scene.environment = roomTex;
      }
    }

    scene.add(new THREE.AmbientLight(0x6a3a4c, 1.25));
    const key = new THREE.DirectionalLight(0xffe8cc, 2.9);
    key.position.set(1.6, 2.6, 4.2);
    scene.add(key);
    const rim = new THREE.PointLight(0xff6a8a, 9, 22, 2);
    rim.position.set(-3.4, -2.2, 1.6);
    scene.add(rim);
    const fill = new THREE.PointLight(0x8fb4ff, 4, 22, 2);
    fill.position.set(3.2, 2.4, -1.2);
    scene.add(fill);

    // a pool of light behind, so the rope has something to sit against
    if (texGlow) {
      const pool = new THREE.Mesh(
        new THREE.PlaneGeometry(16, 16),
        new THREE.MeshBasicMaterial({
          map: texGlow, color: 0x7e2f38, transparent: true, opacity: 0.45,
          blending: THREE.AdditiveBlending, depthWrite: false
        })
      );
      pool.position.set(0, 0, -3.4);
      scene.add(pool);
    }

    // ---- the rope, as a tube written into pre-allocated buffers -------------
    const N = 60;                 // nodes
    let L = 0.14;                 // rest length between nodes
    const L_START = 0.14;
    const L_TIGHT = 0.08;
    const TUBE_R = 0.13;
    const SEP = 0.28;             // the rope has thickness; this is what jams
    const RAD = 8;
    const RADV = RAD + 1;

    const ropeGeo = new THREE.BufferGeometry();
    const rPos = new Float32Array(N * RADV * 3);
    const rNor = new Float32Array(N * RADV * 3);
    const rUv = new Float32Array(N * RADV * 2);
    {
      const idx = new Uint16Array((N - 1) * RAD * 6);
      let k = 0;
      for (let s = 0; s < N - 1; s++) {
        for (let j = 0; j < RAD; j++) {
          const a = s * RADV + j, b = s * RADV + j + 1;
          const c = (s + 1) * RADV + j + 1, d = (s + 1) * RADV + j;
          idx[k++] = a; idx[k++] = b; idx[k++] = c;
          idx[k++] = a; idx[k++] = c; idx[k++] = d;
        }
      }
      ropeGeo.setAttribute("position", new THREE.BufferAttribute(rPos, 3));
      ropeGeo.setAttribute("normal", new THREE.BufferAttribute(rNor, 3));
      ropeGeo.setAttribute("uv", new THREE.BufferAttribute(rUv, 2));
      ropeGeo.setIndex(new THREE.BufferAttribute(idx, 1));
      ropeGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 14);
    }
    const ropeMat = new THREE.MeshPhysicalMaterial({
      color: 0xe64550,
      roughness: 0.62, metalness: 0,
      sheen: 0.5, sheenRoughness: 0.4, sheenColor: new THREE.Color(0x8a6a50),
      clearcoat: 0.1, clearcoatRoughness: 0.5,
      envMapIntensity: 0.6,
      normalMap: texRope || null,
      normalScale: texRope ? new THREE.Vector2(0.5, 0.5) : undefined
    });
    if (texRope) texRope.repeat.set(1, 1);
    const rope = new THREE.Mesh(ropeGeo, ropeMat);
    rope.frustumCulled = false;
    scene.add(rope);

    // the two ends, so it is obvious what to grab
    // the ends carry a little light of their own, so it is obvious they are
    // the things to grab
    const beadMat = new THREE.MeshPhysicalMaterial({
      color: 0xffdc8a, metalness: 1, roughness: 0.24, envMapIntensity: 2.2,
      emissive: new THREE.Color(0xff9a3c), emissiveIntensity: 0.5
    });
    const beadGeo = new THREE.SphereGeometry(0.13, 14, 10);
    const beadA = new THREE.Mesh(beadGeo, beadMat);
    const beadB = new THREE.Mesh(beadGeo, beadMat);
    scene.add(beadA); scene.add(beadB);

    // crossing markers
    const MARKS = 48;
    let marks = null;
    if (texRing) {
      marks = new THREE.InstancedMesh(
        new THREE.PlaneGeometry(0.5, 0.5),
        new THREE.MeshBasicMaterial({
          map: texRing, transparent: true, depthWrite: false, depthTest: false,
          blending: THREE.AdditiveBlending
        }),
        MARKS
      );
      marks.frustumCulled = false;
      marks.count = 0;
      marks.renderOrder = 5;
      scene.add(marks);
    }

    function writeRing(si, px, py, pz, tx, ty, tz, radius, uCoord) {
      let tl = Math.sqrt(tx * tx + ty * ty + tz * tz) || 1;
      tx /= tl; ty /= tl; tz /= tl;
      let sx = ty, sy = -tx, sz = 0;
      let l = Math.sqrt(sx * sx + sy * sy);
      if (l < 1e-5) { sx = 1; sy = 0; sz = 0; l = 1; }
      sx /= l; sy /= l;
      let nx = sy * tz - sz * ty, ny = sz * tx - sx * tz, nz = sx * ty - sy * tx;
      l = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
      nx /= l; ny /= l; nz /= l;
      const base = si * RADV;
      for (let j = 0; j <= RAD; j++) {
        const ang = (j / RAD) * TAU;
        const ca = Math.cos(ang), sa = Math.sin(ang);
        const dx = sx * ca + nx * sa, dy = sy * ca + ny * sa, dz = sz * ca + nz * sa;
        const o = (base + j) * 3;
        rPos[o] = px + dx * radius; rPos[o + 1] = py + dy * radius; rPos[o + 2] = pz + dz * radius;
        rNor[o] = dx; rNor[o + 1] = dy; rNor[o + 2] = dz;
        const o2 = (base + j) * 2;
        rUv[o2] = j / RAD;
        rUv[o2 + 1] = uCoord;
      }
    }

    // ===================================================================== //
    // 4. Rope physics — Verlet, with real self-collision                    //
    // ===================================================================== //
    const px = new Float32Array(N), py = new Float32Array(N), pz = new Float32Array(N);
    const ox = new Float32Array(N), oy = new Float32Array(N), oz = new Float32Array(N);
    let closed = false;
    let grabbed = -1;
    let grabX = 0, grabY = 0;
    let ouSign = 1;                 // +1 passes over, -1 passes under
    const LIFT = 0.5;               // how far the held section rides out of plane
    const LIFT_SPAN = 6;            // how many nodes either side come with it

    // An open coil rather than a straight line: both ends finish at the bottom,
    // one just outside the other, so the very first thing you can do with it is
    // take an end across the rope. A straight rope has to be curled up first,
    // and nobody reads that as an invitation.
    function layoutRope() {
      for (let i = 0; i < N; i++) {
        const t = i / (N - 1);
        const a = -Math.PI * 0.5 + t * TAU;
        const r = 0.95 + t * 0.62;
        const x = Math.cos(a) * r, y = Math.sin(a) * r;
        px[i] = x; py[i] = y; pz[i] = t * 0.02;
        ox[i] = x; oy[i] = y; oz[i] = t * 0.02;
      }
    }
    layoutRope();

    function step(dt) {
      const damp = 0.86;
      for (let i = 0; i < N; i++) {
        if (i === grabbed) continue;
        const vx = (px[i] - ox[i]) * damp;
        const vy = (py[i] - oy[i]) * damp;
        const vz = (pz[i] - oz[i]) * damp;
        ox[i] = px[i]; oy[i] = py[i]; oz[i] = pz[i];
        px[i] += vx; py[i] += vy; pz[i] += vz;
      }

      // the rope prefers to lie in the plane, but only gently — collisions
      // have to be able to win, or a crossing would flatten out of existence
      for (let i = 0; i < N; i++) pz[i] += (0 - pz[i]) * 0.035;

      // the held section rides over or under whatever it is crossing
      if (grabbed >= 0) {
        for (let k = -LIFT_SPAN; k <= LIFT_SPAN; k++) {
          const i = grabbed + k;
          if (i < 0 || i >= N) continue;
          const f = 1 - Math.abs(k) / (LIFT_SPAN + 1);
          const want = ouSign * LIFT * f * f;
          pz[i] += (want - pz[i]) * 0.5;
        }
      }

      const iters = 8;
      for (let it = 0; it < iters; it++) {
        // distance between neighbours
        for (let i = 0; i < N - 1; i++) solveLink(i, i + 1, L);
        if (closed) solveLink(N - 1, 0, L);

        // the rope has thickness and cannot pass through itself
        for (let i = 0; i < N; i++) {
          for (let j = i + 4; j < N; j++) {
            if (closed && i === 0 && j >= N - 3) continue;
            const dx = px[j] - px[i], dy = py[j] - py[i], dz = pz[j] - pz[i];
            const d2 = dx * dx + dy * dy + dz * dz;
            if (d2 >= SEP * SEP || d2 < 1e-9) continue;
            const d = Math.sqrt(d2);
            const push = (SEP - d) * 0.5;
            const nx = dx / d, ny = dy / d, nz = dz / d;
            const wi = i === grabbed ? 0 : 1, wj = j === grabbed ? 0 : 1;
            const tw = wi + wj || 1;
            px[i] -= nx * push * (2 * wi / tw); py[i] -= ny * push * (2 * wi / tw); pz[i] -= nz * push * (2 * wi / tw);
            px[j] += nx * push * (2 * wj / tw); py[j] += ny * push * (2 * wj / tw); pz[j] += nz * push * (2 * wj / tw);
          }
        }

        if (grabbed >= 0) { px[grabbed] = grabX; py[grabbed] = grabY; }
      }
    }

    function solveLink(i, j, rest) {
      const dx = px[j] - px[i], dy = py[j] - py[i], dz = pz[j] - pz[i];
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-6;
      const diff = (d - rest) / d * 0.5;
      const wi = i === grabbed ? 0 : 1, wj = j === grabbed ? 0 : 1;
      const tw = wi + wj || 1;
      px[i] += dx * diff * (2 * wi / tw); py[i] += dy * diff * (2 * wi / tw); pz[i] += dz * diff * (2 * wi / tw);
      px[j] -= dx * diff * (2 * wj / tw); py[j] -= dy * diff * (2 * wj / tw); pz[j] -= dz * diff * (2 * wj / tw);
    }

    function writeRope() {
      for (let i = 0; i < N; i++) {
        const a = Math.max(0, i - 1), b = Math.min(N - 1, i + 1);
        let tx = px[b] - px[a], ty = py[b] - py[a], tz = pz[b] - pz[a];
        if (closed) {
          const aa = (i - 1 + N) % N, bb = (i + 1) % N;
          tx = px[bb] - px[aa]; ty = py[bb] - py[aa]; tz = pz[bb] - pz[aa];
        }
        writeRing(i, px[i], py[i], pz[i], tx, ty, tz, TUBE_R, i * 0.28);
      }
      ropeGeo.attributes.position.needsUpdate = true;
      ropeGeo.attributes.normal.needsUpdate = true;
      ropeGeo.attributes.uv.needsUpdate = true;
      ropeGeo.setDrawRange(0, (N - 1) * RAD * 6);
    }

    // ===================================================================== //
    // 5. Reading the diagram                                                //
    // ===================================================================== //
    // Every crossing between two non-adjacent segments of the projection,
    // with which strand is nearer the camera and the sign of the crossing.
    function findCrossings() {
      const out = [];
      const last = closed ? N : N - 1;
      for (let i = 0; i < last; i++) {
        const i2 = (i + 1) % N;
        const ax = px[i], ay = py[i], bx = px[i2], by = py[i2];
        for (let j = i + 2; j < last; j++) {
          if (i === 0 && j === last - 1 && closed) continue;
          const j2 = (j + 1) % N;
          const cx = px[j], cy = py[j], dx2 = px[j2], dy2 = py[j2];
          const r1x = bx - ax, r1y = by - ay;
          const r2x = dx2 - cx, r2y = dy2 - cy;
          const den = r1x * r2y - r1y * r2x;
          if (Math.abs(den) < 1e-9) continue;
          const t = ((cx - ax) * r2y - (cy - ay) * r2x) / den;
          const u = ((cx - ax) * r1y - (cy - ay) * r1x) / den;
          // half-open, so a crossing that lands on a shared vertex is counted
          // once rather than once per pair of segments meeting there
          if (t < 0 || t >= 1 || u < 0 || u >= 1) continue;
          const zi = pz[i] + (pz[i2] - pz[i]) * t;
          const zj = pz[j] + (pz[j2] - pz[j]) * u;
          // +z is toward the camera, so the larger z is the strand on top
          const iOver = zi > zj;
          out.push({
            a: i, ta: t, b: j, tb: u,
            x: ax + r1x * t, y: ay + r1y * t,
            over: iOver ? i : j,
            sign: den > 0 ? 1 : -1,
            gap: Math.abs(zi - zj)
          });
        }
      }
      // Two segments that meet almost exactly at a vertex can still report the
      // same geometric crossing twice; one crossing counted twice is not a knot
      // diagram, so near-duplicates on the same pair of strands are merged.
      const merged = [];
      for (const c of out) {
        let dup = false;
        for (const m of merged) {
          if (Math.abs(m.a - c.a) <= 2 && Math.abs(m.b - c.b) <= 2 &&
              Math.abs(m.x - c.x) < 0.05 && Math.abs(m.y - c.y) < 0.05) { dup = true; break; }
        }
        if (!dup) merged.push(c);
      }
      return merged;
    }

    // Walk the rope and write down each crossing as it is met: the Gauss code.
    function gaussCode(cr) {
      const events = [];
      cr.forEach((c, id) => {
        events.push({ at: c.a + c.ta, id: id, over: c.over === c.a, sign: c.sign });
        events.push({ at: c.b + c.tb, id: id, over: c.over === c.b, sign: c.sign });
      });
      events.sort((p, q) => p.at - q.at);
      return events;
    }

    // Reidemeister I removes a kink; Reidemeister II slides two crossings
    // apart. Both are applied to the code until nothing more comes out.
    function reduce(code) {
      let seq = code.slice(0);
      let changed = true;
      let guard = 0;
      while (changed && guard++ < 60) {
        changed = false;
        const n = seq.length;
        if (n < 2) break;
        // R1: the same crossing twice in a row
        for (let i = 0; i < n; i++) {
          const a = seq[i], b = seq[(i + 1) % n];
          if (a.id === b.id) {
            seq = seq.filter((e) => e.id !== a.id);
            changed = true;
            break;
          }
        }
        if (changed) continue;
        // R2: two crossings adjacent in both places, one strand over both
        const m = seq.length;
        for (let i = 0; i < m && !changed; i++) {
          const a = seq[i], b = seq[(i + 1) % m];
          if (a.id === b.id) continue;
          if (a.over !== b.over) continue;            // same strand, over both or under both
          for (let k = 0; k < m; k++) {
            if (k === i || k === (i + 1) % m) continue;
            const c = seq[k], d = seq[(k + 1) % m];
            if (c.over === a.over) continue;          // the other strand
            const pair = (c.id === a.id && d.id === b.id) || (c.id === b.id && d.id === a.id);
            if (!pair) continue;
            const ids = [a.id, b.id];
            seq = seq.filter((e) => ids.indexOf(e.id) < 0);
            changed = true;
            break;
          }
        }
      }
      return seq;
    }

    // p-colourability: colour the arcs between under-crossings, and at every
    // crossing require 2*over - under1 - under2 = 0 (mod p). Solve by
    // elimination; a nullity above one means it is properly p-colourable.
    function pColourable(seq, p) {
      const ids = [];
      for (const e of seq) if (ids.indexOf(e.id) < 0) ids.push(e.id);
      const n = ids.length;
      if (n === 0) return false;
      // arcs: cut the closed walk at every under-crossing
      const under = [];
      for (let i = 0; i < seq.length; i++) if (!seq[i].over) under.push(i);
      if (under.length !== n) return false;
      const arcOf = new Array(seq.length);
      let arc = 0;
      for (let i = 0; i < seq.length; i++) {
        const idx = (under[under.length - 1] + 1 + i) % seq.length;
        if (!seq[idx].over) { arcOf[idx] = arc; arc = (arc + 1) % n; }
        else arcOf[idx] = arc;
      }
      // one equation per crossing
      const rows = [];
      for (const id of ids) {
        const row = new Array(n).fill(0);
        let overArc = -1;
        const underArcs = [];
        for (let i = 0; i < seq.length; i++) {
          if (seq[i].id !== id) continue;
          if (seq[i].over) overArc = arcOf[i];
          else {
            // the arc that runs into this under-crossing, and the one that
            // leaves it — arcs only change here, so the next one is arc+1
            underArcs.push(arcOf[i]);
            underArcs.push((arcOf[i] + 1) % n);
          }
        }
        if (overArc < 0 || underArcs.length < 2) return false;
        row[overArc] = (row[overArc] + 2) % p;
        row[underArcs[0]] = (row[underArcs[0]] - 1 + p) % p;
        row[underArcs[1]] = (row[underArcs[1]] - 1 + p) % p;
        rows.push(row);
      }
      // rank over Z_p
      let rank = 0;
      for (let c = 0; c < n && rank < rows.length; c++) {
        let piv = -1;
        for (let r = rank; r < rows.length; r++) if (rows[r][c] % p !== 0) { piv = r; break; }
        if (piv < 0) continue;
        const t = rows[rank]; rows[rank] = rows[piv]; rows[piv] = t;
        const inv = modInverse(rows[rank][c] % p, p);
        for (let c2 = 0; c2 < n; c2++) rows[rank][c2] = (rows[rank][c2] * inv) % p;
        for (let r = 0; r < rows.length; r++) {
          if (r === rank || rows[r][c] % p === 0) continue;
          const f = rows[r][c] % p;
          for (let c2 = 0; c2 < n; c2++) rows[r][c2] = ((rows[r][c2] - f * rows[rank][c2]) % p + p * p) % p;
        }
        rank++;
      }
      return n - rank >= 2;
    }

    function modInverse(a, p) {
      a = ((a % p) + p) % p;
      for (let x = 1; x < p; x++) if ((a * x) % p === 1) return x;
      return 1;
    }

    // crossing number plus colourability is enough to name the small knots
    const KNOTS = [
      { n: 3, p: 3, name: "TREFOIL", tag: "3₁", note: "The simplest knot there is. Three crossings, and not one of them can be removed." },
      { n: 4, p: 5, name: "FIGURE-EIGHT", tag: "4₁", note: "Four crossings. It is its own mirror image — tie it left-handed or right-handed and you get the same knot." },
      { n: 5, p: 5, name: "CINQUEFOIL", tag: "5₁", note: "Five crossings in a row, all the same way. A torus knot: it lies flat on a doughnut." },
      { n: 5, p: 7, name: "THREE-TWIST", tag: "5₂", note: "Five crossings, and the first knot that is not a torus knot." },
      { n: 6, p: 3, name: "6₁", tag: "6₁", note: "Six crossings. It is slice — it bounds a disc in four dimensions, which is a strange thing to be true of a rope." },
      { n: 6, p: 11, name: "6₂", tag: "6₂", note: "Six crossings, and none of them will come out." },
      { n: 6, p: 13, name: "6₃", tag: "6₃", note: "Six crossings, and none of them will come out." },
      { n: 7, p: 7, name: "SEPTAFOIL", tag: "7₁", note: "Seven crossings, all the same way. You do not tie one of these by accident." }
    ];

    function idsOf(seq) {
      const ids = [];
      for (const e of seq) if (ids.indexOf(e.id) < 0) ids.push(e.id);
      return ids;
    }

    // Tie two knots one after the other in the same rope and you get a
    // connected sum, which is not a new knot but the two of them stacked. In a
    // Gauss code that shows up as a place you can cut the walk in two with no
    // crossing shared across the cut.
    function decompose(seq) {
      const n = seq.length;
      if (n < 4) return n ? [seq] : [];
      for (let rot = 0; rot < n; rot++) {
        const s = seq.slice(rot).concat(seq.slice(0, rot));
        for (let k = 2; k <= n - 2; k += 2) {
          const head = s.slice(0, k), tail = s.slice(k);
          const hIds = idsOf(head), tIds = idsOf(tail);
          let shared = false;
          for (const id of hIds) if (tIds.indexOf(id) >= 0) { shared = true; break; }
          if (shared) continue;
          if (hIds.length * 2 !== head.length || tIds.length * 2 !== tail.length) continue;
          return decompose(head).concat(decompose(tail));
        }
      }
      return [seq];
    }

    function handedness(seq) {
      const ids = idsOf(seq);
      let sum = 0;
      for (const id of ids) {
        for (const e of seq) if (e.id === id) { sum += e.sign; break; }
      }
      return sum;
    }

    function identifyPrime(seq) {
      const n = idsOf(seq).length;
      if (n === 0) return { n: 0, name: "THE UNKNOT", tag: "0₁", knot: false, note: "" };
      for (const k of KNOTS) {
        if (k.n === n && pColourable(seq, k.p)) {
          return { n: n, name: k.name, tag: k.tag, knot: true, note: k.note };
        }
      }
      return { n: n, name: n + "-CROSSING KNOT", tag: "?", knot: true, note: "" };
    }

    function identify(seq) {
      const parts = decompose(seq).filter((p) => idsOf(p).length > 0);
      const n = idsOf(seq).length;

      if (n === 0) {
        return { n: 0, name: "THE UNKNOT", tag: "0₁", knot: false,
          note: "Every crossing came out. Pull the ends and it simply opens — this is a circle wearing a disguise." };
      }

      if (parts.length <= 1) {
        const one = identifyPrime(seq);
        if (one.note) return one;
        return { n: n, name: n + "-CROSSING KNOT", tag: "?", knot: true,
          note: "Nothing this bit knows the name of. It has " + n + " crossings that will not come out, which is enough to be sure it is a knot." };
      }

      // two knots in one rope
      const named = parts.map(identifyPrime);
      const trefoils = named.filter((p) => p.tag === "3₁");
      if (parts.length === 2 && trefoils.length === 2) {
        const ha = handedness(parts[0]), hb = handedness(parts[1]);
        if (ha * hb < 0) {
          return { n: n, name: "REEF KNOT", tag: "3₁ # 3₁*", knot: true,
            note: "Two trefoils of opposite hand, tied one on top of the other. This is the knot you actually tie a rakhi with — and it is why it holds." };
        }
        return { n: n, name: "GRANNY KNOT", tag: "3₁ # 3₁", knot: true,
          note: "Two trefoils of the same hand. It looks like a reef knot and it is not: this is the one that slips." };
      }
      const label = named.map((p) => p.tag).join(" # ");
      return { n: n, name: "TWO KNOTS IN ONE ROPE", tag: label, knot: true,
        note: "A connected sum — " + label + ". Two knots tied one after the other in the same rope, and neither of them will come out." };
    }

    // ===================================================================== //
    // 6. Playing                                                            //
    // ===================================================================== //
    let phase = "tie";              // tie -> closing -> tighten -> verdict
    let time = 0, phaseT = 0;
    let started = false;
    let crossings = [];
    let liveCount = 0, shownCount = -1;
    let best = 0;
    let verdict = null;
    let dragSpeed = 0;

    const ndc = new THREE.Vector3();
    const camDir = new THREE.Vector3();
    const camAim = new THREE.Vector3(0, 0, 0);
    let camDist = 12, camDistTarget = 12;

    function screenToPlane(sx, sy, out) {
      ndc.set((sx / Math.max(1, W)) * 2 - 1, -((sy / Math.max(1, H)) * 2 - 1), 0.5);
      ndc.unproject(camera);
      camDir.copy(ndc).sub(camera.position);
      if (Math.abs(camDir.z) < 1e-6) return false;
      const t = (0 - camera.position.z) / camDir.z;
      if (t <= 0) return false;
      out.x = camera.position.x + camDir.x * t;
      out.y = camera.position.y + camDir.y * t;
      return true;
    }
    const planePt = { x: 0, y: 0 };

    function firstGesture() {
      if (started) return;
      started = true;
      resumeAudio();
      ctx.platform.start();
      if (canMusic && ctx.music && ctx.music.unlock) { try { ctx.music.unlock(); } catch (_) {} }
    }

    function paintOU() {
      const over = ouSign > 0;
      nodes.ouicon.textContent = over ? "↑" : "↓";
      nodes.outext.textContent = over ? "passing OVER" : "passing UNDER";
      nodes.ou.style.background = over ? "rgba(243,198,94,0.16)" : "rgba(120,170,255,0.16)";
      nodes.ou.style.borderColor = over ? "rgba(243,198,94,0.5)" : "rgba(140,180,255,0.5)";
    }
    paintOU();

    ctx.listen(nodes.ou, "click", () => {
      firstGesture();
      ouSign = -ouSign;
      paintOU();
      ctx.platform.haptic("light");
      tick(2);
    });

    ctx.listen(view, "pointerdown", (e) => {
      firstGesture();
      if (view.setPointerCapture) { try { view.setPointerCapture(e.pointerId); } catch (_) {} }
      if (phase === "closing" || phase === "tighten") return;
      if (!screenToPlane(e.offsetX, e.offsetY, planePt)) return;
      let bestI = -1, bestD = 1.6 * 1.6;
      for (let i = 0; i < N; i++) {
        const dx = px[i] - planePt.x, dy = py[i] - planePt.y;
        const d = dx * dx + dy * dy;
        if (d < bestD) { bestD = d; bestI = i; }
      }
      if (bestI < 0) return;
      grabbed = bestI;
      grabX = planePt.x; grabY = planePt.y;
      nodes.hint.style.opacity = "0.4";
    });

    ctx.listen(view, "pointermove", (e) => {
      if (grabbed < 0) return;
      if (!screenToPlane(e.offsetX, e.offsetY, planePt)) return;
      const dx = planePt.x - grabX, dy = planePt.y - grabY;
      dragSpeed = Math.min(1, Math.sqrt(dx * dx + dy * dy) * 3);
      grabX = planePt.x; grabY = planePt.y;
    });

    const release = () => { grabbed = -1; dragSpeed = 0; };
    ctx.listen(view, "pointerup", release);
    ctx.listen(view, "pointercancel", release);

    // ---- closing and tightening --------------------------------------------
    ctx.listen(nodes.close, "click", () => {
      if (phase !== "tie" || liveCount < 1) return;
      firstGesture();
      phase = "closing";
      phaseT = 0;
      grabbed = -1;
      nodes.close.style.display = "none";
      nodes.ou.style.display = "none";
      nodes.hint.textContent = "closing it";
      nodes.cross.style.opacity = "0";
      nodes.hint.style.opacity = "1";
      snap();
      ctx.platform.haptic("medium");
      ctx.platform.interact({ type: "close_loop" });
    });

    async function submitBest(n, name) {
      if (n <= 0) return;
      if (n > best) {
        best = n;
        if (ctx.capabilities.storage !== false) {
          try { await ctx.storage.set("best", best); } catch (_) {}
        }
      }
      try {
        await ctx.memory.record("crossings").submit(n, { label: name });
      } catch (err) {
        ctx.platform.error({ where: "record_submit", message: String(err) });
      }
    }

    function readVerdict() {
      crossings = findCrossings();
      const code = gaussCode(crossings);
      const reduced = reduce(code);
      verdict = identify(reduced);
      verdict.raw = crossings.length;

      nodes.card.style.opacity = "1";
      nodes.top.style.opacity = "0";
      nodes.cardname.textContent = verdict.name;
      nodes.cardsub.textContent = verdict.knot
        ? verdict.tag + " · " + verdict.n + " crossings that will not come out"
        : "it was never a knot";
      nodes.cardnote.textContent = verdict.note;
      nodes.hint.textContent = verdict.knot ? "it cannot be undone" : "pull it and it opens";
      nodes.endrow.style.display = "flex";

      if (verdict.knot) {
        gong(96, 0.3);
        ctx.timeout(() => gong(144, 0.16), 260);
        ctx.platform.haptic("success");
        ctx.platform.milestone("knot_" + verdict.tag);
        submitBest(verdict.n, verdict.name);
      } else {
        slump();
        sting("fail");
        ctx.platform.haptic("warning");
        ctx.platform.milestone("unknot");
      }
      ctx.platform.complete({ knot: verdict.name, crossings: verdict.n });
    }

    function restart() {
      phase = "tie";
      phaseT = 0;
      closed = false;
      grabbed = -1;
      L = L_START;
      verdict = null;
      crossings = [];
      liveCount = 0; shownCount = -1;
      layoutRope();
      beadB.visible = true;
      nodes.card.style.opacity = "0";
      nodes.top.style.opacity = "1";
      nodes.endrow.style.display = "none";
      nodes.close.style.display = "none";
      nodes.ou.style.display = "flex";
      nodes.hint.style.opacity = "1";
      nodes.hint.textContent = "drag the rope across itself";
      nodes.cross.textContent = "0 crossings";
      nodes.cross.style.opacity = "1";
      if (marks) marks.count = 0;
      ctx.platform.setProgress(0);
    }

    ctx.listen(nodes.again, "click", () => { firstGesture(); restart(); });

    // ---- sheets --------------------------------------------------------------
    const HELP =
      '<div style="font-size:19px;font-weight:700;margin-bottom:14px;">Tie a knot</div>' +
      '<div style="font-size:14px;line-height:1.75;color:rgba(246,234,214,0.86);">' +
        '• Drag any part of the rope. The bit under your finger lifts toward you.<br>' +
        '• Tap <b>OVER / UNDER</b> to choose which way it crosses the rope underneath.<br>' +
        '• Make a few crossings, then <b>close the loop</b> — a rakhi is a loop.<br>' +
        '• The rope then tightens itself. If it was never a knot it collapses into a ring; ' +
        'if it was, it jams.<br>' +
        '• Whatever survives gets named. Trefoil, figure-eight, cinquefoil — real knots, ' +
        'told apart by counting crossings and colouring the arcs.' +
      '</div>' +
      '<button data-el="go" style="pointer-events:auto;margin-top:22px;width:100%;height:48px;' +
      'border-radius:24px;border:0;background:' + GOLD + ';color:#2a1606;font-size:15px;font-weight:700;' +
      'font-family:inherit;">Start tying</button>' +
      '<button data-el="toboard" style="pointer-events:auto;margin-top:10px;width:100%;height:44px;' +
      'border-radius:22px;border:1px solid rgba(246,234,214,0.3);background:transparent;color:' + INK + ';' +
      'font-size:14px;font-weight:600;font-family:inherit;">Knots people tied</button>';

    function showHelp() {
      nodes.sheetbody.innerHTML = HELP;
      const go = nodes.sheetbody.querySelector('[data-el="go"]');
      if (go) ctx.listen(go, "click", () => { nodes.sheet.style.display = "none"; firstGesture(); });
      const tb = nodes.sheetbody.querySelector('[data-el="toboard"]');
      if (tb) ctx.listen(tb, "click", showBoard);
    }

    function esc(t) {
      return String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    }

    function readBoard(res) {
      if (!res) return [];
      let raw = Array.isArray(res) ? res
        : res.entries || res.items || res.records || res.rows ||
          (res.data && (res.data.entries || res.data.items)) || [];
      if (!Array.isArray(raw)) return [];
      const out = [];
      for (const e of raw) {
        if (!e || typeof e !== "object") continue;
        const user = e.user || e.author || e.by || null;
        const who = typeof user === "string" ? user
          : (user && (user.handle || user.username || user.displayName || user.name)) || e.handle || "someone";
        out.push({
          rank: e.rank || out.length + 1,
          who: String(who).slice(0, 16),
          value: String(e.label || e.formatted || e.value || e.score || "").slice(0, 16),
          self: !!(e.self || e.mine || e.isSelf || (user && user.self))
        });
        if (out.length >= 10) break;
      }
      return out;
    }

    async function showBoard() {
      nodes.sheet.style.display = "flex";
      nodes.sheetbody.innerHTML =
        '<div style="font-size:19px;font-weight:700;margin-bottom:14px;">Knots people tied</div>' +
        '<div style="font-size:13.5px;color:' + DIM + ';">looking…</div>';
      let rows = [];
      try {
        rows = readBoard(await ctx.memory.record("crossings").leaderboard({ scope: "global", period: "all_time" }));
      } catch (err) {
        ctx.platform.error({ where: "leaderboard", message: String(err) });
      }
      let html = '<div style="font-size:19px;font-weight:700;margin-bottom:14px;">Knots people tied</div>';
      if (!rows.length) {
        html += '<div style="font-size:13.5px;line-height:1.7;color:' + DIM + ';">' +
          'Nothing recorded yet. Tie something that will not come undone and yours goes up first.</div>';
      } else {
        html += '<div style="font-size:14px;line-height:2.0;">';
        for (const r of rows) {
          html += '<div style="display:flex;justify-content:space-between;gap:12px;' +
            (r.self ? "color:" + GOLD + ";font-weight:700;" : "") + '">' +
            '<span>' + r.rank + ". " + esc(r.who) + '</span><span>' + esc(r.value) + '</span></div>';
        }
        html += '</div>';
      }
      html += '<button data-el="back" style="pointer-events:auto;margin-top:22px;width:100%;height:46px;' +
        'border-radius:23px;border:0;background:' + GOLD + ';color:#2a1606;font-size:15px;font-weight:700;' +
        'font-family:inherit;">Back</button>';
      nodes.sheetbody.innerHTML = html;
      const b = nodes.sheetbody.querySelector('[data-el="back"]');
      if (b) ctx.listen(b, "click", () => { nodes.sheet.style.display = "none"; showHelp(); });
    }

    ctx.listen(nodes.help, "click", () => { showHelp(); nodes.sheet.style.display = "flex"; });
    ctx.listen(nodes.board, "click", showBoard);

    // ===================================================================== //
    // 7. Layout and the frame loop                                          //
    // ===================================================================== //
    const TOP_RESERVE = SAFE_T + 60;
    const BOT_RESERVE = SAFE_B + 150;
    let bandFrac = 0.72;

    function layout() {
      W = Math.max(1, ctx.width);
      H = Math.max(1, ctx.height);
      renderer.setSize(W, H, false);
      camera.aspect = W / H;
      bandFrac = clamp((H - TOP_RESERVE - BOT_RESERVE) / H, 0.35, 0.95);
      camera.updateProjectionMatrix();
    }
    layout();
    ctx.listen(window, "resize", () => ctx.timeout(layout, 60));
    if (window.visualViewport) ctx.listen(window.visualViewport, "resize", () => ctx.timeout(layout, 60));

    // Fit the camera to however big the rope currently is — which means the
    // view closes in on its own as the knot tightens.
    function fitCamera() {
      let cx = 0, cy = 0;
      for (let i = 0; i < N; i++) { cx += px[i]; cy += py[i]; }
      cx /= N; cy /= N;
      // width and height have to be fitted separately, or a tall thin rope
      // pushes the camera back far enough to leave the frame mostly empty
      let rx = 0.5, ry = 0.5;
      for (let i = 0; i < N; i++) {
        const dx = Math.abs(px[i] - cx), dy = Math.abs(py[i] - cy);
        if (dx > rx) rx = dx;
        if (dy > ry) ry = dy;
      }
      const pad = TUBE_R * 2 + 0.3;
      rx += pad; ry += pad;
      const half = Math.tan((camera.fov * Math.PI) / 360);
      const dH = ry / (half * bandFrac);
      const dW = rx / (half * camera.aspect);
      const floor = phase === "tie" ? 6.5 : 3.4;
      camDistTarget = clamp(Math.max(dH, dW), floor, 20);
      camAim.set(cx, cy, 0);
    }

    const marksM4 = new THREE.Matrix4();
    const marksV = new THREE.Vector3();
    const marksQ = new THREE.Quaternion();
    const marksS = new THREE.Vector3(1, 1, 1);

    function placeMarks() {
      if (!marks) return;
      const n = Math.min(crossings.length, MARKS);
      for (let i = 0; i < n; i++) {
        const c = crossings[i];
        marksV.set(c.x, c.y, 0.42);
        marksS.setScalar(0.55 + Math.min(0.35, c.gap * 0.4));
        marksM4.compose(marksV, marksQ, marksS);
        marks.setMatrixAt(i, marksM4);
      }
      marks.count = n;
      marks.instanceMatrix.needsUpdate = true;
    }

    if (ctx.capabilities.storage !== false) {
      try {
        const b = await ctx.storage.get("best");
        if (typeof b === "number" && isFinite(b)) best = b | 0;
      } catch (_) { /* storage is a nicety */ }
    }

    // one frame before the curtain lifts, so nothing is ever blank
    fitCamera();
    camDist = camDistTarget;
    camera.position.set(camAim.x, camAim.y + 0.6, camDist);
    camera.lookAt(camAim);
    writeRope();
    renderer.render(scene, camera);
    nodes.curtain.style.transition = "opacity 520ms ease";
    nodes.curtain.style.opacity = "0";
    ctx.timeout(() => { nodes.curtain.style.display = "none"; }, 560);

    // The first time round, say what this is. After that, stay out of the way.
    let seen = false;
    if (ctx.capabilities.storage !== false) {
      try { seen = !!(await ctx.storage.get("seen")); } catch (_) { seen = false; }
    }
    if (!seen) {
      showHelp();
      ctx.timeout(() => { nodes.sheet.style.display = "flex"; }, 620);
      if (ctx.capabilities.storage !== false) {
        try { await ctx.storage.set("seen", true); } catch (_) {}
      }
    }

    let frame = 0;
    ctx.onFrame((dtMs) => {
      const dt = Math.min(0.05, Math.max(0.001, dtMs / 1000));
      time += dt;
      frame++;

      // ---- phases ---------------------------------------------------------
      if (phase === "closing") {
        phaseT += dt;
        const mx = (px[0] + px[N - 1]) * 0.5, my = (py[0] + py[N - 1]) * 0.5;
        const k = Math.min(1, dt * 6);
        px[0] += (mx - px[0]) * k; py[0] += (my - py[0]) * k;
        px[N - 1] += (mx - px[N - 1]) * k; py[N - 1] += (my - py[N - 1]) * k;
        if (phaseT > 0.75) {
          closed = true;
          beadB.visible = false;
          phase = "tighten";
          phaseT = 0;
          if (marks) marks.count = 0;
          nodes.hint.textContent = "pulling it tight";
        }
      } else if (phase === "tighten") {
        phaseT += dt;
        const t = clamp(phaseT / 3.2, 0, 1);
        const e = t * t * (3 - 2 * t);
        L = lerp(L_START, L_TIGHT, e);

        setCreak(t < 1 ? 0.5 + 0.5 * Math.sin(time * 3) : 0.2, e);
        ctx.platform.setProgress(clamp(phaseT / 4.2, 0, 1));
        if (phaseT > 4.2) {
          phase = "verdict";
          phaseT = 0;
          setCreak(0, 0);
          readVerdict();
        }
      } else {
        setCreak(0, 0);
      }

      step(dt);
      writeRope();

      beadA.position.set(px[0], py[0], pz[0]);
      beadB.position.set(px[N - 1], py[N - 1], pz[N - 1]);
      // the bead shrinks with the rope, or it swallows the tightened knot
      const beadScale = clamp((L / L_START) * 1.35, 0.45, 2);
      beadA.scale.setScalar(beadScale);
      beadB.scale.setScalar(beadScale);

      // ---- the diagram, live ----------------------------------------------
      if (phase === "tie" && frame % 3 === 0) {
        crossings = findCrossings();
        liveCount = crossings.length;
        placeMarks();
        if (liveCount !== shownCount) {
          if (liveCount > shownCount && shownCount >= 0) {
            tick(liveCount);
            ctx.platform.haptic("light");
          }
          shownCount = liveCount;
          nodes.cross.textContent = liveCount + (liveCount === 1 ? " crossing" : " crossings");
          if (liveCount >= 1 && nodes.close.style.display === "none") {
            nodes.close.style.display = "block";
            nodes.hint.textContent = "cross it a few more times, then close it";
          } else if (liveCount === 0) {
            nodes.close.style.display = "none";
            nodes.hint.textContent = "drag the rope across itself";
          }
        }
      }

      setRub(grabbed >= 0 ? Math.max(0.15, dragSpeed) : 0);
      dragSpeed *= Math.pow(0.05, dt);

      // ---- camera ----------------------------------------------------------
      fitCamera();
      camDist += (camDistTarget - camDist) * Math.min(1, dt * 2.2);
      const sway = Math.sin(time * 0.3) * 0.06;
      camera.position.set(camAim.x + sway, camAim.y + camDist * 0.06, camDist);
      camera.lookAt(camAim.x, camAim.y, 0);

      rim.intensity = 8 + Math.sin(time * 1.5) * 1.4;
      renderer.render(scene, camera);
    });
  }
};
