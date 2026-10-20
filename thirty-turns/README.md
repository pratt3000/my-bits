# Thirty Turns

A mobile-first [Plethora Bit](https://create.plethora.studio): a pocket 4X in
the mould of *The Battle of Polytopia*. One city, one warrior, a square world
under fog. Harvest, hunt and fish to grow cities, research a 24-technology tree,
capture villages, and fight with nine unit types and three kinds of boat. Play
alone against bots at four difficulties, or pass the phone around for up to
eight tribes. Games save and resume.

It is a faithful reimplementation of the classic ruleset — the same tech tree,
the same unit stats and combat formula, the same city levels and rewards, the
same four ways to win — under its own name, with twelve tribes of our own. The
original's source is not public and its names and art are Midjiwa's, so this is
the mechanics rebuilt from the rules, not a copy of anything.

## Files

| File            | Purpose                                                              |
| --------------- | -------------------------------------------------------------------- |
| `plethora.json` | Manifest (`plethora-bit@2`, runtime global `window.plethoraBit`).     |
| `main.js`       | The entry source (`entry: "main.js"`), about 3,700 lines in one file. |
| `sim.js`        | Node-only engine test; not part of the package. See *Verified*.       |

`main.js` is three layers in one file, in order: the data tables (terrain,
buildings, techs, units, tribes, rewards, tasks), a pure rules engine plus the
bot and the save format — none of which touch the DOM — and then the isometric
renderer and interface. The engine runs headlessly in node for testing; see
*Verified* below.

## The rules

### The world

Square grid, eight-direction movement and adjacency. Sizes from Tiny (11²) to
Massive (30²); the player count sets a minimum. Six map types set the water
fraction: Dryland, Lakes, Pangea, Continents, Archipelago, Water World.

Capitals are placed by farthest-point sampling and every land tile is "biomed"
by its nearest capital, so each tribe's corner of the map looks and yields like
that tribe. Villages keep a Chebyshev spacing of three, resources cluster around
villages and capitals, ruins sit away from cities (and in deep water, where a
boat can find a battleship). Each start is guaranteed two resources its starting
technology can work plus some food.

Fog is unexplored-only: once you have seen a tile you see what is on it from
then on, as in the original.

### Tribes

| Tribe   | Starts with            | Land                                   |
| ------- | ---------------------- | -------------------------------------- |
| Verdane | Organization           | Fruit-rich fields                      |
| Hjold   | Hunting                | Snow, deep forest, animals             |
| Saharn  | Riding                 | Dry open fields                        |
| Tiwa    | Fishing                | Islands, palms, fish                   |
| Fennow  | Archery                | Autumn forest, fruit                   |
| Aurelle | A level 3 capital      | Lavender fields                        |
| Grimm   | Smithery               | Ash wasteland, dead trees, metal       |
| Sabu    | Farming                | Savanna, crops                         |
| Aiyun   | Meditation             | Mountains                              |
| Quill   | Shields                | Jungle, fruit                          |
| Yoruk   | Roads                  | Steppe                                 |
| Shen    | Climbing               | Red maples, mountains, metal           |

### Economy

- Everyone starts on 5 stars; turn one is played on them. From turn two a city
  pays its level, +1 for the capital, +1 for a workshop, and a Customs House
  pays 2 per adjacent port.
- A city of level *L* needs *L + 1* population to reach *L + 1*; overflow
  carries. Each level adds a star a turn and one unit of capacity (a city
  supports *L + 1* units). Reaching a level offers a reward:

  | Level | Choice                                   |
  | ----- | ---------------------------------------- |
  | 2     | Workshop (+1 star/turn) or Explorer      |
  | 3     | City Wall (×4 defence) or +5 stars       |
  | 4     | +3 population or Border Growth (radius 2)|
  | 5+    | Park (+250 score) or a Giant             |

- Technology costs `4 + tier × cities`, 20% off with Philosophy.
- Working the land: fruit, animals and fish cost 2 for 1 pop; farms and mines
  5 for 2; a lumber hut 2 for 1; a port 10 for 2. Windmills, forges and
  sawmills pay per adjacent farm, mine or lumber hut (1, 2 and 1), and a later
  farm next to an existing windmill feeds it too. Temples (20, forest temple
  15) give 1 pop and climb from 100 to 400 score over twelve turns. Roads cost
  3, bridges 5; a city connected to the capital by road gives both +1 pop.
  Clearing a forest pays 1 star; burning one (Chivalry) makes a crop field for
  5; growing one (Spiritualism) costs 5. Whales pay 10 stars.
- An enemy unit standing on a city puts it under siege: no stars from it.

### The 24 technologies

Five roots, each with two branches, a tier-3 leaf on each branch except
Shields: Riding → Roads → Trade, Riding → Free Spirit → Chivalry; Organization
→ Farming → Construction, Organization → Shields; Climbing → Meditation →
Philosophy, Climbing → Mining → Smithery; Fishing → Sailing → Navigation,
Fishing → Whaling → Aquatism; Hunting → Archery → Spiritualism, Hunting →
Forestry → Mathematics. Archery, Meditation and Aquatism also give 1.5× defence
in forests, on mountains and on water.

### Units

| Unit        | Cost | HP | Atk | Def | Move | Range | Skills                  |
| ----------- | ---- | -- | --- | --- | ---- | ----- | ----------------------- |
| Warrior     | 2    | 10 | 2   | 2   | 1    | 1     | dash, fortify           |
| Rider       | 3    | 10 | 2   | 1   | 2    | 1     | dash, escape, fortify   |
| Archer      | 3    | 10 | 2   | 1   | 1    | 2     | dash, fortify           |
| Defender    | 3    | 15 | 1   | 3   | 1    | 1     | fortify                 |
| Swordsman   | 5    | 15 | 3   | 3   | 1    | 1     | dash, fortify           |
| Catapult    | 8    | 10 | 4   | 0   | 1    | 3     |                         |
| Knight      | 8    | 10 | 3.5 | 1   | 3    | 1     | dash, persist, fortify  |
| Mind Bender | 5    | 10 | 0   | 1   | 1    | 1     | heal, convert           |
| Giant       | —    | 40 | 5   | 4   | 1    | 1     |                         |
| Boat        | —    | —  | 1   | 1   | 2    | 2     | carries a unit          |
| Ship        | 5    | —  | 2   | 2   | 3    | 2     | upgrade, needs Sailing  |
| Battleship  | 15   | —  | 4   | 3   | 3    | 2     | upgrade, needs Navigation |

*Dash* attacks after moving; *escape* moves after attacking; *persist* attacks
again after a kill; *fortify* is the city bonus. A land unit that steps onto a
friendly port becomes a boat and keeps its hit points; a boat that lands
becomes the unit again. Three kills make a veteran (+5 max HP).

Movement: roads halve the cost; entering a forest or a mountain (off road),
boarding, landing, or any tile next to an enemy ends the move. Mountains need
Climbing, deep ocean needs Navigation.

Combat, exactly the classic formula:

```
attackForce  = atk × hp/maxHp
defenseForce = def × hp/maxHp × bonus          (1.5 in a city or bonus terrain, 4 behind a wall)
damage to defender = round(attackForce / (attackForce + defenseForce) × atk × 4.5)
damage to attacker = round(defenseForce / (attackForce + defenseForce) × def × 4.5)
```

The defender hits back only if it survives and the attacker is within its own
range, so archers and catapults outrange melee and a catapult (def 0) never
retaliates. A melee kill moves the attacker in.

A unit that has not moved can capture the city or village it stands on, examine
ruins (stars, population, a technology, a Giant, a reveal, or a battleship at
sea), or recover 2 health (4 at home). A Mind Bender heals neighbours 4 or
converts an adjacent enemy. Free Spirit lets you disband for half the cost.

### Tasks and monuments

Seven tasks, each unlocking a free monument worth +3 population and 400 score:
research every technology, defeat 10 units, hold 100 stars, connect five cities
to the capital by road, grow a city to level 5, meet every tribe, and five turns
without attacking after meeting one.

### Score and winning

20 per tile, 100 per city plus 50 for every level above the first, 100 × tier
per technology, 5 × cost per unit, temples by level, parks 250, monuments 400. Figures are the classic ones where
they are documented and approximations where they are not.

| Mode       | Ends when                                         |
| ---------- | ------------------------------------------------- |
| Perfection | the chosen turn limit (20–50, default 30) is reached: highest score |
| Domination | one tribe is left                                 |
| Glory      | someone reaches 10,000 points                     |
| Might      | one tribe holds every capital                     |

A tribe with no cities is out. Domination, Glory and Might also carry a 200-turn
cap, after which score decides, so two tribes that can never reach each other
still get a result.

## The bots

A bot's turn is: spend, move, spend again. Spending ranks every option it can
afford by value per star — a technology by the resources inside its borders it
would unlock (and by threat, for military techs), a tile action by population
with a bonus for completing a level, a unit by need (threatened cities, early
exploration, war modes) — and buys greedily until nothing is worth it. Rewards
are chosen by situation: walls when an enemy is near, border growth when the
next ring holds resources, a Giant at war, a park in peace.

Each unit first captures or examines if it can, strikes when the exchange is
good (or when it cannot shoot after moving), then walks toward the best goal —
an unclaimed village, ruins, a weak enemy city, a city of its own under threat,
or the nearest edge of the fog — scoring each reachable tile by distance to
that goal, the threat on it, terrain cover and any shot it opens up. Several
units may converge on one enemy city, and allies nearby make a trade worth
taking.

| Level  | Sloppiness (chance to skip or randomise a decision) | Extra stars           |
| ------ | --------------------------------------------------- | --------------------- |
| Easy   | 45%                                                 | —                     |
| Normal | 12%                                                 | —                     |
| Hard   | 3%                                                  | +1 a turn, +3 to start |
| Crazy  | 0%                                                  | +2 a turn, +1 per city, +8 to start |

Everything random goes through the game's own seeded generator, so a resumed
game plays on exactly as it would have.

## The look

Low-poly in two dimensions. The world is a raised slab: every land tile draws
its two front faces in the tribe's earth colour before its top, so the island
floats with visible sides, coasts show a cliff where the sea sits a few pixels
lower, and foam runs along the shore. Everything that stands on a tile is a
few flat facets lit from the upper left — a lighter face on the left, a darker
one on the right — which is what makes a cone read as a tree, a stack of quads
as a house, and three triangles with a ragged white hem as a mountain.

Each tribe has its own field, forest, trunk, rock, earth and house colours, a
tree style (cones, snow-capped cones, palms, dead trees, round canopies,
acacias) and an animal (boar, deer, bear, camel, horned, humped), and the land
near each capital uses that tribe's set, so a snowbound Hjold valley, a Tiwa
atoll and an ash-grey Grimm waste are told apart at a glance. Fruit bushes,
wheat rows, fish, whales and ore crystals mark resources; farms, mines, lumber
huts, ports, windmills with turning blades, forges with smoke, sawmills,
domed customs houses, tiered temples that gain gold trim as they age,
obelisks and broken columns mark what has been built or found. Cities grow a
house per level around a stone plaza, gain a hall with a tower at level four,
a crenellated wall band when walled, and a pennant on the capital.

Units are chibi figures: a tunic in the tribe colour with a shaded side, a
round head with two dots for eyes, and gear per type — a club and cap, a
hooded archer with a bow, a defender behind a tall shield, a swordsman with
helmet and buckler, a catapult with its crew, a knight on an armoured horse
with lance and plume, a mind bender with a glowing staff, a bald grey giant.
Boats carry the figure on a hull with mast and sail; ships get a second sail;
battleships are steel with a stack and guns. Hit points show as a bar when
below full.

Fog is a cloud bank: unexplored tiles are a dark slab, and the ones that
border the known world are covered in puffs drawn in three layers (bodies,
tops, highlights) so neighbouring tiles merge into one bank. Below 0.62 zoom
every tile drops to one shape so a Massive map stays cheap.

Bot turns are replayed as scenes: moves slide along their path, hits flash and
float their damage, deaths fade, and anything outside the viewer's fog is
skipped. Long turns are compressed so nobody waits more than a few seconds.
Pass-and-play shows a curtain between turns and each player sees only their
own fog.

The canvas asks for a three-times backing store in CSS coordinates
(`maxDpr: 3, coordinateSpace: "css"`), which is the SDK's opt-in for a crisp
surface when every draw call already uses `ctx.width`/`ctx.height` pixels; the
default backing store is CSS-sized and blurs on a phone. A little ambient
motion runs at about fourteen frames a second while the map is up: water
sparkles drift, the capital's pennant waves, forge smoke rises, the selection
ring breathes. The camera glides to the capital at the start of a turn.

### Interface

DOM inside the bit's root, styled by one `<style>` block in that root (classes,
keyframes and press states; inline SVG icons; no images). A glass HUD carries
the tribe emblem and turn, stars and income, and the score; two round buttons
open the technology tree and the menu. The bottom is an action sheet: what is
selected, its stats as icon pairs, a one-line hint, and the actions as chips,
with the gold End turn button in its header. Panels are blurred overlays with
cards: a hero menu, tribe cards with a colour swatch in setup, the technology
tree as five branch cards with tier indents, a city sheet with a population
bar and the training list, reward cards with icons, a podium at the end.

