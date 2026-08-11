# Pixel Fog

Nine views of San Francisco. Tap one to open it, then rub it with a finger — a
living mosaic of that same picture blooms wherever you touch. Rub most of it
away and the whole view gives itself over to pixels.

## The nine views

| Tile             | What it is                                                        |
| ---------------- | ----------------------------------------------------------------- |
| Golden Gate      | The bridge at sunset, fog snagged around the tower feet.           |
| Downtown Dusk    | The skyline across the bay — Salesforce Tower, Transamerica.       |
| Painted Ladies   | The Alamo Square row, warm windows, downtown hazy behind.          |
| Coit Tower       | Telegraph Hill at midday, Alcatraz out in a bright blue bay.       |
| Bay Bridge       | The west span lit up after dark, cable lights doubled in water.    |
| Karl the Fog     | Dawn ridges receding, fog rivers pooling between them.             |
| Hyde Street      | A steep street in one-point perspective, cable car climbing.       |
| Sutro Tower      | The three-pronged lattice standing above a sea of fog.             |
| Ocean Beach      | The sun going into the Pacific over wet, mirroring sand.           |

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
ridges built from stacked sine octaves, seeded scatter, and hand-placed
landmark geometry. Each scene is a pure `paint(g, W, H)` function driven by a
seeded PRNG, so it composes identically at any size — the same code paints a
110 px tile and a 363 px picture.

## How the reveal works

Two layers and a mask, rebuilt per frame:

1. The chosen scene is baked once to an `OffscreenCanvas` at the picture size.
2. That bake is read back **once** with `getImageData` and averaged into a fine
   colour grid (~11 CSS px blocks) plus a coarse grid folded down from it 3×3.
   Every shade string each cell can use is pre-built at the same time, so the
   frame loop never does string work per cell.
3. Rubbing stamps a pre-baked soft brush into a mask surface.
4. Each frame the mosaic is drawn into a scratch surface, `destination-in`
   composites the mask onto it, and the result is drawn over the crisp picture —
   so the mosaic appears only where you have rubbed, with soft edges.

The mosaic animates three ways at once: a slow diagonal wave fades the fine grid
in and out over the coarse one, so bands of coarseness travel across the frame;
each block breathes a little, so the grout lines between them pulse; and each
block drifts through six pre-built brightness shades on its own phase.

Cross the 88 % mark and a sweep fills the rest of the mask, the tile picks up a
gold dot, and `platform.milestone` fires. Revealing all nine calls
`platform.complete`.

## Contract notes

- Permissions: `backgroundMusic` (a `drift` bed plus tap/success stings),
  `haptics`, `storage` (which views you have already revealed).
- No dependencies, no packaged assets, no memory channels.
- Tile and picture share one computed aspect ratio, so opening a tile is a pure
  scale with nothing to distort. The aspect stretches toward the screen's height
  (capped at 1.6) — square tiles left a third of a tall phone empty.
- Layout re-derives from `ctx.width`/`ctx.height` compared each frame rather
  than a resize listener, and re-bakes the thumbnails and the open picture when
  they change.
- Thumbnails bake one or two per frame instead of all nine up front, so the
  first frame is a backdrop plus placeholders rather than a stall, and the grid
  develops in front of you. `platform.ready()` fires on that first frame.

### Working within what the upload validator rejects

Both constraints are inherited from `cairn/README.md`, and both are honoured
here:

- **`document.createElement("canvas")`** is rejected. Every offscreen surface
  goes through `makeSurface()`, which returns an `OffscreenCanvas` or `null`.
  `document.createElement` with a literal `"div"`/`"button"` is fine and is what
  the chrome uses.
- **`canvas.getBoundingClientRect()`** is rejected. Pointer positions come from
  `event.offsetX`/`offsetY`, which are already canvas-relative.

Timers go through `ctx.timeout`, and no canvas blur-filter property is used.

### Without `OffscreenCanvas`

`makeSurface()` returns `null` and the bit takes a plainer path that is still
fully playable:

- The nine tiles are painted live into the grid once rather than baked and
  blitted, and the grid repaints only when something changes.
- Opening a picture skips the zoom (there is no bake to scale) and paints
  straight into the frame, then captures it with `getImageData`.
- The reveal becomes a hard-edged clip built from the rub stamps instead of a
  soft mask, and each frame restores only the rubbed bounding box via
  `putImageData` — the backdrop is deliberately *not* repainted, so the rest of
  the picture survives untouched.
- The progress line is skipped on this path: with no per-frame backdrop repaint,
  a translucent bar drawn over itself every frame would accumulate to solid
  white.

## Verified

Driven headless in Chromium against a mock `ctx`: grid renders, all nine scenes
open and paint, rubbing reveals, consecutive frames differ (the mosaic really is
animating), the completion sweep fires `milestone` and `setProgress`, a
mid-session viewport change re-layouts and re-bakes, and back returns to the
grid — with no runtime errors at any stage.
