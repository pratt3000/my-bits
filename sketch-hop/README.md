# Sketch Hop

An endless doodle-style vertical jumper, drawn on graph paper. You bounce
forever; the only job is to steer, and never come back down.

A homage to the classic notebook-doodle jumper — same genre and the same
hand-drawn feel, with its own creature, its own monsters and its own name.

## The climb

The Doodle-ish creature bounces automatically and wraps around the edges of the
page. Score is height, and only height.

| Platform | Behaviour |
| -------- | --------- |
| 🟩 **Green**  | Static. Holds its ground. |
| 🟦 **Blue**   | Slides horizontally, bouncing off the page edges. |
| 🟫 **Brown**  | Crumbles the moment you touch it — no bounce, it just falls away. |
| ⬜ **White**  | Bounces once, then fades out behind you. |
| 🟨 **Yellow** | Bobs up and down on its own. Appears higher up. |

### Power-ups

Springs and trampolines are instant launches; the other three are timed flights
with a shrinking gauge under the buttons.

| | Effect |
| --- | --- |
| **Spring** | A single hard bounce, ~1.7× a normal jump. |
| **Trampoline** | Harder still, and it spins you. |
| **Propeller** | 2.6 s of slow controlled lift. |
| **Jetpack** | 3.2 s, considerably faster. |
| **Rocket** | 2.2 s, straight up through everything. |
| **Shield** | 8 s of eating one monster on contact. |

Crumbling and vanishing platforms never carry a power-up — a boost you cannot
reliably reach is a tease, not a reward.

### Things that end a run

Five inked monsters — **blob**, **spike**, **cyclops**, **toothy** (takes two
shots) and **squid**. Land on a head to squash it, or shoot ink from the nose;
walk into one and the run is over. Above a certain height **UFOs** trail a
tractor beam that abducts anything standing under it, and **black holes** pull
from three radii out and swallow you at the rim. A power-up flight makes you
immune to all of it.

## Controls

Two schemes, both one-handed.

- **Touch** (default) — hold anywhere and drag; the creature steers toward your
  finger. A *quick tap* fires ink toward the tap point.
- **Tilt** — opt in from the title card. Motion is a permission-gated
  capability, so it is never the default and never the only option: if the grant
  is denied the bit silently stays on touch. A stored tilt preference is
  re-armed on the next real gesture, because iOS only grants motion from one.

## Art

Everything is generated at runtime — packaged assets are disabled
(`maxAssets: 0`), so there is nothing to download.

The hand-drawn look is a **wobble pass**: every stroke is subdivided, nudged
perpendicular by seeded noise, curved through Catmull-Rom, then drawn twice —
once solid and once fainter and offset, the way a pencil goes round a shape a
second time. The seed is derived from the object's identity, so a given sprite
wobbles the same way every frame instead of shimmering.

Sprites are baked once into `OffscreenCanvas` surfaces at
`U × min(dpr, 2)` and drawn with explicit `dw/dh`, so a frame is `drawImage`
calls rather than several hundred path operations. Steady 60 fps on a phone
viewport (median 16.7 ms, p95 16.9 ms).

### The lettering

The font registry has no handwriting face, and the system chalk fonts
(`Chalkboard SE`, `Bradley Hand`, `Comic Sans MS`) only exist on *some* phones —
on the rest a system-font design silently degrades to a generic bold sans, which
is the one thing that would break the aesthetic.

So the alphabet is **drawn**: A–Z, 0–9 and punctuation defined as stroke paths on
a normalised grid, run through the same wobble pass as everything else. It looks
identical on every device, needs no dependency, and survives the no-`OffscreenCanvas`
fallback because it is stroked live rather than baked. Every label is fitted to
its box (`fitSize`), so no string can run out of a panel or a button.

## Sound

Synthesized; there are no packaged assets.

The **boing** is bespoke because it is the whole personality of a jumper and no
generic sting sounds like one: a triangle swept up an octave and a half in 55 ms
then settling back, with a 26 Hz vibrato on the frequency and a 35 ms noise
transient on top. It pitches up as the climb gets faster. Springs sweep
220 → 1250 Hz, brown platforms crack as two filtered noise bursts, monsters
squish as a lowpass sweeping 1500 → 190 Hz.

Propeller, jetpack and rocket share one sustained noise voice, retuned per kind —
the propeller gets a 22 Hz chop on the filter frequency, the rockets a steady
low roar. A `ctx.music` chiptune bed runs underneath at intensity scaled to
height, ducked on power-ups and deaths.

## Files

```
sketch-hop/
  plethora.json   # manifest: permissions, one record channel
  main.js         # the whole bit
  README.md
```

## Contract notes

- Permissions: `audio` (synthesized effects via Web Audio), `backgroundMusic`
  (`ctx.music` bed), `haptics`, `storage` (personal best, control and sound
  preference), `motion` (opt-in tilt steering, with touch fallback).
- Memory: one `records` channel, `score`, submitted once at the end of a run.
- No dependencies, no packaged assets.
- If a WebView has no `OffscreenCanvas`, `makeSurface()` returns null and every
  bake site falls back to drawing live: flat rectangles, a plain ellipse
  creature, the grid ruled per frame. Plainer, fully playable, never blank.
  Verified by deleting `OffscreenCanvas` before boot — zero errors, still plays.

### Generation invariants

Three spawn bugs were found by dumping world geometry and testing it rather than
by looking at it, and all three are now asserted over 25 seeds / 428 platforms:

- **Twin platforms must clear each other.** Two platforms on the same row within
  `w + 26·U` fuse into what reads as one long bar, which is not the route choice
  the twin spawn was meant to offer.
- **Monsters and hazards are placed before the row above them exists**, so a
  later platform can land on top of one. A sweep at the end of `generateUpTo`
  drops anything left buried.
- Gaps stay inside the jump arc: apex is `v²/2g ≈ 192·U` px, so the maximum
  generated gap is capped at `158·U`.

### What the upload validator rejects

Confirmed the hard way in a sibling bit (`cairn/README.md`) and respected here:

- `document.createElement("canvas")` → *"Direct document/body access is not
  allowed."* `OffscreenCanvas` is accepted and is what this bit uses.
- `canvas.getBoundingClientRect()` → *"unsupported remote resources"*, a message
  that gives no hint layout access is the cause. This bit uses
  `event.offsetX / offsetY`, which are already canvas-relative and skip a forced
  reflow per pointer event anyway.
- The canvas `filter` property is avoided for the same reason (it also accepts
  `url(#…)`); the one use here was redundant and was removed.
