# Forehead

Hold the phone sideways against your forehead and let the room shout at you.

You cannot see the word. Everyone else can. Tilt down when you get it, tilt up
to skip — or just tap: the right half is a hit, the left half a pass.

Five decks of fifty cards: At the Movies, Animals, Act It Out, Food & Drink,
Around the World, Around the House. Thirty, sixty or ninety second rounds.

## The word is drawn sideways, and it fills the screen

The phone is held *sideways* on a forehead, so the word is rotated a quarter
turn. A portrait word on a sideways phone is unreadable across a room, which is
the entire point of the game.

Sizing it took two passes. Rotated, the word's **length** is bounded by the
screen height and its **cap height** by the screen width, so both bounds have to
be solved and the smaller taken. A fixed size leaves a five-letter word floating
in the middle of a phone that somebody is trying to read from the far side of a
kitchen.

## The tilt is calibrated, not assumed

Reading a fixed device axis breaks the moment somebody holds the phone the
other way up — and in a room of six people, half of them will. So the gravity
vector is captured once, at the instant the player says "I'm holding it",
whatever *on my forehead* happens to mean for them. Every later reading is the
angle away from that, and which way is "down" is simply which way it was
pointing when play began.

A gesture fires once. The phone has to come back near level before it will
register again, so one long tilt is one answer rather than a stream of them.

Motion is requested from that gesture, never at boot. **The tap controls are on
screen either way** — they are the game, not a consolation for a refused
permission.

## Two bugs the harness caught

- **The clocks ran long on a slow device.** `dt` is clamped so a stall cannot
  jump the game, but an accumulated clock inherits that clamp, and a
  sixty-second round would quietly become ninety on a struggling phone. Both
  the countdown and the round clock are anchored to real timestamps now.
- **A left-half tap registered as a hit.** `offsetX` is measured against
  `e.target`, and once the word grew to fill the screen it started catching
  taps as a child of the stage — so the half was measured against the *word's*
  box. Every child on the play screen is `pointer-events: none` now, which makes
  the stage the only possible target.

`tools/harness/play-forehead.mjs` plays a full round with taps (headless has no
accelerometer, so this also exercises the fallback path) and asserts the exact
hit/pass pattern it scripted.

## Sound

A pulse bed that **speeds up over the last ten seconds**, so the room hears the
clock running out without anybody having to look at it. Coin on a hit, fail on
a skip, and a full-screen colour flash on both — green or red — so the verdict
is visible from wherever people are standing.

## Leaderboard

**Cards In One Round** — how many the room got through in a single round. A
property of the round, not of whoever happened to be holding the phone.
