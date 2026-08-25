# bombsquad — design brief

*Compiled from reference images the researcher downloaded and viewed.*

## Art direction

A stop-motion diorama photographed on a tabletop: every surface is either hand-squeezed modelling clay or real pine offcuts. I saw floating arenas built from chunky raw-wood blocks and planks (visible grain, knots, bright end-grain cut faces, lit warm from above at ~#C8913C with #8A5C26 shadowed sides and near-black #2B1D12 crevices) suspended over a pitch-dark void, backed by clumps of grey-olive plasticine "rocks" (#504934 lit down to #1F190E) with thumbprint dents, heavily vignetted so the arena pops. Characters are ~34px-tall clay figurines: one huge sphere head, a tiny squashed body, no neck, no fingers, a coloured helmet cap with a crest, two black goggle-dots and stubby dark boots — team colour on the body, a second "highlight" colour on the helmet. Everything is bathed in a warm key light from upper-left with a strong drop shadow directly under it, so objects read as physical props sitting on a surface. Explosions are enormous relative to the figures — a white-hot #FFF074 core blooming through #FEAD3D and #D46F24 into #852811 smoke, throwing sparks and leaving permanent charred scorch blots on the wood. Menus are the same material: a fat squashed purple clay tablet (#4E4758) with an irregular thumbprinted rim, a recessed darker well, mint-green value text and glossy green/brown clay pill buttons. In-game HUD score bars are literal clay pills — a light clay frame (#8EC58A green team / #D18F89 rose team) around a near-black inset well holding a saturated fill bar. Player colours come straight from the source PLAYER_COLORS list: #FF2626, #33FF33, #1A1AFF, #33FFFF, #8040FF, #FFFF00, #FF8000, #FF4D80 (first 8 are the bright ones), with darker highlight colours drawn from the same list. Nothing is crisp, nothing is symmetrical, nothing is CAD-drawn — the stated design intent is an "imperfect" look.

## Palette

- `#14100A` — deep backdrop void / vignette edge
- `#504934` — grey-olive clay rock clumps in background
- `#C8913C` — wood plank top face — the arena floor
- `#8A5C26` — wood plank extruded side / seam shadow
- `#E0B978` — bright wood end-grain and lit plank top edge
- `#4E4758` — UI clay tablet panel purple
- `#5C8F2E` — clay button green (Done/Save/+/-)
- `#8EC58A` — team-1 HUD pill light clay frame (green side)
- `#D18F89` — team-2 HUD pill light clay frame (rose side)
- `#FFF074` — explosion hot core, sparks, fuse tip
- `#FD8B1E` — explosion mid flame / fireball ring
- `#EAF3E6` — hand-lettered off-white HUD & label text

## Typography

Nunito Sans is the only correct pick. BombSquad's in-game face is a hand-drawn, rounded, humanist sans: soft blunt terminals, tall x-height, wide apertures, mixed case (not all-caps), generous tracking, and a slightly wobbly baseline, always painted off-white (#EAF3E6) with a heavy dark outline so it survives on top of busy wood. Nunito Sans ExtraBold 800 is the single font in the approved set with genuinely rounded terminals and a friendly chunky non-geometric skeleton — use it for the game title, HUD score numerals, buttons and menu labels at +0.02em tracking, always drawn as strokeText (3px rgba(0,0,0,0.6)) then fillText. Nunito Sans 600 for settings rows and body copy. The only exception: use Space Mono 700 for the fuse countdown, the per-turn shot clock and any live-ticking digit — tabular figures stop numbers from jittering, and it also echoes the typewriter captions on the official store art ("Blow up your friends."). Reject the others: Bebas Neue is condensed all-caps (BombSquad is mixed-case and wide), Space Grotesk / Press Start 2P read techy/pixel and kill the handmade-clay premise, and all three serifs are wrong for a slapstick party game.

## Shape language

Chunky, hand-squeezed, zero sharp corners. Every silhouette resolves to a sphere, a squashed ellipse, or a fat rounded rect — buttons r=14, panels r=22 with each corner jittered ±3px from a seed so nothing looks machine-drawn. Characters are roughly 1:1.1 head-to-body: an oversized sphere head, a tiny stubby torso, no neck, no hands, boots as two dark ellipses; identity comes from a helmet cap (top 55% of the head circle, in the highlight colour) plus a distinct crest silhouette. The arena is a fat octagon or disc assembled from thick blocky planks with visible seams and a real extruded side face — never a thin outline. Bombs are perfect dark spheres with one specular arc; the land mine is a squat disc, TNT is a rounded wooden crate. Nothing is drawn thinner than 2px except wood grain and catch-lights. Everything sits on its own drop shadow so it reads as a physical object on a table rather than a sprite on a background. Deliberate asymmetry everywhere: thumbprint dents, off-centre highlights, wobbly clay rims.

## UI chrome

Menus (seen directly in the settings screenshot): a large squashed purple clay tablet (#4E4758) filling most of the frame, with an irregular ~26px thumbprinted rim, a recessed inner well ~8% darker ringed by a soft inner shadow, and a lit top edge / shadowed bottom edge. Title centred at the top in off-white hand-lettering. Top-left: a brown clay "Cancel" pill (#5F4846) with a tiny icon dot. Top-right: a bright green clay "Done"/"Save" pill (#3FBF77 lit face) with a small ▶ glyph. Setting rows read label-left in off-white, value-right in mint green (#8EE08A), followed by a pair of small green clay square buttons (− / + or ‹ / ›) at the far right; a green clay scroll rail runs down the right edge. A "Map" row embeds a live thumbnail set into a torn-hole aperture in the clay with the map name overlaid in mint green. Buttons are drawn twice — a darker copy offset 4px down as the physical lip, then the lit face on top with a 2px rgba(255,255,255,0.25) inner top highlight; pressed = translate down 3px, drop the lip, darken 8%. In-game HUD (top-left, always): the mini-game name in small off-white hand-lettering, an optional grey subtitle line under it ("secure the flag for 30 seconds"), then stacked clay score pills — a light clay frame (#8EC58A / #D18F89) around a near-black inset well (#0B290A / #2C0D0B) holding a saturated fill bar (#1D7815 / #912519) with a 2px white top highlight, the value left-aligned inside in outlined off-white. Centre-top carries wave/objective text with a smaller yellow-green sub-line; top-right carries "Lives: 4". Floating world-space labels (player names) sit above heads in the player's own colour, small and outlined.

## Motion

Heavy, springy, overshooting, and hilariously over-reactive. Bodies are ragdolls first and characters second — a hit sends them tumbling limb-over-limb and they keep sliding and rolling long after the impact, face-planting into wood. Gravity ~2.3 arena-radii/s², restitution 0.35, ground friction 0.86/frame (0.985 on ice and for frozen bodies, which slide like pucks). Explosions are instantaneous and enormous relative to the figures: a 60ms white-hot flash, a 200ms lobed fireball expansion on easeOutCubic, then 700ms of gravity-driven sparks and 900ms of curling smoke, plus camera shake (decaying ±6px, ±18px for TNT — the source uses camerashake intensity 1.0 normal / 5.0 TNT). Everything in the UI overshoots: panels enter with back-out ease (c=1.7) over 320ms, buttons pulse 1.0→1.12→1.0 in 180ms, score "+1" pops scale 0.4→1.3→1.0 and drifts up 40px over 900ms. Fuses pulse the flame 0.85–1.15 at ~14Hz and flash the bomb red in the last 0.7s. The signature move is Epic/slow-motion mode: the whole sim drops to roughly a third speed for climactic moments with a pitch-down — use 0.28× timestep for 1.2s whenever a kill is about to decide the match, plus 70ms hitstop on any lethal blow.

## Mechanics

CORE (values taken verbatim from the game's own source, ballistica bascenev1lib/actor/spaz.py + bomb.py + powerupbox.py, and the wiki):

CHARACTER: hitpoints = 1000 (default_hitpoints), default_bomb_count = 1, blast_radius = 2.0 world units, jump cooldown 250ms, punch cooldown 400ms (BASE_PUNCH_COOLDOWN), base punch power scale 1.2 (BASE_PUNCH_POWER_SCALE). Actions are exactly four: MOVE (analog), JUMP, PUNCH, BOMB. Holding PUNCH while running is how you grab/pick up bodies, flags, bombs and crates; pressing BOMB while holding something THROWS it.

BOMB HOLD/COOK (the defining mechanic): drop_bomb() spawns the bomb AND immediately re-picks it up, so the 3.0s fuse starts burning the instant you press BOMB. Keep holding and you keep cooking; release (press BOMB again) to throw. Hold past 3.0s and it detonates in your hands. You may only have ONE bomb out at a time unless you hold Triple Bombs.

BOMB TYPES — fuse / blast-radius multiplier / damage at direct hit (100% = 1000hp = instant kill) / impulse magnitude:
- Normal: 3.0s fuse, ×1.0 radius, 100% damage, mag 2000.
- Sticky: 3.0s fuse, ×1.0, 100%, mag 2000. Sticks to anything it touches. Cannot stick to its thrower until 0.25s after release.
- Ice: 3.0s fuse, ×1.2 radius, 53% damage, mag ×0.5 (1000). Freezes every body in radius; frozen = immobilised 5s, brittle and slippery; a frozen body SHATTERS instantly if it takes >200 damage or hits 0hp.
- Trigger/Impact: explodes on first contact, arms 0.2s after leaving your hand, self-destructs at 20.0s with a warning beep at 18.3s. ×0.7 radius, 85% damage, mag 2000. Will NOT detonate on its own thrower or on another impact bomb from the same thrower.
- Land Mine: no fuse, never self-detonates. Arms 1.25s after it lands, then explodes on contact with anything except another land mine. ×0.7 radius, 263% damage, mag ×2.5 (5000). Given 3 at a time; the powerup does not expire, it ends when you've thrown all 3.
- TNT crate: no fuse, detonates only when damaged. ×1.45 radius, 220% damage, mag ×2.0 (4000), big explosion + heavy camera shake. Spawns on the map, not from a powerup.
Chain reaction: any bomb inside another blast detonates.

DAMAGE MODEL: use t = clamp(1 − dist/blastRadius, 0, 1); damage = BASE × t^1.6 where BASE = 1000/850/530/2630/2200 for normal-sticky/impact/ice/mine/tnt; knockback speed = KB × t outward plus a fixed upward pop, KB scaling with mag (normal 1.00, ice 0.50, mine 2.50, tnt 2.00). Hits landing within 1000ms of a previous hit count as the same hit for stats (so punch flurries and bomb pileups read as one).

PUNCH: damage scales with your movement momentum, not a flat number — magnitude = punch_power × punch_momentum_angular × 110, velocity_magnitude = punch_power × 40. A standing punch barely tickles; a full-speed running punch launches people. You also take −400 kickback on the first connect of each punch (halved on ice). One hit per target per punch. Boxing gloves set punch_power_scale to 1.7 and cooldown to 300ms.

POWERUP CRATES: 2–6 crates spawn at fixed map pads every 9s and vanish 8s later (DEFAULT_POWERUP_INTERVAL 8.0). Contents roll on exact weights out of 21: Boxing Gloves 3, Triple Bombs 3, Ice Bombs 3, Trigger Bombs 3, Sticky Bombs 3, Energy Shield 2, Land Mines 2, Med Pack 1, Curse 1. All powerups expire after exactly 20.0s (POWERUP_WEAR_OFF_TIME 20000ms) with a warning flash starting at 18.0s — except Land Mines (3 charges, no expiry).
- Energy Shield: 650hp bubble (65% of full health), absorbs damage first; it only spills through to the player past a spillover threshold, so a single big hit usually just pops the shield. Optionally decays every 0.5s.
- Curse: you explode 5.0s after pickup (curse_time = 5.0), or immediately if you take any damage. A Med Pack heals to full AND cures the curse.
- Triple Bombs: bomb_count 3.

DEATH: 0hp, shattered while frozen, or knocked off the map (out-of-bounds is the funniest and most common kill). RESPAWN delay is derived from team size: 3.0s solo, 5.0s for 2, 6.0s for 3, 7.0s for 4+, multiplied by the Respawn Times setting, floored at 1.0s.

WIN CONDITIONS (default settings, exact):
- Death Match — first to "Kills to Win Per Player" (default 5). FFA: +1 for a kill, −1 for dying to non-player causes (clamped at 0 unless Allow Negative Scores). Teams: your team +1 on a kill, enemy team +1 when you die at all.
- Elimination — Lives Per Player default 1; last player/team with lives wins. Solo Elimination: only one member of each team is alive at a time, a queue; respawn ≤1s.
- Capture the Flag — Score to Win default 3. Carry the ENEMY flag to YOUR flag to score; you cannot score if your own flag is missing from its base. Your flag returns if a teammate touches it for Flag Touch Return Time (default 0, i.e. instantly) or automatically after Flag Idle Return Time (default 30s) undisturbed.
- Keep Away — hold the central flag for a cumulative Hold Time (default 30s). Flag tints to the holder's colour, yellow when contested; returns to centre when it dies or after 30s dropped.
- King of the Hill — stand NEAR the flag for Score to Win (default 30) seconds; contested = yellow, nobody scores.
- Chosen One — touch the central flag to become the Chosen One and receive boxing gloves and/or a shield; hold the title for the set time to win. You only lose it by dying; whoever killed you becomes the Chosen One, and if the killer is already dead the flag respawns at centre.
- Assault — touch the enemy flag to score; your whole team teleports back to spawn.
- Conquest — claim every flag on the map; you respawn at your team's last held flag and cannot respawn at all if you hold none.
- Hockey — puck can be pushed but never picked up; blasts shove it. Score to Win default 1. Ground friction is near-zero for everyone.
- Football — flag spawns centre, reaching the enemy end zone scores 7; Score to Win default 21.
- Meteor Shower — punching/grabbing/holding bombs is disabled; bombs rain from above at an accelerating rate; last alive wins.
Time Limit options everywhere: None (default) / 1 / 2 / 5 / 10 / 20 minutes. Epic Mode runs the whole match at roughly one-third speed.

## One-phone adaptation

The honest constraint: BombSquad is an 8-player real-time twin-stick brawler and you cannot give 8 people simultaneous sticks on one portrait phone. So convert it to a HOT-SEAT TURN-BASED ARENA that keeps every BombSquad signature (cooked fuses, arc-thrown bombs, blast knockback, ragdoll face-plants, knock-them-off-the-edge kills, powerup crates, slow-mo climax) and gains the thing one-phone needs most: only one person touches the screen at a time, so input zones can never overlap, and there is ZERO hidden information in the base game.

SETUP / SEATING. Phone flat on the table, portrait. Pick 2–8 players. Eight clay "seat markers" are drawn around the screen perimeter at 0°/45°/…/315°, mapped onto the portrait rectangle's edges (the four diagonal seats land on the rounded corners, which are the roomiest). Each player taps an empty marker to claim their physical seat — this records seatAngle — then picks a colour from the 16-swatch wheel (use the source PLAYER_COLORS; first 8 are the bright ones) and one of 8 helmet crests (mohawk, horns, cap, bandana, crown, antenna, tuft, dome) so identity never rests on colour alone. On-screen guidance: 2 players → sit at the two short edges; 3–4 → one per edge; 5–8 → spread evenly and take the corner seats first.

ORIENTATION / ROTATION. The arena is a floating octagonal wooden platform INSCRIBED IN A CIRCLE of radius min(w,h)×0.42 centred on the screen, specifically so it never clips at any rotation. On each turn start the whole world plus HUD is drawn under ctx.translate(cx,cy); ctx.rotate(−seatAngle); ctx.translate(−cx,−cy), animated over 420ms with ease-in-out so the board visibly swings around to face whoever's turn it is — a genuinely great table moment and free, because everything is procedural. Critically, all touch coordinates must be run through the inverse transform before hit-testing.

TURN STRUCTURE (20s shot clock shown as an eroding clay bar):
1. MOVE — drag from your character; a dashed reachable ring (0.18 arena radii) shows the budget; release to walk there with a clay-bounce.
2. ACT — press and HOLD the big BOMB thumb-pad, positioned bottom-right of your rotated frame. Holding cooks the fuse (3.0s meter draining, exactly as in the real game); while holding, drag to aim — a 22-dot parabolic preview with the landing X. Release to throw; drag length sets range, clamped 0.10–0.75 arena radii. Let the cook meter hit zero and you detonate in your own hands. Swipe UP on an adjacent body = grab & throw them (same slingshot). Double-tap an adjacent enemy = punch, drag length sets power.
3. RESOLVE — 2.5–4s of live physics with every body simulated at once and everyone watching.

THE SHARED DODGE WINDOW (so nobody is ever idle). When any fuse crosses 1.0s remaining, time drops to 0.35× for 1.2 real seconds and EVERY character inside 1.5× the blast radius gets a 92px clay tap-disc drawn centred on their own figure and rotated to THAT player's seat. First tap dives that character 0.14 radii directly away from the bomb. Discs are anchored to widely separated characters so they physically cannot overlap; if two are closer than 110px, push the discs apart along the connecting line and draw a thin leader to each owner. Cap concurrent touches at 3 and ignore extras — typically only 1–3 people are in danger at once.

PASSING. Between turns a full-screen clay "PASS →" card appears, tinted the next player's colour, with a big arrow pointing toward their physical seat and the card already rotated to their orientation, so it reads correctly the instant they reach for it. Tap to begin.

HIDDEN INFORMATION. The base modes have none — deliberately, and that is the whole reason this works on one shared phone. Only the optional SABOTEUR variant needs it (one player is secretly Cursed and must detonate beside someone within 2 turns). Handle it with an explicit privacy pass: "Phone face-down. Pass to <name>. Press and HOLD the seal." The role renders ONLY inside a 130px circular aperture placed under the held thumb at the screen edge nearest that player's seat, rotated to them, and disappears the instant the finger lifts — so the reveal is physically shielded by their own hand rather than broadcast to the table.

MODES TO SHIP: Last Clay Standing (elimination, 1 life at 5–8 players, 2 lives at 2–4), Blast Points (first to 3 kills, −1 for self-destructs), and one team mode — King of the Pad (a glowing hill zone relocates each round; +1 per round for each of your figures standing in it, first to 5).

## Drawing it with no assets

Everything is Canvas 2D primitives. No images, no emoji, and because ctx.filter/blur is banned, ALL softness comes from radial gradients and multi-pass strokes with decreasing alpha.

CLAY TEXTURE (the single most important routine). At boot, build one 128×128 tileable noise tile in an OffscreenCanvas (allowed; document.createElement is not) by writing an ImageData filled with 2-octave hash value-noise into the alpha channel (0–40), then ctx.createPattern(tile,'repeat'). To render any clay surface: (1) fill the path with a createRadialGradient whose inner stop sits at 32%/28% of the bbox and is the base colour lightened 18%, outer stop darkened 22%; (2) ctx.save, clip to the path, set globalCompositeOperation='overlay' and globalAlpha 0.22, fill with the noise pattern, restore; (3) stamp 8–14 seeded thumbprint dents, each two arcs — one offset up-left in +8% lightness, one down-right in −10%. Fallback if OffscreenCanvas is missing: draw the same noise once into an ImageData on the main canvas, createImageBitmap it, and cache.

WOOD PLANKS (arena floor). Base fill #C8913C; 6–10 grain lines per plank as bezierCurveTo strokes of rgba(90,58,26,0.18) at lineWidth 1–3, each a long low-amplitude sine displaced by a seeded random; 2–4 knots as concentric squashed ellipses in rgba(74,46,20,0.35); plank seams as a 3px #8A5C26 stroke with a 1px rgba(255,225,180,0.5) highlight on the up-light edge; exposed end-grain faces in #E0B978 with concentric arc grain.

FAKE DEPTH. Draw the platform path three times: (a) offset +34px, filled rgba(0,0,0,0.45) as the cast shadow, softened by stroking the same path 6× with lineWidth 4→24 and alpha 0.10→0.02; (b) offset +18px filled with a vertical gradient #8A5C26→#3A2410 as the extruded side; (c) the top face last. Same three-pass trick for every object's shadow.

CHARACTERS (~34px, ~12 primitive calls). Squashed ellipse torso in the player colour with a vertical gradient (+25% L top, −20% L bottom); sphere head at 0.62× torso width with a radial hotspot at 35%/28%; helmet = head circle clipped to its top 55%, filled in the highlight colour, plus a rim ellipse; the 8 crests are short inline SVG-style Path2D strings scaled to the helmet; two black goggle dots each with a 1px white catch-light; two dark boot ellipses; two stubby arm capsules. RAGDOLL = a 6-point verlet chain (head, 2 shoulders, hip, 2 feet) with 5 distance constraints and 3 solver iterations per frame, seeded by the blast impulse; render the same primitives at the solved point positions. That is the "advanced ragdoll face-plant physics" identity in ~40 lines.

BOMBS. Sphere #1A1A22 with a radial gradient from #4A4A58 at 30/30 to #0A0A10; a specular arc of rgba(255,255,255,0.55) at 32°; fuse as a 3px #6B6B76 quadraticCurveTo stub whose length shrinks linearly with remaining time; burning tip = a 3-stop radial gradient #FFFBD0 → #FFB020 → rgba(255,80,0,0) at r=7px pulsing 0.85–1.15 at 14Hz; 4–8 spark particles per frame with gravity, 0.35s life, drawn as 1.5px tapered lines along velocity. Sticky = same plus 5 drooping #7AB648 goo blobs (circle + tangent triangle). Ice = #8FD8FF sphere with 6 white facet chords. Impact = 3 orbiting #FF3B30 LED dots blinking faster near timeout. Land mine = a squat #C0392B/#2C3E50 disc with a blinking centre LED. TNT = rounded-rect crate, 4 plank lines, cream label rect, "TNT" in Nunito Sans 800 rotated 6°.

EXPLOSION (must sell it without blur). 0–60ms: white-hot core, radial gradient #FFFFFF → #FFF074 → rgba(255,160,40,0), scaling 0.15→1.0 of blast radius on easeOutCubic. 60–260ms: a lobed fireball built as ONE path where r(θ) = R × (1 + 0.22·sin(5θ+s1) + 0.12·sin(9θ+s2)), filled rgba(255,240,150,0.95) → rgba(253,169,48,0.8) → rgba(133,40,17,0), lobe amplitude growing as it expands. 0–700ms: 22 spark particles ramping #FFF074 → #FEAD3D → #D46F24, 2px tapered lines, gravity 2.2, drag 0.92. 0–900ms: 6 smoke tendrils as quadratic curves stroked lineWidth 10→2, alpha 0.28→0, colour #6B5C4A, curling on a slow sine. PERMANENT scorch: a radial-gradient blot rgba(20,12,8,0.55)→transparent at 1.15×R plus 5 seeded ragged arcs, painted into a persistent scorch layer so the arena visibly chars over the match — a real BombSquad detail.

ENERGY SHIELD. Inner fill rgba(150,120,255,0.16) plus a rim built from 3 concentric strokes (lineWidth 6/3/1.5 at alpha 0.10/0.22/0.50, colour ramping #B39CFF→#E6DCFF) and 14 shimmering dots orbiting at 0.98R with per-dot phase. Rim alpha tracks shield HP; flash white on hit.

HUD CLAY PILLS. Rounded-rect r=14 filled with the light clay colour and clay-textured; an inset rounded-rect 7px in filled #0B290A / #2C0D0B; the fill bar inside that as a horizontal gradient #1D7815→#35A82A (or #912519→#C4372A) with a 2px rgba(255,255,255,0.18) top highlight; value left-aligned in Nunito Sans 800 #EAF3E6, strokeText 3px rgba(0,0,0,0.55) then fillText.

BUTTONS. Draw the rounded-rect twice — a darker copy offset 4px down as the physical lip, then the lit face with a top-lit gradient (#7FBB45→#4C7A24) and a 2px rgba(255,255,255,0.25) inner top-edge arc; label outlined off-white. Pressed = translate +3px, no lip, darken 8%.

BACKGROUND. 40 seeded overlapping circles clustered at the frame edges, each a radial gradient #6A6250 (up-left lit) → #2B2820 with 3 thumbprint dents, forming the clay rock rubble; then a final radial vignette from transparent at centre to rgba(0,0,0,0.72) at the corners.

PARABOLA PREVIEW. 22 dots sampled along the throw arc, radius 4→2 and alpha 1.0→0.15 down the arc, with a travelling brightness wave at 1.4Hz; landing marker is a two-stroke X plus a dashed circle at the blast radius.

## Player counts

[2, 3, 4, 5, 6, 7, 8]

## Risks

- Rotating the whole canvas per seat silently breaks touch input unless every pointer coordinate is run back through the inverse transform; and since getBoundingClientRect is banned, the CSS-to-canvas scale must be derived from window.innerWidth/innerHeight with a guaranteed full-bleed layout.
- An 8-player turn rotation drags and kills party energy — the 20s shot clock and the shared slow-mo dodge window are load-bearing mechanics, not polish, and must ship in v1.
- No ctx.filter means every glow, soft shadow and fireball has to be multi-pass gradients; falling back to shadowBlur is very slow on mobile, so cap shadowed draws at ~12 per frame and build softness from stacked strokes instead.
- The clay grain depends on createPattern from an OffscreenCanvas since document.createElement is banned — if OffscreenCanvas is unavailable there is no second canvas, so a cached ImageData/createImageBitmap fallback must exist or every surface renders flat and the whole art direction collapses.
- Eight ragdolls plus bombs plus particles can miss 60fps on low-end phones — cap at 8 characters, 12 props and 60 particles, and degrade the explosion to core-plus-ring only when frame time exceeds ~22ms.
- Red/green team pills plus up to 8 player colours is a colour-blindness trap: the 8 helmet-crest silhouettes and fixed HUD pill positions must carry player identity independently of hue.