## Sound

A `cozy` music bed from `ctx.music` with stings for captures, research, level
ups and results, plus a handful of WebAudio blips of our own for steps, hits,
builds and the end of a turn. Nothing plays before the first gesture.

## Memory

- `perfection` — Perfection score after a 30-turn game, descending, with a
  `difficulty` dimension (the hardest bot in the game). Single player only.
- `conquest` — turns to win Domination, Glory or Might, ascending, same
  dimension.
- `game.progress.main` — the viewer-private Continue Playing save, written once
  per human turn. A compact save is about 4 KB for a 16² map; when a bigger
  game would exceed the 8 KB budget the progress entry carries a pointer and
  the full save lives in `ctx.storage`, which is always written as well.
  Pass-and-play games save to storage only.

## Contract notes

- `plethora-bit@2`, manifest `schemaVersion: 1`, entry `main.js`.
- Permissions: `audio` (own blips), `backgroundMusic` (bed and stings),
  `haptics`, `storage` (saves and settings).
- No dependencies. Everything is drawn and synthesised at runtime.
- Onboarding is a four-page `briefing`; the rules genuinely need it.
- Four tuning knobs: extra stars per bot turn, a Perfection turn-limit override
  (0 lets the player choose), animation speed, music volume.
- Controls sit above `ctx.safeArea.bottom`; the HUD below `safeArea.top`.
- The canvas transform is never touched and the backing store never resized —
  `ctx.createCanvas2D()` hands back a context already scaled to CSS pixels.
