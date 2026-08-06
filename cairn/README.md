# my-bits

Plethora Bits — tiny mobile-first interactive objects built to the
[Plethora Bit agent contract](https://create.plethora.studio) (`plethora-bit@2`).

## Cairn

Zen rock balancing with real physics. Stack stones on a plinth in shallow water,
one at a time, for as long as your patience holds.

The feel is the point:

- **The stone rides above your finger.** Tap *beside* a stone and you carry it
  from its centre, keeping the offset you grabbed at, so your fingertip is never
  covering the thing you are trying to balance. It eases up far enough to clear
  your finger and no further.
- **Tap the stone itself and you grip it there.** A soft point constraint ties
  your finger to that exact spot with rotation left free, so it swings under
  gravity like a real one — grab it high and it steadies itself, grab it
  off-centre and it tilts on purpose.
- **Press down to seat it.** The hand has a *bounded* force, so leaning on a
  stone pushes load all the way down the cairn to the plinth: press gently and
  the stack takes it, press too hard and you shove the whole thing over. A gauge
  beside the stone reads the press, and the contact points glow with the load
  they're actually carrying — read straight off the solver.
- **Let go and watch it wobble.** When the cairn goes quiet the stone scores.
  Grab it again mid-wobble if you have to.
- **A second finger steadies a lower stone**, the way your other hand does in
  real life. Two fingers on the held stone twist it.

### Stones

Eight stone types, each a procedurally generated convex polygon with its own
silhouette, baked texture, density, friction and voice — **river stone** (smooth,
mottled), **slate** (broad strata slabs that make a fresh platform), **granite**
(speckled), **basalt** (angular, faceted), **sandstone** (warm banded),
**quartz** (crystalline, slick, high value), **obsidian** (glossy, slicker
still, highest value) and **moss stone** (grippy, worth a bonus). Stones shrink
and get stranger as the cairn grows.

### Modes

Each has its own global leaderboard.

| Mode | ×  | What changes |
| ---- | -- | ------------ |
| 🪷 **Zen**   | 1.0 | Still air, forgiving stone, 3 slips. Strong placement assist. |
| 🌊 **Tide**  | 1.6 | The plinth swells with the sea, harder the taller you build. 1 slip. |
| ⛈️ **Storm** | 2.4 | Gusts (warned a beat ahead), tremors, slick stone, no assist, no slips. |

Only a fallen cairn ends a run — a stone that slips off costs a slip, not the
run.

### Sound

Everything is synthesized; there are no packaged assets.

Stone is heavily damped and almost unpitched, so a strike is **entirely filtered
noise** — no oscillators, which are exactly what make a synthesised knock sound
like a woodblock. Each hit is a two-millisecond contact tick, two or three short
inharmonic resonances, and a dull lowpassed body, all scaled by the stone's size
and material: a big sandstone thuds, a small quartz pings.

Measured by rendering each material through an `OfflineAudioContext` (decay from
peak, spectral centroid, and tonality as the strongest bin's share of total
energy):

| | old | new |
| --- | --- | --- |
| decay to −40 dB | 48–128 ms | 7–21 ms |
| spectral centroid | 229–662 Hz | 543–2645 Hz |
| tonality | 0.17–0.45 | 0.08–0.23 |

The old version's centroid sat below 700 Hz — under a phone speaker's useful
range — and granite scored 0.45 tonality, which is the "bong" you could hear.

Placing a stone rings a **struck singing bowl** (inharmonic partials, two
detuned voices each so it beats), pitched up the pentatonic scale as the cairn
grows, with a deeper bowl every fifth stone. Dragging a stone across another
runs a grinding bed driven by the solver's tangential contact speed. Falling
stones splash and a collapse rumbles, over a `ctx.music` bed per mode.

## Physics

The registry has no 2D rigid-body engine — `ammo.js` and `oimo` are 3D, and
Phaser 4's Arcade physics is AABB-only with no rotation — and irregular
polygon-on-polygon contact *is* the mechanic here, so the solver is written in
`main.js`, in the Box2D-Lite shape:

- SAT for convex polygons, picking the axis of least penetration, with a bias
  toward the previous reference face so the choice doesn't flip frame to frame.
- Contact manifolds by clipping the incident face against the reference face's
  side planes, giving up to two points with stable feature ids.
- Sequential impulses with accumulated normal/friction impulses, Coulomb
  clamping, Baumgarte position bias and **warm starting** across frames — which
  is what makes a tall stack stand still instead of buzzing.
- Fixed 1/140 s substeps with an accumulator, 16 relaxation passes.
- Grab is a soft point constraint with a max force; steadying a stone is heavy
  per-body damping; the plinth is a kinematic body whose scripted velocity the
  contacts see, which is how the tide drags stones along with it.

## Files

```
cairn/
  plethora.json   # manifest: permissions, three record channels
  main.js         # the whole bit
  README.md
```

## Contract notes

- Permissions: `audio` (synthesized stone voices via Web Audio),
  `backgroundMusic` (`ctx.music` bed), `haptics`, `storage` (personal bests).
- Memory: three `records` channels — `zen_stack`, `tide_stack`, `storm_stack` —
  one leaderboard per mode, submitted once at the end of a run.
- No dependencies, no packaged assets: shapes, textures, scenery and audio are
  all generated at runtime.
- Stone textures and their soft contact shadows are baked once at creation, and
  the sky is baked per mode, so a frame is drawImage calls rather than gradient
  fills. Bakes go to an `OffscreenCanvas` via `makeSurface()`. If a WebView has
  no `OffscreenCanvas` that returns null and every bake site falls back to
  drawing live: flat-shaded polygons, no contact shadows, sky painted per frame.
  Plainer, fully playable, never blank.

### What the upload validator rejects

Two constraints cost several upload rounds to find, and neither is in
`sdk.md`. Both were confirmed by bisecting real uploads:

- **`document.createElement("canvas")`** → *"Direct document/body access is not
  allowed. Use ctx.createCanvas()."* `ctx.createCanvas()` is not actually the
  fix for offscreen work — it mints a display surface the runtime mounts in the
  container. `OffscreenCanvas` is accepted and is what this bit uses.
  `document.createElement` with a **literal** `"div"`/`"button"` is fine.
- **`canvas.getBoundingClientRect()`** → *"This bit uses unsupported remote
  resources…"*, a message that names the loader APIs and gives no hint that
  layout access is the cause. Use `event.offsetX` / `offsetY`, which are already
  canvas-relative and skip a forced reflow per pointer event anyway.

Changed in passing while hunting the above, and worth keeping regardless
though neither was independently confirmed as a trigger: timers go through
`ctx.timeout` rather than bare `setTimeout`, and the contact shadow's soft edge
is built from concentric strokes rather than the canvas blur-filter property
(which also accepts `url(#…)`).
