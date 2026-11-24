# Progress — Spec 036 (Robinson projection for the world map)

## 2026-11-24 — spec, tests, code, rebuild
- Finding: `maps/world-countries` is built by the 003b **builder** (data-only, Lambert disk), not by the importer; Robinson was therefore added to both (builder `params.projection`, importer curation `params.projection`). No format change, no new dependency, default unchanged.
- Spec written first (`spec.md`, FR-697..704, NFR-180..182); user's approval is the quoted "robinson".
- Tests first: `robinson.test.ts` (table nodes exact, Catmull-Rom midpoints, symmetry, monotone, extent), `robinson-build.test.ts` (params parse, laea default byte-identical, wide-world build, seeds), `importer-robinson.test.ts` (curation, view, antimeridian). `world-map.test.ts` updated: 8 sea zones, 4352 px, Robinson params and frame checks.
- Code: `core/robinson.ts` (own table, cubic through rows), `core/projection.ts` `planeFor`, builder params/report/seeds, importer `views.ts` (flat projection shared with Equal Earth), curation.
- First rebuild of the world map (superseded below): width 4352 (4096 lost the Maldives: 0 px), margin 2%, S = 1; added the sea seed `Océano Pacífico Occidental` (last, id 201). Faction/land ids and names unchanged; `presentation.json` differs only by that entry. Adjacency differences listed in `tools/build-map/data/world-countries/README.md` (land pairs: -Azerbaiyán/Turquía, +Botsuana/Zambia, +Dinamarca/Suecia).
- Tests: `npm run typecheck` and `npm test` green locally (476 files, 6,892 tests passed, 8 skipped). Untested: the viewer on the new map (not run here; viewer untouched).
- Before/after previews (gitignored): `.claude/review/036-robinson/before.png` (Lambert 4096) and `after.png` (Robinson 4352), plus 1,600 px versions.


## 2026-11-24 — PR #103 feedback: fit 4096, keep every territory
- User (quoted): "tal vez haya que ver como optimizar esto para que si muestre sin perder zonas". Goal: <= 4096 px and no lost territory.
- Evaluated: (b) non-square: the map format (`checkIdImage` W x H), the viewer (camera `fitScale`, `checkCapabilities` on max(width, height), minimap, tests at 1000 x 800) and the PNG codec already take width != height; only the builder core assumed a square. But at the same width the pixel size is unchanged (it only drops the empty rows), so it alone does not save the Maldives. (a) alone leaves half the image empty. Chose (c) = both. No format or viewer change was needed.
- Code: `rasterize`/`toPixel`/`seedPixels`/sea/self-check take a height (default W, so every other build is byte-identical); `robinsonFrame` (globe rectangle); `core/footprint.ts` (`growFootprints`, `params.minFootprint`, report `grownUnits`). The importer's Robinson stays square.
- World map rebuilt: 4096 x 2179, `minFootprint` 9, 19 units grown to 9 px (Maldives from 0), every other territory has >= 9 px; ids.png 118 KB. Adjacency vs the pre-036 map: land pairs +Botsuana/Zambia only; land-sea 30 removed/34 added; sea-sea 2 removed/3 added (listed in the data README). Merged origin/main (#104) into the branch.
- Tests: new `footprint.test.ts`, extended `robinson-build.test.ts` and `world-map.test.ts` (4096 x 2179, every territory >= 9 px); full `npm test` and `npm run typecheck` rerun before the push. Untested: the viewer on the rectangular map in a browser (code paths read, camera tests at 1000 x 800 exist).

Branch `feat/036-robinson-projection`, state: implemented, PR #103 updated. Next step: the user reviews the PR and the previews (`.claude/review/036-robinson/`); open the map in the viewer once.
