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
    permissions: ["haptics", "backgroundMusic", "audio"]
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
      .wg-vignette { position:absolute; inset:0; pointer-events:none; mix-blend-mode:multiply;
        background:radial-gradient(125% 105% at 50% 40%, rgba(255,255,255,0) 42%, rgba(30,50,26,.28) 76%, rgba(10,22,10,.55) 100%); }
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

      .wg-lb { position:absolute; inset:0; display:flex; align-items:center; justify-content:center; padding:22px;
        pointer-events:none; opacity:0; transition:opacity .25s ease;
        background:radial-gradient(130% 100% at 50% 40%, rgba(8,22,13,.5), rgba(4,12,8,.82)); }
      .wg-lb.show { opacity:1; pointer-events:auto; }
      .wg-lb-card { width:100%; max-width:380px; background:rgba(14,28,18,.74); border:1px solid rgba(255,255,255,.16);
        border-radius:20px; padding:18px 16px 16px; backdrop-filter:blur(10px); -webkit-backdrop-filter:blur(10px); }
      .wg-lb-head { font-size:22px; font-weight:800; text-align:center; margin-bottom:12px; }
      .wg-lb-tabs { display:flex; gap:6px; margin-bottom:12px; }
      .wg-lb-tabs button { flex:1; pointer-events:auto; padding:8px 0; border-radius:999px; border:1px solid rgba(255,255,255,.18);
        background:rgba(255,255,255,.05); color:#dfeede; font-size:13px; font-weight:700; cursor:pointer; }
      .wg-lb-tabs button.on { background:linear-gradient(180deg,#8fe089,#6cc06a); color:#0d2313; border-color:transparent; }
      .wg-lb-list { display:flex; flex-direction:column; gap:5px; min-height:130px; max-height:46vh; overflow-y:auto; }
      .wg-lb-row { display:flex; align-items:center; gap:10px; padding:8px 10px; border-radius:10px;
        background:rgba(255,255,255,.05); font-size:15px; }
      .wg-lb-row .r { min-width:34px; font-weight:800; text-align:center; }
      .wg-lb-row .nm { flex:1; font-weight:600; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
      .wg-lb-row .sc { font-weight:800; color:#ffe29a; }
      .wg-lb-row.you { background:rgba(143,224,137,.18); border:1px solid rgba(143,224,137,.4); }
      .wg-lb-me { margin-top:8px; }
      .wg-lb-empty { text-align:center; opacity:.82; padding:30px 8px; font-weight:600; line-height:1.5; }
      .wg-lb-close { margin-top:14px; width:100%; pointer-events:auto; padding:12px; border-radius:12px; border:none;
        background:rgba(255,255,255,.1); color:#eafff0; font-size:15px; font-weight:700; cursor:pointer; }
      .wg-lb-close:active { transform:scale(.97); }
    `;
    root.appendChild(style);

    const ui = document.createElement("div");
    ui.className = "wg-ui";
    ui.innerHTML = `
      <div class="wg-vignette"></div>
      <div class="wg-hud" style="opacity:0;transition:opacity .5s ease">
        <div class="wg-score"><span class="spark">✦</span><span class="val">0</span></div>
        <div class="wg-sub"><span class="found">0</span> discoveries</div>
        <div class="wg-best"></div>
      </div>
      <div class="wg-top-right" style="opacity:0;transition:opacity .5s ease">
        <button class="wg-btn wg-lbbtn" aria-label="Leaderboard">🏆</button>
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
            <div>🔔 <b>Listen</b> — a soft chime means something's near</div>
            <div>✨ <b>Look low</b> in the bushes, then tap it to collect</div>
            <div>🍃 <b>Tap the trees</b> to rustle their leaves</div>
          </div>
          <button class="wg-cta wait">Waking the grove…</button>
        </div>
      </div>

      <div class="wg-lb">
        <div class="wg-lb-card">
          <div class="wg-lb-head">🏆 Grove Leaderboard</div>
          <div class="wg-lb-tabs">
            <button data-p="daily">Today</button>
            <button data-p="weekly">This week</button>
            <button data-p="all_time" class="on">All time</button>
          </div>
          <div class="wg-lb-list"></div>
          <div class="wg-lb-me"></div>
          <button class="wg-lb-close">Close</button>
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
      mute: $(".wg-mute"), info: $(".wg-info"), lbBtn: $(".wg-lbbtn"),
      fact: $(".wg-fact"), fEmoji: $(".wg-emoji"), fWord: $(".wg-word"),
      fName: $(".wg-name"), fBadge: $(".wg-badge"), fText: $(".wg-factext"),
      lb: $(".wg-lb"), lbList: $(".wg-lb-list"), lbMe: $(".wg-lb-me"), lbClose: $(".wg-lb-close")
    };

    // We have a visible first frame now (the intro). Tell the host.
    ctx.markVisualReady("intro");

    // Diagnostics: surface any failure on-screen (no dev console in the WebView).
    let readyCalled = false, booted = false;
    function safeReady() { if (!readyCalled) { readyCalled = true; try { ctx.platform.ready(); } catch (_) {} } }
    function showFatal(stage, err) {
      const m = err && (err.message || err.reason || err.toString) ? String(err.message || err.reason || err) : String(err);
      try { ctx.platform.error && ctx.platform.error({ stage: stage, message: m }); } catch (_) {}
      if (booted) return; // grove already running — don't hijack a working screen
      el.cta.classList.remove("wait");
      el.cta.textContent = "Show error";
      const tag = ui.querySelector(".wg-tag");
      if (tag) {
        tag.textContent = "⚠ " + stage + " — " + m;
        tag.style.color = "#ffd7d7";
        tag.style.userSelect = "text";
        tag.style.webkitUserSelect = "text";
      }
      el.intro.style.display = "flex";
      safeReady();
    }
    ctx.listen(window, "error", (e) => showFatal("runtime", (e && e.error) || (e && e.message) || e));
    ctx.listen(window, "unhandledrejection", (e) => showFatal("promise", (e && e.reason) || e));

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
      { e: "🦋", n: "Butterfly", t: "common", f: "A butterfly tastes with its feet — standing on a leaf tells it whether to lay eggs there." },
      { e: "🐁", n: "Wood Mouse", t: "common", f: "A mouse's heart can beat up to 600 times a minute — around ten beats every second." },
      { e: "🐢", n: "Turtle", t: "common", f: "Some turtles can breathe through their skin, letting them stay underwater for months." },
      // uncommon
      { e: "🦊", n: "Fox", t: "uncommon", f: "Foxes seem to use Earth's magnetic field to aim their pounce — like a living compass." },
      { e: "🦝", n: "Raccoon", t: "uncommon", f: "Raccoons have hyper-sensitive paws and 'wash' food mainly to feel it better, not to clean it." },
      { e: "🐦", n: "Robin", t: "uncommon", f: "A robin can sense Earth's magnetic field, helping it find its way when it migrates." },
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
    const THREE_URL = "https://libs.plethora.studio/three/0.164.1/three.module.js";
    try {
      THREE = await ctx.importModule("three", "0.164.1");
    } catch (err1) {
      try {
        THREE = await ctx.importModule(THREE_URL);
      } catch (err2) {
        showFatal("load three", err2 || err1);
        return;
      }
    }
    if (THREE && !THREE.WebGLRenderer && THREE.default) THREE = THREE.default;
    if (!THREE || !THREE.WebGLRenderer) {
      showFatal("three exports", new Error("WebGLRenderer missing (keys: " + Object.keys(THREE || {}).slice(0, 6).join(",") + ")"));
      return;
    }

    try {

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

    function groundTexture() {
      const S = 512;
      const c = makeCanvas(S);
      const g = c.getContext("2d");
      g.fillStyle = "#2f4d29";
      g.fillRect(0, 0, S, S);
      // wrap-safe blobs: draw each near an edge again on the opposite side
      function blob(col, x, y, r, a) {
        g.fillStyle = col; g.globalAlpha = a;
        for (const ox of [0, S, -S]) for (const oy of [0, S, -S]) {
          if (Math.abs(x + ox - S / 2) > S && Math.abs(y + oy - S / 2) > S) continue;
          g.beginPath(); g.arc(x + ox, y + oy, r, 0, Math.PI * 2); g.fill();
        }
      }
      // mossy greens, dark hollows, dirt + leaf-litter speckle
      const layers = [
        ["#3a6031", 520, 8, 22, 0.35], ["#274021", 460, 6, 20, 0.4],
        ["#4b7a3f", 360, 5, 16, 0.32], ["#5c8f49", 220, 4, 12, 0.3],
        ["#6a4a2c", 180, 3, 9, 0.4], ["#7d5a33", 120, 2, 7, 0.45],
        ["#89a94f", 200, 1, 4, 0.35]
      ];
      for (const [col, count, rmin, rmax, a] of layers) {
        for (let i = 0; i < count; i++) {
          blob(col, Math.random() * S, Math.random() * S, rmin + Math.random() * (rmax - rmin), a * (0.6 + Math.random() * 0.6));
        }
      }
      g.globalAlpha = 1;
      const tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      tex.anisotropy = 4;
      return tex;
    }

    const leafTex = emojiTexture("🍃");
    const glowTex = radialTexture();

    // ---------------------------------------------------------------------
    // 4. Scene, camera, renderer, lighting, fog.
    // ---------------------------------------------------------------------
    const SKY = 0x93bd8f;         // hazy sunlit green
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(ctx.nativeDpr || window.devicePixelRatio || 1, 2));
    renderer.setSize(ctx.width, ctx.height, false);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(SKY);
    scene.fog = new THREE.Fog(SKY, 9, 70); // close, cozy haze so the forest feels deep

    const camera = new THREE.PerspectiveCamera(64, ctx.width / ctx.height, 0.1, 400);

    scene.add(new THREE.HemisphereLight(0xd6f0c8, 0x2c3a22, 1.0));
    const sun = new THREE.DirectionalLight(0xfff1cf, 1.55);
    sun.position.set(22, 34, 10);
    scene.add(sun);
    const fill = new THREE.DirectionalLight(0xbfe0ff, 0.28);
    fill.position.set(-18, 20, -26);
    scene.add(fill);

    // --- shared wind: sways grass, canopies and bushes in the vertex shader ---
    const GRASS_R = 34;                 // grass radius around the player
    const windU = { value: 0 };
    function applyWind(mat, mode) {
      mat.onBeforeCompile = (sh) => {
        sh.uniforms.uTime = windU;
        let inject;
        if (mode === "grass") {
          inject =
            "float ph = instanceMatrix[3].x*0.35 + instanceMatrix[3].z*0.35;\n" +
            "transformed.x += sin(uTime*1.7 + ph)*0.22*transformed.y;\n" +
            "transformed.z += cos(uTime*1.3 + ph)*0.14*transformed.y;\n" +
            "float gd = distance(cameraPosition.xz, vec2(instanceMatrix[3].x, instanceMatrix[3].z));\n" +
            "transformed *= clamp((" + GRASS_R.toFixed(1) + " - gd)/7.0, 0.0, 1.0);\n";
        } else {
          inject =
            "float ph = instanceMatrix[3].x*0.2 + instanceMatrix[3].z*0.2;\n" +
            "transformed.x += sin(uTime*0.85 + ph)*0.13;\n" +
            "transformed.z += cos(uTime*0.65 + ph)*0.10;\n";
        }
        sh.vertexShader = "uniform float uTime;\n" +
          sh.vertexShader.replace("#include <begin_vertex>", "#include <begin_vertex>\n" + inject);
      };
    }

    // Ground — follows the player so the forest floor is effectively endless.
    const GROUND = 320;
    const TILE = 5.5; // world metres per texture tile (finer detail)
    const gTex = groundTexture();
    gTex.repeat.set(GROUND / TILE, GROUND / TILE);
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(GROUND, GROUND),
      new THREE.MeshStandardMaterial({ map: gTex, roughness: 1, metalness: 0 })
    );
    ground.rotation.x = -Math.PI / 2;
    scene.add(ground);

    // ---------------------------------------------------------------------
    // 5. Endless forest: trunks + two canopy lobes, bushes and swaying grass,
    //    all instanced and recycled behind the player.
    // ---------------------------------------------------------------------
    const _m = new THREE.Matrix4();
    const _q = new THREE.Quaternion();
    const _p = new THREE.Vector3();
    const _s = new THREE.Vector3();
    const _col = new THREE.Color();
    const UP = new THREE.Vector3(0, 1, 0);

    // -- trees --
    const MAX_TREES = 300;
    const trunkGeo = new THREE.CylinderGeometry(0.12, 0.24, 2.6, 6);
    trunkGeo.translate(0, 1.3, 0);
    const canopyGeo = new THREE.IcosahedronGeometry(1, 1); // rounder canopy
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x543a26, roughness: 1, flatShading: true });
    const foliageMat1 = new THREE.MeshStandardMaterial({ roughness: 1, flatShading: true });
    const foliageMat2 = new THREE.MeshStandardMaterial({ roughness: 1, flatShading: true });
    applyWind(foliageMat1, "canopy");
    applyWind(foliageMat2, "canopy");
    const trunkMesh = new THREE.InstancedMesh(trunkGeo, trunkMat, MAX_TREES);
    const foliage1 = new THREE.InstancedMesh(canopyGeo, foliageMat1, MAX_TREES);
    const foliage2 = new THREE.InstancedMesh(canopyGeo, foliageMat2, MAX_TREES);
    [trunkMesh, foliage1, foliage2].forEach((m) => {
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.frustumCulled = false; // instances recycle around the player
    });
    scene.add(trunkMesh, foliage1, foliage2);

    const FOLIAGE_DARK = [0x356b30, 0x2f5f2c, 0x3f7a38, 0x2b5228, 0x477f36];
    const FOLIAGE_LITE = [0x6fae52, 0x7cb85a, 0x64a24a, 0x86bf5f, 0x5c9a46];
    const trees = [];

    function writeTree(i) {
      const t = trees[i];
      _q.setFromAxisAngle(UP, t.rot);
      _p.set(t.x, 0, t.z);
      _s.set(t.tw, t.scale, t.tw);
      _m.compose(_p, _q, _s);
      trunkMesh.setMatrixAt(i, _m);
      const top = 2.6 * t.scale;
      _p.set(t.x, top - 0.2 * t.fr, t.z);
      _s.set(t.fr, t.fr * 1.1, t.fr);
      _q.setFromAxisAngle(UP, t.rot * 1.7);
      _m.compose(_p, _q, _s);
      foliage1.setMatrixAt(i, _m);
      foliage1.setColorAt(i, _col.setHex(t.color));
      _p.set(t.x + t.lx, top + 0.7 * t.fr, t.z + t.lz);
      _s.set(t.fr * 0.68, t.fr * 0.78, t.fr * 0.68);
      _q.setFromAxisAngle(UP, t.rot * 2.3);
      _m.compose(_p, _q, _s);
      foliage2.setMatrixAt(i, _m);
      foliage2.setColorAt(i, _col.setHex(t.color2));
    }

    function placeTree(i, ahead) {
      const t = trees[i] || (trees[i] = {});
      let x, z;
      if (ahead) {
        const ang = camYaw + (Math.random() - 0.5) * Math.PI * 1.4;
        const d = 42 + Math.random() * 32;
        x = player.x + Math.sin(ang) * d;
        z = player.z + Math.cos(ang) * d;
      } else {
        const ang = Math.random() * Math.PI * 2;
        const d = 3 + Math.random() * 70;
        x = player.x + Math.cos(ang) * d;
        z = player.z + Math.sin(ang) * d;
      }
      t.x = x; t.z = z;
      t.scale = 0.75 + Math.random() * 1.6;
      t.tw = 0.7 + Math.random() * 0.5;
      t.fr = (1.5 + Math.random() * 1.5) * (0.8 + t.scale * 0.15);
      t.rot = Math.random() * Math.PI * 2;
      t.lx = (Math.random() - 0.5) * t.fr;
      t.lz = (Math.random() - 0.5) * t.fr;
      t.color = FOLIAGE_DARK[(Math.random() * FOLIAGE_DARK.length) | 0];
      t.color2 = FOLIAGE_LITE[(Math.random() * FOLIAGE_LITE.length) | 0];
      writeTree(i);
    }

    // -- bushes (mid-layer cover that hides creatures) --
    const MAX_BUSH = 220;
    const bushGeo = new THREE.IcosahedronGeometry(1, 0);
    const bushMat = new THREE.MeshStandardMaterial({ roughness: 1, flatShading: true });
    applyWind(bushMat, "canopy");
    const bushMesh = new THREE.InstancedMesh(bushGeo, bushMat, MAX_BUSH);
    bushMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    bushMesh.frustumCulled = false;
    scene.add(bushMesh);
    const BUSH_COLORS = [0x37652f, 0x2f5a2a, 0x40763a, 0x315730, 0x4a833c];
    const bushes = [];

    function writeBush(i) {
      const b = bushes[i];
      _p.set(b.x, b.h * 0.55, b.z);
      _s.set(b.w, b.h, b.w);
      _q.setFromAxisAngle(UP, b.rot);
      _m.compose(_p, _q, _s);
      bushMesh.setMatrixAt(i, _m);
      bushMesh.setColorAt(i, _col.setHex(b.color));
    }
    function placeBush(i, ahead) {
      const b = bushes[i] || (bushes[i] = {});
      let x, z;
      if (ahead) {
        const ang = camYaw + (Math.random() - 0.5) * Math.PI * 1.5;
        const d = 20 + Math.random() * 18;
        x = player.x + Math.sin(ang) * d;
        z = player.z + Math.cos(ang) * d;
      } else {
        const ang = Math.random() * Math.PI * 2;
        const d = 2 + Math.random() * 42;
        x = player.x + Math.cos(ang) * d;
        z = player.z + Math.sin(ang) * d;
      }
      b.x = x; b.z = z;
      b.w = 0.7 + Math.random() * 1.3;
      b.h = (0.5 + Math.random() * 0.6) * b.w;
      b.rot = Math.random() * Math.PI * 2;
      b.color = BUSH_COLORS[(Math.random() * BUSH_COLORS.length) | 0];
      writeBush(i);
    }

    // -- grass: thousands of instanced blades that sway and fade at the edge --
    const GRASS = 3400;
    const bladeGeo = new THREE.BufferGeometry();
    const bh = 0.6, bw = 0.055;
    bladeGeo.setAttribute("position", new THREE.Float32BufferAttribute(
      [-bw, 0, 0, bw, 0, 0, 0, bh, 0], 3));
    bladeGeo.setAttribute("normal", new THREE.Float32BufferAttribute(
      [0, 1, 0, 0, 1, 0, 0, 1, 0], 3));
    bladeGeo.setIndex([0, 1, 2]);
    const grassMat = new THREE.MeshStandardMaterial({ roughness: 1, side: THREE.DoubleSide });
    applyWind(grassMat, "grass");
    const grassMesh = new THREE.InstancedMesh(bladeGeo, grassMat, GRASS);
    grassMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    grassMesh.frustumCulled = false;
    scene.add(grassMesh);
    const GRASS_COLORS = [0x5f9e43, 0x6fae4c, 0x538f3a, 0x7bbb55, 0x4c8a3c, 0x86c25e];
    const blades = [];

    function writeBlade(i) {
      const b = blades[i];
      _p.set(b.x, 0, b.z);
      _s.set(b.s, b.hs, 1);
      _q.setFromAxisAngle(UP, b.rot);
      _m.compose(_p, _q, _s);
      grassMesh.setMatrixAt(i, _m);
      grassMesh.setColorAt(i, _col.setHex(b.color));
    }
    function placeBlade(i, ahead) {
      const b = blades[i] || (blades[i] = {});
      let x, z;
      if (ahead) {
        const ang = camYaw + (Math.random() - 0.5) * Math.PI * 1.6;
        const d = GRASS_R - 6 + Math.random() * 6;
        x = player.x + Math.sin(ang) * d;
        z = player.z + Math.cos(ang) * d;
      } else {
        const ang = Math.random() * Math.PI * 2;
        const d = 0.5 + Math.random() * (GRASS_R - 1);
        x = player.x + Math.cos(ang) * d;
        z = player.z + Math.sin(ang) * d;
      }
      b.x = x; b.z = z;
      b.s = 0.7 + Math.random() * 0.9;
      b.hs = 0.7 + Math.random() * 1.1;
      b.rot = Math.random() * Math.PI * 2;
      b.color = GRASS_COLORS[(Math.random() * GRASS_COLORS.length) | 0];
      writeBlade(i);
    }

    // ---------------------------------------------------------------------
    // 6. Collectibles: animals hidden low among the bushes, words drifting.
    //    No giveaway beacon — a soft glow + firefly only appear up close, and
    //    the discovery chime hints when one is near.
    // ---------------------------------------------------------------------
    const COLLECT_COUNT = 30;
    const COLLECT_REACH = 9;       // must be within this many metres to gather
    const NEAR_CHIME = 17;         // discovery chime range
    const FIND_GLOW = 14;          // glow + firefly reveal range
    const collectibles = [];
    const pickables = [];          // main sprites for raycasting

    function randomContent() {
      if (Math.random() < 0.3) {
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

      const glowMat = new THREE.SpriteMaterial({ map: glowTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0, toneMapped: false });
      const glow = new THREE.Sprite(glowMat);
      glow.scale.set(2.0, 2.0, 1);
      group.add(glow);

      const sparkMat = new THREE.SpriteMaterial({ map: glowTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0, color: 0xfff2c0, toneMapped: false });
      const spark = new THREE.Sprite(sparkMat);
      spark.scale.set(0.5, 0.5, 1);
      group.add(spark);

      const mainMat = new THREE.SpriteMaterial({ transparent: true, depthWrite: false, toneMapped: false });
      const main = new THREE.Sprite(mainMat);
      group.add(main);

      scene.add(group);
      const c = { group, glow, glowMat, spark, sparkMat, main, mainMat, content: null, x: 0, z: 0, baseY: 0.6, floatAmp: 0.06, phase: Math.random() * Math.PI * 2, near: false, dead: false };
      main.userData.col = c;
      pickables.push(main);
      collectibles[i] = c;
      spawnCollectible(c, true);
    }

    function spawnCollectible(c, initial) {
      const content = randomContent();
      c.content = content;
      const tier = TIERS[content.tier];
      c.mainMat.map = content.kind === "word" ? wordTexture(content.word) : emojiTexture(content.emoji);
      c.mainMat.needsUpdate = true;
      const mainScale = content.kind === "word" ? 1.2 : 1.95;
      c.main.scale.set(mainScale, mainScale, 1);
      c.glowMat.color.setHex(tier.color);
      c.sparkMat.color.setHex(content.tier === "word" ? 0xbfffe6 : 0xfff2c0);
      const legend = content.tier === "legendary";
      c.glow.scale.setScalar(legend ? 2.8 : content.tier === "rare" ? 2.3 : 1.9);

      // Nestle animals beside a bush (tucked, partly hidden); words drift a bit
      // more in the open. Fall back to a plain ring if no bush is handy.
      const minD = initial ? 8 : 16, maxD = initial ? 32 : 48;
      let x = null, z = null;
      if (content.kind === "animal" && bushes.length) {
        for (let tries = 0; tries < 6; tries++) {
          const b = bushes[(Math.random() * bushes.length) | 0];
          if (!b) continue;
          const bd = Math.hypot(b.x - player.x, b.z - player.z);
          if (bd >= minD && bd <= maxD) {
            const a = Math.random() * Math.PI * 2, off = 0.8 + Math.random() * 1.2;
            x = b.x + Math.cos(a) * off; z = b.z + Math.sin(a) * off;
            break;
          }
        }
      }
      if (x === null) {
        const ang = Math.random() * Math.PI * 2;
        const d = minD + Math.random() * (maxD - minD);
        x = player.x + Math.cos(ang) * d;
        z = player.z + Math.sin(ang) * d;
      }
      c.x = x; c.z = z;
      if (content.kind === "word") { c.baseY = 1.2 + Math.random() * 0.5; c.floatAmp = 0.22; }
      else { c.baseY = 0.72 + Math.random() * 0.22; c.floatAmp = 0.05; }
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
      resumeAC();
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
          sfxTap();
          return;
        }
      }
      // otherwise try the foliage / bushes for a rustle
      const tHit = raycaster.intersectObjects([foliage1, foliage2, bushMesh], false);
      if (tHit.length && tHit[0].distance < 30) {
        const h = tHit[0];
        let color = 0x4c8a3f;
        if (h.object === bushMesh) { const b = bushes[h.instanceId]; if (b) color = b.color; }
        else { const t = trees[h.instanceId]; if (t) color = t.color2 || t.color; }
        rustle(h.point, color);
      } else {
        sfxTap();
      }
    }

    function rustle(point, color) {
      burstLeaves(point.x, point.y, point.z, color);
      sfxRustle();
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
      sfxCollect(content.tier);
      if (content.tier === "legendary") {
        ctx.platform.milestone && ctx.platform.milestone("legendary_find", { name: content.name });
        ctx.platform.haptic && ctx.platform.haptic("success");
      } else if (content.tier === "rare") {
        ctx.platform.haptic && ctx.platform.haptic("medium");
      } else {
        ctx.platform.haptic && ctx.platform.haptic("light");
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
    ctx.listen(el.fact, "pointerup", () => { if (factOpen) { resumeAC(); sfxTap(); hideFact(); } });

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
    // 10b. In-bit leaderboard panel (reads the same "grove" record).
    // ---------------------------------------------------------------------
    let lbPeriod = "all_time", lbOpen = false;
    function lbEsc(s) { return String(s).replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c])); }
    function lbFmt(n) { const x = Math.round(Number(n) || 0); return x.toLocaleString ? x.toLocaleString() : String(x); }
    function lbYou(e) { return !!(e && (e.isYou || e.you || e.self || e.isSelf || e.mine)); }
    function lbNorm(e, i) {
      const u = e.user || {};
      return {
        rank: e.rank ?? e.position ?? (i + 1),
        name: e.displayName || e.name || e.handle || e.username || u.displayName || u.name || u.handle || (lbYou(e) ? "You" : "Explorer"),
        value: e.value ?? e.score ?? e.points ?? (e.entry && e.entry.value) ?? 0,
        you: lbYou(e)
      };
    }
    function openLeaderboard() {
      lbOpen = true;
      el.lb.classList.add("show");
      el.lbList.innerHTML = '<div class="wg-lb-empty">Loading…</div>';
      el.lbMe.innerHTML = "";
      Promise.resolve(maybeSubmit(true)).catch(() => {}).then(loadLeaderboard);
    }
    function closeLeaderboard() { lbOpen = false; el.lb.classList.remove("show"); }
    async function loadLeaderboard() {
      if (!ctx.memory || !ctx.memory.record) {
        el.lbList.innerHTML = '<div class="wg-lb-empty">Leaderboard isn\'t available here.</div>';
        return;
      }
      let lb;
      try { lb = await ctx.memory.record("grove").leaderboard({ scope: "global", period: lbPeriod }); }
      catch (_) { el.lbList.innerHTML = '<div class="wg-lb-empty">Couldn\'t load the board — try again.</div>'; return; }
      if (!lbOpen) return;
      const raw = (lb && (lb.entries || lb.rows || lb.leaderboard || lb.top || lb.results)) || [];
      const entries = raw.map(lbNorm);
      const meRaw = lb && (lb.you || lb.self || lb.me || lb.viewer);
      const me = meRaw ? lbNorm(meRaw, ((meRaw.rank ?? 0) || 1) - 1) : entries.find((x) => x.you);
      if (!entries.length) {
        el.lbList.innerHTML = '<div class="wg-lb-empty">No scores yet.<br>Be the first to wander the grove! 🌿</div>';
      } else {
        const medal = ["🥇", "🥈", "🥉"];
        el.lbList.innerHTML = entries.slice(0, 12).map((e) =>
          '<div class="wg-lb-row' + (e.you ? " you" : "") + '"><span class="r">' +
          (medal[e.rank - 1] || ("#" + e.rank)) + '</span><span class="nm">' +
          lbEsc(e.name) + '</span><span class="sc">✦ ' + lbFmt(e.value) + "</span></div>").join("");
      }
      const meVal = me ? me.value : score;
      const meRank = me && me.rank ? ("#" + me.rank) : "—";
      el.lbMe.innerHTML = '<div class="wg-lb-row you"><span class="r">' + meRank +
        '</span><span class="nm">You' + (me ? "" : " · this run") + '</span><span class="sc">✦ ' + lbFmt(meVal) + "</span></div>";
    }
    ctx.listen(el.lbBtn, "click", () => { resumeAC(); sfxTap(); openLeaderboard(); });
    ctx.listen(el.lbClose, "click", () => { sfxTap(); closeLeaderboard(); });
    ctx.listen(el.lb, "pointerup", (e) => { if (e.target === el.lb) closeLeaderboard(); });
    for (const tab of ui.querySelectorAll(".wg-lb-tabs button")) {
      ctx.listen(tab, "click", () => {
        lbPeriod = tab.dataset.p;
        for (const t of ui.querySelectorAll(".wg-lb-tabs button")) t.classList.toggle("on", t === tab);
        sfxTap();
        loadLeaderboard();
      });
    }

    // ---------------------------------------------------------------------
    // 11. Audio. A self-contained WebAudio synth drives every interaction
    //     sound (guaranteed, no assets, no network); ctx.music is used for the
    //     gentle ambient bed, with music stings as a fallback if WebAudio is
    //     unavailable. All permission-guarded.
    // ---------------------------------------------------------------------
    let musicHandle = null, muted = false, audioReady = false;
    const canMusic = ctx.capabilities && ctx.capabilities.backgroundMusic;
    const canAudio = ctx.capabilities && ctx.capabilities.audio;

    let AC = null, master = null;
    function ensureAC() {
      if (AC || !canAudio) return;
      const Ctor = window.AudioContext || window.webkitAudioContext;
      if (!Ctor) return;
      try {
        AC = new Ctor();
        master = AC.createGain();
        master.gain.value = muted ? 0 : 0.9;
        master.connect(AC.destination);
      } catch (_) { AC = null; master = null; }
    }
    function resumeAC() {
      if (AC && AC.state === "suspended") { try { AC.resume(); } catch (_) {} }
    }
    function tone(freq, delay, dur, type, peak) {
      if (!AC) return;
      const o = AC.createOscillator(), g = AC.createGain();
      o.type = type || "sine";
      o.frequency.value = freq;
      o.connect(g); g.connect(master);
      const t = AC.currentTime + (delay || 0);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(peak || 0.22, t + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0006, t + dur);
      o.start(t);
      o.stop(t + dur + 0.03);
    }
    function noiseBurst(dur, cutoff, peak) {
      if (!AC) return;
      const n = Math.max(1, Math.floor(AC.sampleRate * dur));
      const buf = AC.createBuffer(1, n, AC.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
      const src = AC.createBufferSource(); src.buffer = buf;
      const bp = AC.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = cutoff || 3400; bp.Q.value = 0.8;
      const g = AC.createGain(); g.gain.value = peak || 0.3;
      src.connect(bp); bp.connect(g); g.connect(master);
      src.start();
      src.stop(AC.currentTime + dur + 0.02);
    }

    // Fallback to ctx.music stings only when WebAudio isn't available.
    function fbSting(name) {
      if (AC || muted || !canMusic || !ctx.music || !ctx.music.sting) return;
      try { ctx.music.sting(name); } catch (_) {}
    }

    const COLLECT_NOTES = {
      common:    [523.25, 659.25],
      uncommon:  [523.25, 783.99],
      word:      [587.33, 880.00],
      rare:      [659.25, 987.77, 1318.51],
      legendary: [523.25, 659.25, 783.99, 1046.50, 1318.51]
    };
    function sfxCollect(tier) {
      if (muted) return;
      if (!AC) { fbSting(tier === "legendary" ? "win" : tier === "rare" ? "powerup" : "coin"); return; }
      const notes = COLLECT_NOTES[tier] || COLLECT_NOTES.common;
      notes.forEach((f, i) => tone(f, i * 0.058, 0.26, "triangle", 0.2));
      if (tier === "legendary" || tier === "rare") tone(notes[notes.length - 1] * 2, notes.length * 0.058, 0.5, "sine", 0.09);
    }
    function sfxRustle() {
      if (muted) return;
      if (!AC) { fbSting("tap"); return; }
      noiseBurst(0.16, 4200, 0.26);
      noiseBurst(0.22, 2600, 0.16);
    }
    function sfxNear() {
      if (muted || !AC) return;
      tone(1244.51, 0, 0.16, "sine", 0.07);
    }
    function sfxTap() {
      if (muted) return;
      if (!AC) { fbSting("tap"); return; }
      tone(320, 0, 0.08, "sine", 0.12);
    }
    function sfxStart() {
      if (muted || !AC) return;
      [392.0, 523.25, 659.25].forEach((f, i) => tone(f, i * 0.07, 0.5, "triangle", 0.16));
    }

    // --- ambient forest bed: soft breeze + warm drone + distant birdsong ---
    let ambient = null, birdStop = false;
    function startAmbient() {
      if (!AC || ambient) return;
      const bed = AC.createGain();
      bed.gain.setValueAtTime(0.0001, AC.currentTime);
      bed.gain.linearRampToValueAtTime(muted ? 0 : 0.16, AC.currentTime + 4);
      bed.connect(master);

      // breeze: looping brown-ish noise through a slowly breathing lowpass
      const secs = 4, n = Math.floor(AC.sampleRate * secs);
      const buf = AC.createBuffer(1, n, AC.sampleRate);
      const d = buf.getChannelData(0);
      let last = 0;
      for (let i = 0; i < n; i++) { const w = Math.random() * 2 - 1; last = (last + 0.02 * w) / 1.02; d[i] = last * 3.2; }
      const wind = AC.createBufferSource(); wind.buffer = buf; wind.loop = true;
      const wf = AC.createBiquadFilter(); wf.type = "lowpass"; wf.frequency.value = 560; wf.Q.value = 0.6;
      const wg = AC.createGain(); wg.gain.value = 0.55;
      wind.connect(wf); wf.connect(wg); wg.connect(bed); wind.start();
      const lfo = AC.createOscillator(); lfo.frequency.value = 0.05;
      const lfoG = AC.createGain(); lfoG.gain.value = 240;
      lfo.connect(lfoG); lfoG.connect(wf.frequency); lfo.start();
      const lfo2 = AC.createOscillator(); lfo2.frequency.value = 0.08;
      const lfo2G = AC.createGain(); lfo2G.gain.value = 0.22;
      lfo2.connect(lfo2G); lfo2G.connect(wg.gain); lfo2.start();

      // warm low drone (kept dim + low-passed so it reads as atmosphere)
      const padF = AC.createBiquadFilter(); padF.type = "lowpass"; padF.frequency.value = 820;
      const padG = AC.createGain(); padG.gain.value = 0.038;
      padF.connect(padG); padG.connect(bed);
      const chord = [110.0, 164.81, 220.0]; // A2 · E3 · A4-ish warmth
      const oscs = [lfo, lfo2];
      chord.forEach((f) => {
        const o = AC.createOscillator(); o.type = "triangle"; o.frequency.value = f;
        const o2 = AC.createOscillator(); o2.type = "sine"; o2.frequency.value = f * 1.004;
        o.connect(padF); o2.connect(padF); o.start(); o2.start(); oscs.push(o, o2);
      });
      const plfo = AC.createOscillator(); plfo.frequency.value = 0.07;
      const plfoG = AC.createGain(); plfoG.gain.value = 0.02;
      plfo.connect(plfoG); plfoG.connect(padG.gain); plfo.start(); oscs.push(plfo);

      ambient = { bed, wind, oscs };
      scheduleBird();
    }
    function scheduleBird() {
      if (!AC || birdStop) return;
      ctx.timeout(() => { if (ambient && !muted && AC.state === "running") chirp(); scheduleBird(); }, 3500 + Math.random() * 9000);
    }
    function chirp() {
      if (!AC || !ambient) return;
      const base = 1900 + Math.random() * 1500;
      const notes = 2 + ((Math.random() * 3) | 0);
      for (let i = 0; i < notes; i++) {
        const t = AC.currentTime + i * 0.09;
        const f = base * (1 + (Math.random() - 0.5) * 0.28);
        const o = AC.createOscillator(); o.type = "sine";
        o.frequency.setValueAtTime(f, t);
        o.frequency.exponentialRampToValueAtTime(f * 1.35, t + 0.05);
        const eg = AC.createGain();
        eg.gain.setValueAtTime(0.0001, t);
        eg.gain.linearRampToValueAtTime(0.032, t + 0.012);
        eg.gain.exponentialRampToValueAtTime(0.0004, t + 0.09);
        o.connect(eg); eg.connect(ambient.bed); o.start(t); o.stop(t + 0.11);
      }
    }
    function stopAmbient() {
      birdStop = true;
      if (!ambient) return;
      try { ambient.wind.stop(); } catch (_) {}
      for (const o of ambient.oscs) { try { o.stop(); } catch (_) {} }
      ambient = null;
    }

    async function startAudio() {
      if (audioReady) return;
      audioReady = true;
      ensureAC();
      resumeAC();
      sfxStart();
      startAmbient();
    }
    ctx.listen(el.mute, "click", () => {
      muted = !muted;
      el.mute.textContent = muted ? "🔇" : "🔊";
      if (master && AC) {
        try { master.gain.setTargetAtTime(muted ? 0 : 0.9, AC.currentTime, 0.05); }
        catch (_) { try { master.gain.value = muted ? 0 : 0.9; } catch (__) {} }
      }
    });
    ctx.listen(document, "visibilitychange", () => {
      if (!AC) return;
      if (document.hidden) { try { AC.suspend(); } catch (_) {} }
      else if (started && audioReady) { try { AC.resume(); } catch (_) {} }
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
    foliage1.instanceMatrix.needsUpdate = true;
    foliage2.instanceMatrix.needsUpdate = true;
    if (foliage1.instanceColor) foliage1.instanceColor.needsUpdate = true;
    if (foliage2.instanceColor) foliage2.instanceColor.needsUpdate = true;
    for (let i = 0; i < MAX_BUSH; i++) placeBush(i, false);
    bushMesh.instanceMatrix.needsUpdate = true;
    if (bushMesh.instanceColor) bushMesh.instanceColor.needsUpdate = true;
    for (let i = 0; i < GRASS; i++) placeBlade(i, false);
    grassMesh.instanceMatrix.needsUpdate = true;
    if (grassMesh.instanceColor) grassMesh.instanceColor.needsUpdate = true;
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
    let nowMs = 0;
    let treeCursor = 0, bushCursor = 0, grassCursor = 0;
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

      // --- wind ---
      windU.value = timeMs * 0.001;

      // --- recycle trees ---
      let td = false;
      for (let k = 0; k < 26; k++) {
        const i = (treeCursor + k) % MAX_TREES;
        const t = trees[i];
        if (Math.hypot(t.x - player.x, t.z - player.z) > 80) { placeTree(i, true); td = true; }
      }
      treeCursor = (treeCursor + 26) % MAX_TREES;
      if (td) {
        trunkMesh.instanceMatrix.needsUpdate = true;
        foliage1.instanceMatrix.needsUpdate = true;
        foliage2.instanceMatrix.needsUpdate = true;
        if (foliage1.instanceColor) foliage1.instanceColor.needsUpdate = true;
        if (foliage2.instanceColor) foliage2.instanceColor.needsUpdate = true;
      }

      // --- recycle bushes ---
      let bdrt = false;
      for (let k = 0; k < 12; k++) {
        const i = (bushCursor + k) % MAX_BUSH;
        const b = bushes[i];
        if (Math.hypot(b.x - player.x, b.z - player.z) > 48) { placeBush(i, true); bdrt = true; }
      }
      bushCursor = (bushCursor + 12) % MAX_BUSH;
      if (bdrt) {
        bushMesh.instanceMatrix.needsUpdate = true;
        if (bushMesh.instanceColor) bushMesh.instanceColor.needsUpdate = true;
      }

      // --- recycle grass ---
      let gdrt = false;
      for (let k = 0; k < 360; k++) {
        const i = (grassCursor + k) % GRASS;
        const b = blades[i];
        if (Math.hypot(b.x - player.x, b.z - player.z) > GRASS_R + 4) { placeBlade(i, true); gdrt = true; }
      }
      grassCursor = (grassCursor + 360) % GRASS;
      if (gdrt) {
        grassMesh.instanceMatrix.needsUpdate = true;
        if (grassMesh.instanceColor) grassMesh.instanceColor.needsUpdate = true;
      }

      // --- collectibles: bob, recycle, reveal only up close, discovery chime ---
      for (const c of collectibles) {
        if (c.dead) continue;
        const d = Math.hypot(c.x - player.x, c.z - player.z);
        if (d > 66) { spawnCollectible(c, false); continue; }
        const y = c.baseY + Math.sin(timeMs * 0.0018 + c.phase) * c.floatAmp;
        c.group.position.set(c.x, y, c.z);
        const near = d < FIND_GLOW ? (FIND_GLOW - d) / FIND_GLOW : 0;
        const pulse = 0.7 + Math.sin(timeMs * 0.005 + c.phase) * 0.3;
        c.glowMat.opacity = near * 0.5 * pulse;
        c.sparkMat.opacity = near * 0.85 * (0.5 + 0.5 * Math.sin(timeMs * 0.012 + c.phase));
        const orb = 0.4 + 0.15 * Math.sin(timeMs * 0.003 + c.phase);
        c.spark.position.set(
          Math.cos(timeMs * 0.004 + c.phase) * orb,
          0.35 + Math.sin(timeMs * 0.006 + c.phase) * 0.15,
          Math.sin(timeMs * 0.004 + c.phase) * orb
        );
        if (started && !c.near && d < NEAR_CHIME) {
          c.near = true;
          if (!factOpen) { sfxNear(); ctx.platform.haptic && ctx.platform.haptic("light"); }
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
    safeReady();
    booted = true;

    ctx.onDestroy(() => {
      try { stopAmbient(); } catch (_) {}
      try { if (musicHandle && musicHandle.stop) musicHandle.stop({ fadeOutMs: 300 }); } catch (_) {}
      try { if (AC && AC.close) AC.close(); } catch (_) {}
      try { renderer.dispose(); } catch (_) {}
    });
    } catch (e) {
      showFatal("init", e);
    }
  }
};
