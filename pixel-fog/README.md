# Pixel Fog

Nine places in San Francisco, each buried under a living mosaic of itself. Rub
the pixels away with a finger and the picture surfaces — and with it one fact
about the place that you almost certainly do not know. Clear one, swipe for the
next.

## The nine, and what is hidden in each

| Place                | The fact underneath                                                        |
| -------------------- | -------------------------------------------------------------------------- |
| Golden Gate Bridge   | Charles Ellis did the engineering; Strauss forced him off in 1931 and took the credit. Corrected in 2007. |
| Alcatraz Island      | Carried the first lighthouse ever lit on the Pacific coast, in 1854 — long before the cellhouse. |
| The Painted Ladies   | Surplus battleship grey covered them for decades; colour returned only after 1963. |
| Bay Bridge           | Until 1958 the lower deck carried electric commuter trains rather than cars. |
| Fort Point           | The bridge's steel arch exists so it could vault this 1861 fort instead of demolishing it. |
| Hyde Street          | No cable car has an engine — each grips a cable moving at a flat 9.5 mph.   |
| Coit Tower           | The 1934 murals were branded communist; a hammer and sickle was scrubbed off before opening. |
| Ocean Beach          | The clipper *King Philip* broke up here in 1878 and still surfaces at the lowest tides. |
| Financial District   | Dozens of Gold Rush ships lie buried under the streets; crews still hit their hulls. |

The bar for these was deliberately high: nothing a San Franciscan would already
trot out. No international orange, no escapes from the Rock, no Karl.

## Files

```
pixel-fog/
  plethora.json   # manifest
  main.js         # entry source defining window.plethoraBit
  README.md       # this file
```

## Every picture is drawn, not fetched

The runtime blocks remote images (`ctx.fetch` is data/blob only, http/https
egress is denied) and packaged assets are off (`maxAssets: 0`). So there are no
photographs here: all nine views are painted at runtime out of canvas gradients,
ridges built from stacked sine octaves, seeded scatter, and hand-placed landmark
geometry. Each is a pure `paint(g, W, H)` function driven by a seeded PRNG, so
it composes identically at any size.

The fact is painted *into* the picture, under the same bake — which is why
rubbing uncovers the words the same way it uncovers the bridge.

## How the reveal works

The picture starts hidden and is uncovered, so the mosaic is the base layer and
the photograph is what breaks through:

1. The place is baked once to an `OffscreenCanvas` at full screen size.
2. That bake is read back **once** with `getImageData` and averaged into a fine
   colour grid (~13 CSS px blocks) plus a coarse grid folded down from it 3×3.
   Every shade string each cell can use is pre-built here, so the frame loop
   never does string work per cell.
3. Each frame the mosaic is drawn across the whole screen.
4. Rubbing stamps a pre-baked soft brush into a mask. The crisp bake is copied
   into a scratch surface, `destination-in` composites the mask onto it, and the
   result is drawn over the mosaic — so the picture shows only where you rubbed.

The mosaic animates three ways at once: a slow diagonal wave fades the fine grid
in and out over the coarse one, so bands of coarseness travel across the frame;
each block breathes, so the grout lines between them pulse; and each block
drifts through six pre-built brightness shades on its own phase.

Cross 72 % and a sweep clears the rest, the dot goes gold, and
`platform.milestone` fires. Clearing all nine calls `platform.complete`.

## Rub versus swipe

Worth stating plainly, because the obvious implementation does not work.

A swipe cannot be told apart from a rub by velocity, straightness or direction:
**rubbing a picture clean *is* a fast, straight, horizontal scrub.** A first
attempt used a flick heuristic and every single rub stroke paged instead. A
screen-edge zone fails for the same reason — rubbing edge to edge starts in it.

So the rule is binary, and has no false positives:

- **While pixels remain, every drag rubs.** Nothing pages.
- **Once the picture is clear** there is nothing left to rub, so any sideways
  drag pages — which is what you reach for anyway once you are done.
- **To leave a picture early, tap a dot** at the top. The dots are padded hit
  targets and jump straight to any of the nine.

Both were verified in a browser: vigorous mid-screen scrubbing never pages, and
a swipe on a cleared picture always does.

## Contract notes

- Permissions: `backgroundMusic` (a `drift` bed plus tap/success stings),
  `haptics`, `storage` (which places you have already uncovered).
- No dependencies, no packaged assets, no memory channels.
- The picture is the whole screen. The only chrome is the dot row, a one-line
  hint that fades on first rub, and a small `?`.
- Pages are cached three at a time (previous, current, next) and rebuilt on a
  layout change. Masks live at CSS resolution, the bake at up to 2×, which keeps
  the working set to roughly 20 MB rather than 50.
- Layout re-derives from `ctx.width`/`ctx.height` compared each frame rather than
  a resize listener. A rotation rebuilds every page, so a half-cleared picture
  resets; the gold dot is kept.
- Thumbnails are gone with the grid: the first frame is page one's mosaic, drawn
  before `platform.ready()`.

### Working within what the upload validator rejects

Three constraints, all inherited the hard way. The validator reports every one
of them with the same message about unsupported remote resources and registry
loaders, which is never what is actually wrong.

- **`document.createElement("canvas")`** is rejected (found by `cairn`). Every
  offscreen surface goes through `makeSurface()`, which returns an
  `OffscreenCanvas` or `null`. `document.createElement` with a literal
  `"div"`/`"button"` is fine and is what the chrome uses.
- **Querying the canvas for its layout box** is rejected (found by `cairn`).
  Pointer positions come from `event.offsetX`/`offsetY`, already
  canvas-relative. The validator text-scans the source, so *naming* that call in
  a comment also fails the upload — this file describes it instead.
- **`const ph = <call expression>`** is rejected — the local's name alone. It is
  the declaration, not the use: deleting the line while leaving `ph.addColorStop(...)`
  in place passes, and `const ph = cellPhase[i]` (a member expression) passes
  too. The arguments are irrelevant. No local in this file is named `ph`.

`measureText`, `fillText`, `clip("evenodd")`, `getImageData`/`putImageData`,
`setPointerCapture` and drawing the display canvas into an `OffscreenCanvas` were
all probed against the real endpoint and are accepted.

Method, for the next rejection that names the wrong thing: upload
truncated-but-parseable prefixes of the source and binary-search for the line
range that flips PASS → FAIL, then ablate single statements inside it. Uploading
under the same `title` updates one draft instead of littering the account.

### Without `OffscreenCanvas`

`makeSurface()` returns `null` and the bit takes a plainer path that still works:
the picture is painted once straight to the canvas and kept as `ImageData`
before the mosaic ever covers it; each frame restores the rubbed bounding box
with `putImageData` and then lays the mosaic over everything *except* the rub
stamps, using an `evenodd` clip. Hard edges instead of a soft mask, no slide
animation between places, and stamps are capped at 700.

## Verified

Driven headless in Chromium against a mock `ctx`: all nine places paint and
reveal, consecutive frames differ (the mosaic really is animating), vigorous
horizontal rubbing never pages, a swipe on a cleared picture does, dot jumps
work, clearing fires `milestone` and `setProgress`, and a mid-session viewport
change re-layouts — with no runtime errors at any stage.
