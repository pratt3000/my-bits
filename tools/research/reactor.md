# reactor — design brief

*Compiled from reference images the researcher downloaded and viewed.*

## Art direction

What I actually saw in the screenshots is a "puffy sticker on parchment" look, not neon arcade. The whole field is a warm cream/oatmeal #FAEDCD, and the central puzzle board is a muted sage-olive #CCD5AE carrying a faint 45-degree argyle/diamond lattice a few shades darker — it reads like a felt game mat. Every player's tap slab is a flat earth-tone rectangle (tan #D4A373 or sage #BAC39E) that occupies a full screen edge, and the ONLY saturated colour in the layout arrives as a state flash: the whole slab snaps to electric green #05EE5C on a correct hit, hot pink-red #FF4A6F on a wrong hit, and pure white #FFFFFF on a missed/too-late one. Stimulus objects (dice, flags, shapes, smileys, a maze) are drawn as fat rounded cartoon solids with a heavy near-black 3–4px outline, a soft top-left radial highlight and a slightly darker bottom lip, so they look like moulded plastic tokens sitting on the mat. Feedback is delivered by comic-book starburst stickers — jagged 14–16 point polygons in yellow #FFDB35 ("BEST!"), cyan #72CBFF ("NICE!"), orange ("TOO SLOW!", "DONT WORRY!") — with a hard black offset shadow and a few radiating tick marks, tilted about 8 degrees. Critically, the 2-player screenshots show the entire prompt line, stimulus and score chip rendered TWICE — once upright in the lower half, once rotated 180 degrees in the upper half — so a player sitting opposite never reads inverted content; that duplication is the signature of the whole layout.

## Palette

- `#FAEDCD` — Field / table background (parchment cream, ~50-60% of every screen)
- `#CCD5AE` — Central stimulus board (sage felt mat) fill
- `#E9EDC9` — Board lattice highlight + pale sage accents
- `#D4A373` — Idle player slab A + timer-bar outline + round-counter text
- `#BAC39E` — Idle player slab B (alternating seats)
- `#05EE5C` — CORRECT flash — slab floods this instantly
- `#FF4A6F` — WRONG flash — slab floods this + 4px screen shake
- `#FFFFFF` — TOO SLOW / missed flash — slab floods white
- `#72CBFF` — Score chip fill, zone divider hairlines, 'NICE!' sticker
- `#FFDB35` — 'BEST!' sticker fill, alternate score chip, banner accents
- `#2B2B26` — Universal cartoon outline on EVERY object (3-4px), all body text
- `#DA0037` — Stimulus red — dice, triangles, flag stripes, danger tokens

## Typography

Three of the eight, used strictly by role. **Bebas Neue** for all headline chrome — the round counter ("7 / 14"), the big centred verdict words, the starburst sticker text, and the pre-round countdown numerals; the reference banners are condensed heavy all-caps with a white outline and hard offset shadow, which Bebas reproduces almost exactly at 1.5px letter-spacing. **Nunito Sans (700/800)** for the prompt line ("Same number on both colors?", "Is the capital city correct?") and the score chips; the reference prompt/answer type has visibly rounded terminals and a friendly humanist width — Nunito Sans ExtraBold is the closest approved match, and it stays legible at the ~13px size a rotated edge slab forces. **Space Mono** only for the optional reaction-time readout ("0.284s") and the tick counter, because tabular monospace stops the number jittering as digits change. Do NOT use Press Start 2P — the reference is comic/sticker, not pixel-art, and it would break the whole read.

## Shape language

Superellipse-flavoured rounded rectangles everywhere: corner radius 14-22px on slabs and cards, 18px on dice, 6-8px on flags, 999px capsules on the timer bar and score chips. Every filled object carries the same three-part treatment: (1) a 3.5px near-black #2B2B26 stroke, (2) an inner top highlight — a 6-8px band of rgba(255,255,255,0.28) hugging the top edge inside the stroke, and (3) a bottom lip of rgba(0,0,0,0.14) about 5px tall, which is what makes everything look injection-moulded rather than flat. Nothing is a plain sharp rectangle except the divider hairlines (2px #72CBFF) separating adjacent player zones. Stimulus glyphs are built from the simplest possible primitives — dice are roundRect + 7 pip circles, shapes are circle/diamond/equilateral-triangle paths, the smiley is circle + 2 eye circles + a stroked arc with round caps, the maze is fat 16px round-cap polylines. Starbursts are the only jagged form in the language, and they exist purely to punctuate a result. Player identity is a rounded-shoulder human silhouette (a circle head over a stadium-shaped torso) with a big numeral punched through it, drawn as a 4px coloured outline only — never filled.

