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
- **Fight.** Cannons fire on their own at anything in their arc and range.
  Broadside guns cover ±60° off each beam, so the game is about showing an
  enemy your side while keeping their side off you. Bow and stern chasers
  come with the bigger hulls.
- **Read the badges.** Every ship wears its level in a hexagon: green is
  prey, gold is a fair fight, red will sink you. Under it, the loot it drops.
- **Loot and hold.** Sunk ships drop barrels of gold and gems that drift to
  you when close. The hold has a capacity; gems always fit. Bank it at port
  with the ⚓ button, which is refused mid-fight. Sink and you keep half.
- **Explore.** Islands, rocks (they hurt), eight wrecks, three forts at
  330 / 600 / 860 m that shell you with mortars, and five "?" buoys marking
  sunken treasure: stop over one and a dive ring fills.
- **Quests.** A chain of twenty, then a repeating set with growing targets.
  Each pays gold and gems.

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

`levelAt(x, z)` is the source of truth: enemy level is 1 + distance from
port / 36, plus a third of your captain level, then rolled so 45% of spawns
are prey, 40% fair and 15% strong. Hull HP, gun damage, gun count and rate
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
  the cannon inventory and the slot map, XP, quest index, lifetime stats and
  the world seed. Writes are debounced.
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
  broadside), flee. Land avoidance looks 22 m ahead and turns away from the
  island centre.
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
`__ptSpawn(level, dist, engage)`, `__ptKill()`, `__ptGive(coins, gems)`,
`__ptWarp(x, z)`, `__ptTreasure()`, `__ptFort()`, `__ptCollect()`.
