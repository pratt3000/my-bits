# Windmill Cove

Mini golf built to the shape of *Golf With Your Friends*: six themed courses of
nine holes, a stroke counter, water that costs you one, and a leaderboard per
course. Single player, one screen per hole, played with a thumb.

## What it is

The bit opens on a title screen — **Play** and **How to play** — and Play opens
the course list. A round left part-way through surfaces as **Continue** there.


Top-down putting. Drag anywhere and pull back — the ball fires the way you
pulled, like a catapult — and the ring around the ball fills green → amber →
red as you pull further. A dotted line previews the line and up to two rail
bounces, which is enough to set up a bank shot and not enough to solve the hole
for you.

Every hole fits on one screen. That is the central design decision: no camera
to fight, no panning to find the flag, and aiming stays precise on a phone.

### The courses

| Course | Theme | Par | What it does to you |
| --- | --- | --- | --- |
| 🌲 Fernwood | Forest | 31 | Windmills, log bumpers, a creek and a millpond |
| 🏴‍☠️ Buccaneer Bay | Pirate | 32 | Water everywhere, sliding planks, cannon pads, a whirlpool |
| 🏜️ Sunken Oasis | Desert | 35 | Sand that kills roll, tomb portals, spinning scarab gates |
| 👻 Hollow Manor | Haunted | 33 | Sliding doors, cold spots, a crypt of blockers |
| 🍭 Sugar Rush | Candy | 32 | Gumdrop bumpers that fire you back, frosting rinks, slides |
| 🛰️ Orbital Nine | Space | 32 | Almost no friction, gravity wells, wormholes, one black hole |

### The mechanics, and where they came from

Everything on the list is a thing *Golf With Your Friends* or *Golf It!* does,
rebuilt in two dimensions:

- **Water and out of bounds** — one stroke, ball back where you played from.
- **Sand** kills roll; **ice** barely slows you at all.
- **Ramps and blowers** apply a steady push; **cannon pads** top your speed up
  to a fixed launch, always inside an enclosed corridor so an overshoot only
  ever bounces off a wall.
- **Windmill blades** sweep the fairway and *throw* the ball — the blade's own
  tip velocity is part of the collision, so a blade knocks rather than blocks.
- **Sliding gates** do the same thing in a straight line.
- **Whirlpools** pull; the one on Orbital Nine's Event Horizon swallows.
- **Portals** move you and keep your speed.
- **Springy bumpers** return most of what you give them.
- The cup **lips out** if you arrive too fast — it rattles the rim and stays out.

Scores are named the way golf names them (hole in one, eagle, birdie, par,
bogey, …), there is a stroke limit of par + 5, and a round submits its total to
that course's leaderboard.

## Files

```
windmill-cove/
  plethora.json   manifest: six record channels, one per course
  main.js         the whole bit
  README.md       this
```

## How it is built

**Holes are painted, not drawn.** A hole definition is a handful of rectangle
lists — `pads` lay down fairway, `water`/`sand`/`ice` drop hazards into it,
`bridges` put green back on top, `cuts` punch blockers. At load, `compileHole`
rasterises those into a half-unit cell grid, then walks the grid and emits a
wall segment wherever an inside cell borders an outside one, merging collinear
runs. So a hole author never lists an edge, and an interior blocker gets its
rails for free. Every hole also gets a tee box and a green apron stamped around
the cup, which is why no hole ever starts you on ice.

**The solver** sub-steps by ball speed so a hard shot cannot tunnel a rail, and
resolves every contact against a closest point — segment, circle, rect or
rotating capsule — with the collider's own velocity folded in. That last part is
what makes a windmill throw the ball. Walls go into a uniform-grid broadphase so
a step tests a handful of segments rather than all of them.

**Nothing is fetched.** No dependencies, no packaged assets. The checkerboard
mowing pattern, the log rails with their ring end caps, the striped flagstick,
the pines, waves, dunes, gravestones, candy and starfields are all generated at
runtime, and every sound is synthesised — the club strike's pitch and body both
track how hard you hit it.

**Static art is baked once per hole** to an `OffscreenCanvas` at display scale,
so a frame is one `drawImage` plus the moving parts. Where a WebView has no
`OffscreenCanvas`, `makeSurface()` returns null and `paintCourse` draws live
each frame instead — no scenery, everything else intact. Plainer, never blank.

### What the upload validator rejects

Inherited from `cairn/`, and obeyed here from the start:

- `document.createElement("canvas")` — use `OffscreenCanvas` for bakes.
  `ctx.createCanvas2D` is for the one display surface the runtime mounts.
- `canvas.getBoundingClientRect()` — use `event.offsetX/offsetY`, which are
  already canvas-relative and skip a forced reflow per pointer event.
- `document.createElement(tag)` with a computed tag. Only literal `"div"` and
  `"button"` here.
- Bare `setTimeout` — timers go through `ctx.timeout`.

### Verification

Two harnesses, both run against the shipped `main.js`:

- A **headless playtester** loads the file with a stub `window`, pulls out
  `COURSES` and the solver, and plays every one of the 54 holes with hundreds of
  randomised cup-biased shots. It checks the tee is on green, the cup is not
  buried in a post, and the hole can actually be finished — and it reports the
  best score it found against par. It caught six unfinishable or absurd holes
  during authoring: a five-blade spinner that swept an entire channel into the
  water, cannons that fired across open water with no bridge under them, a
  whirlpool whose reach covered both causeways, and three ramps pushing against
  the direction of travel.
- A **browser round test** drives a real Chromium through a full nine holes with
  a mock Plethora `ctx`, screenshotting each hole and asserting no page or bit
  errors. It found the stroke limit hanging off the come-to-rest path only,
  which soft-locked any hole where every shot found water.

Both live outside the repo; the bit itself carries no test hooks.
