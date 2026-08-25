/* =====================================================================
 * PLETHORA LOCAL-MULTIPLAYER KIT  —  source template, not a module.
 *
 * Bits must ship as ONE self-contained main.js, so there is nothing to
 * import: paste the sections a bit needs inside its init() and delete the
 * rest. This file is the canonical copy so a fix lands everywhere.
 *
 * Every helper here is written against the three constructs that get a
 * draft rejected at upload and are documented nowhere in sdk.md:
 *   - no document.createElement  -> markup goes on ctx.createRoot()
 *   - no getBoundingClientRect() -> pointer maths uses offsetX/offsetY
 *   - no canvas ctx.filter blur  -> soft edges are concentric strokes
 * ===================================================================== */

/* ---------------------------------------------------------------------
 * SHELL — the DOM overlay.
 *
 * Bits may not reach into the host DOM, so the whole overlay is declared
 * as one markup string on the runtime-owned root and the handles are
 * queried back out by [data-el]. That is the pattern the SDK's own
 * examples use and the only one that survives validation.
 * ------------------------------------------------------------------- */
function makeShell(ctx, markup, opts = {}) {
  const root = ctx.createRoot({ touchAction: opts.touchAction || "none" });
  root.innerHTML = markup;
  const el = (name) => root.querySelector(`[data-el="${name}"]`);
  const all = (name) => [...root.querySelectorAll(`[data-el="${name}"]`)];
  // Taps on overlay chrome must never fall through to the play surface
  // underneath — on a shared phone that is somebody else's turn being stolen.
  const onTap = (node, fn) => {
    if (!node) return;
    ctx.listen(node, "pointerdown", (e) => e.stopPropagation());
    ctx.listen(node, "click", (e) => { e.stopPropagation(); e.preventDefault(); fn(e); });
  };
  return { root, el, all, onTap };
}

