# Symphony Sketchpad

Draw a picture, then hear it played back.

Pick an instrument, draw, and the stroke sounds as you make it — height is
pitch, quantised to a major pentatonic so nothing you draw is wrong. Press play
and a plane of light sweeps across the canvas, firing every point it passes
through and flaring the stroke white as it crosses. What you drew is the score.

## Sound

Twenty-one instruments, none sampled and none a bare oscillator either.

Each pitched voice is a baked **`PeriodicWave`** — a real harmonic spectrum with
scattered partial phases, because partials that all start aligned are what makes
an additive tone sound like a buzzer. Bells, xylophone and woodblock don't use
one: their partials sit at **inharmonic** ratios (2.76×, 5.4×, 8.93× for the
bell) that a `PeriodicWave` cannot express, since its partials are integer
multiples of the fundamental. Those stack real oscillators instead, which is
what makes struck metal sound struck.

Every voice runs through one master chain, and this is where most of the quality
actually lives:

```
voice → pan → ┬──────────────────────────→ bus → shelf → limiter → out
              ├─ reverb send → convolver ───┘
              └─ delay send  → ping-pong ───┘
```

- **Reverb** is a `ConvolverNode` fed an impulse generated at load: exponentially
  decaying noise, 2.6 s, with the two channels decorrelated so the tail spreads
  instead of sitting in the middle of your head.
- **Delay** is a true ping-pong — two lines cross-fed. Feedback is held at 0.30
  because a pair of cross-fed delays has a system gain of *2g*; at 0.5 it never
  decays. That exact mistake cost real time in [`aarti`](../README.md) once.
- **Limiter** is a `DynamicsCompressor` with a 3 ms attack and a 12:1 ratio, so
  a hundred ringing notes duck politely instead of clipping.

Then the expressive parts, which cost nothing and change everything:

- **Stereo placement by canvas x** — a wide drawing plays wide.
- **Velocity from draw speed.** A flick is louder *and* brighter, because the
  filter cutoff tracks velocity as well as pitch. No extra control to learn.
- **±7 cents of drift per note**, so a repeated figure never sounds mechanical.
- Vibrato that eases in over 350 ms, because nobody starts a note already
  wobbling.
- Selecting an instrument auditions it.

## Picture

three.js with a real bloom pipeline, not a canvas `shadowBlur`:

```
scene → bright pass → blur H → blur V → composite (+ filmic curve, + grain)
                      └── quarter resolution ──┘
```

Strokes are camera-facing ribbons whose fragment shader has a **two-stage
falloff** — a tight core plus a wide halo — which is what stops a glowing line
looking like a fat antialiased one. The backdrop is a shader with a slow aurora
that brightens with how much is playing, a vignette, and enough grain that flat
areas are never dead. Type is Space Grotesk from the font registry.

The drawing plane stays flat and screen-aligned. Depth is for looking at; a
tilted canvas would only make you miss.

## Two bugs worth recording

Both were invisible to the console and found by looking at screenshots.

**The scan plane did not render at all.** The orthographic camera is built as
`(0, W, 0, H)` — top above bottom, so screen coordinates map straight through
and y runs downward like the DOM. That flips the projection's Y, which **inverts
triangle winding**, so any `FrontSide` material is back-face culled into
invisibility. The strokes only survived by luck of their winding; a stroke drawn
right-to-left would have vanished too. Both materials are `DoubleSide` now, and
there is a comment at the camera saying why.

**The backdrop was vertically flipped.** `vUv.y` runs bottom-up in GL and the
layout is top-down, so the darker canvas region landed at the wrong end.

## Verified

`node _skills/sekai/harness/run.js symphony-sketchpad sc-sym2.json` — 308 frames,
no console or page errors, `loadFont` / `ready` / `start` / `interact` all fired.

Audio was probed separately, since the harness cannot hear: all 21 instruments
build their graph with **zero errors**, 12 `PeriodicWave`s baked (the other nine
are the drums, noise and inharmonic voices), context running at 44.1 kHz.

## Provenance

Ported from a standalone Sekai build, then rebuilt to a higher standard at the
repository owner's request. The concept, the pentatonic mapping, the scanline
and the instrument list are the original's. The synthesis and the rendering are
new — the original's voices were single oscillators into `destination`, which is
what made it sound thin.

Nothing was substituted for a missing asset: the original declared two audio
slots and both were empty in the shipped build, so there was never an asset to
lose. No leaderboard — it is a creative toy with no score, and one would invent
a goal it does not have.
