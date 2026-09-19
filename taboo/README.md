# Forbidden Five

A mobile-first [Plethora Bit](https://create.plethora.studio): the word-twisting
party game, on one phone.

One player holds the handset and has to talk their team onto the word printed
across the top of the card — without ever saying it, or any of the five words
listed underneath. The other teams read the same screen over their shoulder and
hit the buzzer the moment a forbidden word slips out.

Built for a room rather than a pair: two to four teams, up to forty names, and a
clue-giver rotation that works round every team so nobody hogs the phone.

> Say **APPLE** without RED, FRUIT, PIE, CIDER or CORE.

## Files

| File            | Purpose                                                          |
| --------------- | ---------------------------------------------------------------- |
| `plethora.json` | Manifest (`plethora-bit@2`, runtime global `window.plethoraBit`). |
| `main.js`       | The entry source (`entry: "main.js"`) — decks, UI and sound.      |

## The name

The game is titled *Forbidden Five* — for the five words under the answer —
rather than *Taboo*, which is Hasbro's mark. The folder keeps the working name,
as `galaxian/` does. Nothing about the rules is softened; only the title is ours.

## The room

Teams are 2–4, and the player list is optional — leave it empty and the game
behaves as it always did, with each team sorting out its own clue-giver.

Type names in and it does more. New players drop into the thinnest team, so
twenty names typed straight through come out 5/5/5/5. **Shuffle teams** redeals
the whole room at random; tapping a name walks that person to the next team;
the × removes them. From then on the handoff screen calls out *who* is up by
name, cycling round each team's list in order, so over a match everybody gets
the phone exactly once before anyone gets it twice.

A line under the list does the arithmetic nobody does at a party: twenty people
in two teams with four turns each means only four of ten on each team ever give
clues, and it says so, and tells you to raise turns each. Turns go to 12, which
is a full round for a team of twelve.

## A turn

1. **Handoff.** A full-bleed panel in the team's colour names the team, and the
   clue-giver by name when there is a roster, and tells everyone else to look
   away. Nothing starts until the clue-giver presses the button themselves, so
   the phone can cross the room first.
2. **Play.** The card fills the screen: the answer in a coloured band, the five
   forbidden words stacked under it. The clock drains across a bar in the same
   colour and ticks audibly over the last ten seconds.
   - **GOT IT** — a point, and the next card deals immediately.
   - **TABOO** — pressed by the *watching* team; the point comes off.
   - **SKIP** — rationed, and the button disables when they run out.
3. **Time.** The card in hand when the buzzer goes is dead — it is never logged
   and never scored, exactly as a card is discarded across a table.
4. **Summary.** Every card played, marked and totalled, credited to whoever gave
   the clues, with the running match score, then the phone goes back across the
   room.

A match runs until every team has used every turn. A tie at the top offers a
tiebreak turn each, repeating until somebody is ahead — and with three or four
teams it names the teams that are level rather than calling the whole thing a
draw.

## The decks

310 cards across five decks, dealt off one shuffled pile spanning everything
selected — so a card cannot come round twice until the pile is exhausted, at
which point it reshuffles.

| Deck              | Cards | What's in it                                    |
| ----------------- | ----- | ----------------------------------------------- |
| Classic           |  129  | Everyday objects, animals, jobs, weather, verbs |
| Food & Drink      |   46  | Meals, ingredients, the kitchen                 |
| Screen & Stage    |   45  | Film, TV, music and the business of performing  |
| Out In The World  |   45  | Travel, landscape, weather events, sport        |
| Modern Life       |   45  | Phones, the internet, work, subscriptions       |

Every card is validated at authoring time: exactly six fields, no forbidden
word equal to its answer, no duplicate answers, and no answer that is a
substring of another (so `POPCORN` and `POPCORN BUCKET` cannot both exist).

## Settings

All of it is in-game, because in this game they are the players' choices rather
than the creator's: how many teams, team names, the player list, 30/45/60/90
seconds a turn, 0–3 or unlimited skips, 2–12 turns each, which decks are in the
pile, and sound and vibration. Everything persists through `ctx.storage`,
roster included, so the same group picks up where they left off.

`manifest.tuning` sets which of those a fresh install *starts* on, plus the
things players never see: what a buzz costs, what a skip costs, when the clock
starts ticking, and the four team colours. Thirteen knobs, all bounded.

## Everything is drawn

`maxAssets` is 0, so there is nothing to load. The card stock, the buzzer, the
tick and the fanfare are all built in place.

- **Layout** is DOM and CSS inside the single root from `ctx.createRoot()` —
  the stylesheet, the screen and the hit-flash overlay are all children of it,
  and nothing is ever queried or mounted outside it. There is no `document.`
  reference anywhere in the source.
- **Sound** is a small WebAudio board: each cue is one or two oscillators
  through their own gain envelope. The buzzer is two detuned squares an
  augmented fourth apart — the game-show honk, unpleasant on purpose.
- **Feedback** is a rim flash rather than a full-screen wash, so a point never
  hides the next card.

## Contract notes

- Runtime `plethora-bit@2`, SDK 1.5.7, manifest schema 1, no dependencies.
- Permissions `audio`, `haptics`, `storage` — and nothing else is touched.
- The clock runs on `ctx.game.loop` and the turn tally on `ctx.game.score`,
  submitted once a match.
- **Controls are delegated.** Three listeners on the stage — click, input,
  keydown — handle every button for the life of the Bit. The first build bound
  each control with `ctx.input.activate` after each repaint, which registered
  sixty handlers on the first paint of the setup screen and some thirty more on
  every tap, and tore the tapped node out of the document from inside the
  handler the runtime was still dispatching on. It crashed on the first tap on
  a real device. `ctx.listen` on a container that is never replaced is the
  documented escape hatch for exactly this, and native buttons already fire
  click from Enter and Space, so keyboard activation is unaffected.
- `manifest.onboarding` is `briefing`: three pages. The rules genuinely need
  explaining before the first card, and the runtime holds play until Start.
  A **Rules** button on the setup screen replays it.
- **No `manifest.game.progress`.** The contract is explicit that progress is
  viewer-private Continue Playing state, not shared-device party state. A match
  belongs to the room, not to whoever is signed in, so it lives in the Bit.

## Leaderboard

One record channel, `best_turn`: the most words a single clue-giver landed in
one turn, dimensioned by turn length so a 90-second run never outranks a
30-second one. Submitted at the result, once a match — and again after a
tiebreak only if that turn beat what was already sent.

## Not included

The Luna listing advertises six languages. Word-association cards do not
survive translation — the five forbidden words for a word are specific to how
people actually talk about it in that language, and a machine pass would
produce cards that are either trivially easy or impossible. Five English decks
that work beat thirty that do not.

## Verified

Driven headless in Chromium against a mock `ctx` built from this manifest, at
390x800, 360x640 and 844x390:

- A full match end to end at each size — setup, handoff, all three card
  buttons, the clock running out, the turn summary, and the result screen —
  with no page errors, nothing overflowing the root, and no touch target under
  40px.
- **20 players across 4 teams**: dealt 5/5/5/5, all 20 turns played, and all
  20 distinct players gave clues, one each, in strict rotation. The partial tie
  on the result screen read "Team One and Team Four tie", not "draw".
- **22 players across 2 teams at 12 turns each**: 24 turns, 22 distinct
  clue-givers. At 20 players, 2 teams and only 3 turns each, the setup line
  correctly warns that just 3 of 10 on each team will give clues.
- Moving a player across teams and reshuffling both rebalance the split.
- With no roster at all, the original two-team game is unchanged.
- Skips disable at zero and stay live on unlimited.
- The card in hand at time-up is not logged and not scored.
- 129 consecutive draws off a one-deck pile returned 129 distinct cards: no
  card comes round twice before the pile is exhausted.
- A tie offers a tiebreak, the tiebreak resolves, and it neither edits the
  saved turn count nor suppresses a record it improved.
- Settings, team count and roster survive a return to the setup screen.
- Under a deliberately hostile mock — one that caps live activations and
  throws if a handler detaches its own target mid-dispatch — the delegated
  build registers **zero** per-element activations and takes every tap. The
  build it replaced registered 60 on first paint and threw on tap one.
