# Blast Yard

A two-to-four player bomb brawl on one phone, in 3D.

Lay the phone flat on a table with a person at each edge. Everybody plays at
once — there are no turns and four thumbs are on the glass at the same instant.
You can move, and you can throw a bomb. Bombs cook, arc, bounce and go off with
a blast that **launches** rather than kills. The only way out is over the edge,
and the rim of the yard crumbles away as the round drags on, so somebody always
goes over. Last figure standing takes the round; first to the target takes the
match.

## Files

| File | What it is |
| --- | --- |
| `plethora.json` | manifest — `three@0.164.1`, `backgroundMusic`, `haptics`, `storage`, one leaderboard |
| `main.js` | the whole bit |
| `tools/harness/play-blast-yard.mjs` | drives a real four-finger match to a real match end |

## The control problem, and the answer

This is the hardest input problem in the set. Four players, four sticks, four
fire buttons, on a 390-point-wide screen, all live at the same time.

**Four floating joysticks on the play surface does not work.** They collide
with each other, they sit on top of the figures they are steering, and when two
land close together there is no honest way to say whose finger is whose. Worse,
the thing you most need to see — a bomb rolling toward your feet — is exactly
what your own thumb is covering.

So **every control lives outside the play surface.** Each player owns a clay
control pad bolted to their own screen edge, with an analog stick on the left of
the pad and one bomb button on the right; the arena is then fitted into whatever
rectangle is left in the middle.

```
  +---------------------------------------+
  |   [ stick ]   Mint  ooo   ( bomb )    |   top seat, rotated 180
  +---------------------------------------+
  |  ♪ ≡ ?                       ROUND 2  |
  |  +---+     .-------------.     +---+  |
  |  |   |    /               \    |   |  |
  |  | L |   |   the yard      |   | R |  |   left seat  rotated 90
  |  | e |   |                 |   | i |  |   right seat rotated 270
  |  | f |    \               /    | g |  |
  |  +---+     '-------------'     +---+  |
  |                                       |
  +---------------------------------------+
  |   [ stick ]   Ember ooo   ( bomb )    |   bottom seat, rotated 0
  +---------------------------------------+
```

Five things fall out of that, and each of them is load-bearing:

- **Pads cannot overlap, by construction.** A touch is inside exactly one pad
  or it is nowhere, so a finger is bound to its owner before it has moved a
  pixel. There is no proximity heuristic to get wrong.
- **A pointer is bound on `pointerdown` and keeps its control for its whole
  life**, with one live pointer per control. Deciding per-move would let a
  finger sliding across a pad hop from the stick onto the bomb button
  mid-throw; letting a second pointer in would mean one player being driven by
  two hands.
- **Each pad is a DOM element rotated to its seat**, so `offsetX`/`offsetY`
  arrive already in that player's own frame. "Push away from me" is literally
  the same gesture at every edge, and the seat's rotation is applied once, in
  one four-line table, rather than being scattered through the input code.
  (`getBoundingClientRect` is rejected at upload, and it is not needed here:
  `offsetX` is target-relative and transform-aware.)
- **Nothing ever occludes the yard.** The chrome buttons and the round counter
  sit in the strip between the top pad and the platform, not down the side
  margins where they would cover the outermost lane of play.
- **The overlay is transparent to pointers** (`pointer-events: none` on the
  root) with only the pads and the panels opting back in. `ctx.createRoot()`
  returns an element filling the container and is created after the canvas, so
  without that it silently swallows every touch and the bit boots, renders and
  animates while completely ignoring the players.

The floating stick is worth a line of its own: wherever a finger lands inside
the stick zone becomes that stick's origin. Nobody has to find a 27-point circle
by feel while looking at the middle of the screen. Two different radii do the
work — the finger travels `0.42 × padHeight` for full tilt, but the knob only
slides `0.225 × padHeight`, so it never escapes its well however hard the stick
is shoved.

There is deliberately **no hidden information** anywhere in this game, which is
what lets four people share one screen with no pass-the-phone gate: everything
that matters — where every figure is, how long every fuse has left, whose bomb
is in the air — is on the table for all four of them at once. The only private
thing is your own thumb.

The pads also carry the whole per-player HUD — name, round-win pips, bomb state,
the live fuse countdown — rotated to that seat, so nobody reads their own score
upside down.

The layout adapts to the count. Two players get the two short edges and a nearly
circular yard using the full screen width; three add the left edge; four add the
right. As the free rectangle narrows, **the platform gets longer rather than
smaller**, and the camera is re-fitted to it, so a four-player yard has more
floor than a two-player one rather than less.

## Why the camera is tilted, and why that is fair

Slapshot and Chess put the camera straight overhead, because in a head-to-head
game across a table any tilt hands the near player a bigger, closer half. That
argument does not apply here and the tilt buys a lot, so this one leans 18°.

It is fair because:

- **Nobody owns a half.** This is a free-for-all on a shared platform. Figures
  roam the whole yard, spawns are symmetric about the centre, and the rim
  crumbles in a shuffled order that ignores where people are sitting.
- **The lens is long.** 24° of field of view puts the camera about seventeen
  world units from a yard two units across, so the near rim renders roughly
  **6% larger** than the far rim. That is a difference you can measure and not
  one that decides a fall.
- **The controls do not tilt.** Every pad is identical and lives at its owner's
  own edge, so the view angle changes what the yard looks like, never what
  anything does.

What it buys: the platform reads as a slab of wood floating over a rocky void
rather than a circle painted on black. You can see the extruded side of the
planks, blocks tumble away from the rim with real depth, and a launched figure
arcs through the air instead of merely getting bigger.

