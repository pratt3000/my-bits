# Crazy Eights

Crazy Eights for two to four people and one phone, built around the handover
rather than around the cards.

Every other card bit in this repo is played with the phone flat on the table
and everything face up. This one is the opposite: a hand is worthless the
moment the person next to you can read it, so the phone is a physical object
that gets passed, and the whole interaction design falls out of that.

## Files

| File | What it is |
| --- | --- |
| `plethora.json` | manifest — `backgroundMusic`, `haptics`, `storage`, one leaderboard, no dependencies |
| `main.js` | the whole bit: deck art, rules, layout, overlay |
| `README.md` | this |

## The cover is a tap, not a hold

`bluffin` reveals its secret screen on press-and-hold, which is the pattern the
privacy problem usually wants: the secret exists only while a finger is on the
glass, and there is no timer to shoulder-surf.

It cannot work here. The screen behind the cover has to be *tapped* — you pick
a card out of a fan, and after an eight you name a suit — so holding the cover
open would take a third hand. So the cover lifts on a tap, and the exposure is
bounded at the other end instead: it closes itself the instant the player
commits, whether that is playing a card, drawing out, or passing. The phone is
never left sitting on somebody's cards waiting for them to notice.

The cover is deliberately *not* opaque. Card counts, the discard, the stock and
the named suit are public information — that is the only reason a hidden-hand
game is playable at all — so the cover is a gradient that is clear over the
table and solid over the fan. Only the hand is secret, and the hand is drawn
face down until the cover lifts. It is still full-bleed and
`pointer-events: auto`, so a peeking tap cannot reach the fan underneath.

## Illegal cards are dimmed, not punished

A hand of seven with two legal cards in it should be a question about which of
the *two* to play, not a memory test about which of the *seven* is allowed. So
the cards you cannot play are darkened and are not hit-testable at all — a
wrong tap is impossible rather than penalised.

The dim is 46% rather than the 60% it started at, because these are your own
cards and you are planning with them: an unplayable king still has to be
readable, it just must not be tappable. The play script asserts this directly —
it taps a dimmed card and checks the pile did not move.

## One gesture for select, preview and commit

Pressing lifts the card under the finger, sliding re-picks whichever card is
now under it, and lifting the finger plays the one that is up. Sliding down off
the bottom of the fan cancels.

Two taps per card (select, then confirm) is the obvious alternative and it is
wrong here: every turn already costs a handover tap, so a confirm step makes a
seven-card hand twenty-one deliberate gestures. Scrubbing gives the preview for
free. The pointer is bound to the fan on `pointerdown` and keeps it for its
whole life, and a fan that already has a live pointer refuses a second — on a
shared phone the player whose turn it is *not* will point at a card, and that
finger must not move somebody else's selection.

## Layout

Everything is a horizontal band. A fan sized to a 390px screen leaves about
seven pixels either side, so a side-mounted control would sit on the outermost
card in the hand — which is the card a right-handed thumb reaches for first.
Top to bottom: round/target header and the three chrome buttons, the opponents'
rail, the table, the prompt band, the fan.

- **The rail** is ordered by whose turn comes next, left to right, so the strip
  doubles as the turn order and the leftmost plaque is always the person the
  phone is about to reach. Each plaque carries a little fan of card backs as
  well as the number, because a count is also a picture of a hand. At one card
  the plaque goes orange and pulses.
- **The deck is the draw button.** There is no "Draw" control; when nothing in
  your hand plays, the stock takes a brass halo and says `TAP TO DRAW`, and you
  tap the thing you are actually drawing from. The only real button on the
  table is the one that appears when you can neither play *nor* draw.
- **The named suit** is a parchment token pinned above the pile. Parchment
  rather than brass because spades and clubs disappear on metal, and
  legibility is the entire job of that token.

## Three bugs worth remembering

**The fan gave you the card next to the one you tapped.** `fanHit` returned the
topmost card whose rectangle contained the point, which is what the *eye* sees
and not what the *hand* means. In a ten-card fan each card shows a thirty-pixel
sliver, so aiming at the middle of a card lands inside its right-hand
neighbour — and if that neighbour is illegal, the tap does nothing at all. A
player would have watched their hand refuse to respond to the card they were
plainly pointing at. It cost the play script eleven minutes of spinning first,
which is the only reason it was found.

