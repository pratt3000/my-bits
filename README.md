# my-bits

Plethora Bits — tiny mobile-first interactive objects.

## 🌲 Whispering Grove

A relaxing first-person **3D forest** you wander freely. Randomly-placed animals
and nature-words are hidden among the trees; walk up and tap to gather them for
tiered points, and each discovery reveals a super-interesting fact. Leaves
rustle when you tap the trees, soft chimes guide you toward nearby finds, and
the grove is endless — regenerated fresh every visit.

- **`main.js`** — the bit source (defines `window.plethoraBit`), rendered with
  Three.js (`three@0.164.1`, loaded from the Plethora library registry).
- **`plethora.json`** — the manifest (runtime `plethora-bit@2`, permissions
  `haptics` + `backgroundMusic`, and a `grove` leaderboard record).

### Controls

- **Left side** — drag to walk (a floating joystick appears under your thumb).
- **Right side** — drag to look around.
- **Listen** — a soft chime plays when a discovery is near; creatures hide low
  among the bushes and only reveal a faint glow/firefly up close.
- **Tap** a creature or word to collect it (walk close enough first).
- **Tap the trees or bushes** to rustle their leaves.

### How it works

- Endless forest: the ground, ~190 full-canopy trees, 150 bushes and ~2,600
  swaying grass blades (all GPU-instanced with a vertex-shader wind) recycle
  around the player, so you can wander forever without hitting an edge.
- Discoveries: 25+ animals across four rarity tiers (Common → Legendary) plus a
  set of nature-words, all placed at random and respawned as you explore.
- Tiers: Common `+10`, Uncommon `+25`, Rare `+60`, Legendary `+150`, Word `+20`.
- Everything is procedural — no packaged assets (the platform's `maxAssets` is
  `0`). Creatures and words are drawn to `<canvas>` textures at runtime.
- Scores are submitted to a Plethora global/following leaderboard.

Publishing is manual from the Plethora app/dashboard after pairing.
