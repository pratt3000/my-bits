# Sketch Racer

Draw the longest road you dare, then drive it.

Drag one finger across the paper and it becomes a track, metering its own length
as you go. Hit RACE and a small car sets off along it — nose following every
curve, camera locked to the bonnet, engine note climbing with speed — until it
crosses the chequered flag you left at the far end.

There is no skill in the driving. The car always finishes. The whole game is in
the drawing: how much road you can cram into one gesture before you run out of
screen or patience. Finish in the global top five and the car turns to diamond,
which is purely cosmetic and entirely the point.

## Leaderboard

**Longest Track** — a `ctx.memory.record` channel, ranked by metres, daily,
weekly and all-time, global or people you follow, best-per-user.

This is a **translation, not an addition**. The original already kept a
leaderboard through Sekai's own `save_app_result` / `get_app_top_results` API,
with its own paged board UI and the same top-five diamond unlock. All that
changed is what sits behind it: `ctx.memory.record("distance")` instead of a
`postMessage` to the host. The board is rendered by the bit, and the top-five
check that unlocks the diamond now reads the real Plethora ranking.

## Notes on the port

The drawing, the path maths, the car, the camera and the race are the
original's, unchanged — same 5px sample thinning, same `pointOnPath`
interpolation, same `speed += (base - speed) * 0.1` ramp, same car drawn from
the same rounded rectangles. Tune values are the ones the build shipped:
`baseSpeed 35`, `lineWidth 40`, paper `#f8f5e6`, track `#2d3436`, car `#ff6b6b`.

Rebuilt: no CDN (Tailwind and Font Awesome inlined or replaced with SVG), no
platform scaffolding (`sekaiEditable`, the `postMessage` API, the audio unlock
shim, `snapdom` share, the social like button and the view-source modal all
gone), and Plethora owns the DOM and the frame loop.

Two deliberate fixes:

- **Frame-rate independence.** The original advanced the car by a fixed amount
  per frame, so a 120 Hz phone raced at double speed. Movement is scaled by
  delta time against 60 fps.
- **Dead state removed.** `boostTime`, `slowTime` and `pads` were declared and
  reset but never read — there is no boost mechanic in the shipped game, and its
  `boost` sound effect was never triggered.

## Divergence from the original

Approved by the repository owner, who chose "all four, substitutes everywhere"
knowing what each would cost.

| Asset | What happened |
|---|---|
| `win` sound effect | **Not substituted.** The original generated this into a buffer itself — three ascending sine tones over a linear decay — and only reached for a file if one was attached. That generator is carried over verbatim, so this is the original's own sound. |
| `boost` sound effect | Dropped. Nothing triggered it; there is no boost mechanic. |
| Background music track | **Substituted.** The only real loss. Replaced with Plethora's own generative bed (`ctx.music`, `lofi` preset at low volume) rather than an invented track. |
| Leaderboard avatars | Dropped. They were remote per-user images from Sekai; the Plethora board shows handles. |

The engine note, the finish sound and every other noise are the original's own
synthesis, so what the game *sounds* like while you play is unchanged. Only the
music underneath it is different.

## Verified

`node _skills/sekai/harness/run.js sketch-racer sc-racer.json` — 332 frames, no
console or page errors. `ready`, `start`, `interact`, `complete`,
`record.submit` and `milestone` (the diamond unlock) all fired. Screenshots
confirm drawing meters the track live, the race renders with the car angled
along the path and the camera following, the result sheet shows the distance and
personal best, and the leaderboard renders ranked entries.

The harness reports "two frames 500 ms apart are byte-identical" at the end of a
run: correct, since a finished race sitting on the result sheet is a static
frame.
