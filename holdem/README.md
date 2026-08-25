# Hold'em

Texas Hold'em for two to six people and one phone. Blinds rotate and climb,
raises have to be legal raises, side pots are worked out for you, and the best
five of your seven wins.

Chips are numbers. There is no money in this, nothing to buy, and nothing to win
but the table.

## The whole design problem is that poker is mostly public

Every other card bit in this repo sits at one end or the other: Crownlands hides
nothing, Bluffin hides everything. Hold'em hides exactly four cards per table
and shows the rest — and the showing part *is* the game. If the board, the pot,
the stacks and every live bet are not permanently on screen, nobody can read the
table and nobody can bet properly.

So the hidden part gets the smallest enclosure that works: **the bottom quarter
of the screen**. A cover sits over it with the name of whoever should be holding
the phone, and the table above it never goes away.

### The cover lifts on a tap, not a hold

Hold-to-reveal is the usual privacy pattern and it is wrong here. The screen
underneath has to be *tapped* — fold, call, open the raise sizer, step the
amount, confirm — so holding it open takes a third hand. This is the same
conclusion Bluffin reached for the same reason.

The exposure is bounded by the player's own commit instead: acting closes the
cover in the same gesture. The phone is never left sitting on somebody's hand
waiting for them, and no timer can strand it there either.

### Nothing is rotated to a seat

Every other local-multiplayer bit here rotates a player's HUD to face their
chair. Hold'em deliberately does not, because **the phone physically travels**.
The person acting is holding it, so their panel is upright by definition;
rotating it would turn it upside down for the only person allowed to read it.
The seats stay put around the felt so the geometry of the table is stable — who
is left of whom, where the button is — and all of the text on them reads the
right way up for whoever has the phone.

## The evaluator is the part that has to be exact

A hand evaluator that is wrong one time in fifty renders perfectly in every
screenshot and quietly ruins every game. So the whole engine — ranking, side
pots and the betting round — lives between `RULES START` / `RULES END` markers,
touches neither `ctx` nor the clock, and
`tools/harness/rules-holdem.mjs` lifts it straight out of `main.js` and drives it
in node. The test runs the shipped code, not a copy that can drift.

**105 checks, all passing.** The interesting ones:

| Case | Why it is there |
| --- | --- |
| `A-2-3-4-5` is a **five**-high straight | The ace plays LOW. Ranked by the ace it becomes the *best* straight instead of the worst. This is the single most common poker bug there is, so it is tested both ways: the wheel beats trip aces, and `6-5-4-3-2` beats the wheel. |
| The steel wheel | `A♠2♠3♠4♠5♠` is a five-high straight *flush*, and any higher one beats it. |
| `A-K-Q-J-2`, `A-2-3-4-6` | Are **not** straights. The wheel special case must not leak. |
| Board plays | Two players whose hole cards change nothing both make the board's hand and split the pot to the chip. Add a pair of aces on an ace-high-straight board and it is *still* a split — the straight already on the table beats it. |
| Quads over a full house | Deuces beat aces full. |
| A flush over a straight | The two categories people transpose. |
| Kickers | Down to the fifth card, including "the second pair outranks a kicker" and "identical ranks tie exactly, suits are nothing". |
| Three pair | Collapses to the best two pair *with the right kicker*, not the lowest one. |
| A six-card straight | Resolves to the high end, not the low. |
| Side pots | Three players all in for three different amounts make two *contested* pots plus a returned bet, not three pots; the short stack with the best hand wins **only** the main pot. |
| The uncalled bet | Money nobody matched comes off the top before anything is counted, the way a dealer pushes it back. A layer with one eligible player is not a pot, it is your own chips coming home — and counting it as one made a 500 shove everyone folded to read as a 530 pot, on the screen *and* on the leaderboard. |
| The odd chip | An unsplittable chip goes to the first winner left of the button. |
| Minimum raises | Facing a 20 blind the minimum is *to 40*, not to 30; after a raise to 60 the next is to 100. A raise below the minimum is clamped up, never accepted. |
| The undersized all-in | A shove for less than a full raise raises the bet but **does not reopen the betting**. Players who already acted must call or fold and may not re-raise. A full raise over the top does reopen it. |
| Heads up | The button posts the small blind and acts first before the flop, last after it. |
| Chip conservation | 3,000 chips in, 3,000 chips out across a whole scripted hand. |
| Brute force | `best7` is checked against an independent maximum over all 21 combinations for 4,000 random seven-card hands. |

`tools/harness/play-holdem.mjs` then drives a real three-handed session: hand one
is checked and called through every street to a genuine river showdown, then
everybody shoves until one player has all 3,000 chips. It asserts a full board
was dealt, that the **Pot** button sized a real pot raise every time it was
offered, that chips stayed conserved through every hand, and that the match
reached exactly one survivor.

## What that engine actually enforces

- Blinds rotate one seat a hand and climb through 10/20, 15/30, 25/50, 50/100
  and on up on a schedule you pick (5, 8, 12 hands, or never).
