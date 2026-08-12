// Turing Soup — a mobile-first Plethora Bit.
// Two chemicals, A and B, diffuse and react (Gray-Scott). B eats A and
// reproduces; feed tops A up, kill removes B. That single rule grows coral,
// mitosis, worms and spirals — nothing here is drawn, it is all emergent.
//
// Drag on the canvas to inject B and watch structure bloom out of your finger.
// The XY pad steers feed/kill in real time so the whole colony morphs between
// regimes without ever resetting.
//
// The simulation runs on the GPU (WebGL2, ping-pong float framebuffers) with a
// CPU fallback so the bit always shows something alive.

window.plethoraBit = {
  meta: {
    title: "Turing Soup",
    runtime: "plethora-bit@2",
    tags: [
      "art",
      "generative",
      "simulation",
      "fidget",
      "sensory",
      "touch",
      "science"
    ],
    permissions: ["haptics", "backgroundMusic", "storage"]
  },

  async init(ctx) {
    // ---- tuning constants --------------------------------------------------
    const SIM_MAX = 420; // longest sim edge in cells; features read ~8-20 cells
    const DPR_CAP = 2;
    const FEED = { min: 0.01, max: 0.09 };
    const KILL = { min: 0.038, max: 0.07 };
    // Explicit Euler on the 9-point stencil has lambda_min = -1.6, so dt * Da
    // must stay below 1.25 or the grid breaks into a checkerboard. Cap well
    // under that: Scale only ever shrinks the pattern from the stable default.
    const SCALE = { min: 0.35, max: 1.1 };

    // Landmark regimes in (feed, kill) space. These are the classic Gray-Scott
    // pockets — small moves between them change the colony completely. Every
    // one of these was checked to survive a fresh scatter of seeds; the
    // textbook "mitosis" and "spiral" corners are knife-edge from small seeds
    // and were dropped rather than shipped as chips that can die on tap.
    const PRESETS = [
      { name: "Coral", f: 0.0545, k: 0.062 },
      { name: "Worms", f: 0.058, k: 0.063 },
      { name: "Maze", f: 0.029, k: 0.057 },
      { name: "Solitons", f: 0.03, k: 0.062 },
      { name: "Holes", f: 0.039, k: 0.058 },
      { name: "Amoeba", f: 0.018, k: 0.051 }
    ];

    // IQ cosine palettes: colour = a + b * cos(2pi * (c * t + d)).
    const PALETTES = [
      {
        name: "Nebula",
        a: [0.5, 0.35, 0.55], b: [0.45, 0.3, 0.45],
        c: [1.0, 1.0, 1.0], d: [0.0, 0.1, 0.25],
        ground: [0.025, 0.02, 0.055],
        spec: [1.0, 0.85, 1.0], rim: [0.55, 0.35, 0.95]
      },
      {
        name: "Lagoon",
        a: [0.28, 0.48, 0.54], b: [0.28, 0.38, 0.34],
        c: [1.0, 1.0, 1.0], d: [0.5, 0.58, 0.68],
        ground: [0.01, 0.045, 0.075],
        spec: [0.85, 1.0, 1.0], rim: [0.15, 0.75, 0.85]
      },
      {
        name: "Ember",
        a: [0.55, 0.28, 0.15], b: [0.5, 0.35, 0.2],
        c: [1.0, 1.0, 1.0], d: [0.02, 0.12, 0.2],
        ground: [0.05, 0.012, 0.01],
        spec: [1.0, 0.9, 0.7], rim: [1.0, 0.35, 0.12]
      },
      {
        name: "Verdant",
        a: [0.33, 0.45, 0.28], b: [0.33, 0.4, 0.25],
        c: [1.0, 1.0, 1.0], d: [0.25, 0.15, 0.35],
        ground: [0.015, 0.045, 0.03],
        spec: [0.95, 1.0, 0.8], rim: [0.45, 0.95, 0.35]
      },
      {
        // Near-monochrome channels: the ramp reads as liquid metal, and only
        // the small per-channel phase spread tints the edges.
        name: "Mercury",
        a: [0.6, 0.61, 0.66], b: [0.32, 0.31, 0.3],
        c: [1.0, 1.0, 1.0], d: [0.0, 0.03, 0.09],
        ground: [0.035, 0.037, 0.05],
        spec: [1.0, 1.0, 1.0], rim: [0.45, 0.62, 1.0]
      }
    ];

    // ---- live state --------------------------------------------------------
    const state = {
      feed: PRESETS[0].f,
      kill: PRESETS[0].k,
      scale: 1.0, // diffusion multiplier -> pattern feature size
      steps: 10, // sim substeps per frame
      palette: 0,
      sheet: false, // bottom sheet expanded
      music: true
    };

    let started = false; // first real gesture happened
    let touched = false; // user has painted at least once
    let lastInteract = 0;
    let musicHandle = null;
    let activity = 0; // mean B, drives the music bed
    let hint = null;

    const saved = readSaved();
    if (saved) {
      // Clamp anything restored from storage: the palette list and ranges can
      // change between versions of the bit.
      if (Number.isFinite(saved.feed)) state.feed = clamp(saved.feed, FEED.min, FEED.max);
      if (Number.isFinite(saved.kill)) state.kill = clamp(saved.kill, KILL.min, KILL.max);
      if (Number.isFinite(saved.scale)) state.scale = clamp(saved.scale, SCALE.min, SCALE.max);
      if (Number.isFinite(saved.steps)) state.steps = Math.round(clamp(saved.steps, 2, 18));
      if (Number.isFinite(saved.palette)) {
        state.palette = Math.min(PALETTES.length - 1, Math.max(0, Math.round(saved.palette)));
      }
      state.sheet = !!saved.sheet;
      state.music = saved.music !== false;
    }

    // ---- surfaces ----------------------------------------------------------
    const canvas = ctx.createCanvas({ touchAction: "none" });
    canvas.style.display = "block";
    canvas.style.width = "100%";
    canvas.style.height = "100%";

    const gl = canvas.getContext("webgl2", {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      preserveDrawingBuffer: false,
      powerPreference: "high-performance"
    });

    // Float render targets are required for Gray-Scott's tiny per-step deltas;
    // anything less capable drops to the CPU grid rather than banding badly.
    const canFloat = !!gl && !!gl.getExtension("EXT_color_buffer_float");
    let engine = gl && canFloat ? createGLEngine() : null;
    if (!engine) engine = createCPUEngine();

    // =======================================================================
    // GPU engine
    // =======================================================================
    function createGLEngine() {
      const QUAD_VS = `#version 300 es
      precision highp float;
      out vec2 vUv;
      void main() {
        // Fullscreen triangle strip from gl_VertexID: no buffers needed.
        vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
        vUv = p;
        gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
      }`;

      // Gray-Scott step. Toroidal wrap makes growth seamless off every edge.
      const SIM_FS = `#version 300 es
      precision highp float;
      out vec4 outColor;
      uniform sampler2D uState;
      uniform ivec2 uSize;
      uniform float uFeed, uKill, uDa, uDb, uDt;
      uniform vec2 uBrushA, uBrushB;
      uniform float uBrushR, uBrushAmt;

      vec2 grab(ivec2 c) {
        ivec2 w = ((c % uSize) + uSize) % uSize;
        return texelFetch(uState, w, 0).rg;
      }

      float segDist(vec2 p, vec2 a, vec2 b) {
        vec2 pa = p - a, ba = b - a;
        float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-6), 0.0, 1.0);
        return length(pa - ba * h);
      }

      void main() {
        ivec2 c = ivec2(gl_FragCoord.xy);
        vec2 s = grab(c);

        // 9-point laplacian: 0.2 orthogonal, 0.05 diagonal, -1 centre.
        vec2 lap = -s;
        lap += (grab(c + ivec2(-1, 0)) + grab(c + ivec2(1, 0)) +
                grab(c + ivec2(0, -1)) + grab(c + ivec2(0, 1))) * 0.2;
        lap += (grab(c + ivec2(-1, -1)) + grab(c + ivec2(1, -1)) +
                grab(c + ivec2(-1, 1)) + grab(c + ivec2(1, 1))) * 0.05;

        float A = s.r, B = s.g;
        float reac = A * B * B;
        float nA = A + (uDa * lap.r - reac + uFeed * (1.0 - A)) * uDt;
        float nB = B + (uDb * lap.g + reac - (uKill + uFeed) * B) * uDt;

        if (uBrushAmt > 0.0) {
          float d = segDist(vec2(c) + 0.5, uBrushA, uBrushB);
          float w = exp(-(d * d) / (uBrushR * uBrushR)) * uBrushAmt;
          nB += w;
          nA -= w * 0.55;
        }

        outColor = vec4(clamp(nA, 0.0, 1.0), clamp(nB, 0.0, 1.0), 0.0, 1.0);
      }`;

      // Pack a shaded-ready field: blurred B plus its Sobel gradient. Doing it
      // once at sim resolution keeps the display pass down to one bilinear tap.
      const FIELD_FS = `#version 300 es
      precision highp float;
      out vec4 outColor;
      uniform sampler2D uState;
      uniform ivec2 uSize;

      float grab(ivec2 c) {
        ivec2 w = ((c % uSize) + uSize) % uSize;
        return texelFetch(uState, w, 0).g;
      }

      void main() {
        ivec2 c = ivec2(gl_FragCoord.xy);
        float tl = grab(c + ivec2(-1, 1)), t = grab(c + ivec2(0, 1)), tr = grab(c + ivec2(1, 1));
        float l  = grab(c + ivec2(-1, 0)), m = grab(c),                r  = grab(c + ivec2(1, 0));
        float bl = grab(c + ivec2(-1, -1)), b = grab(c + ivec2(0, -1)), br = grab(c + ivec2(1, -1));

        float blur = (m * 4.0 + (t + b + l + r) * 2.0 + (tl + tr + bl + br)) / 16.0;
        float gx = ((tr + 2.0 * r + br) - (tl + 2.0 * l + bl)) * 0.125;
        float gy = ((tl + 2.0 * t + tr) - (bl + 2.0 * b + br)) * 0.125;

        outColor = vec4(blur, gx, gy, m);
      }`;

      const DISPLAY_FS = `#version 300 es
      precision highp float;
      in vec2 vUv;
      out vec4 outColor;
      uniform sampler2D uField;
      uniform ivec2 uSize;
      uniform vec3 uPalA, uPalB, uPalC, uPalD;
      uniform vec3 uGround, uSpec, uRim;
      uniform float uTime, uDrift;

      vec4 grab(ivec2 c) {
        ivec2 w = ((c % uSize) + uSize) % uSize;
        return texelFetch(uField, w, 0);
      }

      // Manual bilinear so the look never depends on float-filter extensions.
      vec4 sampleField(vec2 uv) {
        vec2 p = uv * vec2(uSize) - 0.5;
        vec2 i = floor(p), f = fract(p);
        f = f * f * (3.0 - 2.0 * f); // smoothstep the blend: silkier membranes
        ivec2 c = ivec2(i);
        vec4 a = mix(grab(c), grab(c + ivec2(1, 0)), f.x);
        vec4 b = mix(grab(c + ivec2(0, 1)), grab(c + ivec2(1, 1)), f.x);
        return mix(a, b, f.y);
      }

      vec3 palette(float t) {
        return uPalA + uPalB * cos(6.28318530718 * (uPalC * t + uPalD + uDrift));
      }

      void main() {
        vec4 F = sampleField(vUv);
        float b = F.x;
        vec2 g = F.yz;

        float h = smoothstep(0.015, 0.32, b);
        float slope = length(g);

        // Treat B as a height field; light it like wet, living tissue.
        vec3 n = normalize(vec3(-g * 26.0, 1.0));
        vec3 L = normalize(vec3(-0.42, 0.66, 0.62));
        vec3 V = vec3(0.0, 0.0, 1.0);
        vec3 H = normalize(L + V);
        float dif = max(dot(n, L), 0.0);
        float spe = pow(max(dot(n, H), 0.0), 42.0);
        float fres = pow(1.0 - max(n.z, 0.0), 3.0);

        float t = h * 0.72 + slope * 1.6;
        // Sample the ramp at slightly offset stops per channel for iridescence.
        vec3 base = vec3(palette(t + 0.022).r, palette(t).g, palette(t - 0.022).b);

        vec3 col = base * (0.26 + 0.9 * dif);
        col += uSpec * spe * 1.35;
        col += uRim * fres * 0.55;
        col = mix(uGround, col, smoothstep(0.0, 0.1, b) * 0.92 + 0.08);

        // Depth: thin films glow, dense cores stay saturated.
        col += base * pow(h, 3.0) * 0.28;

        vec2 q = vUv - 0.5;
        col *= 1.0 - 0.62 * dot(q, q);

        float grain = fract(sin(dot(gl_FragCoord.xy + uTime, vec2(12.9898, 78.233))) * 43758.5453);
        col += (grain - 0.5) * 0.022;

        outColor = vec4(max(col, 0.0), 1.0);
      }`;

      // Average B into an 8x8 grid so the music can follow the colony cheaply.
      const REDUCE_FS = `#version 300 es
      precision highp float;
      in vec2 vUv;
      out vec4 outColor;
      uniform sampler2D uState;
      uniform ivec2 uSize;

      void main() {
        ivec2 tile = ivec2(gl_FragCoord.xy);
        vec2 cell = vec2(uSize) / 8.0;
        float sum = 0.0;
        for (int y = 0; y < 8; y++) {
          for (int x = 0; x < 8; x++) {
            vec2 p = (vec2(tile) + (vec2(x, y) + 0.5) / 8.0) * cell;
            ivec2 c = clamp(ivec2(p), ivec2(0), uSize - 1);
            sum += texelFetch(uState, c, 0).g;
          }
        }
        outColor = vec4(sum / 64.0, 0.0, 0.0, 1.0);
      }`;

      function compile(type, src) {
        const sh = gl.createShader(type);
        gl.shaderSource(sh, src);
        gl.compileShader(sh);
        if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
          throw new Error("shader: " + gl.getShaderInfoLog(sh));
        }
        return sh;
      }

      function program(fs) {
        const p = gl.createProgram();
        gl.attachShader(p, compile(gl.VERTEX_SHADER, QUAD_VS));
        gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs));
        gl.linkProgram(p);
        if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
          throw new Error("link: " + gl.getProgramInfoLog(p));
        }
        const uniforms = {};
        const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
        for (let i = 0; i < n; i++) {
          const name = gl.getActiveUniform(p, i).name.replace(/\[0\]$/, "");
          uniforms[name] = gl.getUniformLocation(p, name);
        }
        return { p, u: uniforms };
      }

      let progSim, progField, progDisplay, progReduce;
      try {
        progSim = program(SIM_FS);
        progField = program(FIELD_FS);
        progDisplay = program(DISPLAY_FS);
        progReduce = program(REDUCE_FS);
      } catch (err) {
        report(err);
        return null;
      }

      const vao = gl.createVertexArray(); // no attributes, but core profile wants one
      const sampler = gl.createSampler();
      gl.samplerParameteri(sampler, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.samplerParameteri(sampler, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.samplerParameteri(sampler, gl.TEXTURE_WRAP_S, gl.REPEAT);
      gl.samplerParameteri(sampler, gl.TEXTURE_WRAP_T, gl.REPEAT);

      // RGBA32F carries the tiny per-step deltas Gray-Scott needs; RGBA16F is
      // the fallback when a device only makes half-float renderable.
      const FMT = pickFormat();
      function pickFormat() {
        for (const f of [gl.RGBA32F, gl.RGBA16F]) {
          const tex = gl.createTexture();
          gl.bindTexture(gl.TEXTURE_2D, tex);
          gl.texStorage2D(gl.TEXTURE_2D, 1, f, 4, 4);
          const fbo = gl.createFramebuffer();
          gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
          gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
          const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
          gl.bindFramebuffer(gl.FRAMEBUFFER, null);
          gl.deleteFramebuffer(fbo);
          gl.deleteTexture(tex);
          if (ok) return f;
        }
        return null;
      }
      if (!FMT) return null;

      let sw = 0, sh = 0;
      let texA = null, texB = null, fboA = null, fboB = null;
      let fieldTex = null, fieldFbo = null;
      let reduceTex = null, reduceFbo = null;
      const reduceBuf = new Uint8Array(8 * 8 * 4);

      function makeTarget(w, h, format) {
        const tex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texStorage2D(gl.TEXTURE_2D, 1, format, w, h);
        const fbo = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        return { tex, fbo };
      }

      function allocate(w, h) {
        [texA, texB, fieldTex, reduceTex].forEach((t) => t && gl.deleteTexture(t));
        [fboA, fboB, fieldFbo, reduceFbo].forEach((f) => f && gl.deleteFramebuffer(f));
        sw = w; sh = h;
        const a = makeTarget(w, h, FMT); texA = a.tex; fboA = a.fbo;
        const b = makeTarget(w, h, FMT); texB = b.tex; fboB = b.fbo;
        const f = makeTarget(w, h, FMT); fieldTex = f.tex; fieldFbo = f.fbo;
        const r = makeTarget(8, 8, gl.RGBA8); reduceTex = r.tex; reduceFbo = r.fbo;
      }

      function upload(data) {
        gl.bindTexture(gl.TEXTURE_2D, texA);
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, sw, sh, gl.RGBA, gl.FLOAT, data);
      }

      function draw(prog, fbo, w, h) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
        gl.viewport(0, 0, w, h);
        gl.useProgram(prog.p);
        gl.bindVertexArray(vao);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      }

      // Texture binding only — sampler uniforms are set after useProgram.
      function bindState() {
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, texA);
        gl.bindSampler(0, sampler);
      }

      return {
        kind: "gl",
        get size() { return { w: sw, h: sh }; },

        allocate(w, h) { allocate(w, h); },
        seed(data) { upload(data); },

        step(n, brush) {
          gl.useProgram(progSim.p);
          for (let i = 0; i < n; i++) {
            bindState();
            gl.uniform1i(progSim.u.uState, 0);
            gl.uniform2i(progSim.u.uSize, sw, sh);
            gl.uniform1f(progSim.u.uFeed, state.feed);
            gl.uniform1f(progSim.u.uKill, state.kill);
            gl.uniform1f(progSim.u.uDa, 1.0 * state.scale);
            gl.uniform1f(progSim.u.uDb, 0.5 * state.scale);
            gl.uniform1f(progSim.u.uDt, 1.0);
            // The brush lands once per frame so a fast drag cannot overdose.
            const live = brush && i === 0;
            gl.uniform2f(progSim.u.uBrushA, live ? brush.x0 : 0, live ? brush.y0 : 0);
            gl.uniform2f(progSim.u.uBrushB, live ? brush.x1 : 0, live ? brush.y1 : 0);
            gl.uniform1f(progSim.u.uBrushR, live ? brush.r : 1);
            gl.uniform1f(progSim.u.uBrushAmt, live ? brush.amt : 0);
            draw(progSim, fboB, sw, sh);
            [texA, texB] = [texB, texA];
            [fboA, fboB] = [fboB, fboA];
          }
        },

        render(timeMs, viewW, viewH) {
          gl.useProgram(progField.p);
          bindState();
          gl.uniform1i(progField.u.uState, 0);
          gl.uniform2i(progField.u.uSize, sw, sh);
          draw(progField, fieldFbo, sw, sh);

          const pal = PALETTES[state.palette];
          gl.useProgram(progDisplay.p);
          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D, fieldTex);
          gl.bindSampler(0, sampler);
          gl.uniform1i(progDisplay.u.uField, 0);
          gl.uniform2i(progDisplay.u.uSize, sw, sh);
          gl.uniform3fv(progDisplay.u.uPalA, pal.a);
          gl.uniform3fv(progDisplay.u.uPalB, pal.b);
          gl.uniform3fv(progDisplay.u.uPalC, pal.c);
          gl.uniform3fv(progDisplay.u.uPalD, pal.d);
          gl.uniform3fv(progDisplay.u.uGround, pal.ground);
          gl.uniform3fv(progDisplay.u.uSpec, pal.spec);
          gl.uniform3fv(progDisplay.u.uRim, pal.rim);
          gl.uniform1f(progDisplay.u.uTime, (timeMs % 10000) * 0.001);
          gl.uniform1f(progDisplay.u.uDrift, (timeMs % 200000) * 0.0000075);
          draw(progDisplay, null, viewW, viewH);
        },

        measure() {
          gl.useProgram(progReduce.p);
          bindState();
          gl.uniform1i(progReduce.u.uState, 0);
          gl.uniform2i(progReduce.u.uSize, sw, sh);
          draw(progReduce, reduceFbo, 8, 8);
          gl.readPixels(0, 0, 8, 8, gl.RGBA, gl.UNSIGNED_BYTE, reduceBuf);
          let sum = 0;
          for (let i = 0; i < 64; i++) sum += reduceBuf[i * 4];
          return sum / (64 * 255);
        }
      };
    }

    // =======================================================================
    // CPU fallback — same reaction, smaller grid, simpler shading.
    // =======================================================================
    function createCPUEngine() {
      if (gl) canvas.style.display = "none";
      const c2 = ctx.createCanvas2D({ touchAction: "none" });
      const g2 = c2.getContext("2d");
      g2.imageSmoothingEnabled = true;

      let w = 0, h = 0;
      let A = null, B = null, A2 = null, B2 = null;
      // The grid is upscaled straight into one ImageData sized to the canvas
      // backing store — putImageData ignores the transform, so no second
      // canvas is needed and none may be created outside the ctx surfaces.
      let img = null, buf = null, xMap = null, dw = 0, dh = 0;
      let cell = null;
      const lutR = new Float32Array(256);
      const lutG = new Float32Array(256);
      const lutB = new Float32Array(256);
      let lutFor = -1;

      function allocate(nw, nh) {
        w = nw; h = nh;
        A = new Float32Array(w * h); B = new Float32Array(w * h);
        A2 = new Float32Array(w * h); B2 = new Float32Array(w * h);
        cell = new Uint32Array(w * h);
        dw = 0; // force the output buffer and x-map to be rebuilt for this grid
        sizeOutput();
      }

      // Run the fallback at CSS resolution: the per-pixel loop is JavaScript,
      // and a soft upscale costs far less than a DPR-sized buffer.
      function sizeOutput() {
        const nw = Math.max(1, Math.round(ctx.width));
        const nh = Math.max(1, Math.round(ctx.height));
        if (nw === dw && nh === dh && img) return;
        dw = nw; dh = nh;
        if (c2.width !== dw || c2.height !== dh) {
          c2.width = dw;
          c2.height = dh;
        }
        img = g2.createImageData(dw, dh);
        buf = new Uint32Array(img.data.buffer);
        xMap = new Int32Array(dw);
        for (let x = 0; x < dw; x++) xMap[x] = Math.min(w - 1, (x * w / dw) | 0);
      }

      // Ramp lookup shared with the shader's palette(): sampling it by index
      // keeps the per-cell shading free of trigonometry.
      function buildLut() {
        const pal = PALETTES[state.palette];
        for (let i = 0; i < 256; i++) {
          const t = i / 255;
          lutR[i] = pal.a[0] + pal.b[0] * Math.cos(6.2832 * (pal.c[0] * t + pal.d[0]));
          lutG[i] = pal.a[1] + pal.b[1] * Math.cos(6.2832 * (pal.c[1] * t + pal.d[1]));
          lutB[i] = pal.a[2] + pal.b[2] * Math.cos(6.2832 * (pal.c[2] * t + pal.d[2]));
        }
        lutFor = state.palette;
      }

      function smoothstep(e0, e1, x) {
        const t = clamp01((x - e0) / (e1 - e0));
        return t * t * (3 - 2 * t);
      }

      // Shade at grid resolution — a few thousand cells — then the upscale is
      // a plain copy. Mirrors the display shader minus the specular term.
      function shade() {
        const pal = PALETTES[state.palette];
        const g0 = pal.ground[0], g1 = pal.ground[1], g2c = pal.ground[2];
        for (let y = 0; y < h; y++) {
          const up = ((y - 1 + h) % h) * w;
          const dn = ((y + 1) % h) * w;
          const row = y * w;
          for (let x = 0; x < w; x++) {
            const i = row + x;
            const b = B[i];
            const hh = smoothstep(0.015, 0.32, b);
            const gx = (B[row + ((x + 1) % w)] - B[row + ((x - 1 + w) % w)]) * 0.5;
            const gy = (B[up + x] - B[dn + x]) * 0.5; // +y points up the screen
            const nx = -gx * 26, ny = -gy * 26;
            const inv = 1 / Math.sqrt(nx * nx + ny * ny + 1);
            const dif = Math.max(0, (nx * -0.42 + ny * 0.66 + 0.62) * inv);

            let t = hh * 0.72 + Math.sqrt(gx * gx + gy * gy) * 1.6;
            t = t < 0 ? 0 : t > 1 ? 1 : t;
            const li = (t * 255) | 0;
            const lit = 0.26 + 0.9 * dif;
            const mixv = smoothstep(0, 0.1, b) * 0.92 + 0.08;

            const r = clamp255((g0 + (lutR[li] * lit - g0) * mixv) * 255);
            const g = clamp255((g1 + (lutG[li] * lit - g1) * mixv) * 255);
            const bl = clamp255((g2c + (lutB[li] * lit - g2c) * mixv) * 255);
            cell[i] = (255 << 24) | (bl << 16) | (g << 8) | r;
          }
        }
      }

      function idx(x, y) {
        return ((y + h) % h) * w + ((x + w) % w);
      }

      return {
        kind: "cpu",
        get size() { return { w, h }; },
        allocate(nw, nh) { allocate(Math.min(nw, 220), Math.min(nh, 220)); },

        seed(data) {
          for (let i = 0; i < w * h; i++) {
            A[i] = data[i * 4];
            B[i] = data[i * 4 + 1];
          }
        },

        step(n, brush) {
          const da = 1.0 * state.scale, db = 0.5 * state.scale;
          const f = state.feed, k = state.kill;
          for (let s = 0; s < n; s++) {
            for (let y = 0; y < h; y++) {
              for (let x = 0; x < w; x++) {
                const i = y * w + x;
                const o = A[i], p = B[i];
                const la =
                  (A[idx(x - 1, y)] + A[idx(x + 1, y)] + A[idx(x, y - 1)] + A[idx(x, y + 1)]) * 0.2 +
                  (A[idx(x - 1, y - 1)] + A[idx(x + 1, y - 1)] + A[idx(x - 1, y + 1)] + A[idx(x + 1, y + 1)]) * 0.05 - o;
                const lb =
                  (B[idx(x - 1, y)] + B[idx(x + 1, y)] + B[idx(x, y - 1)] + B[idx(x, y + 1)]) * 0.2 +
                  (B[idx(x - 1, y - 1)] + B[idx(x + 1, y - 1)] + B[idx(x - 1, y + 1)] + B[idx(x + 1, y + 1)]) * 0.05 - p;
                const reac = o * p * p;
                A2[i] = Math.min(1, Math.max(0, o + (da * la - reac + f * (1 - o))));
                B2[i] = Math.min(1, Math.max(0, p + (db * lb + reac - (k + f) * p)));
              }
            }
            A.set(A2); B.set(B2);
          }
          if (brush) {
            const r2 = brush.r * brush.r;
            const span = Math.ceil(brush.r * 2);
            for (let y = Math.floor(brush.y1 - span); y <= brush.y1 + span; y++) {
              for (let x = Math.floor(brush.x1 - span); x <= brush.x1 + span; x++) {
                const dx = x - brush.x1, dy = y - brush.y1;
                const wgt = Math.exp(-(dx * dx + dy * dy) / r2) * brush.amt;
                if (wgt < 0.01) continue;
                const i = idx(x, y);
                B[i] = Math.min(1, B[i] + wgt);
                A[i] = Math.max(0, A[i] - wgt * 0.55);
              }
            }
          }
        },

        render() {
          sizeOutput();
          if (lutFor !== state.palette) buildLut();
          shade();
          for (let y = 0; y < dh; y++) {
            const row = Math.min(h - 1, (y * h / dh) | 0) * w;
            const out = y * dw;
            for (let x = 0; x < dw; x++) buf[out + x] = cell[row + xMap[x]];
          }
          g2.putImageData(img, 0, 0);
        },

        measure() {
          let sum = 0;
          for (let i = 0; i < w * h; i += 7) sum += B[i];
          return sum / (w * h / 7);
        }
      };
    }

    function clamp255(v) {
      return v < 0 ? 0 : v > 255 ? 255 : v | 0;
    }

    if (!engine) {
      showFatal();
      return;
    }

    // ---- sizing ------------------------------------------------------------
    let viewW = 0, viewH = 0, simW = 0, simH = 0;

    function syncSize(force) {
      const cw = Math.max(1, Math.round(ctx.width));
      const chh = Math.max(1, Math.round(ctx.height));
      const dpr = Math.min(ctx.dpr || 1, DPR_CAP);

      if (engine.kind === "gl") {
        viewW = Math.max(1, Math.round(cw * dpr));
        viewH = Math.max(1, Math.round(chh * dpr));
        if (canvas.width !== viewW || canvas.height !== viewH) {
          canvas.width = viewW;
          canvas.height = viewH;
        }
      } else {
        viewW = cw;
        viewH = chh;
      }

      const long = Math.max(cw, chh);
      const cells = engine.kind === "gl" ? SIM_MAX : 190;
      const s = cells / long;
      const nw = Math.max(48, Math.round(cw * s));
      const nh = Math.max(48, Math.round(chh * s));

      // Only re-grid on a real layout change; a rotate restarts the colony.
      const changed = Math.abs(nw - simW) > simW * 0.12 || Math.abs(nh - simH) > simH * 0.12;
      if (force || changed) {
        simW = nw; simH = nh;
        engine.allocate(simW, simH);
        seed("scatter");
      }
    }

    // ---- seeding -----------------------------------------------------------
    function seed(kind) {
      const { w, h } = engine.size;
      const data = new Float32Array(w * h * 4);
      for (let i = 0; i < w * h; i++) {
        data[i * 4] = 1; // A saturated
        data[i * 4 + 3] = 1;
      }

      const blobs = [];
      if (kind === "scatter" || kind === "revive") {
        const n = kind === "revive" ? 3 : 5 + Math.floor(Math.random() * 4);
        for (let i = 0; i < n; i++) {
          blobs.push({
            x: (0.15 + Math.random() * 0.7) * w,
            y: (0.15 + Math.random() * 0.7) * h,
            r: Math.max(2.5, Math.min(w, h) * (0.03 + Math.random() * 0.05))
          });
        }
      } else {
        // "clear" still leaves a few motes so the soup regrows instead of dying.
        blobs.push({ x: w * 0.5, y: h * 0.42, r: Math.min(w, h) * 0.05 });
        blobs.push({ x: w * 0.36, y: h * 0.6, r: Math.min(w, h) * 0.032 });
        blobs.push({ x: w * 0.66, y: h * 0.6, r: Math.min(w, h) * 0.032 });
      }

      for (const bl of blobs) {
        const span = Math.ceil(bl.r * 2.2);
        for (let y = Math.floor(bl.y - span); y <= bl.y + span; y++) {
          for (let x = Math.floor(bl.x - span); x <= bl.x + span; x++) {
            const xx = ((x % w) + w) % w, yy = ((y % h) + h) % h;
            const dx = x - bl.x, dy = y - bl.y;
            const wgt = Math.exp(-(dx * dx + dy * dy) / (bl.r * bl.r));
            if (wgt < 0.02) continue;
            const i = (yy * w + xx) * 4;
            data[i + 1] = Math.min(1, data[i + 1] + wgt);
            data[i] = Math.max(0, data[i] - wgt * 0.6);
          }
        }
      }
      engine.seed(data);
    }

    syncSize(true);

    // ---- painting ----------------------------------------------------------
    let pointerDown = false;
    let prevPoint = null;
    let pendingBrush = null;

    function toSim(e) {
      const rect = ctx.container.getBoundingClientRect();
      const { w, h } = engine.size;
      const fy = (e.clientY - rect.top) / Math.max(1, rect.height);
      return {
        x: ((e.clientX - rect.left) / Math.max(1, rect.width)) * w,
        // GL texture row 0 is the bottom of the screen; the CPU grid is top-down.
        y: (engine.kind === "gl" ? 1 - fy : fy) * h
      };
    }

    function onDown(e) {
      if (ui.contains(e.target)) return; // taps that land on controls are not paint
      pointerDown = true;
      prevPoint = toSim(e);
      pendingBrush = brushFrom(prevPoint, prevPoint);
      firstGesture();
      buzz("light");
      if (!touched) {
        touched = true;
        hideHint();
        ctx.platform.milestone("first_paint");
      }
    }

    function onMove(e) {
      if (!pointerDown) return;
      const p = toSim(e);
      const from = prevPoint || p;
      pendingBrush = brushFrom(from, p);
      prevPoint = p;
      const now = performance.now();
      if (now - lastInteract > 400) {
        lastInteract = now;
        ctx.platform.interact({ kind: "paint" });
      }
    }

    function onUp() {
      pointerDown = false;
      prevPoint = null;
    }

    function brushFrom(a, b) {
      const { w, h } = engine.size;
      const r = Math.max(2.2, Math.min(w, h) * 0.035);
      return { x0: a.x, y0: a.y, x1: b.x, y1: b.y, r, amt: 0.92 };
    }

    ctx.listen(ctx.container, "pointerdown", onDown);
    ctx.listen(window, "pointermove", onMove, { passive: true });
    ctx.listen(window, "pointerup", onUp);
    ctx.listen(window, "pointercancel", onUp);
    ctx.listen(window, "resize", () => syncSize(false));

    // ---- interface ---------------------------------------------------------
    const ui = ctx.createRoot({ touchAction: "none" });
    ui.style.pointerEvents = "none";
    ui.style.font = "500 13px/1.35 -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
    ui.style.color = "rgba(255,255,255,0.92)";
    ui.style.webkitUserSelect = "none";
    ui.style.userSelect = "none";
    ui.style.overflow = "hidden";

    // Kept separate so toggles can restore it: clearing style.background would
    // strip it from the inline style and leave a bare blur over the artwork.
    const GLASS_BG = "rgba(12,12,20,0.42)";
    const GLASS_ON = "rgba(255,255,255,0.2)";
    const GLASS = "backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);" +
      `background:${GLASS_BG};border:1px solid rgba(255,255,255,0.14);`;

    function el(tag, style, parent, text) {
      const n = document.createElement(tag);
      if (style) n.setAttribute("style", style);
      if (text != null) n.textContent = text;
      (parent || ui).appendChild(n);
      return n;
    }

    // Top bar: what the soup is doing right now.
    const top = el("div",
      `position:absolute;left:0;right:0;top:0;padding:${(ctx.safeArea?.top || 0) + 10}px 12px 0;` +
      "display:flex;align-items:flex-start;gap:8px;justify-content:space-between;");

    // Just the regime name rides over the artwork; the numbers live in the
    // sheet, next to the pad that changes them.
    const readout = el("div", GLASS +
      "pointer-events:auto;border-radius:14px;padding:8px 11px;min-width:0;" +
      "box-shadow:0 6px 22px rgba(0,0,0,0.35);", top);
    const regimeName = el("div",
      "font-size:13px;font-weight:650;letter-spacing:0.2px;white-space:nowrap;", readout, "Coral");

    const tools = el("div", "display:flex;gap:5px;flex-wrap:wrap;justify-content:flex-end;flex:0 0 auto;", top);

    function iconButton(label, title, onTap) {
      const b = el("button", GLASS +
        "pointer-events:auto;width:34px;height:34px;border-radius:11px;color:inherit;font-size:14px;" +
        "display:flex;align-items:center;justify-content:center;cursor:pointer;padding:0;flex:0 0 auto;" +
        "box-shadow:0 6px 18px rgba(0,0,0,0.32);transition:transform .12s ease,background .2s ease;", tools, label);
      b.setAttribute("aria-label", title);
      ctx.listen(b, "pointerdown", (e) => {
        e.stopPropagation();
        b.style.transform = "scale(0.9)";
      });
      ctx.listen(b, "pointerup", (e) => {
        e.stopPropagation();
        b.style.transform = "";
      });
      ctx.listen(b, "click", (e) => {
        e.stopPropagation();
        firstGesture();
        buzz("light");
        onTap(b);
      });
      return b;
    }

    const tuneBtn = iconButton("≡", "Tune the reaction", () => toggleSheet());

    const paletteBtn = iconButton("◐", "Change palette", () => {
      state.palette = (state.palette + 1) % PALETTES.length;
      flash(PALETTES[state.palette].name);
      ctx.platform.emit("palette", { name: PALETTES[state.palette].name });
      sting("tap");
      persist();
    });

    iconButton("✳", "Scatter fresh seeds", () => {
      seed("scatter");
      flash("Seeded");
      ctx.platform.interact({ kind: "seed" });
      sting("coin");
    });

    iconButton("⟲", "Clear the dish", () => {
      seed("clear");
      flash("Cleared");
      ctx.platform.interact({ kind: "clear" });
    });

    const musicBtn = iconButton("♪", "Toggle sound", () => {
      state.music = !state.music;
      musicBtn.textContent = state.music ? "♪" : "♪̸";
      musicBtn.style.opacity = state.music ? "1" : "0.5";
      if (state.music) startMusic();
      else if (musicHandle) { musicHandle.stop({ fadeOutMs: 400 }); musicHandle = null; }
      persist();
    });

    const helpBtn = iconButton("?", "How it works", () => toggleHelp());

    // Tuning sheet: summoned by the ≡ button and otherwise parked completely
    // off-screen, so nothing sits over the artwork while you are watching it.
    const sheet = el("div", GLASS +
      "position:absolute;left:8px;right:8px;bottom:0;pointer-events:auto;border-radius:20px;" +
      `margin-bottom:${(ctx.safeArea?.bottom || 0) + 10}px;padding:10px 12px 12px;` +
      "box-shadow:0 -8px 30px rgba(0,0,0,0.4);" +
      "transition:transform .3s cubic-bezier(.3,.8,.4,1),opacity .22s ease;");

    const head = el("div",
      "display:flex;align-items:center;justify-content:space-between;gap:10px;padding-bottom:8px;", sheet);
    const headLeft = el("div", "display:flex;align-items:baseline;gap:8px;min-width:0;", head);
    el("div", "font-size:11px;letter-spacing:0.6px;opacity:0.72;text-transform:uppercase;", headLeft, "Tune");
    const regimeNums = el("div",
      "font-size:10px;opacity:0.55;font-variant-numeric:tabular-nums;letter-spacing:0.2px;white-space:nowrap;",
      headLeft, "");
    const closeBtn = el("button",
      "pointer-events:auto;width:28px;height:28px;border-radius:9px;color:inherit;font-size:13px;flex:0 0 auto;" +
      "display:flex;align-items:center;justify-content:center;padding:0;cursor:pointer;" +
      "border:1px solid rgba(255,255,255,0.14);background:rgba(255,255,255,0.06);", head, "✕");
    closeBtn.setAttribute("aria-label", "Close the tuning panel");

    const body = el("div", "display:flex;flex-direction:column;gap:10px;", sheet);

    // Preset chips.
    const chips = el("div",
      "display:flex;gap:6px;overflow-x:auto;padding-bottom:2px;-webkit-overflow-scrolling:touch;scrollbar-width:none;", body);
    const chipEls = PRESETS.map((p) => {
      const c = el("button",
        "flex:0 0 auto;pointer-events:auto;border-radius:11px;padding:7px 12px;font-size:12px;font-weight:600;" +
        "color:inherit;cursor:pointer;white-space:nowrap;border:1px solid rgba(255,255,255,0.14);" +
        "background:rgba(255,255,255,0.06);transition:background .18s ease,border-color .18s ease;", chips, p.name);
      ctx.listen(c, "click", (e) => {
        e.stopPropagation();
        firstGesture();
        state.feed = p.f;
        state.kill = p.k;
        syncControls();
        buzz("medium");
        sting("success");
        ctx.platform.interact({ kind: "preset", name: p.name });
        ctx.platform.emit("preset", { name: p.name });
        persist();
      });
      return c;
    });

    // Feed/kill pad — the phase space itself, with the presets as landmarks.
    const padWrap = el("div", "position:relative;", body);
    const pad = el("div",
      "position:relative;height:132px;border-radius:14px;pointer-events:auto;touch-action:none;cursor:crosshair;" +
      "border:1px solid rgba(255,255,255,0.14);overflow:hidden;" +
      "background:radial-gradient(120% 90% at 18% 88%, rgba(94,234,212,0.22), transparent 62%)," +
      "radial-gradient(120% 90% at 82% 20%, rgba(168,85,247,0.26), transparent 60%)," +
      "linear-gradient(140deg, rgba(30,41,80,0.55), rgba(10,10,18,0.75));", padWrap);

    el("div", "position:absolute;left:8px;bottom:6px;font-size:9px;letter-spacing:0.5px;opacity:0.5;" +
      "pointer-events:none;text-transform:uppercase;", pad, "kill →");
    el("div", "position:absolute;left:8px;top:6px;font-size:9px;letter-spacing:0.5px;opacity:0.5;" +
      "pointer-events:none;text-transform:uppercase;", pad, "↑ feed");

    PRESETS.forEach((p) => {
      const dot = el("div",
        "position:absolute;width:6px;height:6px;border-radius:99px;background:rgba(255,255,255,0.34);" +
        "transform:translate(-50%,-50%);pointer-events:none;", pad);
      dot.style.left = `${norm(p.k, KILL) * 100}%`;
      dot.style.top = `${(1 - norm(p.f, FEED)) * 100}%`;
    });

    const marker = el("div",
      "position:absolute;width:18px;height:18px;border-radius:99px;transform:translate(-50%,-50%);" +
      "border:2px solid rgba(255,255,255,0.95);box-shadow:0 0 14px rgba(255,255,255,0.55),inset 0 0 8px rgba(255,255,255,0.35);" +
      "pointer-events:none;transition:box-shadow .2s ease;", pad);

    let padDown = false;
    function padSet(e) {
      const r = pad.getBoundingClientRect();
      const nx = clamp01((e.clientX - r.left) / r.width);
      const ny = clamp01((e.clientY - r.top) / r.height);
      state.kill = KILL.min + nx * (KILL.max - KILL.min);
      state.feed = FEED.min + (1 - ny) * (FEED.max - FEED.min);
      syncControls();
    }
    ctx.listen(pad, "pointerdown", (e) => {
      e.stopPropagation();
      padDown = true;
      pad.setPointerCapture?.(e.pointerId);
      firstGesture();
      buzz("light");
      padSet(e);
    });
    ctx.listen(pad, "pointermove", (e) => {
      if (!padDown) return;
      e.stopPropagation();
      padSet(e);
      const now = performance.now();
      if (now - lastInteract > 400) {
        lastInteract = now;
        ctx.platform.interact({ kind: "tune" });
      }
    });
    ctx.listen(pad, "pointerup", (e) => {
      e.stopPropagation();
      padDown = false;
      persist();
    });
    ctx.listen(pad, "pointercancel", () => { padDown = false; });

    function slider(label, min, max, step, get, set) {
      const row = el("div", "display:flex;align-items:center;gap:10px;pointer-events:auto;", body);
      el("div", "font-size:10px;letter-spacing:0.5px;opacity:0.6;width:46px;text-transform:uppercase;", row, label);
      const input = el("input",
        "flex:1;pointer-events:auto;accent-color:#c4b5fd;height:22px;background:transparent;", row);
      input.type = "range";
      input.min = min; input.max = max; input.step = step;
      input.value = get();
      const val = el("div",
        "font-size:10px;opacity:0.55;width:30px;text-align:right;font-variant-numeric:tabular-nums;", row, "");
      const paint = () => { val.textContent = Number(input.value).toFixed(step < 0.1 ? 2 : 0); };
      paint();
      ctx.listen(input, "input", (e) => {
        e.stopPropagation();
        set(Number(input.value));
        paint();
      });
      ctx.listen(input, "pointerdown", (e) => e.stopPropagation());
      ctx.listen(input, "change", () => { persist(); firstGesture(); });
      return { input, paint };
    }

    const scaleSlider = slider("Scale", SCALE.min, SCALE.max, 0.01,
      () => state.scale, (v) => { state.scale = clamp(v, SCALE.min, SCALE.max); });
    const speedSlider = slider("Speed", 2, 18, 1, () => state.steps, (v) => { state.steps = Math.round(v); });

    let sheetOpen = !!state.sheet;
    function applySheet() {
      // 140% clears the sheet's own height plus its bottom margin, so the
      // closed state leaves the canvas completely unobstructed.
      sheet.style.transform = sheetOpen ? "translateY(0)" : "translateY(140%)";
      sheet.style.opacity = sheetOpen ? "1" : "0";
      sheet.style.pointerEvents = sheetOpen ? "auto" : "none";
      tuneBtn.style.background = sheetOpen ? GLASS_ON : GLASS_BG;
    }
    function toggleSheet(force) {
      sheetOpen = force != null ? force : !sheetOpen;
      state.sheet = sheetOpen;
      applySheet();
      persist();
    }
    ctx.listen(closeBtn, "click", (e) => {
      e.stopPropagation();
      buzz("light");
      toggleSheet(false);
    });
    ctx.listen(sheet, "pointerdown", (e) => e.stopPropagation());

    // Toast for palette / seed feedback.
    const toast = el("div", GLASS +
      "position:absolute;left:50%;top:50%;transform:translate(-50%,-50%) scale(0.94);border-radius:14px;" +
      "padding:9px 16px;font-size:13px;font-weight:600;opacity:0;transition:opacity .25s ease,transform .25s ease;" +
      "pointer-events:none;letter-spacing:0.3px;");
    let toastToken = 0;
    function flash(text) {
      toast.textContent = text;
      toast.style.opacity = "1";
      toast.style.transform = "translate(-50%,-50%) scale(1)";
      const mine = ++toastToken;
      ctx.timeout(() => {
        if (mine !== toastToken) return;
        toast.style.opacity = "0";
        toast.style.transform = "translate(-50%,-50%) scale(0.94)";
      }, 850);
    }

    // First-run hint, retired by the first stroke.
    hint = el("div",
      "position:absolute;left:0;right:0;top:50%;transform:translateY(-50%);text-align:center;font-size:14px;" +
      "letter-spacing:0.4px;opacity:0.9;pointer-events:none;text-shadow:0 2px 18px rgba(0,0,0,0.75);" +
      "transition:opacity .5s ease;", null, "drag to grow");
    ctx.interval(() => {
      if (!hint) return; // becomes a no-op once the first stroke lands
      hint.style.opacity = hint.style.opacity === "0.45" ? "0.9" : "0.45";
    }, 1100);
    function hideHint() {
      if (!hint) return;
      hint.style.opacity = "0";
      const dead = hint;
      hint = null;
      ctx.timeout(() => dead.remove(), 600);
    }

    // Help panel.
    const help = el("div",
      "position:absolute;inset:0;display:none;align-items:center;justify-content:center;padding:24px;" +
      "background:rgba(6,6,12,0.72);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);pointer-events:auto;");
    const helpCard = el("div", GLASS +
      "border-radius:18px;padding:18px 18px 16px;max-width:330px;width:100%;box-shadow:0 20px 60px rgba(0,0,0,0.55);", help);
    el("div", "font-size:16px;font-weight:700;margin-bottom:4px;", helpCard, "Turing Soup");
    el("div", "font-size:12px;opacity:0.68;line-height:1.5;margin-bottom:10px;", helpCard,
      "Two chemicals. A feeds the dish, B eats A and copies itself. Everything you see grows from that one rule.");
    const list = el("ul", "margin:0;padding-left:16px;font-size:12.5px;line-height:1.72;opacity:0.9;", helpCard);
    [
      "Drag anywhere to inject chemical B.",
      "≡ opens the tuning panel; drag its pad to steer feed (↑) and kill (→).",
      "Chips jump to classic regimes: coral, worms, maze, solitons, holes, amoeba.",
      "Scale sets how big the structures grow; Speed sets how fast time runs.",
      "◐ swaps the palette, ✳ scatters new seeds, ⟲ clears the dish.",
      "Patterns wrap around every edge, so growth never hits a wall."
    ].forEach((t) => el("li", null, list, t));
    const helpClose = el("button",
      "margin-top:14px;width:100%;pointer-events:auto;border-radius:12px;padding:10px;font-size:13px;font-weight:650;" +
      "color:#0b0b12;background:rgba(255,255,255,0.9);border:none;cursor:pointer;", helpCard, "Got it");

    let helpOpen = false;
    function toggleHelp(force) {
      helpOpen = force != null ? force : !helpOpen;
      help.style.display = helpOpen ? "flex" : "none";
      helpBtn.style.background = helpOpen ? GLASS_ON : GLASS_BG;
    }
    ctx.listen(helpClose, "click", (e) => { e.stopPropagation(); toggleHelp(false); buzz("light"); });
    ctx.listen(helpCard, "click", (e) => e.stopPropagation()); // reading it should not close it
    ctx.listen(help, "click", () => toggleHelp(false));

    // ---- control sync ------------------------------------------------------
    function norm(v, range) {
      return clamp01((v - range.min) / (range.max - range.min));
    }

    function syncControls() {
      marker.style.left = `${norm(state.kill, KILL) * 100}%`;
      marker.style.top = `${(1 - norm(state.feed, FEED)) * 100}%`;

      let best = null, bestD = Infinity;
      for (const p of PRESETS) {
        const d = Math.hypot((p.f - state.feed) / (FEED.max - FEED.min), (p.k - state.kill) / (KILL.max - KILL.min));
        if (d < bestD) { bestD = d; best = p; }
      }
      const near = bestD < 0.035;
      regimeName.textContent = near ? best.name : "Custom";
      regimeNums.textContent =
        `f ${state.feed.toFixed(4).slice(1)} · k ${state.kill.toFixed(4).slice(1)}`;
      chipEls.forEach((c, i) => {
        const on = near && PRESETS[i] === best;
        c.style.background = on ? "rgba(255,255,255,0.22)" : "rgba(255,255,255,0.06)";
        c.style.borderColor = on ? "rgba(255,255,255,0.5)" : "rgba(255,255,255,0.14)";
      });
    }

    function persist() {
      if (!ctx.capabilities?.storage) return;
      try {
        ctx.storage.set("soup", {
          feed: state.feed, kill: state.kill, scale: state.scale,
          steps: state.steps, palette: state.palette, sheet: state.sheet, music: state.music
        });
      } catch (err) { /* storage is a convenience, never a hard dependency */ }
    }

    function readSaved() {
      if (!ctx.capabilities?.storage) return null;
      try {
        const v = ctx.storage.get("soup");
        return v && typeof v === "object" ? v : null;
      } catch (err) {
        return null;
      }
    }

    scaleSlider.input.value = state.scale;
    scaleSlider.paint();
    speedSlider.input.value = state.steps;
    speedSlider.paint();
    musicBtn.textContent = state.music ? "♪" : "♪̸";
    musicBtn.style.opacity = state.music ? "1" : "0.5";
    syncControls();
    applySheet();

    // ---- feel: haptics + sound --------------------------------------------
    function buzz(kind) {
      if (!ctx.capabilities?.haptics) return;
      try { ctx.platform.haptic(kind); } catch (err) { /* optional */ }
    }

    function sting(name) {
      if (!state.music || !ctx.capabilities?.backgroundMusic || !musicHandle) return;
      try { ctx.music.sting(name); } catch (err) { /* optional */ }
    }

    async function startMusic() {
      if (!state.music || musicHandle || !ctx.capabilities?.backgroundMusic) return;
      try {
        await ctx.music.unlock();
        musicHandle = await ctx.music.play({
          preset: "drone",
          volume: 0.42,
          tempo: 62,
          intensity: 0.3,
          scale: "hirajoshi",
          fadeInMs: 2400
        });
      } catch (err) {
        musicHandle = null;
      }
    }

    function firstGesture() {
      if (started) return;
      started = true;
      try { ctx.platform.start(); } catch (err) { /* optional */ }
      startMusic();
    }

    // ---- frame loop --------------------------------------------------------
    let lastMeasure = 0;
    let lowStreak = 0;
    let lastRevive = -1e9;
    let lastW = ctx.width, lastH = ctx.height;

    function frame(dtMs, timeMs) {
      if (ctx.width !== lastW || ctx.height !== lastH) {
        lastW = ctx.width; lastH = ctx.height;
        syncSize(false);
      }

      const brush = pendingBrush;
      pendingBrush = null;
      engine.step(state.steps, brush);
      engine.render(timeMs, viewW, viewH);

      // One cheap 8x8 readback drives both the music bed and the revival check.
      if (timeMs - lastMeasure > 500) {
        lastMeasure = timeMs;
        let m = activity;
        try { m = engine.measure(); } catch (err) { /* keep the last reading */ }
        activity += (m - activity) * 0.4;

        if (musicHandle) {
          try {
            musicHandle.setIntensity(Math.max(0.12, Math.min(0.9, activity * 4.2)));
            musicHandle.setVolume(0.3 + Math.min(0.22, activity * 1.6));
          } catch (err) { /* audio is decorative */ }
        }

        // Parts of feed/kill space are lethal, and a colony can burn out on its
        // own. A quiet dish reseeds itself so the bit is never a black screen.
        if (m < 0.005) {
          lowStreak++;
          if (lowStreak >= 3 && timeMs - lastRevive > 2500) {
            lowStreak = 0;
            lastRevive = timeMs;
            seed("revive");
            ctx.platform.emit("revive");
          }
        } else {
          lowStreak = 0;
        }
      }
    }

    // Draw one frame before handing over, so the very first paint is alive.
    engine.step(2, null);
    engine.render(0, viewW, viewH);
    ctx.onFrame(frame);

    ctx.onDestroy(() => {
      if (musicHandle) {
        try { musicHandle.stop({ fadeOutMs: 300 }); } catch (err) { /* ignore */ }
        musicHandle = null;
      }
    });

    function report(err) {
      try { ctx.platform.error({ message: String(err && err.message ? err.message : err) }); } catch (e) { /* ignore */ }
    }

    function showFatal() {
      const box = ctx.createRoot();
      box.setAttribute("style",
        "display:flex;align-items:center;justify-content:center;padding:28px;text-align:center;" +
        "background:#0a0a12;color:rgba(255,255,255,0.8);font:500 14px/1.5 -apple-system,sans-serif;");
      box.textContent = "This bit needs WebGL. Try opening it in the Plethora app.";
      ctx.platform.ready();
    }

    function clamp01(v) {
      return v < 0 ? 0 : v > 1 ? 1 : v;
    }

    function clamp(v, lo, hi) {
      return v < lo ? lo : v > hi ? hi : v;
    }

    ctx.platform.ready();
  }
};