## UI chrome

Minimal and diegetic. (a) Score chip: a ~74x26 capsule, fill #72CBFF (or #FFDB35), 2.5px black stroke, black Nunito Sans 800 text "Score: 4" — one per player, pinned in that player's slab, rotated with the slab so it faces its owner. (b) Timer bar: a vertical capsule ~14px wide running down the LEFT inner edge of the centre board, track cream #FAEDCD, fill a muted #D3C8AC, 2.5px #D4A373 outline, draining top-to-bottom, perfectly linear. (c) Round counter: "7 / 14" in Bebas Neue ~22px, colour #D4A373, no box, rendered twice — bottom-left upright and top-right rotated 180 — exactly as the screenshots show. (d) Prompt line: black Nunito Sans 800 ~15px on the bare cream field just inside each board edge, one rotated copy per occupied edge. (e) Verdict stickers: comic starburst or a rounded speech bubble with a tail and 5-6 radiating black tick marks, spawned at the centre of the slab that earned it. (f) No HUD bar, no pause button during a round, no settings gear on the play screen — the only persistent chrome is the four score chips and the timer bar. Pre-game setup is a single screen: a big Bebas "PLAYERS" heading and a row of tappable numeral tiles 2-8, then a "TAP ALL SLABS TO ARM" check where every seat must touch once before the match starts.

## Motion

Snappy, un-cushioned, arcade-honest — the reference has almost no easing sophistication and that is correct for a fairness game. Stimulus entry: 140ms scale 0.86 to 1.00 with a back-out overshoot (c=1.9) plus 6px upward drift. Slab state flash: fill jumps to the state colour on the SAME frame as the touch (zero latency, this is non-negotiable — any tween here feels like input lag), holds 420ms, then eases back to the idle tone over 260ms. Sticker: 180ms punch 0 to 1.18 to 1.00, with +/-8 degrees rotation jitter on the first 3 frames only, hold 700ms, then 160ms fade to alpha 0 while scaling to 0.90. Timer bar: strictly linear, never eased. Wrong tap: 4px horizontal screen shake decaying over 90ms, plus a 60Hz-ish descending two-tone buzz via WebAudio. Correct tap: three 120ms expanding ring pulses (6px stroke, alpha 0.5 to 0) from the winning slab's centre, plus a rising blip. Between rounds: a 220ms wipe where the old stimulus scales to 0.9 and fades while the new board lattice slides 12px. Countdown into the arm phase: three Bebas numerals each punching 1.4 to 1.0 over 200ms. Total dead time between rounds must stay under 1.4s or the party energy dies.

## Mechanics

EXACT RULES (confirmed from the 4 Reaction / 4 Player Reactor listings and the on-screen state I observed).

MATCH: 14 rounds (Quick) or 31 rounds (Long) — both counters appear in the screenshots as "7 / 14" and "10 / 31". Highest score after the last round wins; no sudden death, ties are ties (report both).

ROUND STRUCTURE — four phases:
1. ARM (random 0.8-2.2s, uniform). Board shows the sage mat, no stimulus. ANY tap during ARM is a FALSE START: that player takes -1, their slab flashes #FF4A6F, and they are LOCKED for the remainder of the round. This is what stops mashing.
2. SHOW. The stimulus appears and the timer bar begins draining. Window length ramps with round index: window_ms = 2600 - 85 * (round - 1), clamped to a floor of 1300ms.
3. RESOLVE (900ms). Flashes and stickers.
4. Advance.

THE QUESTION IS ALWAYS A YES/NO ASSERTION about the stimulus, printed as the prompt ("Same number on both colors?", "Does the mouse find the cheese?", "Is the flag correct?", "Is the capital city correct?"). The generator flips a coin per round for whether the assertion is TRUE or FALSE, then builds the stimulus to match. Target 50/50; never allow more than 3 consecutive rounds of the same truth value.

