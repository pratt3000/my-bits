# Heartwood

A mobile-first [Plethora Bit](https://create.plethora.studio) — a tree that
grows itself. Not a fractal: a cloud of invisible points is scattered into the
air and the wood reaches for whichever ones are nearest, using each up as it
arrives. Tap to grow another.

## Files

| File            | Purpose                                                           |
| --------------- | ----------------------------------------------------------------- |
| `plethora.json` | Manifest (`plethora-bit@2`, runtime global `window.plethoraBit`).  |
| `main.js`       | The entry source (`entry: "main.js"`).                             |

## The autonomous system

**Space colonization** (after Runions et al.). Attractor points are scattered
into a seeded crown volume; each iteration, every live attractor pulls on its
nearest node within reach, each pulled node grows one step along the average of
its pulls, and any attractor a branch has reached is consumed.

That single rule — reach for the light you can actually reach — is enough to
produce trunks, forks, limbs competing for the same space, and a crown that
fills its volume, because it is roughly the rule a real tree uses. It is not a
recursive template, so no two trees have the same silhouette and none of them
look like a copy of themselves at a smaller scale.

- **Leonardo's rule for thickness.** A limb's cross-section equals the sum of
  the limbs it carries (`w^2.15`), computed bottom-up in one reverse pass, since
  children always come after parents in the node array.
- **A uniform grid over the nodes** keeps the nearest-node search local: cells
  are one attraction radius wide, so each attractor only tests a 3×3
  neighbourhood instead of every node.
- **Five crown shapes** — round, vase (hollow centre), column, weeping (cloud
  pulled down at the edges), windswept — and eight seasons: Spring, Summer,
  Autumn, Winter (bare, snowing), Jade, Ember, Ghost, Ink.

## Features

- **Tap anywhere** to grow another — new crown, season and silhouette.
- **Drag to paint light.** Attractor points land under your finger and the
  nearest wood reaches for them — the same rule the tree grew by, so a branch
  you draw is real growth, not a decal. During the stroke new twigs appear at a
  provisional width; on release every limb upstream is re-thickened by
  Leonardo's rule and the bake is repainted once, rather than on every frame.
  Leaves are keyed to their node, so foliage does not reshuffle when you add to
  a tree: tips that grew a branch lose their leaves, new tips gain some.
- **It grows in front of you.** The tree is solved instantly, then revealed
  generation by generation over ~2.6 s so you watch it reach outward.
- **Wind.** The whole tree pivots at its base like a real one, and each leaf
  flutters on top of that with its own phase and amplitude. Leaves lie *along*
  the twig that carries them, not across it.
- **Air** — petals, pollen, snow or embers, matched to the season.
- Ambient music bed and haptics on reseed, both capability-gated.

## Contract notes

Built against agent context **`plethora-agent-context-2026-08-13.1`** using only
the documented `ctx` SDK surface:

- No packaged assets (`maxAssets: 0`), no dependencies, no network egress.
- Permissions declared for every gated API used: `haptics`, `backgroundMusic`.
- Limbs are baked once into an **`OffscreenCanvas`** as they are revealed, so a
  steady-state frame is one `drawImage` plus the leaves, not a few thousand
  path fills. Where `OffscreenCanvas` is missing the limbs are drawn live each
  frame — heavier, identical picture.
- Limbs are tapered quads rather than stroked lines: a trunk can be forty times
  thicker than a twig without the joins showing.
- Overlay markup is declared on the `ctx.createRoot()` element and queried back
  out via `data-el` attributes. No host-document access, no bare timers.

### What the upload validator rejects

Like `cairn/`, this bit cost several upload rounds to a rule that is not in
`sdk.md` and whose error message points somewhere else entirely:

- **`gradient.addColorStop(offset, <colour it cannot resolve>)`** →
  *"This bit uses unsupported remote resources. Use ctx.loadScript(),
  ctx.importModule(), or ctx.loadFont()…"*. The message names the loader APIs;
  the actual cause is a colour argument the validator cannot trace to a literal.
  These colours come from the season table at runtime, so the sky, ground and
  contact shadow are now painted as narrow bands and concentric discs instead of
  with `CanvasGradient` objects. Gradients themselves are fine —
  `orrery/` uses several — as long as every stop colour is resolvable.

Two things worth knowing if you go hunting for one of these yourself:

- **Bisect with a known-good corpus, not intuition.** `Map`, `.get()`, `.set()`,
  `ellipse()`, `atan2`, `while`, `sort()` and `OffscreenCanvas` all read as
  suspicious and are all innocent — they appear in `cairn/` and `perfect-drop/`,
  which upload fine. Diffing against bits that already passed kills most
  hypotheses for free.
- **A rejected upload creates nothing**, so probes are cheap, and unreachable
  code is still scanned — a minimal bit plus a chunk of the real source in a
  never-called function localises the trigger without shipping anything. Just
  don't assume a single culprit: a plain binary search reports the wrong
  statement when the trigger is a *combination* (here, creating a gradient
  **and** giving it an unresolvable stop).

## Uploading a draft

Publishing is intentionally manual. To upload as a draft, an agent pairs with
the creator at <https://create.plethora.studio/agent-pair>, then `POST`s
`{ source, manifest }` to `/v1/agent/bits/drafts` (API origin
`https://api.plethora.studio`) with an `Authorization: Plethora-Agent <token>`
header. See the agent context for the full pairing flow.
