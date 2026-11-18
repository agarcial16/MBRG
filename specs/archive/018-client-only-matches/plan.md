# Plan 018 — Client-only matches
Spec: `spec.md` (approved 2026-11-15; decisions OQ1..OQ4 at its end). Tier: Full SDD. Status: draft, awaiting the user's approval. Written against the code at `main` (32e9ac2).

## 1. Shape of the change
A client-only match is an ordinary 011 public match plus one stored fact: the owning namespace. The policy is **`client` iff a row exists in a new table `client_matches (match_id, namespace)`**; no row means `open`. Nothing in the simulation, the map format, `MatchState`, the draws or any round changes (NFR-101/102).

Discarded: a `join_policy` + `owner_namespace` column pair on `matches` (`ALTER TABLE ADD COLUMN` is storage-only too, but it touches the table every other query reads and every 008/011 golden of `matches` rows; a side table is untouched by old queries and costs one indexed read). Discarded: a policy field inside `CoreMatch` persisted with the match (it would enter the core view digests and goldens).

## 2. Files and responsibilities
| Area | File | Change | FR / NFR |
|---|---|---|---|
| protocol | `packages/protocol/src/wire.ts` | `CreationBody.joinPolicy?`, `PublicMatch.clientOnly?: true`, `MatchSummary.clientOnly?: true`, `JoinPolicy` type | 490, 501, 503 |
| protocol | `read.ts` | `readCreation` accepts `joinPolicy` (`open`/`client`; any other value or type: `invalid-request` naming `joinPolicy`); `CREATION_FIELDS` gains it | 490 |
| protocol | `encode.ts`, `decode.ts`, `canonical.ts`, `index.ts` | `clientOnly` written at a position fixed in the key lists; decoder refuses any value but `true`; summaries likewise; canonical body keeps `joinPolicy` (sorted) | 501, 503 |
| protocol | `errors.ts` | `joins-closed` in `ERROR_ORDER` between `too-many-matches` and `match-halted` | 496 |
| server http | `http/status.ts` | `joins-closed`: 403 | 496 |
| server core | `core/policy.ts` (new, pure) | `creationPolicy`, `joinPolicy`, `submitPolicy` (section 4) | 491..493, 496, 497, NFR-104 |
| server core | `core/view.ts` | `publicOf` writes `clientOnly: true` when told so (parameter, like `playerCount`) | 501 |
| server store | `store/schema.ts`, `sqlite.ts`, `store.ts`, `faults.ts` | `SCHEMA_VERSION = 3`; `SCHEMA_V3_ADDITIONS` (`client_matches`); `openStore` upgrades 1 and 2 in place; `insertClientMatch`, `getClientNamespace`; `listMatches` also returns `clientOnly` (LEFT JOIN) | 494, 506, NFR-103 |
| server service | `service/matches.ts` | `createPublic` takes an optional verified client `{ namespace, digest }`; `create` refuses `joinPolicy`; `join` and `submit` consult the policy; every `publicView`/`publicOf` call site adds the flag through one helper | 491..501 |
| server http | `http/server.ts` | the creation route passes the client identity to `createPublic`; join and submit routes keep their credential rules | 491, 492, 500 |
| bot | `apps/bot/src/io/server-client.ts` (create call only) | sends `joinPolicy: 'client'` and `Authorization: Bearer` of the `discord` credential; a refusal naming `joinPolicy` is "server unavailable", no retry | 505 |
| tests | `packages/sim/test/traceability.test.ts` | ledger extended with FR-490..506, NFR-100..104 | done criterion 1 |

Not edited, ever, in this spec (NFR-102): `packages/sim/src`, `packages/shared/src`, `packages/sim/test/golden`, `maps/dev`, `apps/server/test/golden/dev-secrets.json`, the map format, `MatchState`. `apps/web` is not touched (FR-504 is a later spec). In `apps/bot` only the create call and its test (spec 017 works there in parallel).

## 3. Persistence (FR-506, FR-494, NFR-103)
`SCHEMA_V3_ADDITIONS` is one statement: `CREATE TABLE IF NOT EXISTS client_matches (match_id TEXT NOT NULL PRIMARY KEY REFERENCES matches (id), namespace TEXT NOT NULL)`. `openStore`: `user_version` 0 creates v1+v2+v3; 1 adds v2+v3; 2 adds v3; each inside the same transaction as the version change. The upgrade writes no row of any existing table, `meta` included: `meta.schema_version` is write-only in the code (nothing reads it; `user_version` is the authority), so a file upgraded from 1 or 2 keeps its old `meta` value while a new file gets 3 (this reads FR-506 literally; the 011 upgrade updated `meta`, this one does not); 3 opens as is; anything else is `unknown-schema-version`, so an older server (supports 2) refuses a v3 file by its existing rule. `TABLES` gains `client_matches`. The only writer is `insertClientMatch`, called inside the creation transaction right after `insertMatch`; there is no update method and no command changes a row (FR-494: restart, expiry, start, step and halt never touch the table). The one delete is inside `purgeExpired`: the policy lives and dies with its match, so when an expired lobby is purged after its retention (`sqlite.ts` purge) `client_matches` is added to its child-first table list, before `matches`; without it the foreign key would fail the purge transaction (and with it the memo purge). The match no longer exists then, so FR-494 (policy of an existing match) holds. The namespace is never in a read, event, error or log (NFR-100); `getClientNamespace` is used only by the service's policy checks.

