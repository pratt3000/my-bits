# Beer Mileage

A mobile-first [Plethora Bit](https://create.plethora.studio) — turn what you
walked into what you have earned to drink, and watch it fill a real glass.

Log steps, runs, rides, swims and gym time. It counts only the energy above
sitting at the bar, divides by the real calories in a pint of whatever you
drink, and pours the result in 3D. Ten thousand steps at 70 kg is a pint and a
half of lager. That number is the whole product, and it is honest.

## Files

| File            | Purpose                                                           |
| --------------- | ----------------------------------------------------------------- |
| `plethora.json` | Manifest (`plethora-bit@2`, runtime global `window.plethoraBit`).  |
| `main.js`       | The entry source (`entry: "main.js"`).                             |

## Two real models, and the arithmetic between them

**Energy** comes from the Compendium of Physical Activities (Ainsworth et al.,
2011): each activity is a MET at a reference pace, and only the energy *above*
the 1 MET of sitting is counted, because that is the part you earned.

| activity | MET | reference pace | net kcal per kg per km / h |
| -------- | --: | -------------- | -------------------------- |
| steps    | 3.5 | 4.8 km/h, 0.762 m stride | 0.52 /kg/km              |
| run      | 9.8 | 9.7 km/h (10 min/mile)   | 0.91 /kg/km              |
| ride     | 8.0 | 21 km/h                  | 0.33 /kg/km              |
| swim     | 7.0 | 2.0 km/h                 | 3.0 /kg/km               |
| gym      | 5.0 | —                        | 4.0 /kg/h                |

**Beer** is alcohol at 7 kcal per gram (0.789 g/ml) plus what is left of the
malt at 4 kcal per gram, per style and per the glass it is actually poured in:

| style   | serving | ABV  | carbs g/100ml | kcal | label check                      |
| ------- | ------: | ---: | ------------: | ---: | -------------------------------- |
| Lager   | 473 ml  | 5.0% | 3.0           | 187  | Budweiser 145/355 ml → 193 (3%)  |
| Pilsner | 473 ml  | 4.8% | 3.2           | 186  |                                  |
| Wheat   | 500 ml  | 5.3% | 4.0           | 226  | Weihenstephaner ~220 (3%)        |
| IPA     | 473 ml  | 6.5% | 4.3           | 251  | typical 230–260                  |
| Stout   | 568 ml  | 4.2% | 2.6           | 191  | Guinness 125/355 ml → 200 (5%)   |

So the stout — in the biggest glass — costs less than the lager, which is true
and which nobody believes until they see the sum.

The model is a pure block between `// === MODEL BEGIN` and `// === MODEL END`
with no `ctx`, DOM or three in it. `test-model.js` slices it out and runs 44
checks against the label values above, published rules of thumb (10k steps ≈
278 kcal, 10 km run ≈ 635), and the day arithmetic: immutable adds, undo of the
last add only, clearing one activity, pouring only what is earned, the
remainder clamping at zero when you undo a run you already drank on, and the
midnight rollover archiving yesterday and capping history at fourteen days.

## The glass

Rendered with `three@0.164.1`, in metres because physically-correct lights
want them.

- **A glass is a radius profile revolved into a solid**, so volume is not
  height. Five profiles — shaker, pilsner, weizen, tulip and the stout's tulip
  pint — and the fill is inverted through a numeric volume table, so a pilsner
  fills fast at the waist and slowly at the flare, as it does.
- **The beer is a solid cut by a level plane.** `renderer.localClippingEnabled`
  and one world-horizontal `clippingPlane`, so the beer stays flat while the
  glass tilts. Slosh is a damped spring on the plane's normal, kicked by tilt
  velocity; the cap disc and the head ride on the same plane.
- **The head** jumps on every pour by `Δfill × foaminess × agitation`, where
  agitation is high into an empty glass and low into a full one, and always
  settles toward a resting height. Wheat foams big and settles slow; stout is
  creamy and slower still.
- **Bubbles stream from fixed nucleation sites**, as they do in a real glass,
  and pop into the head. Stout runs the nitro cascade instead — bubbles down
  the inside of the wall, a few rising in the middle.
- **Condensation only where the beer is**, because that is where the glass is
  cold. Droplets grow, and the big ones slide.
- **The pints already earned** stand beside the glass, up to four in a
  receding cluster on the left — a portrait frustum is only about ±13 cm wide
  at the glass, and the right edge belongs to the controls — with a `+N`
  beyond that. Each new one pops in when the glass overflows; pouring one
  tips it and takes it away.
- The environment is a small room of warm panels baked to a PMREM, which is
  what makes glass look like glass, and the wall is bokeh.

### Nested transmission does not work, and that is not a bug in this file

A transmissive material in three refracts a render of the *opaque* scene. Put a
transmissive beer inside a transmissive glass and the glass wall wins the depth
test while its refraction has nothing behind it — the beer is simply never
seen, and the empty glass renders as a tinted tube. The beer here is opaque on
purpose: clearcoat, a warm emissive and the glass doing the bending reads
richer than a transmissive beer would have anyway. The bubbles are opaque for
the same reason; the condensation is outside the wall, so it can stay
transparent.

## Three acts

The first version was a dashboard — chips and a form — and it felt like data
entry. It is a moment now, and the interface gets out of the way for it.

1. **Ask.** One question at a time. *What did you do today?* Five big cards,
   plus one that counts steps live off the motion sensor. *How far did you
   run?* A number the size of the screen that you scrub with your thumb across
   a ruler — a tick and a haptic on every step — with presets and nudges under
   it, and a live line that says what it is worth: *= 327 kcal · 1.74 pints of
   lager*. Then **POUR IT**.
2. **Pour.** The controls fade. A brass tap lowers in over the glass, the
   stream starts, the level rises at the pace the pour would take, splash
   comes up off the surface, the head surges, and the number rolls up in step.
   Every time the glass fills it holds at the brim for a beat, clinks, and
   goes to the row while a fresh one takes its place under the stream. The
   pour's pitch climbs as the glass fills, because the air column shortens.
   Then a punchline, matched to how much you earned.
3. **Play.** Tap the glass and it rings — lower the fuller it is, because the
   beer loads the wall — with a pulse, a slosh and a burst of bubbles. Swipe
   up and it tips to your mouth and drains with two gulps, then the tap tops
   it back up to what is still yours. Drag to tilt; the beer stays level.

## Chrome

DOM over the GL canvas, with the root at `pointer-events: none` and only the
controls opting back in. No `backdrop-filter`: over a WebGL canvas it went
stale in the compositor and left blank squares where controls had been
toggled, and it is not a risk worth a blur. Type is Bebas Neue for the numbers
and DM Serif Display italic for the questions and the beer, both from the
Plethora font registry via `ctx.loadFont`, with the system stack underneath
and a 2.5 s cap on waiting.

- The **live steps** card runs a threshold crossing on the high-passed
  acceleration magnitude with a refractory period, ticking on every step and
  committing twenty at a time so the glass rises as you walk; stopping pours
  whatever is left. It says plainly when motion is not available.
- Settings: weight, what you drink, tilt with the phone (drag always works),
  reset today. About: the formulas with the numbers filled in.
- A seven-day strip on the result screen, from the archived history.

## Contract notes

- `plethora-bit@2`, `schemaVersion: 1`, contract
  `plethora-agent-context-2026-08-13.1`.
- Permissions: `haptics`, `storage` (today, history, profile), `motion` (live
  steps and tilt, both optional with a fallback), `audio` (the glug, the clink,
  the swallow), `backgroundMusic` (`cozy`, quiet).
- One dependency, `three@0.164.1`; no packaged assets, no network.
- No leaderboard by design.
- `ctx.storage.set()` returns nothing on device, so writes go through
  `fireAndForget()`. Rollover runs at load: a saved day with a different date
  is archived and a fresh one started.
- Pointer positions never query layout; the drag is delta-based from
  `clientX`/`clientY`.

## Verified

`node test-model.js beer-mileage/main.js` — 44 passed.

Headless Chromium against the strict mock `ctx`, driving the whole flow through
the DOM with `eval` steps and synthetic pointer events: pick steps, preset,
scrub the ruler, pour and watch the reveal; log a 10 km run whose pour fills
two glasses on the way; swipe up on the glass to drink one; tap the glass;
switch to stout; read the about sheet; open the live-steps card where motion is
unavailable; resize. No console or page errors; `ready`, `markVisualReady`,
`start`, `interact`, `milestone`, `setProgress` and both `loadFont` calls fire,
and the `milestone`s are exactly the glasses the model predicts.

The harness reports the GL canvas as `kind: "err"` because it cannot sample a
WebGL2 surface for its colour check; the visuals were reviewed from screenshots
instead.
