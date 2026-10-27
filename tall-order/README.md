# Tall Order

Balance the tallest ice cream tower in town — in 3D, with the phone. A
scooper stands in a little parlour holding a waffle cone over his head. Two
machine arms, one on each side, swing in from the left and the right and lower
scoop after scoop onto the stack. The stack leans, sideways and toward you and
away. You hold the phone up like a tray and tilt it to walk the cone under the
lean before the centre of mass wanders past the cone and the whole thing comes
down. Where there are no motion sensors (the web player, a desktop) a drag does
the same job.

It is Cone Zone, the *Wii Play: Motion* minigame, rebuilt for a phone and
dressed up: a pastel parlour with a tiled floor, a display case of tubs, a
chalk menu, a neon sign and string lights; glossy lumpy scoops with drips,
sprinkles and a cherry that hops to the top; a scooper whose face tells you
how worried you should be; INCOMING rushes, big scoops, mini triplets, hearts,
a clean-landing multiplier, a spirit level in the HUD, and two leaderboards.

## Files

| File            | What it is                                                                                   |
| --------------- | -------------------------------------------------------------------------------------------- |
| `plethora.json` | Manifest — `plethora-bit@2`, full screen, `three@0.164.1`, `motion`, two records, tuning.    |
| `main.js`       | Entry source defining `window.plethoraBit`. The whole parlour is built from primitives here. |

## How it plays

- **Tilt.** The phone is the controller. Motion starts from the Play press
  (a user gesture, which iOS needs for its permission prompt) and the control
  is levelled right there, so however you hold the phone, still means stand
  still. The cone stands where the tilt says: the full walking range (±0.72 m
  sideways, ±0.45 m in depth) at the control's max angle of 22°, so a steady
  hand is a standing cone and a flick is a shove. *Re-level* happens again on
  Resume. Which way is forward on the tilt's depth axis is a creator knob
  (*tilt_forward*, default *away*: tipping the top of the phone away walks
  the cone away from you) with a player flip on the pause card, because the
  SDK does not say which sign `tiltControl.y` gives for that.
- **Touch** is the fallback (and the default where `capabilities.motion` is
  false): a drag moves the cone by what the finger moves at the cone's depth,
  sideways, and up or down the screen for depth. Arrow keys and WASD work in
  the web player. A chip on the title and the pause card switches.
- **Scoops.** The arms aim at the tower's top with an error that grows with
  height (and more in a rush); a ring the size of the catch zone sits on the
  top, a beam runs from the hand to it, and both turn green, amber or red for
  how far the hand is from the zone right now, which is the thing to steer
  by. The scoop drops; a landing inside the zone counts and sits where it
  landed, which shifts the centre of mass for good and shoves the tower. A
  scoop the tower is not under glances off, splats on the tiles and costs a
  heart. Three hearts.
- **Kinds.** Regular (100 points), big (150, heavier, from scoop 5), mini
  (60, in quick triplets, from scoop 8).
- **Clean landings** — near the centre while the tower is nearly upright —
  build a multiplier up to ×8; a wobbly one resets it.
- **INCOMING.** Every eight scoops (a knob) the machine's lights go red and
  it warns for 1.3 s, then fires four to eight scoops half a second apart from
  alternating arms, with more aim error, for double points. Then a breather.
- **Milestones** every ten scoops: a bonus of 50 × scoops, confetti, a cheer.
- **The level.** A bubble in the HUD drifts the way the tower leans — right
  is right, down is toward you — and turns amber then red near the limit, so
  the depth lean, which is hard to see head-on, is never a mystery.