/** Escape anything player-authored before it goes near innerHTML. */
const esc = (s) => String(s).replace(/[&<>"']/g,
  (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/* ---------------------------------------------------------------------
 * SEATS — where each player physically sits around the phone.
 *
 * A phone flat on a table has people on all four edges. Text and buttons
 * that read right-way-up for one player are upside-down for the player
 * opposite, so each seat carries the rotation its owner needs. `deg` is
 * for CSS transforms, `rad` for canvas.
 * ------------------------------------------------------------------- */
const SEATS = {
  bottom: { deg: 0,   rad: 0,             anchor: "bottom" },
  top:    { deg: 180, rad: Math.PI,       anchor: "top"    },
  left:   { deg: 90,  rad: Math.PI / 2,   anchor: "left"   },
  right:  { deg: 270, rad: -Math.PI / 2,  anchor: "right"  },
};
/** Seat layout for N players so nobody reaches across somebody else. */
function seatsFor(n) {
  return [["bottom"], ["bottom", "top"], ["bottom", "top", "left"],
          ["bottom", "top", "left", "right"]][Math.max(1, Math.min(4, n)) - 1];
}

/** Draw `fn` rotated about (cx,cy) so it reads right-way-up from `seat`. */
function atSeat(g, seat, cx, cy, fn) {
  g.save();
  g.translate(cx, cy);
  g.rotate(SEATS[seat].rad);
  fn(g);
  g.restore();
}

/* ---------------------------------------------------------------------
 * CANVAS PRIMITIVES
 * ------------------------------------------------------------------- */
function roundRect(g, x, y, w, h, r) {
  const k = Math.min(r, w / 2, h / 2);
  g.beginPath();
  g.moveTo(x + k, y);
  g.arcTo(x + w, y,     x + w, y + h, k);
  g.arcTo(x + w, y + h, x,     y + h, k);
  g.arcTo(x,     y + h, x,     y,     k);
  g.arcTo(x,     y,     x + w, y,     k);
  g.closePath();
}

/**
 * A soft shadow without the canvas blur filter.
 *
 * Writing ctx.filter = "blur(...)" is rejected at upload: the property also
 * accepts url(#…), so the validator reads any write to it as pulling in a
 * remote resource. Stacking wide translucent strokes gets the same falloff.
 */
function softShadow(g, pathFn, { spread = 18, alpha = 0.05, step = 2.5 } = {}) {
  g.save();
  g.lineJoin = "round";
  g.lineCap = "round";
  g.strokeStyle = `rgba(0,0,0,${alpha})`;
  for (let w = spread; w >= 2; w -= step) {
    g.lineWidth = w;
    pathFn(g);
    g.stroke();
  }
  g.restore();
}

/** Offscreen surface for baking sprites. Never document.createElement("canvas"). */
function makeSurface(w, h) {
  if (typeof OffscreenCanvas === "undefined") return null;   // older WebViews: draw live
  return new OffscreenCanvas(Math.max(1, Math.ceil(w)), Math.max(1, Math.ceil(h)));
}

/* ---------------------------------------------------------------------
 * POINTERS — canvas-relative coordinates without getBoundingClientRect.
 *
 * offsetX/offsetY are already relative to the target and skip the forced
 * reflow a rect read costs on every move.
 * ------------------------------------------------------------------- */
function pointerXY(e) { return { x: e.offsetX, y: e.offsetY }; }

/**
 * Track every finger separately.
 *
 * This is the whole game for local multiplayer: four people press at once
 * and each press must stay bound to its own player for its whole life. A
 * single {x,y} would let the last finger down overwrite the others.
 */
function makeTouchTracker(ctx, target, { onDown, onMove, onUp }) {
  const live = new Map();                       // pointerId -> arbitrary per-finger state
  ctx.listen(target, "pointerdown", (e) => {
    target.setPointerCapture && target.setPointerCapture(e.pointerId);
    const s = onDown ? onDown(pointerXY(e), e.pointerId, e) : {};
    if (s !== null && s !== undefined) live.set(e.pointerId, s);
    e.preventDefault();
  }, { passive: false });
  ctx.listen(target, "pointermove", (e) => {
    const s = live.get(e.pointerId);
    if (s === undefined) return;
    onMove && onMove(pointerXY(e), s, e.pointerId, e);
    e.preventDefault();
  }, { passive: false });
  const end = (e) => {
    const s = live.get(e.pointerId);
    if (s === undefined) return;
    live.delete(e.pointerId);
    onUp && onUp(pointerXY(e), s, e.pointerId, e);
  };
  ctx.listen(target, "pointerup", end);
  ctx.listen(target, "pointercancel", end);
  return { live, count: () => live.size };
}

/* ---------------------------------------------------------------------
 * SOUND — one wrapper so every bit mutes the same way.
 * Needs "backgroundMusic" and/or "haptics" in manifest.permissions.
 * ------------------------------------------------------------------- */
function makeSound(ctx, { preset = "arcade", volume = 0.5, tempo } = {}) {
  let muted = false, bed = null, unlocked = false;
  return {
    get muted() { return muted; },
    /** Call from the first real gesture — mobile WebViews need it. */
    async unlock() {
      if (unlocked) return;
      unlocked = true;
      try {
        await ctx.music.unlock();
        if (!muted) bed = ctx.music.play({ preset, volume, ...(tempo ? { tempo } : {}) });
      } catch (_) { /* audio is a nicety; never let it break play */ }
    },
    sting(name) { if (!muted) { try { ctx.music.sting(name); } catch (_) {} } },
    duck(a, ms) { if (!muted) { try { ctx.music.duck(a, ms); } catch (_) {} } },
    tempo(bpm)  { try { (bed || ctx.music).setTempo(bpm); } catch (_) {} },
    intensity(v){ try { (bed || ctx.music).setIntensity(v); } catch (_) {} },
    haptic(kind) { try { ctx.platform.haptic(kind); } catch (_) {} },
    toggle() {
      muted = !muted;
      try {
        if (muted) { (bed || ctx.music).stop({ fadeOutMs: 220 }); bed = null; }
        else if (unlocked) bed = ctx.music.play({ preset, volume });
      } catch (_) {}
      return muted;
    },
  };
}

/* ---------------------------------------------------------------------
 * PLAYING CARDS — a full 52-card deck drawn procedurally.
 *
 * Packaged assets are disabled (maxAssets: 0), so pips and courts are
 * canvas paths. Each face is baked once to an OffscreenCanvas and then
 * blitted, which keeps a hand of twelve cards to twelve drawImage calls.
 * ------------------------------------------------------------------- */
const SUITS = [
  { id: "S", name: "spades",   colour: "#1b1b22", red: false },
  { id: "H", name: "hearts",   colour: "#c8202f", red: true  },
  { id: "D", name: "diamonds", colour: "#c8202f", red: true  },
  { id: "C", name: "clubs",    colour: "#1b1b22", red: false },
];
const RANKS = ["A","2","3","4","5","6","7","8","9","10","J","Q","K"];

/** Suit glyph as a canvas path, unit-scaled to roughly [-1,1]. */
function suitPath(g, suit, x, y, s) {
  g.save();
  g.translate(x, y);
  g.scale(s, s);
  g.beginPath();
  if (suit === "H") {
    g.moveTo(0, 0.75);
    g.bezierCurveTo(-1.35, -0.15, -0.72, -1.05, 0, -0.45);
    g.bezierCurveTo(0.72, -1.05, 1.35, -0.15, 0, 0.75);
  } else if (suit === "D") {
    g.moveTo(0, -0.95); g.lineTo(0.68, 0); g.lineTo(0, 0.95); g.lineTo(-0.68, 0);
  } else if (suit === "S") {
    g.moveTo(0, -0.95);
    g.bezierCurveTo(0.95, 0.05, 1.15, 0.62, 0.42, 0.62);
    g.bezierCurveTo(0.16, 0.62, 0.08, 0.48, 0.08, 0.4);
    g.lineTo(0.3, 0.95); g.lineTo(-0.3, 0.95); g.lineTo(-0.08, 0.4);
    g.bezierCurveTo(-0.08, 0.48, -0.16, 0.62, -0.42, 0.62);
    g.bezierCurveTo(-1.15, 0.62, -0.95, 0.05, 0, -0.95);
  } else {                                              // clubs
    g.arc(0, -0.42, 0.38, 0, Math.PI * 2);
    g.closePath(); g.moveTo(-0.28, 0.22);
    g.arc(-0.42, 0.16, 0.38, 0, Math.PI * 2);
    g.closePath(); g.moveTo(0.8, 0.16);
    g.arc(0.42, 0.16, 0.38, 0, Math.PI * 2);
    g.closePath();
    g.moveTo(0.09, 0.2); g.lineTo(0.3, 0.95); g.lineTo(-0.3, 0.95); g.lineTo(-0.09, 0.2);
  }
  g.closePath();
  g.fill();
  g.restore();
}

/** Pip layout per rank, in card-relative units where x,y are in [-1,1]. */
const PIPS = {
  A:  [[0, 0]],
  2:  [[0, -0.62], [0, 0.62]],
  3:  [[0, -0.62], [0, 0], [0, 0.62]],
  4:  [[-0.5, -0.62], [0.5, -0.62], [-0.5, 0.62], [0.5, 0.62]],
  5:  [[-0.5, -0.62], [0.5, -0.62], [0, 0], [-0.5, 0.62], [0.5, 0.62]],
  6:  [[-0.5, -0.62], [0.5, -0.62], [-0.5, 0], [0.5, 0], [-0.5, 0.62], [0.5, 0.62]],
  7:  [[-0.5, -0.62], [0.5, -0.62], [0, -0.31], [-0.5, 0], [0.5, 0], [-0.5, 0.62], [0.5, 0.62]],
  8:  [[-0.5, -0.62], [0.5, -0.62], [0, -0.31], [-0.5, 0], [0.5, 0], [0, 0.31], [-0.5, 0.62], [0.5, 0.62]],
  9:  [[-0.5, -0.68], [0.5, -0.68], [-0.5, -0.23], [0.5, -0.23], [0, 0],
       [-0.5, 0.23], [0.5, 0.23], [-0.5, 0.68], [0.5, 0.68]],
  10: [[-0.5, -0.68], [0.5, -0.68], [0, -0.45], [-0.5, -0.23], [0.5, -0.23],
       [-0.5, 0.23], [0.5, 0.23], [0, 0.45], [-0.5, 0.68], [0.5, 0.68]],
};

/**
 * Bake one card face. Returns an OffscreenCanvas ready to blit, or null on a
 * WebView with no OffscreenCanvas — callers fall back to drawing live.
 */
function bakeCard(rank, suitId, w, h, theme = {}) {
  const face = theme.face || "#fdfcf7";
  const edge = theme.edge || "rgba(24,22,30,0.16)";
  const suit = SUITS.find(s => s.id === suitId);
  const ink = suit.red ? (theme.red || "#c8202f") : (theme.black || "#1b1b22");
  const surf = makeSurface(w, h);
  if (!surf) return null;
  const g = surf.getContext("2d");
  const r = Math.min(w, h) * 0.085;

  roundRect(g, 0.5, 0.5, w - 1, h - 1, r);
  g.fillStyle = face; g.fill();
  g.strokeStyle = edge; g.lineWidth = 1; g.stroke();

  // Corner index: rank over a small suit glyph, mirrored into the far corner
  // so the card reads from either end the way a real one does.
  const cs = w * 0.155;
  const corner = (flip) => {
    g.save();
    if (flip) { g.translate(w, h); g.rotate(Math.PI); }
    g.fillStyle = ink;
    g.font = `700 ${cs}px ui-serif, Georgia, serif`;
    g.textAlign = "center"; g.textBaseline = "alphabetic";
    g.fillText(rank, w * 0.135, h * 0.135);
    suitPath(g, suitId, w * 0.135, h * 0.208, cs * 0.44);
    g.restore();
  };
  corner(false); corner(true);

  const cx = w * 0.5, cy = h * 0.5;
  if (PIPS[rank]) {
    // Number cards: the classic pip grid, lower pips rotated like the real
    // thing. Nine and ten pack four rows into the same panel, so they get a
    // smaller pip on a taller spread — at one scale they collide.
    const dense = rank === "9" || rank === "10";
    const px = w * 0.30;
    const py = h * (dense ? 0.355 : 0.335);
    const ps = w * (dense ? 0.080 : 0.115);
    for (const [ux, uy] of PIPS[rank]) {
      g.save();
      g.translate(cx + ux * px, cy + uy * py);
      if (uy > 0.05) g.rotate(Math.PI);
      g.fillStyle = ink;
      suitPath(g, suitId, 0, 0, ps);
      g.restore();
    }
  } else {
    drawCourt(g, rank, suitId, ink, w, h);
  }
  return surf;
}

/**
 * A court card.
 *
 * Real courts are mirrored half-portraits, and a literal one turns to mud at
 * the ~60px a phone gives a card. This draws a single flat heraldic figure —
 * crown, face, mantle — reading as King/Queen/Jack by its headwear, with the
 * suit colour carrying the rest.
 */
function drawCourt(g, rank, suitId, ink, w, h) {
  const cx = w * 0.5, cy = h * 0.5;
  const iw = w * 0.66, ih = h * 0.62;
  const x0 = cx - iw / 2, y0 = cy - ih / 2;

  // Panel with a double rule, the way an engraved court is framed.
  roundRect(g, x0, y0, iw, ih, w * 0.045);
  g.fillStyle = "rgba(0,0,0,0.035)"; g.fill();
  g.strokeStyle = ink; g.lineWidth = Math.max(1, w * 0.016); g.stroke();
  roundRect(g, x0 + w * 0.028, y0 + w * 0.028, iw - w * 0.056, ih - w * 0.056, w * 0.03);
  g.strokeStyle = ink; g.lineWidth = Math.max(0.6, w * 0.007); g.stroke();

  g.save();
  roundRect(g, x0 + w * 0.028, y0 + w * 0.028, iw - w * 0.056, ih - w * 0.056, w * 0.03);
  g.clip();

  const fx = cx, fy = cy + ih * 0.02;
  const u = iw * 0.5;                                   // figure unit

  // Mantle: shoulders sweeping to the panel floor.
  g.fillStyle = ink;
  g.beginPath();
  g.moveTo(fx - u * 0.86, y0 + ih);
  g.quadraticCurveTo(fx - u * 0.74, fy + u * 0.16, fx - u * 0.30, fy + u * 0.06);
  g.lineTo(fx + u * 0.30, fy + u * 0.06);
  g.quadraticCurveTo(fx + u * 0.74, fy + u * 0.16, fx + u * 0.86, y0 + ih);
  g.closePath();
  g.fill();

  // Collar notch, so the mantle reads as cloth rather than a blob.
  g.fillStyle = "rgba(253,252,247,0.92)";
  g.beginPath();
  g.moveTo(fx - u * 0.26, fy + u * 0.07);
  g.lineTo(fx, fy + u * 0.42);
  g.lineTo(fx + u * 0.26, fy + u * 0.07);
  g.closePath();
  g.fill();

  // The suit worn on the chest, knocked out of the mantle — drawn in ink it
  // would be ink-on-ink and vanish.
  g.fillStyle = "rgba(253,252,247,0.93)";
  suitPath(g, suitId, fx, fy + u * 0.70, u * 0.38);

  // Face.
  g.fillStyle = "rgba(253,252,247,0.95)";
  g.beginPath();
  g.ellipse(fx, fy - u * 0.30, u * 0.28, u * 0.34, 0, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = ink; g.lineWidth = Math.max(0.7, w * 0.009); g.stroke();

  // Headwear is the only thing separating the three ranks.
  g.fillStyle = ink;
  const hy = fy - u * 0.60;
  if (rank === "K") {                                   // tall crown, five points, cross
    g.beginPath();
    g.moveTo(fx - u * 0.42, hy + u * 0.20);
    g.lineTo(fx - u * 0.42, hy - u * 0.06);
    g.lineTo(fx - u * 0.21, hy + u * 0.10);
    g.lineTo(fx,            hy - u * 0.26);
    g.lineTo(fx + u * 0.21, hy + u * 0.10);
    g.lineTo(fx + u * 0.42, hy - u * 0.06);
    g.lineTo(fx + u * 0.42, hy + u * 0.20);
    g.closePath();
    g.fill();
    g.fillRect(fx - u * 0.05, hy - u * 0.54, u * 0.10, u * 0.26);
    g.fillRect(fx - u * 0.17, hy - u * 0.45, u * 0.34, u * 0.09);
  } else if (rank === "Q") {                            // low coronet with pearls
    g.beginPath();
    g.moveTo(fx - u * 0.40, hy + u * 0.20);
    g.lineTo(fx - u * 0.34, hy - u * 0.10);
    g.lineTo(fx - u * 0.12, hy + u * 0.06);
    g.lineTo(fx,            hy - u * 0.16);
    g.lineTo(fx + u * 0.12, hy + u * 0.06);
    g.lineTo(fx + u * 0.34, hy - u * 0.10);
    g.lineTo(fx + u * 0.40, hy + u * 0.20);
    g.closePath();
    g.fill();
    for (const px of [-0.34, 0, 0.34]) {
      g.beginPath(); g.arc(fx + u * px, hy - u * 0.16, u * 0.065, 0, Math.PI * 2); g.fill();
    }
  } else {                                              // Jack: soft cap and feather
    g.beginPath();
    g.moveTo(fx - u * 0.38, hy + u * 0.20);
    g.quadraticCurveTo(fx - u * 0.40, hy - u * 0.20, fx + u * 0.06, hy - u * 0.20);
    g.quadraticCurveTo(fx + u * 0.40, hy - u * 0.18, fx + u * 0.38, hy + u * 0.20);
    g.closePath();
    g.fill();
    g.beginPath();
    g.moveTo(fx + u * 0.22, hy - u * 0.14);
    g.quadraticCurveTo(fx + u * 0.66, hy - u * 0.52, fx + u * 0.50, hy + u * 0.04);
    g.quadraticCurveTo(fx + u * 0.40, hy - u * 0.12, fx + u * 0.22, hy - u * 0.14);
    g.closePath();
    g.fill();
  }
  g.restore();
}

/** Bake the card back — a woven guilloché in one accent colour. */
function bakeCardBack(w, h, accent = "#2f4d8a") {
  const surf = makeSurface(w, h);
  if (!surf) return null;
  const g = surf.getContext("2d");
  const r = Math.min(w, h) * 0.085;
  roundRect(g, 0.5, 0.5, w - 1, h - 1, r);
  g.fillStyle = accent; g.fill();
  g.save();
  roundRect(g, w * 0.055, h * 0.04, w * 0.89, h * 0.92, r * 0.7);
  g.clip();
  g.strokeStyle = "rgba(255,255,255,0.17)";
  g.lineWidth = Math.max(0.7, w * 0.012);
  const step = w * 0.13;
  for (let i = -h; i < w + h; i += step) {          // lattice
    g.beginPath(); g.moveTo(i, 0);      g.lineTo(i + h, h); g.stroke();
    g.beginPath(); g.moveTo(i + h, 0);  g.lineTo(i, h);     g.stroke();
  }
  g.restore();
  roundRect(g, w * 0.055, h * 0.04, w * 0.89, h * 0.92, r * 0.7);
  g.strokeStyle = "rgba(255,255,255,0.55)"; g.lineWidth = Math.max(1, w * 0.018); g.stroke();
  roundRect(g, 0.5, 0.5, w - 1, h - 1, r);
  g.strokeStyle = "rgba(0,0,0,0.25)"; g.lineWidth = 1; g.stroke();
  return surf;
}

/** Bake all 52 faces plus the back once, then blit for the rest of the run. */
function makeDeckArt(w, h, theme) {
  const faces = {};
  for (const s of SUITS) for (const r of RANKS) faces[r + s.id] = bakeCard(r, s.id, w, h, theme);
  return { faces, back: bakeCardBack(w, h, theme && theme.accent), w, h };
}

/** A shuffled 52-card deck. Pass a seeded rng for reproducible tests. */
function freshDeck(rng = Math.random) {
  const d = [];
  for (const s of SUITS) for (const r of RANKS) d.push({ rank: r, suit: s.id, red: s.red, id: r + s.id });
  for (let i = d.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [d[i], d[j]] = [d[j], d[i]];
  }
  return d;
}

/** Deterministic rng so a harness run can replay an exact deal. */
function makeRng(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5;  s >>>= 0;
    return s / 4294967296;
  };
}

/* ---------------------------------------------------------------------
 * PASS-THE-PHONE — the privacy screen for hidden-information games.
 *
 * On one shared device a hand is only secret if the phone physically
 * changes hands with the screen covered in between. This is the gate: it
 * names who should be holding the phone, and only that player's hand is
 * revealed, while they hold a button down.
 * ------------------------------------------------------------------- */
function privacyMarkup(name, colour) {
  return `<div data-el="privacy" style="position:absolute;inset:0;display:none;
    align-items:center;justify-content:center;flex-direction:column;gap:18px;
    background:rgba(8,10,16,0.97);z-index:60;text-align:center;padding:24px;">
    <div style="font-size:13px;letter-spacing:0.22em;text-transform:uppercase;opacity:0.55;">Pass the phone to</div>
    <div data-el="privacy-name" style="font-size:34px;font-weight:700;color:${colour};">${esc(name)}</div>
    <div data-el="privacy-hold" style="margin-top:8px;padding:16px 30px;border-radius:999px;
      background:${colour};color:#0b0d12;font-weight:700;font-size:17px;">Hold to look</div>
    <div style="font-size:13px;opacity:0.45;max-width:250px;line-height:1.5;">
      Only you should see the screen. Let go to hide it again.</div>
  </div>`;
}

/* ---------------------------------------------------------------------
 * PLAYER COUNT + INSTRUCTIONS
 * ------------------------------------------------------------------- */
function playerPickerMarkup(counts, { title, sub, accent = "#f5c451" }) {
  const buttons = counts.map(n =>
    `<button data-el="pc" data-n="${n}" style="width:64px;height:64px;border:none;border-radius:20px;
      background:rgba(255,255,255,0.07);color:#fff;font-size:24px;font-weight:700;
      font-family:inherit;">${n}</button>`).join("");
  return `<div data-el="picker" style="position:absolute;inset:0;display:flex;align-items:center;
    justify-content:center;flex-direction:column;gap:22px;z-index:50;text-align:center;padding:26px;">
    <div style="font-size:30px;font-weight:700;letter-spacing:-0.01em;">${esc(title)}</div>
    <div style="font-size:15px;opacity:0.6;max-width:270px;line-height:1.5;">${esc(sub)}</div>
    <div style="font-size:12px;letter-spacing:0.22em;text-transform:uppercase;opacity:0.5;margin-top:6px;">How many players?</div>
    <div style="display:flex;gap:12px;flex-wrap:wrap;justify-content:center;">${buttons}</div>
  </div>`;
}

/** Round icon buttons, kept top-right and clear of ctx.safeArea.bottom. */
function chromeMarkup(ctx, buttons, accent = "#fff") {
  const b = buttons.map(x =>
    `<button data-el="${x.el}" aria-label="${esc(x.label)}" style="pointer-events:auto;width:38px;height:38px;
      border-radius:13px;border:none;background:rgba(255,255,255,0.10);color:${accent};
      font-size:16px;line-height:1;font-family:inherit;">${x.icon}</button>`).join("");
  return `<div style="position:absolute;right:12px;top:${ctx.safeArea.top + 10}px;
    display:flex;gap:8px;z-index:40;pointer-events:none;">${b}</div>`;
}

function panelMarkup(elName, title, bodyHtml) {
  return `<div data-el="${elName}" style="position:absolute;inset:0;display:none;align-items:center;
    justify-content:center;background:rgba(6,8,13,0.9);z-index:70;padding:24px;">
    <div style="max-width:330px;width:100%;background:rgba(22,26,36,0.98);border-radius:22px;
      padding:24px;border:1px solid rgba(255,255,255,0.08);">
      <div style="font-size:20px;font-weight:700;margin-bottom:14px;">${esc(title)}</div>
      <div style="font-size:15px;line-height:1.65;opacity:0.82;">${bodyHtml}</div>
      <button data-el="${elName}-close" style="margin-top:20px;width:100%;padding:13px;border:none;
        border-radius:14px;background:rgba(255,255,255,0.12);color:#fff;font-size:15px;
        font-weight:600;font-family:inherit;">Got it</button>
    </div>
  </div>`;
}
