# Spec 005 — Labels and transitions
Status: approved

## Context and goal
Roadmap step 2 is "viewer on a real map". Specs 003a to 003c (map package, builder, dev map) and 004 (static viewer with a debug scene) are merged. This spec finishes step 2 with the two things the old viewer got wrong: **labels** (it needed six patch iterations) and **transitions** (broken).

This spec defines:
1. **Labels** drawn on the map: a name for every faction and a name for every land territory. At far zoom the faction names show; zooming in, the faction names fade out while the territory names fade in.
2. **Label layout**: where each label sits and how big it is, computed in the viewer from the id image and the displayed owners. Faction labels are recomputed on every round change (a faction that absorbed another gets a label that fits its new territory); territory labels depend on the territory only and never move.
3. **Transition** between consecutive rounds: when the user steps one round forward, the absorbed territories change colour as a front that expands from the contact border into the absorbed area, and the labels follow; stepping one round back plays the same transition in reverse (the front retreats towards the contact border). Every other round change stays instant, as in 004, and so does every round change when the browser reports a reduced-motion preference.

Why: a spectator reads the map through names and watches an elimination happen. Text that is placed by region (not by colour), sized by what fits and crossfaded by zoom stays legible at any scale; a transition driven by contact distance explains what changed and where. Stating the layout rule exactly, with measurable properties, avoids the patch-by-patch tuning of the old viewer.

Decisions of the user (2026-10-16): labels are faction names plus territory names (sea zone names are out); the faction name fades out as the territory names fade in with zoom; label position and size are computed in the viewer from the id image (no change to the map package or the builder); the transition is a colour front expanding from the contact border, and played backwards when stepping back (it reuses the same distances and rules reversed); rounds advance only by the manual controls of 004 (no automatic playback), animating one step of one round in either direction and nothing else; no new dependency.

Amendment (2026-10-16, after the review of the T8 screenshots): every label uses white text with a black halo, the style the Germany label had; the text colour is no longer chosen by contrast with the fill (FR-174).

## Depends on
- Specs 001 to 003c unchanged. Spec 004 (viewer): its rendering base, camera, address, controls, debug panel, theme, border rules and scans. This spec amends the items listed under "Earlier items touched by this spec".

## Enables
- Roadmap step 3 (server and predictions): the viewer already animates one revealed round at a time and draws from a state alone.
- Step 4 (Discord bot) and later modes: the same label and transition rules apply to any owner table.

## Compatibility, "ask first" items and numbering
- **Map format, presentation data format, id image format, `MatchState`, `RoundRecord`, the sim and shared packages: unchanged.** The viewer reads names from the presentation data already defined (003a).
- **No new dependency** (NFR-36).
- **Numbering.** Ids continue after 003c: FR-167 to FR-194 and NFR-32 to NFR-37, unique across all specs.

