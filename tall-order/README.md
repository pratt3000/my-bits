# Tall Order

Balance the tallest ice cream tower in town. A scooper stands at the bottom
of the screen holding a waffle cone; two machine arms slide in along a rail at
the top and lower scoop after scoop onto the stack. The stack leans. You walk
the cone under the lean — drag a finger, or tilt the phone — before the centre
of mass wanders past the cone and the whole thing comes down.

It is Cone Zone, the *Wii Play: Motion* minigame, rebuilt for one thumb and
dressed up: a rooftop parlour at golden hour, glossy scoops with drips and
sprinkles and a cherry that hops to the top, a scooper whose face tells you how
worried you should be, INCOMING rushes, big scoops, mini triplets, hearts, a
clean-landing multiplier, and two leaderboards.

## Files

| File            | What it is                                                                      |
| --------------- | ------------------------------------------------------------------------------- |
| `plethora.json` | Manifest — `plethora-bit@2`, full screen, no dependencies, two records, tuning. |
| `main.js`       | Entry source defining `window.plethoraBit`. Everything is drawn in Canvas2D.    |

## How it plays

- **Balance.** The tower is an inverted pendulum pivoting at the cone's rim.
  Drag anywhere to walk the cone (relative: the cone moves by what the finger
  moves, scaled by the zoom), or switch to tilt on the title screen when the
  app has motion. Arrow keys work in the web player.
- **Scoops.** The arms aim at the tower's top with an error that grows with
  height (and more in a rush); the aim is fixed when the arm stops to hover, a
  dotted line and a landing disc show where, and the scoop drops straight down.
  A landing inside the catch zone counts; it sits where it landed, which shifts
  the centre of mass for good and gives the tower a shove. A scoop the tower is
  not under glances off, splats on the deck and costs a heart. Three hearts.
- **Kinds.** Regular (100 points), big (150, heavier, from scoop 5), mini
  (60, in quick triplets, from scoop 8).
- **Clean landings** — near the centre while the tower is nearly upright —
  build a multiplier up to ×8; a wobbly one resets it.
- **INCOMING.** Every eight scoops (a knob) the machine warns for 1.3 s, then
  fires four to eight scoops half a second apart from alternating arms, with
  more aim error, for double points. Then a breather.
- **Milestones** every ten scoops: a bonus of 50 × scoops, confetti, a cheer.
- **It ends** when the tower topples (the centre of mass passes the edge of
  the cone's support) or the hearts run out. The result card shows scoops,
  points, your bests, the top three on the score board and your rank, and
  replays immediately — the board is fetched after, never awaited.
- **Records:** `score` (Best Score) and `tower` (Tallest Tower), both
  `best_per_user`, daily/weekly/all-time, global/following, submitted once at
  the result. A new personal best of five scoops or more posts a Pulse
  completion from the result card.

## The physics

One rigid body, lean angle `th`, pivot at the cone's rim, centre of mass
`(cx, cy)` in the tower's own frame (cx is the sum of where each scoop landed,
weighted by mass):

```
th'' = (G / cy) (sin th + (cx / cy) cos th)        gravity, and the bias of an off-centre stack
     - K_CUP (1 - grown) th                          the cone's cup springs a short stack upright
     - (a / cy) cos th                               the cone's own horizontal acceleration
     - c th'                                         viscosity
```

`G` is an effective gravity (520 px/s² × the *topple speed* knob × one minus
0.6 × *stickiness*) multiplied by `grown = smoothstep(26, 120, cy)`, and the
cone's acceleration reaches the stack in the same proportion, so the first
three or four scoops sit in the cup, come along for the ride and spring back
when nudged; the instability fades in over scoops four to six. It topples when
`|th| > atan(SUP / cy)` with `SUP = 30 px`: a tall tower leans slowly (the time
constant `1 / sqrt(G / cy)` is 0.64 s at eight scoops and a second at twenty)
but has a tiny window (10° at eight scoops, 4° at twenty, always about 60 px
of sway at the top), and from eight scoops on a lean of one degree reaches the
limit in about a second and a half. Moving the cone right by `dx` changes the
lean by `-dx / cy`, which is exactly how a broom on a palm is balanced, and
why the cone follows the finger through a stiff critically damped spring
rather than snapping: the tower feels the cone's acceleration, and a finger
jump has to be a bounded one. Because the cone spring (22 rad/s) and the
jelly wobble (13 rad/s) are stiff, the body physics runs in substeps of 16 ms
or less whatever the frame rate; before that a 100 ms frame sent the cone to
infinity.

A lopsided stack has an equilibrium lean, `-atan(cx / cy)`, where it needs no
acceleration at all; holding it dead upright instead means accelerating the
cone forever, which is how a player gets chased to the edge of the screen.
That is a feature of the real thing too, and the hint for a long run: let it
lean a little.

