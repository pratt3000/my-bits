# Gotchas

Traps that have actually cost time, with what they looked like and how to avoid
them. **Add to this file whenever a port surprises you** — that is the whole
point of it, and a trap recorded here is one nobody pays for twice. Note the
symptom as well as the cause, because next time you will recognise the symptom
first.

---

## Runtime

### `ctx.storage.set()` returns nothing — never chain onto it

**Symptom:** the bit works, but a `TypeError: undefined is not an object
(evaluating '….catch')` appears, usually a beat *after* an interaction rather
than during it.

`sdk.md` documents `storage.get`/`set` as plain calls, not promises, and on
device `set()` returns nothing at all. A `.catch()` on that result throws and
takes the bit down. Because the write is usually debounced, the crash lands
after the interaction that triggered it, which makes it look unrelated.

Route every write through a helper that tolerates all three cases — absent,
throwing, and not thenable:

```js
function fireAndForget(thunk) {
  try {
    const r = thunk();
    if (r && typeof r.catch === "function") r.catch(() => {});
  } catch (err) { /* not supported on this runtime */ }
}
```

Reads can stay on `await`, which copes whether or not a promise comes back.
`check.py` catches the chained form. `ripcord/` and `waveflow/` both carry this
helper.

**The general lesson, which is bigger than storage:** never assume a runtime
call is thenable, and be suspicious of any mock that is *more* permissive than
the documented contract. This bug passed every headless run because the harness
mock had `storage` as `async` when the contract says otherwise. A mock that is
kinder than reality is worse than no mock.

### A flick in the harness is slower than it looks

**Symptom:** a bit that reads flick speed from pointer events ignores every
drag the scenario sends, or reads one as absurdly fast, while the same code is
fine on a phone.

`page.mouse.move()` waits for the renderer to acknowledge each event. Under
software rendering a frame can take most of a second, so a scenario's "220 ms"
six-point drag really takes four to eight seconds and the event timestamps say
so — the bit is right to call it slow. `run.js` now sends mouse events over
CDP without awaiting them one by one, stamped with the real send time, which
is what a finger looks like: events arrive on a real clock and the renderer
coalesces them behind a slow frame. Two things to carry into the bit itself:
measure speed from `event.timeStamp`, never from a clock read in the handler
(handlers run late when frames are slow), and unpack `getCoalescedEvents()`
so a batched move still yields real samples. Found with `crumple/`.

Also: a six-point drag has five sleeps, so its real duration is 5/6 of `ms`,
and a scenario can set `"dpr": 1` to render four times fewer pixels.

### Full screen: the logo button sits where a bottom control wants to be

**Symptom:** a bit that used to look right has its bottom-centre control, or
its drag start, under Plethora's logo button; or a bit laid out from the
`onResize` payload gets a zero bottom inset on an older app.

Since SDK 1.7.0 a bit declares `"display": "fullscreen"` and covers the whole
phone; the logo floats over the bottom centre and `ctx.contentSafeArea` is
`ctx.safeArea` moved in past it (bottom ≈ 108 on an iPhone, ≈ 130 on Android
with 3-button navigation). Read `ctx.contentSafeArea ?? ctx.safeArea` — the
`??` matters, because on an app from before full-screen support the same
file plays in the legacy safe frame where `contentSafeArea` is undefined and
`safeArea.bottom` is a fixed 120. Read it from `ctx`, not from the `onResize`
callback's payload, whose `safeArea` is all zeros in the safe frame. The
three inset objects are frozen live values: assigning to them does nothing
(and throws in strict mode), so the harness scenario changes them through
`window.__setInsets(...)`, never by assignment. If a scene puts the thing a
finger has to reach near the bottom — `crumple/`'s resting paper ball — make
the camera or layout guarantee it clears `contentSafeArea.bottom`, and prove
it with a squat viewport, where a fixed composition fails first.

### The contract moved hosts, and the old host does not say so

**Symptom:** the docs you fetch say `2026-09-06.1` / SDK 1.5.7 and know
nothing about full screen, while the creator says the SDK is 1.7.0.

`api.plethora.studio/v1/agent/*` still answers, with the stale set, however
hard you cache-bust. The canonical agent origin is `agent.plethora.studio`
(announced in `https://plethora.studio/llms.txt`), and every document there
carries a `Context version:` line — read it before trusting anything.
`upload.py` and the README links point there now. Found with `crumple/`.

### Anything that only appears on device

The harness runs desktop Chromium. Things it cannot tell you about: real audio
output, real haptics, actual touch behaviour, iOS WebKit quirks. When a bit
passes clean and still misbehaves for the creator, suspect this list first, and
ask for the exact error text — the runtime surfaces it in an overlay.