The platform is fitted to the free rectangle by projecting its own rim,
measuring the pixel box that comes back, walking the camera distance until that
box fits, and then shifting the frustum with `setViewOffset` so the box lands
centred on the rectangle. That is one routine for every player count — two,
three and four each describe a different rectangle and nothing else in the scene
has to know.

## Every shadow here is painted

There is no shadow map. Four figures, thirty-seven platform blocks, bombs and
rubble is far more casters than a phone will happily render twice per frame, and
the scene is fill-rate bound before the depth pass is even counted.

Instead: a soft blot under each figure that stretches and fades as it leaves the
ground, a blot under each bomb, and one big blot under the platform itself,
offset toward the key light. It costs three textured quads, it never shimmers,
and it is what a stop-motion diorama does anyway — the shadow is a piece of felt
somebody cut out and put on the table.

Everything lit uses `MeshLambertMaterial` for the same reason. The wood is
rough, the clay is rough, and nothing in frame has a specular highlight worth
the PBR shader.

## The yard falls apart

The platform is a solid elliptical core ringed by two courses of eighteen wedge
blocks, each a real extruded slab with its own bevel and its own seam. Every
sector remembers its own boundary radius.

Once the round passes the pace threshold, blocks start dropping into the void in
a shuffled order, one at a time, taking their sector's boundary with them. So
the yard does not shrink neatly: it gets **ragged**, and the safe ground stops
being where you remember it. Any scorch mark that was sitting on a block goes
with it.

This is what guarantees a round ends. Without it a careful four-player standoff
in the middle of a big platform can run forever, which is the failure mode of
every last-one-standing game.

## Mechanics worth knowing

- **Hold the bomb button to cook the fuse**, release to throw. The three-second
  fuse starts the instant you press, exactly as in the game this is descended
  from, so a bomb thrown late lands and detonates immediately while an early
  throw gives everyone time to walk away. Hold it past three seconds and it goes
  off in your hands, at 1.15× power, which is very nearly always fatal.
- **Aim with the stick while cooking.** A dotted arc shows the flight path and a
  ring shows where it lands, sized to the blast radius and turning red when the
  landing is off the platform.
- **Blasts launch, they do not kill.** Damage would need health bars, four of
  them, on a screen with no room; and a knock-you-off-the-edge kill is the
  funniest one anyway. Knockback falls off as `1 − distance/radius`, adds an
  upward pop so victims arc, and drops the victim into a tumble where they
  cannot steer and slide like a puck (friction 0.975 per frame instead of 0.86).
  That long helpless skid toward the rim is the joke.
- **Bombs chain.** Anything inside a blast goes off 70 ms later.
- **The killing blow runs in slow motion.** When the second-to-last figure goes
  over, the whole simulation drops to a third speed for a beat, because it is
  the one thing everybody at the table is looking at.

## Leaderboard

**Longest Streak** — the most rounds won back-to-back by one player during the
match. It is a property of the *match*, not of one of the people sharing the
phone, which is what a couch game should be putting on a global board: it
records how badly one person ran the table, and everybody there was part of it.

## Settings

Rounds to win 2 / 3 / 5. Pace — chill, normal or frantic, which is how long the
rim holds together. Mute. All persisted with `ctx.storage`.

## Contract notes

- No packaged assets (`maxAssets: 0`). The plank grain, the scorch blots, the
  soft shadow blot and the pool of light under the yard are painted into
  `OffscreenCanvas` surfaces at boot and uploaded as textures. If a WebView has
  no `OffscreenCanvas` every one of them falls back to a flat colour — plainer,
  fully playable, never blank.
- The overlay is one markup string on `ctx.createRoot()`, queried back out by
  `[data-el]`. `document.createElement` is rejected at upload.
- Pointer maths uses `event.offsetX` / `offsetY`, never
  `getBoundingClientRect()`, which is also rejected.
- Every child of a pad is `pointer-events: none`, so the pad itself is always
  the event target and `offsetX` is always measured in the pad's own frame.
- Point lights are physical since three r155: illuminance falls off as `1/d²`,
  so a bomb's glow at 0.3 units needs an intensity around 0.1, not the 1.5 that
  looks reasonable next to a directional light. The first build put four of them
  at 1.5 and bleached the middle of the yard white.
- `three@0.164.1` is loaded with `ctx.importModule` against the declared
  manifest pin.

## Verified

```
node tools/harness/validate.mjs blast-yard      # clean
node tools/harness/play-blast-yard.mjs          # PASS
```

The play script sets the match to two round wins, picks four players, readies
all four seats with a single four-finger tap, then plays two full rounds with
three sticks held down at once while the fourth player cooks and throws a bomb —
and asserts a real match end: `matchend`, winner Ember, two wins, a streak of
two, `platform.complete` fired and the record submitted.

## Two things only real input found

- **The knob escaped its well.** The stick's throw radius was larger than the
  well radius minus the knob radius, so at full tilt the knob sat outside its
  own socket and, on the top pad, overlapped the bomb button. Splitting the
  input radius from the visual travel fixed it.
- **Seat axes.** The three-and-four-player layouts rotate pads by 90° and 270°,
  and nothing about a still screenshot tells you whether "toward me" on the left
  pad walks a figure left or up. The play script holds all four sticks at full
  deflection at once and asserts each figure moves toward its own edge — which
  is also the four-simultaneous-touch proof.
- **A held stick went dead between rounds.** Starting a round cleared every
  pointer binding, which is correct at the start of a *match* and wrong here:
  nobody lifts their thumb between rounds, so that player was un-steerable for a
  whole round until they happened to let go and press again.
