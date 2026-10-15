# Tasks 003a — Map package contracts
Plan: `specs/003a-map-package-contracts/plan.md`. Prerequisites: spec `Status: approved`; plan and tasks approved by the user; user decisions of plan section 12 applied. Any later change goes to the spec first, then the plan, then these tasks.

Rules for every task:
- Tasks tracked in this `tasks.md` (no GitHub issues), single PR on branch `feat/003a-map-package-contracts`, created from an up-to-date `rewrite` (`git pull --ff-only origin rewrite`). Never push to `main` or `rewrite`. One commit per task; the PR into `rewrite` is opened after T10; squash merge only with the user's OK.
- Tests first: write them, run them and see them fail (red) for the right reason, then code. Prove new guards by a temporary mutation when a test could pass vacuously (back the file up first; never `git checkout` a file with uncommitted edits).
- Before each commit: `npm test`, `npm run typecheck`, and `$env:CI='1'; npm test` (PowerShell) all green. Quote the path (it contains spaces).
- Inputs are typed `unknown` and walked by index: no `forEach`/`every`/`for...of` on possibly sparse input lists or pixel arrays. Own-property reads only (`Object.hasOwn`). `src` stays pure (no I/O, DOM, clock, randomness) and ASCII-only: special code points as `\u` escapes.
- Test titles start with the FR/NFR ids they verify; never FR-6 or FR-25; meta-test titles name no real id. Until T9, check each task's ids with `rg -n "(it|test|describe)\(['\"\`][^'\"\`]*\bFR-NN\b" packages/*/test`.
- Do not edit `packages/sim/src`, the 001/002 files of `packages/shared/src` (`types, errors, ids, kinds, validate, validate-structural, validate-relational`), any golden, or any 001/002 test file except `packages/sim/test/traceability.test.ts` in T9 (NFR-22; `language.test.ts` and `purity.test.ts` stay untouched).
- Commit: English, conventional prefix, one line <= 72 chars. Tick the task, update `MEMORY.md` locally (gitignored: state, decisions with why, mistakes) and stop. The reviewer validates each task FR by FR.

- [x] **T1. Commit the spec docs; package types, error kinds and the name and colour rules.** FR-84, FR-85, FR-86, FR-87, FR-88, FR-92 (kinds, data fields, order constant)
  - Files: `specs/003a-map-package-contracts/{spec,plan,tasks}.md` (first commit; 003b stays untracked), `packages/shared/src/{package-types.ts,package-errors.ts,names.ts,index.ts}`, `packages/shared/test/{names.test.ts,helpers/package-fixtures.ts}`.
  - Tests first: plan section 10 `names.test.ts` list (every invalid and valid name edge case, the 66 noncharacters, an unassigned non-noncharacter accepted, U+2FFC not Cn on the runtime); every FR-88 colour case; `PRESENTATION_KIND_ORDER` equals the FR-92 table literally.
  - Code: plan sections 3 and 4; additive exports only.
  - Commits: `docs: add spec, plan and tasks 003a map package contracts`; `feat(shared): add presentation types and name and color rules`.
  - Done when: name and colour tests green; `index.ts` diff is additive only; `rg` finds FR-87 and FR-88 in titles.

- [x] **T2. Presentation check, structural phase.** FR-84, FR-85, FR-86, FR-89, FR-91, FR-92, FR-93 (structural, blocking), FR-94 (structural order), FR-95, FR-96, FR-97, FR-98, FR-99
  - Files: `packages/shared/src/presentation.ts`, `packages/shared/test/presentation-structural.test.ts`, `packages/shared/test/helpers/package-fixtures.ts`.
  - Tests first: plan section 10 `presentation-structural` list; each structural kind alone with exact data fields; "`id` if valid" omitted (key absent, not undefined); every structural kind except `invalid-presentation` at once with exact order, including the 7/3 duplicate first-position example; inherited `name`/`color`; invalid map -> exactly `validateMap` errors.
  - Code: plan section 5 up to the blocking decision; relational phase returns nothing yet (valid data -> `ok`).
  - Commit: `feat(shared): check presentation data structure`.
  - Done when: structural tests green with `toStrictEqual`; `rg` finds every id of this task in titles.

- [x] **T3. Presentation check, relational phase.** FR-90, FR-93 (relational, skip rule), FR-94 (relational order), FR-100, FR-101, FR-102, FR-103
  - Files: `packages/shared/src/{faction-order.ts,presentation.ts}`, `packages/shared/test/presentation-relational.test.ts`.
  - Tests first: plan section 10 `presentation-relational` list; sea zone entry required; faction id equal to a territory id -> unknown; participation rules of FR-102/FR-103; "España"/"españa" not duplicates; faction name equal to a territory name valid; repeated territory names valid; every relational kind at once with exact order; shuffled lists give the same result; duplicates + unknown id -> structural only.
  - Code: plan section 5 relational part; `factionOrder` = first appearance of own valid owners of land entries.
  - Commit: `feat(shared): cross-check presentation data with the map`.
  - Done when: relational tests green; every presentation edge case of the spec has a passing test.

- [x] **T4. Pixel value encode and decode.** FR-106
  - Files: `packages/shared/src/{pixel-codec.ts,index.ts}`, `packages/shared/test/pixel-codec.test.ts`.
  - Tests first: the seven listed pairs both ways; both round-trip properties per plan section 6; out-of-domain values (16,777,216, −1, 1.5, −0, NaN, Infinity, `"1"`, null, BigInt) and channels (256, −1, 1.5, NaN, `"0"`, −0) -> `invalid-image`, no value, never clamped or wrapped.
  - Code: plan section 6.
  - Commit: `feat(shared): add id image pixel encode and decode`.
  - Done when: codec tests green; `rg` finds FR-106 in titles.

- [x] **T5. Image input validation and the contact function.** FR-108 (contact function), FR-110 (`invalid-image` condition)
  - Files: `packages/shared/src/{image-input.ts,contact.ts,index.ts}`, `packages/shared/test/contact.test.ts`.
  - Tests first: quadripoint `AB/CD` -> exactly A-B, A-C, B-D, C-D; `A.B` -> none; single 4-adjacent pair; several pieces (union); ids not in any map still paired; plain list and `Uint32Array` give equal results; sorted output with `a < b`; every `invalid-image` input of the spec edge cases (W x H mismatch, 16,777,216, −1, 1.5, −0, NaN, `"1"`, BigInt, sparse hole, W `"2"`, plain object, W or H 0).
  - Code: plan section 7 `imageInputError` and `contactPairs`.
  - Commit: `feat(shared): derive pixel contact pairs from id images`.
  - Done when: contact tests green; `rg` finds FR-108 and FR-110 in titles.

- [ ] **T6. Id image check against the map.** FR-107, FR-108 (adjacency equals contact), FR-109, FR-110
  - Files: `packages/shared/src/{id-image.ts,index.ts}`, `packages/shared/test/id-image.test.ts`, `packages/shared/test/helpers/package-fixtures.ts`.
  - Tests first: plan section 10 `id-image` list; each kind with exact data fields; all kinds at once in table order; adjacency errors ordered by map position of `a`, then `b` (a fixture whose map order differs from id order); invalid map -> map errors only; `invalid-image` reported alone; quadripoint with A-D linked -> `extra-adjacency`; strait drawn as a sea zone valid, direct link across it -> `extra-adjacency`; single pair unlinked -> `missing-adjacency`; exclave valid; unknown id U touching A and B -> one `unknown-pixel-id`, no adjacency error with U; linked entry without pixels -> `missing-territory-pixels` + one `extra-adjacency` per link; same image against a map with other links.
  - Code: plan section 7 `checkIdImage`, using `contactPairs`.
  - Commit: `feat(shared): check id images against the map`.
  - Done when: id image tests green; every id image edge case of the spec has a passing test.

- [ ] **T7. Map package tests and no modification.** FR-82, FR-83, FR-104
  - Files: `packages/shared/test/{map-package.test.ts,helpers/package-fixtures.ts}`.
  - Tests first: FR-82 valid package fixture: `validateMap`, `checkPresentation`, `checkIdImage` each `ok`, inputs deep-equal to `structuredClone` copies taken before; same map with `name` or `color` on an entry -> `unknown-field`. FR-83 presentation with top-level `seed` and `round` -> one `presentation-unknown-field` each; map with top-level `round` -> `unknown-field`; both checks called twice return equal results. FR-104 deep-frozen map, presentation and pixels given to every check and function (valid and invalid inputs) never throw and stay deep-equal.
  - Code: none expected; fix any mutation found.
  - Commit: `test(shared): verify the map package contract`.
  - Done when: tests green; `rg` finds FR-82, FR-83, FR-104 in titles.

- [ ] **T8. Purity and language of the new contracts.** NFR-15, NFR-18
  - Files: `packages/shared/test/{package-purity.test.ts,package-language.test.ts}` (new). `packages/sim/test/{language.test.ts,purity.test.ts}` stay untouched.
  - Tests first: NFR-15 every new `src` file matches the glob `shared/src/**/*.ts` that the existing 002 scan already uses (so it is scanned without editing `purity.test.ts`); run-time test calls `checkPresentation`, `checkIdImage`, `encodePixel`, `decodePixel`, `contactPairs`, `isValidName`, `isValidColor` on valid and invalid inputs with `Math.random`, `Date.now`, `performance.now`, `crypto` replaced by throwing functions. NFR-18 literal lists of every new kind (FR-92, FR-110) and data field name (`list`, `position`, `positions`, `id`, `location`, `at`, `field`, `name`, `factions`, `color`, `pixelCount`, `firstPixel`, `x`, `y`, `territory`, `a`, `b`), copied from the spec (not imported); bad inputs produce every kind; every key of every produced error is in the list; no `colour`.
  - Commit: `test(shared): purity and language of map package checks`.
  - Done when: both suites green; the existing 002 purity scan and ASCII check pass over the new sources; `git diff rewrite -- packages/sim/test/language.test.ts packages/sim/test/purity.test.ts` is empty.

- [ ] **T9. Traceability to FR-131/NFR-23 with the 003b pending set; no regression.** NFR-19, NFR-22
  - Files: `packages/sim/test/traceability.test.ts` (only the edits of plan section 9), `packages/shared/test/no-regression.test.ts` (new).
  - Tests first: plan section 9 titles: expected list ends at FR-131/NFR-23 minus retired minus pending; pending set equals exactly the 28 ids of 003b; self-trace pin exactly FR-55, FR-56, NFR-13, NFR-19; NFR-22 public surface: `@mbrg/sim` exports exactly `MODE, getRounds, getState, ownerOf, totalRounds`, `@mbrg/shared` keeps every pre-003a runtime export and its full export list equals that plus exactly the 003a additions (goldens stay guarded by the existing golden tests). Prove the check by temporarily renaming one 003a title (reported missing) and planting a pending id removal (pin fails), then revert.
  - Commit: `test: trace spec 003a requirements`.
  - Done when: traceability and NFR-22 tests green with every 003a id required; process check: `git diff --exit-code rewrite -- packages/sim/src packages/sim/test/golden` and the 001/002 shared `src` files are clean; `git diff --stat rewrite -- packages/*/test` shows only new files plus `traceability.test.ts`.

- [ ] **T10. Close-out.** Done criteria
  - Files: `specs/003a-map-package-contracts/spec.md` (status -> `implemented`, last, after review), `MEMORY.md` (local).
  - Steps: reviewer validates FR by FR against the spec done criteria; push the branch; open the single PR into `rewrite` (description lists T1..T10 from this file); CI green on the PR; squash merge only after the user's OK.
  - Commit: `docs: mark spec 003a implemented`.
  - Done when: CI run linked in the PR is green; NFR-22 process check of T9 repeated clean; no dependency added (`package.json` and lockfile unchanged); goldens byte-identical; `MEMORY.md` updated (state, decisions with why, lessons; next step 003b QA).
