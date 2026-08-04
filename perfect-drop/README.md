# Perfect Drop

A mobile-first [Plethora Bit](https://create.plethora.studio) built around a
single sound: a drop of water falling into a still, dark pool.

Hold anywhere and a drop swells on the spout. Let go the instant its edge kisses
the ring and it falls — and the closer you were, the better it sounds. A perfect
release comes back bright, rising and ringing into the reverb. A rushed one lands
dull and flat. **You can hear your own precision**, which is the whole point.

Every perfect drop in a row climbs one note of a minor pentatonic scale, so a
good run stops being a sound effect and turns into a melody.

## Files

| File            | Purpose                                                           |
| --------------- | ----------------------------------------------------------------- |
| `plethora.json` | Manifest (`plethora-bit@2`, runtime global `window.plethoraBit`).  |
| `main.js`       | The entry source (`entry: "main.js"`).                             |

## The sound

There are no packaged assets (`maxAssets: 0`), so the drip is synthesised from
scratch on a `AudioContext` — and it is modelled on what physically happens when
a drop hits water:

1. **The tick** — a very short band-passed noise burst as the surface breaks.
2. **The bubble** — the drop entrains a pocket of air, and as that bubble
   shrinks its resonant pitch *rises*. That upward glide is the entire reason a
   drip says "plink" and not "thud", so it is the heart of the voice.
3. **The body** — a soft octave-down giving the pool some depth.
4. **The shine** — an octave and a twelfth that only ring on a clean release.
5. **The room** — a procedurally generated impulse response (decaying noise)
   puts the whole thing in a stone chamber.

Precision maps onto timbre, verified by rendering the shipped `drip()` through an
`OfflineAudioContext` and measuring it:

| Release       | Pitch glide           | Tail   | Centroid |
| ------------- | --------------------- | ------ | -------- |
| **perfect**   | 551 → 1050 Hz (1.9×)  | 1322ms | 752 Hz   |
| a touch early | 450 → 678 Hz (1.5×)   | 904ms  | 466 Hz   |
| too heavy     | 424 → 551 Hz (1.3×)   | 550ms  | 360 Hz   |
| overflowed    | barely sweeps         | 421ms  | 382 Hz   |

The note ladder spans two octaves of G minor pentatonic (392 Hz – 1.4 kHz) and
wraps at the tenth perfect drop. That ceiling is deliberate: an unbounded ladder
is shrieking by the time anyone gets good at it.

Underneath it all sits a near-silent room tone, and every few seconds another
drip sounds somewhere else in the cave — the same voice pushed dark, quiet and
soaking wet, so the silence between your drops feels like a place.

## Features

- **One gesture, real depth** — hold to swell, release on the ring. The ring is
  visible from the start but the fill rate varies per drop, so it rewards
  watching rather than counting.
- **Worthington jet** — a perfect hit throws a column of water back up, and the
  secondary droplet it launches ticks when it lands. It is the best part of a
  real drip and it is worth rendering.
- **Ripples** as foreshortened ellipses spreading across the surface, with the
  far lip of each ring catching the light from above.
- **Haptics** — a light tick the moment the drop enters the perfect window, so
  the cue reaches your thumb as well as your eye.
- **Attract mode** — the cave drips on its own before the first touch, so the
  first frame is never dead and audio can wait for a real gesture.
- **Leaderboard** on best perfect streak (`memory.records.streak`), plus a
  personal best in `ctx.storage`.
- **Light-touch controls** at the top (mute / leaderboard / instructions),
  keeping the pool and `ctx.safeArea.bottom` clear.

## Contract notes

Built against agent context **`plethora-agent-context-2026-07-10.2`** using only
the documented `ctx` SDK surface:

- No packaged assets and no external dependencies — every pixel and every sample
  is generated at runtime. No network egress.
- Permissions declared for every gated API used: `audio` (the `AudioContext`
  synthesis), `haptics`, `storage`.
- Custom WebAudio rather than `ctx.music` because the bit needs bespoke,
  continuously parameterised synthesis — the timbre *is* the score — which the
  preset beds and fixed stings cannot express.
- Surfaces via `ctx.createCanvas2D` / `ctx.createRoot`; all listeners, frames,
  timers and the audio context are registered through `ctx` so the runtime owns
  cleanup.
- `ctx.platform.ready()` is called only after a live first frame.

## Uploading a draft

Publishing is intentionally manual. To upload as a draft, an agent pairs with
the creator at <https://create.plethora.studio/agent-pair>, then `POST`s
`{ source, manifest }` to `/v1/agent/bits/drafts` (API origin
`https://api.plethora.studio`) with an `Authorization: Plethora-Agent <token>`
header. See the agent context for the full pairing flow.
