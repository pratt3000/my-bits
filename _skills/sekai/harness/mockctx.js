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
  const managedCanvases = [];
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

  // ---- full screen, safe areas and the logo button ---------------------------
  // SDK 1.7.0: a bit whose manifest declares display "fullscreen" gets the whole
  // phone. ctx.safeArea is then the phone's own insets, ctx.contentSafeArea the
  // same moved in past Plethora's logo button at the bottom (and the web
  // player's back arrow at the top), and ctx.logoArea the button's rect. Without
  // the declaration, or on an app from before full-screen support, the bit
  // plays in the legacy safe frame: safeArea is a fixed { 0, 0, 120, 0 } and
  // contentSafeArea and logoArea are undefined — which is why a bit reads
  // `ctx.contentSafeArea ?? ctx.safeArea`. All three are frozen; the host
  // replaces them when the insets change and fires onResize. A scenario picks
  // the mode with `display` ("fullscreen" | "safe-frame"; default: whatever the
  // manifest declares) and overrides the numbers with `insets`. The defaults
  // are an iPhone 17 Pro, straight from sdk.md.
  const manifest = window.__manifest || {};
  const fullscreen = window.__display ? window.__display === "fullscreen" : manifest.display === "fullscreen";
  const freeze = (o) => (o == null ? undefined : Object.freeze(Object.assign({}, o)));
  let insets = null;
  function defaultInsets() {
    const r = rect();
    if (!fullscreen) return { safeArea: { top: 0, right: 0, bottom: 120, left: 0 } };
    return {
      safeArea: { top: 62, right: 0, bottom: 34, left: 0 },
      contentSafeArea: { top: 62, right: 0, bottom: 108.5, left: 0 },
      logoArea: { x: r.w / 2 - 32, y: r.h - 100, width: 64, height: 64 }
    };
  }
  function setInsets(next) {
    const d = defaultInsets();
    const n = next || window.__insets || d;
    insets = {
      safeArea: freeze(n.safeArea || d.safeArea),
      contentSafeArea: fullscreen ? freeze(n.contentSafeArea || d.contentSafeArea) : undefined,
      logoArea: fullscreen ? freeze(n.logoArea || d.logoArea) : undefined
    };
    // A full-screen document carries the insets as CSS variables on :root; a
    // safe-frame one gets none, so a bit's CSS needs fallbacks either way.
    const root = document.documentElement.style;
    for (const side of ["top", "right", "bottom", "left"]) {
      if (fullscreen) {
        root.setProperty("--plethora-safe-" + side, insets.safeArea[side] + "px");
        root.setProperty("--plethora-content-safe-" + side, insets.contentSafeArea[side] + "px");
      } else {
        root.removeProperty("--plethora-safe-" + side);
        root.removeProperty("--plethora-content-safe-" + side);
      }
    }
  }
  setInsets();

  // ctx.onResize(cb, { immediate?, debounceMs? }) -> cleanup. Fires on a
  // resize and, in a full-screen bit, on an inset change. In the safe frame
  // the payload's safeArea is all zeros (sdk.md), so a bit that reads the
  // payload instead of ctx gets a zero bottom inset there — a trap worth
  // reproducing.
  const resizeCbs = [];
  function resizePayload() {
    const r = rect();
    const p = {
      width: r.w, height: r.h, dpr: DPR, nativeDpr: window.devicePixelRatio || 1,
      safeArea: fullscreen ? insets.safeArea : Object.freeze({ top: 0, right: 0, bottom: 0, left: 0 })
    };
    if (fullscreen) { p.contentSafeArea = insets.contentSafeArea; p.logoArea = insets.logoArea; }
    return p;
  }
  function fireResize(entry) {
    const run = () => {
      try { entry.cb(resizePayload()); }
      catch (e) { errors.push("onResize: " + (e.stack || e.message || e)); }
    };
    if (entry.debounce > 0) { clearTimeout(entry.timer); entry.timer = setTimeout(run, entry.debounce); }
    else run();
  }
  function fireAllResize(why) {
    note("resize", why, rect());
    if (why === "viewport") for (const s of managedCanvases) s();
    for (const e of resizeCbs.slice()) fireResize(e);
  }
  let firstObservation = true;
  new ResizeObserver(() => {
    if (firstObservation) { firstObservation = false; return; }
    fireAllResize("viewport");
  }).observe(container);

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
    // Getter-only, like the host's frozen live values: assigning does nothing
    // (and throws in strict-mode code).
    get safeArea() { return insets.safeArea; },
    get contentSafeArea() { return insets.contentSafeArea; },
    get logoArea() { return insets.logoArea; },
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
      if (typeof opts.style === "string") el.style.cssText += ";" + opts.style;
      else if (opts.style) Object.assign(el.style, opts.style);
      if (opts.input === "passthrough" || opts.pointerEvents === "none") el.style.pointerEvents = "none";
      container.appendChild(el);
      destroyers.push(() => el.remove());
      return el;
    },

    createCanvas2D(opts) {
      opts = opts || {};
      const c = document.createElement("canvas");
      const dpr = opts.maxDpr ? Math.min(DPR, opts.maxDpr) : DPR;
      const css = opts.coordinateSpace === "css" || opts.scaleToCssPixels === true;
      c.style.position = "absolute";
      c.style.inset = "0";
      c.style.width = "100%";
      c.style.height = "100%";
      if (opts.touchAction) c.style.touchAction = opts.touchAction;
      if (opts.input === "passthrough") c.style.pointerEvents = "none";
      container.appendChild(c);
      const g = c.getContext("2d", { alpha: opts.alpha !== false });
      const size = () => {
        const r = rect();
        c.width = Math.round(r.w * dpr);
        c.height = Math.round(r.h * dpr);
        if (css) g.setTransform(dpr, 0, 0, dpr, 0, 0);
      };
      size();
      managedCanvases.push(size);
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

    // ctx.input.activate(target, handler): click plus Enter/Space. The gesture
    // tracker is not mocked; a bit that needs it fails here, loudly.
    input: {
      activate(target, handler) {
        const onClick = (e) => handler(e);
        const onKey = (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); handler(e); } };
        target.addEventListener("click", onClick);
        target.addEventListener("keydown", onKey);
        const off = () => { target.removeEventListener("click", onClick); target.removeEventListener("keydown", onKey); };
        listeners.push(off);
        return off;
      },
      track() { throw new Error("ctx.input.track is not mocked in the harness"); },
      on() { throw new Error("ctx.input.on is not mocked in the harness"); },
      delegate() { throw new Error("ctx.input.delegate is not mocked in the harness"); }
    },

    // ctx.game: score tracks and the loop, per sdk.md. Leaderboard reads
    // return the documented shape (rows + nullable viewerRank), not an
    // invented one.
    game: (function () {
      const tracks = new Map();
      let primary = null;
      function declaredRecord(channel) {
        const recs = (window.__manifest && window.__manifest.memory && window.__manifest.memory.records) || {};
        if (!recs[channel]) throw new Error("record channel not declared in manifest.memory.records: " + channel);
        return recs[channel];
      }
      function fakeBoard(channel, o) {
        o = o || {};
        const value = (tracks.get("score") || {}).value || 0;
        const rows = [
          { rank: 1, userId: "u-asha", username: "asha", value: Math.max(value + 1200, 4200), displayLabel: String(Math.max(value + 1200, 4200)), achievedAt: "2026-10-20T10:00:00Z" },
          { rank: 2, userId: "u-me", username: "you", value: value, displayLabel: String(value), achievedAt: "2026-10-27T10:00:00Z", isViewer: true },
          { rank: 3, userId: "u-rohan", username: "rohan", value: Math.max(0, value - 300), displayLabel: String(Math.max(0, value - 300)), achievedAt: "2026-10-19T10:00:00Z" }
        ].slice(0, o.limit || 25);
        return {
          channel: channel, scope: o.scope || "global", period: o.period || "all_time", dimensions: o.dimensions || {},
          rows: rows, viewerRank: { rank: 2, userId: "u-me", username: "you", value: value, displayLabel: String(value) },
          standing: null, rankStatus: "ready", rankComputedAt: new Date().toISOString(), totalRanked: 128,
          boardKey: channel + ":global:all_time", boardVersion: 1, checkpointStatus: { pending: 0, failed: 0, lastFailure: null }
        };
      }
      return {
        score(idOrOptions, options) {
          let id = "score", o = idOrOptions || {};
          if (typeof idOrOptions === "string") { id = idOrOptions; o = options || {}; }
          if (tracks.has(id)) return tracks.get(id);
          const isPrimary = id === "score" ? o.primary !== false : !!o.primary;
          if (isPrimary && primary) throw new Error("only one primary score track");
          const min = typeof o.min === "number" ? o.min : -Infinity, max = typeof o.max === "number" ? o.max : Infinity;
          const subs = [];
          const t = {
            id: id, value: o.initial || 0, previous: o.initial || 0, delta: 0, lowest: o.initial || 0, highest: o.initial || 0, initial: o.initial || 0, primary: isPrimary,
            set(v, meta) {
              if (typeof v !== "number" || !isFinite(v)) throw new Error("score must be finite");
              t.previous = t.value; t.value = Math.min(max, Math.max(min, v)); t.delta = t.value - t.previous;
              t.lowest = Math.min(t.lowest, t.value); t.highest = Math.max(t.highest, t.value);
              for (const s of subs) s({ id: id, value: t.value, previous: t.previous, delta: t.delta, lowest: t.lowest, highest: t.highest, reason: meta && meta.reason, source: "set" });
              return t;
            },
            add(a, meta) { return t.set(t.value + a, meta); },
            reset(meta) { return t.set(t.initial, meta); },
            flush() { note("score.flush", id, t.value); return t; },
            onChange(fn) { subs.push(fn); return () => { const i = subs.indexOf(fn); if (i >= 0) subs.splice(i, 1); }; },
            async submit(channel, so) {
              declaredRecord(channel);
              note("record.submit", channel, { v: t.value, o: so });
              return { submitted: true, eventId: "evt-" + Math.random().toString(36).slice(2), value: t.value, displayLabel: (so && so.label) || String(t.value), updatedPeriods: ["daily", "weekly", "all_time"], isPersonalBest: true, improvedBest: true, standing: null, pulseCapture: null, challenges: [] };
            },
            async checkpoint(channel, so) { declaredRecord(channel); note("record.checkpoint", channel, { v: t.value, o: so }); return { queued: true, checkpointId: "ck-1", submitted: false }; },
            async rank(channel, ro) { declaredRecord(channel); const b = fakeBoard(channel, ro); delete b.rows; return b; },
            async leaderboard(channel, lo) { declaredRecord(channel); note("leaderboard", channel, lo); return fakeBoard(channel, lo); },
            async checkpointStatus() { return { pending: 0, failed: 0, lastFailure: null }; }
          };
          tracks.set(id, t);
          if (isPrimary) primary = t;
          return t;
        },
        loop(o) {
          o = o || {};
          const maxDelta = o.maxDeltaMs || 80;
          const st = o.state || {};
          let running = o.autoStart !== false, paused = false, destroyed = false, elapsed = 0, frames = 0;
          const h = {
            get frame() { return frames; }, get elapsedMs() { return elapsed; }, get isRunning() { return running && !destroyed; }, get isPaused() { return paused; },
            timeScale: o.timeScale || 1,
            stats: { fps: 0, frameMs: 0, updateMs: 0, renderMs: 0, droppedFrames: 0, clampedDeltas: 0, substeps: 0 },
            pause() { paused = true; if (o.onPause) o.onPause(st); }, resume() { paused = false; if (o.onResume) o.onResume(st); },
            start() { running = true; }, stop() { running = false; if (o.onStop) o.onStop(st); },
            destroy() { destroyed = true; running = false; if (o.onDestroy) o.onDestroy(st); },
            step(ms) { tick(ms == null ? 1000 / 60 : ms); }, resetClock() {}, setFps() {}, setTimeScale(v) { h.timeScale = v; }
          };
          function tick(dt) {
            if (destroyed || !running || paused) return;
            if (dt > maxDelta) { dt = maxDelta; h.stats.clampedDeltas++; }
            dt *= h.timeScale;
            elapsed += dt; frames++;
            try {
              if (o.update) o.update(dt, st);
              if (o.fixedUpdate) o.fixedUpdate(dt, st);
              if (o.render) o.render(0, st);
            } catch (e) {
              if (o.onError) o.onError(e, "update"); else errors.push("game.loop: " + (e.stack || e.message || e));
            }
          }
          frameCbs.push((dt) => tick(dt));
          destroyers.push(() => h.destroy());
          if (o.onStart) o.onStart(st);
          return h;
        },
        clamp(v, a, b) { return Math.min(b, Math.max(a, v)); },
        lerp(a, b, t) { return a + (b - a) * t; },
        approach(v, t, a) { return v < t ? Math.min(t, v + a) : Math.max(t, v - a); },
        wrap(v, a, b) { const r = b - a; return a + ((((v - a) % r) + r) % r); }
      };
    })(),

    // ctx.tune: manifest.tuning defaults, overridable from a scenario through
    // window.__tune = { id: value }; window.__setTune(id, value) fires onChange.
    tune: (function () {
      const decl = (window.__manifest && window.__manifest.tuning) || {};
      const knobs = decl.knobs || {}, curves = decl.curves || {};
      const over = Object.assign({}, window.__tune || {});
      const subs = [];
      const val = (id) => (id in over ? over[id] : knobs[id] ? knobs[id].default : undefined);
      const typed = (id, type) => { const k = knobs[id]; if (!k || k.type !== type) return undefined; return val(id); };
      function curve(id) {
        const c = curves[id];
        if (!c) return { id: id, domain: "custom", range: [0, 1], points: [], easing: "linear", at() { return 0; }, toJSON() { return null; } };
        const pts = (id in over ? over[id] : c.default).slice().sort((a, b) => a.x - b.x);
        const sm = c.easing === "smooth" || c.easing === "ease_in_out";
        return {
          id: id, domain: c.domain, range: c.range, points: pts, easing: c.easing || "linear",
          at(x) {
            if (!pts.length) return 0;
            if (x <= pts[0].x) return pts[0].y;
            for (let i = 1; i < pts.length; i++) {
              if (x <= pts[i].x) {
                let t = (x - pts[i - 1].x) / Math.max(1e-9, pts[i].x - pts[i - 1].x);
                if (sm) t = t * t * (3 - 2 * t);
                if (c.easing === "step") t = 0;
                return pts[i - 1].y + (pts[i].y - pts[i - 1].y) * t;
              }
            }
            return pts[pts.length - 1].y;
          },
          toJSON() { return { id: id, points: pts }; }
        };
      }
      window.__setTune = (id, value) => { over[id] = value; for (const s of subs) if (s.ids.indexOf(id) >= 0) s.fn(value, { id: id, revision: 1 }); };
      return {
        get: val,
        number: (id) => typed(id, "number"), integer: (id) => typed(id, "integer"), boolean: (id) => typed(id, "boolean"),
        choice: (id) => typed(id, "choice"), multiChoice: (id) => typed(id, "multi_choice"), color: (id) => typed(id, "color"),
        range: (id) => typed(id, "range"), point2: (id) => typed(id, "point2"), vec2: (id) => typed(id, "vec2"), seed: (id) => typed(id, "seed"),
        durationMs: (id) => typed(id, "duration_ms"), percent: (id) => typed(id, "percent"),
        curve: curve,
        onChange(ids, fn) { const e = { ids: Array.isArray(ids) ? ids : [ids], fn: fn }; subs.push(e); return () => { const i = subs.indexOf(e); if (i >= 0) subs.splice(i, 1); }; },
        has: (id) => !!(knobs[id] || curves[id]),
        snapshot() { const o = {}; for (const k of Object.keys(knobs)) o[k] = val(k); return o; },
        meta: (id) => knobs[id] || curves[id] || undefined,
        applyPreset() { return []; }, reset() { return []; }
      };
    })(),

    pulse: { complete(o) { note("pulse.complete", o); } },
    share(o) { note("share", o); },
    viewer: { username: "you" },

    onFrame(cb) { frameCbs.push(cb); },
    raf(cb) { frameCbs.push(cb); },
    onResize(cb, opts) {
      if (typeof cb !== "function") throw new Error("onResize needs a callback");
      opts = opts || {};
      const entry = { cb, timer: null, debounce: opts.debounceMs | 0 };
      resizeCbs.push(entry);
      if (opts.immediate) fireResize(entry);
      return () => { const i = resizeCbs.indexOf(entry); if (i >= 0) resizeCbs.splice(i, 1); };
    },

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
    motion: (function () {
      const zero3 = () => ({ x: 0, y: 0, z: 0 });
      let active = false;
      const m = {
        get available() { return !!ctx.capabilities.motion; },
        get active() { return active; },
        get permission() { return ctx.capabilities.motion ? (active ? "granted" : "prompt") : "unavailable"; },
        error: null,
        get snapshot() { return { atMs: performance.now(), source: active ? "browser" : "none", orientation: zero3(), tilt: zero3(), control: { x: 0, y: 0 }, acceleration: zero3(), accelerationIncludingGravity: zero3(), gravity: zero3(), rotationRate: { alpha: 0, beta: 0, gamma: 0 }, gyroscope: zero3(), magnetometer: zero3(), quaternion: { x: 0, y: 0, z: 0, w: 1 }, calibrated: false, permission: m.permission }; },
        tilt: zero3(), control: { x: 0, y: 0 }, accel: zero3(),
        async start() {
          if (!ctx.capabilities.motion) { const e = new Error("motion permission not declared or denied"); e.name = "NotAllowedError"; throw e; }
          active = true; note("motion.start"); return true;
        },
        stop() { active = false; }, pause() {}, resume() {},
        calibrate() { return m.snapshot; }, resetCalibration() { return m.snapshot; },
        setSmoothing() {}, setDeadzone() {}, setAxisMapping() {},
        tiltControl() {
          return { get x() { return (window.__tilt && window.__tilt.x) || 0; }, get y() { return (window.__tilt && window.__tilt.y) || 0; }, angle: 0, strength: 0, raw: { x: 0, y: 0 }, destroy() {} };
        },
        shake() { return { active: false, strength: 0, count: 0, vector: zero3(), destroy() {} }; },
        impulse() { return { active: false, strength: 0, vector: zero3(), ageMs: 0, destroy() {} }; },
        on() { return () => {}; }, onChange() { return () => {}; }
      };
      return m;
    })(),

    memory: {
      local(id) {
        return {
          async get() { return store.has("mem:" + id) ? JSON.parse(store.get("mem:" + id)) : null; },
          async set(v) { store.set("mem:" + id, JSON.stringify(v)); return { ok: true }; }
        };
      },
      record(id) {
        const recs = (window.__manifest && window.__manifest.memory && window.__manifest.memory.records) || {};
        if (window.__manifest && !recs[id]) throw new Error("record channel not declared in manifest.memory.records: " + id);
        const board = (o) => {
          o = o || {};
          return {
            channel: id, scope: o.scope || "global", period: o.period || "all_time", dimensions: o.dimensions || {},
            rows: [
              { rank: 1, userId: "u-asha", username: "asha", value: 11, displayLabel: "11", achievedAt: "2026-10-20T10:00:00Z" },
              { rank: 2, userId: "u-me", username: "you", value: 7, displayLabel: "7", achievedAt: "2026-10-27T10:00:00Z", isViewer: true }
            ].slice(0, o.limit || 25),
            viewerRank: { rank: 2, userId: "u-me", username: "you", value: 7, displayLabel: "7" },
            standing: null, rankStatus: "ready", rankComputedAt: new Date().toISOString(), totalRanked: 40,
            boardKey: id + ":global:all_time", boardVersion: 1, checkpointStatus: { pending: 0, failed: 0, lastFailure: null }
          };
        };
        return {
          async submit(v, o) { note("record.submit", id, { v, o }); return { submitted: true, eventId: "evt-1", value: v, displayLabel: (o && o.label) || String(v), updatedPeriods: ["daily", "weekly", "all_time"], isPersonalBest: true, improvedBest: true, standing: null }; },
          async checkpoint(v, o) { note("record.checkpoint", id, { v, o }); return { queued: true, checkpointId: "ck-1", submitted: false }; },
          async leaderboard(o) { note("leaderboard", id, o); return board(o); },
          async rank(o) { const b = board(o); delete b.rows; return b; },
          async checkpointStatus() { return { pending: 0, failed: 0, lastFailure: null }; }
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
  // What the host does when the insets change: new frozen values, then
  // onResize. Takes { safeArea?, contentSafeArea?, logoArea? }.
  window.__setInsets = (next) => { setInsets(next); fireAllResize("insets"); };
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
