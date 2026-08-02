/*
 * Whispering Grove
 * A relaxing first-person 3D forest you wander freely. Randomly-placed animals
 * and nature words drift among the trees; walk up and tap to collect them for
 * tiered points, each revealing a super-interesting fact. Leaves rustle when
 * touched, discoveries chime softly to guide you, and the grove is endless and
 * different every time.
 *
 * Runtime: plethora-bit@2  (window.plethoraBit)
 * Renderer: three@0.164.1 (ES module via ctx.importModule)
 */

window.plethoraBit = {
  meta: {
    title: "Whispering Grove",
    runtime: "plethora-bit@2",
    tags: ["3d", "forest", "explore", "relaxing", "collect"],
    permissions: ["haptics", "backgroundMusic"]
  },

  async init(ctx) {
    // ---------------------------------------------------------------------
    // 0. Immediate first frame: a themed loading / intro screen so the host
    //    never sees a blank canvas while the 3D library streams in.
    // ---------------------------------------------------------------------
    const canvas = ctx.createCanvas({ touchAction: "none" });
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    canvas.style.display = "block";

    const root = ctx.createRoot({ touchAction: "none" });
    root.style.pointerEvents = "none";

    const sa = ctx.safeArea || { top: 0, bottom: 0, left: 0, right: 0 };

    const style = document.createElement("style");
    style.textContent = `
      .wg-ui { position:absolute; inset:0; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
        color:#f4fff2; -webkit-user-select:none; user-select:none; -webkit-tap-highlight-color:transparent; }
      .wg-ui * { box-sizing:border-box; }
      .wg-hud { position:absolute; top:calc(${sa.top}px + 12px); left:calc(${sa.left}px + 14px);
        pointer-events:none; text-shadow:0 1px 6px rgba(0,20,0,.55); }
      .wg-score { font-size:30px; font-weight:800; letter-spacing:.3px; display:flex; align-items:center; gap:7px; }
      .wg-score .spark { color:#ffe29a; filter:drop-shadow(0 0 6px rgba(255,210,120,.7)); }
      .wg-sub { font-size:13px; opacity:.85; margin-top:2px; font-weight:600; }
      .wg-best { font-size:12px; opacity:.7; margin-top:1px; font-weight:600; }

      .wg-top-right { position:absolute; top:calc(${sa.top}px + 12px); right:calc(${sa.right}px + 14px);
        display:flex; gap:10px; pointer-events:none; }
      .wg-btn { pointer-events:auto; width:44px; height:44px; border-radius:50%; border:1px solid rgba(255,255,255,.28);
        background:rgba(20,40,25,.42); backdrop-filter:blur(8px); -webkit-backdrop-filter:blur(8px);
        color:#eafff0; font-size:19px; display:flex; align-items:center; justify-content:center; cursor:pointer;
        transition:transform .12s ease, background .2s ease; }
      .wg-btn:active { transform:scale(.9); background:rgba(30,60,35,.6); }

      .wg-toast { position:absolute; left:50%; top:22%; transform:translate(-50%,-50%) scale(.9);
        background:rgba(12,26,16,.72); border:1px solid rgba(255,255,255,.18); padding:9px 16px; border-radius:999px;
        font-size:14px; font-weight:600; opacity:0; transition:opacity .25s ease, transform .25s ease; pointer-events:none;
        backdrop-filter:blur(6px); -webkit-backdrop-filter:blur(6px); white-space:nowrap; }
      .wg-toast.show { opacity:1; transform:translate(-50%,-50%) scale(1); }

      .wg-joy { position:absolute; width:120px; height:120px; margin:-60px 0 0 -60px; border-radius:50%;
        border:2px solid rgba(255,255,255,.35); background:rgba(255,255,255,.06); pointer-events:none;
        opacity:0; transition:opacity .15s ease; }
      .wg-joy.show { opacity:1; }
      .wg-knob { position:absolute; width:52px; height:52px; margin:-26px 0 0 -26px; left:50%; top:50%; border-radius:50%;
        background:rgba(255,255,255,.85); box-shadow:0 2px 10px rgba(0,0,0,.35); }

      .wg-overlay { position:absolute; inset:0; display:flex; align-items:center; justify-content:center;
        padding:24px; pointer-events:auto; background:radial-gradient(120% 90% at 50% 20%, rgba(10,26,15,.35), rgba(6,16,10,.8));
        backdrop-filter:blur(3px); -webkit-backdrop-filter:blur(3px); text-align:center; }
      .wg-card { max-width:400px; width:100%; }
      .wg-title { font-size:40px; font-weight:800; letter-spacing:.5px; margin-bottom:6px;
        text-shadow:0 2px 20px rgba(0,40,10,.6); }
      .wg-tag { font-size:15px; opacity:.9; line-height:1.5; margin-bottom:20px; font-weight:500; }
      .wg-help { text-align:left; font-size:14px; line-height:1.7; opacity:.92; margin:0 auto 22px; max-width:320px; }
      .wg-help b { color:#ffe29a; }
      .wg-cta { pointer-events:auto; display:inline-block; padding:15px 30px; border-radius:999px; border:none;
        font-size:17px; font-weight:800; letter-spacing:.3px; color:#0d2313; cursor:pointer;
        background:linear-gradient(180deg,#c8f7c0,#8fe089); box-shadow:0 8px 26px rgba(90,200,120,.4); transition:transform .12s ease; }
      .wg-cta:active { transform:scale(.94); }
      .wg-cta.wait { opacity:.55; }

      .wg-fact { position:absolute; inset:0; display:flex; align-items:center; justify-content:center; padding:26px;
        pointer-events:none; opacity:0; transition:opacity .3s ease;
        background:radial-gradient(130% 100% at 50% 40%, rgba(8,22,13,.35), rgba(4,12,8,.72)); }
      .wg-fact.show { opacity:1; pointer-events:auto; }
      .wg-fact-inner { max-width:400px; width:100%; text-align:center; transform:translateY(14px) scale(.96);
        transition:transform .35s cubic-bezier(.2,.9,.25,1.2); }
      .wg-fact.show .wg-fact-inner { transform:translateY(0) scale(1); }
      .wg-emoji { font-size:96px; line-height:1; filter:drop-shadow(0 8px 24px rgba(0,0,0,.45)); margin-bottom:4px; }
      .wg-word { font-size:52px; font-weight:800; line-height:1.05; margin-bottom:8px; letter-spacing:.5px;
        font-family:'Cormorant Garamond',Georgia,serif; }
      .wg-name { font-size:26px; font-weight:800; margin-bottom:10px; }
      .wg-badge { display:inline-flex; align-items:center; gap:8px; padding:6px 14px; border-radius:999px;
        font-size:13px; font-weight:800; letter-spacing:1px; text-transform:uppercase; margin-bottom:16px; }
      .wg-factext { font-size:16px; line-height:1.6; opacity:.95; margin-bottom:20px; font-weight:500; }
      .wg-dismiss { font-size:13px; opacity:.7; font-weight:600; letter-spacing:.4px; }
      .wg-plus { font-weight:800; }
    `;
    root.appendChild(style);

    const ui = document.createElement("div");
    ui.className = "wg-ui";
    ui.innerHTML = `
      <div class="wg-hud" style="opacity:0;transition:opacity .5s ease">
        <div class="wg-score"><span class="spark">✦</span><span class="val">0</span></div>
        <div class="wg-sub"><span class="found">0</span> discoveries</div>
        <div class="wg-best"></div>
      </div>
      <div class="wg-top-right" style="opacity:0;transition:opacity .5s ease">
        <button class="wg-btn wg-mute" aria-label="Sound">🔊</button>
        <button class="wg-btn wg-info" aria-label="How to play">?</button>
      </div>
      <div class="wg-toast"></div>
      <div class="wg-joy"><div class="wg-knob"></div></div>

      <div class="wg-overlay wg-intro">
        <div class="wg-card">
          <div class="wg-title">🌲 Whispering Grove</div>
          <div class="wg-tag">A quiet, endless forest to wander. Find animals and nature-words hidden among the trees, then tap to gather them — each holds a little secret.</div>
          <div class="wg-help">
            <div>🕹️ <b>Left side</b> — drag to walk</div>
            <div>👆 <b>Right side</b> — drag to look around</div>
            <div>✨ <b>Tap</b> a glowing creature or word to collect it</div>
            <div>🍃 <b>Tap the trees</b> to rustle their leaves</div>
          </div>
          <button class="wg-cta wait">Waking the grove…</button>
        </div>
      </div>

      <div class="wg-fact">
        <div class="wg-fact-inner">
          <div class="wg-emoji"></div>
          <div class="wg-word"></div>
          <div class="wg-name"></div>
          <div class="wg-badge"></div>
          <div class="wg-factext"></div>
          <div class="wg-dismiss">tap to keep exploring</div>
        </div>
      </div>
    `;
    root.appendChild(ui);

    const $ = (s) => ui.querySelector(s);
    const el = {
      hud: $(".wg-hud"), topRight: $(".wg-top-right"),
      scoreVal: $(".wg-score .val"), found: $(".found"), best: $(".wg-best"),
      toast: $(".wg-toast"), joy: $(".wg-joy"), knob: $(".wg-knob"),
      intro: $(".wg-intro"), cta: $(".wg-cta"),
      mute: $(".wg-mute"), info: $(".wg-info"),
      fact: $(".wg-fact"), fEmoji: $(".wg-emoji"), fWord: $(".wg-word"),
      fName: $(".wg-name"), fBadge: $(".wg-badge"), fText: $(".wg-factext")
    };

    // We have a visible first frame now (the intro). Tell the host.
    ctx.markVisualReady("intro");

    // ---------------------------------------------------------------------
    // 1. Content: tiers, animals and words with their facts.
    // ---------------------------------------------------------------------
    const TIERS = {
      common:    { label: "Common",    pts: 10,  color: 0x9be79f, css: "#2e5c34" },
      uncommon:  { label: "Uncommon",  pts: 25,  color: 0x7fd1ff, css: "#1f5678" },
      rare:      { label: "Rare",      pts: 60,  color: 0xc9a6ff, css: "#4a2f78" },
      legendary: { label: "Legendary", pts: 150, color: 0xffd479, css: "#7a5410" },
      word:      { label: "Word",      pts: 20,  color: 0x7ff0d6, css: "#155c4d" }
    };

    const ANIMALS = [
      // common
      { e: "🐇", n: "Rabbit", t: "common", f: "A rabbit's teeth never stop growing — up to 12 cm a year — so constant nibbling keeps them filed down." },
      { e: "🐿️", n: "Squirrel", t: "common", f: "Squirrels plant thousands of trees by accident, forgetting where they buried most of their acorns." },
      { e: "🐸", n: "Frog", t: "common", f: "A frog blinks to help it swallow — its eyes sink downward and push food down its throat." },
      { e: "🐌", n: "Snail", t: "common", f: "A snail can sleep for up to three whole years when the weather stays too dry." },
      { e: "🐝", n: "Honeybee", t: "common", f: "A honeybee visits about two million flowers to make a single jar of honey." },
      { e: "🐜", n: "Ant", t: "common", f: "Ants have no lungs — oxygen seeps in through tiny holes all over their bodies." },
      { e: "🦆", n: "Duck", t: "common", f: "A duck's quack really does echo — the popular myth that it doesn't is simply false." },
      { e: "🐛", n: "Caterpillar", t: "common", f: "A caterpillar has around 4,000 muscles. A human body has roughly 600." },
      { e: "🐞", n: "Ladybird", t: "common", f: "A single ladybird can devour 5,000 aphids over its lifetime." },
      // uncommon
      { e: "🦊", n: "Fox", t: "uncommon", f: "Foxes seem to use Earth's magnetic field to aim their pounce — like a living compass." },
      { e: "🦔", n: "Hedgehog", t: "uncommon", f: "Meeting a new smell, a hedgehog licks it and paints the frothy spit onto its own spines." },
      { e: "🦇", n: "Bat", t: "uncommon", f: "Bats almost always turn left leaving a cave, and they're the only mammals that truly fly." },
      { e: "🦡", n: "Badger", t: "uncommon", f: "Badgers keep tidy underground toilets and even change their grassy bedding to stay clean." },
      { e: "🐗", n: "Wild Boar", t: "uncommon", f: "Boar wallow in mud partly as sunscreen — the dried layer shields their skin from burning." },
      { e: "🦫", n: "Beaver", t: "uncommon", f: "A beaver's front teeth are orange because the enamel is reinforced with iron." },
      { e: "🐍", n: "Grass Snake", t: "uncommon", f: "Snakes 'smell' with their tongues, flicking scent onto a sensor in the roof of the mouth." },
      { e: "🦎", n: "Lizard", t: "uncommon", f: "Many lizards can drop their tail to escape a predator — then slowly grow a new one." },
      // rare
      { e: "🦌", n: "Red Deer", t: "rare", f: "A stag regrows its entire rack of antlers every year — the fastest-growing tissue of any mammal." },
      { e: "🦉", n: "Owl", t: "rare", f: "An owl can turn its head about 270° thanks to extra neck bones and special blood vessels." },
      { e: "🐺", n: "Wolf", t: "rare", f: "A wolf's howl can carry up to 10 km, and each wolf has its own recognisable voice." },
      { e: "🦢", n: "Swan", t: "rare", f: "Swans usually mate for life and can sleep while floating, balanced on a single leg." },
      { e: "🦚", n: "Peacock", t: "rare", f: "A peacock's shimmering colours aren't pigment — they're tiny crystals bending the light." },
      // legendary
      { e: "🐻", n: "Brown Bear", t: "legendary", f: "A bear's nose is about seven times sharper than a bloodhound's — it can smell food 30 km away." },
      { e: "🦅", n: "Golden Eagle", t: "legendary", f: "An eagle can spot a rabbit from 3 km — its eyesight is roughly eight times sharper than ours." },
      { e: "🦄", n: "Unicorn", t: "legendary", f: "The unicorn is Scotland's national animal — a mythical beast chosen for its untamable spirit." }
    ];

    const WORDS = [
      { w: "Komorebi", f: "Komorebi is Japanese for the dappled light that filters through leaves — a word with no English equal." },
      { w: "Psithurism", f: "Psithurism is the whispering, rustling sound the wind makes as it moves through the trees." },
      { w: "Susurrus", f: "Susurrus means a soft murmuring or rustling — the word even sounds like the hush it names." },
      { w: "Petrichor", f: "Petrichor, the smell of rain on dry earth, was named in 1964 from Greek 'stone' and the blood of the gods." },
      { w: "Murmuration", f: "A murmuration is a shape-shifting cloud of thousands of starlings all wheeling as one." },
      { w: "Mycelium", f: "Mycelium — the thread-like web of fungi underground — links trees into a 'wood-wide web' that shares food." },
      { w: "Sylvan", f: "Sylvan means 'of the forest', from the Latin silva, meaning woodland." },
      { w: "Verdant", f: "Verdant means lush and green, from the Latin virere — to be green and thriving." },
      { w: "Dappled", f: "Dappled describes patches of light and shade — the exact play of sun beneath a leafy canopy." },
      { w: "Ephemeral", f: "Ephemeral means fleeting, from the Greek for 'lasting only a day', like a mayfly." },
      { w: "Zephyr", f: "A zephyr is a gentle breeze, named after Zephyrus, the Greek god of the west wind." },
      { w: "Fernweh", f: "Fernweh is German for 'far-sickness' — an ache to be somewhere distant, the opposite of homesickness." },
      { w: "Eclosion", f: "Eclosion is the moment an insect breaks free of its pupa — a butterfly unfurling its wings." },
      { w: "Bosky", f: "Bosky means wooded or thick with bushes — a leafy old word beloved by poets." },
      { w: "Nemophilist", f: "A nemophilist is a haunter of woods — one who loves the forest and its deep solitude." },
      { w: "Chlorophyll", f: "Chlorophyll makes leaves green and turns sunlight into food; its name means 'green leaf' in Greek." }
    ];

    // ---------------------------------------------------------------------
    // 2. Load Three.js (streams in the background while intro is shown).
    // ---------------------------------------------------------------------
    let THREE;
    try {
      THREE = await ctx.importModule("three", "0.164.1");
    } catch (err) {
      ctx.platform && ctx.platform.error && ctx.platform.error({ where: "importModule", message: String(err) });
      el.cta.classList.remove("wait");
      el.cta.textContent = "Couldn't load the grove ✕";
      ctx.platform.ready();
      return;
    }

    // ---------------------------------------------------------------------
    // 3. Small canvas-texture factories (all assets are procedural — maxAssets is 0).
    // ---------------------------------------------------------------------
    // Offscreen drawing surfaces must come from the SDK canvas factory rather
    // than the raw DOM API (which the platform validator rejects).
    // These are hidden — they exist only to bake textures onto the GPU.
    function makeCanvas(size) {
      const c = ctx.createCanvas2D();
      c.style.display = "none";
      c.width = size;
      c.height = size;
      return c;
    }

    const texCache = new Map();

    function emojiTexture(emoji) {
      const key = "e:" + emoji;
      if (texCache.has(key)) return texCache.get(key);
      const c = makeCanvas(160);
      const g = c.getContext("2d");
      g.clearRect(0, 0, 160, 160);
      g.font = "118px -apple-system, 'Segoe UI Emoji', 'Noto Color Emoji', serif";
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.fillText(emoji, 80, 88);
      const tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 2;
      texCache.set(key, tex);
      return tex;
    }

    function wordTexture(word) {
      const key = "w:" + word;
      if (texCache.has(key)) return texCache.get(key);
      const c = makeCanvas(512);
      const g = c.getContext("2d");
      g.clearRect(0, 0, 512, 512);
      g.font = "700 120px 'Cormorant Garamond', Georgia, serif";
      g.textAlign = "center";
      g.textBaseline = "middle";
      // soft dark pill behind for legibility
      const w = Math.min(480, g.measureText(word).width + 70);
      const h = 190;
      g.fillStyle = "rgba(10,26,16,0.55)";
      roundRect(g, (512 - w) / 2, (512 - h) / 2, w, h, 40);
      g.fill();
      g.fillStyle = "#eafff2";
      g.shadowColor = "rgba(0,0,0,0.4)";
      g.shadowBlur = 12;
      g.fillText(word, 256, 262);
      const tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 2;
      texCache.set(key, tex);
      return tex;
    }

    function roundRect(g, x, y, w, h, r) {
      g.beginPath();
      g.moveTo(x + r, y);
      g.arcTo(x + w, y, x + w, y + h, r);
      g.arcTo(x + w, y + h, x, y + h, r);
      g.arcTo(x, y + h, x, y, r);
      g.arcTo(x, y, x + w, y, r);
      g.closePath();
    }

    function radialTexture() {
      const c = makeCanvas(128);
      const g = c.getContext("2d");
      const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
      grad.addColorStop(0, "rgba(255,255,255,1)");
      grad.addColorStop(0.25, "rgba(255,255,255,0.75)");
      grad.addColorStop(1, "rgba(255,255,255,0)");
      g.fillStyle = grad;
      g.fillRect(0, 0, 128, 128);
      return new THREE.CanvasTexture(c);
    }

    function beamTexture() {
      const c = makeCanvas(64);
      const g = c.getContext("2d");
      const grad = g.createLinearGradient(0, 0, 64, 0);
      grad.addColorStop(0, "rgba(255,255,255,0)");
      grad.addColorStop(0.5, "rgba(255,255,255,0.85)");
      grad.addColorStop(1, "rgba(255,255,255,0)");
      g.fillStyle = grad;
      g.fillRect(0, 0, 64, 64);
      return new THREE.CanvasTexture(c);
    }

    function groundTexture() {
      const S = 512;
      const c = makeCanvas(S);
      const g = c.getContext("2d");
      g.fillStyle = "#3f6b3a";
      g.fillRect(0, 0, S, S);
      // layered soft blobs of green + earth for a mossy floor
      const blobs = [
        ["#4b7a41", 900], ["#356032", 700], ["#5c8a4c", 500],
        ["#2f5530", 400], ["#6b9450", 300], ["#7a5a34", 150]
      ];
      for (const [col, count] of blobs) {
        g.fillStyle = col;
        for (let i = 0; i < count; i++) {
          const x = Math.random() * S, y = Math.random() * S;
          const r = 3 + Math.random() * 12;
          g.globalAlpha = 0.15 + Math.random() * 0.35;
          g.beginPath();
          g.arc(x, y, r, 0, Math.PI * 2);
          g.fill();
        }
      }
      g.globalAlpha = 1;
      const tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      return tex;
    }

    const leafTex = emojiTexture("🍃");
    const glowTex = radialTexture();
    const beamTex = beamTexture();

    // ---------------------------------------------------------------------
    // 4. Scene, camera, renderer, lighting, fog.
    // ---------------------------------------------------------------------
    const SKY = 0xbfe0c4;
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(ctx.nativeDpr || window.devicePixelRatio || 1, 2));
    renderer.setSize(ctx.width, ctx.height, false);
    renderer.outputColorSpace = THREE.SRGBColorSpace;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(SKY);
    scene.fog = new THREE.Fog(SKY, 22, 110);

    const camera = new THREE.PerspectiveCamera(62, ctx.width / ctx.height, 0.1, 400);

    scene.add(new THREE.HemisphereLight(0xdff2d6, 0x40331f, 1.15));
    const sun = new THREE.DirectionalLight(0xfff3d8, 1.35);
    sun.position.set(30, 60, 20);
    scene.add(sun);
    const fill = new THREE.DirectionalLight(0xbfe0ff, 0.35);
    fill.position.set(-20, 25, -30);
    scene.add(fill);

    // Ground — follows the player so the forest floor is effectively endless.
    const GROUND = 420;
    const TILE = 7; // world metres per texture tile
    const gTex = groundTexture();
    gTex.repeat.set(GROUND / TILE, GROUND / TILE);
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(GROUND, GROUND),
      new THREE.MeshStandardMaterial({ map: gTex, roughness: 1, metalness: 0 })
    );
    ground.rotation.x = -Math.PI / 2;
    scene.add(ground);

    // ---------------------------------------------------------------------
    // 5. Endless forest via two InstancedMeshes (trunks + foliage) that
    //    recycle behind the player.
    // ---------------------------------------------------------------------
    const MAX_TREES = 150;
    const trunkGeo = new THREE.CylinderGeometry(0.16, 0.28, 2.4, 6);
    trunkGeo.translate(0, 1.2, 0); // base at y=0
    const foliageGeo = new THREE.IcosahedronGeometry(1, 0);
    const trunkMesh = new THREE.InstancedMesh(
      trunkGeo, new THREE.MeshStandardMaterial({ color: 0x6b4a2f, roughness: 1, flatShading: true }), MAX_TREES);
    const foliageMesh = new THREE.InstancedMesh(
      foliageGeo, new THREE.MeshStandardMaterial({ roughness: 1, flatShading: true }), MAX_TREES);
    trunkMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    foliageMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    scene.add(trunkMesh, foliageMesh);

    const FOLIAGE_COLORS = [0x4c8a3f, 0x3f7a38, 0x5c9a4a, 0x6ba054, 0x3c6b46, 0x8a9a3a];
    const trees = [];
    const _m = new THREE.Matrix4();
    const _q = new THREE.Quaternion();
    const _p = new THREE.Vector3();
    const _s = new THREE.Vector3();
    const _col = new THREE.Color();

    function writeTree(i) {
      const t = trees[i];
      // trunk
      _q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), t.rot);
      _p.set(t.x, 0, t.z);
      _s.set(t.scale, t.scale, t.scale);
      _m.compose(_p, _q, _s);
      trunkMesh.setMatrixAt(i, _m);
      // foliage — a squashed blob sitting on top of the trunk
      _p.set(t.x, 2.4 * t.scale + t.fr * 0.7, t.z);
      _s.set(t.fr, t.fr * 1.25, t.fr);
      _q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), t.rot * 1.7);
      _m.compose(_p, _q, _s);
      foliageMesh.setMatrixAt(i, _m);
      foliageMesh.setColorAt(i, _col.setHex(t.color));
    }

    function placeTree(i, ahead) {
      const t = trees[i] || (trees[i] = {});
      let x, z;
      if (ahead) {
        const ang = camYaw + (Math.random() - 0.5) * Math.PI * 1.3;
        const d = 42 + Math.random() * 26;
        x = player.x + Math.sin(ang) * d;
        z = player.z + Math.cos(ang) * d;
      } else {
        const ang = Math.random() * Math.PI * 2;
        const d = 6 + Math.random() * 58;
        x = player.x + Math.cos(ang) * d;
        z = player.z + Math.sin(ang) * d;
      }
      t.x = x; t.z = z;
      t.scale = 0.7 + Math.random() * 1.5;
      t.fr = (1.5 + Math.random() * 1.6) * (0.75 + t.scale * 0.2);
      t.rot = Math.random() * Math.PI * 2;
      t.color = FOLIAGE_COLORS[(Math.random() * FOLIAGE_COLORS.length) | 0];
      writeTree(i);
    }

    // ---------------------------------------------------------------------
    // 6. Collectibles: floating animals + words that recycle around player.
    // ---------------------------------------------------------------------
    const COLLECT_COUNT = 16;
    const COLLECT_REACH = 10;      // must be within this many metres to gather
    const NEAR_CHIME = 19;         // discovery chime range
    const collectibles = [];
    const pickables = [];          // main sprites for raycasting

    function randomContent() {
      if (Math.random() < 0.45) {
        const w = WORDS[(Math.random() * WORDS.length) | 0];
        return { kind: "word", tier: "word", emoji: null, word: w.w, name: w.w, fact: w.f };
      }
      const r = Math.random();
      let tier = "common";
      if (r > 0.95) tier = "legendary";
      else if (r > 0.82) tier = "rare";
      else if (r > 0.55) tier = "uncommon";
      const pool = ANIMALS.filter((a) => a.t === tier);
      const a = pool[(Math.random() * pool.length) | 0];
      return { kind: "animal", tier, emoji: a.e, word: null, name: a.n, fact: a.f };
    }

    function makeCollectible(i) {
      const group = new THREE.Group();

      const glowMat = new THREE.SpriteMaterial({ map: glowTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.6 });
      const glow = new THREE.Sprite(glowMat);
      glow.scale.set(3.2, 3.2, 1);
      group.add(glow);

      const beamMat = new THREE.SpriteMaterial({ map: beamTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.28 });
      const beam = new THREE.Sprite(beamMat);
      beam.scale.set(0.9, 9, 1);
      beam.position.y = 3.2;
      group.add(beam);

      const mainMat = new THREE.SpriteMaterial({ transparent: true, depthWrite: false });
      const main = new THREE.Sprite(mainMat);
      group.add(main);

      scene.add(group);
      const c = { group, glow, glowMat, beam, beamMat, main, mainMat, content: null, x: 0, z: 0, baseY: 1.3, phase: Math.random() * Math.PI * 2, near: false, dead: false };
      main.userData.col = c;
      pickables.push(main);
      collectibles[i] = c;
      spawnCollectible(c, true);
    }

    function spawnCollectible(c, initial) {
      const content = randomContent();
      c.content = content;
      const tier = TIERS[content.tier];
      // texture (cached + shared — never disposed here)
      c.mainMat.map = content.kind === "word" ? wordTexture(content.word) : emojiTexture(content.emoji);
      c.mainMat.needsUpdate = true;
      const mainScale = content.kind === "word" ? 3.0 : 1.7;
      c.main.scale.set(content.kind === "word" ? mainScale * 1.0 : mainScale, mainScale, 1);
      c.main.position.y = 0;
      // tint glow + beam by tier
      c.glowMat.color.setHex(tier.color);
      c.beamMat.color.setHex(tier.color);
      const legend = content.tier === "legendary";
      c.glow.scale.setScalar(legend ? 4.2 : content.tier === "rare" ? 3.6 : 3.0);
      c.beamMat.opacity = legend ? 0.42 : 0.26;
      // position: random ring around the player, never right on top of them
      const ang = Math.random() * Math.PI * 2;
      const d = (initial ? 10 : 20) + Math.random() * 26;
      c.x = player.x + Math.cos(ang) * d;
      c.z = player.z + Math.sin(ang) * d;
      c.baseY = 1.15 + Math.random() * 0.5;
      c.near = false;
      c.dead = false;
      c.group.visible = true;
      c.group.position.set(c.x, c.baseY, c.z);
    }

    // ---------------------------------------------------------------------
    // 7. Ambient particles (drifting pollen / motes).
    // ---------------------------------------------------------------------
    const MOTES = 220;
    const moteGeo = new THREE.BufferGeometry();
    const motePos = new Float32Array(MOTES * 3);
    for (let i = 0; i < MOTES; i++) {
      motePos[i * 3] = (Math.random() - 0.5) * 70;
      motePos[i * 3 + 1] = Math.random() * 12;
      motePos[i * 3 + 2] = (Math.random() - 0.5) * 70;
    }
    moteGeo.setAttribute("position", new THREE.BufferAttribute(motePos, 3));
    const moteMat = new THREE.PointsMaterial({
      map: glowTex, color: 0xfffbe0, size: 0.35, transparent: true, opacity: 0.55,
      depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true
    });
    const motes = new THREE.Points(moteGeo, moteMat);
    scene.add(motes);

    // Falling leaf particles for the rustle effect.
    const LEAF_POOL = 30;
    const leaves = [];
    for (let i = 0; i < LEAF_POOL; i++) {
      const m = new THREE.SpriteMaterial({ map: leafTex, transparent: true, depthWrite: false });
      const s = new THREE.Sprite(m);
      s.scale.set(0.5, 0.5, 1);
      s.visible = false;
      scene.add(s);
      leaves.push({ sprite: s, mat: m, life: 0, vy: 0, vx: 0, vz: 0, spin: 0 });
    }
    function burstLeaves(x, y, z, color) {
      let n = 0;
      for (const lf of leaves) {
        if (lf.life > 0) continue;
        lf.sprite.position.set(x + (Math.random() - 0.5), y, z + (Math.random() - 0.5));
        lf.sprite.material.color.setHex(color);
        lf.sprite.material.opacity = 1;
        lf.sprite.scale.setScalar(0.4 + Math.random() * 0.4);
        lf.sprite.visible = true;
        lf.life = 1.6 + Math.random() * 0.8;
        lf.vy = -0.7 - Math.random() * 0.5;
        lf.vx = (Math.random() - 0.5) * 1.2;
        lf.vz = (Math.random() - 0.5) * 1.2;
        if (++n >= 6) break;
      }
    }

    // ---------------------------------------------------------------------
    // 8. Player + input state.
    // ---------------------------------------------------------------------
    const EYE = 1.7;
    const SPEED = 6.2;
    const LOOK_SENS = 0.0042;
    const player = { x: 0, z: 0 };
    let camYaw = 0, camPitch = -0.02;
    let started = false;
    const move = { x: 0, y: 0 }; // normalized joystick vector

    const pointers = new Map();
    let movePid = null, lookPid = null;
    let moveOrigin = { x: 0, y: 0 };
    let lastLook = { x: 0, y: 0 };

    function canvasXY(e) {
      const r = canvas.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    }

    ctx.listen(canvas, "pointerdown", (e) => {
      if (!started) return;
      if (el.fact.classList.contains("show")) return; // fact card handles its own dismiss
      const p = canvasXY(e);
      pointers.set(e.pointerId, { sx: p.x, sy: p.y, moved: 0, t: e.timeStamp });
      if (p.x < ctx.width * 0.5 && movePid === null) {
        movePid = e.pointerId;
        moveOrigin = { x: p.x, y: p.y };
        move.x = 0; move.y = 0;
        el.joy.style.left = p.x + "px";
        el.joy.style.top = p.y + "px";
        el.knob.style.left = "50%";
        el.knob.style.top = "50%";
        el.joy.classList.add("show");
      } else if (lookPid === null) {
        lookPid = e.pointerId;
        lastLook = { x: p.x, y: p.y };
      }
    });

    ctx.listen(canvas, "pointermove", (e) => {
      const rec = pointers.get(e.pointerId);
      if (!rec) return;
      const p = canvasXY(e);
      rec.moved += Math.hypot(p.x - (rec.lx ?? rec.sx), p.y - (rec.ly ?? rec.sy));
      rec.lx = p.x; rec.ly = p.y;
      if (e.pointerId === movePid) {
        const dx = p.x - moveOrigin.x, dy = p.y - moveOrigin.y;
        const max = 58;
        const len = Math.hypot(dx, dy);
        const k = len > max ? max / len : 1;
        move.x = (dx * k) / max;
        move.y = (dy * k) / max;
        el.knob.style.left = 50 + (move.x * 50) + "%";
        el.knob.style.top = 50 + (move.y * 50) + "%";
      } else if (e.pointerId === lookPid) {
        camYaw -= (p.x - lastLook.x) * LOOK_SENS;
        camPitch -= (p.y - lastLook.y) * LOOK_SENS;
        camPitch = Math.max(-1.2, Math.min(1.2, camPitch));
        lastLook = { x: p.x, y: p.y };
      }
    });

    function endPointer(e) {
      const rec = pointers.get(e.pointerId);
      if (rec) {
        const dur = e.timeStamp - rec.t;
        if (rec.moved < 12 && dur < 450) handleTap(rec.sx, rec.sy);
        pointers.delete(e.pointerId);
      }
      if (e.pointerId === movePid) {
        movePid = null; move.x = 0; move.y = 0; el.joy.classList.remove("show");
      }
      if (e.pointerId === lookPid) lookPid = null;
    }
    ctx.listen(canvas, "pointerup", endPointer);
    ctx.listen(canvas, "pointercancel", endPointer);

    // ---------------------------------------------------------------------
    // 9. Tap handling: collect a creature/word, or rustle a tree.
    // ---------------------------------------------------------------------
    const raycaster = new THREE.Raycaster();
    const ndc = new THREE.Vector2();

    function handleTap(px, py) {
      ndc.x = (px / ctx.width) * 2 - 1;
      ndc.y = -(py / ctx.height) * 2 + 1;
      raycaster.setFromCamera(ndc, camera);

      const hits = raycaster.intersectObjects(pickables, false);
      if (hits.length) {
        const c = hits[0].object.userData.col;
        if (c && !c.dead) {
          const dist = Math.hypot(c.x - player.x, c.z - player.z);
          if (dist <= COLLECT_REACH) { collect(c); return; }
          showToast("Move a little closer 🌿");
          return;
        }
      }
      // otherwise try the trees for a rustle
      const tHit = raycaster.intersectObject(foliageMesh, false);
      if (tHit.length && tHit[0].distance < 26) {
        const inst = tHit[0].instanceId;
        const t = trees[inst];
        rustle(tHit[0].point, t ? t.color : 0x4c8a3f);
      }
    }

    function rustle(point, color) {
      burstLeaves(point.x, point.y, point.z, color);
      sting("tap");
      ctx.platform.haptic && ctx.platform.haptic("light");
    }

    let score = 0, found = 0, best = 0, submitted = 0, lastSubmit = -9999;

    function collect(c) {
      c.dead = true;
      c.group.visible = false;
      const content = c.content;
      const tier = TIERS[content.tier];
      score += tier.pts;
      found += 1;
      el.scoreVal.textContent = String(score);
      el.found.textContent = String(found);

      ctx.platform.interact && ctx.platform.interact({ type: "collect", tier: content.tier });
      ctx.platform.setScore && ctx.platform.setScore(score);
      if (content.tier === "legendary") {
        ctx.platform.milestone && ctx.platform.milestone("legendary_find", { name: content.name });
        ctx.platform.haptic && ctx.platform.haptic("success");
        sting("win");
      } else if (content.tier === "rare") {
        ctx.platform.haptic && ctx.platform.haptic("medium");
        sting("powerup");
      } else {
        ctx.platform.haptic && ctx.platform.haptic("light");
        sting(content.kind === "word" ? "success" : "coin");
      }

      showFact(content, tier);
      // respawn a fresh discovery elsewhere so the grove never empties
      ctx.timeout(() => spawnCollectible(c, false), 400);
    }

    // ---------------------------------------------------------------------
    // 10. Fact card + toast + leaderboard.
    // ---------------------------------------------------------------------
    let factOpen = false;
    function showFact(content, tier) {
      factOpen = true;
      if (content.kind === "word") {
        el.fEmoji.style.display = "none";
        el.fWord.style.display = "block";
        el.fWord.textContent = content.word;
        el.fName.style.display = "none";
      } else {
        el.fEmoji.style.display = "block";
        el.fEmoji.textContent = content.emoji;
        el.fWord.style.display = "none";
        el.fName.style.display = "block";
        el.fName.textContent = content.name;
      }
      el.fBadge.textContent = tier.label + " · +" + tier.pts;
      el.fBadge.style.background = "rgba(255,255,255,0.12)";
      el.fBadge.style.color = "#eafff2";
      el.fBadge.style.border = "1px solid rgba(255,255,255,0.35)";
      el.fBadge.style.boxShadow = "0 0 22px " + hexToRgba(tier.color, 0.5);
      el.fText.textContent = content.fact;
      el.fact.classList.add("show");
    }
    function hideFact() {
      factOpen = false;
      el.fact.classList.remove("show");
      maybeSubmit(true);
    }
    ctx.listen(el.fact, "pointerup", () => { if (factOpen) hideFact(); });

    let toastToken = 0;
    function showToast(msg) {
      el.toast.textContent = msg;
      el.toast.classList.add("show");
      const my = ++toastToken;
      ctx.timeout(() => { if (my === toastToken) el.toast.classList.remove("show"); }, 1600);
    }

    function hexToRgba(hex, a) {
      return "rgba(" + ((hex >> 16) & 255) + "," + ((hex >> 8) & 255) + "," + (hex & 255) + "," + a + ")";
    }

    async function maybeSubmit(force) {
      if (!ctx.memory || !ctx.memory.record) return;
      if (score <= submitted) return;
      if (!force && nowMs - lastSubmit < 6000) return;
      submitted = score;
      lastSubmit = nowMs;
      try {
        await ctx.memory.record("grove").submit(score);
      } catch (_) { /* rejected writes are fine */ }
    }

    async function loadBest() {
      if (!ctx.memory || !ctx.memory.record) return;
      try {
        const lb = await ctx.memory.record("grove").leaderboard({ scope: "global", period: "all_time" });
        const mine = lb && (lb.you || lb.self || (lb.entries || []).find((e) => e && e.isYou));
        const v = mine && (mine.value ?? mine.score);
        if (typeof v === "number" && v > 0) { best = v; el.best.textContent = "best ✦ " + best; }
      } catch (_) {}
    }

    // ---------------------------------------------------------------------
    // 11. Audio (background music bed + tiny stings). All permission-guarded.
    // ---------------------------------------------------------------------
    let musicHandle = null, muted = false, audioReady = false;
    const canMusic = ctx.capabilities && ctx.capabilities.backgroundMusic;

    async function startAudio() {
      if (audioReady || !canMusic || !ctx.music) return;
      audioReady = true;
      try {
        await ctx.music.unlock();
        musicHandle = await ctx.music.play({
          preset: "drift", scale: "minorPentatonic", volume: muted ? 0 : 0.4,
          intensity: 0.35, tempo: 74, fadeInMs: 2500
        });
      } catch (_) { /* audio optional */ }
    }
    function sting(name) {
      if (muted || !canMusic || !ctx.music || !ctx.music.sting) return;
      try { ctx.music.sting(name); } catch (_) {}
    }
    ctx.listen(el.mute, "click", () => {
      muted = !muted;
      el.mute.textContent = muted ? "🔇" : "🔊";
      try {
        if (musicHandle && musicHandle.setVolume) musicHandle.setVolume(muted ? 0 : 0.4, { fadeMs: 400 });
        else if (ctx.music && ctx.music.setVolume) ctx.music.setVolume(muted ? 0 : 0.4);
      } catch (_) {}
    });

    // ---------------------------------------------------------------------
    // 12. Intro / begin.
    // ---------------------------------------------------------------------
    ctx.listen(el.info, "click", () => {
      if (started) { el.intro.style.display = "flex"; }
    });
    ctx.listen(el.intro, "pointerup", (e) => {
      // tapping the backdrop (after first begin) closes the reopened help
      if (started && e.target === el.intro) el.intro.style.display = "none";
    });

    function begin() {
      if (started) { el.intro.style.display = "none"; return; }
      started = true;
      el.intro.style.display = "none";
      el.hud.style.opacity = "1";
      el.topRight.style.opacity = "1";
      ctx.platform.start && ctx.platform.start();
      startAudio();
    }
    ctx.listen(el.cta, "click", begin);

    // ---------------------------------------------------------------------
    // 13. Populate world, size, first render, ready.
    // ---------------------------------------------------------------------
    for (let i = 0; i < MAX_TREES; i++) placeTree(i, false);
    trunkMesh.instanceMatrix.needsUpdate = true;
    foliageMesh.instanceMatrix.needsUpdate = true;
    if (foliageMesh.instanceColor) foliageMesh.instanceColor.needsUpdate = true;
    for (let i = 0; i < COLLECT_COUNT; i++) makeCollectible(i);

    function resize() {
      const w = ctx.width, h = ctx.height;
      renderer.setPixelRatio(Math.min(ctx.nativeDpr || window.devicePixelRatio || 1, 2));
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    }
    let lastW = ctx.width, lastH = ctx.height;
    resize();

    // enable the CTA now that the grove is built
    el.cta.classList.remove("wait");
    el.cta.textContent = "Enter the grove 🌿";

    // ---------------------------------------------------------------------
    // 14. Frame loop.
    // ---------------------------------------------------------------------
    const _fwd = new THREE.Vector3();
    let nowMs = 0;
    let treeCursor = 0;
    loadBest();

    function update(dtMs, timeMs) {
      const dt = Math.min(dtMs, 60) / 1000;
      nowMs = timeMs;

      if (lastW !== ctx.width || lastH !== ctx.height) {
        lastW = ctx.width; lastH = ctx.height; resize();
      }

      // --- camera orientation ---
      if (!started) {
        camYaw += dt * 0.06; // gentle idle drift for the intro backdrop
      }
      camera.rotation.set(camPitch, camYaw, 0, "YXZ");

      // --- movement ---
      if (started && (move.x !== 0 || move.y !== 0)) {
        const hx = -Math.sin(camYaw), hz = -Math.cos(camYaw); // forward (horizontal)
        const rx = -hz, rz = hx;                              // right
        let vx = hx * (-move.y) + rx * move.x;
        let vz = hz * (-move.y) + rz * move.x;
        const len = Math.hypot(vx, vz);
        if (len > 1) { vx /= len; vz /= len; }
        player.x += vx * SPEED * dt;
        player.z += vz * SPEED * dt;
      }
      const bob = started ? Math.sin(timeMs * 0.008) * 0.05 * Math.hypot(move.x, move.y) : 0;
      camera.position.set(player.x, EYE + bob, player.z);

      // --- ground + motes follow the player (endless world) ---
      ground.position.set(player.x, 0, player.z);
      gTex.offset.set(player.x / TILE, -player.z / TILE);
      motes.position.set(player.x, 0, player.z);
      const mp = moteGeo.attributes.position.array;
      for (let i = 0; i < MOTES; i++) {
        mp[i * 3 + 1] += dt * 0.35;
        mp[i * 3] += Math.sin(timeMs * 0.0005 + i) * dt * 0.15;
        if (mp[i * 3 + 1] > 13) {
          mp[i * 3 + 1] = 0;
          mp[i * 3] = (Math.random() - 0.5) * 70;
          mp[i * 3 + 2] = (Math.random() - 0.5) * 70;
        }
      }
      moteGeo.attributes.position.needsUpdate = true;

      // --- recycle trees that fall behind ---
      let treesDirty = false;
      for (let k = 0; k < 18; k++) {
        const i = (treeCursor + k) % MAX_TREES;
        const t = trees[i];
        const d = Math.hypot(t.x - player.x, t.z - player.z);
        if (d > 78) { placeTree(i, true); treesDirty = true; }
      }
      treeCursor = (treeCursor + 18) % MAX_TREES;
      if (treesDirty) {
        trunkMesh.instanceMatrix.needsUpdate = true;
        foliageMesh.instanceMatrix.needsUpdate = true;
        if (foliageMesh.instanceColor) foliageMesh.instanceColor.needsUpdate = true;
      }

      // --- collectibles: bob, face gently, recycle, discovery chime ---
      for (const c of collectibles) {
        if (c.dead) continue;
        const d = Math.hypot(c.x - player.x, c.z - player.z);
        if (d > 62) { spawnCollectible(c, false); continue; }
        c.group.position.set(c.x, c.baseY + Math.sin(timeMs * 0.0018 + c.phase) * 0.28, c.z);
        const pulse = 0.85 + Math.sin(timeMs * 0.004 + c.phase) * 0.15;
        c.glowMat.opacity = pulse * (d < NEAR_CHIME ? 0.85 : 0.55);
        // discovery chime as a creature enters range
        if (started && !c.near && d < NEAR_CHIME) {
          c.near = true;
          if (!factOpen) { sting("tap"); ctx.platform.haptic && ctx.platform.haptic("light"); }
        } else if (c.near && d > NEAR_CHIME + 4) {
          c.near = false;
        }
      }

      // --- falling leaves ---
      for (const lf of leaves) {
        if (lf.life <= 0) continue;
        lf.life -= dt;
        lf.sprite.position.x += lf.vx * dt;
        lf.sprite.position.y += lf.vy * dt;
        lf.sprite.position.z += lf.vz * dt;
        lf.vy += dt * 0.4; // slight settle
        lf.sprite.material.rotation += dt * 2;
        lf.sprite.material.opacity = Math.max(0, Math.min(1, lf.life));
        if (lf.life <= 0 || lf.sprite.position.y <= 0.05) { lf.life = 0; lf.sprite.visible = false; }
      }

      // periodic best-score submit
      if (started) maybeSubmit(false);

      renderer.render(scene, camera);
    }

    // first render behind the intro, then hand off to host
    renderer.render(scene, camera);
    ctx.onFrame(update);
    ctx.platform.ready();

    ctx.onDestroy(() => {
      try { if (musicHandle && musicHandle.stop) musicHandle.stop({ fadeOutMs: 300 }); } catch (_) {}
      try { renderer.dispose(); } catch (_) {}
    });
  }
};
