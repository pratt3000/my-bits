# Bandhan Tree

A mobile-first [Plethora Bit](https://create.plethora.studio) — one tree at
dusk, carrying everybody's threads. Walk around it, tap any thread to read who
tied it and what they wished, then tie your own and leave it up for whoever
comes next.

बंधन — the bond. Rakshabandhan is a promise made with a thread.

## Files

| File            | Purpose                                                           |
| --------------- | ----------------------------------------------------------------- |
| `plethora.json` | Manifest (`plethora-bit@2`, runtime global `window.plethoraBit`).  |
| `main.js`       | The entry source (`entry: "main.js"`).                             |

## A thread is three numbers

The tree is generated, not modelled: a seeded recursive growth (`mulberry32`,
one fixed seed) run identically on every device, so **branch 47 is the same
branch for everyone**. Two hundred and forty tying slots are then sampled from
the outer branches with a second fixed seed.

That is what makes the shared world cheap and exact. A thread is stored as

```json
{ "s": 137, "c": 4, "w": 2 }
```

— slot, silk, blessing — and lands on the same twig for you as it did for
whoever tied it, with no geometry, no coordinates and no drift between clients.
Everyone gets one thread; tying again writes under the same id, so it moves
rather than multiplies.

## Features

- **Drag to walk around it.** Horizontal drag orbits with momentum, vertical
  drag raises and lowers your eye; let go and the tree keeps turning slowly.
- **Tap a thread to read it** — the blessing, and who tied it. Picking projects
  the anchors to the screen and takes the nearest within a thumb's reach, which
  is both cheaper than raycasting a merged mesh and much kinder to fingers.
- **Tie your own**: eight silks and ten blessings, all curated, no free text.
  It grows into place, focuses the camera, rings, and goes up for everyone.
- **Yours keeps a small light on it** so you can find it again on a tree with a
  hundred and fifty threads on it.
- **One draw call for the lot.** Every thread is written into one merged ribbon
  buffer, three vertices across — the middle one lit and the edges not, which is
  enough to make a flat strip read as a round cord — with the knots as a single
  instanced mesh.
- **Dusk**: a painted equirect sky with early stars, a canopy of instanced leaf
  clumps each with its own colour and sway, fireflies orbiting fixed homes,
  lanterns in the branches, and exponential fog.
- **Offline is a state, not a crash.** If the world cannot be read or refuses a
  write, the tree still works, your thread still appears, and the bit says so.

## How the shared world is used

One `objects` world, `threads`, with attribution on and a rate limit of three
writes a day.

- The snapshot shape is **not pinned by the contract**, so it is read
  defensively — `objects` / `items` / `entries` / `records`, arrays or maps,
  payloads under `object` / `data` / `value` / `state`, and authorship under
  `user` / `author` / `by` with `handle` / `username` / `displayName` / `name`.
- Every decoded field is range-checked before it can index anything.
- A write is assumed to have landed **only when nothing in the reply says
  otherwise** — `ok: false`, `accepted: false`, `rejected: true`, or a status
  string that mentions a refusal.
- A tree can hold more threads than a phone should draw, so a stable window of
  a hundred and fifty is shown, offset per session so different visitors meet
  different neighbours, and this viewer's own thread is always in it.
- The world does not push, so it is re-read every forty-five seconds.

## Sound

All synthesised in-file: wind is bandpassed brown-ish noise with a filter that
moves on a slow LFO; the pad is four detuned sines behind a lowpass; a temple
bell somewhere over the fields rings on its own schedule; and every silk has a
chime pitched to it, so tapping along a branch plays a scale.

## Contract notes

Built against agent context **`plethora-agent-context-2026-08-13.1`** using only
the documented `ctx` SDK surface:

- Dependency: `three@0.164.1` via `ctx.importModule`, with the exact registry
  URL literal as a fallback.
- No packaged assets (`maxAssets: 0`) and no network egress. The leaf clump,
  the bark normal map, the glow sprites and the dusk sky are all baked into an
  `OffscreenCanvas` at startup.
- Permissions declared for every gated API used: `audio`, `backgroundMusic`,
  `haptics`, `storage`.
- All branches are one merged, indexed `BufferGeometry` built by hand (no
  `BufferGeometryUtils`, which lives in the addons and is not a registry pin).
- Pointer positions come from `event.offsetX`/`offsetY`; no canvas layout
  queries, no bare timers, no host-document access.

### One worth remembering

Particles that **integrate** their drift wander. The fireflies originally did
`position += sin(t)·dt` every frame, which is a random walk with no restoring
force: after a few minutes they had left the scene, and one that passed through
the near plane filled a third of the screen with a soft grey square. They now
orbit a fixed home — `position = home + sin(t)·r` — which is bounded by
construction.

## Uploading a draft

Publishing is manual. An agent pairs with the creator at
<https://create.plethora.studio/agent-pair>, then `POST`s `{ source, manifest }`
to `/v1/agent/bits/drafts` (API origin `https://api.plethora.studio`) with an
`Authorization: Plethora-Agent <token>` header.

## Verified

Driven headless in Chromium against a mock `ctx` built strictly to `sdk.md`,
with the world pre-seeded before boot: the tree grows and renders a first frame
before three loads; seventy seeded threads land on their slots and hang in the
wind; orbiting, momentum and the auto-turn all work; tapping a thread reads it
and lights it; the composer picks a silk and cycles blessings; tying writes to
the world, focuses the camera, fires `complete`, and survives a viewport change
— no runtime errors, no console warnings. An empty world and a throwing world
were both exercised and degrade to their stated messages.
