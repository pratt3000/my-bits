# Port log

One entry per port. Keep them short and concrete — the useful parts are what the
original turned out to be made of, what the port had to change, and anything
that went wrong, since that is what makes the next one faster. Anything
generalisable belongs in `references/gotchas.md` as well.

---

## 2026-09-03 — WaveFlow XY Synth → `waveflow/`

**Source:** `sekai.ai/play/d179d91b-dca4-40d3-98dd-a473516a094a`
→ `prod-data.sekai.chat/v3-games/dist/3e13b519-…/index.html`, 62 KB.

**What it was:** one self-contained HTML file. 1 014 lines of game JS, a 2.3 KB
stylesheet, 14 KB of markup, plus a 32-line audio-unlock shim Sekai injects.
Tailwind and lucide from CDNs. An XY performance pad: 25 synth voices, each a
small Web Audio graph, with pitch mapped exponentially up the pad and timbre
across it, and an `AnalyserNode` oscilloscope drawn over the top.

**Kept verbatim:** the whole `SynthEngine` — every oscillator type, detune,
filter Q and `setTargetAtTime` constant — plus the pad mapping and the scope
drawing. That is the part worth having and it has no DOM in it.

**Rebuilt:** styling inline (no Tailwind); 26 lucide icons inlined as SVG
geometry, 4.6 KB against a 424 KB script; `sekaiEditable` + its `postMessage`
editor API + the unlock shim deleted; `createCanvas2D`/`createRoot`/`listen`/
`onFrame` in place of direct DOM and `requestAnimationFrame`; the octave slider
hand-built, since `::-webkit-slider-thumb` cannot be set inline; layout made
safe-area aware and resize-aware.

**Fixed a bug in the original:** it asked lucide for `waveform`, which is not an
icon lucide has — the name is `audio-waveform` — so Sub Bass had always rendered
as an empty button. `icons.js` now reports misses like this automatically.

**Went wrong:**

1. Chained `.catch()` onto `ctx.storage.set()`. Passed every headless run
   because the harness mock had storage as `async`; crashed on the creator's
   phone. The mock is synchronous now and `check.py` catches the pattern. The
   repo's own `ripcord/` had already hit this and documented it — reading the
   sibling bits first would have saved the round trip.
2. A later re-upload created a **duplicate draft** instead of updating, leaving
   two identical drafts to clean up by hand. `upload.py` now keeps a ledger and
   warns.

**Time sinks worth avoiding:** four pairing codes expired unapproved before one
was minted while the creator was actually at their phone. Mint on their word,
not in advance.
