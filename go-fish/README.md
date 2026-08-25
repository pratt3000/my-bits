# Go Fish

Go Fish for two to four people and one phone, played in bright deep water.

## Files

| File | What it is |
| --- | --- |
| `plethora.json` | manifest — `backgroundMusic`, `haptics`, `storage`, one leaderboard |
| `main.js` | the whole bit: deck, water, rules, screens |
| `../tools/harness/play-go-fish.mjs` | plays a full three-handed game through the real UI and asserts the rules |

## What the game actually is

Go Fish is not a game about the cards in your hand. It is a game about what
everybody overheard. Sunny asked Minnow for kings two turns ago and did not get
them, so Sunny has at least one king and Minnow has none — and if you are
holding a king, you now know exactly who to ask. The hand is bookkeeping; the
table talk is the game.

At a real table that information is free, because people say it out loud. On
one phone it is not free at all, and getting it back is the whole design
problem. Three of the four decisions below exist to solve it.

## The ask rule is enforced by construction

**You may only ask for a rank you are already holding.** This is the rule
casual play gets wrong every single time, and it is the rule that makes the
game work: without it you could fish for information at no cost, and nobody
would ever learn anything about anybody.

Rather than accept an illegal ask and then scold, the ask screen simply *is*
your hand. The tappable things on it are the rank groups you are holding, one
card per rank with the extras peeking out behind, so an illegal ask cannot be
expressed. There is no error state because there is no error to make.

The same goes for the target: only players who still have cards are offered,
because asking an empty-handed player is not a move. Two-handed there is
exactly one player you could possibly ask, so the bit picks them for you — a
chip that is the only chip is a tax, not a decision.

## Every ask is read out loud, twice

When you commit, the phone leaves your hand and becomes a public board:
**SNAPPER ASKS SUNNY FOR SEVENS**, with a rank plate the size of a playing card
and the word spelled out underneath. Then the answer gets its own beat — the
count handed over, or **GO FISH!** at sixty-six points with two fish swimming
past it.

That board prints the same sentence a second time **upside down, above it**. A
phone laid flat in the middle of a table has two long edges, and the player on
the far one is the person the information matters most to. Nothing about Go
Fish works if that beat is missable, so it is a screen of its own rather than a
toast, it holds until it is read, and a tap anywhere moves it on for a table
that reads faster than the default.

The cover screen then hands the last three asks back to whoever is picking the
phone up, under **WHAT THE TABLE HEARD** — they were not looking at the screen
when it happened, and at a real table they would have been.

## The cover is a tap, not a hold

Hold-to-look is the usual privacy pattern and it is wrong here. The screen
behind the cover has to be *tapped* — a rank, a player, then the ask — so
holding the cover open would take a third hand. (This is the same trap
`bluffin` documents: the moment the hidden screen is interactive, hold-to-look
stops being a pattern and becomes a hardware problem.)

Exposure is bounded by the player's own commit instead. The cover lifts on a
tap and closes itself the instant the ask is sent, so the phone is never left
sitting on somebody's cards waiting for them to notice. Nothing secret is
*drawn* while the cover is up — the hand is not painted in that phase at all,
so there is no layer to see through.

## State commits, then animates

Every beat makes its state change on entry and the flight is decoration over
the top. Cards leave the giver's hand the moment the beat opens; the arc across
the screen is a picture of something that already happened. That means a tap
that skips the animation can never desynchronise the game from the board, and
the harness can poll a `busy` flag instead of guessing at a sleep.

## The look

Deep water, lit from above: a bright aqua ceiling falling through teal to a
near-black floor, with sand and coral as the only warm notes. The water is
baked once — gradient, god rays, reef, sea fans, sand and grain — and blitted;
the fish, the bubbles, the swaying weed and a couple of drifting light shafts
are painted live over the top.

The four players are fish rather than colours. "Pass it to Sunny" is a sentence
a six-year-old can act on, and each fish is drawn from the same path used for
the card back medallion and the go-fish beat, in a colour picked to survive
being laid on blue at any depth.

All 52 faces are canvas paths — there are no packaged assets — baked once at
device scale and blitted. The card back is a fish-scale pattern (overlapping
arcs in rows, which is exactly how a scale pattern is built) under a foam frame
with one fish in a medallion, in three colourways.

