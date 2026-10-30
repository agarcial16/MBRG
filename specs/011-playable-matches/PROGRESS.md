# Progress 011 — Playable matches
Per-task log (what changed, tests run and results, what is untested, next step). Also the list of existing tests and goldens changed, with the reason (NFR-75).

State: spec approved (2026-10-30); plan and tasks drafted, waiting for the user's approval and the answers to plan section 15. No code written.

## Changed existing tests and goldens (NFR-75)
(none yet)

## M1 T1 — Ledger extension (2026-10-30)
- Changed: `packages/sim/test/traceability.test.ts` only. Ranges FR 1..392, NFR 1..76; counts 437 -> 466 (everything 439 -> 468); `PENDING_011` literal 29 ids, `DONE_011 = []`; 3 new tests (29-id pin, no pending id already traced, planted-id detection); the "every expected id appears" filter excludes `PENDING_011`. The old "FR-369/NFR-72 not expected" assertion became "expected" (with FR-393/NFR-77 not expected). Ledger 0 / 29.
- Tests: full `npm test` 249 files, 4082 passed, 4 skipped; `npm run typecheck` clean; `CI=1 npm test` same; title-rule scan finds nothing.
- Mutation proofs (full suite): removing FR-380 from the literal -> pin test and "every expected id" test fail; planting FR-380 in a title -> "already traced" test fails. Both restored.
- Untested: nothing beyond the ledger. Next: T2 (protocol forced mark and `forced-absorber` error).
