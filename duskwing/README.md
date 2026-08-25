# Duskwing

Two to four people, one phone, one burning cave. Everybody takes a horizontal
band of the screen. **Hold your band and your creature beats its wings; let go
and it falls.** That is the only control there is or will ever be.

The world slides past from right to left forever, saw blades and crushers and
rotors come with it, and the last wing still flying takes the round.

## Files

| File | What it is |
| --- | --- |
| `plethora.json` | manifest — no dependencies, `backgroundMusic`, `haptics`, `storage`, one leaderboard |
| `main.js` | the whole bit; canvas 2D, no three.js |

## Why a band per player, and why the band is the button

A side-scroller has a **direction of travel**, so unlike a board game it cannot
be rotated to face a seat: turning a player's half upside down would make their
world scroll the wrong way. The usual local-multiplayer answer — give each
player a corner and rotate their chrome — is unavailable here.

So the screen is sliced into N full-width horizontal strips, and each strip is
simultaneously one player's tunnel *and* one player's control. A finger
anywhere inside your strip flies your creature. That is the only scheme that
survives four hands arriving on a 390px phone at the same instant: no player
has to find a small target, nobody has to reach across anyone, and everybody
reads the screen the same way up because everybody is sitting on the same side
of it. The instructions say so in the first line.

Every pointer is bound to the band it landed in for its whole life (a `Map`
keyed by `pointerId`), and a band that already has a live finger ignores extra
ones. Without both of those, a hand that strays across a divider starts flying
somebody else's creature, and a player with two fingers down owns two bands.

## Why the left edge is both the wall and the pad

In the game this descends from, falling behind the advancing edge kills you.
Here that edge is a black column down the left of every band, glowing in its
owner's colour. It is the lethal boundary **and** the natural place for a
thumb to rest.

That is not decoration, it is the fix for finger occlusion. Hazards arrive from
the right, so the one place a hand must never sit is the right of the screen —
and putting the pad's visual anchor on the far left keeps four hands parked on
the side the cave has already passed.

The coupling that makes the game a game: **flapping carries you forward, and
falling lets the cave reel you back into that edge.** The numbers are tuned
around one figure — 0.56, the fraction of the time on the pad that exactly
holds altitude. Holding *position* costs more than that, so hovering
defensively bleeds ground and the only way to bank distance is to climb hard
and then dive back through the gap you were aiming for anyway. The backward
pull scales with the scroll speed, because it *is* the cave advancing, so an
endless flight ramps through the wall rather than only through hazard density.
Even flown well, no flight lasts forever. The only question is how long you
held it off — which is exactly what a distance record should be measuring.

## Why every band flies its own cave

The obvious design is one shared course: strictly fair, the same blade for
everyone. It also stacks four identical saw blades in a vertical column down
the screen, which reads instantly as copy-paste and destroys the picture.

Each band therefore gets its own course from the same generator with the same
parameters and a large phase offset into the terrain waves. That is fair the
way a shuffled deck is fair — same blades, same odds, different order — and it
looks like four different tunnels bored through the same rock.

## The art is the whole point, so the rules about it are absolute

Everything in the play layer is `#000000` with no interior detail: the
creatures, the rock, the blades, the rotors, the spikes. All information comes
from the shape read against a lit sky. All the colour lives *behind* the
silhouettes — an amber-to-teal gradient, three bloom centres, drifting fog, a
fan of god-rays, three parallax forest layers and a field of dust motes — or in
the **two eyes of each creature**, which is the only thing distinguishing four
identical black moths. Nothing in the foreground is ever tinted, because
tinting it would destroy the one thing that makes the picture work. Ownership is
carried instead by the eyes, by the glow on that player's wall, and by the huge
ghosted distance numeral sitting in that player's own patch of sky.

Two details from the reference that turned out to matter more than they sound:

- **The sky gradient runs diagonally, not vertically.** A vertical gradient
  gives each horizontal band a single flat colour. Running it corner to corner
  means every band has light travelling across it as well as down the screen.
- **Every hazard has a bloom placed behind it.** Pure black on a dark palette
  vanishes on a dim screen in a bright room, and a blade you cannot see is not
  a hazard, it is a bug.

There is no `ctx.filter = blur()` anywhere — it is rejected at upload, and it
is not needed. Stacked low-alpha radial gradients *are* the blur.

## What a fresh pass on the picture changed

