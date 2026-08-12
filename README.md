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
| [`perfect-drop/`](perfect-drop)         | ASMR timing toy — release a water drop just right for the perfect plink.    |
| [`cairn/`](cairn)                       | Zen rock balancing — stack stones with real physics, three modes, three boards. |
| [`strange-silk/`](strange-silk)         | Bend a chaotic flow with your finger and watch particles form strange attractors. |

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
