# The First Rakhi

A mobile-first [Plethora Bit](https://create.plethora.studio) — tear a strip
from a woven sari, thread by thread, and bind a cut with it. The cloth is
genuinely woven and genuinely torn.

पहली राखी — Krishna cut his finger on the Sudarshana chakra; Draupadi tore a
strip from her sari and bound it, and he owed her forever. That strip is the
first rakhi anybody tells you about.

## Files

| File            | Purpose                                                           |
| --------------- | ----------------------------------------------------------------- |
| `plethora.json` | Manifest (`plethora-bit@2`, runtime global `window.plethoraBit`).  |
| `main.js`       | The entry source (`entry: "main.js"`).                             |

## The cloth is woven, not textured

Thirty-two warp threads and forty-two weft threads, each one an actual ribbon in
the scene, each crossing riding in front of or behind its neighbour by the
parity of `i + j` — so the weave is visible if you look closely, and the light
catches the undulation.

The **pattern is not a texture**. Warp threads carry one colour sequence and
weft threads another, and the stripes, checks, selvedge and zari border are what
happens where those two sequences meet. That is what a loom is, and it means a
new sari every time from six palettes and a handful of numbers — Kesari,
Indigo, Emerald, Saffron, Magenta, Aubergine.

Shading is per-node: a normal from the four neighbours, dotted with a fixed
light, so folds and slack read properly across a mesh that is drawn with an
unlit material.

## The tear is a crack, not a script

Underneath is a mass-spring net with breakable links. Weft links — what holds
one warp thread to the next — part sooner than warp links, which is why tears
run down the grain rather than across it.

There is a nick already in the hem, because that is how cloth is torn: you notch
it, then pull, and the crack runs on its own. Three things make that work:

- **Crack-tip weakening.** A weft thread with a break already beside it —
  including diagonally — parts at 70% of the usual strain. That is the stress
  concentration a real crack tip has, and it is what makes a tear *run* instead
  of stopping. The diagonal neighbours are what let it wander toward wherever
  you are pulling, so a straight pull gives a clean strip and a crooked one
  gives a ragged one.
- **Alternating solver sweeps.** Gauss-Seidel only carries information as far as
  it sweeps, so a pull at the hem never reached a crack tip twenty rows up.
  Reversing the sweep direction on every other iteration walks it the whole way.
- **Cloth only tears while it is pulled.** Position-based constraints converge
  slowly down a long chain, so the top rows stay stretched and the cloth would
  otherwise tear itself apart hanging. Breaking is gated on an active grab,
  which is both stable and true: cloth does not tear on its own.

When the tear is done a flood fill decides what came away — and it has to be a
long piece, spanning most of the height, or a torn-off corner would end the
story on a scrap. Those threads then wind themselves twice round the cut, the
rest of the sari is let go of and falls out of frame, and the bleeding stops.

## Sound

Every broken thread gets its own short bandpassed burst, pitched by where on the
cloth it broke, with a budget so that a cascade of forty at once does not clip.
Dozens a second is what a tear actually sounds like. Under it: cloth rustle that
follows the pull, a low drone, and a bell when the strip is bound.

## Contract notes

Built against agent context **`plethora-agent-context-2026-08-13.1`** using only
the documented `ctx` SDK surface:

- Dependency: `three@0.164.1` via `ctx.importModule`, with the exact registry
  URL literal as a fallback.
- No packaged assets (`maxAssets: 0`) and no network egress.
- Permissions declared for every gated API used: `audio`, `backgroundMusic`,
  `haptics`, `storage`.
- Each thread span owns its six vertices rather than sharing them, so a thread
  that snaps collapses just the span that broke.
- A ribbon's across-direction is taken from the thread's own direction crossed
  with the view, not hard-coded per thread family — otherwise the weave looks
  correct while the cloth is flat and falls apart the moment the strip wraps
  around an arm.
- Pointer positions come from `event.offsetX`/`offsetY`; no canvas layout
  queries, no bare timers, no host-document access.

### One that cost a round

Verlet integration takes `a·dt²` per step. A stray factor of 60 in the gravity
term tore the cloth to pieces under its own weight before anybody touched it —
which looks exactly like a broken break-threshold, and is not.

## Verified

Driven headless in Chromium against a mock `ctx` built strictly to `sdk.md`: the
cloth hangs stably with nothing torn, a pull opens the nick and the tear runs up
the grain thread by thread, the thread counter and progress track it, a full
tear frees a strip and fires `milestone` and then `complete`, the rest of the
sari falls away, the strip binds the cut, and "Another sari" reweaves — no
runtime errors, no console warnings.

## Uploading a draft

Publishing is manual. An agent pairs with the creator at
<https://create.plethora.studio/agent-pair>, then `POST`s `{ source, manifest }`
to `/v1/agent/bits/drafts` (API origin `https://api.plethora.studio`) with an
`Authorization: Plethora-Agent <token>` header.
