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

## Uploading

The build environment's network policy blocks `plethora.studio`, so pairing and
draft upload can't run from the agent side. Everything you need to upload from
your own machine is in this folder:

- `main.js` — the `source`
- `plethora.json` — the `manifest`
- `draft-payload.json` — the exact JSON body for `POST /v1/agent/bits/drafts`
  (source + manifest + title/description/tags, `generated: true`)
- `upload.sh` — posts `draft-payload.json` with a `Plethora-Agent` token

### Option A — creator web app (simplest)

Open https://create.plethora.studio, create a new bit, and paste the contents of
`main.js` as the source and `plethora.json` as the manifest.

### Option B — pair an agent + POST the draft

1. Create a pairing session:
   ```bash
   curl -sS -X POST https://create.plethora.studio/v1/agent/pair/sessions
   ```
   Show the returned `pairingCode` / `pairingUrl` and approve it at
   https://create.plethora.studio/agent-pair. Keep the `sessionId` and
   `sessionSecret`.
2. Poll the exchange until `status` is `approved`, then read `data.accessToken`
   **once**:
   ```bash
   curl -sS -X POST \
     https://create.plethora.studio/v1/agent/pair/sessions/<sessionId>/exchange \
     -H "Content-Type: application/json" \
     -d '{"sessionSecret":"<sessionSecret>"}'
   ```
3. Upload the draft:
   ```bash
   ./upload.sh <accessToken>
   ```

Publish stays manual by design — review it in the app/dashboard, then publish.

> `draft-payload.json` is generated from `main.js` + `plethora.json`. If you edit
> either, regenerate it:
> ```bash
> node -e 'const fs=require("fs");const s=fs.readFileSync("main.js","utf8");const m=JSON.parse(fs.readFileSync("plethora.json","utf8"));fs.writeFileSync("draft-payload.json",JSON.stringify({title:m.title,description:m.description,tags:m.tags,source:s,manifest:m,generated:true},null,2))'
> ```
