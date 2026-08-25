# Ratscrew

Egyptian Ratscrew for two to four people around one phone. The phone lies flat
in the middle of the table, everybody takes the pad on the edge nearest them,
and the whole game is one question asked over and over: **whose hand got there
first?**

## Files

| File | What it is |
| --- | --- |
| `plethora.json` | manifest — `backgroundMusic`, `haptics`, `storage`, no dependencies, one leaderboard |
| `main.js` | the whole bit: rules, 52-card renderer, table, overlay |
| `README.md` | this |

## Why it is a pad each, and not a pile in the middle

At a real table everybody slaps the same pile. On a 390-pixel screen that is not
available. Four hands cannot share a two-inch target, and if they could, the
person sitting closest to it would win every race — which quietly destroys the
one thing Egyptian Ratscrew is about.

So each player gets their own pad on their own edge, all the same size and all
the same distance from their owner. "First finger down" then means what it says.
The pad doubles as that player's face-down stack: tap it on your turn to throw a
card into the middle, tap it any time to slap.

That double duty creates exactly one ambiguity, and it is resolved by one rule:

> **A live slap always outranks your own flip.**

Which is what a human does at a real table — nobody turns a card over while a
double is sitting there. The pad says `FLIP` when it is your turn and `SLAP`
when the middle is live, so it is never a guess. The consequence is that a
double cannot be *missed*, only lost; the pile does not move on until somebody
takes it.

## How a dead heat is settled

Inside the `pointerdown` handler, synchronously, and nowhere else.

Several hands landing in the same frame arrive as several `pointerdown` events
in delivery order. The first one to reach `winSlap` while `slapNow` is set
clears it *before the second handler runs*, so there is exactly one winner and
no tie to break. Nothing is deferred to a frame or a timeout, because a frame
boundary would collapse four distinct arrivals into one and hand the game a tie
it cannot resolve.

Everyone who lands after that, inside an 800 ms grace, is logged `late` and pays
nothing. Being second is not a foul.

`tools/harness/play-ratscrew.mjs` proves it: `bit.tapTogether([...])` sends both
touch points in a single CDP `touchStart`, and the run asserts exactly one
`slap` claim, at least one `late`, that the winner banked the entire pile, and
that the loser's stack and lockout were untouched.

## The rules, and where they differ from the kitchen table

* Face cards and aces are tribute: **4** chances for an ace, **3** for a king,
  **2** for a queen, **1** for a jack. A face card thrown during payment flips
  the debt back and the payer becomes the creditor.
* An unpaid tribute is swept up **after a 900 ms beat**, not instantly — the
  countdown runs backwards round the ring in the creditor's own colour. If the
  last card of a failed payment happened to make a double, that beat is your
  window to steal it. Slaps beat collection, as they should.
* Slap conditions: **DOUBLE** (top two the same rank), **SANDWICH** (top and
  third), and **TENS** (two number cards adding to ten) which is a settings
  toggle, because half the houses that play this game do not use it.
* A wrong slap **burns** a card, face down, to the *bottom* of the pile — where
  it cannot shield the card the next flip has to match against. On top it would
  turn a penalty into armour.
* Running out of cards is not immediately fatal. You stay in until the pile is
  next claimed by somebody else, so you can slap your way back in. That is the
  real rule, and it is what keeps a player who just threw their last card alive
  for one more heartbeat. Burn while empty and you are out for good — you had
  nothing left to pay with.

Two things exist only because this is a phone:

* **A 0.85 s lockout after a burn.** At a real table, mashing the pile is
  punished by your own arm and by running out of cards. On a screen, mashing is
  free and it wins every race. The lockout is the phone-specific correction.
* **A 0.24 s gap between flips.** Without it a fast tapper empties their stack
  before anybody else has seen a card. Your own second tap inside that gap is
  read as an eager double-tap and costs nothing; somebody *else's* tap in the
  same gap is a slap at nothing and burns, which is correct.

## The look

Deep baize under one warm bulb, walnut rail, copper inlay. All 52 faces, the
back, the felt weave and the whole table are canvas paths baked into
`OffscreenCanvas` at boot and blitted — there are no packaged assets
(`maxAssets` is 0), and every bake site falls back to drawing live on a WebView
without `OffscreenCanvas`.

Gold and red are kept strictly apart because they mean opposite things and both
arrive as a full-screen flash: **gold is a good slap, red is a burn.** Sharing a
hue would mean nobody could tell at a glance whether they had just won the pile
or paid for it.

Four things learned by looking at the render rather than the code:

* **A shadow per card built a grey slab.** Six cards landing within twenty
  pixels of each other stacked six baked shadows into something opaque that read
  as a seventh card under the pile. There is now one shadow for the whole heap,
  and only the top card throws its own.
* **The scatter was too tight.** At six pixels of jitter the pile was one card
  with edges. At twenty you can see the corner index of what is underneath,
  which is the only way a sandwich is legible at all.
* **The shout was drawn under the blow-out.** The one frame that names the
  winner was the one frame washed white. The banner now goes on last, above the
  flash.
* **The turn arrow pointed at an empty side of the table.** It was rotated by
  the negative of the seat angle, which sent the left player's chevron to the
  right-hand edge of the ring.

The cards that actually make the slap are ringed in gold while the window is
open. That is how somebody learns the sandwich rule without opening the panel.

## Layout

Nothing goes in the side margins. The board is as wide as the screen allows, so
the chrome sits in the top-right corner, and **both** end pads are shortened by
the same amount — screen-right for the bottom player, screen-left for the top
one, who is sitting rotated a half turn. The layout is therefore symmetric under
the seat rotation and the buttons cost one player nothing the other does not
also pay.

Every pad's contents are rotated to its own seat, so nobody reads their own card
count upside down.

## Leaderboard

**Fastest Slap** — the quickest correct hand that came down on this table,
in milliseconds. It is a property of the *match*, not of one of the people
sharing the phone, which is what a couch game should be putting on a global
board. Anything under 90 ms is treated as a mid-air mash: it still wins the
pile, because it was first, but it does not set a record.

The reaction clock starts when the thrown card becomes *legible* — 105 ms into
the 195 ms turn-over — not when it was committed, so the number on the board is
a reaction to something a human could actually see.

## Settings

Players (2–4), six cards each or the whole deck, the tens rule on or off, and
mute. All persisted with `ctx.storage`. A full-screen panel stops the game clock
while it is up and gives the time back on close, so an open slap window never
bills somebody for their reading time.

## No pass-the-phone gate

There is no hidden information in this game — every stack is face down and
nobody, including its owner, ever looks at it. The privacy cover the
hidden-hand bits need would be a screen with nothing to hide.

## Verified

```
node tools/harness/validate.mjs ratscrew     # clean
node tools/harness/play-ratscrew.mjs         # a real 3-player game to a real winner
```

The play script deals three players with tens on, proves the simultaneous slap
resolves to exactly one winner, proves a wrong slap costs a card and locks the
pad, waits for a real tribute, plays the game out to a single survivor, and then
deals a rematch from the end screen — asserting all 18 cards are still accounted
for at the finish.
