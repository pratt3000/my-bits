# Building a bit in this repo

Everything here was learned by uploading real drafts and reading real
rejections. The API's error messages do not name their actual causes, so treat
this as the rulebook and `tools/harness/validate.mjs` as the enforcement.

Fetch the live contract before you start — it wins over this file:

- <https://api.plethora.studio/v1/agent/context.md>
- <https://api.plethora.studio/v1/agent/sdk.md>
- <https://api.plethora.studio/v1/agent/schema.json>
- <https://api.plethora.studio/v1/agent/libraries.json>

## Shape

```
<bit-name>/
  plethora.json   # manifest
  main.js         # the whole bit, one file, assigns window.plethoraBit
  README.md       # what it is and why it is built the way it is
```

`entry` stays `"main.js"` — it names the file at the *package* root at upload
time, independent of where the bit sits in this repo.

## The five constructs that get a draft rejected

Three of these appear nowhere in `sdk.md`. All were found by bisecting real
uploads.

| Construct | What the API says | What to do instead |
| --- | --- | --- |
| `document.createElement(...)` | *"Direct document/body access is not allowed."* | Declare the whole overlay as one markup string on `ctx.createRoot()` and query handles back with `[data-el]`. |
| `getBoundingClientRect()` | *"This bit uses unsupported remote resources…"* — says nothing about layout | `event.offsetX` / `event.offsetY`. Already target-relative, and skips a forced reflow per pointer event. |
| `g.filter = "blur(...)"` | rejected as a remote resource | The property also accepts `url(#…)`. Build soft edges from concentric translucent strokes. |
| any `http(s)://` that is not `libs.plethora.studio` | *"unsupported remote resources"* | There are no packaged assets (`maxAssets: 0`). Generate everything. |
| a permission-gated API with no matching `manifest.permissions` entry | 400 | Declare it. The validator checks both directions — a declared permission you never use is also flagged. |

**Never alias a `ctx` namespace object into a variable.** `const s = ctx.sensors`
then `s.tilt` gets the draft rejected with the same *"unsupported remote
resources"* message; reading `ctx.sensors.tilt` through in full is fine. The
upload validator statically tracks calls made through `ctx`, and binding one of
its namespaces to a local defeats that. Aliasing *scalars* — `let W = ctx.width`
— is fine, and every accepted bit does it.

An offscreen drawing surface is `new OffscreenCanvas(w, h)`, never
`document.createElement("canvas")`. Guard it: some WebViews lack it, so every
bake site needs a live-drawing fallback rather than a blank screen.

## Local multiplayer on one phone

This is the whole point of these bits, and it has its own failure modes.

- **Bind a pointer to a player on `pointerdown`, for that pointer's whole
  life.** Deciding per-move lets a finger that strays across the centre line
  start driving the opponent's piece. Key a `Map` by `pointerId`; release only
  on `pointerup`/`pointercancel`.
- **One hand per zone.** If a zone already has a live pointer, ignore
  additional ones — otherwise one player grabs two controls.
- **Rotate each player's UI to their seat.** Somebody sitting at the far edge
  reads a score at the top of the screen upside down. `transform: rotate(180deg)`
  for DOM, `g.rotate(Math.PI)` for canvas.
- **Symmetric camera.** In a 3D two-player game the camera must be directly
  overhead. Any tilt gives the near player a larger, closer half.
- **Hidden information needs a physical pass.** A hand is only secret if the
  phone changes hands with the screen covered. Gate it behind a
  "pass to <name> → hold to look" screen.
