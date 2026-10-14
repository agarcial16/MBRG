# Tasks 002 — Sea and islands
Plan: `specs/002-sea-and-islands/plan.md`. Prerequisites: spec `Status: approved`; decisions D1-D4 (plan section 12) answered by the user before T1. If any default is rejected, update the plan first.

Rules for every task:
- Work on branch `feat/002-sea-and-islands`, created from an up-to-date `rewrite` (`git pull --ff-only origin rewrite`). Never push to `main` or `rewrite`. One PR into `rewrite` after T10; squash merge only with the user's OK (D2).
- Tests first: write them, run them and see them fail (red) for the right reason, then code. Prove new guards by a temporary mutation when the test could pass vacuously.
- Before each commit: `npm test`, `npm run typecheck`, and `$env:CI='1'; npm test` (PowerShell) all green. Quote the path (it contains spaces).
- Input to validation is typed `unknown` and walked by index: no `forEach`/`every`/`for...of` on possibly sparse input. `src` stays pure (no I/O, DOM, clock, randomness, forbidden imports) and ASCII-only (no spec symbols such as `≥`, `×`, `−` in comments).
- Test titles start with the FR/NFR ids they verify; never FR-6 or FR-25. From T2 on, remove the ids each task covers from `PENDING` in `traceability.test.ts`.
- The four 001 golden files are never edited or regenerated: `git diff --exit-code -- packages/sim/test/golden` must show no change to them. Run `npx vitest -u` only with the `golden-sea.test.ts` file filter (T8).
- Commit: English, conventional prefix, one line <= 72 chars. Tick the task, update `MEMORY.md` locally (gitignored: state, decisions with why, mistakes) and stop. The reviewer validates each task FR by FR.

- [x] **T1. Commit the spec docs; shared entry types and kind rule.** FR-57, FR-58, FR-72
  - Files: `specs/002-sea-and-islands/{spec,plan,tasks}.md` (first commit), `packages/shared/src/{types.ts,kinds.ts,index.ts}`, `packages/sim/src/internal.ts` (`initialState` skips sea zones, forced by the union type), `packages/shared/test/{kinds.test.ts,map-shape.test.ts}`, `packages/sim/test/match.test.ts` (FR-29 test rebuilt as a one-faction map from `mapFrom([1, 1], ...)` expecting `too-few-factions`, no `.owner` assignment).
  - Tests first: `entryKind` per plan section 10 (own `undefined` -> invalid; inherited `kind` via `Object.create` -> land); `isSeaZone`; map-shape FR-2 FR-57 tests on `LandTerritory` and `SeaZone` keys; `initialState` on a hand-built sea map has no sea id and `ownerOf(state, seaId)` is undefined (FR-72).
  - Commits: `docs: add spec, plan and tasks 002 sea and islands`; `feat(shared): add sea zone types and entry kind rule`.
  - Done when: new tests green; typecheck green (every `t.owner` read narrowed); 001 tests and goldens unchanged.

- [x] **T2. FR-64 kind table, remove multiple-initial-territories, retired ids.** FR-64 (table, order), FR-69, FR-60 (validation), NFR-12 (removal), NFR-13
  - Files: `packages/shared/src/{errors.ts,validate-relational.ts,validate.ts}`, `packages/shared/test/{ids.test.ts,validate-relational.test.ts}`, `packages/sim/test/{language.test.ts,traceability.test.ts}`.
  - Tests first: migration rows of plan section 9 for FR-6/FR-25 tests, `FR-10 FR-64` order test, every-relational-kind test, language list without `multiple-initial-territories`; traceability: `RETIRED = ['FR-6', 'FR-25']`, retired-id rejection, list contains FR-81 and NFR-13 and excludes retired ids, extractor self-test (`NFR-6`, `FR-60` never yield `FR-6`), and `PENDING` (002 ids not yet traced).
  - Code: union and `VALIDATION_KIND_ORDER` per FR-64 (new kinds typed, not yet emitted); delete the FR-25 block; `firstPosition` cases for `invalid-kind` and `sea-owner`.
  - Commit: `feat(shared): drop multiple-initial-territories, adopt FR-64 table`.
  - Done when: no title contains FR-6 or FR-25 (`rg "\bFR-(6|25)\b" packages/*/test` finds none in titles); traceability green with `PENDING`.

- [x] **T3. Structural validation of kinds.** FR-58, FR-59, FR-61, FR-64 (structural, blocking marks), FR-65, FR-66 (structural), FR-67, FR-68, NFR-8 (b: no unknown-field for kind, no missing-owner on sea, sea-owner), NFR-12
  - Files: `packages/shared/src/validate-structural.ts`, `packages/shared/test/{validate-sea.test.ts,validate-structural.test.ts}`, `packages/sim/test/language.test.ts` (add `invalid-kind`, `sea-owner` to the literal list and `BAD_MAPS` entries that produce them).
  - Tests first: plan section 10 structural items; every structural kind at once with exact order; `invalid-kind` and `sea-owner` in the `nonBlocking` list; FR-61 sea/invalid-kind entries with bad id or neighbors are blocking; FR-28 no mutation.
  - Code: plan section 4 structural pseudocode; `invalid-kind`/`sea-owner` pushed, never `block`.
  - Commit: `feat(shared): validate entry kinds and sea zone owners`.
  - Done when: structural tests green with exact `toStrictEqual` lists; language test produces every FR-64 kind.

