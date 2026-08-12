# Mandelbrot

Pinch to fall into the set. Every zoom reveals another level of complexity, and
there are 68 of them.

The zoom is the whole bit, so the engineering is all in service of one promise:
that pinching again always shows you something new.

## Why this is not a for-loop over pixels

The obvious renderer — map each pixel to a complex number, iterate
`z → z² + c`, colour by how long it took to escape — dies almost immediately
under a finger:

| precision | dies at | levels of zoom |
| --------- | ------- | -------------- |
| GPU `float32` | ~10⁵ | 17 |
| JS `double` | ~10¹³ | 44 |
| this bit | ~10²⁰ | **68** |

At 10¹³ the pixel step drops below the spacing of representable doubles, and
neighbouring pixels start landing on the *same* complex number: the picture
turns into flat rectangles. Seventeen levels is about four seconds of pinching.

So the picture is built by **perturbation** instead, which is how the deep-zoom
renderers do it:

1. The CPU iterates exactly one orbit — the view centre `C` — in
   **double-double** arithmetic: two doubles whose exact sum carries ~32
   significant digits, built from Dekker/Knuth two-sum and two-product (no FMA
   in JS, so the products are done by splitting). That is the reference orbit
   `Z_n`.
2. Every pixel is `c = C + δc` with `δc` tiny, and the *difference* orbit obeys
   `δz' = 2·Z·δz + δz² + δc`. That recurrence is **relatively** stable — signal
   and rounding error are amplified by the same factor each step — so the GPU
   runs it in plain `float32` even when `δc` is 10⁻³¹.
3. Reference orbits normally *glitch* where a pixel's orbit strays far from the
   centre's, which is usually patched with Pauldelbrot's criterion plus a whole
   tree of secondary references. This uses **rebasing** (Zhuoran) instead:
   whenever `|Z_m + δz| < |δz|`, reset `m` to 0 and fold the full value back
   into `δz`. One reference then covers the entire screen, glitch-free, with no
   bookkeeping.

The reference orbit is stored as `float32` in an `RG32F` texture. That sounds
like it should destroy everything the double-double bought, and it does not:
rounding each stored `Z_n` adds an independent ~10⁻⁷ nudge, which perturbation
absorbs as a *relative* error, whereas computing the orbit itself in low
precision would let chaos compound it. Measured against a double-double ground
truth at magnifications from 10³ to 10¹²:

| | mean colour error vs exact |
| --- | --- |
| `float32` stored reference | **3.33** / 255 per channel |
| `double` stored reference | 3.22 / 255 per channel |

The two are the same to within noise, so the texture stays half the size. What
remains is `float32` delta arithmetic on chaotic filaments, which is the normal
price of a GPU fractal.

### The derivative is carried in pixels

Distance estimation needs `dz/dc`, which at 10²⁰ magnification overflows
`float32` long before the orbit escapes. Carrying `dz/dpixel` instead — the
same quantity scaled by the pixel step, so the recurrence gains `+s` instead of
`+1` — keeps it between 10⁻³¹ and about 10³ for the whole run. It cannot
overflow, and it is exactly what the distance estimate wants anyway:
`DE = |z|·log|z| / |dz/dpixel|`, already in pixels. That is what draws the
antialiased filaments and the glow along them.

### Underflow, and why the rebasing test avoids squares

`δz` legitimately reaches 10⁻³¹. Squaring it gives 10⁻⁶², which is not a small
`float32` — it is zero. So the rebasing comparison `|z|² < |δz|²` silently
becomes `something < 0` and never fires. The test is done in Chebyshev norm
(`max(|x|, |y|)`) instead, which never squares and so never underflows. Escape
is still tested on `|z|²`, where `z` is order 1 and the arithmetic is safe.

## Iterations are measured, not guessed

Escape times near the boundary grow with depth, and a starved view does not
degrade gently — it goes **solid black**, because every pixel that has not
escaped by the cap is indistinguishable from set interior. A first attempt with
a hand-fitted iterations-per-level curve produced exactly that at level 45.

Sampling real locations gives the growth law:

| level | 10 | 28 | 40 | 46 | 60 |
| ----- | -- | -- | -- | -- | -- |
| escape time (99th pct) | 452 | 1 470 | 2 463 | 4 802 | 12 924 |

which is `≈ 220 · 2^(level/10)`. Rather than bake that in, the bit **measures
the view it is actually looking at**: before each settled render it runs the
same perturbation loop over a 17×17 grid on the CPU (a few ms) and takes the
99th percentile escape time. That is the budget, wherever you happen to be. If
nothing escapes at all — a lake — more iterations cannot help, so it drops to a
cheap 900 and lets the interior shading do the drawing. Between settles the
budget rides the growth law above so a fast dive does not outrun it.

