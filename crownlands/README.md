# Crownlands

A tile-laying kingdom race for two to four people and one phone.

Draft dominoes from a shared lane and lay them into your own five-by-five realm.
Matching terrain has to touch matching terrain, and at the end each connected
stretch of land scores **its size times the crowns standing on it** — so a vast
empty forest is worth nothing and a single three-crown mine is worth three.

## Why the phone stays on the table

There is **no hidden information anywhere in this game**. The lane is face up,
every kingdom is face up, and only the order of the undrawn pile is unknown.
That is what makes it work on one device: the phone lies flat and players reach
in rather than passing it around. There is no privacy screen in this bit and
there should not be one.

## Why the world only ever flips 180°

Players sit along the two long edges, and the whole world rotates a half turn
when the active player's side changes — never a quarter. A 90° turn would have
to fit a five-by-five kingdom *plus* a draft lane into a portrait phone's width,
which collapses the board. A half turn maps the layout exactly onto itself and
wastes nothing. Consecutive players on the same side see no flip at all, and
every flip happens behind the handoff card, so nobody watches the board spin.

## The draft is the game

Taking a low-numbered tile means going **earlier** next round; the high numbers
carry the crowns. That trade is the whole tension, so the lane always shows each
tile's number, and a claimed tile wears its owner's colour and leaves the
running.

Two players get **two kings each**, which is how the real game keeps the lane
four wide and the draft tense with only two people at the table.

## Placement

Only **one** half has to touch the castle or matching land — the other half is
free to sit against anything. That is the rule casual play gets wrong, so the
bit enforces it and offers exactly the legal placements: tap near where you want
it and it snaps to the nearest legal move, tap the same spot again to turn the
tile, or use the Turn button. A player can never aim at something that will be
refused, and a tile with nowhere legal to go is discarded rather than blocking
the game.

## Two bugs the tests caught

- **The placement scan was one square too small.** It swept `bounds ± 1`, but
  only one half has to touch the kingdom, so the *other* half can sit a full
  square further out — and since either half may be the toucher, the leading
  half ranges over `bounds ± 2`. The narrow sweep silently dropped every
  placement reaching outward, which is most of them. Found by
  `tools/harness/rules-crownlands.mjs` asserting the count of ways to hang the
  first tile off the castle: 24, not the 8 I first guessed, and the code was
  returning 20.
- **The ghost rendered outside the grid.** The five-by-five window was computed
  from the kingdom's own bounds and ignored where the player was aiming, so a
  placement reaching outward was drawn past the edge of the board and over the
  lane beneath it. One `viewOrigin()` now serves the board, the ghost and the
  hit test, so all three always agree.

`tools/harness/rules-crownlands.mjs` lifts the rules straight out of `main.js`
between its markers and checks adjacency, the five-by-five bound, connected-region
scoring (four forest squares with no crowns score **0**, not 4) and the legal-move
enumeration.

## The deck

Forty-eight dominoes, built to the same crown economy the physical game uses
rather than transcribed from it: plentiful terrains carry no crowns, crowns get
rarer as the terrain does, and the only three-crown tiles are mines. Numbers are
assigned by crown count, so sorting the lane sorts it by desirability.

Every terrain, crown and castle is a canvas path — there are no packaged assets
(`maxAssets: 0`) — and each terrain carries its own marks (stalks, trees, waves,
gems) so the board still reads without relying on colour alone.

## Leaderboard

**Best Kingdom** — the highest-scoring realm built at this table. A property of
the game, not of one of the people around it.
