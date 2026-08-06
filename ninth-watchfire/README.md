# The Ninth Watchfire

A five-minute animated story told in twelve chapters, drawn entirely in
procedural canvas 2D.

Nine towers stand along a wall of ice called the Rime. Light one fire and the
next must answer, and the next, all the way down to the green country. The fire
at Ashen Reach has not burned in three hundred years, and Wren Coldhalt has
tended it since she was eleven without once seeing it lit.

## Files

| File            | What it is                                            |
| --------------- | ----------------------------------------------------- |
| `plethora.json` | Manifest — permissions, tags, and the `council` tally. |
| `main.js`       | Entry source defining `window.plethoraBit`.            |

## The story

Original fiction. The setting takes its mood from the classic
cold-beyond-the-wall opening — rangers who don't all come back, an omen in the
sky, a found beast beside its dead mother, a garrison forced to decide — but the
world, characters, and plot are all written for this bit.

Twelve chapters, roughly 300 seconds of narration:

1. **The Waste** — three lanterns go out past the Rime; two come back.
2. **Ashen Reach** — the ninth tower, and the fire nobody alive has seen lit.
3. **The Ranger** — Hessk comes home with frost in his beard and one word.
4. **The Omen** — the lights come in red and every raven leaves at once.
5. **The Whelp** — a white hound dead in the drift, curled around something breathing.
6. **The Council** — nine people, one decision. **This one is yours.**
7. **The Quiet** — the storm with no wind, and what walks out of it.
8. **Two Hundred and Six** — the climb, and everything she burns to make it catch.
9. **The Ninth Fire** — it caught.
10. **The Silence** — the eighth tower does not answer.
11. **The Answer** — a fisherman's daughter with nothing to burn but her boat.
12. **The Green Country** — they came. Late, and badly, but they came.

## Interaction

- **Tap** to reveal the rest of a chapter's lines, then again to skip ahead.
- **Chapter VI holds** until you choose what you would have done. Your answer
  goes to the `council` tally and comes back as a global split; chapter VII's
  opening line changes to match. Not answering within 40 seconds moves on with
  the neutral line.
- **Sound and pause** buttons sit top-right, clear of the bottom unsafe area.
- Progress is stored locally, so a partial watch offers **Resume** next time.

## Contract notes

- Runtime `plethora-bit@2`, schema version 1, entry `main.js`.
- Permissions: `backgroundMusic` (the score), `haptics` (chapter beats),
  `storage` (resume point and your council answer).
- No dependencies, no packaged assets and no registry fonts — every frame is
  generated in code and typeset in the system serif stack.
- One memory channel: a `single_choice` tally `council`, `replace_previous` by
  user, visible after voting. Results parsing is deliberately tolerant of shape.

## Implementation notes

- **Never reset the canvas transform.** `ctx.createCanvas2D()` hands back a
  context already scaled to CSS pixels for the device DPR. Calling
  `setTransform(1,0,0,1,0,0)` throws that away and renders everything at
  `1/dpr` size in the top-left corner. The frame loop uses balanced
  `save`/`restore` only.
- Snow and embers are computed analytically from the clock rather than kept in
  arrays, so they cost nothing to maintain and survive a resize unchanged. All
  wrapping uses a positive modulo — plain `%` goes negative and flings particles
  off-frame the moment anything drifts leftward.
- **No global-DOM access.** The host validator rejects `document.*` outright
  (`Direct document/body access is not allowed`), so the UI is built with
  `innerHTML` on the runtime-owned root plus `querySelector`, which is the
  pattern the contract's own examples use. Note that font stacks are re-quoted
  with `'` for the markup — `UIFONT` and `BODY` carry double quotes that would
  close a style attribute early.
- **Colours interpolate as numeric `[r,g,b]` triples, never as hex strings.**
  This one is worth knowing about, because the error it produces names nothing
  useful. A helper that sliced a hex string, `parseInt`ed it and reassembled the
  result by concatenation got the whole bit rejected with *"unsupported remote
  resources"* — that sequence is the shape of dynamically constructed URL
  obfuscation, and the validator matches on the shape, not on any banned API.
  Nothing here is remote. Keep colour maths off strings entirely.
- Static layers (starfield, ice wall, vignette) are painted straight onto the
  main context each frame. They were cached into offscreen buffers at one point,
  but that whole API family is unavailable, and at roughly three hundred cheap
  fills a frame the caching was never buying much.
- A rolling frame-time average trims particle counts and drops the grain pass on
  slower hardware instead of dropping frames.
- Narration shows three line-groups at a time. Four filled nearly half the
  screen and buried whatever the chapter was showing. Focal points sit in the
  upper half for the same reason.
- The score follows the story rather than looping under it: `drone` in the
  waste, `cozy` for the whelp, `spooky` at full intensity when the storm
  arrives, a near-silent `drone` at the low point, `triumph` when the chain
  answers.
