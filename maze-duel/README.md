# Maze Duel

Two to four people race one hedge maze on one phone, all at the same time.

The phone lies flat on the table and each player sits at a corner of it. A
formal garden maze fills the middle of the screen; everybody's peg starts in
the corner nearest their own hands, and every peg runs at once. There are no
turns, so nobody waits.

## Files

| File | What it is |
| --- | --- |
| `plethora.json` | manifest — `three@0.164.1`, `backgroundMusic`, `haptics`, `storage`, one leaderboard |
| `main.js` | the whole bit |

## Why it is built this way

### The maze is symmetric, so fairness is a theorem, not a retry loop

The obvious way to make a race fair is to generate a maze, measure how far
each start is from the goal, and regenerate if the numbers disagree. That
almost never converges: in a random 11×11 maze the four corner distances
differ by tens of steps, so the loop spins and eventually settles for
"close enough".

This maze is instead carved in the quotient of its own symmetry group. Let
**G** = { identity, mirror-x, mirror-y, 180° rotation } — the symmetry group of
a square grid of odd side. Passages are carved by a randomised depth-first walk
over the *orbits* of **G**, and every carve opens all four mirror images of one
edge in a single step. Two guarantees follow by construction:

- **Every cell reaches the heart.** The heart is the single cell fixed by every
  element of **G**. Each carve joins a whole orbit to a whole parent orbit —
  for each `g ∈ G`, the image edge connects `g·parent` to `g·child` — so if
  every member of the parent orbit reaches the heart, so does every member of
  the child. Induction outward from the heart's own orbit `{heart}` covers the
  grid. There is no unsolvable maze to reject.
- **All four corners are exactly equidistant from the heart.** The four corners
  lie in one orbit, and the carved graph is **G**-invariant, so
  `d(heart, corner) = d(g·heart, g·corner) = d(heart, g·corner)` for every `g`.
  Not similar — equal.

**How that was verified.** `window.__MAZE__.cornerDists()` runs a fresh
breadth-first search from the heart over the live open-edge lattice and returns
all four corner distances. `tools/harness/play-maze-duel.mjs` asserts they are
identical and non-zero on a real generated round, and prints them:
`corner distances to the heart: [14,14,14,14]`. A proof nobody checks is a
proof you have already broken, so the check ships with the test.

**The loops come free, and adding more ruins it.** The orbit walk is a spanning
tree of the *quotient*, not of the grid: the union of an edge's four mirror
images carries a handful of genuine cycles on top of a tree — six of them at
9×9, ten at 13×13. That is exactly the loopiness a race wants, a few real route
choices with no dead-end frustration, and it arrives at no cost.

The first build then knocked out a further 11% of walls on top, the way a
single-player maze generator would. That was badly wrong, and the number that
caught it was the corner distance: a corner sits `n-1` steps from the heart as
the crow walks, and the garden was coming out at exactly `n-1`. Every extra
knock opens four holes at once, symmetrically placed, so a single shortcut near
one corner's route is a shortcut on *all four* routes. Measured over six seeds
at 9×9, dropping in 4% more open edges took the corner distance from 12–18 down
to 8–12; at 12% it was pinned at the 8-step floor. The pass is gone.

What replaced it is a length check, since solvability and fairness need no
checking at all: carve, measure the corner distance, and accept as soon as it is
at least 90% past the straight-line floor, best-of-twelve otherwise. Twelve
breadth-first searches over at most 169 cells. Measured over forty seeds, that
lifts the worst 11×11 the generator will hand you from 14 steps to 20, and
leaves the median at 24.

The symmetry is also the right *look*: a formal garden maze is symmetric, so
the fairness mechanism and the art direction want the same thing.

### Thumb-sticks in the corners, not fingers on the pegs

Both control schemes were on the table. Direct dragging loses at exactly the
moment the game is decided:

- Four pegs converge on one cell, so four hands end up over the middle of the
  board and nobody can see the goal they are racing to.
- A pointer that lands between two adjacent pegs has no honest owner, and any
  nearest-peg rule quietly hands one player somebody else's piece.

Sticks win because ownership is decided by geometry that cannot overlap. The
screen is cut into a chrome strip, a board, and one rectangle per player. A
pointer's owner is read off its landing position on `pointerdown` and held in a
`Map` keyed by `pointerId` for that pointer's whole life; a zone that already
has a live pointer ignores every additional one, so nobody can quietly drive two
sticks. **Nothing a player does ever needs a finger over the maze**, so the
board is never covered.

The zones are cut per round, not fixed: a band with only one player in it
belongs entirely to that player. In a two-player game the two seats face each
other diagonally across the phone and each owns their whole end of the table,
rather than having to remember that only half of it is live.

The stick floats: it appears wherever the thumb lands rather than at a fixed
spot, and its anchor is dragged along once the thumb passes the ring's edge, so
a long push never runs out of travel mid-corridor.

**Proved with four fingers down at once.** The play script presses all four
corners in the same frame, steers all four independently through a whole race,
and then plants four briars with four simultaneous taps — `tapTogether` — and
asserts the briars actually appeared.

