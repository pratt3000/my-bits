# Snap

The card-table race, for two to four people around one phone.

Lay the phone flat in the middle of the table. Everyone gets a slam pad on the
edge nearest them, turned the right way up for where they are sitting. Cards
flip onto one central pile on a timer; the instant a card lands on another of
the same rank the layout ring turns gold, and the first hand down takes the
pile. Slam at nothing and it costs you a card.

## Files

| File | What it is |
| --- | --- |
| `plethora.json` | manifest — no dependencies, `backgroundMusic`, `haptics`, `storage`, one leaderboard |
| `main.js` | the whole bit |

## Why it is built this way

**The race is resolved inside the `pointerdown` handler, synchronously.** Four
hands landing in the same instant arrive as four `pointerdown` events in
delivery order. The first one to reach `slam()` while the match window is open
closes the window before the second handler runs, so there is exactly one
winner and never a tie to break. Nothing about the claim is deferred to a frame
or a timeout — a frame boundary would collapse four distinct arrivals into one
and force the game to invent a tiebreak. The harness proves it: two fingers in a
single CDP `touchStart` produce one `snap` and one `late`, and four fingers
produce one `snap` and three `late`.

**Being second is not a foul.** A slam that arrives after the pile is claimed is
recorded as `late` and costs nothing. Any other rule would punish three of the
four people at the table for the crime of being ordinary, and would make a
simultaneous slam feel like a lottery instead of a race.

**A pointer is bound to a pad on `pointerdown` and keeps it until it lifts**, and
a pad that already holds a live pointer ignores extra ones. Deciding per-move
lets a stray hand drive a neighbour's control; allowing two pointers per pad
lets one person quietly own two of them.

**The two end pads are each shortened on the player's own left.** That is
screen-left for the bottom player and screen-right for the top one, who is
sitting rotated 180 degrees — so the layout is symmetric under the seat
rotation, and it frees the screen's top-right corner for the chrome buttons
without taking the corner from one player only. Without that, the top player's
slam zone contains three buttons.

**The deck is stacked, and it says so.** A fair shuffle of 52 cards yields about
three rank-adjacent pairs, which is forty seconds of watching cards go by. The
deck is instead laid out card by card, and once three to seven have gone past
without a match it reaches into the remaining pool for a partner to the card
just laid. Every card is still present exactly once — only the order is
arranged. A snap arrives every five cards on average and never later than the
seventh card of the hand.

**The stacked order is written back reversed,** because the stock is dealt with
`pop()`. Building it forward and dealing it backward was a real bug and worth
naming: plants fail near the end of the layout, where partners have run out, and
under `pop()` that end is the first thing anybody sees. Whole half-decks went by
with no snap in them at all — the exact drought the stacking exists to prevent,
moved to the one place it does the most damage.

**A forfeited card goes under the pile, not on top of it.** On top, its blank
back would be the card the next flip has to match against, and no match would be
possible — turning a penalty into a shield for the person who just fouled.

**Two clocks drive the frame.** One is clamped hard and drives decay and easing,
where a long stall must not make everything jump. The other is the game clock
and is barely clamped at all: a card is due 600 ms after the last one whatever
the frame rate, so a phone that drops frames cannot quietly halve the speed
everybody is racing against.

**The result is printed twice, the second copy turned round.** The far end of
the table gets the same plate as the near end — eyebrow, winner, every count —
just compact. It was a bare rotated headline for a while, and a bare rotated
headline reads as a bug: the same two words twice within a hundred and fifty
pixels, one of them upside down and sitting on nothing. Two seats out of two,
or two out of four, should not have to take the loser's word for the score.

**Winning turns your pad your own colour.** The win flash used to be a flat
white fill, which bleached the pad to a dead grey slab at the one moment the
player's colour matters most — the pad stopped being theirs on the frame they
took the pile. The colour now lives in the ink wash and the flash is only a
warm bloom on top of it. The full-table tint that goes with it is a tint and
not a wash, for the same reason: at the old strength the felt, the cards and
three other people's pads all went the winner's colour at once.

**The shout is measured against the free band, not the screen.** Four-handed,
"VIOLET SNAPS" at full size is wider than the gap between the side pads and
lays itself straight across two other people's counts. It scales to fit — and
because the banner runs along the winner's own axis, at a side seat what it has
to fit inside is the height of the table rather than the width.

