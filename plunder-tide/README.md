# Plunder Tide 🏴‍☠️

A pirate ship on an open sea, in the mould of the top-down naval plunder
games: sail out from your home port, hunt ships whose level is below yours,
dodge or fight the ones above, gather the loot they drop into a limited hold,
and bring it home to bank it. Everything you earn buys cannons, hulls and
upgrades, and the sea gets meaner the further out you go.

Single player against bots. Original art, names and code; every model,
texture and sound is generated in `main.js`.

## How it plays

- **Sail.** Touch and drag anywhere on the sea. A joystick appears under
  the finger: direction is heading, distance is sail. The camera sits to the
  north looking south, so screen-up is north on the chart.
- **Follow the compass.** A gold arrow orbits your ship pointing at the
  current target with its distance: the quest's target when it has one,
  otherwise loot in the water, then the nearest prey, and the port when the
  hold is full. Tap any pin on the chart to override it with a course.
- **Fight.** Cannons fire on their own at anything in their arc and range.
  Broadside guns cover ±60° off each beam, so the game is about showing an
  enemy your side while keeping their side off you. Bow and stern chasers
  come with the bigger hulls.
- **Read the badges.** Every ship wears its level in a hexagon: green is
  prey, gold is a fair fight, red will sink you. Under it, the loot it drops.
- **Loot and hold.** Sunk ships drop barrels of gold and gems that drift to
  you when close. The hold has a capacity; gems always fit. Bank it at port
  with the ⚓ button, which is refused mid-fight, or at a trading post for a
  12% cut. Sink and you keep half.
- **Quests** are a chain of twenty-six, then a repeating set with growing
  targets, and every one has a place: the compass points at the marked
  treasure, the rumoured trading post, the ring of the next region, the
  fort of the Shoals. Each pays gold and gems.

## The sea

**Five regions** in rings around the port, each with its own water colour,
fog, level band and fort:

| Region | Radius | Levels | Fort |
|---|---|---|---|
| Home Waters | 0–230 m | 1–5 | — |
| The Shoals | 230–440 m | 5–12 | 12 |
| Kraken Reach | 440–650 m | 12–22 | 22 |
| The Iron Strait | 650–830 m | 22–36 | 36 |
| Dead Man's Deep | 830–990 m | 36–60 | 52 |

Crossing into a region for the first time pays gems and announces its level
band; after that a smaller banner marks the border.

**The chart** (compass button, or tap the minimap) is a fog-of-war map on a
32×32 grid that fills in as you sail and persists between voyages.
Coastline appears when an island comes into view; forts, wrecks and
treasure buoys when you have seen them; named stops when you have found
them. The minimap in the corner is the same chart cropped to 520 m around
you. Rumours (300 gold, from the chart or a trading post) mark the nearest
thing you have not found.

**Eight islands are places.** Each has a pier, a flag and a lantern; sail up
slowly and a card appears.

- **Trading posts** (three, in the first three regions): bank the hold for a
  12% fee, repair for gold, buy a rumour, and set the post as your home
  base so voyages start there instead of the port.
- **Smuggler's coves** (three): a cache of gold and sometimes gems, refilled
  four minutes of play after it is searched.
- **Pirate nests** (two): three guards and a named captain wake up when you
  come within 220 m and stay tethered to the island. Clear them all for a
  loot drop and a bounty; they return ten minutes later.

Discovering a stop pays experience and gems. Rocks hurt, wrecks are
scenery, and everything else is charted as coastline.

**Things between the stops.** Every 75–120 s a merchant **convoy** of two or
three fat, slow, lightly-armed ships crosses the sea on a lane toward or
away from the port, with an escort past Home Waters; sinking any of them
counts as plundering the convoy. Every 100–150 s a **distress flare** goes
up: a merchant under attack by a raider. Sink the raider while the merchant
lives and she pays in loot and bounty. Both appear on the chart and as edge
markers once sighted, and both spawn sooner while a quest asks for them.

## Progression

| Hull | Guns | Hull HP | Hold | Cost |
|---|---|---|---|---|
| Sloop | 4 | 320 | 2,500 | — |
| Brigantine | 6 | 700 | 6,000 | 7,000 + 25 💎 |
| Frigate | 8 (+bow, +stern) | 1,500 | 14,000 | 28,000 + 90 💎 |
| Galleon | 10 (+bow, +stern) | 3,200 | 36,000 | 95,000 + 280 💎 |

Six cannon types, each an inventory item with ten levels: Iron Cannon,
Swivel Gun (fast, wide arc), Chain Shot (slows sails), Long Nine (range),
Incendiary (burn over time) and Mortar (lobbed splash, useless up close).
The better ones need a bigger hull. The Armory mounts them: tap a slot on
the ship in port, then a gun. Upgrades: hull plating, sails, hold, carpenters
(repair out of combat) and gunnery. Port repairs are free.

