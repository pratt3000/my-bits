// Wave Interference — a mobile-first Plethora Bit.
//
// Every finger you put down becomes a source radiating circular waves. Where
// crest meets crest the surface blazes; where crest meets trough it goes dark.
// Move the sources and the whole fringe pattern reorganises continuously.
//
// The field is summed per pixel in a fragment shader, with each colour channel
// reading it at a slightly offset phase — that is where the iridescence on the
// band edges comes from. The surface gradient is available analytically (the
// derivative of a sum of cosines is a sum of sines), so the crests get real
// specular lighting for almost nothing.
//
// The sound is the same physics in the audible band: one tone per source,
// detuned by the source separation, so the beating you hear is the fringe
// pattern you see.

window.plethoraBit = {
  meta: {
    title: "Wave Interference",
    runtime: "plethora-bit@2",
    tags: ["art", "fidget", "sensory", "generative", "touch", "physics", "relaxing"],
    permissions: ["audio", "haptics", "storage"]
  },

  async init(ctx) {
    const MAX_SRC = 6;      // shader source slots (4 fingers + 2 drifting sources)
    const MAX_PULSE = 3;    // concurrent tap ripples
    const MAX_TOUCH = 4;    // fingers that can hold a source at once

    // Each medium is a whole look: wavelength, wave speed, dispersion, a four
    // stop colour ramp from trough to crest, and a root note.
    const MODES = [
      {
        id: "abyss",
        name: "Abyss",
        lambda: 0.250, speed: 0.60, disp: 0.14, att: 3.4, gain: 0.62,
        c0: [0.012, 0.022, 0.052], c1: [0.035, 0.135, 0.300],
        c2: [0.180, 0.760, 0.900], c3: [1.000, 0.965, 0.880],
        glow: [0.40, 0.82, 1.0], spec: 0.75, bump: 0.85, root: 164.81
      },
      {
        id: "nebula",
        name: "Nebula",
        lambda: 0.195, speed: 0.76, disp: 0.18, att: 3.2, gain: 0.54,
        c0: [0.028, 0.012, 0.055], c1: [0.190, 0.060, 0.400],
        c2: [0.930, 0.260, 0.780], c3: [1.000, 0.945, 1.000],
        glow: [1.0, 0.45, 0.90], spec: 0.85, bump: 0.80, root: 220.00
      },
      {
        id: "ember",
        name: "Ember",
        lambda: 0.160, speed: 0.90, disp: 0.12, att: 3.8, gain: 0.66,
        c0: [0.040, 0.016, 0.010], c1: [0.400, 0.110, 0.028],
        c2: [1.000, 0.600, 0.180], c3: [1.000, 0.960, 0.820],
        glow: [1.0, 0.68, 0.28], spec: 1.00, bump: 0.90, root: 130.81
      }
    ];

    const FONT = "-apple-system,system-ui,'Segoe UI',Roboto,sans-serif";
    const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

    let modeIndex = 0;
    let muted = false;

    // ---- persisted preferences ---------------------------------------------
    if (ctx.capabilities.storage) {
      try {
        const saved = await ctx.storage.get("prefs");
        if (saved && typeof saved === "object") {
          const i = MODES.findIndex((m) => m.id === saved.mode);
          if (i >= 0) modeIndex = i;
          muted = saved.muted === true;
        }
      } catch (_) {}
    }
    function savePrefs() {
      if (!ctx.capabilities.storage) return;
      try { ctx.storage.set("prefs", { mode: MODES[modeIndex].id, muted }); } catch (_) {}
    }

    let mode = MODES[modeIndex];

    // ---- surfaces -----------------------------------------------------------
    const canvas = ctx.createCanvas({ touchAction: "none" });
    let gl = null;
    try {
      const opts = { alpha: false, antialias: false, depth: false, stencil: false, powerPreference: "high-performance" };
      gl = canvas.getContext("webgl2", opts) || canvas.getContext("webgl", opts) ||
           canvas.getContext("experimental-webgl", opts);
    } catch (_) { gl = null; }

    // Unit space: pixels / short edge, so a wavelength means the same thing on
    // every screen and distances stay isotropic.
    let unit = Math.min(ctx.width, ctx.height) || 1;
    let viewW = ctx.width / unit;
    let viewH = ctx.height / unit;

    // ---- sources ------------------------------------------------------------
    // A source is either held by a finger or free-drifting. Releasing a finger
    // hands the source its last velocity, so the waves keep going where you
    // threw them instead of stopping dead.
    const sources = [];
    for (let i = 0; i < MAX_SRC; i++) {
      sources.push({
        x: 0.5, y: 0.5, vx: 0, vy: 0,
        amp: 0, target: 0, phase: i * 1.7, fade: 2.2, rise: 6.5,
        pointer: null, free: false
      });
    }

    function seedDrifters() {
      const a = sources[0], b = sources[1];
      a.x = viewW * 0.34; a.y = viewH * 0.40; a.vx = 0.085; a.vy = 0.055;
      b.x = viewW * 0.68; b.y = viewH * 0.62; b.vx = -0.070; b.vy = -0.075;
      a.free = b.free = true;
      a.target = b.target = 1;
      a.amp = b.amp = 1;   // full amplitude on frame one: never a blank first frame
    }
    seedDrifters();

    function claimSource(pointerId, x, y) {
      // Prefer an unused slot, otherwise recycle the faintest free one.
      let pick = null;
      for (const s of sources) if (!s.pointer && s.target === 0 && s.amp < 0.02) { pick = s; break; }
      if (!pick) {
        for (const s of sources) {
          if (s.pointer) continue;
          if (!pick || s.amp < pick.amp) pick = s;
        }
      }
      if (!pick) return null;
      pick.pointer = pointerId;
      pick.free = false;
      pick.x = x; pick.y = y;
      pick.vx = 0; pick.vy = 0;
      pick.target = 1;
      pick.rise = 6.5;
      return pick;
    }

    // Interference needs two sources. If the field is down to one — after a tap,
    // or once a retiring source finally fades out — swell a fresh one in from
    // somewhere else on screen so the resting state is never a lone ripple.
    function ensureDrifters() {
      let live = 0;
      for (const s of sources) if (s.target > 0) live++;
      if (live >= 2) return;
      for (const s of sources) {
        if (live >= 2) break;
        if (s.pointer !== null || s.target > 0) continue;
        const a = Math.random() * 6.283;
        s.x = viewW * (0.22 + Math.random() * 0.56);
        s.y = viewH * (0.22 + Math.random() * 0.56);
        s.vx = Math.cos(a) * 0.09;
        s.vy = Math.sin(a) * 0.09;
        s.free = true;
        s.target = 1;
        s.rise = 0.85;   // swells in over a couple of seconds, never pops
        live++;
      }
    }

    // Once a finger is down it owns the field: the ambient sources bow out over
    // a couple of seconds rather than crowding the pattern the user is making.
    function yieldDrifters() {
      for (const s of sources) {
        if (s.pointer === null && s.free && s.amp > 0) {
          s.free = false;
          s.target = 0;
          s.fade = 1.5;
        }
      }
    }

    function releaseSource(s) {
      s.pointer = null;
      s.free = true;
      // Keep whatever speed the finger had, within reason.
      const sp = Math.hypot(s.vx, s.vy);
      if (sp > 0.9) { s.vx *= 0.9 / sp; s.vy *= 0.9 / sp; }
    }

    // Two free sources is the resting state; extras fade away over a few seconds.
    function trimFreeSources() {
      const free = sources.filter((s) => s.free);
      if (free.length <= 2) return;
      free.sort((a, b) => a.amp - b.amp);
      for (let i = 0; i < free.length - 2; i++) {
        free[i].free = false;
        free[i].target = 0;
        free[i].fade = 0.5;
      }
    }

    function stepSources(dt) {
      for (const s of sources) {
        if (s.pointer === null && !s.free) s.target = 0;
        // Amplitude eases toward its target: sources fade in and out, never pop.
        const rate = s.target > s.amp ? s.rise : s.fade;
        s.amp += (s.target - s.amp) * clamp(dt * rate, 0, 1);
        if (s.amp < 0.004 && s.target === 0) { s.amp = 0; s.free = false; s.fade = 2.2; }
        if (s.amp <= 0) continue;

        if (s.pointer === null) {
          // Anything no finger is holding drifts, including sources on their way
          // out, so nothing ever freezes in place while it fades.
          s.x += s.vx * dt;
          s.y += s.vy * dt;
          const m = 0.06;
          if (s.x < m) { s.x = m; s.vx = Math.abs(s.vx); }
          if (s.x > viewW - m) { s.x = viewW - m; s.vx = -Math.abs(s.vx); }
          if (s.y < m) { s.y = m; s.vy = Math.abs(s.vy); }
          if (s.y > viewH - m) { s.y = viewH - m; s.vy = -Math.abs(s.vy); }
          s.vx *= (1 - 0.35 * dt);
          s.vy *= (1 - 0.35 * dt);
          const sp = Math.hypot(s.vx, s.vy);
          const floor = 0.055;
          if (sp < floor) {
            const a = sp > 1e-5 ? Math.atan2(s.vy, s.vx) : Math.random() * 6.283;
            s.vx = Math.cos(a) * floor;
            s.vy = Math.sin(a) * floor;
          }
        }
      }
    }

    // ---- tap ripples --------------------------------------------------------
    const pulses = [];
    function addPulse(x, y) {
      if (pulses.length >= MAX_PULSE) pulses.shift();
      pulses.push({ x, y, r: 0.02, life: 0 });
    }
    function stepPulses(dt) {
      for (let i = pulses.length - 1; i >= 0; i--) {
        const p = pulses[i];
        p.r += dt * 0.85;
        p.life += dt;
        if (p.life > 2.6) pulses.splice(i, 1);
      }
    }

    // ---- shader -------------------------------------------------------------
    const VERT = [
      "attribute vec2 aPos;",
      "void main() { gl_Position = vec4(aPos, 0.0, 1.0); }"
    ].join("\n");

    const FRAG = [
      "#ifdef GL_FRAGMENT_PRECISION_HIGH",
      "precision highp float;",
      "#else",
      "precision mediump float;",
      "#endif",
      "#define MAX_SRC " + MAX_SRC,
      "#define MAX_PULSE " + MAX_PULSE,
      "uniform vec2 uRes;",
      "uniform float uUnit;",
      "uniform float uPhase;",
      "uniform float uK;",
      "uniform vec3 uChroma;",      // fixed per-channel phase offset (iridescence)
      "uniform float uAtt;",
      "uniform float uGain;",
      "uniform float uSpec;",
      "uniform float uBump;",
      "uniform vec4 uSrc[MAX_SRC];",    // xy position, z amplitude, w phase
      "uniform vec4 uPulse[MAX_PULSE];",// xy position, z radius, w strength
      "uniform vec3 uC0;",              // trough
      "uniform vec3 uC1;",
      "uniform vec3 uC2;",
      "uniform vec3 uC3;",              // crest
      "uniform vec3 uGlow;",
      "",
      // Sin-based hashing loses precision at four-digit fragment coordinates and
      // the "noise" comes back as coherent arcs across the screen. This one is
      // pure fract/dot, so it stays noise everywhere.
      "float hash21(vec2 p) {",
      "  vec3 p3 = fract(vec3(p.xyx) * 0.1031);",
      "  p3 += dot(p3, p3.yzx + 33.33);",
      "  return fract((p3.x + p3.y) * p3.z);",
      "}",
      "",
      // Trough to crest, four stops with overlapping smoothsteps so there is no
      // hard seam anywhere along the ramp.
      "vec3 ramp(float t) {",
      "  t = clamp(t, 0.0, 1.0);",
      "  vec3 c = mix(uC0, uC1, smoothstep(0.0, 0.52, t));",
      "  c = mix(c, uC2, smoothstep(0.46, 0.86, t));",
      // The top stop is deliberately hard to reach: only genuine constructive
      // peaks go incandescent, which is what keeps them worth looking at.
      "  c = mix(c, uC3, smoothstep(0.88, 1.0, t));",
      "  return c;",
      "}",
      "",
      "void main() {",
      "  vec2 p = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y) / uUnit;",
      "",
      "  vec3 h = vec3(0.0);",       // field height per colour channel
      "  vec2 grad = vec2(0.0);",    // analytic gradient of the green channel
      "  float energy = 0.0;",   // local wave strength, for gating the highlight
      "  vec3 halo = vec3(0.0);",
      "",
      "  for (int i = 0; i < MAX_SRC; i++) {",
      "    vec4 s = uSrc[i];",
      "    vec2 d = p - s.xy;",
      "    float r = length(d) + 1e-4;",
      // Cylindrical spreading: amplitude falls as 1/sqrt(distance).
      "    float att = s.z * inversesqrt(r * uAtt + 0.30);",
      // A fixed phase offset per channel, not a per-channel wavenumber: spreading
      // the wavenumbers would decorrelate the channels with distance and turn the
      // far field into rainbow confetti. This keeps the tint constant everywhere.
      "    float base = uK * r - uPhase + s.w;",
      "    vec3 ph = base + uChroma;",
      "    h += att * cos(ph);",
      "    grad += (d / r) * (-att * uK * sin(ph.g));",
      "    energy += att;",
      "    halo += uGlow * (s.z * exp(-r * 9.0) * 0.14);",
      "  }",
      "",
      "  for (int i = 0; i < MAX_PULSE; i++) {",
      "    vec4 q = uPulse[i];",
      "    float r = length(p - q.xy);",
      "    float d = r - q.z;",
      // A gaussian-enveloped wave packet: a single ring travelling outward.
      "    h += q.w * exp(-d * d * 70.0) * cos(uK * d + uChroma);",
      "  }",
      "",
      // Keep the field signed: a crest and a trough are different things, and
      // squaring would fold them together and double every fringe.
      "  vec3 f = h * uGain;",
      "  f = f / (1.0 + abs(f) * 0.38);",
      "  vec3 t = f * 0.5 + 0.5;",
      // Each channel reads the ramp at its own wavelength, so the dispersion
      // shows up as thin iridescence along the edge of every band.
      "  vec3 col = vec3(ramp(t.r).r, ramp(t.g).g, ramp(t.b).b);",
      "",
      // Light the surface using the analytic gradient: crests catch a highlight.
      "  vec3 n = normalize(vec3(-grad * uBump, 1.0));",
      "  vec3 lig = normalize(vec3(-0.42, -0.66, 0.62));",
      "  vec3 hv = normalize(lig + vec3(0.0, 0.0, 1.0));",
      "  float spec = pow(max(dot(n, hv), 0.0), 14.0) * uSpec;",
      // Only the upper half of the wave catches the light, and only where the
      // water is actually moving: a calm far field should read matte, not
      // scratched with stray highlights.
      "  spec *= smoothstep(0.34, 0.86, t.g) * smoothstep(0.95, 1.80, energy);",
      "  col += spec * (0.55 + 0.45 * uGlow);",
      "  col += halo;",
      "",
      // Vignette, then a touch of dither so the smooth ramps do not band.
      "  vec2 q = (gl_FragCoord.xy / uRes) - 0.5;",
      "  q.x *= uRes.x / uRes.y;",
      "  col *= 1.0 - 0.42 * pow(clamp(length(q) * 1.25, 0.0, 1.0), 2.2);",
      "  col += (hash21(gl_FragCoord.xy) - 0.5) * 0.0085;",
      "",
      "  gl_FragColor = vec4(max(col, 0.0), 1.0);",
      "}"
    ].join("\n");

    function compile(type, src) {
      const sh = gl.createShader(type);
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
        const log = gl.getShaderInfoLog(sh);
        gl.deleteShader(sh);
        throw new Error("shader: " + log);
      }
      return sh;
    }

    let program = null, uni = null, srcBuf = null, pulseBuf = null;

    function buildProgram() {
      const vs = compile(gl.VERTEX_SHADER, VERT);
      const fs = compile(gl.FRAGMENT_SHADER, FRAG);
      const prog = gl.createProgram();
      gl.attachShader(prog, vs);
      gl.attachShader(prog, fs);
      gl.linkProgram(prog);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
        const log = gl.getProgramInfoLog(prog);
        gl.deleteProgram(prog);
        throw new Error("link: " + log);
      }
      program = prog;
      gl.useProgram(prog);

      const quad = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, quad);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      const loc = gl.getAttribLocation(prog, "aPos");
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

      uni = {};
      for (const name of ["uRes", "uUnit", "uPhase", "uK", "uChroma", "uAtt", "uGain",
                          "uSpec", "uBump", "uC0", "uC1", "uC2", "uC3", "uGlow"]) {
        uni[name] = gl.getUniformLocation(prog, name);
      }
      uni.uSrc = gl.getUniformLocation(prog, "uSrc[0]");
      uni.uPulse = gl.getUniformLocation(prog, "uPulse[0]");
      srcBuf = new Float32Array(MAX_SRC * 4);
      pulseBuf = new Float32Array(MAX_PULSE * 4);

      ctx.onDestroy(() => {
        try {
          gl.deleteBuffer(quad);
          gl.deleteProgram(prog);
        } catch (_) {}
      });
    }

    let glReady = false;
    if (gl) {
      try { buildProgram(); glReady = true; }
      catch (e) { glReady = false; try { ctx.platform.error({ reason: "gl_init", message: String(e && e.message || e) }); } catch (_) {} }
    }

    // ---- 2D fallback --------------------------------------------------------
    // No WebGL: paint the same field on a small buffer and let the browser
    // upscale it. Softer and slower, but the bit is never blank.
    let fb = null;
    if (!glReady) {
      const c2 = ctx.createCanvas2D({ touchAction: "none" });
      const g2 = c2.getContext("2d");
      const FW = 84;
      let FH = 84;
      const img = { data: null, w: FW, h: FH };
      fb = {
        canvas: c2,
        draw(phase) {
          FH = Math.max(24, Math.round(FW * (ctx.height / Math.max(1, ctx.width))));
          if (!img.data || img.h !== FH) {
            img.data = g2.createImageData(FW, FH);
            img.h = FH;
          }
          const px = img.data.data;
          const k = 6.28318 / mode.lambda;
          const scale = viewW / FW;
          const smooth = (e0, e1, x) => {
            const t = clamp((x - e0) / (e1 - e0), 0, 1);
            return t * t * (3 - 2 * t);
          };
          for (let yy = 0; yy < FH; yy++) {
            for (let xx = 0; xx < FW; xx++) {
              const px0 = xx * scale, py0 = yy * scale;
              let h = 0;
              for (const s of sources) {
                if (s.amp <= 0) continue;
                const r = Math.hypot(px0 - s.x, py0 - s.y) + 1e-4;
                h += (s.amp / Math.sqrt(r * mode.att + 0.3)) * Math.cos(k * r - phase + s.phase);
              }
              const f = h * mode.gain;
              const t = (f / (1 + Math.abs(f) * 0.38)) * 0.5 + 0.5;
              const o = (yy * FW + xx) * 4;
              const a = smooth(0, 0.52, t), b = smooth(0.46, 0.86, t), c = smooth(0.88, 1, t);
              for (let ch = 0; ch < 3; ch++) {
                let v = mode.c0[ch] + (mode.c1[ch] - mode.c0[ch]) * a;
                v += (mode.c2[ch] - v) * b;
                v += (mode.c3[ch] - v) * c;
                px[o + ch] = clamp(v, 0, 1) * 255;
              }
              px[o + 3] = 255;
            }
          }
          g2.putImageData(img.data, 0, 0);
          g2.save();
          g2.imageSmoothingEnabled = true;
          g2.drawImage(c2, 0, 0, FW, FH, 0, 0, ctx.width, ctx.height);
          g2.restore();
        }
      };
    }

    // ---- audio --------------------------------------------------------------
    // Two oscillators, one per dominant source, detuned by how far apart the
    // sources are. Close together: a slow, wide swell. Far apart: fast shimmer.
    // That beat rate is the audible twin of the fringe spacing on screen.
    let ac = null, master = null, wet = null, audioFailed = false;
    let voices = [], pad = null, wash = null, washGain = null;

    function buildAudio() {
      if (audioFailed || !ctx.capabilities.audio) return null;
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) { audioFailed = true; return null; }
      try { ac = new AC(); } catch (_) { audioFailed = true; return null; }

      master = ac.createGain();
      master.gain.value = muted ? 0 : 0.9;
      const comp = ac.createDynamicsCompressor();
      comp.threshold.value = -16; comp.ratio.value = 3.2;
      comp.attack.value = 0.004; comp.release.value = 0.3;
      master.connect(comp);
      comp.connect(ac.destination);

      // A little reverb-ish bloom from a short generated impulse.
      wet = ac.createGain();
      wet.gain.value = 0.34;
      try {
        const conv = ac.createConvolver();
        const len = Math.floor(ac.sampleRate * 1.9);
        const buf = ac.createBuffer(2, len, ac.sampleRate);
        for (let c = 0; c < 2; c++) {
          const d = buf.getChannelData(c);
          for (let i = 0; i < len; i++) {
            d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6) * 0.5;
          }
        }
        conv.buffer = buf;
        wet.connect(conv);
        conv.connect(master);
      } catch (_) {
        wet.connect(master);
      }

      function mkVoice(freq, panX) {
        const out = ac.createGain();
        out.gain.value = 0;
        let panner = null;
        try {
          panner = ac.createStereoPanner();
          panner.pan.value = panX;
          out.connect(panner);
          panner.connect(master);
          panner.connect(wet);
        } catch (_) {
          out.connect(master);
          out.connect(wet);
        }
        const osc = ac.createOscillator();
        osc.type = "sine";
        osc.frequency.value = freq;
        const oGain = ac.createGain();
        oGain.gain.value = 0.6;
        osc.connect(oGain); oGain.connect(out);
        // An octave partial keeps the beating audible on phone speakers, which
        // roll off hard below ~250 Hz.
        const oct = ac.createOscillator();
        oct.type = "sine";
        oct.frequency.value = freq * 2;
        const octGain = ac.createGain();
        octGain.gain.value = 0.24;
        oct.connect(octGain); octGain.connect(out);
        const fifth = ac.createOscillator();
        fifth.type = "sine";
        fifth.frequency.value = freq * 3;
        const fifthGain = ac.createGain();
        fifthGain.gain.value = 0.07;
        fifth.connect(fifthGain); fifthGain.connect(out);
        osc.start(); oct.start(); fifth.start();
        return { out, osc, oct, fifth, panner };
      }

      voices = [mkVoice(mode.root, -0.35), mkVoice(mode.root, 0.35)];

      // Sub drone for weight.
      pad = (function () {
        const out = ac.createGain();
        out.gain.value = 0.0;
        const lp = ac.createBiquadFilter();
        lp.type = "lowpass"; lp.frequency.value = 320; lp.Q.value = 0.7;
        out.connect(lp); lp.connect(master); lp.connect(wet);
        const a = ac.createOscillator(); a.type = "triangle"; a.frequency.value = mode.root / 2;
        const b = ac.createOscillator(); b.type = "sine"; b.frequency.value = mode.root / 2 * 1.005;
        const ag = ac.createGain(); ag.gain.value = 0.5;
        a.connect(ag); b.connect(ag); ag.connect(out);
        a.start(); b.start();
        return { out, a, b };
      })();

      // Filtered noise that opens up as the sources move: the sound of water.
      washGain = ac.createGain();
      washGain.gain.value = 0;
      const bp = ac.createBiquadFilter();
      bp.type = "bandpass"; bp.frequency.value = 900; bp.Q.value = 0.8;
      washGain.connect(bp); bp.connect(master); bp.connect(wet);
      const nb = ac.createBuffer(1, Math.floor(ac.sampleRate * 2), ac.sampleRate);
      const nd = nb.getChannelData(0);
      for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
      const ns = ac.createBufferSource();
      ns.buffer = nb; ns.loop = true;
      ns.connect(washGain);
      ns.start();
      wash = { src: ns, bp };

      ctx.onDestroy(() => { try { ac.close(); } catch (_) {} });
      return ac;
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

    // Mobile WebViews hand back a suspended context; only a real gesture frees it.
    function unlockAudio() {
      if (!ac && !buildAudio()) return;
      tryResume();
      try {
        const b = ac.createBuffer(1, 1, ac.sampleRate || 22050);
        const s = ac.createBufferSource();
        s.buffer = b; s.connect(ac.destination); s.start(0);
      } catch (_) {}
    }

    function setParam(param, value, tc) {
      if (!param) return;
      try { param.setTargetAtTime(value, ac.currentTime, tc); }
      catch (_) { try { param.value = value; } catch (__) {} }
    }

    function bell(freq, panX) {
      if (!ac || ac.state !== "running" || muted) return;
      try {
        const o = ac.createOscillator();
        o.type = "sine";
        o.frequency.value = freq;
        const g = ac.createGain();
        const t = ac.currentTime;
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.16, t + 0.012);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 1.5);
        o.connect(g);
        let node = g;
        try {
          const p = ac.createStereoPanner();
          p.pan.value = clamp(panX, -1, 1);
          g.connect(p);
          node = p;
        } catch (_) {}
        node.connect(master);
        node.connect(wet);
        o.start(t);
        o.stop(t + 1.6);
      } catch (_) {}
    }

    // Retunes the two voices against the current pair of sources, throttled well
    // below frame rate so parameter changes stay glitch-free.
    let audioClock = 0;
    let beatHz = 0;
    function updateAudio(dt, motion) {
      if (!ac || ac.state !== "running" || !voices.length) return;
      audioClock += dt;
      if (audioClock < 0.05) return;
      audioClock = 0;

      // Fingers speak first: a held source outranks a drifting one regardless of
      // amplitude, so the two tones are the two sources the player is moving.
      const lit = sources.filter((s) => s.amp > 0.01);
      const held = lit.filter((s) => s.pointer !== null).sort((x, y) => y.amp - x.amp);
      const loose = lit.filter((s) => s.pointer === null).sort((x, y) => y.amp - x.amp);
      const live = held.concat(loose);
      const a = live[0] || null;
      const b = live[1] || null;

      const sep = a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
      // Fringe spacing goes as 1/separation, so separation maps to beat rate.
      beatHz = clamp(0.12 + sep * 5.6, 0.12, 8.5);

      const targets = [a, b];
      for (let i = 0; i < voices.length; i++) {
        const v = voices[i];
        const s = targets[i];
        const amp = s ? clamp(s.amp, 0, 1) : 0;
        setParam(v.out.gain, amp * 0.16, 0.09);
        if (s) {
          const f = i === 0 ? mode.root : mode.root + beatHz;
          setParam(v.osc.frequency, f, 0.07);
          setParam(v.oct.frequency, f * 2, 0.07);
          setParam(v.fifth.frequency, f * 3, 0.07);
          if (v.panner) setParam(v.panner.pan, clamp((s.x / viewW) * 2 - 1, -1, 1) * 0.7, 0.09);
        }
      }

      const present = (a ? a.amp : 0) + (b ? b.amp : 0);
      setParam(pad.out.gain, clamp(present * 0.05, 0, 0.1), 0.35);
      setParam(washGain.gain, clamp(motion * 0.05, 0, 0.05), 0.18);
      if (wash) setParam(wash.bp.frequency, 700 + clamp(motion, 0, 12) * 220, 0.25);
    }

    function applyModeToAudio() {
      if (!ac || !voices.length) return;
      setParam(voices[0].osc.frequency, mode.root, 0.08);
      setParam(voices[0].oct.frequency, mode.root * 2, 0.08);
      setParam(voices[0].fifth.frequency, mode.root * 3, 0.08);
      setParam(pad.a.frequency, mode.root / 2, 0.15);
      setParam(pad.b.frequency, mode.root / 2 * 1.005, 0.15);
    }

    // ---- overlay ------------------------------------------------------------
    // Built as markup on the runtime-owned root, then queried back out; bits may
    // not reach into the host DOM directly.
    const ui = ctx.createRoot({ touchAction: "none" });
    ui.style.pointerEvents = "none";

    const top = Math.round(ctx.safeArea.top + 12);
    const BTN =
      "pointer-events:auto;min-width:42px;height:42px;padding:0 12px;border-radius:14px;border:none;" +
      "cursor:pointer;background:rgba(12,18,32,0.52);color:#e8f2ff;font-size:14px;font-weight:600;" +
      "line-height:1;font-family:" + FONT + ";backdrop-filter:blur(9px);-webkit-backdrop-filter:blur(9px);" +
      "box-shadow:0 2px 14px rgba(0,0,0,0.45),inset 0 0 0 1px rgba(255,255,255,0.10);" +
      "display:flex;align-items:center;justify-content:center;letter-spacing:0.2px;";

    ui.innerHTML =
      '<div data-el="chips" style="position:absolute;right:12px;top:' + top + 'px;display:flex;gap:8px;">' +
        '<button data-el="mode" style="' + BTN + '"></button>' +
        '<button data-el="mute" style="' + BTN + '"></button>' +
        '<button data-el="info" style="' + BTN + '">?</button>' +
      '</div>' +
      '<div data-el="hint" style="position:absolute;left:0;right:0;top:' + (top + 58) + 'px;text-align:center;' +
        'pointer-events:none;font-family:' + FONT + ';font-size:13px;color:rgba(226,240,255,0.82);' +
        'text-shadow:0 1px 10px rgba(0,0,0,0.75);transition:opacity 0.6s ease;letter-spacing:0.3px;">' +
        'Touch with two fingers — each one radiates waves</div>' +
      '<div data-el="panel" style="position:absolute;inset:0;display:none;align-items:center;justify-content:center;' +
        'pointer-events:auto;background:rgba(4,7,14,0.72);backdrop-filter:blur(10px);' +
        '-webkit-backdrop-filter:blur(10px);">' +
        // Bounded and scrollable so the list cannot run off a short screen.
        '<div style="max-width:330px;max-height:78vh;overflow-y:auto;margin:0 20px;' +
          'padding:20px 22px;border-radius:20px;' +
          'background:rgba(14,20,34,0.90);box-shadow:0 12px 44px rgba(0,0,0,0.6),inset 0 0 0 1px rgba(255,255,255,0.10);' +
          'font-family:' + FONT + ';color:#e6f0ff;">' +
          '<div style="font-size:17px;font-weight:700;margin-bottom:10px;letter-spacing:0.2px;">Wave Interference</div>' +
          '<ul style="margin:0;padding-left:18px;font-size:13.5px;line-height:1.65;color:#c9dcf2;">' +
            '<li>Put down <b>two fingers</b> — each becomes a wave source.</li>' +
            '<li>Move them: crest on crest makes bright fringes, crest on trough makes dark ones.</li>' +
            '<li>Up to four fingers work at once.</li>' +
            '<li><b>Tap</b> to send a single ripple through the field.</li>' +
            '<li><b>Let go</b> and your sources drift on, still radiating.</li>' +
            '<li>The two tones are the two sources. Their beating <i>is</i> the pattern you see — far apart beats fast, close together swells slowly.</li>' +
            '<li>The <b>✦</b> chip changes medium: wavelength, colour and pitch.</li>' +
          '</ul>' +
          '<button data-el="close" style="' + BTN + 'width:100%;margin-top:16px;height:40px;">Got it</button>' +
        '</div>' +
      '</div>';

    const elMode = ui.querySelector('[data-el="mode"]');
    const elMute = ui.querySelector('[data-el="mute"]');
    const elInfo = ui.querySelector('[data-el="info"]');
    const elHint = ui.querySelector('[data-el="hint"]');
    const elPanel = ui.querySelector('[data-el="panel"]');
    const elClose = ui.querySelector('[data-el="close"]');

    function syncChips() {
      elMode.textContent = "✦ " + mode.name;
      elMute.textContent = muted ? "🔇" : "🔊";
    }
    syncChips();

    let hintVisible = true;
    function hideHint() {
      if (!hintVisible) return;
      hintVisible = false;
      elHint.style.opacity = "0";
    }

    function tapChip(el, fn) {
      ctx.listen(el, "pointerdown", (e) => { e.stopPropagation(); });
      ctx.listen(el, "click", (e) => { e.stopPropagation(); fn(); });
    }

    tapChip(elMode, () => {
      modeIndex = (modeIndex + 1) % MODES.length;
      mode = MODES[modeIndex];
      syncChips();
      applyModeToAudio();
      savePrefs();
      if (ctx.capabilities.haptics) { try { ctx.platform.haptic("light"); } catch (_) {} }
      try { ctx.platform.interact({ type: "mode", mode: mode.id }); } catch (_) {}
    });

    tapChip(elMute, () => {
      muted = !muted;
      syncChips();
      if (!muted) unlockAudio();
      if (master) setParam(master.gain, muted ? 0 : 0.9, 0.05);
      savePrefs();
    });

    tapChip(elInfo, () => { elPanel.style.display = "flex"; });
    tapChip(elClose, () => { elPanel.style.display = "none"; });
    ctx.listen(elPanel, "click", (e) => {
      if (e.target === elPanel) elPanel.style.display = "none";
    });

    // ---- input --------------------------------------------------------------
    let started = false;
    const active = new Map();   // pointerId -> { source, downT, downX, downY, moved }
    let lastInteract = 0;

    function toUnit(e) {
      // offsetX/offsetY are already canvas-relative, and skip a layout read.
      return { x: e.offsetX / unit, y: e.offsetY / unit };
    }

    ctx.listen(canvas, "pointerdown", (e) => {
      e.preventDefault();
      if (!started) {
        started = true;
        try { ctx.platform.start(); } catch (_) {}
      }
      unlockAudio();
      hideHint();
      if (active.size >= MAX_TOUCH) return;
      const p = toUnit(e);
      const s = claimSource(e.pointerId, p.x, p.y);
      if (!s) return;
      yieldDrifters();
      active.set(e.pointerId, { source: s, downT: performance.now(), x: p.x, y: p.y, moved: false });
      try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
      if (ctx.capabilities.haptics) { try { ctx.platform.haptic("light"); } catch (_) {} }
    }, { passive: false });

    ctx.listen(canvas, "pointermove", (e) => {
      const rec = active.get(e.pointerId);
      if (!rec) return;
      e.preventDefault();
      const p = toUnit(e);
      const s = rec.source;
      const dx = p.x - s.x, dy = p.y - s.y;
      // Velocity in unit/second, smoothed, so a release throws the source.
      const dt = Math.max(0.008, (performance.now() - (rec.lastT || rec.downT)) / 1000);
      s.vx = s.vx * 0.6 + (dx / dt) * 0.4;
      s.vy = s.vy * 0.6 + (dy / dt) * 0.4;
      rec.lastT = performance.now();
      s.x = p.x; s.y = p.y;
      if (Math.hypot(p.x - rec.x, p.y - rec.y) > 0.02) rec.moved = true;

      const now = performance.now();
      if (now - lastInteract > 900) {
        lastInteract = now;
        try { ctx.platform.interact({ type: "move", sources: active.size }); } catch (_) {}
      }
    }, { passive: false });

    function endPointer(e) {
      const rec = active.get(e.pointerId);
      if (!rec) return;
      active.delete(e.pointerId);
      try { canvas.releasePointerCapture(e.pointerId); } catch (_) {}
      const s = rec.source;
      const held = performance.now() - rec.downT;
      if (!rec.moved && held < 300) {
        // A tap, not a drag: send one ripple and let the source go.
        addPulse(s.x, s.y);
        bell(mode.root * 4 * (1 + 0.25 * Math.random()), clamp((s.x / viewW) * 2 - 1, -1, 1));
        if (ctx.capabilities.haptics) { try { ctx.platform.haptic("medium"); } catch (_) {} }
        try { ctx.platform.interact({ type: "pulse" }); } catch (_) {}
      }
      releaseSource(s);
      trimFreeSources();
    }

    ctx.listen(canvas, "pointerup", endPointer);
    ctx.listen(canvas, "pointercancel", endPointer);
    ctx.listen(canvas, "contextmenu", (e) => e.preventDefault());

    // ---- render -------------------------------------------------------------
    let renderScale = clamp(ctx.nativeDpr || window.devicePixelRatio || 1, 1, 1.5);
    let lastW = 0, lastH = 0, lastScale = 0;
    let fpsAcc = 0, fpsFrames = 0;

    function resize() {
      unit = Math.min(ctx.width, ctx.height) || 1;
      viewW = ctx.width / unit;
      viewH = ctx.height / unit;
      const w = Math.max(1, Math.round(ctx.width * renderScale));
      const h = Math.max(1, Math.round(ctx.height * renderScale));
      if (glReady) {
        canvas.width = w;
        canvas.height = h;
        gl.viewport(0, 0, w, h);
      }
      lastW = ctx.width; lastH = ctx.height; lastScale = renderScale;
    }
    resize();

    const TAU = 6.28318530718;
    let wavePhase = 0;   // wrapped to one cycle: uTime would lose precision
    let motion = 0;

    function drawGL() {
      gl.useProgram(program);
      for (let i = 0; i < MAX_SRC; i++) {
        const s = sources[i];
        const o = i * 4;
        srcBuf[o] = s.x;
        srcBuf[o + 1] = s.y;
        srcBuf[o + 2] = s.amp;
        srcBuf[o + 3] = s.phase;
      }
      for (let i = 0; i < MAX_PULSE; i++) {
        const p = pulses[i];
        const o = i * 4;
        if (p) {
          pulseBuf[o] = p.x;
          pulseBuf[o + 1] = p.y;
          pulseBuf[o + 2] = p.r;
          pulseBuf[o + 3] = 1.15 * Math.exp(-p.life * 1.15);
        } else {
          pulseBuf[o] = pulseBuf[o + 1] = pulseBuf[o + 2] = pulseBuf[o + 3] = 0;
        }
      }
      const k = 6.28318 / mode.lambda;
      gl.uniform2f(uni.uRes, canvas.width, canvas.height);
      gl.uniform1f(uni.uUnit, unit * renderScale);
      gl.uniform1f(uni.uPhase, wavePhase);
      gl.uniform1f(uni.uK, k);
      gl.uniform3f(uni.uChroma, -mode.disp, 0, mode.disp);
      gl.uniform1f(uni.uAtt, mode.att);
      gl.uniform1f(uni.uGain, mode.gain);
      gl.uniform1f(uni.uSpec, mode.spec);
      gl.uniform1f(uni.uBump, mode.bump);
      gl.uniform3fv(uni.uC0, mode.c0);
      gl.uniform3fv(uni.uC1, mode.c1);
      gl.uniform3fv(uni.uC2, mode.c2);
      gl.uniform3fv(uni.uC3, mode.c3);
      gl.uniform3fv(uni.uGlow, mode.glow);
      gl.uniform4fv(uni.uSrc, srcBuf);
      gl.uniform4fv(uni.uPulse, pulseBuf);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    function frame(dtMs) {
      const dt = clamp((dtMs || 16.7) / 1000, 0.001, 0.05);
      wavePhase = (wavePhase + mode.speed * TAU * dt) % TAU;

      if (ctx.width !== lastW || ctx.height !== lastH || renderScale !== lastScale) resize();

      stepSources(dt);
      if (active.size === 0) ensureDrifters();
      stepPulses(dt);

      let energy = 0;
      for (const s of sources) if (s.amp > 0) energy += Math.hypot(s.vx, s.vy) * s.amp;
      motion += (energy - motion) * clamp(dt * 4, 0, 1);

      if (glReady) drawGL();
      else fb.draw(wavePhase);

      updateAudio(dt, motion);

      // Adaptive resolution: interference is smooth, so dropping the backing
      // store is nearly invisible and buys a lot of frame time on older phones.
      fpsAcc += dtMs || 16.7;
      fpsFrames++;
      if (fpsFrames >= 45) {
        const avg = fpsAcc / fpsFrames;
        fpsAcc = 0; fpsFrames = 0;
        if (avg > 22 && renderScale > 0.62) renderScale = Math.max(0.62, renderScale - 0.18);
        else if (avg < 15.5 && renderScale < 1.5) renderScale = Math.min(1.5, renderScale + 0.12);
      }
    }

    // First frame before ready() so the bit never shows blank.
    frame(16.7);
    ctx.onFrame(frame);

    ctx.timeout(() => { if (hintVisible) hideHint(); }, 7000);

    ctx.markVisualReady("first_field");
    ctx.platform.ready();
  }
};
