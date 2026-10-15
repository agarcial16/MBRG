# Spec 004 — Viewer
Status: approved

## Context and goal
Roadmap step 2 is "viewer on a real map". Specs 003a (map package contracts) and 003b (builder and dev map) are merged: the repository holds a real-scale dev map package (2048 × 2048 id image, 5 factions, 70 land territories, 17 sea zones). Step 2 continues with **004 viewer** (this spec) and 005 labels and transitions. Roadmap gate: nothing moves to step 3 (server and predictions) until the viewer looks right on the real map at target scale.

This spec defines the first viewer:
1. **Static rendering** of a map package from its id image, in the browser, with the technique chosen for the project: the id image is drawn as-is, each map unit coloured by a per-entry lookup (owner colour, sea, background), and borders computed from id differences; a strong border between two land territories exists only where their owners differ, so it vanishes when one faction absorbs the other. Between territories of the same owner only a faint line is drawn, and only when zoomed in.
2. **Explicit sea and background**: sea zones and background are drawn in their own colours, decided from the ids, never inferred from colours or darkness.
3. A **camera** (pan, zoom, reset) over the 2D map.
4. A **debug scene** driven by a fixed seed and round, read from the page address, that shows the match state at that round from the sim, with **instant round stepping** (first, previous, next, last, jump) and no transition.
5. **Performance at real scale** on the dev map, and the **anti-spoiler** rule applied to the viewer.

Why: the old viewer failed on borders (dark pixels read as borders, seams between shared borders), on sea (drawn as "dark = border") and on transitions. Drawing the id image directly gives every border exactly once with no seam; deciding fill and border from ids and owners makes sea explicit and makes absorbed borders disappear by construction. A seeded debug scene makes every visual review reproducible (same seed, round and camera give the same picture), which the roadmap gate and AGENTS.md (reviewed screenshots) require. Labels and transitions are deliberately left to 005 so that this rendering base is judged on its own first.

## Depends on
- Spec 001 (map, ids, match state, `getState`, `totalRounds`, `getRounds`, anti-spoiler NFR-4), spec 002 (sea zones, factions, direct candidates), spec 003a (map package, presentation data, value encoding FR-106, presentation check FR-91, id image check FR-109, faction order, "Contract for later specs"), spec 003b (committed dev map package, FR-105 PNG format, NFR-20 library scope). All merged; their behaviour is unchanged (NFR-29).

## Enables
- Spec 005 (labels and transitions): a rendering base whose fill and borders depend only on ids and the displayed owners.
- Roadmap step 3 (server): a rendering part that consumes only a match state, so server-revealed states can replace the debug scene's local computation.

## Compatibility, "ask first" items and numbering
- **Map format, presentation data format, id image format, `MatchState` and `RoundRecord`: unchanged.** The viewer only reads them.
- **No new export and no behaviour change in the shared or sim packages** (NFR-29). Everything the viewer needs that is not exported today (colour assignment, border classes, camera, address parsing) lives in the viewer. If the plan finds that a shared or sim export is needed, this spec is changed first.
- **Ask first, new dependencies (constitution rule 1, AGENTS.md).** The viewer needs a browser graphics library and a development server / bundler. **The user approved Three.js (graphics library) and Vite (development server / bundler) in principle** (decision Q4). Neither is a dependency of the repository today (Vite is only a transitive dependency of the test runner). The plan SHALL propose an exact version of each, with its licence and justification, for the user's confirmation before it is pinned (NFR-26). No other library (DOM emulation for tests, browser automation, UI framework, PNG decoder) is allowed by this spec.
- **Repository configuration (allowed extensions).** This spec MAY extend, only as far as needed to run, build, type-check and test the viewer: the root workspace list, the root `dev`, `build` and type-check commands (AGENTS.md lists `npm run dev` and `npm run build`), the test runner's include list, the test type-check configuration, and the traceability scan glob (NFR-29). It SHALL NOT change the committed dev map package.
- **Numbering.** Ids continue after 003b: FR-132 to FR-161 and NFR-24 to NFR-29, unique across all specs. No earlier id is retired, renumbered or reused.