- **Keep controls off the bottom edge** (`ctx.safeArea.bottom`).
- **A phone reports at most five simultaneous touches.** iOS caps
  `navigator.maxTouchPoints` at 5, and the sixth contact is simply never
  delivered — it is a hardware/OS limit, not a performance one, so it cannot be
  tuned around. Any design that needs one *held* touch per player therefore
  caps at five players, and four is the safe number. A momentary tap is no
  cheaper: the cap counts concurrent contacts regardless of duration, so six
  people tapping in the same frame still loses one. In an elimination game the
  dropped player just dies, with no feedback explaining why.
  Sequential-turn games are unaffected — that is a real reason to prefer them
  above four players.
  (The headless harness reports `maxTouchPoints: 1` because it emulates a
  desktop pointer. CDP still delivers multi-touch, so multi-finger tests are
  valid; the number is not.)
- **Rotate the HUD, not the world.** Inscribing a playfield in a circle so it
  can spin to face each seat throws away most of a 390x844 screen — a 328px
  arena on an 844px display. Leave the world alone and rotate the text and
  controls around it.
- **The overlay must be transparent to pointers.** `ctx.createRoot()` returns an
  element filling the container, and it is created *after* the canvas, so it
  sits on top and silently swallows every tap meant for the play surface. Give
  the root `pointer-events: none` and opt individual controls back in with
  `pointer-events: auto`. This one is invisible until you script real input:
  the bit boots, renders and animates perfectly while ignoring the player.
- **Nothing fits in the side margins.** A board sized to a 390px-wide screen
  leaves ~7px each side, so a side-mounted button column covers the outermost
  file or column. Put chrome in a horizontal strip above or below the play
  area instead.
- **Wait on the animation, not on the state.** A move commits its state change
  immediately and *then* animates; input stays blocked until the animation
  lands. A play script that waits for the state to change taps into a busy
  board and the input is silently dropped. Expose a `busy` flag and poll it.

## 3D or 2D

Use `three@0.164.1` (declare it in `dependencies`, load with
`await ctx.importModule("three", "0.164.1")`) where depth genuinely helps:
boards with physical pieces, tables, tiles, dice, arenas.

Stay on canvas 2D where the aesthetic *is* flatness: silhouette art, pixel art,
playing cards, word and party games. 3D there is worse, not better.

## Sound

Every bit gets sound, not as an afterthought:

- a background bed via `ctx.music.play({ preset, volume, tempo })`, unlocked
  inside the first real gesture with `ctx.music.unlock()`;
- short `ctx.music.sting(...)` cues on the moments that matter — `tap`, `coin`,
  `success`, `fail`, `powerup`, `win`, `lose`;
- `ctx.music.duck()` before a loud beat, `setIntensity()` to track tension;
- `ctx.platform.haptic(...)` on contact;
- a mute toggle in the chrome that persists via `ctx.storage`.

Wrap all of it in try/catch. Audio is a nicety and must never break play.

## Leaderboards

Platform-owned. Declare a `memory.records` channel in the manifest and call
`ctx.memory.record(id).submit(value)`. Never draw an in-bit leaderboard.

For a couch game the honest record is a property of the *match* — longest
rally, fastest win, best combined score — not of one of the people sharing the
phone.

## An unresolved upload rejection

Five bits (`forehead`, `snap`, `reactor-four`, `go-fish`, `cheat`) are refused
with `400 bad_request` and the *"unsupported remote resources"* message, and the
cause is **not** characterised. What is established:

- It is not the manifest. The same manifest with a trivial source is accepted.
- It is not size (the smallest rejected bit is 30KB; a 123KB bit is accepted),
  nor comments, nor emoji, nor the count of `ctx.` references, nor any single
  construct found by feature-correlating the five against the nineteen accepted.
- **It is cumulative within a file.** Split `forehead`'s body in half and each
  half uploads cleanly on its own; concatenated, they are rejected. So it is a
  threshold or an interaction, not one bad line — which is why bisecting to a
  single trigger does not converge.
- It is not a `data:` literal. `go-fish` is the only one of the five that
  contains the substring `data:` at all (ten object keys, `data: { ... }`);
  spacing them to `data : {` changes nothing.
