# Progress 018 — Client-only matches
Per-task log (what changed, tests run and results, what is untested, next step) and the list of existing tests and goldens changed, with the reason (NFR-102).

State: spec approved (2026-11-15); plan and tasks written, awaiting the user's approval. No task started.

## Changed existing tests and goldens (NFR-102)
- T1.1: `packages/protocol/test/errors.test.ts` (ERROR_ORDER now 28 entries), `apps/server/test/http-status.test.ts` (new kind pinned, length 28), `apps/server/test/config-unchanged.test.ts` (011 list compared without `joins-closed`): the kind list gains `joins-closed` by FR-496.

## Task log
### T1.1 — joins-closed (done)
`joins-closed` added to `ERROR_ORDER` after `too-many-matches`, status 403. Tests first: `errors.test.ts` (28 entries, new describe), `http-status.test.ts` (pin + 28), `config-unchanged.test.ts` (011 list now compared without `joins-closed`, plus its position). `npm test` 5433 passed, typecheck green, protected paths clean. Untested: `CI=1` run. Next: T1.2.

### T1.2 — joinPolicy in the creation body (done)
`CREATION_FIELDS` gains `joinPolicy`; `JOIN_POLICIES`/`JoinPolicy` exported; `readCreation` checks it after `requestId` and before unknown fields and the timing rules (so an invalid-timing body already has a valid `joinPolicy`), and returns it in the value only when present. Tests first: `read.test.ts` (4 new), `canonical.test.ts` (1 new). Finding: the HTTP body parser is `JSON.parse`, which collapses duplicate members, so the spec's "duplicate" refusal cannot live in the reader; moved to T3.2 (creation route only) in tasks-M1/M3. Until M3 the server accepts `joinPolicy` and ignores it (not shipped before M3). `npm test` 5438 passed, typecheck green, protected paths clean. Next: T1.3.
