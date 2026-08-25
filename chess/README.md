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

## The pieces are turned, not drawn

Every Staunton piece except the knight is a rotational solid — a profile swept
about a vertical axis — which is exactly what `THREE.LatheGeometry` builds. So
the flared base, the concave scotia, the waisted shaft, the collar ring and the
finial are real geometry catching a real key light down their left flank, the
way the reference photographs do. The knight is the one piece that breaks
rotational symmetry, so it is extruded from a carved silhouette instead, and
that break is what makes it findable at a glance on a small board.

Heights follow real set proportions relative to a square — pawn 0.80, rook
0.87, knight 1.05, bishop 1.16, queen 1.38, king 1.58. A single global scale
would leave the king and queen the same height, which is the one distinction
that has to survive.

## Why the camera is where it is

Directly overhead, because two people are playing each other across this board
and any tilt would give one of them a better view of it.

The field of view is deliberately wide at 38°. Straight down, a lathe-turned
piece is a disc and you lose the profile that makes a Staunton set readable. A
wider view leans the pieces outward from the centre, so each player sees the
near side of their own men and the far side of their opponent's — exactly as at
a real board. It stays fair because the spread is radial: both ends are the
same distance from the camera. Wider than 38° and the back ranks lean far
enough to overlap and spill off the board.

The key light sits low, which throws long shadows. That is most of what
separates a piece from the board when you are looking straight down at it.

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
