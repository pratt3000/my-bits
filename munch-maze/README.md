# Munch Maze 🟡

The 1980 dot-eating maze chase, rebuilt for a phone at the arcade's 224×288
and scaled up in whole pixels. The maze is the classic 28×31 layout with its
244 dots, and the ghosts run the documented rules: their own targeting, the
scatter and chase waves, per-level speed and fright tables, Cruise Elroy, the
ghost-house dot counters, the fruit schedule and the slow tunnel.

All art, sound and code is original and generated in `main.js`. The walls are
drawn from the tile map at load time with rounded inner and outer lines, and
the ghosts, fruits and the muncher are hand-drawn pixels.

## How it plays

- **Swipe** anywhere to steer. A turn is remembered and taken at the next
  corner, and you can pre-turn up to four pixels early. On a keyboard: arrows
  or WASD.
- Dots 10, energisers 50. Ghosts while frightened: 200, 400, 800, 1600 per
  energiser. Fruit appears under the ghost house after 70 and 170 dots.
- Extra life at 10000. Three lives to start.
- Clear the maze and it flashes; the next level is faster with shorter
  fright times.

### The ghosts

| Colour | Chase target |
|---|---|
| Red | Your tile. Speeds up as "Cruise Elroy" when few dots remain. |
| Pink | Four tiles ahead of you (with the original's up-plus-left quirk). |
| Cyan | Twice the vector from the red ghost to two tiles ahead of you. |
| Orange | Your tile while more than eight tiles away, otherwise its corner. |

Scatter corners: red top right, pink top left, cyan bottom right, orange
bottom left. Ghosts never reverse on their own, cannot turn up in the four
tiles above and below the house, and pick a random turn when frightened.
Level 1 waves: 7 s scatter, 20 chase, 7, 20, 5, 20, 5, then chase for good.
Levels 2 to 4 and 5+ use the arcade's shortened tables.

### Speeds and fright

Level 1: muncher 80 %, ghosts 75 %, tunnel 40 %, fright 6 s with 5 flashes.
Levels 2 to 4: 90 / 85 / 45, fright 5, 4, 3 s. Levels 5 to 20: 100 / 95 / 50,
with the fright timer shrinking to nothing by level 19. Levels 21+: 90 / 95.
Full speed is 75.76 px/s. Eating a dot pauses the muncher one frame, an
energiser three, exactly as the cabinet does.

Cruise Elroy: the red ghost gets 5 % faster at 20 dots left on level 1 and
another 5 % at 10, with the thresholds rising by level to 120 and 60.

### Leaving the house

Pink leaves at once. Cyan leaves after 30 dots and orange after 60 on level 1
(0 and 50 on level 2, at once from level 3). After a lost life a global
counter takes over: 7, 17 and 32 dots. If no dot is eaten for four seconds
(three from level 5) the next ghost is let out anyway.

### Fruit

Cherry 100, strawberry 300, orange 500 (levels 3 and 4), apple 700 (5 and 6),
melon 1000 (7 and 8), galaxian 2000 (9 and 10), bell 3000 (11 and 12), key
5000 from level 13. The bottom right shows the last seven.

## Records

- `score` — High Score
- `level` — Level Reached

## Platform

`ready` on load, `start` on the first tap, `interact` when play begins,
`setScore` on every point, `milestone("level")` on each cleared maze, `fail`
on each death naming the ghost, `complete` at game over with the final
score. Haptics on energisers, ghost eats, fruit and deaths. The siren is one
oscillator retuned as the dots run out, with a faster wobble while
frightened and a rising sweep while eyes are heading home; chomps, ghost
and fruit stings, the death tune and a start jingle are synthesised too.
