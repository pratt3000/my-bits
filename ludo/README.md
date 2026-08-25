# Ludo

Ludo for two to four people and one phone.

## Why there is no pass-the-phone step

Ludo has **no hidden information at all** — every roll and every token position
is public by definition. That single fact shapes the whole adaptation: no
privacy screen, no peek-and-hide, no passing. The phone goes flat in the middle
of the table and nobody ever picks it up. The setup screen says so out loud,
because it is this game's biggest advantage over most things you can play on
one device.

## Why the board never rotates

A Ludo board is radially symmetric, so unlike a chess board it already reads
correctly from every side. Rotating it per player would be worse, not better.
Only the text and controls rotate: each seat's plate is anchored at the corner
nearest its colour and turned so its "up" points off-screen away from the
board. A player at the top of the phone reads text that is upside down to the
player at the bottom, which is exactly right.

Turns are strictly sequential, so only one control set is ever live and the
input zones cannot collide — much easier than the simultaneous-play bits in
this repo, and worth saying because it is *why* four people fit around one
phone here.

## The rules are the full ones

Not the friendly subset:

- A token leaves the yard **only on a six**, straight onto its own start.
- A six, a capture, and getting a token home each earn **one** more roll — so a
  capture with a six is still a single extra turn, not two.
- **Three sixes in a turn** voids the third roll entirely; moves already made on
  the first two stand.
- The **eight safe squares** — four starts plus four stars — are immune. An
  arriving token simply shares the cell.
- **Blockades**: two of your tokens on a cell stop an opponent landing on it and
  passing through it. Settings offer the softer "landing only" variant, which
  is what most people actually play at home.
- **Coming home needs the exact count.** Overshooting is not a legal move at all,
  so the token simply cannot be chosen.

A turn with no legal move is a forfeited roll, which is normal and frequent —
the UI lights exactly the tokens that can move and nothing else, so a forfeit
reads as a forfeit rather than as a broken tap.

## The board and the pieces

Every mark is painted into an `OffscreenCanvas` at boot: the 52-cell ring
measured cell by cell off a real board, the four yards, the home columns, the
stars, the arrows that lead into each home column, and the four triangles
meeting at the exact centre. There are no packaged assets (`maxAssets: 0`).

Tokens are the classic Ludo pawn — a wide skirted base sweeping into a waisted
neck under a ball. That is a rotational solid, so it is turned on a lathe the
same way the chess bit turns its Staunton pieces. Tokens sharing a cell fan out
slightly, so a stack is visibly a stack.

The die is a real cube. Opposite faces sum to seven, it tumbles and settles,
and it sits in the band beyond the board's near edge, pushed toward whoever's
turn it is. **The result is decided before the animation starts** and the
tumble lands on it; reading a face off a physics settle can disagree with the
rules engine, and the rules engine has to win.

## Two layout facts about a square board on a portrait phone

- **The die cannot sit diagonally outside the board.** The camera frames the
  board by width, so there is barely any horizontal margin and a diagonal
  offset puts the die outside the frustum entirely. The room is vertical.
- **The bands above and below are deep and unavoidable.** They get a felt table
  under them and they house the die and the seat plates, so they read as part
  of the object rather than as the bit failing to fill the screen.

There is exactly one `worldToScreen` used by every hit test, so what you can
tap always agrees with what is drawn.

## Leaderboard

**Fastest Finish** — how few turns this table took to get somebody home. A
property of the match, not of one of the people sharing the phone.

## Settings

Two, three or four players. Strict or soft blockades. Mute. Persisted with
`ctx.storage`.