Captain level comes from experience; it feeds the enemy level curve near
port and the AI's judgement of whether you are worth attacking.

## Difficulty

`levelAt(x, z)` is the source of truth: enemy level runs across each
region's band from its inner edge to its outer one, plus a share of your
captain level (a quarter in Home Waters, a tenth beyond), then rolled so 45%
of spawns are prey, 40% fair and 15% strong. Hull HP, gun damage, gun count and rate
all scale with level; hull tier follows level bands. Past captain level 6,
one spawn in eight is a **hunter** that ignores the odds and comes for you
from 230 m; it wears a ☠ and an edge marker. Enemies approach a point off
your beam rather than your stern, then hold a broadside; prey fights back
until badly hurt and then runs; brave ships run only at the very end. Forts
respawn four minutes after falling.

## Leaderboards

Two record channels, submitted every time a voyage ends: **Gold Plundered**
(lifetime gold banked) and **Bounty** (lifetime score from sinks, forts and
treasure). Plethora renders the standings.

## Files

- `plethora.json` — manifest (`plethora-bit@2`, `three@0.164.1`; haptics,
  backgroundMusic, audio, storage; two record channels).
- `main.js` — the whole game, one file, defines `window.plethoraBit`.

## Implementation notes

- **Save** is one JSON object in `ctx.storage`: wallet, tier, upgrades,
  the cannon inventory and the slot map, XP, quest index, lifetime stats,
  the world seed, the fog grid as 32 bitmasks, what has been discovered,
  which regions have been entered, cove timers and the home base. Writes
  are debounced.
- **The chart is inline SVG**: region rings and labels in one group, the
  fog as a single even-odd path (the sea rectangle minus every explored
  cell), pins in another group, all rebuilt only when something changes.
  The minimap is a second `<svg>` that `<use>`s the same groups with a
  moving `viewBox`, so there is one chart and two windows onto it.
- **Water colour by region** is decided in the fragment shader from the
  distance to the origin, blended over 60 m across each ring boundary; the
  scene fog and clear colour follow the region the player is in.
- **Hulls** are lofted: ten stations along the length, seven points per
  ring, vertex-coloured so the stripe is geometry rather than a decal. Sails
  are bowed planes; cannon positions come from the same width profile as the
  hull, so a gun sits on the rail whatever the hull size.
- **Water** is a shader on one large plane that follows the camera: value
  noise for the swell, a soft caustic line, shallows and animated foam rings
  computed per fragment from the island list passed as a uniform array, and
  fog folded in by hand because `ShaderMaterial` does not get it for free.
  Shadows land on a `ShadowMaterial` catcher that rides with the player.
- **Ballistics.** Time of flight is chosen from range (fast and flat for
  guns, 1.6–3.2 s for mortars); the launch velocity is solved so the ball
  lands at the target's deck height, and the lead uses that same time,
  refined once. Projectiles are sub-stepped to 1.5 m so a ball cannot skip
  through a hull on a slow frame.
- **AI** is a three-state machine: patrol waypoints, engage (flank then
  broadside), flee. Merchants and flare victims only sail their lane and
  run from whoever hurt them; raiders carry a `prey` and switch to the
  player when the player hurts them; escorts follow their convoy and nest
  guards are tethered to their island. Bots' shots only hit the ship they
  were aimed at, so a raider can fight a merchant without friendly fire
  rules getting in the way. Land avoidance looks 22 m ahead and turns away
  from the island centre.
- **Labels and markers** are DOM, positioned by projecting world points each
  tick; edge markers clamp to a rectangle inside the safe areas and nudge
  apart when they collide.
- **Audio** is synthesized: filtered-noise sea with a slow LFO, a bass
  thump plus noise for cannon fire scaled by distance, and small tonal cues.
  `ctx.music` plays a cozy bed in port and a drifting one at sea, with
  intensity raised by the number of ships engaging you.

## Testing

```bash
node _skills/sekai/harness/run.js plunder-tide <scenario.json>
python3 _skills/sekai/scripts/check.py plunder-tide
```

Harness hooks: `__ptDebug()`, `__ptPort()`, `__ptSail()`, `__ptSteer(dx, dy)`,
`__ptSpawn(level, dist)`, `__ptSpawnAt(level, dx, dz)`, `__ptHurt(id, amount)`,
`__ptKill()`, `__ptGive(coins, gems)`, `__ptWarp(x, z)`, `__ptTreasure()`,
`__ptFort()`, `__ptCollect()`, `__ptStops()`, `__ptWarpStop(i)`, `__ptConvoy()`,
`__ptFlare()`, `__ptTarget()`, `__ptQuest(i)`, `__ptStats()`.
