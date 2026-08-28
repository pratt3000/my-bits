# Aarti

A mobile-first [Plethora Bit](https://create.plethora.studio) — light the lamp,
then circle it. Press and hold to catch the wick, then carry a brass thali in
slow circles. Move too fast and the flame blows out. Eleven steady turns
completes the aarti, and the trail of light your hand drew becomes a mandala.

आरती — the lamp is circled before the rakhi is tied.

## Files

| File            | Purpose                                                           |
| --------------- | ----------------------------------------------------------------- |
| `plethora.json` | Manifest (`plethora-bit@2`, runtime global `window.plethoraBit`).  |
| `main.js`       | The entry source (`entry: "main.js"`).                             |

## The whole bit is in the word *slowly*

The thali is on a spring, not on your finger: it lags, overshoots, and settles.
That spring (ω₀ ≈ 6.5 rad/s, ζ ≈ 0.42) also low-passes your hand, so a frantic
circle is answered by a smaller, slower one — the plate physically cannot be
whipped around, which is exactly what a heavy plate feels like.

The flame lives off the plate's own speed, smoothed over about a third of a
second so one jolt does not kill a flame that a sustained gallop should:

```
over        = max(0, speedSm − 3.8) / 3.8
flameHealth = clamp(flameHealth − over·1.9·dt + 0.34·dt, 0, 1)
```

Below the threshold it recovers; above it, it drains. A comfortable three
seconds a turn is safe, two seconds a turn is marginal and visible — the flame
leans harder, guttering blue at the base — and much under that puts it out in
about a second. There is a warning before there is a failure.

Turns are counted by unwrapping the plate's angle about the centre, only while
the flame is alive and only outside a dead zone near the middle, so wiggling
does not score.

## Features

- **Lighting it** is a press-and-hold: sparks, an ember growing on the wick, and
  the same finger carries the plate away when it catches.
- **The flame is not decoration.** It leans away from where the plate is going
  (apparent wind), stretches with speed, flickers per layer, and casts the only
  real light in the room.
- **A trail of light** falls behind it and fades over five seconds — two
  ribbons, a wide dim one and a narrow hot one, which is the bloom pass this
  runtime does not have. A steady circle draws a ring of fire; a nervous hand
  draws a scribble.
- **The mandala.** On the eleventh turn the trail stops fading and is repeated
  eight ways around the centre, one fold at a time. Whatever you drew is what
  you get, and nobody else draws the same one.
- **The room warms** as the turns add up: ambient light, key light and a rangoli
  on the wall behind all come up together.
- **A leaderboard** for the longest unbroken aarti, reachable from the help
  sheet as well as from the end of a run.
- A brass thali with a diya, kumkum, akshat, haldi, marigold petals and a rakhi
  waiting on it — all generated, none of it packaged.

## Sound

All synthesised in-file:

- **A temple bell** — six inharmonic partials with different decay rates, struck
  by a very short bandpassed noise transient. It rises a step a turn.
- **A shruti box** — four detuned saws behind a filter that breathes on a slow
  LFO.
- **The flame** — bandpassed noise whose gain and cutoff ride the speed of your
  hand.
- **A conch** at the end: a swept saw with vibrato and breath over it.
- **Ghungroo** — a scatter of very short high sines, on every turn.

## Contract notes

Built against agent context **`plethora-agent-context-2026-08-13.1`** using only
the documented `ctx` SDK surface:

- Dependency: `three@0.164.1` via `ctx.importModule`, with the exact registry
  URL literal as a fallback.
- No packaged assets (`maxAssets: 0`) and no network egress. The flame, the
  hammered-brass normal map, the marigold petal, the rangoli and the room
  equirect are all baked into an `OffscreenCanvas` in pixel loops at startup.
- Permissions declared for every gated API used: `audio`, `backgroundMusic`,
  `haptics`, `storage`.
- Memory: one `records` channel, `steady`, `dedupe: best_per_user`. The
  leaderboard response is read defensively (the shape is not pinned by the
  contract) and rendered with everything escaped.
- Screen-to-world for the drag is a ray/plane intersection through
  `Vector3.unproject`, so it stays correct under any camera or aspect.
- Pointer positions come from `event.offsetX`/`offsetY`; no canvas layout
  queries, no bare timers, no host-document access.

### A reverb that quietly exploded

Chromium spent several runs complaining *"BiquadFilterNode: state is bad,
probably due to unstable filter caused by fast parameter automation"* — but only
on a full eleven-turn run, never on a short one, which is the tell: something was
diverging over time rather than misbehaving on contact.

It was the reverb, not any automation. Two delay lines both fed from one damped
sum and both fed back through a single gain `g` have the system matrix
`[[g,g],[g,g]]`, whose spectral radius is **2g** — so `g = 0.52` is a loop gain
of 1.04 and the network grows without bound until the damping filter's state
goes non-finite. It is inaudible for the first twenty seconds, which is exactly
long enough to blame the wrong thing. `g` is now 0.32.

Worth having chased anyway: automating a biquad's frequency every frame *is*
wasteful, so the flame filter is smoothed in JS and assigned about twelve times
a second instead.

## Uploading a draft

Publishing is manual. An agent pairs with the creator at
<https://create.plethora.studio/agent-pair>, then `POST`s `{ source, manifest }`
to `/v1/agent/bits/drafts` (API origin `https://api.plethora.studio`) with an
`Authorization: Plethora-Agent <token>` header.

## Verified

Driven headless in Chromium against a mock `ctx` built strictly to `sdk.md`:
first frame before three loads; press-and-hold lights the wick; slow circles
count turns, ring the bell, drop petals and advance `setProgress`; fast circles
gutter the flame and fire `fail` with the run submitted to the record channel;
eleven turns fires `complete` and assembles the mirrored mandala; the help sheet
and the leaderboard both render and close; a mid-session viewport change
re-layouts — no runtime errors, no console warnings.
