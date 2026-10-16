# Spec 005 — Labels and transitions
Status: draft

## Context and goal
Roadmap step 2 is "viewer on a real map". Specs 003a to 003c (map package, builder, dev map) and 004 (static viewer with a debug scene) are merged. This spec finishes step 2 with the two things the old viewer got wrong: **labels** (it needed six patch iterations) and **transitions** (broken).

This spec defines:
1. **Labels** drawn on the map: a name for every faction and a name for every land territory. At far zoom the faction names show; zooming in, the faction names fade out while the territory names fade in.
2. **Label layout**: where each label sits and how big it is, computed in the viewer from the id image and the displayed owners, and recomputed on every round change (a faction that absorbed another gets a label that fits its new total territory).
3. **Transition** between consecutive rounds: when the user steps one round forward, the absorbed territories change colour as a front that expands from the contact border into the absorbed area, and the labels follow; stepping one round back plays the same transition in reverse (the front retreats towards the contact border). Every other round change stays instant, as in 004.

Why: a spectator reads the map through names and watches an elimination happen. Text that is placed by region (not by colour), sized by what fits and crossfaded by zoom stays legible at any scale; a transition driven by contact distance explains what changed and where. Stating the layout rule exactly, with measurable properties, avoids the patch-by-patch tuning of the old viewer.

Decisions of the user (2026-10-16): labels are faction names plus territory names (sea zone names are out); the faction name fades out as the territory names fade in with zoom; label position and size are computed in the viewer from the id image (no change to the map package or the builder); the transition is a colour front expanding from the contact border, and played backwards when stepping back (decided 2026-10-16: it reuses the same distances and rules reversed); rounds advance only by the manual controls of 004 (no automatic playback), animating a step of one round in either direction and nothing else.

## Depends on
- Specs 001 to 003c unchanged. Spec 004 (viewer): its rendering base, camera, address, controls, debug panel, theme, border rules and scans. This spec amends the items listed under "Earlier items touched by this spec".

## Enables
- Roadmap step 3 (server and predictions): the viewer already animates one revealed round at a time and draws from a state alone.
- Step 4 (Discord bot) and later modes: the same label and transition rules apply to any owner table.

## Compatibility, "ask first" items and numbering
- **Map format, presentation data format, id image format, `MatchState`, `RoundRecord`, the sim and shared packages: unchanged.** The viewer reads names from the presentation data already defined (003a).
- **No new dependency** (NFR-36): text is drawn with what the browser already provides.
- **Numbering.** Ids continue after 003c: FR-167 to FR-183 and NFR-32 to NFR-37, unique across all specs.

### Earlier items touched by this spec
| Item | Change | By |
|---|---|---|
| 004 FR-155 (no animation, no intermediate state) | Still the rule for every round change except a step of one round, forward or back; that one animates (FR-174). | FR-174, FR-175 |
| 004 FR-150 (address parameters) | One optional debug parameter `transition` is added (FR-183). | FR-183 |
| 004 FR-157 note "labels are not part of this spec" | Labels are now this spec. | FR-167..FR-173 |
| 004 FR-158 (debug panel timings) | One more figure: the layout time of the last round change. | FR-182 |
| 004 tests that forbid transitions and time uniforms (FR-155 scan) | Amended to allow exactly the machinery of this spec, nothing else. | NFR-35 |
| 004 NFR-27 review set | Extended with label and transition scenes. | NFR-34 |

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
- Terms of specs 001 to 004 keep their meaning: **map unit, contact, piece, faction, land territory, sea zone, displayed round (N), displayed state, screen pixel, scale, fit scale, camera, debug scene, rendering part**.
- **Region**: a 4-connected set of map units that belong to land territories of one faction at the displayed state. (A region is never a colour: two separate regions of one faction are two regions, and two regions of equal-looking colours are two regions.)
- **Main region of a faction**: its region with the most map units; ties go to the region whose first map unit in row-major order comes first.
- **Piece of a territory**: 4-connected set of map units with the territory's value; the **main piece** is the one with the most map units, ties as above.
- **Text aspect ratio** of a label: width divided by height of the label's text as measured by the drawing surface in the label's font (one number per text).
- **Label box**: the axis-aligned rectangle, in map units, that holds a label's text: height h, width h × (text aspect ratio).
- **Fits** a region (or piece): every map unit whose centre lies inside the label box grown by `labelMargin` on every side belongs to that region (or piece).
- **Label parameters** (named; final values are tuned from screenshots in the plan and tasks phase, within these ranges):
  - `labelMargin` (M): free space around a box, in map units; 1 ≤ M ≤ 4.
  - `labelMaxHeight` (Hmax): the largest label box height, in map units; 20 ≤ Hmax ≤ 200.
  - `labelMinPx` (P): labels whose box would be drawn lower than P screen pixels are not drawn; 6 ≤ P ≤ 14.
  - `labelFadeStart` (L0) and `labelFadeFull` (L1): the scale at and below which only faction labels show, and the scale at and above which only territory labels show; 0.5 ≤ L0 < L1 ≤ 8.
  - `transitionDuration` (D): duration of a transition in milliseconds; 800 ≤ D ≤ 3000.
