/**
 * Ripcord -- spin the phone, launch a top, win the arena.
 *
 * The launch power is read from the phone's gyroscope: peak angular speed
 * during the rip window becomes the top's RPM, strictly proportionally.
 */
window.plethoraBit = {
  meta: {
    title: "Ripcord",
    runtime: "plethora-bit@2",
    tags: ["game", "arcade", "motion", "physics", "battle", "spinner", "action"],
    permissions: ["motion", "audio", "backgroundMusic", "haptics", "storage"]
  },

  async init(ctx) {
    /* ============================================================ *
     * 0. Constants
     * ============================================================ */

    const TAU = Math.PI * 2;
    const SQUASH = 0.66;          // pseudo-3D vertical compression
    const RING_OUT_R = 1.235;     // world radius past which a top is out
    const BOWL_K = 2.45;          // restoring accel toward centre, per unit r
    const WALL_R = 0.95;          // where the stadium lip starts to bite
    const WALL_K = 9;             // lip steepness -- a ring-out has to be earned
    const DRAG = 0.315;
    const ORBIT_K = 1.7;          // how hard a top is held to its orbit speed

    // Phone spin (deg/s) -> top RPM. Proportional, with a floor and ceiling.
    const RIP_FLOOR = 190;        // below this the rip does not register
    const RIP_CEIL = 2000;        // consumer gyros saturate around here
    const GEAR = 9.2;             // top RPM per phone deg/s
    const MIN_RPM = 3200;
    const MAX_RPM = 14000;
    const TRIGGER_DEG = 215;      // peak needed before release-detect arms

    const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
    const lerp = (a, b, t) => a + (b - a) * t;
    const rand = (a, b) => a + Math.random() * (b - a);
    const easeOut = t => 1 - Math.pow(1 - t, 3);

    /* ============================================================ *
     * 1. Surfaces
     * ============================================================ */

    const canvas = ctx.createCanvas2D({ touchAction: "none" });
    const g = canvas.getContext("2d");

    // Offscreen baking. Minting a canvas element off the document is rejected
    // by the upload validator; OffscreenCanvas is the supported path. If a
    // WebView lacks it every bake site falls back to drawing live -- plainer,
    // but never blank.
    function makeSurface(w, h) {
      if (typeof OffscreenCanvas === "undefined") return null;
      try {
        return new OffscreenCanvas(Math.max(1, Math.ceil(w)), Math.max(1, Math.ceil(h)));
      } catch (err) {
        return null;
      }
    }

    let W = ctx.width;
    let H = ctx.height;
    let cx = W / 2;
    let cy = H / 2;
    let S = 1;                    // world unit -> screen px
    const safeTop = () => (ctx.safeArea && ctx.safeArea.top) || 0;
    const safeBottom = () => (ctx.safeArea && ctx.safeArea.bottom) || 0;

    /* ============================================================ *
     * 2. Audio -- everything synthesized, no packaged assets
     * ============================================================ */

    const audio = {
      ac: null,
      master: null,
      noise: null,
      ok: false,
      failed: false
    };

    function audioInit() {
      if (audio.ok || audio.failed) return audio.ok;
      if (!ctx.capabilities || !ctx.capabilities.audio) {
        audio.failed = true;
        return false;
      }
      try {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) throw new Error("no AudioContext");
        audio.ac = new AC();
        audio.master = audio.ac.createGain();
        audio.master.gain.value = 0.9;
        audio.master.connect(audio.ac.destination);

        // One second of white noise, reused by every noise voice.
        const len = Math.floor(audio.ac.sampleRate);
        const buf = audio.ac.createBuffer(1, len, audio.ac.sampleRate);
        const data = buf.getChannelData(0);
        for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
        audio.noise = buf;

        audio.ok = true;
        ctx.onDestroy(() => {
          try { audio.ac.close(); } catch (err) { /* already closed */ }
        });
      } catch (err) {
        audio.failed = true;
      }
      return audio.ok;
    }

    function audioResume() {
      if (!audio.ok || audio.ac.state !== "suspended") return;
      try {
        const r = audio.ac.resume();
        if (r && typeof r.catch === "function") r.catch(() => {});
      } catch (err) { /* older WebAudio returns nothing */ }
    }

    function noiseSource() {
      const src = audio.ac.createBufferSource();
      src.buffer = audio.noise;
      src.loop = true;
      src.playbackRate.value = rand(0.85, 1.2);
      return src;
    }

    /** Metallic strike: inharmonic partials + a bright transient. */
    function sfxClash(force) {
      if (!audioInit()) return;
      const ac = audio.ac;
      const t = ac.currentTime;
      const amp = clamp(force, 0.12, 1) * 0.5;
      const base = lerp(300, 520, clamp(force, 0, 1)) * rand(0.92, 1.09);

      // Bell-like inharmonic series -- what makes metal read as metal.
      const ratios = [1, 2.41, 3.86, 5.12, 7.31, 9.04];
      for (let i = 0; i < ratios.length; i++) {
        const osc = ac.createOscillator();
        const gn = ac.createGain();
        osc.type = "sine";
        osc.frequency.value = base * ratios[i] * rand(0.995, 1.005);
        const dur = lerp(0.34, 0.08, i / ratios.length);
        const peak = amp * Math.pow(0.62, i);
        gn.gain.setValueAtTime(0.0001, t);
        gn.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + 0.004);
        gn.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        osc.connect(gn).connect(audio.master);
        osc.start(t);
        osc.stop(t + dur + 0.02);
      }

      // Contact transient.
      const src = noiseSource();
      const hp = ac.createBiquadFilter();
      hp.type = "highpass";
      hp.frequency.value = 2600;
      const ng = ac.createGain();
      ng.gain.setValueAtTime(amp * 0.9, t);
      ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.045);
      src.connect(hp).connect(ng).connect(audio.master);
      src.start(t);
      src.stop(t + 0.08);
    }

    /** Electric crackle for the lightning arcs. */
    function sfxSpark(force) {
      if (!audioInit()) return;
      const ac = audio.ac;
      const t = ac.currentTime;
      const amp = clamp(force, 0.1, 1) * 0.3;
      const src = noiseSource();
      const bp = ac.createBiquadFilter();
      bp.type = "bandpass";
      bp.frequency.setValueAtTime(rand(4200, 6800), t);
      bp.frequency.exponentialRampToValueAtTime(rand(1400, 2400), t + 0.09);
      bp.Q.value = 1.6;
      const gn = ac.createGain();
      gn.gain.setValueAtTime(amp, t);
      gn.gain.exponentialRampToValueAtTime(0.0001, t + 0.11);
      src.connect(bp).connect(gn).connect(audio.master);
      src.start(t);
      src.stop(t + 0.14);
    }

    /** Launch rip -- rising noise sweep plus a pitched whip. */
    function sfxRip(power) {
      if (!audioInit()) return;
      const ac = audio.ac;
      const t = ac.currentTime;
      const p = clamp(power, 0, 1);

      const src = noiseSource();
      const bp = ac.createBiquadFilter();
      bp.type = "bandpass";
      bp.Q.value = 3.2;
      bp.frequency.setValueAtTime(320, t);
      bp.frequency.exponentialRampToValueAtTime(lerp(2200, 5200, p), t + 0.32);
      const gn = ac.createGain();
      gn.gain.setValueAtTime(0.0001, t);
      gn.gain.exponentialRampToValueAtTime(0.34, t + 0.06);
      gn.gain.exponentialRampToValueAtTime(0.0001, t + 0.42);
      src.connect(bp).connect(gn).connect(audio.master);
      src.start(t);
      src.stop(t + 0.46);

      const osc = ac.createOscillator();
      const og = ac.createGain();
      osc.type = "sawtooth";
      osc.frequency.setValueAtTime(90, t);
      osc.frequency.exponentialRampToValueAtTime(lerp(360, 780, p), t + 0.3);
      og.gain.setValueAtTime(0.0001, t);
      og.gain.exponentialRampToValueAtTime(0.13, t + 0.07);
      og.gain.exponentialRampToValueAtTime(0.0001, t + 0.36);
      osc.connect(og).connect(audio.master);
      osc.start(t);
      osc.stop(t + 0.4);
    }

    /** A top leaves the stadium -- descending whoosh. */
    function sfxRingOut() {
      if (!audioInit()) return;
      const ac = audio.ac;
      const t = ac.currentTime;
      const src = noiseSource();
      const bp = ac.createBiquadFilter();
      bp.type = "bandpass";
      bp.Q.value = 2.4;
      bp.frequency.setValueAtTime(2600, t);
      bp.frequency.exponentialRampToValueAtTime(180, t + 0.5);
      const gn = ac.createGain();
      gn.gain.setValueAtTime(0.3, t);
      gn.gain.exponentialRampToValueAtTime(0.0001, t + 0.55);
      src.connect(bp).connect(gn).connect(audio.master);
      src.start(t);
      src.stop(t + 0.6);
    }

    /** A top runs out of spin and topples. */
    function sfxDeath() {
      if (!audioInit()) return;
      const ac = audio.ac;
      const t = ac.currentTime;
      // Rattle: fast repeated taps slowing down, like a top settling.
      for (let i = 0; i < 11; i++) {
        const at = t + Math.pow(i / 11, 1.7) * 1.05;
        const osc = ac.createOscillator();
        const gn = ac.createGain();
        osc.type = "triangle";
        osc.frequency.value = rand(140, 240);
        gn.gain.setValueAtTime(0.0001, at);
        gn.gain.exponentialRampToValueAtTime(0.11 * (1 - i / 13), at + 0.003);
        gn.gain.exponentialRampToValueAtTime(0.0001, at + 0.07);
        osc.connect(gn).connect(audio.master);
        osc.start(at);
        osc.stop(at + 0.09);
      }
    }

    /** Continuous spin whirr, one voice per live top. */
    function makeWhirr(bladeCount) {
      if (!audioInit()) return null;
      const ac = audio.ac;
      let osc, sub, gain, bp, src, ng;
      try {
        gain = ac.createGain();
        gain.gain.value = 0;
        gain.connect(audio.master);

        osc = ac.createOscillator();
        osc.type = "sawtooth";
        const shape = ac.createBiquadFilter();
        shape.type = "lowpass";
        shape.frequency.value = 2600;
        osc.connect(shape).connect(gain);
        osc.start();

        sub = ac.createOscillator();
        sub.type = "sine";
        const subG = ac.createGain();
        subG.gain.value = 0.6;
        sub.connect(subG).connect(gain);
        sub.start();

        src = noiseSource();
        bp = ac.createBiquadFilter();
        bp.type = "bandpass";
        bp.Q.value = 4.5;
        ng = ac.createGain();
        ng.gain.value = 0.5;
        src.connect(bp).connect(ng).connect(gain);
        src.start();
      } catch (err) {
        return null;
      }

      return {
        /** rpm drives pitch at the blade-pass frequency; level drives volume. */
        set(rpm, level) {
          if (!audio.ok) return;
          const t = audio.ac.currentTime;
          const f = clamp((rpm / 60) * bladeCount, 30, 3800);
          try {
            osc.frequency.setTargetAtTime(f, t, 0.05);
            sub.frequency.setTargetAtTime(clamp(f * 0.5, 22, 1200), t, 0.05);
            bp.frequency.setTargetAtTime(clamp(f * 2.2, 60, 7000), t, 0.06);
            gain.gain.setTargetAtTime(clamp(level, 0, 1) * 0.045, t, 0.08);
          } catch (err) { /* context closing */ }
        },
        stop() {
          if (!audio.ok) return;
          const t = audio.ac.currentTime;
          try {
            gain.gain.setTargetAtTime(0, t, 0.09);
            osc.stop(t + 0.7);
            sub.stop(t + 0.7);
            src.stop(t + 0.7);
          } catch (err) { /* already stopped */ }
        }
      };
    }

    /* ============================================================ *
     * 3. Spin meter -- the gyroscope read
     * ============================================================ */

    const spin = {
      now: 0,            // current angular speed, deg/s
      peak: 0,           // peak within the active rip window
      smooth: 0,         // display-smoothed value
      source: "none",    // "gyro" | "tilt" | "swipe"
      live: false,       // receiving usable samples
      window: false,     // rip window open
      airborne: false,
      airMs: 0,
      bestAirMs: 0,
      gotAir: false,
      denied: false,
      lastTilt: null,
      quietMs: 0,
      armed: false
    };

    // Wrap-safe difference between two Euler angles, in degrees.
    function angDiff(a, b) {
      let d = (a - b) % 360;
      if (d > 180) d -= 360;
      if (d < -180) d += 360;
      return d;
    }

    function feedSpin(degPerSec, source) {
      if (!isFinite(degPerSec)) return;
      spin.now = degPerSec;
      spin.source = source;
      spin.live = true;
      if (spin.window && degPerSec > spin.peak) {
        spin.peak = degPerSec;
        if (spin.airborne) spin.gotAir = true;
      }
      if (spin.window && spin.peak > TRIGGER_DEG) spin.armed = true;
    }

    function onDeviceMotion(e) {
      // rotationRate IS the gyroscope: true angular velocity in deg/s, and
      // unlike orientation it stays valid in freefall, which is the whole
      // point when the phone is airborne.
      const rr = e.rotationRate;
      if (rr && (rr.alpha != null || rr.beta != null || rr.gamma != null)) {
        const a = rr.alpha || 0;
        const b = rr.beta || 0;
        const c = rr.gamma || 0;
        feedSpin(Math.sqrt(a * a + b * b + c * c), "gyro");
      }

      // Freefall: an accelerometer in free flight reads ~0g.
      const ag = e.accelerationIncludingGravity;
      if (ag) {
        const m = Math.sqrt(
          (ag.x || 0) * (ag.x || 0) +
          (ag.y || 0) * (ag.y || 0) +
          (ag.z || 0) * (ag.z || 0)
        );
        if (m < 3.2) {
          if (!spin.airborne) { spin.airborne = true; spin.airMs = 0; }
        } else if (m > 6.5 && spin.airborne) {
          spin.airborne = false;
          if (spin.airMs > spin.bestAirMs) spin.bestAirMs = spin.airMs;
        }
      }
    }

    let motionAttached = false;
    async function motionStart() {
      if (!ctx.capabilities || !ctx.capabilities.motion) {
        spin.denied = true;
        return false;
      }
      try {
        const ok = await ctx.motion.start();
        if (!ok) { spin.denied = true; return false; }
      } catch (err) {
        spin.denied = true;
        return false;
      }
      if (!motionAttached) {
        motionAttached = true;
        ctx.listen(window, "devicemotion", onDeviceMotion);
      }
      return true;
    }

    // Fallback path: differentiate ctx.motion.tilt. Coarser than the gyro and
    // meaningless in freefall (orientation is gravity-referenced), but it
    // works for an in-hand flick when rotationRate is absent.
    function tiltSample(dt) {
      if (spin.source === "gyro") return;
      const t = ctx.motion && ctx.motion.tilt;
      if (!t || !ctx.motion.active) return;
      if (spin.lastTilt && dt > 0.004) {
        const dx = angDiff(t.x || 0, spin.lastTilt.x);
        const dy = angDiff(t.y || 0, spin.lastTilt.y);
        const dz = angDiff(t.z || 0, spin.lastTilt.z);
        const mag = Math.sqrt(dx * dx + dy * dy + dz * dz) / dt;
        if (mag < 8000) feedSpin(mag, "tilt");
      }
      spin.lastTilt = { x: t.x || 0, y: t.y || 0, z: t.z || 0 };
    }

    function openRipWindow() {
      spin.window = true;
      spin.peak = 0;
      spin.armed = false;
      spin.quietMs = 0;
      spin.gotAir = false;
      spin.bestAirMs = 0;
      spin.airMs = 0;
    }

    function phoneRPM() { return spin.peak / 6; }

    function launchRPM() {
      const eff = clamp(spin.peak, 0, RIP_CEIL);
      if (eff < RIP_FLOOR) return MIN_RPM;
      return clamp(eff * GEAR, MIN_RPM, MAX_RPM);
    }

    function launchPower() {
      return clamp((launchRPM() - MIN_RPM) / (MAX_RPM - MIN_RPM), 0, 1);
    }

    /* ============================================================ *
     * 4. Archetypes and sprite baking
     * ============================================================ */

    /**
     * Difficulty ladder. `rpmMul` sets how hard rivals launch, `skill` sharpens
     * their stats, `opps` adds a third top to the stadium at the top two tiers.
     */
    const DIFFICULTIES = [
      {
        id: "rookie", name: "ROOKIE", weight: 1, opps: 2, rpmMul: 0.86,
        skill: 0.92, maxTier: 0, hue: 158,
        blurb: "Two soft rivals. Learn the rip."
      },
      {
        id: "pro", name: "PRO", weight: 2, opps: 2, rpmMul: 1.04,
        skill: 1.04, maxTier: 1, hue: 200,
        blurb: "Two real rivals that fight back."
      },
      {
        id: "champion", name: "CHAMPION", weight: 4, opps: 3, rpmMul: 0.92,
        skill: 1.11, maxTier: 2, hue: 40,
        blurb: "Three rivals, and they are quick."
      },
      {
        id: "legend", name: "LEGEND", weight: 7, opps: 3, rpmMul: 1.01,
        skill: 1.22, maxTier: 3, hue: 320,
        blurb: "Three apex tops. Rip perfectly or lose."
      }
    ];
    let difficulty = DIFFICULTIES[0];

    /**
     * Elemental specials. Every top has one; yours fires on a button, rivals
     * fire theirs on their own. Three shapes cover the set:
     *   bolt  - forks to the nearest rivals, heavy drain, little shove
     *   burst - radial nova, drain and a hard shove that scales with range
     *   zone  - a lingering field that drains and slows whatever stands in it
     */
    /* ---------------- the forge ---------------- */

    /**
     * Abilities are built from parts. Rivals carry fixed loadouts (below);
     * you can run a preset or spend a budget of sparks on your own.
     *
     * Core and element are free -- they pick the shape and the colour. The
     * budget goes on how hard it hits, how far it reaches, how often it comes
     * back, and up to two riders. Six sparks buys one savage power OR a pair
     * of cheaper riders, which is the whole trade.
     */
    const FORGE_BUDGET = 6;

    const FORGE = {
      core: [
        { id: "bolt",  label: "BOLT",  cost: 0, blurb: "forks to the two nearest" },
        { id: "burst", label: "NOVA",  cost: 0, blurb: "radial blast, falls off with range" },
        { id: "zone",  label: "FIELD", cost: 0, blurb: "lingering pool that drains and slows" }
      ],
      element: [
        { id: "storm", label: "STORM", hue: 196 },
        { id: "fire",  label: "FIRE",  hue: 20 },
        { id: "frost", label: "FROST", hue: 188 },
        { id: "gale",  label: "GALE",  hue: 150 },
        { id: "venom", label: "VENOM", hue: 92 },
        { id: "tide",  label: "TIDE",  hue: 205 }
      ],
      power: [
        { id: "light",  label: "LIGHT",  cost: 0, drain: 820,  shove: 1.0 },
        { id: "heavy",  label: "HEAVY",  cost: 2, drain: 1450, shove: 1.9 },
        { id: "savage", label: "SAVAGE", cost: 4, drain: 2150, shove: 2.7 }
      ],
      reach: [
        { id: "near", label: "NEAR", cost: 0, reach: 0.44 },
        { id: "mid",  label: "MID",  cost: 1, reach: 0.60 },
        { id: "far",  label: "FAR",  cost: 2, reach: 0.80 }
      ],
      charge: [
        { id: "slow",   label: "SLOW",   cost: 0, cool: 12500 },
        { id: "steady", label: "STEADY", cost: 1, cool: 9000 },
        { id: "rapid",  label: "RAPID",  cost: 3, cool: 6000 }
      ],
      rider: [
        { id: "burn",   label: "BURN",   cost: 2, blurb: "leaves a burn ticking" },
        { id: "chill",  label: "CHILL",  cost: 2, blurb: "drags the target down" },
        { id: "launch", label: "LAUNCH", cost: 2, blurb: "much harder shove" },
        { id: "siphon", label: "SIPHON", cost: 3, blurb: "returns spin to you" },
        { id: "pierce", label: "PIERCE", cost: 2, blurb: "ignores their defence" }
      ]
    };

    function forgePart(slot, id) {
      const list = FORGE[slot];
      for (const part of list) if (part.id === id) return part;
      return list[0];
    }

    /** What a loadout costs in sparks. Core and element are free. */
    function forgeCost(build) {
      let spent = forgePart("power", build.power).cost
        + forgePart("reach", build.reach).cost
        + forgePart("charge", build.charge).cost;
      for (const rid of build.riders) spent += forgePart("rider", rid).cost;
      return spent;
    }

    /** Turn a loadout into the runtime shape castSpecial expects. */
    function resolveBuild(build) {
      const core = forgePart("core", build.core);
      const elem = forgePart("element", build.element);
      const pow = forgePart("power", build.power);
      const rng = forgePart("reach", build.reach);
      const chg = forgePart("charge", build.charge);
      const riders = build.riders.slice();
      return {
        label: elem.label,
        hue: elem.hue,
        kind: core.id,
        reach: rng.reach,
        drain: pow.drain * (core.id === "zone" ? 0.72 : 1),
        shove: pow.shove * (riders.indexOf("launch") >= 0 ? 2.3 : 1) * (core.id === "zone" ? 0.2 : 1),
        cool: chg.cool,
        hold: core.id === "zone" ? 3400 : 0,
        riders: riders
      };
    }

    /** Ready-made loadouts for anyone who does not want to build one. */
    const ABILITY_PRESETS = [
      {
        id: "wildfire", name: "WILDFIRE",
        build: { core: "burst", element: "fire", power: "heavy", reach: "mid", charge: "steady", riders: ["burn"] }
      },
      {
        id: "stormbreaker", name: "STORMBREAKER",
        build: { core: "bolt", element: "storm", power: "savage", reach: "mid", charge: "slow", riders: [] }
      },
      {
        id: "glacier", name: "GLACIER",
        build: { core: "zone", element: "frost", power: "light", reach: "near", charge: "steady", riders: ["chill", "siphon"] }
      }
    ];

    function cloneBuild(b) {
      return {
        core: b.core, element: b.element, power: b.power,
        reach: b.reach, charge: b.charge, riders: b.riders.slice()
      };
    }

    // The ability you actually take into the stadium. Starts on a preset; the
    // forge edits this directly. Declared after the presets it reads from.
    let myBuild = cloneBuild(ABILITY_PRESETS[0].build);
    let showForge = false;
    let forgeMs = 0;

    const ELEMENTS = {
      storm:  { label: "STORM",  hue: 196, kind: "bolt",  reach: 0.70, drain: 1450, shove: 1.1, cool: 8500,  hold: 0 },
      fire:   { label: "FIRE",   hue: 20,  kind: "burst", reach: 0.56, drain: 1600, shove: 2.4, cool: 9500,  hold: 0 },
      frost:  { label: "FROST",  hue: 188, kind: "zone",  reach: 0.52, drain: 950,  shove: 0.2, cool: 9000,  hold: 3400 },
      gale:   { label: "GALE",   hue: 150, kind: "burst", reach: 0.72, drain: 700,  shove: 3.4, cool: 8000,  hold: 0 },
      ember:  { label: "EMBER",  hue: 8,   kind: "burst", reach: 0.50, drain: 1500, shove: 2.0, cool: 9000,  hold: 0 },
      radiant:{ label: "RADIANT",hue: 46,  kind: "bolt",  reach: 0.66, drain: 1250, shove: 0.9, cool: 9500,  hold: 0 },
      venom:  { label: "VENOM",  hue: 92,  kind: "zone",  reach: 0.50, drain: 1250, shove: 0.2, cool: 8500,  hold: 3800 },
      tide:   { label: "TIDE",   hue: 205, kind: "burst", reach: 0.66, drain: 1150, shove: 2.6, cool: 9000,  hold: 0 },
      umbra:  { label: "UMBRA",  hue: 282, kind: "zone",  reach: 0.58, drain: 1500, shove: 0.6, cool: 9000,  hold: 3200 }
    };

    /**
     * The full roster. `playable` tops are the three you pick from; the rest
     * are rivals, gated by `tier` so harder difficulties field nastier ones.
     */
    const ROSTER = [
      {
        id: "attack", name: "VOLT LANCE", element: "storm", callsign: "VOLT", role: "ATTACK", playable: true, tier: 0,
        blades: 3, sharp: 2.5, skew: 0.36, rIn: 0.54,
        hue: 191, hue2: 168,
        mass: 0.86, radius: 0.158,
        decay: 1.10, aggression: 1.0,
        deal: 1.56, take: 1.14, knock: 1.62,
        blurb: "Hits hardest of the three. Burns out first."
      },
      {
        id: "defense", name: "IRON BASTION", element: "fire", callsign: "BASTION", role: "DEFENSE", playable: true, tier: 0,
        blades: 6, sharp: 1.25, skew: -0.13, rIn: 0.73,
        hue: 27, hue2: 47,
        mass: 1.34, radius: 0.171,
        decay: 0.95, aggression: 0.24,
        deal: 0.85, take: 0.60, knock: 0.64,
        blurb: "Heavy. Shrugs off hits, holds the centre."
      },
      {
        id: "stamina", name: "PALE ORBIT", element: "frost", callsign: "ORBIT", role: "STAMINA", playable: true, tier: 0,
        blades: 8, sharp: 0.92, skew: 0.07, rIn: 0.79,
        hue: 285, hue2: 322,
        mass: 1.0, radius: 0.162,
        decay: 0.90, aggression: 0.44,
        deal: 0.78, take: 1.22, knock: 0.90,
        blurb: "Outlasts everything. Fragile in a clash."
      },

      /* --- rivals, easiest first --- */
      {
        id: "wisp", name: "WISP", element: "gale", callsign: "WISP", role: "SCOUT", playable: false, tier: 0,
        blades: 3, sharp: 1.8, skew: 0.22, rIn: 0.62,
        hue: 168, hue2: 150,
        mass: 0.70, radius: 0.146,
        decay: 1.16, aggression: 0.62,
        deal: 0.74, take: 1.30, knock: 1.02
      },
      {
        id: "cinder", name: "CINDER FANG", element: "ember", callsign: "CINDER", role: "ATTACK", playable: false, tier: 0,
        blades: 4, sharp: 2.2, skew: 0.30, rIn: 0.58,
        hue: 8, hue2: 32,
        mass: 0.94, radius: 0.156,
        decay: 1.08, aggression: 0.95,
        deal: 1.42, take: 1.10, knock: 1.44
      },
      {
        id: "crown", name: "HOLLOW CROWN", element: "radiant", callsign: "CROWN", role: "BALANCE", playable: false, tier: 1,
        blades: 5, sharp: 1.5, skew: -0.08, rIn: 0.70,
        hue: 44, hue2: 58,
        mass: 1.18, radius: 0.166,
        decay: 0.94, aggression: 0.55,
        deal: 1.06, take: 0.82, knock: 1.00
      },
      {
        id: "riot", name: "RIOT COIL", element: "venom", callsign: "RIOT", role: "CHAOS", playable: false, tier: 1,
        blades: 7, sharp: 1.9, skew: 0.44, rIn: 0.64,
        hue: 96, hue2: 76,
        mass: 0.98, radius: 0.160,
        decay: 1.02, aggression: 1.15,
        deal: 1.28, take: 1.00, knock: 1.30
      },
      {
        id: "nullvec", name: "NULL VECTOR", element: "tide", callsign: "NULL", role: "STAMINA", playable: false, tier: 2,
        blades: 12, sharp: 0.85, skew: 0.03, rIn: 0.84,
        hue: 205, hue2: 190,
        mass: 1.10, radius: 0.164,
        decay: 0.74, aggression: 0.38,
        deal: 0.92, take: 0.94, knock: 0.86
      },
      {
        id: "meridian", name: "BLACK MERIDIAN", element: "umbra", callsign: "MERIDIAN", role: "APEX", playable: false, tier: 3,
        blades: 10, sharp: 1.35, skew: -0.20, rIn: 0.76,
        hue: 268, hue2: 300,
        mass: 1.40, radius: 0.174,
        decay: 0.82, aggression: 0.80,
        deal: 1.34, take: 0.66, knock: 1.20
      }
    ];

    const ARCHETYPES = ROSTER.filter(t => t.playable);

    /**
     * Polar profile of an energy layer. Smooth lobes, angle-warped so the
     * blades sweep back -- that asymmetry is what reads as "forged" rather
     * than "flower", and it shows the spin direction.
     */
    function bladeRadius(a, spec) {
      const warped = a + spec.skew * Math.sin(spec.blades * a);
      const lobe = Math.pow(0.5 + 0.5 * Math.cos(spec.blades * warped), spec.sharp);
      return spec.rIn + (1 - spec.rIn) * lobe;
    }

    function tracebBlade(gg, spec, R, scale) {
      const steps = 168;
      gg.beginPath();
      for (let i = 0; i <= steps; i++) {
        const a = (i / steps) * TAU;
        const r = bladeRadius(a, spec) * R * scale;
        const x = Math.cos(a) * r;
        const y = Math.sin(a) * r;
        if (i === 0) gg.moveTo(x, y); else gg.lineTo(x, y);
      }
      gg.closePath();
    }

    /**
     * Paint one top, centred at 0,0, in a context already translated there.
     * `perspective` squashes y so the top reads as seen from a low angle.
     */
    function paintTop(gg, spec, R, perspective) {
      const h1 = spec.hue;
      const h2 = spec.hue2;

      gg.save();
      gg.scale(1, perspective);

      // Forge disc -- the heavy metal ring below the blade, offset down so a
      // sliver of its edge shows past the energy layer.
      gg.save();
      gg.translate(0, R * 0.16 / perspective);
      const discGrad = gg.createLinearGradient(-R, -R, R, R);
      discGrad.addColorStop(0, "hsl(" + h1 + ", 18%, 30%)");
      discGrad.addColorStop(0.45, "hsl(" + h1 + ", 12%, 52%)");
      discGrad.addColorStop(0.55, "hsl(" + h1 + ", 14%, 38%)");
      discGrad.addColorStop(1, "hsl(" + h1 + ", 20%, 19%)");
      gg.fillStyle = discGrad;
      gg.beginPath();
      gg.arc(0, 0, R * 0.86, 0, TAU);
      gg.fill();
      gg.restore();

      // Energy layer face.
      const bodyGrad = gg.createLinearGradient(-R, -R * 0.9, R * 0.7, R);
      bodyGrad.addColorStop(0, "hsl(" + h2 + ", 88%, 66%)");
      bodyGrad.addColorStop(0.38, "hsl(" + h1 + ", 82%, 47%)");
      bodyGrad.addColorStop(0.72, "hsl(" + h1 + ", 74%, 29%)");
      bodyGrad.addColorStop(1, "hsl(" + h1 + ", 62%, 17%)");
      gg.fillStyle = bodyGrad;
      tracebBlade(gg, spec, R, 1);
      gg.fill();

      // Facets: alternating light/dark wedges from hub to each blade tip.
      for (let i = 0; i < spec.blades; i++) {
        const a0 = (i / spec.blades) * TAU;
        const a1 = a0 + TAU / spec.blades;
        const mid = (a0 + a1) / 2;
        gg.save();
        gg.beginPath();
        gg.moveTo(0, 0);
        for (let k = 0; k <= 18; k++) {
          const a = lerp(a0, mid, k / 18);
          const r = bladeRadius(a, spec) * R;
          gg.lineTo(Math.cos(a) * r, Math.sin(a) * r);
        }
        gg.closePath();
        gg.fillStyle = "rgba(255,255,255,0.10)";
        gg.fill();
        gg.restore();

        gg.save();
        gg.beginPath();
        gg.moveTo(0, 0);
        for (let k = 0; k <= 18; k++) {
          const a = lerp(mid, a1, k / 18);
          const r = bladeRadius(a, spec) * R;
          gg.lineTo(Math.cos(a) * r, Math.sin(a) * r);
        }
        gg.closePath();
        gg.fillStyle = "rgba(0,0,0,0.20)";
        gg.fill();
        gg.restore();
      }

      // Bright edge on the blade outline.
      gg.lineWidth = Math.max(1, R * 0.045);
      gg.strokeStyle = "hsl(" + h2 + ", 96%, 76%)";
      tracebBlade(gg, spec, R, 1);
      gg.stroke();

      // Hub: concentric machined rings and a lit core.
      const hubGrad = gg.createRadialGradient(-R * 0.12, -R * 0.14, R * 0.02, 0, 0, R * 0.46);
      hubGrad.addColorStop(0, "hsl(" + h2 + ", 96%, 88%)");
      hubGrad.addColorStop(0.35, "hsl(" + h1 + ", 60%, 44%)");
      hubGrad.addColorStop(1, "hsl(" + h1 + ", 46%, 15%)");
      gg.fillStyle = hubGrad;
      gg.beginPath();
      gg.arc(0, 0, R * 0.44, 0, TAU);
      gg.fill();

      gg.lineWidth = Math.max(0.6, R * 0.022);
      gg.strokeStyle = "rgba(0,0,0,0.35)";
      for (let i = 1; i <= 3; i++) {
        gg.beginPath();
        gg.arc(0, 0, R * 0.44 * (i / 3.4), 0, TAU);
        gg.stroke();
      }

      // Bolt slot in the very centre.
      gg.strokeStyle = "rgba(255,255,255,0.55)";
      gg.lineWidth = Math.max(1, R * 0.05);
      gg.beginPath();
      gg.moveTo(-R * 0.14, 0);
      gg.lineTo(R * 0.14, 0);
      gg.stroke();

      gg.restore();
    }

    const spriteCache = new Map();

    /** Returns { sharp, blur, size } sprites for a spec at a given px radius. */
    function getSprites(spec, radiusPx) {
      const key = spec.id + "@" + Math.round(radiusPx);
      const hit = spriteCache.get(key);
      if (hit) return hit;

      const margin = 1.22;
      const size = Math.ceil(radiusPx * 2 * margin);
      const sharpSurf = makeSurface(size, size);
      const blurSurf = makeSurface(size, size);
      let entry;

      if (!sharpSurf || !blurSurf) {
        entry = { sharp: null, blur: null, size: size, live: true };
      } else {
        const sg = sharpSurf.getContext("2d");
        sg.translate(size / 2, size / 2);
        paintTop(sg, spec, radiusPx, 1);

        // The blur sprite is the same blade smeared through a full rotation,
        // which is what a top at speed actually looks like.
        const bg = blurSurf.getContext("2d");
        bg.translate(size / 2, size / 2);
        const passes = 26;
        bg.globalAlpha = 1 / (passes * 0.55);
        for (let i = 0; i < passes; i++) {
          bg.save();
          bg.rotate((i / passes) * (TAU / spec.blades));
          paintTop(bg, spec, radiusPx, 1);
          bg.restore();
        }
        bg.globalAlpha = 1;

        entry = { sharp: sharpSurf, blur: blurSurf, size: size, live: false };
      }

      spriteCache.set(key, entry);
      return entry;
    }

    /* ============================================================ *
     * 5. Arena bake
     * ============================================================ */

    let arenaSurf = null;
    let arenaMeta = { w: 0, h: 0, s: 0 };

    function paintArena(gg, scale, sc) {
      const rx = scale;
      const lift = rx * 0.17;          // rim opening offset, in squashed units

      /* --- environment glow behind the whole stadium --- */
      gg.save();
      gg.scale(1, SQUASH);
      const halo = gg.createRadialGradient(0, -lift, rx * 0.3, 0, -lift, rx * 2.0);
      halo.addColorStop(0, "rgba(70,130,255,0.20)");
      halo.addColorStop(0.45, "rgba(48,86,200,0.09)");
      halo.addColorStop(1, "rgba(0,0,0,0)");
      gg.fillStyle = halo;
      gg.beginPath();
      gg.arc(0, -lift, rx * 2.0, 0, TAU);
      gg.fill();

      /* --- outer rim band --- */
      const rimOuter = rx * 1.34;
      const rimInner = rx * 1.13;
      const rimGrad = gg.createLinearGradient(0, -rimOuter - lift, 0, rimOuter - lift);
      rimGrad.addColorStop(0, "#4a5878");
      rimGrad.addColorStop(0.22, "#222a42");
      rimGrad.addColorStop(0.5, "#141a2c");
      rimGrad.addColorStop(0.78, "#1b2338");
      rimGrad.addColorStop(1, "#55638a");
      gg.fillStyle = rimGrad;
      gg.beginPath();
      gg.arc(0, -lift, rimOuter, 0, TAU);
      gg.fill();

      // Brushed-metal banding around the rim.
      gg.save();
      gg.beginPath();
      gg.arc(0, -lift, rimOuter, 0, TAU);
      gg.arc(0, -lift, rimInner, 0, TAU, true);
      gg.clip();   // opposite winding on the inner arc already cuts the ring
      for (let i = 0; i < 130; i++) {
        const a = (i / 130) * TAU;
        gg.strokeStyle = "rgba(190,220,255," + (0.012 + 0.03 * Math.abs(Math.sin(a * 3))).toFixed(3) + ")";
        gg.lineWidth = sc * 1.2;
        gg.beginPath();
        gg.moveTo(Math.cos(a) * rimInner, Math.sin(a) * rimInner - lift);
        gg.lineTo(Math.cos(a) * rimOuter, Math.sin(a) * rimOuter - lift);
        gg.stroke();
      }
      gg.restore();

      // Bevel highlight on the outer edge and a shadow under it.
      gg.strokeStyle = "rgba(180,215,255,0.30)";
      gg.lineWidth = sc * 1.6;
      gg.beginPath();
      gg.arc(0, -lift, rimOuter - sc * 1, 0, TAU);
      gg.stroke();

      // Tick marks, long every sixth.
      for (let i = 0; i < 84; i++) {
        const a = (i / 84) * TAU;
        const long = i % 6 === 0;
        const r0 = rx * (long ? 1.17 : 1.22);
        const r1 = rx * 1.30;
        gg.strokeStyle = long ? "rgba(165,205,255,0.5)" : "rgba(120,150,205,0.2)";
        gg.lineWidth = long ? sc * 2 : sc * 1;
        gg.beginPath();
        gg.moveTo(Math.cos(a) * r0, Math.sin(a) * r0 - lift);
        gg.lineTo(Math.cos(a) * r1, Math.sin(a) * r1 - lift);
        gg.stroke();
      }

      // Accent lamps set into the rim.
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * TAU + 0.12;
        const lr = rx * 1.235;
        const lx = Math.cos(a) * lr;
        const ly = Math.sin(a) * lr - lift;
        const lamp = gg.createRadialGradient(lx, ly, 0, lx, ly, rx * 0.055);
        lamp.addColorStop(0, "rgba(190,235,255,0.85)");
        lamp.addColorStop(0.4, "rgba(110,190,255,0.35)");
        lamp.addColorStop(1, "rgba(90,160,255,0)");
        gg.fillStyle = lamp;
        gg.beginPath();
        gg.arc(lx, ly, rx * 0.055, 0, TAU);
        gg.fill();
      }

      /* --- the bowl wall --- */
      // Lit at the far side, falling into shadow at the near lip. This is what
      // makes the stadium read as a dish rather than a painted circle.
      const wall = gg.createLinearGradient(0, -rimInner - lift, 0, rimInner - lift);
      wall.addColorStop(0, "#33456f");
      wall.addColorStop(0.30, "#20304f");
      wall.addColorStop(0.62, "#111a30");
      wall.addColorStop(1, "#0a1020");
      gg.fillStyle = wall;
      gg.beginPath();
      gg.arc(0, -lift, rimInner, 0, TAU);
      gg.fill();

      // Vertical flutes down the wall.
      gg.save();
      gg.beginPath();
      gg.arc(0, -lift, rimInner, 0, TAU);
      gg.clip();
      for (let i = 0; i < 48; i++) {
        const a = (i / 48) * TAU;
        gg.strokeStyle = "rgba(140,180,240,0.05)";
        gg.lineWidth = sc * 1.4;
        gg.beginPath();
        gg.moveTo(Math.cos(a) * rx * 0.95, Math.sin(a) * rx * 0.95);
        gg.lineTo(Math.cos(a) * rimInner, Math.sin(a) * rimInner - lift);
        gg.stroke();
      }
      gg.restore();

      // Energy ring around the lip.
      gg.strokeStyle = "rgba(125,195,255,0.55)";
      gg.lineWidth = sc * 2.4;
      gg.beginPath();
      gg.arc(0, -lift, rimInner - sc * 2, 0, TAU);
      gg.stroke();
      gg.strokeStyle = "rgba(205,238,255,0.28)";
      gg.lineWidth = sc * 1;
      gg.beginPath();
      gg.arc(0, -lift, rimInner - sc * 5, 0, TAU);
      gg.stroke();

      /* --- the floor --- */
      const floorR = rx * 1.02;
      const floor = gg.createRadialGradient(0, -rx * 0.24, rx * 0.04, 0, 0, floorR);
      floor.addColorStop(0, "#0d1830");
      floor.addColorStop(0.45, "#0a1226");
      floor.addColorStop(0.82, "#0d1730");
      floor.addColorStop(1, "#16223f");
      gg.fillStyle = floor;
      gg.beginPath();
      gg.arc(0, 0, floorR, 0, TAU);
      gg.fill();

      // Ambient occlusion where the floor meets the wall.
      const ao = gg.createRadialGradient(0, 0, floorR * 0.72, 0, 0, floorR);
      ao.addColorStop(0, "rgba(0,0,0,0)");
      ao.addColorStop(1, "rgba(0,0,0,0.55)");
      gg.fillStyle = ao;
      gg.beginPath();
      gg.arc(0, 0, floorR, 0, TAU);
      gg.fill();

      // Tech grid on the floor: concentric rings and radial spokes.
      gg.save();
      gg.beginPath();
      gg.arc(0, 0, floorR, 0, TAU);
      gg.clip();

      for (let i = 1; i <= 7; i++) {
        const r = floorR * (i / 7);
        gg.strokeStyle = "rgba(120,170,255," + (0.115 - i * 0.011).toFixed(3) + ")";
        gg.lineWidth = sc * (i % 2 === 0 ? 1.4 : 0.8);
        gg.beginPath();
        gg.arc(0, 0, r, 0, TAU);
        gg.stroke();
      }
      for (let i = 0; i < 24; i++) {
        const a = (i / 24) * TAU;
        gg.strokeStyle = "rgba(120,170,255," + (i % 2 ? 0.045 : 0.085) + ")";
        gg.lineWidth = sc * (i % 2 ? 0.7 : 1.1);
        gg.beginPath();
        gg.moveTo(Math.cos(a) * floorR * 0.13, Math.sin(a) * floorR * 0.13);
        gg.lineTo(Math.cos(a) * floorR, Math.sin(a) * floorR);
        gg.stroke();
      }

      // Four launch chevrons, like a real stadium floor.
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * TAU + Math.PI / 4;
        gg.save();
        gg.rotate(a);
        gg.strokeStyle = "rgba(150,200,255,0.16)";
        gg.lineWidth = sc * 2;
        gg.lineJoin = "round";
        for (let k = 0; k < 2; k++) {
          const rr = floorR * (0.60 + k * 0.09);
          gg.beginPath();
          gg.moveTo(-floorR * 0.10, rr);
          gg.lineTo(0, rr - floorR * 0.07);
          gg.lineTo(floorR * 0.10, rr);
          gg.stroke();
        }
        gg.restore();
      }
      gg.restore();

      // Centre sink: the low point of the bowl.
      const sink = gg.createRadialGradient(0, 0, 0, 0, 0, floorR * 0.34);
      sink.addColorStop(0, "rgba(80,150,255,0.26)");
      sink.addColorStop(0.45, "rgba(50,95,200,0.09)");
      sink.addColorStop(1, "rgba(0,0,0,0)");
      gg.fillStyle = sink;
      gg.beginPath();
      gg.arc(0, 0, floorR * 0.34, 0, TAU);
      gg.fill();

      gg.strokeStyle = "rgba(160,210,255,0.34)";
      gg.lineWidth = sc * 1.5;
      gg.beginPath();
      gg.arc(0, 0, floorR * 0.105, 0, TAU);
      gg.stroke();
      gg.strokeStyle = "rgba(160,210,255,0.16)";
      gg.lineWidth = sc * 1;
      gg.beginPath();
      gg.arc(0, 0, floorR * 0.17, 0, TAU);
      gg.stroke();

      // Golden-hour light raking across the bowl from the sun side.
      gg.save();
      gg.globalCompositeOperation = "lighter";
      const warmth = gg.createLinearGradient(rx * 0.75, -rimOuter - lift, -rx * 0.55, rimOuter - lift);
      warmth.addColorStop(0, "rgba(255,196,128,0.26)");
      warmth.addColorStop(0.42, "rgba(255,168,104,0.10)");
      warmth.addColorStop(1, "rgba(255,150,92,0)");
      gg.fillStyle = warmth;
      gg.beginPath();
      gg.arc(0, -lift, rimOuter, 0, TAU);
      gg.fill();
      gg.restore();

      gg.restore();
    }

    function drawArenaSheen(nowSec) {
      g.save();
      g.translate(cx, cy);
      g.scale(1, SQUASH);
      g.globalCompositeOperation = "lighter";

      const floorR = S * 1.02;
      g.beginPath();
      g.arc(0, 0, floorR, 0, TAU);
      g.clip();

      // Two soft sheens rotating at different rates.
      for (let i = 0; i < 2; i++) {
        const a = nowSec * (0.28 + i * 0.14) + i * 2.1;
        const sheen = g.createLinearGradient(
          Math.cos(a) * -floorR, Math.sin(a) * -floorR,
          Math.cos(a) * floorR, Math.sin(a) * floorR
        );
        sheen.addColorStop(0, "rgba(90,160,255,0)");
        sheen.addColorStop(0.5, "rgba(110,180,255," + (0.05 - i * 0.018).toFixed(3) + ")");
        sheen.addColorStop(1, "rgba(90,160,255,0)");
        g.fillStyle = sheen;
        g.fillRect(-floorR, -floorR, floorR * 2, floorR * 2);
      }

      // Impact wash, tinted by whatever last clashed.
      if (arenaGlow > 0.01) {
        const wash = g.createRadialGradient(0, 0, 0, 0, 0, floorR);
        wash.addColorStop(0, "hsla(" + arenaHue + ", 95%, 65%, " + (arenaGlow * 0.26).toFixed(3) + ")");
        wash.addColorStop(1, "hsla(" + arenaHue + ", 95%, 60%, 0)");
        g.fillStyle = wash;
        g.fillRect(-floorR, -floorR, floorR * 2, floorR * 2);
      }
      g.restore();
    }

    /** Stable pseudo-random from an index, so the bake never reshuffles. */
    function hashUnit(i, salt) {
      const v = Math.sin(i * 12.9898 + salt * 78.233) * 43758.5453;
      return v - Math.floor(v);
    }

    /**
     * The garden the stadium stands in, at golden hour. Baked once with the
     * arena: sky, sun, two hill layers, a tree line, the grass bed and its
     * tufts. Petals and sway are drawn live on top.
     */
    function paintBackdrop(gg) {
      const skyLine = cy - S * 1.02;

      const sky = gg.createLinearGradient(0, 0, 0, Math.max(skyLine, 2));
      sky.addColorStop(0, "#131d3a");
      sky.addColorStop(0.38, "#2f4270");
      sky.addColorStop(0.68, "#6d6a93");
      sky.addColorStop(0.88, "#c08a6f");
      sky.addColorStop(1, "#e8ad72");
      gg.fillStyle = sky;
      gg.fillRect(0, 0, W, skyLine + 2);

      // Low sun sitting behind the stadium.
      gg.save();
      gg.globalCompositeOperation = "lighter";
      const sunX = cx + W * 0.19;
      const sunY = skyLine - S * 0.12;
      const sun = gg.createRadialGradient(sunX, sunY, 0, sunX, sunY, S * 1.5);
      sun.addColorStop(0, "rgba(255,225,170,0.75)");
      sun.addColorStop(0.16, "rgba(255,190,120,0.34)");
      sun.addColorStop(0.5, "rgba(240,150,90,0.12)");
      sun.addColorStop(1, "rgba(220,120,80,0)");
      gg.fillStyle = sun;
      gg.fillRect(0, 0, W, skyLine + 2);
      gg.restore();

      // Two hill layers, the far one hazier.
      for (let layer = 0; layer < 2; layer++) {
        const baseY = skyLine - S * (layer === 0 ? 0.16 : 0.05);
        const amp = S * (layer === 0 ? 0.13 : 0.09);
        gg.fillStyle = layer === 0 ? "#4a5570" : "#334450";
        gg.beginPath();
        gg.moveTo(-10, skyLine + 4);
        for (let hx = -10; hx <= W + 10; hx += 8) {
          const u = hx / Math.max(W, 1);
          const hy = baseY
            - Math.sin(u * 3.1 + layer * 1.7) * amp
            - Math.sin(u * 7.3 + layer * 4.1) * amp * 0.35;
          gg.lineTo(hx, hy);
        }
        gg.lineTo(W + 10, skyLine + 4);
        gg.closePath();
        gg.fill();
      }

      // Tree line along the horizon.
      for (let i = 0; i < 16; i++) {
        const tx = (hashUnit(i, 1) * 1.16 - 0.08) * W;
        const scale = 0.62 + hashUnit(i, 2) * 0.75;
        const th = S * 0.30 * scale;
        const ty = skyLine + S * 0.012;
        const dark = 24 + Math.floor(hashUnit(i, 3) * 14);
        gg.fillStyle = "rgb(" + Math.round(dark * 0.7) + "," + (dark + 22) + "," + Math.round(dark * 0.85) + ")";
        gg.fillRect(tx - th * 0.035, ty - th * 0.55, th * 0.07, th * 0.6);
        for (let blob = 0; blob < 5; blob++) {
          const bx = tx + (hashUnit(i * 7 + blob, 4) - 0.5) * th * 0.66;
          const by = ty - th * (0.55 + hashUnit(i * 7 + blob, 5) * 0.42);
          const br = th * (0.20 + hashUnit(i * 7 + blob, 6) * 0.19);
          gg.beginPath();
          gg.arc(bx, by, br, 0, TAU);
          gg.fill();
        }
      }

      // Grass bed the stadium sits on.
      const ground = gg.createLinearGradient(0, skyLine, 0, H);
      ground.addColorStop(0, "#2c4a2b");
      ground.addColorStop(0.22, "#223d23");
      ground.addColorStop(0.62, "#162a1a");
      ground.addColorStop(1, "#0a150f");
      gg.fillStyle = ground;
      gg.fillRect(0, skyLine, W, H - skyLine);

      // Warm rim light where the sun catches the grass.
      gg.save();
      gg.globalCompositeOperation = "lighter";
      const rimLight = gg.createLinearGradient(0, skyLine, 0, skyLine + S * 0.5);
      rimLight.addColorStop(0, "rgba(240,170,110,0.30)");
      rimLight.addColorStop(1, "rgba(230,150,90,0)");
      gg.fillStyle = rimLight;
      gg.fillRect(0, skyLine, W, S * 0.5);
      gg.restore();

      // Tufts, denser and larger toward the bottom of frame.
      for (let i = 0; i < 260; i++) {
        const u = hashUnit(i, 7);
        const v = hashUnit(i, 8);
        const gx = u * W;
        const gy = skyLine + Math.pow(v, 0.7) * (H - skyLine);
        const depth = (gy - skyLine) / Math.max(1, H - skyLine);
        const gh = S * (0.02 + depth * 0.085) * (0.6 + hashUnit(i, 9) * 0.8);
        const shade = 30 + Math.floor(depth * 26 + hashUnit(i, 10) * 22);
        gg.strokeStyle = "rgba(" + Math.round(shade * 0.55) + "," + shade + "," + Math.round(shade * 0.6) + ",0.85)";
        gg.lineWidth = Math.max(0.7, gh * 0.11);
        gg.lineCap = "round";
        const lean = (hashUnit(i, 11) - 0.5) * gh * 0.7;
        gg.beginPath();
        gg.moveTo(gx, gy);
        gg.quadraticCurveTo(gx + lean * 0.4, gy - gh * 0.6, gx + lean, gy - gh);
        gg.stroke();
      }

      // Soft shadow the stadium casts on the grass.
      gg.save();
      const cast = gg.createRadialGradient(cx, cy + S * 0.28, S * 0.4, cx, cy + S * 0.28, S * 1.9);
      cast.addColorStop(0, "rgba(0,0,0,0.45)");
      cast.addColorStop(1, "rgba(0,0,0,0)");
      gg.fillStyle = cast;
      gg.fillRect(0, skyLine, W, H - skyLine);
      gg.restore();
    }

    /* ---------- wind, petals and fronds ---------- */

    let windNow = 0;          // -1..1, slow drift with gusts
    const petals = [];

    function seedPetals() {
      petals.length = 0;
      for (let i = 0; i < 82; i++) {
        petals.push({
          x: Math.random(), y: Math.random(),
          size: rand(2.8, 7.6),
          fall: rand(0.010, 0.030),
          roll: rand(-3.2, 3.2),
          turn: Math.random() * TAU,
          sway: rand(0.4, 1.5),
          phase: Math.random() * TAU,
          tone: rand(-8, 42) + (Math.random() < 0.25 ? 300 : 0),
          light: rand(66, 90)
        });
      }
    }

    /** Petals blow across the frame, carried by the same wind as the fronds. */
    function drawPetals(dt) {
      g.save();
      g.globalCompositeOperation = "lighter";
      for (const pt of petals) {
        pt.phase += dt * pt.sway;
        pt.turn += dt * pt.roll;
        pt.y += pt.fall * dt;
        pt.x += (windNow * 0.055 + Math.sin(pt.phase) * 0.012) * dt;
        if (pt.y > 1.06) { pt.y = -0.06; pt.x = Math.random(); }
        if (pt.x > 1.08) pt.x = -0.08;
        if (pt.x < -0.08) pt.x = 1.08;

        g.save();
        g.translate(pt.x * W, pt.y * H);
        g.rotate(pt.turn);
        // Foreshorten as it turns, so each petal flutters rather than slides.
        g.scale(1, 0.35 + 0.65 * Math.abs(Math.cos(pt.turn * 1.3)));
        g.fillStyle = "hsla(" + pt.tone.toFixed(0) + ", 82%, " + pt.light.toFixed(0) + "%, 0.92)";
        g.beginPath();
        g.ellipse(0, 0, pt.size, pt.size * 0.6, 0, 0, TAU);
        g.fill();
        g.restore();
      }
      g.restore();
    }

    /** Foreground fronds leaning with the wind, framing the stadium. */
    function drawFronds(nowSec) {
      // A shallow fringe of foreground grass along the bottom edge, swaying
      // with the wind. Kept short on purpose: taller stems read as dark bars
      // slicing across the stadium.
      g.save();
      g.lineCap = "round";
      for (let i = 0; i < 26; i++) {
        const bx = (hashUnit(i, 21) * 1.06 - 0.03) * W;
        const bh = H * (0.045 + hashUnit(i, 22) * 0.085);
        const bend = (Math.sin(nowSec * 1.05 + i * 0.7) * 0.16 + windNow * 0.42) * bh;
        const shade = 14 + Math.floor(hashUnit(i, 23) * 16);
        g.strokeStyle = "rgba(" + Math.round(shade * 0.6) + "," + (shade + 15) + "," + Math.round(shade * 0.7) + ",0.9)";
        g.lineWidth = Math.max(1.6, bh * 0.075);
        g.beginPath();
        g.moveTo(bx, H + 8);
        g.quadraticCurveTo(bx + bend * 0.4, H - bh * 0.55, bx + bend, H - bh);
        g.stroke();
      }
      g.restore();
    }
    function bakeArena() {
      const need = { w: W, h: H, s: S };
      if (arenaSurf && arenaMeta.w === need.w && arenaMeta.h === need.h && arenaMeta.s === need.s) return;
      arenaMeta = need;
      const sc = clamp(ctx.dpr || 1, 1, 2);
      const surf = makeSurface(W * sc, H * sc);
      if (!surf) { arenaSurf = null; return; }
      const gg = surf.getContext("2d");
      gg.scale(sc, sc);
      paintBackdrop(gg);
      gg.translate(cx, cy);
      paintArena(gg, S, 1);
      arenaSurf = surf;
    }

    /* ============================================================ *
     * 6. Tops and physics
     * ============================================================ */

    let tops = [];
    let battleMs = 0;
    let lastHitMs = 0;

    function makeTop(spec, rpm, angle, isPlayer, label, skill) {
      const r = 0.86;
      const k = skill || 1;
      return {
        spec: spec,
        dealMul: k,
        takeMul: 1 / k,
        decayMul: 1 / k,
        aggMul: 0.85 + k * 0.15,
        focus: Math.random() < 0.55 ? 1 : 0,
        charge: 0.35,          // 0..1, fills over the element's cooldown
        castMs: -9999,         // when this top last fired
        chill: 0,              // slow factor from a frost/venom field
        burn: 0,               // lingering drain per second
        x: Math.cos(angle) * r,
        y: Math.sin(angle) * r,
        vx: -Math.sin(angle) * 0.75,
        vy: Math.cos(angle) * 0.75,
        rpm: rpm,
        rpm0: rpm,
        theta: Math.random() * TAU,
        wobblePhase: Math.random() * TAU,
        h: 0.55,               // height above floor, for the drop-in
        vh: 0,
        alive: true,
        out: false,
        burst: false,
        deathMs: 0,
        isPlayer: !!isPlayer,
        label: label || spec.name,
        whirr: null,
        hitFlash: 0,
        trail: []
      };
    }

    function spinNorm(t) { return clamp(t.rpm / MAX_RPM, 0, 1); }

    function stepPhysics(dt) {
      const live = tops.filter(t => t.alive);

      for (const t of live) {
        // Drop-in.
        if (t.h > 0) {
          t.vh -= 4.2 * dt;
          t.h += t.vh * dt;
          if (t.h <= 0) {
            t.h = 0;
            t.vh = 0;
            impactDust(t);
            sfxClash(0.35);
            if (t.isPlayer) haptic("medium");
          }
          continue;
        }

        const r = Math.hypot(t.x, t.y) || 1e-6;
        const nx = t.x / r;
        const ny = t.y / r;
        const sn = spinNorm(t);

        // Bowl restoring force -- a paraboloid gives a linear pull to centre.
        let ax = -nx * BOWL_K * r;
        let ay = -ny * BOWL_K * r;

        // Stadium lip. Without this a fast top just spirals out on its own,
        // which would punish the good launch this whole bit is about. Getting
        // past the lip has to come from an impact.
        if (r > WALL_R) {
          const over = r - WALL_R;
          ax -= nx * over * WALL_K;
          ay -= ny * over * WALL_K;
        }

        // Gyroscopic drift: a spinning top walks its orbit rather than sliding
        // straight down the bowl. Driven toward a preferred orbital speed
        // instead of applied as a raw force, so it is self-limiting -- a plain
        // tangential force accelerates without bound and throws the top out.
        const tangential = -ny * t.vx + nx * t.vy;
        const wantTangential = lerp(0.26, 0.88, sn);
        const push = (wantTangential - tangential) * ORBIT_K;
        ax += -ny * push;
        ay += nx * push;

        // Seeking. Go for the biggest threat, discounted by how far it is --
        // not simply the nearest. Chasing the nearest top rewards hanging back
        // and letting the aggressive ones wreck each other, which made
        // passivity the dominant strategy. Ganging up on the leader also means
        // a monster launch has to survive being the target.
        const agg = t.spec.aggression * t.aggMul;
        let target = null;
        let bestD = 0;
        let bestScore = -Infinity;
        for (const o of live) {
          if (o === t || o.h > 0) continue;
          const d = Math.hypot(o.x - t.x, o.y - t.y);
          const score = spinNorm(o) * 1.7 * t.focus - d * 0.55;
          if (score > bestScore) { bestScore = score; target = o; bestD = d; }
        }
        if (target && bestD > 1e-4) {
          const seek = agg * 1.70 * (0.35 + sn * 0.65);
          ax += ((target.x - t.x) / bestD) * seek;
          ay += ((target.y - t.y) / bestD) * seek;
        }

        // Player steering overrides the seek: drag and your top drives at the
        // point you are holding, as hard as its remaining spin allows.
        if (t.isPlayer && steer.on) {
          const stx = steer.x - t.x;
          const sty = steer.y - t.y;
          const stl = Math.hypot(stx, sty);
          if (stl > 0.02) {
            const drive = 3.1 * (0.34 + sn * 0.66);
            ax += (stx / stl) * drive;
            ay += (sty / stl) * drive;
          }
        }

        // A dying top wanders drunkenly.
        const wob = 1 - sn;
        t.wobblePhase += dt * lerp(3, 13, wob);
        ax += Math.cos(t.wobblePhase) * wob * 0.5;
        ay += Math.sin(t.wobblePhase * 1.31) * wob * 0.5;

        t.vx += ax * dt;
        t.vy += ay * dt;

        const damp = Math.exp(-(DRAG + t.chill * 2.4) * dt);
        t.vx *= damp;
        t.vy *= damp;

        t.x += t.vx * dt;
        t.y += t.vy * dt;

        // Spin decay: a base burn plus what movement costs.
        const speed = Math.hypot(t.vx, t.vy);
        const burn = (86 + speed * 30 + t.rpm * 0.0050) * t.spec.decay * t.decayMul;
        t.rpm = Math.max(0, t.rpm - burn * dt);

        // Visual rotation, in radians/sec, damped so it stays readable.
        t.theta += (t.rpm / 60) * TAU * dt * 0.16;

        t.hitFlash = Math.max(0, t.hitFlash - dt * 3.4);

        // Trail.
        t.trail.push({ x: t.x, y: t.y, life: 1 });
        if (t.trail.length > 26) t.trail.shift();
        for (const p of t.trail) p.life -= dt * 2.1;
        while (t.trail.length && t.trail[0].life <= 0) t.trail.shift();

        // Ring-out.
        if (Math.hypot(t.x, t.y) > RING_OUT_R) {
          t.alive = false;
          t.out = true;
          t.deathMs = battleMs;
          killWhirr(t);
          sfxRingOut();
          burstParticles(t, 1.0, true);
          shake(14);
          if (t.isPlayer) haptic("error"); else haptic("success");
          ctx.platform.milestone("ring_out", { player: t.isPlayer });
        } else if (t.rpm <= 0.5) {
          t.alive = false;
          t.deathMs = battleMs;
          killWhirr(t);
          sfxDeath();
          burstParticles(t, 0.5, false);
          if (t.isPlayer) haptic("warning");
          ctx.platform.milestone("spin_out", { player: t.isPlayer });
        }
      }

      // Collisions.
      for (let i = 0; i < live.length; i++) {
        for (let j = i + 1; j < live.length; j++) {
          const a = live[i];
          const b = live[j];
          if (!a.alive || !b.alive || a.h > 0 || b.h > 0) continue;
          collide(a, b);
        }
      }

      // Whirr voices.
      for (const t of tops) {
        if (t.alive && t.h <= 0) {
          if (!t.whirr) t.whirr = makeWhirr(t.spec.blades);
          if (t.whirr) t.whirr.set(t.rpm, 0.25 + spinNorm(t) * 0.75);
        }
      }
    }

    function killWhirr(t) {
      if (t.whirr) { t.whirr.stop(); t.whirr = null; }
    }

    /* ---------- elemental specials ---------- */

    const novas = [];      // expanding rings from a burst
    const zones = [];      // lingering fields

    function elementOf(t) {
      if (t.isPlayer) return resolveBuild(myBuild);
      const native = ELEMENTS[t.spec.element] || ELEMENTS.storm;
      if (!native.riders) native.riders = [];
      return native;
    }

    /** True when a top has a target worth spending a charge on. */
    function hasQuarry(t, reach) {
      for (const other of tops) {
        if (other === t || !other.alive || other.h > 0) continue;
        if (Math.hypot(other.x - t.x, other.y - t.y) <= reach) return true;
      }
      return false;
    }

    function castSpecial(caster) {
      if (!caster.alive || caster.h > 0 || caster.charge < 1) return false;
      const el = elementOf(caster);
      caster.charge = 0;
      caster.castMs = battleMs;

      const power = 0.55 + spinNorm(caster) * 0.45;   // a dying top hits softer
      const hitList = [];
      for (const other of tops) {
        if (other === caster || !other.alive || other.h > 0) continue;
        const dist = Math.hypot(other.x - caster.x, other.y - caster.y);
        if (dist <= el.reach) hitList.push({ top: other, dist: dist });
      }
      hitList.sort((m, n) => m.dist - n.dist);

      const riders = el.riders || [];
      const pierces = riders.indexOf("pierce") >= 0;
      const burns = riders.indexOf("burn") >= 0;
      const chills = riders.indexOf("chill") >= 0;
      const siphons = riders.indexOf("siphon") >= 0;
      // PIERCE ignores the target's defence entirely.
      const soak = victim => (pierces ? 1 : victim.takeMul);
      let siphoned = 0;

      if (el.kind === "bolt") {
        // Forks to the two nearest rivals: big drain, modest shove.
        for (const hit of hitList.slice(0, 2)) {
          const victim = hit.top;
          const dealt = el.drain * power * soak(victim);
          siphoned += dealt;
          victim.rpm = Math.max(0, victim.rpm - dealt);
          if (burns) victim.burn = Math.max(victim.burn, 240 * power);
          if (chills) victim.chill = Math.min(1, victim.chill + 0.75);
          const bx = victim.x - caster.x, by = victim.y - caster.y;
          const bl = Math.hypot(bx, by) || 1;
          victim.vx += (bx / bl) * el.shove * power;
          victim.vy += (by / bl) * el.shove * power;
          victim.hitFlash = 1;
          boltArc(caster, victim, el.hue, 1);
          sparks((caster.x + victim.x) / 2, (caster.y + victim.y) / 2, 0.9, caster.spec, victim.spec);
        }
        sfxSpark(1);
      } else if (el.kind === "burst") {
        // Radial nova: everything close gets drained and shoved outward.
        for (const hit of hitList) {
          const victim = hit.top;
          const falloff = 1 - clamp(hit.dist / el.reach, 0, 1);
          const dealt = el.drain * power * falloff * soak(victim);
          siphoned += dealt;
          victim.rpm = Math.max(0, victim.rpm - dealt);
          if (burns) victim.burn = Math.max(victim.burn, 240 * power * falloff);
          if (chills) victim.chill = Math.min(1, victim.chill + 0.7 * falloff);
          const bx = victim.x - caster.x, by = victim.y - caster.y;
          const bl = Math.hypot(bx, by) || 1;
          victim.vx += (bx / bl) * el.shove * power * falloff;
          victim.vy += (by / bl) * el.shove * power * falloff;
          victim.hitFlash = 1;
          if (el.label === "FIRE") victim.burn = Math.max(victim.burn, 260 * power * falloff);
        }
        novas.push({ x: caster.x, y: caster.y, r: 0.02, max: el.reach, life: 1, hue: el.hue, power: power });
        sfxClash(1);
        shake(15 * power);
        flash(0.3 * power);
      } else {
        // Lingering field centred where it was cast.
        zones.push({
          x: caster.x, y: caster.y, r: el.reach, life: 1,
          ms: el.hold, maxMs: el.hold, hue: el.hue,
          drain: el.drain, owner: caster, spin: Math.random() * TAU,
          burns: burns, pierces: pierces, siphons: siphons
        });
        sfxSpark(0.7);
      }

      // SIPHON returns a slice of everything the cast drained.
      if (siphons && siphoned > 0) {
        caster.rpm = Math.min(MAX_RPM, caster.rpm + siphoned * 0.34);
      }

      arenaHue = el.hue;
      arenaGlow = Math.min(1, arenaGlow + 0.85);
      duckMusic(0.8);
      if (caster.isPlayer) {
        haptic("heavy");
        ctx.platform.milestone("special", { element: el.label });
      }
      return true;
    }

    /** Jagged fork used by bolt-kind specials. */
    function boltArc(from, to, hue, force) {
      arcs.push(buildArc(
        cx + from.x * S, cy + from.y * S * SQUASH,
        cx + to.x * S, cy + to.y * S * SQUASH,
        hue, force
      ));
    }

    function stepSpecials(dt) {
      for (const t of tops) {
        if (!t.alive || t.h > 0) continue;
        const el = elementOf(t);
        t.charge = Math.min(1, t.charge + (dt * 1000) / el.cool);

        // Lingering burn from a fire nova.
        if (t.burn > 0) {
          t.rpm = Math.max(0, t.rpm - t.burn * dt);
          t.burn = Math.max(0, t.burn - 90 * dt);
        }
        // Chill decays back to normal once out of a field.
        t.chill = Math.max(0, t.chill - dt * 1.4);

        // Rivals spend a charge whenever someone is in range.
        if (!t.isPlayer && t.charge >= 1 && hasQuarry(t, el.reach * 0.92)) {
          castSpecial(t);
        }
      }

      for (let i = zones.length - 1; i >= 0; i--) {
        const z = zones[i];
        z.ms -= dt * 1000;
        z.spin += dt * 0.8;
        z.life = clamp(z.ms / z.maxMs, 0, 1);
        for (const t of tops) {
          if (!t.alive || t.h > 0 || t === z.owner) continue;
          if (Math.hypot(t.x - z.x, t.y - z.y) > z.r) continue;
          const tick = z.drain * dt * (z.pierces ? 1 : t.takeMul);
          t.rpm = Math.max(0, t.rpm - tick);
          t.chill = Math.min(1, t.chill + dt * 2.2);
          if (z.burns) t.burn = Math.max(t.burn, 150);
          if (z.siphons && z.owner.alive) {
            z.owner.rpm = Math.min(MAX_RPM, z.owner.rpm + tick * 0.30);
          }
        }
        if (z.ms <= 0) zones.splice(i, 1);
      }

      for (let i = novas.length - 1; i >= 0; i--) {
        const nv = novas[i];
        nv.life -= dt * 2.2;
        nv.r = lerp(nv.r, nv.max, 1 - Math.exp(-11 * dt));
        if (nv.life <= 0) novas.splice(i, 1);
      }
    }

    function collide(a, b) {
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const d = Math.hypot(dx, dy);
      const minD = a.spec.radius + b.spec.radius;
      if (d >= minD || d < 1e-6) return;

      const nx = dx / d;
      const ny = dy / d;

      // Separate.
      const overlap = minD - d;
      const ma = a.spec.mass;
      const mb = b.spec.mass;
      const tot = ma + mb;
      a.x -= nx * overlap * (mb / tot);
      a.y -= ny * overlap * (mb / tot);
      b.x += nx * overlap * (ma / tot);
      b.y += ny * overlap * (ma / tot);

      // Approach speed along the normal.
      const rvx = b.vx - a.vx;
      const rvy = b.vy - a.vy;
      const vn = rvx * nx + rvy * ny;
      if (vn > 0) return;

      // Gyroscopic stability: a top spinning hard stands its ground, a dying
      // one gets thrown. This is most of what makes a strong launch worth it.
      const stabA = 0.5 + spinNorm(a) * 1.15;
      const stabB = 0.5 + spinNorm(b) * 1.15;

      // Impulse, with each top's knockback character folded in.
      const rest = 1.34;
      const jimp = -(1 + rest) * vn / (1 / ma + 1 / mb);
      a.vx -= (jimp / ma) * nx * b.spec.knock / stabA;
      a.vy -= (jimp / ma) * ny * b.spec.knock / stabA;
      b.vx += (jimp / mb) * nx * a.spec.knock / stabB;
      b.vy += (jimp / mb) * ny * a.spec.knock / stabB;

      // Spin drain. The faster-spinning top wins the exchange -- as a ratio,
      // so a 2:1 spin lead is a decisive edge rather than a rounding error.
      const impact = Math.min(4.2, -vn);
      const force = clamp(impact / 2.4, 0.05, 1);
      const sa = Math.max(a.rpm, 1);
      const sb = Math.max(b.rpm, 1);
      const advA = Math.pow(clamp(sa / sb, 0.2, 5), 0.75);

      const baseDrain = impact * 430;
      const drainB = baseDrain * a.spec.deal * a.dealMul * b.spec.take * b.takeMul * advA;
      const drainA = baseDrain * b.spec.deal * b.dealMul * a.spec.take * a.takeMul / advA;
      a.rpm = Math.max(0, a.rpm - drainA);
      b.rpm = Math.max(0, b.rpm - drainB);

      a.hitFlash = 1;
      b.hitFlash = 1;

      // Effects, throttled so a grinding contact does not spam.
      if (battleMs - lastHitMs > 55) {
        lastHitMs = battleMs;
        const mx = (a.x + b.x) / 2;
        const my = (a.y + b.y) / 2;
        sparks(mx, my, force, a.spec, b.spec);
        shockwave(mx, my, force);
        arenaHue = (Math.random() < 0.5 ? a.spec : b.spec).hue2;
        arenaGlow = Math.min(1, arenaGlow + force * 0.9);
        sfxClash(force);
        shake(force * 17);
        if (force > 0.34) {
          lightning(a, b, force);
          sfxSpark(force);
          flash(force * 0.4);
          duckMusic(force);
        }
        if ((a.isPlayer || b.isPlayer) && force > 0.2) {
          haptic(force > 0.55 ? "heavy" : "light");
        }
        if (force > 0.6) ctx.platform.milestone("heavy_clash", { force: Number(force.toFixed(2)) });
      }
    }

    /* ============================================================ *
     * 7. Effects
     * ============================================================ */

    const particles = [];
    const arcs = [];
    const waves = [];
    let shakeAmt = 0;
    let flashAmt = 0;
    let arenaGlow = 0;
    let arenaHue = 200;

    function shake(v) { shakeAmt = Math.min(26, shakeAmt + v); }
    function flash(v) { flashAmt = Math.min(0.75, flashAmt + v); }

    function haptic(kind) {
      if (ctx.capabilities && ctx.capabilities.haptics) {
        try { ctx.platform.haptic(kind); } catch (err) { /* unsupported */ }
      }
    }

    function sparks(wx, wy, force, sa, sb) {
      const n = Math.floor(lerp(14, 54, force));
      for (let i = 0; i < n; i++) {
        const a = Math.random() * TAU;
        const sp = rand(90, 460) * lerp(0.5, 1.5, force);
        particles.push({
          x: cx + wx * S,
          y: cy + wy * S * SQUASH,
          vx: Math.cos(a) * sp,
          vy: Math.sin(a) * sp * 0.62 - rand(30, 190),
          life: 1,
          decay: rand(1.5, 3.4),
          hue: Math.random() < 0.5 ? sa.hue2 : sb.hue2,
          hot: rand(0.55, 1)
        });
      }
    }

    function impactDust(t) {
      for (let i = 0; i < 16; i++) {
        const a = Math.random() * TAU;
        const sp = rand(40, 190);
        particles.push({
          x: cx + t.x * S,
          y: cy + t.y * S * SQUASH,
          vx: Math.cos(a) * sp,
          vy: Math.sin(a) * sp * 0.5 - rand(10, 70),
          life: 1,
          decay: rand(2.2, 4),
          hue: t.spec.hue2,
          hot: 0.5
        });
      }
      shake(6);
    }

    function burstParticles(t, force, outward) {
      const n = outward ? 46 : 26;
      for (let i = 0; i < n; i++) {
        const a = Math.random() * TAU;
        const sp = rand(120, 520) * (outward ? 1.4 : 0.7);
        particles.push({
          x: cx + t.x * S,
          y: cy + t.y * S * SQUASH,
          vx: Math.cos(a) * sp,
          vy: Math.sin(a) * sp * 0.6 - rand(60, 260),
          life: 1,
          decay: rand(1.1, 2.4),
          hue: t.spec.hue2,
          hot: 1
        });
      }
      flash(force * 0.35);
    }

    function shockwave(wx, wy, force) {
      waves.push({
        x: cx + wx * S,
        y: cy + wy * S * SQUASH,
        r: S * 0.04,
        max: S * lerp(0.18, 0.52, force),
        life: 1,
        force: force
      });
    }

    /**
     * Jagged arc between two screen points, by midpoint displacement.
     * Returned rather than pushed so specials can reuse it.
     */
    function buildArc(x0, y0, x1, y1, hue, force) {
      const segs = 9;
      const pts = [];
      const spread = S * lerp(0.03, 0.1, force);
      for (let i = 0; i <= segs; i++) {
        const f = i / segs;
        const bow = Math.sin(f * Math.PI);
        pts.push({
          x: lerp(x0, x1, f) + rand(-spread, spread) * bow,
          y: lerp(y0, y1, f) + rand(-spread, spread) * bow
        });
      }
      const branches = [];
      const forks = force > 0.6 ? 3 : 1;
      for (let i = 0; i < forks; i++) {
        const at = Math.floor(rand(2, segs - 1));
        const from = pts[at];
        const bp = [{ x: from.x, y: from.y }];
        const dir = Math.random() * TAU;
        let bx = from.x;
        let by = from.y;
        const steps = Math.floor(rand(2, 5));
        for (let k = 0; k < steps; k++) {
          bx += Math.cos(dir + rand(-0.8, 0.8)) * spread * rand(0.6, 1.7);
          by += Math.sin(dir + rand(-0.8, 0.8)) * spread * rand(0.4, 1.2);
          bp.push({ x: bx, y: by });
        }
        branches.push(bp);
      }
      return {
        pts: pts, branches: branches, life: 1,
        decay: rand(5.5, 8.5), hue: hue, force: force
      };
    }

    function lightning(a, b, force) {
      arcs.push(buildArc(
        cx + a.x * S, cy + a.y * S * SQUASH,
        cx + b.x * S, cy + b.y * S * SQUASH,
        Math.random() < 0.5 ? a.spec.hue2 : b.spec.hue2, force
      ));
    }

    /** Jagged arc between two tops, built by midpoint displacement. */
    function lightning(a, b, force) {
      const x0 = cx + a.x * S;
      const y0 = cy + a.y * S * SQUASH;
      const x1 = cx + b.x * S;
      const y1 = cy + b.y * S * SQUASH;
      const segs = 9;
      const pts = [];
      const spread = S * lerp(0.03, 0.1, force);
      for (let i = 0; i <= segs; i++) {
        const t = i / segs;
        const bow = Math.sin(t * Math.PI);
        pts.push({
          x: lerp(x0, x1, t) + rand(-spread, spread) * bow,
          y: lerp(y0, y1, t) + rand(-spread, spread) * bow
        });
      }
      const branches = [];
      const bn = force > 0.6 ? 3 : 1;
      for (let i = 0; i < bn; i++) {
        const at = Math.floor(rand(2, segs - 1));
        const from = pts[at];
        const bp = [{ x: from.x, y: from.y }];
        const dir = Math.random() * TAU;
        let px = from.x;
        let py = from.y;
        const steps = Math.floor(rand(2, 5));
        for (let k = 0; k < steps; k++) {
          px += Math.cos(dir + rand(-0.8, 0.8)) * spread * rand(0.6, 1.7);
          py += Math.sin(dir + rand(-0.8, 0.8)) * spread * rand(0.4, 1.2);
          bp.push({ x: px, y: py });
        }
        branches.push(bp);
      }
      arcs.push({
        pts: pts,
        branches: branches,
        life: 1,
        decay: rand(5.5, 8.5),
        hue: Math.random() < 0.5 ? a.spec.hue2 : b.spec.hue2,
        force: force
      });
    }

    function stepFx(dt) {
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.vy += 780 * dt;
        p.vx *= Math.exp(-2.1 * dt);
        p.vy *= Math.exp(-0.7 * dt);
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.life -= p.decay * dt;
        if (p.life <= 0) particles.splice(i, 1);
      }
      for (let i = arcs.length - 1; i >= 0; i--) {
        arcs[i].life -= arcs[i].decay * dt;
        if (arcs[i].life <= 0) arcs.splice(i, 1);
      }
      for (let i = waves.length - 1; i >= 0; i--) {
        const w = waves[i];
        w.life -= dt * 2.6;
        w.r = lerp(w.r, w.max, 1 - Math.exp(-9 * dt));
        if (w.life <= 0) waves.splice(i, 1);
      }
      shakeAmt *= Math.exp(-7 * dt);
      flashAmt *= Math.exp(-6.5 * dt);
      arenaGlow *= Math.exp(-3.4 * dt);
    }

    /* ============================================================ *
     * 8. Rendering
     * ============================================================ */

    function drawTop(t) {
      const sx = cx + t.x * S;
      const sy = cy + t.y * S * SQUASH - t.h * S;
      const R = t.spec.radius * S;
      const sn = spinNorm(t);

      // Reflection in the floor, mirrored about the contact point and fading
      // with distance. Cheap, and it does most of the work of making the bowl
      // read as a polished surface.
      const spr0 = getSprites(t.spec, R);
      if (!spr0.live && t.h < 0.25) {
        g.save();
        g.globalCompositeOperation = "lighter";
        g.globalAlpha = 0.10 * (1 - t.h * 4) * (0.35 + sn * 0.65);
        g.translate(cx + t.x * S, cy + t.y * S * SQUASH);
        g.scale(1, -SQUASH * 0.62);
        g.rotate(-t.theta);
        g.drawImage(spr0.blur, -spr0.size / 2, -spr0.size / 2, spr0.size, spr0.size);
        g.restore();
      }

      // Contact shadow.
      g.save();
      g.globalAlpha = clamp(0.62 - t.h * 0.6, 0.08, 0.62);
      const shR = R * 1.22 * (1 + t.h * 0.5);
      const shX = cx + t.x * S;
      const shY = cy + t.y * S * SQUASH;
      const sh = g.createRadialGradient(shX, shY, 0, shX, shY, shR);
      sh.addColorStop(0, "rgba(0,0,0,0.72)");
      sh.addColorStop(0.58, "rgba(0,0,0,0.38)");
      sh.addColorStop(1, "rgba(0,0,0,0)");
      g.fillStyle = sh;
      g.beginPath();
      g.ellipse(shX, shY, shR, shR * SQUASH, 0, 0, TAU);
      g.fill();
      g.restore();

      // Light pool cast on the floor.
      g.save();
      g.globalCompositeOperation = "lighter";
      const pool = g.createRadialGradient(sx, sy, 0, sx, sy, R * 2.6);
      pool.addColorStop(0, "hsla(" + t.spec.hue2 + ", 95%, 60%, " + (0.12 * (0.3 + sn * 0.7)).toFixed(3) + ")");
      pool.addColorStop(1, "hsla(" + t.spec.hue2 + ", 95%, 60%, 0)");
      g.fillStyle = pool;
      g.beginPath();
      g.ellipse(sx, sy, R * 2.6, R * 2.6 * SQUASH, 0, 0, TAU);
      g.fill();
      g.restore();

      // Wobble. As spin dies the top tilts off its tip and precesses.
      const wob = Math.pow(1 - sn, 2.2);
      const lean = wob * R * 0.42;
      const px = Math.cos(t.wobblePhase) * lean;
      const py = Math.sin(t.wobblePhase) * lean * SQUASH;
      const persp = clamp(SQUASH + wob * 0.3 * Math.sin(t.wobblePhase * 0.9), 0.32, 0.95);

      const spr = getSprites(t.spec, R);
      const blurMix = clamp((t.rpm - 1200) / 6200, 0, 0.70);

      g.save();
      g.translate(sx + px, sy + py);

      if (spr.live) {
        // No OffscreenCanvas: draw the blade directly, still rotating.
        g.save();
        g.rotate(t.theta);
        paintTop(g, t.spec, R, persp);
        g.restore();
      } else {
        const half = spr.size / 2;
        g.save();
        g.scale(1, persp / 1);
        g.rotate(t.theta);
        g.globalAlpha = 1 - blurMix * 0.72;
        g.drawImage(spr.sharp, -half, -half, spr.size, spr.size);
        if (blurMix > 0.02) {
          g.globalAlpha = blurMix * 0.85;
          g.drawImage(spr.blur, -half, -half, spr.size, spr.size);
        }
        g.globalAlpha = 1;
        g.restore();
      }

      // Fixed specular sweep -- light does not rotate with the top.
      g.save();
      g.globalCompositeOperation = "lighter";
      g.beginPath();
      g.ellipse(0, 0, R, R * persp, 0, 0, TAU);
      g.clip();
      const spec = g.createLinearGradient(-R, -R * persp, R * 0.5, R * persp);
      spec.addColorStop(0, "rgba(255,255,255,0.22)");
      spec.addColorStop(0.35, "rgba(255,255,255,0.05)");
      spec.addColorStop(1, "rgba(255,255,255,0)");
      g.fillStyle = spec;
      g.fillRect(-R, -R * persp, R * 2, R * persp * 2);
      g.restore();

      // Hit flash.
      if (t.hitFlash > 0.01) {
        g.save();
        g.globalCompositeOperation = "lighter";
        g.globalAlpha = t.hitFlash * 0.65;
        const fl = g.createRadialGradient(0, 0, 0, 0, 0, R * 1.7);
        fl.addColorStop(0, "rgba(255,255,255,0.9)");
        fl.addColorStop(0.4, "hsla(" + t.spec.hue2 + ", 100%, 70%, 0.5)");
        fl.addColorStop(1, "rgba(255,255,255,0)");
        g.fillStyle = fl;
        g.beginPath();
        g.ellipse(0, 0, R * 1.7, R * 1.7 * persp, 0, 0, TAU);
        g.fill();
        g.restore();
      }

      g.restore();

      // Player marker.
      if (t.isPlayer) {
        g.save();
        g.globalCompositeOperation = "lighter";
        g.strokeStyle = "rgba(255,255,255,0.55)";
        g.lineWidth = 1.6;
        g.beginPath();
        g.ellipse(sx, sy, R * 1.42, R * 1.42 * SQUASH, 0, 0, TAU);
        g.stroke();
        g.fillStyle = "rgba(255,255,255,0.85)";
        g.font = "600 " + Math.round(S * 0.055) + "px ui-sans-serif, system-ui, -apple-system, sans-serif";
        g.textAlign = "center";
        g.fillText("YOU", sx, sy - R * 1.75);
        g.restore();
      }
    }

    /** The currently-selected top, spinning in the empty arena on the title. */
    function drawHero() {
      const spec = chosen;
      const R = spec.radius * S * 1.3;
      const sx = cx;
      const sy = cy - S * 0.05;

      g.save();
      const heroShade = g.createRadialGradient(sx, cy + S * 0.02, 0, sx, cy + S * 0.02, R * 1.25);
      heroShade.addColorStop(0, "rgba(0,0,0,0.62)");
      heroShade.addColorStop(0.55, "rgba(0,0,0,0.34)");
      heroShade.addColorStop(1, "rgba(0,0,0,0)");
      g.fillStyle = heroShade;
      g.beginPath();
      g.ellipse(sx, cy + S * 0.02, R * 1.25, R * 1.25 * SQUASH, 0, 0, TAU);
      g.fill();
      g.restore();

      g.save();
      g.globalCompositeOperation = "lighter";
      const pool = g.createRadialGradient(sx, sy, 0, sx, sy, R * 2.8);
      pool.addColorStop(0, "hsla(" + spec.hue2 + ", 95%, 60%, 0.22)");
      pool.addColorStop(1, "hsla(" + spec.hue2 + ", 95%, 60%, 0)");
      g.fillStyle = pool;
      g.beginPath();
      g.ellipse(sx, sy, R * 2.8, R * 2.8 * SQUASH, 0, 0, TAU);
      g.fill();
      g.restore();

      const spr = getSprites(spec, R);
      g.save();
      g.translate(sx, sy);
      g.scale(1, SQUASH);
      g.rotate(introSpin * 1.9);
      if (spr.live) {
        paintTop(g, spec, R, 1);
      } else {
        const half = spr.size / 2;
        g.drawImage(spr.sharp, -half, -half, spr.size, spr.size);
        g.globalAlpha = 0.4;
        g.drawImage(spr.blur, -half, -half, spr.size, spr.size);
        g.globalAlpha = 1;
      }
      g.restore();
    }

    function drawTrails() {
      g.save();
      g.globalCompositeOperation = "lighter";
      for (const t of tops) {
        if (!t.alive || t.h > 0 || t.trail.length < 2) continue;
        for (let i = 1; i < t.trail.length; i++) {
          const p0 = t.trail[i - 1];
          const p1 = t.trail[i];
          const a = clamp(p1.life, 0, 1) * 0.22 * spinNorm(t);
          if (a <= 0.002) continue;
          g.strokeStyle = "hsla(" + t.spec.hue2 + ", 95%, 62%, " + a.toFixed(3) + ")";
          g.lineWidth = (i / t.trail.length) * t.spec.radius * S * 0.30;
          g.lineCap = "round";
          g.beginPath();
          g.moveTo(cx + p0.x * S, cy + p0.y * S * SQUASH);
          g.lineTo(cx + p1.x * S, cy + p1.y * S * SQUASH);
          g.stroke();
        }
      }
      g.restore();
    }

    function drawFx() {
      g.save();
      g.globalCompositeOperation = "lighter";

      // Lingering elemental fields, drawn under everything else.
      for (const z of zones) {
        const za = clamp(z.life, 0, 1);
        const zx = cx + z.x * S;
        const zy = cy + z.y * S * SQUASH;
        const zr = z.r * S;
        const zg = g.createRadialGradient(zx, zy, zr * 0.15, zx, zy, zr);
        zg.addColorStop(0, "hsla(" + z.hue + ", 95%, 62%, " + (0.30 * za).toFixed(3) + ")");
        zg.addColorStop(0.6, "hsla(" + z.hue + ", 95%, 55%, " + (0.16 * za).toFixed(3) + ")");
        zg.addColorStop(1, "hsla(" + z.hue + ", 95%, 50%, 0)");
        g.fillStyle = zg;
        g.beginPath();
        g.ellipse(zx, zy, zr, zr * SQUASH, 0, 0, TAU);
        g.fill();

        // Two counter-rotating rings so the field reads as active.
        for (let ri = 0; ri < 2; ri++) {
          const rr2 = zr * (0.55 + ri * 0.32);
          g.strokeStyle = "hsla(" + z.hue + ", 100%, 74%, " + (0.34 * za).toFixed(3) + ")";
          g.lineWidth = 1.6;
          g.setLineDash([zr * 0.16, zr * 0.12]);
          g.lineDashOffset = (ri ? -1 : 1) * z.spin * zr * 0.5;
          g.beginPath();
          g.ellipse(zx, zy, rr2, rr2 * SQUASH, 0, 0, TAU);
          g.stroke();
        }
        g.setLineDash([]);
      }

      // Expanding nova rings.
      for (const nv of novas) {
        const na = clamp(nv.life, 0, 1);
        const nx2 = cx + nv.x * S;
        const ny2 = cy + nv.y * S * SQUASH;
        const nr = nv.r * S;
        g.strokeStyle = "hsla(" + nv.hue + ", 100%, 72%, " + (na * 0.85).toFixed(3) + ")";
        g.lineWidth = Math.max(1, 12 * na * nv.power);
        g.beginPath();
        g.ellipse(nx2, ny2, nr, nr * SQUASH, 0, 0, TAU);
        g.stroke();
        g.strokeStyle = "rgba(255,255,255," + (na * 0.7).toFixed(3) + ")";
        g.lineWidth = Math.max(0.6, 3 * na);
        g.beginPath();
        g.ellipse(nx2, ny2, nr * 0.94, nr * 0.94 * SQUASH, 0, 0, TAU);
        g.stroke();
        const ng = g.createRadialGradient(nx2, ny2, 0, nx2, ny2, nr);
        ng.addColorStop(0, "hsla(" + nv.hue + ", 100%, 66%, " + (na * 0.30).toFixed(3) + ")");
        ng.addColorStop(1, "hsla(" + nv.hue + ", 100%, 60%, 0)");
        g.fillStyle = ng;
        g.beginPath();
        g.ellipse(nx2, ny2, nr, nr * SQUASH, 0, 0, TAU);
        g.fill();
      }

      for (const w of waves) {
        const a = clamp(w.life, 0, 1);
        g.strokeStyle = "rgba(200,235,255," + (a * 0.5).toFixed(3) + ")";
        g.lineWidth = Math.max(0.5, a * 4 * w.force + 0.5);
        g.beginPath();
        g.ellipse(w.x, w.y, w.r, w.r * SQUASH, 0, 0, TAU);
        g.stroke();
      }

      for (const arc of arcs) {
        const a = clamp(arc.life, 0, 1);
        const flick = 0.55 + Math.random() * 0.45;
        const paths = [arc.pts].concat(arc.branches);
        // Wide coloured glow, then a hot white core.
        for (let pass = 0; pass < 2; pass++) {
          g.strokeStyle = pass === 0
            ? "hsla(" + arc.hue + ", 100%, 65%, " + (a * 0.45 * flick).toFixed(3) + ")"
            : "rgba(255,255,255," + (a * 0.95 * flick).toFixed(3) + ")";
          g.lineWidth = pass === 0 ? S * 0.032 * arc.force + 2 : S * 0.008 + 1;
          g.lineJoin = "round";
          g.lineCap = "round";
          for (const path of paths) {
            g.beginPath();
            g.moveTo(path[0].x, path[0].y);
            for (let i = 1; i < path.length; i++) g.lineTo(path[i].x, path[i].y);
            g.stroke();
          }
        }
      }

      for (const p of particles) {
        const a = clamp(p.life, 0, 1);
        const len = clamp(Math.hypot(p.vx, p.vy) * 0.012, 1.5, 16);
        const ang = Math.atan2(p.vy, p.vx);
        const light = lerp(62, 100, p.hot * a);
        g.strokeStyle = "hsla(" + p.hue + ", 100%, " + light.toFixed(0) + "%, " + a.toFixed(3) + ")";
        g.lineWidth = lerp(0.8, 2.6, p.hot) * a + 0.4;
        g.lineCap = "round";
        g.beginPath();
        g.moveTo(p.x, p.y);
        g.lineTo(p.x - Math.cos(ang) * len, p.y - Math.sin(ang) * len);
        g.stroke();
      }

      g.restore();
    }

    function drawArena() {
      if (arenaSurf) {
        g.drawImage(arenaSurf, 0, 0, W, H);
      } else {
        g.save();
        g.translate(cx, cy);
        paintArena(g, S, 1);
        g.restore();
      }
    }

    /* ============================================================ *
     * 9. UI
     * ============================================================ */

    const UI = {
      font(size, weight) {
        return (weight || 600) + " " + Math.round(size) + "px ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif";
      },
      mono(size, weight) {
        return (weight || 700) + " " + Math.round(size) + "px ui-monospace, SFMono-Regular, Menlo, monospace";
      }
    };

    /**
     * Set g.font to the largest size at or below `size` that fits `text` into
     * `maxW`. Phone widths vary enough that fixed sizes overflow somewhere.
     */
    function fitFont(text, maxW, size, weight, mono) {
      let s = size;
      for (let i = 0; i < 10; i++) {
        g.font = mono ? UI.mono(s, weight) : UI.font(s, weight);
        if (g.measureText(text).width <= maxW || s < 7) break;
        s *= 0.92;
      }
      return s;
    }

    /** Dim the arena behind overlay UI so text stays legible over it. */
    function drawScrim(alpha) {
      g.save();
      g.fillStyle = "rgba(4,8,18," + alpha + ")";
      g.fillRect(0, 0, W, H);
      g.restore();
    }

    const buttons = [];

    function addButton(id, label, x, y, w, h, onTap, style) {
      buttons.push({ id, label, x, y, w, h, onTap, style: style || "primary", enabled: true });
    }

    function clearButtons() { buttons.length = 0; }

    function roundRect(gg, x, y, w, h, r) {
      const rr = Math.min(r, w / 2, h / 2);
      gg.beginPath();
      gg.moveTo(x + rr, y);
      gg.lineTo(x + w - rr, y);
      gg.quadraticCurveTo(x + w, y, x + w, y + rr);
      gg.lineTo(x + w, y + h - rr);
      gg.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
      gg.lineTo(x + rr, y + h);
      gg.quadraticCurveTo(x, y + h, x, y + h - rr);
      gg.lineTo(x, y + rr);
      gg.quadraticCurveTo(x, y, x + rr, y);
      gg.closePath();
    }

    function drawButton(b) {
      const isPrimary = b.style === "primary";
      const isGhost = b.style === "ghost";
      g.save();
      if (isPrimary) {
        const grad = g.createLinearGradient(b.x, b.y, b.x, b.y + b.h);
        grad.addColorStop(0, "rgba(120,205,255,0.96)");
        grad.addColorStop(1, "rgba(60,130,255,0.96)");
        g.fillStyle = grad;
        roundRect(g, b.x, b.y, b.w, b.h, b.h * 0.32);
        g.fill();
        g.strokeStyle = "rgba(220,245,255,0.75)";
        g.lineWidth = 1.4;
        g.stroke();
        g.fillStyle = "#04101f";
      } else if (isGhost) {
        g.fillStyle = "rgba(255,255,255,0.05)";
        roundRect(g, b.x, b.y, b.w, b.h, b.h * 0.32);
        g.fill();
        g.strokeStyle = "rgba(180,215,255,0.32)";
        g.lineWidth = 1.2;
        g.stroke();
        g.fillStyle = "rgba(215,235,255,0.92)";
      } else {
        g.fillStyle = "rgba(12,20,40,0.85)";
        roundRect(g, b.x, b.y, b.w, b.h, b.h * 0.32);
        g.fill();
        g.strokeStyle = "rgba(150,195,255,0.4)";
        g.lineWidth = 1.2;
        g.stroke();
        g.fillStyle = "rgba(225,240,255,0.95)";
      }
      g.font = UI.font(Math.min(b.h * 0.4, 19), 700);
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.fillText(b.label, b.x + b.w / 2, b.y + b.h / 2 + 0.5);
      g.restore();
    }

    function drawButtons() {
      // "card" buttons are painted by drawSelect; drawing the generic panel
      // over them would wash out their artwork.
      for (const b of buttons) {
        if (b.style === "card" || b.style === "chip" || b.style === "cast"
            || b.style === "forge" || b.style === "ability") continue;
        drawButton(b);
      }
    }

    /* ============================================================ *
     * 10. Game state
     * ============================================================ */

    let state = "intro";
    let chosen = ARCHETYPES[0];
    let introSpin = 0;
    let result = null;
    let resultMs = 0;
    let chargeMs = 0;
    let showHelp = false;
    let coachSeen = false;
    let showCoach = false;
    let coachMs = 0;
    let bestRPM = 0;
    let streak = 0;
    let bestScore = 0;
    let music = null;
    let musicOn = false;
    let launchInfo = null;

    /**
     * Fire a side-effect call that may be absent, may throw, and may or may
     * not hand back a promise. On a real device ctx.storage.set() returned
     * nothing, so a bare .catch() on the result took the whole bit down --
     * never assume a runtime call is thenable.
     */
    function titleCase(t) { return t.charAt(0) + t.slice(1).toLowerCase(); }

    function fireAndForget(thunk) {
      try {
        const r = thunk();
        if (r && typeof r.catch === "function") r.catch(() => {});
      } catch (err) { /* not supported on this runtime */ }
    }

    async function loadSaved() {
      if (!ctx.capabilities || !ctx.capabilities.storage || !ctx.storage) return;
      try {
        const s = await ctx.storage.get("ripcord");
        if (s && typeof s === "object") {
          bestRPM = Number(s.bestRPM) || 0;
          bestScore = Number(s.bestScore) || 0;
          coachSeen = !!s.coachSeen;
          const dsel = DIFFICULTIES.find(d => d.id === s.difficulty);
          if (dsel) difficulty = dsel;
          const pick = ARCHETYPES.find(a => a.id === s.top);
          if (pick) chosen = pick;
        }
      } catch (err) { /* first run, or no storage on this runtime */ }
    }

    function save() {
      if (!ctx.capabilities || !ctx.capabilities.storage || !ctx.storage) return;
      fireAndForget(() => ctx.storage.set("ripcord", {
        bestRPM: Math.round(bestRPM),
        bestScore: bestScore,
        top: chosen.id,
        difficulty: difficulty.id,
        coachSeen: coachSeen,
        build: myBuild
      }));
    }

    /** Submit to a leaderboard channel without ever letting it break play. */
    function submitRecord(channel, value, label) {
      if (!ctx.memory || typeof ctx.memory.record !== "function") return;
      fireAndForget(() => ctx.memory.record(channel).submit(value, { label: label }));
    }

    function startMusic() {
      if (musicOn || !ctx.capabilities || !ctx.capabilities.backgroundMusic) return;
      if (!ctx.music) return;
      musicOn = true;
      // unlock() is best-effort and must not prevent the bed from starting.
      fireAndForget(() => ctx.music.unlock());
      try {
        music = ctx.music.play({
          preset: "techno",
          volume: 0.32,
          tempo: 138,
          intensity: 0.5,
          scale: "minorPentatonic"
        });
      } catch (err) {
        musicOn = false;
      }
    }

    function setMusicIntensity(v) {
      if (!musicOn) return;
      try { ctx.music.setIntensity(clamp(v, 0, 1)); } catch (err) { /* not ready */ }
    }

    function duckMusic(force) {
      if (!musicOn) return;
      try { ctx.music.duck(clamp(force * 0.5, 0.1, 0.6), 180); } catch (err) { /* not ready */ }
    }

    function sting(name) {
      if (!musicOn) return;
      try { ctx.music.sting(name); } catch (err) { /* not ready */ }
    }

    function goSelect() {
      state = "select";
      layout();
    }

    /** First time through, teach the rip before asking for one. */
    function goCharge() {
      if (!coachSeen) { showCoach = true; coachMs = 0; layout(); return; }
      beginCharge();
    }

    async function beginCharge() {
      state = "charge";
      chargeMs = 0;
      spin.now = 0;
      spin.smooth = 0;
      spin.lastTilt = null;
      layout();
      const ok = await motionStart();
      if (!ok) {
        spin.denied = true;
      }
      openRipWindow();
      layout();
    }

    function goBattle() {
      const rpm = launchRPM();
      const power = launchPower();
      if (rpm > bestRPM) {
        bestRPM = rpm;
        save();
        submitRecord("launch_rpm", Math.round(rpm),
          Math.round(rpm).toLocaleString() + " RPM");
      }

      spin.window = false;
      launchInfo = {
        degPerSec: spin.peak,
        phoneRPM: phoneRPM(),
        rpm: rpm,
        source: spin.source,
        airMs: spin.bestAirMs
      };

      // Rival field: every top at or below the difficulty's tier, the playable
      // three included. Fielding only the *other* archetypes made picking
      // Stamina the one way never to face a Stamina top, which is the hardest
      // matchup, so it read as strictly the strongest choice.
      //
      // NOTE: this local must not be named `pool` -- see README, the upload
      // validator rejects the bit when a second local of that name exists.
      const diff = difficulty;
      const rivalPool = ROSTER.filter(t => t.tier <= diff.maxTier);
      const shuffled = rivalPool.slice();
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        const tmp = shuffled[i];
        shuffled[i] = shuffled[j];
        shuffled[j] = tmp;
      }
      // Bias the top tier toward the nastiest tops available.
      if (diff.maxTier >= 2) {
        shuffled.sort((a, b) => (b.tier - a.tier) * (Math.random() < 0.62 ? 1 : -1));
      }

      tops = [];
      tops.push(makeTop(chosen, rpm, -Math.PI / 2, true, "YOU", 1));
      const oppCount = diff.opps;
      for (let i = 0; i < oppCount; i++) {
        const spec = shuffled[i % shuffled.length];
        // Opponents scale off the rip, so how hard you spun is the dominant
        // term in whether you can win -- the whole point of the mechanic. The
        // elite roll seeds the occasional monster, so a huge rip is a strong
        // favourite rather than a formality.
        const roll = Math.random();
        const variance = roll < 0.26 ? rand(1.15, 1.45)
          : roll > 0.78 ? rand(0.60, 0.84)
          : 1;
        const oppRPM = clamp(
          lerp(3600, 9200, Math.random()) * (0.72 + power * 0.5) * variance * diff.rpmMul,
          MIN_RPM, MAX_RPM
        );
        const ang = -Math.PI / 2 + ((i + 1) / (oppCount + 1)) * TAU;
        tops.push(makeTop(spec, oppRPM, ang, false, spec.name, diff.skill));
      }
      for (const t of tops) t.h = 0.55 + Math.random() * 0.12;

      battleMs = 0;
      novas.length = 0;
      zones.length = 0;
      steer.on = false;
      result = null;
      state = "battle";
      sfxRip(power);
      startMusic();
      setMusicIntensity(0.55 + power * 0.4);
      haptic("heavy");
      shake(10);
      ctx.platform.setScore(Math.round(rpm));
      ctx.platform.interact({ type: "launch", rpm: Math.round(rpm), source: spin.source });
      layout();
    }

    function endBattle(win, reason) {
      state = "result";
      resultMs = 0;
      result = { win: win, reason: reason };
      for (const t of tops) killWhirr(t);
      if (win) {
        streak += 1;
        // Weighted by difficulty, so a Rookie streak cannot outrank a Legend
        // one, and stored as the score itself -- re-weighting an old Rookie run
        // would otherwise inflate it.
        const score = streak * difficulty.weight;
        if (score > bestScore) {
          bestScore = score;
          submitRecord("win_streak", score, streak + " on " + titleCase(difficulty.name));
        }
        sting("win");
        haptic("success");
        flash(0.35);
        ctx.platform.complete({ win: true, streak: streak, rpm: Math.round(launchInfo ? launchInfo.rpm : 0) });
      } else {
        streak = 0;
        sting("lose");
        haptic("error");
        ctx.platform.fail({ win: false, reason: reason });
      }
      save();
      setMusicIntensity(0.3);
      layout();
    }

    function checkEnd() {
      const live = tops.filter(t => t.alive);
      const player = tops.find(t => t.isPlayer);
      if (!player.alive) {
        if (live.length === 0) endBattle(false, "draw");
        else endBattle(false, player.out ? "ringout" : "spinout");
        return true;
      }
      if (live.length === 1 && live[0].isPlayer) {
        endBattle(true, "survivor");
        return true;
      }
      return false;
    }

    /* ============================================================ *
     * 11. Layout -- buttons rebuilt per state
     * ============================================================ */

    function layout() {
      clearButtons();
      const bw = Math.min(W * 0.68, 320);
      const bh = clamp(H * 0.068, 46, 60);
      const bottom = H - safeBottom() - bh - clamp(H * 0.035, 16, 34);

      if (showForge) {
        const rowH = clamp(H * 0.052, 36, 48);
        const gapY = clamp(H * 0.0135, 8, 13);
        const listX = W * 0.055;
        const listW = W * 0.89;
        let ry = safeTop() + clamp(H * 0.135, 96, 150);

        // Three presets across the top.
        const preW = (listW - 12) / 3;
        for (let i = 0; i < ABILITY_PRESETS.length; i++) {
          const pre = ABILITY_PRESETS[i];
          addButton("pre_" + pre.id, "", listX + i * (preW + 6), ry, preW, rowH, () => {
            myBuild = cloneBuild(pre.build);
            save();
            haptic("light");
            layout();
          }, "forge");
        }
        ry += rowH + gapY * 2.1;

        // One row per slot.
        const slots = [
          ["core", FORGE.core], ["element", FORGE.element], ["power", FORGE.power],
          ["reach", FORGE.reach], ["charge", FORGE.charge], ["rider", FORGE.rider]
        ];
        for (const [slot, parts] of slots) {
          const cellGap = 5;
          const cellW = (listW - cellGap * (parts.length - 1)) / parts.length;
          for (let i = 0; i < parts.length; i++) {
            const part = parts[i];
            addButton("fg_" + slot + "_" + part.id, "",
                      listX + i * (cellW + cellGap), ry, cellW, rowH, () => {
              haptic("light");
              if (slot === "rider") {
                const at = myBuild.riders.indexOf(part.id);
                if (at >= 0) myBuild.riders.splice(at, 1);
                else if (myBuild.riders.length < 2) myBuild.riders.push(part.id);
                else { myBuild.riders.shift(); myBuild.riders.push(part.id); }
              } else {
                myBuild[slot] = part.id;
              }
              // Never let a build exceed the budget: drop riders, then ease
              // the expensive slots, until it fits again.
              let guard = 0;
              while (forgeCost(myBuild) > FORGE_BUDGET && guard++ < 12) {
                if (myBuild.riders.length && slot !== "rider") myBuild.riders.pop();
                else if (myBuild.riders.length > 1) myBuild.riders.shift();
                else if (slot !== "charge" && myBuild.charge === "rapid") myBuild.charge = "steady";
                else if (slot !== "power" && myBuild.power === "savage") myBuild.power = "heavy";
                else if (slot !== "reach" && myBuild.reach === "far") myBuild.reach = "mid";
                else if (slot !== "charge" && myBuild.charge === "steady") myBuild.charge = "slow";
                else if (slot !== "power" && myBuild.power === "heavy") myBuild.power = "light";
                else if (slot !== "reach" && myBuild.reach === "mid") myBuild.reach = "near";
                else if (myBuild.riders.length) myBuild.riders.pop();
                else break;
              }
              save();
              layout();
            }, "forge");
          }
          ry += rowH + gapY;
        }

        addButton("forgedone", "DONE", (W - bw) / 2, bottom, bw, bh, () => {
          showForge = false;
          save();
          layout();
        });
        return;
      }

      if (showCoach) {
        addButton("coachgo", "GOT IT \u2014 RIP IT", (W - bw) / 2, bottom, bw, bh, () => {
          showCoach = false;
          coachSeen = true;
          save();
          beginCharge();
        });
        return;
      }

      if (showHelp) {
        addButton("close", "GOT IT", (W - bw) / 2, bottom, bw, bh, () => {
          showHelp = false;
          layout();
        });
        return;
      }

      if (state !== "battle") {
        addButton("help", "?", W - 46 - 14, safeTop() + 14, 46, 46, () => {
          showHelp = true;
          layout();
        }, "ghost");
      }

      if (state === "intro") {
        addButton("play", "TAP TO PLAY", (W - bw) / 2, bottom, bw, bh, () => {
          onFirstGesture();
          goSelect();
        });
      } else if (state === "select") {
        // Cards, then a difficulty row, then the launch button -- one screen,
        // so choosing a tier never costs an extra step.
        const cardH = clamp(H * 0.105, 70, 98);
        const gap = clamp(H * 0.016, 7, 14);
        const chipH = clamp(H * 0.058, 40, 52);
        const blockH = cardH * 3 + gap * 2 + chipH + clamp(H * 0.058, 40, 52) + bh + clamp(H * 0.13, 78, 128);
        const top = clamp(cy - blockH / 2 + clamp(H * 0.05, 18, 42),
                          safeTop() + clamp(H * 0.11, 78, 118), H);

        for (let i = 0; i < ARCHETYPES.length; i++) {
          const a = ARCHETYPES[i];
          const y = top + i * (cardH + gap);
          addButton("pick_" + a.id, "", W * 0.08, y, W * 0.84, cardH, () => {
            chosen = a;
            save();
            haptic("light");
            layout();
          }, "card");
        }

        const chipY = top + 3 * (cardH + gap) + clamp(H * 0.035, 22, 38);
        const chipGap = 7;
        const chipW = (W * 0.84 - chipGap * 3) / 4;
        for (let i = 0; i < DIFFICULTIES.length; i++) {
          const d = DIFFICULTIES[i];
          addButton("diff_" + d.id, "", W * 0.08 + i * (chipW + chipGap), chipY, chipW, chipH, () => {
            difficulty = d;
            save();
            haptic("light");
            layout();
          }, "chip");
        }

        const abilityY = chipY + chipH + clamp(H * 0.030, 18, 32);
        const abilityH = clamp(H * 0.058, 40, 52);
        addButton("forge", "", W * 0.08, abilityY, W * 0.84, abilityH, () => {
          showForge = true;
          forgeMs = 0;
          haptic("light");
          layout();
        }, "ability");

        addButton("go", "RIP", (W - bw) / 2, abilityY + abilityH + clamp(H * 0.024, 14, 26), bw, bh, () => {
          haptic("medium");
          goCharge();
        });
      } else if (state === "battle") {
        const castW = clamp(W * 0.46, 150, 210);
        const castH = clamp(H * 0.078, 54, 70);
        addButton("cast", "", (W - castW) / 2,
                  H - safeBottom() - castH - clamp(H * 0.022, 12, 26),
                  castW, castH, () => {
          const me = tops.find(t => t.isPlayer);
          if (me && !castSpecial(me)) haptic("warning");
        }, "cast");
      } else if (state === "charge") {
        if (spin.denied || (chargeMs > 7000 && !spin.live)) {
          // No usable motion: hand them a swipe ripcord instead.
          addButton("swipehint", "SWIPE THE RIPCORD BELOW", (W - bw) / 2, bottom - bh - 10, bw, bh, () => {}, "ghost");
        }
        if (spin.armed) {
          addButton("launch", "LAUNCH", (W - bw) / 2, bottom, bw, bh, () => goBattle());
        }
        addButton("back", "BACK", W * 0.08, safeTop() + 14, 84, 46, () => {
          spin.window = false;
          goSelect();
        }, "ghost");
      } else if (state === "result") {
        addButton("again", "RIP AGAIN", (W - bw) / 2, bottom, bw, bh, () => goCharge());
        addButton("change", "CHANGE TOP", (W - bw) / 2, bottom - bh - 10, bw, bh, () => goSelect(), "ghost");
      }
    }

    /* ============================================================ *
     * 12. Input
     * ============================================================ */

    let gestureDone = false;
    function onFirstGesture() {
      if (gestureDone) return;
      gestureDone = true;
      ctx.platform.start();
      audioInit();
      audioResume();
      startMusic();
    }

    // Swipe ripcord fallback: pointer speed stands in for angular speed.
    const swipe = { active: false, x: 0, y: 0, t: 0 };

    // Drag anywhere in the stadium during a battle to steer YOUR top toward
    // that spot. You never control the rivals.
    const steer = { on: false, x: 0, y: 0 };

    function pointerPos(e) {
      // offsetX/offsetY are already canvas-relative. Reading the layout rect
      // instead is rejected by the upload validator, and going through offsets
      // skips a forced reflow per pointer event anyway.
      return { x: e.offsetX, y: e.offsetY };
    }

    ctx.listen(canvas, "pointerdown", e => {
      e.preventDefault();
      onFirstGesture();
      audioResume();
      const p = pointerPos(e);

      for (let i = buttons.length - 1; i >= 0; i--) {
        const b = buttons[i];
        if (p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h) {
          haptic("light");
          b.onTap();
          return;
        }
      }

      if (state === "intro") { goSelect(); return; }
      if (state === "result" && resultMs > 900) { goCharge(); return; }
      if (state === "battle") {
        steer.on = true;
        steer.x = (p.x - cx) / S;
        steer.y = (p.y - cy) / (S * SQUASH);
        return;
      }
      if (state === "charge") {
        swipe.active = true;
        swipe.x = p.x;
        swipe.y = p.y;
        swipe.t = 0;
      }
    }, { passive: false });

    ctx.listen(canvas, "pointermove", e => {
      if (state === "battle" && steer.on) {
        e.preventDefault();
        const sp = pointerPos(e);
        steer.x = (sp.x - cx) / S;
        steer.y = (sp.y - cy) / (S * SQUASH);
        return;
      }
      if (!swipe.active || state !== "charge") return;
      e.preventDefault();
      const p = pointerPos(e);
      const dx = p.x - swipe.x;
      const dy = p.y - swipe.y;
      const dist = Math.hypot(dx, dy);
      const dt = Math.max(0.008, swipe.t);
      // Screen px/s mapped into the same deg/s scale the gyro reports.
      const equiv = (dist / dt) * 0.42;
      if (equiv > 60) feedSpin(equiv, "swipe");
      swipe.x = p.x;
      swipe.y = p.y;
      swipe.t = 0;
    }, { passive: false });

    const endSwipe = () => { swipe.active = false; steer.on = false; };
    ctx.listen(canvas, "pointerup", endSwipe);
    ctx.listen(canvas, "pointercancel", endSwipe);
    ctx.listen(canvas, "contextmenu", e => e.preventDefault());

    /* ============================================================ *
     * 13. Screen painters
     * ============================================================ */

    function drawTitle() {
      g.save();
      g.textAlign = "center";

      const titleY = clamp(H * 0.16, safeTop() + 60, H * 0.24);
      g.font = UI.font(Math.min(W * 0.155, 66), 800);
      const grad = g.createLinearGradient(0, titleY - 40, 0, titleY + 14);
      grad.addColorStop(0, "#dff2ff");
      grad.addColorStop(0.55, "#7fc6ff");
      grad.addColorStop(1, "#2f7cff");
      g.fillStyle = grad;
      g.fillText("RIPCORD", cx, titleY);

      g.font = UI.font(Math.min(W * 0.038, 15), 600);
      g.fillStyle = "rgba(175,205,245,0.8)";
      fitFont("SPIN THE PHONE. THE TOP SPINS WITH IT.", W * 0.86, Math.min(W * 0.038, 15), 600);
      g.fillText("SPIN THE PHONE. THE TOP SPINS WITH IT.", cx, titleY + clamp(W * 0.06, 22, 30));

      if (bestRPM > 0) {
        g.font = UI.mono(Math.min(W * 0.033, 13), 700);
        g.fillStyle = "rgba(140,180,230,0.65)";
        g.fillText("BEST RIP  " + Math.round(bestRPM).toLocaleString() + " RPM", cx, titleY + clamp(W * 0.115, 44, 56));
      }
      g.restore();
    }

    function drawSelect() {
      drawScrim(0.78);
      g.save();
      g.textAlign = "center";
      g.font = UI.font(Math.min(W * 0.055, 24), 800);
      g.fillStyle = "#e6f2ff";
      g.fillText("CHOOSE YOUR TOP", cx, safeTop() + clamp(H * 0.085, 62, 96));
      g.restore();

      for (const b of buttons) {
        if (b.style !== "card") continue;
        const a = ARCHETYPES.find(x => "pick_" + x.id === b.id);
        if (!a) continue;
        const sel = a.id === chosen.id;

        g.save();
        const grad = g.createLinearGradient(b.x, b.y, b.x + b.w, b.y + b.h);
        grad.addColorStop(0, "hsla(" + a.hue + ", 60%, 22%, " + (sel ? 0.95 : 0.6) + ")");
        grad.addColorStop(1, "hsla(" + a.hue2 + ", 55%, 12%, " + (sel ? 0.9 : 0.5) + ")");
        g.fillStyle = grad;
        roundRect(g, b.x, b.y, b.w, b.h, 16);
        g.fill();
        g.strokeStyle = sel
          ? "hsla(" + a.hue2 + ", 95%, 68%, 0.95)"
          : "rgba(140,180,235,0.22)";
        g.lineWidth = sel ? 2.2 : 1.2;
        g.stroke();

        // Live preview of the actual top, spinning.
        const pr = b.h * 0.34;
        const px = b.x + b.h * 0.52;
        const py = b.y + b.h / 2;
        g.save();
        g.translate(px, py);
        g.rotate(introSpin * (1 + ARCHETYPES.indexOf(a) * 0.35));
        const spr = getSprites(a, pr);
        if (spr.live) {
          paintTop(g, a, pr, 0.82);
        } else {
          g.drawImage(spr.sharp, -spr.size / 2, -spr.size / 2, spr.size, spr.size);
        }
        g.restore();

        g.textAlign = "left";
        g.textBaseline = "alphabetic";
        const tx = b.x + b.h * 1.02;
        fitFont(a.name, b.x + b.w - tx - 14, Math.min(b.h * 0.235, 19), 800);
        g.fillStyle = "#f4f9ff";
        g.fillText(a.name, tx, b.y + b.h * 0.4);

        g.font = UI.mono(Math.min(b.h * 0.15, 11), 700);
        g.fillStyle = "hsla(" + a.hue2 + ", 95%, 72%, 0.95)";
        g.fillText(a.role, tx, b.y + b.h * 0.6);

        fitFont(a.blurb, b.x + b.w - tx - 14, Math.min(b.h * 0.155, 12.5), 500);
        g.fillStyle = "rgba(190,215,246,0.86)";
        g.fillText(a.blurb, tx, b.y + b.h * 0.82);
        g.restore();
      }

      /* --- difficulty row --- */
      const chips = buttons.filter(b => b.style === "chip");
      if (!chips.length) return;

      g.save();
      g.textAlign = "left";
      g.font = UI.mono(Math.min(W * 0.028, 11), 800);
      g.fillStyle = "rgba(150,190,235,0.7)";
      g.fillText("DIFFICULTY", W * 0.08, chips[0].y - clamp(H * 0.014, 9, 15));

      for (const b of chips) {
        const d = DIFFICULTIES.find(x => "diff_" + x.id === b.id);
        if (!d) continue;
        const on = d.id === difficulty.id;

        const grad = g.createLinearGradient(b.x, b.y, b.x, b.y + b.h);
        grad.addColorStop(0, "hsla(" + d.hue + ", 70%, " + (on ? 34 : 15) + "%, " + (on ? 0.98 : 0.55) + ")");
        grad.addColorStop(1, "hsla(" + d.hue + ", 65%, " + (on ? 20 : 9) + "%, " + (on ? 0.98 : 0.5) + ")");
        g.fillStyle = grad;
        roundRect(g, b.x, b.y, b.w, b.h, 12);
        g.fill();
        g.strokeStyle = on
          ? "hsla(" + d.hue + ", 95%, 70%, 0.95)"
          : "rgba(140,180,235,0.20)";
        g.lineWidth = on ? 2 : 1.1;
        g.stroke();

        // Difficulty reads as filled pips, so the ladder is visible at a glance.
        const pips = DIFFICULTIES.indexOf(d) + 1;
        const pipR = Math.max(1.6, b.w * 0.026);
        const pipGap = pipR * 2.9;
        const px0 = b.x + b.w / 2 - (pipGap * (DIFFICULTIES.length - 1)) / 2;
        for (let k = 0; k < DIFFICULTIES.length; k++) {
          g.beginPath();
          g.arc(px0 + k * pipGap, b.y + b.h * 0.70, pipR, 0, TAU);
          g.fillStyle = k < pips
            ? (on ? "hsla(" + d.hue + ", 95%, 76%, 0.98)" : "rgba(160,195,240,0.55)")
            : "rgba(255,255,255,0.11)";
          g.fill();
        }

        g.textAlign = "center";
        fitFont(d.name, b.w - 8, Math.min(b.h * 0.28, 13), 800);
        g.fillStyle = on ? "#f2f8ff" : "rgba(196,216,242,0.72)";
        g.fillText(d.name, b.x + b.w / 2, b.y + b.h * 0.42);
      }

      // The ability row: what you are taking in, and a way into the forge.
      const abilityBtn = buttons.find(b => b.style === "ability");
      if (abilityBtn) {
        const built = resolveBuild(myBuild);
        g.save();
        g.fillStyle = "rgba(13,20,36,0.9)";
        roundRect(g, abilityBtn.x, abilityBtn.y, abilityBtn.w, abilityBtn.h, 13);
        g.fill();
        g.strokeStyle = "hsla(" + built.hue + ", 90%, 62%, 0.55)";
        g.lineWidth = 1.4;
        g.stroke();

        // Element swatch.
        const swR = abilityBtn.h * 0.28;
        const swX = abilityBtn.x + abilityBtn.h * 0.42;
        const swY = abilityBtn.y + abilityBtn.h / 2;
        const swg = g.createRadialGradient(swX, swY, 0, swX, swY, swR);
        swg.addColorStop(0, "hsla(" + built.hue + ", 100%, 76%, 1)");
        swg.addColorStop(1, "hsla(" + built.hue + ", 95%, 44%, 1)");
        g.fillStyle = swg;
        g.beginPath();
        g.arc(swX, swY, swR, 0, TAU);
        g.fill();

        g.textAlign = "left";
        const ax = abilityBtn.x + abilityBtn.h * 0.82;
        g.font = UI.mono(Math.min(abilityBtn.h * 0.21, 9.5), 800);
        g.fillStyle = "rgba(150,190,235,0.7)";
        g.fillText("ABILITY", ax, abilityBtn.y + abilityBtn.h * 0.36);
        fitFont(buildName(myBuild), abilityBtn.w - (ax - abilityBtn.x) - 68,
                Math.min(abilityBtn.h * 0.3, 14), 800);
        g.fillStyle = "#eef5ff";
        g.fillText(buildName(myBuild), ax, abilityBtn.y + abilityBtn.h * 0.74);

        g.textAlign = "right";
        g.font = UI.mono(Math.min(abilityBtn.h * 0.24, 11), 800);
        g.fillStyle = "hsla(" + built.hue + ", 95%, 72%, 0.95)";
        g.fillText("FORGE >", abilityBtn.x + abilityBtn.w - 14, abilityBtn.y + abilityBtn.h * 0.6);
        g.restore();
      }

      // One line describing the selected tier.
      g.textAlign = "center";
      const last = chips[chips.length - 1];
      fitFont(difficulty.blurb, W * 0.84, Math.min(W * 0.033, 13), 500);
      g.fillStyle = "hsla(" + difficulty.hue + ", 85%, 74%, 0.92)";
      g.fillText(difficulty.blurb, cx, last.y + last.h + clamp(H * 0.021, 14, 22));
      g.restore();
    }

    function drawGauge() {
      const gr = Math.min(W * 0.34, H * 0.2);
      const gx = cx;
      const gy = cy - clamp(H * 0.02, 6, 26);
      const a0 = Math.PI * 0.78;
      const a1 = Math.PI * 2.22;

      const shown = clamp(spin.smooth / RIP_CEIL, 0, 1);
      const peakN = clamp(spin.peak / RIP_CEIL, 0, 1);

      g.save();
      g.lineCap = "round";

      // Track.
      g.strokeStyle = "rgba(120,160,220,0.16)";
      g.lineWidth = gr * 0.15;
      g.beginPath();
      g.arc(gx, gy, gr, a0, a1);
      g.stroke();

      // Peak-so-far fill.
      if (peakN > 0.002) {
        const pg = g.createLinearGradient(gx - gr, gy, gx + gr, gy);
        pg.addColorStop(0, "rgba(80,190,255,0.55)");
        pg.addColorStop(1, "rgba(255,120,190,0.55)");
        g.strokeStyle = pg;
        g.lineWidth = gr * 0.15;
        g.beginPath();
        g.arc(gx, gy, gr, a0, a0 + (a1 - a0) * peakN);
        g.stroke();
      }

      // Live needle band.
      g.save();
      g.globalCompositeOperation = "lighter";
      g.strokeStyle = "rgba(190,240,255,0.95)";
      g.lineWidth = gr * 0.11;
      g.beginPath();
      g.arc(gx, gy, gr, a0, a0 + (a1 - a0) * shown);
      g.stroke();
      g.restore();

      // Peak tick.
      if (peakN > 0.01) {
        const pa = a0 + (a1 - a0) * peakN;
        g.save();
        g.globalCompositeOperation = "lighter";
        g.strokeStyle = "rgba(255,255,255,0.95)";
        g.lineWidth = 3;
        g.beginPath();
        g.moveTo(gx + Math.cos(pa) * gr * 0.86, gy + Math.sin(pa) * gr * 0.86);
        g.lineTo(gx + Math.cos(pa) * gr * 1.14, gy + Math.sin(pa) * gr * 1.14);
        g.stroke();
        g.restore();
      }

      // Readout: the measurement inside the dial, what it converts to below.
      // Keeping the conversion outside the ring stops the numbers colliding
      // with the arc at high values.
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.font = UI.mono(gr * 0.44, 800);
      g.fillStyle = "#eaf6ff";
      g.fillText(Math.round(spin.peak).toLocaleString(), gx, gy - gr * 0.10);

      g.font = UI.mono(gr * 0.135, 700);
      g.fillStyle = "rgba(150,190,235,0.85)";
      g.fillText("PEAK \u00b0/SEC", gx, gy + gr * 0.17);

      g.font = UI.mono(gr * 0.155, 800);
      g.fillStyle = "rgba(120,215,255,0.95)";
      g.fillText(Math.round(phoneRPM()).toLocaleString() + " RPM", gx, gy + gr * 0.40);

      // What that becomes, clear of the dial.
      const outY = gy + gr * 1.34;
      g.font = UI.mono(gr * 0.13, 700);
      g.fillStyle = "rgba(150,190,235,0.8)";
      g.fillText("LAUNCHES AT", gx, outY - gr * 0.22);

      g.font = UI.mono(gr * 0.30, 800);
      const lg = g.createLinearGradient(gx - gr, 0, gx + gr, 0);
      lg.addColorStop(0, "#7fd8ff");
      lg.addColorStop(1, "#ff8fd0");
      g.fillStyle = lg;
      g.fillText(Math.round(launchRPM()).toLocaleString() + " RPM", gx, outY + gr * 0.06);

      g.restore();
    }

    function drawCharge() {
      drawScrim(0.72);
      g.save();
      g.textAlign = "center";

      const headY = safeTop() + clamp(H * 0.075, 56, 88);
      g.font = UI.font(Math.min(W * 0.075, 32), 800);
      const pulse = 0.75 + 0.25 * Math.sin(chargeMs / 170);
      g.fillStyle = "rgba(235,248,255," + pulse.toFixed(2) + ")";
      g.fillText(spin.airborne ? "AIRBORNE!" : "RIP IT!", cx, headY);

      g.font = UI.font(Math.min(W * 0.036, 14), 600);
      g.fillStyle = "rgba(170,205,245,0.85)";
      let hint;
      if (spin.denied) {
        hint = "No motion sensor \u2014 swipe fast across the screen";
      } else if (spin.airborne) {
        hint = "flight " + (spin.airMs / 1000).toFixed(2) + "s \u2014 catch it";
      } else if (!spin.live) {
        hint = "waiting for the gyroscope\u2026";
      } else if (spin.source === "swipe") {
        hint = "swipe fast \u2014 or flick the phone";
      } else {
        hint = "flick your wrist hard, like a ripcord";
      }
      g.fillText(hint, cx, headY + clamp(W * 0.055, 20, 27));
      g.restore();

      drawGauge();

      // Source badge -- honest about which sensor path is live.
      g.save();
      g.textAlign = "center";
      const badgeY = H - safeBottom() - clamp(H * 0.19, 96, 150);
      const label = spin.source === "gyro" ? "GYROSCOPE"
        : spin.source === "tilt" ? "ORIENTATION (no gyro)"
        : spin.source === "swipe" ? "SWIPE FALLBACK"
        : "NO SIGNAL YET";
      g.font = UI.mono(Math.min(W * 0.03, 11.5), 700);
      const tw = g.measureText(label).width + 24;
      g.fillStyle = "rgba(10,18,36,0.8)";
      roundRect(g, cx - tw / 2, badgeY - 12, tw, 24, 12);
      g.fill();
      g.strokeStyle = spin.live ? "rgba(110,220,180,0.6)" : "rgba(150,180,220,0.3)";
      g.lineWidth = 1;
      g.stroke();
      g.fillStyle = spin.live ? "rgba(150,245,205,0.95)" : "rgba(170,195,230,0.7)";
      g.textBaseline = "middle";
      g.fillText(label, cx, badgeY);
      g.restore();

      // Swipe ripcord affordance.
      if (spin.denied || (chargeMs > 5200 && !spin.live)) {
        const ry = H - safeBottom() - clamp(H * 0.105, 62, 92);
        g.save();
        g.strokeStyle = "rgba(140,200,255,0.35)";
        g.lineWidth = 10;
        g.lineCap = "round";
        g.beginPath();
        g.moveTo(W * 0.14, ry);
        g.lineTo(W * 0.86, ry);
        g.stroke();
        const kx = W * 0.14 + (W * 0.72) * (0.5 + 0.5 * Math.sin(chargeMs / 420));
        g.fillStyle = "rgba(190,235,255,0.95)";
        g.beginPath();
        g.arc(kx, ry, 15, 0, TAU);
        g.fill();
        g.restore();
      }
    }

    function drawBattleHud() {
      const pad = clamp(W * 0.045, 14, 26);
      const top = safeTop() + clamp(H * 0.012, 6, 16);
      const n = Math.max(1, tops.length);
      // Column count is however many tops are in the stadium -- three rivals at
      // the top tiers means four columns, and the right-hand one must stay
      // clear of the help button.
      const gapX = n > 3 ? 6 : 8;
      const barW = (W - pad * 2 - gapX * (n - 1) - 62) / n;
      const barH = clamp(H * 0.008, 5, 8);
      const nameSize = Math.min(W * (n > 3 ? 0.024 : 0.027), 10.5);
      const numSize = Math.min(W * (n > 3 ? 0.023 : 0.026), 10);

      for (let i = 0; i < tops.length; i++) {
        const t = tops[i];
        const x = pad + i * (barW + gapX);
        const y = top + 26;

        g.save();
        g.textAlign = "left";
        g.textBaseline = "alphabetic";
        g.fillStyle = t.alive
          ? "hsla(" + t.spec.hue2 + ", 95%, 75%, 0.95)"
          : "rgba(120,140,170,0.5)";
        const name = t.isPlayer ? "YOU" : (t.spec.abbr || t.spec.name);
        fitFont(name, barW, nameSize, 800, true);
        g.fillText(name, x, y - 7);

        g.fillStyle = "rgba(255,255,255,0.08)";
        roundRect(g, x, y, barW, barH, barH / 2);
        g.fill();

        if (t.alive) {
          const frac = clamp(t.rpm / Math.max(t.rpm0, 1), 0, 1);
          const bg = g.createLinearGradient(x, 0, x + barW, 0);
          bg.addColorStop(0, "hsla(" + t.spec.hue + ", 90%, 55%, 0.95)");
          bg.addColorStop(1, "hsla(" + t.spec.hue2 + ", 95%, 70%, 0.95)");
          g.fillStyle = bg;
          roundRect(g, x, y, Math.max(barH, barW * frac), barH, barH / 2);
          g.fill();

          g.font = UI.mono(numSize, 700);
          g.fillStyle = "rgba(200,225,255,0.7)";
          g.fillText(Math.round(t.rpm).toLocaleString(), x, y + barH + 12);
        } else {
          const dead = t.out ? "RING OUT" : "SPUN OUT";
          fitFont(dead, barW, numSize, 700, true);
          g.fillStyle = "rgba(255,120,140,0.75)";
          g.fillText(dead, x, y + barH + 12);
        }
        g.restore();
      }

      /* --- steering marker --- */
      if (steer.on) {
        const mkx = cx + steer.x * S;
        const mky = cy + steer.y * S * SQUASH;
        g.save();
        g.globalCompositeOperation = "lighter";
        g.strokeStyle = "rgba(210,240,255,0.75)";
        g.lineWidth = 2;
        const pulse = 0.7 + 0.3 * Math.sin(battleMs / 110);
        g.beginPath();
        g.ellipse(mkx, mky, S * 0.055 * pulse, S * 0.055 * pulse * SQUASH, 0, 0, TAU);
        g.stroke();
        g.strokeStyle = "rgba(210,240,255,0.35)";
        g.lineWidth = 1.2;
        g.beginPath();
        g.ellipse(mkx, mky, S * 0.09, S * 0.09 * SQUASH, 0, 0, TAU);
        g.stroke();
        const me2 = tops.find(t => t.isPlayer);
        if (me2 && me2.alive) {
          g.strokeStyle = "rgba(190,230,255,0.22)";
          g.setLineDash([5, 6]);
          g.beginPath();
          g.moveTo(cx + me2.x * S, cy + me2.y * S * SQUASH);
          g.lineTo(mkx, mky);
          g.stroke();
          g.setLineDash([]);
        }
        g.restore();
      }

      /* --- special-attack button --- */
      const castBtn = buttons.find(b => b.id === "cast");
      const me = tops.find(t => t.isPlayer);
      if (castBtn && me) {
        const el = elementOf(me);
        const ready = me.charge >= 1 && me.alive;
        g.save();
        const cg = g.createLinearGradient(castBtn.x, castBtn.y, castBtn.x, castBtn.y + castBtn.h);
        if (ready) {
          cg.addColorStop(0, "hsla(" + el.hue + ", 92%, 58%, 0.96)");
          cg.addColorStop(1, "hsla(" + el.hue + ", 88%, 38%, 0.96)");
        } else {
          cg.addColorStop(0, "rgba(16,24,44,0.86)");
          cg.addColorStop(1, "rgba(10,16,32,0.86)");
        }
        g.fillStyle = cg;
        roundRect(g, castBtn.x, castBtn.y, castBtn.w, castBtn.h, castBtn.h * 0.3);
        g.fill();

        // Charge fills the button left to right while on cooldown.
        if (!ready) {
          g.save();
          roundRect(g, castBtn.x, castBtn.y, castBtn.w, castBtn.h, castBtn.h * 0.3);
          g.clip();
          g.fillStyle = "hsla(" + el.hue + ", 80%, 46%, 0.42)";
          g.fillRect(castBtn.x, castBtn.y, castBtn.w * clamp(me.charge, 0, 1), castBtn.h);
          g.restore();
        }

        g.strokeStyle = ready
          ? "hsla(" + el.hue + ", 100%, 78%, 0.95)"
          : "rgba(150,190,240,0.28)";
        g.lineWidth = ready ? 2.2 : 1.2;
        roundRect(g, castBtn.x, castBtn.y, castBtn.w, castBtn.h, castBtn.h * 0.3);
        g.stroke();

        g.textAlign = "center";
        g.textBaseline = "middle";
        fitFont(el.label, castBtn.w - 26, Math.min(castBtn.h * 0.36, 21), 800);
        g.fillStyle = ready ? "#07121f" : "rgba(190,215,245,0.78)";
        g.fillText(el.label, castBtn.x + castBtn.w / 2, castBtn.y + castBtn.h * 0.40);

        g.font = UI.mono(Math.min(castBtn.h * 0.19, 11), 700);
        g.fillStyle = ready ? "rgba(7,18,31,0.75)" : "rgba(150,185,230,0.6)";
        g.fillText(ready ? "TAP TO UNLEASH"
                         : Math.ceil((1 - me.charge) * elementOf(me).cool / 1000) + "s",
                   castBtn.x + castBtn.w / 2, castBtn.y + castBtn.h * 0.74);
        g.restore();
      }

      g.save();
      g.textAlign = "left";
      g.textBaseline = "alphabetic";
      g.font = UI.mono(Math.min(W * 0.028, 11), 800);
      const badgeY = top + 26 + barH + 34;
      g.fillStyle = "hsla(" + difficulty.hue + ", 90%, 72%, 0.9)";
      g.fillText(difficulty.name, pad, badgeY);
      if (streak > 0) {
        const dw = g.measureText(difficulty.name).width;
        g.fillStyle = "rgba(255,215,120,0.9)";
        g.fillText("STREAK " + streak, pad + dw + 14, badgeY);
      }
      g.restore();
    }

    function drawResult() {
      const t = clamp(resultMs / 420, 0, 1);
      const e = easeOut(t);
      g.save();
      g.globalAlpha = e;
      g.fillStyle = "rgba(4,8,20,0.72)";
      g.fillRect(0, 0, W, H);

      g.textAlign = "center";
      const midY = cy - clamp(H * 0.06, 20, 60);

      g.font = UI.font(Math.min(W * 0.135, 58), 800);
      const win = result && result.win;
      const grad = g.createLinearGradient(0, midY - 40, 0, midY + 12);
      if (win) {
        grad.addColorStop(0, "#fff6d8");
        grad.addColorStop(1, "#ffb43c");
      } else {
        grad.addColorStop(0, "#ffd8e2");
        grad.addColorStop(1, "#ff4d78");
      }
      g.fillStyle = grad;
      g.fillText(win ? "WIN" : "OUT", cx, midY * (0.6 + 0.4 * e) + midY * 0.4 * (1 - e));

      g.font = UI.font(Math.min(W * 0.04, 16), 600);
      g.fillStyle = "rgba(215,232,255,0.9)";
      const reason = !result ? ""
        : result.win ? "last top spinning"
        : result.reason === "ringout" ? "knocked out of the stadium"
        : result.reason === "draw" ? "everyone went down"
        : "ran out of spin";
      g.fillText(reason, cx, midY + clamp(W * 0.075, 28, 40));

      if (launchInfo) {
        const y = midY + clamp(W * 0.16, 62, 84);
        g.font = UI.mono(Math.min(W * 0.032, 12.5), 700);
        g.fillStyle = "rgba(140,185,235,0.8)";
        g.fillText(
          "PHONE " + Math.round(launchInfo.degPerSec).toLocaleString() + "\u00b0/s"
          + "   \u00b7   LAUNCH " + Math.round(launchInfo.rpm).toLocaleString() + " RPM",
          cx, y
        );
        if (launchInfo.airMs > 120) {
          g.fillStyle = "rgba(255,205,120,0.85)";
          g.fillText("AIRBORNE " + (launchInfo.airMs / 1000).toFixed(2) + "s", cx, y + 18);
        }
      }
      g.restore();
    }

    function drawCoach() {
      g.save();
      g.fillStyle = "#040916";
      g.fillRect(0, 0, W, H);

      const t = coachMs / 1000;
      // One snap per 1.9s: wind back slowly, whip through, settle.
      const cycle = (t % 1.9) / 1.9;
      let turn;
      if (cycle < 0.34) turn = -0.30 * (cycle / 0.34);
      else if (cycle < 0.52) turn = lerp(-0.30, 1.65, easeOut((cycle - 0.34) / 0.18));
      else turn = 1.65 * Math.exp(-(cycle - 0.52) * 7) * Math.cos((cycle - 0.52) * 26);
      const whipping = cycle >= 0.34 && cycle < 0.62;

      g.textAlign = "center";
      const headY = safeTop() + clamp(H * 0.085, 62, 96);
      g.font = UI.font(Math.min(W * 0.082, 35), 800);
      g.fillStyle = "#eef6ff";
      g.fillText("HOW TO RIP", cx, headY);

      fitFont("Your phone is the ripcord.", W * 0.84, Math.min(W * 0.042, 17), 600);
      g.fillStyle = "rgba(170,205,245,0.9)";
      g.fillText("Your phone is the ripcord.", cx, headY + clamp(W * 0.07, 26, 34));

      /* --- the animated phone --- */
      const px = cx;
      const py = cy - clamp(H * 0.10, 34, 96);
      const ph = clamp(Math.min(W * 0.40, H * 0.20), 108, 190);
      const pw = ph * 0.49;

      // Motion arcs sweeping through the turn.
      g.save();
      g.translate(px, py);
      g.globalCompositeOperation = "lighter";
      for (let i = 0; i < 3; i++) {
        const r = ph * (0.62 + i * 0.17);
        const a0 = -0.35;
        const a1 = a0 + turn;
        const alpha = (whipping ? 0.80 : 0.26) * (1 - i * 0.22);
        g.strokeStyle = "rgba(130,205,255," + alpha.toFixed(3) + ")";
        g.lineWidth = (whipping ? 7 : 3) - i * 0.7;
        g.lineCap = "round";
        g.beginPath();
        g.arc(0, 0, r, Math.min(a0, a1) - Math.PI / 2, Math.max(a0, a1) - Math.PI / 2);
        g.stroke();

        // Arrow head at the leading edge of the sweep.
        if (whipping) {
          const ah = Math.max(a0, a1) - Math.PI / 2;
          const hx = Math.cos(ah) * r;
          const hy = Math.sin(ah) * r;
          g.fillStyle = "rgba(190,235,255," + (alpha * 1.6).toFixed(3) + ")";
          g.save();
          g.translate(hx, hy);
          g.rotate(ah + Math.PI / 2);
          const ah2 = ph * 0.075;
          g.beginPath();
          g.moveTo(0, -ah2);
          g.lineTo(ah2 * 0.85, ah2 * 0.6);
          g.lineTo(-ah2 * 0.85, ah2 * 0.6);
          g.closePath();
          g.fill();
          g.restore();
        }
      }
      g.restore();

      // The phone itself.
      g.save();
      g.translate(px, py);
      g.rotate(turn);

      g.fillStyle = "rgba(0,0,0,0.5)";
      roundRect(g, -pw / 2 + 3, -ph / 2 + 5, pw, ph, pw * 0.20);
      g.fill();

      const shellGrad = g.createLinearGradient(-pw / 2, -ph / 2, pw / 2, ph / 2);
      shellGrad.addColorStop(0, "#2b3450");
      shellGrad.addColorStop(0.5, "#151c2e");
      shellGrad.addColorStop(1, "#333e5e");
      g.fillStyle = shellGrad;
      roundRect(g, -pw / 2, -ph / 2, pw, ph, pw * 0.20);
      g.fill();
      g.strokeStyle = "rgba(160,200,255,0.55)";
      g.lineWidth = 1.6;
      g.stroke();

      // Screen, lit brighter through the whip.
      const panelGrad = g.createLinearGradient(0, -ph / 2, 0, ph / 2);
      const lit = whipping ? 1 : 0.55;
      panelGrad.addColorStop(0, "rgba(120,205,255," + (0.55 * lit).toFixed(2) + ")");
      panelGrad.addColorStop(1, "rgba(60,120,255," + (0.30 * lit).toFixed(2) + ")");
      g.fillStyle = panelGrad;
      roundRect(g, -pw / 2 + pw * 0.11, -ph / 2 + pw * 0.15, pw * 0.78, ph - pw * 0.30, pw * 0.11);
      g.fill();

      // A little top spinning on the screen.
      g.save();
      g.translate(0, ph * 0.02);
      g.rotate(-turn + introSpin * 3);
      const spr = getSprites(chosen, pw * 0.26);
      if (spr.live) {
        paintTop(g, chosen, pw * 0.26, 0.9);
      } else {
        g.drawImage(spr.blur, -spr.size / 2, -spr.size / 2, spr.size, spr.size);
      }
      g.restore();
      g.restore();

      // Label the motion so the diagram is unambiguous.
      g.textAlign = "center";
      g.font = UI.mono(Math.min(W * 0.034, 13.5), 800);
      g.fillStyle = whipping ? "rgba(190,240,255,0.95)" : "rgba(130,175,225,0.55)";
      g.fillText(whipping ? "SNAP!" : "wind up", px, py + ph * 0.72);

      /* --- the words --- */
      const lines = [
        ["1", "Hold it flat, like a paper plane."],
        ["2", "Snap your wrist hard \u2014 jerk the phone round fast, then stop."],
        ["3", "The faster that snap, the faster your top spins."],
        ["4", "You never have to let go. Throwing it works, but is not needed."]
      ];
      let y = py + ph * 0.72 + clamp(H * 0.055, 34, 66);
      const pad = clamp(W * 0.09, 24, 44);
      g.textAlign = "left";
      for (const [n, text] of lines) {
        g.font = UI.mono(Math.min(W * 0.033, 13), 800);
        g.fillStyle = "rgba(120,205,255,0.95)";
        g.fillText(n, pad, y);

        g.font = UI.font(Math.min(W * 0.037, 15), 500);
        g.fillStyle = "rgba(206,226,250,0.94)";
        const maxW = W - pad * 2 - 22;
        let line = "";
        for (const word of text.split(" ")) {
          const test = line ? line + " " + word : word;
          if (g.measureText(test).width > maxW && line) {
            g.fillText(line, pad + 22, y);
            y += clamp(H * 0.024, 17, 22);
            line = word;
          } else {
            line = test;
          }
        }
        if (line) { g.fillText(line, pad + 22, y); y += clamp(H * 0.024, 17, 22); }
        y += clamp(H * 0.013, 7, 13);
      }
      g.restore();
    }

    /** Short human name for the current loadout, e.g. "SAVAGE STORM BOLT". */
    function buildName(build) {
      return forgePart("power", build.power).label + " " +
             forgePart("element", build.element).label + " " +
             forgePart("core", build.core).label;
    }

    /**
     * The forge. Three presets on top, then one row per slot. Core and element
     * are free; the sparks go on power, reach, charge and up to two riders,
     * which is where the one-strong-versus-two-cheap choice lives.
     */
    function drawForge() {
      g.save();
      g.fillStyle = "#070d18";
      g.fillRect(0, 0, W, H);

      const spent = forgeCost(myBuild);
      const left = FORGE_BUDGET - spent;
      const resolved = resolveBuild(myBuild);

      g.textAlign = "center";
      const headY = safeTop() + clamp(H * 0.055, 40, 66);
      g.font = UI.font(Math.min(W * 0.068, 29), 800);
      g.fillStyle = "#eef6ff";
      g.fillText("FORGE", cx, headY);

      // Sparks remaining, as pips.
      const pipR = Math.max(3, W * 0.011);
      const pipStep = pipR * 3.1;
      const pipX = cx - (pipStep * (FORGE_BUDGET - 1)) / 2;
      const pipY = headY + clamp(H * 0.026, 17, 26);
      for (let i = 0; i < FORGE_BUDGET; i++) {
        g.beginPath();
        g.arc(pipX + i * pipStep, pipY, pipR, 0, TAU);
        g.fillStyle = i < left ? "hsla(48, 100%, 66%, 0.98)" : "rgba(255,255,255,0.13)";
        g.fill();
      }
      g.font = UI.mono(Math.min(W * 0.029, 11.5), 700);
      g.fillStyle = "rgba(160,196,236,0.85)";
      g.fillText(left + " SPARK" + (left === 1 ? "" : "S") + " LEFT", cx, pipY + clamp(H * 0.026, 17, 25));

      const slotOf = id => id.slice(3, id.indexOf("_", 3));
      const partOf = id => id.slice(id.indexOf("_", 3) + 1);

      for (const b of buttons) {
        if (b.style !== "forge") continue;

        /* --- preset buttons --- */
        if (b.id.indexOf("pre_") === 0) {
          const pre = ABILITY_PRESETS.find(x => "pre_" + x.id === b.id);
          if (!pre) continue;
          const on = JSON.stringify(pre.build) === JSON.stringify(myBuild);
          const hue = forgePart("element", pre.build.element).hue;
          g.fillStyle = on ? "hsla(" + hue + ", 70%, 26%, 0.95)" : "rgba(16,24,42,0.9)";
          roundRect(g, b.x, b.y, b.w, b.h, 11);
          g.fill();
          g.strokeStyle = on ? "hsla(" + hue + ", 95%, 68%, 0.95)" : "rgba(140,180,235,0.22)";
          g.lineWidth = on ? 1.9 : 1;
          g.stroke();
          g.textAlign = "center";
          fitFont(pre.name, b.w - 8, Math.min(b.h * 0.30, 12.5), 800);
          g.fillStyle = on ? "#f2f8ff" : "rgba(190,214,244,0.8)";
          g.fillText(pre.name, b.x + b.w / 2, b.y + b.h * 0.62);
          continue;
        }

        /* --- slot chips --- */
        const slot = slotOf(b.id);
        const part = forgePart(slot, partOf(b.id));
        const isRider = slot === "rider";
        const chosen = isRider
          ? myBuild.riders.indexOf(part.id) >= 0
          : myBuild[slot] === part.id;
        // Grey out anything the remaining sparks cannot cover.
        const extra = isRider
          ? part.cost
          : part.cost - forgePart(slot, myBuild[slot]).cost;
        const affordable = chosen || extra <= left;
        const hue = slot === "element" ? part.hue : 205;

        g.fillStyle = chosen
          ? "hsla(" + hue + ", 68%, 30%, 0.95)"
          : (affordable ? "rgba(15,23,40,0.9)" : "rgba(11,16,28,0.75)");
        roundRect(g, b.x, b.y, b.w, b.h, 10);
        g.fill();
        g.strokeStyle = chosen
          ? "hsla(" + hue + ", 95%, 70%, 0.95)"
          : (affordable ? "rgba(140,180,235,0.20)" : "rgba(120,150,190,0.08)");
        g.lineWidth = chosen ? 1.9 : 1;
        g.stroke();

        g.textAlign = "center";
        const alpha = affordable ? 1 : 0.34;
        fitFont(part.label, b.w - 7, Math.min(b.h * 0.30, 12), 800);
        g.fillStyle = chosen
          ? "rgba(244,250,255," + alpha + ")"
          : "rgba(188,212,242," + (alpha * 0.85).toFixed(2) + ")";
        g.fillText(part.label, b.x + b.w / 2, b.y + b.h * (part.cost > 0 ? 0.44 : 0.6));

        if (part.cost > 0) {
          const dotR = Math.max(1.7, b.w * 0.022);
          const dotStep = dotR * 3;
          const dotX = b.x + b.w / 2 - (dotStep * (part.cost - 1)) / 2;
          const dotY = b.y + b.h * 0.73;
          g.fillStyle = "rgba(255,206,110," + (affordable ? 0.95 : 0.3) + ")";
          for (let k = 0; k < part.cost; k++) {
            g.beginPath();
            g.arc(dotX + k * dotStep, dotY, dotR, 0, TAU);
            g.fill();
          }
        }
      }

      /* --- slot labels down the left --- */
      const rowIds = ["core", "element", "power", "reach", "charge", "rider"];
      g.textAlign = "left";
      for (const slot of rowIds) {
        const first = buttons.find(b => b.style === "forge" && b.id.indexOf("fg_" + slot + "_") === 0);
        if (!first) continue;
        g.font = UI.mono(Math.min(W * 0.024, 9.5), 800);
        g.fillStyle = "rgba(140,178,222,0.62)";
        g.fillText(slot === "rider" ? "RIDERS (UP TO 2)" : slot.toUpperCase(),
                   W * 0.055, first.y - 4);
      }

      /* --- live preview of what you have built --- */
      const done = buttons.find(b => b.id === "forgedone");
      if (done) {
        const py2 = done.y - clamp(H * 0.062, 44, 66);
        g.textAlign = "center";
        fitFont(buildName(myBuild), W * 0.86, Math.min(W * 0.048, 20), 800);
        const ng = g.createLinearGradient(cx - W * 0.4, 0, cx + W * 0.4, 0);
        ng.addColorStop(0, "hsla(" + resolved.hue + ", 95%, 74%, 1)");
        ng.addColorStop(1, "hsla(" + ((resolved.hue + 40) % 360) + ", 95%, 68%, 1)");
        g.fillStyle = ng;
        g.fillText(buildName(myBuild), cx, py2);

        const bits = [
          Math.round(resolved.drain) + " drain",
          (resolved.cool / 1000).toFixed(1) + "s cooldown",
          myBuild.riders.length
            ? myBuild.riders.map(r => forgePart("rider", r).label.toLowerCase()).join(" + ")
            : "no riders"
        ];
        fitFont(bits.join("  .  "), W * 0.9, Math.min(W * 0.029, 11.5), 700, true);
        g.fillStyle = "rgba(158,192,232,0.85)";
        g.fillText(bits.join("  .  "), cx, py2 + clamp(H * 0.026, 17, 26));
      }
      g.restore();
    }

    function drawHelp() {
      g.save();
      g.fillStyle = "#040916";
      g.fillRect(0, 0, W, H);

      const pad = clamp(W * 0.09, 24, 46);
      let y = safeTop() + clamp(H * 0.085, 58, 100);

      g.textAlign = "left";
      g.font = UI.font(Math.min(W * 0.062, 26), 800);
      g.fillStyle = "#e9f4ff";
      g.fillText("HOW IT WORKS", pad, y);
      y += clamp(H * 0.045, 30, 44);

      const lines = [
        ["1", "Pick a top. Attack, Defense or Stamina \u2014 they beat each other in a circle."],
        ["2", "Spin the phone. The gyroscope reads your peak angular speed in degrees per second."],
        ["3", "That number becomes RPM. Launch spin is directly proportional to how hard you ripped."],
        ["4", "A hard wrist flick reads exactly the same as a throw \u2014 you never have to let go."],
        ["5", "Throws are detected too. Freefall shows as AIRBORNE, and the gyro keeps reading in flight."],
        ["6", "In the battle, drag anywhere to steer YOUR top. Drive it into the others."],
        ["7", "Every top has an element. When the bar fills, tap it to unleash the attack."],
        ["8", "Tap ABILITY on the select screen to forge your own: pick a shape, an element, and spend six sparks on power, reach, cooldown and up to two riders."],
        ["9", "Win by being the last top spinning, or knock the others out of the stadium."],
        ["10", "No sensor? Swipe fast across the ripcord instead."]
      ];

      for (const [n, text] of lines) {
        g.font = UI.mono(Math.min(W * 0.033, 13), 800);
        g.fillStyle = "rgba(120,205,255,0.95)";
        g.fillText(n, pad, y);

        g.font = UI.font(Math.min(W * 0.034, 13.5), 500);
        g.fillStyle = "rgba(200,222,248,0.92)";
        const words = text.split(" ");
        let line = "";
        const maxW = W - pad * 2 - 22;
        for (const w of words) {
          const test = line ? line + " " + w : w;
          if (g.measureText(test).width > maxW && line) {
            g.fillText(line, pad + 22, y);
            y += clamp(H * 0.024, 17, 21);
            line = w;
          } else {
            line = test;
          }
        }
        if (line) {
          g.fillText(line, pad + 22, y);
          y += clamp(H * 0.024, 17, 21);
        }
        y += clamp(H * 0.011, 6, 11);
      }
      g.restore();
    }

    function drawVignette() {
      g.save();
      const v = g.createRadialGradient(cx, cy, Math.min(W, H) * 0.32, cx, cy, Math.max(W, H) * 0.78);
      v.addColorStop(0, "rgba(0,0,0,0)");
      v.addColorStop(1, "rgba(6,10,6,0.42)");
      g.fillStyle = v;
      g.fillRect(0, 0, W, H);
      g.restore();
    }

    /* ============================================================ *
     * 14. Frame
     * ============================================================ */

    function resize() {
      const nw = ctx.width;
      const nh = ctx.height;
      if (nw === W && nh === H) return;
      W = nw;
      H = nh;
      cx = W / 2;
      cy = H * 0.54;
      S = Math.min(W * 0.42, H * 0.285);
      spriteCache.clear();
      arenaSurf = null;
      if (!petals.length) seedPetals();
      bakeArena();
      layout();
    }

    let clockSec = 0;

    function frame(dtMs) {
      const dt = clamp(dtMs / 1000, 0, 1 / 24);
      resize();

      clockSec += dt;
      const nowSec = clockSec;
      // Slow prevailing wind with an occasional gust.
      windNow = Math.sin(nowSec * 0.21) * 0.55
        + Math.sin(nowSec * 0.07 + 1.3) * 0.3
        + Math.max(0, Math.sin(nowSec * 0.043 - 0.6)) * 0.5;
      introSpin += dt * 1.6;

      if (state === "charge") {
        chargeMs += dtMs;
        tiltSample(dt);
        if (spin.airborne) spin.airMs += dtMs;

        // Decay the live reading so the needle falls back after the flick.
        spin.now *= Math.exp(-4.5 * dt);
        spin.smooth = lerp(spin.smooth, spin.now, 1 - Math.exp(-14 * dt));

        // Release detection: once a real rip has landed and the phone goes
        // quiet, launch. Wait for the landing if they actually threw it.
        if (spin.armed && !spin.airborne) {
          if (spin.now < spin.peak * 0.3) {
            spin.quietMs += dtMs;
            if (spin.quietMs > 230) goBattle();
          } else {
            spin.quietMs = 0;
          }
        }
      }

      if (state === "battle") {
        battleMs += dtMs;
        stepPhysics(dt);
        stepSpecials(dt);
        const player = tops.find(t => t.isPlayer);
        if (player) ctx.platform.setScore(Math.round(player.rpm));
        checkEnd();
        const liveN = tops.filter(t => t.alive).length;
        setMusicIntensity(clamp(0.35 + (3 - liveN) * 0.22, 0.3, 0.95));
      }

      if (state === "result") resultMs += dtMs;
      if (showCoach) coachMs += dtMs;
      if (showForge) forgeMs += dtMs;

      stepFx(dt);

      /* ---- paint ---- */
      g.save();
      if (shakeAmt > 0.3) {
        g.translate(rand(-shakeAmt, shakeAmt), rand(-shakeAmt, shakeAmt) * SQUASH);
      }

      if (!arenaSurf) {
        g.fillStyle = "#05070f";
        g.fillRect(-40, -40, W + 80, H + 80);
      }

      drawArena();
      drawArenaSheen(nowSec);
      drawPetals(dtMs / 16.7);
      if (state === "intro") drawHero();
      drawTrails();

      // Depth sort: farther up the screen draws first.
      const drawable = tops.slice().sort((a, b) => (a.y - a.h * 2) - (b.y - b.h * 2));
      for (const t of drawable) {
        if (t.alive || (state === "battle" && battleMs - t.deathMs < 400)) drawTop(t);
      }

      drawFx();
      g.restore();

      if (flashAmt > 0.004) {
        g.save();
        g.globalCompositeOperation = "lighter";
        g.fillStyle = "rgba(255,255,255," + clamp(flashAmt, 0, 0.75).toFixed(3) + ")";
        g.fillRect(0, 0, W, H);
        g.restore();
      }

      drawFronds(nowSec);
      drawVignette();

      if (state === "intro") drawTitle();
      else if (state === "select") drawSelect();
      else if (state === "charge") drawCharge();
      else if (state === "battle") drawBattleHud();
      else if (state === "result") { drawBattleHud(); drawResult(); }

      if (showForge) drawForge();
      else if (showCoach) drawCoach();
      else if (showHelp) drawHelp();
      drawButtons();
    }

    /* ============================================================ *
     * 15. Boot
     * ============================================================ */

    await loadSaved();
    resize();
    cy = H * 0.54;
    S = Math.min(W * 0.42, H * 0.285);
    bakeArena();
    layout();

    // Paint a real first frame before telling the host we are ready.
    frame(16);
    ctx.markVisualReady("arena");

    ctx.onFrame(frame);
    ctx.onDestroy(() => {
      for (const t of tops) killWhirr(t);
      if (musicOn) {
        try { ctx.music.stop({ fadeOutMs: 200 }); } catch (err) { /* already stopped */ }
      }
    });

    ctx.platform.ready();
  }
};
