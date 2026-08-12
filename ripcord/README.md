# Ripcord

Spin your phone. The gyroscope reads how fast you spun it, and your top launches
at an RPM directly proportional to that number. Then it fights two or three
rivals in a bowl stadium until one top is left spinning.

## First rip

The rip is a physical gesture, and a still diagram does not explain a wrist
snap. Before the first launch — once, remembered in storage, and reachable
afterwards from `?` — a coach screen shows a phone actually performing the
motion on a 1.9 s loop: wind back, whip through, settle, with motion arcs that
brighten and an arrow head that leads the sweep. Four lines say it plainly:
hold it flat, snap your wrist hard, faster snap means faster spin, and you never
have to let go.

## The measurement

This is the whole point of the bit, so it is worth being precise about it.

`ctx.motion` exposes only `tilt` (orientation angles) and `accel` — there is no
`rotationRate` on the documented surface, and the contract forbids inventing
`ctx` methods. So the gyroscope is read through the standard `devicemotion`
event via `ctx.listen`, gated behind `ctx.motion.start()` so iOS still shows its
permission prompt:

```js
const ok = await ctx.motion.start();          // permission, the documented way
ctx.listen(window, "devicemotion", e => {
  const rr = e.rotationRate;                  // deg/sec, three axes
  feedSpin(Math.hypot(rr.alpha, rr.beta, rr.gamma), "gyro");
});
```

`rotationRate` is a true rate gyro. That matters here: it is **not** referenced
to gravity, so it keeps reading correctly while the phone is in freefall, which
orientation angles do not. Three sources, in priority order:

| Source | How | When it is used |
| --- | --- | --- |
| **`gyro`** | `devicemotion` → `rotationRate` magnitude | Whenever the sensor reports it. Valid airborne. |
| **`tilt`** | Differentiate `ctx.motion.tilt`, wrap-corrected | Motion granted but no `rotationRate`. In-hand only. |
| **`swipe`** | Pointer speed across a drawn ripcord | Motion denied or absent. |

The active source is named on screen during the rip, so it never silently
pretends to have measured something it did not.

**Freefall** is detected from `accelerationIncludingGravity`: an accelerometer
in free flight reads about 0 g. Under ~3.2 m/s² the bit shows `AIRBORNE` and
holds the launch until the phone is caught, so the whole flight is captured and
the flight time is reported afterwards.

### Peak, not average

A rip is a transient. The bit tracks the **peak** angular speed inside the rip
window, then auto-launches when the reading falls below 30% of that peak for
230 ms — the release. A hard wrist flick and an actual throw produce the same
gyroscope signal, so nobody has to let go of their phone to play.

### Spin to RPM

```
launchRPM = clamp(peakDegPerSec * 9.2, 3200, 14000)
```

Strictly proportional between the floor and the ceiling. 2,000 °/s is roughly
where consumer gyros saturate, and the floor means even a limp flick fields a
viable top. Both numbers stay on screen — the measurement and what it became —
so the relationship is legible rather than a hidden curve.

## Difficulty

Four tiers. `rpmMul` sets how hard rivals launch, `skill` sharpens their stats
(dealing more, taking less, lasting longer), and the top two tiers put a **third
rival** in the stadium.

| | Rivals | Pool | A perfect rip wins |
| --- | --- | --- | --- |
| 🟢 **Rookie** | 2 | the gentlest tops | ~100% |
| 🔵 **Pro** | 2 | + Hollow Crown, Riot Coil | ~85% |
| 🟠 **Champion** | 3 | + Null Vector | ~80% |
| 🟣 **Legend** | 3 | + Black Meridian | ~50% |

The streak leaderboard is weighted by tier (×1, ×2, ×4, ×7) and stores the
*score*, not the raw streak — otherwise a Rookie run would be re-weighted as if
it had been earned on Legend.

## Does spinning harder actually win?

It has to, or the mechanic is decorative. Measured by running the real physics
headlessly, 25 battles per cell, playing Volt Lance:

| phone °/s | launch RPM | Rookie | Pro | Champion | Legend |
| --------: | ---------: | -----: | --: | -------: | -----: |
| 250 | 3,200 | 20% | 0% | 4% | 0% |
| 450 | 4,140 | 32% | 16% | 8% | 0% |
| 650 | 5,980 | 72% | 44% | 28% | 8% |
| 850 | 7,820 | 92% | 48% | 52% | 16% |
| 1100 | 10,120 | 96% | 72% | 56% | 40% |
| 1400 | 12,880 | 100% | 72% | 84% | 44% |
| 1800 | 14,000 | 100% | 72% | 92% | 60% |

Every tier rises with spin. Pro and Champion sit within sampling noise of each
other at the top end; they separate clearly through the middle, which is where
most rips land.

