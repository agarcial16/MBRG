### M2 — History read (3 / 5)
Plan sections 3, 4, 5, 6 (PD1, PD3, PD4). Depends on M1.

- [x] **T2.1. Protocol of the history read.** FR-573 (shape part), FR-549 (cursor part), FR-550 (wire part)
  - Files: `packages/protocol/src/page.ts` (list `history`), `read.ts` (`readHistoryRequest`), `encode.ts`, `decode.ts`, `wire.ts`, tests in `packages/protocol/test/`.
  - Done when (red first): the request reader accepts `{ community, playerId?, limit?, cursor? }` (limit 1 to 500, default 100; local `playerId`), refuses unknown members and malformed values by name; a `history` cursor round-trips and is refused for another list or a re-encoded text; entries and pages encode and decode (`total` required, `asker` only as `{ points, rank }` or `{ played: false }`), an entry with a member outside the plan is refused.
- [x] **T2.2. Pure history core.** FR-550, FR-551, FR-561 (selection part)
  - Files: `apps/server/src/core/history.ts`, `apps/server/test/core-history.test.ts`, `core-purity.test.ts` (adds the file).
  - Done when: order is finish instant descending then match id; `withinSnapshot` keeps exactly the keys at or after the head; the top 5 holds only rows above 0 points in leaderboard order and `more` counts the rest above 0 (ties at the 5th place included); player count counts 0-point rows; the asker gets their row (0 points included) or `played: false`; a match with only 0-point rows has an empty top 5.
- [x] **T2.3. Store reads.** FR-549, FR-561, NFR-121 (store part)
  - Files: `apps/server/src/store/sqlite.ts`, `store.ts`, store tests.
  - Done when: `historyAfter` and `historyCount` return only `finished` matches of the key and namespace (lobby, expired, running and halted ones of the same key never), in history order, keyset after a key and bounded by a head; `last_step_ms` of a finished match equals the instant of its last `application` step (pinned); `EXPLAIN QUERY PLAN` shows no `SCAN` of `matches`, `results` or `communities`.
- [ ] **T2.4. Service and route `POST /history`.** FR-549, FR-551, FR-552, FR-553, FR-573
  - Files: `apps/server/src/service/matches.ts`, `apps/server/src/http/server.ts`, new `apps/server/test/http-history.test.ts`.
  - Done when (real server): a client credential reads pages of 5 with `total`; a walk across a match that finishes in between keeps its pages and `total` and never repeats or skips; anonymous, player and operator callers get `forbidden` (same bytes as another forbidden reply); another namespace and an unknown key get `{ items: [], total: 0 }`; a request with any query text is `invalid-request` and nothing in a query is read; nothing is stored or memoised; the request log lines and replies contain no key (log scan).
- [ ] **T2.5. Twins: secrecy, isolation, compatibility, bounded work.** NFR-117, NFR-118, NFR-119, NFR-120, NFR-121 (bounded work), FR-561
  - Files: new `apps/server/test/history-secrecy.test.ts`, `history-isolation.test.ts`, `history-bounds.test.ts`; `server-log-scan.test.ts`, source scan.
  - Done when: with a running match of the same community (predictions stored and scored), every history reply before and after each of its steps equals the twin's without it, byte for byte; two keys × two namespaces never mix; a source scan finds `communities` read only by the history reads; every existing golden and the 008/011/018/022 secrecy tests are green and unchanged; one page costs the same statement count with 10 and 1,000 counted matches (a counting store wrapper).
