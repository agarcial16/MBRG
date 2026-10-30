### M2 — Lobby and public creation, service level (`feat/011-m2-lobby-and-public-creation`; 3 / 26 -> 9 / 20)

Plan sections 1 (P1 to P5, P14 to P16), 3, 4, 7, 8, 12 (M2 row), 15 (Q1, Q4, Q6 to Q10). Branch cut from `rewrite` after M1 is merged. Everything here is reached through `createMatchService` (no route yet; routes are M4). Blocked on: Q1 (operator path), Q4, Q6, Q8, Q9, Q10 (T2, T3, T6, T7) and Q7 (T8).

**Ids that M2 may name:** FR-391 (T4), FR-371 and FR-374 and FR-375 (T6), FR-372 and NFR-76 (T7). Tests of other pending ids describe the part in words (public creation bounds and caps, expiry data, lobby data, storage in one transaction, bounded lists, lobby secrecy).

**Hand-offs from M1 and 008**: `Settings` has `forcedPhaseSeconds`; the variable list has 16 entries; `createMatch`/`creationEvents` make the phase-1 view and the seq-1 `schedule` event; `store.insertMatch/updateMatch/getMatch/runningCount/runningMatchIds`; `memoGet/memoPut/memoPurge/memoOldest`; scheduler `at/cancel`; `service.start()` re-arms running matches; `StoredMatch` carries `hostTokenDigest`.

- [ ] **T1. Branch and bookkeeping targets.** (no pending id named)
  - Depends on: M1 merged; Q1, Q4, Q6, Q8, Q9, Q10 answered; plan and tasks approved.
  - Files: `packages/sim/test/traceability.test.ts` (comments: targets per task), `specs/011-playable-matches/PROGRESS.md`.
  - Commit: `test: prepare the spec 011 bookkeeping for M2`.
  - Done when: suite, typecheck, `CI=1` green; counts 3 / 26.
  - Size: S (about 30).

