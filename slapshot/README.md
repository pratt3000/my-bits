# Slapshot

Two-player air hockey on a single phone, in 3D.

Lay the phone flat between two people, one at each end. Both drag a mallet at
the same time with their own finger — that simultaneity is the whole reason
this shape of game works on one device. There is no turn to wait for.

## Files

| File | What it is |
| --- | --- |
| `plethora.json` | manifest — `three@0.164.1`, `backgroundMusic`, `haptics`, `storage`, two leaderboards |
| `main.js` | the whole bit |

## Why it is built this way

**The camera sits directly overhead.** A tilted camera looks better in a still,
but it hands the near player a bigger, closer half — and two people are playing
each other on the same screen, so the view has to be identical from both ends.
Straight down is the only fair angle. The depth comes from real geometry
instead: extruded rails catching a rim light, a puck casting a moving shadow on
the ice, bevelled mallets with lit rings.

**A pointer is bound to a half on `pointerdown` and keeps it until it lifts.**
Deciding per-move would let a player whose finger crosses the centre line start
driving the opponent's mallet. One live pointer per half, so nobody can grab
both.

**The puck is integrated in substeps sized to its own speed.** A hard slap
crosses more than a mallet's diameter in a single 16 ms frame; a one-step
collision test misses the contact and the puck passes straight through the
mallet and the rails.

**The mallet chases the finger rather than teleporting to it.** That gives it a
real velocity to hand the puck, so a deliberate swing feels different from the
puck merely bouncing off a parked pad — and a flick across the screen cannot
launch the puck at an impossible speed.

**The puck glows in the colour of whoever touched it last**, which is the only
colour-changing thing on the table. Possession stays legible across the rink
mid-scramble.

## Leaderboards

Both records belong to the *match*, not to one of the two people sharing the
phone, which is what a couch game should be putting on a global board:

- **Longest Rally** — most hits kept alive without a goal.
- **Fastest Win** — shortest completed match.

## Contract notes

- No packaged assets (`maxAssets: 0`). The ice, its grain, the centre line, the
  face-off circles and the creases are painted into an `OffscreenCanvas` at
  boot and uploaded as a texture. If a WebView has no `OffscreenCanvas` the ice
  falls back to a flat colour — plainer, fully playable, never blank.
- The overlay is one markup string on `ctx.createRoot()`, queried back out by
  `[data-el]`. `document.createElement` is rejected at upload.
- Pointer maths uses `event.offsetX` / `offsetY`, never
  `getBoundingClientRect()`, which is also rejected.
- No fog. The camera is ~4.3 units above a table 2 units across, so any fog
  near-plane close enough to matter starts inside the playfield and washes the
  rink to the background colour.
- `three@0.164.1` is loaded with `ctx.importModule` against the declared
  manifest pin.

## Settings

Play to 5, 7 or 11. Puck speed calm / normal / fast. Mute. All persisted with
`ctx.storage`.
