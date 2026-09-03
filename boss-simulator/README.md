# Boss Simulator

You are the boss, and the computer is dodging.

The usual arrangement, inverted. A target hovers inside a lit arena and tries
very hard to stay alive; you have nine attacks along the bottom and sixty
seconds to take a thousand hit points off it. No cooldowns — press whatever you
like as fast as you like.

## The target is genuinely good

This is the whole game, and it is the original's, line for line. Every frame the
target scores sixteen directions for danger:

- the walls, at 1000 per pixel of overrun;
- every projectile in flight, and **where each one will be fifteen frames from
  now**, which is what makes it duck rather than get clipped;
- the footprint of anything telegraphed, weighted `25000 / (warning + 0.05)` so
  an imminent zone is worth fleeing and a distant one is not;
- a *gradient* inside a large zone, so it can see its way out of a void instead
  of standing in the middle because every step looks equally bad;
- a slight pull toward the centre, so it does not hug a wall forever.

Then it walks down the steepest gradient it finds. Fire one bone at it and it
simply steps aside. You have to close the exits: a wave to herd it, a void to
take half the arena away, a freeze to pin it, and then something heavy while it
cannot move.

## The arena

The simulation still runs flat, in arena coordinates. What changed is that it is
drawn through a **tilted orthographic camera** onto a real floor:

- Walls with height, brightening and going red as the clock runs down.
- A floor plate with a `fwidth`-based grid, a slow scan sweep, a damage flash,
  and a vignette.
- The target as a hovering icosahedron with a fresnel shell, a bright core, a
  shadow on the plate, and a status ring while it is pinned or dragged.
- Projectiles as rounded-rect glow plates flying at elevation, each in its
  ability's colour — nine things happening at once are still nine legible
  things.
- Telegraphs as decals on the plate itself: the void hatches and marches, the
  beam draws its stripe before it fires.
- The crusher's slabs really do close in.

Orthographic, not perspective, because the fit is then exact. The arena's corner
box is projected into camera space and the frustum set to contain it, then grown
so the whole thing sits inside the band the HUD and the keypad leave free — so
the arena never creeps under the interface on a screen shape I did not
anticipate.

## Three things worth recording

**The floor shader was reading local coordinates.** `varying vP = position.xy`
on a unit `PlaneGeometry` never leaves `[-0.5, 0.5]` — the model matrix does the
scaling, not the attribute. So the grid collapsed to nothing, and the scan
sweep, keyed on a uv that was 0.5 everywhere, flashed the *entire floor* on and
off. It reads `(modelMatrix * position).xz` now.

**The floor decals never appeared, silently.** They sit 1.6 units above the
plate, and the orthographic camera was built with `near = -4000, far = 4000`.
1.6 units across an 8000-unit depth range is below the depth buffer's
resolution, so the void's telegraph lost the comparison against the floor and
was discarded — with nothing in the console to say so. Narrowing the range to
±1600 fixed it with the depth test left on, which is better than the usual
reflex of turning the depth test off.

Both were found by screenshot. Neither threw.

**A near wall at full height hides the target.** The crusher drives the target
to the bottom edge of the arena, which from a tilted camera is exactly where the
near wall stands. The near wall is a nine-unit lip now; the other three are full
height.

## Sound

All generated — the original had five sound files and none could travel — but
through one master chain rather than nine oscillators wired straight to the
speakers: a generated convolution room (1.15 s, short and tight, because this is
a fight and not a cathedral), a ping-pong delay whose feedback stays at 0.22
because two cross-fed lines have a system gain of *2g*, and a limiter.

One voice per ability, so you can hear which one landed: a bandpassed crack for
a bone, a swept saw for a wave, a detuned sub for the void, five staggered blips
for the swarm, a charge into a blast for the beam, an **inharmonic bell cluster**
(2.76×, 5.4×, 8.93× — ratios a `PeriodicWave` cannot express) for the freeze, a
downward glide for the grab, and a low impact for the crusher. Hits are pitched
by how much they hurt. Everything is panned by where in the arena it happened.

One noise buffer is generated once and looped. Making a fresh `AudioBuffer` per
shot is how a game that fires forty times a second ends up allocating megabytes.

## Leaderboard

`memory.record("clear_time")` — **Fastest Clear**, `duration_ms` ascending,
daily / weekly / all-time, global and following, `best_per_user`. Submitted only
on a win.

## Divergence — assets

The original shipped sprite art for the target and its attacks, and twelve
sound files. **A Plethora bit cannot package assets** (`maxAssets: 0`), so none
of it could come across. The repository owner was asked before the port went
ahead and chose to continue with substitutes rather than skip the bit; this
section is that mark.

What replaced them is not an imitation of the original art — it is geometry and
shaders built for this rendering, so nothing here pretends to be a redrawing of
something it has not seen.

## Verified

`node _skills/sekai/harness/run.js boss-simulator sc-boss2.json` — no console or
page errors; `loadFont`, `ready`, `start`, `interact` and `haptic` all fire, and
the arena, the swarm, the void telegraph, the beam, the pincer, the freeze and
the crusher were each checked against a screenshot.

Audio was probed separately, since the harness cannot hear: all nine ability
voices plus both hit tiers and both stingers build with **zero errors**,
convolver and ping-pong live, context running at 44.1 kHz.

## Provenance

Ported from a standalone Sekai build, then rebuilt at the repository owner's
request. The dodging AI, all nine attack patterns, the damage numbers, the
economy of the sixty-second limit and the thousand hit points are the
original's, unchanged. The arena, the synthesis and the leaderboard are new.
