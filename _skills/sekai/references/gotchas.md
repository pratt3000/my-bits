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
size to the whole.

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
- Never ask for a username, email, password or login of any kind. Approval
  happens entirely on the creator's own device — that is the point of the flow.

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
