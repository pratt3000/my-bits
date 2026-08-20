# Chameleon Hunt 🦎

A 1-player mobile 3D hide-and-seek game inspired by *Meccha Chameleon*. You
are always the Seeker ("Denner"): AI hiders are camouflaged into the walls,
floors, and furniture of five themed low-poly arenas. Spot them, tap them,
and clear the arena before the clock runs out.

## How it plays

- **Left half of the screen** — dynamic touch joystick: forward, backward, strafe.
- **Right half** — drag to look around (first-person camera).
- **Tap** a suspicious shape to accuse it. Catching a hider triggers an
  un-camouflage reveal: bright rainbow dance, confetti burst, victory jingle.
  Misidentifying a piece of furniture costs **+6 seconds**.
- Hiders clone the *exact material* (procedural texture + color) of the
  surface they lean against, tinted slightly "off" by a per-difficulty
  mismatch factor. Fairness tells: subtle sway and periodically blinking eyes.
- A synthesized **whistle/giggle proximity cue** plays more often and louder
  the closer you are to an undiscovered hider.

## The five arenas

| # | Arena | Difficulty | Find | Time | Notes |
|---|-------|-----------|------|------|-------|
| 1 | Living Room | Very Easy | 3 | 2:00 | Sofas, TV unit, bookshelves |
| 2 | Kitchen & Dining | Easy | 4 | 2:40 | Counters, fridge, dining table |
| 3 | Master Bedroom | Medium | 5 | 3:20 | Big bed, wardrobes, curtains, vanity |
| 4 | Toy Store | Hard | 6 | 4:20 | **Two floors** (stairs + mezzanine), giant teddies, ball pit |
| 5 | Art Museum | Very Hard | 7 | 5:20 | Abstract statues, rotating sculptures, scrolling moiré wall |

Each arena defines a pool of **15+ hand-placed hide spots** (position,
rotation, pose, backing surface). Every run randomly draws its target count
from the pool, and the drawn set is guaranteed to differ from the previous
run's set (persisted per arena).

Arenas unlock in order: clearing arena *N* unlocks arena *N+1* (persisted).

## Scoring & leaderboards

- Completion time is the ranked metric (faster = better); score =
  `found × 250 + remaining-time bonus`, reported via `ctx.platform.setScore`.
- **Local leaderboards**: one per arena in `ctx.storage`, seeded with 4
  realistic bot times, sorted fastest-first, capped at 10. Beating a time
  prompts for a username (remembered for next time).
- **Platform leaderboards**: five `memory.records` channels
  (`living_room`, `kitchen`, `bedroom`, `toy_store`, `museum`), each
  `duration_ms` / `asc` / `timer` / `best_per_user`.

## Audio

The runtime denies arbitrary network audio, so everything is generated:

- **Background bed**: `ctx.music` presets per arena (cozy, lofi, drift,
  bubble, spooky) at low volume, ducked on catches and wins.
- **SFX**: WebAudio synthesis (`audio` permission) — catch fanfare, penalty
  buzz, low-time tick, win/lose melodies, proximity whistle/giggle. Falls
  back to `ctx.music.sting` names when WebAudio is unavailable.

## Files

- `plethora.json` — manifest (`plethora-bit@2`, `three@0.164.1`, permissions:
  haptics, backgroundMusic, audio, storage; 5 record channels).
- `main.js` — entire game, single file, defines `window.plethoraBit`.

## Contract notes

- First visible frame is the DOM menu; `ctx.platform.ready()` fires before
  three.js streams in, `ctx.platform.start()` on the first real gesture.
- All listeners via `ctx.listen`, frame loop via one `ctx.onFrame`, timers
  via `ctx.timeout`, teardown via `ctx.onDestroy` (world dispose, music
  stop, renderer + AudioContext close).
- No packaged assets, no external URLs; textures are canvas-painted, sounds
  synthesized. Controls respect `ctx.safeArea` and avoid the bottom edge
  (the joystick anchors where the thumb lands).
