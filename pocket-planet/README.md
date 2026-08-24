# Pocket Planet

A mobile-first [Plethora Bit](https://create.plethora.studio) — a tiny low-poly
globe that belongs to you. Walk a little character right around it, over
beaches, through forests and up snowy peaks, and shape it one tile at a time:
plant trees that keep growing in real time, lay winding paths, raise cottages,
hang lanterns that come on at dusk. Spin the globe, swim the sea, watch clouds
drift over your hills. Everything is saved, so every visit picks up exactly
where the last one left off.

## Files

| File            | Purpose                                                          |
| --------------- | ---------------------------------------------------------------- |
| `plethora.json` | Manifest (`plethora-bit@2`, runtime global `window.plethoraBit`). |
| `main.js`       | Entry source — the whole bit, rendered with `three`.              |

## How it works

**The planet is one continuous height field on a sphere.** Six cube faces of
48×48 quads are projected out and tangent-warped (`tan(c·π/4)`) so the mesh
stays even instead of bunching at the cube corners. Vertices are shared across
face seams through a quantised direction key, which is what keeps the twelve
cube edges from showing as lighting creases. Flat shading over that grid keeps
the low-poly facet character while the silhouette stays a proper sphere.

**Tiles are the placement grid, not the geometry.** 864 of them, about 48 around
the equator, so a full lap on foot takes roughly 25 seconds. Every position
query goes through a unit direction vector, and `dirToTile()` is the exact
inverse of the forward mapping. That is what makes walking across a cube seam
free: there is no adjacency table anywhere, so the character, the build target
and the tile neighbours all cross face boundaries without a special case. The
character samples the height field at its exact position rather than at the
tile, so a rise is a slope and not a staircase.

**Everything is banded by rank, not by threshold.** Elevation comes from
continent noise plus detail plus ridged noise biased toward high ground; the
values are then sorted and the sea is placed at a fixed percentile. Terrain
colours are cut on the same percentile scale. Every seed therefore produces the
same pleasing land/sea balance and the same biome proportions — no planet comes
out all ocean, and no planet comes out all beach.

**The sea is a patch of the planet's own vertex grid**, not a sphere laid over
it, and it fades out at the shoreline in alpha rather than stopping at a facet
edge. As a full sphere it covered every low-lying scrap of land and washed the
world out with a milky film; clipped on facet boundaries instead, every coast
came out visibly serrated. The swell is stilled toward the shore by the same
depth attribute that drives the fade.

**Trees grow on wall-clock time.** Only the planting timestamp is stored, so
growth continues while the bit is closed: sprout → sapling → young tree → tree →
ancient tree, over about two hours. A stage change while you are watching gets a
chime and a sparkle.

## The loop

The bit was a pure sandbox at first and played as aimless, so it now has a
spine:

- **Wishes** are the direction. One is always shown top-left with a progress
  bar. Every wish is checked against the current state of the planet rather
  than a lifetime counter, so they survive a reload with no extra bookkeeping
  and stay forgiving if you tear something down. The first two dozen are
  authored so the pacing lines up with the unlocks; after that they generate.
- **Seeds** are the economy. They come from harvesting ripe trees, and they
  pay for everything except planting, which stays free.
- **Tools unlock** as wishes are granted, so the palette opens up instead of
  arriving all at once.

The action button is contextual — it does whatever the tile in front of you
calls for. A ripe tree becomes **Harvest**, a young one becomes **Tend** (a
seed to hurry it along), bare ground places the selected tool. That gives the
verbs somewhere to live without a second row of buttons.

A fresh planet already carries about a hundred wild trees, and those are
harvestable too: harvesting one yields seeds and makes it yours. Without that,
a new player could spend their opening seeds and then have no way to earn more
until something ripened two hours later.

## Persistence

Two layers, whichever is newer wins on load:

- `ctx.storage` — fast, device-local.
- `ctx.memory.local("planet")` — durable and cross-device.

Placements pack to a fixed 7 characters per tile (2 base64 index, 1 type digit,
4 base64 minutes-since-2020). A completely built planet — all 864 tiles — packs
to 6048 characters, 6125 bytes of JSON, comfortably inside the platform's 8 KB
local-state limit. The planet seed is saved too, so the same world regenerates
every visit.

## Art direction

Built on established cozy-diorama practice rather than invented from scratch:

- **Value first, hue second** (Dorfromantik) — terrain bands are separated by
  luminance before colour, so the planet reads even in greyscale.
- **One warm key, one cool fill** (Tiny Glade) — a single orbiting sun with soft
  shadows plus a hemisphere bounce does nearly all the shaping.
- **Chunky rounded forms** and flat-shaded facets, so every plane catches a
  different amount of light without the world turning into blocks.
- **Real-time growth stages** (Petit Planet, Little Planet) so the world keeps
  changing between visits.

## Contract notes

Built against agent context **`plethora-agent-context-2026-08-13.1`** using only
the documented `ctx` SDK surface:

- **No packaged assets** (`maxAssets: 0`) — every mesh, colour, sound and the
  entire terrain are generated procedurally at runtime.
- Single pinned registry dependency, **`three@0.164.1`**, loaded via
  `ctx.importModule` (no public CDNs, no network egress).
- Permissions declared for exactly the gated APIs used, no more:
  `haptics`, `backgroundMusic`, `audio`, `storage`.
- A `local` memory channel (`planet`) for the durable save and a `number`
  record (`life`, descending, integer) for the Planet Life leaderboard.
- Adaptive quality: sustained slow frames drop the shadow map, then disable
  shadows and lift the fill light to compensate.

## Uploading a draft

Publishing is manual. An agent pairs with the creator at
<https://create.plethora.studio/agent-pair>, then `POST`s `{ source, manifest }`
to `/v1/agent/bits/drafts` (API origin `https://api.plethora.studio`) with an
`Authorization: Plethora-Agent <token>` header.
