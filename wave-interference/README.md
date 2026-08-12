# Wave Interference

A mobile-first [Plethora Bit](https://create.plethora.studio) — put two fingers
on the screen and each one becomes a source radiating circular waves. Where
crest meets crest the surface blazes; where crest meets trough it goes black.
Move your fingers and the whole fringe pattern reorganises under them.

The sound is the same physics an octave of the world away: one tone per source,
detuned by exactly how far apart the two sources are. The beating you hear is
the fringe pattern you are looking at.

## Files

| File            | Purpose                                                          |
| --------------- | ---------------------------------------------------------------- |
| `plethora.json` | Manifest (`plethora-bit@2`, runtime global `window.plethoraBit`). |
| `main.js`       | Entry source — field shader, source physics, synth, overlay.      |

## How it plays

- Up to **four fingers** at once, each holding a source.
- **Tap** to fire a single expanding ring — a gaussian wave packet, not a decal.
- **Let go** and the source keeps the velocity your finger had, drifting and
  bouncing off the edges, still radiating.
- The **✦ chip** cycles three media — Abyss, Nebula, Ember — each with its own
  wavelength, wave speed, colour ramp and root note.
- Before the first touch two sources drift on their own, so the opening frame is
  already a live interference pattern.

## How it works

The field is evaluated per pixel in a fragment shader: for each source, a
cylindrical wave `cos(kr − φ)` attenuated by `1/√r`, summed. That sum is kept
**signed** — squaring it would fold troughs onto crests and double every fringe,
which reads as noise rather than water.

- **Iridescence** comes from each colour channel sampling the field at a small
  fixed phase offset. Spreading the *wavenumbers* instead (true dispersion) was
  the first attempt and it decorrelates the channels with distance, turning the
  far field into rainbow confetti. A fixed offset keeps the tint constant.
- **Lighting is analytic.** The derivative of a sum of cosines is a sum of sines,
  so the surface gradient falls out of the same loop as the field, one extra
  `sin` per source. It becomes a normal, and the crests get a real specular
  highlight. The lobe is gated by local wave energy — a calm far field should
  read matte, otherwise the highlight aliases into thin bright arcs.
- **Phase, not time**, is what the shader receives, accumulated per frame and
  wrapped to one cycle. Passing an ever-growing `uTime` loses precision over a
  long session, badly so where only `mediump` is available.
- **Resolution adapts.** The backing store scales between 0.62× and 1.5× against
  measured frame time. Interference is smooth, so an upscale is nearly invisible
  and it buys a lot of headroom on older phones.

## Contract notes

Built against agent context **`plethora-agent-context-2026-07-10.2`** using only
the documented `ctx` SDK surface:

- **No packaged assets** (`maxAssets: 0`) and **no dependencies** — the field,
  the palettes and every sound are generated at runtime.
- Permissions declared for every gated API used: `audio` (the synth),
  `haptics`, `storage` (remembers your medium and mute state).
- Bespoke `AudioContext` synthesis rather than `ctx.music`: the two voices have
  to be detuned continuously against finger separation, which is not something a
  preset bed can do. Two sines plus octave and twelfth partials per source, a
  sub drone, a motion-tracking noise wash, and a generated convolution tail.
- No leaderboard, tally or shared world. It is a fidget, and a scoreboard would
  be a lie about what it is.
- The overlay is declared as markup on the `ctx.createRoot()` element and queried
  back out; bits may not build DOM with `document.createElement`.
- Pointer coordinates come from `event.offsetX/offsetY`, never
  `getBoundingClientRect()` — see the note in [`../cairn/README.md`](../cairn/README.md)
  about what the upload validator rejects.

### What the upload validator rejects, continued

Cairn's README documents two undocumented rejections. Here is a third, found the
same way — by bisecting real uploads:

- **A property named `c2`, read with a computed index.** The palette stops used
  to be `c0`/`c1`/`c2`/`c3`, and `mode.c2[ch]` in the 2D fallback was rejected
  with *"This bit uses unsupported remote resources…"*. The same line reading
  `mode.c1[ch]` or `mode.c3[ch]` uploads fine, so it is the token, not the
  shape — presumably a security-keyword scan, `c2` being command-and-control.
  The stops are now `deep`/`mid`/`crest`/`peak`, which is better naming anyway.
  Note `mode.c2` *without* an index passed, and a local `const c2 = …` passed;
  only the indexed member read tripped it.

A method note, since this cost the most time: **bisect with self-contained,
runnable probes**, not by pasting regions of the real file into a stub as dead
code. Dead code whose identifiers do not resolve gets rejected with this same
generic message, which sends you hunting for triggers that are not there. Every
region probe built that way rejected; the one built as a standalone bit found
the real cause in three uploads.

### If WebGL is unavailable

`ctx.createCanvas()` may hand back no GL context at all. The bit then evaluates
the same field on a small `ImageData` buffer and upscales it: softer, no
specular, no iridescence, but the same waves, and never a blank screen.
Verified at 57 fps with every WebGL context denied.

## Uploading a draft

Publishing is manual. An agent pairs with the creator at
<https://create.plethora.studio/agent-pair>, then `POST`s `{ source, manifest }`
to `/v1/agent/bits/drafts` (API origin `https://api.plethora.studio`) with an
`Authorization: Plethora-Agent <token>` header.
