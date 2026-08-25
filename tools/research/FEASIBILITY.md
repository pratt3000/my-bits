# Feasibility review — one phone, several people

An adversarial pass over every design in `tools/research/`, asked to find where
each one physically breaks down around a single portrait phone. Kept because
several of its objections are arithmetic rather than opinion, and because three
of them changed what got built.

## Verdicts

| Game | Verdict |
| --- | --- |
| pocket-tanks | **great-fit** |
| air-hockey | **compromised** |
| headsup | **great-fit** |
| chess | **great-fit** |
| kingdomino | **workable** |
| ludo-king | **workable** |
| othello | **workable** |
| maze-duel | **workable** |
| reactor | **workable** |
| codenames | **compromised** |
| badland | **does-not-work** |
| spaceteam | **does-not-work** |
| bombsquad | **does-not-work** |
| helmet-derby | **compromised** |

## Ranked by how well the one-phone form fits

1. pocket-tanks
2. air-hockey
3. headsup
4. chess
5. kingdomino
6. ludo-king
7. othello
8. maze-duel
9. reactor
10. codenames
11. badland
12. spaceteam
13. bombsquad
14. helmet-derby

## The objections

### air-hockey — compromised

The 2-player duel across the short edges is the single best one-phone form in this entire document — the hard y=H/2 split, first-touch-per-half wins, and the real centreline rule falling out of the mallet clamp for free. Ship that and it is a 10/10.

Everything above N=4 is fantasy, and the brief never does the arithmetic:
(1) TOUCH CAP, UNMENTIONED. iPhone Safari delivers a maximum of 5 simultaneous touch points; navigator.maxTouchPoints returns 5 and the 6th contact is simply never reported. DOME at 6/7/8 requires 6-8 CONTINUOUSLY HELD touches. Players 6, 7 and 8 do not get a laggy mallet, they get no mallet. Your risk list has a detailed paragraph on identifier churn and zero words on the cap. This alone makes 6-8 unshippable on the most common device on earth.
(2) REACTION MATH KILLS N=8 EVEN IF THE HARDWARE COOPERATED. Octagon with apothem 179 -> side = 2*179*tan(pi/8) ~ 148px; goalFrac 0.34+0.02*8 = 0.50 -> a 74px goal. The puck at your 2600px/s clamp crosses the 358px arena in 138ms. Human visual-motor reaction is 200-250ms. Nobody can defend anything. Goals are a coin flip, rounds last seconds. Your own DOME FAIRNESS risk gestures at this and then prescribes the formula that makes it worse.
(3) PHYSICAL. Eight forearms converging on a 7cm-wide object. The grip bars sit at the screen border, which at N=8 allots each player roughly 2cm of physical edge — narrower than an adult thumb, and the corner wedges cross the bezel where palm rejection eats touches.

Delete DOME above 4. FIT 5/10 blended (10/10 at 2P, 1/10 at 8P) · SPECTACLE 9/10.

### codenames — compromised

The dual-print (word upright and 180deg on every tile, copying the physical card) is right in principle and impossible at this size.

(1) THE TYPE MATH DOES NOT CLOSE. (366 - 16)/5 = 70px cells; minus 12px padding = 58px usable width, and you print the word TWICE stacked so each copy gets ~28px of height for up to 10 characters. Your own floor is 9px Bebas Neue. Nine-pixel condensed type, read upside down, from 50cm, by four people arguing — that is not reading, it is guessing, and a misread codeword in Codenames is a lost game. Fix by force: cap deck words at 6 characters, OR drop to a 4x4 grid (a real Codenames variant), OR print one orientation with a FLIP button. Binary-search auto-fit does not manufacture pixels.
(2) THE SEATING IS INVERTED. 'RED on one long edge' puts the RED spymaster shoulder-to-shoulder with the RED operatives — the people most motivated and best positioned to glance at the key are sitting beside the person holding it. The physical game hides the key from your own team by seating the two SPYMASTERS together, opposite the operatives. Put spymasters on one edge, operatives on the other.
(3) YOU HAVE COSTED THE HANDOFF WRONG BY 20x. The risk says pass-the-phone adds 'roughly 5 seconds per turn'. A spymaster studies the key for 60-90 seconds looking for a two-word link. That is 60-90 seconds of holding a phone angled away from teammates sitting beside them, ~18 times a game. The 700ms unlock is fine; the EXPOSURE WINDOW is the leak, and a pulsing 'KEY EXPOSED' stamp does not shorten it.
(4) On-canvas QWERTY at 34x44 keys, one-handed, while shielding the screen with the other hand, is miserable. SPEAK IT INSTEAD should be the default and typing the escape hatch.
(5) 2P 'co-op vs a simulated opponent' is solitaire and directly contradicts the no-AI stance you take in the chess brief.