### The sticks are absolute for every seat, never mirrored

The usual reflex is to rotate the far players' controls the way their HUD is
rotated. That would be the bug. The phone is flat, so a player at the far edge
who pushes their thumb *away from their body* is pushing toward the bottom of
the screen — and their peg should go toward the bottom of the screen too.
Physical direction is shared by everybody around the table. Only the symbolic
overlays (name plates, step counts, hints) are rotated to their seats;
`transform: rotate(180deg)` for the two top corners, upright for the two
bottom ones.

### Movement follows the lane

The peg holds a cell and a fraction along one edge, Pac-Man style, rather than
being a circle colliding with wall geometry. In a corridor exactly one cell wide
that is both far more robust and much crisper to steer: turns are evaluated at
each cell centre, a reversal mid-corridor is instant, and there is no way to
wedge a peg in a corner. It also means a dropped frame can never tunnel a peg
through a hedge — `stepPlayer` walks cell by cell inside one frame, so the stall
cap can be a generous 110 ms.

### The duel is the briar

Without it this is two people solving the same puzzle beside each other. One
mechanic, kept legible:

- You start holding one briar and pick more up from amber pods (maximum three).
- **Lift your thumb and tap your own corner** and a hedge slams across the gap
  you just walked through, sealed for nine seconds.
- It costs you your run for that moment — you have to stop to plant — which is
  the whole trade.
- A tap taken half way down a corridor is remembered and spent the instant the
  peg clears the gap, rather than being refused. Punishing a thumb that landed
  sixty milliseconds off a cell boundary is not a rule, it is a bug.
- It can never seal the last route to the heart for anybody: the placement is
  applied, a breadth-first search from the heart checks that every peg still has
  a path, and the hedge is refused with a shake and a `fail` sting if it does
  not. Walling the goal off is therefore impossible.
- It also cannot be planted on a gap another peg is halfway through.

A tap and a steer share one finger and one zone, so no player ever needs two
simultaneous touches — which matters, because a phone delivers at most five.

**They are told apart by travel alone, never by duration.** The first build used
"under 300 ms and barely moved", and the headless harness — three frames a
second on software GL — showed exactly what is wrong with that: the pointerdown
and the pointerup arrive in the same busy task, and the measured press lasted
between one and five seconds. Every deliberate tap was read as a long press. A
press that never leaves the dead zone could not have been a steer anyway, since
the peg never moved for it, so travel is both the exact test and the one that
does not care what frame rate the device is managing. The cost is that resting a
thumb and lifting it spends a briar — once, because the gap behind you is then
already sealed and further presses do nothing.

Pods spawn in symmetric orbits of four, so no corner is ever nearer a pickup
than another.

### Rendering

Straight overhead, because two to four people are racing each other on the same
screen and any camera tilt hands the near seats a larger, closer half of the
board. The depth comes from real geometry and real light instead: extruded
hedges with clipped crowns, one key light up and to the left, and pegs that
throw their own moving shadows down the corridors.

**The sun angle and the hedge height are one setting, not two.** A corridor is
one cell wide minus the hedge thickness — about 0.76 of a cell. A hedge 0.78
cells tall lit from 50° lays a shadow 0.65 cells long, which is 86% of the
corridor floor: the garden came out reading as dark khaki trenches rather than
warm gravel between hedges. Shorter hedges at 0.70 cells and a higher sun at 58°
put the shadow at 0.45 cells, a little over half the corridor — a band down one
side, which is what makes the maze read as a place rather than a line drawing.

Two more things that only showed up in a screenshot. The goal's light column,
seen from directly overhead, is not a beam — it is a bloom, and at its first
width it was a three-cell gold disc sitting on top of the goal it was meant to
mark; it is now narrow and faint, and the goal is carried by a limestone disc
with a labyrinth cut into it and a pulsing gold ring. And the frame's gold
keyline, run along the inner lip of the navy band, was occluded in patches by
the outer hedge leaning over it under even a 24° lens, so it runs down the
middle of the band instead.

Pegs pass through one another rather than colliding. Four pegs converging on one
cell is the normal end of a race, and any push-apart rule turns the last two
seconds into a shoving match decided by frame timing rather than by who found
the shorter route.

Every hedge in the maze — bodies, crowns and lattice posts, around two thousand
boxes — is written into one hand-merged `BufferGeometry`. Merging by hand avoids
`BufferGeometryUtils` (an addon file, not part of the registry module) and
collapses the whole garden into a single draw call, which is what makes a
per-frame shadow pass over the entire maze affordable at all. Vertex colours
carry the hedge tone from near-black at the root through the shaded face to the
sunlit crown, and they travel through `THREE.Color` so they land in the
renderer's linear working space rather than coming out pale.

## Leaderboard

**Fastest Solve** — `duration_ms`, ascending, timer format. The record belongs
to the *match*, not to one of the people sharing the phone: how fast this table
cracked this garden.

## Settings

- **Garden size** — Small 9×9, Standard 11×11, Grand 13×13. Changing it
  remeasures the whole layout: cell size, frame width and both seating bands.
