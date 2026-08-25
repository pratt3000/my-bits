# Rummy

Gin Rummy for exactly two people and one phone, passed back and forth.

## Why two, and why that is the point

Two is not a concession here, it is what makes the game fit a phone at all.

A melding hand has to be readable as *structure* — these three are a run, those
three are a set, and the rest is what you are carrying — and structure costs
screen. Ten cards laid out as groups, with the loose ones fanned underneath and
a running deadwood total, fills most of a 390-point-wide display on its own.
Three hands of that would not fit, and shrinking them until they did would take
away the one thing the layout exists to show.

Gin Rummy is a two-hander by definition. So there is exactly one hand on the
screen at any moment and it gets the whole table.

## Files

| File | What it is |
| --- | --- |
| `plethora.json` | manifest — `backgroundMusic`, `haptics`, `storage`, one leaderboard |
| `main.js` | the whole bit; the rules engine sits between `RULES START` / `RULES END` markers |

## The interesting problem is reading the hand, not dealing it

A card can be in a set or in a run, but never both. That one restriction turns
"what is my deadwood" from a scan into a small optimisation problem, and it is
the reason the bit does the reading for you: a player who has to work it out by
hand is playing a different, worse game.

**Greedy is wrong, and it is wrong on ordinary hands.** The standard trap:

```
8♠ 9♠ 10♠   10♥ 10♦ 10♣   K♥ Q♦ 3♣ 2♣
```

Four tens is the fattest meld on the table. Take it and the eight and nine of
spades are stranded, and the hand carries 42. Take the *run* instead and the ten
of spades leaves the quad — but three tens is still a legal set, so all six
cards meld and the hand carries 25. Sets-before-runs gets it wrong. Biggest-meld
-first gets it wrong. Longest-run-first gets the mirror image wrong:

```
5♠ 6♠ 7♠ 8♠   8♥ 8♦   K♣
```

Here the run of four is the fattest meld, and splitting it into 5-6-7 completes
three eights and melds one more card.

So the bit solves it exactly. It enumerates every candidate meld — including all
four three-card subsets of a quad, and every contiguous stretch of three or more
in a suit, not just the maximal one — and then searches over which of them to
actually use. The search always branches on the lowest card not yet spoken for,
which makes the state exactly "the set of unassigned cards" and lets a memo on
that bitmask collapse the whole thing. Eleven cards is 2048 states.

`tools/harness/rules-rummy.mjs` lifts that engine straight out of `main.js`
between its markers, so the test runs the shipped code rather than a copy that
can drift. It covers both traps above, ace-low runs (`Q-K-A` is not a run,
`A-2-3` is), the lay-off cascade, every branch of the settlement, and then fuzzes
4000 random hands against an independent brute force over every subset of the
candidate melds. All 55 checks pass.

## The hidden hand, and the one screen that does not need a cover

Every turn is gated by a full-bleed cover naming who should be holding the
phone. It opens on a **tap**, not a press-and-hold: the screen behind it has to
be tapped a dozen times to draw and throw, so holding the cover open would take
a third hand. Exposure is bounded by the player's own commit instead — throwing
a card puts the cover straight back — so the phone is never left sitting on
somebody's hand.

**Nothing is rotated to a seat.** The phone physically changes hands here, so
both players hold it the same way up; a 180° flip would hand one of them an
upside-down screen. That is the opposite of the right answer for a game played
flat on a table, and the difference is simply whether the device moves.

A phone delivers at most five simultaneous touches, and the sixth contact is
simply never delivered. That caps any design needing a held finger per player —
but Gin Rummy takes turns, one finger at a time, so the limit never comes near
it. Taking turns is not a consolation prize on a shared screen; it is the thing
that makes the hardware irrelevant.

**After a knock there is no cover at all.** Both hands go face up, the defender
lays off onto the knocker's melds, and the whole settlement plays out on one
screen. A privacy gate there would be theatre — there is nothing left to hide.

## Five bugs that only scripted input found

- **The action buttons were dead.** `ctx.createRoot()` returns an element that
  fills the container and is created *after* the canvas, so it sits on top and
  swallows every tap. The root is transparent to pointers by design and the
  button ledge inherited that, so the canvas underneath ate "Throw it" — while
  the bit booted, dealt and animated perfectly. Each interactive island now opts
  back in with `pointer-events: auto`.

