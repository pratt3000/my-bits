# Cipher

Twenty-five codewords, two teams, one phone.

A hidden key marks nine of the words RED, eight BLUE, seven innocent
bystanders and exactly one assassin. Each team's spymaster is the only person
who sees that key. They say **one word and one number** out loud; their
operatives argue, then tap. Your own colour keeps the turn alive, a bystander
ends it, the other team's colour ends it *and* helps them, and the assassin
ends the whole game where it stands.

Original name, original art, original word deck. The mechanics are the
classic hidden-key word game; the look is a 1960s intelligence dossier.

## Files

| File | What it is |
| --- | --- |
| `plethora.json` | manifest — `backgroundMusic`, `haptics`, `storage`, one leaderboard, no dependencies |
| `main.js` | the whole bit: deck, rules, art, handoff, HUD |
| `tools/harness/play-cipher.mjs` | plays a full three-turn match to a real win |
| `tools/harness/play-cipher-assassin.mjs` | plays the co-op deal and the assassin |

## The key is never on screen unheld

This is the only hard problem in adapting this game to one device, and every
other decision bends around it.

There is **no screen a player can wander into that shows the key**. It is not
behind a toggle, not on a tab, and not reachable from the board at all. Each
turn opens with the phone shuttered closed and `PASS THE PHONE TO THE RED
SPYMASTER` typed across it, set the right way up for the seat the phone is
travelling to. The only control on that screen is a fingerprint pad, and the
key appears only while a finger is held on it for 700ms — and is gone in the
same frame the finger lifts.

Two details make that survive contact with a real table:

- **The pad occupies the same coordinates on the handoff screen and on the
  clue screen.** The shutters open *under a finger that is already down*, so
  reading the key and writing the clue is one continuous gesture rather than
  two screens and a hunt for a second button.
- **The hold runs on wall-clock time, not on accumulated frame time.** A
  device that drops a long frame still finishes the hold in 700 real
  milliseconds; measuring it by summing frame deltas makes the gate quietly
  longer on exactly the cheap phones where it matters.

While the key is up, a red frame pulses around the whole screen and a
`KEY EXPOSED` stamp sits at the top. The stamp holds that position whether or
not the key is showing — it reads `SPYMASTER ONLY` otherwise — so nothing
jumps, and it is impossible to have the key on screen without a stamp saying
so.

## The board is orientation-neutral; the chrome is not

Every codeword is printed **twice on its tile, once upright and once rotated
180°**, exactly as the physical cards are. Both sides of the table read the
grid without anybody turning the phone, and no tile ever rotates under a
finger.

Only the two HUD bands turn. Each team gets the band at its own physical edge,
rotated to face it, and the idle one drops back so there is never a question
whose move it is — while still carrying that team's own last clue, dimmed and
tagged `LAST CLUE`, the way a spoken clue hangs around in the room. Settings
has a **Red sits at the Bottom / Top** switch for groups sitting the other way
round.

Both bands lay out inside one shared height, set by the *deeper* of the two
safe areas, so the two teams get identical controls rather than one of them
getting a taller balloon because their edge has no home indicator.

## A touch is final, so a touch is never enough

Tapping a codeword only **arms** it: the card lifts and a dashed reticle turns
around it. The contact is committed by a separate `CONFIRM CONTACT` button
down in the active team's own band, which also names the armed word. The
assassin ends the game instantly and a fat finger must not be able to do that.

`END TURN` unlocks only after the mandatory first guess, which is the rule as
written.

## Layout

Nothing goes in the side margins. At 390px wide, a 370px grid leaves ten
pixels a side, so a button column there covers the outermost column of play.
The utility chrome lives in a 40px **spine** between the grid and the near
band — the one horizontal strip that belongs to neither team — and it steps
out of the way entirely on the title, handoff and result screens.

```
┌──────────────────┐  blue band   — rotated 180°, blue's own edge
├──────────────────┤
│   5 × 5 grid     │  370px square, dead centre
├──────────────────┤
│ spine  ♪ ⚙ ?     │  neutral chrome, 40px
├──────────────────┤
└──────────────────┘  red band    — upright, red's own edge
```

