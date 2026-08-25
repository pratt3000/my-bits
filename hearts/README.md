# Hearts

The full game of Hearts for exactly four people and one phone.

Every heart is a point, the queen of spades is thirteen, and points are the last
thing you want — unless you take every single one of them, which puts 26 on
everybody else instead.

## Files

| File | What it is |
| --- | --- |
| `plethora.json` | manifest — `backgroundMusic`, `haptics`, `storage`, one leaderboard, no dependencies |
| `main.js` | the whole bit; the rules engine is delimited by `RULES START` / `RULES END` markers |
| `../tools/harness/rules-hearts.mjs` | lifts the engine out of `main.js` and tests it directly |
| `../tools/harness/play-hearts.mjs` | drives a real four-player game to a real end state |

## The privacy model: nothing is ever covered

A hand of thirteen cards is secret. The trick in the middle, the four running
scores, whose lead it is — none of that is. Most pass-the-phone bits solve this
with a full-bleed cover that hides the whole screen between turns, and that
throws away the public half of the game along with the private half.

Here **the table is never covered, because the hand is simply not drawn.** The
felt, the seat ring and the cards already thrown stay on screen the entire time.
The phone travels showing them. When the person named on the handover panel taps,
their thirteen cards slide up from the bottom edge; the instant they play one,
the rest slide back down and the handover panel returns. The secret exists only
between one tap and that player's own commit.

That also settles the hold-to-look question. Press-and-hold is the right pattern
when the revealed screen is only *read* — but this one has to be **tapped**, and
holding it open with one hand while picking a card out of a thirteen-card fan
with the other takes a third hand. Exposure is bounded by the player's own move
instead, which is strictly tighter: the phone is never left sitting on somebody's
hand waiting for them.

## The ring is drawn from your chair

You are always at the bottom. The player on your left is on the screen's left,
across is across. That is what a card table looks like from your own seat, and
it is what makes "pass three to the left" unambiguous — the arrows that circle
the felt during the passing round point at the actual nameplate that is actually
getting your cards.

Because the seats are relative, the trick reads itself: **a card is rotated to
the seat that threw it.** The player opposite lands theirs upside down, the
players either side land theirs sideways, exactly as at a real table. Each
nameplate is turned to face its own chair the same way, so the person on your
left reads their own score the right way up.

## The awkward rules are the game

They are in `main.js` between `RULES START` and `RULES END`, they know nothing
about drawing, and `tools/harness/rules-hearts.mjs` lifts that block straight out
of the shipped file and tests it — so the test cannot drift from the code.

Everything difficult lives in one function, `legalMoves`:

- **The two of clubs is a forced lead.** Whoever holds it leads the first trick
  and may play nothing else.
- **Follow suit** if you hold the led suit.
- **Nothing that scores may be played on the first trick** — no heart, not the
  queen — *unless points are the only thing you hold*, which is the escape that
  keeps a freak hand from being unplayable.
- **Hearts may not be LED until they are broken**, and a heart is broken the
  moment one hits the table however it got there — *unless hearts are all you
  have left*, the same escape again. The queen is not a heart and may be led
  whenever you like.
- **Shooting the moon** needs every heart *and* the queen. Twenty-six is only
  reachable that way — twelve hearts plus the queen is twenty-five, all thirteen
  hearts without her is thirteen — so a 26 *is* a moon and the code needs no
  separate test for it.

The rules test covers all of that plus a thousand randomly played hands, checking
that no seat is ever offered a card it does not hold, no hand ever runs out of
legal moves, not one point is ever legal on a first trick, hearts are never
offered as a lead while another suit is held, and every hand scores 26 — or 78
when the moon goes up.

Legal cards lift and glow; the rest are dimmed. The rules teach themselves.

## The queen of spades

She is thirteen of the twenty-six points in the deck and she gets her own
treatment every time she appears. A crimson halo follows her card wherever it is
— in your hand, in flight, on the felt — and it breathes, so she never sits
quietly. Playing her ducks the bed, fires the `danger` sting, shakes the table,
throws a crimson ring out from the middle and drops a heavy haptic. Whoever ends
up with her wears a small crimson `Q♠` on their nameplate for the rest of the
hand.

She is the reason the halo is built from concentric translucent strokes rather
than a blur: writing `ctx.filter = "blur(...)"` is rejected at upload, because
the property also accepts `url(#…)` and the validator reads any write to it as
pulling in a remote resource.

## Three bugs that only a scripted game could find

- **The frame loop died on the fifty-second card.** When the last card of a hand
  is played the rules set `turn` to −1 while the phase is still "turn" and the
  card is still in the air. The prompt indexed `hands[-1]`, threw inside
  `onFrame`, and killed the `requestAnimationFrame` chain — the bit froze
  mid-animation and never cleared `busy` again. A screenshot of that frame looks
  completely fine.
- **The finished trick blinked out mid-flight.** `playCard` empties the trick the
  instant the fourth card completes it, so the other three vanished while the
  fourth was still flying to the middle. The paint now falls back to the recorded
  last trick for exactly that window.
- **Taps during the reveal hit the wrong card.** The fan slides 190px up from
  below the bottom edge, so a tap taken mid-slide lands on a card that is not
  where it was measured. `busy` now covers the slide as well as the animations,
  which is the same rule the rest of the repo follows: commit first, animate
  second, refuse input until it lands.

`tools/harness/play-hearts.mjs` plays a real game to a real end state — hundreds
of genuine touches through CDP, hand after hand until somebody crosses the
target, every passing round, every handover and every trick driven through the
same taps a person would make. It asserts on the way through that the opening
lead is always forced to the two of clubs, that no first trick ever took a point,
that hearts were never offered as a lead before they broke, that every hand
totals exactly 26, and that the score submitted to the leaderboard is the score
the game was actually won on.

## Cards, felt, and no assets at all

Packaged assets are disabled (`maxAssets: 0`), so all 52 faces are canvas paths,
baked once into `OffscreenCanvas`es with a live-drawing fallback for WebViews
that lack it. The deck is the shared renderer from `tools/kit/kit.js`, inlined
verbatim so every card bit in this repo deals the same cards.

The felt is baked once: a radial baize gradient, a woollen two-way speckle, the
brass ring the seats sit on, four hearts inlaid at the quarters and a rosette at
dead centre — which is there because the four thrown cards leave a small diamond
of bare felt in the middle of every single trick.

Chrome sits in the strip above the ring. Down the side it would cover the
outermost cards of the fan: a board sized to a 390px screen leaves about seven
pixels of margin.

## Sound

Lo-fi bed at 84bpm, unlocked inside the first gesture. `tap` on a card, `coin` on
a clean trick, `fail` on a trick that costs you, `danger` plus a duck for the
queen, `win` for the moon and for the end of the game. Haptics on every contact,
intensity rising as the table closes on the target, mute persisted through
`ctx.storage`. All of it in try/catch — audio is a nicety and must never break
play.

## Settings

Four editable names, a target of 50, 100 or 150, legal-card hints on or off, and
a new game from inside the panel — reachable from the title screen as well as
mid-game, because names are something you set before the first deal. Persisted
with `ctx.storage`.

## Leaderboard

**Lowest Winning Score** — the number the winner finished on, ascending. It is a
property of the *match*, not of one of the four people sharing the phone, which
is what a couch game should be putting on a global board.