- **The turn flipped before the cover went up.** A throw committed its state
  change immediately and then animated, and `turn` flipped as part of that
  commit — so for the third of a second the card spent in the air, the screen
  was drawing the *next* player's hand, face up, to whoever was still holding
  the phone. The seat now changes when the cover appears and not before, and
  the busy lock deliberately outlasts the timer so "not busy" always means the
  cover is already there.

- **Tapping a card selected its neighbour.** In a fan each card covers most of
  the one before it, so a tap zone the size of a whole card meant tapping the
  seven you were looking at picked up the eight lying on top of it. Every zone
  is now clipped to the sliver the card actually shows, which makes "tap the
  card you can see" true — the only rule a player has.

- **"Next hand" dealt more hands every time you pressed it.** The round sheet's
  button lives in static markup, and it was being bound from inside the function
  that fills the sheet in — so it collected one more listener per hand. By the
  fourth hand a single tap dealt four, and the hands in between were never
  played. Nothing looked wrong on screen; it surfaced as the scripted match
  reporting results for hands **1, 2, 4, 7, 11** — one, then two, then three,
  then four at a time. The action row is one delegated handler now, bound once.

- **Cards in a meld stacked in the wrong order.** Sprites are drawn in z order,
  and ties fall back to whatever order the sprite map happens to hold them in —
  which is *deal* order, not layout order. So inside a meld a card could sit on
  top of the one to its right, hiding the wrong corner index and, worse,
  pointing the exposed-sliver tap zones at the wrong card. z now climbs left to
  right along every row.

`tools/harness/play-rummy.mjs` plays two complete matches through the real UI —
every cover, pile, card and button is a genuine touch — and asserts the cover
holds, the upcard cannot be thrown straight back, nobody knocks over ten,
lay-offs never raise the defender's deadwood, and every settlement pays what the
rules say.

## Performance, which turned out to be a rendering bug

The canvas blur filter is rejected at upload, so the soft shadow under a card is
built from concentric translucent strokes. Three wide stroked rounded rects per
card, twenty cards on screen, sixty times a second is sixty wide strokes a
frame, and on a machine with no GPU that alone took the bit from sixty frames a
second to two. It did not look like a performance problem: it looked like
springs that never settled and a hand that arrived in the wrong place.

The shadow is composited into each baked card sprite now, so a card costs
exactly one `drawImage`. The table — walnut, grain, the recessed baize and its
keylines — is baked once at device resolution and blitted one-for-one; baking at
CSS size and drawing it back at CSS size makes the runtime *rescale* a
full-screen image on every frame, where matching the backing store exactly turns
the same call into a straight copy.

The title screen's translucent scrim was the third: a full-screen semi-
transparent DOM layer over a canvas that repaints every frame makes the
compositor re-blend the whole screen, and it measured at four fifths of the
budget on its own. It is two canvas gradient fills now — which also fixed a
visual problem, because the DOM scrim was greying out the very cards it was
supposed to be sitting behind, and a canvas fill can be shaped to leave the fan
in the clear.

## The table

Walnut with real grain, a recessed baize inlay with a brass keyline, and a nap
of fine speckle so the felt has a surface under the light. Cards are drawn
procedurally — there are no packaged assets — with a corner index mirrored into
the far corner the way a real card reads from either end, and courts drawn as
single flat heraldic figures, since a literal mirrored half-portrait turns to
mud at the size a phone gives a card.

Melds live in a dashed tray so the space they will fill reads as waiting rather
than as a hole in the screen. The tray's floor is fixed and it grows *upward* as
melds appear — anchored the other way it would either sit half empty all game or
shove the hand around. Loose cards fan below it and the fan never moves,
because it is the thing a thumb reaches for a dozen times a hand. Choosing a
card to throw lifts it clear of the fan **and re-forms everything to its left
into the melds you would actually be left holding** — so the lift shows the
trade, not just the selection.

## Sound and settings

A cosy bed that tightens as your deadwood falls, a coin the moment a new meld
forms, a heavy haptic and a duck on the knock, and separate cues for gin, a
clean knock and being undercut. Mute persists.

Settings: match to 50, 100 or 250; baize in burgundy, forest or indigo; hints
on or off (a ring on the card that leaves you least). Player names are entered
on the title screen and remembered.

## Leaderboard

**Fewest Hands to 100** — how few deals this pair needed to finish a match. It
is a property of the *match*, not of one of the two people sharing the phone,
which is what a couch game should be putting on a global board. Only a full
hundred-point match records; the 50 and 250 house options are for the table, and
the bit deliberately submits nothing for them.