---

## Upload validator

The validator reports almost everything as **"This bit uses unsupported remote
resources"** regardless of the real cause, so the message is close to useless
for diagnosis. Known triggers, none of which are about remote resources:

- `document.createElement("canvas")`
- `getBoundingClientRect` — including where it is only *named in a comment*
- `addColorStop()` with a colour it cannot resolve to a literal
- `const <name> = <call expression>` — in at least one case the local's *name*
  alone was enough
- **A `ctx.createCanvas2D()` fallback anywhere in the file plus a loop writing
  into `getImageData(...).data` anywhere else** — even when the pixels never
  come from that canvas. Either alone passes. Bake to `OffscreenCanvas` or
  nothing (`crumple/`, and the same policy in `cairn/` and `pixel-fog/`).

See the root `README.md` "Upload-validator gotchas" section, which links to the
bits where each was found.

**How to bisect a rejection cheaply.** A rejected upload creates nothing, so
probe uploads are free. Make every probe fail a *later* check than the resource
scan — rename `window.plethoraBit` to something else, so a source that clears
the scan fails on "must define window.plethoraBit" instead. Then the two
outcomes are distinguishable and no probe can create a draft. Bisect by line
range; unreachable code is still scanned, so slices work even when they do not
parse.

Two caveats learned the hard way: manifest checks run *before* the source scan,
so a deliberately-broken manifest tells you nothing; and a small slice may pass
simply for being small, so confirm a "clean" verdict on a slice of comparable
size to the whole. Two more from `crumple/`: the validator concatenates every
complaint into one message, so judge a probe on whether the *remote resources*
phrase is present, not on whether the message changed; and it rate-limits —
a dozen probes in parallel all came back "Request deadline exceeded", which is
a timeout, not a verdict. Run probes one at a time. The bisection is in
`crumple/README.md`; its probe script posted the exact draft payload with
`window.plethoraBit` renamed, which is all a probe needs.

### Duplicate drafts

Re-uploading the same title does not reliably update in place — it has been
observed creating a second draft. There is no agent endpoint to delete one, so
the creator has to clear it in the app. `upload.py` keeps a ledger in
`~/.plethora/uploads.json` and warns when a known title comes back `created`.
If it does, say so immediately rather than letting them find it.

---

## Pairing

- Codes expire **ten minutes** after minting. Only mint when the creator says
  they are at their device; four expired unapproved in one session because they
  were minted while nobody was looking.
- The exchange endpoint rate-limits below roughly **15 seconds**. Polling at 4s
  returns `rate_limited`.
- The access token is returned **exactly once**, on the approved exchange.
  Write it to disk before doing anything else with the response.
- The token **expires four hours after approval** (`tokenExpiresAt`), not
  when revoked. `upload.py` then fails with "Agent token is invalid, expired,
  revoked, or missing draft scope" and a new code is needed — and that new
  code expires in ten minutes, so ask the creator first. A session that ran
  overnight lost an upload this way (`crumple/`).
- Never ask for a username, email, password or login of any kind. Approval
  happens entirely on the creator's own device — that is the point of the flow.
- A token minted through the old `api.plethora.studio` pairing endpoints is
  accepted by `agent.plethora.studio` — same backend, different front door —
  so switching hosts mid-session needs no second pairing (`crumple/`).

---

## Fit

Not every game can become a bit, and the ones that cannot usually fail on
content rather than code. Packaged assets are disabled entirely (`maxAssets: 0`),
so a game built around sprites, samples or a custom font has no route that keeps
it intact. `grab.py` detects this and stops; SKILL.md step 1a is what to do
about it.

The failure mode to avoid is subtle and worth naming: with source access and a
capable renderer it is genuinely easy to *generate a replacement* — draw the
sprite procedurally, synthesise the sound — and end up with something that runs,
looks plausible, and is no longer the creator's work. It reads as a successful
port right up until they open it and find art they never made. Detecting the
constraint is the easy half; not quietly routing around it is the point.

## Recovery

- Sekai play pages are Next.js shells; the game address is in the flight data
  under `gameUrl`, sometimes escaped as `\"gameUrl\":\"…\"`. `grab.py` handles
  the forms seen so far — if it fails, open the saved page and search by hand,
  then teach `grab.py` the new pattern.
- A game may reference an icon by a name its icon library does not have — the
  button simply renders empty, and it is easy to reproduce the emptiness
  faithfully without noticing. `icons.js` reports misses explicitly.
- When previewing the recovered original, vendor its CDN scripts first.
  Sandboxes block those hosts, and a failed library load can abort the page's
  init, leaving a blank screen that looks like a failed recovery when the
  recovery was fine.
