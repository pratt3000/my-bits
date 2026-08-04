# Tiny Reef

A mobile-first [Plethora Bit](https://create.plethora.studio) — one aquarium,
shared by everyone who opens it. Design a little fish (body, colour, pattern,
tail, size), give it a name, and release it into a reef that other people's fish
are already swimming in. Tap the water to sprinkle food and watch the shoal
chase it; tap a fish to see its name and who made it. Come back any time to
redesign yours — it updates in place for everyone.

## Files

| File            | Purpose                                                          |
| --------------- | ---------------------------------------------------------------- |
| `plethora.json` | Manifest (`plethora-bit@2`, runtime global `window.plethoraBit`). |
| `main.js`       | Entry source — the whole bit, drawn on one 2D canvas.             |

## Contract notes

Built against agent context **`plethora-agent-context-2026-07-10.2`** using only
the documented `ctx` SDK surface:

- **No packaged assets** (`maxAssets: 0`) and **no dependencies** — the water,
  caustic rays, kelp, coral, and every fish are drawn procedurally.
- Permissions declared for every gated API used: `haptics`, `backgroundMusic`,
  `storage`.
- One `objects` memory **world** (`reef`) holds the shared fish, rate-limited to
  24 writes per user per day, with `attribution` on so tapped fish can credit
  their maker.
- `ctx.storage` keeps a viewer-local copy of your fish (its id and design) so
  the designer reopens on it. Ownership is also read back from the snapshot, so
  a second device still recognises your fish.

## How the shared world is used

A whole fish is a handful of small integers — indices into fixed body, colour,
pattern, tail, size, and name tables — so a mutation is ~80 bytes and **there is
no free text anywhere in the shared world**. Names are picked from two fixed
word lists, which is what makes a world anyone can write to safe to render.

Reads are treated as untrusted: every index is clamped into range, payloads that
are not shaped like a fish are dropped, and attribution handles are clipped and
only ever drawn to canvas (never into HTML). Writes can be refused — the
designer stays open and says so instead of pretending the fish was released.

The bit stays playable when the reef is unreachable: the counter reads
`🐠 solo`, a few procedurally generated "wild" fish keep the tank alive, and
feeding and tapping still work. Wild fish make room as real ones arrive and are
labelled `wild` when tapped, so they are never passed off as someone's work.

Only a window of the reef is drawn (22 fish) to stay smooth on a phone. The
window is offset per session, so different visitors meet different neighbours,
and your own fish is always in it.

## Uploading a draft

Publishing is manual. An agent pairs with the creator at
<https://create.plethora.studio/agent-pair>, then `POST`s `{ source, manifest }`
to `/v1/agent/bits/drafts` (API origin `https://api.plethora.studio`) with an
`Authorization: Plethora-Agent <token>` header.
