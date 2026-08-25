# Helmet Derby

Two players, one phone, two cars trying to bonk each other on the head.

Touch the other car's **helmet** with any part of your own car and the point is
yours. That is the whole rule, and it is why the cars flip and cartwheel: the
fastest way to reach somebody's head is usually to land on it.

## The seating, and why it is honest

A side-view driving game **cannot** be shared by two people sitting opposite
each other. A side view has a handedness, and flipping it hands one player a
mirrored world where their own controls read backwards.

So both players sit **along the same edge**, each holding their own end of the
phone with a thumb pair in their own bottom corner. It works because the
controls are two fat buttons rather than a stick: your thumbs stay in your
corner and your forearms never meet in the middle.

**Nothing is mirrored anywhere in this bit.** A 180° rotation is
orientation-*preserving* — viewing a rotated render from the far side of a table
composes back to the identity, so the far player sees the same handedness and
gravity still points down for them. Code that "mirrors the controls for the
rotated player" inverts one player's steering and then costs a day of debugging.

## Physics is circles, not boxes

Each car is four discs: two wheels, a chassis, and the helmet. Circle-against-
slab contact is stable at any rotation — it never jitters or tunnels the way a
naive box solver does at speed — and it makes "did you hit their helmet" a
single distance test instead of a polygon clip.

`tools/harness/physics-derby.mjs` lifts the solver straight out of `main.js`
between its markers and checks it in numbers, because physics bugs are invisible
in a screenshot: a dropped car rests *on* the ground, a car at 6000 px/s does
not tunnel through the floor, the walls hold, driving moves you, and the bonk
test fires exactly when it should.

## Two bugs that test found

- **Contacts were resolved one at a time**, so a perfectly flat landing lifted
  the car out of the first wheel's contact before the second was tested. That
  produced spin out of nothing, the car settled crooked, and "forward" then
  drove it backwards. Contacts are gathered and applied as an average now, so
  symmetric ones cancel.
- **Ground torque was about four times too high.** Holding forward backflipped
  the car on the spot instead of moving it — it travelled 70px *backwards* over
  1.7 seconds. On the ground the wheels bite, so most of the input has to become
  forward motion and only a little a wheelie; in the air there is nothing to
  bite, so the same input is pure rotation. That split is the entire feel, and
  it now measures at 165px of travel with a 0.9 rad wheelie.

## Sound and settings

Chiptune bed, coin on a score, heavy haptic and a screen shake on contact, mute
persisted. First to 3, 5 or 9. Three arenas — The Plank, Three Tier, Split Deck.

## Leaderboard

**Biggest Win** — the margin this pair finished on. A property of the match, not
of either person playing it.