- **Territory label opacity** at scale s: smoothstep(L0, L1, s) (the smoothstep of 004 Definitions). **Faction label opacity** at scale s: 1 − smoothstep(L0, L1, s).
- **Transition**: the animated change from the displayed state of a round a to the state of the consecutive round b = a + 1 (**forward**) or b = a − 1 (**backward**) (FR-174). Its **later round** is the larger of a and b, and its **earlier round** the smaller; the record of the later round lists the transferred territories. **Progress** p: a number from 0 (state of round a) to 1 (state of round b); during a transition p = smoothstep(0, 1, t / D) for the elapsed time t, 0 ≤ t ≤ D. **Forward progress** f: p for a forward transition and 1 − p for a backward one, so that f = 0 is the state of the earlier round and f = 1 the state of the later round.
- **Transferred pieces**: the 4-connected sets of map units of the territories that the later round's record lists as transferred.
- **Contact set of a transferred piece**: its map units that are 4-adjacent to a map unit of a land territory owned, at the earlier round, by the absorbing faction of the later round's record (the absorber) and not transferred. **Seed set**: the contact set if it is not empty; otherwise the map units of the piece with the smallest squared distance between unit centres to any map unit of an absorber territory (all of them if tied).
- **Front distance** of a map unit of a transferred piece: the number of 4-adjacent steps inside the piece from the nearest map unit of its seed set (0 for the seed set). **Normalised front distance**: that number divided by the largest front distance in the same piece (0 for a piece whose largest is 0).

## Functional requirements
### Labels
- FR-167: THE SYSTEM SHALL show, for each faction that owns at least one land territory in the displayed state, one faction label: the faction's name (presentation data) placed on the faction's main region.
- FR-168: THE SYSTEM SHALL show, for each land territory, one territory label: the territory's name (presentation data) placed on its main piece.
- FR-169: THE SYSTEM SHALL give each label the box of largest height h (a whole number of map units, at least 1, not above Hmax) that fits the label's region (or piece), is horizontal, and has the text's aspect ratio; among equal heights, the topmost box wins, then the leftmost (positions in whole map units, box corner at a unit corner). IF no box of height 1 fits, THEN THE SYSTEM SHALL draw no label for it.
- FR-170: WHEN the displayed state changes, THE SYSTEM SHALL recompute every faction label from the new state (a faction that absorbed another one gets the label of its new main region); territory labels depend on the territory only and SHALL not move.
- FR-171: THE SYSTEM SHALL draw faction labels at the faction label opacity and territory labels at the territory label opacity of the current scale, and SHALL NOT draw a label whose box would be lower than P screen pixels at the current scale.
- FR-172: THE SYSTEM SHALL draw each label's text in black or white, whichever has the higher contrast ratio with the fill colour of the label's owner, so that the contrast ratio is at least 4.5 : 1 (WCAG relative luminance), and SHALL draw the text with a one-pixel halo of the other colour.
- FR-173: THE SYSTEM SHALL draw label text horizontally and sharply at every scale from the fit scale to 32: the text is rendered at the size it is displayed at (no enlargement of a smaller bitmap), and its box on screen is the label box times the scale (within 1 screen pixel).

