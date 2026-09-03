---
name: sekai
description: Port a game from a Sekai link (sekai.ai/play/… or a prod-data.sekai.chat bundle) into a Plethora bit in this repo — recover its source, rebuild it against the plethora-bit@2 contract, verify it headlessly, and upload it as a draft. Use this whenever someone shares a sekai.ai link, asks to turn a game or web page they made into a bit, asks to recover the source of something they built on another platform, or asks to port, convert or re-host an existing interactive page as a Plethora bit — even if they don't say "port" or name Plethora. Also use it for the mechanics it bundles: running a bit headlessly in Chromium, validating a manifest before upload, pairing with Plethora, or uploading a draft.
---

# Sekai → Plethora bit

A Sekai game is a single self-contained HTML page. A Plethora bit is a module
that runs inside someone else's page. This skill is the route between them, plus
the tooling to prove the result works before it reaches anyone's phone.

Everything here is `python3` and `node` with Playwright already installed. Paths
below are relative to this directory.

## The route

Work in a scratch directory, not the repo — only the finished bit belongs in
version control.

### 1. Recover

```bash
python3 scripts/grab.py <sekai-url> <scratch>/recovered
```

Finds the real bundle behind the play page, downloads it, splits out the inline
scripts, stylesheet and markup, and prints an inventory: what it loads from a
CDN, what platform scaffolding is wrapped around it, its repeated controls, its
icons. **That inventory is the porting brief** — everything in it has to be
inlined, dropped, or rebuilt.

Optionally see it running first, which is faster than inferring the design from
source and reveals bugs the original already had:

```bash
node scripts/preview.js <scratch>/recovered/original.html
```

### 1a. If there are hard constraints, stop and ask

`grab.py` ends with a `STOP` block and writes `BLOCKERS.md` when the game
depends on something a bit cannot have: packaged image, audio, video, font or
model files (Plethora sets `maxAssets: 0`), a web font, or a server it talks to.

**When that happens, do not start building. Ask the creator first**, with
`AskUserQuestion`, and wait for an answer.

The reason is not procedural caution. There are only three ways past a hard
constraint, and all three change what the thing *is*:

- **substitute** — generate replacement art or sound procedurally,
- **drop** — cut the feature that needs the asset,
- **don't build it** — the game is not a good fit for a bit.

Choosing any of those silently means handing back something that looks like a
port but is partly your invention wearing the creator's name. They asked for
their game. Only they can say which compromise is acceptable, or whether any is.
So present what is blocked, in plain terms, say what each option would cost, and
let them pick. If they want it built anyway, build exactly what they chose and
nothing more — do not improvise a second substitution later in the port because
it seemed convenient.

Libraries listed under "needs checking" are a different matter: look them up in
`libraries.json` first. If Plethora has an approved pin, there is no constraint
to raise. Only bring it to the creator if there is no pin and no way to do
without it.

### 1b. Mark it, whatever they decide

A port that diverged must say so, permanently, in three places — otherwise in
six months nobody can tell which bits are faithful and which quietly are not:

- `inventory.json` already records `blockers`; keep the recovered directory.
- The bit's `README.md` gets a **`## Divergence from the original`** section
  naming each constraint, the decision taken, and who took it. Write it even
  when the answer was "substitute and carry on" — especially then.
- `LOG.md` gets the same summary in its entry.

If they decide not to build it, still add the `LOG.md` entry. A recorded "we
looked at this and stopped, because X" saves the next person from starting over
and rediscovering X.

### 2. Read `game.js` before writing anything

Read it properly, all of it. You are about to decide which parts are the
*simulation* (keep verbatim) and which are the *shell* (rebuild), and that
judgement needs the whole picture. The simulation is usually the valuable part
and usually has no DOM in it.

### 3. Port

Read `references/porting.md` — the mapping table, the required structure, the
layout maths for a phone-shaped container, and what to add that the original
lacked.

