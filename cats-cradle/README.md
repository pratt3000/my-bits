# Cat's Cradle

A mobile-first [Plethora Bit](https://create.plethora.studio) — the string game
that only works if there are two of you. One loop, four hands, and a sequence of
figures handed back and forth.

The oldest game in the world that needs a sibling, which is why it is here.

## Files

| File            | Purpose                                                           |
| --------------- | ----------------------------------------------------------------- |
| `plethora.json` | Manifest (`plethora-bit@2`, runtime global `window.plethoraBit`).  |
| `main.js`       | The entry source (`entry: "main.js"`).                             |

## How it works

Twelve pegs — thumb, index and little finger of four hands, two pairs facing
each other. The string is **one closed Verlet loop** of 132 nodes, pinned
wherever it crosses a finger and simulated everywhere else, with rest lengths
set 1% short per run so it goes taut between pegs and sags when it is not held.

A figure is a closed path through those pegs. Applying one distributes the nodes
along the path in proportion to each run's length, pins the node at each peg, and
gives every run a little depth so strands cross rather than fight for pixels.
Transitions morph the whole loop into the new path and hand it back to the
physics.

You do not make a figure so much as **take** one: pinch the highlighted strand,
carry it to the ring, let go. Grab the wrong strand and the whole thing falls out
of the air under gravity, which is exactly what happens in the real game.

The six figures are the real sequence — **Opening A, Soldier's Bed, Candles,
Manger, Diamonds, Cat's Eye** — and each move names the real thing to do: which
strand, which finger, whose hand. To be straight about it: the figures are
authored as paths through the pegs to resemble the real ones, not derived from a
topological simulation of string-figure moves. The string between the pegs is
genuinely simulated; the shapes it is asked to hold are drawn by hand.

## Features

- **The glowing strand is the answer.** It pulses, it is thicker than the rest,
  and the ring shows where it goes. Nobody should have to guess.
- **Wrong strand, and it collapses** — the pins release, gravity takes it, and
  it lands in a heap before resetting. Your streak goes to the leaderboard.
- Hands with forearms running off the edge of the frame, because a palm with
  three fingers on it and nothing else reads as a spider.
- Six pips for the six figures, and a best-so-far.

## Sound

Karplus-Strong plucks — a burst of noise round a delay line one period long —
for taking hold of the string and for each figure taken, rising through the
sequence. A soft chime per figure, a low four-note pad underneath, and a
descending slump when it all comes down.

## Contract notes

Built against agent context **`plethora-agent-context-2026-08-13.1`** using only
the documented `ctx` SDK surface:

- Dependency: `three@0.164.1` via `ctx.importModule`, with the exact registry
  URL literal as a fallback.
- No packaged assets (`maxAssets: 0`) and no network egress; the glow and ring
  sprites are baked into an `OffscreenCanvas` at startup.
- Permissions declared for every gated API used: `audio`, `backgroundMusic`,
  `haptics`, `storage`.
- Memory: one `records` channel, `figures`, `dedupe: best_per_user`.
- The string is a pre-allocated tube buffer; the solver alternates sweep
  direction so tension propagates round the loop in one pass.
- Pointer positions come from `event.offsetX`/`offsetY`; no canvas layout
  queries, no bare timers, no host-document access.

## Verified

Driven headless in Chromium against a mock `ctx` built strictly to `sdk.md`:
boots and paints before three loads, Opening A holds taut between the near
hands, taking the highlighted strand to the ring advances through Soldier's Bed,
Candles and Manger with the pips and `milestone`/`setProgress` tracking, a wrong
grab collapses and resets, and a mid-session viewport change re-layouts — no
runtime errors, no console warnings.

## Uploading a draft

Publishing is manual. An agent pairs with the creator at
<https://create.plethora.studio/agent-pair>, then `POST`s `{ source, manifest }`
to `/v1/agent/bits/drafts` (API origin `https://api.plethora.studio`) with an
`Authorization: Plethora-Agent <token>` header.