### Transitions
- FR-174: WHEN the displayed round changes from n to n + 1 or to n − 1 (through any control of 004 FR-154: next, previous, first from round 1, last from round T − 1, the arrow keys, Home from round 1, End from round T − 1, or a typed round), THE SYSTEM SHALL play the transition of FR-175 to FR-177 over D milliseconds; every other change of the displayed round (a jump of more than one round, the page load) SHALL be drawn at once as in 004 FR-155. IF the browser reports a reduced-motion preference, THEN every round change SHALL be drawn at once.
- FR-175: DURING a transition, THE SYSTEM SHALL draw each map unit of a transferred piece in the colour of the absorber when its normalised front distance is below the forward progress f or f = 1, and in the colour of the absorbed faction otherwise, and SHALL draw every other map unit in the colour of its owner (the same at both rounds for them). At p = 0 the drawing SHALL be identical, pixel for pixel, to the instant drawing of round a, and at p = 1 to that of round b. A backward transition is the forward one played in reverse.
- FR-176: DURING a transition, THE SYSTEM SHALL draw borders as follows: along an edge between a transferred territory and a territory of a third faction, the `faction` line as before; along an edge between a transferred territory and the absorber's territories, a line that goes from the `faction` line of the earlier round to the `territory` line of the later round by linear interpolation of colour and opacity over the forward progress f; and no line along the colour front itself.
- FR-177: DURING a transition, THE SYSTEM SHALL draw the label of the eliminated faction (the one that exists at the earlier round only) at its opacity times (1 − f), the label of the absorber with its box interpolated from its box at the earlier round (f = 0) to its box at the later round (f = 1) (box corner and height), and the text colour of each territory label of a transferred territory switched at f = 0.5; all other labels unchanged.
- FR-178: IF the displayed round changes while a transition is playing, THEN THE SYSTEM SHALL complete the transition at once (draw its final state) before handling the new change. IF the page is hidden or the drawing is suspended for longer than D, THEN the transition SHALL be completed when drawing resumes. Camera pan, zoom, reset and resize SHALL keep working during a transition.
- FR-179: WHEN a round change is requested, THE SYSTEM SHALL update the panel, the controls, the address and the displayed round at once to the requested round; only the drawing of the map and its labels is animated.
- FR-180: THE SYSTEM SHALL use, for a transition, only the displayed states of the two rounds involved and the record of the later round, all of which the user has requested or already seen; it SHALL NOT request or compute any round other than the displayed one and the one requested, and the rendering part SHALL receive only per-entry owners, a progress value, the front distances and label boxes, never a seed or round (004 FR-159, FR-160). 004 FR-160 (the sim is asked only for the displayed round) is kept: the state being left is the one already displayed and the state being entered is the one requested.
- FR-181: THE SYSTEM SHALL compute the label layout and the front distances with pure functions of the id image, the owners (the displayed round and, for a transition, the other round involved), the label parameters and the text aspect ratios, so that the same inputs give the same boxes and distances.
- FR-182: THE SYSTEM SHALL show in the debug panel (004 FR-156) the time taken to compute the labels and front distances of the last round change, in milliseconds.
- FR-183: THE SYSTEM SHALL accept the optional address parameter `transition` (a decimal number from 0 to 1, same syntax and error handling as the camera parameters of 004 FR-150, FR-151) which, when present and the displayed round is at least 1, draws the state frozen at forward progress f = `transition` between round N − 1 (f = 0) and round N (f = 1), with no time running; WHEN the user changes the round, the camera is not affected and the parameter is dropped from the address.

