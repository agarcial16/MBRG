# Tasks 001 — Foundations
Plan: `specs/001-foundations/plan.md`. Prerequisites met: spec `Status: approved`; decisions D1-D5 resolved (plan §11); FR-3 holds the id rule (D1). No task is blocked.

Rules for every task: one `feat/...` (or `chore/...`) branch and PR into `rewrite`; tests first (red), then code; `npm test` and `npm run typecheck` green before commit; English one-line conventional commit; test names start with the FR/NFR id; tick the task; update `MEMORY.md` (state, decisions with why, mistakes) and stop.

- [x] **T1. Workspace scaffold and CI.** FR-55, FR-56
  - Files: `package.json` (workspaces `packages/*`, scripts `test` = `vitest run`, `typecheck`), `package-lock.json`, `.nvmrc`, `tsconfig.base.json`, `tsconfig.test.json`, `vitest.config.ts`, `packages/shared/{package.json,tsconfig.json,src/index.ts}`, `packages/sim/{package.json,tsconfig.json,src/index.ts}`, `.github/workflows/ci.yml`.
  - Tests first: `packages/sim/test/smoke.test.ts` imports `@mbrg/shared` from `@mbrg/sim` side to prove workspace resolution.
  - Also: delete stale legacy `node_modules/` before the first `npm install` (authorized, D5); `.nvmrc` = 24 and only `typescript` + `vitest` as devDependencies (D4); fix `MEMORY.md` roadmap wording "sim ported" -> "sim rewritten from scratch".
  - Commit: `chore: scaffold workspaces, vitest and ci workflow`.
  - Done when: `npm ci`, `npm test`, `npm run typecheck` pass locally; the PR shows the CI check running and passing.

- [x] **T2. Shared types, ids and error types.** FR-1, FR-2, FR-3, FR-8, FR-10
  - Files: `packages/shared/src/{types.ts,ids.ts,errors.ts,index.ts}`, `packages/shared/test/ids.test.ts`.
  - Id rule (spec FR-3, D1): number type, integer 1..16,777,215 inclusive, 0 reserved; same rule for territory and faction ids; no new error kind (invalid ids surface through `invalid-territory-id`, `invalid-neighbors`, `invalid-owner` in T3).
  - Tests first: `isValidId` accepts 1, 16,777,215; rejects 0, -0, -1, 16,777,216, 1.5, NaN, ±Infinity, "1", "", null, true, [], {}.
  - Commit: `feat(shared): add map types, id rule and error types`.
  - Done when: id tests green (named `FR-3 ...`); `ValidationError` union matches the FR-10 table (kind names literal) with no extra kind.

- [x] **T3. Structural validation.** FR-4, FR-9, FR-11, FR-12, FR-13, FR-14, FR-15, FR-16, FR-17, FR-18, FR-19, FR-20, FR-28
  - Files: `packages/shared/src/{validate.ts,validate-structural.ts}`, `packages/shared/test/validate-structural.test.ts`.
  - Tests first: one test per structural kind; "every structural kind at once" map with exact list and order; blocking stops relational phase (stub relational returns nothing yet); `version` + extra `name` field -> two `unknown-field`; input deep-equal to a `structuredClone` taken before (FR-28); non-object inputs (`null`, `[]`, `3`) -> only `invalid-map`.
  - Commit: `feat(shared): add structural map validation`.
  - Done when: all structural tests green with exact `toStrictEqual` error lists.

- [x] **T4. Relational validation and error ordering.** FR-5, FR-6, FR-7, FR-9, FR-11, FR-21, FR-22, FR-23, FR-24, FR-25, FR-26, FR-27, FR-29 (validation side)
  - Files: `packages/shared/src/{validate-relational.ts,validate.ts}`, `packages/shared/test/validate-relational.test.ts`.
  - Tests first: one test per relational kind; "every relational kind at once" map with exact order; 3-group disconnected map; one-way A->B map gives `asymmetric-adjacency` + `disconnected-map` [[A],[B]]; unknown neighbor gives no asymmetric error; empty list -> only `too-few-factions` 0; single territory -> only `too-few-factions` 1; faction id equal to a territory id is valid (FR-8); structural non-blocking + relational errors merged in FR-11 order.
  - Commit: `feat(shared): add relational map validation`.
  - Done when: every validation edge case of the spec has a passing test.

- [x] **T5. Seeded PRNG and uniform pick.** FR-52, FR-35, FR-36 (pick primitive), NFR-2 (PRNG golden)
  - Files: `packages/sim/src/rng.ts`, `packages/sim/test/rng.test.ts`, `packages/sim/test/golden/__snapshots__` or `golden/sfc32-seed0.json`.
  - Tests first: same `(seed, round)` gives the same sequence; different rounds differ; outputs are uint32; `pickIndex(rng, 1)` is 0; `pickIndex` always in range; first 8 outputs of `roundRng(0, 1)` match a file snapshot.
  - Commit: `feat(sim): add sfc32 prng and unbiased index pick`.
  - Done when: rng tests green and the PRNG golden is committed.

