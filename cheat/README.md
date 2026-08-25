# Cheat

Cheat — also called BS, or I Doubt It — for three to five people and one phone.

The whole deck is dealt out. The claim rank marches round the table on its own
— Aces, Twos, Threes, wrapping after Kings — and it does not care what anybody
is holding. On your turn you put one to four cards **face down** and announce
them as the current rank. You may be telling the truth. Anyone else may call
**CHEAT**: if you lied you take the whole pile, and if you did not, the caller
does. First to empty their hand wins, but the last play still has to survive
its challenge window.

## Files

| File | What it is |
| --- | --- |
| `plethora.json` | manifest — `backgroundMusic`, `haptics`, `storage`, one leaderboard |
| `main.js` | the whole bit; 2D canvas, no dependencies |
| `tools/harness/play-cheat.mjs` | plays a full five-handed game to a real winner |

## Two phases, and separating them is the entire design

Every turn is two physically different situations happening on the same slab of
glass, and treating them as one screen is what makes pass-and-play games bad.

**PLACE is private.** The phone is picked up, so the screen is upright and all
of it belongs to one person. A full-bleed cover names who should be holding it
and lifts on a **tap**, not a hold. Hold-to-reveal is the usual privacy pattern
and it is wrong here for the same reason it was wrong in `bluffin`: the screen
behind the cover has to be tapped up to five times — four cards and a commit —
and holding a cover open with one hand while doing that takes a third. Exposure
is bounded by the player's own commit instead. The instant they play, the hand
is gone and the cover is back.

**CHALLENGE is public.** The phone goes flat and every player who is not the
placer gets a CHEAT pad on the edge they are actually sitting at, rotated to
face them, all live at the same instant. The race is settled **inside the
`pointerdown` handler**, synchronously, in whatever order the runtime delivered
the events. Four hands landing in the same frame produce four pointerdown
events; the first to arrive closes the window before the second handler runs,
so there is exactly one caller and no tie to break. Deferring any part of that
to a frame or a timeout would collapse four distinct arrivals into one.

## Why the cap is five players, not six

The brief allows six. Five is the number because two separate limits land on
the same answer.

A phone delivers at most **five simultaneous touches** — iOS caps
`navigator.maxTouchPoints` at 5 and the sixth contact is simply never
delivered. It is an OS limit, not a performance one, so it cannot be tuned
around, and a momentary tap is no cheaper than a held one because the cap
counts concurrent contacts regardless of duration. Six players means five
challengers, which is *exactly* at the limit rather than inside it, and the
player whose tap is dropped gets no feedback explaining why they lost a race
they actually won. Five players means four challengers, which is the number
`BUILDING.md` calls safe.

The geometry agrees. A phone has four edges, and four challengers is one per
edge with nobody sharing. Five people around a rectangle sit the way people
sit around any rectangle — one at the head, two down each long side — so the
seat layout is: three players take the near end and both sides, four take one
edge each, and five take the head plus two a side. Turn order is the clockwise
walk of whichever set is in play, because that is how a hand of cards goes
round a real table.

The band a far-side pad would occupy is reserved whether or not anybody is
sitting in it, so the pile, the ring and the plaques land in exactly the same
place at three, four and five players. Letting the table drift upward when the
far seat was empty made the whole composition top-heavy and left the bottom
third of the screen holding one lonely pad.

## What is on screen, and why

**The room.** A dim table under one hanging lamp, deliberately unlike Snap's
bright green baize: Snap is a race, this is a game about lying to people, so
the light does the work and the corners are genuinely dark. Old oxblood cloth
is a weave tile and a noise tile under a warm pool, plus fifteen hundred loose
fibres, a deep vignette and a walnut rail with a brass inlay — all baked into
one `OffscreenCanvas` at boot and blitted as a single `drawImage` per frame.
Fourteen dust motes drift live in the beam, which is the cheapest possible way
to say there is air in the room.

**The lamp itself** is drawn side-on, but only on the title. The play screen is
a top-down table where a hanging light can only ever be a pool; the title is a
poster, and a poster gets the cord, the shade, the bulb and the cone.

**The claim** is posted on two brass plaques, back to back above and below the
pile, so both ends of the phone read it right way up; the side seats get the
same words repeated on their own pad. One centred plaque is upside down for
half the table at exactly the moment it matters most.

**The reveal** pulls the claimed cards out of the pile into a spread and turns
them one at a time, each landing green if it is what was claimed and red if it
is not. That is the whole payoff of a call, and three cards in a heap on top of
each other says nothing. When there is room for four cards side by side they
separate completely; when there is not they overlap to the *right*, so the
top-left index of every card is the part that survives.

**The pile is not swept up on the frame the verdict lands.** Whoever just got
caught deserves the second and a half where everybody is looking at the two he
called an ace, so the cards fly to the loser a beat and a half into the verdict
banner, not before it.

**The picked-up screen** puts the table in the middle as a small diagram: the
pile at the centre, and everybody's card count at the seat they are sitting in.
Card counts are public knowledge at a real table and they are the only evidence
there is — a player down to two is about to go out, and a pile of thirty is
what a bad call costs. Laying them out at their seats reads at a glance where a
list does not, and it fills the middle of a screen that would otherwise be a
strip of chrome floating over an acre of empty cloth. The hand sits low, in
thumb reach, directly above the commit plaque, and its card size follows the
row count — a thirteen-card hand needs two rows and a nineteen-card hand needs
three, and one fixed size makes the short hand look lost.

## Bugs worth remembering

All five were invisible until real input was scripted against the running bit.

- **The overlay swallowed every tap** until the root got `pointer-events:none`,
  with controls opting back in. `ctx.createRoot()` returns an element filling
  the container and is created *after* the canvas, so it sits on top: the bit
  boots, renders and animates perfectly while ignoring the player.
- **The chrome column was unreachable behind the handover cover.** The cover is
  full-screen and was above the chrome, so mute and the rules could not be
  opened during the longest-lived screen in the game. Z-order now runs menu,
  result, cover, sheets, chrome — chrome on top of everything.
- **The verdict banner covered two people's call buttons.** It was 268px wide,
  centred, and the band between the side pads is 236. Both the banner and the
  claim now use one slot whose width is computed from whether the side seats
  reach that far up the screen: with five players the long sides carry two pads
  each and the plaque stays inside the band; with three or four it can run
  nearly edge to edge.
- **A card turning over threw a tall black smear.** The flip squashes the card
  through zero width, and the shadow was inside the same transform — so a card
  a few pixels wide stood in front of a full-height shadow. The shadow is laid
  down unsquashed and the card is squashed on top of it.
- **The verdict faded out before the cards it explains.** There are two clocks:
  a wall clock and a game clock that is clamped hard, so a phone that drops
  frames cannot quietly stretch or skip a challenge window. The banner was
  aging off the wall clock while the verdict it belongs to advanced on the game
  clock, and one long frame aged the words two seconds while the beat moved a
  quarter of one. Everything with a deadline now runs on the same clamped
  clock.

## Leaderboard

**Longest Bluff Run** — the longest unbroken run of lies that got past this
table before anybody caught one. It is a property of the *match*, not of one of
the people sharing the phone, which is what a couch game should be putting on a
global board.

It is deliberately **never shown during play**. A counter reading "three lies so
far" hands the room the exact information the face-down cards exist to hide; it
appears once, on the result screen, when there is nothing left to give away.

## Settings

Call window (3s / 4.5s / 6s), three to five players, optional names that appear
on the handover screen, mute, and a hint that puts a brass edge on the cards in
your hand that really *are* the claimed rank — on your own screen only. All
persisted with `ctx.storage`.
