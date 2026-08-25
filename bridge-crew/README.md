# Bridge Crew

A co-op panic panel for two to four people and one phone.

Everyone can read every order on the board. Nobody can reach anybody else's
controls. You are going to have to shout.

## This is not Spaceteam, and it would be dishonest to pretend otherwise

Spaceteam works because you can **see an order you cannot execute** and **cannot
see the control you must operate**. A single shared screen fundamentally cannot
provide that. Everything on this phone is visible to everyone sitting round it,
and no amount of rotation or small type changes it: thirty-pixel type upside
down at arm's length is newspaper-headline size. Build it that way and within
two minutes the table works out that the fastest strategy is to read silently
and point — and the shouting the whole game exists for is optimised away.

So rather than ship a version that quietly deletes its own subject, the
asymmetry is put back somewhere a shared screen can actually hold it.

**Instead of hiding information, this partitions capability.** Every control on
the panel belongs to exactly one crew member, and only its owner may touch it.
You can read every order on the board, and most of them are for somebody else's
hands. The shouting comes back on its own, because the person who *spots* an
order is usually not the person who can *carry it out*.

Everything else follows. Orders arrive faster than one pair of hands can serve,
several run at once, and each carries its own clock — so the pressure is volume
and coordination rather than secrecy. It is a good game. It is not Spaceteam.

## Controls

Five kinds, chosen so an order can never be satisfied by accident: a **switch**
has to end in the named position, a **dial** on the named number, a **slider**
at the named notch, a **button** primed, a **lever** genuinely *held* for a
second. Let go of a lever early and it drains back.

Names are deliberately confusable — FLUX INJECTOR, PHASE INJECTOR, FLUX
MANIFOLD — so an order has to be read out carefully rather than glanced at. That
is where the shouting lives.

## Layout

Two bands, top and bottom, each optionally split in two: two players face each
other across the phone, three or four share the edges. Everything on the far
band is drawn rotated 180° so it reads from that side of the table. Rotation is
0 or 180 only — a quarter turn cannot fit a panel of controls into a portrait
phone's width.

Capped at **four players** because a phone reports at most five simultaneous
touches and never delivers the sixth.

## The bug worth recording

**Every clock ran in slow motion at a low frame rate.** `dt` is clamped so a
stall cannot jump the game, but an accumulated clock inherits that clamp — so on
a device dropping frames, orders arrived at about a fifth of the intended pace
and an order that said eight seconds did not mean eight seconds. Both the order
lifetimes and the spawn interval are anchored to real timestamps now.

This is the *second* time this exact bug appeared in this repo (Forehead had it
too), which is why it is now written down in `tools/BUILDING.md`.

## Leaderboard

**Orders Served** — what this crew got through together. The only score a co-op
game should be putting on a board.
