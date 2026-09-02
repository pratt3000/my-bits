# Longshot

A mobile-first [Plethora Bit](https://create.plethora.studio): a first-person
marksman hunt across three open 3D reserves, where the range to the target is
the whole game.

Your round takes time to arrive and falls on the way. Rifles are zeroed at
200 m, so past that you hold over on the mil-dots and you lead anything that is
running. Animals notice you in proportion to how close you are, how fast you
are moving and how badly the scrub is hiding you — crouch in a thicket and stop
moving, and a cheetah at 200 m never knows you are there.

Nothing is downloaded. Packaged assets are disabled (`maxAssets: 0`), so the
terrain, every plant, every animal, the sky and every sound are built in code at
boot. The only dependency is `three@0.164.1` from the registry.

## Files

| File            | Purpose                                                           |
| --------------- | ----------------------------------------------------------------- |
| `plethora.json` | Manifest (`plethora-bit@2`, runtime global `window.plethoraBit`).  |
| `main.js`       | The entry source (`entry: "main.js"`).                             |

## Ballistics is the game

A round leaves the muzzle at 760–900 m/s and is then on its own: stepped under
gravity every 3.5 ms and tested against the animals, the trunks, the boulders
and the ground. At 500 m that is six tenths of a second in the air and about two
metres of drop.

Two consequences follow, and they are the entire skill of the game:

- **Holdover.** The rifle is zeroed at 200 m, so the bore points slightly above
  the sight line and a close shot lands on the crosshair. Past the zero the
  round is below it, and the mil-dots under the centre are the marks you use.
- **Lead.** A cheetah sprints at 27 m/s. Over a 0.6 s flight that is sixteen
  metres, so you aim at where it is going to be.

Sub-stepping is not optional: at 900 m/s a whole frame is 15 metres, which walks
a round straight through a gazelle without touching it.

## Why the scrub matters

Each animal carries an alertness that rises with

```
near² × wariness × (1 − concealment × 0.92) × (0.26 + movement × 1.5)
```

and falls on its own. `concealment` comes from the scrub you are standing in,
multiplied up by crouching; `movement` is how fast you are walking. Line of
sight through a trunk cuts detection to a sixth.

That single expression is the stealth mechanic. Standing in the open and walking
is worth about six times the detection of crouching still in a bush, which is
why a hunt is mostly spent not moving.

Shots carry: every round fired adds to a spook wave that every animal within
earshot feels, scaled by its wariness. A cheetah bolts at a shot that a warthog
ignores.

## The quarry

| | value | speed / sprint | wary | herd |
|---|---|---|---|---|
| Warthog | 25 | 3.2 / 7.5 | 0.55 | 1–3 |
| Zebra | 50 | 4.2 / 12 | 0.8 | 3–6 |
| Buffalo | 60 | 3 / 9 | 0.5 | 2–5 |
| Ibex | 90 | 4.5 / 11 | 1.15 | 1–3 |
| Gazelle | 120 | 5.5 / 16 | 1.35 | 2–5 |
| Ostrich | 150 | 5 / 19 | 1.5 | 1–2 |
| Leopard | 400 | 3.4 / 14 | 1.9 | 1 |
| Cheetah | 800 | 4 / 27 | 2.2 | 1 |

Score is `value × zone × range`, where a head shot triples and a limb quarters,
and range multiplies up to 3.4× past 90 m. One head shot on a cheetah at 500 m
is worth more than forty warthogs.

## The rifles

| | zoom | muzzle | cycle | mag | sway |
|---|---|---|---|---|---|
| Ranger .308 | 6x | 810 | 0.95 s | 5 | 0.62 |
| Vector Semi | 4x | 760 | 0.28 s | 10 | 0.78 |
| Longbow .338 | 12x | 900 | 1.45 s | 5 | 0.95 |
| Anvil .50 | 20x | 860 | 2.10 s | 3 | 1.45 |

Sway is two out-of-phase Lissajous figures, so the reticle never repeats a loop
the eye can learn. Crouching halves it, holding your breath cuts it by five, and
looking through a 20x scope slows your turn rate by `1/√zoom` — which is what
makes the Anvil feel heavy rather than just magnified.

## Everything is generated

**Terrain** is one shared height field — fbm plus a ridged term, a basin in the
middle so there is somewhere to stand that can see out, and a raised far ring so
the horizon is land rather than a cut edge. The mesh is tessellated on purpose:
a two-triangle floor cannot take a light gradient, which is what makes cheap
ground look like paper. Colour is per-vertex, from moisture (hollows hold it and
read green, rises bleach), then slope, then altitude.

**Scatter** is five instanced meshes — grass tufts, scrub, trunks, crowns,
boulders — plus one instanced disc pool for ground shadows. All of them have
`frustumCulled = false`, because three culls an InstancedMesh against its
geometry's bounding sphere at the mesh origin, so a whole field of grass vanishes
the moment that origin leaves the frustum.

**Animals** are welded from boxes into three meshes each — body, head, two leg
pairs — because a hundred separate box meshes per herd is a hundred draw calls
per herd.

**Sound** is a crack, a body, and a tail that arrives late; the tail is what
makes a rifle sound like it is outdoors. A hit heard from 400 m is delayed by
`dist / 340`, which is most of what tells you the shot connected.

## Contract notes

- `plethora-bit@2`, `schemaVersion: 1`, entry `main.js`, one dependency
  (`three@0.164.1`), package ~120 KB of the 2 MB limit.
- Permissions: `audio` (bespoke synthesis), `haptics`, `storage`. No
  `backgroundMusic`, camera, microphone or motion.
- One `records` channel, `score`, submitted once at the end of a hunt and never
  for a zero.
- First frame paints the title before `ctx.markVisualReady("title")` and
  `ctx.platform.ready()`; `ctx.platform.start()` fires on the first real gesture,
  which is also where audio unlocks.
- Pixel ratio is capped at the preset budget — a phone reports DPR 3 and will
  happily be asked for 3.5× the pixels of a 1080p laptop.
- The visible light count is fixed for the life of the bit: three bakes it into
  every compiled program, so a light appearing mid-game recompiles the world.

## Five bugs that cost a round each

Each was found by looking at a screenshot, not by reasoning about the code.

- **A viewmodel parented to the scene stays put while your head turns.** The
  rifle has to be a child of the overlay camera, and the camera has to be in the
  scene graph for its children to render at all.
- **`autoClear` wipes the frame between passes.** Rendering the overlay scene
  after the main scene clears the colour buffer unless `autoClear` is turned off
  around it — the world vanishes and only the rifle survives.
- **`inset: 0` does not stretch an `<svg>`.** Without an explicit
  `width/height: 100%` the scope vignette covered the top half of the screen and
  read as a spotlight in the wrong place.
- **An 11° dawn sun is unplayable.** N·L on flat ground is 0.19, so the whole
  reserve rendered as dark olive whatever the albedo said.
- **A portrait frame gives the overlay camera a ~27° horizontal field.** A 1.2 m
  rifle at 40 cm is five times the frame width.

## Verified

Driven headless in Chromium against a mock `ctx`. The scratch copy carries a
read-only test hook; `main.js` never does.

**13 assertions, all passing:**

- boots to a visible title before `ready`; a hunt starts with a full magazine
  and a 300-second clock
- scoring is `value × zone × range` through the real hit path — a head shot on a
  warthog at 300 m pays 25 × 3 × 1.55, and the head-shot and longest-shot
  counters follow
- a taken animal leaves the reserve
- the cycle time genuinely blocks a second round
- the clock runs out into the results screen, `complete` is reported, and the
  scope is cleared rather than left drawn over the panel
- a non-zero score reaches `ctx.memory.record("score").submit()` with the exact
  value, and the career best and run count update
- **a zero-score run is not submitted** — the results panel does not claim it was

Separately, a full 300-second run was played end to end through the real
pointer path: the map picker, START, SCOPE and FIRE all respond to synthetic
pointer events, rounds are limited by cycle time, and the run reaches
`complete` with no page errors.

**Not verified:** never opened on a real phone. The touch layer is wired and
sized for a thumb but has only met an emulated viewport.
