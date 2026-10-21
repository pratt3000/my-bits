# Crumple

Paper toss, the office classic, rebuilt in 3D for one thumb. A crumpled sheet
sits on the corner of your desk and a wastepaper bin waits across the room.
Flick up to throw. Faster goes further, the angle is the aim, and a desk fan is
blowing — the yellow arrow says which way and the number says how hard.

Five sheets a level, three in the bin to clear it, and the bin backs off a
little further every level: through an open-plan office, down to a basement,
on to a bowling-alley bar, and round again. Endless mode counts a streak until
the first miss. Baskets pay cash, and the shop sells paper and bins.

## Files

| File            | What it is                                                                 |
| --------------- | -------------------------------------------------------------------------- |
| `plethora.json` | Manifest — `plethora-bit@2`, `three@0.164.1`, two leaderboards, onboarding. |
| `main.js`       | Entry source defining `window.plethoraBit`.                                 |

## How it plays

Touch the sheet (or anywhere below the banner) and flick upward. The release
speed, measured over the last ~90 ms of the flick in **screen heights per
second**, sets the *distance* of the throw, linearly: a flick of about 1.9
screen heights per second lands level 1's bin, a flick 10% faster throws 10%
further, and the launch speed is solved from that distance. A first version
mapped flick speed to launch speed instead, which made range grow with the
square of the flick — a small difference in finger speed sent the sheet a long
way off, and the creator could not sink one. The flick angle, clamped to
±35°, is the aim. A miss says which way it missed (LONG, SHORT, WIDE LEFT,
WIDE RIGHT) and what to change, because that is what teaches the flick. Wind is a steady sideways push on the ball for the whole flight, with
a little flutter on top, and the fan sits on the side the wind comes from, so
it swaps sides when the wind does. Level 1 is calm; from level 2 the fan
climbs a notch per level.

- **Levels:** five sheets, three in the bin. The bin starts 2.9 m away and
  moves back 30 cm a level to a cap of 6.3 m, and from level 3 it also drifts
  off-centre. Four levels per room.
- **Endless:** a streak. The bin's distance and the wind grow with the streak.
- **Cash:** $25 a basket, $35 for a swish (no rim contact), a level bonus on
  top. The shop has five papers (plain, sticky note, newspaper, pink memo, gold
  foil) and five bins (orange, blue, green, red, steel mesh).
- **Leaderboards:** highest level reached, longest endless streak.

## The physics

The ball is a 4.2 cm sphere under gravity, linear air drag and the wind,
integrated in substeps short enough (≤ 8 mm of travel, ≤ 10 ms) that a
full-power throw can never pass through the bin wall. Rotation is integrated
from an angular velocity that the throw sets (mostly backspin) and every
contact perturbs, so the sheet tumbles in the air and flops on landing.

**The bin** is a cone frustum (11.3 cm radius at the floor, 15.9 cm at the
rim, 32.5 cm tall) with a torus lip. Contact is resolved in three cases: the
lip as a ring — nearest point on the rim circle, push out, reflect; then,
below the rim, which side of the cone the centre is on decides whether the
wall pushes the ball inward or outward, using the tilted cone normal. That is
what makes rim shots behave — a ball that catches the lip rattles in or spins
out instead of being either swallowed or rejected — and why a ball can hit the
far inner wall, bounce back across and settle. A basket is called once the
ball is committed below the rim and either slows down or has been inside for
1.6 s; a miss once it has rested for 0.3 s on anything outside. "Committed"
is judged inside the substep loop, not once per frame: at ten frames a second
the whole drop from the rim to the bin floor fits inside one frame, and by the
end of it the resting contact has already zeroed the downward velocity the
per-frame check was waiting for. The headless harness, at five frames a
second, caught a throw that dropped in and then timed out as a miss with the
sheet hidden inside the bin — and which runs it happened on depended on where
the frame boundaries fell, so the same bug would have been intermittent on a
slow phone.