## Non-functional requirements
- NFR-32 (Performance): on the dev map, on the reference machine and browser of 004 NFR-24, with a 1920 × 1080 drawing area: during a transition and during panning and zooming with all labels on, median frame time at most 16.7 ms and 95th percentile at most 33.3 ms; the label layout and the front distances of a round change computed within 150 ms (FR-182 measurements); the first frame of a transition drawn within 50 ms of the request.
- NFR-33 (Purity and determinism): the layout, the front distances, the opacity functions and the contrast choice are pure, deterministic functions with no DOM, clock or randomness, tested without a browser; only the clock of the viewer shell may read time, to turn elapsed milliseconds into progress.
- NFR-34 (Visual verification): the review set of 004 NFR-27 is extended with scenes for: faction labels at fit scale at rounds 0, 1 and 4; the crossfade at scales below, at the middle of and above the fade range; territory labels in a dense area and on a small island; a faction whose main region is not its biggest-looking colour area; and the transition at forward progress 0, 0.25, 0.5, 0.75 and 1 (frozen by FR-183) for round 0 to 1 and for a transfer with a piece without contact (a backward transition is the same frames in the opposite order and is checked by tests, not by extra screenshots). The user reviews and accepts every screenshot and the values of the label parameters.
- NFR-34 note: at f = 0 no unit of a transferred piece has changed colour (normalised distance 0 is not below 0), at f = 1 all have.
- NFR-35 (No regression): 001 to 004 tests pass with the meaning of their assertions; the dev map package, the goldens and the sim and shared exports are byte-identical; the only earlier tests that may be edited are the 004 scans that forbid timers, transitions and time uniforms (amended to allow the progress uniform, the shell clock and the animation frame of this spec and nothing else) and the traceability test (expected list extended to FR-183 and NFR-37).
- NFR-36 (Dependencies): none added. Text is rendered with browser facilities already available (canvas 2D or equivalent) and the current Three.js.
- NFR-37 (Language): every user-visible text that is not map data stays in the UI strings module (004 NFR-28); label texts are names from the presentation data. This spec adds no new UI text, except if the plan needs one (then it goes through the same module).

## Edge cases
- A faction with several regions (Spain and the Balearic Islands): one label, on the largest region.
- A region too small for any box of 1 map unit: no label; below P screen pixels: not drawn at that scale.
- Two factions whose labels are close: boxes lie inside different regions, so they never overlap each other; a faction label and territory labels of its own territories may overlap while they crossfade (opacities sum to 1).
- A transferred territory that does not touch the absorber (an island absorbed through a shared sea zone, 002): its piece has no contact set; the seed set is its closest units to the absorber; it still finishes at p = 1.
- A transfer with several transferred pieces: each piece has its own seed set and its own normalisation; all finish together.
- The eliminated faction's label has opacity 0 at forward progress f = 1; it does not exist at the later round (FR-167).
- A very long name: its aspect ratio is large and its box is small; the same rules apply.
- Round T (one faction left): its label covers its main region; a transition into round T is a normal one.
- A step requested while a transition is playing: FR-178 completes the running one, then the new step (forward or back) starts from the new displayed round if it is a step of one round.
- `?round=0&transition=0.5` (no previous round): the parameter has no effect and is reported like an out-of-range camera parameter; `?transition=2`: invalid, reported, instant drawing.
- Scale at exactly L0: only faction labels at full opacity; at exactly L1: only territory labels.
- A browser without a font that has the glyphs of a name: the browser's fallback is used; no failure.

## Out of scope
- Names of sea zones and any label for the background; curved, rotated or letter-spaced text; label collision resolution between different regions (they cannot overlap by construction).
- Automatic playback, pause, speed control, sound, camera animation or following the action.
- Transitions for jumps of more than one round.
- Rounds from a server (step 3); the debug scene keeps computing locally.
- A different map package or a map editor.

## Done criteria
- Every FR and NFR above is traced by passing tests (pure parts) or by accepted screenshots and recorded measurements (NFR-32, NFR-34); `npm test` and `npm run typecheck` are green, also with `CI=1`.
- The label layout properties (inside the region, maximal height, deterministic tie-break, same inputs same boxes) are tested on hand-made grids and on the dev map.
- The front-distance rules and the "final frame equals instant drawing" property are tested.
- NFR-32 figures recorded in the pull request; NFR-34 screenshots accepted by the user, including the values of the label parameters (L0, L1, P, M, Hmax, D).
- `MEMORY.md` updated.

## Open questions
- None. Resolved with the user (2026-10-16): labels are factions plus territories with the faction names fading out as the territory names fade in; layout computed in the viewer from the id image; a colour front expanding from the contact border; manual stepping only, animating one forward step. The values inside the parameter ranges are tuned from screenshots in the plan and tasks phase, as in 004.
