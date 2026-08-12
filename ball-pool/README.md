# Ball Pool

A mobile-first [Plethora Bit](https://create.plethora.studio): a full rack of
eight-ball played with one thumb.

Drag anywhere on the felt to aim — the line runs from the cue ball out through
your finger, so holding further away buys you finer control. Put english on the
cue ball with the little white ball in the corner. Then pull the power bar and
let go. Clear your group, pot the 8, take the board.

Three bot difficulties, pass-and-play for two, and five global leaderboards.

## Files

| File            | Purpose                                                           |
| --------------- | ----------------------------------------------------------------- |
| `plethora.json` | Manifest (`plethora-bit@2`, runtime global `window.plethoraBit`).  |
| `main.js`       | The entry source (`entry: "main.js"`).                             |

## The table is measured in inches

World space is the playing surface of an eight-foot table: 44″ × 88″, with 2¼″
balls, 5″ corner mouths and a foot spot a quarter of the way up. Every physics
constant is therefore a real quantity in real units — rolling drag in in/s²,
restitution as a ratio — which is what makes them tunable instead of magic.

Rolling deceleration sits at 44 in/s² plus a small term proportional to speed.
That is the number that decides whether the game feels like pool: a firm 100 in/s
shot runs about a table length and dies in two seconds, which is what a real ball
does on clean cloth.

## The simulation

No 2D rigid-body library in the registry helps here — ammo.js and oimo are 3D,
and Phaser's Arcade physics is AABB-only. Billiards is equal-mass
circle-on-circle with rolling friction and segmented cushions, so the solver is
written in-file. Three details do the heavy lifting:

**Adaptive substepping.** Each frame picks a step count so the fastest ball moves
under a third of its radius per step, capped at 48. Below that, a 430 in/s break
ball walks straight through the rack. This is the single thing that makes a
full-power break behave.

**Cushions that stop at the pockets.** The rails are six separate runs with a gap
at every mouth, and each run end carries a small round jaw bumper. A ball
travelling tight along the rail near a pocket clips the jaw and rattles, exactly
as it does on a real table, instead of being silently swallowed or bouncing off
an imaginary wall stretched across the mouth. A failsafe catches anything that
somehow gets past a rail line and drops it in the nearest pocket, so no ball can
ever escape the table.

**Spin that only acts after contact.** The cue ball carries a scalar top/back
component and a scalar side component. The top/back one is armed only once the
cue ball has actually touched an object ball — otherwise a follow shot would
accelerate on its way down the table, which is not a thing that happens. Side
spin kicks the tangent on cushion contact and decays across bounces. That
reproduces draw, follow, stun and a widened cushion angle, which is everything a
player actually reads off the ball.

## The rules

Standard eight-ball, judged on the pre-shot table:

- The table stays **open** through the break. The first ball legally potted on
  any later shot assigns the groups.
- **Fouls** are scratching, missing every ball, striking the wrong group first,
  and no cushion after contact with nothing potted. A foul hands the opponent
  ball in hand anywhere on the table.
- The **break** is judged gently — only a scratch or a total miss counts against
  you. Potting the 8 on the break re-racks rather than ending anything.
- **The 8** must come last. Potting it while you still have a group ball up, or
  scratching on it, loses the rack.
- Potting a ball of your group keeps you at the table.

## The bot

For each legal ball and each of the six pockets, the bot builds the ghost-ball
position, throws out anything past a 77° cut or with a blocked cue path or
object path, and scores what survives on cut angle and the two distances. Then
the difficulty decides how well it executes what it found:

| Level  | Aim error | Shot choice        | When nothing is on   |
| ------ | --------- | ------------------ | -------------------- |
| Easy   | ±3.3°     | any of its top 6   | fires and hopes      |
| Medium | ±1.3°     | any of its top 3   | rolls up safe        |
| Hard   | ±0.4°     | always the best    | rolls up safe        |

Aim error is gaussian, not uniform, so an Easy bot mostly misses by a little and
occasionally misses by a lot — which is how a weak player actually misses. With
ball in hand it searches candidate cue positions for the best resulting shot;
Easy searches far fewer of them and then jitters the answer.

Playing against a deliberately terrible opponent, Hard closes a rack out in
15–18 shots where Medium needs about 32.

## Sound

Packaged assets are disabled, so every impact is synthesised from the collision
that caused it, on a single `AudioContext` behind a compressor:

- **Ball on ball** — three triangle partials around 2, 3.3 and 5.1 kHz with a
  sub-50 ms decay and a band-passed contact transient. Loudness, brightness and
  decay all ride the closing speed, and each hit gets a little pitch scatter, so
  a fifteen-ball break does not sound like one sample fired fifteen times.
- **Cushion** — low, damped, no ring: a noise burst swept from 1.1 kHz down to
  280 Hz over 90 ms, plus a short sine thump.
- **Pocket** — the lip, a fall sweeping 260 → 72 Hz, then two knocks as the ball
  settles against the others in the trough.
- **Cue** — a leather-tip tick whose band-pass centre opens up with power.
- **Rolling bed** — a permanent filtered noise loop whose gain and cutoff track
  the total kinetic energy on the table.

Everything is stereo-panned by its position across the table, so a rail shot on
the far side sounds like it happened over there. A `lofi` bed sits underneath and
ducks on the break. Nothing is created until the first tap, so there is no
autoplay.

## Leaderboards

Five record channels, all global and all-time:

| Channel                                        | Measures                        |
| ---------------------------------------------- | ------------------------------- |
| `easy_shots` / `medium_shots` / `hard_shots`   | fewest shots to win a rack      |
| `best_run`                                     | most balls potted in one visit  |
| `win_streak`                                   | longest run of wins             |

The shots boards are ascending — fewer is better. Only games against the bot
submit; pass-and-play does not.

## Contract notes

- `plethora-bit@2`, manifest `schemaVersion: 1`, entry `main.js`.
- Permissions: `audio` (impact synthesis), `backgroundMusic` (bed and stings),
  `haptics`, `storage` (streak and preferences).
- No dependencies. All visuals and audio are procedural — the balls, the cloth
  nap, the wood, the sights and every sound are drawn or synthesised at runtime.
- Portrait and landscape both work: past a 1.05 width/height ratio the whole
  table rotates 90°, with the numbers on the balls counter-rotated so they stay
  upright.
- Controls sit above `ctx.safeArea.bottom`; the cue stick is a realistic 52″ and
  is clipped to the table outline so it slides under the rail rather than
  painting across the controls.
