# Snack Shot

A back-camera **AR shooting gallery**. Fruit targets pop into the room around
you — turn your body (or swipe) to find them, line one up in the crosshair, and
tap **SHOOT** to blast it. Chain hits for a combo multiplier, grab the golden
fruit for 3×, and race a global high-score leaderboard. 60 seconds a round.

## Files

```
snack-shot/
  plethora.json   # manifest — permissions, memory record (leaderboard)
  main.js         # entry — defines window.plethoraBit
```

## How it works

- **Background** — the rear camera feed is drawn to a 2D canvas, cover-fit, with
  a soft vignette so targets and HUD stay legible over any real-world scene.
- **Looking around** — device **motion** (`ctx.motion`) drives yaw/pitch, so you
  physically turn to scan the room. Orientation is re-anchored the moment play
  starts, so wherever you're pointing becomes "forward."
- **Targets** — fruit are placed at fixed world directions around you and
  projected onto the screen from your current view angle. Each has a lifespan
  ring and flees if you're too slow.
- **Shooting** — the **SHOOT** button fires at the centre crosshair (hold to
  rapid-fire). The nearest fruit within the crosshair's angular radius is hit,
  with a bit of aim-assist. A small edge arrow points you toward the nearest
  off-screen fruit so you always know which way to turn.

## Contract notes

- Runtime `plethora-bit@2`, entry `main.js`, no packaged assets — all visuals
  and audio are procedural (emoji fruit + `ctx.music` arcade bed and stings).
- Permissions: `camera`, `motion`, `haptics`, `backgroundMusic`, `storage`.
  Camera and motion are both **explicitly requested** by the creator; they are
  started from the START tap (a real user gesture) and every one degrades:
  - **Camera denied / unsupported** → an animated parallax backdrop replaces the
    feed; the game is fully playable.
  - **Motion denied / unsupported** → swipe-to-look works everywhere (also makes
    it playable in a desktop preview).
- Leaderboard uses a single `memory.records.score` channel
  (`order: desc`, `dedupe: best_per_user`), submitted on game over and viewable
  in-bit. Local best is cached in `ctx.storage`.

## Camera status

Camera and motion APIs are flagged as *in development* in the Plethora contract.
This bit was built at the creator's explicit request and follows the required
pattern: matching manifest permissions, user-gesture startup, denied-permission
handling, and a non-sensor fallback for every sensor it uses.
