# Reactor Four

A two-to-four player reaction duel on a single phone.

The phone goes flat on the table and everyone claims an edge. A reactor core
burns in a circular port at the centre; four console wedges radiate out from it,
one per seat. The round type is announced, the core winds up, and the first
player to slap their own wedge when the signal comes true takes the round. Slap
while it is false and that station scrams: minus one, locked out until the next
round.

Four round types cycle so nobody settles into one reflex:

| Round | Signal |
| --- | --- |
| **GO** | The core burns red, then turns green. Slap on green. |
| **MATCH** | Two glyphs cycle. Slap only when they are identical. |
| **COUNT** | Dots flash. Slap only when exactly N are lit. |
| **MATH** | An equation cycles. Slap only when it is correct. |

## Files

| File | What it is |
| --- | --- |
| `plethora.json` | manifest — `three@0.164.1`, `backgroundMusic`, `haptics`, `storage`, one leaderboard |
| `main.js` | the whole bit |

## Why it is built this way

**The screen is cut by its own diagonals.** Rays from the centre through the
four screen corners divide the display into four wedges that tile it exactly,
and every player's wedge runs the whole length of the edge they are sitting at.
The same test carries two and three players — the sector list just gets coarser
(two 180° halves; 135°/90°/135°) — so a three-player game has no dead strip of
screen that swallows a slap. Ownership is decided in *normalised* coordinates,
which is what puts the mitre lines exactly on the screen diagonals whatever the
aspect ratio turns out to be.

**Nothing that matters is written only in the middle.** Text that reads
right-way-up for the player at the bottom is upside down for the player at the
top. So the port carries only rotation-invariant state — the core's colour, a
pair of glyphs, a row of dots — and *every console repeats the whole signal
rotated to its own seat*. Control rooms mirror the master gauge onto each
station for exactly this reason, and here it is the difference between a fair
game and one the person sitting at the bottom always wins. Whether two glyphs
match is itself a rotation-invariant question, which is why MATCH can live in
the middle at all; the MATH equation cannot, so it is the repeats that carry it.

**Colour is only a cue in the round that says it is.** In a GO round the core
turns green the instant it arms, and that is the whole game. In MATCH, COUNT and
MATH it keeps burning in the round's own hue straight through the arm — if it
flashed green there, every round would collapse back into GO and the reading
would stop mattering. The decoy cycles tick audibly whether they are true or
false, so the sound cannot leak the answer either, and there is no sting on the
arm of a reading round.

**A pointer belongs to the wedge it landed in, for its whole life.** The slap is
decided on `pointerdown` and the binding is held in a `Map` keyed by
`pointerId`, with one live pointer per station. Without both rules a hand that
lands across a mitre line fires somebody else's console, and a player's second
finger fires their own twice.

**The chrome gets out of the way.** The mute/settings/help buttons are a
vertical stack in the top-right corner — the only spot that clears both the top
station's readout and the right station's — and they fade to zero opacity with
`pointer-events: none` for the whole live part of a round, so a slap that lands
on a corner button still counts as a slap.

**A missed signal does not freeze the round.** If nobody claims a true signal
inside its hold window the core reverts to decoys and can come true again later,
so a table that all blinks at once simply plays on — and a late slap into that
reverted window is a false start, which is correct.

**The reactor is real geometry, not a painted circle.** A plasma skin is baked
into an equirectangular map and the emission multiplied through it, so the
sphere has structure that churns as it turns; three gyro rings spin up with the
charge, eight control rods withdraw as it heats, nested back-faced shells stand
in for volume, and energy motes spiral inward and blast outward on discharge.
Every dimension inside the assembly is a fraction of the port radius and the
whole thing hangs off one group, so a rotation rescales it with a single number
instead of stranding geometry at the old size.

**Light leaves the port and lands on the plating.** The console is a 2D layer
above the WebGL one with the port left transparent, and the spill is an additive
radial gradient whose inner stop is fully transparent — so it paints light onto
the consoles without ever painting over the port itself. Expanding sonar rings
run out of the same edge, faster as the charge builds.

**The score lives on the rim as well as the console.** Each station's slice of
the collar around the port fills outward from its middle in that station's
colour, so the running score is readable from the centre of the table without
anybody having to read a neighbour's console upside down.

## Leaderboard

**Fastest Reaction** (`duration_ms`, ascending, timer). The sharpest single
reaction anyone at the table landed during a completed match. It is a property
of the match — of the phone and the people around it — not of one of the two to
four people sharing the device, which is what a couch game should be putting on
a global board.

## Contract notes

- No packaged assets (`maxAssets: 0`). The plasma skin, the chamber wall, the
  bloom and mote sprites, the console plating, the master gauge and all four
  readout strips are painted into `OffscreenCanvas` surfaces and either blitted
  or uploaded as textures. Every bake site checks for `OffscreenCanvas` first
  and falls back to drawing live — plainer, fully playable, never blank.
- The overlay is one markup string on `ctx.createRoot()`, queried back out by
  `[data-el]`. `document.createElement` is rejected at upload. There is no
  player-authored text in this bit, but everything interpolated into markup goes
  through `esc()` anyway.
- Pointer maths uses `event.offsetX` / `offsetY`, never
  `getBoundingClientRect()`, which is also rejected.
- Soft edges — the port's hot rim, the lamp halos — are built from concentric
  translucent strokes. Writing `ctx.filter = "blur(...)"` is rejected because the
  property also accepts `url(#…)`.
- The bit mounts two canvases: `ctx.createCanvas()` for the reactor and
  `ctx.createCanvas2D()` above it for the console. The 2D layer is cleared to
  transparent every frame and every fill is clipped outside the port, which is
  what makes the port a real hole rather than a drawn circle.
- Console plating is baked once per layout and each readout strip is re-baked
  only when its own content signature changes, so a frame is a handful of
  `drawImage` calls plus the live light.
- `three@0.164.1` is loaded with `ctx.importModule` against the declared
  manifest pin.

## Settings

Rounds to win 5 / 10 / 15. Signal pace calm / normal / brutal (it scales the
decoy cycle, the hold window and the GO delay together). Sound on / muted, which
the corner button toggles too. All persisted with `ctx.storage`, along with the
crew size, so the next session opens on the same table.

## Verifying

```
node tools/harness/validate.mjs reactor-four
node tools/harness/run.mjs reactor-four --ms=2200
node tools/harness/play-reactor-four.mjs
```

The play script drives a genuine four-player match: the settings and how-to
panels opened and closed from the title screen, four fingers arming four
stations in the same frame, a deliberate false start that must lock exactly one
station and nobody else, a true signal left untouched so the hold window expires
and the round falls back to decoys instead of freezing, two hands racing the
same signal where only the first may score, and a run through to a real win, the
leaderboard submit and the rematch. The two- and three-player sector layouts are
checked separately by probing `zoneAt` at every corner and edge midpoint, which
is the cheapest way to prove the wedges still tile the whole screen when the
sector list changes shape.
