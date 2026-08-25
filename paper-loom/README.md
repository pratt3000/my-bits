# Paper Loom

A mobile-first [Plethora Bit](https://create.plethora.studio) — a print that
lays itself out. The page cuts itself in two, then cuts each half in two, until
the pieces are worth looking at; every piece then picks a motif and a colour on
its own. Tap for a new seed and watch the page rebuild.

## Files

| File            | Purpose                                                           |
| --------------- | ----------------------------------------------------------------- |
| `plethora.json` | Manifest (`plethora-bit@2`, runtime global `window.plethoraBit`).  |
| `main.js`       | The entry source (`entry: "main.js"`).                             |

## The autonomous system

Recursive binary subdivision, then a motif per leaf cell. The rules are the ones
a designer would use, which is why the output composes rather than just tiles:

- **Split the longer side.** Cutting whichever side is longer keeps the
  generator from producing slivers.
- **Ratios a person would reach for** — halves, thirds, and the golden section
  (0.382 / 0.618), not uniform random cuts.
- **A vocabulary per page.** Each composition draws from a random 3–6 motif
  subset of the thirteen available (Truchet arcs, half-discs, rings, stripes,
  chevrons, dots, quarter-discs, crosses, wedges, sunbursts, eyes, checkers,
  flat), so a page has a recognisable accent instead of showing off everything
  at once.
- **Quiet ground.** A share of pieces stay flat. A composition that patterns
  every piece reads as noise; the empty ground is what makes the rest land.
- **Chosen palettes, not sampled colour.** Ten flat printerly palettes —
  Bauhaus, Riso, Terrazzo, Midnight, Sand, Ink, Coast, Bloom, Cobalt, Moss. A
  generator is only as tasteful as its colours.
- **Truchet arcs** are the one motif that talks to its neighbours: quarter-arcs
  on opposite corners line up across cell boundaries by accident, and the eye
  joins them into long meandering curves.

## Features

- **Tap anywhere** for a new seed — new cuts, motifs, palette and reveal order.
- **Drag to shuffle.** The stroke is a brush that re-rolls only the pieces you
  sweep across, each arriving again with the same ease-in. Re-rolls stay inside
  the page's own palette and motif vocabulary, so an edited composition still
  reads as one design rather than a scrapbook — you can push a layout around
  until it sits right instead of throwing the whole page away.
- **Staggered arrival.** Pieces land over about a second, in one of four seeded
  orders (random, wipe, radial, columns), each with a small ease and scale-up.
- **Paper grain** — a noise tile laid over the finished page in `overlay` mode,
  so it reads as printed ink on stock rather than flat screen colour.
- Once the page is printed the frame loop early-returns; a finished print costs
  nothing to keep on screen.

## Contract notes

Built against agent context **`plethora-agent-context-2026-08-13.1`** using only
the documented `ctx` SDK surface:

- No packaged assets (`maxAssets: 0`), no dependencies, no network egress.
- Permissions declared for every gated API used: `haptics`, `backgroundMusic`.
- The grain tile is an **`OffscreenCanvas`** turned into a repeating
  `CanvasPattern`; if `OffscreenCanvas` is unavailable the grain is simply
  skipped and the page prints clean.
- Opens on a half-printed page rather than bare paper — technically a first
  frame, but not one worth looking at.
- Overlay markup is declared on the `ctx.createRoot()` element and queried back
  out via `data-el` attributes. No host-document access, no bare timers.

## Uploading a draft

Publishing is intentionally manual. To upload as a draft, an agent pairs with
the creator at <https://create.plethora.studio/agent-pair>, then `POST`s
`{ source, manifest }` to `/v1/agent/bits/drafts` (API origin
`https://api.plethora.studio`) with an `Authorization: Plethora-Agent <token>`
header. See the agent context for the full pairing flow.
