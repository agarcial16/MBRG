# Tasks 003c — Enclosed water becomes sea

Branch `feat/003c-enclosed-water`. One task at a time: tests first (red), code, `npm test` and `npm run typecheck` green (also `CI=1`), tick, commit, stop. Mutation proofs use the FULL `npm test`.

- [ ] **T1. Approve plan; amendment notes; traceability ranges and pending set.** NFR-31
  - Files: `specs/003b-builder-and-dev-map/spec.md` (notes only), `packages/sim/test/traceability.test.ts`.
  - Tests first: expected ids are ranges (FR 1..131 and 162..166, NFR 1..23 and 30..31) minus the retired; a pinned pending set holds FR-162..FR-166, NFR-30, NFR-31 and a test (title naming NFR-31) asserts it is exactly that; the old literal-count tests are updated (ids 131+5 = 136, 23+2 = 25, minus 2 retired and minus 7 pending).
  - Capture, before any code change, the byte sizes and SHA-256 of `map.json`, `presentation.json`, `ids.png` and of the outputs of the 003b build fixtures with no enclosed water (kept as literals in T4).
  - Commit: `docs: 003c plan, tasks and traceability ranges`.
  - Done when: tests green; the pending set is pinned.

- [ ] **T2. Enclosed water goes to the nearest zone.** FR-162, FR-164
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
