# my-bits

[Plethora Bits](https://create.plethora.studio) — tiny mobile-first interactive
objects built to the `plethora-bit@2` agent contract.

## Bits

| Bit                                     | What it is                                                                 |
| --------------------------------------- | -------------------------------------------------------------------------- |
| [`loop-lab/`](loop-lab)                 | A live looping station — record a layer, overdub 12 synth instruments.      |
| [`spot-pip/`](spot-pip)                 | Hidden-object search game: find Pip in the crowd, race a global best time.  |
| [`kaleido-bloom/`](kaleido-bloom)       | Kaleidoscope fidget — drag to paint glowing symmetric mandalas.             |
| [`whispering-grove/`](whispering-grove) | A calm, endless 3D forest to wander and collect from.                       |
| [`snack-shot/`](snack-shot)             | Back-camera AR shooter — turn to find fruit in the room and blast them.      |
| [`tiny-reef/`](tiny-reef)               | Shared aquarium — design a fish, release it into a reef everyone shares.    |
| [`ones-and-zeros/`](ones-and-zeros)     | Conway's Game of Life in colour — cells born as 1s, fading to 0s when they die. |
| [`ninth-watchfire/`](ninth-watchfire)   | A five-minute animated story in twelve chapters, with one choice that's yours. |
| [`perfect-drop/`](perfect-drop)         | ASMR timing toy — release a water drop just right for the perfect plink.    |
| [`cairn/`](cairn)                       | Zen rock balancing — stack stones with real physics, three modes, three boards. |
| [`pocket-planet/`](pocket-planet)       | A tiny 3D globe to walk around and build on — trees grow in real time.       |
| [`last-straw/`](last-straw)             | Find a needle in a 3D haystack — 20,000 straws, one needle, saved digs.     |
| [`idol-dash/`](idol-dash)               | Endless temple runner — swipe to turn, jump and slide as the ruins blur past. |
| [`chameleon-hunt/`](chameleon-hunt)     | 3D hide-and-seek — find humanoids camouflaged into five arenas before time runs out. |
| [`strange-silk/`](strange-silk)         | Chaotic attractors iterated a million times — tap for a new seed, a new painting. |
| [`morphogen/`](morphogen)               | Turing's reaction–diffusion live: coral, spots and worms from two numbers.   |
| [`orrery/`](orrery)                     | Bodies on whole-number orbits ring bells as they cross the top — self-playing music. |
| [`paper-loom/`](paper-loom)             | A print that lays itself out: recursive cuts, Truchet motifs, chosen palettes. |
| [`heartwood/`](heartwood)               | A tree grown by space colonization, one reach toward the light at a time.    |
| [`whirligig/`](whirligig)               | Fidget spinner as a gear train — flick a plate of packed discs, all meshed. |
| [`sketch-hop/`](sketch-hop)             | Endless doodle jumper on graph paper — bounce up the page, dodge monsters. Ships as *Sketch Hop II*. |
| [`windmill-cove/`](windmill-cove)       | Mini golf in the Golf With Your Friends mould — seven courses, nine holes each. |
| [`windmill-cove-3d/`](windmill-cove-3d) | The same game in 3D — orbit the camera, survey the hole, aim by looking.     |
| [`pen-fight/`](pen-fight)               | The desk duel in 3D — flick your gold pen to shove your rival's off the table. |
| [`mandelbrot/`](mandelbrot)             | Pinch 68 levels into the Mandelbrot set, and hear each point's orbit sing.  |
| [`n-body/`](n-body)                     | Gravity you can throw — grow a world, launch it, watch orbits and collisions form. |
| [`wave-interference/`](wave-interference) | Two fingers become wave sources — watch the fringes, hear them beat.       |
| [`turing-soup/`](turing-soup)           | Reaction–diffusion dish — drag to inject, steer feed/kill, watch coral grow.  |
| [`boids/`](boids)                       | A murmuration of thousands — your finger is the predator, or the attractor.  |
| [`ripcord/`](ripcord)                   | Spin your phone — the gyroscope sets your top's RPM, then it battles two rivals. |
| [`backseat-rain/`](backseat-rain)       | Back a raindrop on a misted window and race it to the sill. Ships as *Window Seat*. |
| [`ball-pool/`](ball-pool)               | Eight-ball pool — aim, spin, and break against a bot, or pass the phone.    |
| [`pour-decisions/`](pour-decisions)     | Pull the tap and fill to the line — but the head is mostly air, and it gives beer back as it falls. |
| [`skip-stop/`](skip-stop)               | Minimalist NYC subway map — race a local against an express and learn why it wins. |
| [`pixel-fog/`](pixel-fog)               | Rub a living mosaic off nine San Francisco views to find a fact hidden in each. |
| [`deep-pockets/`](deep-pockets)         | Digging game — mine ten strata to the core of the Earth, sell the loot, upgrade the shovel. |
| [`unbreakable/`](unbreakable)           | Tie a knot in real rope, close it, and let physics and knot theory decide whether it is one. |
| [`first-rakhi/`](first-rakhi)           | Tear a strip from a woven sari, thread by thread, and bind a cut with it. |
| [`cats-cradle/`](cats-cradle)           | The string game that needs two people — take the figure out of the other hands. |
| [`waveflow/`](waveflow)                 | XY performance pad — 25 synth voices, pitch up the screen, timbre across it. |

### Rakshabandhan set

`unbreakable`, `first-rakhi` and `cats-cradle` are three takes on one festival,
and none of them is a rakhi maker. The festival is a bond, a debt and a thing
passed between two people, so: a knot you tie and then have proved on you, the
cloth the first one was torn from, and a game that cannot be played alone. Each
is built on something real underneath — knot invariants, a loom and a crack tip,
and a simulated string loop — so the payoff is a fact about what you did, not an
animation of it.

### Generative art set

`strange-silk`, `morphogen`, `orrery`, `paper-loom` and `heartwood` are five
takes on the same brief — art made by an autonomous system, re-seeded on tap —
deliberately drawn from five different families so no two feel alike:
deterministic chaos, chemistry, music, graphic design, and botany. Each shows
its seed, and a tap anywhere throws a new one.

## Layout convention

**One folder per bit.** Every bit lives in its own directory named after it, and
nothing but this README sits at the repo root:

```
<bit-name>/
  plethora.json   # manifest: schemaVersion, runtime, entry, title, permissions, …
  main.js         # entry source defining window.plethoraBit
  README.md       # what the bit is, its files, and its contract notes
```

Keep `entry` as `"main.js"` in the manifest — it names the file at the *package*
root at upload time, which is independent of where the bit sits in this repo.

New bits follow this same shape; don't add bit sources to the repo root.

## Working on a bit

Fetch the current contract before writing code — these endpoints are the source
of truth, and they win over anything cached locally:

- `https://api.plethora.studio/v1/agent/context.md`
- `https://api.plethora.studio/v1/agent/sdk.md`
- `https://api.plethora.studio/v1/agent/schema.json`
- `https://api.plethora.studio/v1/agent/libraries.json`

Packaged assets are disabled (`maxAssets: 0`), so generate visuals and audio
procedurally or use approved pinned registry libraries.

### Upload-validator gotchas

Several constraints are enforced at upload but are not in `sdk.md`, and the
error message points at the wrong thing — unrelated problems all surface as one
complaint about unsupported remote resources and registry loaders. Found the
hard way, documented where they bit:

- `document.createElement("canvas")` — see [`cairn/`](cairn#what-the-upload-validator-rejects).
- Querying a canvas for its layout box, including *naming* that call in a
  comment — see [`cairn/`](cairn#what-the-upload-validator-rejects) and
  [`pixel-fog/`](pixel-fog).
- `addColorStop()` with a colour the validator cannot resolve to a literal —
  see [`heartwood/`](heartwood#what-the-upload-validator-rejects).
- `const ph = <call expression>` — the local's name alone. See
  [`pixel-fog/`](pixel-fog).

A rejected upload creates nothing, so probe uploads are free; unreachable code
is still scanned; and constructs that merely *look* exotic are usually fine if
some already-uploaded bit in this repo uses them. Both
[`pixel-fog/`](pixel-fog) and [`heartwood/`](heartwood#what-the-upload-validator-rejects)
record how to bisect a rejection cheaply.

### Rendering and physics gotchas

Not validator rules — runtime traps that cost real time here, all of which look
like art-direction or tuning failures until you find them:

- **`THREE.Color.setHex()` already converts to the linear working space.** A
  following `.convertSRGBToLinear()` converts twice and crushes saturated
  colours to near-black — invisible until you notice that changing a palette
  changes nothing.
- **`CanvasTexture` used as a colour map needs `colorSpace = SRGBColorSpace`.**
  Left at the default it is treated as linear and every warm texture comes out
  pale. Normal maps are the exception and should stay unset.
- **`sheen: 1` swamps the base colour.** A bright `sheenColor` over a dark base
  renders every palette the same warm gold. Silk still wants a sheen; it wants a
  dim one.
- **Vertex colours are linear**, so an on-screen flame orange is roughly
  `(1.0, 0.15, 0.02)`, not `(1.0, 0.5, 0.2)`.
- **A feedback reverb with two cross-fed delays has a loop gain of 2g**, so the
  feedback gain has to stay under 0.5 or the network diverges — silently for
  twenty seconds, then as a `BiquadFilterNode: state is bad` warning that points
  at whatever else you happened to be automating.
- **Verlet takes `a·dt²` per step.** A stray frame-rate factor in a gravity term
  destroys a cloth under its own weight before it is touched. See
  [`first-rakhi/`](first-rakhi#one-that-cost-a-round).
- **Gauss-Seidel only carries information as far as it sweeps.** Alternating the
  sweep direction each iteration is the cheapest way to get tension across a
  long chain — without it a pull never reaches the far end. Used in both
  [`first-rakhi/`](first-rakhi) and [`cats-cradle/`](cats-cradle).
- **Particles that integrate their drift wander off**, and one that drifts
  through the near plane fills the screen. Orbit a fixed home instead.

## Publishing

Publishing stays manual. An agent pairs with the creator at
<https://create.plethora.studio/agent-pair>, then `POST`s `{ source, manifest }`
to `/v1/agent/bits/drafts` with an `Authorization: Plethora-Agent <token>`
header. Drafts are reviewed and published from the Plethora app or dashboard.

Pairing is durable — the creator approves a code once and the agent reuses the
returned `accessToken` until it is revoked. Only the bootstrap exchange is
one-time, and the pairing code itself expires after 10 minutes, so mint it when
there is something ready to upload rather than at the start of the work.
