# Progress 018 — Client-only matches
Per-task log (what changed, tests run and results, what is untested, next step) and the list of existing tests and goldens changed, with the reason (NFR-102).

State: spec approved (2026-11-15); plan and tasks written, awaiting the user's approval. No task started.

## Changed existing tests and goldens (NFR-102)
- T1.3: `packages/protocol/test/public.test.ts` (key list pin gains `clientOnly` after `playerCount`), `packages/protocol/test/encode.test.ts` (`MATCH_SUMMARY_KEYS` pin gains `clientOnly`; summary keys test splits open/client-only): FR-501 adds the optional member.
- T1.1: `packages/protocol/test/errors.test.ts` (ERROR_ORDER now 28 entries), `apps/server/test/http-status.test.ts` (new kind pinned, length 28), `apps/server/test/config-unchanged.test.ts` (011 list compared without `joins-closed`): the kind list gains `joins-closed` by FR-496.

## Task log
### T1.1 — joins-closed (done)
`joins-closed` added to `ERROR_ORDER` after `too-many-matches`, status 403. Tests first: `errors.test.ts` (28 entries, new describe), `http-status.test.ts` (pin + 28), `config-unchanged.test.ts` (011 list now compared without `joins-closed`, plus its position). `npm test` 5433 passed, typecheck green, protected paths clean. Untested: `CI=1` run. Next: T1.2.

### T1.2 — joinPolicy in the creation body (done)
`CREATION_FIELDS` gains `joinPolicy`; `JOIN_POLICIES`/`JoinPolicy` exported; `readCreation` checks it after `requestId` and before unknown fields and the timing rules (so an invalid-timing body already has a valid `joinPolicy`), and returns it in the value only when present. Tests first: `read.test.ts` (4 new), `canonical.test.ts` (1 new). Finding: the HTTP body parser is `JSON.parse`, which collapses duplicate members, so the spec's "duplicate" refusal cannot live in the reader; moved to T3.2 (creation route only) in tasks-M1/M3. Until M3 the server accepts `joinPolicy` and ignores it (not shipped before M3). `npm test` 5438 passed, typecheck green, protected paths clean. Next: T1.3.

### T1.3 — clientOnly in views and summaries (done)
`PublicMatch.clientOnly?: true` after `playerCount` in `PUBLIC_MATCH_KEYS`; `MatchSummary.clientOnly?: true` last in `MATCH_SUMMARY_KEYS`. Encoders write it only for `true` and refuse any other value; `readPublicMatch` refuses `false`, `"true"`, `1`, `null`. Tests first (6 red): public, encode, decode. Finding: there is no match-list decoder in the protocol package (only the encoder), so FR-503's decoder refusal covers `readPublicMatch` only; a summary decoder does not exist and is not added (out of scope). Existing 008/011 SHA pins stay green (bytes of open views unchanged). `npm test` 5444 passed, typecheck green, protected paths clean. Next: T1.4.

### T1.4 — pure policy decisions (done)
`apps/server/src/core/policy.ts`: `creationPolicy`, `joinPolicy`, `submitPolicy` with `PolicyCaller` (`client` + namespace, or `other`). Test `core-policy.test.ts` written first (red: module missing), 9 tests over every caller class and requested value; `core-purity.test.ts` globs the core folder so it covers the new file (green). Mutation proof: `caller.namespace === owner` replaced by `true`, and `joinPolicy` always ok: each made one test fail; file restored. `npm test` 5453 passed, typecheck green, protected paths clean. M1 complete (4/4). Next: M2 T2.1 (schema v3).
