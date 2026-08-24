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

**The globe is a quad-sphere.** Six cube faces of 12×12 cells are projected out
to a sphere and tangent-warped (`tan(c·π/4)`) so the tiles come out close to
equal-area instead of bunching at the cube corners — 864 tiles, about 48 around
the equator, so a full lap on foot takes roughly 25 seconds.

Every position query goes through a unit direction vector, and `dirToTile()` is
the exact inverse of the forward mapping. That is what makes walking across a
cube seam free: there is no adjacency table anywhere, so the character, the
build target and the tile neighbours all cross face boundaries without a
special case.

**Terrain is banded by rank, not by threshold.** Elevation comes from continent
noise plus detail plus ridged noise biased toward high ground, then the values
are sorted and cut at fixed percentiles. Every seed therefore produces the same
pleasing land/sea balance — no planet ever comes out all ocean or all rock.

**Each tile is a prism on a sealing skirt.** The visible cap is inset to carve a
dark groove between neighbours; underneath it sits a full-width skirt whose
edges meet its neighbours' exactly. Without the skirt, grooves opened straight
through to the sea sphere and every gap between two pieces of land glowed blue.
Land bands also clear sea level by more than the groove depth, and the water's
swell is capped below that, so the sea can never break through a beach.

**Trees grow on wall-clock time.** Only the planting timestamp is stored, so
growth continues while the bit is closed: sprout → sapling → young tree → tree →
ancient tree, over about two hours. A stage change while you are watching gets a
chime and a sparkle.

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
- **Chunky rounded forms**, generous bevels, and narrow dark grooves so every
  facet catches a different amount of light.
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
