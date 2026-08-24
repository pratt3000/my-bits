# Last Straw

**Twenty-six thousand straws. One needle. Somewhere in there.**

A 3D haystack you take apart by hand. Orbit it, tap a straw to pull it out, or
press and hold to burrow a shaft into the pile. Somewhere inside is a sewing
needle. Six pieces of worthless junk are in there too, and they glint exactly
like the real thing.

It is meant to be a long sitting. The dig saves itself, so you can leave the
haystack half-demolished and come back to it.

## Files

| File            | What it is                                                       |
| --------------- | ---------------------------------------------------------------- |
| `plethora.json` | Manifest — `plethora-bit@2`, permissions, `three@0.164.1`, memory |
| `main.js`       | Entry source defining `window.plethoraBit`                        |

## How it plays

- **Drag** to orbit, **pinch** to zoom, **two fingers up/down** to raise or
  lower your eye level.
- **Tap** a straw to pull it out. **Press and hold** to burrow — the rate ramps
  from ~3/s up to ~5/s the longer you hold, and sliding while burrowing steers
  the shaft instead of turning the camera.
- Only what you can actually see can be pulled. The pick returns the nearest
  straw along the ray, so the pile peels from the outside in and a sustained
  hold bores a visible tunnel.
- **Warmth** is the only hint. Every straw you pull reports its distance to the
  needle, and the meter reacts inside 1.55 units — about 2% of the pile. The
  white tick marks the closest you have ever been.
- The needle **glints** when a clear line opens between it and the camera. So
  does every piece of junk.
- Burrowing **cannot** win the game: if the shaft runs into the needle it stalls
  ("your hand closes on something that is not hay") rather than claiming it.
  Taking the needle has to be a deliberate tap.

## How long it takes

Measured by running a simulated player against the real build — one that can
only read what is on screen (the warmth meter, the glint) and drives the same
pointer events a thumb would. Eight runs, all solved:

| | straws pulled | time |
| --- | --- | --- |
| luckiest | 668 | 3 min |
| median | 10,623 | **52 min** |
| worst | 17,352 | 89 min |

The spread is the point: the leaderboard is *fewest straws*, so a lucky early
shaft is worth bragging about, and a bad run turns into a grudge. Clearing all
26,000 straws would take roughly an hour and a half of solid burrowing, which is
the practical ceiling.

## How it is built

Everything is procedural — `maxAssets` is 0, so there is not a single packaged
byte of art or audio.

**The pile.** 26,000 straws in one `InstancedMesh`. Positions are sampled
uniformly by volume inside a domed-cone profile, and each straw is oriented in
the local tangent plane near the surface (thatch) blending to a jumble deeper
in. Per-straw colour is darkened by distance from the hull, which is what makes
a fresh shaft read as a dark tunnel instead of a hole.

**Live straws stay packed.** Slots `[0, liveCount)` are always live. Removing a
straw swaps the last live one into the hole and decrements `mesh.count`, so the
GPU never draws a gap and picking only walks straws that still exist. Only the
16 floats that actually changed are re-uploaded, via `addUpdateRange`.

**Picking is custom.** `InstancedMesh.raycast` would test all 26,000 instances;
instead each straw is treated as a capsule with a bounding-sphere reject, a
`b - h >= bestT` early-out, and an exact ray/segment closest-approach test. The
needle and the junk are tested in the same pass as spheres, which makes
occlusion fall out for free: if hay is in front, the hay has the smaller `t` and
you pull hay.

**Sound** is synthesised into `data:` URLs at boot — six noise-burst straw
rustles and a set of struck-metal tings — layered under a `ctx.music` bed.

**Saving.** Which straws are gone is a bitfield, base64'd to about 4.3 KB, plus
three seeds (field, pile layout, hiding places). The entire 26,000-object scene
is a pure function of those seeds, which is why the save stays inside the
8192-byte `memory.local` ceiling. `ctx.storage` is the primary copy and the
platform channel is the cross-device backup.

## Contract notes

- Runtime `plethora-bit@2`, entry `main.js`, one dependency: `three@0.164.1`,
  loaded with `ctx.importModule` and falling back to the exact registry URL.
- Permissions: `haptics`, `backgroundMusic`, `audio`, `storage` — all four are
  used, and nothing else is touched. No camera, microphone, or motion.
- Memory: two record channels (`fewest_straws` ascending, `fastest_find` as a
  duration) and one `local` channel for the dig in progress.
- First frame is a DOM loading card, then `ctx.markVisualReady` /
  `ctx.platform.ready`; `ctx.platform.start` fires on the first real tap.
- Offscreen texture surfaces come from `ctx.createCanvas2D`, never
  `document.createElement`.
- Bottom of the screen carries only a transient hint chip, clear of
  `ctx.safeArea.bottom`.

### A note on `instanceColor`

In three r164 `color_pars_fragment` declares `vColor` under `USE_COLOR_ALPHA` or
`USE_COLOR` only — **not** `USE_INSTANCING_COLOR`. Setting `setColorAt` alone
tints nothing. The straw material therefore sets `vertexColors: true` *and* the
geometry carries a unit `color` attribute, so `vColor = 1.0 * instanceColor`.

## Tuning

The length of a hunt is governed by a handful of constants at the top of
`main.js`:

| Constant                      | Effect                                                    |
| ----------------------------- | --------------------------------------------------------- |
| `STRAW_COUNT`, `STACK_R/H`     | Size of the search space and how much hay a shaft costs    |
| `W_WARM`, `W_RANGE`            | How much of the pile the hint covers — the strongest lever |
| `HOLD_SLOW_MS`, `HOLD_FAST_MS` | Burrow cadence, so how long clearing hay takes             |
| `DECOY_COUNT`                  | How many false glints are in there                         |

Widening `W_RANGE` collapses the search dramatically; it is quadratic in the
fraction of the pile the meter covers.
