# Bounce & Draw

Draw the walls, let the balls pay you.

A ball falls down a dark board. Draw a bar anywhere and it becomes something
solid to ricochet off, and every bounce earns. Spend what you make on a better
ball — brighter, faster, worth more per hit — or on another ball entirely.

The whole game is one honest idea: **a bounce is worth money, so you are really
building a machine that maximises bounces.** A funnel. A staircase. A long
shallow ramp that keeps a ball skimming instead of dropping.

## Every bar is a note

This is what the rebuild is for. A bar's pitch comes from its **length** — long
bars are low, short bars are high — quantised to a major pentatonic across three
and a half octaves so a hundred bars rattling at once still resolves into
something you would keep listening to. MIDI 36 for a 380-pixel bar up to MIDI 81
for a 24-pixel one.

And a bar's **colour is that same number**: deep magenta at the bottom of the
range through violet to cyan-white at the top. So the board is legible as music
before you hear it — you can look at a machine and know roughly what it will
play — and a machine built to maximise bounces is, without being asked to,
composing.

Drawing a bar auditions it, the way picking an instrument always should.

## Sound

Nothing is sampled and nothing is a bare oscillator. Each strike is a baked
`PeriodicWave` — a marimba-ish spectrum with scattered partial phases, because
partials that all start aligned are what makes an additive tone buzz — through
one master chain:

```
voice → pan → ┬──────────────────────────→ bus → shelf → limiter → out
              ├─ reverb send → convolver ───┘
              └─ delay send  → ping-pong ───┘
```

- **Reverb** is a `ConvolverNode` fed an impulse generated at load: 1.9 s of
  exponentially decaying noise with the two channels decorrelated.
- **Delay** is a true ping-pong, two lines cross-fed, feedback held at 0.26 —
  a pair of cross-fed delays has a system gain of *2g*, so at 0.5 it never
  decays.
- **Limiter** is a `DynamicsCompressor` at 12:1 with a 3 ms attack, which is
  what lets a busy machine hit forty times a second without clipping.

Then the parts that cost nothing and change everything: impact speed sets both
gain and filter cutoff (a fast ball is brighter as well as louder), stereo
position comes from where on the board it happened, low notes ring longer than
high ones, and every note drifts by up to ±4 cents so a repeating figure never
sounds mechanical.

## Look

three.js with a bright-pass → two separable blurs at quarter resolution →
additive composite with an ACES-ish filmic curve and grain.

A bar is not a stroke with a shadow behind it. It is a quad in its own local
frame with a **capsule signed distance** in the fragment shader, giving a solid
dark slab, a lit rim in the bar's pitch colour, a highlight along its upper
edge, and a halo — and a flash that decays over about 300 ms when a ball hits
it. All hundred bars are one geometry, rebuilt only when something changes.

Balls are shaded spheres, not discs: a fixed screen-space light, a specular
point, a fresnel edge, and a squash along the direction of travel on impact.
Behind each one is a tapering ribbon trail; in front, an expanding shock ring
and a burst of sparks.

Coins fly from the impact to the money pill and pop it on arrival. Nothing
communicates "that bounce paid" like watching the payment arrive somewhere.

The backdrop is a shader — a slow two-layer value-noise drift, a dot grid so the
board has a scale, a vignette, and an aura in the middle that grows with your
ball level (the original's idea, kept).

## The camera gotcha, again

```js
const camera = new THREE.OrthographicCamera(0, W, 0, H, -1000, 1000);
```

Top above bottom, so screen coordinates map straight through and the physics
needs no conversion at all. That flips the projection's Y, which **inverts
triangle winding**, so any `FrontSide` material is back-face culled into
invisibility. Every material here is `DoubleSide`. This cost an afternoon in
[`symphony-sketchpad`](../symphony-sketchpad/README.md) and it is written at the
camera in both files now.

## Leaderboard

`memory.record("earnings")` — **Peak Earnings**, daily / weekly / all-time,
global and following, `best_per_user`. Lifetime earnings only ever climb, so the
board is submitted as it grows rather than at some end that never comes,
throttled to whole hundreds so an idle game does not hammer the channel on every
bounce.

## Verified

`node _skills/sekai/harness/run.js bounce-and-draw sc-bounce2.json` — no console
or page errors; `loadFont`, `ready`, `start`, `interact`, `music.play` and
`haptic` all fire.

Audio was probed separately, since the harness cannot hear: the graph builds
with **zero errors** — `PeriodicWave` baked, convolver and ping-pong both live,
context running at 44.1 kHz, twelve strikes across the full note range clean.

## Provenance

Ported from a standalone Sekai build, then rebuilt at the repository owner's
request. The physics, the economy (×2.2 on upgrades, ×2.5 on balls), the ball
colour cycle and the press-drag-release gesture are the original's, unchanged.
The rendering, the note mapping, the synthesis and the leaderboard are new — the
original's bounce was a 400 Hz sine into `destination`.

The original shipped twelve music tracks. A bit cannot package audio, so those
are gone; Plethora's own generative beds stand in, and the Music sheet says so
rather than pretending otherwise.