- A short blind posts what it has, and **does not** lower what everybody else
  has to call.
- Raises are stated *to* a total, the way a live dealer says them, which makes
  the minimum-raise test a single comparison.
- Betting stops the moment fewer than two players can still act, and the rest of
  the board runs out on its own.
- The big blind keeps its option when everybody limps.
- An uncalled bet is returned before the pot is counted, so the pot on screen
  is money that was actually played for and the headline never credits somebody
  with winning their own chips back.
- Money is split by contribution level, so folded chips stay in the pot but a
  folder can never win one, and a player can win a side pot while still losing
  the hand — the showdown colours that number red anyway, because the delta is
  the truth.
- **Pot** and **½ Pot** in the raise sizer size a real pot raise: call first,
  then raise by what the pot is worth with the call in it. Dropping the call out
  of that sum quietly undershoots every raise that faces a bet.

## Looking at it

A real table, lit from above and slightly warm, so every highlight leans amber
and every shadow leans blue-green. Mahogany rail, brass inlay, a woven speckle
in the cloth, and a house emblem in the middle that clears away as the board
lands, the way a dealer sweeps the centre before the flop.

Chips are drawn as chips: the wall of the disc as well as the top of it, with
edge stripes up the visible half. That is the whole difference between a chip
and a coloured circle. Pots are broken into denominations and stacked.

All 52 faces come from the shared renderer in `tools/kit/kit.js`, baked once into
`OffscreenCanvas`es at board size. The two hole cards are baked again at panel
resolution when the cover lifts — it is only ever two cards, so the extra bake is
free and they are crisp at 80px wide instead of upscaled.

Things that had to be laid out by hand rather than by formula, because a
390px-wide portrait phone with six seats and a five-card board is genuinely
tight:

- **The seat rings are hand-picked per player count** so the horizontal
  mid-band always stays clear for the board. A parametric ring puts the
  four-handed left and right seats exactly level with the flop.
- **Seat plaques are clamped to the screen.** An unclamped ring leaves half a
  name past the edge; there are about seven pixels either side of the felt.
- **Bet chips hang off their own plaque** rather than floating between it and
  the middle, and the dealer button takes the opposite corner, so neither can
  land on the other or on a card.
- **Empty board slots draw nothing.** Five grey rectangles on the felt read as
  chrome; a real table has nothing there.
- **The showdown allocates board, pot breakdown and player rows out of one
  budget, top down**, so a two-handed showdown looks generous and a six-handed
  one with three side pots still fits.
- **The pot breakdown merges neighbouring pots won by the same player**, which
  also fixes the headline: three layers all won by one player is not a side-pot
  story, it is "Bo takes 4,000". "Cleo and Dov split 4,000" is a lie when Cleo
  won the main pot and Dov only got his own uncalled chips back.
- **One number is labelled POT.** The felt's pile is only what has been swept
  in, but its *number* is the whole pot, because the panel quotes the total and
  a felt reading "POT 0" beside a panel reading "POT 30" is two numbers with the
  same label disagreeing.
- **A hand that ends before the flop gives the board's band to the money.**
  Holding it open for a board that never came left one grey line marooned in a
  fifth of the screen.
- **The house wordmark is drawn live, not baked into the felt**, so it clears
  away as the board lands. Baked, a three-card flop covers it only as far as its
  third card and leaves the tail of the M beside the king.

## Contract notes

- No packaged assets (`maxAssets: 0`) — the felt, the chips and the cards are
  all canvas paths.
- The overlay is one markup string on `ctx.createRoot()` with
  `pointer-events: none` on the root, because it sits above the canvas and would
  otherwise swallow every tap. Controls opt back in individually.
- Player names are escaped before they go near `innerHTML`.
- Every timer is anchored to a `performance.now()` timestamp. Nothing accumulates
  a clock from frame deltas: `dt` is clamped so a stall cannot jump the game, and
  an accumulated clock inherits that clamp and runs in slow motion on a
  struggling device.
- State commits immediately and *then* animates, with input blocked in between.
  `window.__HOLDEM__.busy` exposes that so a play script waits on the animation
  rather than sleeping a guess.
- Soft shadows are stacked translucent strokes, never `filter = "blur(...)"`.

## Sound

A low lofi bed, unlocked inside the first real gesture. `tap` on a check, `coin`
on chips moving, `fail` on a fold, `danger` plus a heavy haptic and a screen
shake on an all-in, `powerup` as each street comes out, and a ducked `win` at the
showdown. Intensity tracks the pot against the chips left on the table, so the
bed tightens when the money does. Mute persists via `ctx.storage`, and all of it
is wrapped in try/catch — audio is a nicety and must never break play.

## Leaderboard

**Biggest Pot** — the largest pot anybody dragged in a single hand this match,
counting only money that was contested: a bet nobody called was never won, it
only came home. A property of the match, not of whichever person happened to be
holding the phone when it happened.