## 4. Pure decisions (`core/policy.ts`, no I/O, parameters only; NFR-104)
```
Caller = {role:'client', namespace} | {role:'other'}     // other = anonymous, host, player, unknown token, operator
creationPolicy(requested: 'open'|'client'|undefined, caller, operatorPath: boolean):
  operatorPath && requested !== undefined          -> invalid-request ['joinPolicy']             // FR-493
  requested === 'client' && caller.role !== 'client' -> forbidden                                 // FR-492
  requested === 'client'                           -> {policy:'client', namespace: caller.namespace}   // FR-491
  otherwise                                        -> {policy:'open'}
joinPolicy(owner: string | undefined)              -> owner !== undefined ? joins-closed : proceed      // FR-496, any caller
submitPolicy(owner, caller)                        -> owner === undefined || (caller.role==='client' && caller.namespace===owner) ? proceed : forbidden   // FR-497
```
`namespace` comes only from the verified credential (008 FR-284), never from the body (FR-491).

## 5. Behaviour by request (service)
**Creation, client credential (FR-491, 492, 495).** The HTTP route already classifies the caller (`identity.role`). A valid client credential is passed to `createPublic` as `client`. Order in `createPublic`: shape (`readCreation`, so `joinPolicy` problems are `invalid-request`), then `creationPolicy` (`forbidden`, before the memo, nothing drawn or stored), then the memo and `decidePublic` exactly as 011 (public map list, bounds, no `manual`, open-lobby cap, creation rates, lobby, host token). In the same transaction as `insertMatch` and `insertLobby`: `insertClientMatch(matchId, namespace)` when the policy is `client`. The reply is `encodeCreation` with the view carrying `clientOnly: true`.

**Memo scope (FR-495).** The scope stays `public:<source>` for every creation, exactly as 011 (so a creation without `joinPolicy` behaves byte for byte as today). The memo content digest is `sha256(canonicalBody)` as today, except when a valid client credential presents a body that has `joinPolicy`: then it is `sha256(canonicalBody + ':' + credential digest)`. Effects: the same client repeating the same body replays the first reply (FR-495); the same id with the member added, removed or changed differs in content and answers `request-id-reused`; a second client behind the same source repeating that body also differs in content (`request-id-reused`), so a host token is never replayed to another credential. Discarded: a `client:<digest>` scope for every client creation (it changes 011 behaviour for bodies without the member, against FR-490); a per-client scope only for bodies with the member ("with or without" would fall in different scopes and never answer `request-id-reused`). The `joinPolicy` value used by the policy and the digest is read from the raw body when `readCreation` fails only with `invalid-timing`, so `forbidden` still comes before the timing rules. Risk R2.

**Operator creation (FR-493).** `create` runs `creationPolicy(..., operatorPath = true)` after the shape stage: a body with `joinPolicy` is `invalid-request` naming it; operator matches stay open and keep their bytes.

**Join (FR-496, 500).** In `join`: shape (`readJoin`), memo replay (a refusal is never memoised, so no replay exists for a refused join), match found (`unknown-match` stays first), then `joinPolicy` on `getClientNamespace(matchId)`, then expiry, stage, cap, name. Nothing is stored, drawn or published. The route's join limits are untouched: a refused join passes the shape stage, so it counts like any other refusal of that path (FR-500).

**Submission (FR-497, 500).** In `submit`, inside the transaction and BEFORE the memo lookup, `owner = getClientNamespace(matchId)` and `submitPolicy(owner, caller)` run: a restricted caller gets `forbidden` before any replay or `request-id-reused`, as FR-301 orders (`forbidden` precedes `request-id-reused`). This also covers a client renamed or removed from the settings (OQ3): its old memo entries (refusals such as `prediction-closed` are memoised) are never replayed for a non-owner. An unknown match has no owner, so the old order (`unknown-match`) stays. The owning client takes no different code path (008/012 unchanged). Risk R4.

**Reads, events, config (FR-498, 502).** No read or stream path calls the policy; the own-prediction read keeps its rule. `GET /config` is not edited and a test pins its bytes.

