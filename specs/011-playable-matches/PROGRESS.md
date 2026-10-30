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

## M1 T2 — Protocol: the forced mark and the `forced-absorber` kind (2026-10-30)
- Changed: `packages/protocol/src/{wire,errors,public,encode,decode}.ts` (`PublicVictim.forced?: true` after `a`, before `seq`; `victim-revealed` writes it after `a`, before `reportedTime`; `forced-absorber` between `prediction-closed` and `invalid-choice`; encoders and readers accept `true` only, `false`/other values refused; absent when not forced), `apps/server/src/http/status.ts` (409). `index.ts` needed no change (it re-exports the arrays).
- Tests written first and seen red (20 failures) before any source: `errors`, `public`, `encode-events`, `decode`, `encode` (protocol), `http-status` (server). SHA-256 pins of one 008 `PublicVictim` and one 008 `victim-revealed` frame. Type-level key test now also covers `PUBLIC_VICTIM_KEYS` (includes `forced`, no secret-looking key).
- Existing tests edited (NFR-75): `errors.test` (list 22 -> 23 entries), `http-status.test` (PINNED table, length 23), `public.test` (key list; nested-key order test filters `forced` for an unforced victim), `encode-events.test` (EVENT_KEYS pin; key-order test filters `forced`), all because of the new key/kind.
- Results: `npm test` 249 files, 4097 passed, 4 skipped; `npm run typecheck` clean; `CI=1 npm test` same; title-rule scan and protected-path diff clean.
- Mutation proofs (full suite, restored by byte compare): `forced` written first (4 fail), `false` accepted in encoders/readers (6 fail), `forced-absorber` after `invalid-choice` (3 fail), status 422 (2 fail).
- Untested: the core does not set `forced` yet (T4); no server path returns the new kind yet. Next: T3 (setting F).
