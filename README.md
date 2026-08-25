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
| [`pen-fight/`](pen-fight)               | The desk duel in 3D — flick your gold pen to shove your rival's off the table. |
| [`mandelbrot/`](mandelbrot)             | Pinch 68 levels into the Mandelbrot set, and hear each point's orbit sing.  |
| [`n-body/`](n-body)                     | Gravity you can throw — grow a world, launch it, watch orbits and collisions form. |
| [`wave-interference/`](wave-interference) | Two fingers become wave sources — watch the fringes, hear them beat.       |
| [`turing-soup/`](turing-soup)           | Reaction–diffusion dish — drag to inject, steer feed/kill, watch coral grow.  |
| [`boids/`](boids)                       | A murmuration of thousands — your finger is the predator, or the attractor.  |
| [`ripcord/`](ripcord)                   | Spin your phone — the gyroscope sets your top's RPM, then it battles two rivals. |
| [`backseat-rain/`](backseat-rain)       | Sit in the back seat of a car in the rain and race the drops down the window. |
| [`ball-pool/`](ball-pool)               | Eight-ball pool — aim, spin, and break against a bot, or pass the phone.    |
| [`pour-decisions/`](pour-decisions)     | Pull the tap and fill to the line — but the head is mostly air, and it gives beer back as it falls. |
| [`skip-stop/`](skip-stop)               | Minimalist NYC subway map — race a local against an express and learn why it wins. |
| [`pixel-fog/`](pixel-fog)               | Rub a living mosaic off nine San Francisco views to find a fact hidden in each. |
| [`deep-pockets/`](deep-pockets)         | Digging game — mine ten strata to the core of the Earth, sell the loot, upgrade the shovel. |

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

## Publishing

Publishing stays manual. An agent pairs with the creator at
<https://create.plethora.studio/agent-pair>, then `POST`s `{ source, manifest }`
to `/v1/agent/bits/drafts` with an `Authorization: Plethora-Agent <token>`
header. Drafts are reviewed and published from the Plethora app or dashboard.

Pairing is durable — the creator approves a code once and the agent reuses the
returned `accessToken` until it is revoked. Only the bootstrap exchange is
one-time, and the pairing code itself expires after 10 minutes, so mint it when
there is something ready to upload rather than at the start of the work.

## Known upload-validator false positives

The validator reports several unrelated problems with one message about
unsupported remote resources and registry loaders. Collected so far:

- `document.createElement("canvas")` — see [`cairn/`](cairn).
- Querying a canvas for its layout box, including *naming* that call in a
  comment — see [`cairn/`](cairn) and [`pixel-fog/`](pixel-fog).
- `const ph = <call expression>` — the local's name alone. See
  [`pixel-fog/`](pixel-fog), which also records how to bisect a rejection.
