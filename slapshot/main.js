/**
 * Slapshot — two-player air hockey on a single phone, rendered in 3D.
 *
 * The phone lies flat between two people, one at each end. Both drag a mallet
 * at the same time with their own finger, which is the whole reason this shape
 * of game works on one device: there is no turn to wait for.
 *
 * Two decisions drive everything else.
 *
 * The camera sits directly overhead. A tilted camera looks better in a still
 * but hands the near player a bigger, closer half, and this is a game two
 * people play against each other on the same screen — the view has to be
 * identical from both ends. Straight down is the only fair angle, so the depth
 * comes from real geometry instead: extruded rails catching a rim light, a
 * puck that casts a moving shadow on the ice, bevelled mallets with lit rings.
 *
 * Every pointer is tracked by its own pointerId and bound to a half of the
 * rink for its whole life. Without that the second finger down steals the
 * first one's mallet, and a finger straying over the centre line hijacks the
 * opponent's — the two bugs that make a shared-screen game unplayable.
 *
 * Contract notes: packaged assets are disabled (maxAssets is 0), so the ice
 * texture, the rail normals and every mark on the surface are painted into an
 * OffscreenCanvas at boot and uploaded as textures. The overlay is markup on
 * ctx.createRoot() rather than document.createElement, and pointer maths uses
 * offsetX/offsetY rather than getBoundingClientRect — both of those are
 * rejected at upload and neither is documented in sdk.md.
 */
