# Govinda Ala Re

A mobile-first [Plethora Bit](https://create.plethora.studio) — build the human
pyramid in 3D, hold it up with one thumb, and break the dahi handi.

गोविंदा आला रे — on Janmashtami a clay pot of curd is strung up over the street
and teams of *govindas* stack themselves into a pyramid to reach it. The tiers
are called *thar*. The competition is scored in them, and the record is nine,
about forty-three feet up.

## Files

| File            | Purpose                                                           |
| --------------- | ----------------------------------------------------------------- |
| `plethora.json` | Manifest (`plethora-bit@2`, runtime global `window.plethoraBit`).  |
| `main.js`       | The entry source (`entry: "main.js"`).                             |

## Drawn in 3D, simulated in 2D

Rendered with `three@0.164.1`. The simulation stays flat on purpose: the lever
rule only ever cares about **x**, so depth costs the physics nothing. Each tier
is bowed toward the camera — `z = ARC · (halfWidth / baseHalfWidth) · (1 − (x/halfWidth)²)`
— which makes a tier read as the ring it really is and narrows in both axes as
the pyramid rises, without a single term entering the solver.

Every govinda is ten limbs, eleven ball joints, a head and a pair of shorts,
written into four `InstancedMesh` buffers. Forty-five men at nine thar is about
a thousand matrices a frame in four draw calls.

## The pyramid is a structure, not a stack

This is the whole bit. A cairn is a pile of rigid bodies; a human pyramid is a
loaded structure, and every govinda is a joint in it. So the simulation is a
statics solve, top down: each man hands his own weight plus everything resting
on him to the two shoulders underneath, split by the lever rule according to
where he stands between them.

```
share = (his x − left support x) / (right support x − left support x)
left.load  += total × (1 − share)
right.load += total × share
```

Leaning the tower moves every man sideways by `sin(θ) × his height`, which
changes `share` and nothing else. **Leaning and redistributing the load are
therefore the same act** — one control with two consequences, which is the
entire game.

### What the solver decided, before any tuning

Base-row load as a fraction of each man's strength, at seven thar:

| lean  | #0   | #1   | #2   | #3   | #4   | #5   | #6   |
| ----- | ---- | ---- | ---- | ---- | ---- | ---- | ---- |
| −0.14 | 0.80 | 1.28 | 1.32 | 1.15 | 0.87 | 0.51 | 0.09 |
| 0.00  | 0.31 | 0.85 | 1.19 | **1.31** | 1.19 | 0.85 | 0.31 |
| +0.14 | 0.09 | 0.51 | 0.87 | 1.15 | 1.32 | 1.28 | 0.80 |

The flanks swing by **0.71–0.77**; the man in the middle swings by **0.16**.

That is not a design decision, it is what a triangular load path does, and the
game falls out of it:

- **The centre man is a clock you cannot stop.** Whatever you do, he is at ~1.3
  and burning. He is why you have to hurry, and he is why a tall pyramid ends.
- **The flanks are a resource you rotate.** Lean right and the leftmost man
  drops from 0.80 to 0.09 — effectively resting — and recovers. Lean back and
  you rest the other side.

So the correct way to play is to *rock* the pyramid, which is what the real
pathaks do, for the reason they do it.

## Both ways to lose are physical

- **Someone buckles.** Stamina drains as the cube of load over strength, so
  under the limit is nearly free and over it is quick. A man below 60% load
  recovers, slower than he drained — rocking buys time, it never solves the
  problem.
- **It goes over.** A man's feet leave the shoulders under him once his centre
  of mass passes his outer support, which is `sin(θ) > SPACING / (2 × TIER)` =
  **0.239**, a number from the geometry rather than from taste.

Your thumb can only ask for `0.62 × ` that limit, but the tower amplifies the
ask by `BRACE_K / (BRACE_K − topple)`, and the topple term grows with height —
so the same drag that a three thar shrugs off will put a nine thar on the
street. Tall pyramids also stop self-centring when you let go, which is the
honest version of "you cannot look away".

## Difficulty is the ramp the statics already had

Handi height is `(thar − 1) × 4.6 ft + 5.2 ft`, so nine thar is 42 feet — where
the real records sit. Worst load ratio by size, unchanged from the solver:

| thar | 3    | 4    | 5    | 6    | 7    | 8    | 9    |
| ---- | ---- | ---- | ---- | ---- | ---- | ---- | ---- |
| ft   | 14   | 19   | 23   | 28   | 33   | 37   | 42   |
| load | 0.35 | 0.54 | 0.82 | 1.03 | 1.31 | 1.53 | 1.81 |

Round one is a tutorial nobody can fail; by six thar someone is always over his
limit. Past nine the pyramid cannot grow, so the crowd takes over instead —
water spray (which wets grip and drains stamina half again as fast) and a team
that starts each round already tired.

## Sound

Everything is synthesised; there are no packaged assets.

The dhol is worth doing by hand because it is two drums. The *dagga* head is a
sine whose pitch falls 112 Hz → 52 Hz in 160 ms, which is what makes it read as
skin over a shell instead of a synth kick; the treble head is a short triangle
plus a 1.9 kHz noise slap. Over the top sits a *tasha* — noise at 3.4 kHz — and
a cymbal on the downbeat. They play **keherwa**, the eight-beat cycle, scheduled
a beat ahead of the audio clock, and the tempo rises with the pyramid.

The bed is `ctx.music` on `pulse` in **dorian**, which is Kafi thaat and the
closest mode the runtime offers.

## Contract notes

- `plethora-bit@2`, `schemaVersion: 1`, contract
  `plethora-agent-context-2026-08-13.1` (context, sdk and schema all agreed).
- Permissions: `audio` (the dhol), `backgroundMusic`, `haptics`, `storage`
  (personal best only).
- One dependency, `three@0.164.1`, loaded with `ctx.importModule`. No packaged
  assets and no network: every mesh, colour and sound is generated in-file.
- One record channel, `handi_height`, in feet — the unit the festival quotes.
- Pointer positions come from `event.offsetX`/`offsetY`, already canvas-relative,
  and the page origin is captured at press so window-level moves convert without
  a layout query — an upload validator constraint; see the root `README.md`.
- The HUD is DOM on `ctx.createRoot()` over the GL canvas, so the root needs
  `pointer-events: none` or it eats every tap; only the info button opts back in.
- The sky is vertex colours on one plane rather than a texture, with its lowest
  stop set to the fog colour so the ground fades into it instead of ending at a
  visible horizon.
- `ctx.storage.set()` returns nothing on device, so writes go through
  `fireAndForget()`.

## Verified

Headless Chromium against the strict mock `ctx` in
[`_skills/sekai/harness`](../_skills/sekai/harness) — no console or page
errors, frames advancing, `ready()` fired, gestures landing, and the layout
re-fitting on resize.

An automated "player" that rocks the tower and taps as fast as it can:

| build         | wall  | handis | ended |
| ------------- | ----- | ------ | ----- |
| 2D, first cut | 87 s  | 4      | alive |
| 2D, retuned   | 87 s  | 3      | fell  |
| 3D, shipped   | 87 s  | 3      | alive |

The thar counts match what the round sizes predict exactly, so the loop is
doing what the model says. An untouched tower is unstable at every height, with
the grace period falling from 5.9 s at four thar to 2.2 s at nine — computed
from the closed-form root of the lean dynamics, not guessed.
`python3 _skills/sekai/scripts/check.py govinda-ala-re` passes.

### Three that cost a round

**A swallowed tap, twice.** A tap arriving while the previous thar was still
climbing was dropped on the floor. Fixed by queueing it — and then the *same
bug* turned up one guard along: with the last tier climbing, `tiers < needThar`
is false and `phase === "holding"` is false, so the tap that sends the boy for
the pot hit neither branch and vanished. `forming` now queues unconditionally
and the queue decides between another thar and the reach.

Nothing in the harness complains about either. Every event fires, frames
advance, no error; it shows up only as a handi that never gets broken. **A
swallowed input is invisible to every check that looks for errors, and it reads
to a player as a dead button.**

**`InstancedMesh.count` is not capacity.** The bounds check was
`if (nLimb >= limbs.count) return`, and `count` is set at the end of each frame
to how many instances were *drawn*. So after the first frame every limb past
the previous total was silently rejected, and only the bottom tier ever
rendered — which looks exactly like a game that has not built any tiers yet.
Capacities now live in their own constants.

## Uploading a draft

```bash
python3 _skills/sekai/scripts/check.py govinda-ala-re   # gates the upload
python3 _skills/sekai/scripts/upload.py govinda-ala-re
```

Publishing stays manual, from the Plethora app or dashboard.