### Earlier items touched by this spec
| Item | Change | By |
|---|---|---|
| 004 FR-136 (fill drawing) and FR-139 (line drawing and overlap order) | Labels are drawn above the fills and above every border line. During a transition, the interpolated line between a transferred territory and the absorber takes the place of `faction` in the FR-139 overlap order while f < 1. | FR-173, FR-180 |
| 004 FR-138 (an absorbed border changes in the same frame as the colours) | During a transition the colours and that border change gradually with f; at f = 1 the drawing equals the instant drawing of the later round. | FR-179, FR-180 |
| 004 FR-140 (the only camera-dependent drawing property is `territory` line opacity) | Label opacity and label visibility also depend on the camera, through the scale only. During a transition, the fills, borders and labels of transferred territories (and the absorber's and eliminated faction's labels) also depend on f. | FR-172, FR-179, FR-180, FR-181 |
| 004 FR-150 (address parameters) | One optional debug parameter `transition` is added. | FR-191, FR-192, FR-193, FR-194 |
| 004 FR-151 (invalid parameter handling) | An invalid `transition` is reported but does not reset the camera (it is not a camera parameter). | FR-192 |
| 004 FR-153 (address equals the displayed scene) | With a valid `transition` the address also holds the frozen progress; the map shows that progress (at `transition=0`, the drawing of round N − 1) while the panel, controls and address say round N. Accepted debug behaviour. | FR-191, FR-193, FR-194 |
| 004 FR-155 (no animation, no intermediate state) | Still the rule for every round change except a step of one round, forward or back, which animates; also the rule for every round change under a reduced-motion preference. | FR-176, FR-177, FR-178 |
| 004 FR-157 (pointer readout; note "labels are not part of this spec") | Labels are now this spec. During a transition the readout shows the owner at the displayed round (the round being entered). | FR-167..FR-175, FR-185 |
| 004 FR-158 (debug panel timings) | One more figure: the computing time of the labels and front distances of the last round change. The round-change time is measured up to the first frame that shows the new labels. | FR-190, NFR-32 |
| 004 FR-159 (rendering part inputs) | The rendering part also receives the owners before and after a change, the forward progress, the front distances and the label data, and nothing else. | FR-188 |
| 004 FR-160 (rounds requested from the sim) | Unchanged request set; a state or record of a round above N may be kept only while a backward transition from that round plays. | FR-187 |
| 004 NFR-24 (round change within 50 ms; a round change sends per-entry data only) | Round changes: within 150 ms, measured to the first frame with the new labels. A step of one round may also send the front distances of the transferred pieces; every other round change stays per-entry data only. Frame-time budgets also apply during transitions and with labels drawn. | NFR-32, FR-188 |
| 004 NFR-25 (clock reads only for FR-158) | Clock reads also allowed for the transition clock, in the part of the viewer that drives the animation. | NFR-33 |
| 004 tests of FR-155 (scan forbidding transitions and time inputs), NFR-24, NFR-25 and FR-140 | Amended to allow exactly the machinery of this spec, nothing else. | NFR-35 |
| 004 NFR-27 review set | Extended with label and transition scenes. | NFR-34 |
| Traceability test | Expected list extended to FR-194 and NFR-37. | NFR-35 |

## Users
- **Spectator** (indirect, later): reads names, sees who absorbed whom and where.
- **Developer / map author**: needs layouts and transitions that can be reproduced from a seed, a round and, for a transition, a fixed progress.
- **Reviewer (the user)**: accepts the look from screenshots of fixed scenes.

## User stories
- US-11. As a spectator, I want each faction's name over its territory at far zoom so that I know who is who at a glance.
- US-12. As a spectator, I want the faction names to give way to territory names as I zoom in so that the map stays readable at any scale.
- US-13. As a spectator, I want an absorption to play as colour spreading from the border where the two met so that I see what changed and where.
- US-14. As a developer, I want the same state to give the same labels and a transition to be frozen at a chosen progress so that I can review and reproduce them exactly.

