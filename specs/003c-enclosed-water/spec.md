# Spec 003c — Enclosed water becomes sea
Status: draft

## Context and goal
Spec 003b turns water that no sea zone seed can reach (lakes, lagoons, estuary pockets, gaps between provinces) into background (FR-116). The viewer (spec 004) draws background as "outside the map", so these pockets show up as holes inside the land. On the committed dev map there are 99 such pockets surrounded only by land (about 790 pixels) plus some that touch both land and sea. The user wants them to be sea.

This spec changes the builder so that no water pixel is ever background, rebuilds the dev map, and records the consequences for adjacency.

Why: the pockets are water on the real map; they read as errors on screen and in the pointer readout ("fuera del mapa").

## Depends on
- Spec 003b (builder, dev map), amended here: FR-116, FR-117, the edge case about an island whose surrounding water reaches no seed, FR-124 (report) and the committed `maps/dev`.
- Specs 001, 002 and 003a unchanged. Spec 004 is paused after T7 and resumes on top of this spec (its NFR-29 dev map hashes and its traceability range are updated then).

## Compatibility, "ask first" items and numbering
- The map format, `MatchState` and the sim are unchanged. The content of `maps/dev` changes (user decision 2026-10-16: separate spec, now).
- New ids continue the sequence: FR-162 to FR-166, NFR-30 and NFR-31.
- User decisions (2026-10-16): every pocket is assigned to the **nearest sea zone in a straight line**; the work is a separate spec before 004 continues.

## Users
- The developer and the player who watch the debug scene and later the real viewer.

## User stories
- US-1. As a viewer user, I want enclosed water to be drawn and reported as sea, so that no hole labelled "outside the map" appears inside the land.
- US-2. As the developer, I want the rebuild to report how much enclosed water was joined and to which zones, so that the effect on adjacency can be reviewed.

## Definitions
- **Water pixel**: a pixel that the rasterization (003b FR-115) classifies as water: no land or other-land polygon contains its centre.
- **Enclosed water**: a 4-connected set of water pixels that no sea zone seed reaches through water (003b FR-116). Before this spec these pixels became background.
- **Distance between a pixel and a zone**: the smallest squared Euclidean distance between the pixel centre and the centre of any pixel already assigned to that zone by the seed search.

## Functional requirements
- FR-162: WHEN the seed search of 003b FR-116 has assigned the reachable water, THE SYSTEM SHALL assign every enclosed water set, as a whole, to the sea zone that has the smallest distance to any pixel of the set (squared Euclidean distance between pixel centres, minimum over all pairs); ties go to the zone of the seed listed first. No water pixel SHALL be background after this step.
- FR-163: THE SYSTEM SHALL keep a piece of a sea zone that touches no other sea zone and has fewer pixels than S (003b FR-117): the loop of FR-117 SHALL NOT reassign it and SHALL NOT turn it into background. Pieces of a sea zone that touch another sea zone, and every land piece, keep the rule of FR-117 unchanged.
- FR-164: THE SYSTEM SHALL leave no pixel that the rasterization classified as water with the value 0 in the final id image; background SHALL remain only where other land, excluded land or nothing was drawn.
- FR-165: THE SYSTEM SHALL add to the build report (003b FR-124) the number of enclosed water sets and the number of their pixels, and, for each zone that received at least one set, the zone's map id and the number of sets and pixels it received (ids, like the other report lines of 003b FR-124, not names).
- FR-166: THE SYSTEM SHALL rebuild and commit `maps/dev` with the real command so that it keeps the same factions, land territories, sea zones, ids, names, owners and order as before, and so that every link that changes is a link between a land territory and a sea zone created by contact with joined enclosed water (the build or a one-off comparison lists every added or removed link for review).

## Non-functional requirements
- NFR-30 (Determinism and compatibility): the build stays deterministic (003b NFR-14). A build whose rasterization has no enclosed water SHALL give byte-identical output to the 003b builder, so the 003b fixtures that contain no enclosed water keep their results unchanged.
- NFR-31 (Traceability): every id of this spec appears in at least one test title (001 NFR-7 rule, extended by the traceability range); the 003b, 003a, 002 and 001 tests keep their meaning, and the only changes to them are the assertions whose subject is exactly the rule amended here (lakes and unreachable water becoming background, the disconnected island case, the committed dev map bytes and the report format).

## Edge cases
- Enclosed water touching only land (a lake or lagoon inside a territory): becomes part of the nearest sea zone; the land territories around it gain a link with that zone (003a FR-108). On the committed map, the territories involved are already coastal (checked while writing this spec; to be re-verified by FR-166).
- Enclosed water touching land and other land only, far from any zone: still goes to the nearest zone by distance, however far.
- A single enclosed pixel (a 1-pixel gap between provinces): joins the nearest zone as a 1-pixel piece, which FR-163 keeps. It draws as a 1-pixel sea speck; it is accepted.
- Equal distances to two zones: the zone of the seed listed first.
- An island whose surrounding water reaches no seed (003b edge case): the water now joins the nearest zone, so the island is linked and the build no longer fails with `disconnected-map` for that reason. Other causes of `disconnected-map` are unchanged.
- No enclosed water at all: nothing changes (NFR-30).
- Other land (for example Britain and Africa, which are polygons) is not water and stays background.

## Out of scope
- Treating large lakes as their own territory or as a different kind of entry (a later spec may).
- Changing seeds, projection, frame, grouping, the value of S, the preview image content or the map format.
- Any viewer change.

## Done criteria
- All FR and NFR above are traced by passing tests; `npm test` and `npm run typecheck` are green, also with `CI=1`.
- The 003b mutation-proof habit is followed for FR-162 (change the tie rule, the distance or the whole-set rule and a test fails) and FR-163.
- The committed `maps/dev` is rebuilt by the real command; the report lists enclosed sets and the link differences; a preview or screenshots of the debug scene around La Rochelle, Camargue and Hamburg are accepted by the user.
- `MEMORY.md` updated.

## Open questions
- None. (Resolved with the user: nearest zone in a straight line; separate spec; done before spec 004 continues.)
