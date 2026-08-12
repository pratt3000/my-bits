# Skip Stop

A minimalist New York subway map with a physics lesson hiding inside it.

An express train has no higher top speed than the local running beside it on the
same trunk. It wins purely by not stopping. Each round frames one real corridor,
states the kinematics, and asks you to predict the outcome before dispatching
both trains down the actual track.

```
skip-stop/
  plethora.json   # manifest: one global leaderboard, no dependencies
  main.js         # entry — the map, the model and the game, with the geometry baked in
  README.md
```

## The map

Everything on it is real, and all of it is baked into `main.js` as projected
metres (there is no network egress at runtime and packaged assets are disabled).

| Layer | Source |
| --- | --- |
| Track centrelines, stopping patterns | MTA GTFS (`gtfs_subway.zip`, feed of 2026-07-31) |
| PATH | Port Authority GTFS |
| Shoreline — the five boroughs | NYC Open Data, Borough Boundaries (`gthc-hcne`) |
| Shoreline — surrounding region | US Census cartographic counties, 500k |
| Parks | NYC Open Data, Parks Properties (`enfh-gkve`) |

Coordinates are projected to metres about 40.725 N, 73.94 W and simplified with
Douglas–Peucker at 7 m for track and 45–55 m for land, which comes to about 4,000
line vertices, 488 stations and 110 polygons.

Four decisions worth recording:

- **Stopping patterns come from the *dominant* weekday trip pattern per route,
  not the longest.** The 4, A, E and F all run local late at night, and those
  late-night patterns have the most stops — so picking by length silently turns
  every express into a local. This was caught by the 6 and the 4 reporting
  identical journeys down Lexington Avenue.
- **The Staten Island Railway is excluded.** It is a separate railway rather than
  the subway, and including it drags the frame so far south-west that the network
  itself shrinks to a corner. Staten Island's landmass stays.
- **The five boroughs use NYC's own shoreline, the surrounding region uses census
  counties.** Census county polygons swallow bays — Queens reads 330 km² against
  281 km² of real land — so they are only good enough for the ring of land around
  the city. The two shared borders are legal survey lines, so the seam between the
  sources is sub-pixel.
- **PATH is drawn but not framed for.** It is the one rapid-transit service here
  that actually crosses into New Jersey, so it belongs on the map, but including
  its Newark tail in the opening shot costs the subway a fifth of its size and
  leaves the frame half empty. It runs out past the edge instead.

### Colour, and the lane problem

The MTA colours the *trunk*, not the service, so 1/2/3 are all the same red down
Seventh Avenue. Where services share track and share a colour, overdraw is
therefore correct and the map stays clean. Where differently-coloured services
genuinely share track — 2 beside 5 up White Plains Road, B/D beside N/Q over the
Manhattan Bridge — every vertex carries a **baked lane rank**, computed by
stamping all track into a 45 m grid and ranking each route's colour among the
distinct colours sharing its neighbourhood. The rank is offset perpendicular at
draw time in screen pixels, so a pair reads as a pair at every zoom instead of one
hiding the other.

That same shared palette means a corridor's local and express are usually the
*identical* colour, so the round view carries its own grammar: the express is the
bold track with ringed stops, the local the hairline with small ones, and each
train rides as its own route bullet. The same weight distinction labels the two
curves on the result graph.

## The model

Between platforms a train accelerates at 1.0 m/s², holds 72 km/h if there is room
for it, and brakes at 1.1 m/s². Short hops never reach cruise at all and get a
triangular profile — which is exactly why tightly spaced local stops cost so much
more than their 30 s dwell alone. Distances are measured along the real track
geometry, so a round's numbers are properties of the corridor rather than
invented.

On screen those constants are quoted as **times, not accelerations**: "20 s to
wind up to 72 km/h, 18 s to brake back to a stand, 30 s waiting at every stop".
It is the same model — 20 m/s ÷ 1.0 m/s² is 20 s, and ÷ 1.1 m/s² is 18 s — but
"brake at 1.1" with the unit dropped is not a sentence anyone can read, and the
whole lesson depends on the premise landing.

