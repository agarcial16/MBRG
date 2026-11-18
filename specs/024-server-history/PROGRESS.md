# PROGRESS — spec 024 per-server match history

## M1 T1.1 Ledger and `community` in the creation body (FR-546, NFR-120 part)
- Changed: `packages/protocol/src/ids.ts` (`isCommunityKey`, `/^[0-9a-f]{64}$/`), `wire.ts` (`CreationBody.community?`, `CREATION_FIELDS` ends with `community`), `read.ts` (`readCreation` reads the key after `joinPolicy`, before the unknown-member and timing-rule checks; the member is in the value only when sent), `index.ts` (export), `apps/server/src/http/body.ts` (a repeated `community` member is `invalid-request` naming it, as `joinPolicy`).
- Ledger (`packages/sim/test/traceability.test.ts`): ranges FR-545..562, FR-573, NFR-117..122 added; `PENDING_024` holds 24 ids, `DONE_024` = FR-546. NFR-120 is traced here by a part-named title ("creation body digest") and stays pending until T2.5 closes it (the 008 list reads part).
- Tests added: `packages/protocol/test/read-community.test.ts` (6), `apps/server/test/http-body-member.test.ts` (+4: repeated member, single member, joinPolicy order, digest literals `143c350b…4b56` and `85313dcb…c070` pinned from `main` code before any change).
- Pinned tests changed (reason): `packages/protocol/test/read.test.ts` NFR-103 test pins `CREATION_FIELDS` (now 5 members); `traceability.test.ts` pins `FR_RANGES`/`NFR_RANGES` and the totals 517/515 -> 542/540 (the new ranges).
- Mutation proofs (affected files only): uppercase accepted, unanchored regex, no repeated-member check, no key check, inherited `community` read: each killed by the intended test.
- Untested here: the creation service/HTTP use of the key (T1.2, T1.4).
- Next: T1.2 (policy). Branch `feat/024-server-history`.

## M1 T1.2 Creation policy with the key (FR-545, policy part)
- Changed: `apps/server/src/core/policy.ts`: `creationPolicy(requested, caller, operatorPath, community?)`; the decision of a client policy carries `community` only when a key was given. A key without `joinPolicy: 'client'`, from any non-client caller (player, anonymous, other) or on the operator path is `invalid-request` naming `community`; the operator-path `joinPolicy` error still comes first (field order); a body without a key gets exactly the 018 answers (decision has no `community` member).
- Decision not in the plan: an anonymous caller asking `joinPolicy: 'client'` WITH a key gets `invalid-request community` (FR-545 "any other creation with a key"), not `forbidden`; without a key it stays `forbidden` (018 FR-492).
- Tests: `apps/server/test/core-policy.test.ts` +6 titled `FR-545 (policy)`; FR-545 stays pending in the ledger until T1.4 closes the service/HTTP part.
- Pinned test changed (reason): the NFR-104 test pins `creationPolicy.length` 3 -> 4 (new optional parameter).
- Mutation proofs (core-policy file only): requested check dropped, caller check dropped, key not carried, error order swapped: each killed by the intended test.
- Untested here: the service passing the key (T1.4).
- Next: T1.3 (schema v5). Branch `feat/024-server-history`.
