# Symphony Sketchpad

Draw a picture, then hear it.

Twenty-one instruments, each one a colour. Pick one and draw: the stroke sounds
as you make it, pitched by how high up the canvas your finger is. The pitch is
quantised to a major pentatonic, so there are no wrong notes — a scribble still
comes out musical. Then press play and a scanline sweeps left to right across
everything you have drawn, firing every point it crosses. The picture is the
score, and drawing in layers gives you an ensemble.

Nothing is sampled. Each instrument is a small Web Audio graph built on the
spot:

| | |
|---|---|
| Trumpet | sawtooth into a resonant lowpass that tracks the note |
| Cymbals | looping white noise through a highpass at 5 kHz + pitch |
| Kick | a sine swept 180 → 45 → 30 Hz over 300 ms |
| Snare | noise through a highpass, plus a 180 → 80 Hz thump |
| Violin | sawtooth with a 6 Hz vibrato LFO on the pitch |
| Flute | sine with a 5 Hz tremolo LFO on the gain |
| Synthesizer | two sawtooths 1% apart |
| Crystal Bell | a sine at the third harmonic, decaying over 1.2 s |

…and thirteen more.

The shop is a joke about volume, and it is the original's joke — ten tiers from
150% up to "The End" at ω%. Tapping the active tier turns it back off.

## Notes on the port

Ported from a standalone Sekai build. The synthesis, the pentatonic mapping, the
scanline playback and the particles are unchanged — same oscillator types, same
filter frequencies, same envelopes, same scale table. The shell was rebuilt:

- **No CDN.** The original loaded Tailwind and Font Awesome. Styling is inline
  and the six control icons are inlined as SVG geometry (lucide, ISC licence).
- **No platform scaffolding.** The `sekaiEditable` block, the `postMessage`
  editing API, the audio-unlock shim, and the `snapdom` screenshot-share button
  are gone — the last of those needed a host share API that a bit does not have.
- **Plethora owns the DOM and the clock**: `ctx.createCanvas2D`, `ctx.createRoot`,
  `ctx.listen`, `ctx.onFrame`.
- **Real config values, not the source defaults.** The code's fallbacks were
  `brushSize: 1000` and `playbackSpeed: 45`; the values the build actually
  shipped were `9` and `8`, carried in the platform's editable metadata rather
  than in the source. Ported with the shipped values — the fallback would have
  painted the entire canvas in a single stroke.
- **The palette grid uses `grid-auto-rows`, not `aspect-ratio`.** Inside a
  scrolling container the implicit rows collapse and the tiles overlap; caught
  in a screenshot, not by the console.
- **Nothing chains onto `ctx.storage.set()`** — see
  [`_skills/sekai/references/gotchas.md`](../_skills/sekai/references/gotchas.md).

## Nothing was substituted

The original declared two audio slots — background music and a clear sound — and
**both were empty in the shipped build**, so there was no asset to lose and no
replacement to invent. Every sound here is the same synthesis the original had.
This is the only one of the four ported in this batch that needed no compromise.

No leaderboard: it is a creative toy with no score, and adding one would invent
a goal the thing does not have.

The chosen instrument and volume tier persist in `ctx.storage`.

## Verified

`node _skills/sekai/harness/run.js symphony-sketchpad sc-symphony.json` — 535
frames, no console or page errors, `ready` / `start` / `markVisualReady` /
`interact` all fired. Screenshots confirm strokes render in their instrument's
colour, the palette selects, the scanline sweeps and fires particle bursts as it
crosses each stroke, the shop opens and tiers toggle, and the layout survives a
resize to 360×780.

The harness reports "two frames 500 ms apart are byte-identical" at the end of
the run. That is correct behaviour, not a fault: a sketchpad at rest, with
nothing playing and no particles alive, draws the same frame. The original did
the same.
