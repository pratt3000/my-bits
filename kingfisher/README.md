# Kingfisher

One tap to fly. A kingfisher over a lake at dawn, stone pillars rising from
the water and hanging from the mist, and a day that turns as the run gets
long. A Flappy Bird built the way a game should be built: a pure,
deterministic model with fixed-step physics, a difficulty curve that is
proved fair by a test rather than asserted, hitboxes that forgive a graze,
and input that is never lost.

## Play

- Tap anywhere (or press space) to flap. That is the whole interface.
- Pass a pillar for a point. Medals at 10, 25, 50 and 100.
- Your best is kept on the device and goes on the platform leaderboard.
- After forty pillars a gentle wind arrives. The day cycles dawn, noon,
  dusk and stars over about 120 pillars.

## Why it feels right

**The model is pure and fixed-step.** Everything between `MODEL BEGIN` and
`MODEL END` in `main.js` knows nothing about the DOM, three.js or the
platform. It runs at 120 Hz from an accumulator capped at a tenth of a
second, so a slow frame never spirals and a run is reproducible from its
seed. Rendering interpolates between the last two states, so motion is
smooth at any frame rate.

**Taps are queued, not sampled.** A tap between two frames is counted at
the next fixed step. A swallowed input is invisible in tests and
infuriating on a phone, so there is none.

**The curve is smooth and bounded.** Speed, gap, spacing and drift ease out
over sixty pillars and then hold; the test checks that no single point
moves any of them by more than a hair. The gap starts at 5.4 bird
diameters and settles at 3.9; the pace settles at 0.9 s a pillar.

**The generator can't ask the impossible.** How far the gap centre may move
from one pillar to the next is capped by what a bird can fly in the clear
air between the columns: a four-taps-a-second climb, or a fall from a
hover, each with slack.

**Fairness is a test.** `test-model.js` slices the model out and plays it
with two bots. A steady player holds the next gap's height, taps no faster
than a thumb, and looks one pillar ahead; a planner is the same player who
plays both choices a second forward before every tap. The planner must
clear 200 pillars on every seed or the suite fails; the steady player must
always reach silver. As tuned, the steady player scores 89 to 200 over
eight seeds, which is where "very hard, never unfair" sits.

**Hitboxes forgive.** The bird is a 0.4 m circle inside a body that draws
at half a metre; the columns are shrunk by 5 cm and the caps draw wider
than they collide. What looks clear is clear.

**Death has weight.** An 85 ms hit-stop, a flash, a camera shake, the
tumble, the splash and its ring, then the card. The music ducks under it.

## How it's built

three.js r164, everything procedural. A sky dome shader with the sun in
it; a water shader with ripples, fresnel and the sun's glitter; three
periodic parallax ridges; instanced clouds; instanced pillar bodies, caps
and their reflections in the lake; a bird from spheres with wings hinged at
the shoulder; one instanced quad pool for feathers, spray and sparks. Four
moods (dawn, day, dusk, night) are lerped through by distance.

Sound is synthesised in-file: a wingbeat, a two-note chime that climbs a
step every ten pillars, a thud, a splash, a small fanfare for medals, and
a `drift` music bed whose intensity rises with the score.

## Test

```
node kingfisher/test-model.js kingfisher/main.js
```

Difficulty monotone, bounded and cliff-free; every gap inside the play
band and reachable from the last; collision cases; hover before the first
flap; no input dies in the water before the first pillar; the planner
clears 200 on eight seeds; the steady player reaches silver; scoring counts
exactly one point per pillar; medals; determinism.