## Rules, in full

- 9 / 8 / 7 / 1. Red starts, so red owns the ninth word.
- The number is how many codewords the clue points at; the team gets that
  many guesses **plus one**, and the bonus pip is drawn hollow so you can see
  which guess is the borrowed one. It can be switched off in settings.
- **0 and ∞ both lift the cap** — those are the two official special numbers,
  and zero additionally means "none of ours", a pure warning.
- Guessing the opposing colour scores for them, and can therefore **hand them
  the win on your own turn**.
- The assassin ends the game and the team that touched it loses.
- 2–3 players get the official **co-op variant**: one team, one spymaster,
  racing a simulated opposition that covers one of its own words at the end of
  every turn. The handoff still happens, because the operatives still must not
  see the key.

## Drawn, not loaded

Packaged assets are disabled and there are no remote URLs, so every pixel is a
canvas path.

- The **sunburst** is a radial gradient, fourteen onion rings and a corner
  vignette, baked once. Only the thirty-six rays turn, at 0.004 rad/s — far
  too slow to notice, which is the point: it keeps the screen alive through
  the long silences of a talking game without pulling an eye off the grid.
- Each of the **25 tile faces** is baked into its own `OffscreenCanvas` and
  blitted. An unrevealed face is a rounded card, a generated paper grain, an
  inset plaque, a hairline with a rivet and two chevrons, and the codeword
  printed twice — around fourteen paths and two text layouts. Times 25, times
  60 frames a second, that is not a thing to do live. Every bake site has a
  live-drawing fallback for WebViews with no `OffscreenCanvas`.
- The four **agent faces** are flat silhouettes with a single rim light, and
  the rim is a lit copy of the same paths offset up-left and then covered —
  stroking them instead draws every interior seam, and a head comes out ringed
  like a coin.
- The key's **glyph-per-colour pairing** (rounded diamond for red, ring for
  blue) is a colour-blind affordance, so it repeats in the corner of the
  covered card rather than living only on the key.
- Clue words are typed on an **on-canvas QWERTY**. A DOM text field would
  summon the system keyboard over a phone that is deliberately being shielded.
  There is no space key: a clue is exactly one word.

Ten-letter words are the make-or-break of five columns in portrait, so the
deck is capped at nine characters and every codeword is fitted by
binary-searching `measureText` — counting the letter-spacing, which on a
headline is most of the width — with the display face falling back through a
condensed system stack.

## The deck

528 common, concrete, deliberately ambiguous nouns — the kind that carry two
or three unrelated senses, which is the whole game. No proper nouns (a clue
may legally *be* a proper name, so putting one on the board only starts
arguments), nothing longer than nine characters, and nothing anybody has to
apologise for saying at a table.

## Leaderboard

**Fewest Guesses to Win** — how few contacts this board took to settle,
counting both teams. It is a property of the *match*, not of one of the up to
eight people sharing the phone, which is what a couch game should be putting
on a global board. Nothing is submitted when the assassin ends it.

## Sound

A low `drift` bed under a talking game, tightening as a team's agents run out.
`success` when the key comes up, `powerup` on transmit, `tap` on arming,
`coin` on your own agent, `fail` on a bystander, `danger` on the other team's,
`lose` on the assassin, `win` on the last agent — with `duck` before each
reveal and haptics on contact. All of it wrapped in try/catch and mutable from
the chrome or settings; audio is a nicety and must never break a hand.

## Two things worth remembering

- **The overlay swallows every tap** unless the root is `pointer-events: none`
  with controls opting back in. `ctx.createRoot()` is created after the canvas
  and fills the container, so the bit boots, renders and animates perfectly
  while ignoring the player.
- **Wait on the animation, not on the state.** A contact commits at the
  midpoint of the card's turn-over and the board rejects input until it lands,
  so both play scripts poll an exposed `busy` flag rather than watching the
  score.