- **It ends** when the tower topples (the centre of mass passes the edge of
  the cone's support) or the hearts run out. The result card shows scoops,
  points, your bests, the top three on the score board and your rank, and
  replays immediately — the board is fetched after, never awaited.
- **Records:** `score` (Best Score) and `tower` (Tallest Tower), both
  `best_per_user`, daily/weekly/all-time, global/following, submitted once at
  the result. A new personal best of five scoops or more posts a Pulse
  completion from the result card.

## The physics

Metres; the floor is y = 0 and the scooper faces the camera. The tower is one
rigid body pivoting at the cone's rim, with a lean in two axes `(thx, thz)`
and a centre of mass `(cx, cy, cz)` in its own frame (cx and cz are the sum
of where each scoop landed, weighted by mass). Per axis:

```
th'' = (G / cy) (th + c / cy)          gravity, and the bias of an off-centre stack
     - K_CUP (1 - grown) th            the cone's cup springs a short stack upright
     - (a / cy) grown                  the cone's own horizontal acceleration
     - c th'                           viscosity
```

`G` is an effective gravity (1.7 m/s² × the *topple speed* knob × one minus
0.6 × *stickiness*) multiplied by `grown = smoothstep(0.085, 0.39, cy)`, and
the cone's acceleration reaches the stack in the same proportion, so the first
three or four scoops sit in the cup, come along for the ride and spring back
when nudged; the instability fades in over scoops four to six. The lean is one
rotation, by `hypot(thx, thz)` about the horizontal axis that takes up toward
the lean, and it topples when that passes `atan(SUP / cy)` with `SUP = 0.1 m`:
a tall tower leans slowly but has a tiny window (10° at eight scoops, 4° at
twenty), and from eight scoops on a lean of one degree reaches the limit in
about a second and a half. These are the 2D build's equations with the pixel
constants turned into metres (120 px → 0.39 m), so its playability study
holds: a balancer with a human's 250 ms reaction delay holds about twenty
scoops, and with no delay fifty.

The cone follows its target — the tilt, or the finger — through a stiff
critically damped spring (22 rad/s), and the tower feels the spring's
acceleration, capped at 30 m/s²: a flick of the phone is a bounded shove,
not a teleport. The spring and the jelly wobble are stiff, so the body
physics runs in substeps of 16 ms or less whatever the frame rate.

A lopsided stack has an equilibrium lean, `-atan(c / cy)`, where it needs no
acceleration at all; holding it dead upright instead means accelerating the
cone forever, which is how a player gets walked to the edge. That is a
feature of the real thing too, and the hint for a long run: let it lean a
little.

A landing at offset `(ex, ez)` in the tower's frame adds `e × m / (M × cy) × 3`
per axis to the angular velocity (capped at ±0.5 rad/s), settles at half the
offset as that scoop's permanent displacement, and kicks the jelly wobble:
each scoop carries a damped lateral oscillator (spring 170, damping 7, ±3 cm)
excited by landings and by the cone's acceleration in proportion to its
height, so the stack whips like soft ice cream. The wobble is cosmetic, and it
is most of the feel. Scoops overlap by 18% of their summed radii. A topple
turns the stack into rigid-body debris that bounces twice, leaves a splat
decal and a spray of droplets in its flavour, and rests.

The arms are two-link chains (1.0 m and 0.92 m) on carriages that ride their
pillars so the hand is always 0.7 m above the tower's top; the elbow bends
up and out like a crane from a closed-form two-bone solution, the home pose
stands folded beside the pillar, and the hand hovers above the aim point,
opens, and withdraws. The camera frames feet to tower top inside the
content-safe height (90% fill), fits the walking range to the width, follows
the cone part of the way so a narrow portrait never loses the scooper,
dollies back as the tower grows, and shifts the image by half the difference
of the top and bottom insets (`setViewOffset`) so the framed span is centred
between them, not between the screen edges.

## The look

three.js 0.164.1 from the registry (`ctx.importModule("three", "0.164.1")`,
with the libs URL as a fallback), ACES tone mapping, a 2048² PCF soft shadow
from a warm key light, a cool fill, a hemisphere and a pendant point light,
and a painted equirectangular parlour as the environment map at half
strength so chrome and gloss have something to reflect. Every texture is
painted on an `OffscreenCanvas` with plain drawing calls (tiles, stripes,
wood grain, the chalk menu, the neon sign, the waffle, cookie specks, a
contact-shadow blob) and falls back to flat colours where there is none. The
chalk board and the neon sign are lettered in the title face, so they are
repainted once the fonts arrive.

The scooper is a round-headed soda jerk built from capsules and spheres —
paper hat, striped shirt, apron, bow tie, arms raised with his hands gripping
the cone — whose eyes follow the arm or the tower top, whose brows and mouth
blend between calm, focused, panic, joy and dismay from the lean ratio and
the events, who leans into the cone's acceleration pivoting at his hands so
the cone never leaves them, and whose legs scissor as he walks. Scoops are
icosahedral-looking lumpy spheres (value noise on a sphere) in physical
materials with clearcoat and sheen, optional instanced sprinkles, capsule
drips and a cherry on the top one. Sparkles are additive points, droplets and
confetti instanced meshes, splats decals on the floor. The HUD, cards and
title are a DOM overlay root above the canvas.

## Sound

A small WebAudio synth (permission `audio`) for plops pitched by scoop size,
squishes, the clean-landing chime, the splat, the INCOMING alarm, the
milestone arpeggio, the arm's whir and release and the fall; `ctx.music`
(`backgroundMusic`) for a cozy bed that climbs in tempo and intensity with
the tower, ducks under the alarm, and stings on milestones and the result.
Mute is a chip on the title and the pause card and persists.

## Contract notes

- Built against context `plethora-agent-context-2026-10-22.1`, SDK 1.7.0,
  fetched live at the start of the session per the repo rule.
- `display: "fullscreen"` (required to publish since this context). Insets
  come from `ctx.contentSafeArea ?? ctx.safeArea`, read every frame and on
  `ctx.onResize`; the HUD hangs from the top inset, the hint, the cards and
  the title pad by all four, the camera centres its framing between the top
  and bottom insets, and the parlour runs to every edge underneath. The same
  file plays in the legacy safe frame through the `??`.
- One dependency, `three@0.164.1`, in `dependencies` and loaded through
  `ctx.importModule`. `ctx.createCanvas({ touchAction: "none" })` for WebGL
  plus a passthrough DOM root for the HUD; buttons through
  `ctx.input.activate`.
- `ctx.game.loop` drives update and render; `ctx.game.score` holds the live
  score and tower tracks and submits the two declared records at the result;
  `score.leaderboard` reads the top three.
- Tilt through `ctx.motion.start` + `tiltControl({ maxAngle: 22, deadzone:
  0.05, smoothing: 0.25, calibrate: true })`, started from the Play press,
  `calibrate()` on start and resume, paused with the game, stopped at the
  result; touch is the fallback when motion is absent or denied, and the
  default where `capabilities.motion` is false. Permissions: `audio`,
  `backgroundMusic`, `haptics`, `motion`, `storage`.
- Ten tuning knobs (topple speed, stickiness, placement error, drop interval,
  rush cadence, big and mini chances, sensitivity, tilt forward, music) and a
  difficulty curve over scoop count; `chill` and `frantic` presets. Published
  playback uses the defaults.
- Persistence in `ctx.storage` (bests, plays, control, forward, mute) through
  a fire-and-forget helper, because `set()` returns nothing on device.
- Onboarding is `immersive`: the first run shows a tilting-phone (or finger)
  cue and one follow-up line, then nothing.
- Validator traps avoided by construction: textures on `OffscreenCanvas`,
  never `document.createElement("canvas")`; gradient stops are string
  literals; no layout-box queries, no `ph` local, no ImageData, no bare
  timers.

## Verified

Headless, with the repo harness (`_skills/sekai/harness/run.js`) against the
strict mock `ctx`, whose `ctx.motion.tiltControl` reads a `window.__tilt`
the harness sets. For this build the runner gained a `balance` mode `tilt`
that holds no finger: it reads the bit's own balancer (`debug.drive2`, the
model-based full-state controller from the 2D build, per axis), integrates
it twice in the bit's game time and sets the tilt that puts the cone there
— a hand on a tray, not scripted motion. A `accel2` mode does the same with
a two-axis drag, and a `waitUntil` step waits for game state, because under
the software renderer the WebGL scene runs at about a third of wall time.

