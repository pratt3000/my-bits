# Morphogen

A mobile-first [Plethora Bit](https://create.plethora.studio) — Turing's 1952
answer to why a leopard has spots, running live in your hand. Two chemicals, one
that feeds itself and one that eats it, diffusing at different speeds. Nothing
in the maths knows what a spot is, yet spots appear. Drag to pour more in; tap
for a new seed.

## Files

| File            | Purpose                                                           |
| --------------- | ----------------------------------------------------------------- |
| `plethora.json` | Manifest (`plethora-bit@2`, runtime global `window.plethoraBit`).  |
| `main.js`       | The entry source (`entry: "main.js"`).                             |

## The autonomous system

The **Gray–Scott** form of a reaction–diffusion system, integrated on a wrapped
grid of ~30,000 cells:

```
u' = u + Du·∇²u − uv² + F(1 − u)
v' = v + Dv·∇²v + uv² − (F + k)v
```

Every one of the ten species in the bit is *the same two equations*. Only the
feed rate `F` and kill rate `k` differ, and that alone decides whether you get
Coral, Mitosis, Solitons, Worms, Labyrinth, Fingerprint, Waves, Holes, Moss or
Flicker. The seed also jitters `F`/`k` slightly, so two runs of one species are
not twins.

- **How the first chemical is dropped changes everything**, because the reaction
  only ever grows outward from what it is given. Six inoculation patterns —
  drop, scatter, ring, lattice, band, dust.
- **Relief from the gradient.** Colour comes from `v`; a cheap directional light
  off `∇v` gives the pattern depth, so it reads as carved shell rather than a
  heat map.
- **Hand-picked colour ramps** rather than random hue. Reaction–diffusion reads
  as a *material* — nacre, ember, jade, patina — and materials have particular
  colours.

## Features

- **Drag to pour** more chemical in and grow the pattern out of your finger.
- **Tap for a new seed** — new species, palette and starting drop. Tap and drag
  are told apart on release by distance travelled, so a tap never leaves a
  stray blob behind.
- **Adaptive step count.** The bit spends whatever the device can afford on
  chemistry (3–9 iterations per frame, steered by measured frame time), so a
  slow phone runs the reaction more gently instead of dropping frames.
- Ambient music bed and light haptics on reseed, both capability-gated.

## Contract notes

Built against agent context **`plethora-agent-context-2026-08-13.1`** using only
the documented `ctx` SDK surface:

- No packaged assets (`maxAssets: 0`), no dependencies, no network egress.
- Permissions declared for every gated API used: `haptics`, `backgroundMusic`.
- The grid is rendered into an **`OffscreenCanvas`** via `putImageData` and
  scaled up to the display canvas. Where `OffscreenCanvas` is missing it falls
  back to drawing the grid as filled blocks — blockier, but alive.
- Pointer positions use `event.offsetX`/`offsetY`, which are already
  canvas-relative and avoid a forced reflow per move.
- Overlay markup is declared on the `ctx.createRoot()` element and queried back
  out via `data-el` attributes. No host-document access, no bare timers.

## Uploading a draft

Publishing is intentionally manual. To upload as a draft, an agent pairs with
the creator at <https://create.plethora.studio/agent-pair>, then `POST`s
`{ source, manifest }` to `/v1/agent/bits/drafts` (API origin
`https://api.plethora.studio`) with an `Authorization: Plethora-Agent <token>`
header. See the agent context for the full pairing flow.
