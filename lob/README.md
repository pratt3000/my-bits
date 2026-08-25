# Lob

Artillery for two people and one phone. Two tanks at opposite ends of a
landscape that really does blow apart; set an angle and a power, pick one of
eight single-use weapons, and fire.

## Files

| File | What it is |
| --- | --- |
| `plethora.json` | manifest — `backgroundMusic`, `haptics`, `storage`, one leaderboard, no dependencies |
| `main.js` | the whole bit: physics, twelve weapons, the destructible heightmap, both decks and the arcade font |

## Both decks are on screen at once

The bottom deck belongs to **Azure**, the top deck to **Ember**, and the top one
is drawn rotated a half turn so it reads right-way-up from that seat. Only the
deck whose turn it is lights up; the other is scrimmed and refuses input, with
an audible reject if you press it anyway.

That costs 420 of the 763 usable pixels, and it is worth every one of them.
Neither player ever loses sight of their own armour or their remaining shells,
neither has to reach across the other's hands, and the handover between turns is
just one deck brightening and the other dimming — no gate, no tap-to-continue,
no waiting.

Everything on Ember's deck goes through **one** transform to draw
(`pushDeck`) and **one** inverse to hit-test (`screenToDeck`). A rotated control
surface fails silently when those two disagree — every button simply stops
working for the far player and nothing throws — so there is exactly one place in
the file for that bug to live. `tools/harness/play-lob.mjs` drives both seats
for precisely this reason.

## Angle is relative, not absolute

**0 points flat at your opponent, 90 is straight up, 180 is over your own
shoulder.** Every classic artillery game uses an absolute 0–180 compass where 0
is due east, which means the right-hand player's entire useful range is 90–180
and every printed hint is wrong for one of the two people playing.

Relative angles also make one aim dome work for both seats. Local "right" on
Ember's rotated deck maps to screen-left, which is exactly where Ember's
opponent is, so the dome needle points at the enemy from either end without a
special case. The same trick carries the wind readout: each dome shows which way
the wind will push **that player's** shell, in that player's own frame, while
the sky shows the absolute drift as blown streaks.

The battlefield itself never rotates. Spinning the world a half turn between
turns is a lovely piece of juice, but it cannot coexist with two decks that are
both visible — the dimmed one would end up at the wrong end of the table.

The *terrain* never rotates; the **writing over it does**. Text in the
battlefield window is not scenery, it is a message with an addressee, so it is
drawn in that person's frame: the turn banner and the volley counter face
whoever is acting, and every damage number faces the player who fired the shell
that caused it. Printing "EMBER FIRES" upside down at the exact instant it
becomes Ember's turn is the one thing a shared-screen game cannot get away with,
and before this rule existed Azure could read every number on the board and
Ember could read none of them. The match-over card carries the same idea in
HTML: the full result sits right-way-up for Azure and a rotated headline plus
score line sits at the far edge for Ember.

Damage numbers land on top of the fireball that caused them, so they carry a
hard dark outline rather than a drop shadow — Ember's orange ink over an orange
blast is the one pairing this palette cannot survive. The outline is one
combined `Path2D` filled once, not eight offset fills: stacked alpha turned a
half-faded number into a solid black smear.

## The ground is one number per column

`surf` is a `Float32Array` with one surface height per screen column, and every
piece of destruction is "raise or lower a run of columns":

```
crater  if (cy - d <= surf[x]) surf[x] = max(surf[x], cy + d)
dirt    if (cy + d >= surf[x]) surf[x] = min(surf[x], cy - d)
```

Collision is one array read. Craters, dirt domes, drill shafts, pedestals,
burial and fall damage all fall out of those two lines. Damage lands in a
separate `surfT` target array and the displayed heights chase it over about a
sixth of a second, so a crater collapses rather than snapping.

A heightmap cannot represent caves, tunnels or overhangs, so there are no cave
weapons — the Auger drills a shaft **down from the surface**, which a heightmap
represents exactly.

## Twelve weapons, eight in your hand

Each player is dealt eight: two Lobbers so nobody is ever without a shot, plus
six distinct others. Each fires once and is gone. The point is that every one of
them changes what you have to think about, not what number appears.