**Everything else** is boxes: floor, walls, the player's desk (a box rotated
45°, resolved in its own frame), and per-room colliders for desks, cabinets,
chairs, shelving, the bar and its stools. Restitution is low and friction is
Coulomb — proportional to the normal impulse — so a hard landing kills most of
the slide (paper flops, it does not roll) while a resting contact only takes
μ·g per second off it. Impacts under 0.45 m/s are treated as resting contact
so a settled ball never jitters. The first cut scaled the slide by a constant
on every contact, which with ten substeps a frame glued a sheet to whatever it
touched, including the outside of the bin, where it then never counted as at
rest; one throw in the harness stuck that way and the model was replaced.

**Forgiveness.** Three things. At launch, a throw whose distance is within a
band of the right one is pulled three quarters of the way in; the band is 28%
on level 1 and tightens to 9% by level 11 (in endless, with the streak). The
lip is inelastic (restitution 0.28), so a sheet that catches the rim mostly
dies there and drops in rather than pinging off — which is what paper does.
And on the way down, within 1.2 m of the bin, a sideways pull (7 m/s² at the
bin, fading to nothing) nudges the ball toward the bin's line *across* the
line of flight only, so a slightly wide aim still drops; it is applied in
flight, so it works with the wind rather than against the player's
correction for it. Measured on level 1 with no wind: flicks from about 1.4 to
2.4 screen heights per second land clean; on level 12, 1.75 to 2.05. Before
the launch band and the linear mapping the clean window was ±3% of flick
speed, which played as impossible. An earlier pull toward the bin in every
direction helped short throws and made long ones longer — it moved the window
instead of widening it, so it went.

## The look

Three rooms, all built from primitives and painted textures at init:

- **Office** — blue-grey carpet, fabric cubicle partitions with aluminium
  caps, two desks (monitors, keyboard, mug, papers, a plant), a filing
  cabinet, an office chair, a water cooler, a printer, posters, a big floor
  plant, a boxed stack, and a strip window on the right wall that throws cool
  daylight against warm fluorescent panels.
- **Basement** — stained concrete, cinder-block walls, joists, pipes and a
  duct overhead, one hanging bulb in a tin shade, metal shelving with
  cardboard boxes and paint cans, a workbench with a toolbox, a water heater.
- **Bar** — plank floor, dark panelling, a bar with a glossy top and a brass
  rail, four stools, a backlit shelf of bottles, a neon sign, three bowling
  pins, pendant lamps, a dartboard, two high tables, pink and blue accent
  lights.

The player's desk is a square top seen over its far corner, so a wedge of
wood fills the bottom of the frame and points up the room. The desk fan is a
chrome cage with sixteen wires and three blades that spin with the wind and a
head that sweeps slowly. The crumpled sheet is an icosphere pushed around by
three octaves of value noise and left flat-shaded, so every facet catches
light differently; missed sheets stay where they fell (up to twelve). A short
trail of fading sprites follows a throw, and two or three flies wander the
carpet, because every office has them.

Textures — carpet, concrete, planks, laminate, cubicle fabric, cinder block,
ceiling tile, cardboard, posters, a desktop for the monitor, a neon sign, the
five papers — are painted to `OffscreenCanvas` with tileable value noise.
Without `OffscreenCanvas` (iOS before 16.4) every texture function returns
null, materials fall back to flat colours of the same tone, the monitor and
neon keep a plain emissive, and the trail and flies are skipped.
Reflections come from a banded equirectangular room per scene. Lighting is a
hemisphere, one shadow-casting key light (1536² PCF soft), and a few point
lights; ACES tone mapping; fog to sink the far wall.

The HUD follows the reference: a tan paper banner with a pause button, LEVEL
and TARGET (or HIGH and SCORE in endless), and a cash pill; five paper-ball
icons that grey out as sheets are used; a SHOP tag taped to the left edge; a
purple "!" tab for how-to-play; a yellow wind arrow with its number; a white
arrow bobbing over the sheet; and an animated pointing hand for the first
three throws of a player's life.