Playability was checked offline before trusting the headless driver: a model
of exactly these equations, driven by a full-state balancer with a 250 ms
reaction delay (a human's), holds a tower of about twenty scoops; with no
delay it holds fifty. The same balancer, with equilibrium compensation and
gains picked from the closed-loop eigenvalues, is the harness driver
(`debug.drive`).

A landing at lateral offset `e` adds `e × m / (M × cy) × 3` to the angular
velocity (capped at ±0.5 rad/s), settles at `e / 2` as that scoop's permanent
offset, and kicks the jelly wobble: each scoop also carries a damped lateral
oscillator (spring 170, damping 7) excited by landings and by the cone's
acceleration in proportion to its height, so the stack whips like soft ice
cream. The wobble is cosmetic, and it is most of the feel. Scoops overlap by
18% of their summed radii.

The camera zooms out as the tower grows so the top stays below the dispenser's
claw: `scale = room / (pivot height + tower height + 90)`, clamped to 0.24..1,
where `room` is the screen distance from the claw to the deck. The drop
gravity is divided by the zoom so a scoop falls in the same screen time at
every height.

## The look

Canvas2D, every frame, no assets: a four-palette sky (sunset, mint, midnight,
candy — a *Sky* knob) painted as a literal-stop gradient, a sun with a glow or
a moon with stars, drifting cloud clusters, a two-depth skyline with lit
windows, a rooftop parapet and a brick deck that run edge to edge under the
logo. The machine is a chrome rail with a maker's plate; each arm is a
carriage, a piston and two fingers that swing open on release. Scoops are a
flat flavour fill with three lower lobes, then a shade and a gloss gradient
clipped to the shape, a specular, optional drips, sprinkles or cookie specks,
and a cherry on the top one. The scooper is a round-headed soda jerk with a
paper hat, striped shirt and apron; his eyes follow the arm or the tower top,
his brows and mouth read calm, focused, panic, joy and dismay from the lean
ratio and the events, and he leans and shuffles with the cone's acceleration
and speed. A red vignette pulses as the lean nears the limit. Screen shake on
big landings and the fall; particles for splats, sparkles and confetti.

## Sound

A small WebAudio synth (permission `audio`) for plops pitched by scoop size,
squishes, the clean-landing chime, the splat, the INCOMING alarm, the
milestone arpeggio and the fall; `ctx.music` (`backgroundMusic`) for a cozy
bed that climbs in tempo and intensity with the tower, ducks under the alarm,
and stings on milestones and the result. Mute is a chip on the title and the
pause card and persists.

## Contract notes

- Built against context `plethora-agent-context-2026-10-22.1`, SDK 1.7.0.
- `display: "fullscreen"` (required to publish since this context). Layout
  reads `ctx.contentSafeArea ?? ctx.safeArea` every frame and on
  `ctx.onResize`; the banner hangs from the top inset, the hint, the cards and
  the title pad by all four, the scooper's feet stand on the content-safe
  bottom so he is never behind the logo button, and the sky and deck run to
  every edge. The same file plays in the legacy safe frame through the `??`.
- No dependencies. `ctx.createCanvas2D({ coordinateSpace: "css", maxDpr: 2,
  alpha: false })` plus a passthrough DOM root for the HUD; buttons through
  `ctx.input.activate`.
- `ctx.game.loop` drives the frame; `ctx.game.score` holds the live score and
  tower tracks and submits the two declared records at the result;
  `score.leaderboard` reads the top three.
- Tilt through `ctx.motion.start` + `tiltControl`, started from the Play tap,
  calibrated on start, stopped at the result; touch is the default and the
  fallback when motion is denied or absent. Permissions: `audio`,
  `backgroundMusic`, `haptics`, `motion`, `storage`.
- Ten tuning knobs (topple speed, stickiness, placement error, drop interval,
  rush cadence, big and mini chances, sensitivity, sky, music) and a
  difficulty curve over scoop count; `chill` and `frantic` presets. Published
  playback uses the defaults.
- Persistence in `ctx.storage` (bests, plays, control, mute) through a
  fire-and-forget helper, because `set()` returns nothing on device.
- Onboarding is `immersive`: the first run shows a drag cue and one follow-up
  line, then nothing.
- Gradient stops are string literals throughout: the upload validator rejects
  a stop colour it cannot resolve, so dynamic colours (flavours, palettes) are
  flat fills under literal-stop overlays. No `document.createElement("canvas")`,
  no layout-box queries, no `ph` local, no ImageData.

## Verified

Headless, with the repo harness (`_skills/sekai/harness/run.js`) against the
strict mock `ctx`, which for this bit learned `ctx.game` (score tracks and the
loop), `ctx.tune` from the manifest, `ctx.input.activate`, a permission-gated
`ctx.motion`, `ctx.pulse` and the documented leaderboard shape. The runner
gained a closed-loop `balance` step that holds a finger down and moves it
from the bit's `debug.drive` each tick — a hand on a pole, not scripted drags.

- Full screen, 390 × 844 with an iPhone's insets and logo band: init clean,
  `ready()` after the title, no console or page errors; the driver reached
  fifteen scoops through the first INCOMING rush (both arms firing, double
  points) and the ten-scoop milestone (confetti, bonus, cheer); clean and
  wobbly landings, the multiplier rising and resetting, mini and big scoops,
  the camera zooming out; a scripted swipe toppled it, the result card
  showed scoops, points, a new best, the mock's top three with the viewer's
  row and rank, and a Pulse completion was posted; play again, pause and
  resume, an inset change mid-run, a resize.
- The legacy safe frame (`display: "safe-frame"` in the mock, 390 × 778,
  `contentSafeArea` undefined, a 120 px bottom band): title, play, three
  scoops, pause card; every control above the band.
- A squat 844 × 390 viewport with landscape insets: the camera zooms to its
  floor, five scoops land; it plays but it is not the target.
- The upload validator's known traps are avoided by construction (see
  *Contract notes*); the real validator is the upload.

Not verifiable here: tilt (the harness has no motion), haptics, the music
bed, real touch, and the host's logo button over the real deck.

Uploaded as a draft on 2026-10-27 through `agent.plethora.studio`: action
`created`, id `7eda9816-178b-468d-ad2d-5a4be1951f9c`, 103,069 bytes, no
`notices` in the response, so the full-screen declaration and the source
passed the validator on the first upload. The upload carried
`agentFeedback.contextVersion` 2026-10-22.1, which the uploader confirmed
against the live origin first. Publishing stays manual in the app: Create ->
Drafts.