FIT 6/10 · SPECTACLE 5/10.

### badland — does-not-work

The best-looking idea in the batch and the one whose arithmetic is most catastrophically absent. Radial gravity as an orientation fix is genuinely inventive. It is also a genre swap: BADLAND is a one-thumb side-scroller about a wall of death chasing you forward through a forest. This is a radial arena elimination brawler. Hold-to-flap, the clone swarm and propagating pods survive; the dread and the forward motion — the two things people remember — do not.

(1) THE ARENA COLLAPSES TO 174px AND YOU NEVER COMPUTE IT. At 8 players you specify 3 bottom pads + 3 top pads + left and right SIDE bars. Side bars are 96px each; the arena is inset by padDepth+12 on each side. 390 - 192 - 24 = 174px of arena diameter. Into that 174px circle you put up to 8 swarms, CLONE pods that grant +2 bodies each (so 24+ bodies), rim saw teeth, free blades and lasers. Each body renders at roughly 8px. Pure black on a dark rim gradient. Distinguished ONLY by eye colour — which at 8px is one pixel. The whole design's identity system evaporates exactly where it is needed most.
(2) TOUCH CAP IS A HARD STOP, NOT A TUNING PROBLEM. iPhone Safari delivers 5 concurrent touches. Your 6/7/8-player modes need 6-8 HELD contacts. Your mitigation — impulse-tap at 7-8 — does not help: the cap applies to concurrent contacts regardless of duration, so six people tapping in the same frame still loses one, and in an elimination game the dropped player just dies. Cap the seat list at 5 and say why, or three of eight players spend the round wondering why their Clony won't flap.
(3) 'Warn at seat-claim if fewer than N touches ever register together' is a warning that the product you sold does not run on this phone. That is a spec bug, not a mitigation.

SHIP 2-4 PLAYERS ONLY, and be honest in the copy that it is BADLAND-inspired, not BADLAND. FIT 3/10 · SPECTACLE 10/10 — genuinely the most beautiful thing you could build here.

### spaceteam — does-not-work

The boldest adaptation and the one that most clearly deletes its own subject.

(1) THE CORE MECHANIC REQUIRES INFORMATION ASYMMETRY AND A SHARED SCREEN CANNOT PROVIDE IT. Spaceteam works because you can SEE an order you cannot execute, and cannot see the control you must operate. Here both halves are visible to everyone. Your defence is 13cm of distance, 180deg of rotation, and ~30px type. Thirty-pixel type upside down at 13cm is roughly newspaper-headline size at arm's length — trivially readable. So the dominant strategy is for both crews to silently read the opposite panel and point. The shouting you set out to preserve is optimised away within two minutes of the first session. Confusable name pairs do NOT fix this: they slow reading equally for both crews, so they never change the RANKING of strategies, only the absolute pace.
(2) THE LAYOUT ARITHMETIC DOES NOT CLOSE. Each half is 390x422. Order band = 6%->15.5% of 422 = 40px tall, and you specify '~30px Space Grotesk 700 auto-fit to two lines' — two 30px lines need 70px+. Control grid = 17.5%->50% of 422 = 137px tall x 390px wide for 4-6 widgets. That is 97x137 at four widgets and ~65x137 or ~130x68 at six — not the '~120x110px targets' you claim. A 65px-wide dial carrying a 16-character technobabble label at an 11px floor is neither readable nor operable under a 4-second timer. Real Spaceteam gives each player a WHOLE phone for 4-6 widgets; you are giving them one sixth of one.
(3) THE HANDS/EYES ROLE AT 5-8 IS THE RIGHT SOCIAL ANSWER AND ALSO AN ADMISSION THAT ONLY 2 OF YOUR 8 PLAYERS ARE PLAYING.

