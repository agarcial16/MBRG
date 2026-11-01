# Progress 014 — Public match config read
Branch: `feat/014-public-config`. Ledger (done / pending of 12): 1 / 11.

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

### T2 Protocol shape, encoder, decoder, golden (ledger 1 / 11: FR-416)
- Changed: `packages/protocol/src/{wire,encode,decode,index}.ts` (`PublicConfig`, `PUBLIC_CONFIG_KEYS`, `encodePublicConfig`, `readPublicConfig`); `packages/protocol/test/public-config.test.ts` (37 tests); `packages/protocol/test/golden/config-014.json` (made by hand: texts typed, hashes taken from the typed text by a scratch script, not from the encoder); `traceability.test.ts` (FR-416 pending -> done). `purity.test.ts` globs `src/**`, no change needed (the golden hash is taken in the test with `node:crypto`; no crypto in src).
- Decisions (user-approved): flat shape; the decoder refuses a duplicate map (`maps[i]`) and an `enabled` that disagrees with `maps`. The encoder also refuses both, an extra or inherited key (throws `RangeError`, like the other encoders) so nothing outside the list reaches the text.
- Tests: red first (36 of 37 failed before the code). Green: `npm test` 304 files / 4840 passed / 4 skipped; typecheck green; `CI=1 npm test` same.
- Mutations (full `npm test` each, restored byte for byte): two keys swapped in `PUBLIC_CONFIG_KEYS` -> 8 failures (key list, 3 text, literal, SHA pins); `enabled` dropped from the written keys -> text and SHA tests fail; decoder key set widened to the input's own keys -> "refuses an unknown field"; decoder `isMapId` skipped -> "map id of a bad shape"; encoder `JSON.stringify(config)` -> "key order whatever the input order" and "refuses a value out of shape".
- Untested: nothing server-side yet. Next: T3 (service read, FR-414).
