### M1 — Key at creation and schema v5 (1 / 4)
Plan sections 1, 2, 6 (PD2, PD6). No dependency.

- [x] **T1.1. Ledger and `community` in the creation body.** FR-546, NFR-120
  - Files: `packages/sim/test/traceability.test.ts` (ranges FR-545..562, FR-573, NFR-117..122; `PENDING_024`), `packages/protocol/src/wire.ts`, `read.ts`, `apps/server/src/http/body.ts`, tests in `packages/protocol/test/` and `apps/server/test/http-body*.test.ts`.
  - Done when (red first): a body with 64 lowercase hex `community` returns it (member present only when sent); uppercase, 63/65 characters, non-hex, non-string are `invalid-request` naming `community`; a repeated member is refused by name; a body without it returns exactly the old value and `canonicalBody` and its digest equal the literals pinned from `main`; the ledger is green with the ids pending.
- [ ] **T1.2. Creation policy with the key.** FR-545
  - Files: `apps/server/src/core/policy.ts`, `apps/server/test/core-policy.test.ts`.
  - Done when: a client credential with `joinPolicy: 'client'` and a key is accepted and the decision carries the key; the key without `joinPolicy: 'client'`, from a player, an anonymous caller or on the operator path is `invalid-request` naming `community`; every 018 policy test is unchanged and green.
- [ ] **T1.3. Schema v5 and community storage.** FR-560, FR-547
  - Files: `apps/server/src/store/schema.ts`, `sqlite.ts`, `store.ts`, `faults.ts` if it lists writes, store tests.
  - Done when: a fresh file is v5 with `communities` and its index; v1, v2, v3 and v4 files upgrade in place with no row of an existing table rewritten (row digests of every old table equal before and after); a v6 file is refused; `insertCommunity` refuses a missing match, a second row, a malformed key and a call outside a transaction (`invalid-write`); the store has no method that changes or removes a row; `purgeExpired` removes the row with its expired lobby and keeps it for a started match.
- [ ] **T1.4. Key stored at creation (service and HTTP).** FR-545, FR-547 (restart part)
  - Files: `apps/server/src/service/matches.ts` (`createPublic`/`decidePublic`), `apps/server/test/http-client-create.test.ts` or a new `http-community-create.test.ts`.
  - Done when (real server): a client creation with a key stores one row in the same transaction as the match (a `failWrite` inside the transaction leaves neither); a refused creation stores nothing; a memo replay with the same body returns the same reply and writes nothing; the same `requestId` with a different key is `request-id-reused`; after a restart the row is unchanged (closed-file read); creation replies and events carry no key (byte scan).
