# Progress 022 — Display names for client players
Per-task log (what changed, tests run and results, what is untested, next step) and the list of existing tests and goldens changed, with the reason (NFR-114).

State: spec approved (2026-11-17); plan and tasks approved by the user in this session (2026-11-17, PD1 and PD2 as proposed). M1 done.

## Changed existing tests and goldens (NFR-114)
- M1: none (new test files only).

## Task log
### M1 - Protocol (T1.1, T1.2, done)
`SubmissionBody.name?`, `SUBMISSION_FIELDS` gains `name` (last), `readSubmission` reads it with `readName` after `requestId` and before unknown fields and the player id charset; the value member is present only when sent. Tests first (red): `read-submission-name.test.ts` (6), `canonical-name.test.ts` (3; the digest of a body without name is pinned, `canonicalBody` itself is unchanged). Until M4 the server accepts `name` and ignores it. `npm test` 5627 passed, typecheck green, protected paths clean. Untested: `CI=1`. Next: M2.

### M2 - Pure decisions (T2.1, T2.2, done)
`apps/server/src/core/client-name.ts`: `submissionName(caller, name)` (none / store / refuse `invalid-request` naming `name` for a non-client caller, PD1) and `withClientNames(playerNames, clientNames)` (new map, player names win). The caller type is the existing `PolicyCaller` of 018 (`other` covers player tokens). Test `core-client-name.test.ts` (5); `core-purity.test.ts` covers the new file. Mutation proofs: player branch removed and precedence swapped, each failed one test; restored. Full suite and typecheck green, protected paths clean. Next: M3.

### M3 - Storage (T3.1 to T3.5, done)
Schema version 4: `SCHEMA_V4_ADDITIONS` (`client_names(match_id -> matches, player_id, name, PK (match_id, player_id))`), `TABLES` gains it, `main.ts --check` expects 4. `openStore` creates v1..v4 for a new file and upgrades 1, 2 and 3 in one transaction; no row of an existing table is written, `meta` included. `putClientName` (needs a transaction and an existing match, refuses `player:` and malformed ids, empty names and names over 24 code points; upsert `ON CONFLICT DO UPDATE`), `clientNames` (only ids with a `results` row in the match, groups of ids as `playerNames`), fault wrapper counts the write, `winnersAfter` now LEFT JOINs `players` and `client_names` with `COALESCE`, the purge list gains `client_names`. Tests first (red): `store-upgrade-v4` (v1, v2, v3 fixtures, row equality, atomic failure, version 5 refused), `store-client-names` (14 incl. scored-only, winners, purge on a file db, source scan). Mutation proofs: scored-only condition removed (1 failed), left join made inner (2), purge list without the table (2); restored. The T3.1..T3.5 work is one commit because the schema, the open path and the methods cannot be green apart. Existing tests changed: `store-open.test.ts` (version 4 everywhere, `client_names` in table lists, refused versions 5 and 7), `service-v1-database.test.ts` (version 4, `cutBackToV1` drops `client_names`), `store-upgrade-v3.test.ts` (ends at 4, refuses 5), `lobby-durability.test.ts` (`putClientName` in its write list), `store-client-matches.test.ts` (the interface scan ignores the two 022 methods), all by FR-536. Flaky under full-suite load: `service-restart` and `service-timeline-golden` timed out once in M2 and pass alone. Next: M4.
