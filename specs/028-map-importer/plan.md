# Plan 028 — Map importer (vector route)
Spec: `spec.md` (approved 2026-11-21, OQ5/OQ6 answers; amended with PD6). Status: **draft**, for approval. New modes of `tools/build-map`; the 003b core reused in place -- `core/sea.ts` alone is reimplemented (section 4).

## 1. Files and responsibilities
`src/importer/**` is a scanned pure core (NFR-134: codec injected, only `node:zlib`). Command: `import-map -- extract|inspect|import` (flags in the tasks); exit 0/1/2, JSON stderr errors, no network; FR-608's stages, first failure stops, no file touched on failure, 003b temp+rename write (FR-586, 608-610).
Core, by FR: types 592 | read-source 587,588 | curation 592 | units 593,595 | select 594 | grouping 596,597 | errors + check-curation 599 | equal-earth 600 | views 600,601 | pixels 589,602 | sea-sources 598 (own pass, section 4) | gap-fill 603 | min-size 604 | numbering 605 | sha256 609 | report 607,609 | import 608 | inspect 591 | read-dbf + extract-geo 590 | scale-fixture 614,136 (generator; T1.10). Outside: `read-shapefile.ts` (+`openShpGeometry`; readShapefile unchanged) 590, `cli/import.ts` 586, `cli/scale-import.ts` 136/614, `shared/src/colors.ts` (PD5) 607, `data/importer/` 611/612, `docs/deployment.md` 613.
Reused unchanged: `core/projection|rasterize|pieces|adjacency|self-check|json|png-check|preview.ts`, `io/write-package.ts`, `test/helpers/*`. New checks go to new `test/importer-*.test.ts`; only the ledger and the shared pin change (task rules).

## 2. Curation, units, selection (FR-592 to FR-595)
Members, caps, types as FR-592; wrong type, unknown member, empty `columns.key`, over-length list -> `invalid-curation` (member path); over 16 MiB before parsing (NFR-135). Key **lengths** are not schema errors: a territory or faction key, curated or generated (`units.*.territory|faction`, `factions[].key`, `territoryNames`, a property value used as a key), outside 1..256 code units fails `invalid-key` in the curation stage, never `invalid-curation` (FR-599). Units, names, filters per FR-593/594.

## 3. Projection and insets (FR-600, FR-601, PD6)
`laea` reuses `core/projection.ts` untouched (centre, `selection-too-wide`, far context as FR-600). `equal-earth` is own code on the published constants (unit sphere); main map: central meridian 0. Each inset centres on its units' own lon/lat midpoint; with `equal-earth` that midpoint longitude **is** the inset's own central meridian lon0 (PD6, as amended): longitudes project as `lon - lon0` wrapped into (-180, 180]. `antimeridian-edge` per view: wrapped ends differing by over 180 degrees fail (unit key or context file and feature index) -- the main map refuses an unsplit antimeridian ring, an inset centred on it accepts it. Frame `frameFor` unchanged; inset rectangle: projected bbox + margin x main side, rounded outward, at `(x, y)`; a seed lies in the first inset containing it, else the main view.

## 4. Pixels, sea, gap fill, cleanup (FR-589, FR-598, FR-602 to FR-604)
Rings converted per view; `rasterize` unchanged per view (land, then other land, value 0); inset rectangles overwrite the main raster. `core/sea.ts` **not** reused (fused BFS + private join; water stays water with no seeds; later pixels overwrite earlier zones); own pass (`sea-sources.ts`):
1. Sources: seed pixels (composed rule) + sea-unit water pixels, map order; land wins inside a sea unit; a shared pixel goes to the first zone in map order.
2. Isolate enclosed sets **before zone assignment**: label water reachable from the sources (4-adjacent); each remaining group is one set (003c, row-major).
3. `gapFill` G here, before zones are assigned (FR-603's "before 003c runs"): a set under G touching a land territory goes whole to the highest-contact territory (ties first in map order); pixels become land, sets reported; no G, no fill.
4. BFS through water, ties to the first zone in map order.
5. Remaining sets join the nearest zone, squared pixel-centre distance (003c FR-162, ties first).
6. Zero zones: all water becomes background, never `no-sea-seeds`.
Then the FR-604 min-size check (all at once, map order) and the FR-117/FR-163 cleanup (identity vs `cleanup-direct.ts`).

## 5. Decisions (discarded alternative in brackets)
**PD1** one command, three modes, existing workspace [three scripts/new workspace: more surfaces, split pins]. **PD2** one hand-edited curation JSON (OQ2 A) [guided dialogue]. **PD3** no new dependency (NFR-133); Equal Earth, SHA-256 own code; `@mbrg/protocol` workspace-only [libraries]. **PD4** own DBF reader (the library trims values; FR-590 keeps leading spaces) [its DBF path]; geometry from `openShp`. **PD5** colour assignment + `PALETTE` to `@mbrg/shared` (FR-607: the viewer's own function) [copy: drift]. **PD6** amended: main-map meridian 0, insets re-centre; wrap + `antimeridian-edge` per view [fixed everywhere: Canaries off centre]. **PD7** `--draft` in a package folder: usage error. **PD8** extract keeps record order, no default rounding. **PD9** curated names/colours in the curation stage, source names by the self-check. **PD10** `stat` before every read, re-checked on the bytes.

## 6. Test strategy (Vitest; new `test/importer-*.test.ts` files only)
- **Golden (FR-611):** the committed dev-map curation (per-province `units.territory`: the 288 provinces merge into the grouping table's 70 territories; `factionBy { property: "adm0_a3" }` with the five committed factions; committed context, seeds and params) imports byte-identical to `maps/dev`; every 003b test green unedited.
- **Sample (FR-612, NFR-138):** committed synthetic source + curation + expected package, the ten FR-612 cases, byte for byte; never under `maps/`.
- **Scale (NFR-136, FR-614):** **prototype, inside this plan (M1, T1.10):** the NFR-136 fixture's heavy path (T1.2 reader + the 003b core in place: projection, `rasterize`, seed BFS, `pieces`) under 120 s **before M2 builds against that number**; a breach stops the plan and proposes a spec change (as 003b NFR-16). T3.4's opt-in `scale:import` (outside `npm test`) re-measures the real import at the same bound (time and memory recorded, `inspect` <= 30 s, one faction per unit = the stress proof).
- **Purity, language, ledger:** new `importer-purity` and `importer-language` tests grow per task (003b pin tests never edited); T1.1 adds `PENDING_028` (36 ids) and drops `FR-586`/`NFR-132` from the 024/025/027 exclusions.

## 7. Milestones
M1 input side (10) | M2 import pipeline (10) | M3 proofs (6); detail in `tasks.md`.
