# Spec 035 — Ocean tiles (generic sea splitting in the importer)
Status: draft
Tier: Light SDD (the map importer, `tools/build-map`; no change to `packages/sim`, `packages/shared`, `packages/protocol`, the server or the viewer; the one decision that could change the map format is OQ7, recommended NO, and is "ask first" if the user picks it). Depends on 028 (importer: curation `params`, sea zones FR-598, enclosed water and lakes FR-603, minimum piece FR-604, exclave bridges FR-602, numbering FR-605, report FR-609, viewer-limits warnings FR-607), 002 (sea zones in the sim: FR-75 to FR-78), 003a (presentation names FR-86/FR-87, contact adjacency FR-108) and 004 (viewer limits, sea-zone borders). Ids: FR-670 to FR-692, NFR-175 to NFR-179 (highest in use on any branch: FR-666, NFR-170).
Stacked on PR #94 (spec 028, not merged yet): this branch and its draft PR target `feat/028-map-importer`. 028 is archived and says an unknown curation member fails with `invalid-curation` (FR-592): this spec adds one optional member to `params`, so it amends FR-600, FR-605 and FR-609 of 028 only through the ids below.

## Context and goal
User request (2026-11-24, quoted): "en general habría que partir los oceanos en bastantes "tiles" como hace EU4 por ejemplo para que las distancias no sean tan largas pero esto lo deberíamos de hacer genérico para cualquier mapa no solo para este".

Today a sea zone is one entry per curation seed (or sea unit). The sim treats a sea zone as a passable link: the absorption candidates of a faction are the land-neighbour factions **plus every living faction touching a sea zone that the faction touches**, in one group; only when that group is empty does the reach widen, **one sea zone per hop** (002 FR-75 to FR-77). A zone is therefore as long as a hop and as big as a rivalry. Measured on the hand-run outputs (2026-11-24):

