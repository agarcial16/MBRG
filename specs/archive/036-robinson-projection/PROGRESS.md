# Progress — Spec 036 (Robinson projection for the world map)

## 2026-11-24 — spec, tests, code, rebuild
- Finding: `maps/world-countries` is built by the 003b **builder** (data-only, Lambert disk), not by the importer; Robinson was therefore added to both (builder `params.projection`, importer curation `params.projection`). No format change, no new dependency, default unchanged.
- Spec written first (`spec.md`, FR-697..704, NFR-180..182); user's approval is the quoted "robinson".
- Tests first: `robinson.test.ts` (table nodes exact, Catmull-Rom midpoints, symmetry, monotone, extent), `robinson-build.test.ts` (params parse, laea default byte-identical, wide-world build, seeds), `importer-robinson.test.ts` (curation, view, antimeridian). `world-map.test.ts` updated: 8 sea zones, 4352 px, Robinson params and frame checks.
- Code: `core/robinson.ts` (own table, cubic through rows), `core/projection.ts` `planeFor`, builder params/report/seeds, importer `views.ts` (flat projection shared with Equal Earth), curation.
- Rebuild of the world map: width 4352 (4096 lost the Maldives: 0 px), margin 2%, S = 1; added the sea seed `Océano Pacífico Occidental` (last, id 201). Faction/land ids and names unchanged; `presentation.json` differs only by that entry. Adjacency differences listed in `tools/build-map/data/world-countries/README.md` (land pairs: -Azerbaiyán/Turquía, +Botsuana/Zambia, +Dinamarca/Suecia).
- Tests: `npm run typecheck` and `npm test` green locally (476 files, 6,892 tests passed, 8 skipped). Untested: the viewer on the new map (not run here; viewer untouched).
- Before/after previews (gitignored): `.claude/review/036-robinson/before.png` (Lambert 4096) and `after.png` (Robinson 4352), plus 1,600 px versions.

Branch `feat/036-robinson-projection`, state: implemented, PR open. Next step: the user reviews the PR and the before/after images; check the map in the viewer (texture 4352 > 4096; the viewer refuses cleanly on a device with a smaller texture limit).
