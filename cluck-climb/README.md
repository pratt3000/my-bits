# Cluck Climb 🐔

A one-thumb precision climber in the "charge a jump, flap to fix it" mould:
a small white chicken, a tall channel of maroon rock, and only the green
ledges are safe. Miss one and you tumble back down as far as gravity takes
you. One mountain, the same for everyone, with a timer and a percent, so the
times mean something.

All art, sound, level generation and code is original and lives in
`main.js`. The look follows the genre's flat pixel style: azure sky, rock
with an orange and plum outline, cream clouds, green ledge tops, an outlined
timer top left and a percent top right.

## How it plays

- **Hold** anywhere to charge a jump. The chicken squats and a dotted arc
  previews the flight. **Drag left or right** while holding to aim; keep the
  finger still to jump straight up. **Release** to jump.
- **Tap in the air to flap.** Two flaps per jump, shown as pips under the
  chicken. A flap adds lift and nudges you toward the side you tapped.
- **Only green ledges hold.** Bare rock bounces you off and slopes shed you.
  A long fall lands with a stun and a count on the results card.
- **Hazards** are orange diamonds drifting across gaps in the upper half.
  Touching one knocks you off with no flaps left.
- **Feathers** twinkle near the ideal apex of many jumps. They are optional
  and counted.
- Reach the nest at the top for the results card and your time.
- Keyboard: space to charge and jump, arrows to aim, space in the air to
  flap.

## The mountain

The level is generated at load from a fixed seed, so every player climbs
the same one. Thirty-four ledges lead from the ground to the summit. For each
ledge the generator simulates real jumps from three points on the ledge
below, over three aim directions, four charges and five flap timings, with
collision against the rock placed so far, and only keeps a ledge that at
least two of the three starting points can reach. The channel narrows and
the ledges shrink from about forty pixels wide to thirteen as you rise, the
gaps grow, and hazards appear from the eighth ledge on and get faster.

Physics: gravity 430 px/s², jump speed 105 to 230 px/s by charge, sideways
jumps at a fixed angle, a flap worth 95 px/s of lift, a bounce that keeps a
third of the impact speed.

## Records

- `time` — Fastest Climb (duration, ascending)
- `height` — Height Reached (percent)
- `feathers` — Feathers collected on a finished climb

## Platform

`ready` on load, `start` on the first tap, `interact` on the first jump,
`setScore` with the height percent, `milestone("summit")` and `complete`
with the time, falls and feathers at the top. Height is submitted every 5 %
of new progress so an unfinished climb still counts. Haptics on jumps,
flaps, landings, falls, feathers and hazards. All sound is synthesised:
a charge tick, jump whoop, flap flutter, thuds, a chime for feathers and a
fanfare at the nest.