If you want this to survive: put the two halves back-to-back on a stand, or blur/shrink the far half to ~30% so the EYES must relay it. Anything that restores asymmetry. FIT 4/10 · SPECTACLE 8/10.

### bombsquad — does-not-work

The brief opens by conceding the only thing that matters: 'you cannot give 8 people simultaneous sticks on one portrait phone.' Correct. Everything after is a competent Worms clone wearing BombSquad's clay. Cooked fuses, arc throws and ring-outs are the PROPS. The product is eight people mashing at once in real time, and turns delete it. This is the clearest 'cannot be made faithfully' in the set.

(1) THE ARENA THROWS AWAY 60% OF THE SCREEN TO ENABLE A FEATURE THAT SHOULDN'T EXIST. r = 0.42 * min(390,844) = 164px, so a 328px circle on an 844px-tall display. It has to be inscribed in a circle so the WORLD can rotate; the world rotates so the seat can face the player. Rotate the HUD, not the world, and you get the whole screen back. Eight characters plus bombs plus crates in 328px is ~30px per ragdoll — limbs at 4px.
(2) THE SHARED DODGE WINDOW IS THE BEST IDEA HERE AND IS OVERSOLD AS LOAD-BEARING. 1.2 real seconds at 0.35x, minus the ~250ms it takes a distracted person to notice the slow-mo started, leaves under a second to locate a 92px disc. And the packing fails: a 390px screen fits three non-overlapping 92px discs and then you are out of screen — your 'push apart if closer than 110px' rule has nowhere to push to. Most people will miss most windows and the 'nobody is ever idle' promise fails silently.
(3) TURN LENGTH. 420ms rotation + PASS card tap + up to 20s shot clock + 2.5-4s resolve ~ 30s per turn. Eight players = four minutes between your turns, in a game whose identity is that nothing ever stops.
(4) SABOTEUR's 130px aperture under a held thumb at the screen edge is actually the best privacy pattern in this document — reuse it in the chess Hand & Brain brief, where the reveal is currently leaked by tap position.

FIT 4/10 · SPECTACLE 8/10.

### helmet-derby — compromised

The brief states its own disqualifying fact in the second sentence: a side-view driving game cannot be shared by players seated opposite each other. Both offered answers are bad.

(1) DUO puts two adults shoulder-to-shoulder on a portrait phone's SHORT edge — 7cm of glass, two thumb clusters, a 28px (~5mm) dead gutter between them. Their thumbs will not collide; their FOREARMS will, because both people are reaching in from the same 7cm of table edge with their whole hands. A hazard-stripe divider does not create elbow room.
(2) FACE-OFF renders the physics world twice into 390x230 viewports. With a 14px minimum car height in a 230px-tall window you are playing in a letterbox, at double render cost, and the 5px head hitbox — the actual win condition — is 2% of the viewport height.
(3) CONCRETE GEOMETRY ERROR, FIX BEFORE ANYONE IMPLEMENTS IT: 'because left/right in the world is mirrored for the rotated player'. It is not. A 180deg rotation is orientation-preserving, and viewing that rotated render from the opposite side of the table composes back to the identity — the far player sees the same handedness and gravity still points down for them. Whoever implements the negation this sentence implies will invert one player's controls and then spend a day debugging it. Delete the clause; keep the bobbing YOU caret, which is still useful because both cars look alike.
(4) 3-8 IS A QUEUE, NOT A MODE. At 8 players, six people sit behind a phone watching a 90-second bout in a 230px window, then wait through a 2.5s seat card with two READY pads. The gate is well-designed; the situation it gates is not a party game.
(5) Ladder K defaulting to player count clamped 3-9 means an 8-player ladder needs 8 crowns from one player — potentially 30+ bouts.

FIT 4/10 · SPECTACLE 6/10.