## Definitions
- Terms of specs 001 to 004 keep their meaning: **map unit, 4-adjacent, contact, piece, faction, land territory, sea zone, round record, T, displayed round (N), displayed state, screen pixel, scale, fit scale, camera, debug scene, rendering part, smoothstep, `territoryDarken`**.
- **Map coordinates**: map unit (x, y) is the unit in column x and row y of the id image; y grows downwards; its centre is (x + 0.5, y + 0.5). **Row-major order**: smallest y first, then smallest x. Positions outside the id image never belong to a region or a piece.
- **Inside**: a map unit is inside the rectangle [x0, x1] × [y0, y1] when x0 ≤ x + 0.5 ≤ x1 and y0 ≤ y + 0.5 ≤ y1 (edges included).
- **Region** (at a given round): a maximal 4-connected set of map units whose values are land territories owned by one faction at that round. A region is never a colour: two separate regions of one faction are two regions, and two regions of equal-looking colours are two regions.
- **Main region of a faction**: its region with the most map units; ties go to the region whose first map unit in row-major order comes first.
- **Main piece of a territory**: the territory's piece (a maximal 4-connected set of map units with the territory's value, 003b) with the most map units; ties as for the main region.
- **Label parameters** (named; final values are tuned from screenshots in the plan and tasks phase, within these ranges):
  - `labelFont`: the font family list and weight of every label, fixed in the plan from a list that includes a generic fallback family.
  - `labelMargin` (M): free space around a box, in map units; 1 ≤ M ≤ 4.
  - `labelMaxHeight` (Hmax): the largest label box height, in map units; 20 ≤ Hmax ≤ 200.
  - `labelMinPx` (P): labels whose box would be drawn lower than P screen pixels are not drawn; 6 ≤ P ≤ 14.
  - `labelFadeStart` (L0) and `labelFadeFull` (L1): the scale at and below which only faction labels show, and the scale at and above which only territory labels show; 0.5 ≤ L0 < L1 ≤ 8.
  - `transitionDuration` (Dt): duration of a transition in milliseconds; 800 ≤ Dt ≤ 3000.
- **Text aspect ratio** of a label: the advance width of its text in `labelFont` divided by the font size, measured once per text at one fixed reference size (one number per text).
- **Label box**: the rectangle [x0, x0 + w] × [y0, y0 + h] in map coordinates that holds a label's text, where x0 and y0 are whole numbers (outside a transition), the height h is a whole number of map units and is the font size of the text on the map, and the width w = h × (text aspect ratio). Its **centre** is (x0 + w / 2, y0 + h / 2).
- **Fits**: a label box fits a set of map units (a region or a main piece) when every map unit inside the box grown by M on every side, [x0 − M, x0 + w + M] × [y0 − M, y0 + h + M], belongs to that set.
- **Territory label opacity** at scale s: smoothstep(L0, L1, s). **Faction label opacity** at scale s: 1 − smoothstep(L0, L1, s).
- **Transition**: the animated change from the displayed state of a round a to the state of the consecutive round b = a + 1 (**forward**) or b = a − 1 (**backward**) (FR-176). Its **later round** is the larger of a and b, its **earlier round** the smaller; the record of the later round names the **eliminated faction**, the **absorber** (the absorbing faction) and the transferred territories.
- **Progress** p: a number from 0 (state of round a) to 1 (state of round b); during a transition p = smoothstep(0, 1, t / Dt) for the elapsed time t (FR-182). **Forward progress** f: p for a forward transition and 1 − p for a backward one, so that f = 0 is the state of the earlier round and f = 1 the state of the later round.
- **Transferred pieces**: the maximal 4-connected sets of map units whose value is a territory listed as transferred by the later round's record. One transferred piece may span several transferred territories.
- **Contact set of a transferred piece**: its map units that are 4-adjacent to a map unit of a land territory owned by the absorber at the earlier round. **Seed set**: the contact set if it is not empty; otherwise the map units of the piece that reach the minimum, over all pairs of a map unit of the piece and a map unit of a territory owned by the absorber at the earlier round, of the squared distance between the two unit centres (every unit of the piece that reaches the minimum is in the seed set).
- **Front distance** of a map unit of a transferred piece: the number of 4-adjacent steps inside the piece from the nearest map unit of its seed set (0 for the seed set). **Normalised front distance**: that number divided by the largest front distance in the same piece (0 for a piece whose largest is 0).

