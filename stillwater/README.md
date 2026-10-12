# Still Water

A mobile-first, first-person [Plethora Bit](https://create.plethora.studio):
a horror crawl through drowned night-time baths.

*It cannot see you. It hears the water.*

Something long and pale lives in the pools. It is blind. On the dry tiles you
make no sound it can follow, but every step you wade sends out ripples, and it
hears every one of them. Scavenge the baths for the parts of a way to kill it,
lure it up, and shoot it while its head is out of the water — before it finds
you first.

## Files

| File            | Purpose                                                           |
| --------------- | ----------------------------------------------------------------- |
| `plethora.json` | Manifest (`plethora-bit@2`, runtime global `window.plethoraBit`).  |
| `main.js`       | The entry source: maze, renderer, creature, game and sound.        |

## Playing

| Touch                     | Keyboard and mouse        | Does                                   |
| ------------------------- | ------------------------- | -------------------------------------- |
| Left thumb, anywhere      | WASD                      | Walk. A gentle push wades quietly.     |
| Right thumb, drag         | Mouse drag, ← →           | Look                                   |
| JUMP                      | Space                     | Jump; in the water, haul out on a ledge |
| DUCK                      | E or Q                    | Throw a rubber duck                    |
| FIRE (once built)         | F or Enter                | Fire the bazooka                       |
|                           | Shift                     | Wade quietly                           |

The stick floats: it appears under your thumb and follows a thumb that runs
past its rim. Its inner ring lights cyan while you are pushing gently enough
to be quiet. Every button fires on the press, under its own finger, so you can
jump or throw while both thumbs are down.

## The way through

1. **Four spring coils** make **spring boots**. They lie on dry footing with
   water around it, spread along the walk from the start, so getting them
   means wading.
2. The boots reach the **high shelves** in the terrace rooms, where up to two of
   the **five bazooka parts** are kept. The rest are far out, by water.
3. **Five rockets** glow on the pool floors, in open water.
4. **Rubber ducks** come in crates (three at a time). A duck that lands in the
   water squeaks for nine seconds. The Listener comes to bite it, and while it
   rears up to bite, its head is out of the water and can be hurt.
5. **Three hits** kill it. Each one makes it faster and angrier.

## The Listener

Its whole world is sound in water.

| Sound                         | How far it carries |
| ----------------------------- | ------------------ |
| A wading step                 | 15 m (tunable)     |
| A slow, quiet wading step     | about 4 m          |
| Lowering yourself in at a creep | about 7 m        |
| Dropping or jumping in        | 9–40 m, by how hard you hit the water |
| Hauling yourself out          | about 13 m         |
| A duck landing / squeaking    | 35 m / 15 m        |
| A rocket going off            | 45 m               |
| Anything on dry tiles         | nothing at all     |

- It hears **where**, roughly: better in direction than in distance, and worse
  the further off and quieter you are.
- A sound in **another pool** reaches it through the drains at 60% of the range,
  and anything as loud as a wading step sends it down its drain and up through
  the drain of the pool you are in. **Bubbles rise from that drain** for the
  last two seconds before it comes out.
- It **wanders** at 1.3 m/s, **investigates** at 2.5, and **hunts** at
  4.3 m/s, 14% faster for every hit it has taken. You wade at 2.1. You cannot
  outrun it in the water; you can get out of it.
- It strikes at a **fresh sound**, or at something it is **touching**. Freeze
  while it hunts you, and it has only the place it last heard you. In testing,
  freezing with it closing from five metres away survived about one time in
  four. Wading on survived none.
- Its photophores glow brighter the more it is listening, and its dark shape
  and lights are drawn through the water's surface, so it can be watched.
  The HUD's ear goes amber when it is listening and red when it is coming.

## Ranks and records

Progress is scored as you go: 100 a coil, 150 a part, 90 a rocket found, 500
for the boots, 800 for the bazooka, 1000 a hit, and 5000 for the kill plus up
to 3000 for speed (three points off for every second).

| Rank       | From    | Roughly                     |
| ---------- | ------- | --------------------------- |
| Drifter    | 0       |                             |
| Scavenger  | 250     | a few coils                 |
| Springheel | 900     | the boots                   |
| Armed      | 2,200   | the bazooka                 |
| Hunter     | 3,600   | a hit on it                 |
| Slayer     | 9,000   | the kill                    |

Two leaderboards: **Furthest Progress** (`best_progress`, higher is better,
labelled with the rank) for everyone, and **Fastest Kill** (`fastest_slay`, a
timer, lower is better) for the few who finish it.

## The baths

The map is a grid of 2 m cells: 40 × 40 with eleven rooms at the default size
(34 / 8 and 48 / 15 for small and large). Rooms are joined in a spanning tree
with extra loops, so there is always another way round. Each room is dressed in
a style that decides where the dry footing is:

| Style    | Dry footing                                                       |
| -------- | ----------------------------------------------------------------- |
| dry      | the whole floor, round a small plunge pool (the start is one)      |
| pool     | walkways on some sides; big ones get an island with a lifeguard chair |
| hall     | both long sides and one or two bridges across                     |
| stones   | stepping stones on a checkerboard                                 |
| court    | a raised dais in a broken ring of stones                          |
| terrace  | a walkway in front of a 2.2 m shelf only spring boots reach       |

Every map gets two terraces, two stones, two pools, a hall, a court and a
second dry room before chance fills the rest. Connected stretches of water are
bodies; each body gets a drain.

**Every map is checked before it is used.** A breadth-first walk from the start
(stepping, dropping, hauling out of the water, and jumping, higher with boots)
must reach every open cell with the boots and every cell below the shelves
without them; a map that fails is regenerated, up to twelve times. Items are
placed only where that walk can reach them: coils, rockets and crates on foot,
shelf parts with the boots. The check found a real fault in the first version:
a corridor could meet a terrace only at its shelf, which cannot be climbed from
the water, sealing the room off. Such corridors now cut a doorway through the
shelf. 90 maps across the three sizes now pass.

## Everything is drawn

`maxAssets` is 0, so nothing is loaded but Three.js (`three@0.164.1`, from the
Plethora library registry) and two registry fonts.

- **One tile shader** draws every surface: tile size by surface (wall, mosaic
  band, pool, floor, ceiling), anti-aliased grout from `fwidth` faded with
  distance, stained and chipped tiles, damp blotches, streaks, an algae tide
  line, a wet band at the waterline, and slightly domed glaze. Geometry carries
  no UVs; the pattern comes from world position.
- **Lamps only light their own room.** Each lamp carries the box of the room it
  hangs in and is masked to it, softened at doorways, so light never leaks
  through a wall. Warm sconces, teal lamps set in the pool walls (which light
  only what is under the water), strip lights in corridors, and moonlight
  through skylights in the big rooms. Each 8 × 8-cell chunk gets the eight
  lamps that matter to it.
- **Water** is a shaded surface: a slow swell, three octaves of noise, up to 20
  live ripple rings (every footstep, splash and wake), Fresnel between seeing
  the pool floor at your feet and a dark mirror across the room, lamp glints,
  pool lamps glowing up through it, and foam where it meets the tiles.
- **Caustics** play on everything under the water and are thrown up onto the
  walls and ceilings above it, scaled by the light that would make them.
- **The Listener** is one tube of twenty segments posed in the vertex shader
  from a spine laid along the path its head has swum, with a swimming wave
  toward the tail. It has a broad flat head with milky blind eyes, a jaw that
  drops open on needle teeth when it bites or lunges, three pairs of frills
  that flare when it listens, a crest of blades that cut the surface, and
  photophores. Its shadow and lights are drawn after the water.
- **Items** are shared geometry with a soft shaft of light and a pool of it on
  the floor, visible across a hall, and fading as you walk into them.
- **Resolution follows the frame rate:** the canvas starts at the device's
  pixel ratio (capped at 2), gives back a quarter step after 1.5 s of slow
  frames, down to 0.85, and takes it back after 10 s of fast ones.
- **Film grain** is added in the shaders' fog step, scaled to brightness, so it
  also dithers the banding out of the dark gradients.
- A typical view is about 35 draw calls.

## Sound

Everything is synthesised with WebAudio, through a compressor and a long
generated tiled-hall reverb. Footsteps on tiles, wading, splashes by force,
hauling out, drips placed around you, the duck's squeak, the bazooka and the
blast. The Listener is placed in 3D (HRTF): a low detuned drone that grows
louder and harsher as it listens, clicks when it hears something, a growl when
it starts to hunt, a roar as it lunges. The drains gurgle where it goes in and
where it will come out. A heartbeat rises as it hunts you closer.

## Contract notes

- Runtime `plethora-bit@2`, SDK 1.5.7, manifest schema 1, dependency
  `three@0.164.1` loaded with `ctx.importModule`.
- Permissions `audio`, `haptics`, `storage`; nothing else is touched.
- The WebGL canvas comes from `ctx.createCanvas`, and the HUD from
  `ctx.createRoot` after it, so source order stacks the HUD on top. The HUD is
  `pointer-events:none`; only the touch surface, the buttons and the menu card
  take touches.
- **Controls are delegated**: one listener each on the touch surface, the
  button bar and the menu card, registered once. Pointers are tracked by id,
  and released on `pointerup`, `pointercancel` and window `blur`.
- **Storage is a convenience, never a dependency.** Every call checks
  `ctx.storage` itself and never assumes `set()` returns a promise. Haptics
  check the function the same way.
- `ctx.game.loop` drives the frame. Game beats (the death and win cards,
  toasts) run on the game's own clock, so they pause with it.
- `ctx.game.score` holds progress and submits once, at the end of a run; a kill
  also submits its time to the second record, measured when the run ends rather
  than after the first submit returns.
- `manifest.onboarding` is `guided`, four steps.
- No `document.` reference anywhere in the source, no network, no packaged
  assets, and no URL of any kind. The first upload was refused for using
  "remote resources" over one string: the grain overlay was an SVG data URI,
  and its `xmlns` namespace looks like a remote address to the upload check.
  The grain moved into the shaders.

## Verified

Driven headless in Chromium (SwiftShader WebGL) against a mock `ctx` built from
this manifest:

- **Paints** the title, play, death and win screens; three moods.
- **The hunt**: wading toward it from 11 m, it investigates, hunts, lunges and
  kills; the card shows, with one `fail`, one record submit, one pulse.
- **Sneaking**: wading quietly to within 4 m of it, unheard.
- **Climbing**: walking into a low ledge from the water hauls you out in 0.6 s.
- **Items**: every coil, part and rocket picked up; boots and bazooka assemble;
  the HUD and chapter follow.
- **The lure**: a thrown duck lands, squeaks, draws it, and it rears up to bite;
  a rocket at its head takes a hit off it.
- **The kill**: the death throes, the win card, `complete`, both records, the
  pulse.
- **The drains**: sent to another pool, it swims to its drain, travels, and
  comes up investigating in the other one.
- **Touch**: two thumbs at once walk and look; a third finger jumps; a gentle
  push sneaks; release stops; DUCK throws; keyboard walks; a blur mid-drag
  releases the stick. All of it again with `ctx.storage` and
  `ctx.platform.haptic` missing: no errors.
- **Maps**: 90 seeds across three sizes pass the reachability check with every
  item reachable.
- **Cost**: game logic about 0.1 ms a frame; GPU geometry count does not grow
  across restarts.