| map (output) | sea zones | what one zone does |
|---|---|---|
| world-1815-5 (4,096 px, 8.59 km/px, 301 factions) | 14 | Índico: 62 land territories of 62 factions touch it (Red Sea to south Australia, 8,800 × 11,600 km bounding box); Mar de la China Meridional 40 factions; Atlántico Sur 12 factions (West Africa to Patagonia); Pacífico Norte Oeste (Russia's Pacific coast to northern Australia, 8,175 × 19,236 km). Each is one clique of "direct rivals", and the viewer's colour assignment treats the owners around one zone as direct candidates of each other (004 FR-141), which is part of why the map reports `palette-exhausted` |
| spain-municipios-4 (4,096 px, 0.29 km/px, 52 factions, 8,211 land territories) | 8 | Golfo de Cádiz: 1,180 km bounding box (Huelva to Almería plus the Canary inset), 98 land territories on it; with municipalities as factions it would be one clique of 98 |

Two further measurements shape the design. (1) On the world map only about 345 million km² of the 1,093 million km² of "sea" lie within 1,500 km of land; 531 million lie beyond 3,000 km: the square frame is mostly empty water (the Equal Earth outline fills about half of it). A tiler that spends tiles evenly over all water would spend most of them on nothing. (2) The sea passes of 028 flow by 4-connected steps, so zone borders are diamonds and diagonals (see the world seazones preview), not what a human draws.

**Goal:** an optional, generic importer step that splits the water of any map into many sea tiles of a controlled size (small near coasts, larger in the open sea, none wasted in empty frame), deterministic, derived from the raster only, with tile adjacency exactly pixel contact, so that factions on different continents stop being direct neighbours through one giant zone and a sea hop is a comparable distance anywhere. No map-format, sim, server or viewer change is required (the sim already treats `kind: "sea"` entries as ownerless links: `candidates.ts` reads sea entries only through `isSeaZone` and the neighbour graph).

## Users
- **Map author / operator**: asks for tiling with one line in the curation and reviews tile counts in the report and the preview.
- **Spectator / predictor** (indirect): sees more plausible rivalries (neighbours across a sea are near) and a faction colouring that exhausts the palette less.

## User stories
- US-1. As a map author, I want to switch tiling on with one line and no tuning, so that any map (world, region, Spain by municipalities) gets sensible sea tiles.
- US-2. As a map author, I want to tune the tile size, or keep one named sea whole, so that straits and small seas look as I want.
- US-3. As an operator, I want an unchanged curation (no tiling member) to give byte-identical packages, so that a listed map never changes under me.
- US-4. As a spectator, I want two factions to be direct rivals across water only when their coasts are close, so that a match does not end with a faction across an ocean absorbing Asia.

## Definitions
- **Basin**: a sea zone as 028 builds it (a curation seed zone or a sea territory's units, with enclosed sets and inset water joined by FR-598, FR-601, FR-603), before tiling. **Tile**: one sea entry produced by splitting a basin.
- **Basin piece**: a 4-connected set of water pixels of one basin (an inset rectangle's water, an enclosed set joined to the zone, the main water). A basin may have several.
- **Coast distance** of a water pixel: the distance between its centre and the centre of the nearest pixel that is not water (land, other land, a lake or background). It is measured in kilometres at the map's pixel size (028 FR-609).
- **Spacing** at a pixel: `tileKm` where coast distance ≤ `coastBandKm`, `openTileKm` where it is larger and ≤ `reachKm`; undefined (no tile is seeded) beyond `reachKm`.
- **Empty frame**: water beyond `reachKm` of any land: the corners of a square frame and the poles of a world map.

## Functional requirements
### Opt-in, parameters, defaults
- FR-670: THE importer SHALL accept an optional `params.tiling` object in the curation (028 FR-600) with these optional members: `tileKm` (coast spacing), `openTileKm` (open-sea spacing), `coastBandKm`, `reachKm` (numbers > 0, at most the frame side in km), `maxTiles` (integer 1 to 100,000, default 10,000) and `zones` (an object from a basin name to a number ≥ 0: that basin's `tileKm`, and `0` meaning "keep this basin as one entry"). A basin name is a `seas[i].name` or the name of a sea territory (028 FR-595/FR-596). Unknown members, wrong types, a spacing below 3 pixels at the map's pixel size, or a `zones` key that names no basin SHALL fail with `invalid-curation` (member path) or `unknown-sea` (name). `"tiling": {}` is valid and turns tiling on with every default.
- FR-671: WHEN `params.tiling` is present and a spacing member is absent, THE importer SHALL derive it from the frame side in kilometres F (pixel side in km × `side`, 028 FR-609): `tileKm` = F / 60 rounded to a whole number of kilometres (at least 3 pixels), `openTileKm` = 2 × `tileKm`, `coastBandKm` = `tileKm`, `reachKm` = 6 × `tileKm`. The values in force SHALL be printed (FR-687), also when the author gave them. Estimated result at these defaults (to be measured by the prototype, NFR-177): about 600 sea tiles on world-1815-5 (tile 586 km) and about 600 on spain-municipios-4 (tile 20 km).
- FR-672: WHERE `params.tiling` is absent, THE importer SHALL produce exactly the package, report and errors of 028 (byte for byte: the dev map equivalence FR-611 and the sample FR-612 of 028 pass unedited, NFR-132).

### Where it runs
- FR-673: THE importer SHALL run tiling after the water pass of 028 (zones assigned, enclosed sets joined or made lakes) and before the minimum-piece check and cleanup (028 FR-604) and the exclave bridges (028 FR-602). It SHALL change only the pixels of basins; land, other land, lakes and background are never touched. The 028 check "a sea territory has no piece of S pixels" SHALL still run on the basins as 028 FR-604 says, before tiling.

### Splitting a basin
- FR-674 (seeding): FOR each basin piece, THE importer SHALL place seeds on its water pixels so that no two seeds of one piece are closer than the spacing at the later of the two, trying candidate pixels in increasing coast distance and then row-major order, and SHALL place no seed beyond `reachKm`. A piece with no pixel within reach SHALL get exactly one seed, on its pixel nearest to the piece's centroid (ties row-major). A basin with `zones[name] = 0`, or whose total pixels do not exceed one tile of its own spacing, SHALL get one tile, equal to the basin.
- FR-675 (partition): THE importer SHALL give every water pixel of a basin piece to the tile of the seed nearest to it by distance through the piece's own water (a tile never reaches across land or into another basin), ties to the seed first in seed order. The distance SHALL be Euclidean-like, not a count of 4-connected steps: on open water between two seeds the border SHALL be the perpendicular bisector within 1 pixel, so borders show no horizontal, vertical or 45° bias.
- FR-676: IF a tile has fewer pixels than `max(S, 0.1 × spacing²)` (S = `minPieceSize`, spacing in pixels at its seed), THEN THE importer SHALL merge it into the tile of the same piece that shares the longest border with it (ties to the lower tile order). A piece smaller than that threshold in all SHALL keep its single tile. Therefore no tile fails `territory-below-min-size` (028 FR-604) because of tiling.
- FR-677: THE importer SHALL number tiles of one basin 1..n in order of the row-major position of their seed pixel (north to south, then west to east), after merges.

### Ids, names, adjacency, sea semantics
- FR-678: THE importer SHALL make each tile a sea entry (`kind: "sea"`, no owner) numbered by 028 FR-605: sea ids come after land ids, basins in the order of FR-605, the tiles of one basin consecutive in tile order. A basin that stays whole keeps today's single id and name.
- FR-679: THE importer SHALL name a tile `<basin name> <n>` (basin name exactly as given, one space, `n` in decimal without padding, FR-677), in the presentation data (003a FR-86); a basin that stays whole keeps its name. IF the name would exceed 80 code points (003a FR-87), THEN `tile-name-too-long` (basin, length). Tile names are unique by construction; territory names may repeat anyway (003a).
- FR-680: THE importer SHALL derive every link, tile-tile, tile-land and across basins, only from the final pixel contact (003a FR-108, 028 FR-605), with no field and no inserted link. Two tiles are neighbours if and only if some pair of their pixels is 4-adjacent; tiles of different basins that touch (a strait) are linked.
- FR-681: THE importer SHALL NOT change the map format, `MatchState`, the protocol or the sim, and tiles SHALL never be owned: they are passable links, as sea zones are (002 FR-57, FR-59, FR-72). Their effect on a match is only through the graph: factions are direct candidates when they touch a common tile, and a widening hop crosses one tile.

### Interaction with the other 028 steps
- FR-682: Lakes (enclosed sets with no zone within `enclosedReach`, 028 FR-603) SHALL stay other land and never be tiled. An enclosed set that joined a basin is a piece of that basin and is split by FR-674 (a set below the merge threshold of FR-676 joins the nearest tile of the same basin by squared distance between pixel centres, a tile being an id and not a connected region, as a zone is).
- FR-683: Water of an inset rectangle that is a sea apart or that names its sea (028 FR-601) belongs to its basin and is split as pieces of that basin; no tile SHALL cross the rectangle's border and no seed outside the rectangle SHALL serve a tile inside it.
- FR-684: Exclave bridges (028 FR-602) SHALL run on the tiles as on sea zones: the line may cross tiles, the water pixels 4-adjacent to it become other land, a tile cut into pieces is cleaned by the piece cleanup of 028 FR-604, and `unreachable-exclave` is unchanged. A bridge SHALL never be counted as water in the report.
- FR-685: IF the total number of tiles would exceed `maxTiles`, THEN `too-many-tiles` (cap, count, the basins with the most tiles) SHALL fail the import at the pixel stage before any partition is computed; the viewer limits of 028 FR-607 stay warnings (entries above 65,535, required texture size) and now count tiles in "entries".

### Report, proofs, review
- FR-686: THE report (028 FR-609) SHALL gain a tiling section when tiling is on: the spacings, band and reach in kilometres and in pixels; per basin, its pixels, its area in km², its pieces and its tiles; the totals; the smallest, median and largest tile (km²); every merged tile; the number of water pixels beyond `reachKm` and their share. The viewer-limits section SHALL be computed on the final entries.
- FR-687: THE report SHALL print the tiling parameters in force (FR-671) even when they are all defaults.
- FR-688: THE repository SHALL hold a small committed synthetic sample for tiling (an ocean with two coasts, a strait between two basins, one enclosed set joined to a basin, an inset with a sea, one basin kept whole by `zones`, a bridged exclave) whose package is compared byte for byte by a test; it SHALL NOT be added to `maps/`, the server settings or the e2e harness.
- FR-689: A tiling whose `tileKm`, `openTileKm`, `coastBandKm` and `reachKm` are at least the frame side SHALL produce exactly the package of the same curation without `tiling` (every basin stays whole), proving the step is neutral at its limit.
- FR-690: THE deployment guide SHALL gain the operator steps for tiling: when to switch it on, the three tuning numbers, `zones`, how to read the section of FR-686 and the viewer-limits warnings, and the note that sea names carry the basin's name plus a number.
- FR-691: Hand run (done criterion): the operator re-imports world-1815 and spain-municipios with `"tiling": {}`, reviews the previews and report, and records tile counts, import time, required texture size, and the faction colour assignment result (`palette-exhausted`) of both before and after.
- FR-692: THE spec's feature PR SHALL record on `docs/board.md` the follow-up V4 (viewer: how a map with hundreds of sea tiles is drawn: the sea-zone border weight, optional sea-name labels) only if the hand run's screenshots show the need (OQ9).

## Non-functional requirements
- NFR-175 (Determinism and purity): the tiling core takes the raster and parameters and gives the raster; no file system, clock, randomness or network (028 NFR-134); two runs give identical bytes; the purity scan covers the new sources.
- NFR-176 (Compatibility): `maps/dev`, all goldens, the 028 equivalence and sample tests, the format, the server and the viewer are unchanged (028 NFR-132); no new dependency (028 NFR-133).
- NFR-177 (Performance): on the scale fixture of 028 NFR-136 (4,096 px, 8,191 entries) with `"tiling": {}`, tiling adds at most 25% to the import time (within the 120 s bound), single-threaded, default heap; the plan measures a prototype first and may propose other numbers through a change of this spec.
- NFR-178 (Language): code, error kinds and report labels in English; the numeric tile suffix is language-neutral; basin names stay the author's content.
- NFR-179 (Testability): tests first for every id; fixtures at real scale (a 1,000-pixel-wide ocean, a 4,096 world slice with empty frame); each rule has a test that fails when the rule is removed (mutation check on the seeding order, the tie rule, the merge threshold and the reach cut).

## Edge cases
- Empty frame (corners, poles): no seeds beyond `reachKm`; the water there joins the nearest tile by FR-675, so it is never a tile of its own (a world map's top and bottom bands become wedges of coastal tiles that touch only their own coast).
- A basin smaller than one tile, a one-pixel enclosed set, a basin with `zones: 0`: one entry, today's name.
- Gibraltar-like strait between two basins: tiles of both touch; the link exists whatever the tile size.
- Canary Islands inset (`inset.sea` naming the Gulf of Cádiz basin): the rectangle is its own piece, tiled apart, tiles named by the same basin ("Atlántico (Golfo de Cádiz) 7"); no tile crosses into the main water.
- A spacing larger than the frame, or `tileKm` below 3 pixels: valid (FR-689) or `invalid-curation`.
- Tile whose name would be too long: `tile-name-too-long`.
- A map with no sea zones: tiling does nothing (no basin).
- Spain by municipalities: about 600 tiles on 8,211 land territories raise the entries to about 8,800 and so the required texture size from 8,220 to about 8,800 (both above 8,192): reported, never a gate (028 OQ5).
- Exclave group on an island: its bridge crosses tiles (028 FR-602); tiles cut by it are cleaned.

## Out of scope
- Any change to the sim, shared package, protocol, server, bot or viewer, including sea-name labels, a different sea-zone border style and per-tile art (OQ9 records them as follow-up V4).
- Sea ownership or sea combat; tiles are passable links only.
- A tile-to-basin grouping field in the map or presentation format (OQ7 B, "ask first").
- Hand-placed tile seeds or per-tile names in the curation; tiling lakes; subdividing land territories; default-on tiling for existing curations (OQ1).
- Hierarchical (multi-level) sea graphs.

## Done criteria
- Tests first for every id; ledger extended with FR-670 to FR-692 and NFR-175 to NFR-179; `npm test`, `npm run typecheck`, CI green; dev map equivalence and 028 sample unchanged.
- The tiling sample (FR-688) and the neutral-limit test (FR-689) byte-identical.
- NFR-177 measured and recorded in `PROGRESS.md` and the PR.
- Hand run (FR-691): before/after previews of both maps and the numbers recorded; the user accepts the look; status `implemented`; `MEMORY.md` (decision: tiling opt-in, tiles are ownerless sea entries named basin + number), `docs/lessons/map.md` and `docs/board.md` updated in the feature PR; the spec moves to `specs/archive/`.

## Open questions
- [NEEDS CLARIFICATION] OQ1. Opt-in or default-on? **A (recommended):** opt-in through `params.tiling` (`{}` = all defaults): `maps/dev`, the 028 sample and every existing curation stay byte-identical, and the user's world and Spain curations add one line. **B:** default-on with auto size, as `contextGap`/`enclosedReach` are: every map is tiled without asking, but FR-611/FR-612 and NFR-132 of 028 break (they would be regenerated) and `maps/dev`'s 17 seed zones change. **C:** a command-line flag instead of a curation member: not reviewable or repeatable.
- [NEEDS CLARIFICATION] OQ2. One tile size or two tiers? **A (recommended):** two tiers (small tiles in the coast band, larger in open sea, none beyond reach): keeps rivalries local where land touches the water, keeps hop counts comparable, and spends no entries in empty water (about 600 tiles instead of several thousand for the same coast spacing). **B:** one spacing everywhere: simpler, about 4 to 5 times more entries on the world map for the same coast resolution (and phantom tiles in the empty frame unless reach also applies). **C:** a hierarchy (regions of tiles): out of scope.
- [NEEDS CLARIFICATION] OQ3. Default density (frame side ÷ divisor)? **A (recommended):** 60 (about 600 tiles on both sample maps). **B:** 40 (about 1,300: closer to EU4's density, more entries and clutter). **C:** 90 (about 300: fewer, bigger tiles). Authors can always set `tileKm`.
- [NEEDS CLARIFICATION] OQ4. What happens to curated named seas? **A (recommended):** they stay as basins: tiles never cross a basin border, inherit its name, and `zones` can keep one whole or change its size: curation keeps meaning (the Mediterranean stays distinct from the Atlantic at Gibraltar). **B:** ignore curation and tile all water as one surface, naming tiles after the nearest curated sea: more uniform, but a tile can straddle a strait and the author loses control. **C:** tile only basins over a size threshold: same as A with `zones` set by hand.
- [NEEDS CLARIFICATION] OQ5. How are tiles named? **A (recommended):** `<basin> <n>` with `n` by seed position north to south (FR-679): stable, language-neutral, never a collision. **B:** compass suffix (`(NE)`): prettier but not unique past 8 tiles. **C:** an author `nameFormat` template: later, if A proves too plain. Note the viewer draws no sea labels today (004), so names appear in the panel and predictions only.
- [NEEDS CLARIFICATION] OQ6. Empty-frame water? **A (recommended):** no seeds beyond `reachKm`; the nearest tile absorbs the rest (FR-674, FR-675). **B:** make water beyond the projection's valid domain background: it changes pixels the importer never touches today and needs the projection domain for each projection (a 028 amendment). **C:** tile all water evenly: wastes about half of the world map's tiles on nothing.
- [NEEDS CLARIFICATION] OQ7. Record which basin a tile came from? **A (recommended):** no, the name carries it: no format change, nothing "ask first". **B:** add an optional `group` field on sea entries (format change, ask first: lets a future viewer label a basin once and colour or fade tiles by basin).
- [NEEDS CLARIFICATION] OQ8. The `maxTiles` guard (FR-685)? **A (recommended):** 10,000 default (an own resource cap, not a viewer limit), settable up to 100,000. **B:** no cap: a typo such as `tileKm: 1` on the world map would build millions of tiles.
- [NEEDS CLARIFICATION] OQ9. Viewer follow-up? **A (recommended):** change nothing in the viewer in this spec; review the hand-run screenshots (sea-zone borders already draw, 004, and the palette benefits) and record V4 on the board only if hundreds of sea borders clutter the sea or labels are wanted. **B:** include a lighter sea-zone border in this spec: widens the tier to touch `apps/web` (UI, `medium-ui`).
- [NEEDS CLARIFICATION] OQ10. Gameplay effect (information, no decision needed unless the user disagrees): with tiles the direct rivals of a faction across water are only those within a tile-sized reach, so matches lean more on land neighbours and widening hops; a faction alone on an island is absorbed by the nearest living faction counted in tile hops, which approximates kilometres better than zone hops do. The sim's rule is unchanged (002 FR-75 to FR-77).
