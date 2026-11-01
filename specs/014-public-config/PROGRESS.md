# Progress 014 — Public match config read
Branch: `feat/014-public-config`. Ledger (done / pending of 12): 0 / 12.

Entry format per task: what changed · tests run and results · mutation proofs (mutant -> test that failed) · untested · next step.

## Protected files and goldens
No re-pin expected (plan section 1). Record here any exception with its reason.

## Log
(empty)

### T1 Bookkeeping targets (ledger 0 / 12)
- Changed: `packages/sim/test/traceability.test.ts` only: `FR_RANGES` `[[1,392],[413,421]]`, `NFR_RANGES` `[[1,76],[81,83]]`; `PENDING_014` (12 literal ids) and empty `DONE_014` with the targets of the table; totals 468 / 466 / 466 became 480 / 478 / 478 (also the independent list test); `PENDING_014` joins the "every id has a test name" exclusion; two new tests (12 literal ids, no overlap, every done id has a title, no pending id already traced).
- Tests: red first (the pinned 468 failed after the ranges moved; one list-order failure fixed in the independent list). Final: `npm test` 302/303 files; the one failure (`service-players-flow`, 4 tests) passes alone in 1.9 s (load flake, same as the known timeouts under CPU load); `CI=1 npm test` 303 files / 4803 passed / 4 skipped; typecheck green.
- Mutations (full `npm test`, restored byte for byte): `FR-421` dropped from `PENDING_014` -> the 12-ids test and the "every expected id has a test name" test failed; `FR-413` in both lists -> the 12-ids test and the closed/pending test failed.
- Untested: nothing new. Next: T2 (FR-416).