- **Briars** — on or off, for a pure race.
- **Sound** — muted or not, persisted with `ctx.storage` alongside the rest.

## Testing

`tools/harness/play-maze-duel.mjs` drives a real four-player race in headless
Chromium: it opens the rules and the settings panel, drops the garden to 9×9,
picks four players, presses all four corners in the same frame, rides out the
countdown, steers four sticks independently along four shortest paths, plants
four briars with four simultaneous taps, races to a genuine win in the heart
cell, and takes the rematch. It asserts on the four corner distances being
equal, on the briars actually appearing, on the phase reaching `over` with a
winner and a measured time, on the rematch starting a fresh garden, and on the
leaderboard submit, the music bed and the haptics all having fired.

Two things it taught that no amount of reading the code would have:

- headless runs on software GL at about three frames a second, so anything
  measured with a wall clock inside an event handler is meaningless — which is
  how the duration-based tap test was caught;
- a `bit.tap` that reuses a touch id still held down is silently dropped, so
  every finger has to come up before the end screen or the rematch button never
  fires.
- the briar assertion used to fire on a fixed step number, and on a slow enough
  frame budget the countdown ate those steps, so four taps went out before
  anybody had picked a pod up and the check failed on a game that was working.
  It now arms on state — at least two players actually holding a briar — which
  is the condition the assertion always meant.

### What a fresh pass at the screenshots found

Four things survived the build and only showed up under a designer's eye:

- **The winner had no card.** The result was drawn straight onto the hedges on
  a light scrim, on the theory that the frame flooding with the winner's colour
  was the payoff and a panel would bury it. On screen it read as mud: a 10px
  eyebrow at half opacity over green hedges, and the violet peg sitting inside
  the "C" of *Crimson*. It is a card now — the flood still reads down both
  sides of it, which was the part worth keeping.
- **Half the table read the result upside down.** Every other piece of HUD is
  rotated to its seat, and then the one screen the whole table looks at faced
  one way. The card now carries the result twice, back to back like the indices
  on a playing card, with the two buttons between them so either end can reach
  them. The countdown got the same treatment: "3" and "RUN" are both nonsense
  inverted, so the beat is struck twice with the heart glowing in the gap — and
  it is placed on the board's centre now rather than the screen's, so it lands
  on the heart instead of 29px above it.
- **The idle stick home was a grey dashed ring on dark walnut**, which is close
  to invisible and, worse, said nothing about whose corner it was. Before
  anybody has touched the glass it is the only thing marking out a player's
  patch of table, so it wears the seat's colour now, as does the hint under it.
- **The two bands were not mirrors.** The bottom zone ran to `safeB * 0.4`
  rather than to the home bar, and the stick rings drew their border outside
  their box, so both bands sat 2px low on screen. Between them the bottom
  seats' controls were 14px off the mirror of the top seats' — in the one game
  that promises the two ends of the table are identical. Both bands now mirror
  exactly about the board's centre: home rings 179/723, plates 241/661, hint
  edges 106.9/795.1, all summing to 451.0.

The maze generator was tuned outside the browser, on a standalone copy that
prints open-edge counts and corner distances over dozens of seeds at each size.
That is what turned "the maze looks a bit open" into "4% extra open edges costs
six steps of corner distance, and 12% pins it to the floor" — and later what
picked the 90% length bar over 40%, by showing it lifts the worst 11x11 from 14
steps to 20 at a cost of a few extra carves.

## Contract notes

- No packaged assets (`maxAssets: 0`). The gravel and its grain, the oiled
  walnut tabletop and the labyrinth engraved on the goal are painted into
  `OffscreenCanvas` surfaces at boot and uploaded as textures. Every one of them
  falls back to a flat colour when a WebView has no `OffscreenCanvas` — plainer,
  fully playable, never blank.
- The overlay is one markup string on `ctx.createRoot()`, queried back out by
  `[data-el]`. `document.createElement` is rejected at upload.
- The overlay root is `pointer-events: none`; only the chrome opts back in.
  Without that it silently swallows every thumb-stick, since the root is created
  after the canvas and sits on top of it.
- The chrome strip is `z-index: 60` — above the title and win cards, below the
  two modal panels. Underneath the cards it was unreachable, which is exactly
  where a player goes looking for the rules.
- Pointer maths uses `event.offsetX` / `offsetY`, never
  `getBoundingClientRect()`, which is also rejected.
- The settings and rules panels are hidden during a race, since either one would
  otherwise let somebody freeze the screen mid-sprint.
- `three@0.164.1` is loaded with `ctx.importModule` against the declared
  manifest pin. Both fonts go through `ctx.loadFont` and are fired without
  awaiting, so the first frame never waits on a typeface.
- A garden is generated, built and rendered before `ctx.platform.ready()`, so
  the first frame is a live board with the pegs already on their corners rather
  than a flat colour — the title card is a translucent plate laid on top of it.
- Every listener, timer and frame callback goes through `ctx.listen`,
  `ctx.timeout` and `ctx.onFrame`; the only stored state is one `ctx.storage`
  record holding the garden size, the briar toggle, mute and the player count
  together, so changing one can never quietly forget another.
