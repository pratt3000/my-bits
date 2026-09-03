# Porting a recovered game to `plethora-bit@2`

Read this after `grab.py` has run and you have read `game.js`. It covers what
changes and what must not.

## The one rule that decides everything else

A Sekai build is a **web page**: it owns the document, loads libraries off a
CDN, and starts itself on `DOMContentLoaded`. A Plethora bit is a **module
inside someone else's page**: it owns nothing, can load nothing, and is handed a
`ctx` and told to start. Nearly every difference below follows from that.

So the split to aim for is: **keep the simulation, rebuild the shell.** The
valuable, hard-to-reproduce part of these games is the domain logic — the audio
graph, the physics, the generative maths. That is usually pure computation with
no DOM in it, and it should survive the port essentially unchanged, constants
and all. What gets rewritten is everything touching the document, the network,
and the clock.

Resist "improving" the simulation while you are in there. If the port sounds or
behaves differently from the original, you have introduced a bug, and you will
not know which change caused it. Port first, and raise improvements separately.

## What maps to what

| In the original | In the bit | Why |
|---|---|---|
| `<script src="cdn…">` | inline it, or drop the dependency | No network egress at all. Icon fonts and icon libraries become inline SVG (`scripts/icons.js`); CSS frameworks become inline styles. |
| `<style>` + framework classes | inline `style="…"` strings | You are building DOM inside `ctx.createRoot()`. Pseudo-elements (`::-webkit-slider-thumb`) cannot be set inline, so controls that rely on them get hand-built. |
| `document.getElementById` | `root.querySelector("[data-el=…]")` | The bit's DOM is its own subtree. A `data-el` attribute plus one `nodes` map is the pattern used across this repo. |
| `document.createElement("canvas")` | `ctx.createCanvas2D()` / `ctx.createCanvas()` | Raw canvas creation is rejected by the validator. `createCanvas2D` also applies DPR to the backing store for you. |
| `canvas.getBoundingClientRect()` | `e.offsetX` / `e.offsetY` | `getBoundingClientRect` is rejected by the validator — even when it only appears in a comment. |
| `requestAnimationFrame(loop)` | `ctx.onFrame((dt, now) => …)` | The runtime owns the frame loop and stops it when the bit is backgrounded. |
| `setTimeout` / `setInterval` | `ctx.timeout` / `ctx.interval` | Cancelled automatically on teardown. |
| `el.addEventListener` | `ctx.listen(el, name, fn)` | Removed automatically on teardown. |
| `DOMContentLoaded` | the body of `init(ctx)` | The document loaded long ago. |
| `window.appState` | a local `const state = {…}` | One global, `window.plethoraBit`, and nothing else. |
| audio-unlock shim | the first real gesture | The gesture that starts the sound is the unlock; no shim needed. |
| `sekaiEditable` + `postMessage` | delete | Host platform scaffolding for Sekai's own editor. Dead weight in a bit. |
| `window.addEventListener("resize")` | compare `ctx.width`/`ctx.height` each frame | Cheap, and it catches container changes the window event misses. |

## Structure to write

```js
window.plethoraBit = {
  meta: { title, runtime: "plethora-bit@2", tags, permissions },
  async init(ctx) {
    // 0. constants, palette, inlined icon geometry
    // 1. surfaces: ctx.createCanvas2D() + ctx.createRoot() for UI
    // 2. the ported simulation, untouched
    // 3. draw, from the simulation's state
    // 4. input via ctx.listen; first gesture calls ctx.platform.start()
    // 5. persistence via ctx.storage (see gotchas.md)
    // 6. draw one frame, markVisualReady(), platform.ready(), then onFrame
  }
};
```

Order matters at the end: draw a real frame *before* `platform.ready()`, because
a blank first frame is called out explicitly in `sdk.md`.

## Layout inside a phone-shaped container

`ctx.createCanvas2D()` fills the whole container. If the original had a sidebar
or a bottom bar, do not try to make the canvas smaller — keep it full-bleed,
draw the interactive area into a sub-rectangle, and lay the DOM controls over
the rest:

```js
padX = 0;
padY = SAFE_T;
padW = W - RAIL_W;
padH = H - SAFE_T - BAR_H - SAFE_B;
```

Then every pointer coordinate is `(e.offsetX - padX) / padW`, and everything
drawn is offset by `padX`/`padY`. Honour `ctx.safeArea` on the top and bottom —
that is the notch and the home indicator, and content under them is unreadable.

Recompute all of it in one `layout()` function called from `onFrame` when the
size changes, and remember that resizing a canvas resets its transform, so
re-apply `setTransform(ctx.dpr, 0, 0, ctx.dpr, 0, 0)` afterwards.

## Permissions

Declare exactly what the source uses — the validator checks both directions, so
an unused declaration is as much a rejection as an undeclared use. `check.py`
verifies this. In particular: raw `AudioContext` needs `audio`, and needs it
even though you are not using `ctx.audio` at all. `backgroundMusic` is only for
`ctx.music`; a synth that generates its own sound does not want it.

## What to add that the original did not have

Small things, worth doing because they are what makes a bit feel native:

- `ctx.platform.start()` on the first gesture, `interact()` on meaningful
  actions, `haptic("light")` on taps.
- `ctx.storage` for whatever the player would be annoyed to lose — a chosen
  preset, a best score.
- A first-run hint that fades on first touch, if the original had one.

Don't add scoring, leaderboards or goals to something that was not a game. A
toy is allowed to be a toy.