**A settings or rules sheet freezes the hand,** and hands back the time it was
up. Otherwise cards keep flipping behind a panel nobody can slam through, and an
open match window bills whoever opened it for their reading time.

**Stock remaining is a ring, not a number.** The ring reads the same from all
four seats; a numeral is upside down for half the table. Two brass count plates
are riveted to the ring back to back for the two end seats, and the deck's own
physical thickness carries the same reading again.

## The look

Deep baize under one warm lamp, walnut rail, brass inlay. The whole table —
gradient, weave, fibre scatter, layout circle, lamp bloom, vignette, rail — is
painted once into an `OffscreenCanvas` at boot and blitted as a single image per
frame. Cards land with a real shadow, a slight random rotation and a small
random offset on a ring, so the pile builds up crooked the way a real one does,
and every card turns over in flight rather than appearing face up.

Player colours are all warm-or-cold extremes rather than mid-tones, because
every one of them has to survive being laid on green — a sage or an olive player
would vanish into the felt. Each seat also carries a suit, pressed into its pad
like a maker's mark.

## Performance

Two things dominated the budget and both are now baked:

- **Card shadows.** Live they are five stacked translucent fills per card, so a
  dozen cards on the table is sixty anti-aliased fills a frame. Baked they are a
  single blit, and being one-off the bake can afford sixteen steps instead of
  five — the falloff is smoother than the live version ever was.
- **The backing store of every bake surface.** All of them take their context
  with `willReadFrequently: true`, which pins them to the CPU backend. That is
  what a write-once blit source wants: a GPU-backed offscreen has to be read
  back across the bus on every single `drawImage`. Measured in the harness it
  was the difference between one frame a second and a smooth one.

Letter-spaced text is laid out by hand — `letterSpacing` is not universal — and
the per-character widths are memoised, because it runs on every pad every frame
and `measureText` is one of the few canvas calls that is not cheap.

## Leaderboard

**Fastest Snap** — the quickest hand that came down on this table, in
milliseconds. It belongs to the *match*, not to one of the people sharing the
phone, which is what a couch game should be putting on a global board. Anything
under 90 ms is not submitted: that is not a reaction, it is a hand that happened
to be in the air.

## Contract notes

- No packaged assets (`maxAssets: 0`). All 52 faces, the card back, the card
  shadow, the felt weave, the noise and the whole table are canvas paths painted
  into `OffscreenCanvas` surfaces at boot. If a WebView has no `OffscreenCanvas`
  every bake returns `null` and each site paints live instead — plainer felt,
  identical cards, fully playable, never blank. That path is exercised in the
  harness with a build that forces the fallback on.
- The overlay is one markup string on `ctx.createRoot()`, queried back out by
  `[data-el]`. `document.createElement` is rejected at upload. The root is
  `pointer-events: none` so a slam reaches the table underneath; only the chrome
  buttons and the full-screen panels take input.
- Pointer maths uses `event.offsetX` / `offsetY`, never
  `getBoundingClientRect()`, which is also rejected.
- Every soft edge — card shadows, the armed pad glow, the alert ring — is built
  from stacked translucent fills or strokes. Writing `g.filter = "blur(...)"` is
  read as pulling in a remote resource, because the property also accepts
  `url(#…)`.
- Player-facing strings go through `esc()` before they meet `innerHTML`.

## Settings

Players 2–4. Flip speed slow / brisk / blitz. Snap on rank, or on rank or suit.
Mute. All persisted with `ctx.storage`; player count and speed apply on the next
deal.

The selected segment is a brass chip, the same metal as the Deal button. Held
at thirty per cent over the panel's green it mixed down to a khaki that read as
the *disabled* one — the chosen answer looked no different from the ones that
were not, which is the entire job of a segmented control. The way out of a
sheet wears the brass hairline the panels and the pads already wear, for the
same reason: a flat translucent slab reads as the greyed-out button.

## Verifying

```
node tools/harness/validate.mjs snap
node tools/harness/run.mjs snap --ms=2000
node tools/harness/play-snap.mjs
```

`play-snap.mjs` drives a real hand to a real end state and asserts on it: a
simultaneous two-finger slam resolves to exactly one winner with the other
recorded late and unpenalised; a false snap forfeits a card and locks that pad;
a settings sheet freezes the stock; the deck runs out; all 52 cards are still
accounted for; a reaction time reaches the record channel; and the rematch
button deals a fresh deck with every count back to zero.
