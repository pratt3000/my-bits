# Windmill Cove 3D

Mini golf you look around in. The sibling bit [`windmill-cove/`](../windmill-cove)
plays from a fixed overhead view; this one puts the camera in the world —
orbit around the ball, pinch out to survey the hole, pinch back in, aim by
looking, hit with a power pad. Three themed courses of nine holes, single
player, a fewest-strokes leaderboard per course.

## Playing it

The front door is a title screen — **Play** and **How to play**, over a slow
orbit of the first hole. Play opens the course list; the course list has a way
back. A round left part-way through surfaces as **Continue** on the title.


- **Drag one finger** to swing the camera around the ball. Where you look is
  where you aim — the arrow on the ground is your line. Aiming and looking are
  deliberately the same act, which is how the games this imitates do it.
- **Pinch** to zoom out and survey, pinch back in to line up. **Two fingers**
  pan the view off the ball. **🔭 Survey** jumps to the whole hole; **🎯 Ball**
  snaps back.
- **Press the SHOT pad and slide up** for power — the bar fills green → amber →
  red. Slide sideways on the pad to fine-tune the aim. Release to hit.

### The courses

| Course | Theme | Par | What it does to you |
| --- | --- | --- | --- |
| 🌲 Fernwood Heights | Forest | 29 | Tiered greens, windmills, a creek, a mill pond |
| 🏴‍☠️ Buccaneer Reef | Pirate | 32 | Causeways over water, cannon pads, sliding gates, a whirlpool |
| 🛰️ Orbital Deck | Space | 32 | Ice, gravity wells, a wormhole, a black hole, a long way down |

## What being 3D actually buys

Elevation is real, so **gravity does the work that hand-placed push zones did
in the flat version**. A ramp is a tilted slab; roll onto it too softly and you
come back down, commit to it and you crest — and past about 30 u/s you leave
the lip with the better part of a second in the air. None of that is scripted.
The flat game had to fake all of it.

The same goes for hazards: falling off is falling off, not a region test.

## Files

```
windmill-cove-3d/
  plethora.json   manifest: three@0.164.1, three record channels
  main.js         the whole bit
  README.md       this
```

## How it is built

**Physics knows nothing about rendering.** Everything above the
`window.plethoraBit` assignment is pure — no DOM, no WebGL, no Three. That is
load-bearing, not tidiness: it is what lets a headless harness pull out
`COURSES` and the solver and play all 27 holes in a second and a half.

**The solver** is sphere-versus-analytic-shape, sub-stepped by ball speed so a
hard shot cannot pass through a rail. Colliders are oriented boxes (two angles:
yaw turns a rail, tilt makes a ramp), vertical cylinders, and the moving
variants of both. Every contact resolves against a closest point with the
collider's own velocity folded in, which is what makes a windmill blade throw
the ball rather than merely stop it. Boxes go into a coarse XZ grid so a step
tests a handful rather than all of them.

**Holes are built from three helpers.** `plat` lays a platform with rails on
the sides you name — a side you leave out is where it opens onto the next one —
and `rampZ`/`rampX` climb between heights. A hole is a dozen calls.

**Nothing is fetched but Three.** No packaged assets. The checkerboard mowing
texture is drawn to an `OffscreenCanvas` at load, the flagstick and its barber
stripes are built from cylinders, and every sound is synthesised — the club
strike's pitch and body both track how hard you hit it. Scenery is instanced:
120 pines would otherwise be ~480 draw calls, and they are four.

### Two things that cost real time

- **The tangential scrub was applied on every substep.** A ball merely resting
  on the floor re-contacts every substep, so the "graze bleeds pace" term ate
  its speed and a 12 u/s putt stopped in a metre. It is now proportional to how
  hard the contact actually was.
- **Rest detection cannot be "velocity is zero".** At the apex of a bounce it
  genuinely is, for one frame. It has to be velocity zero *and* grounded.

### Verification

- A **headless playtester** loads the shipped file with a stub `window` and
  plays all 27 holes with hundreds of randomised cup-biased shots each,
  checking the tee is standing on something and the hole can be finished. It
  caught two authoring bugs: X-rising ramps placed between platforms the ball
  crosses in Z, so the tiers never connected, and a windmill whose blades
  spanned the entire causeway they guarded.
- A **physics bench** asserts the behaviours the game rests on: the ball settles
  at exactly its radius above the floor, rolls down a ramp under gravity alone,
  stays inside the rails, falls out of bounds off a ledge, and runs measurably
  further on ice than grass. It is also what showed the ramp climbing curve —
  roll back under 26 u/s, crest at 26, airborne past 30.
- A **browser test** drives real Chromium with a mock Plethora `ctx` and a
  locally served copy of the pinned Three build, orbits the camera, surveys,
  and plays shots through the pad, asserting no page or bit errors.

Both harnesses live outside the repo; the bit carries no test hooks.