If the original used lucide icons, inline their geometry rather than the script:

```bash
node scripts/icons.js --from <scratch>/recovered/inventory.json
```

Write the bit into a new folder at the repo root, following the repo's
convention: `<bit-name>/` containing `plethora.json`, `main.js`, `README.md`.

### 4. Verify

```bash
node harness/run.js <repo>/<bit-name> harness/scenarios/example.json
```

Drives the bit in headless Chromium against a deliberately strict mock `ctx` —
anything `sdk.md` does not document is absent, so calling it throws here rather
than on a phone. Reports console and page errors, whether `ready()` fired,
whether frames advanced, and writes screenshots to `shots/<bit>/`.

Write a scenario for the bit's real interactions; copy `harness/scenarios/example.json`
as a starting point. Steps: `wait`, `tap`, `press`, `drag`, `circle`, `zigzag`,
`down`/`moveTo`/`up` (held gestures, so you can screenshot mid-drag), `eval`,
`screenshot`, `resize`, `expectEvent`.

**Look at the screenshots.** A bit can run clean and still look wrong — mangled
layout, an unreadable palette, a control off-screen — and the console will never
say so. This is the step that catches it, and skipping it is how a broken-looking
bit gets shipped with a green test.

### 5. Check, then upload

```bash
python3 scripts/check.py <repo>/<bit-name>     # gates the upload; exits non-zero on failure
python3 scripts/upload.py <repo>/<bit-name>
```

`check.py` verifies the manifest and scans for constructs the upload validator
rejects. Its value is that the validator's own error message names the wrong
cause almost every time, so catching things locally saves a bisect.

If pairing is needed, `python3 scripts/upload.py pair` mints a code. Only mint
one when the creator says they are at their phone — codes last ten minutes, and
they must approve on their own device. Never ask for a login of any kind.

Publishing is always the creator's own action; uploading only creates a draft.

### 6. Record what you learned

Append an entry to `LOG.md`, and if something surprised you, add it to
`references/gotchas.md`. Read both **before** starting a port — `gotchas.md` in
particular is the accumulated cost of previous mistakes, and it is short.

## Fidelity

Port the simulation unchanged — same constants, same coefficients, same
structure. If the result sounds or behaves differently from the original, that
is a bug, and having also "improved" things while porting makes it much harder
to find. Improvements are a separate, later conversation.

Two exceptions worth making deliberately, and mentioning to the creator:

- **Bugs the original had.** If a control never worked, fix it and say so.
- **Things the bit contract requires.** No CDN, no document ownership. These are
  not choices — but note the difference between *rewriting* a dependency and
  *replacing content*. Inlining Tailwind as styles or lucide as SVG changes no
  pixel the creator chose; it is the same design expressed differently, so it
  needs no permission. Generating a sprite to stand in for one you cannot ship
  is new content, and that is step 1a's territory.

The line to hold: rebuild the shell freely, never invent the substance.

## Before you start

Fetch the current contract — it is the source of truth and it changes:

- `https://api.plethora.studio/v1/agent/context.md`
- `https://api.plethora.studio/v1/agent/sdk.md`
- `https://api.plethora.studio/v1/agent/schema.json`
- `https://api.plethora.studio/v1/agent/libraries.json`

## Files

```
scripts/grab.py       recover a game from its link, print the porting brief
scripts/preview.js    run the recovered original standalone, screenshot it
scripts/icons.js      inline lucide icon geometry; reports icons that do not exist
scripts/check.py      manifest + validator pre-flight; gates the upload
scripts/upload.py     pair once, then upload drafts; warns about duplicates
harness/run.js        drive a bit headlessly against a strict mock ctx
harness/scenarios/    example scenario to copy
references/porting.md the mapping, in detail — read before writing the bit
references/gotchas.md traps that have cost time — read before starting
LOG.md                one entry per port
```

`harness/vendor/` is fetched on demand (three.js, lucide) and is not committed.
