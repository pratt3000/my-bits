# Happy Diwali from Prathamesh

A Diwali greeting to open with the sound on, after the one at
`diwali.desh.app`: a courtyard at night, one diya to light, and the wish
written in the sky. Every model, texture and sound is made at runtime; the
package is the source and the manifest.

## The story

1. **Approach.** The camera settles in front of the hero diya. After three
   and a half seconds a "Tap here" pill appears over it. A tap anywhere
   lights it; six seconds of nobody tapping lights it anyway (the pill fills
   as the clock runs, and any touch restarts it). This is the original's
   behaviour too.
2. **Lit.** A match strikes, the flame catches, the screen flashes warm. Three
   seconds later the camera lifts to take in the whole courtyard.
3. **Spread.** The flame rolls out from lamp to lamp by distance from the
   hero diya, the string lights come on across the house, the lamp groups
   light the walls. The pill returns over the centre of the yard.
4. **Rangoli.** Powder colours draw themselves on the stone in a spiralling
   sweep over six and a half seconds, the sender's initial in the middle,
   and a paper lantern swells into view at its centre. The pill returns over
   the lantern.
5. **Lantern.** It lifts off, bobbing, then climbs into the night; fifty more
   rise over the town behind.
6. **Fireworks.** The camera pulls back over the roof and fourteen shells go
   up over the town: peonies, chrysanthemums, crossettes, rings, crackles,
   willows.
7. **Wish.** Two more shells climb and burst into "Happy Diwali" and "from
   Prathamesh", the sparks sticking where the letters go, then whitening in a
   sweep from left to right. Tapping the sky launches more shells. The share
   button (where the host offers `ctx.share`) and "Watch again" appear.

## How it is built

- **three.js 0.164.1** from the registry (`ctx.importModule`), a custom
  lighting model instead of three's lights: twelve warm point practicals
  (the lamp groups, the lantern, the doorway), a sky/ground hemisphere, a
  cool rim from the sky glow, height and distance fog. Every lit surface is
  a `ShaderMaterial` on that chunk, which is what makes the lamp light wrap
  softly round the clay and the walls.
- **The house** is boxes: plinth and steps, a wall with a brick-red dado,
  glowing window panes with iron bars and stone frames, the double door
  standing open with a toran of marigolds and mango leaves, a tiled chhajja
  on brackets, a balcony with its railing and open door, a parapet with
  merlons and a raised block, compound walls with a lamp ledge and niches,
  string lights hung in catenaries (warm white with a pastel one in four).
  Three skylines of random buildings with temple spires and scattered lit
  windows step back into the haze; low-poly trees and bushes fill the
  ground outside the walls.
- **The lamps** follow the original's layout exactly (hero, ring, two
  paths, steps, door sills, wall ledges and niches); the bowl is a lathe
  with a pinched spout, shaded in a shader with the sindoor band, gold
  lines and white dots; flames are instanced paper-cut quads that lean and
  flicker; a glow disc sits under each.
- **The rangoli** is drawn on an `OffscreenCanvas` (petals, rings, dots,
  the initial in DM Serif Display, powder grain) and revealed by a shader
  front with a glowing edge.
- **Fireworks** are one point cloud of fourteen slots by 1600 particles; a
  launch fills a slot (rocket trail, stars with trails, flash, smoke, pops)
  and the vertex shader does all the motion from the time, so a burst costs
  nothing per frame. The wish text samples the ink of each line into points
  and launches them from a burst centre with the ballistics solved so each
  spark lands on its letter.
- **Post:** the scene renders in linear HDR to a half-float target (24-bit
  depth: the 16-bit default z-fights the facade into stripes), bright parts
  are blurred at three sizes and added back, and the AgX curve takes it to
  the screen. Without float render targets it falls back to 8-bit with a
  lower threshold.
- **Sound** is all Web Audio: wind and crickets, a detuned saw drone under a
  breathing low-pass with a sub, pentatonic plucks through a feedback delay,
  and effects for the match, the flame, each lamp igniting, the rangoli
  sweep, the lantern riser, every burst (with crackle pops for crackles and
  crossettes) and a bell for the wish. It is created on the first touch,
  which also unlocks audio; the sound button mutes it.
- The phone's upright screen widens each shot's vertical field the way the
  original does (from the 16:9 framing, capped at 64°), so the same scene
  fits across a narrow screen.
- A phone that cannot keep up drops to a 1× backing store after a few
  seconds of slow frames.

## Verified

- `_skills/sekai/scripts/check.py` passes.
- Headless Chromium through `_skills/sekai/harness`: the whole story in
  portrait (390×844) and landscape (844×390), tapping the pill at each step
  and the sky at the end, with `ready`, `start`, `interact` and `complete`
  all fired and no console errors. The harness mock gained `ctx.input`
  (tap and activate) and `ctx.onResize` for it.
- The software renderer manages a few frames a second, so timing-sensitive
  screenshots were taken with generous waits; on a phone the frame loop
  runs at the display rate.

## Not verified here

- Sound: the harness has no speakers. The graph is exercised (no errors on
  creation) but the mix was tuned by ear only in the sense of the numbers.
- `ctx.share` is not in the harness mock, so the share pill is hidden there
  and only the "Watch again" button shows; on a host with `ctx.share` the
  share pill appears above it.

## Divergence from the original

- No GLB models or MP3s (the package can carry no assets): everything is
  procedural, so the house, plants and town are simpler shapes in the same
  places, and the music is a drone and plucks rather than the original's
  score.
- The original's end button goes to a page where you add your own name;
  here it shares this wish, and the sender is fixed.
- No free-look orbit mode after the wish.