The scan now runs topmost-first over the *legal* cards only. Illegal cards are
dimmed and unusable anyway, so they cannot shadow a playable card out from
under a finger: put a thumb across a bright card and a dim one and the bright
one is what lifts. The play script's assertion changed with it — the honest
claim is not "tapping a dimmed card does nothing" but "a dimmed card can never
reach the pile" — and the loop grew a stall guard so the next version of this
bug fails in five turns instead of eleven minutes.

**The discard pile wore a black hole.** Every card drew its own shadow, and
five discards landing within a dozen pixels of each other stacked five of them
into a dark rounded slab around the pile that read as a UI panel. One shadow is
now laid down for the whole pile, thrown by the card on top of it, and the fan
does the same with thinned shadows — only the lifted card, which is genuinely
off the table, throws a full one.

**The result panels hung off both edges of the screen.** Chrome's UA sheet
gives `<button>` `box-sizing: border-box` and `<div>` `content-box`, so a panel
with `width: 100%` and 22px of padding came out 44px wider than the column it
sits in — while the buttons underneath it lined up perfectly, which is what
made it look like a centring bug rather than a sizing one. `box-sizing` is now
explicit on every padded block.

A fourth, smaller one: the prompt band used to be drawn in every phase, and the
cover, the suit sheet and the result panel all sit on translucent grounds — so
a faint "ROSE · 1 card plays" printed itself through all three. It is now drawn
only while somebody is actually looking at their hand.

## Rules, and the one house ruling

Standard: seven cards each (five with four players), match the discard by rank
or suit, any eight is wild and names the suit that follows. If you cannot play
you draw until you can — a settings toggle makes that one card and pass
instead. If the stock runs dry the discard is shuffled back in, all but the top
card, so the game cannot deadlock while cards exist. If every player passes in
a row the round is blocked and nobody goes out.

The house ruling: **if the turn-up is an eight, the suit it shows stands.** The
alternative is the dealer naming a suit before anybody has looked at a hand,
which on a passed phone means one more handover before the game has started.

Scoring is penalties. The round winner takes nothing; everybody else scores
what they are still holding — 50 for an eight, 10 for a court, face value
otherwise, ace one. When somebody crosses the target the **lowest** score wins,
which is stated on the header, in the prompt, on every score panel and in the
rules card, because it is the one thing about this game that a new table
reliably gets backwards.

## Leaderboard

**Closest Round** — how few cards the losers were left holding when somebody
went out, ascending. It is a property of the *round*, not of one of the people
sharing the phone: an exact finish where everybody else was down to one card is
a better hand of cards than a blowout, and that is the thing worth putting on a
global board. A blocked round never produced a finish, so it never submits.

## Sound and settings

A `cozy` bed unlocked inside the Deal tap, a sting on every card played, drawn,
wild-carded and won, `duck()` before the round result, haptics on selection and
on contact, and a mute toggle persisted through `ctx.storage` along with the
player count, the target and the draw rule. All of it wrapped in try/catch —
audio is a nicety and must never be able to break a hand of cards.

Settings also carry **Leave this game**, because somebody has to be able to
walk away from a half-played hand without closing the bit.

## Verifying

```
node tools/harness/validate.mjs crazy-eights
node tools/harness/play-crazy-eights.mjs
```

The play script drives a genuine two-handed game to a named winner — lifting
the cover every turn the way a person does, never peeking at a hand it has not
revealed — then walks out through **Leave this game** and deals a four-handed
one, to prove the rail holds three opponents and that a four-player deal is
five cards. Along the way it checks the legal set against the rule card by
card, that a dimmed card can never reach the pile, and that with an eight live
nothing but the named suit (or another eight) is playable.

It polls the bit's `busy` flag rather than sleeping: a play commits its state
instantly and *then* animates, so a script that waits on the *state* taps into
a moving card and the input is silently dropped. It also plays like a person —
keeping the suit it holds most of and saving its eights — because naive
first-legal play drags a two-handed round past a hundred turns without either
hand shrinking. `EIGHTS_TRACE=1` prints the whole game state turn by turn.