### Earlier items touched by this spec
| Item | Change | By |
|---|---|---|
| 003a "Contract for later specs": colours | Adopted with own ids; palette, sea and background colours decided here. | FR-141, FR-142, FR-143 |
| 003a "Contract for later specs": id image sampling | Adopted with own id. | FR-134 |
| 003a "Contract for later specs": builder libraries | Adopted: the viewer neither depends on nor ships builder libraries. | NFR-26 |
| 003b NFR-20 test ("the viewer, when it exists") | Its viewer clause now applies; the test may be extended to read the viewer manifest and sources. | NFR-26, NFR-29 |
| 003a NFR-19 / traceability test | Expected list grows to FR-161 and NFR-29; scan includes viewer tests. | NFR-29 |
| 001 NFR-4 (anti-spoiler) | Applied to the viewer and to the debug scene. | FR-158, FR-159, FR-160 |

## Users
- **Developer / map author**: needs to see the dev map at real scale, reproduce any seed and round exactly, and inspect ids, owners and borders to find rendering bugs.
- **Reviewer (the user)**: needs reproducible screenshots of fixed scenes to accept or reject the look before the roadmap gate opens.
- **Spectator / predictor** (indirect, later): needs readable factions, visible coasts and sea zones, and borders that change only when ownership changes.

## User stories
- US-6. As a developer, I want to open the viewer with a seed and a round in the page address so that anyone can reproduce exactly the same scene.
- US-7. As a developer, I want to step between rounds instantly so that I can check, round by round, that colours and borders follow ownership.
- US-8. As a reviewer, I want sea zones, coasts and background drawn explicitly, faction borders strong, and borders between same-owner territories gone at far zoom and only faint when zoomed in, so that the map reads like a strategy map and never like a broken bitmap.
- US-9. As a developer, I want to pan and zoom smoothly on the real 2048 × 2048 map so that I can inspect small islands and straits.
- US-10. As a developer, I want the renderer to accept only a match state, never a seed, so that the later server can feed it revealed rounds without leaking future ones.

## Definitions
- Terms of specs 001 to 003b keep their meaning: **map package, id image, map unit, background, 4-adjacent, contact, piece, faction, faction order, land territory, sea zone, direct candidates, match state, round record, T** (number of rounds, 001 FR-42).
- **Viewer**: the browser application of this spec. **Rendering part**: the part of the viewer that draws a map package for a given owner per land territory and camera. **Debug scene**: the part of the viewer that reads the address parameters, computes the displayed state with the sim and drives the rendering part.
- **Displayed round (N)** and **displayed state**: the round shown and the match state at that round.
- **Screen pixel**: one CSS pixel of the page (independent of the device pixel ratio).
- **Scale**: screen pixels per map unit. **Fit scale**: the largest scale at which the whole id image is visible in the drawing area.
- **Fill class** of a map unit: `land` (value is a land territory id), `sea` (value is a sea zone id) or `outside` (value 0, or a position outside the id image).
- **Border class** of the edge between two 4-adjacent map units with values A ≠ B, at the displayed state:

  | Border class | A and B |
  |---|---|
  | `faction` | two land territories with different owners |
  | `territory` | two different land territories with the same owner |
  | `coast` | a land territory and a sea zone |
  | `sea-zone` | two different sea zones |
  | `outer` | a land territory and `outside` |
  | `shore` | a sea zone and `outside` |

  Edges between map units of equal value have no border. `outside`–`outside` has no border.
