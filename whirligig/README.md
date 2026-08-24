# Whirligig

A mobile-first [Plethora Bit](https://create.plethora.studio) — a fidget
spinner built as a real gear train. A speckled paper plate is packed with
a couple of hundred concentric-ring discs; flick the plate and the whole
machine turns at once, every disc rolling against the discs it touches.

Visually it follows the primary-on-cream idiom of circle-packed generative
work — red, blue, gold, cream and white targets with ink hubs and thin
radial spokes. The palette was sampled from a reference image supplied by
the creator (u/mecobi's *Moving Parts 2*, r/generative); the code, motion
model and composition here are original.

## Files

| File            | Purpose                                                           |
| --------------- | ----------------------------------------------------------------- |
| `plethora.json` | Manifest (`plethora-bit@2`, runtime global `window.plethoraBit`).  |
| `main.js`       | The entry source (`entry: "main.js"`).                            |

## How the motion works

The machine is not a set of independently animated circles. Rates are solved
once, at build time, from the geometry of the packing:

1. **Pack the plate.** Greedy circle packing in the unit disc: each candidate
   grows until it touches its nearest neighbour or the rim. Because every disc
   ends up limited by something it touches, the resulting tangency graph is
   dense enough to behave like a real gear train.
2. **Find the meshes.** Two discs mesh when their centres sit within a small
   tolerance of `r_a + r_b` apart.
3. **Solve the train.** Breadth-first search from the largest disc, which the
   plate's rim drives through internal contact. Each mesh crossed applies the
   rolling-contact relation, so directions alternate and speeds scale by the
   inverse radius ratio:

   ```
   external mesh   omega_b = -omega_a * (r_a / r_b)
   internal mesh   omega_child = +omega_host * (r_host / r_child)
   ```

4. **Nest planets.** Discs above a size threshold carry small discs inside
   them. Those live in the host's *rotating* frame, so they orbit the host as
   it turns while spinning on their own axes from internal rolling contact.
5. **Compress for legibility.** Exact ratios span three orders of magnitude,
   which reads as noise once the plate is moving. Magnitudes are compressed
   toward the median (`|rate|^0.62`, capped) while every sign and the strict
   big-slow / small-fast ordering is preserved.

Every rate is stored per unit of plate speed, so a single flick drives the
whole train and the ratios hold at any speed.

### Multiple axes

The plate is a flat plane in 3D, orthographically projected. Each disc is
drawn by pushing an affine basis onto the canvas transform, so a circle
becomes the correct ellipse under tilt and one `arc()` call does the work.
The plane precesses about two further axes on incommensurate periods, and the
amplitude tracks speed: a fast plate stands up gyroscopically, a slow one
leans over and wanders like a settling coin.

## Feel

- **Direct manipulation** — drag turns the plate under your finger; release
  throws it with the pointer's angular velocity. A stalled finger is a hold,
  not a throw.
- **Long coast** — viscous bearing drag plus a small constant loss, so it runs
  down over roughly half a minute and never quite dies.
- **Spokes fade at speed** and sharpen as it settles, the way real spokes blur
  away; at rest they show every disc's exact phase.
- **Ratchet haptics** every quarter turn, rate-limited so it stays a texture.
- **Music tracks the machine** — the `drift` bed's tempo, intensity and volume
  follow plate speed, with `tap` on a flick and `powerup` on spinning up.
- **`↻` packs a brand-new machine**; **`?`** explains it point-wise.

## Contract notes

Built against agent context **`plethora-agent-context-2026-08-13.1`** using
only the documented `ctx` SDK surface:

- No packaged assets (`maxAssets: 0`) — the packing, the livery, the speckled
  paper texture and all audio are generated procedurally at runtime.
- No external dependencies and no network egress.
- Permissions declared for every gated API used: `haptics`, `backgroundMusic`.
  Both are guarded by `ctx.capabilities` and degrade silently.
- Surfaces via `ctx.createCanvas2D` / `ctx.createRoot`; all listeners, the
  single frame loop and music go through `ctx` so the runtime owns cleanup.
- The first frame is drawn before `ctx.platform.ready()`, so the bit is never
  blank; `ctx.platform.start()` fires on the first real gesture.
- Controls sit at the top, clear of `ctx.safeArea.bottom`.
- Source is pure ASCII, so no transport can mangle the glyphs.

## Uploading a draft

Publishing is intentionally manual. To upload as a draft, an agent pairs with
the creator at <https://create.plethora.studio/agent-pair>, then `POST`s
`{ source, manifest }` to `/v1/agent/bits/drafts` (API origin
`https://api.plethora.studio`) with an `Authorization: Plethora-Agent <token>`
header. See the agent context for the full pairing flow.
