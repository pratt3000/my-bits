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

This is deliberately an *idealised* model: it answers "what if a train only had to
accelerate, cruise and stop?" Real trains are slower, held down by signal timers,
curves and traffic, so the express's advantage here is cleaner than the one you
would time on a platform. The premise is stated on screen in every round rather
than buried, because the whole lesson depends on both trains sharing it.

Rounds ask for one of three predictions — the express's running time, the minutes
it saves, or its average speed — scored on relative accuracy, squared, out of
1000. Lexington Avenue always opens, because a 20-stop local against a 6-stop
express is the clearest statement of the idea; the other four are drawn from the
remaining corridors, so the run varies.

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
