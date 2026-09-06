# Barrel Heights 🛢️

The four-screen arcade climber from 1981, rebuilt for a phone: sloped girders
and rolling barrels, the pie factory's conveyors, the elevators with bouncing
springs, and the rivets that bring the ape down. It runs at the arcade's
224×256 and scales up in whole pixels, so every sprite is a crisp block.

All art, sound and code is original and generated in `main.js`. The screens are
laid out from memory of the genre rather than copied, and the characters are
this bit's own ape, lady and carpenter.

## How it plays

- **Pad** (bottom left) walks and climbs: drag toward an arrow. A diagonal
  push walks and climbs at once, so hold up-right and the carpenter takes
  the next ladder he passes. **JUMP** (bottom right, or a tap on the
  playfield) jumps. A direction pressed in the first few frames of a jump, or
  released just before it, still makes it a running jump. On a keyboard:
  arrows or WASD, space or Z to jump, Enter to start.
- The first three games open with a HOW TO PLAY card, and on level 1 a
  JUMP! prompt flashes over the carpenter when a barrel is about to reach
  him, until three barrels have been hopped.
- A running jump toward a barrel is far more forgiving than a standing hop:
  about half a second of leeway against a quarter. Climbing a few rungs up
  any ladder, broken ones included, puts you out of reach of barrels on the
  girder below.
- Jump over a barrel, fireball, spring or pie for **100** (300 for two in one
  jump, 500 for three). Land a fall longer than your own height and you die.
- **Hammer**: jump into it to grab it. For nine seconds it smashes anything it
  touches for 300, 500 or 800. You cannot jump or climb while holding it.
- **Items** (hat, purse, umbrella): 300 on level 1, 500 on level 2, 800 after.
- **Bonus** counts down from 5000 (more on later levels) in steps of 100
  every two seconds. Reach the lady and it is added to your score. Hit zero
  and you lose a life.
- Extra life at 7000, then every 20000. Three lives to start.

### The four screens

| Height | Screen | What happens |
|---|---|---|
| 25 m | Girders | The ape rolls barrels down six sloped girders. Barrels take ladders at random, more often when you are below them. The first barrel is blue: when it reaches the oil drum it lights it and a fireball climbs out. Two hammers. Now and then the ape drops a barrel straight down that bounces from girder to girder. |
| 50 m | Conveyors | Three pairs of belts that reverse on their own clocks. Pies ride the belts and drop off the ends. The oil drum breeds fireballs. Two hammers, one on a centre shelf you can only reach by jumping across the middle belts. |
| 75 m | Elevators | Two shafts, one rising, one falling. Ride to the top or bottom of a shaft and you are crushed. Springs bounce along the top from the ape and drop down the right-hand shaft where the final ladder is. Fireballs patrol the right-hand platforms. |
| 100 m | Rivets | Eight rivets on four floors. Walk over or jump over one to pull it, which leaves a gap you have to jump. Pull all eight and the floor drops from under the ape. Fireballs, items and two hammers. |

After the rivets the level goes up and all four screens come round again.

## Difficulty

An internal difficulty from 1 to 5 rises with the level and with time spent
on a screen (one step every 45 seconds), and level 1 never goes past 3. It
drives barrel speed (1.1 px per frame at 1, up to 1.6 at 5) and throw rate
(one every 3.2 s at 1, down to 1.5 s at 5), how often barrels take a ladder
toward you, wild-barrel odds (none on level 1 until difficulty 3), fireball
speed and count (one fireball on level 1, lit by the fourth barrel rather
than the first), belt speed, pie rate, elevator speed, and spring rate and
speed.

## Records

- `score` — High Score
- `height` — Height Reached (100 per completed level plus the height of the
  screen you were on)

## Platform

`ready` on load, `start` on the first tap, `interact` when a screen begins,
`setScore` on every point, `milestone("stage")` when a screen is cleared,
`fail` on each death with the cause, `complete` at game over with the final
score. Haptics on jump, hammer hits, rivets, deaths and the ape's falls.
All sound is Web Audio synthesis: footsteps, the jump whoop, the hammer
riff, the death tune, the screen-start jingle and "how high" motif.