- All DOM goes through one delegated click listener on the root; buttons carry
  `data-act`. `document.createElement` is never called with a computed tag,
  canvas fonts name a literal family stack, and there are no gradients, so
  none of the validator traps recorded in the root README apply.

## What the upload validator rejected

Three rounds, all reported as "unsupported remote resources", all found with
`_skills/sekai/scripts/bisect.py` rather than by hand:

- The engine opened its random generator as `const g = gameRng(S)` in four
  functions, and the renderer's context is `const g = canvas.getContext("2d")`.
  The validator resolves constants without scope, so every `g.font = …` became
  unresolvable. The engine's handle is now `dice`.
- `const p = ctx.music.sting(name)` in `sting()` plus a different `p` indexed
  as `p[0]` in `artCloud()` and then in `drawUnit()`. Every local bound to a
  `ctx.…()` result now has a name used nowhere else.
- Before those, the manifest itself: a `percent` tuning knob takes 0–1, not
  0–100, and that one at least says so.

## Verified

- `_skills/sekai/scripts/check.py` passes, and the draft is on Plethora
  (uploaded 2026-10-20).
- The engine plays itself in node: `node thirty-turns/sim.js` (four quick
  games), `sim.js full` (36 games across every map size and type, all four
  modes and difficulties) or `sim.js trace` (one game's expansion, turn by
  turn). It slices the engine out of `main.js` between the data tables and
  the renderer, so there is one source of truth, and checks invariants every
  turn: units on legal tiles, one per tile, hit points in range, no negative
  stars, no owned city at level 0, saves round-trip, same seed → same game. A
  16² four-player Perfection game completes in under half a second.
- Headless Chromium scenarios through `_skills/sekai/harness`: menu → setup →
  move → city and tech panels → end turn with bot replays; harvest → level-up
  → reward; six turns of play, quit, continue; a two-human pass-and-play
  start; a Tiny Domination game against two Crazy bots played out by ending
  turns; portrait and landscape.

## Divergence from the original

Names (the game, the tribes, the monuments) are our own. The naval rules are
the classic ones (Boat → Ship → Battleship from ports, Whaling), not the later
rework. Diplomacy, cloaks, embassies and the special tribes are not included.
Scoring constants that are not documented anywhere are approximations.
