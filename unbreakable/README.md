# Unbreakable

A mobile-first [Plethora Bit](https://create.plethora.studio) — tie a knot, and
find out whether it is one. Real rope, real self-collision, and then real knot
theory: the bit reads the crossing diagram off your rope, reduces it, and names
what survives.

गाँठ — the knot. Rakshabandhan is a bond made out of string, so this takes that
literally.

## Files

| File            | Purpose                                                           |
| --------------- | ----------------------------------------------------------------- |
| `plethora.json` | Manifest (`plethora-bit@2`, runtime global `window.plethoraBit`).  |
| `main.js`       | The entry source (`entry: "main.js"`).                             |

## The proof is the tightening

Close the loop and the rest lengths start to shrink. A rope that was never
knotted has nowhere to hide and collapses into a clean ring; a real knot jams
against its own thickness and stops. That is not an animation of a result — the
rope has genuine self-collision, so it *is* the result, happening in front of
you. The minimum separation is fixed at two tube radii, which is exactly what
makes a real knot jam.

## Then the diagram gets read

1. **Crossings.** Project to the plane and intersect every pair of non-adjacent
   segments. Which strand is nearer the camera decides over and under; the sign
   comes from the tangents. Segment parameters are half-open and near-duplicates
   on the same pair of strands are merged, because a crossing that lands on a
   shared vertex would otherwise be counted four times — and one crossing
   counted twice is not a knot diagram at all.
2. **The Gauss code.** Walk the rope and write down each crossing as you meet it.
3. **Reduction.** Reidemeister I removes a kink — the same crossing twice in a
   row. Reidemeister II slides two crossings apart when one strand goes over
   both and the other under both, and they are adjacent on both strands. Repeat
   until nothing more comes out.
4. **Naming.** Crossing number plus **p-colourability**: colour the arcs between
   under-crossings and require `2·over − under₁ − under₂ ≡ 0 (mod p)` at every
   crossing, then take the rank of that system over ℤ_p by elimination. A
   nullity above one means it is properly p-colourable, and that is enough to
   separate the trefoil (3-colourable) from the figure-eight (5) from the
   cinquefoil (5, but five crossings) from the three-twist (7).
5. **Connected sums.** Tie two knots in the same rope and the code splits in two
   with no crossing shared across the cut. So the bit finds that split, names
   each half, and checks their handedness — because two trefoils of opposite
   hand is a **reef knot**, which is the knot you actually tie a rakhi with, and
   two of the same hand is a **granny**, which is the one that slips.

Colourability is a knot invariant, so it agrees on the raw diagram and the
reduced one. That is checked, not assumed.

## Features

- **You author the crossings.** The section under your finger lifts toward you
  or dives away depending on the OVER/UNDER switch, so the diagram is yours
  rather than whatever the solver happened to do.
- **Crossings are counted live**, with a marker on each, so the diagram is
  legible while you make it.
- **The camera closes in on its own** as the knot tightens, because it fits to
  whatever the rope currently is.
- **Leaderboard** for the most crossings that will not come out.
- A rope that starts as an open coil — both ends at the bottom, one just outside
  the other — because a straight rope reads as nothing to do.

## Verified

The knot reader is unit-tested against known knots, driven from the bit's own
source rather than a copy of it:

```
  circle           raw:  0  reduced: 0                    -> THE UNKNOT
  wobbly circle    raw:  0  reduced: 0                    -> THE UNKNOT
  kinked circle    raw:  0  reduced: 0                    -> THE UNKNOT
  trefoil          raw:  3  reduced: 3  p:[3]             -> TREFOIL
  figure-eight     raw:  4  reduced: 4  p:[5]             -> FIGURE-EIGHT
  cinquefoil       raw:  5  reduced: 5  p:[5]             -> CINQUEFOIL
  (2,7) torus      raw:  7  reduced: 7  p:[7]             -> SEPTAFOIL
  reef knot        crossings: 6                           -> REEF KNOT
  granny knot      crossings: 6                           -> GRANNY KNOT
```

And driven headless in Chromium against a mock `ctx` built strictly to `sdk.md`:
boots and paints before three loads, the rope takes crossings and counts them,
closing tightens and settles, the verdict fires `complete` and submits the
record, and a mid-session viewport change re-layouts — no runtime errors, no
console warnings.

## Contract notes

Built against agent context **`plethora-agent-context-2026-08-13.1`** using only
the documented `ctx` SDK surface:

- Dependency: `three@0.164.1` via `ctx.importModule`, with the exact registry
  URL literal as a fallback.
- No packaged assets (`maxAssets: 0`) and no network egress. The rope's lay, the
  crossing rings, the glow and the room equirect are all baked into an
  `OffscreenCanvas` at startup.
- Permissions declared for every gated API used: `audio`, `backgroundMusic`,
  `haptics`, `storage`.
- Memory: one `records` channel, `crossings`, `dedupe: best_per_user`.
- The rope is a pre-allocated tube buffer, not rebuilt geometry.
- Pointer positions come from `event.offsetX`/`offsetY`; no canvas layout
  queries, no bare timers, no host-document access.

## Uploading a draft

Publishing is manual. An agent pairs with the creator at
<https://create.plethora.studio/agent-pair>, then `POST`s `{ source, manifest }`
to `/v1/agent/bits/drafts` (API origin `https://api.plethora.studio`) with an
`Authorization: Plethora-Agent <token>` header.
