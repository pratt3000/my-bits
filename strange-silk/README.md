# Strange Silk

A mobile-first [Plethora Bit](https://create.plethora.studio) — tens of
thousands of particles falling through a chaotic flow. Drag a finger and you
push the silk itself around: particles are shouldered aside and dragged with
your hand, then the attractor pulls them back. The same drag is bending the
equation underneath, because the screen doubles as a map of the flow's two
parameters. Hold still and the picture keeps developing like a long exposure;
tap the name and one attractor visibly transforms into the next.

Eight attractors: **Aizawa, Lorenz, Thomas, Halvorsen, Rössler, Burke–Shaw,
Dadras, Four-Wing**.

## How to play

- **Drag one finger** — push the silk. Particles within a fingertip's radius
  are shoved outward and carried along with the motion, and the flow heals the
  wake over the next second.
- The same drag bends the equation: left/right sets the first parameter,
  up/down the second. The position is absolute — the screen *is* parameter
  space, and a ring marks where you are in it.
- **Two fingers** — orbit the shape, pinch to zoom, twist to roll.
- **Tap the name** — morph into the next attractor.
- **◈** cycles four palettes, **♪** mutes, **?** explains.

## Files

| File            | Purpose                                                           |
| --------------- | ----------------------------------------------------------------- |
| `plethora.json` | Manifest (`plethora-bit@2`, runtime global `window.plethoraBit`).  |
| `main.js`       | The entry source (`entry: "main.js"`).                             |

## How it works

**Simulation.** Up to 60,000 particles are integrated with an inlined midpoint
(RK2) step, one flat typed-array loop per attractor — the derivative runs
~120k times a frame, so a shared per-particle callback was not worth its call
overhead. Seven of the eight cost 1–2 ms per frame for the full 60k. Thomas
needs six `Math.sin` calls per particle and costs ~5 ms, so it runs one substep
at double `dt`; its attractor's extent is identical either way, measured across
its parameter range.

**Seeding — why there is a pool.** A ball of particles takes a long time to
*fall onto* an attractor. Measured against a reference trajectory, Aizawa needs
around ten thousand integration steps before 98% of a cloud is actually on the
attractor — at two steps a frame that is a minute and a half of watching a
featureless blob. So each shape's first appearance is bootstrapped: 64 walkers
run until they are provably on the attractor, then get snapshotted repeatedly to
harvest 6,000 points that already lie on it, and the cloud is seeded from those.

Snapshots have to be spread over *thousands* of steps rather than consecutive
ones. Sampling 64 walkers back-to-back covers a sliver of arc, and a cloud
seeded from that moves as one dense clump instead of a whole attractor.

Pools are built at each shape's mid parameters and cached, costing one ~30 ms
hitch the first time a shape is chosen. Dragging then carries the cloud
anywhere in parameter space on its own.

**Touch is a force, not just a coordinate.** The first build mapped a finger
only to the two parameters, and on a phone that read as nothing happening: the
shape did change, but there was no local response under the fingertip and the
auto-framing quietly absorbed much of the rest. Now the finger is unprojected
onto the plane through the cloud's centre facing the camera — the rotation
matrix is orthonormal, so its inverse is just its transpose — and every particle
within a radius gets a radial shove plus advection along the finger's motion,
both falling off as `(1 - d/r)²`. The attractor does the healing for free.

**Input binds to the container, not the canvas.** Listening on the canvas alone
assumes the bit's own surface is the top-most thing under the touch, which is
not the bit's call to make — the host stacks the container, and an overlay or a
host-side layer above it silently eats every gesture. Events bubble to
`ctx.container`, so the listeners sit there and the control chips are excluded
by walking the target's ancestors instead. Both `PointerEvent` and `TouchEvent`
are handled, whichever family fires first claiming the session, so a WebView
that delivers only touch events still works. `offsetX` falls back to `clientX`
for the same reason — it is not reliably present on touch-derived events.

**The transformation.** Because a pool of on-attractor points exists, changing
shape is a real morph rather than a cut: the old cloud is normalised into the
new attractor's scale, then every particle glides to a point on the new shape
over 900 ms while the camera eases to that attractor's best angle. The opening
is the same move with a formless ball as its starting state.

**Trails are specified as a length, not a decay.** The silk is accumulation:
points splat additively into a buffer that only fades a little each frame, so
every particle drags a trail and roughly two million samples are lit at once. A
*fixed* fade cannot work across these shapes — Lorenz crosses its own attractor
about three times faster per frame than Aizawa, so the same decay that draws
silk for one wraps the other in featureless haze. Instead the bit measures how
far particles actually travel each frame as a fraction of the cloud's own width,
and solves for the decay that keeps every trail ~0.42 cloud-widths long. That
also makes it frame-rate independent, and each shape's `dt` is tuned so they all
travel at a comparable pace to begin with.

**Auto-framing.** Every frame samples the cloud's mean and variance to keep the
shape filling the frame as parameters deform it. Particles that wander further
than 4.5 attractor-radii *from the tracked centre* are recycled onto the
position of a living particle — recycling from the seed instead would streak a
comet across the picture. The test must be centre-relative: an origin-relative
bound lets strays orbit outside the shape forever without ever escaping, which
drags the framing outward until the attractor renders as a speck inside a haze.
Lorenz and Rössler, whose attractors sit well away from the origin, showed this
plainly.

**Rendering.** Raw WebGL, no dependencies and no extensions, so WebGL1 devices
are fine: a fade quad and additive points into an RGBA8 accumulation target, a
quarter-res separable blur for bloom, then a composite that tone-maps the sum
with `1 - exp(-c·exposure)` and a soft vignette. Colour is a four-stop gradient
walked by view depth, so it flows across the shape as it turns. If a WebView
offers no WebGL context at all, a 2D-canvas fallback runs the same simulation
with colour-bucketed additive dots.

**Device tuning.** Particle count is measured, not assumed. The test is *work
done per frame*, not the frame delta — a device comfortably holding 60 fps and
one exactly saturated both report ~16.7 ms between frames, so tuning on the
delta alone would never grow the cloud on any healthy device. Two consecutive
slow windows are required before shedding particles, and bloom can come back
once things recover.

**Audio starts from any gesture.** Mobile hosts only unlock audio inside a user
gesture, and the first build hung `ctx.music.play()` off a canvas `pointerdown`
alone — so a device that never delivered that event was both unresponsive *and*
silent, from one cause. Every control tap now counts as the opening gesture too,
and the attempt is retried on each subsequent gesture, since a host can refuse
the first one while backgrounded. The help panel carries a small diagnostics
line — renderer, particle count, input family, audio state — so a silent or
unresponsive device can be diagnosed without a console.

**Sound.** Each attractor carries its own `ctx.music` preset, scale and tempo,
so switching shapes genuinely changes the music — Aizawa is `ambient` in lydian,
Thomas a `drone` in whole tones, Four-Wing `bubble` in blues. The bed's
intensity is wired to the measured swirl rate of the flow, so dragging into a
violent corner of parameter space is something you hear as well as see.

## Contract notes

Built against agent context **`plethora-agent-context-2026-07-10.2`** using only
the documented `ctx` SDK surface:

- Permissions: `backgroundMusic` (the bed and stings), `haptics`, `storage`
  (remembers your shape, palette and mute). Every gated call is guarded by
  `ctx.capabilities` and wrapped so a backgrounded host can't break the visual.
- No dependencies, no packaged assets (`maxAssets: 0`) — the shapes, the colour
  and the sound are all generated at runtime.
- Surfaces via `ctx.createCanvas` / `ctx.createRoot`; listeners, frames and
  music all go through `ctx` so the runtime owns cleanup.
- Pointer positions come from `event.offsetX` / `offsetY`, falling back to
  `clientX` / `clientY`. The upload validator rejects
  `canvas.getBoundingClientRect()` — with a message about remote resources that
  gives no hint layout access is the cause — and offsets are already
  canvas-relative anyway, skipping a forced reflow per pointer move.
  `document.createElement` is only ever called with a literal `"div"` or
  `"button"`; the validator rejects it for `"canvas"`. The whole source passed
  the real validator on the first upload attempt.
- No blank first frame: the cloud is seeded, framed and drawn once before
  `ctx.platform.ready()`.
- Controls sit at the top inside `ctx.safeArea.top`, leaving the bottom of the
  screen clear for the hand that is dragging.

## Uploading a draft

Publishing is intentionally manual. To upload as a draft, an agent pairs with
the creator at <https://create.plethora.studio/agent-pair>, then `POST`s
`{ source, manifest }` to `/v1/agent/bits/drafts` (API origin
`https://api.plethora.studio`) with an `Authorization: Plethora-Agent <token>`
header. See the agent context for the full pairing flow.