Getting there took reversing two things that made the curve run backwards:

- **Unbounded gyroscopic drift.** A tangential force proportional to spin
  accelerates a fast top until it leaves the bowl, so *high spin caused
  ring-outs* — the opposite of the intended mechanic. It is now driven toward a
  preferred orbital speed, which is self-limiting.
- **A stadium with no lip.** Without one, orbiting fast was enough to fly out.
  A steep restoring force past `r = 0.95` means a ring-out has to be delivered
  by an impact.

Two more changes make spin decisive rather than incidental: incoming knockback
is divided by a gyroscopic stability term (`0.5 + spinNorm * 1.15`), and spin
drain is a **ratio** (`(sa/sb)^0.75`) rather than a narrow lerp, so a 2:1 spin
lead is a 2.8× drain advantage instead of 1.4×.

Two balance problems turned out to be structural rather than numeric, and both
resisted several rounds of stat-shaving before the real cause was found:

- **Stamina looked strictly strongest.** Rivals were drawn from *the other two*
  archetypes, so picking Stamina was the one way never to face a Stamina top —
  which is the hardest matchup. Rivals now come from the whole roster.
- **Three rivals were unsurvivable.** With threat-weighted targeting every one
  of them converged on the leader at once, which is an unrecoverable dogpile.
  Each rival now rolls a `focus` flag: some play the leader, the rest go for
  whoever is nearest.

## Elemental specials

Every top carries one, and it is the only thing in the battle you press. A bar
at the bottom fills over the element's cooldown; when it is full, tapping it
unleashes the attack on whatever is in range. Rivals do the same on their own,
so the stadium is never quiet.

Three shapes cover the whole set:

| Shape | What it does | Elements |
| --- | --- | --- |
| **bolt** | Forks to the two nearest rivals — heavy drain, small shove | Storm, Radiant |
| **burst** | Radial nova — drain and a hard shove, both falling off with range | Fire, Gale, Ember, Tide |
| **zone** | A field left on the floor that drains and *slows* anything standing in it | Frost, Venom, Umbra |

| Top | Element | |
| --- | --- | --- |
| Volt Lance | ⚡ **Storm** | forked lightning to the two nearest |
| Iron Bastion | 🔥 **Fire** | nova that also leaves a burn ticking |
| Pale Orbit | ❄️ **Frost** | freezing field, heavy drag on anything inside |
| Wisp | 🌬 **Gale** | weak drain, huge shove — a ring-out tool |
| Cinder Fang | 🔥 **Ember** | a smaller Fire |
| Hollow Crown | ✨ **Radiant** | bolt |
| Riot Coil | ☠️ **Venom** | lingering field |
| Null Vector | 🌊 **Tide** | wide shove |
| Black Meridian | 🌑 **Umbra** | the strongest field |

A cast scales with the caster's remaining spin (`0.55 + spinNorm * 0.45`), so a
dying top cannot cheat a win out of one button press.

**Is it overpowered?** No — measured, not assumed. Running Legend twice, once
with the driver ignoring the button and once tapping it whenever ready, 26
battles per cell:

| phone °/s | ignoring it | using it |
| --------: | ----------: | -------: |
| 250 | 12% | 8% |
| 650 | 8% | 12% |
| 1100 | 31% | 23% |
| 1400 | 23% | 46% |
| 1800 | 42% | 50% |

Roughly **+4 points on average and ~+15 at the strongest rips**, and pure noise
at weak ones — a feeble launch dies before the bar ever fills. The special is
worth using without deciding the match, which is the intent.

## Steering

Drag anywhere in the stadium and your top drives at that point, at a strength
scaled by its remaining spin — a dying top barely answers the helm. Release and
it goes back to its own devices. **You only ever steer your own top.** A dashed
line and a pulsing ring show where you are pulling it.

This exists because tops orbiting a bowl politely avoid each other. Alongside
it, the orbital-speed target dropped (`lerp(0.32, 1.15)` → `lerp(0.26, 0.88)`)
so tops spiral inward instead of circling, and the seek force rose from
`1.35` to `1.70`. They meet far more often now.

Matches also run about **twice as long** (spin burn `150 + …` → `86 + …`),
because a fight shorter than two cooldowns makes the specials decorative.

## The garden

The stadium stands in a garden at golden hour rather than on flat black. Baked
once with the arena: a dusk sky, a low sun behind the bowl, two hill layers, a
tree line, the grass bed with a few hundred tufts, and the shadow the stadium
casts on the grass. A warm gradient rakes across the bowl from the sun side so
the cool tech stadium belongs to the scene instead of floating over it.

