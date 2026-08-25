# Bluffin

A lying game for three to eight people and one phone.

Everyone sees a fact with a hole in it. The phone goes round once and each
player secretly types a lie to fill the hole. Then it goes round again showing
every lie shuffled in with the truth, and each player picks the one they think
is real.

- **+1000** for finding the truth
- **+500** for every person your lie catches
- **+1500** if you accidentally write the actual truth, and everybody is told

## The one hard problem, and why "hold to look" is wrong

This game is *entirely* hidden information on a device with one screen, so the
handover is the whole design. A full-bleed cover names who should be holding
the phone, and nothing secret exists until they open it.

The obvious pattern — hold a button to reveal, let go and it hides — **does not
work here**, and it took building it to see why: the screen behind the cover
has to be typed into and tapped, so holding it open would take a third hand.

So the reveal is a tap, and the exposure is bounded by the player's own commit
instead. Locking in a lie, or picking an answer, returns straight to the cover.
The phone is never left sitting on somebody's secret waiting for them to
notice.

## Details that matter at a table

- **Your own lie is shown to you, greyed out and untappable.** Hiding it would
  leave you wondering where your answer went; showing it tappable would let you
  vote for yourself.
- **Duplicate lies are refused as you type them.** Two identical answers on the
  board make the vote meaningless, so the second person is asked for another.
- **Answers are compared loosely** — case and punctuation are stripped — so
  "The Alamo" and "the alamo!" are one answer, and typing the truth by accident
  is caught however you punctuate it.
- **Everything a player types is escaped** before it goes near `innerHTML`.
- Names are optional. Leave them blank and they fill themselves in.

## Look

Soft aurora gradients drifting behind glass cards, with a fine grain over the
top so the gradients never band on an OLED. The background is a canvas painted
once per frame and nothing else — the typing screens are DOM, so they are never
competing with a canvas repaint while somebody is mid-word.

Each player has a colour, and it follows them: their name on the cover, the
button they press, their vote chips on the reveal, their row in the scores.

## Verifying it

`tools/harness/play-bluffin.mjs` plays a full three-player round through the
UI — three handovers to write, three to vote, then the reveal — and asserts the
scoring. Player 0 finds the truth and both others fall for player 0's lie, so
the expected result is exactly `[2000, 0, 0]`: 1000 for the truth plus 500 twice
over.

## Leaderboard

**Best Liar** — the top score at the table when the last round ends. A property
of the match, not of one person on this phone.

## Settings

Three to eight players, three / five / eight rounds, mute. Persisted with
`ctx.storage`. Sixty built-in prompts, shuffled per game.
