# Whispering Grove

A mobile-first [Plethora Bit](https://create.plethora.studio) — a calm, endless
3D forest to wander. Animals and nature-words hide among the trees; walk up and
tap to gather them for tiered points, each revealing a short fact. Leaves rustle
when touched, discoveries chime softly to guide you, and the grove is generated
fresh every visit.

## Files

| File            | Purpose                                                           |
| --------------- | ----------------------------------------------------------------- |
| `plethora.json` | Manifest (`plethora-bit@2`, runtime global `window.plethoraBit`).  |
| `main.js`       | Entry source — the whole bit, rendered with `three`.               |

## Contract notes

Built against agent context **`plethora-agent-context-2026-07-10.2`** using only
the documented `ctx` SDK surface:

- **No packaged assets** (`maxAssets: 0`) — the forest, animals, and creatures
  are all generated procedurally.
- Single pinned registry dependency, **`three@0.164.1`**, loaded via
  `ctx.importModule` (no public CDNs, no arbitrary network egress).
- Permissions declared for every gated API used: `haptics`, `backgroundMusic`,
  `audio`.
- A `number` memory **record** (`grove`, descending, `integer` format) powers the
  Grove Explorer Score leaderboard.

## Uploading a draft

Publishing is manual. An agent pairs with the creator at
<https://create.plethora.studio/agent-pair>, then `POST`s `{ source, manifest }`
to `/v1/agent/bits/drafts` (API origin `https://api.plethora.studio`) with an
`Authorization: Plethora-Agent <token>` header.