| | Weapon | What it actually does |
| --- | --- | --- |
| 1 | **Lobber** | The baseline shell. 32 damage, 36 radius. |
| 2 | **Buckshot** | Splits into five at the apex, in a tight fan that lands as a spread. |
| 3 | **Mortar** | Re-solves the shot you dialled in as the steep lob covering the same flat-ground distance. Same landing spot, over the hill. |
| 4 | **Roller** | Lands, then follows the slope downhill until it stops or reaches a tank. Hunts anyone standing in a hole. |
| 5 | **Bouncer** | Reflects off the surface normal three times before detonating. Skips over ridges. |
| 6 | **Auger** | Drills a 22px shaft 116px straight down, then detonates at the bottom. Digs a buried tank out — or in. |
| 7 | **Railgun** | Gravity and wind off, double muzzle speed. Dead flat, needs a clear line. |
| 8 | **Skyfall** | The shell only marks the spot; seven bombs then fall on it from above the world. |
| 9 | **Chain Shot** | Four blasts walking away from impact along the travel direction. |
| 10 | **Hailstorm** | Ten droplets released at the apex, keeping the parent's forward speed so they rain on the target rather than on the middle of the map. |
| 11 | **Dirt Bomb** | No damage. Dumps a 60px dome of dirt. Bury them, or wall yourself in. |
| 12 | **Bulwark** | No shot at all. Raises a wall in front of your own tank. A turn spent on cover. |

Everything runs on a fixed 60 Hz step, so a stuttering phone and a headless test
agree on where the shell landed. `g = 0.30` px/step², muzzle speed
`power × 0.125`, wind is a constant lateral acceleration re-rolled every turn.
A watchdog force-settles a shot after 900 steps: whatever a weapon behaviour
gets wrong, the turn has to come back, because a couch game that freezes
mid-shot is unrecoverable.

## No trajectory preview

Deliberately. Ranging in is the whole game: fire, watch where it lands, correct
by three degrees, fire again. A preview line deletes the sport and leaves an
arithmetic exercise. The compensation is precision — the aim dome sets angle and
power together in one drag, and four hold-to-repeat pads nudge either by exactly
one, because a raw drag jitters by ±3° and that is fatal when you are trying to
walk a shell onto a target.

## Two players, no hidden information

Lob is strictly two-handed, so there is no "how many players?" question to ask.
There is also nothing secret: both players watch every shell fly, and the
arsenal overlay only ever shows the current player's own hand because that is
whose turn it is, not because it is concealed. So there is no pass-the-phone
privacy gate — a gate here would only kill the pace.

## Drawn, not loaded

Packaged assets are disabled and remote URLs are rejected, so:

- the arcade lettering is a hand-built 5×7 block font rendered as canvas rects,
  one `Path2D` and one fill per string;
- the twelve weapon icons are drawn from primitives, not parsed from path data;
- explosion glow is three stacked strokes of falling alpha, because
  `ctx.filter = "blur(...)"` is rejected at upload (the property also accepts
  `url(#…)`, so any write to it reads as a remote resource).

**The decks and the landscape are baked.** Slab, grain, every plate bevel, the
protractor and every fixed label go to an `OffscreenCanvas` once per layout; the
terrain goes to another and is re-cut only when something actually explodes.
Live drawing was five full-width contour fills, two clipped texture passes and
twenty gradient-filled plates *per frame*, which cost more than everything else
in the bit put together and dropped a software rasteriser to four frames a
second. A deck whose readouts have not changed is not redrawn at all. Both
bakes fall back to drawing live if `OffscreenCanvas` is missing.

## Leaderboard

**Biggest Shot** — the largest damage total either player landed with a single
shell in the match. It is a property of the match rather than of one of the two
people sharing the phone, which is what a couch game should be putting on a
global board. Self-damage does not count toward it.

## Settings

Mirrored or wild arsenals, three wind strengths (including off), three armour
levels, and mute. All persisted with `ctx.storage`.

## Ending

First to zero wins. Run out of shells and the healthier tank takes it. Dead
level and dry, both players get one Lobber a round for three rounds; still level
after that and it is an honest dead heat.

## Verified

`tools/harness/play-lob.mjs` plays a full match through the real UI, taps only.
It never asks the bit where to shoot: it reads the published constants —
gravity, wind, both tank positions, the ground heights — integrates its own
trajectory, and taps the aim dome at the screen point that means that angle and
power. Both seats are driven, so the half-turn transform on Ember's deck is
exercised for real.

```
shot 1  P1  lob    aim 75/98  hp 80/80 -> 80/58
shot 2  P2  lob    aim 53/78  hp 80/58 -> 58/58
shot 5  P1  auger  aim 74/94  hp 36/36 -> 36/16
shot 7  P1  buck   aim 70/94  hp 17/16 -> 17/0
phase: over | winner: 0 | KNOCKED OUT   ·   best shot 21   ·   1 leaderboard submit
```

A separate soak fired all twelve weapons across consecutive matches with no
stall and no error. That is how two bugs surfaced that a boot screenshot would
never have shown: the Skyfall recursion, where each bomblet called in another
airstrike and the flight never ended, and an unbounded sudden death between two
players who had both run dry without landing a hit. A third — the decorative
skyline not being remapped alongside the ground on a resize, which fed a NaN
into the sky gradient — came out of resizing the viewport mid-match.
