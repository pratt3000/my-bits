# Kaleido Bloom

A mobile-first [Plethora Bit](https://create.plethora.studio) — a kaleidoscope
fidget/art toy. Drag a finger to paint glowing, radially-symmetric mandalas.
Strokes mirror around the centre (dihedral symmetry), colours drift over time,
and the pattern slowly breathes and fades so it always feels alive.

## Files

| File            | Purpose                                                        |
| --------------- | ------------------------------------------------------------- |
| `plethora.json` | Manifest (`plethora-bit@2`, runtime global `window.plethoraBit`). |
| `main.js`       | The entry source (`entry: "main.js"`).                        |

## Features

- **Kaleidoscope painting** — every stroke is replicated across 6/8/12/16
  wedges plus a mirror, using additive blending so overlaps bloom to white.
- **Attract mode** — before the first touch an autopilot paints an evolving
  rose curve, so the first frame is never blank.
- **Tactile feedback** — `haptics` on touch and control taps.
- **Ambient bed** — the `drift` background-music preset fades in on first
  gesture (`backgroundMusic` permission), guarded by `ctx.capabilities`.
- **Light-touch controls** at the top (respecting `ctx.safeArea.top`): change
  symmetry (`✦`), clear (`⟲`), and a point-wise instructions panel (`?`).

## Contract notes

Built against agent context **`plethora-agent-context-2026-07-10.2`** using only
the documented `ctx` SDK surface:

- No packaged assets (`maxAssets: 0`) — all visuals are generated procedurally.
- No external dependencies or network egress.
- Permissions declared for every gated API used: `haptics`, `backgroundMusic`.
- Surfaces via `ctx.createCanvas2D` / `ctx.createRoot`; all listeners, frames,
  and music are registered through `ctx` so the runtime owns cleanup.

## Uploading a draft

Publishing is intentionally manual. To upload as a draft, an agent pairs with
the creator at <https://create.plethora.studio/agent-pair>, then `POST`s
`{ source, manifest }` to `/v1/agent/bits/drafts` (API origin
`https://api.plethora.studio`) with an `Authorization: Plethora-Agent <token>`
header. See the agent context for the full pairing flow.
