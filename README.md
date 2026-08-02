# my-bits

Plethora Bits — tiny mobile-first interactive objects built to the
[Plethora Bit agent contract](https://create.plethora.studio) (`plethora-bit@2`).

## Loop Lab

A live looping station, the way a loop pedal works: **record a layer while it
loops, then overdub more layers to build a whole song** — all on-screen.

- **Instruments** (all procedurally synthesized with the Web Audio API, no
  packaged assets): a drum kit, bass, keys, a strings pad, plucks, and a
  **Vox** vowel-formant synth.
- **Workflow:** pick an instrument → tap **● REC** → after a 1-bar count-in,
  play the pads for one loop → the layer loops forever → hit **● REC** again to
  overdub the next instrument on top.
- Per-track **mute** and **delete**, adjustable **tempo** (50–180 bpm) and loop
  length (1 / 2 / 4 bars), a **metronome**, and a sweeping loop timeline.
- Melodic pads are locked to **A minor pentatonic**, so every layer stays in
  key. Your song **auto-saves** on the device.

### A note on voice

The original ask was Ed-Sheeran-style *vocal* looping. The Plethora sandbox
exposes the microphone as **analysis-only** and forbids recording/uploading
audio, so live vocal looping isn't possible here. Loop Lab delivers the same
layered-looping *workflow* around synth voices instead — the **Vox** pad is a
vowel synth that stands in for a hummed/"aah" vocal line.

### Files

- `plethora.json` — the bit manifest (`runtime: plethora-bit@2`,
  permissions: `audio`, `haptics`, `storage`).
- `main.js` — the entry source defining `window.plethoraBit`.

Both sit at the repo root as the contract requires (no packaged assets, since
`maxAssets` is 0).

### Publishing

Publishing is intentionally manual. To upload a draft, pair a coding agent at
<https://create.plethora.studio/agent-pair>, then `POST /v1/agent/bits/drafts`
with the `manifest` + `source`. Public publish stays in the app/dashboard.
