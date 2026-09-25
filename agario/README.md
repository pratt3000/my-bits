# Petri Bloom

A mobile-first [Plethora Bit](https://create.plethora.studio): one cell in a
dish full of hungry ones, against twenty-eight bots.

Drag to steer. Swallow anything meaningfully smaller than you. Stay clear of
anything meaningfully bigger — because the heavier you get, the slower you
move, and everything else in the dish is doing the same arithmetic about you.

## Files

| File            | Purpose                                                          |
| --------------- | ---------------------------------------------------------------- |
| `plethora.json` | Manifest (`plethora-bit@2`, runtime global `window.plethoraBit`). |
| `main.js`       | The entry source — dish, bots, renderer and sound.                |

## The name

The folder keeps the working name `agario/`, as `galaxian/` does. The Bit is
titled *Petri Bloom* rather than anything resembling Miniclip's mark. None of
the rules are softened; only the title is ours.

## Mass is the only currency

Everything is read off it:

| Quantity      | Rule                                                  |
| ------------- | ----------------------------------------------------- |
| Radius        | `4 · √mass`                                            |
| Speed         | `560 · mass^-0.35` — a 1000-mass cell moves a third as fast as a 60 |
| Eating        | You need **1.2×** their mass, and must cover their centre |
| Split         | Halves the cell and throws one half forward at 800/s   |
| Merge         | 11s + `0.02 · mass` before halves will rejoin          |
| Feed          | Costs 17, emits 12 — the rest is the price of the throw |
| Virus         | 110 mass. Bursts anything over 137 into up to 16 pieces |
| Decay         | Cells over 180 lose 0.22% a second                      |
| Ceiling       | 22,500 for a single cell                                |

## The dish

3600 × 3600, 1500 pellets, 20 viruses, 28 bots. The board is seeded already in
progress: two bots around 200–380, six around 90–180, the rest scratching
around between 20 and 75. You drop in at 60 — mid-pack, with things you can eat
and things that can eat you from the first second.

Pellets are dealt off one array with a uniform bucket grid over it, rebuilt
each frame; it turns the naive fifty-thousand distance checks a frame into a
few dozen.

## The bots

Each one re-plans on a stagger every 0.15–0.32s, so twenty-eight of them never
think on the same frame. A bot:

- **flees** the nearest cell that can eat it, and runs *along* a wall rather
  than into it when cornered;
- **hunts** the nearest cell it can eat, and will split to lunge if the maths
  works — but won't cross the dish for a crumb worth under 8% of its own mass,
  which is what stopped the early game feeling like being chased by the room;
- **grazes** the nearest pellet otherwise, wandering when the area is picked
  clean;
- **avoids viruses** once it is big enough to burst — but only in proportion to
  its skill, so the clumsy ones blunder in. With no human rivals to force a
  leader into the spikes, that is the only thing keeping the top of the board
  honest.

Skill varies per bot around a tunable mean, so the dish has both sharks and
idiots in it.

## Three seconds of grace

You spawn with a dashed ring and three seconds of immunity, and bots will not
even set course for a shielded cell. This is not in the original, and it is
here for a measured reason: without it nine runs in ten ended inside ten
seconds, usually before the player had seen the dish at all.

## Everything is drawn

`maxAssets` is 0, so nothing is loaded.

- **The dish** is Canvas2D in CSS pixel space with a 2× backing store. The
  camera frames a multiple of your own radius — floored at 270 world units so
  the early game has a field of view, capped at 1400 so the late game does not
  turn into a map screen — and clamps to the dish so a player in a corner never
  spends half the display looking at the bench.
- **Membranes** are eighteen points nudged by a pair of sines seeded off the
  cell. A perfectly round blob looks dead.
- **Your own cell** carries a white rim and always shows its name: with
  seventeen hues and twenty-eight cells, two blobs can share a colour, and you
  must be able to find yourself instantly.
- **Sound** is a small WebAudio board. The pellet blip is rate limited to one
  every 55ms or constant grazing turns into a swarm of bees.

## Contract notes

- Runtime `plethora-bit@2`, SDK 1.5.7, manifest schema 1, no dependencies.
- Permissions `audio`, `haptics`, `storage` — nothing else is touched.
- The HUD is a `ctx.createRoot({ input: "passthrough" })` overlay that also
  declares `pointer-events:none` in its own CSS, so a finger dragged across the
  score still reaches the dish underneath whatever the host does. Only the two
  action buttons and the menu card are interactive.
- **Controls are delegated**: one listener each on the button bar and the menu
  card, registered once for the life of the Bit. Nothing is ever rebound.
- `ctx.game.loop` drives the frame, `ctx.game.score` holds the peak, submitted
  once at death.
- `manifest.onboarding` is `guided`: four steps. Steering is obvious; splits,
  feeding and viruses are not.
- **No `manifest.game.progress`.** A run is a run; there is nothing to resume.

## Leaderboard

One record channel, `best_mass`: the biggest single cell you ever reached,
submitted at the result screen.

## Verified

Driven headless in Chromium against a mock `ctx` built from this manifest, at
390x800, 360x640 and 844x390.

**Playable.** Ten fresh runs with a driver that swims in a circle and splits
itself at random intervals — a floor, not typical play, since splitting beside
something bigger is the fastest way to die: runs of 7-39s, peak mass 69-168,
median 84, and three runs under ten seconds. Before the food chain was fixed
the same driver died inside ten seconds nine times out of ten and never got
past mass 25.

**Alive.** Left to itself for five minutes the dish produces a real ecology:
leaders rise and get overtaken (Tapioca 676 → Orbit 820 → Amoeba 1790 →
Sir Eats 16432), with the tenth-placed cell still around 400. The 22,500
ceiling holds.

**Cheap.** Update costs 0.11-0.21ms a frame throughout. Render was the whole
budget and was measured, not guessed:

| | early | 1 min | 3 min |
| --- | --- | --- | --- |
| first build | 0.38ms | 5.11ms | 5.67ms |
| pellets batched by colour | 0.23ms | 0.57ms | 6.02ms |
| membranes scaled to on-screen size | 0.25ms | 0.60ms | **0.67ms** |

Counting the actual canvas calls is what found each one: at three minutes a
frame was making 123 fills and 102 strokes and only 1.1 text draws, so the
text was never the problem — fifteen hundred separate pellet arcs were, and
then eighty-odd nineteen-point membranes on cells that were specks on screen.

**Contained.** Every field of the manifest validates against the live
`schema.json` — knob types, intents, apply modes, groups, onboarding step
shape, record channel, permissions. No `document.` reference anywhere in the
source, no network, no packaged assets.

**Passthrough proven.** `elementFromPoint` at the centre of the screen *and*
over the score readout both return the canvas at all three sizes, so a drag
across the HUD still steers. Zero per-element input activations are ever
registered, checked against the same hostile mock that caught the Forbidden
Five crash.
