### M1 — Protocol and pure decisions (0 / 4)
Plan sections 2, 4, 6. Nothing here reads or writes storage; the server compiles and behaves as before.

- [ ] **T1.1. Error kind `joins-closed`, order and status.** FR-496
  - Files: `packages/protocol/src/errors.ts`, `apps/server/src/http/status.ts`, tests `packages/protocol/test/errors.test.ts`, `apps/server/test/http-status.test.ts`, and `apps/server/test/config-unchanged.test.ts` (it pins `ERROR_ORDER`; listed in PROGRESS).
  - Done when: tests (written first, red) pin `ERROR_ORDER` with `joins-closed` right after `too-many-matches` and before `match-halted`, every other kind unchanged in position and status, and `joins-closed` is 403; `errorReply('joins-closed')` encodes as `{"kind":"joins-closed"}` with no other member.
- [ ] **T1.2. Creation body `joinPolicy`.** FR-490, FR-503, NFR-103
  - Files: `packages/protocol/src/{wire,read,canonical,index}.ts`, tests `packages/protocol/test/{read,canonical}.test.ts`.
  - Done when: tests (red first) show `readCreation` accepts `joinPolicy` `open` and `client`, absent means no member, and refuses any other value or type (number, null, array, object, wrong case) with `invalid-request` naming `joinPolicy`; a duplicated `joinPolicy` key is refused (as the body parser already does for any member, asserted for this one); a body failing only `invalid-timing` still exposes its raw `joinPolicy` to the caller (so the service can order `forbidden` first); the canonical creation body with `joinPolicy` is the sorted form; body limit tests unchanged.
- [ ] **T1.3. `clientOnly` in views and summaries.** FR-501, FR-503
  - Files: `packages/protocol/src/{wire,encode,decode,index}.ts`, tests `packages/protocol/test/{encode,decode,public}.test.ts`.
  - Done when: `encodePublicMatch` and the summary encoder write `clientOnly: true` at the position fixed in their key lists and omit it when absent; the decoders refuse `clientOnly` of `false`, `"true"`, `1` and `null`; every existing 008/011 view and summary encodes to the same SHA-256 as before.
- [ ] **T1.4. Pure policy decisions.** FR-491, FR-492, FR-493, FR-496, FR-497, NFR-104
  - Files: `apps/server/src/core/policy.ts` (new), `apps/server/test/core-policy.test.ts`; `core-purity.test.ts` must cover the new file.
  - Done when: table tests over every caller class (client of the owner, client of another namespace, anonymous, host, player, unknown token, operator) and every requested value (absent, `open`, `client`) cover `creationPolicy` (the operator path refuses any `joinPolicy` naming it), `joinPolicy` (refused for every caller whenever an owner exists, allowed with none) and `submitPolicy` (only the owner's client passes a client-only match; everybody passes an open one); the module imports no I/O, clock or random source (purity test green).
