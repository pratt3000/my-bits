# Othello

Othello for two people sharing one phone, in 3D.

The phone lies flat on the table between the players. Black takes the top edge,
White the bottom, and the board between them never moves for all sixty moves.

## Files

| File | What it is |
| --- | --- |
| `plethora.json` | manifest — `three@0.164.1`, `backgroundMusic`, `haptics`, `storage`, one leaderboard |
| `main.js` | the whole bit |

## Why it is built this way

**It is 3D for exactly one reason: the cascade.** Othello's whole pleasure is a
line of discs turning over one after another, and a colour swap does not
deliver it. Every disc here is a lathe-turned solid with a real ivory side
wall, and a capture rotates it a full half-turn about the axis perpendicular to
the line it was captured along — so it lifts, shows its cream edge as it passes
through vertical, and lands on the other face. Captures are staggered by their
Chebyshev ring from the placed disc, one ring every 58 ms, which makes a
twelve-disc take ripple outward as a wave instead of blinking.

**The disc is one mesh with three materials.** `LatheGeometry` emits a single
group, so the index buffer is re-sorted into three contiguous runs — bottom
face, side wall, top face — and each gets its own material. That buys the ivory
rim as real geometry with its own roughness rather than a band painted onto a
texture, and the rim is the detail that makes a half-turn legible from directly
overhead. All sixty-four discs share the one geometry and the three materials,
so a full board is sixty-four meshes and three shaders.

**The profile is built bottom-to-top on purpose.** `LatheGeometry` winds its
faces assuming an ascending profile; a descending one turns the solid inside
out, back-face culling then hides the face you are looking at, and you see the
*other* face straight through it. Every disc renders as exactly the wrong
colour with no error anywhere. That cost an hour.

**Black is a disc at identity; White is the same disc turned over.** There is no
"colour" state on a mesh at all — a flip is literally the rotation, and the
settled orientation is whatever quaternion the animation left behind. Repeated
flips about different axes compose into a small yaw, which is exactly what
happens to a real disc that has been turned over eight times.

**The camera looks straight down.** Two people are playing each other across
this board; any tilt hands one of them a larger, nearer half. The 58° field of
view is deliberately wide for an overhead shot — it leans the outer discs about
12° so their thickness reads at rest — and it stays fair because the lean is
radial, identical from both ends.

**The board never rotates; the HUD does.** The playfield carries no text — only
grid, star dots and discs — so it is orientation-neutral. Rotating it every turn
across sixty moves would be nauseating. Instead the two strips are the same
markup emitted twice, the far one at `rotate(180deg)`. Because that rotation
also reverses visual order, one child order — territory bar, scores, controls —
puts the bar against the board and the controls under the player's own thumb at
*both* ends. Full-screen messages (a forced pass, the result) are drawn twice,
once facing each seat, so nobody reads the outcome upside down.

**Placing is two-stage, and either end confirms.** Tapping a legal cell arms a
translucent ghost and rings every disc that would flip; a second tap on the same
cell, or the button at *either* end, commits. A mis-tap on an Othello board is
otherwise unrecoverable, and the preview teaches the bracketing rule to anyone
who has not played before. Two confirm buttons mean nobody has to reach across
the table. Players who find it slow can switch to one-tap placing in settings.

**A pointer is bound to the board on `pointerdown` and released only on up.**
One live finger per zone: a second hand landing mid-tap cannot retarget somebody
else's move. Every control does the same — a button that already has a finger on
it ignores the next one. The play script drives the case that actually breaks
this: two fingers landing on two different legal cells in the same frame.

**The forced pass gets a card, not a shrug.** A mandatory pass is the single
biggest source of "this is broken" in digital Othello, so it dims the board and
says *Black passes — no legal move* at both ends for 2.4 seconds. Touching the
board skips it, because it is an announcement and not a modal.

**Wait on the animation, not on the state.** A move commits its board change
immediately and *then* animates; input stays blocked until the cascade lands.
The probe exposes a `busy` flag for exactly that reason — a script that waits
for the counts to change taps into a busy board and is silently ignored.

**No undo.** The confirm step is the mitigation, and it is a better one: an undo
that reaches back past an opponent's reply is an argument waiting to happen at a
table where both players can reach the screen.

## Rules

Strict World Othello Federation play. Setup is d4/e5 White, e4/d5 Black, Black
first. A move must bracket at least one unbroken run of opposing discs against a
disc of the mover's own colour; every bracketed run flips, in all eight
directions, resolved simultaneously from the pre-move board, and flips never
chain. A player with no legal move passes; when neither can move — board full,
mutual block, or one colour wiped out — the game ends and the higher disc count
wins.

Scoring uses the tournament convention: a game that stops early credits every
remaining empty square to the winner, so the shortest possible wipe-out scores
64–0. The board itself always shows raw disc counts.

## Leaderboard

**Biggest Win Margin** — a property of the *match*, not of one of the two people
sharing the phone, which is what a couch game should be putting on a global
board. Sixty-four is the ceiling, and it means somebody was erased.

## Contract notes

- No packaged assets (`maxAssets: 0`). The felt's radial ground, its speckle and
  fibres, the incised grid with its highlight lip, the four star dots, the
  engraved OTHELLO wordmark on the rim and the table's vignette are all painted
  into an `OffscreenCanvas` at boot and uploaded as textures. A WebView with no
  `OffscreenCanvas` falls back to flat colour — plainer, fully playable, never
  blank.
- The overlay is one markup string on `ctx.createRoot()`, queried back out by
  `[data-el]`. `document.createElement` is rejected at upload. The root is
  `pointer-events: none` and only the chrome opts back in, or it would swallow
  every tap meant for the board.
- Pointer maths uses `event.offsetX` / `offsetY`, never
  `getBoundingClientRect()`, which is also rejected. It is exact here because a
  perspective camera looking straight down projects the felt plane linearly.
- A dark floor sits a hair under the felt: the rim's bevel opens the well by a
  fraction of a unit more than the felt covers, and without it the lit body slab
  shows through as a bright seam at the corners.
- All animation is a pure function of `performance.now()`, never a frame count,
  so a dropped frame shortens a cascade rather than desynchronising it.
- `three@0.164.1` is loaded with `ctx.importModule` against the manifest pin.
- Bebas Neue and Space Grotesk are requested from the registry *after*
  `ready()`. Every size is laid out against a system fallback stack that already
  carries the screen, so a failure changes nothing.

## Settings

Sound on / muted. Placing a disc: confirm (ghost + capture preview) or instant.
Legal-move rings shown or hidden. All persisted with `ctx.storage`.

## Verifying

```
node tools/harness/validate.mjs othello
node tools/harness/run.mjs othello
node tools/harness/play-othello.mjs
```

The play script plays two complete games on one board: the shortest possible
wipe-out (nine plies, White erased 13–0, margin 64), which is the only way to
reach a genuine terminal position inside a screenshot budget when a full game is
sixty moves; and the shortest line that forces a pass, which also takes the a1
corner on the way through and so exercises the gold pulse.
