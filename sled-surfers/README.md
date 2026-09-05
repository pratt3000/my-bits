# Sled Surfers 🐧

A penguin on a sled and a snowy slope that never ends, in the mould of the
mobile game of the same name: drag to steer, tap to hop, ride the ramps for
big air, and push through stage after stage as the run gets faster and the
slope gets meaner.

Original art, characters and code — the *mechanics* and the look are modelled
on the genre, not lifted from it. Everything on screen is generated in
`main.js`: no packaged assets.

## How it plays

- **Hold and drag** left or right to steer. The finger's travel across about
  70% of the screen sweeps the whole slope. The banks of the bowl push you
  back toward the middle; the street in the city has kerbs instead.
- **Tap** (or flick up) to hop. Logs and fences are low and only need a hop;
  trees, rocks, cars, buses and icicle walls end the run unless you are
  shielded or on a rocket. Snowmen and cave crystals are soft: they slow you
  down and cost nothing else.
- **Ramps** launch you. Airtime over about three quarters of a second pays
  an air bonus that grows with the square of the time in the air.
- **Ice patches** are faster but nearly unsteerable.
- **Stages.** A checkered arch ends each stage; a vertical rail on the right
  of the HUD shows how far along it you are, with the flag at the top and a
  percentage bubble that climbs. Clearing a stage pays a bonus and raises the
  score multiplier. Stage lengths grow from 480 m in steps of 140 m, capped
  at 1 400 m.

### Biomes

Stages cycle through four biomes. The second time round, the sun goes down:
same slopes, night palette, lit windows and lamps.

| Stage | Biome | Profile | Hazards |
|---|---|---|---|
| 1, 5, … | Alpine Pass | bowl | pines, rocks, logs, fences, ramps, ice, icicles |
| 2, 6, … | Frozen Forest | bowl | round snow-capped trees, logs, rocks, ramps |
| 3, 7, … | Snowy City | kerbed street | parked cars, buses, fences, ramps, ice |
| 4, 8, … | Ice Cave | bowl with ceiling | rocks, icicle walls, crystals, ramps, ice |

### Difficulty

`difficulty(d)` is the single source of truth. Speed climbs with distance
(16 → 36 m/s) plus a per-stage bump. Hazard rows are spaced by a **reaction
time budget** — seconds × current speed — that shrinks from 1.7 s in stage 1
to 0.9 s by stage 8, so the window to react stays usable however fast you are
going. Rows get denser and wider per stage. Every row leaves a **safe
corridor** whose position drifts no further between rows than the sled can
steer in that time, so every layout is survivable. Ramps are rate-limited
(one per 90 m), and the run's first 70 m and the 30 m after each finish are
hazard-free.

### Powerups

Crates sit in the corridor every 170–260 m:

- 🚀 **Rocket** — faster, invincible, smashes hazards. Measured in metres.
- 🧲 **Magnet** — pulls coins from the neighbouring lanes.
- 🛡️ **Shield** — eats one crash.
- ✨ **×2** — doubles points.

### Garage

Coins persist between runs and buy:

- **Sleds** with stats: Snow Tube (free), Pink Board (carves and hops
  harder), Prop Plane (glides — halved gravity on the way down), Rocket Sled
  (fastest, with a flame that lights above 20 m/s).
- **Outfits** — four penguin palettes with a beanie, shades or a crown.
- **Upgrades** — five levels each of rocket range, magnet time, shield time,
  ×2 time and coin value, plus a three-level head start that begins each run
  on a rocket.

A **second chance** is offered for five seconds after a wipeout (120 coins,
doubling each time, at most twice per run): it clears the next 50 m and
hands over a short shield.

## Scoring & leaderboards

Score is distance × stage multiplier, plus coins, air bonuses, smashed
hazards and stage bonuses. Two platform record channels — **High Score** and
**Farthest Slide** — auto-submit at the end of every run, including a quit
from the pause menu. There is no in-bit leaderboard UI; Plethora owns that.

## Files

- `plethora.json` — manifest (`plethora-bit@2`, `three@0.164.1`; haptics,
  backgroundMusic, audio, storage; two record channels).
- `main.js` — the whole game, one file, defines `window.plethoraBit`.

## Implementation notes

- **Slope model.** A parametric surface: `d` runs down the slope, `u` runs
  across it. The centre line snakes (two sines), the base descends at 8.5%
  with rolling hills, and the cross-section is a profile function — a
  parabolic bowl for alpine, forest and cave, a flat street with kerbs for
  the city. Profiles blend over the 24 m after a stage boundary so the seam
  is a ramp rather than a step. Ground meshes, physics and prop placement all
  go through `groundY(d, u)` and `worldOf(d, u, y)`, so they always agree.
- **Chunks** are 40 m of slope: a vertex-coloured ground mesh, side dressing,
  hazards and pickups. Built 250 m ahead, disposed 45 m behind. Coins are
  one `InstancedMesh` with a free-list of slots.
- **Screen-right is world −x** when the camera looks down +z, so the right
  vector across the slope is `(−t.z, 0, t.x)`. Getting this wrong mirrors
  the steering; fixing it by flipping the vector reverses the ground
  triangles' winding, which back-face culls the entire slope. Both had to
  change together.
- **Ramps** are part of the ground query while the sled is on them; leaving
  the lip converts forward speed into vertical speed. Hops and landings use
  the same air state, so a hop over a ramp lip still counts as air.
- **Collision** is swept along `d` against each hazard's footprint, with a
  clear height per kind so a hop clears a log and a ramp clears a car.
- **Textures** are painted to `OffscreenCanvas` (the runtime rejects
  document-created canvases) and the sky is painted as bands rather than a
  `CanvasGradient`, because the upload validator rejects gradient stops it
  cannot resolve to literals. Without `OffscreenCanvas` everything falls back
  to flat colour.
- **Trail** is a ribbon of the last 110 ground contacts through a small
  `ShaderMaterial`; it includes `colorspace_fragment` so it is not rendered
  in linear space and turning into a saturated stripe.
- **Snow and spray** are `Points` with a painted round sprite; the snow box
  rides with the camera and streams past with speed.
- **Audio** is fully synthesized WebAudio — a filtered-noise sled hiss that
  tracks speed, coins that rise in pitch with a streak — over a `ctx.music`
  bed per biome.
- **Engine loading** uses the single declared registry pin with retries and
  a failure screen that reports the real error and can retry.

## Testing

```bash
node _skills/sekai/harness/run.js sled-surfers <scenario.json>
python3 _skills/sekai/scripts/check.py sled-surfers
```

The bit exposes `window.__ssDebug()`, `__ssWarp(d)`, `__ssGive(kind)`,
`__ssKill()` and `__ssNext()` for the harness; they are inert in production.
