# Umbra

A mobile-first [Plethora Bit](https://create.plethora.studio): a climbing game
played entirely on shadows.

Built from a projector installation by maker artist Tee Ken Ng, where blocks on
a turntable throw shadows on a wall and the shadows are the platformer level.

## The idea, kept honest

Nothing here is drawn as a platform and then animated. Every object on the rack
is a real convex polyhedron with real vertices and faces. Each frame it is spun
by an axis-angle rotation matrix, projected flat, and the **convex hull of that
projection is both what you see and what you collide with**. The lamp is a
parallel source down the z axis onto a wall at z = 0, so the shadow is exactly
the silhouette: drop z, take the hull. That is free, and it means the geometry
cannot drift away from the picture.

So a ledge narrows because the slab casting it has turned edge-on, and it tips
you off because the shadow genuinely tipped. Standing on something that is
turning carries you, computed by running the contact point back through the
previous frame's rotation.

## Files

| File            | Purpose                                                          |
| --------------- | ---------------------------------------------------------------- |
| `plethora.json` | Manifest (`plethora-bit@2`, runtime global `window.plethoraBit`). |
| `main.js`       | The entry source — solids, rack, physics, renderer, sound.        |

## The rack

Six objects, and what each does as a platform falls out of its geometry rather
than being authored:

| Object | Axis | What its shadow does |
| ------ | ---- | -------------------- |
| **slab** | upright | A rectangle whose width breathes between its length and its own thickness |
| **drum** | upright | A 20-gon: width steady to within 0.74 units, so it is always safe |
| **tee** | upright | A lid on a stem — the red T from the installation |
| **beam** | in-plane | A bar sweeping like a clock hand |
| **wedge** | in-plane | A ramp, then a point, then a ledge again |
| **rod** | upright, tilted | The dowel: a long diagonal that sweeps to a sliver |

Turning a box about its upright axis cannot change its vertical extent, so a
slab, drum and tee have tops at a fixed height whatever the angle. Turning one
in the plane of the wall swings its top by most of its length. **The climb is
built only from the first kind**, which is what makes it possible at all; the
swinging ones hang off to one side as a shortcut if you dare and scenery if you
do not.

## Spacing is derived, not guessed

The generator does not carry numbers of its own. It asks the jump:

```
APEX      = jump² / 2·gravity
RISE_MAX  = APEX · 0.70
reachAt(rise) = how far you can lean while still above `rise`, × 0.62
```

Raise `jump_speed` in the tuning and the footholds move apart to match. A
creator cannot tune this into a climb nobody can make.

## Three things that made it playable

Measured, each time, with a bot that reads the live state and plays the same
frames the physics sees.

1. **Footholds were spaced by piece centre.** A beam's top swings seventy-five
   units, so "the next ledge" was routinely nowhere near where the spacing
   assumed. The bot was grounded for 19 frames out of 4,700. Building the climb
   only from constant-height objects took the median from 7m to 14m.
2. **The jump arc did not match the spacing.** A 0.75s airtime at 240 u/s
   carries 180 units sideways while footholds sat 64 apart, so every leap
   overshot and the only way to land was to stop steering. Slowing the lean and
   widening the stride until the arc fitted the gap.
3. **The player was braining itself on the ledge it was aiming for.** A frame
   trace showed an apex of 99 units where the physics says 128: clearing a ledge
   needs rise + thickness + your own height, and the next foothold sits directly
   overhead. Footholds are now one-way — you rise through them and settle on top.
   **Median 14m → 113m.** The swinging shapes stay solid, because being swatted
   off by a turning bar is the point of them.

## Everything is drawn

`maxAssets` is 0, so nothing is loaded.

- **Shadows** get a penumbra from two swollen copies of the same hull at
  different weights — cheaper than a blur, and one ring alone read as a hard
  grey outline rather than a soft edge.
- **The solid** is drawn faintly inside its own shadow: back-faces culled,
  each face shaded by how squarely it faces the lamp. Loud enough to say there
  is a real red object here, quiet enough that the ledge still reads as dark.
- **Sound** is a small WebAudio board.

## Contract notes

- Runtime `plethora-bit@2`, SDK 1.5.7, manifest schema 1, no dependencies.
- Permissions `audio`, `haptics`, `storage` — nothing else is touched.
- The HUD is a `ctx.createRoot({ input: "passthrough" })` overlay that also
  declares `pointer-events:none` in its own CSS, so a finger dragged across the
  score still steers.
- **Controls are delegated**: one listener each on the button bar and the menu
  card, registered once for the life of the Bit.
- `manifest.onboarding` is `guided`: three steps.
- **No `manifest.game.progress`.** A climb is a climb; there is nothing to resume.

## Leaderboard

One record channel, `best_height`: metres climbed, submitted at the result.

## Verified

**Geometry, against closed forms rather than eyeballing.** A box 100×20×40 spun
about its upright axis must silhouette to a rectangle of width
`|100cosθ| + |40sinθ|` and height 20 — asserted at eight angles, exact to 1e-9,
with the width sweeping 100 → 40. A box spun in-plane conserves its area to
1e-6. An n-gon drum's width swings by exactly `2r(1 − cos(π/n))` — asserted for
both 12 and 20 sides. Every hull comes back counter-clockwise, which the
collision normals depend on, and strictly convex with no collinear points.

**Play**, ten runs of a bot that aims for the lowest foothold above it and
anticipates its own momentum: 41m / 113m median / 212m, no run trapped in
geometry, no page errors.

**At 390×800, 360×640 and 844×390**: nothing overflows, no touch target under
40px, `elementFromPoint` at the centre of the screen *and* over the score
readout both return the canvas during a live run, and zero per-element input
activations are ever registered. Update costs 0.04–0.13ms a frame and render
0.06–0.17ms.