12 000 is the ceiling, which the curve reaches around level 62; the dive stops
at **68** while the picture still has something to show rather than quietly
fading to black.

## Rendering while you move

A deep frame is billions of pixel-iterations and takes seconds. Interaction
cannot wait for it, so three things are on screen at once:

- **A coarse live render**, whose *resolution* — never its iteration count —
  drops as depth rises, holding pixels × iterations roughly constant. Capping
  iterations instead is what produces the black rectangle described above;
  blocky-but-true is always better.
- **The last sharp frame, reprojected.** A pan, zoom and twist of the view is
  an affine transform of the previous image, so it is re-shown under the
  gesture through that transform, clipped where it has no data. This is what
  makes a pinch feel like moving a picture instead of watching one rebuild.
- **The sharp image, in horizontal bands**, rendered a few per frame so the
  phone never has to finish a deep frame in one go. It sweeps down the screen,
  then a second pass runs the same bands offset by half a pixel and averages
  them, taking the speckle out of dense filament country. The band count adapts
  to measured frame time.

## Sound

The bed is `ctx.music` (`drift`, hirajoshi) whose intensity rises with depth.
Everything else is synthesised.

**Press and hold and the point under your finger sings.** Its orbit — the
literal sequence `z → z² + c` — is loaded into a wavetable, one cycle of the
attracting cycle if it has one. So the timbre *is* the dynamics: a period-2
bulb gives a two-lobed wave, a period-3 bulb a three-lobed one, and the chaotic
boundary has no period at all and comes out gritty. Points outside the set get
a short bright ping whose pitch reports how fast they ran away.

Pitch is quantised to a scale by where your finger is, so sliding around plays
notes while the fractal chooses the tone colour. The orbit is drawn into the
minimap at the same time, where you can watch it bounce around the whole set —
which is where it actually goes, far outside the view you are zoomed into.

Crossing a level rings an inharmonic bell (partials at 1, 2.76, 5.4) a step up
the scale, with a haptic tick.

## Files

```
mandelbrot/
  plethora.json   # manifest: four permissions, one leaderboard channel
  main.js         # the whole bit
  README.md
```

## Contract notes

- Permissions: `audio` (WebAudio synthesis for the orbit voice and bells),
  `backgroundMusic` (`ctx.music` bed), `haptics`, `storage` (palette, sound
  setting, personal best).
- Memory: one `records` channel, `deepest_level` — how far down you got.
- No dependencies and no packaged assets. There is no fractal library in the
  registry and the renderer is a purpose-built shader anyway, so everything
  here is generated: geometry, colour, minimap and audio.
- **No WebGL2, no problem.** If the context or the shaders fail to come up, the
  bit falls back to a plain 2D canvas with a JS escape-time renderer,
  progressive by rows, capped at 10¹² magnification. Blockier and shallower,
  fully playable, never blank.
- **Touch events drive the gestures; pointer events only drive mouse and pen.**
  This started as pointer-events-only, which worked perfectly in a desktop
  browser and did not pinch on a phone. iOS reserves the two-finger pinch for
  zooming the page and takes it regardless of `touch-action`, firing
  `pointercancel` at the first finger as the second one lands — so the bit was
  left holding one live pointer and quietly fell back to panning. Only
  `preventDefault()` on a raw `touchmove` (plus swallowing the iOS-only
  `gesture*` events) actually stops it. On a touch device the pointer handlers
  ignore `pointerType === "touch"` so nothing is handled twice, and a stray
  `pointercancel` can no longer tear down a gesture the touch path owns.
- Gesture state is reconciled against `event.touches` on every touch event
  rather than trusting `touchend` to arrive. One swallowed release would
  otherwise leave a phantom finger behind, after which a one-finger drag reads
  as a pinch against a finger that is not there.
- Touch coordinates need the canvas origin, and `getBoundingClientRect()` is
  rejected by the validator, so the origin is learned from any pointer event
  (which carries both `offsetX` and `clientX`) and assumed to be the viewport
  corner until one arrives.
- **Interaction timing runs on the wall clock, not accumulated frame time.**
  `dt` is clamped for the smoothing filters, and a deep frame can take 100ms+,
  so a timer fed by `dt` runs slow exactly when the renderer is busiest:
  press-and-hold measured out at nearly a second at 8fps instead of the 260ms
  it asks for. Tap detection has no duration test at all — event timestamps are
  processing times, so a genuine 80ms tap can arrive looking like a 300ms
  press. A tap is simply "went down and came up without moving or becoming a
  listen".
- `document.createElement` is only ever called with a literal `"div"` or
  `"button"`; the validator rejects a computed tag. The minimap bakes through
  `OffscreenCanvas`, with a drawn silhouette as the fallback.
