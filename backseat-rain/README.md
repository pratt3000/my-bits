# Backseat Rain

A mobile-first [Plethora Bit](https://create.plethora.studio) built around one
very specific thing you have already watched a hundred times: the window beside
you in the back seat of a moving car, in the rain.

Condensation gathers into beads. Beads find each other and pool. They lean
sideways because of the air sliding over the glass. And then one of them gets
heavy enough that surface tension gives up and it **runs** — eating every bead
in its path on the way down, getting faster the fatter it gets, tearing a clear
channel through the mist behind it.

That release is the whole bit. The game on top is the bet you already make
without meaning to: three drops get coloured rings, you back one, and the first
one down to the sill wins.

You are actually in the car. The back of it is built around you — door card,
bench, headrests, the front seats ahead, the parcel shelf and rear screen
behind — and the glass hangs in the window aperture. Drag the cabin and you
turn your head; drag the glass and you touch the water.

## Files

| File            | Purpose                                                          |
| --------------- | ---------------------------------------------------------------- |
| `plethora.json` | Manifest (`plethora-bit@2`, runtime global `window.plethoraBit`). |
| `main.js`       | The entry source (`entry: "main.js"`).                            |

## How a drop behaves

Nothing about a drop is scripted or on a timer. Four rules produce all of it:

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
  `1/r`. Fine mist gets blown right off toward the back of the car; a heavy
  runner drops almost straight. A runner that keeps eating therefore *curves*,
  from slanted to vertical, as it fattens.

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
built. Anywhere else in the cabin you turn your head. In the cabin the touch is
resolved by raycasting the pane and reading the hit UV, so the same code drives
both views.

Tilt leans your head on top of that: a real look-around in the cabin, and a
shift of the world behind the pane in the flat view. Without a motion grant the
car sways on its own.

Drops that are *in* the race cannot be grabbed. Being able to carry your own
runner down to the sill would settle every race before it started — so you feed
it instead: build a fat drop, release it in your racer's path, and let your
racer swallow it. Runners merge with runners, so that lands as a real jump in
size and speed.

If you never tap, the rings simply release on their own after a while and it
goes back to being rain on a window. Nothing here demands to be played.

## Two views, one simulation

The glass is simulated into its own surface in its own coordinate space, which
means the same pixels can be presented two ways:

- **Cabin.** `three@0.164.1` builds the back of the car and hangs the glass in
  the window aperture as a texture. The streetlights sliding past outside are
  the *same* lamps that light the interior — `stepCabinLight` finds whichever
  near-strip lamp is squarest to the window and puts the sweep light there — so
  a lamp crossing the pane washes warm light across the seat beside you.
- **Flat.** The glass drawn straight to a 2D canvas inside a painted frame.
  This is what renders on the very first frame, before three has finished
  loading, and it is where the bit stays for good if three fails, if there is
  no WebGL, or if there is no `OffscreenCanvas`. Fully playable either way —
  the cabin is presentation, not mechanics.

Only the cabin gets an offscreen surface. The flat view paints straight into
the display canvas, because Chromium accelerates a canvas that is on screen but
rasterises an offscreen 2D context in software: routing the flat view through
one measured **1.7 ms → 22.5 ms per frame** for no benefit at all.

The cabin is lit almost entirely by what is happening outside. Night interiors
are forgiving — what you read is silhouette and rim light — so plain slabs in
the right darkness sell it better than detail would, with one tileable grain
reused at different repeats so the big door and seat panels are not flat voids.

## Rendering notes

One registry dependency (`three@0.164.1`) and no packaged assets
(`maxAssets: 0`) — scenery, cabin geometry, drops, condensation and every sound
are generated at runtime.

- **Every drop over a threshold is a real lens.** The world outside is sampled,
  flipped through the focal point, and magnified inside the drop's body. That
  inversion is the single detail that makes rain-on-glass read as *glass* rather
  than as circles drawn on a picture. It is also why the world is baked twice:
  soft for the background, sharp for the lens. A lens needs something crisper
  than its surroundings to magnify.

- **The world outside is two horizontally tileable strips** whose period is
  exactly the glass width, so scrolling is a pair of `drawImage` calls with an
  offset and never a reseam. Every element is stamped at `−w`, `0` and `+w` so
  shapes straddling a period edge wrap cleanly. Far and near scroll at different
  rates because the car is moving.

- **Condensation is a real layer, not a texture.** Runners cut through it with
  `destination-out`, which is why a trail reads as *cleared glass* rather than
  as a line drawn on top. It heals by fading the pristine copy back in slowly,
  so old lanes linger about as long as they should.

- **The frame stays put and the world behind it slides** with device tilt. That
  is what parallax through a window actually looks like, and it keeps the glass
  clip aligned with the drops sitting on it. With no motion grant the car sways
  on its own.

- **Small beads are baked sprites**, sized per step of radius, so a frame is
  mostly `drawImage` calls. Lensing is the expensive part and is the first thing
  dropped when frame time slips, and the first thing restored when it recovers.
  In the cabin the pane texture only re-uploads when the window is actually in
  view, and backs off from 40 Hz to 20 Hz when frames get long.

- **Sound is three layers**: a wide hiss for the sheet of rain, a lower body of
  wind over the car shell that rides the same gusts slanting the drops on
  screen, and individual impacts synthesised one at a time on the pane next to
  your ear. The impacts are what make it read as *this* window rather than as
  generic rain. Merges are pitched by size — the bigger the merge, the lower the
  blip.

## Memory

| Channel                 | Family    | What it holds                              |
| ----------------------- | --------- | ------------------------------------------ |
| `window_stats`          | `local`   | Races, wins, best streak, biggest drop.     |
| `streak`                | `records` | Best streak — the leaderboard that matters. |
| `wins`                  | `records` | Races won, all time.                        |

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
390×844 / 320×568 / 844×390, with and without `OffscreenCanvas`:

- Instructions on first run, reopen via `?`, sound toggle both ways, a race
  forming unprompted, tapping a ring placing a bet, and a race running through
  to `complete` / `fail` with both leaderboards submitted.
- No overlapping tap targets at 320 px wide; no controls in the bottom unsafe
  area — the sill sits clear of it and everything below is door card.
- Rotation to landscape and back, with the layout moving the caption down onto
  the door card when the window is too short to carry it over the glass.
- The cabin taking over from the flat view, a bet placed by tapping a ring
  *through* the 3D pane, and dragging the cabin turning the view.
- No runtime errors in any configuration. Simulation cost flat over two minutes
  (p90 ≈ 3 ms), so the drop population and the condensation layer are not
  leaking.

One caveat on the cabin's numbers: headless Chromium rasterises WebGL in
software (SwiftShader), so wall-clock frame rate there is not informative. A
CPU profile is, and it puts **90 % of the time in `(program)`** — the software
rasteriser itself — with 7.9 % in `texSubImage2D` and every one of this bit's
own functions under 1 %. The cabin's cost is the software renderer, not the
code driving it.