## Sound

All synthesised with Web Audio: dry crackles when the sheet is picked up, a
whoosh on the throw, a bright tick off the lip, a hollow plastic thunk inside
the bin, a soft pat on carpet, a dull thud on furniture, a two-note ding for a
basket (three for a swish), a rising arpeggio for a cleared level, a
descending pair for a fail, a cash-register ping in the shop, and a fan bed —
band-passed air plus a low motor hum — whose level follows the wind.
`ctx.music` carries a lo-fi bed and the level stings.

## Contract notes

- `dependencies: ["three@0.164.1"]`, loaded with `ctx.importModule`, with the
  exact registry URL as a fallback.
- The render surface is claimed before `ctx.createRoot`, so the HUD lands
  above it; the root is `pointer-events: none` and only buttons re-enable
  hits. Buttons are listened to individually (never the root), so the
  overlay stays transparent to flicks.
- Pointer positions come from `offsetX`/`offsetY` with pointer capture on
  the canvas; flick speed is measured from event timestamps, unpacking
  coalesced moves, so a slow frame cannot read as a fast flick.
- Persistence in `ctx.storage` (level, cash, bests, purchases, selection,
  mute) through a fire-and-forget helper, because `set()` returns nothing
  on device. Two record channels, `level` and `endless`, submitted only on a
  cleared level or a finished run.
- Permissions: `audio`, `backgroundMusic`, `haptics`, `storage`.
- Onboarding is `immersive`: the bit draws its own in-scene cue (the hand
  and the arrow), which is the reference's own tutorial.

### What the upload validator rejects

The first upload was refused with the usual message about unsupported remote
resources. Bisected with probe uploads (the global renamed, so a clean scan
fails on a different check and no draft is created), the cause was the
combination of **a hidden `ctx.createCanvas2D()` fallback in the bake helper**
and **a loop writing into `getImageData(...).data`** in the texture painter.
Either alone passes — pen-fight carries the same fallback helper and uploads,
and the painter passes once the fallback is gone — and it does not matter that
the pixels never come from the SDK canvas: a probe with the painter on a plain
`OffscreenCanvas` and the fallback merely present elsewhere still failed. The
bake helper is now `OffscreenCanvas` or null, like `cairn/` and `pixel-fog/`.
Ruled out along the way, each by its own probe: the SVG `url(#…)` gradient,
`getCoalescedEvents`, `backdrop-filter`, `MeshPhysicalMaterial`, the registry
URL fallback, the SVG `<text>`, the canvas font string, a variable record
channel, the `<style>` block, the inline SVG as a whole, the local's name,
`createImageData` in place of `getImageData`, and `putImageData`.

## Verified

Run headlessly with the repo harness (`_skills/sekai/harness/run.js`) against
the strict mock `ctx`, on a 390 × 844 viewport:

- init clean, `ready()` after the title card, frames advancing, no console or
  page errors;
- a 1.9 screen-heights-per-second flick lands level 1's bin, a flick 35%
  faster lands long behind it, one 30% slower drops short in front — each
  throw resolves, pays or litters, and the next sheet appears;
- out-of-paper card → try again, level-cleared card → next level, shop
  (buy, select, insufficient funds), pause (resume, restart, mute, menu),
  endless mode, resize.

The harness drives flicks over CDP with real send timestamps rather than
awaiting each mouse move, because under software rendering a frame takes
most of a second and an awaited "220 ms" flick really took eight. That change
lives in `run.js` and helps any flick-driven bit. The harness runs at four or
five frames a second, so a scenario's fixed waits occasionally land a step
early; a run that reports only a scripted step out of order, with every
platform event present and no console error, is timing, not the bit.

Uploaded as a draft on 2026-10-21 (id `b7f4659b-d111-4b16-8cce-ab1925eced78`)
after the validator bisection above, then re-uploaded with the per-substep
commit fix and again with the forgiving flick mapping; publishing stays
manual in the app.
