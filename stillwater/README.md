# Still Water

A mobile-first, first-person [Plethora Bit](https://create.plethora.studio):
one night in a drowned cypress swamp, and the thing that lives in it.

*It cannot see you. It hears the water.*

Most of the swamp is black water: deep channels, waist-deep flats, a southern
lagoon, and islands of mud and palmetto between. Something long and pale lives
in it, and it is blind. On land you make no sound it can follow. Every step you
wade carries, every stroke you swim carries further, and the rotten boardwalks
creak down into the water unless you tread gently. Follow Eli's journal across
the swamp for spring coils and the parts of a bazooka, then call it up and shoot
it while its head is out of the water -- or find fuel and Eli's key and run for
it in the boat. It only has to find you once.

## Files

| File            | Purpose                                                              |
| --------------- | -------------------------------------------------------------------- |
| `plethora.json` | Manifest (`plethora-bit@2`, runtime global `window.plethoraBit`).     |
| `main.js`       | The entry source: swamp, renderer, places, creature, game and sound. |

## Playing

| Touch                     | Keyboard and mouse        | Does                                         |
| ------------------------- | ------------------------- | -------------------------------------------- |
| Left thumb, anywhere      | WASD                      | Walk. A gentle push wades quietly.           |
| Right thumb, drag         | Mouse drag, ← →           | Look                                         |
| JUMP                      | Space                     | Jump; in the water, haul out onto a bank     |
| DUCK (hold, aim, release) | Q (hold)                  | Throw a rubber duck, or a firecracker        |
| STONE (hold, aim, release) | R (hold)                 | Throw a stone: a plop that draws it away     |
| FIRE (once built)         | F or Enter                | Fire the bazooka                             |
| The gold button           | E                         | Use: the workbench, the bell, the generator  |
| The map button            | M                         | The map of where you have been               |
| The goal line at the top  | J                         | The journal: goals, Eli's pages, how it hears |
|                           | Shift                     | Wade quietly                                 |

The stick floats under your thumb; its inner ring lights while you push gently
enough to be quiet. Holding DUCK draws the throw's arc and a ring where it will
land: blue on water, red on land, where it cannot hear it. Walk into a ladder to
climb it, and into a low bank or a boardwalk from the water to haul yourself
out. The map and the journal stop the night while they are open.

## Never aimless

The line at the top of the screen always says what to do next and how far it
is; a gold diamond hangs over the goal while it is in view and sits on the
compass when it is not. The night comes in chapters, each with its card:

| Chapter        | The goal                                                          |
| -------------- | ----------------------------------------------------------------- |
| I The Landing  | Pick up Eli's first page; follow the lanterns to the Fishing Camp  |
| II Springheel  | Five spring coils; make the boots at the workbench                 |
| III High Ground| Climb the Watchtower; from the top the whole map fills in          |
| IV Armed       | Five bazooka parts, the bazooka, a rocket                          |
| V The Hunt     | Lure it up and hit it three times while its head is out            |
| VI Dawn        | It is dead, or you are gone                                        |

**Eli's journal** is nine pages left across the swamp. Each one tells you
something true about the thing, and the ones that name places mark them on your
map: the coils (page two, on the workbench), the parts (page three, on the
tower), the rockets, the duck crates, the fuel and the key. First times are
explained once, as they happen: the first wade, the first creak, the first gap
in a boardwalk, the first time it hears you, the first time it comes.

## The way through

1. **Five of six spring coils** make **spring boots** at the workbench in the
   Fishing Camp. They jump 2.4 m high and about 3.9 m across; without them, 1 m
   and 2.3 m. Every broken boardwalk has a gap of 2.7–3.3 m.
2. **Five of six bazooka parts** make the **bazooka**: on the Watchtower, in the
   Sunken Barge, in the Stilt Village, at the top of the Drowned Chapel's bell
   tower, in the Pumphouse and in the Hermit's Shack.
3. **Five rockets**: two in the barge's cabin, two in the Boathouse, one on the
   island south of the village.
4. **Call it up.** A rubber duck in the water squeaks for forty seconds. The
   chapel bell carries across the whole swamp. The pumphouse generator hammers
   for thirty seconds with a floodlight on. Firecrackers (in the Boathouse) bang
   four times. Whatever it comes for, it rears its head out of the water there.
5. **Three hits** kill it. Each makes it faster and angrier. Then dawn comes up.

**Or leave.** A can of fuel in the Pumphouse and Eli's key, where his lantern
still burns in the Cypress Grove, start the boat in the Boathouse. The outboard
is the loudest thing in the swamp: it comes after you at a quarter more than its
hunting speed, down its channel, across the lagoon and along the old canal under
the dead trees. Pull it somewhere else first.

**Waking at the camp.** Taken, you can wake at the Fishing Camp with everything
you found, for 400 points a time, or start the night over.

## The places

The swamp is 256 m square and the same every night, so it can be learned. Four
lantern-lit boardwalks join the places, rotten in places; all the water is one
connected body, so there is nowhere it cannot reach.

| Place           | What is there                                                     |
| --------------- | ----------------------------------------------------------------- |
| The Landing     | where you wake; a lean-to, a stove-in canoe, a crate of ducks       |
| Fishing Camp    | the workbench, a shack, drying nets, a jetty into the lagoon        |
| Watchtower      | a ladder to a roofed platform; from the top the whole map fills in  |
| Sunken Barge    | a listing hull in a deep lagoon, its stern cabin above the water     |
| Stilt Village   | three huts on stilts over open water, walks and ladders between    |
| Drowned Chapel  | a stone nave half in the water, graves, a bell tower with a bell    |
| Pumphouse       | brick, pipes into the channel, the generator                      |
| Boathouse       | a long shed over its own pool, rockets, firecrackers               |
| Hermit's Shack  | lanterns, junk, a stick fence, a crate of ducks                    |
| Cypress Grove   | no buildings: crowded cypress and two coils in their roots         |

## The Listener

Its whole world is sound in water. It swims a 2 m grid of every cell at least
0.45 m deep, by the shortest way, smoothed so it glides; after a strike or a
charge it can drag itself through shallower water back to the deep.

| Sound                              | How far it carries (default hearing 22 m)    |
| ---------------------------------- | -------------------------------------------- |
| A step in shallow water            | 13 m, and 4 m pushing gently                  |
| A step in water over the knee      | 22 m, and 7 m pushing gently                  |
| A stroke, swimming                 | 33 m, and 10 m slowly                         |
| Falling or jumping in              | 14–66 m, by how hard you hit the water        |
| Jumping out of the shallows        | 24 m                                          |
| Hauling yourself out               | 17–24 m                                       |
| A duck, a firecracker              | 140 m, 110 m                                  |
| The generator, the bell            | 160 m, the whole swamp                        |
| A rotten plank over water, walking | 15 m; nothing at all walking gently          |
| Landing on planks over water       | 15–30 m                                       |
| A stone in the water               | 26 m                                          |
| The boat's outboard                | the whole swamp                               |
| Anything on land                   | nothing at all                               |

- It hears 15% less of you before you have the boots; 15% more once you carry
  the bazooka; 10% more for every hit it has taken; 55% less in the rain; and
  40% more while it rears up to listen, which it does every half-minute or so.
- It hears **where**, roughly: worse the further off and quieter you are.
- It **roams** at 1.7 m/s, **investigates** at 3, **searches** at 2 and
  **hunts** at 4.6 m/s (tunable), 15% faster for every hit. You wade at 1.8–2.5
  and swim at 1.45. You cannot outrun it in the water; you can get out of it.
  The more you have taken from the swamp, the more it roams near you.
- It strikes at a **fresh sound** within 3.2 m, or at anything it is
  **touching**. Freeze while it hunts you and it has only where it last heard
  you. A duck in shallows it cannot swim, it **charges** through with its back
  out of the water, and anyone wading in the way is taken.
- On a **low deck or jetty** over the water you are not safe from it: hunting,
  it can rear up and take you off the planks.
- The water is full of something that glows when it is stirred: **its wake
  glows**, so you can watch it come; your own ripples glow faintly.
- Its lure, photophores and milky eyes glow brighter the harder it listens; its
  dark shape is drawn through the water. The HUD's ear goes amber when it is
  listening and red when it is coming, a heartbeat rises as it closes, and the
  frogs go quiet.

## Weather

Every three or four minutes a storm announces itself with distant thunder, then
the rain comes for a minute or so: rings open all over the water, the wind rises
in the trees, and the rain drowns your steps. Bolts fork down over the trees in
front of you, a flicker of light and then thunder as late as their distance.

## Ranks and records

Progress is scored as you go: 100 a coil, 150 a part, 80 a rocket, 25 a place,
40 a page, 150 the tower's view, 150 each for the fuel and the key, 400 for the
boots, 700 for the bazooka, 1200 a hit, and 6000 for the kill plus up to 3000
for speed (two points off for every second); escaping by boat is worth 2500 plus
up to 1500. Each waking at the camp costs 400.

| Rank       | From    |
| ---------- | ------- |
| Drifter    | 0       |
| Scavenger  | 300     |
| Springheel | 1,000   |
| Armed      | 2,400   |
| Hunter     | 4,000   |
| Slayer     | 10,000  |

Two leaderboards: **Furthest Progress** (`best_progress`, higher is better,
labelled with the rank) and **Fastest Kill** (`fastest_slay`, a timer).

## Everything is drawn

`maxAssets` is 0, so nothing is loaded but Three.js (`three@0.164.1`, from the
Plethora library registry) and two registry fonts.

- **The picture** is drawn into a half-float, 4× multisampled buffer; the
  bright parts are blurred into bloom down and up a five-level chain; a last
  pass applies a filmic curve, a teal-shadow, amber-light grade, a vignette
  that deepens with fear, colour fringes and grain.
- **The ground** is a 257 × 257 height field: noise for the broad shape,
  then channels, pools and islands stamped in for the places. Its shader lays
  mud, moss, leaf litter, dark hollows and twigs by height and noise, glossy and
  dark at the waterline, with a fine bump close up.
- **The water** is a mirror: a second camera below the surface renders the
  world above it with an oblique clip plane, at half resolution. Over that,
  a breeze-masked swell, duckweed scum in the still shallows, up to 24 ripple
  rings from everything that touches it, rain rings, the moon's glitter, and
  the lanterns' streaks. Depth comes from the height field, so it is black
  where deep and peat-brown in the shallows.
- **The cypress** are built in code: a fluted, buttressed foot with knees
  standing round it in the water, a long bare trunk, flat fans of feathery
  foliage, and grey curtains of Spanish moss, all drawn into textures here.
  Saw palmetto, grass, reeds with cattails, lily pads and their flowers, and
  700 fireflies fill the rest. All of it sways in the wind, harder in the rain.
- **Instances are tiled** so the camera skips what it cannot see, and small
  plants past 40–90 m are not drawn at all.
- **Buildings** are boxes and cylinders in a local frame, merged into one mesh
  per material (planks, stone, rusted tin, cloth, dark iron), each solid part
  leaving a collider behind, so what you see is what you stand on.
- **Lamps**: every lantern glows, and the three nearest the camera are real
  lights. A real light is lent to a lantern and fades up there; when another
  lantern becomes clearly nearer it fades out before it moves, so walking past
  lanterns never makes the light pop. A lamp's light is capped close up, so the
  moss beside it never burns out to white. Moths circle every lantern.
- **Mist** lies on the water in 150 drifting banks, lit pale toward the moon.
- **Glowing fungi** crowd the feet of the cypress and the tops of fallen logs:
  thousands of cyan and violet points. Logs, stumps and stones are scattered
  over the islands and the shallows.
- **Moonlight shafts**: the bright sky round the moon is smeared toward it at a
  quarter resolution, so every branch across it casts a ray.
- **Moonlight shadows** follow you in 6 m steps and are only redrawn when you
  cross one.
- **The Listener** is one tube posed in the vertex shader from a spine laid
  along the path its head has swum, with a swimming wave: a long tapering snout
  whose jaw drops open on needle teeth, milky blind eyes, a crest of fins,
  photophores, and a lure on a stalk that lights the water around it.
- **Dawn**: when it dies the sky, fog, moon and water ease to morning over nine
  seconds.
- **Resolution follows the frame rate:** it starts at the device's ratio
  (capped at 1.25), gives back 0.15 after 1.5 s of slow frames down to 0.6,
  then redraws the mirror only every other frame, and takes it all back after
  8 s of fast ones.
- A typical view is about 150 to 210 draw calls and 0.3 to 0.65 million
  triangles, mirror included.

## Sound

Everything is synthesised with WebAudio, through a compressor and a generated
open-air reverb. Frogs and crickets placed round you, an owl far off, wind in
the trees; all of it goes quiet when the thing is near. **Water is made of
bubbles**: each one a sine that rises in pitch as it shrinks, scattered over
swells of filtered noise. A wading step is a slosh in, a slop back, a few
bubbles and the drips off your leg; a swimming stroke is the arm going in, the
pull and the gurgle; a splash is a crash and dozens of bubbles; standing in the
water it laps at you; rain is a hiss and a patter of tiny bubbles on the
surface. Planks knock hollow and the rotten ones creak; mud sucks. The duck's
squeak, a stone's plop, the bell, the generator, the outboard, the bazooka and
the blast, and thunder that cracks when it is close. The Listener is placed in 3D (HRTF): a low detuned drone that grows
louder and harsher as it listens, clicks when it hears something, a growl when
it starts to hunt, a roar as it lunges.

## Contract notes

- Runtime `plethora-bit@2`, SDK 1.5.7, manifest schema 1, dependency
  `three@0.164.1` loaded with `ctx.importModule`.
- Permissions `audio`, `haptics`, `storage`; nothing else is touched.
- The WebGL canvas comes from `ctx.createCanvas`, and the HUD from
  `ctx.createRoot` after it. The HUD is `pointer-events:none`; only the touch
  surface, the buttons, the map and the menu card take touches. The map is SVG
  written as markup: no canvas element is made by hand.
- **Controls are delegated**: one listener each on the touch surface, the
  button bar and the menu card. Pointers are tracked by id and released on
  `pointerup`, `pointercancel` and window `blur`.
- **The world steps at a fixed 60 Hz** and the picture is drawn between steps,
  with the look eased over a few hundredths of a second.
- **Ceilings only ever stop you going up.** A collider that starts above your
  waist is never a wall, so a head that meets a roof stops there instead of
  being pushed sideways out through it.
- **Storage is a convenience, never a dependency.** Every call checks
  `ctx.storage` itself and never assumes `set()` returns a promise. Haptics
  check the function the same way.
- `ctx.game.loop` drives the frame. Game beats (the death and win cards,
  toasts) run on the game's own clock, so they pause with it.
- `ctx.game.score` holds progress and submits once, at the end of a run; a kill
  also submits its time to the second record, measured when the run ends.
- `manifest.onboarding` is `guided`, four steps.
- No `document.` reference anywhere in the source, no network, no packaged
  assets, and no URL of any kind.
- **Write it so the upload check can follow it.** The upload's static check
  refuses values it cannot resolve as "remote resources". The HUD's style is
  one constant string, the safe-area variables are set with four literal
  `setProperty` calls, the storage promise is named `pending`, and the grain is
  in the shaders rather than a data URI.

## Verified

Driven headless in Chromium (SwiftShader WebGL) against a mock `ctx` built from
this manifest:

- **Paints** the title over the stilt village, play, the death card, and the
  win card at dawn; every place in a tour of the map.
- **The lure**: 28 ducks thrown from 14 spots round the swamp, with it 25 to
  135 m away: all 28 drew it and all 28 were bitten, in 5 to 51 s. Before the
  rebuild a duck could land in water it could never reach.
- **Ceilings**: jumping with spring boots inside every roofed place, 13 spots:
  the head stops at the roof and you move sideways not at all.
- **Ladders**: all six climbed to the top and stepped off onto the floor.
- **Boardwalks**: the Landing to the camp, dry all the way; all eight gaps
  cleared with the boots, jumping at the near edge; out of deep water onto a
  boardwalk by walking into it.
- **The hunt**: in the lagoon with it 40 m off, wading at full pace was usually
  taken within 90 s and swimming more often still; wading with a gentle push
  usually lived.
- **The run**: every coil, part, rocket and note picked up; boots and bazooka
  built; three rockets into its head as it rose for ducks; the death throes,
  dawn, the win card, `complete`, both record submits.
- **Touch**: two thumbs walk and look at once; a gentle push sneaks and lights
  the ring; JUMP, hold-to-aim DUCK, the map; a blur mid-drag lets go; keyboard
  walks. All of it again with `ctx.storage` and `ctx.platform.haptic` missing:
  no errors.
- **Guidance**: page one, then the camp with the distance counting down; page
  two marks all six coils and the goal moves to the nearest; the diamond shows
  over it; the journal opens from the goal line and stops the clock; chapter
  cards at each step.
- **Lanterns**: walking a lantern-lined boardwalk for six seconds, the real
  lights used to jump between lanterns ten times; now none moves while lit.
- **New threats**: a stone into the water sends it to the splash; running the
  rotten walk with it near brings it hunting, walking gently does not; hunting,
  it took the player off a low deck.
- **Waking and leaving**: waking at the camp keeps what was found and counts a
  death; fuel, key and the boat: started, a 15 s run down the canal, out, the
  card, `complete`.
- **Cost**: game logic about 0.2 ms a frame; a view is about 150 to 210 draw
  calls and 0.3 to 0.65 million triangles, mirror included.
