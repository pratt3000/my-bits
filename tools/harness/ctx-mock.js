/*
 * A browser-side stand-in for the Plethora `ctx` object, built strictly from
 * /v1/agent/sdk.md (contextVersion plethora-agent-context-2026-08-13.1).
 *
 * It exists so bits in this repo can be *played* before upload — the real
 * runtime only exists inside the Plethora app. Every method the SDK documents
 * is present; anything a bit reaches for that is NOT in the SDK throws loudly,
 * which is the point: the mock fails the same way the upload validator does.
 */
(function () {
  const log = [];
  const events = [];
  function note(kind, ...args) {
    log.push({ kind, args, t: performance.now() });
    events.push(kind);
  }

  // Everything the runtime hands out is registered here so a "cleanup" is
  // observable in tests; the real runtime owns unload cleanup.
  const disposers = [];
  const frameCbs = [];
  const timers = new Set();

  const container = document.getElementById("bit-container");
  const dpr = Math.min(window.devicePixelRatio || 1, 3);

  function sized() {
    const r = container.getBoundingClientRect();
    return { w: Math.round(r.width), h: Math.round(r.height) };
  }

  const memoryStore = {};       // channelId -> value
  const recordStore = {};       // channelId -> [{value,label,at}]
  const tallyStore = {};        // channelId -> {option: count}
  const worldStore = {};        // channelId -> snapshot
  const localStore = {};
  const loadedFonts = new Set();   // family/weight already injected

  const manifest = window.__BIT_MANIFEST__ || {};
  const declaredMemory = manifest.memory || {};
  const declaredPerms = new Set(manifest.permissions || []);

  function requirePerm(name, api) {
    if (!declaredPerms.has(name)) {
      const msg = `PERMISSION VIOLATION: ${api} needs manifest permission "${name}" which is not declared.`;
      note("violation", msg);
      throw new Error(msg);
    }
  }
  /** A registry pin only loads if the manifest actually declares it. */
  function requireDependency(name, version) {
    const want = `${name}@${version}`;
    const declared = (manifest.dependencies || []).map(
      (d) => (typeof d === "string" ? d : `${d.name}@${d.version}`));
    if (!declared.includes(want)) {
      const msg = `DEPENDENCY VIOLATION: loaded "${want}" but manifest.dependencies does not declare it.`;
      note("violation", msg);
      throw new Error(msg);
    }
  }

  function requireChannel(family, id) {
    const fam = declaredMemory[family];
    if (!fam || !fam[id]) {
      const msg = `MEMORY VIOLATION: ctx.memory.${family} channel "${id}" is not declared in manifest.memory.${family}.`;
      note("violation", msg);
      throw new Error(msg);
    }
  }

  const ctx = {
    container,
    get width() { return sized().w; },
    get height() { return sized().h; },
    dpr,
    nativeDpr: window.devicePixelRatio || 1,
    safeArea: window.__BIT_SAFE_AREA__ || { top: 47, bottom: 34, left: 0, right: 0 },
    manifest,
    runtime: { version: "plethora-bit@2", schemaVersion: 1 },
    capabilities: {
      audio: true, backgroundMusic: true, camera: true, haptics: true,
      microphone: true, motion: true, storage: true,
    },

    markVisualReady(reason) { note("markVisualReady", reason); },

    createRoot(opts = {}) {
      const el = document.createElement("div");
      el.style.cssText =
        "position:absolute;inset:0;width:100%;height:100%;overflow:hidden;" +
        (opts.touchAction ? `touch-action:${opts.touchAction};` : "touch-action:none;") +
        (opts.style || "");
      if (opts.className) el.className = opts.className;
      container.appendChild(el);
      disposers.push(() => el.remove());
      return el;
    },

    createCanvas2D(opts = {}) {
      const c = document.createElement("canvas");
      const { w, h } = sized();
      c.width = Math.round(w * dpr);
      c.height = Math.round(h * dpr);
      c.style.cssText =
        `position:absolute;inset:0;width:100%;height:100%;display:block;` +
        `touch-action:${opts.touchAction || "none"};`;
      container.appendChild(c);
      c.getContext("2d").setTransform(dpr, 0, 0, dpr, 0, 0);
      disposers.push(() => c.remove());
      return c;
    },

    createCanvas(opts = {}) {
      const c = document.createElement("canvas");
      const { w, h } = sized();
      c.width = Math.round(w * dpr);
      c.height = Math.round(h * dpr);
      c.style.cssText =
        `position:absolute;inset:0;width:100%;height:100%;display:block;` +
        `touch-action:${opts.touchAction || "none"};`;
      container.appendChild(c);
      disposers.push(() => c.remove());
      return c;
    },

    platform: {
      ready(p) { note("ready", p); document.documentElement.dataset.bitReady = "1"; },
      start(p) { note("start", p); },
      interact(p) { note("interact", p); },
      setScore(s, p) { note("setScore", s, p); },
      setProgress(v, p) { note("setProgress", v, p); },
      milestone(n, p) { note("milestone", n, p); },
      complete(p) { note("complete", p); },
      fail(p) { note("fail", p); },
      error(p) { note("error", p); },
      emit(n, p) { note("emit", n, p); },
      haptic(kind) {
        requirePerm("haptics", "ctx.platform.haptic");
        note("haptic", kind);
      },
    },

    listen(target, name, handler, options) {
      target.addEventListener(name, handler, options);
      disposers.push(() => target.removeEventListener(name, handler, options));
    },

    onFrame(cb) {
      frameCbs.push(cb);
      if (frameCbs.length === 1) {
        let last = performance.now();
        const tick = (now) => {
          const dt = now - last; last = now;
          for (const f of frameCbs) {
            try { f(dt, now); }
            catch (e) { note("frame-error", String(e && e.stack || e)); throw e; }
          }
          rafId = requestAnimationFrame(tick);
        };
        let rafId = requestAnimationFrame(tick);
        disposers.push(() => cancelAnimationFrame(rafId));
      }
    },
    raf(cb) { return ctx.onFrame(cb); },

    timeout(fn, ms) {
      const id = setTimeout(() => { timers.delete(id); fn(); }, ms);
      timers.add(id);
      disposers.push(() => clearTimeout(id));
      return id;
    },
    interval(fn, ms) {
      const id = setInterval(fn, ms);
      timers.add(id);
      disposers.push(() => clearInterval(id));
      return id;
    },
    onDestroy(fn) { disposers.push(fn); },

    async loadScript(name, version) {
      const url = window.__BIT_LIBS__ && window.__BIT_LIBS__[`${name}@${version}`];
      if (!url) throw new Error(`loadScript: "${name}@${version}" is not cached for the harness`);
      requireDependency(name, version);
      await import(url);            // cached UMD builds still install their global
      note("loadScript", name, version);
    },
    async importModule(name, version) {
      const url = window.__BIT_LIBS__ && window.__BIT_LIBS__[`${name}@${version}`];
      if (!url) throw new Error(`importModule: "${name}@${version}" is not cached for the harness`);
      requireDependency(name, version);
      note("importModule", name, version);
      return import(url);
    },
    async loadFont(family, id, version, opts) {
      // The registry is unreachable offline, but the faces the bits actually
      // ask for are cached on disk and served by the harness. Injecting them
      // for real is the only way a font change is visible in a screenshot —
      // a stub that returns "loaded" renders the system fallback and hides
      // exactly the bug you are looking for.
      const weight = String((opts && opts.weight) || "400");
      const url = `/libcache/${String(id || family).toLowerCase()}-${weight}.ttf`;
      const key = `${family}/${weight}`;
      if (!loadedFonts.has(key)) {
        loadedFonts.add(key);
        try {
          const face = new FontFace(family, `url(${url})`, { weight });
          await face.load();
          document.fonts.add(face);
        } catch (err) {
          note("loadFont:miss", family, weight, String(err && err.message));
          return { family, status: "fallback" };
        }
      }
      note("loadFont", family, weight);
      return { family, status: "loaded" };
    },
    registry: { async resources() { throw new Error("registry.resources unavailable in harness"); } },
    mediapipe: { async hands() { throw new Error("mediapipe unavailable in harness"); } },
    async fetch(url) {
      if (/^https?:/i.test(url)) throw new Error("ctx.fetch: http/https egress is denied");
      return fetch(url);
    },

    music: (function () {
      const presets = ["ambient","pulse","arcade","drift","sparkle","techno","house","chiptune",
                       "drone","lofi","synthwave","jungle","cozy","spooky","triumph","bubble"];
      const scales = ["major","minor","pentatonic","minorPentatonic","blues","dorian","lydian",
                      "wholeTone","hirajoshi","chromatic"];
      const stings = ["tap","coin","success","fail","danger","powerup","win","lose"];
      let state = "locked", preset = null;
      function handle() {
        return {
          stop() { state = "stopped"; note("music.stop"); },
          pause() { state = "paused"; }, resume() { state = "playing"; },
          async unlock() { state = "ready"; return state; },
          setVolume(v) { note("music.setVolume", v); },
          setPreset(n) { preset = n; note("music.setPreset", n); },
          setTempo(t) { note("music.setTempo", t); },
          setIntensity(v) { note("music.setIntensity", v); },
          setScale(s) { note("music.setScale", s); },
          setPattern(p) { note("music.setPattern", p); },
          duck(a, ms) { note("music.duck", a, ms); },
          async sting(n) { note("music.sting", n); },
          state: () => state, details: () => ({ preset, presets, scales, stings }),
          error: () => null, ready: () => true,
          get playing() { return state === "playing"; },
          get preset() { return preset; },
        };
      }
      const m = handle();
      return Object.assign(m, {
        presets, scales, stings,
        async unlock() { state = "ready"; note("music.unlock"); return state; },
        play(o) {
          requirePerm("backgroundMusic", "ctx.music.play");
          preset = typeof o === "string" ? o : (o && o.preset) || null;
          state = "playing"; note("music.play", o);
          return handle();
        },
        start(o) { return m.play(o); },
      });
    })(),

    audio: {
      play(url, o) { requirePerm("audio", "ctx.audio.play"); note("audio.play", url, o); return stubSound(); },
      loop(url, o) { requirePerm("audio", "ctx.audio.loop"); note("audio.loop", url, o); return stubSound(); },
      stopAll() { note("audio.stopAll"); },
      reactive: {
        async start() { requirePerm("microphone", "ctx.audio.reactive.start"); return {}; },
        stop() {},
      },
    },

    camera: {
      async start() { requirePerm("camera", "ctx.camera.start"); throw new Error("no camera in harness"); },
      stop() {}, pause() {}, resume() {},
      async flip() { return null; },
      snapshot() { return null; },
      zoom() {},
      ready: false, width: 0, height: 0, facing: "user",
    },
    microphone: {
      async start() { requirePerm("microphone", "ctx.microphone.start"); throw new Error("no mic in harness"); },
      stop() {},
    },

    storage: {
      get(k) { requirePerm("storage", "ctx.storage.get"); return k in localStore ? localStore[k] : null; },
      set(k, v) { requirePerm("storage", "ctx.storage.set"); localStore[k] = v; },
      remove(k) { requirePerm("storage", "ctx.storage.remove"); delete localStore[k]; },
      clear() { requirePerm("storage", "ctx.storage.clear"); for (const k in localStore) delete localStore[k]; },
    },

    sensors: {
      async start() { requirePerm("motion", "ctx.sensors.start"); return false; },
      tilt: { x: 0, y: 0 }, acceleration: null, accelerationIncludingGravity: null,
      accelerometer: null, gyroscope: null, magnetometer: null, rotation: null,
      rotationRate: null, orientation: null, snapshot: null,
      onChange() {}, active: false,
    },
    motion: {
      async start() { requirePerm("motion", "ctx.motion.start"); return false; },
      tilt: { x: 0, y: 0 }, accel: { x: 0, y: 0, z: 0 }, active: false,
    },

    memory: {
      local(id) {
        requireChannel("local", id);
        return {
          async get() { return id in memoryStore ? memoryStore[id] : null; },
          async set(v) { memoryStore[id] = v; note("memory.local.set", id); return { ok: true }; },
        };
      },
      record(id) {
        requireChannel("records", id);
        return {
          async submit(value, opts) {
            (recordStore[id] ||= []).push({ value, label: opts && opts.label });
            note("memory.record.submit", id, value, opts);
            return { ok: true, accepted: true };
          },
          async leaderboard() {
            const decl = declaredMemory.records[id];
            const rows = (recordStore[id] || []).slice()
              .sort((a, b) => decl.order === "asc" ? a.value - b.value : b.value - a.value);
            return { entries: rows.map((r, i) => ({ rank: i + 1, value: r.value, label: r.label, name: "you" })) };
          },
        };
      },
      tally(id) {
        requireChannel("tallies", id);
        return {
          async choose(v) {
            const t = (tallyStore[id] ||= {});
            t[v] = (t[v] || 0) + 1; note("memory.tally.choose", id, v);
            return { ok: true };
          },
          async results() {
            const t = tallyStore[id] || {};
            const total = Object.values(t).reduce((a, b) => a + b, 0);
            return { total, options: Object.entries(t).map(([value, count]) => ({ value, count })) };
          },
        };
      },
      world(id) {
        requireChannel("worlds", id);
        return {
          async get() { return worldStore[id] || null; },
          async mutate(m) {
            const decl = declaredMemory.worlds[id];
            const s = (worldStore[id] ||= decl.type === "pixel_grid" ? { pixels: [] } : { items: [] });
            if (decl.type === "pixel_grid") {
              const at = s.pixels.findIndex(p => p.x === m.x && p.y === m.y);
              if (at >= 0) s.pixels[at] = m; else s.pixels.push(m);
            } else if (decl.type === "field") {
              Object.assign(s, m);
            } else {
              s.items.push(m);
            }
            note("memory.world.mutate", id);
            return { ok: true };
          },
        };
      },
    },

    assets: {
      url() { throw new Error("assets disabled (maxAssets: 0)"); },
      image() { throw new Error("assets disabled (maxAssets: 0)"); },
      audio() { throw new Error("assets disabled (maxAssets: 0)"); },
      json() { throw new Error("assets disabled (maxAssets: 0)"); },
      text() { throw new Error("assets disabled (maxAssets: 0)"); },
    },
  };

  function stubSound() {
    let paused = false, vol = 1;
    return {
      stop() {}, pause() { paused = true; }, resume() { paused = false; },
      get paused() { return paused; },
      get volume() { return vol; }, set volume(v) { vol = v; },
    };
  }

  window.__PLETHORA_CTX__ = ctx;
  window.__BIT_LOG__ = log;
  window.__BIT_EVENTS__ = events;
})();
