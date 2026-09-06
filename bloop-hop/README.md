# Bloop's Big Hop 🟢

A chunky 3D side-scrolling platformer in the classic mould: run, hop, stomp,
bonk blocks from below, ride moving platforms and grab the flag. Four worlds
of three levels each, a boss at the end of every world, three stars per
level, lives, checkpoints and power-ups.

Original hero, art and name; every model, texture and sound is generated in
`main.js`. No packaged assets.

## How it plays

- **Run** with the pad on the left half of the screen (touch and slide).
  **Jump** with the button on the right. Hold for a full jump, tap for a
  short hop. Keyboard arrows and space work on desktop.
- **Stomp** enemies from above; bounce off them, and hold jump on the
  bounce to go higher. Five stomps without touching the ground is a 1-up.
- **Bonk** ? blocks from below for coins and power-ups. Big Bloop breaks
  bricks; small Bloop bumps them, which knocks off whatever stands on top.
- 🍓 **Berry** makes you big: one free hit. ⭐ **Star** makes you invincible
  for nine seconds. 💖 **Heart** is an extra life.
- **Enemies.** Grumps walk and turn at ledges. Rollers become shells when
  stomped; kick a shell into others. Flaps fly in a sine wave. Snappers
  live in pipes, rise on a cycle, cannot be stomped, and stay down while
  you stand on their pipe.
- **Checkpoint** flag halfway; the goal flag pays more the higher you hit it.
- **Timer.** Every level has a clock at 1.8× par.
- **Stars.** Clear the level · collect 70% of the coins · beat par time.
- **Lives.** Four per campaign. Game over sends you back to the menu with
  your progress kept; levels stay unlocked.

## Worlds

| World | Theme | Music | What changes |
|---|---|---|---|
| 1 | Meadow | chiptune | gaps, blocks, stairs, pipes |
| 2 | Dunes | arcade | snappers, moving platforms, gauntlets |
| 3 | Deep Cavern | spooky | tunnels under brick ceilings, spikes, flaps, lifts |
| 4 | Sky Keep | synthwave | lava rivers, long hops, everything faster |

Level 3 of each world ends in an arena with a crowned boss who charges and
jumps. Stomp it three times (one more per world) and the stone gate to the
flag crumbles.

## Difficulty

`difficultyOf(level)` is a single 0..1 number across the campaign. Every
chunk template reads it: gap width (2 → 5 tiles), enemies per chunk, roller
share, platform count and width across a hop, mover speed, snapper chance,
spike pits, flaps over gaps, lava in the Sky Keep. Chunk weights shift with
it too, so early levels are flats, small gaps and block rows, and late
levels are hops, movers, spikes and gauntlets. Chunk count grows from 9 to
16. Par time and the clock come from the level's length and difficulty.

## Leaderboards

Two record channels: **High Score** (best campaign score) and **Stars**
(total, out of 36), submitted on every level clear and game over. Plethora
renders the standings.

## Files

- `plethora.json` — manifest (`plethora-bit@2`, `three@0.164.1`; haptics,
  backgroundMusic, audio, storage; two record channels).
- `main.js` — the whole game, one file, defines `window.plethoraBit`.

## Implementation notes

- **Levels** are a tile grid (18 rows, up to 260 columns, stored with a
  fixed stride whatever the final width) plus entity lists. Fifteen chunk
  templates are picked by weight, never the same one twice in a row, with a
  checkpoint chunk in the middle and a stair-and-flag run-up at the end.
- **Tiles are instanced**: one `InstancedMesh` per tile type, with a
  grass-topped material array for exposed ground. Block bumps move the
  instance matrix; broken bricks scale it to zero; used blocks are drawn
  from a spare pool.
- **Physics** is a separated-axis AABB sweep against the grid: horizontal
  first, then vertical, with one-way platforms crossed only from above and
  the bonked tile chosen as the one nearest the hero's centre. Jump has a
  0.14 s buffer, 0.1 s coyote time, gravity reduced while the button is
  held for the first 0.24 s, and a hard cut when it is released.
- **Camera** leads the hero by facing and speed, eases on y with a dead
  zone, and sits slightly above its look point so the blocks show their
  tops; the sun and its shadow frustum follow it.
- **Squash and stretch** on the hero for jumps and landings, feet that step
  with run speed, blink-through invulnerability, and a rainbow body while
  starred.
- **Audio** is square-wave chip synthesis: coin pitch climbs with a streak,
  the clock ticks under ten seconds, and every world has its own
  `ctx.music` preset.

## Testing

```bash
node _skills/sekai/harness/run.js bloop-hop <scenario.json>
python3 _skills/sekai/scripts/check.py bloop-hop
```

Harness hooks: `__bhDebug()`, `__bhStart(level)`, `__bhMove(-1|0|1)`,
`__bhJump(hold)`, `__bhRelease()`, `__bhWarp(x)`, `__bhDrop(x, y)`,
`__bhBossPos()`, `__bhFlag()`, `__bhKill()`, `__bhGrid(x0, x1)`.