**Views (FR-501).** The flag is read from the store wherever a view leaves the service (match read, list, creation, start, advance, join and submit replies, any event that embeds a view) through one helper `viewFor`; no call site builds it alone. `core/advance.ts` builds views too (its `already-performed` and `performed` replies and the halted path): it takes the flag as part of its input like `matchSecret`. Summaries get it from the list query, and the service's summary copier (which lists members one by one) must copy it. Open matches keep their bytes because the member is absent, never `false`.

**Host token (FR-499).** `startMatch` is untouched; a test shows the host token starts the lobby of a client-only match and that its join and submit are refused.

## 6. Error order and status
`joins-closed` sits after `too-many-matches` and before `match-halted` in the fixed order (FR-301, FR-496); status 403 (decision OQ2). Tests pin `ERROR_ORDER`, the status table, and that every other kind keeps its position and status.

## 7. Test strategy (Vitest; no new library)
- Pure: table tests for the three functions. Protocol: codec round trips, canonical forms, refusal of `clientOnly: false` or non-boolean, key order pins, 008/011 views byte-identical (existing SHA pins stay green).
- Store: upgrade from v1 and v2 files built as `service-v1-database.test.ts` does; a hash of every pre-existing row before and after; version 3; existing matches read open; `user_version = 4` is refused; restart keeps policy and namespace; a source scan shows no `UPDATE` on `client_matches` and no `DELETE` but the one in `purgeExpired`.
- Service and HTTP over a real server for each FR (create with every caller class, join with every credential class and stage, submit by owner / other client / player, reads and stream unchanged, FR-500 counting, FR-495 memo cases).
- NFR-101 twin test (same fake random source, open vs client-only: same match id, commitment, records, states, events; views differ only in `clientOnly`). NFR-100 scan over reads, events, error replies and log lines of a client-only run. NFR-102: full existing suites and goldens, plus the protected-path diff at the end of every task. Mutation proof of each guard (policy check removed, flag dropped, digest salt, upgrade writing a row), 011 method.
- The hand run (done criterion 4) is the user's, after M5, with the bot.

## 8. Risks
- R1 Persistence upgrade: a bug corrupts real data. Mitigation: side table only; upgrade tests hash every existing table before and after, on v1 and v2 fixtures.
- R2 Salted content digest for client creations with `joinPolicy` (section 5), the only touch on an existing 011 path (the scope does not change). Mitigation: a test pins that a client creation without `joinPolicy` returns the exact 011 reply and that anonymous memo behaviour is unchanged.
- R3 View coverage: one missed call site shows an open-looking view of a client-only match. Mitigation: a test fetches the match through every route returning a match view (including the already-performed and halted advance replies and the list) and asserts the flag; a scan test shows no `publicView(`/`publicOf(` call in `service/` or `core/` bypasses the helper.
- R4 Position of the submit check (section 5): before the memo, tested with memoised refusals and a renamed owner.
- R7 FR-492 and FR-500 counting: a creation or join/submit refused by the policy passes the shape stage, so it counts against the creation, join or submission limits like any other refusal (stated in the tasks, tested).
- R8 Spec 012 NFR-89 says the credential goes only on predictions; FR-505 (approved later) extends it to the create call. Recorded here; the bot's note in its spec is updated in M5.
- R5 Parallel spec 017 in `apps/bot`: M5 edits only the create call and its test; rebase first and keep the diff small.
- R6 Size: estimated 1,800 to 2,600 changed lines with tests: one PR into `main` at the end; split per milestone if the branch would pass about 3,000.

## 9. Coverage matrix
FR-490: T1.2, T3.2 · FR-491: T2.3, T3.2 · FR-492: T1.4, T3.2 · FR-493: T1.4, T3.3 · FR-494: T2.3, T2.4 (incl. purge) · FR-495: T3.3 · FR-496: T1.1, T1.4, T3.4 · FR-497: T1.4, T3.5 · FR-498: T3.6, T3.7 · FR-499: T3.8 · FR-500: T3.4, T3.5 · FR-501: T1.3, T2.5, T3.1, T3.2 · FR-502: T3.6, T4.4 · FR-503: T1.2, T1.3 · FR-504: out of scope (contract for the later web spec; no task) · FR-505: T5.1, T5.2 · FR-506: T2.1, T2.2, T2.3 · NFR-100: T4.2 · NFR-101: T4.1 · NFR-102: every task, T4.4 · NFR-103: T1.2, T2.1, T2.4 · NFR-104: T1.4, M3 tests. (M1 now has T1.1 error, T1.2 creation body, T1.3 views and summaries, T1.4 pure decisions; M3 has T3.1..T3.8, see its file.)
