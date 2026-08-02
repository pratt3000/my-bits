# Spot Pip

A hidden-object search [Plethora Bit](https://create.plethora.studio) — a
"find the character in the crowd" game. Pinch / drag / use the **+ −** buttons
to explore a busy, procedurally-generated crowd and tap **Pip**: the one in the
red-and-white striped hat with round glasses (shown in the card, top-left).

Three levels ramp from easy to hard. The faster you spot him, the more stars
you earn, and your total clear time goes on a **Fastest Clear** leaderboard.

## Files

| File            | Purpose                                              |
| --------------- | ---------------------------------------------------- |
| `plethora.json` | Manifest (`plethora-bit@2`) + the leaderboard channel. |
| `main.js`       | The entry source (`entry: "main.js"`).               |

## How it plays

- **Find Pip** — every level hides one Pip in a jittered grid of decoys.
- **Move & zoom** — one-finger drag to pan, two-finger pinch or the on-screen
  **+ / −** buttons to zoom (kept off the bottom safe area).
- **Tap** a character to guess; tapping Pip wins the level, the camera zooms in
  to reveal him with a gold ring, and a card shows your stars and points.
- **Difficulty** — later levels add more people and more Pip-lookalikes
  (striped shirts, red hats, glasses), so decoys get genuinely confusing.
- **Reward for speed** — 3 / 2 / 1 stars per level by time, a points bonus that
  shrinks with time and wrong taps, and a total-time leaderboard.
- **Multiplayer leaderboard** — the total clear time feeds a global (cross-player)
  `best_time` record. You can view the rankings in-bit any time via the 🏆
  button, or from the finish screen, with your own row highlighted. Player names
  are HTML-escaped before rendering, and the panel degrades gracefully when the
  board is empty or briefly unavailable.

## Contract notes

Built against agent context **`plethora-agent-context-2026-07-10.2`** using only
the documented `ctx` SDK surface:

- **No packaged assets** (`maxAssets: 0`) — the entire crowd, characters, and
  the "Find" icon are drawn procedurally on canvas.
- **No dependencies / no network egress.**
- Rendering stays under the runtime's DPR-scaled base transform (never resets to
  identity), so it's crisp on Retina/high-DPR phones.
- Permissions declared for every gated API used: `haptics`, `backgroundMusic`.
- A `duration_ms` memory **record** (`best_time`, ascending, `timer` format)
  powers the Fastest Clear leaderboard; submissions are guarded so gameplay
  never blocks on the network.

## Uploading a draft

Publishing is manual. An agent pairs with the creator at
<https://create.plethora.studio/agent-pair>, then `POST`s `{ source, manifest }`
to `/v1/agent/bits/drafts` (API origin `https://api.plethora.studio`) with an
`Authorization: Plethora-Agent <token>` header.