- **Territory line parameters** (named; final values are tuned from debug-scene screenshots in the plan/tasks phase, within these ranges):
  - `territoryFadeStart` (S0): the scale at and below which `territory` lines are invisible; 2 ≤ S0 ≤ 8 screen pixels per map unit.
  - `territoryFadeFull` (S1): the scale at and above which `territory` lines reach their maximum opacity; S0 < S1 ≤ 16.
  - `territoryMaxOpacity` (Amax): the maximum opacity of `territory` lines; 0.25 ≤ Amax ≤ 0.35.
  - `territoryDarken` (D): the factor applied to each 8-bit channel of the owner colour to get the `territory` line colour (channel c becomes ⌊c × D⌋); 0.5 ≤ D ≤ 0.8.
- **Territory line opacity** at scale s: Amax × smoothstep(S0, S1, s), where smoothstep(a, b, s) is 0 for s ≤ a, 1 for s ≥ b, and 3t² − 2t³ with t = (s − a) / (b − a) in between.
- **Address parameters**: the query parameters of the page address (`seed`, `round`, and the camera parameters `x`, `y`, `zoom`).
- **UI strings module**: the single module holding every user-visible text of the viewer (constitution rule 6). Names in presentation data are map data, not UI strings (003a NFR-18).

## Functional requirements

### Loading the map package
- FR-132: WHEN the viewer starts, THE SYSTEM SHALL load the committed dev map package (map, presentation data, id image) from the viewer's own origin, unchanged, and SHALL load no other map and contact no other origin.
- FR-133: WHEN the three artifacts are loaded, THE SYSTEM SHALL run map validation, the presentation check (003a FR-91) and the id image check (003a FR-109) on the decoded values before drawing anything; IF any of them reports an error or an artifact cannot be read or decoded, THEN THE SYSTEM SHALL draw no map and SHALL show a Spanish error message (UI strings module) with the number of errors and the `kind` of the first error.
- FR-134: THE SYSTEM SHALL read id image values exactly as stored: each pixel's three 8-bit channels decoded with the decode function of 003a FR-106, with no filtering, interpolation, mipmapping, colour-space conversion, gamma, premultiplied alpha or blending, both when decoding the file and when sampling it for drawing; value 0 means outside the map (003a "Contract for later specs").
- FR-135: IF the browser offers no graphics context able to draw the map, or its maximum texture size is smaller than W or H of the id image, THEN THE SYSTEM SHALL draw no map and SHALL show a Spanish error message naming the missing capability.

### Rendering
- FR-136: THE SYSTEM SHALL draw each map unit with the fill colour of its fill class: a land map unit in the colour of its territory's owner at the displayed state (FR-141); a sea map unit in the sea colour; an `outside` map unit, and any area of the drawing surface not covered by the id image, in the background colour. At every scale of 1 or more, each map unit SHALL be drawn as a solid square of its fill colour except where a border is drawn on it (FR-138); no colour is blended between map units.
- FR-137: THE SYSTEM SHALL decide fill class, fill colour and border class only from id values, map entry kinds and the owner per land territory of the displayed state; it SHALL never infer a border, the sea or the background from the colour, brightness or darkness of any pixel.
- FR-138: THE SYSTEM SHALL draw a border line along every edge between 4-adjacent map units of different values, according to its border class: `faction`, `coast`, `sea-zone`, `outer` and `shore` lines fully opaque in the colour of their class; `territory` lines in the owner's colour darkened by `territoryDarken`, with the territory line opacity (Definitions) at the current scale. It SHALL draw no line between map units of the same value. As a consequence, WHEN a faction absorbs another, the `faction` border between their territories SHALL become a `territory` line in the same frame in which those territories take the absorber's colour: at scales at or below `territoryFadeStart` it disappears in that frame; above it, it is drawn faint in that frame.
- FR-139: THE SYSTEM SHALL draw every border class with a width in screen pixels that is the same at every scale and every displayed round: `faction` and `outer` 2 screen pixels, `coast`, `sea-zone`, `shore` and `territory` 1 screen pixel, each within ± 0.5 screen pixel; the lines SHALL be continuous along a straight run of border edges (no gap at any scale of 1 or more).
- FR-140: THE SYSTEM SHALL keep fill colour and border class of every map unit independent of the camera: panning and zooming change only position and size on screen, never which colour or border class a map unit has. The only camera-dependent drawing property is the opacity of `territory` lines, which depends only on the scale (never on position, round or time) and does not decrease when the scale increases.

