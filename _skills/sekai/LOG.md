# Port log

One entry per port. Keep them short and concrete — the useful parts are what the
original turned out to be made of, what the port had to change, and anything
that went wrong, since that is what makes the next one faster. Anything
generalisable belongs in `references/gotchas.md` as well.

Log the ones that were **not** built too. A hard constraint that stopped a port,
and what the creator decided about it, is worth more to the next attempt than
another success story — it stops someone starting from scratch and rediscovering
the same wall. Entries that diverged from the original must say so here and in
the bit's own README; see SKILL.md step 1b.

---

## 2026-09-03 — WaveFlow XY Synth → `waveflow/`

**Source:** `sekai.ai/play/d179d91b-dca4-40d3-98dd-a473516a094a`
→ `prod-data.sekai.chat/v3-games/dist/3e13b519-…/index.html`, 62 KB.

**Blockers: none.** No packaged assets, no web font, no server. Every sound is
synthesised and every visual drawn, so nothing had to be substituted and the
port is faithful — which is exactly why it went smoothly, and is not the case to
generalise from.

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

---

## 2026-09-03 — four at once: Symphony Sketchpad, Sketch Racer, Bounce & Draw, Boss Simulator

Four Sekai links in one batch. `grab.py` handled all four; two lessons came out
of the gate rather than the ports.

**The blocker detector cried wolf twice, and was right twice.** Its first pass
flagged `${img.value}` and `${avatar}` — template-literal placeholders inside
Sekai's own editor scaffolding, not real files — and missed a `data:` URI
because the negative lookahead sat before the optional quote rather than after
it. It also looked for unquoted `images:` keys, and newer builds emit the
`sekaiEditable` object as strict JSON with quoted keys, so the asset arrays did
not match at all. Fixed all three. The lesson: **verify a blocker before taking
it to the creator**. A false alarm spends their attention and teaches them to
ignore the gate.

**`grab.py` only fetches `index.html`.** Symphony Sketchpad is a newer "sandbox"
build that loads four sibling files — `asset-urls.js` and three
`js/sekai/bridge/*.js` modules — none of which came down. Its real config lived
in a separate inline script, and its asset URLs in `SEKAI_ASSET_URLS`. Worth
teaching grab.py to follow relative script srcs.

**Asset slots can be declared but empty.** Symphony declared `bgm` and `clear`
and both were `""` — declared with nothing in them. Always read the *values*,
not just whether the arrays exist.

| Bit | Real assets | Outcome |
|---|---|---|
| Symphony Sketchpad | none | faithful, nothing substituted |
| Sketch Racer | 3 audio + remote avatars | bgm → `ctx.music`; its win sound was already procedural in the original |
| Bounce & Draw | image + 12 tracks + 3 sfx | all three sfx already procedural; music picker now offers Plethora beds |
| Boss Simulator | 4 sprites + 6 sfx | heaviest divergence: sprites → abstract shapes, all sound synthesised |

**Two of the four had procedural fallbacks already.** Sekai games seem to ship
a synthesised version of their sound effects and only play a file if one is
attached. Check for that before deciding a sound is lost — in Sketch Racer and
Bounce & Draw it meant the games sound exactly as they did.

**Config values are not in the source.** Three of the four had `appState`
fallbacks that differ from the tune values the build shipped, and Symphony's
was catastrophic: source said `brushSize: 1000`, shipped value was `9`. Always
read the tune block.

**Where leaderboards fit.** Sketch Racer already had one through Sekai's
`save_app_result`, so that was a translation. Bounce & Draw ranks *lifetime*
earnings, not balance — a board that dropped when you bought an upgrade would
be backwards — throttled to every $100 so an idle game does not hammer the
channel. Symphony got none: a creative toy with no score, and a board would
invent a goal it does not have.

**The harness "nothing is animating" check fires on anything static at rest** —
a sketchpad with nothing playing, a finished race on a result screen. Not a
fault; do not add motion the original did not have to silence it.
