# Sketch Racer

Draw the longest road you dare, then drop into it and drive.

Drag one finger and a road unrolls under it, metering its own length as you go
— **but the road may not touch itself, and the stroke ends the instant it
does.** Hit RACE and the camera falls out of the sky, swings in behind the car
and follows it along every curve you drew until it crosses the chequered flag.

## The one rule

Without it there is no game. Laps can be laid on top of each other, so the
longest track is simply whoever scribbles the longest — no planning, no ceiling,
no reason to be careful. With it the score becomes *how much road you can pack
into one screen without the lanes meeting*, which has a real maximum (roughly
the drawable area divided by the road width) and rewards the thing the game is
actually about: laying out a circuit.

It also puts risk in every metre. The stroke keeps whatever it drew up to the
cut, so at 250 m you are deciding whether one more sweep is worth losing the
run over.

Mechanically: each new sample is rejected if it comes within `ROAD_W * 1.85` of
any earlier sample more than `SKIP_BACK` back along the path, tested through a
spatial hash so it stays O(1) as the track grows. The skip-back window is
derived from the road width rather than fixed — it has to clear the samples that
are adjacent by construction without also excusing a hairpin, whose two lanes
are about `pi * ROAD_W` apart along the path.

And the check walks the gap between pointer events rather than jumping it. A
`pointermove` can arrive hundreds of pixels from the last one on a fast flick;
taking that as a single sample both corners off the geometry and lets the stroke
leap clean over an earlier lane without the rule ever seeing it.

## Why 3D earns its place here

Because the fall is the point. You draw looking **straight down**, where a
perspective camera pointed at a flat plane behaves like an orthographic one:

```js
// Looking straight down from this height, the vertical field of view covers
// exactly the screen in world units, so one world unit is one CSS pixel.
camHeight = (H / 2) / Math.tan((FOV * Math.PI / 180) / 2);
```

What you draw is exactly what you get. Then the same camera eases to a chase
position and the flat sketch you just made becomes a road with a horizon. Two
views, one camera, no cheating — and it only works because the drawing view is
a real 3D camera that happens to be overhead.

The blend needs one non-obvious line, and getting its sign wrong is the bug
this bit shipped with:

```js
camera.up.set(0, k, -(1 - k));   // overhead needs -Z up, chase needs +Y
```

Straight down, `+Y` is degenerate as an up vector — `lookAt` has no way to pick
a roll — so the up vector has to be blended along with the position. But three
builds the basis as `right = cross(up, eye - target)`. With `up = +Z` and the
camera on `+Y`, that gives `right = -X` and screen-up `= +Z`, which mirrors
**both** axes: the road came out rotated 180 degrees from where it was drawn.
`-Z` is the up vector that puts screen-right on `+X` and screen-down on `+Z`,
matching `toWorldX` / `toWorldZ`. At `k = 1` it is `+Y` either way, so the chase
view never showed the fault.

At the flag the camera lifts and orbits, so the car you just drove is sitting
above the result sheet rather than hidden behind it.

## Look

three.js with a bright-pass → two separable blurs at quarter resolution →
additive composite with a filmic curve and grain. On top of that: a sky dome
with a warm band at the horizon and sparse twinkling stars, a ground grid that
uses `fwidth` for constant-width lines at any distance, glowing rails down both
edges of the road, a dashed centre line, and value-noise asphalt so the surface
has grain when the camera is right down on it.

The road, the grid and the sky all converge to the **same** haze colour with
distance. They have to: fade the ground to black and the horizon becomes a hard
line straight across the middle of the phone.

## Smoothing

A finger is not a spline. Three sources of jitter, three fixes:

- The raw samples wobble, so the path is filtered with **three binomial passes,
  ends pinned** — enough to take out the tremor without rounding off corners the
  player meant. Geometry, length, sampling and the flag all read the filtered
  path.
- `sampleAt` returns a heading that **steps** from one path segment to the next.
  Following it raw is what made the car twitch, so it is damped the short way
  round the circle.
- The camera was snapping to a chase point that itself moves with the car. It
  now eases toward it, on top of the dive blend.

The ribbon also needed one classic fix. Where the road turns tighter than it is
wide, the inside edge runs backwards and the ribbon folds — which renders as a
bright chevron of rail across the middle of the tarmac. Collapsing the inner
edge onto the centreline is the cure: the road keeps its full width everywhere
it can have one, and comes to a point where it cannot.

## Three bugs found by looking, not by reading

None of these threw. The console was clean for all three.

**The whole road was accent-red.** A "travelling pulse just ahead of the car"
was written as a fraction of the track: `exp(-pow((vUv.y - uHead)*14.0, 2.0))`.
A tenth of the track sounds narrow — but from the chase camera a tenth of the
track *is everything you can see*, so the pulse covered the entire visible
surface. It is measured in world units now.

**A glow ribbon washed the rest of it.** `smoothstep(1.0, 0.55, e)` peaks at
`e = 0`, which is the *centre* of the road, not the edge. An additive ribbon at
half alpha across the full width.

**The cabin was a black hole.** `MeshStandardMaterial` at `metalness: 0.6` with
no environment map has nothing to reflect, so it renders black. It is a fresnel
shader now, which needs no environment and reads as dark glass. The same trap
was waiting in `applyDiamond()`, which set `metalness: 0.85` on the winning car
— the reward for finishing top five would have been a matte black box.

`applyDiamond()` had a second, harder bug: it called
`glowUnder.material.color.set(...)` after that material became a `ShaderMaterial`
with no `.color`. It threw inside the `try` that wraps the leaderboard call, so
the *only* symptom was "Could not reach the leaderboard" on the result sheet —
a network-looking error with no network involved.

## Sound

The engine is three detuned sawtooths (±13 cents) through a resonant lowpass
whose cutoff tracks speed, plus bandpassed noise for tyre roar and a 27 Hz LFO
on the output gain for the roughness a pure tone never has. Everything is
generated; there are no samples.

## Leaderboard

`memory.record("distance")` — **Longest Track**, daily / weekly / all-time,
global and following, `best_per_user`. Finish in the global top five and the car
turns to diamond, which persists in `ctx.storage`.

## Race length

Speed is derived from the track, not fixed:

```js
state.targetSpeed = clamp(state.length / RACE_SECONDS, SPEED_MIN, SPEED_MAX);
```

At a fixed speed a short sketch produced a one-second race that ended before the
camera had finished falling. Every race now aims at about six and a half
seconds.

## Verified

`node _skills/sekai/harness/run.js sketch-racer sc-racer3.json` — no console or
page errors; `loadFont`, `ready`, `start`, `interact`, `complete`,
`record.submit` and `milestone` all fire, and the overhead view, the dive, the
chase and the result sheet were each checked against a screenshot.

`sc-racer-cut.json` drives a stroke deliberately back onto its own first lane
and confirms the cut fires where the lanes meet, keeping the metres drawn up to
that point.

## Provenance

Ported from a standalone Sekai build, then rebuilt at the repository owner's
request. The concept — draw a road, then race it, scored on length — is the
original's. The 3D, the camera dive, the synthesis and the leaderboard are new.
The original declared no assets that were missing from its shipped build, so
nothing was substituted.
