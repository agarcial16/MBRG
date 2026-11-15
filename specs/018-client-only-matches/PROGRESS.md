# Progress 018 — Client-only matches
Per-task log (what changed, tests run and results, what is untested, next step) and the list of existing tests and goldens changed, with the reason (NFR-102).

State: spec approved (2026-11-15); plan and tasks written, awaiting the user's approval. No task started.

## Changed existing tests and goldens (NFR-102)
- T1.1: `packages/protocol/test/errors.test.ts` (ERROR_ORDER now 28 entries), `apps/server/test/http-status.test.ts` (new kind pinned, length 28), `apps/server/test/config-unchanged.test.ts` (011 list compared without `joins-closed`): the kind list gains `joins-closed` by FR-496.

## Task log
### T1.1 — joins-closed (done)
`joins-closed` added to `ERROR_ORDER` after `too-many-matches`, status 403. Tests first: `errors.test.ts` (28 entries, new describe), `http-status.test.ts` (pin + 28), `config-unchanged.test.ts` (011 list now compared without `joins-closed`, plus its position). `npm test` 5433 passed, typecheck green, protected paths clean. Untested: `CI=1` run. Next: T1.2.