This is deliberately an *idealised* model: it answers "what if a train only had to
accelerate, cruise and stop?" Real trains are slower, held down by signal timers,
curves and traffic, so the express's advantage here is cleaner than the one you
would time on a platform. The premise is stated on screen in every round rather
than buried, because the whole lesson depends on both trains sharing it.

Rounds ask for one of three predictions — the express's running time, the minutes
it saves, or its average speed. Lexington Avenue always opens, because a 20-stop
local against a 6-stop express is the clearest statement of the idea; the other
four are drawn from the remaining corridors, so the run varies.

## Scoring, and the leaderboard

Points are how close you were, nothing else:

```
tol  = max(truth × 0.6, 3 min)      # or max(truth × 0.5, 12 km/h) for speed
acc  = clamp(1 − |guess − truth| / tol, 0, 1)
pts  = round(1000 × acc^1.5)
```

Exact is 1000, so a run tops out at 5000. The tolerance is proportional to the
answer but **floored**, because some answers are small: a corridor where the
express saves two and a half minutes should not demand you land inside ninety
seconds when a twenty-minute answer gets a wide margin. The `^1.5` curve keeps
near-misses worth having — 10% off is still 761 — while falling away fast enough
that a wild guess is worth nothing. Each round's closeness is also drawn as one
of five bars on the final screen, so you can see where the run was won.

Dispatch stays disabled until the slider is moved. The control's midpoint sits
close enough to the true express time to be worth around 700 points on its own,
and a leaderboard should not pay out for leaving it alone.

The total goes to the `run_score` record channel — global and following, all-time,
best per user — and the finish screen renders that board in place rather than
only submitting to it: top five, your own row highlighted, and pulled in below
the fold with a `···` divider if you placed outside the top five.

The shape of a leaderboard response is not pinned down anywhere in the agent
contract, and there is no worked example of `leaderboard()` to copy, so the
reader accepts entries under `entries` / `rows` / `items` / `leaderboard` /
`results` / `scores` or a bare array, at the top level or nested under `data`,
and reads each row's name, value and "is this me" flag through a list of
plausible field names. Anything it cannot recognise degrades to a quiet "Scores
are not available right now" instead of a broken panel. All four states —
loading, populated, empty, unavailable — are exercised in the harness.

## Handling the map

One finger drags, two pinch. Zoom is bounded so you can always pull back far
enough to see the whole network and push in until a pixel is about three metres —
past that, a map with no street detail is only thick lines on white. Panning is
fenced to the network plus a 2.5 km margin, so the map cannot be flung off into
empty projection space.

A press only counts as a tap if it moved less than 11 px and lasted under half a
second, so dragging never fires a station label or a fast-forward by accident,
and a second finger landing cancels the tap outright. Touching the map also
seizes the camera from any running fly-to, rather than fighting it. Changing
screen — a new round, the result, the finish — re-frames as it always did, which
doubles as the way back if you get lost.

Station dots grow and gain their dark ring as you zoom in; at whole-network scale
they stay small translucent notches, because 488 ringed dots at that size turn
every line into a dashed one.

## Sound

**Each train rings as it pulls into a platform, pitched by service** — the local
on C5, the express an octave above on C6. That is the whole point of it: down
Lexington Avenue the local rings sixteen times to the express's four, so the
difference is audible before it is on the graph. Cues are throttled to 95 ms
apart and dropped entirely under fast-forward, where the real spacing collapses
into a rattle. There are small cues for dispatch, the express's arrival, the
result and the run's end, and a quiet ambient bed from `ctx.music` underneath.

Every cue is **synthesised in-bit over WebAudio** rather than taken from
`ctx.music`'s sting set. The first version used the stings and produced no sound
at all on device. From inside a bit that engine is a black box: each call is
wrapped and each failure silent, so when nothing comes out there is nothing to
read, and the whole path was gated behind `ctx.capabilities.backgroundMusic`
alone. A dozen lines of WebAudio gives exact control of pitch, envelope and
level, lets the two services ring an octave apart, and — the reason it matters —
can be **measured**: the harness splices an analyser in front of the destination
and asserts real peak amplitude, and wraps `createOscillator` to record every
pitch the bit asks for. "It called something that might make a sound" is not a
test.

