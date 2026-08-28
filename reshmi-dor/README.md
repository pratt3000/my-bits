# Reshmi Dor

A mobile-first [Plethora Bit](https://create.plethora.studio) — braid a rakhi
out of silk. Rub the screen and three strands plait themselves into a cord that
winds into a ring; thread charms onto the crossings, change the silk as you go,
then close the ring and tie it. Every crossing plucks a string in Raga Desh.

रेशमी डोर — "silk thread". Rakshabandhan starts with one.

## Files

| File            | Purpose                                                           |
| --------------- | ----------------------------------------------------------------- |
| `plethora.json` | Manifest (`plethora-bit@2`, runtime global `window.plethoraBit`).  |
| `main.js`       | The entry source (`entry: "main.js"`).                             |

## The braid is solved, not drawn

A three-strand plait has a closed form. Put the strands at phases 0, 2π/3, 4π/3
of one angle `u` and give each of them

```
lateral(u) = A·cos(u)        // where it sits across the cord
depth(u)   = B·sin(2u)       // how far in front of the cord it rides
```

Two strands meet wherever their cosines agree, which happens every **π/3** of
`u` — so a crossing every π/3, forty-odd of them around a ring. And `sin(2u)` is
positive over exactly the half-cycles where `|cos u|` is falling, i.e. while a
strand is travelling *inward*: the strand moving toward the middle always passes
in front of the one leaving it. That is the over-under rule of a plait, and it
falls out of the parametrisation rather than being animated on top of it.

The depth amplitude is set from the tube radius (`1.73·B > 2r`), so strands pass
each other without ever intersecting.

## Features

- **Your hand is in the object.** Distance moved becomes cord; speed sets the
  pitch, so a slow rub packs the crossings tight and a fast one lets them run
  long. Two people filling the same ring get visibly different braids.
- **Loose ends.** Past the braid head the three strands continue, splayed and
  swaying with how hard you are rubbing, and get eaten as the cord grows.
- **Silk that changes mid-cord.** Six palettes — Kesari, Mor, Chandan, Gulaal,
  Neel, Haldi — written into a vertex-colour attribute, so a single cord can run
  through several without a second draw call.
- **Charms on the crossings**: bead, pearl, mirror, ghungroo. Arm one and it
  threads onto the next crossing.
- **Tying it off.** The knot lands over the join, a flower blooms in the middle
  with an iridescent stone, two tie-threads drop with tassels that swing behind
  the object's rotation, and marigold petals fall.
- **A box.** The last six rakhis are kept in `ctx.storage` as twist checkpoints,
  colour changes and charm positions — about half a kilobyte each — and rebuilt
  exactly, crossings and all, when you tap one.
- **Raga Desh.** The monsoon raga, and Rakshabandhan falls in Shravan. Braiding
  upward walks the ascending ladder (which leaves out Ga and Dha); braiding
  downward walks the descending one (which puts them back), so the cord plays a
  phrase rather than a scale.

## Sound

All synthesised in-file, none of it sampled:

- **Karplus-Strong strings** — a burst of low-passed noise pushed round a delay
  line one period long, averaged on each lap so the highs die first. Four base
  buffers a fourth apart cover the range by playback rate, which keeps the
  timbre honest and the memory at about a megabyte.
- **A four-string tanpura** (Pa–Sa–Sa–Sa′) scheduled on a lookahead timer.
- **The rub of silk** — bandpassed noise whose gain and cutoff follow finger
  speed, smoothed in JS and sent to the params about twelve times a second.
- **Bells** for charms and for the tie, additive with inharmonic partials.

## Contract notes

Built against agent context **`plethora-agent-context-2026-08-13.1`** using only
the documented `ctx` SDK surface:

- Dependency: `three@0.164.1`, loaded with `ctx.importModule("three","0.164.1")`
  and falling back to the exact registry URL literal.
- No packaged assets (`maxAssets: 0`) and no network egress. Every texture is
  baked into an `OffscreenCanvas` at startup — the silk fibre normal map is a
  height field differentiated in a pixel loop, the marigold petal is painted per
  pixel, the room is a small equirect fed to `PMREMGenerator`.
- Permissions declared for every gated API used: `audio` (custom synthesis),
  `backgroundMusic` (the `ctx.music.sting` fallback where `AudioContext` is
  missing), `haptics`, `storage`.
- The three strands are **pre-allocated buffers**, not rebuilt geometry. The
  braid extends its draw range and only the dirty span is uploaded through
  `addUpdateRange`, so a growing cord costs a few kilobytes a frame instead of
  half a megabyte.
- Pointer positions come from `event.offsetX`/`offsetY`; no canvas layout
  queries, no bare timers, no host-document access.

### Two things that cost time, for the next bit

- **`Color.setHex()` already converts sRGB into the working linear space.**
  Calling `.convertSRGBToLinear()` after it converts twice and crushes every
  palette to near-black — which is invisible until you notice that changing the
  silk changes nothing, because a warm sheen is all you were ever seeing.
- **A full-strength `sheen` swamps the base colour.** `sheen: 1` with a bright
  `sheenColor` renders every palette the same warm gold on a dark base. Silk
  still wants a sheen; it wants a dim one (`0.55`, and a `sheenColor` around
  40% luminance), with the hue carried by the vertex colours underneath.

## Uploading a draft

Publishing is manual. An agent pairs with the creator at
<https://create.plethora.studio/agent-pair>, then `POST`s `{ source, manifest }`
to `/v1/agent/bits/drafts` (API origin `https://api.plethora.studio`) with an
`Authorization: Plethora-Agent <token>` header.

## Verified

Driven headless in Chromium against a mock `ctx` built strictly to `sdk.md`:
boots and renders a first frame before three loads; braiding grows the ring and
fires `setProgress` and the quarter milestones; palette changes and charms land
where they are tapped; the ring closes, ties, blooms and fires `complete`;
"Braid another" resets cleanly and re-braids; the box saves, lists and rebuilds
a kept rakhi; a mid-session viewport change re-layouts — no runtime errors, no
console warnings, at any stage.
