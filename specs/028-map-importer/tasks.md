# Tasks 028 — Map importer (vector route)
Plan: `plan.md`. Spec: `spec.md` (approved 2026-11-21). Status: draft (presented 2026-11-21, for the strong-tier review and then the user's approval; implementation starts only after it). One file per milestone; each task is at most 20-30 minutes and ends with tests green, a PROGRESS.md entry and one commit.

## Milestones
| Milestone | File | Content | Tasks |
|---|---|---|---|
| M1 | `tasks-M1.md` | Ledger, GeoJSON reader, caps, extract mode, curation schema, inspect, units, selection, error collector, the scale prototype (NFR-136) | 10 |
| M2 | `tasks-M2.md` | Grouping, the curation stage, projection (laea reuse + Equal Earth), insets, pixels, sea, gap fill + minimum piece, numbering, the gate and the import CLI | 10 |
| M3 | `tasks-M3.md` | Report and viewer limits, the dev-map equivalence, the synthetic sample, scale + stress proof, the deployment guide, closing | 6 |

26 tasks in 3 milestones.

## Rules for every task
- Delivery: branch `feat/028-map-importer` from `main`; one PR into `main` at the end; squash merge only with the user's OK and CI green. One commit per task: English, one line, conventional prefix, at most 72 characters, ending with the `Co-Authored-By` line of the implementing model.
- Models (AGENTS.md): implementers medium tier; the milestone reviews are strong tier (the spec touches determinism and `packages/shared`). With Claude at its limit the implementer runs on `opencode-go/glm-5.3`, and the strong-tier review happens before the user approves and again before merge.
- Tests first: see them fail for the right reason, then code. Prove guards by temporary mutation (back the file up first; affected test files per mutant; the full suite once at the end of the milestone).
- Per task run only the affected tests; at the end of each milestone `npm test` and `npm run typecheck`; before the PR also `CI=1 npm test`. Use Write/Edit for sources. Quote the worktree path (it has spaces).
- Protected, byte-identical in every task (`git diff --exit-code main`): `maps/dev`, `packages/sim/src`, `packages/sim/test/golden`, `packages/protocol/src`, `apps/server`, `apps/bot`, `apps/web` (except the two files named below), `tools/build-map/data/natural-earth`, `tools/build-map/data/dev-map`, `tools/build-map/src/core`, `tools/build-map/src/io`, `tools/build-map/src/extract/extract.ts`, and every existing test file except exactly two: the traceability ledger (`packages/sim/test/traceability.test.ts`, T1.1, by definition — its edit also removes `FR-586` and `NFR-132` from the three 024/025/027 exclusion assertions) and the shared export pin (`packages/shared/test/no-regression.test.ts`, T3.1, PD5). The builder purity, language and libraries tests (`tools/build-map/test/builder-purity.test.ts`, `builder-language.test.ts`, `libraries.test.ts`) are never edited (NFR-14, NFR-137, NFR-20 pinning): every importer check lives in new `test/importer-purity.test.ts`, `test/importer-language.test.ts` and `test/importer-libraries.test.ts`. Each changed pin is logged in `PROGRESS.md` with its reason; any other pinned test changed stops the task. Exactly two source files outside the importer change, in T3.1 only: `apps/web/src/core/colors.ts` (re-export) and `apps/web/src/core/theme.ts` (the palette constant moves to `@mbrg/shared`), plus the moved `packages/shared/src/colors.ts` and its index export. `packages/shared` gains no other source or export (PD5).
- Purity: `tools/build-map/src/importer/**` is scanned core (NFR-134): no file, clock, randomness or network; the only runtime built-in is the `node:zlib` exemption; `read-dbf.ts` uses only `TextDecoder`/`DataView`. The CLI and `src/extract/read-shapefile.ts` stay adapters outside the scan.
- Ledger: T1.1 adds the ranges FR-586..FR-614 and NFR-132..NFR-138 and `PENDING_028` with all 36 ids, and updates the size pins; an id is named in the header of the one task that closes it, which moves it to `DONE_028` in its own commit. A test title carries an id literal only in that commit: earlier tasks verify the same behaviour with id-free titles, and the closing task renames them.
- Error kinds, data fields and report labels are English identifiers (NFR-137) and land in the importer language test's literal lists (`test/importer-language.test.ts`) as they appear; `builder-language.test.ts` is never edited.
- No new third-party dependency anywhere (NFR-133, PD3); `@mbrg/protocol` is a workspace dependency only.
- `PROGRESS.md` entry after each task: what changed, tests run and result, what is untested, next step (branch, state).
- A requirements change goes to the spec first, then plan, then tasks, then code.
- Hand runs 1 and 2 (spec done criteria) are the user's, after M3: the tasks stop at the automated criteria; the feature PR flips the spec to `Status: implemented` only after the user accepts them.
