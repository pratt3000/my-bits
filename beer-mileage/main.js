/**
 * Beer Mileage — turn what you walked into what you have earned to drink.
 *
 * Two real models, and the payoff is the arithmetic between them:
 *
 *   - Energy above rest, from the Compendium of Physical Activities: each
 *     activity is a MET at a reference pace, minus the 1 MET you would have
 *     burned sitting at the bar anyway, times your weight.
 *   - Energy in a glass: 7 kcal per gram of alcohol at 0.789 g/ml, plus 4 kcal
 *     per gram of residual carbohydrate, per style and per serving.
 *
 * So ten thousand steps at 70 kg is 278 kcal, and 278 kcal is one and a half
 * pints of lager. That number is the entire product, and it is honest.
 *
 * Rendered in three@0.164.1: a real glass with refraction, beer cut by a level
 * plane so it stays flat while the glass tilts, a head that settles, bubbles
 * from fixed nucleation sites, and condensation only where the beer is.
 */
window.plethoraBit = {
  meta: {
    title: "Beer Mileage",
    runtime: "plethora-bit@2",
    tags: ["fitness", "beer", "3d", "tracker", "fun"],
    permissions: ["haptics", "storage", "motion", "audio", "backgroundMusic"]
  },

  async init(ctx) {
    const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
    const lerp = (a, b, t) => a + (b - a) * t;
    const easeOut = (t) => 1 - Math.pow(1 - t, 3);
    const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

    let seed = 0x2545f491;
    function rnd() {
      seed ^= seed << 13; seed >>>= 0;
      seed ^= seed >> 17;
      seed ^= seed << 5; seed >>>= 0;
      return seed / 4294967296;
    }
    const rrange = (a, b) => a + (b - a) * rnd();

    // storage.set returns nothing on device, so never chain onto it
    function fireAndForget(thunk) {
      try {
        const r = thunk();
        if (r && typeof r.catch === "function") r.catch(() => {});
      } catch (err) { /* storage unsupported here */ }
    }

    // === MODEL BEGIN
    // Pure. No ctx, no DOM, no three — the test slices this block out and runs
    // it in node against label values and published figures.
    const MODEL = (function () {
      // Compendium of Physical Activities (Ainsworth et al., 2011). MET at a
      // reference pace; we count only the energy above the 1 MET of sitting.
      const WALK_MET = 3.5, WALK_KMH = 4.8;     // 3.0 mph, level, moderate
      const RUN_MET = 9.8, RUN_KMH = 9.7;       // 6.0 mph, 10 min/mile
      const RIDE_MET = 8.0, RIDE_KMH = 21;      // 12-13.9 mph, moderate
      const SWIM_MET = 7.0, SWIM_KMH = 2.0;     // freestyle, moderate
      const GYM_MET = 5.0;                      // resistance training, general
      const STRIDE_M = 0.762;                   // average adult step
      const netPerKgKm = (met, kmh) => (met - 1) / kmh;

      const ACTS = {
        steps: { label: "Steps", emoji: "🚶", unit: "steps", quick: [1000, 2500, 5000, 10000],
          kcal: (n, kg) => n * STRIDE_M / 1000 * netPerKgKm(WALK_MET, WALK_KMH) * kg },
        run:   { label: "Run",   emoji: "🏃", unit: "km", quick: [1, 2.5, 5, 10],
          kcal: (km, kg) => km * netPerKgKm(RUN_MET, RUN_KMH) * kg },
        ride:  { label: "Ride",  emoji: "🚴", unit: "km", quick: [5, 10, 20, 40],
          kcal: (km, kg) => km * netPerKgKm(RIDE_MET, RIDE_KMH) * kg },
        swim:  { label: "Swim",  emoji: "🏊", unit: "m", quick: [200, 500, 1000, 2000],
          kcal: (m, kg) => (m / 1000) * netPerKgKm(SWIM_MET, SWIM_KMH) * kg },
        gym:   { label: "Gym",   emoji: "🏋️", unit: "min", quick: [15, 30, 45, 60],
          kcal: (min, kg) => (min / 60) * (GYM_MET - 1) * kg }
      };
      const ACT_KEYS = Object.keys(ACTS);

      // Serving, ABV and residual carbohydrate (g per 100 ml) by style. The
      // serving is whatever the style is actually poured in.
      const STYLES = {
        lager:   { name: "Lager",   ml: 473, abv: 5.0, carbs: 3.0, glass: "shaker",
                   blurb: "A US pint of something cold and yellow." },
        pilsner: { name: "Pilsner", ml: 473, abv: 4.8, carbs: 3.2, glass: "pilsner",
                   blurb: "Crisp, bitter, tall glass." },
        wheat:   { name: "Wheat",   ml: 500, abv: 5.3, carbs: 4.0, glass: "weizen",
                   blurb: "Hazy, banana and clove, half a litre." },
        ipa:     { name: "IPA",     ml: 473, abv: 6.5, carbs: 4.3, glass: "tulip",
                   blurb: "Hops, and the calories to match." },
        stout:   { name: "Stout",   ml: 568, abv: 4.2, carbs: 2.6, glass: "pintTulip",
                   blurb: "An imperial pint, and lighter than it looks." }
      };
      const STYLE_KEYS = Object.keys(STYLES);

      const ALC_KCAL_PER_G = 7, ALC_DENSITY = 0.789, CARB_KCAL_PER_G = 4;
      function beerKcal(style) {
        const s = STYLES[style];
        const alcohol = s.ml * (s.abv / 100) * ALC_DENSITY * ALC_KCAL_PER_G;
        const carbs = s.ml * (s.carbs / 100) * CARB_KCAL_PER_G;
        return alcohol + carbs;
      }

      function emptyLog() {
        const log = {};
        for (const k of ACT_KEYS) log[k] = 0;
        return log;
      }
      function localDate(d) {
        const x = d || new Date();
        const p = (n) => String(n).padStart(2, "0");
        return x.getFullYear() + "-" + p(x.getMonth() + 1) + "-" + p(x.getDate());
      }
      function newDay(date) {
        return { date: date, log: emptyLog(), poured: 0, adds: [] };
      }
      function actKcal(log, act, kg) {
        return ACTS[act].kcal(log[act] || 0, kg);
      }
      function dayKcal(log, kg) {
        let sum = 0;
        for (const k of ACT_KEYS) sum += actKcal(log, k, kg);
        return sum;
      }
      function pintsFor(kcal, style) { return kcal / beerKcal(style); }
      function earned(day, kg, style) { return pintsFor(dayKcal(day.log, kg), style); }
      function remaining(day, kg, style) { return Math.max(0, earned(day, kg, style) - day.poured); }
      function fullGlasses(day, kg, style) { return Math.floor(remaining(day, kg, style) + 1e-9); }
      function canPour(day, kg, style) { return fullGlasses(day, kg, style) >= 1; }

      // How much more of an activity finishes the glass you are on.
      function toNextPint(day, kg, style, act) {
        const rem = remaining(day, kg, style);
        const frac = rem - Math.floor(rem + 1e-9);
        const needKcal = (1 - frac) * beerKcal(style);
        const perUnit = ACTS[act].kcal(1, kg);
        return perUnit > 0 ? needKcal / perUnit : Infinity;
      }

      function add(day, act, amount) {
        if (!ACTS[act] || !(amount > 0)) return day;
        const next = { date: day.date, log: Object.assign({}, day.log), poured: day.poured,
                       adds: day.adds.slice() };
        next.log[act] = (next.log[act] || 0) + amount;
        next.adds.push({ act: act, amount: amount });
        return next;
      }
      function undo(day) {
        if (!day.adds.length) return day;
        const last = day.adds[day.adds.length - 1];
        const next = { date: day.date, log: Object.assign({}, day.log), poured: day.poured,
                       adds: day.adds.slice(0, -1) };
        next.log[last.act] = Math.max(0, (next.log[last.act] || 0) - last.amount);
        return next;
      }
      function clearAct(day, act) {
        const next = { date: day.date, log: Object.assign({}, day.log), poured: day.poured,
                       adds: day.adds.filter((a) => a.act !== act) };
        next.log[act] = 0;
        return next;
      }
      function pour(day, kg, style) {
        if (!canPour(day, kg, style)) return day;
        return { date: day.date, log: Object.assign({}, day.log), poured: day.poured + 1,
                 adds: day.adds.slice() };
      }
      // A pour you cannot afford any more (say you undid a run) is not undone;
      // you drank it. remaining() clamps at zero and that is the truth of it.

      // New day: yesterday goes into history, capped, and the glass is empty.
      function rollover(saved, history, today, kg, style) {
        const hist = (history || []).slice();
        if (saved && saved.date === today) return { day: saved, history: hist };
        if (saved && saved.date) {
          hist.push({ date: saved.date, kcal: Math.round(dayKcal(saved.log, kg)),
                      pints: Math.round(earned(saved, kg, style) * 100) / 100,
                      poured: saved.poured });
          while (hist.length > 14) hist.shift();
        }
        return { day: newDay(today), history: hist };
      }

      return {
        ACTS: ACTS, ACT_KEYS: ACT_KEYS, STYLES: STYLES, STYLE_KEYS: STYLE_KEYS,
        consts: { WALK_MET, WALK_KMH, RUN_MET, RUN_KMH, RIDE_MET, RIDE_KMH,
                  SWIM_MET, SWIM_KMH, GYM_MET, STRIDE_M },
        beerKcal, emptyLog, localDate, newDay, actKcal, dayKcal, pintsFor,
        earned, remaining, fullGlasses, canPour, toNextPint,
        add, undo, clearAct, pour, rollover
      };
    })();
    // === MODEL END

    // ===================================================================
    // Sound. A glug when energy goes in, a fizz while the head is lively, a
    // clink when a glass fills, a swallow when you drink one. All synthesised.
    // ===================================================================
    let ac = null, master = null, noiseBuf = null, audioOn = false;
    function initAudio() {
      if (ac || !ctx.capabilities.audio) return;
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      try {
        ac = new AC();
        master = ac.createGain();
        master.gain.value = 0.8;
        master.connect(ac.destination);
        const n = ac.sampleRate * 0.6;
        noiseBuf = ac.createBuffer(1, n, ac.sampleRate);
        const d = noiseBuf.getChannelData(0);
        for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
        audioOn = true;
      } catch (err) { audioOn = false; }
    }
    ctx.onDestroy(() => { try { if (ac) ac.close(); } catch (err) { /* gone */ } });
    function env(node, at, peak, attack, decay) {
      const gn = ac.createGain();
      gn.gain.setValueAtTime(0.0001, at);
      gn.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), at + attack);
      gn.gain.exponentialRampToValueAtTime(0.0001, at + attack + decay);
      node.connect(gn); gn.connect(master);
    }
    function noise(at, dur, type, freq, q, peak) {
      const src = ac.createBufferSource();
      src.buffer = noiseBuf; src.loop = true;
      const f = ac.createBiquadFilter();
      f.type = type; f.frequency.value = freq; f.Q.value = q;
      src.connect(f);
      env(f, at, peak, 0.006, dur);
      src.start(at); src.stop(at + dur + 0.05);
    }
    function sfxGlug(big) {
      if (!audioOn) return;
      const at = ac.currentTime + 0.01;
      // a glug is a pitch that rises as the neck empties
      for (let i = 0; i < (big ? 3 : 2); i++) {
        const o = ac.createOscillator();
        o.type = "sine";
        const t0 = at + i * 0.13;
        o.frequency.setValueAtTime(150 + i * 40, t0);
        o.frequency.exponentialRampToValueAtTime(320 + i * 60, t0 + 0.11);
        env(o, t0, 0.22, 0.008, 0.12);
        o.start(t0); o.stop(t0 + 0.2);
      }
      noise(at, 0.5, "bandpass", 3200, 0.7, big ? 0.12 : 0.07);   // fizz
    }
    function sfxClink() {
      if (!audioOn) return;
      const at = ac.currentTime + 0.01;
      for (const f of [2093, 3136, 5274]) {
        const o = ac.createOscillator();
        o.type = "sine";
        o.frequency.value = f;
        env(o, at, f < 3000 ? 0.16 : 0.07, 0.003, 0.9);
        o.start(at); o.stop(at + 1.0);
      }
    }
    function sfxGulp() {
      if (!audioOn) return;
      const at = ac.currentTime + 0.01;
      const o = ac.createOscillator();
      o.type = "sine";
      o.frequency.setValueAtTime(220, at);
      o.frequency.exponentialRampToValueAtTime(90, at + 0.22);
      env(o, at, 0.28, 0.01, 0.22);
      o.start(at); o.stop(at + 0.3);
      noise(at + 0.18, 0.25, "lowpass", 900, 0.8, 0.12);
      const o2 = ac.createOscillator();          // the "ahh"
      o2.type = "triangle";
      o2.frequency.setValueAtTime(260, at + 0.42);
      o2.frequency.linearRampToValueAtTime(200, at + 0.9);
      env(o2, at + 0.42, 0.06, 0.08, 0.5);
      o2.start(at + 0.42); o2.stop(at + 1.05);
    }
    function sfxTick() {
      if (!audioOn) return;
      noise(ac.currentTime + 0.005, 0.03, "highpass", 4000, 1, 0.08);
    }
    let musicHandle = null;
    async function startMusic() {
      if (!ctx.capabilities.backgroundMusic) return;
      try {
        await ctx.music.unlock();
        if (musicHandle) return;
        musicHandle = await ctx.music.play({
          preset: "cozy", scale: "major", root: "F", volume: 0.22, tempo: 84,
          intensity: 0.32, fadeInMs: 2000
        });
      } catch (err) { musicHandle = null; }
    }
    function sfxTick(i) {
      if (!audioOn) return;
      const at = ac.currentTime + 0.003;
      noise(at, 0.012, "highpass", 3400, 1, 0.08);
      const o = ac.createOscillator();
      o.type = "square";
      o.frequency.value = 780 + ((i % 9) * 21);
      env(o, at, 0.025, 0.002, 0.016);
      o.start(at); o.stop(at + 0.04);
    }
    function sfxPop() {
      if (!audioOn) return;
      const at = ac.currentTime + 0.005;
      const o = ac.createOscillator();
      o.type = "sine";
      o.frequency.setValueAtTime(640, at);
      o.frequency.exponentialRampToValueAtTime(300, at + 0.07);
      env(o, at, 0.16, 0.004, 0.08);
      o.start(at); o.stop(at + 0.12);
    }
    // A glass rings lower as it fills: the beer loads the wall. Real, and the
    // reason a tapped pint sounds different at the top and the bottom.
    function sfxTing(frac) {
      if (!audioOn) return;
      const at = ac.currentTime + 0.005;
      const f0 = (2350 - 900 * clamp(frac, 0, 1)) * (0.985 + Math.random() * 0.03);
      const parts = [[1, 0.14, 1.5], [2.32, 0.05, 0.9], [3.9, 0.02, 0.5]];
      for (const p of parts) {
        const o = ac.createOscillator();
        o.type = "sine";
        o.frequency.value = f0 * p[0];
        env(o, at, p[1], 0.003, p[2]);
        o.start(at); o.stop(at + p[2] + 0.1);
      }
      noise(at, 0.02, "highpass", 5000, 1, 0.05);
    }
    const pourSnd = { on: false, g: null, bp: null, sine: null, sg: null, src: null, lfo: null, lg: null };
    function pourStart() {
      if (!audioOn || pourSnd.on) return;
      const at = ac.currentTime;
      const src = ac.createBufferSource(); src.buffer = noiseBuf; src.loop = true;
      const bp = ac.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = 520; bp.Q.value = 1.1;
      const g = ac.createGain(); g.gain.setValueAtTime(0.0001, at); g.gain.linearRampToValueAtTime(0.16, at + 0.25);
      const lfo = ac.createOscillator(); lfo.type = "sine"; lfo.frequency.value = 6.5;
      const lg = ac.createGain(); lg.gain.value = 0.09;
      lfo.connect(lg); lg.connect(g.gain);
      src.connect(bp); bp.connect(g); g.connect(master);
      // the air column: its pitch climbs as the glass fills
      const sine = ac.createOscillator(); sine.type = "sine"; sine.frequency.value = 380;
      const sg = ac.createGain(); sg.gain.setValueAtTime(0.0001, at); sg.gain.linearRampToValueAtTime(0.035, at + 0.3);
      sine.connect(sg); sg.connect(master);
      src.start(at); lfo.start(at); sine.start(at);
      Object.assign(pourSnd, { on: true, g, bp, sine, sg, src, lfo, lg });
    }
    function pourUpdate(frac, strength) {
      if (!pourSnd.on) return;
      const now = ac.currentTime;
      pourSnd.bp.frequency.setTargetAtTime(480 + 700 * frac, now, 0.05);
      pourSnd.sine.frequency.setTargetAtTime(360 + 1700 * frac * frac, now, 0.05);
      pourSnd.g.gain.setTargetAtTime(0.16 * strength, now, 0.08);
      pourSnd.sg.gain.setTargetAtTime(0.035 * strength, now, 0.08);
    }
    function pourStop() {
      if (!pourSnd.on) return;
      const now = ac.currentTime;
      pourSnd.g.gain.setTargetAtTime(0.0001, now, 0.08);
      pourSnd.sg.gain.setTargetAtTime(0.0001, now, 0.08);
      const s = pourSnd;
      try { s.src.stop(now + 0.5); s.lfo.stop(now + 0.5); s.sine.stop(now + 0.5); } catch (err) { /* already */ }
      pourSnd.on = false;
    }
    function haptic(kind) { try { ctx.platform.haptic(kind); } catch (err) { /* none */ } }

    // ===================================================================
    // State and persistence
    // ===================================================================
    const KEY_PROFILE = "bm.profile", KEY_DAY = "bm.day", KEY_HISTORY = "bm.history";
    const profile = { kg: 72, style: "lager", tilt: false };
    let day = MODEL.newDay(MODEL.localDate());
    let history = [];

    async function loadState() {
      try {
        const p = await ctx.storage.get(KEY_PROFILE);
        if (p && typeof p === "object") {
          if (typeof p.kg === "number" && p.kg >= 30 && p.kg <= 250) profile.kg = p.kg;
          if (MODEL.STYLES[p.style]) profile.style = p.style;
          profile.tilt = !!p.tilt;
        }
        const savedDay = await ctx.storage.get(KEY_DAY);
        const savedHist = await ctx.storage.get(KEY_HISTORY);
        const roll = MODEL.rollover(
          savedDay && savedDay.log ? savedDay : null,
          Array.isArray(savedHist) ? savedHist : [],
          MODEL.localDate(), profile.kg, profile.style);
        day = roll.day;
        history = roll.history;
        if (!Array.isArray(day.adds)) day.adds = [];
      } catch (err) { /* first run, or no storage here */ }
    }
    function saveDay() {
      fireAndForget(() => ctx.storage.set(KEY_DAY, day));
      fireAndForget(() => ctx.storage.set(KEY_HISTORY, history));
    }
    function saveProfile() { fireAndForget(() => ctx.storage.set(KEY_PROFILE, profile)); }

    const derived = { kcal: 0, earned: 0, remaining: 0, full: 0, frac: 0 };
    function recompute() {
      derived.kcal = MODEL.dayKcal(day.log, profile.kg);
      derived.earned = MODEL.earned(day, profile.kg, profile.style);
      derived.remaining = MODEL.remaining(day, profile.kg, profile.style);
      derived.full = MODEL.fullGlasses(day, profile.kg, profile.style);
      derived.frac = derived.remaining - derived.full;
    }

    // ===================================================================
    // Fonts — approved registry faces, with the system stack underneath.
    // ===================================================================
    const fontsReady = Promise.all([
      ctx.loadFont("Bebas Neue", "bebas-neue", "1.0.0", { weight: "400" }),
      ctx.loadFont("DM Serif Display", "dm-serif-display", "1.0.0", { weight: "400", style: "italic" })
    ]).catch(() => null);

    // ===================================================================
    // Three
    // ===================================================================
    const canvas = ctx.createCanvas({ touchAction: "none" });
    let THREE = null;
    const THREE_URL = "https://libs.plethora.studio/three/0.164.1/three.module.js";
    try {
      THREE = await ctx.importModule("three", "0.164.1");
    } catch (e1) {
      try { THREE = await ctx.importModule(THREE_URL); } catch (e2) { THREE = null; }
    }
    if (THREE && !THREE.WebGLRenderer && THREE.default) THREE = THREE.default;
    if (!THREE || !THREE.WebGLRenderer) {
      ctx.platform.error({ where: "load three", message: "WebGLRenderer missing" });
      ctx.platform.ready();
      return;
    }

    // World units are metres: physically-correct lights need them.
    const renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(ctx.nativeDpr || window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.localClippingEnabled = true;
    ctx.onDestroy(() => { try { renderer.dispose(); } catch (err) { /* gone */ } });

    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#120a08");
    scene.fog = new THREE.Fog("#120a08", 1.8, 4.6);
    const camera = new THREE.PerspectiveCamera(30, 1, 0.04, 6);

    // ---- an environment to reflect: a small room of warm panels, baked to a
    // ---- PMREM. This is what makes glass look like glass.
    {
      const room = new THREE.Scene();
      const box = new THREE.Mesh(new THREE.BoxGeometry(6, 4, 6),
        new THREE.MeshStandardMaterial({ color: "#241410", side: THREE.BackSide, roughness: 1 }));
      box.position.y = 1.4;
      room.add(box);
      const panel = (w, h, col, x, y, z, rx, ry) => {
        const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: col }));
        m.position.set(x, y, z);
        m.rotation.set(rx, ry, 0);
        room.add(m);
      };
      panel(2.6, 1.0, "#ffd7a3", 0, 3.3, 0, Math.PI / 2, 0);          // ceiling lamp, warm
      panel(0.7, 2.2, "#ffb46a", -2.9, 1.5, 0.4, 0, Math.PI / 2);     // amber wall to the left
      panel(1.2, 1.6, "#9fb4ff", 2.9, 1.7, -0.5, 0, -Math.PI / 2);    // a cool window to the right
      panel(1.4, 0.5, "#fff1dc", 0, 1.2, 2.9, 0, Math.PI);            // bar lights behind the camera
      panel(3.0, 0.4, "#5a3a20", 0, 0.05, 0, -Math.PI / 2, 0);        // the bar top, dim
      const pmrem = new THREE.PMREMGenerator(renderer);
      pmrem.compileEquirectangularShader();
      const envTex = pmrem.fromScene(room, 0.04).texture;
      scene.environment = envTex;
      pmrem.dispose();
    }

    // ---- light
    scene.add(new THREE.HemisphereLight("#7a5a48", "#1a0e0a", 0.9));
    const key = new THREE.DirectionalLight("#ffd9ae", 1.5);
    key.position.set(0.35, 0.7, 0.55);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.near = 0.05;
    key.shadow.camera.far = 3;
    key.shadow.camera.left = -0.4; key.shadow.camera.right = 0.4;
    key.shadow.camera.top = 0.5; key.shadow.camera.bottom = -0.2;
    key.shadow.bias = -0.0004;
    key.shadow.radius = 4;
    scene.add(key);
    const fill = new THREE.DirectionalLight("#9fb4ff", 0.55);
    fill.position.set(-0.6, 0.3, 0.4);
    scene.add(fill);
    const rim = new THREE.DirectionalLight("#ffb072", 1.6);
    rim.position.set(-0.2, 0.5, -0.7);
    scene.add(rim);
    // a lamp low behind the glass, so the beer glows from inside
    const inner = new THREE.PointLight("#ffa040", 0.5, 0.8, 2);
    inner.position.set(0.06, 0.1, -0.16);
    scene.add(inner);

    // ---- the bar. Varnished wood with a little grain in the vertex colours,
    // ---- a brass rail along the back, and bokeh where the rest of the pub is.
    {
      const geo = new THREE.PlaneGeometry(2.4, 0.9, 96, 36);
      const pos = geo.attributes.position;
      const cols = [];
      const base = new THREE.Color("#4a2b17"), dark = new THREE.Color("#2b170c"), light = new THREE.Color("#6b4224");
      const c = new THREE.Color();
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i), y = pos.getY(i);
        const grain = Math.sin(x * 38 + Math.sin(y * 9) * 2.2) * 0.5 + Math.sin(x * 90 + y * 4) * 0.25;
        const plank = Math.floor((y + 0.45) / 0.15) % 2 === 0 ? 0.04 : -0.04;
        const t = clamp(0.5 + grain * 0.35 + plank, 0, 1);
        c.copy(dark).lerp(light, t);
        c.lerp(base, 0.35);
        cols.push(c.r, c.g, c.b);
      }
      geo.setAttribute("color", new THREE.Float32BufferAttribute(cols, 3));
      const bar = new THREE.Mesh(geo, new THREE.MeshPhysicalMaterial({
        vertexColors: true, roughness: 0.55, metalness: 0.02, clearcoat: 0.22, clearcoatRoughness: 0.42
      }));
      bar.rotation.x = -Math.PI / 2;
      bar.position.set(0, 0, -0.12);
      bar.receiveShadow = true;
      scene.add(bar);

      const front = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.5, 0.06),
        new THREE.MeshStandardMaterial({ color: "#2a170d", roughness: 0.7 }));
      front.position.set(0, -0.254, 0.365);
      scene.add(front);

      const brass = new THREE.MeshStandardMaterial({ color: "#d3a64d", metalness: 1, roughness: 0.22 });
      const railR = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.009, 2.2, 14), brass);
      railR.rotation.z = Math.PI / 2;
      railR.position.set(0, 0.012, -0.56);
      scene.add(railR);
      for (const x of [-0.7, 0, 0.7]) {
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.008, 0.024, 10), brass);
        post.position.set(x, 0.0, -0.56);
        scene.add(post);
      }

      // backdrop: a dark warm wall, and a shelf of bottles as silhouettes
      const wall = new THREE.Mesh(new THREE.PlaneGeometry(4, 2.4),
        new THREE.MeshStandardMaterial({ color: "#1a0e0b", roughness: 1 }));
      wall.position.set(0, 0.9, -1.1);
      scene.add(wall);
      const bottleMat = new THREE.MeshPhysicalMaterial({
        color: "#3b1f14", roughness: 0.25, transmission: 0, clearcoat: 1, clearcoatRoughness: 0.1
      });
      for (let i = 0; i < 18; i++) {
        const h = rrange(0.22, 0.34), r = rrange(0.028, 0.04);
        const bt = new THREE.Mesh(new THREE.CapsuleGeometry(r, h - 2 * r, 3, 10), bottleMat);
        bt.position.set(0.08 + i * 0.056 + rrange(-0.01, 0.01), 0.31 + h / 2, -1.0);
        bt.material = bottleMat.clone();
        bt.material.color.set(["#3b1f14", "#1e3a22", "#4a2a12", "#2c2c3a", "#5a3a1a"][i % 5]);
        scene.add(bt);
      }
      const shelf = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.02, 0.16),
        new THREE.MeshStandardMaterial({ color: "#2e1a10", roughness: 0.6 }));
      shelf.position.set(0.58, 0.3, -1.0);
      scene.add(shelf);
    }

    // ---- your tab, chalked on the wall: four strokes and a diagonal per
    // ---- pint earned today, the ones you have drunk rubbed dim
    const TAB_MAX = 40;
    // From the settled camera the only clear wall is a narrow band just above
    // the rail, right of the earned glasses; the board is a strip that fits it.
    const tabMarks = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.0055, 0.052, 0.004),
      new THREE.MeshStandardMaterial({ roughness: 0.95, emissive: "#d9d2c2", emissiveIntensity: 0.45 }), TAB_MAX);
    tabMarks.count = 0;
    {
      const board = new THREE.Group();
      board.position.set(0.25, 0.012, -1.07);
      board.rotation.y = -0.1;
      board.add(new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.15, 0.018),
        new THREE.MeshStandardMaterial({ color: "#182521", roughness: 0.96 })));
      const wood = new THREE.MeshStandardMaterial({ color: "#5a3a22", roughness: 0.7 });
      for (const f of [[0.48, 0.022, 0, 0.086], [0.48, 0.022, 0, -0.086], [0.022, 0.15, -0.229, 0], [0.022, 0.15, 0.229, 0]]) {
        const m = new THREE.Mesh(new THREE.BoxGeometry(f[0], f[1], 0.03), wood);
        m.position.set(f[2], f[3], 0.005);
        board.add(m);
      }
      board.add(tabMarks);
      scene.add(board);
    }
    const _zAxis = new THREE.Vector3(0, 0, 1);
    function updateTab() {
      const total = Math.min(TAB_MAX, Math.floor(derived.earned + 1e-9));
      const chalk = new THREE.Color("#f3eee2"), dim = new THREE.Color("#5b665f");
      let k = 0;
      for (let i = 0; i < total; i++) {
        const grp = Math.floor(i / 5), inG = i % 5;
        const x0 = -0.19 + grp * 0.052;
        _pos.set(x0 + (inG < 4 ? inG * 0.0095 : 0.0145), 0, 0.012);
        const jit = ((i * 7919) % 13) / 13 - 0.5;
        _q.setFromAxisAngle(_zAxis, inG < 4 ? jit * 0.16 : 0.8);
        _scl.set(1, inG < 4 ? 1 + jit * 0.08 : 1.45, 1);
        _m4.compose(_pos, _q, _scl);
        tabMarks.setMatrixAt(k, _m4);
        tabMarks.setColorAt(k, i < day.poured ? dim : chalk);
        k++;
      }
      tabMarks.count = k;
      tabMarks.instanceMatrix.needsUpdate = true;
      if (tabMarks.instanceColor) tabMarks.instanceColor.needsUpdate = true;
    }

    // ---- bokeh: soft discs of pub light, additive, drifting
    const BOKEH_N = 72;
    const bokeh = new THREE.InstancedMesh(
      new THREE.CircleGeometry(1, 20),
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.42, blending: THREE.AdditiveBlending,
        depthWrite: false, fog: false }),
      BOKEH_N
    );
    const bokehSeeds = [];
    {
      const col = new THREE.Color();
      const palette = ["#ffb35c", "#ffd48a", "#ff8c42", "#fff1cf", "#ffc26b", "#d98a3c"];
      for (let i = 0; i < BOKEH_N; i++) {
        bokehSeeds.push({ x: rrange(-0.9, 0.9), y: rrange(0.08, 0.62), z: rrange(-0.98, -0.7),
                          r: rrange(0.022, 0.085), ph: rrange(0, 6.3), sp: rrange(0.3, 0.9) });
        col.set(palette[i % palette.length]);
        bokeh.setColorAt(i, col);
      }
    }
    scene.add(bokeh);

    // ===================================================================
    // The glass. A radius profile revolved into a solid, so — as with any
    // real glass — volume is not height. The fill is inverted through a
    // volume table, and the beer is a solid cut by a level plane.
    // ===================================================================
    const GLASSES = {
      shaker:    { H: 0.150, wall: 0.0025, base: 0.012,
                   outer: [[0, 0.031], [0.15, 0.042]] },
      pilsner:   { H: 0.190, wall: 0.0022, base: 0.016,
                   outer: [[0, 0.031], [0.006, 0.031], [0.014, 0.022], [0.034, 0.0225], [0.19, 0.036]] },
      weizen:    { H: 0.200, wall: 0.0022, base: 0.016,
                   outer: [[0, 0.033], [0.01, 0.030], [0.05, 0.0265], [0.105, 0.036], [0.15, 0.043], [0.2, 0.039]] },
      tulip:     { H: 0.160, wall: 0.0024, base: 0.016,
                   outer: [[0, 0.031], [0.012, 0.027], [0.062, 0.043], [0.112, 0.0355], [0.16, 0.042]] },
      pintTulip: { H: 0.160, wall: 0.0025, base: 0.012,
                   outer: [[0, 0.030], [0.06, 0.034], [0.12, 0.044], [0.16, 0.042]] }
    };
    const LOOK = {
      lager:   { color: "#f4c341", attn: "#e08a12", dist: 0.045, trans: 0.92, rough: 0.10,
                 foam: "#fff7e8", foamK: 0.30, rest: 0.012, tau: 5.0, bubble: "#fff6d8", surge: false },
      pilsner: { color: "#f9df6e", attn: "#e6a824", dist: 0.060, trans: 0.94, rough: 0.08,
                 foam: "#fffaf0", foamK: 0.36, rest: 0.016, tau: 5.0, bubble: "#fff6d8", surge: false },
      wheat:   { color: "#eec46a", attn: "#c98a2a", dist: 0.018, trans: 0.62, rough: 0.42,
                 foam: "#fff8ec", foamK: 0.80, rest: 0.030, tau: 8.0, bubble: "#fff1d0", surge: false },
      ipa:     { color: "#e9962c", attn: "#a8480a", dist: 0.028, trans: 0.86, rough: 0.14,
                 foam: "#fdf3e0", foamK: 0.40, rest: 0.014, tau: 5.5, bubble: "#fff0cc", surge: false },
      stout:   { color: "#2a1008", attn: "#5e1a0e", dist: 0.006, trans: 0.55, rough: 0.20,
                 foam: "#f3e9d9", foamK: 0.55, rest: 0.022, tau: 9.0, bubble: "#d9c7a8", surge: true }
    };

    function interpProfile(pts, h) {
      if (h <= pts[0][0]) return pts[0][1];
      for (let i = 1; i < pts.length; i++) {
        if (h <= pts[i][0]) {
          const t = (h - pts[i - 1][0]) / (pts[i][0] - pts[i - 1][0]);
          return lerp(pts[i - 1][1], pts[i][1], t);
        }
      }
      return pts[pts.length - 1][1];
    }

    // One glass's derived geometry: radii, the volume table and its inverse.
    function makeGlassSpec(kind) {
      const gdef = GLASSES[kind];
      const outerR = (h) => interpProfile(gdef.outer, h);
      const innerR = (h) => Math.max(0.004, outerR(h) - gdef.wall);
      const N = 96;
      const vol = new Float64Array(N + 1);
      for (let i = 1; i <= N; i++) {
        const h0 = gdef.base + ((i - 1) / N) * (gdef.H - gdef.base);
        const h1 = gdef.base + (i / N) * (gdef.H - gdef.base);
        const r0 = innerR(h0), r1 = innerR(h1);
        vol[i] = vol[i - 1] + Math.PI * ((r0 * r0 + r0 * r1 + r1 * r1) / 3) * (h1 - h0);
      }
      const full = vol[N];
      function levelFor(frac) {
        const target = clamp(frac, 0, 1) * full;
        let lo = 0, hi = N;
        while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (vol[mid] < target) lo = mid; else hi = mid; }
        const t = vol[hi] > vol[lo] ? (target - vol[lo]) / (vol[hi] - vol[lo]) : 0;
        return gdef.base + ((lo + t) / N) * (gdef.H - gdef.base);
      }
      return { kind: kind, H: gdef.H, base: gdef.base, wall: gdef.wall, outerR, innerR,
               levelFor, litres: full * 1000 };
    }

    function glassGeometry(spec) {
      const pts = [];
      const P = (r, h) => pts.push(new THREE.Vector2(r, h));
      P(0, 0);
      P(spec.outerR(0) - 0.004, 0);
      P(spec.outerR(0), 0.0025);
      for (let i = 1; i <= 26; i++) {
        const h = 0.0025 + (i / 26) * (spec.H - 0.0025 - 0.0006);
        P(spec.outerR(h), h);
      }
      P(spec.outerR(spec.H) - spec.wall * 0.5, spec.H + 0.0007);     // rounded rim
      P(spec.innerR(spec.H), spec.H);
      for (let i = 1; i <= 26; i++) {
        const h = spec.H - (i / 26) * (spec.H - spec.base);
        P(spec.innerR(h), h);
      }
      P(0, spec.base);
      return new THREE.LatheGeometry(pts, 64);
    }
    function liquidGeometry(spec) {
      const pts = [];
      pts.push(new THREE.Vector2(0, spec.base));
      for (let i = 0; i <= 30; i++) {
        const h = spec.base + (i / 30) * (spec.H - spec.base);
        pts.push(new THREE.Vector2(spec.innerR(h) - 0.0003, h));
      }
      pts.push(new THREE.Vector2(0, spec.H));
      return new THREE.LatheGeometry(pts, 64);
    }
    // A cushion of foam, unit radius and height, roughened on top.
    function foamGeometry() {
      const pts = [];
      const prof = [[0, 1.0], [0.35, 0.99], [0.62, 0.95], [0.82, 0.86], [0.94, 0.7], [0.99, 0.45], [1.0, 0.2], [0.97, 0]];
      for (const p of prof) pts.push(new THREE.Vector2(p[0], p[1]));
      const g = new THREE.LatheGeometry(pts, 40);
      const pos = g.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
        if (y > 0.6) {
          const n = Math.sin(x * 23 + z * 17) * 0.5 + Math.sin(x * 51 - z * 33) * 0.3 + Math.sin(z * 71) * 0.2;
          pos.setY(i, y + n * 0.06 * (y - 0.6));
        }
      }
      g.computeVertexNormals();
      return g;
    }

    const glassMat = new THREE.MeshPhysicalMaterial({
      color: "#ffffff", metalness: 0, roughness: 0.04, transmission: 1, thickness: 0.006,
      ior: 1.5, clearcoat: 1, clearcoatRoughness: 0.04, envMapIntensity: 1.2,
      attenuationColor: new THREE.Color("#dff3ff"), attenuationDistance: 0.6
    });
    const cheapGlassMat = new THREE.MeshPhysicalMaterial({
      color: "#ffffff", metalness: 0, roughness: 0.06, transparent: true, opacity: 0.24,
      clearcoat: 1, clearcoatRoughness: 0.05, envMapIntensity: 1.4, depthWrite: false
    });
    // Opaque on purpose. three's transmission pass refracts the *opaque* scene,
    // so a transmissive beer inside a transmissive glass is invisible — the wall
    // wins the depth test and its refraction has nothing behind it. An opaque
    // beer with a clearcoat and a warm emissive reads richer through the glass
    // anyway, because the glass does the bending.
    const beerMat = new THREE.MeshPhysicalMaterial({
      metalness: 0, roughness: 0.1, clearcoat: 1, clearcoatRoughness: 0.06,
      clippingPlanes: [], envMapIntensity: 0.9, emissiveIntensity: 0.2
    });
    const capMat = new THREE.MeshStandardMaterial({ roughness: 0.08, metalness: 0, envMapIntensity: 1.6 });
    const foamMat = new THREE.MeshStandardMaterial({ roughness: 0.96, metalness: 0 });
    const rowBeerMat = new THREE.MeshStandardMaterial({ roughness: 0.18, metalness: 0 });
    const rowFoamMat = new THREE.MeshStandardMaterial({ roughness: 0.96 });

    // the level plane: world-horizontal, so the beer stays flat when the glass tilts
    const levelPlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 0);
    beerMat.clippingPlanes = [levelPlane];

    const glassGroup = new THREE.Group();       // tilts with the phone
    scene.add(glassGroup);
    const liquidGroup = new THREE.Group();      // sits on the level plane: cap + foam
    scene.add(liquidGroup);
    const FOAM_GEO = foamGeometry();

    const G = {                                 // the live glass
      spec: null, glass: null, liquid: null, cap: null, foam: null,
      levelFrac: 0, targetFrac: 0, head: 0, headRest: 0.012, look: LOOK.lager,
      sloshX: 0, sloshVX: 0, sloshZ: 0, sloshVZ: 0, tiltX: 0, tiltY: 0, shownTiltX: 0, shownTiltY: 0,
      nucl: [], overflowT: -1,
      driven: false, drinkTip: 0, pulse: 0
    };

    function disposeMesh(m) {
      if (!m) return;
      m.parent && m.parent.remove(m);
      if (m.geometry) m.geometry.dispose();
    }

    function buildGlass(styleKey) {
      const style = MODEL.STYLES[styleKey];
      const look = LOOK[styleKey];
      const spec = makeGlassSpec(style.glass);
      disposeMesh(G.glass); disposeMesh(G.liquid); disposeMesh(G.cap); disposeMesh(G.foam);
      G.spec = spec; G.look = look;

      G.glass = new THREE.Mesh(glassGeometry(spec), glassMat);
      G.glass.castShadow = true;
      glassGroup.add(G.glass);

      beerMat.color.set(look.color);
      beerMat.emissive.set(look.attn);
      beerMat.emissiveIntensity = look.surge ? 0.05 : (look.rough > 0.3 ? 0.14 : 0.22);
      beerMat.roughness = look.rough > 0.3 ? 0.34 : 0.1;
      beerMat.sheen = look.rough > 0.3 ? 0.25 : 0;
      beerMat.sheenColor.set("#ffe8c0");
      beerMat.needsUpdate = true;
      G.liquid = new THREE.Mesh(liquidGeometry(spec), beerMat);
      glassGroup.add(G.liquid);

      capMat.color.set(look.color);
      G.cap = new THREE.Mesh(new THREE.CircleGeometry(1, 56), capMat);
      G.cap.rotation.x = -Math.PI / 2;
      liquidGroup.add(G.cap);

      foamMat.color.set(look.foam);
      G.foam = new THREE.Mesh(FOAM_GEO, foamMat);
      G.foam.castShadow = true;
      liquidGroup.add(G.foam);
      G.headRest = look.rest;

      // bubbles stream from fixed nucleation sites, as they do in a real glass
      G.nucl = [];
      for (let i = 0; i < 7; i++) {
        G.nucl.push({ r: spec.innerR(spec.base + 0.01) * rrange(0.15, 0.9), th: rrange(0, 6.283),
                      y: spec.base + rrange(0.002, 0.02), next: rrange(0, 0.4), rate: rrange(0.1, 0.32) });
      }
      bubbleMat.color.set(look.bubble);
      for (const b of bubbles) b.alive = false;
      for (const d of drops) { d.y = rrange(0.006, spec.H * 0.9); d.show = 0; }
      fitCamera();
    }

    // ---- bubbles
    const BUB_N = 170;
    const bubbleMat = new THREE.MeshStandardMaterial({ color: "#fff6d8", roughness: 0.2, envMapIntensity: 1.5,
      emissive: "#fff3d0", emissiveIntensity: 0.55 });
    const bubbleMesh = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 6, 5), bubbleMat, BUB_N);
    bubbleMesh.frustumCulled = false;
    bubbleMesh.count = 0;
    scene.add(bubbleMesh);
    const bubbles = [];
    for (let i = 0; i < BUB_N; i++) bubbles.push({ alive: false, x: 0, y: 0, z: 0, s: 0.001, vy: 0, ph: 0, wall: false });

    // ---- condensation: only where the beer is, because that is where the glass is cold
    const DROP_N = 190;
    const dropMat = new THREE.MeshStandardMaterial({ color: "#eaf6ff", roughness: 0.03, metalness: 0,
      transparent: true, opacity: 0.5, envMapIntensity: 2.0 });
    const dropMesh = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 7, 5), dropMat, DROP_N);
    dropMesh.frustumCulled = false;
    scene.add(dropMesh);
    const drops = [];
    for (let i = 0; i < DROP_N; i++) {
      drops.push({ th: rrange(0, 6.283), y: rrange(0.006, 0.14), s: rrange(0.0004, 0.0013), show: 0 });
    }

    // ---- the pints already earned, waiting on the bar
    const ROW_MAX = 4;
    // All on the left, receding: the right edge belongs to the activity chips,
    // and a portrait frustum is only about ±13 cm wide at the glass.
    const ROW_POS = [[-0.08, -0.05], [-0.106, -0.118], [-0.074, -0.19], [-0.102, -0.262]];
    const row = [];     // { group, anim: "in"|"idle"|"out", t }
    function makeRowGlass(spec, look) {
      const grp = new THREE.Group();
      const gl = new THREE.Mesh(glassGeometry(spec), cheapGlassMat);
      gl.renderOrder = 2;
      grp.add(gl);
      const beer = new THREE.Mesh(liquidGeometry(spec), rowBeerMat.clone());
      beer.material.color.set(look.color);
      beer.scale.y = 0.9;
      beer.position.y = 0;
      grp.add(beer);
      const fm = new THREE.Mesh(FOAM_GEO, rowFoamMat.clone());
      fm.material.color.set(look.foam);
      const top = spec.base + (spec.H - spec.base) * 0.9;
      fm.scale.set(spec.innerR(top) * 0.98, look.rest * 1.1, spec.innerR(top) * 0.98);
      fm.position.y = top;
      grp.add(fm);
      return grp;
    }
    function syncRowCount(target, animate) {
      target = Math.min(ROW_MAX, target);
      while (row.filter((r) => r.anim !== "out").length < target) {
        const grp = makeRowGlass(G.spec, G.look);
        const idx = row.filter((r) => r.anim !== "out").length;
        grp.position.set(ROW_POS[idx][0], 0, ROW_POS[idx][1]);
        grp.scale.setScalar(animate ? 0.001 : 0.5);
        scene.add(grp);
        row.push({ group: grp, anim: animate ? "in" : "idle", t: 0 });
      }
      let live = row.filter((r) => r.anim !== "out");
      while (live.length > target) {
        const r = live[live.length - 1];
        r.anim = "out"; r.t = 0;
        live = row.filter((x) => x.anim !== "out");
      }
      live.forEach((r, i) => { r.slot = i; });
    }
    function rebuildRow() {
      for (const r of row) { scene.remove(r.group); }
      row.length = 0;
      syncRowCount(derived.full, false);
    }
    function stepRow(dt) {
      for (let i = row.length - 1; i >= 0; i--) {
        const r = row[i];
        const slot = ROW_POS[Math.min(ROW_MAX - 1, r.slot || 0)];
        if (r.anim === "in") {
          r.t += dt;
          const k = easeOut(clamp(r.t / 0.7, 0, 1));
          const over = Math.sin(k * Math.PI) * 0.08;
          r.group.scale.setScalar(0.5 * k + over);
          r.group.position.y = (1 - k) * 0.04;
          if (r.t >= 0.7) { r.anim = "idle"; r.group.scale.setScalar(0.5); r.group.position.y = 0; }
        } else if (r.anim === "out") {
          r.t += dt;
          const k = clamp(r.t / 0.75, 0, 1);
          r.group.rotation.z = -easeInOut(k) * 1.1;
          r.group.position.y = Math.sin(k * Math.PI) * 0.05;
          r.group.scale.setScalar(0.5 * (1 - k * k));
          if (k >= 1) { scene.remove(r.group); row.splice(i, 1); continue; }
        }
        if (r.anim !== "out") {
          r.group.position.x += (slot[0] - r.group.position.x) * Math.min(1, dt * 6);
          r.group.position.z += (slot[1] - r.group.position.z) * Math.min(1, dt * 6);
        }
      }
    }

    // ---- per-frame liquid update
    const _n = new THREE.Vector3(), _q = new THREE.Quaternion(), _up = new THREE.Vector3(0, 1, 0);
    function stepLiquid(dt, t) {
      const spec = G.spec, look = G.look;
      // fill eases toward the truth; an overflow holds at the brim for a beat
      let target = G.targetFrac;
      if (G.overflowT >= 0) {
        G.overflowT += dt;
        if (G.overflowT < 0.55) target = 1;
        else if (G.overflowT > 1.3) G.overflowT = -1;
      }
      if (!G.driven) {
        const rate = target > G.levelFrac ? 3.6 : 4.2;
        G.levelFrac += (target - G.levelFrac) * Math.min(1, dt * rate);
        if (Math.abs(target - G.levelFrac) < 0.0004) G.levelFrac = target;
      }

      // head: kicked by pouring, always settling toward its resting height
      const rest = G.levelFrac > 0.005 ? G.headRest : 0;
      G.head += (rest - G.head) * Math.min(1, dt / look.tau);
      if (G.levelFrac < 0.005) G.head = 0;

      // tilt, smoothed; slosh is a damped spring kicked by tilt velocity
      const dtx = G.tiltX - G.shownTiltX, dty = G.tiltY - G.shownTiltY;
      G.shownTiltX += dtx * Math.min(1, dt * 9);
      G.shownTiltY += dty * Math.min(1, dt * 9);
      G.sloshVX += (-G.sloshX * 60 - G.sloshVX * 5.5 + dtx * 90) * dt;
      G.sloshVZ += (-G.sloshZ * 60 - G.sloshVZ * 5.5 + dty * 90) * dt;
      G.sloshX += G.sloshVX * dt;
      G.sloshZ += G.sloshVZ * dt;
      glassGroup.rotation.z = -G.shownTiltX * 0.34;
      glassGroup.rotation.x = G.shownTiltY * 0.30 + G.drinkTip;
      G.pulse = Math.max(0, G.pulse - dt * 4);
      const pk = 1 + Math.sin(G.pulse * Math.PI) * 0.035;
      glassGroup.scale.set(pk, 1, pk);

      const levelY = G.levelFrac > 0.002 ? spec.levelFor(G.levelFrac) : -1;
      _n.set(clamp(G.sloshX, -0.35, 0.35), 1, clamp(G.sloshZ, -0.35, 0.35)).normalize();
      levelPlane.normal.copy(_n).negate();
      levelPlane.constant = levelY > 0 ? levelY * _n.y : -1;  // no beer: keep y <= -1, which is nothing
      // Note: material.clippingPlanes keeps the side where plane.distanceToPoint > 0.
      // With normal = -n and constant = levelY·n.y, points below the level are positive.

      // where the level plane crosses the glass's own axis, in the glass's frame
      const ca = Math.cos(glassGroup.rotation.z) * Math.cos(glassGroup.rotation.x);
      const hLocal = levelY > 0 ? clamp(levelY / Math.max(0.5, ca), spec.base, spec.H) : 0;
      const r = levelY > 0 ? spec.innerR(hLocal) * (0.94 + 0.06 * ca) : 0;
      _axis.set(0, hLocal, 0);
      glassGroup.localToWorld(_axis);
      liquidGroup.position.set(_axis.x, Math.max(0, levelY), _axis.z);
      _q.setFromUnitVectors(_up, _n);
      liquidGroup.quaternion.copy(_q);
      G.cap.visible = levelY > 0;
      G.cap.scale.setScalar(Math.max(0.0001, r - 0.0006));
      G.foam.visible = levelY > 0 && G.head > 0.0006;
      G.foam.scale.set(r * 1.0, G.head, r * 1.0);
      G.foam.rotation.y = t * 0.02;

      // bubbles
      let n = 0;
      if (levelY > 0) {
        for (const site of G.nucl) {
          site.next -= dt;
          if (site.next <= 0 && site.y < levelY - 0.004) {
            site.next = site.rate * rrange(0.6, 1.4);
            const b = bubbles.find((x) => !x.alive);
            if (b) {
              b.alive = true;
              if (look.surge && rnd() < 0.7) {
                // nitro stout: the famous cascade down the inside of the wall
                const wr = spec.innerR(levelY) * 0.965;
                const th = rrange(0, 6.283);
                b.x = Math.sin(th) * wr; b.z = Math.cos(th) * wr; b.y = levelY - 0.004;
                b.s = rrange(0.0005, 0.0009); b.vy = -rrange(0.018, 0.03); b.wall = true;
              } else {
                b.x = Math.sin(site.th) * site.r; b.z = Math.cos(site.th) * site.r; b.y = site.y;
                b.s = look.surge ? rrange(0.0005, 0.0009) : rrange(0.0008, 0.0022);
                b.vy = 0.02 + b.s * (look.surge ? 10 : 30); b.wall = false;
              }
              b.ph = rrange(0, 6.283);
            }
          }
        }
      }
      for (const b of bubbles) {
        if (!b.alive) continue;
        b.y += b.vy * dt;
        b.ph += dt * 7;
        if (!b.wall) {
          b.x += Math.sin(b.ph) * 0.0009 * dt * 6;
          b.z += Math.cos(b.ph * 0.8) * 0.0009 * dt * 6;
          if (b.y >= levelY - 0.0012 || levelY <= 0) { b.alive = false; G.head += 0.00001; continue; }
        } else if (b.y <= spec.base + 0.004 || levelY <= 0) { b.alive = false; continue; }
        // keep inside the glass
        const rr = spec.innerR(clamp(b.y, spec.base, spec.H)) - 0.0012;
        const d = Math.hypot(b.x, b.z);
        if (d > rr) { b.x *= rr / d; b.z *= rr / d; }
        _pos.set(b.x, b.y, b.z).applyMatrix4(glassGroup.matrixWorld);
        _scl.setScalar(b.s);
        _m4.compose(_pos, _idq, _scl);
        bubbleMesh.setMatrixAt(n++, _m4);
      }
      bubbleMesh.count = n;
      bubbleMesh.instanceMatrix.needsUpdate = true;

      // condensation
      let k = 0;
      const cold = levelY > 0.01;
      for (const d of drops) {
        const want = cold && d.y < levelY - 0.004 ? 1 : 0;
        d.show += (want - d.show) * Math.min(1, dt * (want ? 0.35 : 1.4));
        if (want) d.s = Math.min(0.0019, d.s + 0.0000045 * dt);
        if (d.s > 0.00135) {
          d.y -= (d.s - 0.0012) * 0.7 * dt;
          if (d.y < 0.005) { d.y = rrange(0.01, Math.max(0.02, levelY - 0.01)); d.s = rrange(0.0004, 0.0008); d.th = rrange(0, 6.283); }
        }
        if (d.show < 0.02) continue;
        const rad = spec.outerR(d.y) + 0.0004;
        _pos.set(Math.sin(d.th) * rad, d.y, Math.cos(d.th) * rad).applyMatrix4(glassGroup.matrixWorld);
        _q2.setFromAxisAngle(_up, d.th).premultiply(glassGroup.quaternion);
        const s = d.s * d.show;
        _scl.set(s, s * 1.35, s * 0.5);
        _m4.compose(_pos, _q2, _scl);
        dropMesh.setMatrixAt(k++, _m4);
      }
      dropMesh.count = k;
      dropMesh.instanceMatrix.needsUpdate = true;
    }
    const _pos = new THREE.Vector3(), _scl = new THREE.Vector3(), _m4 = new THREE.Matrix4();
    const _axis = new THREE.Vector3();
    const _idq = new THREE.Quaternion(), _q2 = new THREE.Quaternion();

    // ---- pouring energy in: the level target moves, the head jumps, glasses overflow
    function pourIn(deltaFrac) {
      const look = G.look;
      const headroom = 1 - G.levelFrac;
      const agitation = 0.35 + 0.65 * headroom;
      G.head += clamp(deltaFrac, 0, 1) * look.foamK * agitation * (G.spec.H * 0.22);
      G.head = Math.min(G.head, G.spec.H * 0.17);
    }

    // ---- camera
    let W = ctx.width, H = ctx.height;
    const cam = { tdist: 0.5, tlook: 0.08 };
    // The camera is a character: a wide high lens down the bar for choosing, a
    // push toward the thing you picked, a tight push for the pour, and the
    // settled shot for play. Position, target and focal length all ease.
    const camPos = new THREE.Vector3(0, 0.34, 1.2), camLook = new THREE.Vector3(0, 0.08, 0);
    const camGoalPos = new THREE.Vector3(), camGoalLook = new THREE.Vector3();
    let camFov = 30, camGoalFov = 30;
    function camGoals() {
      const D = cam.tdist, Hg = G.spec ? G.spec.H : 0.15;
      const st = (typeof UI !== "undefined") ? UI.state : "result";
      if (st === "pick") { camGoalPos.set(0, 0.46, 0.94); camGoalLook.set(0, 0.0, 0.12); camGoalFov = 50; }
      else if (st === "amount" || st === "live") { camGoalPos.set(0, 0.28, 0.62); camGoalLook.set(0, 0.06, 0.12); camGoalFov = 40; }
      else if (st === "reveal") { camGoalPos.set(0, Hg * 0.6 + D * 0.17, D * 0.86); camGoalLook.set(0, Hg * 0.6, 0); camGoalFov = 30; }
      else { camGoalPos.set(0, Hg * 0.5 + D * 0.2, D); camGoalLook.set(0, Hg * 0.5, 0); camGoalFov = 30; }
    }
    function fitCamera() {
      const Hg = G.spec ? G.spec.H : 0.15;
      const vfov = camera.fov * Math.PI / 180;
      const aspect = Math.max(0.4, W / Math.max(1, H));
      const dv = (Hg * 1.75 / 2) / Math.tan(vfov / 2);
      const dh = 0.15 / (Math.tan(vfov / 2) * aspect);      // room for the row beside it
      cam.tdist = Math.max(dv, dh);
      cam.tlook = Hg * 0.5 - 0.004;
    }
    function placeCamera(t, dt) {
      camGoals();
      const k = 1 - Math.exp(-(dt || 0.016) * 3.0);
      camPos.lerp(camGoalPos, k);
      camLook.lerp(camGoalLook, k);
      camFov += (camGoalFov - camFov) * k;
      if (Math.abs(camera.fov - camFov) > 0.02) { camera.fov = camFov; camera.updateProjectionMatrix(); }
      const sway = Math.sin(t * 0.23) * 0.012;
      camera.position.set(camPos.x + sway + G.shownTiltX * 0.04, camPos.y + G.shownTiltY * 0.02, camPos.z);
      camera.lookAt(camLook);
      camera.updateMatrixWorld();
    }


    // ===================================================================
    // Chrome. Three acts — ask, pour, play — as DOM over the GL canvas. The
    // root is invisible to the finger and only the controls opt back in.
    // ===================================================================
    const ui = ctx.createRoot({ touchAction: "none" });
    ui.style.pointerEvents = "none";
    const DISPLAY = '"Bebas Neue","Oswald","Impact",system-ui,sans-serif';
    const SERIF = '"DM Serif Display",Georgia,"Times New Roman",serif';
    const BODY = 'system-ui,-apple-system,"Segoe UI",Roboto,sans-serif';
    ui.innerHTML = [
      "<style>",
      ".bm{position:absolute;inset:0;pointer-events:none;color:#fff;font-family:" + BODY + ";",
      "-webkit-user-select:none;user-select:none;overflow:hidden}",
      ".bm *{box-sizing:border-box}",
      ".bm button{font-family:inherit;cursor:pointer;-webkit-tap-highlight-color:transparent}",
      ".bm-top{position:absolute;left:0;right:0;top:0;padding:0 18px;text-align:center;transition:opacity .4s;",
      "background:linear-gradient(180deg,rgba(12,6,4,.92),rgba(12,6,4,.6) 60%,rgba(12,6,4,0))}",
      ".bm-brand{font-family:" + DISPLAY + ";font-size:15px;letter-spacing:.34em;color:#e9b95a;opacity:.92}",
      ".bm-num{display:flex;align-items:baseline;justify-content:center;gap:10px;margin-top:2px;line-height:1}",
      ".bm-big{font-family:" + DISPLAY + ";font-size:92px;color:#fff;letter-spacing:.01em;",
      "text-shadow:0 2px 24px rgba(255,180,80,.25);transition:font-size .3s}",
      ".bm-unit{font-family:" + DISPLAY + ";font-size:30px;color:#e9b95a;letter-spacing:.06em}",
      ".bm-style{font-family:" + SERIF + ";font-style:italic;font-size:17px;color:#ffe2b3;opacity:.9;margin-top:-4px}",
      ".bm-kcal{font-size:11.5px;font-weight:600;opacity:.62;margin-top:6px;letter-spacing:.04em}",
      ".bm-top.small .bm-big{font-size:44px}.bm-top.small .bm-unit{font-size:18px}",
      ".bm-top.small .bm-style{font-size:14px}.bm-top.small .bm-kcal{display:none}",
      ".bm-stage{position:absolute;inset:0;pointer-events:none}",
      ".bm-ask{position:absolute;left:0;right:0;bottom:0;pointer-events:auto;padding:0 18px;",
      "background:linear-gradient(180deg,rgba(12,6,4,0),rgba(12,6,4,.86) 18%,rgba(12,6,4,.96) 40%)}",
      ".bm-q{font-family:" + SERIF + ";font-style:italic;font-size:30px;color:#ffe9c4;text-align:center;",
      "line-height:1.12;margin:0 0 16px}",
      ".bm-pickq{position:absolute;left:0;right:0;text-align:center;pointer-events:none;padding:0 18px}",
      ".bm-pickq .bm-sub{font-size:10.5px;letter-spacing:.22em;font-weight:700;opacity:.5;margin-top:-8px}",
      ".bm-labels{position:absolute;inset:0;pointer-events:none}",
      ".bm-lbl{position:absolute;transform:translate(-50%,0);pointer-events:auto;border:1px solid rgba(255,220,160,.18);",
      "background:rgba(18,9,5,.74);border-radius:12px;padding:5px 10px 4px;color:#ffe9c4;font-family:" + DISPLAY + ";",
      "font-size:14px;letter-spacing:.12em;white-space:nowrap;text-align:center;transition:opacity .25s;line-height:1.05}",
      ".bm-lbl i{display:block;font-style:normal;font-family:" + BODY + ";font-size:9.5px;opacity:.6;letter-spacing:.02em;min-height:11px}",
      ".bm-pickfoot{position:absolute;left:0;right:0;bottom:0;text-align:center;padding:12px 18px 0;pointer-events:auto;",
      "background:linear-gradient(180deg,rgba(12,6,4,0),rgba(12,6,4,.85) 50%)}",
      ".bm-cards{display:grid;grid-template-columns:1fr 1fr;gap:10px}",
      ".bm-card{border:1px solid rgba(255,220,160,.16);border-radius:20px;padding:15px 8px 12px;",
      "background:rgba(34,17,9,.85);color:#fff;display:flex;flex-direction:column;align-items:center;gap:5px}",
      ".bm-card:active{background:rgba(233,185,90,.92);color:#2a1408}",
      ".bm-card span{font-size:38px;line-height:1}",
      ".bm-card b{font-family:" + DISPLAY + ";font-size:21px;letter-spacing:.12em;font-weight:400}",
      ".bm-card i{font-style:normal;font-size:10.5px;opacity:.55;min-height:13px}",
      ".bm-tally{text-align:center;font-size:12px;opacity:.62;margin-top:12px;font-weight:600;letter-spacing:.03em}",
      ".bm-amt{display:flex;align-items:baseline;justify-content:center;gap:10px;margin:2px 0 0;line-height:1}",
      ".bm-amtv{font-family:" + DISPLAY + ";font-size:98px;color:#fff;text-shadow:0 2px 28px rgba(255,180,80,.3)}",
      ".bm-amtu{font-family:" + DISPLAY + ";font-size:28px;color:#e9b95a;letter-spacing:.08em}",
      ".bm-prev{font-family:" + SERIF + ";font-style:italic;font-size:17px;color:#ffe2b3;text-align:center;",
      "opacity:.9;min-height:22px}",
      ".bm-scrub{position:relative;height:64px;margin:8px -18px 8px;overflow:hidden;pointer-events:auto;touch-action:none}",
      ".bm-ruler{position:absolute;left:50%;top:14px;bottom:14px;width:4000px;margin-left:-2000px;",
      "background:repeating-linear-gradient(90deg,rgba(255,220,160,.34) 0 2px,transparent 2px 16px)}",
      ".bm-ruler::after{content:'';position:absolute;left:0;right:0;top:50%;height:2px;margin-top:-1px;",
      "background:rgba(255,220,160,.12)}",
      ".bm-mark{position:absolute;left:50%;top:6px;bottom:6px;width:3px;margin-left:-1.5px;background:#e9b95a;",
      "border-radius:2px;box-shadow:0 0 14px rgba(233,185,90,.9)}",
      ".bm-fade{position:absolute;inset:0;background:linear-gradient(90deg,rgba(12,6,4,1),rgba(12,6,4,0) 22%,",
      "rgba(12,6,4,0) 78%,rgba(12,6,4,1));pointer-events:none}",
      ".bm-scrubhint{position:absolute;left:0;right:0;bottom:0;text-align:center;font-size:9.5px;letter-spacing:.2em;",
      "opacity:.5;font-weight:700;pointer-events:none}",
      ".bm-presets{display:flex;gap:7px;justify-content:center;flex-wrap:wrap}",
      ".bm-pre{border:1px solid rgba(255,220,160,.18);border-radius:14px;padding:9px 13px;",
      "background:rgba(255,225,170,.08);color:#ffe9c4;font-family:" + DISPLAY + ";font-size:17px;letter-spacing:.06em}",
      ".bm-pre.on{background:rgba(233,185,90,.9);color:#2a1408;border-color:#ffe0a8}",
      ".bm-pm{display:flex;justify-content:center;gap:12px;margin-top:10px}",
      ".bm-pm button{width:50px;height:44px;border-radius:14px;border:0;background:rgba(255,225,170,.12);",
      "color:#fff;font-size:24px}",
      ".bm-cta{border:0;border-radius:30px;padding:16px 28px;width:100%;margin-top:12px;",
      "background:linear-gradient(180deg,#ffd98a,#e9a83a);color:#2a1408;font-family:" + DISPLAY + ";",
      "font-size:27px;letter-spacing:.12em;box-shadow:0 10px 30px rgba(233,168,58,.35),inset 0 1px 0 rgba(255,255,255,.5)}",
      ".bm-cta:active{transform:scale(.98)}.bm-cta:disabled{opacity:.35;box-shadow:none}",
      ".bm-ghost{border:1px solid rgba(255,220,160,.22);background:rgba(255,255,255,.05);color:#ffe9c4;",
      "border-radius:30px;padding:13px 22px;font-family:" + DISPLAY + ";font-size:19px;letter-spacing:.1em}",
      ".bm-back{border:0;background:none;color:#e9b95a;font-family:" + DISPLAY + ";font-size:16px;letter-spacing:.16em;",
      "padding:12px 0 0;width:100%;text-align:center;opacity:.8}",
      ".bm-result{position:absolute;left:0;right:0;bottom:0;padding:0 18px;pointer-events:none;display:flex;",
      "flex-direction:column;align-items:center;gap:10px;",
      "background:linear-gradient(180deg,rgba(12,6,4,0),rgba(12,6,4,.9) 46%)}",
      ".bm-punch{font-family:" + SERIF + ";font-style:italic;font-size:22px;color:#ffe9c4;text-align:center;",
      "line-height:1.25;padding:0 8px;text-shadow:0 2px 12px rgba(0,0,0,.7);transition:opacity .6s}",
      ".bm-rowbtns{display:flex;gap:10px;width:100%;pointer-events:auto}",
      ".bm-rowbtns>*{flex:1;margin-top:0}",
      ".bm-hint{font-size:12.5px;font-weight:600;color:#ffe2b3;opacity:.78;text-align:center}",
      ".bm-gest{font-size:10.5px;opacity:.5;letter-spacing:.12em;font-weight:700;text-align:center}",
      ".bm-week{display:flex;justify-content:center;gap:9px;height:34px;align-items:flex-end}",
      ".bm-day{width:14px;display:flex;flex-direction:column;align-items:center;gap:3px}",
      ".bm-bar{width:9px;border-radius:3px 3px 1px 1px;background:linear-gradient(180deg,#ffe9b8,#e9a83a);min-height:2px}",
      ".bm-day.today .bm-bar{box-shadow:0 0 10px rgba(255,200,90,.6)}",
      ".bm-dl{font-size:8.5px;font-weight:700;opacity:.5;letter-spacing:.05em}",
      ".bm-reveal{position:absolute;left:0;right:0;bottom:0;padding:0 18px;text-align:center;pointer-events:none}",
      ".bm-icon{position:absolute;width:36px;height:36px;border-radius:12px;border:1px solid rgba(255,220,160,.14);",
      "background:rgba(22,11,6,.78);color:#fff;font-size:17px;font-weight:700;pointer-events:auto;",
      "display:flex;align-items:center;justify-content:center;transition:opacity .3s}",
      ".bm-sheet{position:absolute;inset:0;background:rgba(10,5,3,.95);pointer-events:auto;overflow-y:auto;",
      "-webkit-overflow-scrolling:touch;padding:0 22px}",
      ".bm-sheet h2{font-family:" + DISPLAY + ";font-size:28px;letter-spacing:.12em;color:#e9b95a;margin:0 0 14px;",
      "text-align:center;padding:0 48px}",
      ".bm-sheet h3{font-family:" + DISPLAY + ";font-size:15px;letter-spacing:.2em;color:#e9b95a;opacity:.8;margin:18px 0 8px}",
      ".bm-sheet p{font-size:13px;line-height:1.5;opacity:.85;margin:0 0 10px}",
      ".bm-sheet code{font-family:ui-monospace,Menlo,monospace;font-size:11.5px;background:rgba(255,255,255,.06);",
      "padding:2px 5px;border-radius:5px;color:#ffe2b3}",
      ".bm-kg{display:flex;align-items:center;justify-content:center;gap:16px}",
      ".bm-kg button{width:46px;height:46px;border-radius:14px;border:0;background:rgba(255,225,170,.12);color:#fff;font-size:24px}",
      ".bm-kgv{font-family:" + DISPLAY + ";font-size:40px;min-width:110px;text-align:center}",
      ".bm-kgv small{font-size:16px;opacity:.6;letter-spacing:.1em}",
      ".bm-styles{display:flex;flex-direction:column;gap:7px}",
      ".bm-st{display:flex;align-items:center;justify-content:space-between;gap:10px;border:1px solid rgba(255,220,160,.12);",
      "border-radius:14px;padding:10px 12px;background:rgba(255,255,255,.04);color:#fff;text-align:left;width:100%}",
      ".bm-st.on{background:rgba(233,185,90,.16);border-color:#e9b95a}",
      ".bm-st b{font-family:" + SERIF + ";font-style:italic;font-weight:400;font-size:19px;display:block}",
      ".bm-st i{font-style:normal;font-size:11px;opacity:.6;display:block;margin-top:1px}",
      ".bm-st em{font-family:" + DISPLAY + ";font-style:normal;font-size:19px;color:#e9b95a;white-space:nowrap}",
      ".bm-st em small{font-size:11px;letter-spacing:.1em;opacity:.7}",
      ".bm-line{display:flex;align-items:center;justify-content:space-between;padding:10px 0;font-size:13.5px;font-weight:600}",
      ".bm-tog{width:40px;height:24px;border-radius:12px;background:rgba(255,255,255,.15);border:0;position:relative;padding:0}",
      ".bm-tog::after{content:'';position:absolute;top:3px;left:3px;width:18px;height:18px;border-radius:9px;background:#fff;transition:left .15s}",
      ".bm-tog.on{background:#e9b95a}.bm-tog.on::after{left:19px}",
      ".bm-danger{width:100%;border:1px solid rgba(255,110,90,.4);background:rgba(255,80,60,.1);color:#ffb0a0;",
      "border-radius:14px;padding:12px;font-weight:700;letter-spacing:.06em;margin-top:16px}",
      ".bm-close{position:absolute;right:14px;width:40px;height:40px;border-radius:14px;border:0;",
      "background:rgba(255,255,255,.1);color:#fff;font-size:22px}",
      ".bm-toast{position:absolute;left:50%;transform:translateX(-50%);padding:9px 16px;border-radius:14px;",
      "background:rgba(18,9,5,.9);border:1px solid rgba(255,220,160,.18);font-family:" + DISPLAY + ";",
      "font-size:19px;letter-spacing:.06em;color:#ffe9c4;opacity:0;transition:opacity .2s;white-space:nowrap}",
      ".bm-toast small{font-size:12px;opacity:.6;margin-left:8px;letter-spacing:.1em}",
      ".bm-plus{position:absolute;left:14px;font-family:" + DISPLAY + ";font-size:14px;letter-spacing:.1em;color:#e9b95a;",
      "background:rgba(18,9,5,.8);border:1px solid rgba(255,220,160,.2);border-radius:10px;padding:3px 8px;display:none}",
      ".bm-dis{font-size:10.5px;opacity:.45;line-height:1.4;margin-top:14px}",
      ".bm-livenote{font-size:10.5px;opacity:.55;margin-top:6px;line-height:1.35;text-align:center}",
      "</style>",
      '<div class="bm">',
      '<div class="bm-top" data-top>',
      '<div class="bm-brand">BEER MILEAGE</div>',
      '<div class="bm-num"><span class="bm-big" data-big>0.0</span><span class="bm-unit" data-unit>PINTS</span></div>',
      '<div class="bm-style" data-style></div>',
      '<div class="bm-kcal" data-kcal></div>',
      "</div>",
      '<div class="bm-stage" data-stage></div>',
      '<div class="bm-plus" data-plus></div>',
      '<button class="bm-icon" type="button" data-gear aria-label="Settings">⚙</button>',
      '<button class="bm-icon" type="button" data-info aria-label="About">i</button>',
      '<div class="bm-sheet" data-settings hidden></div>',
      '<div class="bm-sheet" data-about hidden></div>',
      '<div class="bm-toast" data-toast></div>',
      "</div>"
    ].join("");

    const q = (sel) => ui.querySelector(sel);
    const elTop = q("[data-top]"), elBig = q("[data-big]"), elUnit = q("[data-unit]");
    const elStyle = q("[data-style]"), elKcal = q("[data-kcal]"), elStage = q("[data-stage]");
    const elPlus = q("[data-plus]"), elGear = q("[data-gear]"), elInfo = q("[data-info]");
    const elSettings = q("[data-settings]"), elAbout = q("[data-about]"), elToast = q("[data-toast]");

    // What the screen shows; the pour drags it from the old truth to the new.
    const viz = { remaining: 0, full: 0, frac: 0, kcal: 0 };
    function syncViz() {
      viz.remaining = derived.remaining; viz.full = derived.full;
      viz.frac = derived.frac; viz.kcal = derived.kcal;
    }

    const AMOUNT = {
      steps: { q: "How many steps?", unit: "STEPS", step: 250, max: 40000, presets: [3000, 5000, 8000, 10000, 15000], px: 5 },
      run:   { q: "How far did you run?", unit: "KM", step: 0.1, max: 60, presets: [3, 5, 10, 21.1], px: 6 },
      ride:  { q: "How far did you ride?", unit: "KM", step: 0.5, max: 250, presets: [10, 20, 40, 80], px: 6 },
      swim:  { q: "How far did you swim?", unit: "M", step: 50, max: 6000, presets: [500, 1000, 1500, 2000], px: 6 },
      gym:   { q: "How long in the gym?", unit: "MIN", step: 5, max: 300, presets: [30, 45, 60, 90], px: 7 }
    };
    const UI = { state: "pick", act: null, value: 0, scrub: { on: false, id: null, x0: 0, v0: 0, ticks: 0 } };

    const fmtVal = (v, act) => (act === "run" || act === "ride")
      ? (Math.round(v * 10) / 10).toFixed(1) : Math.round(v).toLocaleString();
    const fmtPints = (p) => (p >= 10 ? Math.round(p).toString() : (Math.round(p * 10) / 10).toFixed(1));
    let shownPints = 0, toastT = null;
    const pedo = { on: false, live: 0, pending: 0, mean: 9.81, prev: 0, last: 0, off: null, available: null };

    function layoutHud() {
      elTop.style.paddingTop = (ctx.safeArea.top + 14) + "px";
      elTop.style.paddingBottom = "26px";
      elGear.style.top = (ctx.safeArea.top + 12) + "px"; elGear.style.right = "12px";
      elInfo.style.top = (ctx.safeArea.top + 12) + "px"; elInfo.style.left = "12px";
      elToast.style.top = (ctx.safeArea.top + 190) + "px";
      elPlus.style.top = (H * 0.5 + 10) + "px";
      for (const s of [elSettings, elAbout]) {
        s.style.paddingTop = (ctx.safeArea.top + 22) + "px";
        s.style.paddingBottom = (ctx.safeArea.bottom + 30) + "px";
      }
      for (const c of ui.querySelectorAll("[data-close]")) c.style.top = (ctx.safeArea.top + 14) + "px";
      for (const a of ui.querySelectorAll(".bm-ask,.bm-result,.bm-reveal,.bm-pickfoot")) {
        a.style.paddingBottom = (ctx.safeArea.bottom + 18) + "px";
      }
      const pq = q("[data-pickq]");
      if (pq) pq.style.top = (ctx.safeArea.top + 112) + "px";
      elTop.classList.toggle("small", UI.state === "pick" || UI.state === "amount" || H < 700);
    }

    function toast(main, sub) {
      elToast.innerHTML = main + (sub ? "<small>" + sub + "</small>" : "");
      elToast.style.opacity = "1";
      if (toastT) toastT();
      let alive = true;
      toastT = () => { alive = false; };
      ctx.timeout(() => { if (alive) elToast.style.opacity = "0"; }, 1500);
    }

    function punchline(rem) {
      const s = MODEL.STYLES[profile.style].name.toLowerCase();
      if (rem < 0.01) return "Nothing yet. The bar is patient.";
      if (rem < 0.25) return "That's a sip. Keep walking.";
      if (rem < 0.6) return "A short glass of " + s + ". Don't stop now.";
      if (rem < 0.98) return "Nearly a pint. The next thousand steps are on you.";
      if (rem < 1.5) return "One pint of " + s + ", fairly earned.";
      if (rem < 2.5) return "Two pints. That was a proper day.";
      if (rem < 4) return "You've earned a round. Choose your friends carefully.";
      return "Someone's had a day. Pace yourself.";
    }

    function hintText() {
      let act = "steps", best = -1;
      for (const k of MODEL.ACT_KEYS) {
        const kc = MODEL.actKcal(day.log, k, profile.kg);
        if (kc > best) { best = kc; act = k; }
      }
      if (best <= 0) act = "steps";
      const need = MODEL.toNextPint(day, profile.kg, profile.style, act);
      const shown = act === "steps" ? Math.ceil(need).toLocaleString() + " steps"
        : act === "swim" ? Math.ceil(need / 50) * 50 + " m"
        : act === "gym" ? Math.ceil(need) + " min"
        : (Math.ceil(need * 10) / 10).toFixed(1) + " km";
      const verb = { steps: "", run: " of running", ride: " on the bike", swim: " in the pool", gym: " in the gym" }[act];
      return shown + verb + " to the next pint";
    }

    function renderWeek() {
      const byDate = {};
      for (const h of history) byDate[h.date] = h;
      const now = new Date();
      const days = [];
      let max = 0.01;
      for (let i = 6; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
        const key = MODEL.localDate(d);
        const pints = i === 0 ? derived.earned : (byDate[key] ? byDate[key].pints : 0);
        max = Math.max(max, pints);
        days.push({ pints, label: ["S", "M", "T", "W", "T", "F", "S"][d.getDay()], today: i === 0 });
      }
      return '<div class="bm-week">' + days.map((d) =>
        '<div class="bm-day' + (d.today ? " today" : "") + '"><div class="bm-bar" style="height:' +
        Math.max(2, Math.round((d.pints / max) * 22)) + 'px;opacity:' + (d.pints > 0 ? 0.85 : 0.25) +
        '"></div><div class="bm-dl">' + d.label + "</div></div>").join("") + "</div>";
    }

    function renderTop() {
      updateTab();
      const s = MODEL.STYLES[profile.style];
      elUnit.textContent = viz.remaining >= 0.95 && viz.remaining < 1.05 ? "PINT" : "PINTS";
      elStyle.textContent = "of " + s.name.toLowerCase() + " · " + Math.round(MODEL.beerKcal(profile.style)) + " kcal a pint";
      elKcal.textContent = Math.round(viz.kcal).toLocaleString() + " KCAL EARNED TODAY"
        + (day.poured ? " · " + day.poured + " POURED" : "");
      const extra = viz.full - ROW_MAX;
      elPlus.style.display = extra > 0 ? "block" : "none";
      elPlus.textContent = "+" + extra + " MORE";
      elTop.classList.toggle("small", UI.state === "pick" || UI.state === "amount" || H < 700);
      const busy = UI.state === "reveal";
      elGear.style.opacity = busy ? "0" : "1"; elInfo.style.opacity = busy ? "0" : "1";
      elGear.style.pointerEvents = busy ? "none" : "auto"; elInfo.style.pointerEvents = busy ? "none" : "auto";
    }

    function tallyText() {
      const parts = [];
      for (const k of MODEL.ACT_KEYS) {
        const v = day.log[k] || 0;
        if (v > 0) parts.push(fmtVal(v, k) + " " + (k === "steps" ? "steps" : MODEL.ACTS[k].unit) + (k === "steps" ? "" : " " + MODEL.ACTS[k].label.toLowerCase()));
      }
      return parts.length ? "Today so far: " + parts.join(" · ") : "";
    }

    function renderStage() {
      let html = "";
      if (UI.state === "pick") {
        // the choices are on the bar; these are their captions, projected each frame
        html = '<div class="bm-pickq" data-pickq><h1 class="bm-q">' + (derived.kcal > 0 ? "What else did you do?" : "What did you do today?") + "</h1>"
          + '<div class="bm-sub">tap something on the bar</div></div>'
          + '<div class="bm-labels" data-labels>'
          + PROP_ORDER.map((k) => {
              const v = k === "walk" ? 0 : (day.log[k] || 0);
              const attr = k === "walk" ? "data-live-card" : 'data-card="' + k + '"';
              const sub = k === "walk" ? "count live" : (v > 0 ? fmtVal(v, k) + " today" : "");
              return '<button class="bm-lbl" type="button" data-prop="' + k + '" ' + attr + "><b>" + PROP_LABEL[k] + "</b><i>" + sub + "</i></button>";
            }).join("")
          + "</div>"
          + '<div class="bm-pickfoot" data-pickfoot><div class="bm-tally">' + tallyText() + "</div>"
          + (derived.kcal > 0 ? '<button class="bm-back" type="button" data-more-done>SHOW MY BEER ›</button>' : "")
          + "</div>";
      } else if (UI.state === "amount") {
        const A = AMOUNT[UI.act], a = MODEL.ACTS[UI.act];
        html = '<div class="bm-ask"><h1 class="bm-q">' + A.q + "</h1>"
          + '<div class="bm-amt"><span class="bm-amtv" data-val>' + fmtVal(UI.value, UI.act) + '</span><span class="bm-amtu">' + A.unit + "</span></div>"
          + '<div class="bm-prev" data-prev></div>'
          + '<div class="bm-scrub" data-scrub><div class="bm-ruler" data-ruler></div><div class="bm-fade"></div>'
          + '<div class="bm-mark"></div><div class="bm-scrubhint">DRAG TO SET</div></div>'
          + '<div class="bm-presets">' + A.presets.map((n) => '<button class="bm-pre" type="button" data-pre="' + n + '">'
              + fmtVal(n, UI.act) + "</button>").join("") + "</div>"
          + '<div class="bm-pm"><button type="button" data-nudge="-1">−</button><button type="button" data-nudge="1">+</button></div>'
          + '<button class="bm-cta" type="button" data-pour' + (UI.value > 0 ? "" : " disabled") + ">POUR IT</button>"
          + '<button class="bm-back" type="button" data-back>‹ SOMETHING ELSE</button>'
          + "</div>";
      } else if (UI.state === "reveal") {
        html = '<div class="bm-reveal"><div class="bm-punch" data-punch style="opacity:0"></div></div>';
      } else if (UI.state === "live") {
        html = '<div class="bm-ask"><h1 class="bm-q">Walk with me.</h1>'
          + '<div class="bm-amt"><span class="bm-amtv" data-live-count>' + pedo.live.toLocaleString() + '</span><span class="bm-amtu">STEPS</span></div>'
          + '<div class="bm-prev" data-livenote>' + liveNote() + "</div>"
          + '<div class="bm-rowbtns" style="margin-top:14px"><button class="bm-ghost" type="button" data-live-stop>' + (pedo.on ? "STOP AND POUR" : "BACK") + "</button></div>"
          + "</div>";
      } else {
        const canDrink = derived.full >= 1;
        html = '<div class="bm-result">'
          + '<div class="bm-punch" data-punch>' + punchline(derived.remaining) + "</div>"
          + renderWeek()
          + '<div class="bm-hint">' + (canDrink ? "" : hintText()) + "</div>"
          + '<div class="bm-rowbtns">'
          + (canDrink ? '<button class="bm-cta" type="button" data-drink>DRINK ONE</button>' : "")
          + '<button class="' + (canDrink ? "bm-ghost" : "bm-cta") + '" type="button" data-more>' + (derived.kcal > 0 ? "LOG MORE" : "LOG SOMETHING") + "</button>"
          + "</div>"
          + '<div class="bm-gest">TAP THE GLASS · SWIPE UP TO DRINK · DRAG TO TILT</div>'
          + "</div>";
      }
      elStage.innerHTML = html;
      layoutHud();
      renderTop();
      if (UI.state === "amount") renderAmount();
    }

    function renderAmount() {
      const v = q("[data-val]"), pv = q("[data-prev]"), cta = q("[data-pour]");
      if (!v) return;
      v.textContent = fmtVal(UI.value, UI.act);
      const kcal = MODEL.ACTS[UI.act].kcal(UI.value, profile.kg);
      const p = MODEL.pintsFor(kcal, profile.style);
      pv.textContent = UI.value > 0
        ? "= " + Math.round(kcal) + " kcal · " + (Math.round(p * 100) / 100) + " pints of " + MODEL.STYLES[profile.style].name.toLowerCase()
        : "";
      if (cta) cta.disabled = !(UI.value > 0);
      for (const b of ui.querySelectorAll("[data-pre]")) {
        b.classList.toggle("on", Math.abs(parseFloat(b.getAttribute("data-pre")) - UI.value) < 1e-6);
      }
      const ruler = q("[data-ruler]");
      if (ruler) ruler.style.transform = "translateX(" + (-(UI.value / AMOUNT[UI.act].step) * AMOUNT[UI.act].px % 16) + "px)";
    }

    function setState(s) { UI.state = s; renderStage(); }
    function liveNote() {
      if (pedo.available === false) return "Motion is not available here. Log your steps by hand instead.";
      if (pedo.on) return "Keep the phone on you. Every twenty steps goes in the glass.";
      return "Uses the phone's motion sensor while this is open.";
    }

    function renderSettings() {
      let html = '<button class="bm-close" type="button" data-close>×</button><h2>SETTINGS</h2>'
        + "<h3>YOUR WEIGHT</h3>"
        + '<div class="bm-kg"><button type="button" data-kg="-1">−</button><div class="bm-kgv" data-kgv>' + profile.kg + " <small>KG</small></div>"
        + '<button type="button" data-kg="1">+</button></div>'
        + '<p style="text-align:center;opacity:.55;font-size:11.5px;margin-top:8px">Heavier means every step is worth more beer.</p>'
        + "<h3>WHAT YOU DRINK</h3><div class=\"bm-styles\">";
      for (const k of MODEL.STYLE_KEYS) {
        const s = MODEL.STYLES[k];
        html += '<button class="bm-st' + (k === profile.style ? " on" : "") + '" type="button" data-style="' + k + '">'
          + "<span><b>" + s.name + "</b><i>" + s.ml + " ml · " + s.abv + "% · " + s.blurb + "</i></span>"
          + "<em>" + Math.round(MODEL.beerKcal(k)) + "<small> KCAL</small></em></button>";
      }
      html += "</div><h3>THE GLASS</h3>"
        + '<div class="bm-line"><span>Tilt with the phone</span><button class="bm-tog' + (profile.tilt ? " on" : "") + '" type="button" data-tilt aria-label="Tilt with the phone"></button></div>'
        + '<p style="opacity:.55;font-size:11.5px;margin-top:-4px" data-tiltnote>' + (profile.tilt ? "On. Drag also works." : "Off. Drag the glass to tilt it.") + "</p>"
        + '<button class="bm-danger" type="button" data-reset>RESET TODAY</button>';
      elSettings.innerHTML = html;
    }

    function renderAbout() {
      const c = MODEL.consts;
      elAbout.innerHTML = '<button class="bm-close" type="button" data-close>×</button><h2>HOW IT COUNTS</h2>'
        + "<p>Every activity is a MET from the Compendium of Physical Activities, minus the one MET you would burn sitting at the bar, times your weight and time. Only the energy <em>above</em> rest counts, which is why the numbers are smaller than your watch says.</p>"
        + "<h3>ENERGY</h3>"
        + "<p><code>steps × 0.762 m × (" + c.WALK_MET + " − 1) / " + c.WALK_KMH + " km/h × kg</code></p>"
        + "<p><code>run km × (" + c.RUN_MET + " − 1) / " + c.RUN_KMH + " × kg</code> &nbsp; <code>ride km × (" + c.RIDE_MET + " − 1) / " + c.RIDE_KMH + " × kg</code></p>"
        + "<p><code>swim km × (" + c.SWIM_MET + " − 1) / " + c.SWIM_KMH + " × kg</code> &nbsp; <code>gym h × (" + c.GYM_MET + " − 1) × kg</code></p>"
        + "<h3>BEER</h3>"
        + "<p>Alcohol is 7 kcal a gram at 0.789 g/ml; what is left of the malt is 4 kcal a gram.</p>"
        + "<p><code>ml × ABV × 0.789 × 7 + ml × carbs × 4</code></p>"
        + "<p>A US pint of 5% lager comes out at " + Math.round(MODEL.beerKcal("lager")) + " kcal, within a few percent of the number on the can. Ten thousand steps at 70 kg is "
        + Math.round(MODEL.actKcal({ steps: 10000 }, "steps", 70)) + " kcal. Do the division and try not to be sad.</p>"
        + "<h3>THE GLASS</h3>"
        + "<p>The pour's pitch climbs as the glass fills, and a tapped glass rings lower the fuller it is. Both are real: the air column shortens, and the beer loads the wall.</p>"
        + '<p class="bm-dis">Beer Mileage is a game about arithmetic. Pints are a fictional fitness metric, not a recommendation to drink anything, and burning it off first does not make it health food.</p>';
    }

    function tweenNumber(dt) {
      const target = viz.remaining;
      if (Math.abs(target - shownPints) < 0.004) shownPints = target;
      else shownPints += (target - shownPints) * Math.min(1, dt * 9);
      elBig.textContent = fmtPints(shownPints);
    }

    // ===================================================================
    // The tap, the stream and the splash — the pour is the moment.
    // ===================================================================
    const tapGroup = new THREE.Group();
    scene.add(tapGroup);
    {
      const brass = new THREE.MeshStandardMaterial({ color: "#d3a64d", metalness: 1, roughness: 0.2 });
      const dark = new THREE.MeshPhysicalMaterial({ color: "#3a2214", roughness: 0.5, clearcoat: 0.6 });
      // the spout tip is the group's origin; the body stands behind and above it
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.013, 0.12, 18), brass);
      body.position.set(0.034, 0.075, -0.02);
      body.castShadow = true;
      tapGroup.add(body);
      const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.0075, 0.0075, 0.04, 12), brass);
      arm.rotation.z = Math.PI / 2;
      arm.rotation.y = -0.5;
      arm.position.set(0.017, 0.028, -0.01);
      tapGroup.add(arm);
      const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.0062, 0.0074, 0.03, 12), brass);
      nozzle.position.set(0, 0.014, 0);
      tapGroup.add(nozzle);
      const handle = new THREE.Mesh(new THREE.CapsuleGeometry(0.009, 0.05, 4, 10), dark);
      handle.position.set(0.034, 0.16, -0.02);
      handle.rotation.z = -0.35;
      tapGroup.add(handle);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.014, 0.003, 8, 24), brass);
      ring.rotation.x = Math.PI / 2;
      ring.position.set(0.034, 0.128, -0.02);
      tapGroup.add(ring);
    }
    const streamMat = new THREE.MeshPhysicalMaterial({ roughness: 0.15, clearcoat: 1, clearcoatRoughness: 0.1,
      emissiveIntensity: 0.25, envMapIntensity: 0.9 });
    const stream = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 1, 1, 12, 1, true), streamMat);
    stream.visible = false;
    scene.add(stream);
    const SPLASH_N = 56;
    const splashMesh = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 6, 5), streamMat, SPLASH_N);
    splashMesh.frustumCulled = false;
    splashMesh.count = 0;
    scene.add(splashMesh);
    const splash = [];
    for (let i = 0; i < SPLASH_N; i++) splash.push({ alive: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, s: 0.001, t: 0 });

    let tapRise = 0.3;                // metres above its pouring position
    function tapTipY() { return G.spec.H + 0.07 + tapRise; }
    function placeTap() {
      tapGroup.position.set(0.004, tapTipY(), 0.004);
      tapGroup.visible = tapRise < 0.29;
    }
    function spawnSplash(levelY, n, drip) {
      for (let i = 0; i < n; i++) {
        const p = splash.find((x) => !x.alive);
        if (!p) return;
        p.alive = true; p.t = 0;
        const a = rrange(0, 6.283), sp = drip ? rrange(0.02, 0.08) : rrange(0.08, 0.26);
        p.x = 0.004 + rrange(-0.003, 0.003); p.z = 0.004 + rrange(-0.003, 0.003);
        p.y = drip ? tapTipY() - 0.01 : levelY + 0.002;
        p.vx = Math.cos(a) * sp; p.vz = Math.sin(a) * sp;
        p.vy = drip ? -0.1 : rrange(0.12, 0.42);
        p.s = rrange(0.0006, drip ? 0.0016 : 0.0013);
      }
    }
    function stepSplash(dt, levelY) {
      let n = 0;
      for (const p of splash) {
        if (!p.alive) continue;
        p.t += dt;
        p.vy -= 9.81 * dt;
        p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
        if (p.t > 0.7 || (p.vy < 0 && p.y < levelY - 0.002) || p.y < 0.002) { p.alive = false; continue; }
        _pos.set(p.x, p.y, p.z);
        _scl.setScalar(p.s);
        _m4.compose(_pos, _idq, _scl);
        splashMesh.setMatrixAt(n++, _m4);
      }
      splashMesh.count = n;
      splashMesh.instanceMatrix.needsUpdate = true;
    }

    function bubbleBurst(n) {
      const spec = G.spec, look = G.look;
      const levelY = G.levelFrac > 0.002 ? spec.levelFor(G.levelFrac) : -1;
      if (levelY <= 0) return;
      for (let i = 0; i < n; i++) {
        const b = bubbles.find((x) => !x.alive);
        if (!b) return;
        const site = G.nucl[(rnd() * G.nucl.length) | 0];
        b.alive = true; b.wall = false;
        b.x = Math.sin(site.th) * site.r; b.z = Math.cos(site.th) * site.r; b.y = site.y + rrange(0, 0.01);
        b.s = rrange(0.0008, 0.002); b.vy = 0.05 + b.s * 40; b.ph = rrange(0, 6.283);
        if (look.surge) b.s *= 0.6;
      }
    }

    // ===================================================================
    // The props: what you did today, as things on the bar you can pick up.
    // Two rows, because a portrait lens is narrow even at 52 degrees.
    // ===================================================================
    const PROP_ORDER = ["steps", "run", "ride", "swim", "gym", "walk"];
    const PROP_HOME = { run: [-0.15, 0.07], ride: [-0.05, 0.075], swim: [0.05, 0.075], walk: [0.15, 0.07],
                        steps: [-0.08, 0.245], gym: [0.08, 0.245] };
    const PROP_HERO = new THREE.Vector3(0, 0.165, 0.16);
    const PROP_LABEL = { steps: "STEPS", run: "RUN", ride: "RIDE", swim: "SWIM", gym: "GYM", walk: "WALK" };
    const PM = {
      white: new THREE.MeshStandardMaterial({ color: "#f2ede4", roughness: 0.6 }),
      red: new THREE.MeshStandardMaterial({ color: "#d8402c", roughness: 0.55 }),
      dark: new THREE.MeshStandardMaterial({ color: "#1e1a1c", roughness: 0.7 }),
      steel: new THREE.MeshStandardMaterial({ color: "#c9ccd2", metalness: 0.9, roughness: 0.3 }),
      rubber: new THREE.MeshStandardMaterial({ color: "#262626", roughness: 0.95 }),
      blue: new THREE.MeshStandardMaterial({ color: "#2b6fd6", roughness: 0.5 }),
      lens: new THREE.MeshPhysicalMaterial({ color: "#8fd6ff", roughness: 0.05, transparent: true, opacity: 0.55, clearcoat: 1 }),
      iron: new THREE.MeshStandardMaterial({ color: "#2a2b2e", metalness: 0.6, roughness: 0.45 }),
      screen: new THREE.MeshBasicMaterial({ color: "#3fd18a" }),
      face: new THREE.MeshStandardMaterial({ color: "#f6f2e8", roughness: 0.4 })
    };
    function pm(geo, mat, x, y, z, rx, ry, rz) {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x || 0, y || 0, z || 0);
      m.rotation.set(rx || 0, ry || 0, rz || 0);
      m.castShadow = true;
      return m;
    }
    function buildProp(act) {
      const g = new THREE.Group();
      if (act === "steps") {                       // a pair of trainers
        for (const side of [-1, 1]) {
          const shoe = new THREE.Group();
          shoe.add(pm(new THREE.BoxGeometry(0.052, 0.01, 0.022), PM.red, 0, 0.005, 0));
          shoe.add(pm(new THREE.CapsuleGeometry(0.0105, 0.03, 4, 10), PM.white, 0.004, 0.019, 0, 0, 0, Math.PI / 2));
          for (let i = 0; i < 3; i++) {
            shoe.add(pm(new THREE.CylinderGeometry(0.0012, 0.0012, 0.02, 6), PM.dark, -0.004 + i * 0.007, 0.03, 0, Math.PI / 2, 0, 0));
          }
          shoe.position.set(side * 0.016, 0, side * 0.004);
          shoe.rotation.y = side * 0.18;
          g.add(shoe);
        }
      } else if (act === "run") {                  // a stopwatch
        g.add(pm(new THREE.CylinderGeometry(0.03, 0.03, 0.009, 36), PM.steel, 0, 0.035, 0, Math.PI / 2, 0, 0));
        g.add(pm(new THREE.CylinderGeometry(0.026, 0.026, 0.0095, 36), PM.face, 0, 0.035, 0.0005, Math.PI / 2, 0, 0));
        g.add(pm(new THREE.BoxGeometry(0.0022, 0.022, 0.002), PM.red, 0, 0.044, 0.006));
        g.add(pm(new THREE.BoxGeometry(0.0022, 0.016, 0.002), PM.dark, 0.006, 0.039, 0.006, 0, 0, -0.9));
        g.add(pm(new THREE.CylinderGeometry(0.005, 0.005, 0.01, 12), PM.steel, 0, 0.069, 0));
        g.add(pm(new THREE.TorusGeometry(0.0075, 0.0018, 8, 20), PM.steel, 0, 0.078, 0));
        g.add(pm(new THREE.CylinderGeometry(0.0035, 0.0035, 0.008, 10), PM.steel, 0.022, 0.062, 0, 0, 0, -0.8));
      } else if (act === "ride") {                 // a bicycle wheel
        const wheel = new THREE.Group();
        wheel.add(pm(new THREE.TorusGeometry(0.034, 0.0045, 10, 40), PM.rubber));
        wheel.add(pm(new THREE.TorusGeometry(0.029, 0.0016, 8, 40), PM.steel));
        wheel.add(pm(new THREE.CylinderGeometry(0.005, 0.005, 0.012, 14), PM.steel, 0, 0, 0, Math.PI / 2, 0, 0));
        for (let i = 0; i < 14; i++) {
          const a = (i / 14) * Math.PI * 2;
          wheel.add(pm(new THREE.CylinderGeometry(0.0006, 0.0006, 0.056, 4), PM.steel,
            Math.cos(a) * 0.0145, Math.sin(a) * 0.0145, i % 2 ? 0.002 : -0.002, 0, 0, a + Math.PI / 2));
        }
        wheel.position.y = 0.0385;
        wheel.rotation.y = 0.35;
        g.add(wheel);
        g.userData.spin = wheel;
      } else if (act === "swim") {                 // goggles
        for (const side of [-1, 1]) {
          g.add(pm(new THREE.TorusGeometry(0.0125, 0.0032, 10, 24), PM.blue, side * 0.016, 0.03, 0));
          g.add(pm(new THREE.CylinderGeometry(0.011, 0.011, 0.003, 24), PM.lens, side * 0.016, 0.03, 0, Math.PI / 2, 0, 0));
        }
        g.add(pm(new THREE.BoxGeometry(0.008, 0.004, 0.004), PM.blue, 0, 0.03, 0));
        g.add(pm(new THREE.TorusGeometry(0.03, 0.0022, 6, 30, Math.PI), PM.dark, 0, 0.03, -0.004, -Math.PI / 2, 0, 0));
        g.rotation.x = 0.25;
      } else if (act === "gym") {                  // a dumbbell
        g.add(pm(new THREE.CylinderGeometry(0.0045, 0.0045, 0.078, 12), PM.steel, 0, 0.018, 0, 0, 0, Math.PI / 2));
        for (const side of [-1, 1]) {
          g.add(pm(new THREE.CylinderGeometry(0.018, 0.018, 0.009, 24), PM.iron, side * 0.03, 0.018, 0, 0, 0, Math.PI / 2));
          g.add(pm(new THREE.CylinderGeometry(0.013, 0.013, 0.007, 24), PM.iron, side * 0.022, 0.018, 0, 0, 0, Math.PI / 2));
        }
      } else {                                     // the phone, for walking with it
        g.add(pm(new THREE.BoxGeometry(0.032, 0.064, 0.005), PM.dark, 0, 0.033, 0, -0.35, 0, 0));
        const scr = pm(new THREE.PlaneGeometry(0.028, 0.056), PM.screen, 0, 0.033, 0.0028, -0.35, 0, 0);
        scr.castShadow = false;
        g.add(scr);
      }
      g.userData.act = act;
      return g;
    }
    const props = {};
    for (const k of PROP_ORDER) {
      const grp = buildProp(k);
      const home = PROP_HOME[k];
      props[k] = { group: grp, home: new THREE.Vector3(home[0], 0, home[1]), sunk: 1, lift: 0,
                   phase: rrange(0, 6.3), spinY: rrange(-0.4, 0.4) };
      grp.position.set(home[0], -0.1, home[1]);
      grp.visible = false;
      scene.add(grp);
    }
    let heroAct = null;
    const _pv = new THREE.Vector3();
    function stepProps(dt, t) {
      const st = UI.state;
      for (const k of PROP_ORDER) {
        const p = props[k];
        const wantSunk = (st === "pick" || ((st === "amount" || st === "live") && k === heroAct)) ? 0 : 1;
        const wantLift = ((st === "amount" || st === "live") && k === heroAct) ? 1 : 0;
        p.sunk += (wantSunk - p.sunk) * Math.min(1, dt * 4.5);
        p.lift += (wantLift - p.lift) * Math.min(1, dt * 4);
        const lift = easeInOut(clamp(p.lift, 0, 1));
        const g = p.group;
        g.visible = p.sunk < 0.985;
        const bob = Math.sin(t * 2 + p.phase) * 0.003 * (1 - p.sunk);
        g.position.set(lerp(p.home.x, PROP_HERO.x, lift), lerp(0, PROP_HERO.y, lift) - 0.11 * p.sunk + bob,
                       lerp(p.home.z, PROP_HERO.z, lift));
        p.spinY += dt * (0.35 + 1.4 * lift);
        g.rotation.y = p.spinY;
        const sc = 0.85 + 0.65 * lift;
        g.scale.set(sc, sc, sc);
        if (g.userData.spin) g.userData.spin.rotation.z += dt * (0.8 + 4 * lift);
      }
    }
    function hitProp(px, py) {
      ndc.set((px / W) * 2 - 1, -(py / H) * 2 + 1);
      ray.setFromCamera(ndc, camera);
      const groups = PROP_ORDER.filter((k) => props[k].group.visible).map((k) => props[k].group);
      const hits = ray.intersectObjects(groups, true);
      for (const h of hits) {
        let o = h.object;
        while (o && !o.userData.act) o = o.parent;
        if (o) return o.userData.act;
      }
      return null;
    }
    function syncLabels() {
      const box = q("[data-labels]");
      if (!box) return;
      for (const k of PROP_ORDER) {
        const el = box.querySelector('[data-prop="' + k + '"]');
        if (!el) continue;
        const p = props[k];
        if (p.sunk > 0.6) { el.style.opacity = "0"; continue; }
        _pv.set(p.home.x, -0.012, p.home.z + 0.03).project(camera);
        el.style.left = ((_pv.x + 1) / 2 * W) + "px";
        el.style.top = ((1 - _pv.y) / 2 * H) + "px";
        el.style.opacity = String(clamp(1 - p.sunk * 1.6, 0, 1));
      }
    }

    // ===================================================================
    // The pour: a timeline that drags the shown number and the level from
    // the old truth to the new, filling and swapping glasses on the way.
    // ===================================================================
    const P = { on: false, mini: false, t: 0, phase: "", from: 0, to: 0, rem: 0, dur: 0, pause: 0, hold: false, lift: 0 };
    function startPour(fromRem, toRem, mini) {
      P.on = true; P.mini = !!mini; P.t = 0; P.phase = "lower";
      P.from = fromRem; P.to = toRem; P.rem = fromRem; P.pause = 0; P.hold = false; P.lift = 0;
      P.dur = mini ? 0.9 : clamp(1.3 + 1.15 * (toRem - fromRem), 1.7, 5.2);
      G.driven = true;
      tapRise = 0.3;
      if (!mini) {
        setState("reveal");
        haptic("medium");
        ctx.platform.setProgress(0);
      }
    }
    function stepPour(dt) {
      const spec = G.spec, look = G.look;
      P.t += dt;
      if (elStage.getAttribute("data-phase") !== P.phase) elStage.setAttribute("data-phase", P.phase);
      if (P.phase === "lower") {
        tapRise = 0.3 * (1 - easeOut(clamp(P.t / 0.55, 0, 1)));
        if (P.t >= 0.55) { P.phase = "pour"; P.t = 0; pourStart(); sfxGlug(true); }
        placeTap();
        stream.visible = false;
        return;
      }
      if (P.phase === "pour") {
        tapRise = 0;
        placeTap();
        if (P.pause > 0) {
          P.pause -= dt;
          stream.visible = false;
          pourUpdate(1, 0.15);
          if (P.pause <= 0 && P.hold) {
            // the full glass goes to the row; a fresh one takes its place
            P.hold = false;
            G.levelFrac = 0.002;
            G.head = 0;
            syncRowCount(Math.min(ROW_MAX, Math.floor(P.rem + 1e-9)), true);
            viz.full = Math.floor(P.rem + 1e-9);
            renderTop();
          }
          return;
        }
        const prev = P.rem;
        P.rem = Math.min(P.to, P.rem + ((P.to - P.from) / P.dur) * dt);
        const crossed = Math.floor(P.rem + 1e-9) > Math.floor(prev + 1e-9);
        if (!P.mini) {      // a top-up after a drink animates the glass, not the number
          viz.remaining = P.rem;
          viz.kcal = lerp(P.kcalFrom, P.kcalTo, (P.rem - P.from) / Math.max(1e-9, P.to - P.from));
        }
        if (crossed) {
          // the glass is full: hold it at the brim for a beat, clink, then swap
          G.levelFrac = 1;
          G.head = Math.min(spec.H * 0.17, G.head + spec.H * 0.05);
          P.pause = 0.6; P.hold = true;
          sfxClink(); haptic("success");
          try { ctx.music.sting("success"); } catch (err) { /* no bed */ }
          ctx.platform.milestone("pint_earned", { pints: Math.floor(P.rem + 1e-9), kcal: Math.round(viz.kcal) });
          stream.visible = false;
          return;
        }
        const frac = P.rem - Math.floor(P.rem + 1e-9);
        G.levelFrac = Math.max(0.002, frac);
        G.head = Math.min(spec.H * 0.17, G.head + dt * look.foamK * spec.H * 0.09 * (0.4 + 0.6 * (1 - frac)));
        const levelY = spec.levelFor(G.levelFrac);
        // the stream: spout tip down to the surface, wobbling a little
        const tipY = tapTipY(), len = Math.max(0.005, tipY - levelY - 0.002);
        const r = 0.0034 * (1 + 0.12 * Math.sin(P.t * 41));
        stream.visible = true;
        stream.scale.set(r, len, r);
        stream.position.set(0.004, levelY + 0.002 + len / 2, 0.004);
        spawnSplash(levelY, 4, false);
        G.sloshVX += (rnd() - 0.5) * 0.4 * dt; G.sloshVZ += (rnd() - 0.5) * 0.4 * dt;
        pourUpdate(G.levelFrac, 1);
        ctx.platform.setProgress(clamp((P.rem - P.from) / Math.max(1e-9, P.to - P.from), 0, 1));
        if (P.rem >= P.to - 1e-9) { P.phase = "lift"; P.t = 0; pourStop(); }
        return;
      }
      if (P.phase === "lift") {
        stream.visible = false;
        if (P.t < 0.25) spawnSplash(spec.levelFor(Math.max(0.002, G.levelFrac)), 1, true);
        tapRise = 0.3 * easeInOut(clamp(P.t / 0.6, 0, 1));
        placeTap();
        if (P.t >= 0.6) {
          P.on = false;
          G.driven = false;
          elStage.removeAttribute("data-phase");
          syncViz();
          G.targetFrac = derived.frac;
          G.levelFrac = Math.max(G.levelFrac, derived.frac > 0 ? 0.002 : 0);
          syncRowCount(derived.full, true);
          if (!P.mini) {
            setState("result");
            const punch = q("[data-punch]");
            if (punch) { punch.style.opacity = "0"; ctx.timeout(() => { punch.style.opacity = "1"; }, 60); }
            if (derived.full >= 1) { try { ctx.music.sting("win"); } catch (err) { /* no bed */ } }
            haptic("light");
          }
          renderTop();
        }
      }
    }

    // ---- the drink: tip it to your mouth, drain it, and the tap tops you up
    const D = { on: false, t: 0, from: 0 };
    function startDrink() {
      if (P.on || D.on) return;
      if (!MODEL.canPour(day, profile.kg, profile.style)) {
        G.sloshVX += 1.2; G.pulse = 1;
        sfxTing(G.levelFrac);
        haptic("warning");
        toast("NOT YET", hintText().toUpperCase());
        return;
      }
      D.on = true; D.t = 0; D.from = G.levelFrac;
      G.driven = true;
      haptic("medium");
      ctx.timeout(sfxGulp, 300);
      ctx.timeout(sfxGulp, 850);
    }
    function stepDrink(dt) {
      D.t += dt;
      const k = D.t / 1.5;
      G.drinkTip = -0.95 * easeInOut(clamp(k * 1.7, 0, 1));
      G.levelFrac = Math.max(0, D.from * (1 - clamp((k - 0.18) / 0.62, 0, 1)));
      if (G.levelFrac < 0.05) G.head = Math.max(0, G.head - dt * 0.05);
      if (k >= 1) {
        D.on = false;
        G.drinkTip = 0;
        G.driven = false;
        const next = MODEL.pour(day, profile.kg, profile.style);
        const rem0 = derived.remaining;
        day = next; recompute(); saveDay();
        syncViz();
        syncRowCount(derived.full, true);     // the one you drank leaves the row now, not after the top-up
        renderTop();
        toast("DOWN THE HATCH", derived.full ? derived.full + " LEFT" : "LAST ONE");
        ctx.platform.interact({ type: "pour", poured: day.poured });
        // the tap tops the glass back up to what is still yours
        G.levelFrac = 0.002;
        P.kcalFrom = derived.kcal; P.kcalTo = derived.kcal;
        startPour(Math.floor(rem0 - 1 + 1e-9), derived.remaining, true);
        setState("result");
      } else {
        G.drinkTip += 0;   // the easing above owns it
      }
    }

    // ===================================================================
    // Actions
    // ===================================================================
    let started = false;
    function firstGesture() {
      if (started) return;
      started = true;
      initAudio();
      if (ac && ac.state === "suspended") { try { ac.resume(); } catch (err) { /* blocked */ } }
      startMusic();
      ctx.platform.start();
    }

    function chooseAct(k) {
      if (!MODEL.ACTS[k]) return;
      heroAct = k;
      UI.act = k; UI.value = 0; UI.scrub.ticks = 0;
      sfxPop(); haptic("light");
      setState("amount");
    }

    function commitAmount() {
      if (!UI.act || !(UI.value > 0) || P.on || D.on) return;
      const before = derived.remaining, kcalBefore = derived.kcal;
      const next = MODEL.add(day, UI.act, UI.value);
      if (next === day) return;
      day = next; recompute(); saveDay();
      ctx.platform.interact({ type: "add", act: UI.act, amount: UI.value });
      P.kcalFrom = kcalBefore; P.kcalTo = derived.kcal;
      sfxPop();
      heroAct = null;
      startPour(before, derived.remaining, false);
      UI.value = 0;
    }

    function setStyle(k) {
      if (!MODEL.STYLES[k] || k === profile.style || P.on || D.on) return;
      profile.style = k;
      saveProfile();
      recompute(); syncViz();
      buildGlass(k);
      G.levelFrac = 0.002;
      G.targetFrac = derived.frac;
      G.head = derived.frac > 0 ? G.headRest : 0;
      rebuildRow();
      renderSettings(); renderStage();
      sfxTick(3);
      ctx.platform.interact({ type: "style", style: k });
    }
    function setKg(delta) {
      profile.kg = clamp(profile.kg + delta, 35, 200);
      saveProfile();
      recompute(); syncViz();
      G.targetFrac = derived.frac;
      syncRowCount(derived.full, true);
      const kgv = elSettings.querySelector("[data-kgv]");
      if (kgv) kgv.innerHTML = profile.kg + " <small>KG</small>";
      renderTop();
      sfxTick(delta > 0 ? 5 : 1);
    }
    function resetToday() {
      if (P.on || D.on) return;
      day = MODEL.newDay(MODEL.localDate()); recompute(); saveDay(); syncViz();
      G.levelFrac = 0; G.head = 0; G.targetFrac = 0;
      rebuildRow();
      toast("RESET", "A FRESH GLASS");
      setState("pick");
      ctx.platform.interact({ type: "reset" });
    }

    // ---- live steps from the motion sensor, while this is open
    async function setLive(on) {
      if (on) {
        if (!ctx.capabilities.motion) { pedo.available = false; pedo.on = false; setState("live"); return; }
        let okay = false;
        try { okay = await ctx.sensors.start(); } catch (err) { okay = false; }
        if (!okay) { pedo.available = false; pedo.on = false; setState("live"); return; }
        pedo.available = true; pedo.on = true; pedo.live = 0; pedo.pending = 0;
        try {
          pedo.off = ctx.sensors.onChange(() => {
            const a = ctx.sensors.accelerationIncludingGravity || ctx.sensors.accelerometer;
            if (!a || typeof a.x !== "number") return;
            const mag = Math.hypot(a.x, a.y, a.z);
            pedo.mean += (mag - pedo.mean) * 0.06;
            const hp = mag - pedo.mean;
            const now = performance.now();
            if (hp > 1.1 && pedo.prev <= 1.1 && now - pedo.last > 280) {
              pedo.last = now; pedo.live++; pedo.pending++;
              sfxTick(pedo.live);
              const c = q("[data-live-count]");
              if (c) c.textContent = pedo.live.toLocaleString();
              if (pedo.pending >= 20) {
                const n = pedo.pending; pedo.pending = 0;
                day = MODEL.add(day, "steps", n); recompute(); saveDay(); syncViz();
                G.targetFrac = derived.frac; syncRowCount(derived.full, true); renderTop();
              }
            }
            pedo.prev = hp;
          });
        } catch (err) { pedo.off = null; }
        setState("live");
      } else {
        const wasOn = pedo.on;
        pedo.on = false;
        if (pedo.off) { try { pedo.off(); } catch (err) { /* already */ } pedo.off = null; }
        if (wasOn && pedo.live > 0) {
          const before = derived.remaining, kcalBefore = derived.kcal;
          if (pedo.pending > 0) { const n = pedo.pending; pedo.pending = 0; day = MODEL.add(day, "steps", n); recompute(); saveDay(); }
          P.kcalFrom = kcalBefore; P.kcalTo = derived.kcal;
          ctx.platform.interact({ type: "add", act: "steps", amount: pedo.live, live: true });
          startPour(before, derived.remaining, false);
        } else setState(derived.kcal > 0 ? "result" : "pick");
      }
    }
    async function setTilt(on) {
      if (on) {
        let okay = false;
        if (ctx.capabilities.motion) { try { okay = await ctx.sensors.start(); } catch (err) { okay = false; } }
        profile.tilt = okay;
        const note = elSettings.querySelector("[data-tiltnote]");
        if (note) note.textContent = okay ? "On. Drag also works." : "Motion is not available here. Drag the glass to tilt it.";
      } else profile.tilt = false;
      saveProfile();
      const tog = elSettings.querySelector("[data-tilt]");
      if (tog) tog.classList.toggle("on", profile.tilt);
    }

    // ---- the amount: scrub, presets, nudges
    function setValue(v, tick) {
      const A = AMOUNT[UI.act];
      const snapped = Math.round(clamp(v, 0, A.max) / A.step) * A.step;
      if (Math.abs(snapped - UI.value) < 1e-9) return;
      const dir = snapped > UI.value ? 1 : -1;
      UI.value = Math.round(snapped * 1000) / 1000;
      if (tick) { UI.scrub.ticks += dir; sfxTick(Math.abs(UI.scrub.ticks)); haptic("light"); }
      renderAmount();
    }

    ctx.listen(ui, "click", (e) => {
      const sel = "[data-card],[data-live-card],[data-pre],[data-nudge],[data-pour],[data-back],[data-more],[data-more-done],[data-drink],[data-live-stop],[data-gear],[data-info],[data-close],[data-style],[data-kg],[data-reset],[data-tilt]";
      const t = e.target.closest ? e.target.closest(sel) : null;
      if (!t) return;
      e.preventDefault(); e.stopPropagation();
      firstGesture();
      if (t.hasAttribute("data-card")) {
        chooseAct(t.getAttribute("data-card"));
      } else if (t.hasAttribute("data-live-card")) {
        heroAct = "walk"; sfxPop(); haptic("light"); setLive(true);
      } else if (t.hasAttribute("data-live-stop")) {
        sfxPop(); setLive(false);
      } else if (t.hasAttribute("data-pre")) {
        setValue(parseFloat(t.getAttribute("data-pre")), false); sfxPop(); haptic("light");
      } else if (t.hasAttribute("data-nudge")) {
        setValue(UI.value + parseInt(t.getAttribute("data-nudge"), 10) * AMOUNT[UI.act].step, true);
      } else if (t.hasAttribute("data-pour")) {
        commitAmount();
      } else if (t.hasAttribute("data-back")) {
        sfxTick(1); setState("pick");
      } else if (t.hasAttribute("data-more")) {
        sfxPop(); setState("pick");
      } else if (t.hasAttribute("data-more-done")) {
        sfxPop(); setState("result");
      } else if (t.hasAttribute("data-drink")) {
        startDrink();
      } else if (t.hasAttribute("data-gear")) {
        renderSettings(); elSettings.hidden = false; elAbout.hidden = true; sfxTick(2);
      } else if (t.hasAttribute("data-info")) {
        renderAbout(); elAbout.hidden = false; elSettings.hidden = true; sfxTick(2);
      } else if (t.hasAttribute("data-close")) {
        elSettings.hidden = true; elAbout.hidden = true; sfxTick(1);
      } else if (t.hasAttribute("data-style")) {
        setStyle(t.getAttribute("data-style"));
      } else if (t.hasAttribute("data-kg")) {
        setKg(parseInt(t.getAttribute("data-kg"), 10));
      } else if (t.hasAttribute("data-reset")) {
        elSettings.hidden = true; resetToday();
      } else if (t.hasAttribute("data-tilt")) {
        setTilt(!profile.tilt);
      }
    });

    // scrub: a horizontal drag across the ruler sets the amount
    ctx.listen(ui, "pointerdown", (e) => {
      const z = e.target.closest ? e.target.closest("[data-scrub]") : null;
      if (!z || UI.state !== "amount") return;
      e.preventDefault();
      firstGesture();
      UI.scrub.on = true; UI.scrub.id = e.pointerId; UI.scrub.x0 = e.clientX; UI.scrub.v0 = UI.value;
    }, { passive: false });
    ctx.listen(window, "pointermove", (e) => {
      if (!UI.scrub.on || e.pointerId !== UI.scrub.id) return;
      const A = AMOUNT[UI.act];
      setValue(UI.scrub.v0 + ((e.clientX - UI.scrub.x0) / A.px) * A.step, true);
    }, { passive: false });
    const endScrub = (e) => { if (UI.scrub.on && (!e || e.pointerId === UI.scrub.id)) UI.scrub.on = false; };
    ctx.listen(window, "pointerup", endScrub);
    ctx.listen(window, "pointercancel", endScrub);

    // ---- the glass: tap it, swipe up to drink it, drag to tilt it
    const ray = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    const ptr = { down: false, id: null, x0: 0, y0: 0, ox: 0, oy: 0, tx0: 0, ty0: 0, t0: 0, onGlass: false, mode: null, prop: null };
    function hitGlass(px, py) {
      if (!G.glass) return false;
      ndc.set((px / W) * 2 - 1, -(py / H) * 2 + 1);
      ray.setFromCamera(ndc, camera);
      return ray.intersectObject(G.glass, false).length > 0;
    }
    function tapGlass() {
      sfxTing(G.levelFrac);
      haptic("light");
      G.pulse = 1;
      G.sloshVX += (rnd() < 0.5 ? -1 : 1) * 0.5;
      bubbleBurst(26);
      G.head = Math.min(G.spec.H * 0.17, G.head + 0.0025);
      ctx.platform.interact({ type: "cheers" });
    }
    ctx.listen(canvas, "pointerdown", (e) => {
      e.preventDefault();
      if (ptr.down) return;
      ptr.down = true; ptr.id = e.pointerId; ptr.mode = null;
      ptr.x0 = e.clientX; ptr.y0 = e.clientY; ptr.t0 = performance.now();
      ptr.tx0 = G.tiltX; ptr.ty0 = G.tiltY;
      const ox = typeof e.offsetX === "number" ? e.offsetX : e.clientX;
      const oy = typeof e.offsetY === "number" ? e.offsetY : e.clientY;
      ptr.onGlass = !P.on && !D.on && hitGlass(ox, oy);
      ptr.prop = UI.state === "pick" ? hitProp(ox, oy) : null;
      firstGesture();
    }, { passive: false });
    ctx.listen(window, "pointermove", (e) => {
      if (!ptr.down || e.pointerId !== ptr.id) return;
      const dx = e.clientX - ptr.x0, dy = e.clientY - ptr.y0;
      if (!ptr.mode) {
        if (Math.abs(dx) + Math.abs(dy) < 12) return;
        ptr.mode = (ptr.onGlass && -dy > Math.abs(dx) * 1.4) ? "swipe" : "tilt";
      }
      if (ptr.mode === "swipe") {
        // No time gate: "swipe" is only entered when the first movement was
        // upward on the glass, so a slow, deliberate drag up it is a drink too.
        if (-dy > 70) { ptr.mode = "done"; startDrink(); }
        return;
      }
      if (ptr.mode === "tilt") {
        G.tiltX = clamp(ptr.tx0 + dx / (W * 0.55), -1, 1);
        G.tiltY = clamp(ptr.ty0 + dy / (H * 0.7), -1, 1);
      }
    }, { passive: false });
    function endPtr(e) {
      if (!ptr.down || (e && e.pointerId !== ptr.id)) return;
      ptr.down = false;
      const quick = performance.now() - ptr.t0 < 350;
      if (!ptr.mode && quick) {
        if (ptr.prop) { if (ptr.prop === "walk") { heroAct = "walk"; sfxPop(); haptic("light"); setLive(true); } else chooseAct(ptr.prop); }
        else if (ptr.onGlass) tapGlass();
        else { elSettings.hidden = true; elAbout.hidden = true; }
      }
    }
    ctx.listen(window, "pointerup", endPtr);
    ctx.listen(window, "pointercancel", endPtr);

    // ===================================================================
    // Frame
    // ===================================================================
    function resize() {
      W = ctx.width; H = ctx.height;
      camera.aspect = W / Math.max(1, H);
      camera.updateProjectionMatrix();
      renderer.setSize(W, H, false);
      layoutHud();
      fitCamera();
    }
    let lastW = 0, lastH = 0;
    ctx.onFrame((dtMs, timeMs) => {
      const dt = Math.min(0.05, Math.max(0.001, dtMs / 1000));
      const t = timeMs / 1000;
      if (ctx.width !== lastW || ctx.height !== lastH) { lastW = ctx.width; lastH = ctx.height; resize(); }

      if (profile.tilt && ctx.sensors && ctx.sensors.active && ctx.sensors.tilt && !ptr.down) {
        G.tiltX = clamp(ctx.sensors.tilt.x || 0, -1, 1);
        G.tiltY = clamp(ctx.sensors.tilt.y || 0, -1, 1);
      } else if (!ptr.down || ptr.mode !== "tilt") {
        G.tiltX += (0 - G.tiltX) * Math.min(1, dt * 2.2);
        G.tiltY += (0 - G.tiltY) * Math.min(1, dt * 2.2);
      }
      const tdt = Math.min(0.1, Math.max(0.001, dtMs / 1000));
      if (P.on) stepPour(tdt); else { tapRise = Math.min(0.3, tapRise + dt * 0.5); placeTap(); stream.visible = false; }
      if (D.on) stepDrink(tdt);

      glassGroup.updateMatrixWorld();
      stepLiquid(dt, t);
      stepSplash(dt, G.levelFrac > 0.002 ? G.spec.levelFor(G.levelFrac) : 0);
      stepRow(dt);
      for (let i = 0; i < BOKEH_N; i++) {
        const b = bokehSeeds[i];
        const tw = 0.85 + 0.15 * Math.sin(t * b.sp + b.ph);
        _pos.set(b.x + Math.sin(t * 0.13 + b.ph) * 0.02, b.y + Math.cos(t * 0.11 + b.ph) * 0.015, b.z);
        _scl.setScalar(b.r * tw);
        _m4.compose(_pos, _idq, _scl);
        bokeh.setMatrixAt(i, _m4);
      }
      bokeh.instanceMatrix.needsUpdate = true;
      stepProps(dt, t);
      placeCamera(t, dt);
      syncLabels();
      renderer.render(scene, camera);
      tweenNumber(Math.min(0.12, dtMs / 1000));
    });

    // ===================================================================
    // Boot
    // ===================================================================
    await Promise.race([fontsReady, new Promise((res) => ctx.timeout(res, 2500))]);
    await loadState();
    recompute(); syncViz();
    W = ctx.width; H = ctx.height; lastW = W; lastH = H;
    resize();
    buildGlass(profile.style);
    streamMat.color.set(G.look.color); streamMat.emissive.set(G.look.attn);
    G.levelFrac = derived.frac; G.targetFrac = derived.frac; G.head = derived.frac > 0 ? G.headRest : 0;
    shownPints = derived.remaining;
    rebuildRow();
    placeTap();
    setState(derived.kcal > 0 ? "result" : "pick");
    glassGroup.updateMatrixWorld();
    stepLiquid(0.016, 0);
    camGoals(); camPos.copy(camGoalPos); camLook.copy(camGoalLook); camFov = camGoalFov;
    placeCamera(0, 0.016);
    stepProps(0.016, 0); syncLabels();
    updateTab();
    renderer.render(scene, camera);
    ctx.markVisualReady("first frame");
    ctx.platform.ready();
  }
};
