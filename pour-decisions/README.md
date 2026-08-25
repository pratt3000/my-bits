# Pour Decisions

A mobile-first [Plethora Bit](https://create.plethora.studio) built on the one
thing every bartender knows: **the beer you can see is not the beer you poured.**

Hold anywhere to pull the tap. Every level names a line — *fill to 59%* — and
scores the **settled beer**, not the froth on top of it. So the game is never
"stop at the line". It is "stop short of the line by exactly the amount the head
is about to give back", which is a real judgement about a real fluid, and it is
why pouring a good beer takes a couple of goes.

## Files

| File            | Purpose                                                          |
| --------------- | ---------------------------------------------------------------- |
| `plethora.json` | Manifest (`plethora-bit@2`, runtime global `window.plethoraBit`). |
| `main.js`       | The entry source (`entry: "main.js"`).                            |

## The head

The whole bit turns on one model. While the tap is open, beer falls into the
glass and the fall whips air into it:

```
headroom  = 1 - (beer + head)          // how far the stream still drops
agitation = 0.30 + 0.70 * headroom     // a long fall foams; a short one barely does
conv      = foaminess * agitation      // fraction of the pour that turns to head
head     += poured * conv * 2.6        // foam is mostly air, so it stands 2.6× taller
```

and the head is always collapsing back underneath it, thick heads fastest:

```
gone  = decay * (0.5 + 2 * head) * dt
beer += (gone / 2.6) * 0.92            // 8% stays on the glass as lacing
```

Three consequences, and they are the entire game:

1. **The beer line keeps rising after you let go.** Stop *on* the target and you
   overshoot every time.
2. **A nearly full glass hardly foams at all** (`agitation` bottoms out at 0.30),
   which is why topping up works and why the high targets are landable.
3. **You cannot just do the arithmetic**, because the 8% lost to lacing means the
   head never gives back quite everything.

`foaminess` and `decay` are tuned per level as a pair — they set how big a head
you see *and* how many points of beer it hands back:

| # | Glass   | Target | Head at release | Gives back | Settles | Release slack |
| - | ------- | -----: | --------------: | ---------: | ------: | ------------: |
| 1 | Tankard |    59% |            0.10 |     3.4 pp |    1.2s |         0.77s |
| 2 | Nonic   |    35% |            0.13 |     4.5 pp |    1.0s |         0.62s |
| 3 | Tulip   |    72% |            0.15 |     5.2 pp |    1.2s |         0.59s |
| 4 | Weizen  |    45% |            0.24 |     8.4 pp |    1.3s |         0.60s |
| 5 | Flute   |    88% |            0.12 |     4.1 pp |    1.0s |         0.50s |
| 6 | Chalice |    26% |            0.26 |     9.1 pp |    2.4s |         0.30s |
| 7 | Waisted |    64% |            0.22 |     7.7 pp |    1.5s |         0.47s |
| 8 | Pokal   |    93% |            0.09 |     2.9 pp |    1.1s |         0.30s |

"Release slack" is the measured window — the span of release points that still
land inside the scoring window, divided by the flow rate. It is what difficulty
actually *feels* like, and it closes from **0.77s to 0.30s** across the run.
A perfect pour is reachable on every level; the last two demand it.

## The glasses

A glass is a radius profile revolved into a solid, so **volume is not height**.
The quarter marks are drawn where the volume says, not at even spacings, and the
gap between them varies by up to **2.28×** within a single glass:

| Glass   | Shape                                   | Tick spread |
| ------- | --------------------------------------- | ----------: |
| Tankard | straight sides                          |       1.04× |
| Tulip   | bulb, waist, flare                      |       1.23× |
| Chalice | wide bowl, most volume in the first third |     1.25× |
| Nonic   | tapered — wide rim, narrow foot         |       1.31× |
| Waisted | pinched middle                          |       1.47× |
| Weizen  | slim foot swelling to a broad shoulder  |       1.58× |
| Flute   | narrow cone                             |       1.68× |
| Pokal   | bulb foot under a tall chimney          |       2.28× |

That is the difficulty ramp doing real work: by the Pokal, 25% of the beer sits
in the bottom fifth of the glass, and eyeballing the height gets you nowhere.

## The sound

No packaged assets (`maxAssets: 0`), so everything is synthesised on an
`AudioContext` and modelled on what a filling glass actually does:

- **The pour** — a noise bed through a resonant bandpass. The air column above
  the beer shortens as the glass fills, so its resonance climbs (190 Hz → 1.1 kHz
  across the fill). That rising note is how you can hear a glass filling from the
  next room, so it is the centre of the mix and it doubles as a fill gauge you
  can hear with your eyes shut.
- **The splash** — a brighter layer gated on `headroom`, so it speaks while the
  beer still has a long way to fall and fades out as the glass fills.
- **The head** — a fine dry fizz that tracks foam volume, with single bubbles
  popping at random as it collapses.
- **Bubbles** — short sines that glide *upward* in pitch, the same physics that
  makes a drip say "plink".
- **The glass** — inharmonic partials (1 : 2.76 : 5.4) over a soft tick when a
  fresh glass is set down and when it is served.
- A `cozy` `ctx.music` bed at 0.2, ducked while the tap is open.

## Features

- **One gesture** — hold anywhere to pour, let go to stop. No bottom-heavy
  controls; `ctx.safeArea.bottom` stays clear.
- **Graduations at 25 / 50 / 75 / 100%**, labelled in both percent and ml, plus
  unlabelled minor ticks every 10%, so the read is fair on every shape.
- **Auto-serve** once the head has settled, with a countdown ring. Pouring again
  cancels it, which is what makes staged topping-up feel natural.
- **Spills** — go over the rim and the head goes first, exactly as it does in
  life. 60% docked.
- **One-pull levels** where topping up is refused and you have to commit.
- **Streak bonus** for consecutive great pours, and a per-level strip on the
  final card so a round reads at a glance.
- **Haptics** on the pull, when the beer line crosses the target, and on serve.
- **Leaderboard** on round total (`memory.records.score`), plus a personal best
  in `ctx.storage`.

## Contract notes

Built against agent context **`plethora-agent-context-2026-07-10.2`** using only
the documented `ctx` SDK surface:

- No packaged assets and no external dependencies — every pixel and every sample
  is generated at runtime. No network egress.
- Permissions declared for every gated API used: `audio` (the pour synth),
  `backgroundMusic` (`ctx.music`), `haptics`, `storage`.
- Custom WebAudio rather than `ctx.music` alone for the pour, because the timbre
  is continuously parameterised by the fill level — the sound *is* the gauge,
  which the preset beds and fixed stings cannot express.
- Surfaces via `ctx.createCanvas2D` / `ctx.createRoot`; all listeners, frames and
  timers are registered through `ctx` so the runtime owns cleanup.
- `ctx.platform.ready()` is called only after a live first frame, and the title
  screen pours on its own so that frame is never a still life.
- Degrades cleanly with `audio`, `backgroundMusic`, `haptics` or `storage`
  unavailable.

## Uploading a draft

Publishing is intentionally manual. To upload as a draft, an agent pairs with the
creator at <https://create.plethora.studio/agent-pair>, then `POST`s
`{ source, manifest }` to `/v1/agent/bits/drafts` (API origin
`https://api.plethora.studio`) with an `Authorization: Plethora-Agent <token>`
header. See the agent context for the full pairing flow.