## Functional requirements
### Labels
- FR-167: THE SYSTEM SHALL show, for each faction that owns at least one land territory in the displayed state, one faction label: the faction's name (presentation data) placed on the faction's main region.
- FR-168: THE SYSTEM SHALL show, for each land territory, one territory label: the territory's name (presentation data) placed on the territory's main piece.
- FR-169: THE SYSTEM SHALL give each label the horizontal label box of largest height h, a whole number from 1 to Hmax, that fits the label's main region (faction label) or main piece (territory label); among the fitting boxes of that height, the box whose centre has the smallest squared Euclidean distance to the mean of the centres of all of them SHALL win, then the box with the smallest y0, then the box with the smallest x0.
- FR-170: IF no label box of height 1 fits the label's main region or main piece, THEN THE SYSTEM SHALL draw no label for it.
- FR-171: WHEN the displayed state changes, THE SYSTEM SHALL recompute every faction label from the new state (a faction that absorbed another one gets the box of its new main region; a faction with no land territory has no label) and SHALL NOT change any territory label box or colour (a territory label's opacity factor may change during a transition).
- FR-172: THE SYSTEM SHALL draw faction labels at the faction label opacity and territory labels at the territory label opacity of the current scale, each multiplied by the label's opacity factor (1 outside a transition, FR-181), and SHALL NOT draw a label whose box height on screen (h × scale) is below P screen pixels.
- FR-173: THE SYSTEM SHALL draw every label above the fills and above every border line of 004 FR-136 to FR-139.
- FR-174: THE SYSTEM SHALL draw every label's text (faction and territory labels) in white (#FFFFFF) with a halo 1 screen pixel wide in black (#000000), whatever the fill colour under the label, its owner or the round; text and halo take the label's opacity of FR-172 alike.
- FR-175: THE SYSTEM SHALL draw label text horizontally at every scale from the fit scale to 32, rendered at the device pixel resolution of its displayed size (no bitmap enlarged by a factor above 1.0), with its box on screen equal to the label box times the scale within 1 screen pixel or 1 % of the box's on-screen width (horizontally) and height (vertically), whichever is larger.

### Transitions
- FR-176: WHEN the displayed round changes from N to N + 1 or to N − 1 (through any control of 004 FR-154: next, previous, first from round 1, last from round T − 1, the arrow keys, Home from round 1, End from round T − 1, or a typed round that differs by one), THE SYSTEM SHALL play the transition from the drawing of round N to that of the new round over Dt milliseconds (FR-179 to FR-182).
- FR-177: IF the browser reports a reduced-motion preference, THEN THE SYSTEM SHALL draw every round change at once as in 004 FR-155 (the frozen progress of FR-191 still applies).
- FR-178: WHEN the displayed round is set in any other way (a jump of more than one round, the first drawing after load, or the error path of 004 FR-151 that displays round 0), THE SYSTEM SHALL draw it at once as in 004 FR-155; a typed round equal to the displayed round is no change and SHALL start nothing.
- FR-179: WHILE a transition is playing, THE SYSTEM SHALL draw each map unit of a transferred piece in the absorber's colour when its normalised front distance is below the forward progress f or f = 1, and in the eliminated faction's colour otherwise, and every other map unit in its fill colour (the same at both rounds); the whole drawing (fills, borders and labels) at f = 0 SHALL be identical, pixel for pixel, to the instant drawing of the earlier round, and at f = 1 to that of the later round.
- FR-180: WHILE a transition is playing, THE SYSTEM SHALL draw borders as follows: along an edge between a transferred territory and a territory owned by the absorber at the earlier round, a line whose colour and opacity go by linear interpolation in f from the `faction` line (f = 0) to the `territory` line of the later round (f = 1), taking the place of `faction` in the 004 FR-139 overlap order while f < 1; along an edge between two different transferred territories, a `territory` line whose colour goes by linear interpolation in f from the eliminated faction's colour darkened by `territoryDarken` to the absorber's colour darkened the same way; every other edge as at both rounds. Two 4-adjacent map units of the same value SHALL get no line, whatever colour the front gives them (no line along the colour front).
- FR-181: WHILE a transition is playing, THE SYSTEM SHALL draw the labels as follows: the eliminated faction's label with its box at the earlier round and opacity factor 1 − f (nothing if it had no box); the absorber's label, when it has a box at both rounds, with its box (x0, y0, h) interpolated linearly in f from the earlier box (f = 0) to the later box (f = 1) and opacity factor 1, and, when it has a box at one round only, with that box and opacity factor f (later round) or 1 − f (earlier round); every other label, including the territory labels of the transferred territories, as at both rounds (same box, opacity factor 1 and the colours of FR-174).
- FR-182: WHILE a transition is playing, THE SYSTEM SHALL take t as the wall-clock time elapsed since the round change was requested and SHALL draw the final state (the instant drawing of the round being entered) at the first frame with t ≥ Dt, including the first frame drawn after the page was hidden or drawing was suspended, which then ends the transition.
- FR-183: IF a round change is requested while a transition is playing, THEN THE SYSTEM SHALL complete the running transition at once (its final state becomes the drawing of the displayed round) and SHALL then handle the new change from that displayed round (FR-176 to FR-178); for example, previous during a forward transition from round 4 to round 5 shows round 5 at once and then animates from round 5 back to round 4.
- FR-184: IF the reduced-motion preference changes while a transition is playing, THEN THE SYSTEM SHALL complete the transition at once.
- FR-185: WHILE a transition is playing, THE SYSTEM SHALL keep pan, zoom, reset and resize working as in 004 FR-144 to FR-148, and SHALL show in the pointer readout (004 FR-157) the owner at the displayed round (the round being entered).
- FR-186: WHEN a round change is requested, THE SYSTEM SHALL set the displayed round, the panel, the controls and the address to the requested round no later than the first frame of the change; only the drawing of the map and its labels is animated.

### Data, anti-spoiler and debugging
- FR-187: THE SYSTEM SHALL request from the sim only the rounds 004 FR-160 allows for the displayed round N (0..N); it SHALL keep a state or record of a round above N only while a backward transition from that round plays, and SHALL release it when the transition completes; for the frozen progress of FR-191 it SHALL use rounds N − 1 and N only.
- FR-188: THE SYSTEM SHALL give the rendering part (004 FR-159), besides the map package and the camera, only: the owner per land territory to display and, during a transition, the owner per land territory before and after the change, the forward progress f and the normalised front distance per map unit of the transferred pieces; and, per label, its text, whether it is a faction or a territory label, its box, its opacity factor and its text colour. It SHALL never give it a seed, a round number, a round count or a round record.
- FR-189: THE SYSTEM SHALL compute the label boxes, the front distances, the label opacities and opacity factors, the text colours and the interpolated boxes with pure functions of the id image, the owners at the rounds involved, the transferred territories, the label parameters, the text aspect ratios, the scale and f, so that the same inputs give the same results.
- FR-190: THE SYSTEM SHALL show in the debug panel (004 FR-156) the time taken to compute the faction labels and front distances of the last round change, in milliseconds.
- FR-191: THE SYSTEM SHALL accept the optional address parameter `transition`, a decimal number with the syntax of the camera parameters of 004 FR-150; WHILE a valid `transition` (a number from 0 to 1) is in the address and the displayed round N is at least 1, THE SYSTEM SHALL draw the transition between rounds N − 1 (f = 0) and N (f = 1) frozen at forward progress f = `transition`, with no time running, while the panel, controls and address show round N.
- FR-192: IF `transition` is not a number from 0 to 1, or the displayed round N is 0, THEN THE SYSTEM SHALL show a Spanish message naming the parameter, ignore it (round N drawn at once), leave the camera unaffected, and remove the parameter from the address at the next address update.
- FR-193: WHEN only the camera changes while a valid `transition` is in the address, THE SYSTEM SHALL keep `transition` in the address together with the new camera parameters.
- FR-194: WHEN the displayed round changes while a valid `transition` is in the address, THE SYSTEM SHALL leave the frozen drawing for the full state of round N, remove `transition` from the address, and then handle the change from round N (FR-176 to FR-178).

## Non-functional requirements
- NFR-32 (Performance): on the dev map, on the reference machine and browser of 004 NFR-24, with a 1920 × 1080 drawing area: the faction labels and the front distances of a round change computed within 100 ms (FR-190 figure); every round change (drawn at once, or the first frame of a transition) drawn within 150 ms of the request, measured by 004 FR-158 from the request to the first frame that shows the new labels; median frame time at most 16.7 ms and 95th percentile at most 33.3 ms during a transition and during panning and zooming at a scale between L0 and L1 with every label FR-172 allows drawn. Territory label boxes depend only on the territory, are computed once per page load and are outside the per-change budget. Figures recorded in the pull request.
- NFR-33 (Purity and determinism): the functions of FR-189 and the progress function are pure and deterministic, with no DOM, graphics, clock or randomness, and are tested without a browser; the text aspect ratios are measured outside them and passed in. Only the part of the viewer that drives the animation reads the clock for transitions, to turn elapsed milliseconds into progress (besides the measurements of 004 FR-158).
- NFR-34 (Visual verification): the review set of 004 NFR-27 is extended with scenes for: faction labels at fit scale for seed 1 at rounds 0, 1 and T; the crossfade at a scale below L0, between L0 and L1, and above L1; territory labels in a dense area and on a small island; a faction with two regions separated by a strait or a line narrower than 4 screen pixels at fit scale, with its label on the main region (FR-167, FR-169); the transition from round 0 to 1 at forward progress 0, 0.25, 0.5, 0.75 and 1 (frozen by FR-191); and the same five progress values for a transfer with a transferred piece whose contact set is empty, at a seed and round named in the plan where one exists (found by a test), or this scene is dropped if none is found. A backward transition is the same frames in the opposite order and is checked by tests, not by extra screenshots. The user reviews and accepts every screenshot and the values of the label parameters.
- NFR-35 (No regression): 001 to 004 tests pass with the meaning of their assertions; the dev map package, the goldens and the sim and shared exports are byte-identical. The only earlier tests that may be edited are: the 004 FR-155 scan, amended to allow, by an explicit list in the plan, the identifier for the `transition` address parameter, interpolation helpers in pure code, one progress input to the drawing, and animation frame requests only in the part of the viewer that drives the animation; the 004 NFR-25 clock rule, amended to allow clock reads for the transition clock in that same part; the 004 NFR-24 and FR-140 tests, amended as in the "Earlier items touched" table; and the traceability test (expected list extended to FR-194 and NFR-37).
- NFR-36 (Dependencies): no dependency is added; text is drawn with facilities the browser already provides.
- NFR-37 (Language): every user-visible text that is not map data stays in the UI strings module (004 NFR-28); label texts are names from the presentation data. This spec adds only the message of FR-192 (and any text the plan needs), through the same module.

## Edge cases
- A faction with several regions (Spain and the Balearic Islands): one label, on the main region.
- A region or main piece too small for any box of height 1: no label (FR-170); a box lower than P screen pixels at the current scale: not drawn at that scale (FR-172).
- Outside a transition, labels of two different factions never overlap: their boxes, grown by M ≥ 1, lie inside different regions. A faction label and the territory labels of its own territories may overlap while they crossfade (their opacities sum to 1). During a transition the absorber's moving label may overlap other labels (accepted).
- An absorber whose main region changes to another region (the absorbed land is larger than its old main region): its box jumps there; during the transition the interpolated box may pass over other factions (accepted).
- An absorber with a box at one round only: its label fades in (or out) on that box (FR-181). An eliminated faction with no box at the earlier round: nothing is drawn for it.
- The eliminated faction's label has opacity factor 0 at f = 1; it does not exist at the later round (FR-167).
- At f = 0 no map unit of a transferred piece has the absorber's colour (a normalised distance of 0 is not below 0); at f = 1 all have.
- A transferred piece of 1 map unit: front distance 0, normalised 0; it changes colour at the first f > 0.
- A transferred piece with no contact set (an island absorbed through a shared sea zone, 002): the seed set is its units closest to the absorber's land; it still finishes at f = 1.
- A transfer with several transferred pieces: each piece has its own seed set and its own normalisation; all finish together. A transferred piece may cover several transferred territories: the front crosses the edges between them.
- A white, black or very light fill under a label: the text is still white with a black halo (FR-174); legibility comes from the halo (white on black, contrast ratio 21:1), not from the fill.
- Two labels with the same text (e.g. a faction named like one of its territories): each is placed and drawn independently.
- An empty name: rejected by the presentation check (003a), so it never reaches the viewer; the layout gives no label for it.
- A very long name: its aspect ratio is large and its box is small; the same rules apply.
- Round T (one faction left): its label covers its main region; a transition into or out of round T is a normal one.
- A step requested while a transition is playing: FR-183 completes the running one; the new step (forward or back) then starts from the new displayed round.
- The pointer over a unit that still shows the eliminated faction's colour during a transition: the readout names the owner at the displayed round (the absorber after a forward step) (FR-185).
- Reduced-motion preference: every round change is drawn at once (FR-177); a frozen `transition` in the address still applies; a preference change during a transition completes it (FR-184).
- `?round=0&transition=0.5` (no previous round), `?transition=2`, `?transition=abc`: message naming `transition`, round N drawn at once, camera unaffected, parameter removed at the next address update (FR-192).
- `?round=3&transition=0`: the map shows the drawing of round 2 while the panel, controls and address say round 3 (FR-191; accepted debug behaviour). Panning keeps `transition` in the address (FR-193); stepping removes it and starts from the full state of round 3 (FR-194).
- Scale exactly L0: only faction labels, at full opacity; exactly L1: only territory labels.
- A browser without a font in `labelFont` that has the glyphs of a name: the generic fallback is used; no failure. The dev map layout is reproducible for a given font.

## Out of scope
- Names of sea zones and any label for the background; curved, rotated (vertical, diagonal) or letter-spaced text, and labels that extend beyond their land (left to a later spec); label collision resolution between different regions (they cannot overlap outside transitions by construction).
- Automatic playback, pause, speed control, sound, camera animation or following the action.
- Transitions for jumps of more than one round.
- Rounds from a server (step 3); the debug scene keeps computing locally.
- A different map package or a map editor.

## Done criteria
- Every id FR-167 to FR-194 and NFR-32 to NFR-37 appears in at least one test title (001 NFR-7 rule, enforced by the traceability test). Ids that need screenshots or measurements (FR-175, NFR-32, NFR-34) are traced by tests of their pure part. `npm test` and `npm run typecheck` are green, also with `CI=1`.
- The label layout properties (fits the main region or main piece, maximal height, tie rule, no box below height 1, territory boxes equal at every round, same inputs same boxes) are tested on hand-made grids with injected fixed text aspect ratios and on the dev map.
- The seed set, front distance and normalisation rules, the f = 0 and f = 1 "equals the instant drawing" property, the backward transition as the forward one reversed, the label interpolation rules and the ink rule (every label, at every round, f and fill colour, has white text and a black halo) are tested.
- NFR-32 figures recorded in the pull request; NFR-34 screenshots accepted by the user, including the values of the label parameters (`labelFont`, L0, L1, P, M, Hmax, Dt).
- `MEMORY.md` updated.

## Open questions
- None. Resolved with the user (2026-10-16): labels are factions plus territories with the faction names fading out as the territory names fade in; layout computed in the viewer from the id image; a colour front expanding from the contact border, played in reverse when stepping back; manual stepping only, animating one step of one round in either direction; no new dependency. The values inside the parameter ranges are tuned from screenshots in the plan and tasks phase, as in 004.
