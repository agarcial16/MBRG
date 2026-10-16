# Tasks 003c — Enclosed water becomes sea

Branch `feat/003c-enclosed-water`. One task at a time: tests first (red), code, `npm test` and `npm run typecheck` green (also `CI=1`), tick, commit, stop. Mutation proofs use the FULL `npm test`.

- [x] **T1. Approve plan; amendment notes; traceability ranges and pending set.** NFR-31
  - Files: `specs/003b-builder-and-dev-map/spec.md` (notes only), `packages/sim/test/traceability.test.ts`.
  - Tests first: expected ids are ranges (FR 1..131 and 162..166, NFR 1..23 and 30..31) minus the retired; a pinned pending set holds FR-162..FR-166 and NFR-30 and a test (title naming NFR-31, which this file self-traces) asserts it is exactly that; the old literal-count tests are updated (ids 131+5 = 136 FR and 23+2 = 25 NFR = 161, minus 2 retired = 159, minus the 6 pending FR-162..FR-166 and NFR-30 = 153 expected; NFR-31 is self-traced by this file, so the self-trace pin becomes FR-55, FR-56, NFR-13, NFR-19, NFR-31).
  - Capture, before any code change, the byte sizes and SHA-256 of `map.json`, `presentation.json`, `ids.png` and of the outputs of the 003b build fixtures with no enclosed water (kept as literals in T4).
  - Baseline captured 2026-10-16 before any code change (SHA-256, real `pngCodec`, `buildInMemory`): `baseInputs()` map `0d18c4e727c3397e99b046fbf58d9dc6624c3f5993a050a6c52cf07821b10852`, presentation `96c6fadd271a067424a9d559dc82b78ce91b5a26e6af41dd9fdb54c70bc23b0d`, image `78a52b0614e1f5ae739f09ad1b85e583f7bae39ed401ff7e9d7113d2130bfc63`, report `75e23233e9a714f7f9ca8c2f71c5b9eab7c2a55651f356553e8f5d785b08d9e9` (2 sea zones, 0 reassigned). `miniInputs()` has a lake, so it is NOT a compatibility fixture. Committed `maps/dev` before: map `6247eff2813c18e1bb50422f5c344421d78ff598ad3387e101be7324a86aca28` 11,787 B, presentation `0e883d89bb7b823c6408efdc55744a4927e90886e0fc36576639d7609f30548d` 5,347 B, ids.png `837db644b50cc1dfe4dcf1eb03dbb2b282604f6de9634f890225c2792cbc9e5b` 70,617 B. T4 must first check that `baseInputs()` has no enclosed water (the new report says 0 sets).
  - Commit: `docs: 003c plan, tasks and traceability ranges`.
  - Done when: tests green; the pending set is pinned.

- [x] **T2. Enclosed water goes to the nearest zone.** FR-162, FR-164
  - Files: `tools/build-map/src/core/sea.ts`, `tools/build-map/test/sea.test.ts` (the lake test is replaced).
  - Tests first: plan section 7 list for `sea.test.ts` including the brute-force comparison. Mutations proved.
  - Commit: `feat(build-map): assign enclosed water to the nearest sea zone`.
  - Done when: tests green; `rg` finds FR-162 and FR-164 in titles.

- [ ] **T3. Keep isolated sea pieces.** FR-163
  - Files: `tools/build-map/src/core/pieces.ts`, `tools/build-map/test/helpers/cleanup-direct.ts`, `tools/build-map/test/pieces.test.ts`.
  - Tests first: plan section 4 fixtures; incremental equals literal loop on all of them and on random fixtures. Mutations proved (no re-push after a sea target; keep land pieces too).
  - Commit: `feat(build-map): keep isolated sea pieces below the minimum size`.
  - Done when: tests green; `rg` finds FR-163.

- [ ] **T4. Build wiring, report and byte compatibility.** FR-164, FR-165, NFR-30
  - Files: `tools/build-map/src/core/{build,report}.ts`, `tools/build-map/test/build.test.ts`.
  - Tests first: plan section 7 `build.test.ts` list (re-pinned mini image, island case, exact report text, byte-identical fixtures from T1).
  - Commit: `feat(build-map): report enclosed water and build with it`.
  - Done when: tests green; FR-164, FR-165, NFR-30 traced.

- [ ] **T5. Rebuild and commit `maps/dev`; link comparison; user review.** FR-166
  - Files: `maps/dev/*`, `tools/build-map/test/{dev-map,rebuild}.test.ts` (sizes and the no-zero-water check).
  - Steps: real build command with `--preview=<scratchpad>`; throw-away comparison of old and new links, ids, names, owners and order; screenshots of the debug scene (from `feat/004-viewer` code, not committed here) or preview crops around La Rochelle, Camargue and Hamburg. **User reviews and accepts** the link differences and the images.
  - Commit: `feat: rebuild the dev map with enclosed water as sea`.
  - Done when: tests green; user accepted; FR-166 traced.

- [ ] **T6. Close: remove pending set, status, memory, PR.** NFR-31
  - Files: `packages/sim/test/traceability.test.ts` (pending set removed; literal counts final), `specs/003c-enclosed-water/spec.md` (status implemented), `MEMORY.md`.
  - Steps: full `npm test` (also `CI=1`), typecheck; push; PR (squash only with the user's OK, CI green); afterwards rebase `feat/004-viewer` onto the merged result and update its T8 (hashes, id ranges 1..166 and 1..31).
  - Commit: `docs: close spec 003c`.
  - Done when: PR green and accepted by the user.