Live on top: **wind** — a slow prevailing drift with occasional gusts — carrying
82 petals that flutter as they turn, and a fringe of foreground grass along the
bottom edge that leans with the same value. The scenery is generated from a
`sin`-based hash keyed by index, so it is stable across rebakes rather than
reshuffling every resize.

## The tops

Each is a polar profile — `rIn + (1 - rIn) * cos(blades * a)^sharp`, with the
angle warped by `skew` so the blades sweep back rather than sitting radially
symmetric. That asymmetry is what reads as forged metal instead of a flower, and
it shows which way the top is turning.

**Yours to pick:**

| | Blades | Character |
| --- | --- | --- |
| ⚡ **Volt Lance** | 3 | Attack. Hits hardest, burns out first, wins by ejection. |
| 🛡 **Iron Bastion** | 6 | Defense. Heavy, takes 40% less drain, hard to move. |
| 🌀 **Pale Orbit** | 8 | Stamina. Outlasts everything, fragile in an exchange. |

**Rivals**, unlocked by tier — they also turn up as opponents, so a mirror match
is possible:

| | Blades | Tier | Character |
| --- | --- | --- | --- |
| **Wisp** | 3 | Rookie | Light and quick, but folds when hit. |
| **Cinder Fang** | 4 | Rookie | A cheaper Volt Lance. Still bites. |
| **Hollow Crown** | 5 | Pro | Balanced, heavy, no weakness to exploit. |
| **Riot Coil** | 7 | Pro | The most aggressive thing in the roster. |
| **Null Vector** | 12 | Champion | Barely decays. Wins by simply still being there. |
| **Black Meridian** | 10 | Legend | Apex: heavy, hits hard, shrugs off almost everything. |

Each is baked once into two `OffscreenCanvas` sprites: a crisp one, and a
**blur** built by drawing the blade 26 times through one blade-pitch of
rotation. The renderer crossfades between them on spin rate, so a top at speed
is a smeared disc and a dying one resolves into individual blades — two
`drawImage` calls per top per frame rather than re-tracing the polygon. A fixed
specular sweep is drawn after, clipped to the top, so highlights do not rotate
with the body.

As spin drops, the top leans off its tip by `(1 - spinNorm)²` and precesses,
and its projected squash oscillates. That is the wobble a real top does as it
dies, and it is the clearest read on who is losing.

## The stadium

Drawn as a real bowl rather than a flat disc. The rim opening sits slightly
above the floor, so the crescent between them reads as the far wall you are
looking down into — that offset is most of what sells the depth. On top of it:
a machined rim with brushed banding, tick marks and twelve inset lamps; vertical
flutes down the wall; an energy ring at the lip; ambient occlusion where the
floor meets the wall; and a floor of concentric rings, radial spokes and launch
chevrons.

All of that bakes once to an `OffscreenCanvas`, along with the hall it stands in
— a haze behind the bowl, out-of-focus gantry lights above and below, and a pool
of light on the ground. Live on top: two soft sheens rotating at different
rates, a colour wash that flares on impact in the hue of whatever just clashed,
drifting motes for depth, and each top's reflection mirrored in the floor.

## Physics

A paraboloid bowl gives a linear restoring force toward the centre. On top of
that: the orbital-speed drive, the stadium lip, threat-weighted seeking, and a
drunken wander that grows as spin fades.

Collisions are mass-weighted impulses with restitution 1.34, each top's
knockback character folded in, and the receiver's gyroscopic stability dividing
what it absorbs. Opponents target **the biggest threat discounted by distance**,
not the nearest — chasing the nearest rewards hanging back while the aggressive
tops wreck each other, which made passivity dominant. It also means a monster
launch has to survive being everyone's target.

Spin burns at `(150 + speed * 52 + rpm * 0.009) * decay` per second. The
`rpm * 0.009` term is spin-proportional drag: faster spin costs more to sustain,
which is what keeps a maximal rip a strong favourite rather than a formality.

## Sound

All synthesized; there are no packaged assets.

Each live top runs a **spin whirr** whose oscillator sits at the blade-pass
frequency — `rpm / 60 * bladeCount` — so a 3-blade top at 9,000 RPM sings at
450 Hz and the pitch falls as it dies. You can hear who is losing without
looking. Clashes are six inharmonic partials (1, 2.41, 3.86, 5.12, 7.31, 9.04)
with a highpassed contact transient, amplitude scaled by impact. Lightning is a
noise burst swept down through a bandpass; a death is eleven decelerating taps,
the rattle of a top settling. `ctx.music` carries a techno bed that rises in
intensity as tops are eliminated and ducks on heavy hits.

## Effects

