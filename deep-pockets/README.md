# Deep Pockets

A digging game. One small plot of land, one rusty trowel, and the core of the
Earth a thousand metres straight down — with a great deal of money in the way.

Press and drag anywhere to steer. Push into dirt and you dig it; push into
tunnel and you walk it. Fill your backpack, haul it up, sell the lot, buy a
shovel that can chew through the next stratum, and go back down. Somebody is
waiting at the bottom. He has been waiting a while.

A full run to the core takes roughly **40–60 minutes**, and it saves as you go —
the shaft, the money, the bones, all of it.

## The loop

1. **Dig.** Every tile you break can drop something. In the topsoil that means
   pebbles, worms, bottle caps and somebody's boot. It gets better.
2. **Fill up.** The backpack starts at ten slots and stops taking things when
   it's full.
3. **Get back up.** Climb your own shaft, spend a rope ladder, or — once you can
   afford it — the Return Winch, which does it for nothing, forever.
4. **Sell.** Pinch & Sons is the hut on the grass. Walk onto it and the shop
   button appears.
5. **Upgrade**, and go deeper. The rock gets harder every stratum, so the shovel
   is the real progress bar.

Nobody can be stranded: 🪢 always gets you out. Without a rope, Pinch's lad
lowers a hook and keeps what's in your bag as payment — and it asks first.

## The ten strata

| Depth | Stratum | Rock | Needs | What's in it |
| ----- | ------- | ---- | ----- | ------------ |
| 1–40 | Topsoil | Topsoil | Trowel | pebbles, worms, bottle caps, crisp packets, a boot, a lost coin |
| 41–110 | Clay Beds | Clay | Spade | clay lumps, flint, coal, iron |
| 111–200 | Limestone Caverns | Limestone | Spade | copper, silver, fossil shells, amber. Caves begin. |
| 201–320 | Deep Rock | Granite | Pick | gold, amethyst, jade. Boulders and gas. |
| 321–450 | Crystal Vaults | Quartzite | Drill | emerald, sapphire, split geodes |
| 451–600 | The Abyss | Basalt | Auger | obsidian, black opal, diamond. First lava. |
| 601–720 | Fossil Strata | Bone Shale | Auger | ruby, ancient coins, trilobites |
| 721–870 | Magma Shelf | Magmastone | Cutter | magmatite, meteorite. **Needs an Asbestos Coat** or the heat cooks you. |
| 871–990 | The Mantle | Mantle Rock | Corebreaker | mythril, starstone, void crystal. **Needs Coreplate.** |
| 991–1000 | The Core | Core Shell | Corebreaker | Gary. |

Seven shovels (Rusty Trowel → Steel Spade → Miner's Pick → Tungsten Drill →
Diamond Auger → Plasma Cutter → Corebreaker), six backpacks, five lanterns, four
boots, four suits. Plus a Mine Cart that drops you back to your deepest tunnel,
a Return Winch, and a Dowsing Rod that makes ore and fossils glow *through* solid
rock.

## What's down there besides ore

- **Seven treasure halls**, wide carved chambers at set depths with pillars and
  chests. Chests pay cash and usually something else — dynamite, a med kit, a
  rope, a handful of the local ore.
- **Eight dinosaur bones**, one per stratum below the topsoil, with the museum
  tent listing the depth band each one is hiding in. Bring all eight and the
  curator assembles Terrence, who is worth $150,000 and a permanent 15% on
  everything you sell after.
- **Boulders** that fall the moment you dig out from under them, and land on
  your head if you're slow. You can shove them sideways, or blast them.
- **Gas pockets** that detonate when broken, and **lava** that does not care.
- **Flags at the core** left by everyone else who has made it that far.

## Controls

One thumb does all of it. The stick spawns wherever you press and steers from
there, so it works left- or right-handed and never sits under your hand. Three
buttons live top-right (sound, leaderboards, instructions), and the contextual
action button plus 🧨 and 🪢 sit above the bottom safe area.

On a keyboard: arrows or WASD, **space** for dynamite, **E** to use what you're
standing on.

## Files

```
deep-pockets/
  plethora.json   # manifest: permissions, memory channels
  main.js         # the whole bit
  README.md
```

## Contract notes

- `plethora-bit@2`, no dependencies, no packaged assets. Every tile texture,
  every piece of scenery and every sound is generated at runtime.
- **Permissions:** `audio` (the synthesised dig/ore/blast cues), `backgroundMusic`
  (`ctx.music`, whose preset changes with the stratum you're in), `haptics`,
  `storage`.
- **Memory:**
  - `local.progress` — the durable save, minus the tunnel map, so it stays a few
    hundred bytes.
  - `records.depth` / `records.fortune` / `records.core_run` — deepest dig,
    lifetime earnings, and fastest time to the core.
  - `tallies.verdict` — asked once, at the core.
  - `worlds.flags` — a `points` world; reaching the core plants your flag and
    shows you everyone else's, in the chamber itself.
- **Saving.** The world is generated from a seed, so a save is the seed plus your
  progress plus a run-length encoded mask of which tiles you removed. The mask is
  walked column-major, which collapses a vertical shaft into a single run — a
  fully dug thousand-metre plot comes to a few kilobytes. The full save with the
  mask goes to `ctx.storage`; the same save without it goes to `memory.local`,
  which is capped at 8 KB.
- **Lighting.** Tiles you have never lit are drawn as a flat wash of the
  stratum's colour, so you can sense the bands ahead without seeing what's in
  them. Darkness is one black layer with the lamp punched out of it with
  `destination-out` on an `OffscreenCanvas`, composited at an alpha that ramps
  with depth. Without `OffscreenCanvas` it degrades to a flat dim.

### What the upload validator rejects

Inherited from earlier bits in this repo, and worth restating because none of it
is in `sdk.md`:

- **`document.createElement`** — *"Direct document/body access is not allowed."*
  The whole overlay is declared as markup on the `ctx.createRoot()` element and
  the handles are queried back out via `data-el` attributes. Offscreen bakes (the
  tile atlas, the sky, the darkness layer) go to an **`OffscreenCanvas`**;
  `ctx.createCanvas` is not a substitute, since it mints a display surface the
  runtime mounts in the container.
- **`canvas.getBoundingClientRect()`** — reported as *"unsupported remote
  resources"*, which says nothing about layout access. Pointer positions come
  from `event.offsetX` / `offsetY` with `setPointerCapture`, which are already
  canvas-relative and skip a forced reflow per pointer event.
- Timers go through `ctx.timeout` / `ctx.interval`, and every listener through
  `ctx.listen`.
