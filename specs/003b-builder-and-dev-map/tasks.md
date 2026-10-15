# Tasks 003b — Builder and dev map
Plan: `specs/003b-builder-and-dev-map/plan.md`. Prerequisites: spec `Status: approved` (amended in plan review, same 28 ids); plan and tasks approved by the user; dependencies approved by the user on 2026-10-15: `pngjs` 7.0.0, `@types/pngjs`, `tsx`, `@types/node` (PR1), `shapefile` 0.6.6 (PR2) (plan section 1). Any later change goes to the spec first, then the plan, then these tasks.

Rules for every task:
- Delivery: two PRs into `rewrite`, each task a **GitHub issue** (label `spec-003b`, plus `pr1` or `pr2`; body = the task text below). PR1 on `feat/003b-builder-pipeline` (T1..T9), PR2 on `feat/003b-dev-map` (T10..T15), each branch created from an up-to-date `rewrite` (`git pull --ff-only origin rewrite`); PR2 starts only after PR1 is merged. Never push to `main` or `rewrite`. One commit per task; PR description lists `Closes #n` for its issues; squash merge only with the user's OK and CI green.
- Tests first: write them, see them fail (red) for the right reason, then code. Prove new guards by temporary mutation when a test could pass vacuously (back the file up first; never `git checkout` a file with uncommitted edits); use the FULL `npm test` for mutation proofs.
- Before each commit: `npm test`, `npm run typecheck`, and `$env:CI='1'; npm test` (PowerShell) all green. Quote the path (it contains spaces).
- `tools/build-map/src/core` and `src/extract/extract.ts` stay pure (no fs, clock, randomness; only `node:zlib` `deflateSync`/`inflateSync`; never import `pngjs` or `shapefile`, which live only in `src/io/png-codec.ts` and `src/extract/read-shapefile.ts`); all builder sources ASCII-only. No new export in `@mbrg/shared`; no edit to `packages/*/src`, goldens, or any 001/002/003a test except `packages/sim/test/traceability.test.ts` as plan section 11 states (NFR-22).
- Only the five approved packages may be added, in `tools/build-map/package.json` only (never `packages/*` or the root), exact version (no range) in the manifest and the lockfile, licence re-checked on npm at install and recorded in plan section 1 in the same commit. Any other package (including `@types/shapefile`): stop and ask.
- Test titles start with the FR/NFR ids they verify; never FR-6 or FR-25; meta-test titles in the traceability file name no id other than NFR-13/NFR-19. Check each task's ids with `rg -n "(it|test|describe)\(['\"\`][^'\"\`]*\bFR-NN\b" packages/*/test tools/*/test`.
- Commit: English, conventional prefix, one line <= 72 chars. Tick the task, update `MEMORY.md` locally (state, decisions with why, mistakes), close the issue through the PR, and stop. The reviewer validates each task FR by FR.

## PR1 — builder pipeline (FR-105, FR-111..FR-126, NFR-14, NFR-20, NFR-23)
Pending set during PR1: unchanged (28 ids) until T9; **at PR1 merge: exactly FR-127, FR-128, FR-129, FR-130, FR-131, NFR-16, NFR-17, NFR-21**.

- [x] **T1. Commit spec docs; builder workspace, approved tooling, config extensions, tsx spike, library manifest test.** NFR-20, NFR-19 (scan glob step)
  - Files: `specs/003b-builder-and-dev-map/{spec,plan,tasks}.md` (first commit); root `package.json` (`workspaces` + `tools/build-map`, `typecheck` + `tsc -p tools/build-map/tsconfig.json && tsc -p tools/build-map/tsconfig.test.json`), `vitest.config.ts` (`include` + `tools/*/test/**/*.test.ts`), `.gitignore` (`tools/build-map/out/`); `tools/build-map/{package.json,tsconfig.json,tsconfig.test.json}` with `pngjs` 7.0.0, `tsx`, `@types/node` (24.x), `@types/pngjs` pinned exactly; `tools/build-map/test/libraries.test.ts`; `packages/sim/test/traceability.test.ts` (second glob + builder-scan test only).
  - Tests first: NFR-20 manifest test (plan section 13, PR1 list); `NFR-19 the scanned sources include the builder tests`.
  - Spike (tsx): a 5-line `src/cli/build.ts` stub importing `validateMap` from `@mbrg/shared` (whose own imports are extensionless) runs with `npm run build-map -w @mbrg/build-map` on Node 24, exit status 0, on Windows and in CI. If it fails, stop and ask.
  - Commits: `docs: add spec, plan and tasks 003b builder and dev map`; `chore(build-map): add builder workspace and tooling`.
  - Done when: `npm ci` clean; typecheck covers the workspace src and tests and `packages/*` tests still type-check without Node types; the stub command runs; NFR-20 and the scan test green; lockfile diff = workspace link + the four approved packages and their transitive packages; licences recorded in plan section 1.

- [x] **T2. PNG id image file: pre-decode check and pngjs codec.** FR-105, NFR-23 (round trip, chunk check)
  - Files: `tools/build-map/src/core/{types.ts,crc32.ts,png-check.ts}`, `tools/build-map/src/io/png-codec.ts`, `tools/build-map/test/{png.test.ts,helpers/png-bytes.ts}`.
  - Tests first: plan section 13 `png.test.ts` (round trip with 1, 255, 256, 65,535, 65,536, 16,777,215; written chunk list and IHDR fields; each planted chunk, depth, colour type, interlace; every malformed case of FR-105; pngjs never called on a rejected file; filters 1-4 decoded).
  - Code: plan section 4 (`checkPngFile` in core; pngjs only in the adapter).
  - Commit: `feat(build-map): check and encode id image PNG files`.
  - Done when: tests green; `rg` finds FR-105 and NFR-23 in titles.

- [x] **T3. Input parsing, grouping table check, numbering and names.** FR-112 (`invalid-input`, input keys, no seed/round), FR-113, FR-119, FR-120, FR-121
  - Files: `tools/build-map/src/core/{types.ts,errors.ts,parse-inputs.ts,grouping.ts,numbering.ts,presentation.ts}`, `tools/build-map/test/{helpers/fixtures.ts,inputs.test.ts,grouping.test.ts,numbering-names.test.ts}`.
  - Tests first: every malformed input of FR-112 -> one `invalid-input` each in input order; every FR-113 kind alone and all at once in table order, code-unit order inside a kind, secondary order by `territory`, once per distinct data; spec edge cases (bayern twice, FRA province in a DEU territory, empty list, territory colour, missing record, unassigned province outside the frame); FR-120 order and ids; FR-121 name sources, null/empty fallbacks, trailing space kept, no name field; FR-112 pinned input keys.
  - Code: plan section 5.
  - Commit: `feat(build-map): parse inputs, check grouping, number entries`.
  - Done when: tests green with `toStrictEqual`; `rg` finds FR-112, FR-113, FR-119, FR-120, FR-121.

- [x] **T4. Projection, frame and centre-point rasterization.** FR-114, FR-115, NFR-23 (rasterization)
  - Files: `tools/build-map/src/core/{projection.ts,rings.ts,rasterize.ts}`, `tools/build-map/test/{projection.test.ts,rasterize.test.ts}`.
  - Tests first: plan section 13 projection and rasterize lists (edges, shared vertices, holes, overlapping holes and polygons, orientation, duplicates, zero-area rings, other land, first in map order, values only from the input ids).
  - Code: plan section 6.
  - Commit: `feat(build-map): project and rasterize provinces by pixel centre`.
  - Done when: tests green; `rg` finds FR-114, FR-115.

- [ ] **T5. Sea zones and contact adjacency.** FR-116, FR-118
  - Files: `tools/build-map/src/core/{sea.ts,adjacency.ts}`, `tools/build-map/test/{sea.test.ts,adjacency.test.ts}`.
  - Tests first: nearest seed, equal-distance tie to the first seed (a fixture where FIFO BFS would differ), lake -> background, each seed error and their order, seed on pixel edges and on the frame's east/south edge; links equal `contactPairs`, ascending neighbours, corner-only no link.
  - Code: plan section 7 (layered BFS, `buildMapData`).
  - Commit: `feat(build-map): grow sea zones from seeds and derive links`.
  - Done when: tests green; `rg` finds FR-116, FR-118.

- [ ] **T6. Small-piece cleanup, incremental and proven identical.** FR-117
  - Files: `tools/build-map/src/core/pieces.ts`, `tools/build-map/test/{pieces.test.ts,helpers/cleanup-direct.ts}`.
  - Tests first: every land step 1-4 and sea step, zero-contact fall-through, corner-only -> background, ties, smallest-first with row-major tie, cascades/merges, background untouched, `vanished-entry` for land and sea (stops at first); incremental == direct on the hand fixtures and on 500 seeded generated grids.
  - Code: plan section 7 `cleanupPieces`.
  - Commit: `feat(build-map): reassign pieces smaller than the minimum size`.
  - Done when: tests green; identity test fails under a planted tie-rule mutation; `rg` finds FR-117.

- [ ] **T7. In-memory build: assembly, self-check, report, JSON, preview image.** FR-112 (determinism), FR-122, FR-124, FR-125, FR-126 (image), NFR-14 (throwing clock run)
  - Files: `tools/build-map/src/core/{build.ts,self-check.ts,json.ts,report.ts,preview.ts}`, `tools/build-map/test/{build.test.ts,preview.test.ts,builder-purity.test.ts}`, `helpers/fixtures.ts` ("mini" lon/lat fixture: 3 countries, island, excluded province, other land, lake, 3 seeds, W = 64, S = 4).
  - Tests first: plan section 13 `build.test.ts` and `preview.test.ts`; build twice on the fixture -> identical bytes of all three artifacts; `png-round-trip-mismatch` through an altering test codec; `.nvmrc` and CI `node-version-file` check; the throwing clock/randomness build with the real pngjs codec.
  - Code: plan section 8 (`buildInMemory(inputs, codec)`).
  - Commit: `feat(build-map): assemble and self-check the map package in memory`.
  - Done when: tests green; the mini package passes `validateMap`, `checkPresentation`, `checkIdImage`; `rg` finds FR-122, FR-124, FR-125, FR-126.

- [ ] **T8. Build command, atomic writes, preview files, purity scan.** FR-111, FR-123, FR-126 (location, on failure), NFR-14 (source scan)
  - Files: `tools/build-map/src/io/{read-inputs.ts,fs-ops.ts,write-package.ts}`, `tools/build-map/src/cli/build.ts`, `tools/build-map/test/{command.test.ts,builder-purity.test.ts,helpers/scan.ts}`.
  - Tests first: plan section 13 `command.test.ts` (temp dirs; write failure per artifact, first-rename failure -> `write-failed` with all temps removed, later rename failure -> `partial-write` with remaining temps removed; previous artifacts byte-identical; preview on failure after rasterization only; unreadable input -> `invalid-input`; `.gitignore` line; no network) and the NFR-14 scan tests (exemption list exactly the two zlib functions; planted `node:fs`, `gzipSync`, namespace/default zlib import, `require`, dynamic import, `pngjs` import in core flagged).
  - Code: plan section 9.
  - Commit: `feat(build-map): add build command with atomic package writes`.
  - Done when: tests green; a manual `npm run build-map -w @mbrg/build-map` on a temp copy of the mini fixture writes three artifacts and prints the report; `rg` finds FR-111, FR-123, NFR-14.

- [ ] **T9. Language list, traceability step 1, scale measurement; close PR1.** NFR-18 (003b lists), NFR-19 (pending set to 8), NFR-16 (measurement only, no id in titles)
  - Files: `tools/build-map/test/{builder-language.test.ts,scale-probe.test.ts}`, `packages/sim/test/traceability.test.ts` (plan section 11, PR1 step).
  - Tests first: builder language literal lists (plan section 13) and ASCII-only `tools/build-map/src`; traceability: pending pin = the 8 ids, `FR-105, FR-126, NFR-14, NFR-23` expected, `FR-127, NFR-21` not expected; prove by temporarily renaming one PR1 title (reported missing), then revert.
  - Measurement: plan section 12 probe (one full build through `runBuild`, artifacts written to a temp dir); record local and CI `buildMs`/`checksMs` in the PR1 description and `MEMORY.md`; apply the decision rule (if thresholds fail, stop and propose a spec change before PR2).
  - Steps: NFR-22 process check (plan section 11); push; open PR1 (`Closes` T1..T9 issues); CI green; squash merge only with the user's OK.
  - Commit: `test(build-map): trace builder ids and measure scale`.
  - Done when: traceability green with every PR1 id required; pending set exactly FR-127..FR-131, NFR-16, NFR-17, NFR-21; CI run linked; measurements recorded; `MEMORY.md` updated.

## PR2 — dev map (FR-127..FR-131, NFR-16, NFR-17, NFR-21)
Pending set during PR2: the 8 ids above until T15; **at PR2 merge: no pending set; expected = FR-1..FR-131 + NFR-1..NFR-23 minus FR-6, FR-25 (152 ids)**.

- [ ] **T10. Extraction step on a synthetic Natural Earth fixture.** FR-131 (automated part), NFR-20 (approved list + `shapefile`)
  - Files: `tools/build-map/src/extract/{read-shapefile.ts,shapefile.d.ts,extract.ts}`, `tools/build-map/src/cli/extract.ts`, `tools/build-map/package.json` (`extract` script; `shapefile` 0.6.6 pinned; transitive licences checked, `text-encoding` included: if outside the NFR-20 list, stop and ask), `tools/build-map/test/{extract.test.ts,helpers/ne-fixture.ts,libraries.test.ts,builder-purity.test.ts}`.
  - Tests first: selection, kept properties (lower case), whole features, per-polygon other land (one feature with a near and a far polygon), rounding to 5 decimals, collapsing, DBF padding removed, outer + hole read correctly, metadata record, `invalid-source-version` (missing and different texts, trailing line break ignored, `files` sorted), two runs byte-identical; `shapefile` only given ArrayBuffers and imported only by `read-shapefile.ts`; purity scan covers `src/extract/extract.ts`.
  - Code: plan section 10.
  - Commit: `feat(build-map): extract Natural Earth source subset`.
  - Done when: tests green; `invalid-source-version` and `files` added to the builder language lists; `rg` finds FR-131.

- [ ] **T11. Committed source data and provenance.** NFR-21, NFR-17 (source size measured)
  - Files: `tools/build-map/data/dev-map/{grouping.json (countries only at this point),extraction-box.json}`, `tools/build-map/data/natural-earth/{provinces.json,countries.json,other-land.json,source-meta.json,PROVENANCE.md}`.
  - Steps: download Natural Earth 1:10m admin-1 and admin-0 countries locally (outside the repo; never committed); run `npm run extract -w @mbrg/build-map -- --ne <dir>` twice and compare bytes; measure total size (<= 10 MB with whole features and per-polygon other land; clip only if exceeded and say so in the note); write `PROVENANCE.md` (plan section 12).
  - Commit: `feat(build-map): add Natural Earth source subset`.
  - Done when: two extraction runs byte-identical; size recorded in the PR description; note complete (source, version, files, box, trimming, rounding, collapsing, command, Portugal approximation, licence).

- [ ] **T12. Grouping table, sea seeds and parameters; first dev map build and review.** FR-127 (inputs), NFR-16 (real-data measurement)
  - Files: `tools/build-map/data/dev-map/{grouping.json,sea-seeds.json,params.json}`.
  - Steps: group every admin-1 code into the 70 territories (DEU 16, ESP 16, FRA 13, ITA 20, PRT 5 from whole districts) with Spanish names for multi-province territories; exclude Canarias, Ceuta, Melilla, Azores, Madeira and French overseas regions; 10-20 Spanish-named seeds; params `{ width: 2048, margin: 0.02, minPieceSize: 40 }`; build with `--preview` until no error; measure build and check times on real data.
  - Review: the user reviews `tools/build-map/out/preview.png` and the build report (grouping, Portugal approximation, islands, straits, sea zones) and gives explicit OK.
  - Commit: `feat(build-map): add dev map grouping, seeds and parameters`.
  - Done when: build succeeds; user OK recorded in the issue; timings recorded (if above the NFR-16 thresholds, stop and propose a spec change).

- [ ] **T13. Commit the dev map package and its checks.** FR-127, FR-128, FR-129, FR-131 (box covers frame), NFR-17, NFR-21
  - Files: `maps/dev/{map.json,presentation.json,ids.png}`, `tools/build-map/test/dev-map.test.ts`.
  - Tests first: plan section 13 `dev-map.test.ts` (FR-127 counts and names, FR-128 three checks + PNG read, FR-129 five spec-002 properties, extraction box covers every outermost pixel centre, NFR-17 sizes: PNG <= 2 MB, JSON <= 500 KB together, source data <= 10 MB, NFR-21 note contains the `source-meta.json` version).
  - Commit: `feat: add dev map of western Europe`.
  - Done when: tests green; `rg` finds FR-127, FR-128, FR-129, NFR-17, NFR-21.

- [ ] **T14. Rebuild test and timing thresholds.** FR-130, NFR-16
  - Files: `tools/build-map/test/rebuild.test.ts`; delete `tools/build-map/test/scale-probe.test.ts`.
  - Tests first: one full rebuild through `runBuild` from the committed inputs into a temp dir, explicit timeout 180 s: build (inputs read to three artifacts written) < 60 s (NFR-16), map and presentation bytes equal to `maps/dev`, decoded pixels equal to the committed PNG; validation + presentation + id image checks of the dev map < 1 s. Prove by temporarily editing one byte of `maps/dev/map.json` (fails), then revert.
  - Commit: `test(build-map): rebuild the dev map and check timings`.
  - Done when: green locally and in CI (ubuntu): proves cross-OS identical JSON and pixels; `rg` finds FR-130, NFR-16.

- [ ] **T15. Traceability step 2; close PR2 and the spec.** NFR-19 (pending set removed), NFR-22, done criteria
  - Files: `packages/sim/test/traceability.test.ts` (plan section 11, PR2 step), `specs/003b-builder-and-dev-map/spec.md` (status -> `implemented`, last, after review), `MEMORY.md` (local).
  - Tests first: `NFR-19 the expected list excludes only the retired ids` (152 ids, computed); pending pin test removed; self-trace pin unchanged; prove by temporarily renaming one PR2 title (reported missing), then revert.
  - Steps: NFR-22 process check (plan section 11); reviewer validates FR by FR against the spec done criteria; push; open PR2 (`Closes` T10..T15 issues); CI green; squash merge only with the user's OK.
  - Commits: `test: trace spec 003b requirements`; `docs: mark spec 003b implemented`.
  - Done when: CI green on the PR; no pending set; manual check done: extraction reproduces the committed source data from the real Natural Earth files; `MEMORY.md` updated (state, decisions, lessons; "~40-60 provinces" replaced by the 70 territories; next step spec 004).
