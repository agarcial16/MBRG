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
