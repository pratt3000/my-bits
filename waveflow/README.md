# WaveFlow XY Synth

One finger, twenty-five voices. A performance pad rather than a keyboard: put a
finger down and it sounds, and where the finger sits decides what you hear.

- **Up the screen is pitch** — an exponential sweep from A1 (55 Hz) to A6
  (1760 Hz), so the whole range is playable with one thumb rather than the
  bottom octave eating half the pad.
- **Across is timbre**, and it means something different on every voice. On
  Analog it opens a resonant lowpass from 100 Hz to 10 kHz. On Digital FM it
  drives both the modulator ratio and the modulation index. On Static Noise
  there is no oscillator at all — it sweeps a bandpass through white noise
  generated into a looping buffer.
- **The strip along the bottom** shifts the whole instrument two octaves either
  way, and it applies live, so you can slide it while a note is still ringing.

Nothing is sampled. Every voice is a small Web Audio graph assembled on note-on
and torn down on note-off, which is why the oscilloscope drawn across the pad is
the real output — an `AnalyserNode` tapped off the master bus, windowed with a
half-sine at the edges so the trace stays inside the frame. When nothing is
playing it settles into a slow ripple instead of going flat.

## The voices

| | | | |
|---|---|---|---|
| Analog | Digital FM | Chiptune | Robotic |
| Sub Bass | Lead Pulse | Drone | Static Noise |
| Crystal Glass | Orchestral Strings | Acid Squelch | Wind Breeze |
| Metallic Bell | Retro Organ | Laser Beam | Theremin Wave |
| Metal Clang | Vocal Choir | Pulsar Synth | Space Pad |
| Telephone | Vibraphone | Heavy Dist | Alien Chirp |
| Glitch Stutter | | | |

The graphs behind them are all variations on the same handful of parts. `osc1`
is what you hear; `osc2` is a partner — an FM modulator on Digital FM and
Metallic Bell, a twin detuned 15 cents on Orchestral Strings, an octave-down
triangle on Drone; `lfo` modulates whatever that voice wants modulated, which
is pitch on Theremin Wave, filter cutoff on Space Pad, and amplitude on Pulsar
Synth. Heavy Dist is the odd one out: a `WaveShaperNode` with a 44 100-sample
curve at 4× oversampling.

## Notes on the port

This is a port of a standalone build of the same instrument. The synthesis, the
pad mapping and the scope are unchanged — same oscillator types, same detunes,
same `setTargetAtTime` constants, same 55–1760 Hz sweep. What was rebuilt is the
shell around them:

- **No CDN.** The original pulled Tailwind and lucide off the network at load.
  Bits cannot, so the styling is inline and the twenty-six icons are inlined as
  SVG geometry (lucide, ISC licence) — about 4.6 KB instead of a 424 KB script.
- **No platform scaffolding.** The `sekaiEditable` metadata block, its
  `postMessage` editing API, and the injected audio-unlock shim are gone. Audio
  unlocks on the first real gesture, which is the same gesture that starts a
  note.
- **Plethora owns the DOM and the clock.** `ctx.createCanvas2D` for the pad,
  `ctx.createRoot` for the rail and strip, `ctx.listen` for input and
  `ctx.onFrame` for the loop, so everything is torn down with the bit.
- **The slider is hand-built.** A native `<input type=range>` needs
  `::-webkit-slider-thumb` to look like anything, and pseudo-elements cannot be
  set inline, so the strip is a track, a fill and a knob with the knob and fill
  made pointer-inert — which also gives a much bigger touch target than a 23 px
  thumb.
- **One fix.** The original asked lucide for `waveform`, which is not an icon it
  has (`audio-waveform` is), so Sub Bass rendered as an empty button. It has its
  icon now.
- **Layout follows the safe area** and recomputes on resize; the original sized
  itself once from `clientWidth`.
- **Nothing chains onto a runtime call.** `ctx.storage.set()` hands back nothing
  on a real device, so a `.catch()` on its result throws `undefined is not an
  object` and takes the whole bit down. Writes go through the same
  `fireAndForget` helper [`ripcord/`](../ripcord) uses. `sdk.md` documents
  `storage.get`/`set` as plain calls, not promises — the harness mock had them
  as `async`, which hid this until it ran on a phone; the mock is synchronous
  now.

Preset and octave are remembered in `ctx.storage` between sessions.

## Verified

`node harness/run.js waveflow sc-wave.json` — 414 frames, no console or page
errors, `ready` / `start` / `markVisualReady` / `interact` all fired, and the
screenshots confirm the scope traces real audio (a sawtooth at the pad position),
presets switch under a held finger, the octave strip tracks, and the layout
survives a resize to 360×780.
