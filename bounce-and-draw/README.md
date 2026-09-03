# Bounce & Draw

Draw the walls, let the balls pay you.

A ball falls down a dark screen. Draw a bar anywhere and it becomes something
solid to ricochet off, and every bounce earns. Spend what you make on a better
ball — brighter, faster, worth more per hit — or on another ball entirely, until
the screen is full of neon rattling around whatever geometry you left lying
about.

The whole game is one honest idea: a bounce is worth money, so you are really
building a machine that maximises bounces. A funnel. A staircase. A long shallow
ramp that keeps a ball skimming instead of dropping.

Every stroke is a **straight bar**, not a freehand curve — press, drag to set the
far end, release. A hundred at once; the oldest falls off the end.

## Leaderboard

**Peak Earnings** — a `ctx.memory.record` channel ranked on lifetime money,
daily, weekly and all-time, best-per-user.

Added at the repository owner's request; the original had no board. It ranks
*lifetime* earnings rather than current balance, because the balance drops every
time you buy something and a board that punished you for upgrading would be
backwards. Submissions are throttled to every $100 earned — an idle game
generates money continuously, and hammering the channel on every bounce would be
rude to the platform.

## Notes on the port

The physics, the economy and the look are the original's, unchanged: gravity
0.4, restitution 0.9, $1 per bounce times ball level, upgrade cost ×2.2, ball
cost ×2.5, the seven-colour ball cycle, the velocity cap that stops a fast ball
tunnelling through a thin bar, and the small random nudge on every bounce that
keeps a ball from settling into a perfect repeating orbit.

Rebuilt: no CDN, no `sekaiEditable` or `postMessage` scaffolding, Plethora owns
the DOM and the frame loop, and movement is delta-time scaled — the original
stepped per frame, so it ran at double speed on a 120 Hz phone. Its own
"clamp a huge stutter to one frame" guard is kept.

## Divergence from the original

Approved by the repository owner, who chose "all four, substitutes everywhere".

| Asset | What happened |
|---|---|
| bounce / coin / upgrade sounds | **Not substituted.** The original synthesised all three itself — a 400 Hz sine boing, a two-note square coin, a three-note triangle upgrade fanfare — and only played a file if one happened to be attached. Those generators carry over verbatim, so the game sounds exactly as it did. |
| 12 background music tracks | **Substituted.** The music picker is still there, but it now offers Plethora's own generative beds (lo-fi, synthwave, arcade, chiptune, drift, techno, cozy, or silence) rather than the original playlist. The panel says so in as many words. |
| Background overlay image | Dropped. It was a decorative aura; the glow behind the field is now drawn as a radial gradient that still scales with your ball level, as the original's did. |

Worth saying plainly: the original's track list included commercial music —
*girl in red*, an Undertale OST track — which is a separate reason those could
not travel to another platform, quite apart from `maxAssets: 0`.

## Verified

`node _skills/sekai/harness/run.js bounce-and-draw sc-bounce.json` — 390 frames,
**no console or page errors**. Screenshots confirm bars draw as straight neon
segments, the ball bounces off them and earns, `+$1` floaters rise, the money
badge pulses, shop buttons dim when unaffordable, the music panel lists the beds
and marks the playing one, the leaderboard renders, and the layout survives a
resize.
