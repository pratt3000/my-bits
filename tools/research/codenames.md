# codenames — design brief

*Compiled from reference images the researcher downloaded and viewed.*

## Art direction

Two visual layers that must both be present. The CHROME layer (from the box and press art I viewed) is Saul-Bass/Bond-titles spy-thriller: a full-bleed concentric radial sunburst blazing from a hot yellow core (#FFC21C) out through orange (#F4882A) and red-orange (#D9482E) to a mulberry-purple rim (#7C1A55), overlaid with faint onion-ring banding and thin radial rays, with flat black silhouettes (a woman in a skirt suit, a man in a suit, a faceless man in a fedora and trench coat) and white speech balloons carrying red uppercase text. The BOARD layer (from four real play photos) is a mid-century intelligence dossier: 25 cream card-stock tiles (#F3EBD8) each carrying a slightly whiter inset plaque (#FBF7EC) hairlined in near-black, with the codeword printed TWICE inside the plaque — once upright, once rotated 180 degrees — split by a hairline rule with a small circular rivet at its centre and tiny chevron notches either side. Revealed tiles become full-bleed painted agent art: RED is a hooded woman backlit in hot orange over maroon shadow; BLUE is a pale hooded figure in round blue-tinted spectacles against navy architectural columns; BYSTANDER is a deliberately dull smiling civilian in olive-grey on flat khaki; ASSASSIN is a pure-black card with a fedora-and-trenchcoat silhouette rimmed in cold grey-green (#B9BBA8) and a void where the face should be. The spymaster key I saw in the plastic stand is the third motif to steal: a taupe holder framing a black bezel holding a 5x5 grid of rounded colour squares — red squares carry an embossed rounded-diamond glyph, blue squares an embossed ring glyph, tan squares nothing at all — with four glowing lozenge "edge lights" at the midpoints of the bezel's sides whose colour states which team goes first.

## Palette

- `#FFC21C` — sunburst core / highlight yellow, active-state glow
- `#F4882A` — sunburst mid orange
- `#D9482E` — sunburst outer hot red-orange
- `#7C1A55` — sunburst rim mulberry, screen edge + vignette
- `#CE3B31` — RED team agent: key square, HUD band, revealed tile base
- `#2A6AB4` — BLUE team agent: key square, HUD band, revealed tile base
- `#E3D3A4` — innocent bystander parchment
- `#0B0B0D` — assassin black / key-card bezel / keyboard keys
- `#B9BBA8` — assassin rim light, cold grey-green edge
- `#F3EBD8` — codename card stock cream
- `#FBF7EC` — inner plaque white
- `#2A2622` — card ink / hairlines / plaque stroke

## Typography

BEBAS NEUE is the primary and does most of the work: it is the only approved face that matches both the wide heavy uppercase display type on the box logo AND the tight condensed uppercase printed on the codename cards, and critically its extreme condensation is what makes a 10-character word like ANTARCTICA legible inside a ~70px-wide tile in portrait. Use it for all 25 codewords, team names, big numerals, the title, and the clue banner. SPACE MONO is the secondary "dossier/telex" voice — clue number readout, guess-remaining counter, TOP SECRET / CLASSIFIED / KEY EXPOSED stamps, turn timer digits, the CIVILIAN micro-label on bystander tiles, and the on-canvas keyboard keycaps; its typewriter character sells the intelligence-file idea without a single image. INTER only for small multi-line body copy on the setup and rules screens, where plain legibility beats character. Explicitly avoid Press Start 2P (wrong era entirely), and avoid Cormorant Garamond / DM Serif Display — those read Victorian or editorial, not 1960s intelligence.

## Shape language

Rounded rectangles everywhere, at two distinct radii: card-scale r≈8px for tiles and plaques, chip-scale r≈4px for key swatches and HUD pips. Deco geometry appears as chamfered/notched corners on the key-card frame (straight 45-degree cuts rather than curves) and as concentric circles: the sunburst rings, the plaque rivet dot, the blue agent's round spectacles, the ring glyph on blue key squares. The only non-round primitives are the rounded-diamond (squircle-diamond) glyph on red key squares, thin chevron notches flanking the plaque hairline, and the hard triangular lapels/brim of the assassin silhouette. Figures are flat high-contrast silhouettes with a single rim light — never modelled, never outlined in a cartoon stroke. Strict 5x5 orthogonal grid with even gutters; nothing tilts, nothing is skewed. Vertical bars on the blue tiles (architectural columns) and radial rays on the red tiles are the only directional texture.

## UI chrome

The physical game has almost no chrome — cards sit bare on a table — so the chrome is invented from the box and the key-card holder. Panels: dark lacquer slabs (#141210 at 92% over the sunburst) with a 1px inner highlight at rgba(255,255,255,0.10) top edge and a chamfered top-left/bottom-right corner. Buttons: pill or rounded-rect with a 2px outer stroke in the owning team's colour and a flat interior; primary actions (TRANSMIT, CONFIRM CONTACT) fill in #FFC21C with #0B0B0D Bebas Neue caps; secondary (PASS, HIDE KEY) are hollow with a coloured stroke. The clue banner is a white speech-balloon shape lifted straight from the box — rounded rect plus a small tail triangle — filled #FBF7EC with the clue word in Bebas Neue #CE3B31 or #2A6AB4 and the number in a filled circle at its right end. Guess allowance renders as a row of small pip lozenges that snap off one per guess, with the bonus guess pip drawn as a hollow outline instead of a fill. Score is shown as two stacks of agent-card mini-swatches (9 and 8 slots) that fill in as agents are contacted — no numeric scoreboard. The spymaster key view is framed exactly like the real holder: taupe (#8C6E5E) chamfered frame, black bezel, four glowing edge lozenges in the starting team's colour. A persistent pulsing red hairline border plus a Space Mono "KEY EXPOSED" stamp runs whenever the key is on screen.

## Motion

Deliberate, weighty, cinematic — this is a talking game, so motion punctuates rather than fills. Default easing easeOutCubic; easeOutBack(1.7) only for tile lift. Tile reveal: fake the card flip with scaleX 1→0 over 130ms ease-in, swap the face, 0→1 over 130ms ease-out, with the drop shadow shortening and re-lengthening in sync and a 1px specular sweep at the midpoint. Arming a guess: the tile lifts to scale 1.04 with shadow offset +4y over 160ms and gains a slowly rotating dashed reticle ring (setLineDash([6,10]), lineDashOffset decrementing 0.6/frame). Correct contact: 12 short radial sparks in the team colour over 320ms plus a guess-pip snapping off with a small recoil. Turn change: the two HUD bands cross-fade over 260ms as the idle band drops to 35% alpha, and the sunburst's colour centre lerps about 8% toward the active team's hue so the whole screen changes allegiance. Handoff: the screen shutters closed — two solid panels slide from top and bottom to meet at centre with a 40ms overshoot — then the PASS instruction types in at ~22 chars/s in Space Mono. Hold-to-reveal: a progress arc sweeps 0→2π around a procedurally drawn fingerprint pad over 700ms and springs back on early release. Assassin: 90ms white flash, then a rgba(10,10,12,0.75) wash desaturating the board, the assassin tile scaling to 1.8x at screen centre, a red iris-wipe drawn as an expanding circle with an enormous lineWidth, and the background sunburst rings freezing dead. Background sunburst rotates continuously at ~0.004 rad/s — barely perceptible, but it keeps the screen alive between turns.

## Mechanics

COMPONENTS/SETUP: Deal 25 codewords into a 5x5 grid. Generate a hidden key assigning: 9 to the STARTING team, 8 to the other team, 7 innocent bystanders, 1 assassin (9+8+7+1=25). The starting team is chosen at random and is the one with 9 — in the physical game this is signalled by the colour of the four edge lights on the key card, and by flipping the neutral "double agent" card to the starting team's colour so that team has 9 agent markers. Only the two spymasters ever see the key; it stays available to them all game.

TURN STRUCTURE: Teams alternate, starting team first. A turn is: (1) the active spymaster gives exactly ONE WORD plus ONE NUMBER; (2) their operatives make guesses; (3) turn ends.

CLUE LEGALITY (enforce or at least surface these):
- Exactly one word. Made-up compound words are never legal ("lunar squid" for MOON + OCTOPUS is illegal). Genuinely single-word compounds (greenhouse) are legal. Hyphenated words and multi-word proper names (New York, mother-in-law) are a house-rule the group agrees before starting.
- The clue must be about MEANING. It may not refer to letters, spelling position, or a word's location on the table ("third row", "starts with B" are illegal).
- Proper names are legal if they are one word.
- Letters and numbers are legal clues when they carry meaning: "X: 1" for RAY, "eight: 3" for BALL/FIGURE/OCTOPUS.
- The number after the clue is NEVER itself part of the clue: "citrus: 8" as a pointer to LEMON and OCTOPUS is illegal.
- A spymaster may SPELL a clue out loud to disambiguate homophones — "k-n-i-g-h-t" is legal even while NIGHT is on the board.
- Homophones with different spellings are different words (knight ≠ night). One spelling with several pronunciations counts as one word (bow covers the theatre bow, the ship's bow and the archery bow).
- Rhyme-based clues are legal only if they route through meaning: "snail" for MAIL (snail mail) or WHALE (both animals) is fine; "snail" for SCALE purely because it rhymes is not.
- Foreign words are legal only if the group would use them in an English sentence (strudel yes, Apfel no).
- ILLEGAL: any form of a codeword still visible/unrevealed on the table, including plurals, other inflections, and it appearing as part of a compound — with HORSESHOE on the board you may not say HORSE, HORSES, or SNOWSHOE. Once a word is covered, it is free to use.
- PENALTY for an invalid clue: the team's turn ends immediately AND the opposing spymaster may cover one of their own team's words with an agent card before giving the next clue.

NUMBER AND GUESS LIMIT: The number states how many board words relate to the clue. Operatives get up to NUMBER + 1 guesses (the bonus guess exists so a team can pick up a word missed on an earlier clue). They MUST make at least one guess. They may stop (pass) at any time after that first guess. Special numbers: "0" means none of our words relate to this clue (a pure negative steer) and "unlimited"/infinity means guess as many as you like — in BOTH cases the number+1 cap is removed and guesses are unlimited, but at least one guess is still mandatory.

RESOLUTION PER GUESS (a touch is final — model it as arm-then-confirm on a phone):
- Own team's colour: cover with your agent card, guess counter decrements, team may continue.
- Innocent bystander: cover with the bystander card, TURN ENDS immediately.
- Opposing team's colour: cover with the OPPOSING team's agent card (it counts toward their win), TURN ENDS immediately.
- Assassin: game ends instantly and the team that touched it LOSES.

WINNING: First team to have all of their agents covered wins. Crucially this can happen on the OPPONENT'S turn — if red guesses a blue word that was blue's last remaining agent, blue wins immediately. The only other ending is the assassin.

TIMER: Optional. The retail box includes a sand timer that any player may flip if someone is stalling; there is no mandatory clock.

SMALL-COUNT OFFICIAL VARIANTS: With TWO players, play cooperatively — one spymaster, one operative, on the same team, racing a simulated opponent: each time the opponent would take a turn, cover one of the opponent's words with their agent card; you must contact all your agents before the opponent's run out (and without hitting the assassin). With THREE players you can either run that co-op with two operatives, or play competitively with two spymasters and a single operative who guesses for both teams in turn.

## One-phone adaptation

SEATING: phone flat on the table between the teams, RED on one long edge and BLUE on the other. Setup asks "RED sits at the BOTTOM / TOP" and everything team-specific honours that. The board itself is orientation-neutral by copying the real card: EVERY codeword tile prints its word twice, once upright and once rotated 180 degrees, exactly as the physical cards do — so both sides read the grid without anyone rotating anything. Only the HUD rotates: BLUE's clue banner, guess pips and PASS button live in the top ~230px band drawn at 180 degrees; RED's live in the bottom ~230px band upright. The idle team's band sits at 35% alpha. Offer a "ROTATE BOARD 90°" toggle for groups seated along the other axis.

LAYOUT (design at 390x844, scale to fit): the 5x5 grid is a 366x366 square dead-centre (cells ~70x70, 4px gutters), leaving two 239px HUD bands that never overlap the grid or each other. Codewords auto-fit: binary-search the Bebas Neue size so measureText fits tileWidth-12, floor 9px, then wrap to two lines. Cap generated words at 10 characters.

HIDDEN INFORMATION — the key, and only the key. Pass-the-phone with a hard privacy gate every single turn:
1. HANDOFF SCREEN (safe for anyone to see): shutters slam closed, "PASS THE PHONE TO THE RED SPYMASTER" typed out, rotated to face the receiving side.
2. HOLD-TO-UNLOCK: the spymaster picks the phone up, angles it away, and holds a procedurally drawn fingerprint pad for 700ms while an arc fills. Early release resets. This makes an accidental reveal essentially impossible and is unskippable — the key is NEVER reachable from board mode.
3. KEY VIEW: the grid gains the key overlay (red squares with diamond glyph, blue with ring glyph, tan blank, black outlined red) inside the black bezel with the four starting-team edge lights. A pulsing red border and a "KEY EXPOSED" stamp run the whole time so nobody puts it down face-up.
4. CLUE ENTRY while shielded: an on-canvas QWERTY (no DOM inputs — 3 rows, 34x44 keys, plus backspace and DONE) for the clue word, and a pill strip 0-9 plus ∞ for the number. A "SPEAK IT INSTEAD" option skips typing and records only the number, for groups that want the classic spoken feel. TRANSMIT hides the key and shutters back to a handoff screen.
5. BOARD MODE: phone goes back flat. Clue balloon and pips visible to all; operatives debate out loud.
6. GUESSING: tap a tile to ARM it (it lifts, reticle spins), then hit the separate CONFIRM CONTACT button in the active team's band — never a second tap on the tile — so the assassin can't be hit by a fat finger. Reveal, resolve, decrement, repeat. PASS is enabled only after the mandatory first guess.

PLAYER COUNTS: 2 = co-op vs the simulated opponent, still with the full handoff since the operative must not see the key. 3 = either co-op with two operatives, or two spymasters and one shared operative (in the two-spymaster case the two of them view the reveal together, so the handoff shortens to a single "SPYMASTERS ONLY" gate). 4-8 = standard two teams, one spymaster each, handoff to the ACTIVE spymaster only — matching the physical game where each spymaster keeps the key in view during their own turn. At 7-8 players the extra operatives just crowd the same table edge; nothing in the UI changes.

## Player counts

[2, 3, 4, 5, 6, 7, 8]

## Drawing it with no assets

Everything is canvas 2D primitives, gradients, Path2D strings and generated noise. Zero images, zero remote URLs, no emoji.

SUNBURST BACKGROUND: createRadialGradient(cx,cy,0,cx,cy,R) with stops 0:#FFE24E, 0.10:#FFC21C, 0.28:#F4882A, 0.50:#D9482E, 0.72:#A62B57, 1:#5E1246. Over it draw 14 concentric stroked circles of width R/26 alternating rgba(255,255,255,0.045) and rgba(0,0,0,0.05) for the onion-ring halo. Over that, 36 wedges from centre (moveTo(cx,cy) + arc + closePath), alternating wedges filled rgba(255,255,255,0.03), rotating at 0.004 rad/s. Finish with a corner vignette: radial gradient transparent → rgba(20,4,26,0.55).

PAPER GRAIN: at boot, build one 64x64 noise tile via ctx.createImageData(64,64), random alpha 0-14 over #8B7A55, putImageData into an OffscreenCanvas (new OffscreenCanvas — not createElement), then createPattern('repeat') and fill card faces at globalAlpha 0.5. Guard with a feature check and skip the grain if OffscreenCanvas is unavailable.

UNREVEALED TILE: drop shadow first (rounded rect offset +2y, rgba(60,40,20,0.28)); body rounded rect r8 with vertical gradient #F3EBD8→#E4D9BE, inner stroke #C9BB99; grain pattern; inset plaque rounded rect (inset 5px) filled #FBF7EC, stroked #2A2622 1px with a 0.5px rgba(255,255,255,0.9) inner highlight; a hairline rgba(40,36,32,0.35) across the plaque middle with a filled rivet circle r3 (#D8CDB2 fill, #9C8F6E ring) at centre and two chevron paths "M-12 0 L-6 -4 L-6 4 Z" flanking it at rgba(40,36,32,0.22); the word drawn upright in the lower 42% and then again after save(); translate(cx,cy); rotate(PI); translate(-cx,-cy) in the (now) upper 42%.

RED AGENT: radial gradient centred 45%/38% — 0:#FF9A2E, 0.35:#E8511F, 0.75:#B3241A, 1:#5E0F0F; 24 thin rays behind the head at rgba(255,200,120,0.10); hooded-woman Path2D (head circle + hood arc + shoulder bezier) filled #2A0709 at 0.9; left-side-only rim stroke #FFB86B 1.5px using clip() to a half-rect. Below ~60px tile size, drop the figure and draw the red rounded-diamond emblem instead.

BLUE AGENT: radial gradient 0:#7FB7E8, 0.4:#2E6BB4, 0.8:#123C6E, 1:#0A2244; four vertical column bars rgba(255,255,255,0.06) with 1px rgba(255,255,255,0.12) edges; pale head+hood path #CBDEEA; two filled circles #1B3E6B for the round spectacles with a #87B6DC highlight arc — the spectacles are the identity, keep them at every size. Small-tile fallback: the blue ring emblem.

BYSTANDER: flat vertical gradient #DCD2AE→#C6BA92; generic head-and-shoulders silhouette #9AA083 at 0.55 with a #6E7358 outline; "CIVILIAN" in Space Mono 7px letter-spaced rgba(70,66,50,0.7).

ASSASSIN: fill #0A0A0C; a top-down light cone as a linear gradient rgba(190,196,176,0.16)→transparent clipped to a trapezoid; fedora-and-coat Path2D built from a flattened ellipse brim, a rounded-trapezoid crown, a wide bell-curve shoulder and two triangular lapels, filled #000 with an upper-left-only rim stroke #B9BBA8 1.2px. The face stays an untouched void — that is what makes it read.

KEY OVERLAY: per cell an inset rounded square at 78% alpha — red #CE3B31 with a #8F1B10 squircle-diamond glyph, blue #2A6AB4 with a #1B3C6B filled circle plus #4E8CC4 arc ring, bystander #E3D3A4 with no glyph, assassin #111114 with a thin #D6342A outline. The glyph-per-colour pairing is a real colour-blind affordance from the product — keep it. Frame in a #141210 bezel with a #8C6E5E chamfered taupe holder (lineTo chamfers, no curves) and four edge-light lozenges at the side midpoints.

GLOWS WITHOUT ctx.filter: stack 3 rounded rects / arcs of increasing size at alpha 0.5 / 0.25 / 0.12 in the glow colour. Used for edge lights, the armed reticle, and the hold-to-unlock arc. FINGERPRINT PAD: ~9 nested arc() strokes at varying radii and sweep angles with small random phase — pure arcs, no asset. KEYBOARD KEYS: rounded rects #1B1A20 with a #3A3742 top bevel and Space Mono 15px #E7E0D0 caps, active key flashing #FFC21C.

PERF: cache each of the 25 tile faces (unrevealed and its revealed variant) into OffscreenCanvases once and blit; only re-render a tile when its state changes, so the 50 text draws per frame from the dual-rotation printing never happen in the animation loop. Since getBoundingClientRect is banned, size the canvas from window.innerWidth/innerHeight * devicePixelRatio, position it at 0,0 full-bleed, and hit-test touches directly from touch.clientX/clientY.

WORD DECK: ship ~400 concrete common single nouns, uppercase, max 10 characters, hard-coded as one comma-joined string and split at boot (a few kilobytes). Real examples I read off the cards in the photos, to set the tone: TOKYO, INDIA, COVER, HOOD, BOOM, NET, SHARK, KING, ANGEL, POOL, GOLD, EMBASSY, CIRCLE, SPOT, AGENT, MAT, BOSS, WEB, SCRIPT, DIESEL.

## Risks

- Five columns of words in portrait width is the make-or-break: at ~70px cells a 10-char word needs Bebas Neue plus binary-search auto-fit plus a two-line wrap fallback. Cap deck words at 10 characters and test against the longest one before shipping.
- Accidental assassin taps end the game instantly. Arm-then-confirm is mandatory, and the confirm must be a SEPARATE button in the active team's HUD band, never a second tap on the tile.
- Key leakage kills the game. The reveal must be unreachable from board mode, require the 700ms hold every single turn, and never be baked into any cached tile layer that could survive a state change.
- Pass-the-phone adds roughly 5 seconds per turn to a fast party game. Keep the handoff to ONE screen and ONE gesture, and skip it entirely in the 3-player two-spymaster variant where the phone never changes hands.
- The dual-rotation word printing doubles text draws across 25 tiles. Without per-tile OffscreenCanvas caching this will drop frames on older phones; also provide a direct-draw fallback if OffscreenCanvas is missing.
- Google Fonts may not have loaded on the first frame, which silently breaks all the measureText-based auto-fit. Re-run layout on document.fonts.ready and specify real fallback stacks ('Bebas Neue','Arial Narrow',sans-serif).