Sparks are drawn as streaks along their velocity rather than dots, additively,
white-hot fading through amber. Lightning is midpoint-displaced with forking
branches, drawn as a wide coloured glow under a thin white core, flickering over
~150 ms. Plus shockwave rings, screen shake, an additive flash on big hits, and
a coloured light pool each top casts on the floor.

## Files

```
ripcord/
  plethora.json   # manifest: motion/audio/haptics permissions, two record channels
  main.js         # the whole bit
  README.md
```

## Contract notes

- Permissions: `motion` (the gyroscope), `audio` (Web Audio synthesis),
  `backgroundMusic` (`ctx.music` bed), `haptics`, `storage` (best rip, streak,
  chosen top).
- Memory: two `records` channels — `launch_rpm` ("Fastest Rip") and
  `win_streak` ("Win Streak").
- No dependencies and no packaged assets: geometry, textures, stadium and audio
  are all generated at runtime.
- The stadium is baked once to an `OffscreenCanvas` and blitted per frame; only
  tops, trails, particles and light pools are drawn live. Where `OffscreenCanvas`
  is missing, every bake site falls back to drawing live — plainer, still
  playable, never blank.
- The source is deliberately **pure ASCII**; every non-ASCII character in a
  user-visible string is a `\uXXXX` escape. Rendering the raw bytes through a
  non-UTF-8 path turns `°` into `Â°` and `—` into `â€"`, which is exactly what
  happened the first time this was rendered in a browser.

### One identifier name can fail the upload, for reasons unknown

The rejection is the misleading *"unsupported remote resources"* message, and
the cause has nothing to do with resources. This single-token change flips the
upload from accepted to rejected, with no other edit:

```js
const rivalPool = ROSTER.filter(t => t.tier <= diff.maxTier);   // accepted
const pool      = ROSTER.filter(t => t.tier <= diff.maxTier);   // rejected
```

**The mechanism is not known.** The obvious theory — that a duplicate `const`
name is illegal — is wrong: this file ships with three other `const pool`
declarations and uploads fine. What is different about the rejected one is that
those three all bind a gradient, and this one binds an array; the validator's
own message talks about resolving *"simple const aliases"*, so a name bound to
inconsistent kinds of value may defeat that. That is a guess, not a finding.

What is solid is the reproduction, so: **if an upload is rejected with the
remote-resources message and the bit loads nothing remote, suspect a name.**

Finding it took bisecting by repeated upload, and three intermediate
conclusions were wrong before this one. Two methodology errors caused them, both
worth avoiding:

- **Prefix-applying patch hunks is invalid here.** Hunks interdepend, so an
  early hunk applied without the later one that declares its variable creates a
  free variable, which the validator also rejects. That framed an innocent
  hunk. ESLint's `no-undef` over the whole file disproved it.
- **Assuming a variant differed only by the thing under test.** Variants built
  up from a known-good base were missing far more than intended, so "last
  passing variant plus X fails" did not mean X was at fault. Always `diff` the
  variant against the real file before concluding.

The reliable method is to *remove* one coherent feature at a time from the real
failing file, so the comparison is always sound.

### Never assume a runtime call is thenable

On a real device `ctx.storage.set()` returned **nothing** rather than a promise,
so the `.catch(() => {})` chained onto it threw
`TypeError: undefined is not an object` and took the whole bit down at the first
tap on the top-select screen.

Every such call now goes through `fireAndForget()`, which tolerates the method
being absent, throwing, or returning a non-promise:

```js
function fireAndForget(thunk) {
  try {
    const r = thunk();
    if (r && typeof r.catch === "function") r.catch(() => {});
  } catch (err) { /* not supported on this runtime */ }
}
```

The reason this reached a device at all is that the test harness mocked every
API as returning a promise, so the shape mismatch was invisible. It now has two
degraded-runtime modes, and both are part of the normal check:

- **hostile A** — methods present but returning `undefined` (the observed bug).
- **hostile B** — `ctx.capabilities` claims support while `ctx.storage`,
  `ctx.memory`, `ctx.music` and `ctx.motion` are missing entirely.

Reverting the fix makes hostile A fail with the device's exact stack, so the
regression test is known to bite rather than merely pass.

### What the upload validator rejects

Inherited from [`cairn`](../cairn), and both still apply:

- **Minting a canvas element off the document** → *"Direct document/body access
  is not allowed."* `OffscreenCanvas` is the supported path for offscreen work.
- **Reading a canvas's layout rect** → *"This bit uses unsupported remote
  resources…"*, a message that gives no hint that layout access is the cause.
  Use `event.offsetX` / `offsetY`, which are canvas-relative already.

Worth adding: the validator appears to pattern-match source text, so both of the
above are described in prose in this codebase rather than written out literally
in a comment.
