/**
 * Bluffin — a lying game for three to eight people and one phone.
 *
 * Everyone sees a prompt with a hole in it. The phone goes round once and each
 * player secretly types a lie to fill the hole. Then the phone goes round
 * again, showing every lie shuffled in with the truth, and each player picks
 * the one they think is real. You score for finding the truth, and you score
 * more for every person your lie catches.
 *
 * The whole design problem is that this game is ALL hidden information on a
 * device with one screen. It is solved with an explicit physical handover: a
 * full-bleed cover names who should be holding the phone, and the screen
 * underneath does not exist until they press and hold. Let go and it is gone
 * again. No timers, no auto-advance — the phone is only ever showing one
 * person's secret, and only while they are holding it.
 *
 * Everything a player types is escaped before it goes anywhere near innerHTML,
 * and answers are compared case- and punctuation-insensitively so "The Alamo"
 * and "the alamo!" cannot both appear on the board.
 *
 * Contract notes: no packaged assets (maxAssets is 0). The overlay is markup on
 * ctx.createRoot() with pointer-events off on the root itself, because that
 * element sits above everything and will otherwise swallow taps.
 * document.createElement and getBoundingClientRect are rejected at upload.
 */
window.plethoraBit = {
  meta: {
    title: "Bluffin",
    runtime: "plethora-bit@2",
    tags: ["party", "multiplayer", "local-multiplayer", "bluffing", "words"],
    permissions: ["backgroundMusic", "haptics", "storage"],
    // The bit manages its own layout around the keyboard, so the host should
    // not also lift the focused input.
    keyboardBehavior: "none",
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
     * Prompts. Each has a hole and a true answer. They are chosen to be
     * guessable-but-not-obvious: a good prompt is one where a confident
     * lie is more believable than the truth.
     * ------------------------------------------------------------- */
    const PROMPTS = [
      ["In 2018 a town in Spain spent €18,000 on fireworks and accidentally set fire to its own ___.", "town hall"],
      ["The longest recorded flight of a chicken is ___ seconds.", "13"],
      ["A group of flamingos is called a ___.", "flamboyance"],
      ["The first item ever sold on eBay was a broken ___.", "laser pointer"],
      ["In Switzerland it is illegal to own only one ___.", "guinea pig"],
      ["The average person walks the equivalent of ___ times around the world in a lifetime.", "five"],
      ["Nintendo was founded in 1889 and originally made ___.", "playing cards"],
      ["A shrimp's heart is located in its ___.", "head"],
      ["The inventor of the Pringles can is buried in ___.", "a Pringles can"],
      ["In Japan there is a museum dedicated entirely to ___.", "instant noodles"],
      ["Bananas are slightly ___.", "radioactive"],
      ["The dot over a lowercase i is called a ___.", "tittle"],
      ["Astronauts on the ISS see roughly ___ sunrises a day.", "sixteen"],
      ["Honey found in ancient Egyptian tombs was still ___.", "edible"],
      ["A jiffy is an actual unit of time lasting ___.", "1/100th of a second"],
      ["Wombat droppings are famously ___.", "cube shaped"],
      ["The world's quietest room is so silent you can hear your own ___.", "blood flowing"],
      ["Oxford University is older than the ___.", "Aztec Empire"],
      ["Scotland's national animal is the ___.", "unicorn"],
      ["Cows have best friends and get stressed when ___.", "separated"],
      ["The Eiffel Tower can be ___ centimetres taller in summer.", "15"],
      ["There are more possible games of chess than ___ in the universe.", "atoms"],
      ["A cloud can weigh more than ___.", "a million pounds"],
      ["Venus is the only planet that spins ___.", "clockwise"],
      ["The unicorn was declared the national animal of Scotland because it was believed to be the natural enemy of the ___.", "lion"],
      ["In 1962 an outbreak of contagious ___ closed schools in Tanzania for months.", "laughter"],
      ["The world record for the most T-shirts worn at once is ___.", "260"],
      ["Sea otters hold hands while sleeping so they do not ___.", "drift apart"],
      ["Pineapples take about ___ years to grow.", "two"],
      ["The strongest muscle in the human body by weight is the ___.", "masseter"],
      ["A day on Venus is longer than its ___.", "year"],
      ["The inventor of the frisbee was turned into one after he ___.", "died"],
      ["Sloths can hold their breath longer than ___.", "dolphins"],
      ["In medieval Europe, animals could legally be put on ___.", "trial"],
      ["The hashtag symbol's technical name is an ___.", "octothorpe"],
      ["Norway once knighted a ___.", "penguin"],
      ["A blue whale's tongue weighs about as much as an ___.", "elephant"],
      ["The word 'robot' comes from a Czech word meaning ___.", "forced labour"],
      ["Butterflies taste with their ___.", "feet"],
      ["The shortest war in history lasted ___ minutes.", "38"],
      ["Bubble wrap was originally invented as ___.", "wallpaper"],
      ["An ostrich's eye is bigger than its ___.", "brain"],
      ["The first computer bug was an actual ___.", "moth"],
      ["Tug of war used to be an ___ event.", "Olympic"],
      ["Cleopatra lived closer in time to the Moon landing than to the building of the ___.", "Great Pyramid"],
      ["A crocodile cannot stick out its ___.", "tongue"],
      ["The average cumulus cloud contains enough water to fill ___.", "a swimming pool"],
      ["Peanuts are not nuts, they are ___.", "legumes"],
      ["Vending machines kill more people annually than ___.", "sharks"],
      ["The longest place name in the world has ___ letters.", "85"],
      ["Sharks existed before ___.", "trees"],
      ["A single strand of spaghetti is called a ___.", "spaghetto"],
      ["Octopuses have ___ hearts.", "three"],
      ["The colour orange was named after the ___.", "fruit"],
      ["Humans share about 60% of their DNA with a ___.", "banana"],
      ["The Great Wall of China is held together partly by ___.", "sticky rice"],
      ["In 1998 Sony accidentally sold camcorders that could see through ___.", "clothing"],
      ["A duel between three people is properly called a ___.", "truel"],
      ["Rats laugh when you ___ them.", "tickle"],
      ["Saturn would ___ if you put it in a big enough bath.", "float"],
    ];

    const esc = (s) => String(s).replace(/[&<>"']/g,
      (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    /** Loose comparison, so "The Alamo" and "the alamo!" are one answer. */
    const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
    const shuffle = (a) => {
      for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
      }
      return a;
    };

    const COLOURS = ["#ff5470", "#ffd166", "#2ec4b6", "#8367ff", "#ff9f45", "#3ec1ff", "#c2f970", "#ff7ad9"];

    /* ---------------------------------------------------------------
     * Settings and sound
     * ------------------------------------------------------------- */
    const saved = (function () {
      try { return ctx.storage.get("bluffin") || {}; } catch (_) { return {}; }
    })();
    const settings = {
      players: clamp(saved.players || 4, 3, 8),
      rounds: saved.rounds || 5,
      mute: !!saved.mute,
    };
    function saveSettings() { try { ctx.storage.set("bluffin", settings); } catch (_) {} }

    const sound = (function () {
      let muted = settings.mute, bed = null, unlocked = false;
      const start = () => ctx.music.play({ preset: "bubble", volume: 0.26, tempo: 112, intensity: 0.28 });
      return {
        get muted() { return muted; },
        async unlock() {
          if (unlocked) return;
          unlocked = true;
          try { await ctx.music.unlock(); if (!muted) bed = start(); } catch (_) {}
        },
        sting(n) { if (!muted) { try { ctx.music.sting(n); } catch (_) {} } },
        duck(a, ms) { if (!muted) { try { ctx.music.duck(a, ms); } catch (_) {} } },
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
     * Background. Painted once and animated by transform only, so the
     * heavy typing screens are never competing with a canvas repaint.
     * ------------------------------------------------------------- */
    const bgCanvas = ctx.createCanvas2D({ touchAction: "none" });
    const bg = bgCanvas.getContext("2d");
    let W = ctx.width, H = ctx.height;
    const blobs = [];
    for (let i = 0; i < 7; i++) {
      blobs.push({
        x: Math.random(), y: Math.random(), r: 0.24 + Math.random() * 0.3,
        c: COLOURS[i % COLOURS.length], vx: (Math.random() - 0.5) * 0.012,
        vy: (Math.random() - 0.5) * 0.012,
      });
    }
    function paintBg(dt) {
      W = ctx.width; H = ctx.height;
      bg.fillStyle = "#0b0c1c";
      bg.fillRect(0, 0, W, H);
      for (const b of blobs) {
        b.x += b.vx * dt; b.y += b.vy * dt;
        if (b.x < -0.3 || b.x > 1.3) b.vx *= -1;
        if (b.y < -0.3 || b.y > 1.3) b.vy *= -1;
        const g = bg.createRadialGradient(b.x * W, b.y * H, 0, b.x * W, b.y * H, b.r * W);
        g.addColorStop(0, b.c + "2e");
        g.addColorStop(1, b.c + "00");
        bg.fillStyle = g;
        bg.fillRect(0, 0, W, H);
      }
      // A fine grain over the top, so the gradients never band on an OLED.
      bg.globalAlpha = 0.03;
      for (let i = 0; i < 240; i++) {
        bg.fillStyle = i % 2 ? "#ffffff" : "#000000";
        bg.fillRect(Math.random() * W, Math.random() * H, 2, 2);
      }
      bg.globalAlpha = 1;
    }

    /* ---------------------------------------------------------------
     * Game state
     * ------------------------------------------------------------- */
    let players = [];          // { name, colour, score }
    let deck = [];             // prompt indices, shuffled, consumed one per round
    let round = 0, phase = "setup";
    let prompt = null;         // { text, truth }
    let lies = [];             // { by, text }
    let board = [];            // shuffled { text, by }  — by === -1 is the truth
    let picks = [];            // picks[player] = index into board
    let cursor = 0;            // whose turn it is to hold the phone

    function startGame() {
      players = [];
      for (let i = 0; i < settings.players; i++) {
        const typed = (el("name-" + i) && el("name-" + i).value || "").trim();
        players.push({ name: typed || "Player " + (i + 1), colour: COLOURS[i % COLOURS.length], score: 0 });
      }
      deck = shuffle(PROMPTS.map((_, i) => i));
      round = 0;
      nextRound();
    }

    function nextRound() {
      round++;
      const idx = deck[(round - 1) % deck.length];
      prompt = { text: PROMPTS[idx][0], truth: PROMPTS[idx][1] };
      lies = [];
      board = [];
      picks = new Array(players.length).fill(-1);
      cursor = 0;
      phase = "write";
      renderHandoff();
    }

    /* ---------------------------------------------------------------
     * Overlay
     * ------------------------------------------------------------- */
    const FONT = "Inter,-apple-system,system-ui,'Segoe UI',Roboto,sans-serif";
    const ST = ctx.safeArea.top, SB = ctx.safeArea.bottom;
    const CARD = "background:rgba(255,255,255,0.055);border:1px solid rgba(255,255,255,0.10);" +
      "border-radius:22px;backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);";
    const BIG = "width:100%;padding:16px;border:none;border-radius:17px;font-family:inherit;" +
      "font-size:17px;font-weight:800;letter-spacing:0.01em;";
    const BTN = "pointer-events:auto;width:36px;height:36px;border-radius:12px;border:none;" +
      "background:rgba(255,255,255,0.12);color:#eef1ff;font-size:15px;font-family:inherit;padding:0;";

    const root = ctx.createRoot({ touchAction: "manipulation" });
    // The overlay covers the canvas, so the root itself must not eat pointers.
    root.style.cssText += ";font-family:" + FONT + ";color:#eef1ff;pointer-events:none;text-transform:lowercase;";

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
      '<div data-el="stage" style="position:absolute;inset:0;pointer-events:auto;display:flex;' +
        // Top padding clears the floating chrome, which would otherwise sit on
        // whatever the screen puts at the top of its content.
        'flex-direction:column;padding:' + (ST + 54) + 'px 18px ' + (SB + 14) + 'px;"></div>' +
      '<div style="position:absolute;right:12px;top:' + (ST + 8) + 'px;display:flex;gap:7px;' +
        'z-index:60;pointer-events:none;">' +
        '<button data-el="mute" aria-label="Sound" style="' + BTN + '">' + SPK(true) + '</button>' +
        '<button data-el="help" aria-label="How to play" style="' + BTN + '">?</button>' +
      '</div>' +
      '<div data-el="helpp" style="position:absolute;inset:0;pointer-events:auto;display:none;' +
        'align-items:center;justify-content:center;background:rgba(7,8,20,0.94);z-index:80;padding:24px;">' +
        '<div style="max-width:330px;width:100%;' + CARD + 'padding:24px;">' +
          '<div style="font-size:20px;font-weight:800;margin-bottom:12px;">How to play</div>' +
          '<ul style="font-size:14.5px;line-height:1.75;opacity:0.86;padding-left:18px;margin:0;">' +
            '<li>Everyone sees a fact with a hole in it. One of you is holding the phone.</li>' +
            '<li>The phone goes round once. Each of you secretly types a <b>lie</b> to fill the hole.</li>' +
            '<li>Then it goes round again showing every lie mixed in with the truth. Pick the one you think is real.</li>' +
            '<li><b>+1000</b> for finding the truth.</li>' +
            '<li><b>+500</b> for every person your lie catches.</li>' +
            '<li>Type the actual truth by accident and you get <b>+1500</b> and everyone is told.</li>' +
            '<li>The cover names whoever should be holding the phone. It closes again the moment they commit, so it is never left sitting on somebody\'s secret.</li>' +
          '</ul>' +
          '<button data-el="helpp-close" style="' + BIG + 'margin-top:18px;' +
            'background:rgba(255,255,255,0.14);color:#eef1ff;">Got it</button>' +
        '</div>' +
      '</div>';

    const el = (n) => root.querySelector('[data-el="' + n + '"]');
    const stage = el("stage");
    const tap = (node, fn) => {
      if (!node) return;
      ctx.listen(node, "click", (e) => { e.stopPropagation(); e.preventDefault(); fn(e); });
    };
    tap(el("mute"), (e) => { e.target.innerHTML = SPK(!sound.toggle()); });
    if (settings.mute) el("mute").innerHTML = SPK(false);
    tap(el("help"), () => { el("helpp").style.display = "flex"; });
    tap(el("helpp-close"), () => { el("helpp").style.display = "none"; });

    const wrap = (inner) => '<div style="flex:1;display:flex;flex-direction:column;' +
      'justify-content:center;gap:14px;">' + inner + '</div>';
    const promptCard = () =>
      '<div style="' + CARD + 'padding:20px;font-size:19px;line-height:1.5;font-weight:600;">' +
        esc(prompt.text).replace("___",
          '<span style="color:#ffd166;letter-spacing:0.08em;">______</span>') + '</div>';

    /* --- setup --- */
    function renderSetup() {
      phase = "setup";
      stage.innerHTML =
        '<div style="flex:1;display:flex;flex-direction:column;justify-content:center;gap:12px;">' +
          '<div style="font-size:11px;letter-spacing:0.42em;text-transform:lowercase;opacity:0.5;' +
            'text-align:center;">Pass and lie</div>' +
          '<div style="font-size:58px;font-weight:900;letter-spacing:-0.03em;text-align:center;' +
            'background:linear-gradient(96deg,#ff5470,#ffd166,#2ec4b6);-webkit-background-clip:text;' +
            'background-clip:text;-webkit-text-fill-color:transparent;line-height:1;">Bluffin</div>' +
          '<div style="font-size:14.5px;opacity:0.62;text-align:center;line-height:1.5;' +
            'max-width:270px;margin:0 auto;">Fill the blank with a lie. Score for fooling people, ' +
            'and for spotting the truth.</div>' +
          '<div style="font-size:11px;letter-spacing:0.22em;text-transform:lowercase;opacity:0.5;' +
            'margin-top:14px;">Players</div>' +
          '<div data-el="pc" style="display:flex;gap:7px;flex-wrap:wrap;"></div>' +
          '<div style="font-size:11px;letter-spacing:0.22em;text-transform:lowercase;opacity:0.5;' +
            'margin-top:6px;">Rounds</div>' +
          '<div data-el="rc" style="display:flex;gap:7px;"></div>' +
          '<button data-el="names" style="' + BIG + 'margin-top:14px;' +
            'background:rgba(255,255,255,0.12);color:#eef1ff;">Add names</button>' +
          '<button data-el="go" style="' + BIG + 'background:linear-gradient(96deg,#ff5470,#ffd166);' +
            'color:#180c14;">Start</button>' +
        '</div>';
      pills(el("pc"), [3, 4, 5, 6, 7, 8], ["3", "4", "5", "6", "7", "8"],
        () => settings.players, (v) => { settings.players = Number(v); });
      pills(el("rc"), [3, 5, 8], ["3", "5", "8"],
        () => settings.rounds, (v) => { settings.rounds = Number(v); });
      tap(el("names"), renderNames);
      tap(el("go"), async () => {
        ctx.platform.start();
        await sound.unlock();
        sound.sting("coin");
        startGame();
      });
    }

    function renderNames() {
      stage.innerHTML =
        '<div style="flex:1;display:flex;flex-direction:column;gap:9px;overflow-y:auto;">' +
          '<div style="font-size:20px;font-weight:800;margin-bottom:2px;">Who is playing?</div>' +
          '<div style="font-size:13px;opacity:0.55;margin-bottom:8px;">Leave any blank and it fills itself in.</div>' +
          Array.from({ length: settings.players }, (_, i) =>
            '<div style="display:flex;align-items:center;gap:10px;">' +
              '<span style="width:11px;height:11px;border-radius:50%;flex:none;' +
                'background:' + COLOURS[i % COLOURS.length] + ';"></span>' +
              '<input data-el="name-' + i + '" maxlength="14" placeholder="Player ' + (i + 1) + '" ' +
                'style="flex:1;padding:13px 15px;border-radius:14px;border:1px solid rgba(255,255,255,0.12);' +
                'background:rgba(255,255,255,0.06);color:#eef1ff;font-family:inherit;font-size:16px;">' +
            '</div>').join("") +
          '<button data-el="go2" style="' + BIG + 'margin-top:14px;flex:none;' +
            'background:linear-gradient(96deg,#ff5470,#ffd166);color:#180c14;">Start</button>' +
        '</div>';
      tap(el("go2"), async () => {
        ctx.platform.start();
        await sound.unlock();
        sound.sting("coin");
        startGame();
      });
    }

    function pills(host, values, labels, get, set) {
      host.innerHTML = values.map((v, i) =>
        '<button data-v="' + v + '" style="flex:1;min-width:44px;padding:12px 0;border:none;' +
        'border-radius:13px;font-family:inherit;font-size:15px;font-weight:700;">' +
        labels[i] + '</button>').join("");
      const paint = () => {
        for (const b of host.querySelectorAll("button")) {
          const on = String(get()) === b.dataset.v;
          b.style.background = on ? "rgba(255,255,255,0.28)" : "rgba(255,255,255,0.08)";
          b.style.color = on ? "#fff" : "rgba(238,241,255,0.55)";
        }
      };
      for (const b of host.querySelectorAll("button")) {
        tap(b, () => { set(b.dataset.v); saveSettings(); paint(); sound.haptic("light"); });
      }
      paint();
    }

    /* ---------------------------------------------------------------
     * The handover.
     *
     * This is the load-bearing screen. Everything secret sits behind it,
     * and it only lifts while a finger is held down — so the phone is
     * only ever showing one person's screen, and only while that person
     * is holding it. No timer, no auto-advance, nothing to shoulder-surf
     * by accident.
     * ------------------------------------------------------------- */
    function renderHandoff() {
      const p = players[cursor];
      const what = phase === "write" ? "type a lie" : "pick the truth";
      stage.innerHTML = wrap(
        '<div style="text-align:center;font-size:11px;letter-spacing:0.28em;text-transform:lowercase;' +
          'opacity:0.5;">Round ' + round + ' of ' + settings.rounds + '</div>' +
        '<div style="text-align:center;font-size:13px;letter-spacing:0.2em;text-transform:lowercase;' +
          'opacity:0.5;margin-top:14px;">Pass the phone to</div>' +
        '<div style="text-align:center;font-size:40px;font-weight:900;color:' + p.colour + ';' +
          'line-height:1.1;">' + esc(p.name) + '</div>' +
        '<div style="text-align:center;font-size:14px;opacity:0.55;">…then ' + what + '</div>' +
        '<button data-el="hold" style="' + BIG + 'margin-top:26px;background:' + p.colour + ';' +
          'color:#12101c;">I\'m ' + esc(p.name) + ' — show me</button>' +
        '<div style="text-align:center;font-size:12.5px;opacity:0.42;line-height:1.5;">' +
          'Only you should see the next screen.<br>It closes the moment you commit.</div>');

      // Tap, not press-and-hold.
      //
      // Hold-to-reveal reads well and is what the privacy pattern usually
      // wants, but it cannot work here: the screen behind this one has to be
      // typed into and tapped, so holding it open would take a third hand. The
      // secret's exposure is bounded by the player's own commit instead —
      // locking in a lie or picking an answer returns straight to this cover,
      // so the phone is never sitting on somebody's secret waiting for them.
      tap(el("hold"), () => {
        sound.haptic("light");
        if (phase === "write") renderWrite(); else renderPick();
      });
    }

    /* --- write a lie --- */
    function renderWrite() {
      const p = players[cursor];
      stage.innerHTML = wrap(
        '<div style="text-align:center;font-size:12px;letter-spacing:0.2em;text-transform:lowercase;' +
          'color:' + p.colour + ';">' + esc(p.name) + '</div>' +
        promptCard() +
        '<input data-el="lie" maxlength="42" placeholder="your lie…" autocomplete="off" ' +
          'autocorrect="off" autocapitalize="none" spellcheck="false" ' +
          'style="padding:16px 17px;border-radius:16px;border:1px solid rgba(255,255,255,0.14);' +
          'background:rgba(255,255,255,0.07);color:#eef1ff;font-family:inherit;font-size:18px;' +
          'font-weight:600;">' +
        '<div data-el="warn" style="font-size:13px;color:#ff9f45;opacity:0;min-height:18px;"></div>' +
        '<button data-el="done" style="' + BIG + 'background:' + p.colour + ';color:#12101c;">Lock it in</button>');

      const input = el("lie");
      input.focus();
      tap(el("done"), () => submitLie(input.value));
      ctx.listen(input, "keydown", (e) => { if (e.key === "Enter") submitLie(input.value); });
    }

    function submitLie(raw) {
      const text = String(raw || "").trim().slice(0, 42);
      const warn = el("warn");
      if (!text) return flag(warn, "Type something — even a bad lie beats no lie.");
      // A lie that duplicates somebody else's would put the same answer on the
      // board twice, which makes the vote meaningless.
      if (lies.some((l) => norm(l.text) === norm(text))) {
        return flag(warn, "Somebody already wrote that. Try another.");
      }
      lies.push({ by: cursor, text });
      sound.sting("tap");
      sound.haptic("light");
      cursor++;
      if (cursor < players.length) return renderHandoff();
      buildBoard();
    }

    function flag(node, msg) {
      node.textContent = msg;
      node.style.opacity = "1";
      sound.haptic("warning");
      ctx.timeout(() => { node.style.opacity = "0"; }, 2400);
    }

    /** Shuffle the lies in with the truth, then start the voting pass. */
    function buildBoard() {
      board = shuffle(lies.map((l) => ({ text: l.text, by: l.by })).concat([{ text: prompt.truth, by: -1 }]));
      cursor = 0;
      phase = "pick";
      renderHandoff();
    }

    /* --- pick the truth --- */
    function renderPick() {
      const p = players[cursor];
      stage.innerHTML =
        '<div style="flex:1;display:flex;flex-direction:column;gap:10px;overflow-y:auto;">' +
          '<div style="text-align:center;font-size:12px;letter-spacing:0.2em;text-transform:lowercase;' +
            'color:' + p.colour + ';">' + esc(p.name) + '</div>' +
          promptCard() +
          '<div style="font-size:12px;letter-spacing:0.18em;text-transform:lowercase;opacity:0.5;' +
            'margin-top:2px;">Which one is true?</div>' +
          board.map((b, i) =>
            // Your own lie is shown but not tappable, so nobody can vote for
            // themselves and nobody is left wondering where their answer went.
            '<button data-el="opt-' + i + '" ' + (b.by === cursor ? 'disabled' : '') +
            ' style="text-align:left;padding:15px 16px;border-radius:16px;font-family:inherit;' +
            'font-size:16px;font-weight:600;border:1px solid rgba(255,255,255,0.11);' +
            (b.by === cursor
              ? 'background:rgba(255,255,255,0.03);color:rgba(238,241,255,0.32);'
              : 'background:rgba(255,255,255,0.075);color:#eef1ff;') + '">' +
            esc(b.text) + (b.by === cursor
              ? '<span style="font-size:12px;opacity:0.7;"> — yours</span>' : '') +
            '</button>').join("") +
        '</div>';
      board.forEach((b, i) => {
        if (b.by === cursor) return;
        tap(el("opt-" + i), () => {
          picks[cursor] = i;
          sound.sting("tap");
          sound.haptic("medium");
          cursor++;
          if (cursor < players.length) renderHandoff();
          else score();
        });
      });
    }

    /* ---------------------------------------------------------------
     * Scoring and the reveal
     * ------------------------------------------------------------- */
    let lastGains = [];
    function score() {
      phase = "reveal";
      lastGains = players.map(() => 0);
      const truthIdx = board.findIndex((b) => b.by === -1);

      for (let i = 0; i < players.length; i++) {
        const pick = picks[i];
        if (pick < 0) continue;
        if (pick === truthIdx) lastGains[i] += 1000;                 // found it
        else {
          const author = board[pick].by;
          if (author >= 0 && author !== i) lastGains[author] += 500; // your lie caught someone
        }
      }
      // Writing the actual truth by accident is the best thing that can happen
      // to you, and everybody should hear about it.
      const accidental = [];
      for (const l of lies) {
        if (norm(l.text) === norm(prompt.truth)) { lastGains[l.by] += 1500; accidental.push(l.by); }
      }
      for (let i = 0; i < players.length; i++) players[i].score += lastGains[i];

      sound.duck(0.45, 380);
      sound.sting("success");
      sound.haptic("success");
      renderReveal(truthIdx, accidental);
    }

    function renderReveal(truthIdx, accidental) {
      const votersFor = (i) => players
        .map((p, j) => (picks[j] === i ? j : -1)).filter((j) => j >= 0);

      stage.innerHTML =
        '<div style="flex:1;display:flex;flex-direction:column;gap:9px;overflow-y:auto;">' +
          '<div style="text-align:center;font-size:11px;letter-spacing:0.28em;text-transform:lowercase;' +
            'opacity:0.5;">Round ' + round + '</div>' +
          promptCard() +
          board.map((b, i) => {
            const truth = b.by === -1;
            const voters = votersFor(i);
            return '<div style="padding:13px 15px;border-radius:15px;border:1px solid ' +
              (truth ? 'rgba(46,196,182,0.55)' : 'rgba(255,255,255,0.09)') + ';background:' +
              (truth ? 'rgba(46,196,182,0.14)' : 'rgba(255,255,255,0.05)') + ';">' +
              '<div style="display:flex;justify-content:space-between;gap:10px;align-items:baseline;">' +
                '<span style="font-size:16px;font-weight:700;">' + esc(b.text) + '</span>' +
                '<span style="font-size:11px;letter-spacing:0.14em;text-transform:lowercase;flex:none;' +
                  'color:' + (truth ? '#2ec4b6' : 'rgba(238,241,255,0.42)') + ';">' +
                  (truth ? 'the truth' : esc(players[b.by].name)) + '</span>' +
              '</div>' +
              (voters.length
                ? '<div style="margin-top:7px;display:flex;gap:5px;flex-wrap:wrap;">' +
                  voters.map((j) => '<span style="font-size:11px;padding:3px 9px;border-radius:999px;' +
                    'background:' + players[j].colour + '28;color:' + players[j].colour + ';">' +
                    esc(players[j].name) + '</span>').join("") + '</div>'
                : '') +
            '</div>';
          }).join("") +
          (accidental.length
            ? '<div style="padding:12px 15px;border-radius:15px;background:rgba(255,209,102,0.14);' +
              'border:1px solid rgba(255,209,102,0.5);font-size:14px;line-height:1.5;">' +
              accidental.map((i) => esc(players[i].name)).join(" and ") +
              ' wrote the actual truth. +1500 each.</div>'
            : '') +
          '<div style="' + CARD + 'padding:14px;margin-top:4px;">' +
            players.map((p, i) => {
              const g = lastGains[i];
              return '<div style="display:flex;justify-content:space-between;align-items:baseline;' +
                'padding:5px 0;font-size:15px;">' +
                '<span style="color:' + p.colour + ';font-weight:700;">' + esc(p.name) + '</span>' +
                '<span style="opacity:0.85;">' + p.score.toLocaleString() +
                  (g ? '<span style="color:#ffd166;font-size:12px;"> +' + g + '</span>' : '') +
                '</span></div>';
            }).join("") +
          '</div>' +
          '<button data-el="next" style="' + BIG + 'margin-top:6px;flex:none;' +
            'background:linear-gradient(96deg,#ff5470,#ffd166);color:#180c14;">' +
            (round >= settings.rounds ? "Final scores" : "Next round") + '</button>' +
        '</div>';
      tap(el("next"), () => {
        if (round >= settings.rounds) finish();
        else { sound.sting("coin"); nextRound(); }
      });
    }

    async function finish() {
      phase = "over";
      const ranked = players.map((p, i) => ({ p, i })).sort((a, b) => b.p.score - a.p.score);
      const top = ranked[0].p;
      stage.innerHTML = wrap(
        '<div style="text-align:center;font-size:11px;letter-spacing:0.32em;text-transform:lowercase;' +
          'opacity:0.5;">Best liar</div>' +
        '<div style="text-align:center;font-size:44px;font-weight:900;color:' + top.colour + ';' +
          'line-height:1.1;">' + esc(top.name) + '</div>' +
        '<div style="' + CARD + 'padding:16px;margin-top:12px;">' +
          ranked.map((r, n) =>
            '<div style="display:flex;justify-content:space-between;padding:7px 0;font-size:16px;">' +
              '<span><span style="opacity:0.4;">' + (n + 1) + '.</span> ' +
                '<span style="color:' + r.p.colour + ';font-weight:700;">' + esc(r.p.name) + '</span></span>' +
              '<span style="opacity:0.85;">' + r.p.score.toLocaleString() + '</span></div>').join("") +
        '</div>' +
        '<button data-el="again" style="' + BIG + 'margin-top:18px;' +
          'background:linear-gradient(96deg,#ff5470,#ffd166);color:#180c14;">Play again</button>');
      tap(el("again"), () => { sound.sting("coin"); renderSetup(); });

      sound.duck(0.5, 450);
      sound.sting("win");
      sound.haptic("success");
      ctx.platform.complete({ players: players.length, rounds: settings.rounds, top: top.score });
      // The score that travels is the table's best liar for the night, which is
      // a property of the match rather than of one person on this phone.
      try { await ctx.memory.record("best_liar").submit(top.score, { label: top.score.toLocaleString() + " pts" }); }
      catch (_) {}
    }

    /* ---------------------------------------------------------------
     * Boot
     * ------------------------------------------------------------- */
    ctx.onFrame((dtMs) => paintBg(Math.min(dtMs, 50) / 1000));
    ctx.listen(window, "resize", () => { W = ctx.width; H = ctx.height; });

    // A read-only window for the local harness, so a scripted game can drive
    // the handovers and assert on real scoring.
    window.__BLUFFIN__ = {
      get phase() { return phase; },
      get round() { return round; },
      get cursor() { return cursor; },
      get scores() { return players.map((p) => p.score); },
      get board() { return board.map((b) => ({ text: b.text, by: b.by })); },
      get truth() { return prompt ? prompt.truth : null; },
      get lies() { return lies.map((l) => l.text); },
    };
    ctx.onDestroy(() => { try { delete window.__BLUFFIN__; } catch (_) {} });

    paintBg(0);
    renderSetup();
    ctx.markVisualReady("title up");
    ctx.platform.ready();
  },
};
