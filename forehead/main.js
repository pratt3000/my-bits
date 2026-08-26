/**
 * Forehead — the phone goes on your head and everyone else shouts at you.
 *
 * One player holds the phone against their forehead with the screen facing
 * out. They cannot see it; everybody else can. A word fills the screen, the
 * room describes it without saying it, and the holder guesses. Tilt the phone
 * down when they get it, up to skip.
 *
 * Two things drive the build.
 *
 * The phone is held SIDEWAYS on a forehead, so the word is drawn rotated a
 * quarter turn. A portrait word on a sideways phone is unreadable across a
 * room, which is the whole point of the game.
 *
 * The tilt is CALIBRATED rather than assumed. Reading a fixed axis breaks the
 * moment somebody holds the phone the other way up — and half a room will.
 * Instead the neutral gravity vector is captured at the start of the round and
 * every later reading is measured as an angle away from it, so which way is
 * "down" is whichever way it was pointing when play began. There is a full tap
 * fallback for a device with no motion, or a player who declines it: the
 * screen splits into a skip half and a got-it half.
 *
 * Contract notes: no packaged assets (maxAssets is 0). Motion is a declared,
 * permission-gated capability started from a user gesture, with the tap
 * fallback always present rather than only on failure. The overlay is markup on
 * ctx.createRoot() with pointer-events off on the root itself.
 */
