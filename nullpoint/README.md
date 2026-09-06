# Nullpoint ◎

A one-thumb arcade shooter with a single rule: **every shot goes through the
dead centre**. You can drift anywhere inside the arena, but the ship always
points at the middle and the bullet always flies that way. Bullets bounce off
the arena wall and come back, and your own bullet kills you.

Inspired by the constraint at the heart of Mors' *dead_center*. The code,
name, art, sounds and scoring here are original and generated in `main.js`;
nothing is packaged.

## How it plays

- **Drag** anywhere to move. The ship follows the finger relatively, with a
  little gain, so a small thumb sweep covers the arena.
- **Tap** to fire. The shot leaves the ship aimed at the crosshair in the
  centre, passes through it, and keeps going.
- **Bounce.** The bullet reflects off the wobbling wall up to three times,
  then fizzles. Every bounce doubles what the next kill pays.
- **Rings** drift in from the wall toward the centre. Touch one and the run
  ends.
- **Your own bullet kills you** once it is a beat old. Move after you shoot.
- **Combos.** Kills within 2.4 s of each other chain, up to ×8.

Score per ring = ring value × (1 + bounces) × combo.

### Rings

| Ring | Colour | Behaviour | Value |
|---|---|---|---|
| Drifter | red | slow slide toward the centre | 100 |
| Seeker | orange | homes on the ship (from 18 s) | 150 |
| Big | crimson | large, slow, hard to dodge (from 40 s) | 250 |
| Orbiter | pink | circles the centre fast (from 65 s) | 200 |

## Difficulty

Everything ramps on run time: spawn interval falls from 2.3 s to 0.55 s, the
ring cap rises one every 12 s to 14, ring speed grows up to 2.1×, and the
nastier ring types are mixed in as the run goes on. A new wave is announced
every 20 s, with a wall pulse and a music step.

## Records

- `score` — High Score
- `kills` — Rings Popped

## Platform

`ready` on load, `start` on the first tap, `setScore` on every kill,
`milestone("wave")` each wave, `fail` on death, `complete` with the final
stats. Haptics on fire, bounce and death. Procedural chip-tune bed via
`ctx.music` with intensity stepping up by wave, and Web Audio sting sounds.
Bottom of the screen carries only the mute button.