### Colours
- FR-141: THE SYSTEM SHALL give every faction one colour, fixed for the whole match (a territory absorbed at any round is drawn in the absorber's colour; no faction's colour changes between rounds): a faction's preferred colour (003a FR-88) when given, used exactly as given; otherwise a colour from the viewer palette assigned as follows, computed only from the map and the presentation data (never from seed, round, time or camera), identical on every run: going through the factions without a preferred colour in faction order, each takes (1) the first palette colour used by no faction already coloured and equal to no preferred colour of the map; else (2) the first palette colour used by none of its direct candidates at round 0 (002) already coloured and equal to no preferred colour of its direct candidates; IF no palette colour meets (2), THEN THE SYSTEM SHALL draw no map and show a Spanish error message naming the faction.
- FR-142: THE SYSTEM SHALL use a viewer palette of at least 12 colours, pairwise distinct, in a fixed order, each also distinct from the sea colour, the background colour and every border class colour; and a sea colour, a background colour and border class colours that are pairwise distinct. The exact values are proposed in the plan and confirmed by the user in the screenshot review (NFR-27).
- FR-143: THE SYSTEM SHALL draw all sea zones in the same sea colour, distinguished from each other only by `sea-zone` borders, and SHALL draw background (including lakes and other land, 003b FR-115, FR-116) in the background colour, which is not a water colour; no fill or border colour is black or near-black merely because it is a border or the sea.

### Camera
- FR-144: WHEN the scene opens without valid camera address parameters, THE SYSTEM SHALL show the whole id image at fit scale, centred in the drawing area.
- FR-145: WHILE the user drags with the primary pointer button on the drawing area, THE SYSTEM SHALL pan so that the map point under the pointer at the start of the drag stays under the pointer (within 1 screen pixel).
- FR-146: WHEN the user turns the mouse wheel over the drawing area, THE SYSTEM SHALL zoom by a fixed factor per wheel step (in or out by direction) about the pointer, so that the map point under the pointer stays under it (within 1 screen pixel), limited to scales from the fit scale to 32 screen pixels per map unit; a step beyond a limit stops at the limit.
- FR-147: THE SYSTEM SHALL keep the map point at the centre of the drawing area inside the id image rectangle after every pan, zoom and resize.
- FR-148: WHEN the drawing area is resized, THE SYSTEM SHALL keep the map point at its centre and the scale (raised to the new fit scale if it is now below it); WHEN the user activates the reset control, THE SYSTEM SHALL return to the view of FR-144.
- FR-149: THE SYSTEM SHALL leave the camera unchanged when the displayed round changes.

### Debug scene: parameters and state
- FR-150: THE SYSTEM SHALL read from the address parameters: `seed`, a text of decimal digits only whose value is an integer from 0 to 4,294,967,295 (001 FR-31), default 1 when absent; `round`, a text of decimal digits only whose value is an integer from 0 to T, default 0 when absent; and optionally `x`, `y` (map unit coordinates of the view centre, decimal numbers) and `zoom` (scale, decimal number), used only when all three are present and valid, clamped to the limits of FR-146 and FR-147. Leading signs, spaces, exponents, fractions in `seed` or `round`, and repeated parameters are invalid.
- FR-151: IF `seed` or `round` is invalid, or `round` is greater than T, THEN THE SYSTEM SHALL show a Spanish error message naming the parameter and its text, display round 0 (the initial state, which does not depend on the seed) and SHALL NOT clamp or correct the value; IF any camera parameter is invalid, THEN it SHALL show a message naming it and use the view of FR-144.
- FR-152: THE SYSTEM SHALL obtain the displayed state from the sim as the state at round N for the map and seed (001 FR-43), the owner of each land territory with the sim's owner lookup, T with the sim's round count (001 FR-42) and, for N ≥ 1, the record of round N from the records of rounds 1..N (001 FR-44); IF the sim returns an error, THEN THE SYSTEM SHALL draw no map and show a Spanish error message with the error `kind`.
- FR-153: THE SYSTEM SHALL keep the address parameters equal to the displayed scene: after every round change it SHALL set `round` (and keep `seed`), and after every camera change it SHALL set `x`, `y`, `zoom`, without reloading the page and without adding a browser history entry, so that copying the address reproduces the scene.

