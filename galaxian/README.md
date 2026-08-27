# Convoy Charge

A mobile-first [Plethora Bit](https://create.plethora.studio): a reconstruction
of Namco's **Galaxian** (1979), the arcade fixed shooter that answered *Space
Invaders* by teaching the aliens to leave the formation.

Forty-six of them hang above you in a five-row convoy. They peel off and dive in
swooping arcs, and you slide along the bottom with exactly one missile allowed on
screen at a time. Take the flagship while both its escorts still fly and it is
300; take both escorts first and it is 800.

Ships the arcade's rules, not an homage to them: the scoring table, the single
missile, the escort bonus, the flagships that escape, the extra ship at 7000, and
the flags in the bottom-right corner.

## Files

| File            | Purpose                                                           |
| --------------- | ----------------------------------------------------------------- |
| `plethora.json` | Manifest (`plethora-bit@2`, runtime global `window.plethoraBit`).  |
| `main.js`       | The entry source (`entry: "main.js"`).                             |

## The name

The game is titled *Convoy Charge* — the arcade's own term for a flagship diving
with its two hornets — rather than *Galaxian*, which is Bandai Namco's mark. The
folder keeps the working name, as `sketch-hop/` and `backseat-rain/` do. Nothing
about the rules is softened; only the title is ours.

## The rack

Five rows, ten columns, 46 aliens, which is the arcade's exact composition:

| Row | Class                  | Count | In convoy | Charging          |
| --- | ---------------------- | ----- | --------- | ----------------- |
| 1   | Flagship               | 2     | 60        | 150 / 200 / 300 / 800 |
| 2   | Hornet (red)           | 6     | 50        | 100               |
| 3   | Emissary (purple)      | 8     | 40        | 80                |
| 4–6 | Drone (blue)           | 30    | 30        | 60                |

Every alien is worth double once it leaves the rack, which is the game's whole
risk calculus: shooting into the formation is safe and cheap, waiting for the
dive is dangerous and pays twice.

The flagship is the exception, and its table is the reason people still play
this. It charges with a hornet off each wingtip:

- **150** — diving alone, no escorts available.
- **200** — one escort still flying.
- **300** — both escorts still flying.
- **800** — both escorts shot down *first*, then the flagship. A thousand for
  the trio, and the only way to get it is to spend two shots on the wingmen
  while the whole formation is bearing down on you.

The bookkeeping lives on a convoy record created when the flagship launches. It
counts escorts at launch and escorts killed, and a hornet killed *after* the
flagship still counts — you cannot get the 800 by shooting out of order.

## Flagships escape

Straight from the arcade: a flagship that completes its dive and reaches the
bottom of the screen may simply keep going. It scores nothing, it thins the rack
you still have to clear — and it comes back at the head of the next one, up to
four flagships in all. Letting one through is a debt, not a reprieve.

## The dive

Divers are steered agents rather than canned splines, which is what makes two
runs of the same wave look different.

An alien peels out of the rack sideways and slightly upward (heading ±2.0 rad
from straight down), then turns over and hunts the Galaxip, weaving as it comes.
Turn rate is capped per class, so the arcs are smooth and the alien overshoots
when you move late:

| Class    | Speed | Turn rate | Weave | Lead  |
| -------- | ----- | --------- | ----- | ----- |
| Drone    | 62    | 3.1       | 0.30  | 0.30  |
| Emissary | 66    | 3.6       | 0.85  | 0.16  |
| Hornet   | 64    | 2.9       | 0.42  | 0.26  |
| Flagship | 56    | 2.4       | 0.28  | 0.34  |

That table is the personality difference the original had: drones come almost
straight at you, emissaries slew about and are hard to lead, the flagship is
heavy and turns late.

Escorts do not steer at all while their flagship lives. They ride its frame —
16 px off each wingtip, 9 px back, rotated by its heading — so the V holds
through the whole arc. Kill the flagship and they are orphaned into their own
dives mid-flight.

A diver that reaches the bottom re-enters at the top and flies back to its slot,
as the arcade's did. It steers home at a higher turn rate and snaps to formation
within 5 px.

## Difficulty

Per stage, and gradually rather than in steps, which is how the original
escalated:

```
speed          1 + 0.055·(w−1)   capped 1.9
divers aloft   2 + ⌊(w+1)/2⌋     capped 8
dive interval  1350 − 95·(w−1)   floor 260 ms
fire rate      0.45 + 0.13·(w−1) capped 1.7
convoy chance  0.24 + 0.055·(w−1) capped 0.62
escape chance  0.22 + 0.03·(w−1) capped 0.45
```

Separately, the rack sways faster as it thins — `1 + 2.4·(fraction destroyed)` —
so the last two drones really are the hardest two.

## Fitting a 224×256 cabinet to a phone

The virtual screen keeps the cabinet's 224 px width exactly and stretches
vertically to the device, capped at 380 so a very tall phone letterboxes rather
than becoming a corridor. Everything is drawn in those virtual pixels with
`imageSmoothingEnabled = false`, so sprites stay hard-edged at any scale.

The extra height would otherwise slow every dive down by half, so `zone.pace`
scales flight speeds, alien fire and the missile by the extra airspace. A dive
takes about as long on a phone as it did on the cabinet. Row pitch opens from 14
to 17 px over the same range so the rack fills the space it is given.

In landscape the same expression fits by height instead and letterboxes
sideways; no branch is needed.

## Everything is drawn

Packaged assets are disabled (`maxAssets: 0`), so there is nothing to load.

**The character ROM** is a 5×7 bitmap font, 47 glyphs, each one line of source.
`drawText` emits one rect per horizontal run rather than per pixel.

**The sprites** are grids of colour slots — `.` transparent, `1`/`2`/`3` for the
three colours a Galaxian sprite was allowed. The three alien classes share one
silhouette across blue, purple and red exactly as the arcade did; only the
palette entry changes. The flagship gets its own wider bird in yellow, red and
blue. Each has a convoy frame and a wings-up frame that divers alternate at
110 ms.

Each `(grid, palette)` pair is baked once into an `OffscreenCanvas`, so a frame
is `drawImage` calls. Where a WebView has no `OffscreenCanvas`, `bake` keeps the
grid and `blit` paints rect-per-pixel instead: slower, never blank.

**Explosions** are procedural. Spoke angles come from a cheap hash of the burst
seed, so nothing allocates per frame, and the first 70 ms show a white
silhouette of whatever just died — the arcade's hit flash — before the sprite
breaks up into a cross and then a starburst.

**The starfield** is 96 dots scrolling down, each blinking on its own period in
one of six colours.

## Sound

The Galaxian PCB made four kinds of noise, and each is rebuilt rather than
replaced with a generic sting:

- **Analog fire** — a square falling 1180→260 Hz in 100 ms with a click of
  bandpassed noise on the front.
- **Analog explosion** — broad noise swept 1500→90 Hz over 750 ms, with a
  sawtooth underneath, for the Galaxip going up.
- **Three analog rack noises** — the convoy's idling hum. Two detuned sawtooths
  and a square at 58/77/103 Hz through a resonant lowpass, all three swept by
  one shared LFO. As the rack thins, `setRack(level)` raises their pitch, the
  LFO rate and the filter cutoff together, so the bed climbs exactly as the
  survivors speed up.
- **The digital oscillator** — monophonic and stepped, built from a
  `PeriodicWave` of odd harmonics because the real board wired only three of a
  counter's four output bits to the resistor ladder. It plays the intro tune,
  the wave-clear and game-over jingles, and the alien-destroyed blip: ten pitch
  steps 22 ms apart, alternately detuned, which is what gives it the tumble.

The flagship's charge adds a fifth voice the board had in spirit: a square at
520 Hz with an 11 Hz, ±190 Hz vibrato, on while any convoy is in the air.

There is no background music, because Galaxian has none. The rack noise is the
bed.

## Controls

**Drag** (default) — touch anywhere and the Galaxip tracks your finger
*relatively*, so grabbing far from the ship does not teleport it and your thumb
never covers it. Each new touch fires.

**Pads** — a left, a right and a fire button in their own band at the foot of
the screen. Choosing pads shortens the playfield by 44 px so the Galaxip is
never under a thumb.

**Auto fire** is off by default. With one missile allowed at a time it is close
to equivalent — `fireMissile()` simply no-ops while a shot is in flight — but
"make each one count" is the whole texture of the original, so it is opt-in.

Arrow keys / WASD and space work for anyone playing on a desktop.

## Contract notes

- `plethora-bit@2`, manifest `schemaVersion: 1`, entry `main.js`.
- Permissions: `audio` (the sound board is bespoke synthesis, which is the one
  case the contract asks you to justify), `haptics`, `storage`. No
  `backgroundMusic` — there is no music to play. No camera, microphone or
  motion.
- One `records` channel, `score`, feeding the standard global leaderboard.
  Submitted once per run at game over, and never for a zero.
- `ctx.storage` holds the local best and the four settings.
- First frame paints the attract screen before `ctx.markVisualReady("attract")`
  and `ctx.platform.ready()`; `ctx.platform.start()` fires on the first real
  gesture, which is also where audio unlocks and the rack noise starts.
- All timers and listeners go through `ctx.timeout` / `ctx.listen`; the
  `AudioContext` is closed from `ctx.onDestroy`.
- Every button is painted on the canvas and hit-tested against a hotspot list
  rebuilt each frame. There is no DOM beyond the canvas `ctx.createCanvas2D`
  hands back.

### What the upload validator rejects

Following the rules `cairn/`, `heartwood/` and `pixel-fog/` paid for, none of
which are in `sdk.md`:

- No `document.createElement("canvas")` — offscreen surfaces are
  `OffscreenCanvas`, via `makeSurface()`.
- Pointer positions come from `event.offsetX`/`offsetY`; the canvas is never
  asked for its layout box, and this file does not name that call either.
- No local is named `ph`.
- No `CanvasGradient` anywhere. Galaxian is flat colour, so there was nothing to
  give up.
- Timers go through `ctx.timeout`.

## Verified

Driven headless in Chromium against a mock `ctx`:

- **Scoring**, 19 assertions — rack composition (46 aliens, 30/8/6/2, rows
  2/6/8/10/10/10); convoy 30/40/50/60 and charging 60/80/100; the flagship table
  at 150/200/300/800 including a 1000-point trio; escort kills counted in either
  order; the extra Galaxip at 7000 awarded exactly once; one missile on screen;
  stage advance; escaped flagships rejoining the next rack at 4/48; three lives
  to game over with the score submitted and `fail` reported, and a zero run not
  submitted.
- **Input**, 12 assertions — tap fires, drag steers, a grab far from the ship
  does not teleport it, the settings panel switches schemes and the layout
  reserves the pad band, all three pads press and release, arrow keys and space,
  and a landscape resize refitting by height.
- **Soak** — ~150 s of autopilot across four stages with no page errors, divers
  bounded to x ∈ [8, 216] (they bank off the walls rather than leaving), and
  convoy records peaking at 2 rather than accumulating.
