# Boids

A murmuration of a few thousand birds, running on nothing but Reynolds' three
rules. Your finger is a predator they scatter and split around, or an attractor
they wind into a glowing vortex.

```
boids/
  plethora.json   # manifest
  main.js         # the whole bit
  README.md       # this file
```

## What it does

- **Flocking.** Every bird steers by separation, alignment and cohesion against
  its neighbours only. Nothing choreographs the flock; the shapes it makes are
  emergent.
- **Predator (🦅).** Birds flee the finger, opening a cavity that closes again
  behind it. A dark core with a warm rim is punched through the flock.
- **Attractor (✨).** Birds fall into orbit and wind up into a vortex with a
  hole in the middle. Two fingers make two vortices and a spiral between them.
- **Panic contagion.** Fear is per-bird state, inherited from the most
  frightened neighbour each frame. Scare one corner and the alarm crosses the
  flock as a visible wave, seconds after you let go.
- **Idle life.** With nobody touching it, the flock startles on its own every
  9–22 seconds, so it is never a static screensaver.

Multi-touch throughout: every live pointer is its own predator or attractor.

## How it works

**Spatial hash, not all-pairs.** Neighbour lookups are the whole cost of boids —
naively it is O(n²), which caps you at a few hundred birds. Each frame the flock
is counting-sorted into a uniform grid whose cell size *is* the perception
radius, so a bird only scans the 3×3 cells around it. The sort is O(n) with zero
allocation: `cellStart` offsets plus a `cellItems` index array, reused every
frame. That is what buys thousands of birds instead of hundreds.

**Separation is an acceleration, not a steer.** Textbook Reynolds normalizes all
three rules, which means separation pushes just as hard with one neighbour as
with forty — so the moment a flock tightens, cohesion wins and it collapses into
a single dense knot. Here separation accumulates `SEP_R/d - 1` per close
neighbour, zero at the edge of personal space and unbounded as `d → 0`, and is
applied directly as acceleration under a cap. Crowding pushes back in proportion
to how crowded it is, which gives the flock a resting density and lets it fill
the screen.

**The roost is measured in screen-normalized units.** A wandering point pulls
birds back only once they stray outside a loose ellipse. Measuring that boundary
in pixels settles the flock into a circle the width of the short edge; measuring
it as a fraction of `W/2` and `H/2` lets it fill a tall phone.

**Fear is double-buffered.** `fear` and `fearNext` swap each frame. Without two
buffers, contagion order-dependently races across the whole array in a single
frame and the wave disappears. The inherited value is damped to 0.965 — high
enough that a wave survives crossing the screen, low enough that it dies out.

**The attractor's pull outreaches its push.** The radial term flips sign at the
orbit radius so birds inside are pushed out and birds outside fall in. Giving
both the same cutoff radius makes the attractor *hollow out a cavity* instead of
forming a vortex: anything near the centre is expelled past the cutoff and then
nothing draws it back. The inward reach is ~4× the orbit radius.

## Rendering

- **The canvas never clears.** It erases toward transparency with
  `destination-out`, so trails decay over a CSS gradient sky rather than over a
  flat fill. Fading toward a dark colour instead leaves a residue floor from
  8-bit rounding, and repeated alpha fills band the gradient.
- **Birds are drawn additively**, so dense clusters bloom for free — no blur
  pass, no second buffer. The cost is that additive ink clips wherever birds
  pile up, and trail persistence multiplies it: equilibrium brightness is
  roughly per-frame ink over the fade rate. Both numbers are kept modest or
  dense knots go pure white and the flock loses its colour.
- **~150 stroke calls, not ~3000.** Birds are counting-sorted a second time into
  buckets of (depth tier × hue × brightness). Each non-empty bucket is one
  `beginPath`/`stroke` over all its members. Per-bird strokes would dominate the
  frame.
- **Colour is heading**, cycled through six luminous anchors. This makes
  alignment legible: birds flying together *are* the same colour, so coherent
  domains visibly form, shear and mix. Frightened birds go hot but keep their
  hue — pushing them to full white loses the flock's colour exactly when it is
  most alive.
- **Depth** is a per-bird `z` driving stroke width, alpha and a little speed.

Measured in Chromium at 390×780, DPR 2, software rendering: **3.4 ms p50** for
sim + draw with ~2250 birds, p95 4.1 ms. A rolling frame-time average trims the
population up to three times on devices that cannot hold it, rather than letting
the whole thing judder.

## Contract notes

- No dependencies, no packaged assets (`maxAssets` is 0). Sky, birds, colour and
  the wind bed are all generated at runtime.
- **`ctx.createRoot({ style })` does nothing.** `touchAction` and `className`
  are read; a `style` object is not. Set root styles by mutating the returned
  element, the way every other bit here does. This one cost a round trip to
  device: the UI root kept `pointer-events: auto`, so it sat over the canvas as
  a full-screen transparent sheet and swallowed every touch. The flock still
  simulated, drifted and startled itself perfectly happily — it just could not
  see a finger, and nothing errored.
- `document.createElement` is only ever called with a **literal** `"div"` or
  `"button"`. A computed tag can't be statically shown not to be a canvas or
  script, and the upload validator rejects it.
- Pointer coordinates come from `event.offsetX/offsetY`, which are already
  canvas-relative. Reading the canvas rect for coordinates is rejected by the
  validator, and offset\* skips a forced reflow per pointer event anyway.
- Timers go through `ctx.timeout`; every listener through `ctx.listen`.
- Permissions are `audio` (the wind bed is a WebAudio brown-noise source through
  a bandpass whose gain and cutoff track the flock's mean fear),
  `backgroundMusic` (`ctx.music` drift bed, started from the first gesture),
  `haptics`, and `storage` (remembers your mode).
- First frame is drawn after 40 warm-up steps so the flock has organised before
  `ctx.platform.ready()` — it opens as a murmuration, never as noise and never
  as a blank screen.
- Help is opt-in behind the `?` button. A sheet auto-opening over the flock on
  first load buries the one thing worth showing.
