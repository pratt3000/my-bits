# Idol Dash 🗿

An endless temple runner in the Temple Run 2 mould: you've taken the cursed
idol, the guardians want it back, and the ruins only get faster.

Original art, characters and name — the *mechanics* are modelled on the
genre, not the branding.

## How it plays

- **Swipe up** — vault tree roots and broken path.
- **Swipe down** — slide under low gates (also slam-cancels a jump).
- **Swipe left / right** — change lane, and **take the corner** when the path
  bends. Swiping near a bend *buffers* the turn until you reach it; run
  straight past and you're over the edge.
- Speed climbs continuously (15.5 → 34 m/s) and the score multiplier steps up
  every few hundred metres.

## Obstacles

| Hazard | Answer |
|---|---|
| Tree roots | jump |
| Low gates | slide |
| Broken path (gaps) | jump — or boost straight over |
| Stone blocks | change lane |
| Fire braziers | timed — pass while the flame is down, or slide |
| Spinning blades | change lane |

Clip something and you **stumble**: you lose speed and the guardian monkeys
close in behind you. Three stumbles without recovery and they catch you.
Run clean and the heat bleeds off.

## Powerups

Dropped in crates along the path, each upgradeable with gems:

- 🛡️ **Shield** — eats one hit.
- 🧲 **Coin Magnet** — pulls coins from neighbouring lanes.
- 🚀 **Boost** — invincible sprint that clears gaps and **turns corners for
  you**.
- ✨ **Score ×2** — doubles everything for its duration.

## Economy

Coins and gems bank at the end of every run. Gems buy six upgrade tracks in
the shop — shield duration, magnet duration, boost distance, ×2 duration,
coin value, and a cheaper **Second Chance** revive (a 5-second timed offer on
the death screen that clears nearby hazards and hands you a shield).

## Biomes

The run rotates every ~900 m through **Lost Jungle**, **Sunken Temple**,
**Cliffside Falls**, **Blazing Sands** and **Frozen Shadows** — each with its
own sky gradient, fog, lighting, path/wall textures and roadside props
(trees, carved pillars, waterfalls, obelisks, ice spires).

## Scoring & leaderboards

Score comes from distance × multiplier plus pickups. Two platform record
channels — **High Score** and **Farthest Run** — auto-submit at the end of
each run (Plethora already knows the player, so there's no name prompt).
There is deliberately **no in-bit leaderboard UI**: Plethora surfaces a
leaderboard per bit already, so the game just shows your personal best on
the menu and lets the platform own the standings.

## Files

- `plethora.json` — manifest (`plethora-bit@2`, `three@0.164.1`; haptics,
  backgroundMusic, audio, storage; two record channels).
- `main.js` — the whole game, one file, defines `window.plethoraBit`.

## Implementation notes

- **Track model.** Axis-aligned straight segments joined by 90° corners.
  Gameplay stays 1-D (distance along segment + lane); each segment stores its
  world origin and heading so meshes place into world space. Segments build
  four ahead and recycle behind.
- **Camera headings.** A three.js camera looks down its local −Z, so the
  camera yaw is the mesh yaw plus π. Getting this wrong points the camera
  backwards down the track and frustum-culls the entire level — worth
  remembering.
- **Textures** are painted to `OffscreenCanvas` (the runtime rejects
  document-created canvases) and tiled at a fixed real-world scale so
  flagstones don't stretch along long spans. Without `OffscreenCanvas`
  everything falls back to flat colour.
- **Audio** is fully synthesized WebAudio — coin pitch rises with a streak,
  footsteps track running speed — over a `ctx.music` bed per biome.
- **Engine loading** uses the single declared registry pin with retries, and
  a failure screen that reports the real error and can retry.
