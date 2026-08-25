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
