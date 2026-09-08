# Pen Fight

The Indian school-bench game, rebuilt in 3D. Two pens on a scratched wooden
desk: flick yours to shove your rival's over the edge before they do it to you.
Best of five rounds, scored in chalk on the blackboard. Winner keeps the pen.

## Files

| File            | What it is                                                                 |
| --------------- | -------------------------------------------------------------------------- |
| `plethora.json` | Manifest — `plethora-bit@2`, `three@0.164.1`, three leaderboards.           |
| `main.js`       | Entry source defining `window.plethoraBit`. Everything is generated in-file. |

## How it plays

Touch your pen, drag the way you want it to go, let go. Direction and length of
the drag set the power; **where on the pen you touched it** sets the spin. Catch
it at the tip and it spins; catch it at the balance point and it drives straight.
A pen is out when its centre of mass crosses the desk edge. First to three
rounds takes the match.

**The bench.** Eleven rivals sit between you and the title, from Bunty on the
back bench of 9B up to Vikram in twelfth standard. Each rival plays with their
own pen, aims a little better than the last, and reads the desk edge more
carefully. Beat one to unlock the next.

**Winner keeps the pen.** Before a bench match you stake one pen from your tin.
Win and the rival's pen goes in your tin. Lose and your staked pen is gone. If
the tin ever empties, a Pinpoint turns up in lost-and-found so you can keep
playing.

**Pass and play.** Two players on one phone, each picking a pen from the full
roster. Nothing is staked.

## The pens

Twelve pens you would know from a pencil box, each with its own radius, length,
density, friction and bounce, so they behave differently on the desk:

| Pen                  | Character                                            |
| -------------------- | ---------------------------------------------------- |
| Cello Pinpoint       | the starter; average in every way                    |
| Classmate Octane     | light and quick, will not sit still                  |
| Flair Writometer     | long and low-friction, slides further than you meant |
| Cello Gripper        | rubber grip; parks where you put it                  |
| Linc Ocean           | bouncy; hits ricochet sideways                       |
| Add Gel              | planted, hits solid                                  |
| Cello Butterflow     | dead restitution; hits sink into it                  |
| Reynolds Racer Gel   | fat and grippy, moves what it meets                  |
| Montex Megatop       | top-heavy cap, wobbles instead of sliding straight   |
| Apsara Platinum      | a hex pencil; light, low bounce                      |
| Parker Vector        | steel; dead weight, clean executions                 |
| Reynolds Trimax      | triangular, so it does not roll                      |

Bodies, caps, grips, bands and side text are baked into a livery texture per pen
at runtime; no image assets are shipped.

## The physics

A pen is a capsule (segment plus radius) sliding on a plane with position,
heading and their velocities. A flick is an impulse applied at the touch point,
so tip-versus-centre behaviour falls out of the off-centre torque rather than a
special case. Friction is integrated along the pen so a pen that slides and
spins loses both together. Round pens roll (lower friction perpendicular to
their axis); hex and triangular pens do not. Collisions use segment-segment
closest points with per-pen restitution. A pen hangs flat over the lip until
its centre of mass crosses the edge, then tips and falls.

## The rivals

The CPU rehearses candidate flicks in a copy of the simulation and scores each
by whether it knocks you off, keeps itself on, and how much desk-edge distance
it gains. Higher rivals rehearse more candidates and add less execution noise.

## Leaderboards

- **Pens In The Tin** — most pens held at once.
- **Rivals Beaten** — how far along the bench you have got.
- **Round Streak** — longest run of rounds won without dropping one.

## Harness hooks

`__pfInfo()`, `__pfGo(page, arg, arg2)`, `__pfFlick(dx, dy, power, s)`,
`__pfKnock(side)`, `__pfSkipIntro()`, `__pfReset()` are exposed on `window` for
the local harness only.