- [x] **T6. Round engine (internal).** FR-30, FR-33, FR-34, FR-35, FR-36, FR-37, FR-38, FR-39, FR-40, FR-49
  - Files: `packages/sim/src/{types.ts,internal.ts}`, `packages/sim/test/helpers/maps.ts`, `packages/sim/test/internal.test.ts`.
  - Tests first: `initialState` = map owners, `mode: 'classic'`, round 0; `playRound` on a 2-faction map gives the only possible outcome; absorber is always a mutual neighbor faction; neighbor factions are the union over all territories; transferred ids in map order and only those change; accumulated territories move together when an absorber is later eliminated; isolated faction via a hand-built map that fails only `disconnected-map` -> `isolated-faction` with faction and round, no partial state; no `seed` key in state or record; `ownerOf` lookup.
  - Commit: `feat(sim): add classic round engine`.
  - Done when: internal tests green; `internal.ts` is not re-exported from `src/index.ts`.

- [x] **T7. Public match API and input checks.** FR-29, FR-31, FR-32, FR-41, FR-42, FR-43, FR-44, FR-45, FR-46, FR-47, FR-48, FR-53
  - Files: `packages/sim/src/{inputs.ts,match.ts,index.ts}`, `packages/sim/test/match.test.ts`.
  - Tests first: `totalRounds` = factions − 1 and error on invalid map; seeds 0, -0, 4,294,967,295 valid (-0 same result as 0); seeds -1, 4,294,967,296, 1.5, NaN, Infinity, "42", null -> `invalid-seed`; rounds -0 ok, 1.5, NaN, Infinity, "2" -> `invalid-round`; T+1 -> `round-out-of-range` {round, total}; invalid map + seed + round -> map errors, `invalid-seed`, `invalid-round`, no out-of-range; round 0 -> initial state and `[]`; round T -> single owner; results contain only rounds 0..N (key set and length); JSON round-trip `toStrictEqual` with number ids.
  - Commit: `feat(sim): add getState, getRounds and totalRounds`.
  - Done when: match API tests green; public exports limited to the plan §6 list.

- [x] **T8. Golden matches and determinism.** FR-7, FR-50, FR-51, FR-54, NFR-2
  - Files: `packages/sim/test/golden.test.ts`, `packages/sim/test/golden/*.json` (3+ pairs per plan §9).
  - Tests first: each golden pair matches its file snapshot (generated once with `npx vitest -u`, diff reviewed, 2-faction one also asserted by hand); for one reference match, `getState(N)` equals round-0 state plus records 1..N for every N (FR-54); requests 5, 2, 5 and a shuffled order equal fresh requests (FR-50); a reordered map differs from the original for at least one seed in 0..99 (FR-7).
  - Commit: `test(sim): add golden matches and determinism checks`.
  - Done when: goldens committed and CI passes without `-u` (CI never writes snapshots).

- [x] **T9. Non-functional tests.** NFR-1, NFR-3, NFR-4, NFR-5, NFR-6, FR-52
  - Files: `packages/sim/test/{fairness,scale,purity,language}.test.ts`, `tsconfig.test.json` (`vite/client` types if not added in T1).
  - Tests first: fairness on the 6-ring + chord map, seeds 0..9,999, bounds ±3 pp (rounds 1 and 2 elimination) and ±5 pp (round-1 absorber); scale on 20×25 grid < 1000 ms; purity with throwing `Math.random`, `Date.now`, `performance`, `crypto` plus raw-source scan of `shared/src` and `sim/src`; language: every error kind produced across fixtures is in a literal list copied from the spec; anti-spoiler: no seed in outputs (NFR-4 via FR-48/FR-49 assertions).
  - Commit: `test(sim): add fairness, scale, purity and language tests`.
  - Done when: all four suites green locally and in CI.

- [x] **T10. Traceability (commits done; CI demo pending gh auth), CI demonstration and close-out.** FR-55, FR-56, done criteria
  - Files: `packages/sim/test/traceability.test.ts`, `specs/001-foundations/spec.md` (status -> `implemented`, at the end), `MEMORY.md`.
  - Tests first: traceability test reads all test sources (raw glob) and asserts every FR-1..FR-54 and NFR-1..NFR-6 id appears in a test name; fails listing missing ids.
  - CI demo: open one passing PR and one PR with an intentionally failing test; screenshot/link of the failed check; close the failing PR unmerged.
  - Commit: `test: add requirement traceability check`; `docs: mark spec 001 implemented`.
  - Done when: traceability test green, both CI runs linked in the PR description, `MEMORY.md` updated with state, decisions and lessons of spec 001.
  - Progress: [x] `traceability.test.ts` written and green (also checks the `ci.yml` config for FR-55/FR-56); [x] missing coverage added (`packages/shared/test/map-shape.test.ts` for FR-1, FR-2); [x] `MEMORY.md` updated.
  - Done: [x] commits; [x] reviewer validation (approved); [x] spec status -> `implemented`. Pending: [ ] push, PRs and CI demo (blocked: `gh` not authenticated, run `gh auth login`).