Two things that only showed up under that measurement:

- **A context can report `running` a beat before its clock starts advancing.**
  An envelope written against `currentTime` while it still reads zero has already
  elapsed by the time anything would be heard, so the first cue of a session was
  silently dropped — measured peak 0.0001 against 0.13 for every later cue.
  Cues now wait for the clock itself rather than the state flag, and give up
  after ~360 ms and fire anyway rather than swallow one. Every cue is scheduled
  a 30 ms lead-in ahead of `currentTime` for the same reason.
- The station cue is throttled on a **shared** timer across both trains, so a
  frame where both pull in together rings once rather than twice.

The speaker button in the top bar mutes everything and the choice is remembered
in `ctx.storage`. Audio only ever starts from a user gesture and every call is
wrapped, so a WebView that refuses to play costs nothing but silence.

`ctx.music`'s handle is deliberately never held: everything needed is on
`ctx.music` itself, and keeping the returned object is the const-alias shape the
upload validator rejects (below). `AudioContext` is permission-gated, so the
manifest declares `audio` alongside `backgroundMusic`.

## Contract notes

- No dependencies and no packaged assets. The map, the model and the type are all
  drawn at runtime; the only payload is the baked geometry.
- The base map is static whenever the camera is still, so it is baked once per
  camera state to an **`OffscreenCanvas`** and blitted. The runtime owns every
  canvas in the DOM and the upload validator rejects
  `document.createElement("canvas")`; where a WebView has no `OffscreenCanvas`,
  `makeSurface()` returns null and the map is drawn live each frame instead.
- The overlay is declared as **markup on the `ctx.createRoot()` element** and the
  handles queried back out — bits may not reach into the host DOM. The root fills
  the container, so it is explicitly `pointer-events: none`; only the panel takes
  input, or the map underneath would never see a tap. Slider track and thumb are
  pseudo-elements and cannot be styled inline, so those few rules ride along in
  the root's own markup, scoped to `.ss`.
- Pointer positions come from `event.offsetX/offsetY`, which are already
  canvas-relative. `getBoundingClientRect()` is rejected by the validator.
- Timers go through `ctx.timeout`, listeners through `ctx.listen`.

### Two more constructs the upload validator rejects

Both surfaced as `"This bit uses unsupported remote resources. Use
ctx.loadScript(), ctx.importModule(), or ctx.loadFont() … Loader args may be
direct literals or simple const aliases only."` — a message that names none of
the actual causes. Both were found by bisecting real uploads, and neither is
documented in `sdk.md`. Neither construct fires on its own in a small file; each
needs enough of the rest of the source present, which suggests the check scores
signals rather than matching one pattern, and makes a lone minimal repro
misleading.

- **Binding a maybe-promise to a local and then handling rejection on that
  local** — the `const p = thing(); if (p && p.catch) p.catch(…)` shape — reads
  as a loader reached through a const alias. Three sites used it, guarding
  `ctx.music.sting`, `ctx.music.unlock` and `ctx.memory.record().submit()`. All
  three now pass the result straight to an `ignore()` helper and never re-bind
  it. The pattern is rejected **inside comments too**, so it cannot be quoted
  verbatim when explaining the workaround.
- **A local named `st` used with dot-property access** — `st.textContent`,
  `st.style.color`. Renaming it to `tally` fixed it with nothing else changed;
  the selector string it was assigned from made no difference either way, and
  `st` as a `for…of` binding read with `st[0]` is fine. The `.st` data key is
  also fine. Loop bindings were renamed to `sp` anyway, to keep one name for the
  idea.
- One global leaderboard, `run_score`, submitted once at the end of a run. The
  personal best is kept in `ctx.storage`.