window.plethoraBit = {
  meta: {
    title: "Forehead",
    runtime: "plethora-bit@2",
    tags: ["party", "multiplayer", "local-multiplayer", "charades", "words"],
    permissions: ["backgroundMusic", "haptics", "motion", "storage"],
  },

  async init(ctx) {

    /* A drawn speaker rather than the emoji. Colour-emoji glyphs land as a
     * blue-and-white blob beside otherwise monochrome chrome, they ignore the
     * button's own colour, and they are the one thing on screen that is not
     * set in the game's typeface. currentColor keeps this one in step. */
    const SPK = (on) =>
      '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" ' +
        'stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" ' +
        'style="display:block;margin:0 auto;overflow:visible;" aria-hidden="true">' +
        '<path d="M4 9.4h3.5L12.2 5.4v13.2L7.5 14.6H4z" fill="currentColor" stroke="none"/>' +
        (on ? '<path d="M15.8 9.2a4 4 0 0 1 0 5.6"/><path d="M18.4 6.6a7.7 7.7 0 0 1 0 10.8"/>'
            : '<path d="M16.2 9.6l5 4.8M21.2 9.6l-5 4.8"/>') +
      '</svg>';

    /* Every game in this set is set in lowercase Inter. Canvas text comes from
     * a few hundred call sites, so the case change goes in at the one place
     * they all pass through rather than at each of them. Single characters are
     * left alone — card ranks and piece letters are symbols, not words, and
     * "k" on a king reads as a bug. measureText is patched to match, or
     * centred text would be measured at its uppercase width and drift off
     * its own anchor. */
    for (const Proto of [globalThis.CanvasRenderingContext2D,
                         globalThis.OffscreenCanvasRenderingContext2D]) {
      if (!Proto || Proto.prototype.__lcText) continue;
      Proto.prototype.__lcText = true;
      for (const method of ["fillText", "strokeText", "measureText"]) {
        const original = Proto.prototype[method];
        if (!original) continue;
        Proto.prototype[method] = function (text, ...rest) {
          const t = typeof text === "string" && text.length > 1 ? text.toLowerCase() : text;
          return original.call(this, t, ...rest);
        };
      }
    }
    // Inter, from the Plethora font registry, in the three weights it serves.
    // The calls are fire-and-forget with literal arguments: a font is a
    // nicety and the first frame must never wait on one, and the upload
    // validator only accepts loader arguments that are direct literals.
    try { ctx.loadFont("Inter", "inter", "1.0.0", { weight: "400" }); } catch (_) {}
    try { ctx.loadFont("Inter", "inter", "1.0.0", { weight: "600" }); } catch (_) {}
    try { ctx.loadFont("Inter", "inter", "1.0.0", { weight: "700" }); } catch (_) {}
    /* ---------------------------------------------------------------
     * Decks. Each is chosen for words a room can describe fast and out
     * loud — nothing that needs spelling, and nothing that only one
     * person in the room will know.
     * ------------------------------------------------------------- */
    const DECKS = [
      { id: "movies", name: "At the Movies", hue: "#ff3b6b", icon: "🎬", words:
        ["Jurassic Park","Titanic","The Lion King","Star Wars","Jaws","Frozen","The Matrix","Shrek",
         "Home Alone","Toy Story","Rocky","Ghostbusters","Finding Nemo","Harry Potter","The Godfather",
         "Back to the Future","Indiana Jones","Forrest Gump","The Avengers","Spider-Man","Batman",
         "King Kong","E.T.","Grease","Mamma Mia","Mean Girls","The Hunger Games","Pirates of the Caribbean",
         "Despicable Me","Moana","Coco","Up","Wall-E","Ratatouille","Cars","Zootopia","Aladdin",
         "Beauty and the Beast","Cinderella","Snow White","The Little Mermaid","Kung Fu Panda","Madagascar",
         "Ice Age","The Incredibles","Monsters Inc","Inside Out","Encanto","Barbie","Oppenheimer"] },
      { id: "animals", name: "Animals", hue: "#26c281", icon: "🦒", words:
        ["Elephant","Penguin","Kangaroo","Octopus","Giraffe","Hedgehog","Flamingo","Sloth","Koala",
         "Rhinoceros","Chameleon","Jellyfish","Platypus","Meerkat","Walrus","Parrot","Peacock","Otter",
         "Squirrel","Camel","Hippopotamus","Crocodile","Butterfly","Dolphin","Owl","Bat","Skunk","Raccoon",
         "Panda","Polar Bear","Tiger","Zebra","Snail","Spider","Scorpion","Seahorse","Starfish","Lobster",
         "Ostrich","Woodpecker","Beaver","Porcupine","Armadillo","Llama","Donkey","Goose","Turkey","Ferret",
         "Chinchilla","Narwhal"] },
      { id: "actions", name: "Act It Out", hue: "#ffb020", icon: "🤸", words:
        ["Sneezing","Juggling","Swimming","Tiptoeing","Yawning","Shivering","Applauding","Snoring",
         "Tying shoelaces","Brushing teeth","Riding a horse","Playing violin","Climbing a ladder",
         "Blowing out candles","Waving goodbye","Doing a cartwheel","Eating spaghetti","Taking a selfie",
         "Painting a wall","Rowing a boat","Flying a kite","Skipping rope","Chopping onions",
         "Typing fast","Whistling","Tickling","Limping","Balancing a book","Threading a needle",
         "Karate chop","Moonwalking","Air guitar","Hula hooping","Pouring tea","Fishing","Shovelling snow",
         "Hitchhiking","Arm wrestling","Sleepwalking","Playing chess","Blowing a bubble","Ice skating",
         "Doing yoga","Bowling","Salsa dancing","Sniffing a flower","Mopping the floor",
         "Zipping a coat","Winking","Stretching"] },
      { id: "food", name: "Food & Drink", hue: "#ff7043", icon: "🍜", words:
        ["Pizza","Sushi","Pancakes","Popcorn","Spaghetti","Avocado","Watermelon","Croissant","Tacos",
         "Ice cream","Doughnut","Pineapple","Marshmallow","Peanut butter","Cheeseburger","Noodles",
         "Chocolate","Curry","Waffle","Lemonade","Coconut","Bagel","Omelette","Dumpling","Pretzel",
         "Cupcake","Smoothie","Olives","Pumpkin","Mushroom","Broccoli","Garlic","Ketchup","Mustard",
         "Cinnamon","Honey","Yoghurt","Cereal","Toast","Soup","Salad","Steak","Bacon","Cheese","Rice",
         "Mango","Blueberry","Cucumber","Pickle","Fried egg"] },
      { id: "places", name: "Around the World", hue: "#3ba7ff", icon: "🗺️", words:
        ["Eiffel Tower","Great Wall of China","Pyramids","Amazon Rainforest","Sahara Desert","Mount Everest",
         "Venice","Iceland","Times Square","Grand Canyon","Stonehenge","Big Ben","Taj Mahal","Colosseum",
         "Niagara Falls","Antarctica","Hollywood","Tokyo","Sydney Opera House","Machu Picchu","Santorini",
         "Serengeti","Dubai","Route 66","Bermuda Triangle","Silicon Valley","Vatican City","Kilimanjaro",
         "Great Barrier Reef","Alps","Nile","Sphinx","Buckingham Palace","Golden Gate Bridge","Rio de Janeiro",
         "Marrakesh","Bali","Loch Ness","Death Valley","Yellowstone","Petra","Angkor Wat","Chernobyl",
         "Easter Island","Galápagos","Mount Fuji","Casablanca","Kathmandu","Reykjavik","Zanzibar"] },
      { id: "objects", name: "Around the House", hue: "#a678ff", icon: "🪑", words:
        ["Toaster","Umbrella","Vacuum cleaner","Hairdryer","Doorbell","Mirror","Candle","Ladder","Kettle",
         "Remote control","Pillow","Scissors","Stapler","Toothbrush","Wheelbarrow","Lawnmower","Frying pan",
         "Coat hanger","Alarm clock","Washing machine","Corkscrew","Torch","Tape measure","Watering can",
         "Ironing board","Fire extinguisher","Bookshelf","Doormat","Chandelier","Sewing machine","Piggy bank",
         "Cuckoo clock","Rocking chair","Bean bag","Chest of drawers","Fridge magnet","Oven glove","Colander",
         "Rolling pin","Dustpan","Clothes peg","Bubble wrap","Sellotape","Rubber duck","Jigsaw puzzle",
         "Snow globe","Bicycle pump","Spirit level","Hole punch","Whisk"] },
    ];

    const esc = (s) => String(s).replace(/[&<>"']/g,
      (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
    const shuffle = (a) => {
      for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
      }
      return a;
    };

    /* ---------------------------------------------------------------
     * Settings
     * ------------------------------------------------------------- */
    const saved = (function () {
      try { return ctx.storage.get("forehead") || {}; } catch (_) { return {}; }
    })();
    const settings = {
      deck: DECKS.some((d) => d.id === saved.deck) ? saved.deck : "movies",
      seconds: saved.seconds || 60,
      tilt: saved.tilt !== false,
      mute: !!saved.mute,
    };
    function saveSettings() { try { ctx.storage.set("forehead", settings); } catch (_) {} }
    const deckOf = () => DECKS.find((d) => d.id === settings.deck);

    const sound = (function () {
      let muted = settings.mute, bed = null, unlocked = false;
      const start = () => ctx.music.play({ preset: "pulse", volume: 0.24, tempo: 128, intensity: 0.4 });
      return {
        get muted() { return muted; },
        async unlock() {
          if (unlocked) return;
          unlocked = true;
          try { await ctx.music.unlock(); if (!muted) bed = start(); } catch (_) {}
        },
        sting(n) { if (!muted) { try { ctx.music.sting(n); } catch (_) {} } },
        duck(a, ms) { if (!muted) { try { ctx.music.duck(a, ms); } catch (_) {} } },
        tempo(b) { if (!muted && bed) { try { bed.setTempo(b); } catch (_) {} } },
        haptic(k) { try { ctx.platform.haptic(k); } catch (_) {} },
        toggle() {
          muted = !muted; settings.mute = muted; saveSettings();
          try {
            if (muted) { (bed || ctx.music).stop({ fadeOutMs: 220 }); bed = null; }
            else if (unlocked) bed = start();
          } catch (_) {}
          return muted;
        },
      };
    })();

    /* ---------------------------------------------------------------
     * Tilt.
     *
     * Calibrated, never assumed. Reading a fixed device axis breaks the
     * moment somebody holds the phone the other way up, and in a room of
     * six people half of them will. Instead the gravity vector is
     * captured once at the start of a round — whatever "on my forehead"
     * happens to mean for this person — and every later reading is the
     * angle away from that. Which way is "down" is simply which way it
     * was pointing when play began.
     * ------------------------------------------------------------- */
    const tilt = (function () {
      let available = false, neutral = null, ref = null, armed = true;
      const TRIGGER = 0.62;                 // ~38 degrees off neutral
      const REARM = 0.34;                   // must come back near level first

      // ctx.sensors is read through in full every time rather than bound to a
      // local. The upload validator statically tracks every value derived from
      // ctx, and a binding claims that name for the rest of the file; this one
      // used to be `const a = ...`, and `a` is an ordinary local in seventy-odd
      // other places here. That collision is what the draft was being refused
      // for, under the message "unsupported remote resources" — which names the
      // loader APIs and has nothing to do with the actual cause. A unique name
      // would do; binding nothing is simply harder to get wrong later.
      // One deliberate change of behaviour came with the rewrite: the old
      // `accelerationIncludingGravity || accelerometer` short-circuited, so a
      // gravity object that existed but carried no numeric x meant no reading
      // at all. Each source is now tried on its own merits.
      function vec() {
        if (!ctx.sensors) return null;
        if (ctx.sensors.accelerationIncludingGravity &&
            typeof ctx.sensors.accelerationIncludingGravity.x === "number") {
          return {
            x: ctx.sensors.accelerationIncludingGravity.x,
            y: ctx.sensors.accelerationIncludingGravity.y,
            z: ctx.sensors.accelerationIncludingGravity.z,
          };
        }
        if (ctx.sensors.accelerometer &&
            typeof ctx.sensors.accelerometer.x === "number") {
          return {
            x: ctx.sensors.accelerometer.x,
            y: ctx.sensors.accelerometer.y,
            z: ctx.sensors.accelerometer.z,
          };
        }
        if (ctx.sensors.tilt && typeof ctx.sensors.tilt.x === "number") {
          return { x: ctx.sensors.tilt.x, y: ctx.sensors.tilt.y, z: 1 };
        }
        return null;
      }
      const norm = (v) => {
        const m = Math.hypot(v.x, v.y, v.z) || 1;
        return { x: v.x / m, y: v.y / m, z: v.z / m };
      };

      return {
        get available() { return available; },
        async start() {
          if (!ctx.capabilities.motion) return false;
          try { available = await ctx.sensors.start(); } catch (_) { available = false; }
          return available;
        },
        /** Capture "this is level", whatever level means for this player. */
        calibrate() {
          const v = vec();
          neutral = v ? norm(v) : null;
          armed = true;
          // A reference axis perpendicular to gravity, so the two tilt
          // directions can be told apart rather than just measured.
          if (neutral) {
            const up = Math.abs(neutral.z) < 0.9 ? { x: 0, y: 0, z: 1 } : { x: 0, y: 1, z: 0 };
            ref = norm({
              x: neutral.y * up.z - neutral.z * up.y,
              y: neutral.z * up.x - neutral.x * up.z,
              z: neutral.x * up.y - neutral.y * up.x,
            });
          }
          return !!neutral;
        },
        /**
         * "correct" | "pass" | null. Returns a direction once per gesture:
         * the phone has to come back near level before it will fire again,
         * so one long tilt is one answer rather than a stream of them.
         */
        read() {
          if (!available || !neutral || !ref) return null;
          const v = vec();
          if (!v) return null;
          const n = norm(v);
          const dot = clamp(n.x * neutral.x + n.y * neutral.y + n.z * neutral.z, -1, 1);
          const off = Math.acos(dot);
          if (!armed) { if (off < REARM) armed = true; return null; }
          if (off < TRIGGER) return null;
          armed = false;
          const side = n.x * ref.x + n.y * ref.y + n.z * ref.z;
          return side < 0 ? "correct" : "pass";
        },
      };
    })();

    /* ---------------------------------------------------------------
     * Overlay
     * ------------------------------------------------------------- */
    const FONT = "Inter,-apple-system,system-ui,'Segoe UI',Roboto,sans-serif";
    const ST = ctx.safeArea.top, SB = ctx.safeArea.bottom;
    const BIG = "width:100%;padding:16px;border:none;border-radius:18px;font-family:inherit;" +
      "font-size:17px;font-weight:800;";
    const BTN = "pointer-events:auto;width:36px;height:36px;border-radius:12px;border:none;" +
      "background:rgba(255,255,255,0.16);color:#fff;font-size:15px;font-family:inherit;padding:0;";

    const root = ctx.createRoot({ touchAction: "none" });
    root.style.cssText += ";font-family:" + FONT + ";color:#fff;pointer-events:none;overflow:hidden;text-transform:lowercase;";

    /* Form controls do not inherit text-transform: the UA stylesheet pins
     * `text-transform:none` on button/input/select, so the lowercase set on
     * this root stops dead at every button. Stamp them as they are built,
     * rather than threading the declaration through 250 style strings. */
    const lowercaseControls = () => {
      for (const el of root.querySelectorAll("button,input,select,textarea")) {
        if (el.style.textTransform !== "lowercase") el.style.textTransform = "lowercase";
      }
    };
    lowercaseControls();
    new MutationObserver(lowercaseControls).observe(root, { childList: true, subtree: true });
    root.innerHTML =
      '<div data-el="sheet" style="position:absolute;inset:0;transition:background 260ms ease;' +
        'background:#12131f;"></div>' +
      '<div data-el="stage" style="position:absolute;inset:0;pointer-events:auto;display:flex;' +
        'flex-direction:column;padding:' + (ST + 52) + 'px 18px ' + (SB + 14) + 'px;"></div>' +
      '<div style="position:absolute;right:12px;top:' + (ST + 8) + 'px;display:flex;gap:7px;' +
        'z-index:60;pointer-events:none;">' +
        '<button data-el="mute" aria-label="Sound" style="' + BTN + '">' + SPK(true) + '</button>' +
        '<button data-el="help" aria-label="How to play" style="' + BTN + '">?</button>' +
      '</div>' +
      // The scrim is opaque, and so is the card on it. At 0.95 the ready
      // screen behind still came through: a 150px pink wordmark and a 90px
      // emoji at five percent are perfectly legible, and they landed in the
      // middle of the bullets. A rule panel has to be a wall, not a filter.
      '<div data-el="helpp" style="position:absolute;inset:0;pointer-events:auto;display:none;' +
        'align-items:center;justify-content:center;background:#0A0B14;z-index:80;padding:24px;">' +
        // The list scrolls; the way out does not scroll with it. On a short
        // screen five rules are taller than the panel, and a dismiss button
        // that starts below the fold is a panel with no visible exit.
        '<div style="max-width:330px;width:100%;max-height:100%;display:flex;flex-direction:column;' +
          'box-sizing:border-box;background:#1C1E2E;border-radius:22px;' +
          'padding:24px;border:1px solid rgba(255,255,255,0.14);">' +
          '<div style="overflow-y:auto;min-height:0;">' +
          '<div style="font-size:20px;font-weight:800;margin-bottom:12px;">How to play</div>' +
          '<ul style="font-size:14.5px;line-height:1.75;opacity:0.88;padding-left:18px;margin:0;">' +
            '<li>One person holds the phone <b>sideways against their forehead</b>, screen facing everyone else.</li>' +
            '<li>They cannot see the word. Everyone else can — describe it without saying it.</li>' +
            '<li><b>Tilt down</b> when they get it. <b>Tilt up</b> to skip.</li>' +
            '<li>No tilt? Tap the screen instead: <b>right half</b> is got it, <b>left half</b> skips.</li>' +
            '<li>Keep going until the clock runs out, then pass the phone to the next person.</li>' +
          '</ul>' +
          '</div>' +
          '<button data-el="helpp-close" style="' + BIG + 'margin-top:18px;flex:none;' +
            'background:#2E3145;color:#fff;">Got it</button>' +
        '</div>' +
      '</div>';

    const el = (n) => root.querySelector('[data-el="' + n + '"]');
    const stage = el("stage"), sheet = el("sheet");
    const tap = (node, fn) => {
      if (!node) return;
      ctx.listen(node, "click", (e) => { e.stopPropagation(); e.preventDefault(); fn(e); });
    };
    tap(el("mute"), (e) => { e.target.innerHTML = SPK(!sound.toggle()); });
    if (settings.mute) el("mute").innerHTML = SPK(false);
    tap(el("help"), () => { el("helpp").style.display = "flex"; });
    tap(el("helpp-close"), () => { el("helpp").style.display = "none"; });

    /* ---------------------------------------------------------------
     * State
     * ------------------------------------------------------------- */
    let phase = "setup";                 // setup | ready | count | play | over
    let queue = [], current = null, results = [];
    let left = 0, flash = null;
    // Both clocks are anchored to real timestamps rather than accumulated
    // frame deltas. dt is clamped so a stall cannot jump the game, but that
    // clamp also makes an accumulated clock run LONG on a struggling phone —
    // a sixty-second round would quietly become ninety. A round has to be the
    // length it says it is.
    let countEndsAt = 0, roundEndsAt = 0;

    function setSheet(colour) { sheet.style.background = colour; }

    function renderSetup() {
      phase = "setup";
      setSheet("#12131f");
      const d = deckOf();
      stage.innerHTML =
        // Six decks, three lengths and a start button are taller than a short
        // screen, and a column that centres what does not fit hides the start
        // button off the bottom edge. `safe center` degrades to flex-start
        // once it overflows, and the column scrolls to the button instead.
        '<div style="flex:1;min-height:0;overflow-y:auto;display:flex;flex-direction:column;' +
          'justify-content:center;justify-content:safe center;gap:11px;">' +
          '<div style="font-size:11px;letter-spacing:0.42em;text-transform:lowercase;opacity:0.5;' +
            'text-align:center;">On your head</div>' +
          '<div style="font-size:56px;font-weight:900;letter-spacing:-0.03em;text-align:center;' +
            'line-height:1;color:' + d.hue + ';">Forehead</div>' +
          '<div style="font-size:14.5px;opacity:0.6;text-align:center;line-height:1.5;max-width:270px;' +
            'margin:0 auto;">Hold the phone sideways on your forehead. Everyone else can see the word — ' +
            'you cannot.</div>' +
          '<div style="font-size:11px;letter-spacing:0.22em;text-transform:lowercase;opacity:0.5;' +
            'margin-top:16px;">Deck</div>' +
          '<div data-el="decks" style="display:flex;gap:7px;flex-wrap:wrap;"></div>' +
          '<div style="font-size:11px;letter-spacing:0.22em;text-transform:lowercase;opacity:0.5;' +
            'margin-top:6px;">Round length</div>' +
          '<div data-el="secs" style="display:flex;gap:7px;"></div>' +
          '<button data-el="go" style="' + BIG + 'margin-top:18px;background:' + d.hue + ';' +
            'color:#12101c;">Start a round</button>' +
        '</div>';

      const dk = el("decks");
      dk.innerHTML = DECKS.map((x) =>
        '<button data-v="' + x.id + '" style="flex:1 1 46%;padding:13px 8px;border:none;border-radius:14px;' +
        'font-family:inherit;font-size:13.5px;font-weight:700;text-align:left;">' +
        x.icon + '&nbsp; ' + esc(x.name) + '</button>').join("");
      const paintDecks = () => {
        for (const b of dk.querySelectorAll("button")) {
          const on = settings.deck === b.dataset.v;
          const hue = DECKS.find((x) => x.id === b.dataset.v).hue;
          b.style.background = on ? hue : "rgba(255,255,255,0.07)";
          b.style.color = on ? "#12101c" : "rgba(255,255,255,0.62)";
        }
      };
      for (const b of dk.querySelectorAll("button")) {
        tap(b, () => {
          settings.deck = b.dataset.v; saveSettings(); paintDecks();
          sound.haptic("light");
          const h = deckOf().hue;
          el("go").style.background = h;
          renderSetup.hue = h;
        });
      }
      paintDecks();
      pills(el("secs"), [30, 60, 90], ["30s", "60s", "90s"],
        () => settings.seconds, (v) => { settings.seconds = Number(v); });
      tap(el("go"), begin);
    }

    function pills(host, values, labels, get, set) {
      host.innerHTML = values.map((v, i) =>
        '<button data-v="' + v + '" style="flex:1;padding:12px 0;border:none;border-radius:13px;' +
        'font-family:inherit;font-size:15px;font-weight:700;">' + labels[i] + '</button>').join("");
      const paint = () => {
        for (const b of host.querySelectorAll("button")) {
          const on = String(get()) === b.dataset.v;
          b.style.background = on ? "rgba(255,255,255,0.26)" : "rgba(255,255,255,0.07)";
          b.style.color = on ? "#fff" : "rgba(255,255,255,0.55)";
        }
      };
      for (const b of host.querySelectorAll("button")) {
        tap(b, () => { set(b.dataset.v); saveSettings(); paint(); sound.haptic("light"); });
      }
      paint();
    }

    /* ---------------------------------------------------------------
     * A round
     * ------------------------------------------------------------- */
    async function begin() {
      ctx.platform.start();
      await sound.unlock();
      sound.sting("coin");

      // Motion is asked for from this gesture, not at boot. If it is refused,
      // or the device has none, the tap controls are the game rather than a
      // consolation — they are on screen either way.
      let motionOk = false;
      if (settings.tilt) motionOk = await tilt.start();

      queue = shuffle(deckOf().words.slice());
      results = [];
      left = settings.seconds;
      phase = "ready";
      renderReady(motionOk);
    }

    function renderReady(motionOk) {
      const d = deckOf();
      setSheet("#12131f");
      stage.innerHTML =
        '<div style="flex:1;display:flex;flex-direction:column;justify-content:center;gap:14px;' +
          'text-align:center;">' +
          '<div style="font-size:52px;">🙋</div>' +
          '<div style="font-size:26px;font-weight:800;line-height:1.25;">Phone sideways,<br>on your forehead</div>' +
          '<div style="font-size:14.5px;opacity:0.62;line-height:1.55;max-width:280px;margin:0 auto;">' +
            (motionOk
              ? 'Hold it level, then tap to start. <b>Tilt down</b> for a hit, <b>tilt up</b> to skip. ' +
                'Tapping works too.'
              : 'Tap the <b>right half</b> when they get it, the <b>left half</b> to skip.') +
          '</div>' +
          '<button data-el="go3" style="' + BIG + 'margin-top:20px;background:' + d.hue + ';' +
            'color:#12101c;">I\'m holding it</button>' +
        '</div>';
      tap(el("go3"), () => {
        // Calibrate at the instant the player says the phone is where it will
        // stay, not at boot when it is flat on a table.
        tilt.calibrate();
        countEndsAt = performance.now() + 3000;
        phase = "count";
        renderCount();
      });
    }

    function renderCount() {
      const d = deckOf();
      setSheet(d.hue);
      stage.innerHTML =
        '<div style="flex:1;display:flex;align-items:center;justify-content:center;">' +
          '<div data-el="cd" style="font-size:150px;font-weight:900;color:#12101c;' +
            'transform:rotate(-90deg);line-height:1;">3</div>' +
        '</div>';
    }

    function nextWord() {
      if (!queue.length) queue = shuffle(deckOf().words.slice());
      current = queue.pop();
      renderPlay();
    }

    /**
     * The word screen.
     *
     * Rotated a quarter turn, because the phone is held sideways on a
     * forehead — a portrait word on a sideways phone is unreadable from
     * across a room, which is the entire game. The type scales down for
     * long entries so a two-word film title still fills the screen.
     */
    function renderPlay() {
      const d = deckOf();
      // Fill the screen. Rotated a quarter turn, the word's LENGTH is bounded
      // by the screen height and its cap height by the screen width, so both
      // bounds have to be solved and the smaller taken — a fixed size leaves a
      // short word floating in the middle of a phone that somebody is trying
      // to read from across a room.
      const len = Math.max(current.length, 1);
      const byLength = (ctx.height - 96) / (0.60 * len);
      const byHeight = ctx.width * 0.56;
      const size = Math.max(30, Math.min(byLength, byHeight));
      // Every child here is pointer-events:none so the stage itself is always
      // the event target. offsetX is measured against e.target, so a tap that
      // lands on the word — which now fills the screen — would otherwise be
      // measured against the word's own box and report the wrong half.
      stage.innerHTML =
        '<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;' +
          'pointer-events:none;">' +
          '<div data-el="word" style="transform:rotate(-90deg);white-space:nowrap;font-size:' + size + 'px;' +
            'font-weight:900;letter-spacing:-0.03em;color:#12101c;text-align:center;line-height:1;">' +
            esc(current) + '</div>' +
        '</div>' +
        // The clock reads right-way-up for the room, who are the ones watching it.
        '<div data-el="clock" style="position:absolute;left:14px;top:50%;pointer-events:none;' +
          'transform:translateY(-50%) rotate(-90deg);' +
          'font-size:20px;font-weight:800;color:rgba(18,16,28,0.72);"></div>' +
        '<div style="position:absolute;right:14px;top:50%;pointer-events:none;' +
          'transform:translateY(-50%) rotate(-90deg);' +
          'font-size:20px;font-weight:800;color:rgba(18,16,28,0.72);">' +
          results.filter((r) => r.hit).length + '</div>';
      setSheet(d.hue);
      paintClock();
    }

    function paintClock() {
      const c = el("clock");
      if (c) c.textContent = Math.max(0, Math.ceil(left)) + "s";
    }

    /** Resolve the current word and move on. */
    function answer(hit) {
      if (phase !== "play" || !current) return;
      results.push({ word: current, hit });
      sound.sting(hit ? "coin" : "fail");
      sound.haptic(hit ? "success" : "warning");
      // A full-screen colour flash, so the room sees the verdict from
      // wherever they are standing.
      flash = { colour: hit ? "#1db954" : "#e0413e", t: 0.34 };
      setSheet(flash.colour);
      ctx.platform.interact({ type: hit ? "hit" : "pass" });
      ctx.timeout(() => { if (phase === "play") nextWord(); }, 340);
      current = null;
    }

    /* --- taps are always live, tilt or no tilt --- */
    ctx.listen(stage, "pointerdown", (e) => {
      if (phase !== "play") return;
      answer(e.offsetX > ctx.width / 2);
      e.preventDefault();
    }, { passive: false });

    /* ---------------------------------------------------------------
     * End of round
     * ------------------------------------------------------------- */
    async function finish() {
      phase = "over";
      setSheet("#12131f");
      const hits = results.filter((r) => r.hit).length;
      stage.innerHTML =
        '<div style="flex:1;display:flex;flex-direction:column;gap:9px;overflow-y:auto;">' +
          '<div style="text-align:center;font-size:11px;letter-spacing:0.3em;text-transform:lowercase;' +
            'opacity:0.5;">Time</div>' +
          '<div style="text-align:center;font-size:78px;font-weight:900;line-height:1;color:' +
            deckOf().hue + ';">' + hits + '</div>' +
          '<div style="text-align:center;font-size:14px;opacity:0.6;margin-bottom:8px;">' +
            (hits === 1 ? "one right" : hits + " right") + ' out of ' + results.length + '</div>' +
          (results.length
            ? results.map((r) =>
              '<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;' +
                'padding:11px 14px;border-radius:13px;background:rgba(255,255,255,0.06);">' +
                '<span style="font-size:15.5px;font-weight:600;' +
                  (r.hit ? '' : 'opacity:0.62;text-decoration:line-through;') + '">' + esc(r.word) + '</span>' +
                '<span style="font-size:15px;flex:none;">' + (r.hit ? "✅" : "⏭️") + '</span>' +
              '</div>').join("")
            : '<div style="text-align:center;opacity:0.5;font-size:14px;">No cards played.</div>') +
          '<button data-el="again" style="' + BIG + 'margin-top:14px;flex:none;background:' +
            deckOf().hue + ';color:#12101c;">Next player</button>' +
          '<button data-el="home" style="' + BIG + 'flex:none;background:rgba(255,255,255,0.12);' +
            'color:#fff;">Change deck</button>' +
        '</div>';
      tap(el("again"), begin);
      tap(el("home"), renderSetup);

      sound.duck(0.5, 420);
      sound.sting(hits > 0 ? "win" : "lose");
      sound.haptic("success");
      ctx.platform.setScore(hits);
      ctx.platform.complete({ hits, played: results.length, deck: settings.deck });
      // How many the room got through in one round — a property of the round,
      // not of whoever happened to be holding the phone.
      try { await ctx.memory.record("round_score").submit(hits, { label: hits + " cards" }); }
      catch (_) {}
    }

    /* ---------------------------------------------------------------
     * Frame
     * ------------------------------------------------------------- */
    ctx.onFrame((dtMs) => {
      const dt = Math.min(dtMs, 50) / 1000;

      if (phase === "count") {
        const remain = (countEndsAt - performance.now()) / 1000;
        const node = el("cd");
        if (node) node.textContent = remain > 0 ? String(Math.ceil(remain)) : "GO";
        if (remain <= -0.35) {
          phase = "play";
          roundEndsAt = performance.now() + settings.seconds * 1000;
          sound.sting("powerup");
          nextWord();
        }
        return;
      }

      if (phase !== "play") return;

      if (flash) {
        flash.t -= dt;
        if (flash.t <= 0) { flash = null; setSheet(deckOf().hue); }
      }

      left = (roundEndsAt - performance.now()) / 1000;
      paintClock();
      // The bed speeds up over the last ten seconds, so the room hears the
      // clock running out without anybody having to look at it.
      if (left < 10) sound.tempo(128 + (10 - left) * 5);
      if (left <= 0) { sound.duck(0.4, 300); return finish(); }

      const t = tilt.read();
      if (t && current) answer(t === "correct");
    });

    /* --- boot --- */
    // A read-only window for the local harness.
    window.__FOREHEAD__ = {
      get phase() { return phase; },
      get word() { return current; },
      get left() { return left; },
      get results() { return results.slice(); },
      get tiltAvailable() { return tilt.available; },
    };
    ctx.onDestroy(() => { try { delete window.__FOREHEAD__; } catch (_) {} });

    renderSetup();
    ctx.markVisualReady("title up");
    ctx.platform.ready();
  },
};
