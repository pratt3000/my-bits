/**
 * A mock of the plethora-bit@2 ctx surface, faithful to
 * /v1/agent/sdk.md, for driving bits headlessly in Chromium.
 *
 * It is deliberately strict: any ctx method a bit calls that the real SDK does
 * not document is *not* here, so calling one throws and the run fails.
 */
(function () {
  const errors = [];
  const events = [];
  window.__bitErrors = errors;
  window.__bitEvents = events;

  window.addEventListener("error", (e) => errors.push("window.error: " + (e.message || e)));
  window.addEventListener("unhandledrejection", (e) =>
    errors.push("unhandledrejection: " + (e.reason && (e.reason.stack || e.reason.message) || e.reason))
  );

  const container = document.getElementById("bit");
  const frameCbs = [];
  const destroyers = [];
  const listeners = [];
  const store = new Map();
  const worlds = new Map();

  function rect() {
    return { w: container.clientWidth, h: container.clientHeight };
  }

  const DPR = 2;

  function note(kind, a, b) {
    events.push({ kind, a, b, t: performance.now() });
  }

  // ---- offline-ish memory simulation ----------------------------------------
  function worldOf(id) {
    if (!worlds.has(id)) worlds.set(id, new Map());
    return worlds.get(id);
  }

  // Seed data injected before the page scripts run, so a world can already have
  // content the first time the bit reads it.
  if (window.__seedData) {
    for (const key of Object.keys(window.__seedData)) {
      const m = worldOf(key);
      for (const e of window.__seedData[key]) m.set(e.id, e.object);
    }
  }

  const ctx = {
    container,
    get width() { return rect().w; },
    get height() { return rect().h; },
    dpr: DPR,
    nativeDpr: window.devicePixelRatio || 1,
    safeArea: window.__safeArea || { top: 47, bottom: 34, left: 0, right: 0 },
    manifest: window.__manifest || {},
    runtime: { version: "plethora-bit@2", schemaVersion: 1 },
    capabilities: Object.assign(
      { audio: true, backgroundMusic: true, camera: false, haptics: true, microphone: false, motion: false, storage: true },
      window.__caps || {}
    ),

    markVisualReady(reason) { note("markVisualReady", reason); },

    createRoot(opts) {
      opts = opts || {};
      const el = document.createElement("div");
      el.style.position = "absolute";
      el.style.inset = "0";
      if (opts.className) el.className = opts.className;
      if (opts.touchAction) el.style.touchAction = opts.touchAction;
      if (opts.style) Object.assign(el.style, opts.style);
      container.appendChild(el);
      destroyers.push(() => el.remove());
      return el;
    },

    createCanvas2D(opts) {
      opts = opts || {};
      const c = document.createElement("canvas");
      const r = rect();
      c.style.position = "absolute";
      c.style.inset = "0";
      c.style.width = "100%";
      c.style.height = "100%";
      c.width = Math.round(r.w * DPR);
      c.height = Math.round(r.h * DPR);
      if (opts.touchAction) c.style.touchAction = opts.touchAction;
      container.appendChild(c);
      const g = c.getContext("2d");
      g.setTransform(DPR, 0, 0, DPR, 0, 0);
      destroyers.push(() => c.remove());
      return c;
    },

    createCanvas(opts) {
      opts = opts || {};
      const c = document.createElement("canvas");
      const r = rect();
      c.style.position = "absolute";
      c.style.inset = "0";
      c.style.width = "100%";
      c.style.height = "100%";
      c.width = Math.round(r.w * DPR);
      c.height = Math.round(r.h * DPR);
      if (opts.touchAction) c.style.touchAction = opts.touchAction;
      container.appendChild(c);
      destroyers.push(() => c.remove());
      return c;
    },

    platform: {
      ready(p) { note("ready", p); window.__ready = true; },
      start(p) { note("start", p); },
      interact(p) { note("interact", p); },
      setScore(s, p) { note("setScore", s, p); },
      setProgress(v, p) { note("setProgress", v, p); },
      milestone(n, p) { note("milestone", n, p); },
      complete(p) { note("complete", p); },
      fail(p) { note("fail", p); },
      error(p) { note("platform.error", p); errors.push("platform.error " + JSON.stringify(p)); },
      emit(n, p) { note("emit", n, p); },
      haptic(k) { note("haptic", k); }
    },

    listen(target, name, handler, options) {
      target.addEventListener(name, handler, options);
      listeners.push(() => target.removeEventListener(name, handler, options));
    },

    onFrame(cb) { frameCbs.push(cb); },
    raf(cb) { frameCbs.push(cb); },

    timeout(fn, ms) {
      const id = setTimeout(fn, ms);
      destroyers.push(() => clearTimeout(id));
      return id;
    },
    interval(fn, ms) {
      const id = setInterval(fn, ms);
      destroyers.push(() => clearInterval(id));
      return id;
    },
    onDestroy(fn) { destroyers.push(fn); },

    async loadScript(name, version) { throw new Error("no script deps in harness: " + name + "@" + version); },
    async importModule(name, version) {
      if (name === "three") return import("/vendor/three.module.js");
      throw new Error("unknown module " + name + "@" + version);
    },
    async loadFont(family, name, version, options) {
      note("loadFont", family, name);
      return { family };
    },
    registry: { async resources() { throw new Error("no resources in harness"); } },
    mediapipe: { async hands() { throw new Error("no mediapipe in harness"); } },
    async fetch(url) { return fetch(url); },

    music: (function () {
      let state = "locked";
      const api = {
        presets: ["ambient", "pulse", "arcade", "drift", "sparkle", "techno", "house", "chiptune", "drone", "lofi", "synthwave", "jungle", "cozy", "spooky", "triumph", "bubble"],
        scales: ["major", "minor", "pentatonic", "minorPentatonic", "blues", "dorian", "lydian", "wholeTone", "hirajoshi", "chromatic"],
        stings: ["tap", "coin", "success", "fail", "danger", "powerup", "win", "lose"],
        async unlock() { if (state === "locked") state = "ready"; return state; },
        stop() { state = "stopped"; },
        pause() { state = "paused"; },
        resume() { state = "playing"; },
        setVolume() {}, setPreset() {}, setTempo() {}, setIntensity() {},
        setScale() {}, setPattern() {}, duck() {},
        async sting(n) { note("sting", n); },
        state() { return state; },
        details() { return { preset: "ambient", presets: [], scales: [], stings: [] }; },
        error() { return null; },
        ready() { return state !== "locked"; },
        get playing() { return state === "playing"; },
        get preset() { return "ambient"; }
      };
      const handle = Object.create(api);
      handle.stop = () => { state = "stopped"; note("music.stop"); };
      api.play = async (o) => { state = "playing"; note("music.play", o); return handle; };
      api.start = api.play;
      return api;
    })(),

    audio: {
      play() { return { stop() {}, pause() {}, resume() {}, paused: false, volume: 1 }; },
      loop() { return { stop() {}, pause() {}, resume() {}, paused: false, volume: 1 }; },
      stopAll() {},
      reactive: { async start() { throw new Error("no mic"); }, stop() {} }
    },

    camera: {
      async start() { throw new Error("camera denied in harness"); },
      stop() {}, pause() {}, resume() {}, async flip() { return null; },
      snapshot() { return null; }, zoom() {},
      ready: false, width: 0, height: 0, facing: "user"
    },
    microphone: { async start() { throw new Error("mic denied in harness"); }, stop() {} },

    // sdk.md documents these as plain calls, not promises ("get(key) -> parsed
    // JSON value or null"), and on a real device set() hands back nothing at
    // all. Mocking them as async let a bit chain .catch() on set() and pass
    // here, then die on the phone. They are synchronous now so that cannot
    // happen again; `await` on a plain value still works either way.
    storage: {
      get(k) { return store.has(k) ? JSON.parse(store.get(k)) : null; },
      set(k, v) { store.set(k, JSON.stringify(v)); },
      remove(k) { store.delete(k); },
      clear() { store.clear(); }
    },

    sensors: {
      async start() { return false; },
      tilt: { x: 0, y: 0 }, acceleration: null, accelerationIncludingGravity: null,
      accelerometer: null, gyroscope: null, magnetometer: null, rotation: null,
      rotationRate: null, orientation: null, snapshot: null,
      onChange() { return () => {}; }, active: false
    },
    motion: { async start() { return false; }, tilt: { x: 0, y: 0 }, accel: null, active: false },

    memory: {
      local(id) {
        return {
          async get() { return store.has("mem:" + id) ? JSON.parse(store.get("mem:" + id)) : null; },
          async set(v) { store.set("mem:" + id, JSON.stringify(v)); return { ok: true }; }
        };
      },
      record(id) {
        return {
          async submit(v, o) { note("record.submit", id, { v, o }); return { ok: true, accepted: true }; },
          async leaderboard() {
            return { entries: [
              { rank: 1, value: 11, label: "11", user: { handle: "asha" } },
              { rank: 2, value: 7, label: "7", user: { handle: "rohan" }, self: true }
            ] };
          }
        };
      },
      tally(id) {
        return {
          async choose(v) { note("tally.choose", id, v); return { ok: true }; },
          async results() { return { options: [], total: 0 }; }
        };
      },
      world(id) {
        return {
          async get() {
            if (window.__worldOffline) throw new Error("world offline (simulated)");
            const m = worldOf(id);
            return { objects: Array.from(m.entries()).map(([k, v]) => ({ id: k, object: v, user: { handle: "someone" } })) };
          },
          async mutate(mut) {
            if (window.__worldOffline) throw new Error("world offline (simulated)");
            const m = worldOf(id);
            if (mut && mut.id && (mut.op === "delete" || mut.delete)) m.delete(mut.id);
            else if (mut && mut.id) m.set(mut.id, mut.object || mut);
            note("world.mutate", id, mut);
            return { ok: true, accepted: true };
          }
        };
      }
    },

    assets: {
      url() { throw new Error("assets disabled"); },
      image() { throw new Error("assets disabled"); },
      audio() { throw new Error("assets disabled"); },
      json() { throw new Error("assets disabled"); },
      text() { throw new Error("assets disabled"); }
    }
  };

  // Runtime-owned frame loop.
  let last = performance.now();
  let frames = 0;
  function tick(now) {
    const dt = now - last;
    last = now;
    frames++;
    window.__frames = frames;
    for (const cb of frameCbs) {
      try { cb(dt, now); }
      catch (e) { errors.push("onFrame: " + (e.stack || e.message || e)); }
    }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  window.__ctx = ctx;
  window.__seedWorld = (id, entries) => {
    const m = worldOf(id);
    for (const e of entries) m.set(e.id, e.object);
  };
  window.__boot = async function () {
    if (!window.plethoraBit || typeof window.plethoraBit.init !== "function") {
      errors.push("bit did not define window.plethoraBit.init");
      return;
    }
    try { await window.plethoraBit.init(ctx); }
    catch (e) { errors.push("init threw: " + (e.stack || e.message || e)); }
  };
})();
