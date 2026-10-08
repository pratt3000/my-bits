# Petri Bloom

A mobile-first [Plethora Bit](https://create.plethora.studio): one glowing cell
in a dish full of hungry ones, against twenty-eight bots.

Drag to steer. Swallow anything meaningfully smaller than you. Stay clear of
anything meaningfully bigger — because the heavier you get, the slower you
move, and everything else in the dish is doing the same arithmetic about you.
Eat your way up through eight stages of life, from Spore to Apex Bloom.

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
| Speed         | `520 · mass^-0.28` — a 1000-mass cell moves at 44% of a 50 |
| Eating        | You need **1.2×** their mass, and must cover their centre |
| Split         | Halves the cell and throws one half forward at 800/s   |
| Merge         | 8s + `0.02 · mass` before halves will rejoin           |
| Feed          | Costs 17, emits 12 — the rest is the price of the throw |
| Virus         | 110 mass. Bursts anything over 137 into up to 16 pieces |
| Decay         | Cells over 180 lose 0.22% a second, rising past 1500    |
| Ceiling       | 22,500 for a single cell                                |

## Progression

The first build was slow and gave almost nothing back for eating: a speck was
worth 2.2, the camera pulled back exactly as fast as you grew, so on screen
you never got any bigger, and eating a whole rival earned a small green
number. This build is built around feedback.

- **Food is worth more.** Specks are worth 3.6, there are 1800 of them, and 26
  **golden blooms** worth 22 each pulse across the dish and show on the
  minimap. Small bots are seeded and respawn at 16–55, so there is prey from
  the first second.
- **You visibly grow.** The view widens as you do, but slower: your size on
  screen goes as about radius^0.6, from a 19px radius at the start to about
  75px by 5000 mass on a 390-wide phone. The old camera held you at a constant
  15px, so growing was invisible.
- **Eight stages of life.** Spore, Microbe 100, Amoeba 220, Paramecium 450,
  Colony 900, Organism 1800, Leviathan 3600, Apex Bloom 7000. The HUD shows
  the stage, a count-up mass, a bar to the next stage, and what it is called.
  Evolving fires a banner, a rising arpeggio, a success haptic, a shock ring,
  a burst of your colour and a pulse through your membrane.
- **Every meal answers.** Specks are drawn visibly into you; a swallowed cell
  bursts into droplets, swells you with an overshoot, punches the camera in a
  touch and floats its mass off the spot. Kills within 2.6s of each other
  chain into DOUBLE GULP, TRIPLE GULP and FRENZY ×n, each worth a bonus.

Measured with the bot brain driving the player (four runs of the old build,
eight of this one), median time to reach each stage:

| reached | old build | this build |
| --- | --- | --- |
| 100 (Microbe) | 21s | 9s |
| 220 (Amoeba) | 84s, when it happened at all | 28s |
| 450 (Paramecium) | never in two minutes | 25–88s |

## You are the one being played

Faster food feeds the bots too, and at first the dish's own economy ran away:
the leading bot reached 8,000–15,000 inside two and a half minutes and ate
the player from off-screen. Four measured corrections:

- bots get **60%** of a pellet's value; you get all of it;
- a bot **rots by its colony's total mass**, not per piece, and faster than you
  past 1500 — a leader split into sixteen modest pieces otherwise hardly rots;
- a bot over 2500 grows **careless round viruses**, which is what breaks it up;
- nobody **split-lunges at you while you are still a Spore**.

The leader now sits at 2,800–4,100 at two and a half minutes and about 5,600
at four, which is the old build's range.

## The dish

3600 × 3600, 1800 specks, 26 golden blooms, 20 viruses, 28 bots. The board is
seeded already in progress: two bots around 200–380, six around 90–180, the
rest between 16 and 60. You drop in at 50, at least 560 units from any wall.

Pellets are dealt off one array with a uniform bucket grid over it, rebuilt
each frame; it turns the naive fifty-thousand distance checks a frame into a
few dozen.

## The bots

Each one re-plans on a stagger every 0.15–0.32s, so twenty-eight of them never
think on the same frame. A bot:

- **flees** the nearest cell that can eat it, and runs *along* a wall rather
  than into it when cornered;
- **hunts** the nearest cell it can eat, and will split to lunge if the maths
  works — but won't cross the dish for a crumb worth under 8% of its own mass;
- **grazes** the nearest pellet otherwise, wandering when the area is picked
  clean;
- **avoids viruses** once it is big enough to burst — in proportion to its
  skill, and half as carefully past 2500.

Skill varies per bot around a tunable mean, so the dish has both sharks and
idiots in it.

## Three seconds of grace

You spawn with a dashed ring and three seconds of immunity, and bots will not
even set course for a shielded cell. Without it nine runs in ten ended inside
ten seconds, usually before the player had seen the dish at all.

## Nothing comes from off the screen unannounced

Showing you bigger means showing less of the dish, so any cell that could eat
you and is just off the screen gets a red chevron on the edge pointing at it,
brighter and pulsing as it closes.

## Everything is drawn

`maxAssets` is 0, so nothing is loaded.

- **The canvas** asks for `maxDpr: 2` and nothing else. That raises the backing
  store without changing the drawing space, and `render()` scales to CSS
  pixels itself every frame from `canvas.width / ctx.width`; a runtime that
  ignores the option leaves a 1:1 store and the same code draws as before.
  The first build drew at 1× on a 3× phone, which is a good part of why it
  looked soft.
- **Cells are soft bodies.** Each carries a ring of twenty radial offsets on
  springs, smoothed against their neighbours and drawn as one closed curve. A
  swimming cell flattens in front and draws out a tail; a resting one never
  quite stops trembling; anything it eats dents the membrane where it went in,
  and the visual radius springs toward the real one with an overshoot, so a
  big meal visibly swells it. Bodies are lit by a unit-space radial gradient
  per hue, with a membrane rim, a nucleus and vacuoles that slosh against the
  direction of travel, a sheen and a glint.
- **Split pieces are joined by liquid.** Any two pieces of one colony within
  reach are bridged by a metaball neck — two concave flanks stroked in the rim
  colour, filled over both rims where they meet — so the outline runs round
  the whole colony and the neck thins and snaps as they drift apart.
- **The dish** is a flat floor with the top and bottom shaded down, a faint
  grid that fades out before it can shimmer, two depths of plankton that drift
  slower than the dish (parallax for almost nothing), and a lit glass wall.
- **Stamps.** Specks (glow, bead and glint in one), viruses in a dozen
  rotation phases of one spike, your halo and the golden glow are painted once
  through `ctx.visual.sprite.custom` and copied. Specks and viruses are cut at
  the exact device-pixel size they are drawn at, keyed off the settled zoom,
  so a frame is straight copies with no resampling, and a gulp's camera punch
  does not recut them. The Bit never creates a canvas of its own; without the
  sprite helper every one of these falls back to paths.
- **A quality governor** times real frames. If they run long for a second and
  a half it sheds plankton, vacuoles, then organelles and your halo; twelve
  seconds of short frames earns them back.
- **Sound** is a small WebAudio board: the speck blip (rate limited), a gulp,
  a bloom chime, a rising combo stab, a merge bloop, a pop, the death fall and
  an arpeggio for each stage that climbs with it.

## Contract notes

- Runtime `plethora-bit@2`, SDK 1.5.7, manifest schema 1, no dependencies.
- Permissions `audio`, `haptics`, `storage` — nothing else is touched.
- The canvas and HUD are made with the factory defaults and no placement
  opt-ins; default stacking is source order, so the canvas made first sits
  under the HUD made after it. The HUD declares `pointer-events:none` in its
  own CSS, so a finger dragged across the score still reaches the dish. Only
  the two action buttons and the menu card are interactive.
- **Controls are delegated**: one listener each on the button bar and the menu
  card, registered once for the life of the Bit. Nothing is ever rebound.
- **Storage is a convenience, never a dependency.** Every call checks
  `ctx.storage` itself, not the capability flag beside it, and never assumes
  `set()` returns a promise. Haptics check the function the same way.
- `ctx.game.loop` drives the frame, `ctx.game.score` holds the peak, submitted
  once at death. Evolving and combos raise `ctx.platform.milestone`.
- `manifest.onboarding` is `guided`: four steps. Steering is obvious; splits,
  feeding and viruses are not.
- **No `manifest.game.progress`.** A run is a run; there is nothing to resume.

## Leaderboard

One record channel, `best_mass`: the biggest you ever reached, submitted at
the result screen, which also shows the stage you reached and how many cells
you swallowed.

## Verified

Driven headless in Chromium against a mock `ctx` built from this manifest,
with the SDK sprite helper mocked three ways: present, rasterising at twice
the asked size, and absent.

- **Paints**: a 780×1600 backing store for a 390-wide screen, 100% of the
  frame lit, and `elementFromPoint` at the centre returns the canvas.
- **Survives the device**: every control tapped with `ctx.storage` and
  `ctx.platform.haptic` both missing, no errors; a real drag across the dish
  reaches the game.
- **Dies properly**: swallowed, the shot holds for a beat with a burst of your
  colour, then the card; one `fail`, one record submit, one pulse.
- **No leaks**: forty-eight live stamps after forty-five seconds of play,
  however often the zoom recuts them.
- **Cost**, flushed to pixels in software rasterisation, the worst gameplay
  scene (you at 2400 in eight pieces, zoomed out): old build 3.1ms at 1×; this
  build 4–5ms at 1× and about 8ms at 2×. Spectating a four-minute-old dish
  costs about 10–12ms at 2×. Profiling found the costs that mattered: a
  full-screen radial floor (4ms, now bands), five hundred scaled glow sprites
  (now exact-size copies) and gradient-filled spiky viruses (now stamps).
- **Contained**: no `document.` reference anywhere in the source, no network,
  no packaged assets.
