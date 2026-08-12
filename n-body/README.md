# N-Body

Gravity you can throw.

Press and hold anywhere — a world appears and gains mass for as long as you hold
it. Drag outward and the mass locks, the world stays put, and you aim: the line
shows where it will go, the first tick on it is a circular orbit and the second
is escape velocity. After release nothing is scripted. Every body pulls on every
other body, and the orbits, captures, slingshots and collisions are just what
that force law does.

```
n-body/
  plethora.json   # manifest
  main.js         # entry, defines window.plethoraBit
  README.md
```

## The simulation

- **Direct summation.** Accelerations come from every unordered pair, O(n²),
  with a softening term so a very close pass cannot launch a body to infinity
  between steps. Softening is small next to real separations, so ordinary orbits
  are untouched.
- **Leapfrog, kick-drift-kick.** Symplectic, so orbits stay closed instead of
  winding in or out from integrator error. A fixed 1/150 s step with an
  accumulator and a 5-substep ceiling keeps the physics frame-rate independent
  and stops a slow frame from cascading.
- **Contact merges** are perfectly inelastic: momentum is conserved exactly, and
  the kinetic energy that goes missing is what the flash and the impact sound
  are scaled by. Merging is also what makes mass accumulate, so a busy system
  simplifies itself instead of grinding to a halt at the body cap.
- **Ignition.** Above 850 mass units a body becomes a star, and the brightest
  star in the scene becomes the light source for everything else.
- `G = 2200` in world units of CSS pixels, with suns of 2500–3200. A planet
  ~180px out comes round in about six seconds. The first pass ran at `G = 1400`
  and lighter suns, which read to a player as the sun's gravity being too weak:
  ordinary throws sailed off instead of curving.
- `MERGE_FACTOR` is 0.72 of the touching radii rather than 0.86, so bodies have
  to genuinely overlap. At 0.86 they swallowed each other on approach and the
  slingshot never got a chance to happen.

## Feel

- **Aiming is static.** The first version threw on the finger's own velocity,
  and that made the trajectory preview useless: you could not study the preview
  and then release, because holding still to look sets the velocity to zero. The
  world now stays where you first touched — which also keeps your finger off it
  — and the drag vector sets the launch.
- **Speed is quoted in circular orbits, not pixels.** A drag of `AIM_REF` (96
  screen px) launches at exactly the local circular-orbit speed, wherever you
  happen to be standing, so an ordinary drag produces an orbit instead of a
  lucky one. Within 13% of that speed and 13° of the tangent it snaps to a clean
  circle and the preview turns gold. Velocities are built in the attractor's
  frame, so aiming still works around a star that is itself moving.
- **The preview says whether it comes back.** Bound or not is the two-body
  specific orbital energy `v²/2 − GM/r` against the dominant attractor, which is
  exact and free; the path is drawn solid when that is negative and dashed when
  it is not.
- **Mass locks when aiming starts**, otherwise a careful aim silently buys you a
  heavier world than a careless one.
- Nurseries are stored in screen space and converted to world space when read —
  the camera drifts while you hold, and a world-space nursery would slide out
  from under a stationary finger.
- **Phase shading.** Shading is a function of position on the unit disc, so one
  sprite serves every body at every size: it is baked once and rotated toward
  the star when drawn. That rotation is what gives planets real phases as they
  come round.
- **The camera** frames the system on a mass-weighted RMS radius, so an escapee
  moves the shot but cannot dominate it, and the lerp is slow enough to read as
  a held shot rather than a zoom. Bodies past 2600 units from the centre fade
  out and are culled.
- **Sound** is a `ctx.music` "drift" bed plus bespoke voices on a raw
  AudioContext: a pluck on spawn pitched by mass, a thump-and-shatter on merge
  scaled by impact energy, a swell on ignition, and a whoosh on close approach.
  Everything is quantised to A minor pentatonic so it agrees with the bed. The
  flyby whoosh fires on a *local minimum* of each body's nearest-neighbour
  distance — proximity alone would drone continuously on any tight binary.

## Contract notes

No dependencies and no packaged assets: every planet texture, the starfield and
all audio are generated at runtime. Bakes go to an `OffscreenCanvas` via
`makeSurface()`; where a WebView has no `OffscreenCanvas` that returns null and
every bake site degrades to drawing live — flat discs, no starfield, no glow.
Plainer, fully playable, never blank. Both paths are verified.

### What the upload validator rejects

Carried over from Cairn and Perfect Drop, and observed again here — none of it
is in `sdk.md`:

- **`document.createElement("canvas")`** → *"Direct document/body access is not
  allowed. Use ctx.createCanvas()."* `ctx.createCanvas()` is not the fix for
  offscreen work; it mints a display surface the runtime mounts in the
  container. `OffscreenCanvas` is accepted.
- **Building the overlay with `document.createElement`** → the same rejection.
  The overlay is markup on `ctx.createRoot()` with `data-el` handles queried
  back out.
- **`getBoundingClientRect()`** → *"This bit uses unsupported remote
  resources…"*, which says nothing about layout access. `event.offsetX/offsetY`
  are already canvas-relative and skip a forced reflow per pointer event.
- Timers go through `ctx.timeout`, and nothing writes the canvas `filter`
  property (it also accepts `url(#…)`).

### Performance

Fill rate, not JavaScript — a CPU profile of the busiest scenario put ~97% of
samples in native rasterisation and under 3% in the bit's own code. The
background is therefore baked at exactly the canvas DPR and blitted at whole
device-pixel offsets; baking it smaller and letting `drawImage` stretch turned
the per-frame clear into a full-screen bilinear resample, which cost about a
third of the frame budget at DPR 3. Halos below a couple of pixels are skipped
rather than drawn, since a sub-pixel halo still costs a full additive blit.

Halo size is clamped on screen as well as in world units. A runaway merge makes
a star whose proportional halo covers most of the display, and one additive blit
that size cost more than everything else in the frame combined — it was worth 6
fps on its own with only three bodies alive.

Measured headless with software rasterisation only (no GPU in the container),
43-body disc scenario: 60 fps at DPR 1 and 2, ~40 fps at DPR 3, up from 28 fps
before the blit fix. A real device composites the canvas on the GPU.
