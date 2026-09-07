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
  previews the flight. **Drag left or right** while holding to aim: the
  further you drag, the flatter and wider the jump, up to about 44 px of
  drag for a full sideways launch; keep the finger still to jump straight
  up. A small arrow beside the chicken shows the aim. **Release** to jump.
- **Tap in the air to flap.** Three flaps per jump in Classic mode, shown
  as pips under the chicken. A flap adds lift and steers hard toward the
  side you tapped, so a tap left of the chicken pulls it left. Tapping with
  no flaps left flashes NO FLAPS.
- **Modes.** The title has a toggle. Classic gives three flaps a jump and
  posts times to the ranked board. Free Flight gives unlimited flaps for a
  relaxed climb; its height and feathers still count, its times do not.
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
the same one. It is a stack of eleven sections of five kinds, each built on
top of the last:

- **Caverns**: an open channel with jagged walls, hanging islands and
  shelves off the walls. Later caverns have drifting hazards.
- **Slabs**: a breather of wide flat-topped platforms.
- **Tunnels**: a winding passage carved through solid rock, with small
  ledges tucked into the bends. You ricochet off the tunnel walls.
- **Splits**: a central pillar divides the way into two routes, one with
  wider ledges, the other narrower and lined with feathers, merging on a
  wide ledge above the pillar.
- **Overhangs**: thick shelves jut from alternating walls, so you zigzag and
  have to clear the lip of each one.

The rock is built as a pixel mask while generating, and every ledge is kept
only if the jump simulator, using the real physics against that mask, lands
on it from at least two of three starting points on the ledge below, over
five aim strengths, four charges and six flap timings. Ledges shrink from
about forty pixels wide to thirteen as you rise, hazards start around a
third of the way up and get faster, and there are forty ledges to the nest.

Physics: gravity 430 px/s², jump speed 105 to 230 px/s by charge, sideways
aim up to a 0.58 horizontal share, a flap worth 95 px/s of lift that also
steers hard, a bounce that keeps a third of the impact speed.

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
