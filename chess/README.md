# Chess

Chess for two people and one phone, with pieces that are turned rather than
drawn.

The phone lies flat between the players. White sits at the near edge, Black at
the far one, and **the board never moves** — Black plays it upside down exactly
as at a real board. That is both correct and familiar, and it means the board
never rotates under anybody's finger. Each player's HUD lives in the band at
their own edge, rotated to face them, which is the same reason a tournament
board engraves its far-side coordinates upside down.

## Files

| File | What it is |
| --- | --- |
| `plethora.json` | manifest — `three@0.164.1`, `backgroundMusic`, `haptics`, `storage`, one leaderboard |
| `main.js` | the whole bit; the rules engine is delimited by `ENGINE START` / `ENGINE END` markers |

## The rules are provably correct

They are not approximated. Move generation is pseudo-legal followed by
make / test / unmake against king safety — the single test that correctly
handles pins, discovered check, moving out of check, and the en-passant case
where lifting two pawns off one rank uncovers your own king. Nothing
special-cases a pin.

Castling checks all five conditions (including that b1 need only be *empty*,
not safe, and that the rook may be attacked). En passant expires after one ply.
Promotion offers all four pieces, because underpromotion to a knight is
genuinely useful. Draws are detected automatically: stalemate, dead position,
the fifty-move clock, and fivefold repetition keyed on pieces + side to move +
castling rights + en-passant file.

`tools/harness/perft-chess.mjs` lifts the engine straight out of `main.js`
between its markers and counts every legal move path against the published
figures, so the test runs the shipped code rather than a copy that can drift:

```
✓ start     depth 4: 197281      ✓ position3 depth 4: 43238
✓ kiwipete  depth 3: 97862       ✓ position4 depth 3: 9467
✓ position5 depth 3: 62379       ✓ position6 depth 2: 2079
```

Kiwipete traps castling rights; position 3 traps the en-passant discovered
check. All six positions match exactly.

## This was 3D, and it did not work

The pieces were real lathe-turned Staunton solids under a real key light, and
from the only camera angle this game can honestly use they were unreadable.

The camera has to be **directly overhead**: two people are playing each other
across the board, and any tilt gives one of them a better view of it. But the
profile that makes a chess set readable is its *side* — the flared base, the
waisted shaft, the mitre, the coronet — and from straight above you see none of
it. A bishop, a pawn and a queen are three circles of slightly different
diameter. Widening the field of view to lean the pieces outward helped at the
edges and did nothing in the middle.

So the board is flat and the pieces are the flat vector silhouettes every chess
site uses, for exactly this reason. Each is a path in a unit square: a solid
body in the player's colour, a heavy contrasting outline so a white piece on a
light square and a black piece on a dark square both stay legible, one interior
line to separate a glyph from a blob, and a squashed ellipse of a contact
shadow so it sits *on* the square.

Dropping three.js also dropped the only dependency this bit had, and with it a
1.2MB module download that happened before the first frame.

## Two bugs worth remembering

Both were invisible until real input was scripted against the running bit.

- **The overlay swallowed every tap.** `ctx.createRoot()` returns an element
  filling the container, created after the canvas, so it sits on top. The bit
  booted, rendered and animated perfectly while ignoring the player. The root
  now has `pointer-events: none`, with controls opting back in.
- **The chrome column covered the h-file.** The board is 376px wide on a 390px
  screen, so the side margins are 7px. The buttons now sit in the strip between
  the board and White's HUD.

## Leaderboard

**Fastest Mate** — how few moves this board took to produce a checkmate. It is
a property of the match, not of one of the two people at the table, which is
what a couch game should be putting on a global board.

## Settings

Three boards — walnut, tournament green, slate. Legal-move hints on or off.
Mute. All persisted with `ctx.storage`.
