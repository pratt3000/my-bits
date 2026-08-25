# Speed

Two players, one phone, and **no turns at all**.

Both of you play at the same time onto the same two middle piles, as fast as you
can. Nobody waits for anybody.

## Why this is the easiest card game to put on one phone

Every other card bit in this repo has to solve hidden hands and pass-the-phone.
Speed simply does not have the problem: both hands are face up, because both
players need to see their own cards and **neither can use the other's**. There
is nothing to hide.

So the design work goes into reach and identity instead. Each player's hand lies
along their own edge, rotated to face them, with their draw pile at their own
corner. The two centre piles sit dead in the middle, equidistant, so neither
player has a shorter journey to them.

Every pointer is bound to a half of the table on `pointerdown` for that
pointer's whole life. Both players are reaching for the same two piles at once,
so without that binding a hand crossing the middle would start playing its
opponent's cards.

## Rules

A card plays if its rank is one step above or below either middle pile, with the
wrap closed at both ends — **an ace sits next to both the king and the two**,
which is what stops the game deadlocking on a king. Your hand refills from your
own pile automatically. First to empty their hand *and* their pile is out.

**Playable cards lift and glow** in your own colour, so nobody has to do the
arithmetic under time pressure.

If neither player can move and neither can draw, the middle flips itself after a
beat — rather than making two people agree out loud that they are both stuck.

## Two bugs worth recording

- **The centre piles started as single cards, not stacks.** That threw away
  every card played, so when the side stacks ran out there was nothing left to
  recycle and the game deadlocked with no way back. They are stacks now, and
  running out gathers everything buried under the two face-up cards, shuffles
  it, and splits it into fresh side stacks — the same thing you do at a table.
- **Black court cards were indistinguishable at hand size.** The corner index is
  what you actually read in a fanned hand, and its suit pip was rendering at
  about 3px on a 66px card, so a jack of clubs and a jack of spades were the
  same card. The pip is much larger now, in `tools/kit/kit.js` and in every card
  bit that copied it.

## Cards

The 52-card deck comes from `tools/kit/kit.js` and is inlined verbatim, so every
card bit in this repo draws exactly the same cards. Faces are canvas paths baked
once into `OffscreenCanvas` — there are no packaged assets (`maxAssets: 0`) —
with a live-drawing fallback that is plainer but fully playable on a WebView
without `OffscreenCanvas`.

## Leaderboard

**Fastest Out** — how quickly this table emptied a hand. A property of the
match, not of one of the two people playing it.