- [ ] **T2. Protocol: lobby stages, player count, start body, lobby errors.** (words only)
  - Depends on: T1; Q6, Q10.
  - Files: `packages/protocol/src/{wire,errors,read,encode,decode,canonical,index}.ts`, `apps/server/src/http/status.ts`, tests `packages/protocol/test/{errors,public,encode,decode,read,canonical}.test.ts`, `apps/server/test/http-status.test.ts`.
  - Tests first: `STAGES` gains `lobby`, `expired`; an `expired`/`lobby` public view encodes with `playerCount` (non-negative whole number, written where `PUBLIC_MATCH_KEYS` places it: after `reportedTime`, before `schedule`) and with no `schedule`, `victim`, `winner`, `matchSecret`, `haltReason`; a running or finished view with `playerCount` absent encodes to the exact 008 bytes (SHA-256 pins of one 008 public view per stage); `playerCount` present on a running view when given; `match-started` and `match-expired` follow `match-finished` in `ERROR_ORDER` (409); `readStart` accepts `{}` and `{requestId}` (credential character set, as `readAdvance`'s id) and names the first bad field; `canonicalBody('POST', '/matches/<id>/start', body)` is the sorted form; a `schedule` event with stage `lobby` or `expired` encodes without anchors and the stage member list of the event encoder accepts them (only these two new values and the running stages).
  - Commit: `feat(protocol): add the lobby stages and the start body`.
  - Mutation proofs: `playerCount` written for a running view with count 0; `lobby` allowed with a `schedule` member; wrong error order.
  - Done when: tests green; mutations caught; protocol purity green; no id moved.
  - Size: M (about 350).

- [ ] **T3. Settings: public maps, bounds, caps and lobby expiry.** (words only)
  - Depends on: T2; Q8.
  - Files: `apps/server/src/service/settings.ts` (`MBRG_PUBLIC_MAPS`, `MBRG_PUBLIC_MIN_INTERVAL`, `MBRG_PUBLIC_MIN_PHASE1`, `MBRG_PUBLIC_MIN_PHASE2`, `MBRG_PUBLIC_MAX_INTERVAL`, `MBRG_MAX_OPEN_LOBBIES`, `MBRG_MAX_PUBLIC_RUNNING`, `MBRG_LOBBY_EXPIRY_HOURS`; appended after the 16; `Settings.publicCreation`), `apps/server/test/{server-settings,service-settings,service-seam}.test.ts`, `apps/server/test/helpers/{main-child,service-harness,server-harness}.ts`.
  - Tests first: 24 variables in order; defaults (public maps empty = public creation off; 30, 10, 5, 3,600*, 50*, 20*, 24); every public map id must be in `MBRG_MAPS` (else a problem naming `MBRG_PUBLIC_MAPS`); whole-number rules, bounds `min <= max`, `L1 + L2 < min interval`? (a bound set is internally consistent: the minimum interval must exceed minL1 + minL2, else a problem); problems name variables only; the FR-260 scans run over 24; defaults do not alter any 008 behaviour (a service built from 008-only variables works and has public creation off).
  - Commit: `feat(server): add the public creation settings`.
  - Mutation proofs: public map not checked against `MBRG_MAPS`; default expiry 12; inconsistent bounds accepted.
  - Done when: tests green; mutations caught; no id moved.
  - Size: M (about 300).

- [ ] **T4. Schema v2 and the lobby store operations.** FR-391 (close); parts of the storage rule (words)
  - Depends on: T2.
  - Files: `apps/server/src/store/{schema,sqlite,store,faults}.ts` (`SCHEMA_VERSION = 2`, `SCHEMA_V2_ADDITIONS`, tables `lobbies` and `players` created here although M3 fills `players`; ops `insertLobby`, `getLobby`, `markStarted`, `markExpired`, `openLobbyCount`, `publicRunningCount`, `lobbiesExpiringBefore`, `lobbyIds`, `purgeExpired`), `apps/server/test/{store-open,store-ops,store-lobbies}.test.ts`, `apps/server/test/fixtures/open-store.ts`.
  - Tests first: a new file opens as v2 (`user_version` 2, `meta.schema_version` 2, tables = the 9 of v1 plus `lobbies` and `players`); **a database written by the 008 code (a fixture file saved from the `rewrite` store with matches, predictions, results, events, memo) opens unchanged**, its matches read back byte-equal, its `user_version` becomes 2, the new tables are empty; the upgrade is one transaction (a kill/`failWrite` in the middle leaves `user_version` 1 and the file usable); a second open of v2 changes nothing; `user_version` 3 is refused; a lobby row is stored with its match in the caller's transaction and rolls back with it; counts: open lobbies exclude started and expired, public running counts only public matches in `phase-1/2/locked`, operator matches (no `lobbies` row) count in neither; expiry query returns lobbies with `expires_ms <= now` that are neither started nor expired, in id order; `markStarted`/`markExpired` refuse a second mark (`invalid-write`); `purgeExpired(now)` deletes expired lobbies older than the retention with their match rows, events, states and memo-free children, and nothing else; the storage scan for future data finds nothing in a lobby match.
  - Commit: `feat(server): store the lobby data in schema version 2`.
  - Mutation proofs: `ALTER`-style change of `matches` (the unchanged-columns test); upgrade outside the transaction; operator matches counted as public; purge deleting a started lobby; count including expired.
  - Done when: tests green; mutations caught; FR-391 moved (4 / 25).
  - Size: L (about 650).

- [ ] **T5. Pure lobby rules and public-creation checks.** (words only)
  - Depends on: T2, T3.
  - Files: `apps/server/src/core/{lobby,create}.ts` (`createLobby`, `lobbyEvents`, `startDecision`, `expireDecision`), `apps/server/src/service/publiccreate.ts` (pure: `checkPublicCreation(settings, mapId, timing)` -> first error), `apps/server/test/{core-lobby,core-create,public-creation}.test.ts`, `apps/server/test/core-purity.test.ts` (scan covers the new files).
  - Tests first: `createLobby` returns stage `lobby`, `appliedRounds` 0, state at round 0, anchors null, `lastSeq` 1 after `lobbyEvents` (a `schedule` event with stage `lobby`, no anchors); `startDecision(view, now)`: stage `phase-1`, `lastStepMs = t0 = now`, anchors from `now` for a clock timing (C1 = now + I - L1 - L2 ...), none for `manual`, one `schedule` event with the next seq and the reported time; refused with a closed code for `phase-*`/`locked`/`finished`/`halted` (`match-started`), `expired` (`match-expired`); `expireDecision`: `lobby` -> `expired` with a `schedule` event stage `expired`; refused for any other stage; `nextStep` is null for `lobby` and `expired`; `decideAdvance` in `lobby` -> `step-mismatch` naming stage `lobby`; `decideSubmission` in `lobby`/`expired` -> `prediction-closed`; `checkPublicCreation`: a map not in the public list -> `unknown-map` (same reply bytes as a map that does not exist), `manual` -> `invalid-timing` unless Q9 allows it, each rule (I, L1, L2 below the public minimum or I above the public maximum) listed by letter in the order of FR-233 plus the public bounds as `invalid-timing` items, 008 rules still applied first; all functions take `now` as a parameter (purity scan).
  - Commit: `feat(server): add the pure lobby rules`.
  - Mutation proofs: start allowed in `expired`; anchors from the creation instant; `manual` accepted; public minimum off by one (`>=` vs `>`); unlisted map answers a different reply than an unknown map.
  - Done when: tests green; mutations caught; purity green; no id moved.
  - Size: M (about 500).

- [ ] **T6. Service: public creation, lobby and start.** FR-371, FR-374, FR-375 (close)
  - Depends on: T4, T5.
  - Files: `apps/server/src/service/matches.ts` (`createPublic(request)` with the source key, `start(request)`; `create` unchanged for the operator, Q1), `apps/server/src/service/ids.ts` (none new), `apps/server/test/{service-lobby,service-start,service-create}.test.ts` (`service-create` and `service-seam` method lists grow by `createPublic` and `startMatch`).
  - Tests first (fake clock, fake scheduler, in-memory and file DB): public creation with a listed map, a timing inside the bounds and a request id gives a match in stage `lobby`, `playerCount` 0, the host token once, `lastSeq` 1, a `lobbies` row (public), a memo row keyed by the source scope; the same request id and content from the same source replays the first reply bytes (token included) and creates nothing; the same id from another source creates a second lobby (no cross-source leak); the same id with other content is `request-id-reused`; every refusal (unlisted map, bounds, caps, malformed body) creates and stores nothing and draws no random bytes; the operator path still creates a `phase-1` match (Q1); `start` by the host token: stage `phase-1` of round 1, clock anchored at the start instant, one new `schedule` event stored in the same transaction with the stage change, published after commit, the scheduler armed for C1; `manual`: no anchors and the host steps with `advance` afterwards (FR-375) through a full round; a second `start` with the same `requestId` and content returns the first reply and writes nothing; without a request id, or with another, a started match answers `match-started` and an expired one `match-expired`; any other credential (operator included, per P14), a wrong host token or none is `forbidden`; `unknown-match`; `unavailable` under the fault seam leaves the lobby intact; no `results`/`victim-revealed` event exists before the start (public data and events of a lobby contain nothing of a round).
  - Commit: `feat(server): create public lobbies and start matches`.
  - Mutation proofs: start storing its event in a second transaction; anchors taken from the creation instant; memo scope without the source; operator accepted by `start`; a refusal that stores the memo.
  - Done when: tests green; mutations caught; FR-371, FR-374, FR-375 moved (7 / 22).
  - Size: L (about 700).

- [ ] **T7. Service: expiry, ticks and restart of lobbies.** FR-372, NFR-76 (close)
  - Depends on: T6.
  - Files: `apps/server/src/service/{matches,scheduler}.ts` (expiry wake-up per lobby; `armAt` takes a kind; `tick` and `start()` handle lobbies; memo-purge tick also calls `purgeExpired`), `apps/server/test/{service-lobby-expiry,service-lobby-restart}.test.ts`.
  - Tests first (fake clock and fake scheduler only; no real timer): a lobby not started within 24 h (the setting; also 1 h and a non-round 7 h) becomes `expired` at `created + expiry` exactly (not 1 ms before), stores and publishes a `schedule` event with stage `expired`, rejects `start` (`match-expired`) and (once M3 exists) joins; the record is kept and then removed after the retention (24 h + 1 ms after expiry; before it a read still answers `expired`; after it `unknown-match`); a started match is never expired by the rule (the wake-up is cancelled at `start`, and a tick at +25 h leaves it running); a restart (new store and service on the same file, `start()`) keeps a lobby a lobby and re-arms its expiry; a lobby already overdue at restart expires at once, with the effective instant; a backward clock does not expire early; an expiry that fails to store (`failWrite`) leaves the lobby and retries after 3 s; timers exist only in `scheduler.ts` (existing scan); open-lobby count drops at expiry and a new public creation succeeds at the cap boundary afterwards.
  - Commit: `feat(server): expire lobbies that are not started`.
  - Mutation proofs: `<` vs `<=` at the boundary; expiry applied to a started match; wake-up not cancelled at `start`; retention counted from creation; a lobby not re-armed at `start()`.
  - Done when: tests green; mutations caught; FR-372, NFR-76 moved (9 / 20).
  - Size: M (about 500).

- [ ] **T8. Keep `apps/web` compiling with the new stages.** (words only; blocked on Q7)
  - Depends on: T2; the user's answer to Q7. If the answer is "no": this task is dropped and the plan returns to the user (the wire stage values would then change).
  - Files: `apps/web/src/core/{live-hud,live-text}.ts` (one entry each for `lobby` and `expired` in the `Record<Stage, string>` tables, texts only), the strings module (`STRINGS` keys used by those entries; a key must be used by code), `apps/web/test/live-text.test.ts` (the iteration over `STAGES` stays and passes).
  - Tests first: `stageText('lobby')` and `stageText('expired')` return the new strings; `countdown`/`nextAnchor` for the new stages return undefined; no other web test changes (list in `PROGRESS.md`); the viewer does not read `playerCount`.
  - Commit: `fix(web): name the lobby and expired stages`.
  - Mutation proofs: an empty string for `lobby` (the "every stage has a text" test fails).
  - Done when: `npm run typecheck` green with the widened `Stage`; web suites green; no UI behaviour change for any 008 stage.
  - Size: S (about 90).

- [ ] **T9. Service proofs: caps, restart, kills, a 008 database.** (words only for the pending ids)
  - Depends on: T6, T7.
  - Files: `apps/server/test/{service-public-caps,service-lobby-durability,service-v1-database}.test.ts`, `apps/server/test/helpers/durability-script.ts` (additions only).
  - Tests first: open-lobby cap: creation at `cap - 1` succeeds, at `cap` is `too-many-matches`, nothing stored or drawn; after a start or an expiry the slot frees; public-running cap likewise (whether a `start` that would exceed it is refused with `too-many-matches` is Q13; until answered, only the creation-side cap is tested and `start` is not capped); the operator limit of 008 still applies (Q4); kill points of public creation, start and expiry (every write boundary through `failWrite`/the durability harness) recover to the uninterrupted dump: no lobby without its event, no start without its schedule, no expiry half done; a restart in each lobby state; a v1 file with a running 008 match continues to step and score after the upgrade, byte-equal to a run on the 008 build for events and results; twin lobbies (same public data, different secrets via the test seed source) give identical public data and event bytes; a planted-secret scan over lobby replies, events and the database finds nothing before the finish.
  - Commit: `test(server): prove lobbies across caps, restarts and kills`.
  - Mutation proofs: cap check `>` vs `>=`; start writing the schedule event after the commit; expiry marking without its event.
  - Done when: tests green; mutations caught; no id moved.
  - Size: M (about 550).

- [ ] **T10. Close M2: closing-state test, process checks, PR.** (no pending id named in titles)
  - Depends on: T1 to T9.
  - Files: `packages/sim/test/traceability.test.ts` (closing-state test for M2: 9 done / 20 pending, literal lists in the body), `specs/011-playable-matches/PROGRESS.md`, `MEMORY.md` (local).
  - Steps: as M1 T9; `SCHEMA_VERSION` is 2 and `SCHEMA_V1` is byte-equal to the `rewrite` version (`git diff` on the constant block); `package.json`/lockfile unchanged; the PR lists Q1, Q4, Q6 to Q10 answers, the ledger and the changed tests.
  - Commit: `test: pin the spec 011 ledger after M2`.
  - Done when: CI green; counts 9 / 20; `MEMORY.md` updated (next: M3).
  - Size: S (about 80).
