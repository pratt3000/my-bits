# Window Seat

A mobile-first [Plethora Bit](https://create.plethora.studio) built around one
very specific thing you have already watched a hundred times: rain running down
the window you are sitting beside.

Condensation gathers into beads. Beads find each other and pool. They lean
sideways because of the wind sliding over the glass. And then one of them gets
heavy enough that surface tension gives up and it **runs** — eating every bead
in its path on the way down, getting faster the fatter it gets, tearing a clear
channel through the mist behind it.

That release is the whole bit. The game on top is the bet you already make
without meaning to: three drops get backed, you pick one, and the first one down
to the sill wins.

You are actually in the room. It is built around you — plaster walls, a deep
wooden sill, curtains, string lights over the window, a shelf of books, a desk
with a lamp still on — and the glass hangs in the window recess. Drag the room
and you turn your head; drag the glass and you touch the water.

## Files

| File            | Purpose                                                          |
| --------------- | ---------------------------------------------------------------- |
| `plethora.json` | Manifest (`plethora-bit@2`, runtime global `window.plethoraBit`). |
| `main.js`       | The entry source (`entry: "main.js"`).                            |

## How a drop behaves

Nothing about a drop is scripted or on a timer. A handful of rules produce all
of it:

- **Beads grow where they sit.** Vapour lands in proportion to the area a bead
  presents, so `dm/dt = k·r²`. With `m = r³` that makes `dr/dt` constant, and a
  bead takes `3·(release − r₀)/k` seconds to break loose *regardless of the size
  it started at*. A per-drop `grow` jitter spreads those releases out so the
  glass never releases in waves. Collisions alone would not do this — randomly
  scattered beads on a window almost never touch.

- **A bead holds until its weight beats its own contact patch.** Pinning scales
  with radius, weight with radius cubed, so there is a hard size above which
  sitting still stops being an option. Every drop carries its own pin jitter, so
  the moment any particular one goes is genuinely unpredictable.

- **Small drops slant, fat drops plummet.** Wind pushes on frontal area (`~r²`)
  while gravity pulls on mass (`~r³`), so sideways acceleration falls off as
  `1/r`. Fine mist gets blown right along the glass; a heavy runner drops almost
  straight. A runner that keeps eating therefore *curves*, from slanted to
  vertical, as it fattens.

- **Water on glass is held back by its contact line, not by air.** Retarding
  force follows the wetted perimeter while weight follows volume, so terminal
  speed lands on `gravity·r²/friction`. A fat drop is not slightly faster than a
  thin one, it is dramatically faster — which is the entire race. Both axes
  relax toward terminal exponentially rather than by an explicit step, because a
  drop that sheds down to a sliver would blow an explicit integrator up.

Runners shed mass as they go, and the shed beads re-pool. So a later runner can
inherit a lane the first one cleared and go screaming down it. That is where the
rivalry between paths comes from, and it is emergent, not authored.

## What you actually do

One gesture does everything, and what it does depends on what is under it. On
the glass you touch the water — your fingertip becomes a warm patch that sweeps
loose beads into a single heavy drop, and letting go releases whatever you
built. Anywhere else in the room you turn your head. In the room the touch is
resolved by raycasting the pane and reading the hit UV, so the same code drives
both views.

Tilt leans your head on top of that: a real look-around in the room, and a shift
of the world behind the pane in the flat view. Without a motion grant the view
drifts on its own.

Drops that are *in* the race cannot be grabbed. Being able to carry your own
runner down to the sill would settle every race before it started — so you feed
it instead: build a fat drop, release it in your racer's path, and let your
racer swallow it. Runners merge with runners, so that lands as a real jump in
size and speed.

If you never tap, the backed drops simply release on their own after a while and
it goes back to being rain on a window. Nothing here demands to be played.

## Why the drops are geometry, not painting

A droplet is a lens, and a lens cannot be faked with gradients. The first
version of this bit painted each drop as a shaded circle onto a canvas, and the
result read exactly as what it was: grey bubbles stuck to a picture. No amount
of tuning the gradients fixes that, because the thing your eye actually uses to
decide it is looking at water is never in them.

So the pane is rendered properly. The world outside goes to the GPU as a
texture, the glass is a blurred sample of it, and every droplet is an
**instanced quad carrying a baked surface normal**. For a dome
`z = H·√(1 − d²)` that normal works out as `(k·u/s, k·v/s, 1)` with
`s = √(1 − d²)` and `k = H/R`, so a small `k` bakes the flat wide-contact bead
that sits on cold glass and a large one bakes a fat drop about to run. The
fragment shader then samples the world **against** that normal, which pulls in
the far side of what is behind the drop — the image arrives inverted and
magnified, the way a real bead delivers it. Add a dark rim where light hits at a
grazing angle, a tight caustic where the dome faces the sky and a softer one low
down where the street throws light back up, and it stops looking painted.

Instancing is also what makes the density believable. Painting each drop by hand
capped the glass at a few hundred; one quad each means thousands, so the haze a
real window is covered in can actually be there. The sub-pixel end of that haze
still lives in the condensation bake — simulating it would cost thousands of
bodies to draw what a texture draws for free.

Backing a drop tints the light coming through it rather than drawing a ring
around it. A ring is UI stuck on top of a scene; a drop with a colour in it is
still a drop.

## Why the rain is made of drops, not of noise

Three things have to be true at once or it is not rain, and getting each of them
wrong in turn is how this bit arrived at the version that ships.

**It is dark.** Rain heard from inside is a wall, a shut window and a couple of
metres of air away, and every one of those takes the top off it. The energy
lives under about 1.5 kHz. The first two attempts here shaped noise — band-passed
white, then pink rolled off low — and read as hiss, because that is what they
were. The third rebuilt every layer out of synthesised impacts and read as
*frying*, because a dense field of small bright ticks at a 2.7 kHz centroid is
the sound of a pan, not of weather. What ships measures 1.2–1.4 kHz.

**Water does not ring.** It splats: the impact spreads and slows within a
millisecond or two, so the top end leaves first. Every impact is noise poured
into a gentle lowpass whose cutoff falls as the sound dies, and nothing has a Q
high enough to hold a pitch — the struck-resonator version was crisper and
completely wrong. Onsets are ramped over about half a millisecond too, because
an envelope that starts at full amplitude on sample zero is a step, and a step
is broadband no matter how gently the noise inside it is filtered. That one
detail was the difference between soft splats and an audible tick on every drop.

The single exception is the **drip** — a drop falling into standing water traps a
bubble, and the bubble's note climbs as it collapses. It is the most recognisable
water sound there is, which is exactly why there is only one every few seconds.
A field of them is a cave.

**It breathes.** Rain does not fall at a constant rate, so where the grains land
in each loop is decided by a slow curve rather than a flat random, and the loops
arrive with swells and lulls already in them. Whole numbers of cycles per loop,
or the seam would be a step in the weather. On top of that the gusts on screen
move the bed levels, the roll-off *and* the rate of impacts together, on two
periods that do not divide into each other.

Thousands of live nodes a second is not possible, so the dense layers are baked
once at unlock (about 70 ms): palettes of grains, stamped into looping buffers at
random offsets, anything overhanging the end wrapping to the front so the loop is
seamless by construction rather than by crossfade. The two loops are 5.77 s and
4.13 s, deliberately mismatched, so their combination does not repeat on any
period you could sit through. Channels are stamped independently, which is why
the bed is decorrelated and sounds like weather around you rather than a mono
source in front of you.

- **The sheet of it**, out past the glass: 900 impacts a second per channel,
  weighted small, rolled off around 1.3 kHz because that is what a closed window
  does to rain. Dense enough that the impacts stop being individual and become
  the wash.
- **Nearer and fatter**, off the sill and the ledge outside, close enough to hear
  land one at a time, on the other loop length.
- **The taps on the pane itself** are live, because they are the few a second you
  can pick out individually. Gaps between them are exponential rather than fixed
  and scheduled a horizon ahead in audio time, so a shower never inherits the
  frame rate as a rhythm. Each is panned across the glass, and playback rate
  below 1 drops the pitch and stretches the decay together — which is what a
  bigger drop does, so one control covers the whole size range. They are damped
  hard: a pane is stiff, its frame absorbs, and you are on the wrong side of it.
  Left bright they were the loudest thing in the mix and read as something
  *tapping* rather than as weather.
- **Splash**, which never resolves into anything and lives an octave or two above
  the impacts, so the top of it is quietly busy rather than empty.
- Under all of it, the room, which you only notice if it stops.

The whole mix lives in one `RAIN` table rather than scattered through the graph,
because every number in it was arrived at by recording the output and measuring
it, and they only mean anything next to each other.

## Two views, one simulation

The glass is simulated into its own coordinate space, so the same drops can be
presented two ways:

- **The room.** `three@0.164.1` builds it around you and hangs the pane in the
  window recess. The streetlights sliding past outside are the *same* lamps that
  light the interior — `stepCabinLight` finds whichever near-strip lamp is
  squarest to the window and puts the sweep light there — so a car passing
  washes cold light across the cushions.
- **Flat.** The glass drawn to a 2D canvas inside a painted frame. This is the
  very first frame, before three has finished loading, and it is where the bit
  stays if three fails, if there is no WebGL, or if there is no
  `OffscreenCanvas`. It cannot do real refraction, so it is plainer — but it is
  fully playable, and the room is presentation, not mechanics.

The flat view paints straight into the display canvas rather than through an
offscreen one, because Chromium accelerates a canvas that is on screen but
rasterises an offscreen 2D context in software: routing it through one measured
**1.7 ms → 22.5 ms per frame** for no benefit at all.

The room is lit almost entirely from outside, and those sources sit *outside the
glass* where the light actually is. A point light hung close inside is 20 cm from
whatever it is next to and blows it out; from beyond the pane the falloff across
the room is gentle enough to shade a whole wall. Inside there are only the warm
ones you can see — string lights, a candle, the desk lamp — plus a bounce off
the floorboards so the room is not lit only from above. Because the drops are
drawn with a `RawShaderMaterial`, which bypasses three's tone-mapping include,
the renderer runs with `NoToneMapping`: ACES would have crushed the room while
leaving the pane untouched.

Proportions matter more than detail. Eye height above the cushion is what tells
you whether you are sitting on a window seat or kneeling on the floor, and the
sill has to sit about a forearm above it.

## Rendering notes

One registry dependency (`three@0.164.1`) and no packaged assets
(`maxAssets: 0`) — scenery, room geometry, drops, condensation and every sound
are generated at runtime.

- **The world outside is two horizontally tileable strips** whose period is
  exactly the glass width, so scrolling is a pair of `drawImage` calls with an
  offset and never a reseam. Every element is stamped at `−w`, `0` and `+w` so
  shapes straddling a period edge wrap cleanly. Far and near drift at different
  rates.

- **Condensation is a real layer, not a texture.** Runners cut through it with
  `destination-out`, which is why a trail reads as *cleared glass* rather than
  as a line drawn on top. It heals by fading the pristine copy back in slowly,
  so old lanes linger about as long as they should.

- **The frame stays put and the world behind it shifts** with device tilt. That
  is what parallax through a window actually looks like, and it keeps the glass
  clip aligned with the drops sitting on it.

- **Small beads are baked sprites**, sized per step of radius, so a frame is
  mostly `drawImage` calls. Lensing is the expensive part and is the first thing
  dropped when frame time slips, and the first thing restored when it recovers.
  In the room the pane texture only re-uploads when the window is actually in
  view, and backs off from 40 Hz to 20 Hz when frames get long.

## Memory

| Channel        | Family    | What it holds                               |
| -------------- | --------- | ------------------------------------------- |
| `window_stats` | `local`   | Races, wins, best streak, biggest drop.      |
| `streak`       | `records` | Best streak — the leaderboard that matters.  |
| `wins`         | `records` | Races won, all time.                         |

Device-only preferences (sound on/off, whether the instructions have been seen)
go to `ctx.storage`, which is the right home for them; `memory.local` is for the
run stats, which should follow the player.

## What the upload validator rejects

Inherited from `cairn`, and still true. Neither is documented in `sdk.md`, and
neither error message names its actual cause:

- **Minting a canvas element by hand** → *"Direct document/body access is not
  allowed."* `ctx.createCanvas()` is not the fix for offscreen work — it mints a
  display surface the runtime mounts. `OffscreenCanvas` is accepted and is what
  this bit bakes into. `document.createElement` with a **literal** `"div"` /
  `"button"` / `"ul"` / `"li"` is fine; a computed tag is not.
- **Querying layout rectangles** → *"This bit uses unsupported remote
  resources…"*, which says nothing about layout. Pointer input uses
  `event.offsetX` / `offsetY`, already canvas-relative, which also skips a
  forced reflow per pointer event.

The validator reads the source as text, so the header comment in `main.js`
describes both constructs rather than quoting them — a comment containing them
verbatim is enough to trip it.

Also kept throughout: timers go through `ctx.timeout`, listeners through
`ctx.listen`, and no blur filter is used anywhere, canvas or CSS. Softness comes
from bouncing a bake through a tiny canvas and letting the smoothed upscale do
the work.

## Verified

Driven in headless Chromium against a stub of the `ctx` surface, at
390×844 / 320×568 / 844×390, with and without `OffscreenCanvas` — 22 checks:

- Instructions on first run, reopen via `?`, sound toggle both ways, a race
  forming unprompted, tapping a backed drop placing a bet, and a race running
  through to `complete` / `fail` with both leaderboards submitted.
- No overlapping tap targets at 320 px wide; no controls in the bottom unsafe
  area.
- Rotation to landscape and back, with the layout moving the caption down off
  the glass when the window is too short to carry it.
- The room taking over from the flat view, a bet placed by tapping *through* the
  3D pane, and dragging the room turning the view.
- No runtime errors in any configuration. Simulation cost flat over two minutes
  (p90 8.3 ms → 5.9 ms), so the drop population and the condensation layer are
  not leaking.

The audio is verified by recording rather than by assertion. A test subclasses
`AudioContext` and shadows `destination` with a node feeding a `ScriptProcessor`,
so what is measured is the shipped signal path and not a copy of the synthesis
code. The same capture writes a WAV and a spectrogram, which is how the frying
and the per-drop tick were both caught — neither was audible in a number, and
both were obvious in a picture. Over 12 seconds: peak 0.65, RMS 0.134, spectral
centroid **1.23 kHz**, crest factor **4.9** (the struck-resonator version that
sounded like a pan measured 13.1 at 2.7 kHz), envelope flutter 0.35 against
roughly 0.11 for steady filtered noise, and inter-channel correlation **−0.009**
— which is the number that says the bed is genuinely two independent stampings
rather than one signal sent to both ears.

One caveat on the room's numbers: headless Chromium rasterises WebGL in software
(SwiftShader), so wall-clock frame rate there is not informative. A CPU profile
is, and it puts **90 % of the time in `(program)`** — the software rasteriser
itself — with 7.9 % in `texSubImage2D` and every one of this bit's own functions
under 1 %. The room's cost is the software renderer, not the code driving it.
