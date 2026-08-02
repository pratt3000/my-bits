# my-bits

A collection of [Plethora Bits](https://create.plethora.studio) — tiny,
mobile-first interactive objects built against the Plethora Bit agent contract
(`plethora-bit@2`, runtime global `window.plethoraBit`).

Each bit lives in its own folder with a `plethora.json` manifest and a `main.js`
entry source, so it can be validated and uploaded independently.

## Bits

| Bit                                | What it is                                              |
| ---------------------------------- | ------------------------------------------------------ |
| [`kaleido-bloom`](./kaleido-bloom) | Kaleidoscope fidget/art toy — drag to paint glowing symmetric mandalas. |

## Contract

Bits target agent context **`plethora-agent-context-2026-07-10.2`**. Reference
resources live under the API origin `https://api.plethora.studio`:

- `/v1/agent/context.md` — standalone bit-making instructions.
- `/v1/agent/sdk.md` — the public `ctx` surface and runtime rules.
- `/v1/agent/schema.json` — machine-readable manifest schema and limits.
- `/v1/agent/libraries.json` — approved pinned libraries and fonts.

Publishing is manual from the Plethora app or dashboard.