- Full screen, 390 × 844, tilt (`caps.motion`): init clean, `ready()` after
  the title, no console or page errors; motion started from the Play press;
  the tilt driver held four clean landings from alternating arms with the
  cone kept at the centre (base offset under a millimetre), the multiplier
  rising, the camera dollying back; a scripted full tilt toppled it, the
  result card showed scoops, points, a new best, the mock's top three with
  the viewer's row and rank, and the records were submitted; play again,
  pause and resume (re-levelled), an inset change mid-run, a resize.
- The same viewport without motion: touch is the default, the finger cue
  shows, the two-axis drag driver landed three clean scoops, a swipe toppled
  it, the result card and the records followed.
- The legacy safe frame (`display: "safe-frame"`, 390 × 778,
  `contentSafeArea` undefined, a 120 px bottom band): title, play, a scoop,
  pause card; the hint and the framing stay above the band.
- A squat 844 × 390 viewport with landscape insets: the whole parlour fits,
  a scoop lands, the pause card scrolls; it plays but it is not the target.
- `check.py` passes; the live index still serves `2026-10-22.1` / SDK 1.7.0
  at upload time.

Not verifiable here: real tilt (the sign of `tiltControl.y`, the feel of the
22° range, calibration on a moving hand), haptics, the music bed, real touch,
frame rate on a phone GPU, and the host's logo button over the real floor.

Uploaded on 2026-10-27 through `agent.plethora.studio` as a revision of the
existing draft: action `updated`, id `7eda9816-178b-468d-ad2d-5a4be1951f9c`,
131,928 bytes, no `notices` in the response, so the three.js dependency, the
full-screen declaration and the source passed the validator. The upload
carried `agentFeedback.contextVersion` 2026-10-22.1, which the uploader
confirmed against the live index first. The first attempt came back as an
HTML error page from the edge rather than JSON; the second, a minute later,
succeeded. It is a draft: not published, not yet played on a phone.
