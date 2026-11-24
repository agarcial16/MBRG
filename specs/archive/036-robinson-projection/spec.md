# Spec 036 — Robinson projection for the world map
Status: implemented (approved 2026-11-24; amended during implementation, notes marked "implementation note")
Tier: Light SDD (`tools/build-map` and map content; no change to `packages/*`, the server or the viewer, no map-format change). Depends on 003b (builder, FR-114), 028 (importer, FR-600) and the predefined world map (`maps/world-countries`, PR #91). Ids: FR-697 to FR-704, NFR-180 to NFR-182 (highest in use: FR-696, NFR-179).
Approval (2026-11-24, user, quoted literally, after being offered Robinson or Equal Earth): "robinson".

## Context and goal
User feedback on `maps/world-countries`: "la proyeccion que tiene es un poco rara para jugarlo en 2d". The map is drawn in the 003b builder's Lambert azimuthal equal-area projection (the planet as a disk in the square image, countries bent toward the rim). It is built by the **builder** (`tools/build-map/data/world-countries/`, data only), not by the importer. Goal: a Robinson world (the familiar flat world map) in the same square image, with no change to which factions, territories, sea zones, ids or names exist.

## Functional requirements
- FR-697: THE SYSTEM SHALL provide the Robinson projection on the unit sphere as own, pure code: the standard table of 19 rows (every 5° of latitude, 0 to 90) of the length factor PLEN and the distance factor PDFE, interpolated by a cubic (Catmull-Rom) through the rows (odd in latitude for y, even for the length factor, ends clamped), `x = 0.8487 · PLEN(lat) · lon`, `y = 1.3523 · PDFE(lat)`, longitude and latitude in radians, central meridian at longitude 0, x east, y north. At every table row the value is the table value exactly.
- FR-698: THE importer curation SHALL accept `params.projection: "robinson"` besides `laea` and `equal-earth`; WITH `robinson` the importer SHALL apply exactly the rules FR-600 gives `equal-earth` (central meridian 0 on the main map, longitudes wrapped as `lon - lon0`, antimeridian-edge refusal, the same square frame rule, never `selection-too-wide`).
- FR-699: THE builder `params` input SHALL accept an optional `projection` (`laea` or `robinson`, default `laea`); WITH `robinson` the builder SHALL project with FR-697 about the central meridian 0 (no wrapping: the source longitudes lie in -180..180), frame and rasterize exactly as FR-114/FR-115, and project the sea seeds the same way. A `projection` of any other value SHALL be an `invalid-input`.
- FR-700: WHEN a builder input or an importer curation does not name a projection (or names `laea` / `equal-earth`), THE SYSTEM SHALL produce exactly the bytes it produced before this spec: every committed map and golden other than `maps/world-countries` stays byte-identical.
- FR-701: THE committed `maps/world-countries` SHALL be rebuilt from its data with `projection: "robinson"`; its 193 factions and 193 land territories (ids, owners, order) and the ids and names of its 7 sea zones SHALL stay the same. Implementation note (measured): (a) the width is 4352, not 4096 (at 4096 the Maldives rasterize to 0 px under Robinson); (b) one sea zone is added, `Océano Pacífico Occidental` (last seed, id 201), because a flat map cuts the Pacific at 180 degrees and one Pacific seed left the western Pacific to the Indian and Arctic zones; `presentation.json` differs only by that entry; it SHALL pass map validation, the presentation check and the id-image check (contact adjacency, FR-108).
- FR-702: THE data README of the world map SHALL state the projection, the frame (a Robinson world of about 2:1 in a square image, the rest sea), the measured micro-country pixel counts under it, and the list of adjacency pairs that differ from the previous (Lambert) package.
- FR-703: THE test suite SHALL replace the Lambert-specific world-map checks (planet-disk corners, frame covers the sphere) with Robinson ones (the four image corners and the centre of each edge are sea; the land spans the full width inside the margin and a band of rows around the middle).
- FR-704: WHEN the world map is rebuilt twice from the committed inputs, THE SYSTEM SHALL write byte-identical files, equal to the committed ones.

## Non-functional requirements
- NFR-180: no new dependency; the Robinson code imports nothing.
- NFR-181: the projection and the builder stay deterministic (no clock, randomness or I/O).
- NFR-182: the committed `ids.png` stays at most 2 MB and `map.json` + `presentation.json` at most 500 KB, as the world-map tests state.

## Edge cases
- The poles are lines (Robinson has flat poles): Antarctica as background land spans the bottom of the frame; the sea seeds of the world are re-measured so every zone keeps its body of water.
- A feature crossing the antimeridian in the source is already split at 180 in Natural Earth; the builder does not wrap.
- A country that rasterizes to 0 px at the chosen width is a failure to decide (see Open questions), never silently dropped.

## Out of scope
Non-square images; any change to the viewer, shared, sim, protocol, server; other projections; changing the faction set, merges (Vatican, Monaco) or omissions (Nauru, Tuvalu); re-running the world map through the importer; ocean tiles for this map.

## Done criteria
`npm test` and `npm run typecheck` green, CI green; `maps/world-countries` is Robinson, valid, same ids and names; before/after preview PNGs of the whole map; spec archived with `Status: implemented`, `MEMORY.md` and `docs/board.md` updated.

## Open questions
- Decided: the builder, not the importer, builds the world map, so Robinson is added to both (FR-698, FR-699); the builder gains an optional member only, no format change.
