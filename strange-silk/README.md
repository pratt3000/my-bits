# Strange Silk

A mobile-first [Plethora Bit](https://create.plethora.studio) — generative art
from deterministic chaos. A 2D chaotic map is iterated over a million times from
a single seed, and the density of where its orbit lands *is* the picture:
filigree threads of light on deep ink. Tap anywhere for a new seed.

## Files

| File            | Purpose                                                           |
| --------------- | ----------------------------------------------------------------- |
| `plethora.json` | Manifest (`plethora-bit@2`, runtime global `window.plethoraBit`).  |
| `main.js`       | The entry source (`entry: "main.js"`).                             |

## The autonomous system

Four classic strange attractors, chosen by seed — **de Jong**, **Clifford**,
**Svensson** and **Fractal Dream**. Each is a two-line recurrence with four
constants; iterate it and the orbit never repeats and never escapes, and the
shape it wears into the plane is the artwork. Nothing about the image is
authored: the seed picks the map, its four constants and the colour ramp.

- **Log tone mapping** is what makes it read as silk. A handful of cells collect
  thousands of hits while most collect two or three; a linear ramp would show a
  white core in a black field and nothing else.
- **Cosine palettes** (after Inigo Quilez) — three cosine waves held out of
  phase always land on a harmonious ramp, so a random seed cannot pick an ugly
  one.
- **Degenerate seeds are measured and skipped.** Many constants collapse the
  orbit to a point or a bare loop. Each candidate is probed for its extent and
  for how much of a 64×64 grid it visits; anything under the threshold is
  rejected and the next seed is tried, up to 24 times.
- **Quarter turn when it helps.** Most attractors are wider than they are tall
  and a phone is the opposite, so both orientations are fitted and the one that
  fills more of the frame wins.

## Features

- **Tap anywhere for a new seed** — new equation, new constants, new colours.
- **Reproducible.** The seed shown at the top is the whole painting; the PRNG is
  `mulberry32`, so the same seed paints the same picture on any device.
- **Progressive bloom** — ~1.2M orbit steps land over about a hundred frames,
  then the print rests and the frame loop costs nothing.
- Ambient `drift` music bed and light haptics on reseed, both capability-gated.

## Contract notes

Built against agent context **`plethora-agent-context-2026-08-13.1`** using only
the documented `ctx` SDK surface:

- No packaged assets (`maxAssets: 0`), no dependencies, no network egress.
- Permissions declared for every gated API used: `haptics`, `backgroundMusic`.
- The density buffer is an **`OffscreenCanvas`** — bits may not mint canvases
  through the host document, and `ctx.createCanvas()` returns a *display*
  surface. Where `OffscreenCanvas` is missing, the bit falls back to plotting
  points directly onto the display canvas with additive blending: plainer, but
  never blank.
- Overlay markup is declared on the `ctx.createRoot()` element and queried back
  out via `data-el` attributes. No host-document access, no
  `getBoundingClientRect`, and timers go through `ctx.timeout`.

## Uploading a draft

Publishing is intentionally manual. To upload as a draft, an agent pairs with
the creator at <https://create.plethora.studio/agent-pair>, then `POST`s
`{ source, manifest }` to `/v1/agent/bits/drafts` (API origin
`https://api.plethora.studio`) with an `Authorization: Plethora-Agent <token>`
header. See the agent context for the full pairing flow.
