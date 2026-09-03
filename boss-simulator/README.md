# Boss Simulator

The usual arrangement, inverted: **you are the boss**, and the computer is the
one dodging.

A target moves inside a white box and tries very hard to stay alive. You have
nine attacks along the bottom and sixty seconds to take a thousand points off
it. No cooldowns — press whatever you like as fast as you like.

What makes it a game rather than a button-masher is that the target is genuinely
good. Every frame it scores sixteen directions for danger — the walls, every
projectile in flight, where each of those will be fifteen frames from now, the
footprint of anything telegraphed, plus a slight pull toward the middle so it
does not hug a wall forever — and walks down the steepest gradient it finds.

Fire one bone and it simply steps aside. You have to close the exits: a wave to
herd it, a void to take half the arena away, a freeze to pin it, then something
heavy while it cannot move.

## The nine

| | | |
|---|---|---|
| **Bone** one fast shot from a random edge | **Wave** a wall with the gap left exactly where it is standing | **Void** half the arena, 0.8s warning |
| **Swarm** sixteen outward from the centre | **Beam** vertical, aimed where it was | **Pincer** walls from both sides, two gaps |
| **Freeze** pins it 1.5s | **Grab** drags it to the centre | **Crush** the walls close in, 20 damage |

The Wave is the joke worth noticing: the gap is placed at the target's current
position, so fired alone it is guaranteed to miss. It only works as the second
half of something else.

## Leaderboard

**Fastest Clear** — `ctx.memory.record`, `duration_ms` ascending, formatted as a
timer, daily / weekly / all-time, best-per-user. Added at the repository owner's
request; only a win submits.

## Divergence from the original

**This is the most heavily changed port of the four, and the changes are
visible.** The repository owner chose "all four, substitutes everywhere" knowing
that.

The original drew four PNG sprites — a heart for the target, a bone projectile,
a void hazard and a blaster head — through six `drawImage` calls. Plethora
disables packaged assets (`maxAssets: 0`), so none of them could travel.

Rather than redraw imitations of them, the stand-ins are **deliberately
abstract**:

| Original sprite | Stand-in |
|---|---|
| Heart sprite (the target) | A red diamond with a pale core, in the original's own `heart_col` |
| Bone projectile | A white capsule with a soft glow |
| Void hazard | A violet rectangle, outlined and pulsing during its warning |
| Blaster head | An angular chevron emitter that fires a vertical gradient beam |

Two reasons for abstract rather than lookalike. The honest one: a lookalike is
still my drawing wearing the original's clothes, and geometry is at least
plainly itself. The practical one: those sprites are Undertale's, and
reproducing them by hand on another platform does not make that better.

**Everything except the art is unchanged.** The dodging AI is carried over line
for line, including the 1000× wall penalty, the `25000 / (warning + 0.05)` zone
danger, the gradient that lets it see its way out of a large void, the
fifteen-frame projectile prediction, the 0.1× centre attraction and the `-1`
threshold that stops it twitching. All nine attack patterns keep their exact
spawn positions, speeds, damage and timings. Sixty seconds, 1000 HP, 8.0 speed —
the tune values as shipped.

Sound: the original had five audio files with partial procedural fallbacks. All
five are gone, so every noise here is generated — a filtered noise burst for a
bone, a descending sawtooth sweep for the heavy attacks, a short click on a hit,
a two-note rise on a win.

## Verified

`node _skills/sekai/harness/run.js boss-simulator sc-boss.json` — 528 frames,
**no console or page errors**, `ready` / `start` / `interact` all fired.
Screenshots confirm the arena and HP bar render, every attack type draws
correctly (swarm, void warning and active, beam, both wave directions, freeze
and crush), and the layout survives a resize.

The best evidence that the AI ported correctly: through a scripted burst of nine
attacks the target finished on **1000/1000**. It dodged all of them. That is the
game working as designed, not a collision bug — the screenshots show it sitting
in the gap of a pincer wave, exactly where the danger function would put it.