Everything below was legible in the one state it was first checked in and
broke in another, which is the failure mode of a screen that is four screens
at once.

- **The title copy had no plate.** The scrim behind it sat at 30% through the
  middle, which reads fine at two players — the middle of the screen there is
  black rock — and falls apart at three and four, where the same copy lands on
  a lit sky, a moth flies through the wordmark and the caption lines vanish
  over a bloom. The scrim is now opaque where the words are, with two clear
  windows above and below that still show the attract flight.
- **The wordmark could not reflow.** One unbreakable word in a condensed face
  at a fixed 50px ran the full width of a 390pt phone and was clipped at both
  ends on a 320pt one. It is sized off the real width now, and re-fitted on
  rotate.
- **The countdown sat on a divider.** A single numeral in the middle of the
  screen lands exactly on a band boundary for every even crew size — the one
  place on this screen nothing may sit — and it belongs to nobody. There is
  now one numeral per band, in that band's colour, so the three seconds before
  take-off are also where each player learns which colour is theirs.
- **The claim labels were unreadable in half the bands.** Every band has a
  different sky under the same line of type: magenta over a white bloom and
  cyan over black rock both disappear. Each one carries a feathered dark plate
  now — stacked alpha, the same trick as the glows, no blur.
- **The distance numeral vanished over a bloom.** It is the only running
  feedback a player gets on their own flight, and at one flat alpha it was
  bold in one band and gone in the next. A black underlay carries it: invisible
  against dark rock, an edge against a hot bloom.
- **The results card had the dead bands showing through it.** Four `OUT ·
  CRUSHED` labels ghosting up through the panel collided with the rows being
  read, and every one of those causes is already listed in the panel. They are
  suppressed for the duration of the card. `LEFT BEHIND` was also wrapping to
  two lines and knocking that row out of the column.

## Four things learned the hard way

Each of these was invisible until real input was scripted against the running
bit.

- **The first flight model was unplayable.** A flap bought about 58ms of
  headroom before the ceiling, which no human reacts to. Gravity, the impulse
  and both velocity clamps were rescaled so a full climb or a free fall crosses
  the free span in about 0.65s.
- **Creatures hatched at the middle of the band, not the middle of their
  tunnel** — and dropped straight into the rock wherever the cave happened to
  be meandering.
- **Every glow switched the composite mode.** Twenty-five
  `globalCompositeOperation` changes a frame, each flushing whatever the
  renderer had batched. Glows are now grouped into one pass per band, and the
  whole backdrop is composited at CSS resolution and upscaled in a single blit.
  `multiply` on the eliminated bands became a plain black fill: over an already
  dark palette the two are indistinguishable, and `multiply` is one of the few
  blend modes that costs an extra pass.
- **Grain and vignette were two full-screen passes** doing the work of one.
  They are baked together at boot and cost a single `drawImage`.

The canvas also renders at 1.5x rather than the full device ratio. This bit is
fill-rate bound, nothing in the play layer has a hard edge that a finer pixel
grid would flatter, and the only crisp type on screen is DOM.

## Verifying it

`tools/harness/play-duskwing.mjs` flies two complete four-player rounds through
the real UI and asserts fifteen things, including the one that matters:

```
ok  all four bands hold their own finger
ok  the two released bands fall away under gravity
ok  the two still-held bands keep beating
ok  each finger stayed bound to the band it landed in
ok  round reached a real end state
ok  FLY AGAIN starts a fresh flight
ok  the dark edge on the left claims at least one creature
```

The four-finger test is written as a *change* in vertical speed, not its sign:
a flap is a discrete impulse at 9.5Hz, so a creature that is very much climbing
still reads as falling between beats. Lift two of four fingers, and a third of
a second later the two released bands must be accelerating downward under
gravity alone while the two still held are not.

Every timing assertion waits on the bit's own simulated clock rather than on
wall time. Headless renders through SwiftShader an order of magnitude behind a
phone, and CDP polling starves the frame loop further, so a plain sleep
measures the harness instead of the game.

## Leaderboard

**Furthest Flight** — how far this cave let *this group of people* get. It is a
property of the flight, not of whichever of the four happened to hold on
longest, which is what a game played on one shared phone should be putting on a
global board.

## Settings

Two, three or four players. Three caves — gentle, normal, brutal, which move
the scroll speed, how fast it ramps, and hazard density together. Mute. All
persisted with `ctx.storage`, along with the best flight ever logged on this
phone.
