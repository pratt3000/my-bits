# Kingfisher

One tap to fly. The original one-tap bird, rebuilt faithfully: its rules,
its numbers, its pixel language. Not a reinterpretation.

## The rules, and where they come from

The constants are the ones the well-known faithful clones carry
(sourabhv's FlapPyBird and the projects built on it, nebez's floppybird
for the medals and the game-over choreography), which are the closest
thing to the original's numbers that exists in the open:

| Rule | Value |
|---|---|
| World | 288 × 512, thirty ticks a second |
| Bird | 34 × 24 at x = 57, starts at y = 244 |
| Gravity | 1 px per tick per tick, fall capped at 10 |
| Flap | sets the fall to −9: a rise of exactly 45 px, 9+8+…+1 |
| Pipes | 52 wide, 4 px a tick, gap 100 |
| Gap position | top uniform over [80, 221], so anywhere in a 142 px band |
| Spacing | first pipes at 488 and 632; a new one at 298 when the first crosses x < 5 (144 to 152 apart) |
| Score | the tick the bird's middle passes the pipe's middle |
| Nose | 20° up for eight ticks after a tap, then 3° a tick down to −90° |
| Ground | y = 404; a dead bird falls at 2 px per tick per tick, capped at 15 |
| Medals | bronze 10, silver 20, gold 30, platinum 40 |

Difficulty is constant, like the original. The randomness is the
difficulty: a gap can sit 141 px from the last one, and the drop or the
climb has to happen in the sixteen ticks of clear air between pipes.

## Why it feels right

**The model is pure and runs at the original's tick rate.** Everything
between `MODEL BEGIN` and `MODEL END` in `main.js` knows nothing about the
canvas or the platform. It steps at 30 Hz from an accumulator capped at a
quarter second, so a slow frame never spirals and a run is reproducible
from its seed. Rendering interpolates the bird and the pipes between
ticks, so it is smooth at 60 or 120 Hz while the physics stays the
original's integer-per-tick arithmetic.

**Taps are queued, not sampled.** A tap between two frames is counted at
the next tick.

**Fairness is a test.** `test-model.js` slices the model out and plays it
with two bots. The steady one does what a person does: glides and taps at
the last moment that keeps it off the pipe's floor, holds a height inside
each gap's safe window leaning toward the next gap, and taps no faster
than six times a second. The planner is the same player, but every other
tick it plays both choices two seconds forward and keeps the one that
lives longer. The planner must clear 200 pipes on every seed or the suite
fails. As tuned, the steady bot scores 10 to 99 over eight seeds, which
is the spread real players get.

**Hitboxes forgive two pixels.** The original used pixel masks; this uses
the bird's rectangle inset by two pixels on every side, which is a hair
kinder at the rounded corners and never crueller.

## The look

Everything is drawn in-file on the original's grid: two-by-two pixels on a
144 × 256 field, a dark outline on every shape. A round bird with a white
eye, a red beak and a wing on a hinge (three frames, changing every third
tick), in yellow, blue or red, picked per game. Green pipes with a wider
cap, lit from the left. A tan ground with a striped verge, scrolling at
the pipes' speed. A day and a night backdrop, picked per game: clouds, a
city, bushes; stars and lit windows at night. The chunky outlined score
digits, "GET READY!" with the tap hint, "GAME OVER" dropping in, the tan
score board sliding up with SCORE, BEST, the medal and a NEW tag, then the
OK button. A white flash on the hit.

The scale is chosen so a logical pixel is a whole number of device
pixels, so the art stays crisp on any phone; the sky extends above the
frame and the sand below it on taller screens.

Sound is synthesised: wing, point, hit, die, swoosh. No music, like the
original.

## Test

```
node kingfisher/test-model.js kingfisher/main.js
```