- [x] **T4. Relational validation with sea.** FR-66 (relational), FR-70, FR-71, FR-62 (validation), FR-63 (validation), NFR-8
  - Files: `packages/shared/src/validate-relational.ts`, `packages/shared/test/validate-sea.test.ts`.
  - Tests first: invalid-kind + relational errors in one pass; invalid-kind + blocking elsewhere -> structural only; invalid-kind bridge; owners on sea/invalid-kind never counted; only-sea map; one faction + seas; islands through sea connected; groups with sea ids; one-way land-sea link; moved sea zone; `kind: 'land'` added gives identical results; NFR-8 (a) over the 001 validation fixtures and each (b) difference; D4 inherited owner not counted.
  - Code: factions = own valid owners of land entries (D4); connectivity unchanged.
  - Commit: `feat(shared): count land owners only and connect through sea`.
  - Done when: every validation edge case of the spec has a passing test.

- [x] **T5. Direct absorption candidates (internal operation).** FR-75 (set, order, no weighting), FR-76, FR-81, NFR-7 (candidates)
  - Files: `packages/sim/src/candidates.ts`, `packages/sim/test/{helpers/sea-maps.ts,candidates.test.ts}`.
  - Tests first: island through a shared zone; Denmark mix (G land-only, Sw sea-only, G also on the zone counted once); several shared zones counted once; landlocked faction; unshared coast; lake; bay; one-way land-sea link does not touch; FR-81 shape and not exported from `@mbrg/sim`; NFR-7 `direct` equal to `neighborFactions` for every round of reference matches without sea (hand8, grid, a multi-territory map).
  - Code: plan section 5 direct part; empty group returns `none` (widening comes in T6). Not wired into `playRound` yet.
  - Commit: `feat(sim): add absorption candidates with shared sea zones`.
  - Done when: candidate tests green; public export test unchanged and green.

- [x] **T6. Widening through the sea and isolated faction.** FR-77, FR-78, NFR-9 (exact-distance fixtures)
  - Files: `packages/sim/src/candidates.ts`, `packages/sim/test/candidates.test.ts`.
  - Tests first: widened at exactly distance 1 and exactly 2; open-ocean zones only used while widening; factions found at the same distance all included once, in faction order; `none` on disconnected maps with and without sea zones (map fails only `disconnected-map`).
  - Code: breadth-first loop of plan section 5.
  - Commit: `feat(sim): widen absorption reach one sea hop at a time`.
  - Done when: widening and `none` tests green.

- [x] **T7. Wire candidates into the round engine.** FR-60, FR-62, FR-63 (match), FR-73, FR-74, FR-75 (pick), FR-78 (playRound), FR-79, FR-80, NFR-7
  - Files: `packages/sim/src/internal.ts`, `packages/sim/test/{match-sea.test.ts,golden-sea.test.ts}` (NFR-7 part only).
  - Tests first: plan section 10 `match-sea` list (hand replay of both draws, seeds 0..199; faction order examples; moved sea zone for seeds 0..99; sea never in states/records; T and finish with multi-territory factions; `playRound` -> `isolated-faction` with sea); 001 goldens read raw and compared with `kind: 'land'` on every entry and on every other entry.
  - Code: `playRound` uses `absorptionCandidates(...).factions`; nothing else.
  - Commit: `feat(sim): absorb through land and shared sea zones`.
  - Done when: all tests green; `git diff --exit-code -- packages/sim/test/golden` clean.

- [x] **T8. Golden matches with sea.** NFR-9, FR-51
  - Files: `packages/sim/test/helpers/sea-maps.ts` (4 maps), `packages/sim/test/golden-sea.test.ts`, `packages/sim/test/golden/sea-*.json` (4 new).
  - Tests first: each map valid with its T; property test per pair (i)-(iv) at hard-coded round k (plan section 7), seed S and k found once by a throwaway local search over seeds 0..999 (not committed).
  - Generate: `npx vitest -u packages/sim/test/golden-sea.test.ts`; review every new file; confirm only `sea-*.json` are new and the four 001 files are untouched.
  - Commit: `test(sim): add golden matches with sea zones`.
  - Done when: 4 goldens committed, green with `CI=1`, property tests green.

- [ ] **T9. Fairness, scale and purity with sea.** NFR-10, NFR-11, NFR-12, NFR-1
  - Files: `packages/sim/test/{fairness-sea.test.ts,scale-sea.test.ts,purity.test.ts}` (purity: add a full sea match to the throwing-clock run).
  - Tests first: NFR-10 round-0 candidate assertion then the 10,000-seed distribution within ±5 pp; NFR-11 map per plan section 8 (valid, no land-to-land link, T = 499, < 1000 ms).
  - Commit: `test(sim): add fairness and scale tests with sea zones`.
  - Done when: suites green locally and with `CI=1`.

- [ ] **T10. Traceability, CI and close-out.** NFR-13, done criteria
  - Files: `packages/sim/test/traceability.test.ts` (delete `PENDING`), `specs/002-sea-and-islands/spec.md` (status -> `implemented`, last), `MEMORY.md` (local).
  - Tests first: with `PENDING` removed the check expects FR-1..FR-81 and NFR-1..NFR-13 minus FR-6/FR-25; fix any gap it reports.
  - Then: reviewer validates FR by FR against the spec done criteria; push the branch; open the PR into `rewrite` (issues linked per D3); CI green on the PR; squash merge only after the user's OK.
  - Commits: `test: trace spec 002 requirements`; `docs: mark spec 002 implemented`.
  - Done when: traceability green, CI run linked in the PR, four 001 goldens byte-identical, `MEMORY.md` updated (state, decisions, lessons; drop the obsolete FR-6 lesson).
