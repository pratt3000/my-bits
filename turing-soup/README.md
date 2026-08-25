# Turing Soup

A mobile-first [Plethora Bit](https://create.plethora.studio) — a live
reaction–diffusion dish. Two chemicals, **A** and **B**, diffuse across a
wrapping grid and react:

```
A + 2B → 3B          B eats A and copies itself
feed:   A ← (1 − A)  the dish is topped up with A
kill:   B → ∅        B decays away
```

Nothing in this bit is drawn. Coral, worms, mazes, packed solitons and drifting
blobs all fall out of that one rule (the Gray-Scott model) — the classic
demonstration of Turing's 1952 idea that chemistry alone can grow pattern.

## Files

| File            | Purpose                                                           |
| --------------- | ----------------------------------------------------------------- |
| `plethora.json` | Manifest (`plethora-bit@2`, runtime global `window.plethoraBit`).  |
| `main.js`       | The entry source (`entry: "main.js"`).                             |

## Interaction

- **Drag anywhere** to inject chemical B — structure blooms out of your finger
  and keeps growing after you let go.
- **Feed/kill pad** (in the tuning panel, opened with **≡**) steers the two
  reaction rates live. The pad *is* the phase space: the presets sit on it as
  landmarks,
  and the marker shows where the dish currently lives. Small moves across it
  morph the whole colony without ever resetting it.
- **Preset chips** — Coral, Worms, Maze, Solitons, Holes, Amoeba.
- **Scale** resizes the structures (diffusion rate); **Speed** sets how many
  simulation steps run per frame.
- **≡** opens the tuning panel, **◐** cycles palette, **✳** scatters fresh
  seeds, **⟲** clears the dish, **♪** toggles sound, **?** explains the rules.

The grid is toroidal, so growth wraps off every edge instead of hitting a wall.
Large parts of feed/kill space are lethal, so a dish that goes quiet reseeds
itself — steering into a dead corner is interesting rather than terminal, and
the bit is never a black screen.

### Choosing the presets

Each chip was checked numerically before shipping: six random seedings run for
4000 steps, keeping only regimes that survived every one. The textbook
*mitosis* (`f .0367 / k .0649`) and *spiral* (`f .014 / k .045`) corners are
famous but knife-edge from small seeds — mitosis survived 2 runs in 6 and
spirals 0 in 6 — so they were dropped in favour of Holes and Amoeba, which
survive 6 of 6 and look nothing like the others.

The **Scale** range is bounded by numerical stability, not taste. Explicit Euler
on the 9-point stencil has `λ_min = -1.6`, so `dt · Da < 1.25`; past that the
grid tears into a checkerboard. Measured blow-up starts at exactly `Da = 1.25`,
and the slider stops at `1.10`.

## How it works

The simulation runs on the GPU. Two ping-pong float framebuffers hold `(A, B)`;
one fragment shader advances Gray-Scott with a 9-point Laplacian, a second packs
a blurred B plus its Sobel gradient, and the display pass reads that once and
shades it — treating B as a height field lit like wet tissue, with a cosine
palette sampled at slightly offset stops per channel for iridescence.

`RGBA32F` is preferred because Gray-Scott's per-step deltas are tiny; `RGBA16F`
is the fallback, and a reduced CPU simulation runs on a 2D canvas if a device
has no float-renderable WebGL2 at all.

Sound is a `drone` bed whose intensity and volume follow the colony: an 8×8
reduction pass averages B on the GPU and is read back twice a second, so a busy
dish sounds fuller than a sparse one.

## Contract notes

Built against agent context **`plethora-agent-context-2026-07-10.2`** using only
the documented `ctx` SDK surface:

- No packaged assets (`maxAssets: 0`) — every visual and sound is procedural.
- No external dependencies and no network egress.
- Permissions declared for every gated API used: `haptics`, `backgroundMusic`,
  `storage` (last palette and parameters are remembered).
- Surfaces via `ctx.createCanvas` / `ctx.createRoot`; all listeners, frames,
  timers and music go through `ctx` so the runtime owns cleanup.
- First frame draws the seeded dish before `ctx.platform.ready()`, so the bit is
  never blank; `ctx.platform.start()` fires on the first real gesture.
- Controls sit clear of `ctx.safeArea`. The tuning panel is parked fully
  off-screen until summoned, so nothing but a compact top row ever sits over
  the artwork.

## Uploading a draft

Publishing is intentionally manual. To upload as a draft, an agent pairs with
the creator at <https://create.plethora.studio/agent-pair>, then `POST`s
`{ source, manifest }` to `/v1/agent/bits/drafts` (API origin
`https://api.plethora.studio`) with an `Authorization: Plethora-Agent <token>`
header. See the agent context for the full pairing flow.
