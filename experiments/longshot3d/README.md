# Longshot — a standalone Three.js marksman game

**This is not a Plethora Bit.** It is a browser game built to evaluate
[Thrixel](https://thrixel.com) via the [build-world](https://github.com/thrixel/build-world)
skill, and it loads `.glb` model files — which the Plethora contract forbids
(`maxAssets: 0`, and no network egress beyond `libs.plethora.studio`). It lives
here only because this is the repository the session had; it does not follow the
one-folder-per-bit convention in the root README and should probably move.

## What it is

A first-person marksman hunt on an open savanna. Real ballistics — a round
leaves the muzzle at 810 m/s and is then on its own, stepped under gravity every
3.5 ms — so at 500 m you hold over and you lead. Animals notice you in
proportion to how close you are, how fast you are moving, and how well the scrub
is hiding you, which is what makes crouching in a thicket a mechanic rather than
a pose.

Four rifles trade zoom against cycle time and sway. Score is species value times
hit zone times distance, so the long shot is the point.

## The two Thrixel assets

| | rifle | cheetah |
|---|---|---|
| tool | `create_model` | `sculpt_model` |
| raw | 5,356 tris / 302 KB | 74,195 tris / 10.5 MB |
| after free `reduce_triangles` | — | 3,008 tris |
| after `gltf-transform` (webp, 1K) | 208 KB | **411 KB** |
| parts, as generated | **48 named** — bolt, magazine, bipod legs, turrets | **1 merged mesh** |
| parts, in the shipped file | **8** — see the warning below | 1 |
| cost | ~66 cubes | 47 cubes |

### `gltf-transform optimize` silently destroys the part hierarchy

Thrixel delivered the rifle with 48 correctly named parts. The shipped
`rifle-web.glb` has **8**, because `gltf-transform optimize` runs a `join` pass
that merges meshes by material — `BoltHandle`, `Magazine` and `BipodLeg_L` are
now welded into `Cylinder002`. Nothing warns you; the file just gets smaller.

It cost nothing here, because the rifle is a static viewmodel. It would have
quietly removed the ability to animate a bolt cycle.

**Thrixel's own `reduce_triangles` does not do this.** `cheetah-parts.glb` went
through it and kept all 21 named parts including every leg. So: reduce with
Thrixel, and if you then run `gltf-transform`, pass `--no-join`.

That part-count row is the other finding. `create_model` returns an animatable
hierarchy and poor organic anatomy; `sculpt_model` returns excellent anatomy and
one welded lump. For a running animal neither is right on its own — the cheetah
here is animated by heading, bob and lean because it has no legs to swing, which
reads at sniping range and would not read at two metres.

Everything else — terrain, grass, scrub, acacias, boulders, sky, mountains,
clouds — is generated in code and costs nothing to download.

## Layout

```
main.js            entry: config -> systems -> boot -> prewarm -> shot -> ready
shots.js           the 8-shot review list, ground-relative
systems/render.js  renderer, fixed light rig, sky dome, fog, mountains, clouds
systems/world.js   height field, terrain, instanced scatter, concealment query
systems/assets.js  the two GLBs
systems/targets.js herd AI and detection; Thrixel and code-built animals
systems/weapons.js player, rifles, scope, sway, ballistics, viewmodel
systems/fx.js      tracers, impact dust, score pops
systems/ui.js      DOM HUD, scope reticle, touch controls
lib/               build-world's kit, unmodified
capture.mjs        drives the shot list headless and writes a report
```

## Running it

```bash
npm install                      # three only
python3 -m http.server 5288      # any static server; index.html uses an importmap
node capture.mjs shots/latest    # the review set
```

## Bugs worth knowing about

- The code-built warthog's proportions are still wrong; it reads as a crate.
  The zebra is fine.
- The ground is bare at close range. It needs a detail scatter pass.
- No audio.
- Not yet run through `mobilecheck` — the touch layer is wired but unverified
  on a real phone viewport.

## Three things that cost a round each

- **`config.capture` does not exist.** `configFromLocation()` returns `capture`
  *beside* `config`, not on it, and sets `config.deterministic`. Guarding camera
  control on `ctx.config.capture` therefore never fires, and every shot in the
  review set was silently the same framing.
- **The quality URL param is `q`, not `quality`.** Captures ran at the default
  preset while claiming to be `high`.
- **`autoClear` wipes the frame between passes.** Rendering the overlay scene
  after the main scene clears the colour buffer unless `autoClear` is turned off
  around it, so the world vanishes and only the viewmodel survives. The kit's
  example has the same shape but an empty overlay, so it never trips there.
