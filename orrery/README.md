# Orrery

A mobile-first [Plethora Bit](https://create.plethora.studio) — a music box with
no music in it. Bodies circle at whole-number ratios of one shared loop, each
ringing a bell as it crosses the top. Because the ratios are whole numbers they
all realign every loop, so the piece drifts out into dense polyrhythm and falls
back into a single unison chord, forever. Tap for a new sky.

## Files

| File            | Purpose                                                           |
| --------------- | ----------------------------------------------------------------- |
| `plethora.json` | Manifest (`plethora-bit@2`, runtime global `window.plethoraBit`).  |
| `main.js`       | The entry source (`entry: "main.js"`).                             |

## The autonomous system

Nothing here is composed. The seed picks 5–10 bodies, a loop length of 22–42
seconds, and a base lap count; body *i* then completes `baseLaps + i` laps per
loop, so the outermost is slowest and lowest and every inner one runs a little
faster. Each body rings a bell on the frame it crosses the meridian. The music
is entirely a consequence of the orbits.

- **Scales without a leading tone** — pentatonic, minor pentatonic, hirajoshi,
  kumoi, dorian, lydian, in-sen, whole tone. Any two notes can sound together,
  which is what lets an unsupervised machine play them in any order.
- **Struck bells, not beeps.** Five inharmonic partials (1, 2, 3.01, 4.31, 5.43)
  with separate decay rates, so the upper partials die first the way a real
  strike does.
- **Procedural reverb.** A `ConvolverNode` fed an impulse response generated at
  runtime: decaying noise, no sample file.
- **A drone in the key**, three sine voices a couple of cents apart, fading in
  under the bells and re-keyed on every reseed.

## Features

- **Tap to listen**, then tap again for a new sky — new orbits, key and colours.
- **Watch for the realignment.** Every body meets at the top at once, once per
  loop; the whole piece is the walk out of that unison and back into it.
- Mute toggle, comet trails, expanding ring on each chime, and a downbeat haptic
  from the outermost body only — buzzing on every chime in a ten-body
  polyrhythm is a vibrating brick, not a downbeat.
- If audio is unavailable, the bit says so once and keeps the orbits running.

## Contract notes

Built against agent context **`plethora-agent-context-2026-08-13.1`** using only
the documented `ctx` SDK surface:

- No packaged assets (`maxAssets: 0`), no dependencies, no network egress.
- Permissions declared for every gated API used: `audio`, `haptics`.
- Uses **bespoke `AudioContext` synthesis rather than `ctx.music`**, because the
  piece needs note-level control over pitch and timing that the preset music
  beds do not expose. The context is created on the first user gesture and
  closed from `ctx.onDestroy`; each bell disconnects its own little graph on
  `onended`.
- `AudioContext.resume()` rejects rather than throws when a gesture is not
  accepted, so the promise is caught as well as the call.
- Background and star field are drawn live from a reused `CanvasGradient`; no
  offscreen bake is needed at this object count.
- Overlay markup is declared on the `ctx.createRoot()` element and queried back
  out via `data-el` attributes. No host-document access, no bare timers.

## Uploading a draft

Publishing is intentionally manual. To upload as a draft, an agent pairs with
the creator at <https://create.plethora.studio/agent-pair>, then `POST`s
`{ source, manifest }` to `/v1/agent/bits/drafts` (API origin
`https://api.plethora.studio`) with an `Authorization: Plethora-Agent <token>`
header. See the agent context for the full pairing flow.
