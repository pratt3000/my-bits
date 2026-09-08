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
    scene.fog = new THREE.Fog("#120a08", 1.35, 3.6);
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
        bt.position.set(-1.0 + i * 0.118 + rrange(-0.02, 0.02), 0.42 + h / 2, -1.0);
        bt.material = bottleMat.clone();
        bt.material.color.set(["#3b1f14", "#1e3a22", "#4a2a12", "#2c2c3a", "#5a3a1a"][i % 5]);
        scene.add(bt);
      }
      const shelf = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.02, 0.16),
        new THREE.MeshStandardMaterial({ color: "#2e1a10", roughness: 0.6 }));
      shelf.position.set(0, 0.41, -1.0);
      scene.add(shelf);
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
      nucl: [], overflowT: -1
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
      const rate = target > G.levelFrac ? 3.6 : 4.2;
      G.levelFrac += (target - G.levelFrac) * Math.min(1, dt * rate);
      if (Math.abs(target - G.levelFrac) < 0.0004) G.levelFrac = target;

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
      glassGroup.rotation.x = G.shownTiltY * 0.30;

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
    const cam = { dist: 0.5, look: 0.08, tdist: 0.5, tlook: 0.08 };
    function fitCamera() {
      const Hg = G.spec ? G.spec.H : 0.15;
      const vfov = camera.fov * Math.PI / 180;
      const aspect = Math.max(0.4, W / Math.max(1, H));
      const dv = (Hg * 1.75 / 2) / Math.tan(vfov / 2);
      const dh = 0.15 / (Math.tan(vfov / 2) * aspect);      // room for the row beside it
      cam.tdist = Math.max(dv, dh);
      cam.tlook = Hg * 0.5 - 0.004;
    }
    function placeCamera(t) {
      cam.dist += (cam.tdist - cam.dist) * 0.06;
      cam.look += (cam.tlook - cam.look) * 0.06;
      const sway = Math.sin(t * 0.23) * 0.012;
      camera.position.set(sway + G.shownTiltX * 0.04, cam.look + cam.dist * 0.2 + G.shownTiltY * 0.02, cam.dist);
      camera.lookAt(0, cam.look, 0);
    }

    // ===================================================================
    // Chrome. DOM over the GL canvas; the root is invisible to the finger and
    // only the controls opt back in.
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
      ".bm-top{position:absolute;left:0;right:0;top:0;padding:0 18px;text-align:center;",
      "background:linear-gradient(180deg,rgba(12,6,4,.9),rgba(12,6,4,.55) 60%,rgba(12,6,4,0))}",
      ".bm-brand{font-family:" + DISPLAY + ";font-size:15px;letter-spacing:.34em;color:#e9b95a;opacity:.92}",
      ".bm-num{display:flex;align-items:baseline;justify-content:center;gap:10px;margin-top:2px;line-height:1}",
      ".bm-big{font-family:" + DISPLAY + ";font-size:92px;color:#fff;letter-spacing:.01em;",
      "text-shadow:0 2px 24px rgba(255,180,80,.25)}",
      ".bm-unit{font-family:" + DISPLAY + ";font-size:30px;color:#e9b95a;letter-spacing:.06em}",
      ".bm-style{font-family:" + SERIF + ";font-style:italic;font-size:17px;color:#ffe2b3;opacity:.9;margin-top:-4px}",
      ".bm-kcal{font-size:11.5px;font-weight:600;opacity:.62;margin-top:6px;letter-spacing:.04em}",
      ".bm-week{display:flex;justify-content:center;gap:9px;margin-top:10px;height:34px;align-items:flex-end}",
      ".bm-day{width:14px;display:flex;flex-direction:column;align-items:center;gap:3px}",
      ".bm-bar{width:9px;border-radius:3px 3px 1px 1px;background:linear-gradient(180deg,#ffe9b8,#e9a83a);",
      "min-height:2px;opacity:.85}",
      ".bm-day.today .bm-bar{box-shadow:0 0 10px rgba(255,200,90,.6)}",
      ".bm-dl{font-size:8.5px;font-weight:700;opacity:.5;letter-spacing:.05em}",
      ".bm-side{position:absolute;right:10px;top:50%;transform:translateY(-46%);display:flex;",
      "flex-direction:column;gap:9px;pointer-events:auto}",
      ".bm-chip{width:54px;height:54px;border-radius:18px;border:1px solid rgba(255,220,160,.16);",
      "background:rgba(22,11,6,.8);",
      "display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1px;",
      "color:#fff;font-family:" + BODY + ";padding:0}",
      ".bm-chip span{font-size:20px;line-height:1}",
      ".bm-chip small{font-family:" + DISPLAY + ";font-size:10.5px;letter-spacing:.1em;opacity:.75}",
      ".bm-chip.on{background:rgba(233,185,90,.92);color:#2a1408;border-color:#ffe0a8}",
      ".bm-chip.on small{opacity:.9}",
      ".bm-chip .bm-tot{position:absolute;left:-2px;top:-6px;font-size:9px;font-weight:800;",
      "background:#e9b95a;color:#2a1408;border-radius:8px;padding:1px 5px;display:none}",
      ".bm-chip{position:relative}",
      ".bm-panel{position:absolute;right:72px;top:50%;transform:translateY(-46%);width:min(64vw,250px);",
      "border-radius:20px;padding:14px 14px 12px;background:rgba(18,9,5,.92);",
      "border:1px solid rgba(255,220,160,.14);",
      "pointer-events:auto;box-shadow:0 12px 40px rgba(0,0,0,.45)}",
      ".bm-ph{display:flex;align-items:baseline;justify-content:space-between}",
      ".bm-pt{font-family:" + DISPLAY + ";font-size:22px;letter-spacing:.06em;color:#e9b95a}",
      ".bm-pv{font-family:" + DISPLAY + ";font-size:20px;color:#fff}",
      ".bm-pv small{font-size:12px;opacity:.6;letter-spacing:.08em;margin-left:3px}",
      ".bm-pk{font-size:11px;opacity:.6;margin-top:-2px;font-weight:600}",
      ".bm-quick{display:grid;grid-template-columns:1fr 1fr;gap:7px;margin-top:11px}",
      ".bm-q{border:0;border-radius:12px;padding:10px 4px;background:rgba(255,225,170,.12);color:#ffe9c4;",
      "font-family:" + DISPLAY + ";font-size:18px;letter-spacing:.06em}",
      ".bm-q:active{background:rgba(233,185,90,.9);color:#2a1408}",
      ".bm-row{display:flex;gap:7px;margin-top:9px}",
      ".bm-x{flex:1;border:0;border-radius:10px;padding:7px 4px;background:rgba(255,255,255,.07);color:#fff;",
      "font-size:11.5px;font-weight:700;letter-spacing:.06em}",
      ".bm-x:disabled{opacity:.3}",
      ".bm-live{margin-top:9px;display:flex;align-items:center;justify-content:space-between;gap:8px;",
      "font-size:11.5px;font-weight:600;opacity:.9}",
      ".bm-tog{width:40px;height:24px;border-radius:12px;background:rgba(255,255,255,.15);border:0;position:relative;padding:0}",
      ".bm-tog::after{content:'';position:absolute;top:3px;left:3px;width:18px;height:18px;border-radius:9px;background:#fff;transition:left .15s}",
      ".bm-tog.on{background:#e9b95a}.bm-tog.on::after{left:19px}",
      ".bm-livenote{font-size:10.5px;opacity:.55;margin-top:5px;line-height:1.35}",
      ".bm-bottom{position:absolute;left:0;right:0;display:flex;flex-direction:column;align-items:center;gap:8px;",
      "pointer-events:none}",
      ".bm-pour{pointer-events:auto;border:0;border-radius:30px;padding:15px 34px;",
      "background:linear-gradient(180deg,#ffd98a,#e9a83a);color:#2a1408;font-family:" + DISPLAY + ";",
      "font-size:24px;letter-spacing:.1em;box-shadow:0 10px 30px rgba(233,168,58,.35),inset 0 1px 0 rgba(255,255,255,.5)}",
      ".bm-pour:active{transform:scale(.97)}",
      ".bm-hint{font-family:" + SERIF + ";font-style:italic;font-size:15px;color:#ffe2b3;opacity:.86;",
      "text-align:center;padding:0 24px;text-shadow:0 1px 8px rgba(0,0,0,.6)}",
      ".bm-icon{position:absolute;width:36px;height:36px;border-radius:12px;border:1px solid rgba(255,220,160,.14);",
      "background:rgba(22,11,6,.78);color:#fff;font-size:17px;font-weight:700;pointer-events:auto;",
      "display:flex;align-items:center;justify-content:center;font-family:" + BODY + "}",
      ".bm-sheet{position:absolute;inset:0;background:rgba(10,5,3,.95);",
      "pointer-events:auto;overflow-y:auto;-webkit-overflow-scrolling:touch;",
      "padding:0 22px}",
      ".bm-sheet h2{font-family:" + DISPLAY + ";font-size:30px;letter-spacing:.12em;color:#e9b95a;margin:0 0 14px;text-align:center}",
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
      ".bm-danger{width:100%;border:1px solid rgba(255,110,90,.4);background:rgba(255,80,60,.1);color:#ffb0a0;",
      "border-radius:14px;padding:12px;font-weight:700;letter-spacing:.06em;margin-top:16px}",
      ".bm-close{position:absolute;right:14px;width:40px;height:40px;border-radius:14px;border:0;",
      "background:rgba(255,255,255,.1);color:#fff;font-size:22px}",
      ".bm-toast{position:absolute;left:50%;transform:translateX(-50%);padding:9px 16px;border-radius:14px;",
      "background:rgba(18,9,5,.88);border:1px solid rgba(255,220,160,.18);font-family:" + DISPLAY + ";",
      "font-size:19px;letter-spacing:.06em;color:#ffe9c4;opacity:0;transition:opacity .2s;white-space:nowrap}",
      ".bm-toast small{font-size:12px;opacity:.6;margin-left:8px;letter-spacing:.1em}",
      ".bm-plus{position:absolute;font-family:" + DISPLAY + ";font-size:14px;letter-spacing:.1em;color:#e9b95a;",
      "background:rgba(18,9,5,.8);border:1px solid rgba(255,220,160,.2);border-radius:10px;padding:3px 8px;display:none}",
      ".bm-dis{font-size:10.5px;opacity:.45;line-height:1.4;margin-top:14px}",
      "</style>",
      '<div class="bm">',
      '<div class="bm-top">',
      '<div class="bm-brand">BEER MILEAGE</div>',
      '<div class="bm-num"><span class="bm-big" data-big>0.0</span><span class="bm-unit" data-unit>PINTS</span></div>',
      '<div class="bm-style" data-style></div>',
      '<div class="bm-kcal" data-kcal></div>',
      '<div class="bm-week" data-week></div>',
      "</div>",
      '<div class="bm-side" data-side></div>',
      '<div class="bm-panel" data-panel hidden></div>',
      '<div class="bm-plus" data-plus></div>',
      '<div class="bm-bottom" data-bottom>',
      '<button class="bm-pour" type="button" data-pour>POUR ONE</button>',
      '<div class="bm-hint" data-hint></div>',
      "</div>",
      '<button class="bm-icon" type="button" data-gear aria-label="Settings">⚙</button>',
      '<button class="bm-icon" type="button" data-info aria-label="About">i</button>',
      '<div class="bm-sheet" data-settings hidden></div>',
      '<div class="bm-sheet" data-about hidden></div>',
      '<div class="bm-toast" data-toast></div>',
      "</div>"
    ].join("");

    const q = (sel) => ui.querySelector(sel);
    const elBig = q("[data-big]"), elUnit = q("[data-unit]"), elStyle = q("[data-style]");
    const elKcal = q("[data-kcal]"), elWeek = q("[data-week]"), elSide = q("[data-side]");
    const elPanel = q("[data-panel]"), elPlus = q("[data-plus]"), elBottom = q("[data-bottom]");
    const elPour = q("[data-pour]"), elHint = q("[data-hint]"), elGear = q("[data-gear]");
    const elInfo = q("[data-info]"), elSettings = q("[data-settings]"), elAbout = q("[data-about]");
    const elToast = q("[data-toast]"), elTop = q(".bm-top");

    // activity chips
    for (const k of MODEL.ACT_KEYS) {
      const a = MODEL.ACTS[k];
      const b = document.createElement("button");
      b.type = "button";
      b.className = "bm-chip";
      b.setAttribute("data-act", k);
      b.innerHTML = "<span>" + a.emoji + "</span><small>" + a.label.toUpperCase() + "</small><i class=\"bm-tot\" data-tot></i>";
      elSide.appendChild(b);
    }

    const fmtNum = (n, act) => {
      if (act === "run" || act === "ride") return (Math.round(n * 10) / 10).toString();
      return Math.round(n).toLocaleString();
    };
    const fmtPints = (p) => (p >= 10 ? Math.round(p).toString() : (Math.round(p * 10) / 10).toFixed(1));

    let openAct = null, toastT = null;
    let shownPints = 0;
    const pedo = { on: false, live: 0, pending: 0, mean: 9.81, prev: 0, last: 0, off: null, available: null };

    function layoutHud() {
      elTop.style.paddingTop = (ctx.safeArea.top + 14) + "px";
      elTop.style.paddingBottom = "26px";
      elGear.style.top = (ctx.safeArea.top + 12) + "px";
      elGear.style.right = "12px";
      elInfo.style.top = (ctx.safeArea.top + 12) + "px";
      elInfo.style.left = "12px";
      elBottom.style.bottom = (ctx.safeArea.bottom + 26) + "px";
      elToast.style.top = (ctx.safeArea.top + 238) + "px";
      for (const s of [elSettings, elAbout]) {
        s.style.paddingTop = (ctx.safeArea.top + 22) + "px";
        s.style.paddingBottom = (ctx.safeArea.bottom + 30) + "px";
      }
      const closes = ui.querySelectorAll("[data-close]");
      for (const c of closes) c.style.top = (ctx.safeArea.top + 14) + "px";
      // keep the big number off the glass rim on short screens
      const compact = H < 700;
      elBig.style.fontSize = compact ? "68px" : "92px";
      elUnit.style.fontSize = compact ? "22px" : "30px";
      elWeek.style.display = compact ? "none" : "flex";
    }

    function toast(main, sub) {
      elToast.innerHTML = main + (sub ? "<small>" + sub + "</small>" : "");
      elToast.style.opacity = "1";
      if (toastT) toastT();
      let alive = true;
      toastT = () => { alive = false; };
      ctx.timeout(() => { if (alive) elToast.style.opacity = "0"; }, 1500);
    }

    function renderWeek() {
      const days = [];
      const byDate = {};
      for (const h of history) byDate[h.date] = h;
      const now = new Date();
      let max = 0.01;
      for (let i = 6; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
        const key = MODEL.localDate(d);
        const pints = i === 0 ? derived.earned : (byDate[key] ? byDate[key].pints : 0);
        max = Math.max(max, pints);
        days.push({ key, pints, label: ["S", "M", "T", "W", "T", "F", "S"][d.getDay()], today: i === 0 });
      }
      elWeek.innerHTML = days.map((d) =>
        '<div class="bm-day' + (d.today ? " today" : "") + '"><div class="bm-bar" style="height:' +
        Math.max(2, Math.round((d.pints / max) * 22)) + 'px;opacity:' + (d.pints > 0 ? 0.85 : 0.25) +
        '"></div><div class="bm-dl">' + d.label + "</div></div>").join("");
    }

    function hintText() {
      if (derived.full >= 1) {
        return "You have earned " + derived.full + (derived.full > 1 ? " pints" : " pint") + ". Pour one.";
      }
      // whichever activity you have done most of today, else steps
      let act = "steps", best = -1;
      for (const k of MODEL.ACT_KEYS) {
        const kc = MODEL.actKcal(day.log, k, profile.kg);
        if (kc > best) { best = kc; act = k; }
      }
      if (best <= 0) act = "steps";
      const need = MODEL.toNextPint(day, profile.kg, profile.style, act);
      const a = MODEL.ACTS[act];
      const shown = act === "steps" ? Math.ceil(need).toLocaleString() + " steps"
        : act === "swim" ? Math.ceil(need / 50) * 50 + " m"
        : act === "gym" ? Math.ceil(need) + " min"
        : (Math.ceil(need * 10) / 10).toFixed(1) + " km";
      const verb = { steps: "", run: " of running", ride: " on the bike", swim: " in the pool", gym: " in the gym" }[act];
      return shown + verb + " to your " + (derived.earned - day.poured >= 1 || day.poured > 0 ? "next" : "first") + " pint";
    }

    function renderHud() {
      const s = MODEL.STYLES[profile.style];
      elUnit.textContent = derived.remaining >= 0.95 && derived.remaining < 1.05 ? "PINT" : "PINTS";
      elStyle.textContent = "of " + s.name.toLowerCase() + " · " + Math.round(MODEL.beerKcal(profile.style)) + " kcal a pint";
      elKcal.textContent = Math.round(derived.kcal).toLocaleString() + " KCAL EARNED TODAY"
        + (day.poured ? " · " + day.poured + " POURED" : "");
      elPour.style.display = derived.full >= 1 ? "block" : "none";
      elHint.textContent = hintText();
      for (const k of MODEL.ACT_KEYS) {
        const chip = elSide.querySelector('[data-act="' + k + '"]');
        const tot = chip.querySelector("[data-tot]");
        const v = day.log[k] || 0;
        tot.style.display = v > 0 ? "block" : "none";
        tot.textContent = fmtNum(v, k);
        chip.classList.toggle("on", openAct === k);
      }
      const extra = derived.full - ROW_MAX;
      elPlus.style.display = extra > 0 ? "block" : "none";
      elPlus.textContent = "+" + extra + " MORE";
      elPlus.style.right = "82px";
      elPlus.style.top = "50%";
      renderWeek();
    }

    function renderPanel() {
      if (!openAct) { elPanel.hidden = true; return; }
      const a = MODEL.ACTS[openAct];
      const v = day.log[openAct] || 0;
      const kc = MODEL.actKcal(day.log, openAct, profile.kg);
      const canUndo = day.adds.length && day.adds[day.adds.length - 1].act === openAct;
      let html = '<div class="bm-ph"><div class="bm-pt">' + a.emoji + " " + a.label.toUpperCase() + "</div>"
        + '<div class="bm-pv">' + fmtNum(v, openAct) + "<small>" + a.unit.toUpperCase() + "</small></div></div>"
        + '<div class="bm-pk">' + Math.round(kc) + " kcal · " + (Math.round(MODEL.pintsFor(kc, profile.style) * 100) / 100) + " pints</div>"
        + '<div class="bm-quick">' + a.quick.map((n) => '<button class="bm-q" type="button" data-add="' + n + '">+' + fmtNum(n, openAct) + "</button>").join("") + "</div>"
        + '<div class="bm-row"><button class="bm-x" type="button" data-undo' + (canUndo ? "" : " disabled") + ">UNDO LAST</button>"
        + '<button class="bm-x" type="button" data-clear' + (v > 0 ? "" : " disabled") + ">CLEAR</button></div>";
      if (openAct === "steps") {
        html += '<div class="bm-live"><span>Count my steps live</span><button class="bm-tog' + (pedo.on ? " on" : "") + '" type="button" data-live aria-label="Count steps live"></button></div>'
          + '<div class="bm-livenote" data-livenote>' + liveNote() + "</div>";
      }
      elPanel.innerHTML = html;
      elPanel.hidden = false;
    }
    function liveNote() {
      if (pedo.available === false) return "Not available here. Add your steps with the buttons above.";
      if (pedo.on) return "Walking with the phone counts. " + pedo.live.toLocaleString() + " so far this session.";
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
        + "<p>A US pint of 5% lager comes out at " + Math.round(MODEL.beerKcal("lager")) + " kcal, which is within a few percent of the number on the can. Ten thousand steps at 70 kg is "
        + Math.round(MODEL.actKcal({ steps: 10000 }, "steps", 70)) + " kcal. Do the division and try not to be sad.</p>"
        + '<p class="bm-dis">Beer Mileage is a game about arithmetic. Pints are a fictional fitness metric, not a recommendation to drink anything, and burning it off first does not make it health food.</p>';
    }

    // ---- the number, tweened so a big add rolls up rather than snapping
    function tweenNumber(dt) {
      const target = derived.remaining;
      if (Math.abs(target - shownPints) < 0.004) shownPints = target;
      else shownPints += (target - shownPints) * Math.min(1, dt * 9);
      elBig.textContent = fmtPints(shownPints);
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

    function applyDay(next, why) {
      const beforeFull = derived.full, beforeFrac = derived.frac, beforeRem = derived.remaining;
      day = next;
      recompute();
      saveDay();
      const dRem = derived.remaining - beforeRem;
      if (derived.full > beforeFull) {
        // a glass has filled: hold it at the brim, then it joins the row
        G.overflowT = 0;
        G.targetFrac = derived.frac;
        pourIn(1 - beforeFrac + derived.frac);
        sfxGlug(true);
        ctx.timeout(() => { sfxClink(); haptic("success"); syncRowCount(derived.full, true); }, 520);
        ctx.platform.milestone("pint_earned", { pints: derived.full, kcal: Math.round(derived.kcal) });
      } else if (derived.full < beforeFull) {
        G.overflowT = -1;                 // a pour cancels any brim-hold in progress
        G.targetFrac = derived.frac;
        syncRowCount(derived.full, true);
      } else {
        G.targetFrac = derived.frac;
        if (dRem > 0.0005) { pourIn(dRem); sfxGlug(dRem > 0.25); }
      }
      ctx.platform.setProgress(clamp(derived.frac, 0, 1));
      renderHud();
      renderPanel();
    }

    function addAmount(act, amount) {
      firstGesture();
      const next = MODEL.add(day, act, amount);
      if (next === day) return;
      const kcal = MODEL.actKcal(next.log, act, profile.kg) - MODEL.actKcal(day.log, act, profile.kg);
      applyDay(next, "add");
      haptic("light");
      toast("+" + fmtNum(amount, act) + " " + MODEL.ACTS[act].unit.toUpperCase(), Math.round(kcal) + " KCAL");
      ctx.platform.interact({ type: "add", act: act, amount: amount });
    }

    function pourOne() {
      firstGesture();
      const next = MODEL.pour(day, profile.kg, profile.style);
      if (next === day) return;
      applyDay(next, "pour");
      sfxGulp();
      haptic("medium");
      toast("POURED", (derived.full ? derived.full + " LEFT" : "LAST ONE"));
      ctx.platform.interact({ type: "pour", poured: day.poured });
    }

    function setStyle(k) {
      if (!MODEL.STYLES[k] || k === profile.style) return;
      profile.style = k;
      saveProfile();
      recompute();
      buildGlass(k);
      G.levelFrac = 0;
      G.targetFrac = derived.frac;
      G.head = derived.frac > 0 ? G.headRest : 0;
      rebuildRow();
      renderHud(); renderSettings(); renderPanel();
      sfxTick();
      ctx.platform.interact({ type: "style", style: k });
    }

    function setKg(delta) {
      profile.kg = clamp(profile.kg + delta, 35, 200);
      saveProfile();
      recompute();
      G.targetFrac = derived.frac;
      syncRowCount(derived.full, true);
      const kgv = elSettings.querySelector("[data-kgv]");
      if (kgv) kgv.innerHTML = profile.kg + " <small>KG</small>";
      renderHud(); renderPanel();
      sfxTick();
    }

    function resetToday() {
      applyDay(MODEL.newDay(MODEL.localDate()), "reset");
      G.levelFrac = 0; G.head = 0;
      rebuildRow();
      toast("RESET", "A FRESH GLASS");
      ctx.platform.interact({ type: "reset" });
    }

    // ---- live steps from the motion sensor, while this is open.
    // Threshold crossing on the high-passed magnitude with a refractory period:
    // crude, honest, and it counts a walk.
    async function setLive(on) {
      if (on) {
        if (!ctx.capabilities.motion) { pedo.available = false; pedo.on = false; renderPanel(); return; }
        let okay = false;
        try { okay = await ctx.sensors.start(); } catch (err) { okay = false; }
        if (!okay) { pedo.available = false; pedo.on = false; renderPanel(); return; }
        pedo.available = true;
        pedo.on = true;
        pedo.live = 0; pedo.pending = 0;
        try {
          pedo.off = ctx.sensors.onChange(() => {
            const a = ctx.sensors.accelerationIncludingGravity || ctx.sensors.accelerometer;
            if (!a || typeof a.x !== "number") return;
            const mag = Math.hypot(a.x, a.y, a.z);
            pedo.mean += (mag - pedo.mean) * 0.06;
            const hp = mag - pedo.mean;
            const now = performance.now();
            if (hp > 1.1 && pedo.prev <= 1.1 && now - pedo.last > 280) {
              pedo.last = now;
              pedo.live++;
              pedo.pending++;
              if (pedo.pending >= 20) { const n = pedo.pending; pedo.pending = 0; addAmount("steps", n); }
              const note = elPanel.querySelector("[data-livenote]");
              if (note) note.textContent = liveNote();
            }
            pedo.prev = hp;
          });
        } catch (err) { pedo.off = null; }
      } else {
        pedo.on = false;
        if (pedo.off) { try { pedo.off(); } catch (err) { /* already */ } pedo.off = null; }
        if (pedo.pending > 0) { const n = pedo.pending; pedo.pending = 0; addAmount("steps", n); }
      }
      renderPanel();
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

    // ---- clicks, delegated off the root so rebuilt panels keep working
    ctx.listen(ui, "click", (e) => {
      const t = e.target.closest ? e.target.closest("[data-act],[data-add],[data-undo],[data-clear],[data-pour],[data-gear],[data-info],[data-close],[data-style],[data-kg],[data-reset],[data-live],[data-tilt]") : null;
      if (!t) return;
      e.preventDefault();
      e.stopPropagation();
      firstGesture();
      if (t.hasAttribute("data-act")) {
        const k = t.getAttribute("data-act");
        openAct = openAct === k ? null : k;
        sfxTick(); haptic("light");
        renderHud(); renderPanel();
      } else if (t.hasAttribute("data-add")) {
        addAmount(openAct, parseFloat(t.getAttribute("data-add")));
      } else if (t.hasAttribute("data-undo")) {
        const next = MODEL.undo(day);
        if (next !== day) { applyDay(next, "undo"); sfxTick(); haptic("light"); toast("UNDONE"); }
      } else if (t.hasAttribute("data-clear")) {
        const next = MODEL.clearAct(day, openAct);
        if (next !== day) { applyDay(next, "clear"); sfxTick(); toast("CLEARED", MODEL.ACTS[openAct].label.toUpperCase()); }
      } else if (t.hasAttribute("data-pour")) {
        pourOne();
      } else if (t.hasAttribute("data-gear")) {
        renderSettings(); elSettings.hidden = false; elAbout.hidden = true; openAct = null; renderHud(); renderPanel(); sfxTick();
      } else if (t.hasAttribute("data-info")) {
        renderAbout(); elAbout.hidden = false; elSettings.hidden = true; openAct = null; renderHud(); renderPanel(); sfxTick();
      } else if (t.hasAttribute("data-close")) {
        elSettings.hidden = true; elAbout.hidden = true; sfxTick();
      } else if (t.hasAttribute("data-style")) {
        setStyle(t.getAttribute("data-style"));
      } else if (t.hasAttribute("data-kg")) {
        setKg(parseInt(t.getAttribute("data-kg"), 10));
      } else if (t.hasAttribute("data-reset")) {
        resetToday(); elSettings.hidden = true;
      } else if (t.hasAttribute("data-live")) {
        setLive(!pedo.on);
      } else if (t.hasAttribute("data-tilt")) {
        setTilt(!profile.tilt);
      }
    });

    // ---- the canvas: drag tilts the glass; a tap closes what is open
    const ptr = { down: false, id: null, x0: 0, y0: 0, tx0: 0, ty0: 0, moved: false };
    ctx.listen(canvas, "pointerdown", (e) => {
      e.preventDefault();
      if (ptr.down) return;
      ptr.down = true; ptr.id = e.pointerId; ptr.moved = false;
      ptr.x0 = e.clientX; ptr.y0 = e.clientY; ptr.tx0 = G.tiltX; ptr.ty0 = G.tiltY;
      firstGesture();
    }, { passive: false });
    ctx.listen(window, "pointermove", (e) => {
      if (!ptr.down || e.pointerId !== ptr.id) return;
      const dx = e.clientX - ptr.x0, dy = e.clientY - ptr.y0;
      if (Math.abs(dx) + Math.abs(dy) > 6) ptr.moved = true;
      G.tiltX = clamp(ptr.tx0 + dx / (W * 0.55), -1, 1);
      G.tiltY = clamp(ptr.ty0 + dy / (H * 0.7), -1, 1);
    }, { passive: false });
    function endPtr(e) {
      if (!ptr.down || (e && e.pointerId !== ptr.id)) return;
      ptr.down = false;
      if (!ptr.moved) {
        if (openAct) { openAct = null; renderHud(); renderPanel(); }
        elSettings.hidden = true; elAbout.hidden = true;
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

      // tilt: the phone if allowed, otherwise the drag; when nobody is touching it settles
      if (profile.tilt && ctx.sensors && ctx.sensors.active && ctx.sensors.tilt && !ptr.down) {
        G.tiltX = clamp(ctx.sensors.tilt.x || 0, -1, 1);
        G.tiltY = clamp(ctx.sensors.tilt.y || 0, -1, 1);
      } else if (!ptr.down) {
        G.tiltX += (0 - G.tiltX) * Math.min(1, dt * 2.2);
        G.tiltY += (0 - G.tiltY) * Math.min(1, dt * 2.2);
      }

      glassGroup.updateMatrixWorld();
      stepLiquid(dt, t);
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
      placeCamera(t);
      renderer.render(scene, camera);
      tweenNumber(Math.min(0.12, dtMs / 1000));
    });

    // ===================================================================
    // Boot
    // ===================================================================
    await Promise.race([fontsReady, new Promise((res) => ctx.timeout(res, 2500))]);
    await loadState();
    recompute();
    W = ctx.width; H = ctx.height; lastW = W; lastH = H;
    resize();
    buildGlass(profile.style);
    G.levelFrac = derived.frac; G.targetFrac = derived.frac; G.head = derived.frac > 0 ? G.headRest : 0;
    shownPints = derived.remaining;
    rebuildRow();
    renderHud(); renderPanel();
    glassGroup.updateMatrixWorld();
    stepLiquid(0.016, 0);
    placeCamera(0);
    renderer.render(scene, camera);
    ctx.markVisualReady("first frame");
    ctx.platform.ready();
  }
};
