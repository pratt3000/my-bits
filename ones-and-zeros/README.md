# Ones & Zeros

A mobile-first [Plethora Bit](https://create.plethora.studio) — Conway's Game of
Life, alive in colour. Every new cell blinks in as a **1** and inherits a blend
of the three colours that made it; as it survives it softens into a glowing dot
and drifts in hue; the instant it dies it flashes a **0** and fades. Drag to
draw, drop gliders, pulsars and a glider gun, and watch rainbow colonies spread,
collide and burn out.

## Files

| File            | Purpose                                                          |
| --------------- | ---------------------------------------------------------------- |
| `plethora.json` | Manifest (`plethora-bit@2`, runtime global `window.plethoraBit`). |
| `main.js`       | Entry source — the whole bit, drawn on one 2D canvas.             |

## Contract notes

Built against agent context **`plethora-agent-context-2026-07-10.2`** using only
the documented `ctx` SDK surface:

- **No packaged assets** (`maxAssets: 0`) and **no dependencies** — the boards
  are generated in code and everything is drawn procedurally.
- The digits use **`space-mono@1.0.0`** from the approved font registry via
  `ctx.loadFont`, requested after the first frame; if it fails the system
  monospace stack carries the whole bit.
- Permissions declared for every gated API used: `haptics`, `backgroundMusic`,
  `storage` (`ctx.storage` holds only the speed and mute preference).
- No memory channels — this bit is a private sandbox, not a shared one.

## How it works

The rules are the classic **B3/S23** on a wrapping (toroidal) grid, so gliders
that run off one edge come back in on the other.

**Colour is a lineage, not decoration.** A newborn cell takes the circular mean
of the hues of the three neighbours that produced it, plus a little mutation, so
you can watch a colour travel across the board inside a glider and see two
colonies blend where they meet. Survivors drift about half a degree of hue per
generation, which is invisible step to step but means a long-lived still life
slowly changes colour.

**Age drives the glyph.** A cell is born as a bright `1`, crossfades into a dot
over its first four generations, and dims as it matures. A cell that just died
draws a fading `0` for 420 ms. Only live and just-died cells are drawn.

Frame budget: hue means are computed from per-cell `cos`/`sin` prepared once per
generation rather than eight times per cell, and every colour string is built
once into a 48-hue × 8-age lookup table instead of composed per cell per frame.
The simulation runs on a fixed step (3, 8 or 16 generations per second) while
rendering stays at display rate, so the birth pops and death fades animate
smoothly between generations.

Boards come from four generators — a mirror-symmetric soup, a rainbow band, a
scattering of classic patterns, and rings that collapse into a firework of
gliders. If a board dies out or settles into still lifes **and** nobody has
touched it for a while, a little new life drifts in; a board you just cleared
yourself is left alone.

## Patterns

The stamp tray offers glider, lightweight spaceship, R-pentomino, acorn,
diehard, pulsar, pentadecathlon, and the Gosper glider gun — filtered to the
ones that actually fit the current board, so the gun appears once the screen is
wide enough (landscape, or a tablet). Each stamp lands with its own hue, so you
can follow what your glider gun is producing.

## Uploading a draft

Publishing is manual. An agent pairs with the creator at
<https://create.plethora.studio/agent-pair>, then `POST`s `{ source, manifest }`
to `/v1/agent/bits/drafts` (API origin `https://api.plethora.studio`) with an
`Authorization: Plethora-Agent <token>` header.
