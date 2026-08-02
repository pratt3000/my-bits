# Loop Pedal

A mobile-first live looper Plethora Bit — build a song the way a loop pedal
does: record a phrase, it loops in the background, then stack more layers on top.

- **Runtime:** `plethora-bit@2` · **Entry:** `main.js` · **Permissions:** `audio`, `haptics`
- **No dependencies, no packaged assets** — every sound is synthesised live with the Web Audio API.

## How it plays

1. Pick an instrument tab — **Drums** (kick / snare / hat / clap), **Bass**, **Keys**, **Strings**, or **Vox**.
2. Tap **REC** and play the pads in time. Your taps record into a new colored layer.
3. Tap **REC** again to lock the layer — it now loops on its own.
4. Switch instrument, hit **REC** again, and stack another layer. Repeat to build a full track.
5. The sweeping line on the ring is your guide; the **Click** metronome keeps you in time; **Quantize** snaps taps to a 16th-note grid.
6. **Undo** removes the last layer, **Clear all** starts over, **± BPM** sets the tempo (60–160).

## About "record my voice"

The Plethora sandbox microphone exposes *analysis data only* and cannot record
or loop raw audio (and the mic API is flagged in-development). So instead of
looping your actual voice, the **Vox** instrument is a synthesised vocal-style
pad ("aah") you play like any other layer. This keeps the loop-pedal workflow
fully working without depending on the unreliable/in-dev mic path.

A possible follow-up (opt-in, experimental): a mic "beatbox" mode that reads
mic *amplitude peaks* and maps them to drum hits recorded into the loop as
events (timing only, never raw audio) — contract-compliant, but gated on the
in-development mic API.

## Uploading (manual)

This bit was built to the Plethora agent contract but **not** uploaded from here —
the build environment's network policy blocks `plethora.studio`, so agent
pairing and draft upload can't run. To publish:

- Pair a coding agent / use the dashboard at https://create.plethora.studio/agent-pair
- Upload `main.js` as `source` and `plethora.json` as `manifest` via
  `POST /v1/agent/bits/drafts`, or paste them into the creator web app.
- Publish stays manual by design.