SCORING:
- Assertion TRUE: the FIRST player to tap scores +1 ("BEST!" yellow starburst, green slab flash). The round ends immediately for scoring purposes. Any player whose tap lands after the winner gets 0 and a white slab flash + "TOO SLOW!" — no penalty for being second, only for being wrong.
- Assertion TRUE but nobody taps before the timer expires: EVERY player takes -1, all slabs flash white, "TOO SLOW!" centre-screen. This is the collective-miss rule and it is what forces people to commit.
- Assertion FALSE and a player taps: that player takes -1 ("DONT WORRY!" orange starburst, #FF4A6F slab flash) and is LOCKED for the rest of the round. The round does NOT end — remaining players must still hold their nerve until the timer expires.
- Assertion FALSE and every player correctly holds to expiry: everyone +0, cyan "NICE!" sticker. Restraint is never rewarded with points, only with the absence of loss.
- Scores may go negative; the reference clearly shows "Score: -1".

TIE / SIMULTANEITY RULES (the load-bearing edge cases):
- Winner is decided by the raw PointerEvent.timeStamp of the first qualifying pointerdown, NOT by JS handler order. Capture on the window in the capture phase.
- If two timestamps are exactly equal (happens with coalesced multi-touch), BOTH players score +1. Never silently drop one.
- Only the FIRST pointerdown inside a given zone in a given round counts. Every subsequent touch in that zone is discarded until the next ARM — this defeats palm-mashing and finger-drumming.
- A pointerdown whose coordinates fall in the neutral centre board (not in any slab) is ignored entirely, no penalty.
- A single physical touch is attributed to exactly one zone (point-in-rect, zones are disjoint by construction). A palm spanning two zones fires two separate pointer events and legitimately penalises both — call that out in the how-to-play as "keep one finger on your slab".
- A player already LOCKED (false start or wrong tap) cannot win the round even with a later correct tap.

STIMULUS POOL (each is a generator + a truth-evaluator; ship 8-10, all buildable from primitives):
1. DICE MATCH — 6 dice, some red #DA0037 some blue #00A3DA. Assertion: "Same number on both colors?" TRUE iff at least one pip value appears on both a red and a blue die.
2. THREE IDENTICAL — a scattered field of circles/diamonds/triangles. Assertion: "Three identical shapes?" TRUE iff any shape+colour combo appears exactly/at-least 3 times.
3. COUNT COMPARE — orange circles vs blue diamonds. Assertion: "More circles than diamonds?"
4. COLOR WORD (Stroop) — the word "Red" drawn in some ink colour. Assertion: "Word matches its color?"
5. FLAG CHECK — a procedurally drawn flag plus a country name. Assertion: "Is the flag correct?"
6. CAPITAL CHECK — "France / London". Assertion: "Is the capital city correct?"
7. MAZE — a recursive-backtracker maze with a mouse and a cheese. Assertion: "Does the mouse find the cheese?" TRUE iff the two cells are connected (make FALSE cases by walling off a small pocket). This one needs a longer window: multiply window_ms by 1.9.
8. SMILEY SCAN — a grid of faces, one may be frowning. Assertion: "All faces smiling?"
9. FORMULA — "4 + 3 = 7". Assertion: "Is the formula correct?"
10. TRAFFIC LIGHT — Assertion: "Is the green light on?"

DIFFICULTY: Easy = window floor 1800ms and only pools 1,2,3,8,10. Normal = all pools, floor 1300ms. Hard = floor 1000ms, plus a 15% chance of a DOUBLE round where the assertion is worth +2 / -2 and the slab border pulses gold before SHOW.

## One-phone adaptation

Phone lies FLAT on the table, portrait, players seated around it. Nothing is passed. There is ZERO hidden information in this game — every stimulus is public and simultaneous — so no privacy screen and no pass-the-phone step is needed anywhere, and you should not build one. The whole adaptation problem is orientation and non-overlapping input zones.

PERIMETER RING MODEL: inset the screen by 8px, then carve the outer band into N contiguous slabs walking the rectangle border. Top/bottom bands are 108px tall; left/right bands are 96px wide. Everything inside the ring is the shared centre board. Each slab's contents (score chip, player badge, verdict sticker) are drawn inside a ctx.translate to the slab centre + ctx.rotate of the OUTWARD normal of its edge — 0 for bottom, PI for top, +PI/2 for left, -PI/2 for right — so text always faces the person sitting there.

SEAT ALLOCATION BY N (portrait, so top/bottom are the short edges and left/right the long ones):
- 2 → top(1 full) + bottom(1 full). Classic mirror duel, exactly as the App Store screenshot shows.
- 3 → bottom(1 full) + top(1 full) + left(1 full).
- 4 → top split in 2 + bottom split in 2. This is the reference four-corner layout: two slabs across the top separated by a #72CBFF hairline, two across the bottom.
- 5 → top(2) + bottom(2) + left(1).
- 6 → top(2) + bottom(2) + left(1) + right(1).
- 7 → top(2) + bottom(2) + left(2) + right(1).
- 8 → top(2) + bottom(2) + left(2) + right(2).
Corner overlap is resolved by giving the top/bottom bands full width and letting the side bands start below/above them, so every zone is a disjoint rectangle. Smallest resulting zone on a 390x844 viewport is a side slab at 96 x ~314 — comfortably above the 88px minimum touch target in both axes.

THE ROTATION FIX (most important decision): the centre stimulus GRAPHIC must be orientation-free — dice pips, shape counts, colour matches, smileys, traffic lights and mazes all read identically from any seat, which is exactly why the reference chose them. The PROMPT TEXT is the part that cannot be rotation-free, so render it up to four times, once just inside each occupied inner edge of the board, each rotated to face that edge. The reference already does this for 2 players (prompt printed upright at the bottom and 180-rotated at the top) — I am simply extending it to 4 edges. The round counter gets the same treatment. Text-bearing stimuli (FLAG CHECK, CAPITAL CHECK, COLOR WORD, FORMULA) are only offered when seats are confined to the top and bottom edges (N is 2 or 4); as soon as a side seat exists, the pool drops to the six orientation-free generators. State this rule in the code as a hard filter, not a guideline — a 90-degree seat reading "London" sideways is an unfair round.

SETUP FLOW: pick N on a single screen, then an ARM CHECK — every slab shows a pulsing outline and each player must touch their own slab once; the match starts 1.2s after the last one lands. This both assigns seats physically and proves no zone is under a table edge or a thumb.

ACCESSIBILITY / FAIRNESS: on a phone flat on a table, players nearest a stimulus see it a few degrees off-axis, so always draw the stimulus centred in the true centre of the board, never biased toward an edge. Colour-only rounds get a redundant cue (pip count, shape silhouette) so colour-blind players are not disadvantaged. Give a "left-handed" toggle that mirrors the timer bar to the right edge.

## Drawing it with no assets

Everything is Canvas 2D primitives — zero assets, zero remote URLs, no emoji.

FOUNDATION: one full-viewport fixed canvas at 0,0 sized window.innerWidth/innerHeight * min(devicePixelRatio,2). Hit-test touches with clientX/clientY scaled by the same factor — never call getBoundingClientRect. No ctx.filter: fake every glow by stroking the same path 3 times at lineWidth 10/6/3 with alpha 0.10/0.18/1.0.

THE "PUFFY STICKER" HELPER — write this once and route every solid through it: path -> fill -> save/clip -> fill a 8px top band with rgba(255,255,255,0.28) -> fill a 5px bottom band with rgba(0,0,0,0.14) -> restore -> stroke 3.5px #2B2B26 with round joins. That single function is 80% of the art direction.

BACKGROUND: fillRect #FAEDCD. Argyle lattice on the centre board — save, clip to the board roundRect, ctx.rotate(PI/4), then draw 2px lines in #C0CBA2 every 34px on both axes, restore. Add a very sparse 1px hatch in rgba(0,0,0,0.03) at 11px pitch for felt tooth.

SUNBURST (win moments): 24 wedges from centre, alternating fill rgba(255,255,255,0.10) and transparent, each spanning PI/24, radius 1.4x board diagonal, clipped to the board.

HALFTONE: nested rings of arc() dots, radius 1.6px, 8px pitch, fill rgba(0,0,0,0.05), density falling off with distance — used only behind stickers.

DICE: roundRect(x,y,s,s,s*0.22) filled #DA0037 or #00A3DA, then a createRadialGradient from (x+0.3s, y+0.25s) r=0 to r=s*0.9, rgba(255,255,255,0.32) to transparent, then white pips as arc() r=s*0.10 at the canonical 3x3 lattice positions.

SHAPES: circle = arc; diamond = 4-point path rotated 45; triangle = 3-point equilateral path. Fills #F5A63C / #4EC4FC / #DA0037, all through the puffy helper.

SMILEY: arc r, fill radial #FFD44A centre to #F5A200 edge, 3.5px black stroke, two eye arcs r*0.12, mouth = arc(cx, cy+r*0.08, r*0.55, 0.18PI, 0.82PI) with lineWidth r*0.13 and round caps (negate the angles for a frown).

FLAGS: roundRect r=7 clipped, then fillRect stripes. Germany = #171717 / #DA0037 / #FFCE00 horizontal thirds. Singapore = #ED2939 top half, #F0F0F0 bottom, crescent as a filled arc minus an offset arc in destination-out, plus five 5-point star polygons. UK = #012169 field, white and #C8102E crosses and saltires from rotated fillRects clipped to the flag rect. Always 3px black outline.

MAZE: recursive-backtracker on a 13x13 grid seeded per round. Render corridors, not walls: stroke the spanning-tree edges with lineWidth 17, lineCap/lineJoin round, colour #0FA80F offset (0,3), then the same path in #3DFF06 at lineWidth 14. Cheese = a 3-point wedge polygon #FFD54A with three darker arc holes; mouse = two overlapping circles #B9BEC7 + a small ear arc + a quadraticCurveTo tail.

TRAFFIC LIGHT: roundRect #3A3A3A r=10, three arc() lamps, the lit one gets the 3-pass fake glow.

BOWLING BALL: radial gradient #FF8A78 to #D9422F, 3 small #2B2B26 finger arcs, a white arc highlight at lineWidth 4 alpha 0.5.

COMIC STARBURST: build a 16-vertex polygon where r alternates between R and R*0.66, with each vertex angle jittered by a seeded +/-0.06 rad so it never looks machine-made. Draw a black copy offset (4,5) at alpha 0.30 first, then the coloured fill, then a 3.5px black stroke, then the text in Bebas Neue with a white 5px stroke behind the black fill. Rotate the whole thing -8 degrees.

SPEECH BUBBLE variant: roundRect r=16 + a 3-point tail triangle merged into the same path, plus 6 short radiating black tick lines around it.

PLAYER BADGE: circle head r=9 above a stadium torso (roundRect with r=half-width), stroked 4px in the player's identity colour, never filled, with the seat numeral in Bebas Neue punched in the same colour beside it.

TIMER BAR: two capsules — track roundRect fill #FAEDCD stroke #D4A373 2.5px, and a clipped fill rect of height t*H in #D3C8AC.

TEXT: load the three Google Fonts via a single fonts.googleapis.com stylesheet link (the one permitted external host), and guard every family with a real fallback stack ("Bebas Neue", Impact, sans-serif / "Nunito Sans", system-ui, sans-serif / "Space Mono", ui-monospace, monospace). Draw outlined text as strokeText(white, lineWidth 5, lineJoin round) then fillText(#2B2B26).

Total code well under 2MB in a single JS file; the heaviest generator is the maze and it is about 40 lines.

## Player counts

[2, 3, 4, 5, 6, 7, 8]

## Risks

- Fairness of the shared centre stimulus: a player seated on a long edge views it at 90 degrees. Mitigate by hard-filtering text-bearing generators out of the pool whenever a side seat exists, and by drawing the prompt once per occupied edge, rotated. Do not treat this as optional polish — it decides whether the game is playable at 5-8.
- Touch timestamp fairness: browsers coalesce pointer events and some Androids quantise timeStamp to ~8ms, so two genuinely different taps can tie and one genuinely faster tap can lose. Read PointerEvent.timeStamp in a window-level capture listener, award ties to BOTH players, and never rank by handler invocation order.
- Palm and multi-finger abuse: a hand laid across two zones fires two pointerdowns and can false-start a neighbour. Enforce one-counted-touch-per-zone-per-round, ignore touches in the neutral centre entirely, and say 'one finger on your own slab' in the how-to.
- Zone size at N=7-8 on a small phone (360px wide): side slabs drop to ~92px wide. Below a 340px viewport, cap the player count at 6 and say so on the setup screen rather than shipping unhittable targets.
- The collective -1 on a timed-out TRUE round is harsh and can spiral scores negative early. Playtest it; the fallback is -1 only for players who never tapped at all in the last 3 rounds, or simply 0 for everyone.
- Colour-dependent rounds (Dice Match, Color Word, Traffic Light) disadvantage colour-blind players. Every colour-based assertion must have a redundant non-colour cue — pip counts, shape silhouette, lamp position — or be droppable via a setup toggle.