A book lands with the whole screen: four cards leave the hand, spread into a
fan in mid-water, turn face up together and slam down with a shockwave, a burst
of bubbles, a screen shake and a heavy haptic. It is the only thing in Go Fish
worth celebrating, so it is the only animation that gets the whole screen.

## Five bugs worth remembering

All five were invisible until real input was scripted against the running bit.

- **A pre-selected chip you could switch off.** With one opponent left there is
  no choice to make, so the bit picks them for you — and the target chip was a
  toggle, so a tap turned that selection *off*. The player is then looking at
  an unpicked chip, a dead ask button, and nobody else to choose instead. It is
  reachable two-handed on turn one and three-handed the moment somebody runs
  out of cards, and it locks the game up completely. Both pickers set rather
  than toggle now: the ask is a separate explicit button, so there was never
  anything to cancel. The play script asserts that two taps on the two pickers
  leave an ask actually armed, so this class of bug fails loudly rather than
  hanging.
- **The one-live-pointer latch could never open again.** Binding a pointer on
  `pointerdown` and releasing it on `pointerup` is the documented pattern for
  simultaneous play, and in a turn-based bit it is a trap: a `pointerup` can go
  missing — the OS takes the touch for a system gesture, the app is
  backgrounded mid-tap, a capture is lost without a cancel — and the latch
  stays shut forever. The bit then renders and animates perfectly while
  ignoring every tap, with nothing the player can do about it. There is no
  second finger to bind here, only a second finger to *ignore*, so it is a
  140ms window now: two contacts inside it are one person's stray second touch
  or a double tap, and anything later is always accepted. A window cannot get
  stuck.
- **"Go again" routed straight back to the cover.** Winning an exchange sends
  you round again — but the four cards that completed a book may have been your
  entire hand, and if the ocean is dry there is nothing to draw. That put a
  player on the ask screen with no ranks and no targets. It routes through
  `beginTurn()` now, which draws, or passes, or ends the game.
- **The play script deadlocked itself.** Once the ocean is empty, a script that
  always asks for its first rank and always asks the same player trades misses
  forever, because neither side ever varies. Rotating both choices per turn
  fixes it — and it is a real property of the game, not just of the test:
  progress after the ocean runs out depends on players changing their minds.
- **The god rays cost eighty milliseconds a frame.** Five full-height wedges
  under a `lighter` composite is more expensive than everything else on the
  screen put together on a software rasteriser. They are baked into the water
  now, with two narrow live ones carrying the drift — which is the only part of
  a god ray the eye actually tracks. The wordmark is baked for the same reason:
  two outline passes of 78px text with round joins is not a per-frame cost.

## Leaderboard

**Most Books in a Game** — the biggest haul any one player landed in this game.
It is a property of the match rather than of one of the people sharing the
phone, which is what a couch game should be putting on a global board. Thirteen
is a perfect sweep; six is a good night.

## Settings

Sound, player count, **pace of the table** (how long each public beat holds —
Calm for a table reading out loud, Snappy for people who know the game), and
three card backs. All persisted with `ctx.storage`.

## Contract notes

Packaged assets are disabled (`maxAssets: 0`), so every pip, court, fish,
bubble and frond is a canvas path. Offscreen surfaces are `new OffscreenCanvas`
with a live-drawing fallback for WebViews that have none. The whole game UI is
canvas with immediate-mode hit zones; the overlay is one markup string on
`ctx.createRoot()` carrying only the chrome and the two sheets, and the root is
`pointer-events: none` because it is created after the canvas and would
otherwise swallow every tap. Pointer maths uses `offsetX`/`offsetY`, and every
soft edge is stacked translucent fills rather than a canvas blur filter.

Two variables — the seat count and the baked surfaces — are declared above the
functions that fill them in, because `layout()` and `bakeWater()` both run at
boot and a `let` further down the file is still in its dead zone at that point.

## Verifying

```
node tools/harness/validate.mjs go-fish
node tools/harness/play-go-fish.mjs
```

The play script deals a real three-handed game and plays it to the last card
through the canvas hit zones the bit registers for itself — nothing reaches
into the state to move a card. It asserts that every rank asked for was in the
asker's own hand, that every offered target had cards, that
`ocean + hands + books × 4` is 52 at every single step, that a hit keeps the
turn and a miss passes it, that no rank books twice, and that the game reaches
a real end state with the ocean dry and the hands gone.