### Debug scene: round stepping
- FR-154: THE SYSTEM SHALL provide controls to go to the first round (0), the previous round, the next round, the last round (T) and to a round typed by the user, and the keyboard shortcuts Left arrow (previous), Right arrow (next), Home (first) and End (last) while focus is not in a text field. Previous and first are disabled at round 0; next and last are disabled at round T. IF a typed round is not a valid round from 0 to T, THEN THE SYSTEM SHALL show a Spanish message and keep the displayed round.
- FR-155: WHEN the displayed round changes, THE SYSTEM SHALL draw the next frame entirely with the new displayed state (fills, borders, panel): no animation, transition, fade, intermediate state or frame mixing old and new states.

### Debug scene: panel and inspection
- FR-156: THE SYSTEM SHALL show a debug panel, labelled as a debug scene, with: the seed; N and T; the number of living factions at N; for N ≥ 1, the record of round N (eliminated faction name, absorbing faction name, number of territories transferred); and a faction legend in faction order with, for each faction, its colour swatch, id, name, territory count at N, and whether it is alive or eliminated at N. The panel shows no data about any round after N except T.
- FR-157: WHILE the pointer is over the drawing area, THE SYSTEM SHALL show in the panel the map unit coordinates under the pointer, its value, its fill class, the entry name (presentation data) and, for land, its owner's name at N; for `outside` it shows a Spanish text meaning "outside the map". Map labels drawn on the map are not part of this spec (005).
- FR-158: THE SYSTEM SHALL show, in the debug panel, the time from page start to the first drawn frame, the time of the last round change (request to drawn frame) and the median and 95th percentile frame time over the last 120 frames, in milliseconds, so that NFR-24 can be measured.

### Anti-spoiler
- FR-159: THE SYSTEM SHALL make the rendering part take as input only the map package, the owner per land territory to display and the camera: it SHALL take no seed, round count or round record, SHALL compute no round, and SHALL not depend on the sim package; only the debug scene uses the sim.
- FR-160: THE SYSTEM SHALL make the debug scene request from the sim only the state and records of rounds 0..N for the displayed round N that the user asked for, and T: it SHALL NOT compute, prefetch, cache or hold any state or record of a round after N (stepping to N + 1 computes it only when requested).
- FR-161: THE SYSTEM SHALL treat the debug scene as a developer tool for locally chosen seeds, not a way to watch a match in progress: it is labelled as a debug scene (FR-156), and the seed it reads from the address is never sent anywhere. Rule for later specs (step 3): a client watching a match in progress receives displayed states from the server, never the seed (001 NFR-4), and the debug scene SHALL not be offered for a match in progress; the server spec SHALL exclude the debug scene from production builds (decision Q5). In this spec, the debug scene is the viewer's only scene and stays in every build.