window.plethoraBit = {
  meta: {
    title: "Slapshot",
    runtime: "plethora-bit@2",
    tags: ["multiplayer", "local-multiplayer", "arcade", "two-player"],
    permissions: ["backgroundMusic", "haptics", "storage"],
  },

  async init(ctx) {
    const THREE = await ctx.importModule("three", "0.164.1");

    /* ---------------------------------------------------------------
     * Palette. Cyan owns the bottom end, magenta the top. Every glow,
     * spark and digit in the game is one of those two, so a player can
     * always tell at a glance which marks are theirs.
     * ------------------------------------------------------------- */
    const P1 = { ink: "#2de2fb", hex: 0x2de2fb, name: "Cyan" };
    const P2 = { ink: "#ff3ea5", hex: 0xff3ea5, name: "Magenta" };

    const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
    const TAU = Math.PI * 2;

    /* ---------------------------------------------------------------
     * Settings, remembered between sessions.
     * ------------------------------------------------------------- */
    const saved = (function () {
      try { return ctx.storage.get("slapshot") || {}; } catch (_) { return {}; }
    })();
    const settings = { target: saved.target || 7, speed: saved.speed || 1, mute: !!saved.mute };
    function saveSettings() { try { ctx.storage.set("slapshot", settings); } catch (_) {} }

    /* ---------------------------------------------------------------
     * Sound: a techno bed that tightens as a rally grows, stings on the
     * moments that matter, haptics so a goal is felt through the table.
     * ------------------------------------------------------------- */
    const sound = (function () {
      let muted = settings.mute, bed = null, unlocked = false;
      const start = () => ctx.music.play({ preset: "techno", volume: 0.32, tempo: 126, intensity: 0.3 });
      return {
        get muted() { return muted; },
        async unlock() {
          if (unlocked) return;
          unlocked = true;
          try { await ctx.music.unlock(); if (!muted) bed = start(); }
          catch (_) { /* audio is a nicety, never a blocker */ }
        },
        sting(n) { if (!muted) { try { ctx.music.sting(n); } catch (_) {} } },
        duck(a, ms) { if (!muted) { try { ctx.music.duck(a, ms); } catch (_) {} } },
        heat(v) { if (!muted && bed) { try { bed.setIntensity(clamp(v, 0, 1)); } catch (_) {} } },
        haptic(k) { try { ctx.platform.haptic(k); } catch (_) {} },
        toggle() {
          muted = !muted;
          settings.mute = muted;
          saveSettings();
          try {
            if (muted) { (bed || ctx.music).stop({ fadeOutMs: 200 }); bed = null; }
            else if (unlocked) bed = start();
          } catch (_) {}
          return muted;
        },
      };
    })();

    /* ---------------------------------------------------------------
     * Geometry. The world is measured so the rink exactly fills the
     * screen: one world unit is half the screen height, which makes the
     * screen-to-table mapping a straight linear scale and removes any
     * need to raycast a pointer every frame.
     * ------------------------------------------------------------- */
    const FOV = 26;
    let W = ctx.width, H = ctx.height;
    const view = {};
    function measure() {
      W = ctx.width; H = ctx.height;
      view.halfH = 1;
      view.halfW = view.halfH * (W / H);
      view.dist = view.halfH / Math.tan((FOV / 2) * Math.PI / 180);
      // Rink inset: leave room for the score strip at each end.
      view.rw = view.halfW * 0.945;
      view.rh = view.halfH * 0.855;
      view.pr = view.rw * 0.092;                 // puck radius
      view.mr = view.rw * 0.150;                 // mallet radius
      view.goalW = view.rw * 0.36;               // goal mouth, half-width
      view.wall = view.rw * 0.055;               // rail thickness
    }
    measure();

    /** Screen pixels to table coordinates, on the plane the puck slides on. */
    const toWorldX = (px) => (px / W * 2 - 1) * view.halfW;
    const toWorldZ = (py) => (py / H * 2 - 1) * view.halfH;

    /* ---------------------------------------------------------------
     * Textures. There are no packaged assets, so every surface is
     * painted into an OffscreenCanvas at boot and uploaded once.
     * document.createElement("canvas") is rejected at upload;
     * OffscreenCanvas is the accepted way to get a drawing surface that
     * the runtime does not mount.
     * ------------------------------------------------------------- */
    function surface(w, h) {
      if (typeof OffscreenCanvas === "undefined") return null;
      return new OffscreenCanvas(w, h);
    }

    /**
     * The ice: a cold gradient, faint brushed grain, centre line, face-off
     * circles and the two goal creases. Drawn at the rink's own aspect so
     * nothing stretches.
     */
    function makeIceTexture() {
      const TW = 512, TH = Math.round(TW * (view.rh / view.rw));
      const c = surface(TW, TH);
      if (!c) return null;
      const g = c.getContext("2d");

      const grad = g.createLinearGradient(0, 0, 0, TH);
      grad.addColorStop(0.00, "#122448");
      grad.addColorStop(0.30, "#0a1730");
      grad.addColorStop(0.50, "#060f21");
      grad.addColorStop(0.70, "#0a1730");
      grad.addColorStop(1.00, "#122448");
      g.fillStyle = grad;
      g.fillRect(0, 0, TW, TH);

      // Brushed grain, so a flat plane still reads as a surface under light.
      g.globalAlpha = 0.022;
      for (let i = 0; i < 700; i++) {
        const y = Math.random() * TH;
        g.strokeStyle = Math.random() < 0.5 ? "#ffffff" : "#000000";
        g.lineWidth = Math.random() * 1.4;
        g.beginPath();
        g.moveTo(Math.random() * TW, y);
        g.lineTo(Math.random() * TW, y + (Math.random() - 0.5) * 3);
        g.stroke();
      }
      g.globalAlpha = 1;

      // Centre line and circle.
      g.strokeStyle = "rgba(190,225,255,0.42)";
      g.lineWidth = 3;
      g.setLineDash([14, 11]);
      g.beginPath(); g.moveTo(0, TH / 2); g.lineTo(TW, TH / 2); g.stroke();
      g.setLineDash([]);
      g.lineWidth = 3.5;
      g.beginPath(); g.arc(TW / 2, TH / 2, TW * 0.20, 0, TAU); g.stroke();
      g.beginPath(); g.arc(TW / 2, TH / 2, TW * 0.028, 0, TAU);
      g.fillStyle = "rgba(190,225,255,0.42)"; g.fill();

      // Goal creases, tinted to whichever end each belongs to.
      const crease = (y, colour, dir) => {
        g.strokeStyle = colour;
        g.lineWidth = 4;
        g.beginPath();
        g.arc(TW / 2, y, TW * 0.245, dir > 0 ? 0 : Math.PI, dir > 0 ? Math.PI : TAU);
        g.stroke();
        g.globalAlpha = 0.055;
        g.fillStyle = colour;
        g.fill();
        g.globalAlpha = 1;
      };
      crease(0, "rgba(255,62,165,0.55)", 1);
      crease(TH, "rgba(45,226,251,0.55)", -1);

      // Face-off dots at the quarter marks of each half.
      for (const fy of [TH * 0.22, TH * 0.78]) {
        for (const fx of [TW * 0.27, TW * 0.73]) {
          g.fillStyle = "rgba(190,225,255,0.30)";
          g.beginPath(); g.arc(fx, fy, TW * 0.022, 0, TAU); g.fill();
          g.strokeStyle = "rgba(190,225,255,0.30)";
          g.lineWidth = 2.5;
          g.beginPath(); g.arc(fx, fy, TW * 0.062, 0, TAU); g.stroke();
        }
      }
      return c;
    }

    /* ---------------------------------------------------------------
     * Scene
     * ------------------------------------------------------------- */
    const canvas = ctx.createCanvas({ touchAction: "none" });
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(ctx.dpr, 2));
    renderer.setSize(W, H, false);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.02;
    ctx.onDestroy(() => renderer.dispose());

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x03060d);
    // No fog. The camera sits ~4.3 units above a table 2 units across, so any
    // fog near-plane close enough to matter starts inside the playfield and
    // washes the whole rink to the background colour.

    const camera = new THREE.PerspectiveCamera(FOV, W / H, 0.5, 40);
    camera.position.set(0, view.dist, 0);
    camera.up.set(0, 0, -1);                    // screen-up is -z
    camera.lookAt(0, 0, 0);

    /* --- ice --- */
    const iceCanvas = makeIceTexture();
    const iceMat = new THREE.MeshStandardMaterial({
      color: 0xffffff, roughness: 0.30, metalness: 0.12,
    });
    if (iceCanvas) {
      const tex = new THREE.CanvasTexture(iceCanvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 4;
      iceMat.map = tex;
      ctx.onDestroy(() => tex.dispose());
    } else {
      iceMat.color = new THREE.Color(0x0a1526);   // no OffscreenCanvas: plain ice
    }
    const ice = new THREE.Mesh(new THREE.PlaneGeometry(view.rw * 2, view.rh * 2), iceMat);
    ice.rotation.x = -Math.PI / 2;
    ice.receiveShadow = true;
    scene.add(ice);

    /* --- surround ---
     * The strip of screen beyond the rails is where each player's score
     * lives. Left bare it reads as the bit having failed to fill the
     * screen, so it gets the table's own frame: a dark brushed deck
     * sitting a hair below the ice, catching the same lights.
     */
    const deck = new THREE.Mesh(
      new THREE.PlaneGeometry(view.halfW * 4, view.halfH * 4),
      new THREE.MeshStandardMaterial({ color: 0x0d1424, roughness: 0.62, metalness: 0.45 })
    );
    deck.rotation.x = -Math.PI / 2;
    deck.position.y = -view.wall * 0.35;
    deck.receiveShadow = true;
    scene.add(deck);

    /* --- rails ---
     * Four sides, with the two end rails split around a goal mouth. Real
     * boxes rather than a painted border: an overhead camera still sees
     * their inner faces near the screen edges, and that parallax is most
     * of what sells the table as an object rather than a picture.
     */
    const railMat = new THREE.MeshStandardMaterial({
      color: 0x2c3d5f, roughness: 0.30, metalness: 0.80,
    });
    const railH = view.wall * 1.5;
    const railGroup = new THREE.Group();
    function rail(cx, cz, sx, sz) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(sx, railH, sz), railMat);
      m.position.set(cx, railH / 2, cz);
      m.castShadow = true;
      m.receiveShadow = true;
      railGroup.add(m);
      return m;
    }
    const wt = view.wall;
    // Sides run the full length, overlapping the ends so the corners are solid.
    rail(-view.rw - wt / 2, 0, wt, (view.rh + wt) * 2);
    rail(view.rw + wt / 2, 0, wt, (view.rh + wt) * 2);
    // Ends, split around the goal.
    const endSeg = view.rw - view.goalW;
    for (const z of [-view.rh - wt / 2, view.rh + wt / 2]) {
      rail(-view.goalW - endSeg / 2, z, endSeg, wt);
      rail(view.goalW + endSeg / 2, z, endSeg, wt);
    }
    scene.add(railGroup);

    /* --- goals ---
     * A lit mouth at each end. The bar glows in the colour of the player
     * who is defending it, so you always know which end is yours even
     * mid-scramble.
     */
    function goal(z, hex) {
      const g = new THREE.Group();
      const bar = new THREE.Mesh(
        new THREE.BoxGeometry(view.goalW * 2, railH * 0.42, wt * 0.55),
        new THREE.MeshStandardMaterial({
          color: hex, emissive: hex, emissiveIntensity: 1.5, roughness: 0.4, metalness: 0.3,
        })
      );
      bar.position.set(0, railH * 0.24, z + Math.sign(z) * wt * 0.42);
      g.add(bar);
      // A pool of that colour spilling onto the ice in front of the mouth.
      const wash = new THREE.PointLight(hex, 0.85, view.rw * 0.8, 2);
      wash.position.set(0, railH * 1.6, z * 0.94);
      g.add(wash);
      scene.add(g);
      return { bar, wash };
    }
    const goalTop = goal(-view.rh, P2.hex);      // top mouth: P2 defends it
    const goalBot = goal(view.rh, P1.hex);       // bottom mouth: P1 defends it

    /* --- puck --- */
    const puckMat = new THREE.MeshStandardMaterial({
      color: 0x10151f, roughness: 0.42, metalness: 0.55,
    });
    const puckMesh = new THREE.Mesh(
      new THREE.CylinderGeometry(view.pr, view.pr * 0.96, view.pr * 0.46, 40, 1, false),
      puckMat
    );
    puckMesh.castShadow = true;
    puckMesh.position.y = view.pr * 0.26;
    // A lit band around the puck's edge. It is the only thing on the table
    // that changes colour: it takes the tint of whoever last touched it, so
    // possession is legible at a glance across the whole rink.
    const puckRingMat = new THREE.MeshStandardMaterial({
      color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 2.3,
      roughness: 0.3, metalness: 0.1,
    });
    const puckRing = new THREE.Mesh(
      new THREE.TorusGeometry(view.pr * 0.97, view.pr * 0.17, 12, 40), puckRingMat
    );
    puckRing.rotation.x = Math.PI / 2;
    puckRing.position.y = view.pr * 0.26;
    const puckLight = new THREE.PointLight(0xffffff, 0.7, view.rw * 0.7, 2);
    puckLight.position.y = view.pr * 0.8;
    scene.add(puckMesh, puckRing, puckLight);

    /* --- mallets --- */
    function mallet(hex) {
      const g = new THREE.Group();
      const body = new THREE.Mesh(
        new THREE.CylinderGeometry(view.mr, view.mr * 0.94, view.mr * 0.34, 44),
        new THREE.MeshStandardMaterial({ color: 0x1d2740, roughness: 0.34, metalness: 0.66 })
      );
      body.castShadow = true;
      body.position.y = view.mr * 0.17;
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(view.mr * 0.84, view.mr * 0.13, 12, 44),
        new THREE.MeshStandardMaterial({
          color: hex, emissive: hex, emissiveIntensity: 2.0, roughness: 0.3,
        })
      );
      ring.rotation.x = Math.PI / 2;
      ring.position.y = view.mr * 0.345;
      const knob = new THREE.Mesh(
        new THREE.SphereGeometry(view.mr * 0.34, 24, 16),
        new THREE.MeshStandardMaterial({ color: 0x232c44, roughness: 0.28, metalness: 0.7 })
      );
      knob.position.y = view.mr * 0.46;
      knob.castShadow = true;
      const halo = new THREE.PointLight(hex, 0.5, view.rw * 0.6, 2);
      halo.position.y = view.mr * 0.7;
      g.add(body, ring, knob, halo);
      scene.add(g);
      return g;
    }
    const malletMesh = { p1: mallet(P1.hex), p2: mallet(P2.hex) };

    /* --- lights ---
     * A cool key from above for the shadows, a dim fill so the rails never
     * go black, and one coloured wash per half so each player's end reads
     * as theirs before a single mark is drawn.
     */
    scene.add(new THREE.AmbientLight(0x2c4570, 0.30));
    scene.add(new THREE.HemisphereLight(0x5478ad, 0x05080f, 0.22));
    const key = new THREE.DirectionalLight(0xdceaff, 0.85);
    key.position.set(view.rw * 0.7, view.dist * 0.75, -view.rh * 0.5);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.left = -view.halfW * 1.3;
    key.shadow.camera.right = view.halfW * 1.3;
    key.shadow.camera.top = view.halfH * 1.3;
    key.shadow.camera.bottom = -view.halfH * 1.3;
    key.shadow.camera.near = 0.4;
    key.shadow.camera.far = view.dist * 2;
    key.shadow.bias = -0.0012;
    scene.add(key);
    const washP1 = new THREE.PointLight(P1.hex, 0.55, view.rh * 1.05, 2);
    washP1.position.set(0, railH * 2.0, view.rh * 0.74);
    const washP2 = new THREE.PointLight(P2.hex, 0.55, view.rh * 1.05, 2);
    washP2.position.set(0, railH * 2.0, -view.rh * 0.74);
    scene.add(washP1, washP2);

    /* ---------------------------------------------------------------
     * Sparks. A small pool of lit quads reused forever — allocating
     * meshes mid-rally is the one thing that stutters this scene.
     * ------------------------------------------------------------- */
    const sparks = (function () {
      const N = 90;
      const geo = new THREE.SphereGeometry(view.pr * 0.13, 10, 8);
      const pool = [];
      for (let i = 0; i < N; i++) {
        const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
          color: 0xffffff, transparent: true, opacity: 0,
        }));
        m.visible = false;
        scene.add(m);
        pool.push({ mesh: m, life: 0, max: 1, vx: 0, vy: 0, vz: 0 });
      }
      let next = 0;
      return {
        burst(x, z, hex, count, power) {
          for (let i = 0; i < count; i++) {
            const p = pool[next = (next + 1) % N];
            const a = Math.random() * TAU;
            const sp = power * (0.4 + Math.random() * 0.9);
            p.mesh.position.set(x, view.pr * 0.35, z);
            p.mesh.material.color.setHex(hex);
            p.vx = Math.cos(a) * sp;
            p.vz = Math.sin(a) * sp;
            p.vy = Math.random() * power * 0.7;
            p.max = p.life = 0.34 + Math.random() * 0.4;
            p.mesh.visible = true;
          }
        },
        step(dt) {
          for (const p of pool) {
            if (p.life <= 0) continue;
            p.life -= dt;
            if (p.life <= 0) { p.mesh.visible = false; continue; }
            p.mesh.position.x += p.vx * dt;
            p.mesh.position.z += p.vz * dt;
            p.mesh.position.y += p.vy * dt;
            p.vy -= 3.2 * dt;
            if (p.mesh.position.y < view.pr * 0.16) { p.mesh.position.y = view.pr * 0.16; p.vy *= -0.42; }
            p.vx *= 0.965; p.vz *= 0.965;
            const t = p.life / p.max;
            p.mesh.material.opacity = t;
            p.mesh.scale.setScalar(0.55 + t * 0.85);
          }
        },
      };
    })();

    /* ---------------------------------------------------------------
     * State
     * ------------------------------------------------------------- */
    const SPEEDS = { 0: 0.82, 1: 1.0, 2: 1.24 };
    const puck = { x: 0, z: 0, vx: 0, vz: 0, owner: null };
    const pads = {
      p1: { x: 0, z: view.rh * 0.6, vx: 0, vz: 0, tx: 0, tz: view.rh * 0.6, held: null },
      p2: { x: 0, z: -view.rh * 0.6, vx: 0, vz: 0, tx: 0, tz: -view.rh * 0.6, held: null },
    };
    let phase = "menu";            // menu | serve | play | goal | over
    let score = { p1: 0, p2: 0 };
    let rally = 0, bestRally = 0, serveTimer = 0, serveTo = 1, shake = 0;
    let matchStart = 0, winner = null;

    function resetPuck(towards) {
      puck.x = 0; puck.z = 0; puck.vx = 0; puck.vz = 0; puck.owner = null;
      serveTo = towards;
      serveTimer = 1.15;
      phase = "serve";
      rally = 0;
      puckRingMat.color.setHex(0xffffff);
      puckRingMat.emissive.setHex(0xffffff);
      puckLight.color.setHex(0xffffff);
    }

    function newMatch() {
      score = { p1: 0, p2: 0 };
      winner = null;
      bestRally = 0;
      matchStart = performance.now();
      pads.p1.x = 0; pads.p1.z = view.rh * 0.6; pads.p1.tx = 0; pads.p1.tz = view.rh * 0.6;
      pads.p2.x = 0; pads.p2.z = -view.rh * 0.6; pads.p2.tx = 0; pads.p2.tz = -view.rh * 0.6;
      resetPuck(Math.random() < 0.5 ? 1 : -1);
      paintScore();
    }

    /* ---------------------------------------------------------------
     * Physics. The puck is integrated in substeps sized to its own
     * speed: a hard slap can cross a mallet's whole diameter in one
     * 16ms frame, and a single-step test would miss the contact and let
     * the puck pass straight through.
     * ------------------------------------------------------------- */
    function padHit(pad, hex) {
      const dx = puck.x - pad.x, dz = puck.z - pad.z;
      const d = Math.hypot(dx, dz);
      const minD = view.pr + view.mr;
      if (d >= minD || d === 0) return false;

      const nx = dx / d, nz = dz / d;
      puck.x = pad.x + nx * minD;
      puck.z = pad.z + nz * minD;

      const rvx = puck.vx - pad.vx, rvz = puck.vz - pad.vz;
      const along = rvx * nx + rvz * nz;
      if (along < 0) {
        const e = 1.62;                          // lively; a slap should carry
        puck.vx -= e * along * nx;
        puck.vz -= e * along * nz;
      }
      // A moving mallet adds its own push, which is what makes a deliberate
      // swing feel different from the puck merely bouncing off a parked pad.
      puck.vx += pad.vx * 0.44;
      puck.vz += pad.vz * 0.44;

      const power = Math.hypot(puck.vx, puck.vz);
      rally++;
      if (rally > bestRally) bestRally = rally;
      puck.owner = hex;
      puckRingMat.color.setHex(hex);
      puckRingMat.emissive.setHex(hex);
      puckLight.color.setHex(hex);
      sparks.burst(puck.x, puck.z, hex, power > 2.4 ? 9 : 5, Math.min(power * 0.5, 2.4));
      sound.sting(power > 2.6 ? "powerup" : "tap");
      sound.haptic(power > 2.6 ? "medium" : "light");
      sound.heat(Math.min(rally / 26, 1));
      shake = Math.min(shake + power * 0.0022, 0.020);
      ctx.platform.interact({ type: "hit", rally });
      return true;
    }

    function stepPhysics(dt) {
      const speed = SPEEDS[settings.speed];
      const maxV = 7.5 * speed;

      for (const k of ["p1", "p2"]) {
        const pad = pads[k];
        // The mallet chases the finger rather than teleporting to it. That
        // gives it a real velocity to hand the puck, and stops a flick across
        // the screen from launching the puck at an impossible speed.
        const ax = pad.tx - pad.x, az = pad.tz - pad.z;
        const follow = 1 - Math.pow(0.0016, dt);
        const nx2 = pad.x + ax * follow, nz2 = pad.z + az * follow;
        pad.vx = (nx2 - pad.x) / Math.max(dt, 0.0001);
        pad.vz = (nz2 - pad.z) / Math.max(dt, 0.0001);
        const cap = 9.5;
        const pv = Math.hypot(pad.vx, pad.vz);
        if (pv > cap) { pad.vx = pad.vx / pv * cap; pad.vz = pad.vz / pv * cap; }
        pad.x = nx2; pad.z = nz2;
      }

      if (phase !== "play") return;

      const sp = Math.hypot(puck.vx, puck.vz);
      const steps = clamp(Math.ceil(sp * dt / (view.pr * 0.5)), 1, 12);
      const h = dt / steps;

      for (let i = 0; i < steps; i++) {
        puck.x += puck.vx * h;
        puck.z += puck.vz * h;

        // Side rails.
        if (puck.x - view.pr < -view.rw) {
          puck.x = -view.rw + view.pr; puck.vx = Math.abs(puck.vx) * 0.94;
          wallHit();
        } else if (puck.x + view.pr > view.rw) {
          puck.x = view.rw - view.pr; puck.vx = -Math.abs(puck.vx) * 0.94;
          wallHit();
        }

        // End rails, with a mouth cut out of the middle.
        if (puck.z - view.pr < -view.rh) {
          if (Math.abs(puck.x) < view.goalW) { scoreGoal("p1"); return; }
          puck.z = -view.rh + view.pr; puck.vz = Math.abs(puck.vz) * 0.94;
          wallHit();
        } else if (puck.z + view.pr > view.rh) {
          if (Math.abs(puck.x) < view.goalW) { scoreGoal("p2"); return; }
          puck.z = view.rh - view.pr; puck.vz = -Math.abs(puck.vz) * 0.94;
          wallHit();
        }

        if (padHit(pads.p1, P1.hex)) { /* bound below */ }
        if (padHit(pads.p2, P2.hex)) { /* bound below */ }
      }

      // Air-hockey tables are nearly frictionless; this is just enough drag
      // that a dead puck eventually settles instead of drifting forever.
      const drag = Math.pow(0.9955, dt * 60);
      puck.vx *= drag; puck.vz *= drag;
      const v = Math.hypot(puck.vx, puck.vz);
      if (v > maxV) { puck.vx = puck.vx / v * maxV; puck.vz = puck.vz / v * maxV; }
    }

    let lastWall = 0;
    function wallHit() {
      const now = performance.now();
      if (now - lastWall < 60) return;           // one cue per contact, not per substep
      lastWall = now;
      const power = Math.hypot(puck.vx, puck.vz);
      if (power < 0.6) return;
      sparks.burst(puck.x, puck.z, puck.owner || 0x9fd0ff, 4, Math.min(power * 0.35, 1.6));
      sound.sting("tap");
      shake = Math.min(shake + power * 0.0011, 0.014);
    }

    function scoreGoal(who) {
      const hex = who === "p1" ? P1.hex : P2.hex;
      score[who]++;
      phase = "goal";
      sparks.burst(puck.x, puck.z, hex, 34, 3.4);
      sound.duck(0.55, 420);
      sound.sting("win");
      sound.haptic("heavy");
      sound.heat(0.25);
      shake = 0.05;
      paintScore();
      ctx.platform.setScore(Math.max(score.p1, score.p2));
      ctx.platform.milestone("goal", { by: who, p1: score.p1, p2: score.p2 });

      if (score[who] >= settings.target) return endMatch(who);
      ctx.timeout(() => { if (phase === "goal") resetPuck(who === "p1" ? -1 : 1); }, 900);
    }

    async function endMatch(who) {
      phase = "over";
      winner = who;
      const elapsed = Math.round(performance.now() - matchStart);
      const w = who === "p1" ? P1 : P2;
      shell.el("over-title").textContent = w.name + " wins";
      shell.el("over-title").style.color = w.ink;
      shell.el("over-line").textContent =
        score.p1 + " – " + score.p2 + "   ·   longest rally " + bestRally;
      shell.el("over").style.display = "flex";
      ctx.platform.complete({ winner: who, p1: score.p1, p2: score.p2, bestRally });
      sound.sting("success");
      // Both stats are shared between the two players on this phone — they
      // are a record of the match, not of one person, which is exactly what a
      // couch game should be putting on a global board.
      try {
        if (bestRally > 0) await ctx.memory.record("longest_rally").submit(bestRally, { label: bestRally + " hits" });
        await ctx.memory.record("fastest_win").submit(elapsed);
      } catch (_) { /* offline is fine; the match still finished */ }
    }

    /* ---------------------------------------------------------------
     * Overlay. Declared as one markup string on the runtime-owned root
     * and queried back out by [data-el] — bits may not reach into the
     * host DOM, and document.createElement is rejected at upload.
     *
     * Everything belonging to the top player is rotated 180 degrees,
     * because they are sitting at the other end of the table and would
     * otherwise be reading their own score upside down.
     * ------------------------------------------------------------- */
    const FONT = "-apple-system,system-ui,'Segoe UI',Roboto,sans-serif";
    const SAFE_T = ctx.safeArea.top, SAFE_B = ctx.safeArea.bottom;

    const btnCss = "pointer-events:auto;width:38px;height:38px;border-radius:13px;border:none;" +
      "background:rgba(160,205,255,0.13);color:#dceaff;font-size:16px;line-height:1;" +
      "font-family:inherit;padding:0;";
    const bigBtn = (bg, fg) => "width:100%;padding:15px;border:none;border-radius:16px;font-family:inherit;" +
      "font-size:16px;font-weight:700;background:" + bg + ";color:" + fg + ";margin-top:10px;";

    const root = ctx.createRoot({ touchAction: "none" });
    // The overlay sits above the WebGL canvas, so it must be transparent to
    // pointers or it swallows every drag meant for a mallet. Only the chrome
    // that is meant to be pressed opts back in.
    root.style.cssText += ";font-family:" + FONT + ";color:#dceaff;pointer-events:none;";
    root.innerHTML =
      // --- top player's score, upside down for their seat ---
      '<div data-el="s2" style="position:absolute;right:20px;top:' + (SAFE_T + 30) + 'px;' +
        'transform:rotate(180deg);pointer-events:none;font-size:46px;line-height:1;' +
        'font-weight:800;color:' + P2.ink + ';text-shadow:0 0 26px ' + P2.ink + '99;">0</div>' +
      // --- bottom player's score, in the mirrored corner ---
      '<div data-el="s1" style="position:absolute;left:20px;bottom:' + (SAFE_B + 30) + 'px;' +
        'pointer-events:none;font-size:46px;line-height:1;font-weight:800;color:' + P1.ink + ';' +
        'text-shadow:0 0 26px ' + P1.ink + '99;">0</div>' +
      // --- rally counter, on the centre line where it belongs to neither ---
      '<div data-el="rally" style="position:absolute;left:0;right:0;top:50%;transform:translateY(-50%);' +
        'text-align:center;pointer-events:none;font-size:12px;letter-spacing:0.3em;' +
        'text-transform:uppercase;opacity:0;color:#9fd0ff;"></div>' +
      // --- chrome ---
      '<div style="position:absolute;right:11px;top:' + (SAFE_T + 8) + 'px;display:flex;gap:7px;' +
        'z-index:40;pointer-events:none;">' +
        '<button data-el="mute" aria-label="Sound" style="' + btnCss + '">🔊</button>' +
        '<button data-el="cog" aria-label="Settings" style="' + btnCss + '">⚙</button>' +
        '<button data-el="help" aria-label="How to play" style="' + btnCss + '">?</button>' +
      '</div>' +
      // --- serve countdown ---
      '<div data-el="serve" style="position:absolute;inset:0;display:none;align-items:center;' +
        'justify-content:center;pointer-events:none;font-size:74px;font-weight:800;' +
        'color:#eaf4ff;text-shadow:0 0 32px rgba(120,200,255,0.55);"></div>' +
      // --- title / start ---
      '<div data-el="menu" style="position:absolute;inset:0;pointer-events:auto;display:flex;flex-direction:column;' +
        'align-items:center;justify-content:center;gap:8px;background:rgba(3,6,13,0.82);z-index:50;' +
        'padding:26px;text-align:center;">' +
        '<div style="font-size:13px;letter-spacing:0.42em;text-transform:uppercase;opacity:0.5;">Air Hockey</div>' +
        '<div style="font-size:54px;font-weight:800;letter-spacing:-0.02em;background:linear-gradient(92deg,' +
          P1.ink + ',' + P2.ink + ');-webkit-background-clip:text;background-clip:text;' +
          '-webkit-text-fill-color:transparent;">Slapshot</div>' +
        '<div style="font-size:15px;opacity:0.62;max-width:250px;line-height:1.55;margin-top:4px;">' +
          'Lay the phone flat. Take an end each. Drag your mallet — both of you at once.</div>' +
        '<button data-el="play" style="' + bigBtn("linear-gradient(92deg," + P1.ink + "," + P2.ink + ")", "#04121c") +
          'max-width:230px;margin-top:20px;">Face off</button>' +
      '</div>' +
      // --- match over ---
      '<div data-el="over" style="position:absolute;inset:0;pointer-events:auto;display:none;flex-direction:column;' +
        'align-items:center;justify-content:center;gap:6px;background:rgba(3,6,13,0.9);z-index:55;' +
        'padding:26px;text-align:center;">' +
        '<div data-el="over-title" style="font-size:40px;font-weight:800;"></div>' +
        '<div data-el="over-line" style="font-size:14px;opacity:0.6;letter-spacing:0.02em;"></div>' +
        '<button data-el="again" style="' + bigBtn("rgba(160,205,255,0.16)", "#eaf4ff") +
          'max-width:230px;margin-top:22px;">Rematch</button>' +
      '</div>' +
      // --- settings ---
      '<div data-el="cogp" style="position:absolute;inset:0;pointer-events:auto;display:none;align-items:center;' +
        'justify-content:center;background:rgba(3,6,13,0.92);z-index:70;padding:24px;">' +
        '<div style="max-width:320px;width:100%;background:rgba(14,22,38,0.98);border-radius:22px;' +
          'padding:22px;border:1px solid rgba(160,205,255,0.12);">' +
          '<div style="font-size:19px;font-weight:700;margin-bottom:16px;">Settings</div>' +
          '<div style="font-size:12px;letter-spacing:0.2em;text-transform:uppercase;opacity:0.5;">Play to</div>' +
          '<div data-el="targets" style="display:flex;gap:8px;margin:9px 0 18px;"></div>' +
          '<div style="font-size:12px;letter-spacing:0.2em;text-transform:uppercase;opacity:0.5;">Puck speed</div>' +
          '<div data-el="speeds" style="display:flex;gap:8px;margin:9px 0 4px;"></div>' +
          '<button data-el="cogp-close" style="' + bigBtn("rgba(160,205,255,0.16)", "#eaf4ff") + 'margin-top:20px;">Done</button>' +
        '</div>' +
      '</div>' +
      // --- how to play ---
      '<div data-el="helpp" style="position:absolute;inset:0;pointer-events:auto;display:none;align-items:center;' +
        'justify-content:center;background:rgba(3,6,13,0.92);z-index:70;padding:24px;">' +
        '<div style="max-width:320px;width:100%;background:rgba(14,22,38,0.98);border-radius:22px;' +
          'padding:22px;border:1px solid rgba(160,205,255,0.12);">' +
          '<div style="font-size:19px;font-weight:700;margin-bottom:12px;">How to play</div>' +
          '<ul style="font-size:14.5px;line-height:1.75;opacity:0.85;padding-left:19px;margin:0;">' +
            '<li>Put the phone flat on a table between you.</li>' +
            '<li>One player at each end. <b style="color:' + P1.ink + '">Cyan</b> defends the bottom goal, ' +
              '<b style="color:' + P2.ink + '">magenta</b> the top.</li>' +
            '<li>Drag your mallet with one finger. You can only move it in your own half.</li>' +
            '<li>Both of you play at once — there are no turns.</li>' +
            '<li>The puck glows in the colour of whoever touched it last.</li>' +
            '<li>First to ' + settings.target + ' goals wins. Your longest rally goes to the global board.</li>' +
          '</ul>' +
          '<button data-el="helpp-close" style="' + bigBtn("rgba(160,205,255,0.16)", "#eaf4ff") + 'margin-top:18px;">Got it</button>' +
        '</div>' +
      '</div>';

    const shell = {
      el: (n) => root.querySelector('[data-el="' + n + '"]'),
      tap: (node, fn) => {
        if (!node) return;
        ctx.listen(node, "pointerdown", (e) => e.stopPropagation());
        ctx.listen(node, "click", (e) => { e.stopPropagation(); e.preventDefault(); fn(e); });
      },
    };

    function paintScore() {
      shell.el("s1").textContent = String(score.p1);
      shell.el("s2").textContent = String(score.p2);
    }

    /* --- settings pills --- */
    function pills(host, values, labels, get, set) {
      host.innerHTML = values.map((v, i) =>
        '<button data-v="' + v + '" style="flex:1;padding:11px 0;border:none;border-radius:12px;' +
        'font-family:inherit;font-size:15px;font-weight:600;">' + labels[i] + '</button>').join("");
      const paint = () => {
        for (const b of host.querySelectorAll("button")) {
          const on = String(get()) === b.dataset.v;
          b.style.background = on ? "rgba(160,205,255,0.30)" : "rgba(160,205,255,0.09)";
          b.style.color = on ? "#eaf4ff" : "rgba(220,234,255,0.55)";
        }
      };
      for (const b of host.querySelectorAll("button")) {
        shell.tap(b, () => { set(Number(b.dataset.v)); saveSettings(); paint(); sound.haptic("light"); });
      }
      paint();
    }
    pills(shell.el("targets"), [5, 7, 11], ["5", "7", "11"],
      () => settings.target, (v) => { settings.target = v; });
    pills(shell.el("speeds"), [0, 1, 2], ["Calm", "Normal", "Fast"],
      () => settings.speed, (v) => { settings.speed = v; });

    /* --- chrome wiring --- */
    shell.tap(shell.el("mute"), (e) => {
      const m = sound.toggle();
      e.target.textContent = m ? "🔇" : "🔊";
    });
    if (settings.mute) shell.el("mute").textContent = "🔇";
    shell.tap(shell.el("cog"), () => { shell.el("cogp").style.display = "flex"; });
    shell.tap(shell.el("cogp-close"), () => { shell.el("cogp").style.display = "none"; });
    shell.tap(shell.el("help"), () => { shell.el("helpp").style.display = "flex"; });
    shell.tap(shell.el("helpp-close"), () => { shell.el("helpp").style.display = "none"; });

    shell.tap(shell.el("play"), async () => {
      ctx.platform.start();
      await sound.unlock();
      shell.el("menu").style.display = "none";
      newMatch();
    });
    shell.tap(shell.el("again"), () => {
      shell.el("over").style.display = "none";
      newMatch();
      ctx.platform.interact({ type: "replay" });
    });

    /* ---------------------------------------------------------------
     * Input.
     *
     * A pointer is assigned to a half the moment it lands and keeps that
     * half until it lifts. Deciding per-move instead would let a player
     * whose finger crosses the centre line start driving their
     * opponent's mallet, which is the single worst bug a shared-screen
     * game can have.
     * ------------------------------------------------------------- */
    const owners = new Map();                    // pointerId -> "p1" | "p2"

    ctx.listen(canvas, "pointerdown", (e) => {
      if (phase === "menu" || phase === "over") return;
      const half = e.offsetY > H / 2 ? "p1" : "p2";
      if (pads[half].held !== null) return;      // that end already has a hand on it
      if (canvas.setPointerCapture) { try { canvas.setPointerCapture(e.pointerId); } catch (_) {} }
      owners.set(e.pointerId, half);
      pads[half].held = e.pointerId;
      aim(half, e.offsetX, e.offsetY);
      e.preventDefault();
      if (phase === "serve") sound.unlock();
    }, { passive: false });

    ctx.listen(canvas, "pointermove", (e) => {
      const half = owners.get(e.pointerId);
      if (!half) return;
      aim(half, e.offsetX, e.offsetY);
      e.preventDefault();
    }, { passive: false });

    const release = (e) => {
      const half = owners.get(e.pointerId);
      if (!half) return;
      owners.delete(e.pointerId);
      pads[half].held = null;
    };
    ctx.listen(canvas, "pointerup", release);
    ctx.listen(canvas, "pointercancel", release);

    /** Point a mallet at a finger, clamped inside that player's own half. */
    function aim(half, px, py) {
      const pad = pads[half];
      const m = view.mr;
      pad.tx = clamp(toWorldX(px), -view.rw + m, view.rw - m);
      const z = toWorldZ(py);
      pad.tz = half === "p1"
        ? clamp(z, m * 0.35, view.rh - m)          // bottom half only
        : clamp(z, -view.rh + m, -m * 0.35);       // top half only
    }

    /* ---------------------------------------------------------------
     * Frame
     * ------------------------------------------------------------- */
    let rallyShown = -1;
    ctx.onFrame((dtMs) => {
      const dt = Math.min(dtMs, 50) / 1000;      // a long stall must not tunnel the puck

      if (phase === "serve") {
        serveTimer -= dt;
        const n = Math.ceil(serveTimer);
        const node = shell.el("serve");
        node.style.display = "flex";
        node.textContent = n > 0 ? String(n) : "";
        if (serveTimer <= 0) {
          node.style.display = "none";
          phase = "play";
          const a = (Math.random() - 0.5) * 0.7;
          const v = 2.5 * SPEEDS[settings.speed];
          puck.vx = Math.sin(a) * v;
          puck.vz = Math.cos(a) * v * serveTo;
          sound.sting("coin");
        }
      }

      stepPhysics(dt);
      sparks.step(dt);

      // Mesh follows state.
      puckMesh.position.x = puck.x; puckMesh.position.z = puck.z;
      puckRing.position.x = puck.x; puckRing.position.z = puck.z;
      puckLight.position.x = puck.x; puckLight.position.z = puck.z;
      puckMesh.rotation.y += (puck.vx + puck.vz) * dt * 0.6;
      malletMesh.p1.position.set(pads.p1.x, 0, pads.p1.z);
      malletMesh.p2.position.set(pads.p2.x, 0, pads.p2.z);

      // The rally readout only appears once a rally is worth noticing, so it
      // is not competing with the puck for attention on every single touch.
      if (rally !== rallyShown) {
        rallyShown = rally;
        const node = shell.el("rally");
        node.textContent = rally >= 4 ? rally + " hit rally" : "";
        node.style.opacity = rally >= 4 ? String(Math.min(0.28 + rally * 0.02, 0.6)) : "0";
      }

      // Camera shake, decaying. Applied to the camera rather than the world so
      // the rails and the ice stay locked together.
      if (shake > 0.0002) {
        shake *= Math.pow(0.0025, dt);
        camera.position.x = (Math.random() - 0.5) * shake * view.dist;
        camera.position.z = (Math.random() - 0.5) * shake * view.dist;
        camera.lookAt(0, 0, 0);
        camera.up.set(0, 0, -1);
      } else if (camera.position.x !== 0) {
        camera.position.x = 0; camera.position.z = 0;
        camera.lookAt(0, 0, 0);
        camera.up.set(0, 0, -1);
      }

      // Goal bars breathe when their end is under threat.
      const t = performance.now() * 0.004;
      goalTop.bar.material.emissiveIntensity = 1.3 + (puck.z < 0 ? Math.sin(t) * 0.5 + 0.6 : 0);
      goalBot.bar.material.emissiveIntensity = 1.3 + (puck.z > 0 ? Math.sin(t) * 0.5 + 0.6 : 0);

      renderer.render(scene, camera);
    });

    /* --- resize: the rink is measured from the container, so a rotation
     * or a keyboard opening has to remeasure rather than stretch. --- */
    ctx.listen(window, "resize", () => {
      if (ctx.width === W && ctx.height === H) return;
      measure();
      renderer.setSize(ctx.width, ctx.height, false);
      camera.aspect = ctx.width / ctx.height;
      camera.position.y = view.dist;
      camera.updateProjectionMatrix();
    });

    // A read-only window onto the simulation, so the local harness can drive a
    // real two-finger rally and assert on where the puck actually went. It
    // exposes nothing the bit does not already draw on screen.
    window.__SLAP__ = {
      puck, pads, get phase() { return phase; }, get score() { return score; },
      get rally() { return rally; }, get bestRally() { return bestRally; },
      halfW: view.halfW, halfH: view.halfH, rw: view.rw, rh: view.rh,
    };
    ctx.onDestroy(() => { try { delete window.__SLAP__; } catch (_) {} });

    // First frame is drawn before ready() so the host never shows a blank bit.
    renderer.render(scene, camera);
    ctx.markVisualReady("rink drawn");
    ctx.platform.ready();
  },
};
