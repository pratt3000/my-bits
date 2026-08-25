# Pen Fight

The desk game, with the physics actually simulated. Two pens on a gold-inlaid
walnut table: flick yours to shove your rival's over the edge before they do it
to you. First to three rounds.

## Files

| File            | What it is                                                    |
| --------------- | ------------------------------------------------------------- |
| `plethora.json` | Manifest — `plethora-bit@2`, `three@0.164.1`, one leaderboard. |
| `main.js`       | Entry source defining `window.plethoraBit`.                    |

## How it plays

Touch your gold pen, drag the way you want it to go, let go. Two things decide
what happens: the direction and length of the drag, and **where on the pen you
touched it**. Catch it at the tip and it spins; catch it at the balance point
and it drives straight. A fast swipe counts for extra power even if it is short.

While you drag, the table shows the contact point, an arrow for direction and
power, a dashed line for how far it will actually coast, and a curl that grows
as the flick puts more spin on.

## The physics

A pen is a capsule — a segment with a radius — sliding on a plane, with three
degrees of freedom: position, heading, and the two velocities that go with them.

**Flicking.** A flick is an impulse `J` applied at the point you touched, which
gives `dv = J/m` and `dw = (r x J)/I`. Tip-versus-centre behaviour is not a
special case anywhere in the code; it falls out of applying the impulse off the
centre of mass. The angular term is scaled by `SPIN_TRANSFER` because a
fingertip is a patch that keeps pushing as the pen turns away, not an ideal
point impulse — without it a tip strike spins at 16 rev/s instead of 6.5.

**Friction.** Integrated along the pen at nine sample points rather than applied
as one drag term at the centre. Each sample carries `m/9` of the load and drags
against its own local velocity, contributing both force and torque. That
coupling is the reason a pen that is sliding *and* spinning loses both together
and stops all at once — measured at 0.44 s for each, from the same flick.

**Contact.** Capsule/capsule closest-point, resolved with a normal impulse plus
a clamped Coulomb friction impulse, both carrying the angular terms — which is
what turns a glancing hit into spin instead of a shove. The closest-point
routine handles the parallel case explicitly: two parallel pens touch along a
band, and the textbook fallback picks an arbitrary end of it, which would
resolve every broadside opening hit at one tip. Taking the middle of the overlap
instead is worth about a third more transfer on a clean hit.

**Going over.** A rod is rigid, so it does not sag over a lip — it stays flat
until its centre of mass crosses, then it tips. So the test is exactly "is the
centre of mass still over the table", and a pen hanging half off the edge is
genuinely, not decoratively, still in play. Once it tips it leaves the 2D world
and falls in full 3D, tumbling about the table lip and clattering on the floor.

## Difficulty

The brief was that one flick must not end it. Full power carries a pen 0.53 m,
just short of the 0.59 m from the start line to the far lip — so a full-power
flick down an open table is committed but survivable, and that ceiling caps how
hard you can ever arrive at your rival. Across the opening gap that is 0.67 m/s,
which after an `e = 0.34` exchange moves them about 3 cm; they sit 13 cm from
the edge. Over 400 simulated rounds a knockout took 2.6 flicks on average and
**never** took one, while 17% of rounds were lost by flicking your own pen off
the far side.

Close range is the skill ceiling: walk them back first and a single clean hit
does end it. The rival's aim and power judgement improve as your streak grows.

## Contract notes

- `dependencies: ["three@0.164.1"]`, loaded with `ctx.importModule`, with the
  exact registry URL as a fallback.
- Packaged assets are disabled, so every texture — walnut grain, gold, the
  equirectangular studio environment that makes the gold read as metal, the aim
  arrow, the glows — is drawn to an `OffscreenCanvas` at runtime, with a hidden
  `ctx.createCanvas2D` fallback for WebViews that lack it.
- All sound is synthesised: pen-on-pen clacks are a noise transient plus two
  inharmonic tube modes, and there is a speed-driven sliding bed, a flick
  whoosh, floor clatter, and an edge creak. `ctx.music` carries the bed and the
  round stings.
- The render surface is claimed **before** `ctx.createRoot`, so the HUD lands
  above it; the root is `pointer-events: none` so flicks reach the canvas, and
  only the title curtain takes hits.
- `win_streak` record channel for the consecutive-rounds leaderboard.
- Permissions: `audio`, `backgroundMusic`, `haptics`, `storage`.