## Non-functional requirements
- NFR-24 (Performance at real scale): on the dev map (2048 × 2048, 70 land territories, 17 sea zones), on the reference machine and browser (the user's Windows 11 development PC with current Chrome or Edge; Firefox supported but not measured; decision Q3), with a 1920 × 1080 drawing area: time from page start to first drawn frame at most 2,000 ms (served by the local development server); median frame time at most 16.7 ms and 95th percentile at most 33.3 ms during continuous panning and zooming; a round change drawn within 50 ms of the request (FR-158 measurements, recorded in the pull request). The id image is decoded, checked and sent to the graphics device once per load; a round change updates only the per-entry owner colours, verified by a test on the viewer's state update (its output for a round change contains only per-entry data, never pixel data).
- NFR-25 (Viewer logic purity): address parsing, colour assignment, border classification, camera mathematics (screen to map point, zoom about a point, limits) and round navigation are pure, deterministic functions with no DOM, graphics, clock or system randomness, tested with the existing test runner without a browser. Clock reads are allowed only for the measurements of FR-158. Verified by tests of those functions and by a source scan of their sources (as 001 NFR-1).
- NFR-26 (Dependencies): the viewer's only third-party runtime/build dependencies are the graphics library and the development server / bundler approved by the user from the plan's justification, plus the type declarations of the graphics library (`@types/three`, development dependency of the viewer only, with the type-only and development packages it brings, decision Q6; the same kind of exception as the 003b build tooling); each pinned to an exact version in the manifest and the lockfile, with a licence of the 003b NFR-20 list, re-checked at install. The viewer neither depends on nor imports the builder's libraries; the shared and sim packages keep no third-party dependency. Verified by a manifest and import test (extending the 003b NFR-20 test as allowed by NFR-29).
- NFR-27 (Visual verification): no task that changes what is drawn is done without screenshots of the debug scene, taken from addresses with fixed `seed`, `round`, `x`, `y`, `zoom`, reviewed and accepted by the user. The review set for this spec: seed 1 at rounds 0, 1, 2 and T, each at fit scale; at round 0 and at a round where a faction absorbed a neighbour, zoomed views (scale at least 8) of a land border between two factions, a former border inside the absorber, the Balearic Islands, the Strait of Messina, a coast with a `sea-zone` border, and a lake (background); and, for `territory` lines, the same area inside one faction (including a former faction border after an absorption) at a far zoom (scale at or below `territoryFadeStart`: no line visible), at a scale between `territoryFadeStart` and `territoryFadeFull` (partly faded), and at a near zoom (32, the maximum scale: line at `territoryMaxOpacity`). The territory line parameter values are confirmed from these screenshots. Each screenshot is listed with its address in the pull request.
- NFR-28 (Language): code identifiers, comments and docs in English; every user-visible text of the viewer comes from the UI strings module and is Spanish; verified by a test that the module's texts are non-empty and by a source scan that viewer sources other than that module and tests contain no user-visible text literal (rule for the scan defined in the plan). Error `kind` values shown in messages are English identifiers (data), as in 001-003b.
- NFR-29 (No regression and traceability): 001-003b tests pass with the meaning of their assertions; golden files and the committed dev map package are byte-identical; the shared and sim export lists and behaviour are unchanged. The only earlier test files that may be edited are the traceability test (expected list extended to FR-161 and NFR-29, scan extended to the viewer's tests, its pinned counts updated) and the 003b NFR-20 manifest test (its viewer clause, NFR-26).

## Edge cases
- Quadripoint `A B / C D` with A and D the same owner but B and C different owners: borders are drawn along the 4-adjacent edges only (A–B, A–C, B–D, C–D) by their classes; the corner A–D gets no line of its own (FR-138).
- Two territories of the same owner at fit scale (about 0.5 screen pixels per map unit, below `territoryFadeStart`): no line between them; they read as one faction area.
- At the maximum scale (32 screen pixels per map unit, above `territoryFadeFull`): `territory` lines are at exactly `territoryMaxOpacity`, 1 screen pixel wide (FR-139), so each map unit is a 32-pixel square and the faint line covers only its edge; zooming further is not possible (FR-146), so the opacity never exceeds Amax.
- Scale exactly `territoryFadeStart`: opacity 0; exactly `territoryFadeFull`: opacity Amax (Definitions).
- A preferred colour of black (`#000000`): its `territory` line colour equals the fill (darkening 0 stays 0), so the line is invisible; accepted.
- A `territory` line next to a `faction` line at a T-junction: each edge is drawn by its own class; the `faction` line is opaque and is not lightened by the faint line.
- A land territory with several pieces (Balearic Islands): every piece in the owner's colour, each piece's coast drawn; no line joins the pieces.
- A one-pixel piece or one-pixel strait at fit scale (about 0.5 screen pixels per map unit on a 1080-pixel-high area): it may not be visible, and minification without mipmaps can shimmer while panning (FR-134 forbids filtering). Accepted; at scale 1 or more every map unit is visible.
- Lakes and gaps that 003b turned into background: drawn in the background colour with `outer` borders, not as water (FR-143). Accepted by the user in 003b.
- Sea touching other land (e.g. North African coast): `shore` border between sea and background.
- A sea zone touching the image edge: the edge counts as `outside`, so a `shore` line is drawn there; a land territory touching the image edge gets an `outer` line.
- A preferred colour equal to the sea or background colour: used as given (003a contract); territories stay distinguishable by `coast` and `outer` borders. Two equal preferred colours never reach the viewer (`duplicate-color`, FR-133).
- More factions than palette colours, or a faction whose direct candidates already use every palette colour: assignment step (2) or the FR-141 error.
- Round N = T: one faction owns every land territory; no `faction` border remains; only `coast`, `sea-zone`, `shore` and `outer` lines, plus faint `territory` lines when zoomed in above `territoryFadeStart`.
- Round change from N to N + 1: only territories in the record of round N + 1 change colour; every `faction` border between the eliminated faction and the absorber becomes a `territory` line (invisible at far zoom, faint when zoomed in); borders between the eliminated faction's territories and third factions remain (now as absorber–third borders).
- Jumping from round 0 to T directly: the sim replays rounds 1..T to produce state T; nothing after T exists.
- `?seed=12abc`, `?seed=-1`, `?seed=1e3`, `?seed=4294967296`, `?round=1.5`, `?round=99` (above T), `?round=` (empty), `?seed=1&seed=2`: error message naming the parameter, round 0 displayed, no clamping (FR-151).
- `?zoom=1000`: clamped to 32 (FR-150); `?x=abc`: camera message and fit view.
- Window resized very small (e.g. 200 × 150): fit scale shrinks; borders keep their screen width; nothing overflows into an error.
- Device pixel ratio 2: border widths still in screen (CSS) pixels (FR-139).
- Keyboard Right arrow while typing in the round field: the field gets the key; the round does not change (FR-154).
- Id image fails to decode, or decodes with altered values (e.g. a browser applying colour conversion): unknown ids or missing adjacency make the id image check fail, so nothing is drawn (FR-133).
- Browser without the required graphics capability, or maximum texture size 1024: FR-135 message, no map.

## Out of scope
- Labels of any kind on the map, label layout, and every transition or animation between rounds (spec 005).
- Server, predictions, Discord bot, accounts; revealing rounds progressively from a server.
- Loading any map other than the dev map; map selection; importers; editor.
- 3D, relief, terrain, textures, lighting, shading of sea depth.
- Touch and pinch gestures, keyboard panning, mobile layouts.
- Hover highlighting of territories or factions, selection, tooltips on the map.
- Automated browser screenshots or pixel-diff tests of the graphics output (would need a new dependency).
- Internationalisation beyond keeping strings in one module.
- Changes to map format, presentation data, id image format, map validation, `MatchState`, `RoundRecord`, the sim or the shared exports.

## Done criteria
- Every id FR-132 to FR-161 and NFR-24 to NFR-29 has at least one automated test referencing it in its title; the traceability check expects FR-1..FR-161 and NFR-1..NFR-29 minus FR-6/FR-25 and scans the viewer's tests (NFR-29). Requirements verified mainly by screenshots or measurements (FR-136, FR-139, FR-143, NFR-24, NFR-27) are traced by tests of their pure part (fill and border classes, width settings, colour distinctness, measurement statistics, the review-set address list).
- Pure-function tests cover: address parsing (every edge case above), colour assignment (preferred colours, both steps, error, determinism, independence from seed and round), border classification (every class, quadripoint, image edge, same-owner `territory`, before/after an absorption), territory line opacity and colour (0 at and below S0, Amax at and above S1 and at scale 32, smoothstep values in between, non-decreasing in scale, parameters inside their ranges, darkened owner colour), camera mathematics (fit, zoom about a point, limits, resize, centre clamp), round navigation (bounds, disabled controls, invalid typed round), and the anti-spoiler call pattern of FR-160 (the rounds requested from an injected sim are exactly those asked for).
- The viewer runs with `npm run dev` and builds with `npm run build`; it loads the dev map and shows the debug scene.
- NFR-24 measurements recorded in the pull request on the reference machine; NFR-27 screenshot set reviewed and accepted by the user, including the palette, sea, background and border colours (FR-142) and the territory line parameter values.
- Every dependency approved by the user (NFR-26); type check and test suite pass locally and in CI; `MEMORY.md` updated.

## Open questions
- None open.

- Resolved (user decisions, 2026-10-15):
  - **Q1, borders between territories of the same owner: a faint line that depends on distance** (FR-138, FR-139, FR-140, Definitions "Territory line parameters"). It is invisible at far zoom and fades in with zoom by a smoothstep on the scale, up to a faint maximum opacity of 25-35%, in the owner colour darkened. Why: at far zoom the map must read as factions, and an absorbed border must disappear in the same frame as the absorption, which keeps the original rule (MEMORY: "borders vanish when both sides share an owner"). Zoomed in, provinces must stay readable inside a faction, as in EU4. Only the behaviour and ranges are specified; the final values of `territoryFadeStart`, `territoryFadeFull`, `territoryMaxOpacity` and `territoryDarken` are tuned from debug-scene screenshots in the plan/tasks phase (NFR-27). Discarded: no line at all (provinces unreadable when zoomed in) and a constant faint line (clutters the far view and blurs the absorption).
  - **Q2, border widths: constant in screen pixels at every zoom** (FR-139): 2 px `faction`/`outer`, 1 px `coast`/`sea-zone`/`shore`/`territory`. Why: lines stay readable at fit scale and do not swallow small territories at near zoom. Discarded: widths that grow with zoom.
  - **Q3, reference machine and thresholds** (NFR-24): the user's Windows 11 development PC with current Chrome or Edge (Firefox supported, not measured); first frame within 2 s, median frame time 16.7 ms or less, 95th percentile 33.3 ms or less, round change within 50 ms. Why: one known machine makes the figures reproducible; 60 fps median is the target for smooth panning.
  - **Q4, dependencies: Three.js and Vite approved in principle** (Compatibility, NFR-26). The plan still proposes exact versions, licences and justification for the user's confirmation before they are pinned (exact version in the manifest and lockfile). Why: they are the stack named by the constitution; pinning keeps builds reproducible. Discarded: raw WebGL with no graphics library (more own code for no gain at this stage, and 3D later is a camera/material change in Three.js).
  - **Q5, debug scene defaults** (FR-150, FR-157, FR-158, FR-161, NFR-27): seed 1 when absent; pointer readout and timing figures included; screenshots attached to the pull request, not committed; the debug scene is excluded from production builds only when the server spec arrives. Why: until a server exists there is no match in progress to spoil, and the timings and readout are what make NFR-24 and visual bugs checkable. Discarded: committing screenshots (repository size) and excluding the debug scene now (it is the only scene in this spec).
  - **Q6, type declarations of the graphics library (amendment of NFR-26, user decision 2026-10-15):** `@types/three` is allowed as an exact-pinned development dependency of the viewer only, together with the type-only and development packages it brings (checked against the 003b NFR-20 licence list at install). Why: Three.js ships no TypeScript types, and the viewer's tests and type check (strict mode) need them; this mirrors the 003b exception for build tooling. Discarded: an own minimal `three.d.ts` (more own code for the classes and constants used, and it drifts from the library).