- The five failing and nineteen accepted bits share every token. A scan for
  identifiers and syntax features present in **all five** rejected bits and in
  **none** of the nineteen accepted ones returns the empty set, so there is no
  construct to remove.
- The rejection survived a rewrite of all 24 bits (every font stack, a case
  fold, an SVG icon swap): exactly the same five failed before and after, and
  no accepted bit regressed. Whatever it is, it is stable and it is not
  something the source was edited into.

This is worth reporting to Plethora with the reproduction rather than guessing
at further: the message names no offending resource, and the five bits contain
no remote URL of any kind.

`504 deadline_exceeded` is different and is genuinely just a slow server: the
draft is usually created anyway, and a retry reports `updated`. `tools/upload.mjs`
backs off and retries those.

## Verifying before upload

```
node tools/harness/validate.mjs <bit>     # static: the rules above
node tools/harness/run.mjs <bit>          # boots it headless, screenshots it
```

The harness implements the documented `ctx` surface, serves the sha256-verified
registry build of three.js over HTTP (ES modules will not import from
`file://`), and drives genuine multi-touch through CDP so several fingers can be
down at once. Write a play script per bit that reaches a real end state —
booting is not testing.

`validate.mjs` is deliberately stricter than the server: it rejects
`document.createElement` outright, where the server currently tolerates a
literal `"div"`/`"button"`. Staying inside the strict set is free.

## Typography traps

Four things bite when a whole set of bits is retyped in one face.

**Form controls do not inherit `text-transform`.** The UA stylesheet pins
`text-transform:none` on `button`, `input`, `select` and `textarea`, so a
`text-transform:lowercase` on the overlay root cascades to every label and
caption and then stops dead at every button — which is exactly where the
loudest text on the screen lives. Stamp the controls directly. A
`MutationObserver` on the bit's own root does it once for panels that are
rebuilt by `innerHTML` later:

```js
const lowercaseControls = () => {
  for (const el of root.querySelectorAll("button,input,select,textarea"))
    if (el.style.textTransform !== "lowercase") el.style.textTransform = "lowercase";
};
lowercaseControls();
new MutationObserver(lowercaseControls).observe(root, { childList: true, subtree: true });
```

**A case fold on `fillText` misses letter-tracked text.** Patching
`CanvasRenderingContext2D.prototype.fillText` covers a few hundred call sites
at once, but any helper that draws its own tracking emits one character per
call, and a one-character string is deliberately left alone (card ranks and
piece letters are symbols — a lowercase `k` on a king reads as a bug). Fold
the case inside those helpers instead, at the top, where the whole string is
still in one piece. Patch `measureText` the same way as `fillText`, or centred
text is measured at its uppercase width and drifts off its own anchor.

**Inter is much wider than a condensed display face.** Swapping Bebas Neue or
Cormorant Garamond for Inter at the same `font-size` overflows headings that
were tuned to fit, and a heading painted with `-webkit-background-clip:text`
does not overflow visibly — it simply loses the glyphs outside its own box, so
it reads as a truncated title rather than a layout bug.
`tools/harness/check-overflow.mjs` compares every leaf element's Range width
against its content box and catches both. (It false-positives on a root that
is rotated for landscape, where `clientWidth` is the pre-rotation width.)

**A stubbed `loadFont` hides the whole problem.** The harness caches the real
registry faces under `tools/harness/libcache/` and injects them through
`FontFace`. A mock that returns `{status:"loaded"}` without loading anything
renders the system fallback, so a font change looks applied when nothing has
changed.

Two things are deliberately left in their own case: `lob` sets its chrome in a
5x7 pixel face that has no lowercase glyphs (seven rows cannot carry both
ascenders and descenders), and card ranks stay uppercase everywhere.

## Sizing chrome against the phone

A bit that sizes its board first and gives the chrome whatever is left looks
right on the one viewport it was built against and falls apart on a short
screen. Take the chrome's height first — a 44px control is the smallest a
thumb hits reliably, so that is a floor, not a preference — and let the board
have the rest. In Othello the board is centred, so a strip floor is just a cap
on the cell size:

```
strip = H/2 - unit * (4 + RIM) - 6     =>     unit <= (H/2 - 6 - strip) / (4 + RIM)
```

The failure is invisible to the obvious check. Flex items default to
`flex-shrink: 1`, so a column that has run out of height does not overflow —
it squashes, and `scrollHeight` still reports that everything fits. What
actually disappears is the space *between* the items, which is why
`tools/harness/check-fit.mjs` measures gaps rather than heights, across six
phone sizes, and fails on a gap that is generous on a large screen and gone on
a small one. Measure those gaps with `offsetTop`/`offsetHeight`: half the
chrome in a two-sided game sits in a container rotated 180° to face the other
player, and a screen-space rect there reports every gap as a large negative
number.

On a two-sided board, clear the deeper of the two safe areas at *both* ends.
Honouring each edge exactly puts the two halves 13px out of step, and out of
step is exactly what a player notices on a layout that is supposed to be a
mirror.

## Seat identity is not a screen half

Lob seated both players on the same side so neither reads their tanks upside
down — but its touch router still decided *who* had touched from where the
touch landed (`py >= BOT_Y ? 0 : 1`). The active player's deck is always the
bottom one, so on player two's turn every tap arrived as player one's, failed
the `who !== turn` test, and was refused. Player two could not fire at all and
the match stalled on the first volley.

When a game moves a seat, every place that infers a seat from geometry has to
move with it. Grep for the screen-half comparisons; a rendering fix that
leaves the input router on the old assumption produces a game that looks
correct and cannot be played.

## Two harness lessons

Run play scripts **one at a time**. Six headless Chromium instances on one box
starve each other, and a script that dispatches three simultaneous touches
gets them serialised — which reads as a genuine "only one of three slaps
registered" failure. A ratscrew failure that looked like a clean regression
under A/B testing passed three times in a row on its own.

`ctx.loadFont` in the mock has to actually load the font. A stub that returns
`{status:"loaded"}` renders the system fallback, so a typography change looks
applied when nothing has changed.

## Two different pixel ratios

The runtime sizes the canvas buffer at the device's real pixel ratio and
installs a matching `setTransform`. A bit that caps the ratio for its own
texture bakes — sensible, 2x is already past what the eye resolves on a
playing card — must not reuse that capped number on the real context:

```js
const dpr  = ctx.dpr || 1;        // the buffer's scale. Transforms must match it.
const bake = Math.min(dpr, 2);    // offscreen texture resolution. A memory cap.
```

Getting this wrong draws every frame at two-thirds scale into the top-left
corner and leaves the rest of the screen empty. It is invisible at 2x, which
is what a desktop-sized harness run defaults to, and it is what most phones
actually are not: iPhone 12 and up, and most flagship Android, are 3x.
`tools/harness/check-dpr.mjs` runs every bit at 3x and compares the three
other quadrants against the top-left.

WebGL bits are not affected in the same way — they cap the drawing buffer and
let CSS stretch it, which costs sharpness but still fills the screen.

## Boot is not a test

Deleting a helper and leaving one of its call sites behind parses, validates,
boots, and screenshots perfectly. It throws the first time that code path
runs — and for a board game that is the first *move*, not the first frame.
Removing Othello's caption row left one `paintCaption()` inside `commit()`;
the title screen was flawless and every move after the first died silently in
a pointer handler.

Nothing static caught it. A regex that flags "a call to a name this file never
binds" drowns in false positives — `let a = null, b = null`, method shorthand,
getters, destructured parameters, and function declarations themselves all
bind names in forms a regex cannot separate from a call, and a check nobody
trusts is worse than no check. Getting it right needs a parser.

What caught it in one run was the play script, because it plays nine plies
instead of taking a photograph of the first. That is the whole argument for
writing one per bit: booting is not testing.
