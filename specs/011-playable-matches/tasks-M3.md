### M3 — Players and identity, service level (`feat/011-m3-players-and-identity`; 9 / 20 -> 15 / 14)

Plan sections 1 (P7 to P11), 3, 4, 5, 12 (M3 row), 15 (Q3, Q5). Branch cut from `rewrite` after M2 is merged. Still no route (M4). Blocked on: Q3 (namespace, T3 onwards), Q5 (memo and the plain token, T6).

**Ids that M3 may name:** FR-384 (T2), FR-377 and FR-376 and FR-380 (T6), FR-378 (T7), FR-382 (T8). Words only for the others (token-based submission, players list, bounded lists, digests-only storage, impersonation).

**Hand-offs from M2**: stages `lobby`/`expired` exist; `players` table exists empty in schema v2; `createPublic`, `start`, expiry; `PublicMatch.playerCount` optional; 24 settings variables; `CoreMatch` has no player field yet (T5 adds `playerCount` to the core view and to the pinned `CORE_MATCH_KEYS` test).

- [x] **T1. Branch and bookkeeping targets.** (no pending id named)
  - Depends on: M2 merged; Q3, Q5 answered.
  - Files: `packages/sim/test/traceability.test.ts` (comments), `specs/011-playable-matches/PROGRESS.md`.
  - Commit: `test: prepare the spec 011 bookkeeping for M3`.
  - Done when: suite, typecheck, `CI=1` green; counts 9 / 20.
  - Size: S (about 30).

- [x] **T2. Protocol: names, join, the joined event and the players list shapes.** FR-384 (close, pure and encoder parts)
  - Depends on: T1.
  - Files: `packages/protocol/src/{names,wire,read,encode,decode,page,ids,canonical,index}.ts`, tests `packages/protocol/test/{names,read,encode,decode,page,ids,canonical,purity}.test.ts`.
  - Tests first: `readName`: trims; 1 to 24 code points (24 passes, 25 fails; a 24-character name of astral-plane letters counts code points; empty and whitespace-only fail); letters of any script, digits, space, `_`, `-`, `.` pass; control characters, zero-width characters, `<`, quotes, emoji, `:` and `/` fail; no leading/trailing space after trim (internal), two spaces in a row fail; input is NFC-normalised before the check (`e` + combining acute accepted as `é`); all failures are `invalid-request ['name']` with no detail about which rule; `nameKey`: case and accent insensitive (`José`, `JOSE`, `jose` equal; `ß` and `ss` unequal — documented), stable, never throws, pure (no locale: `İ` handled by `toLowerCase`); `readJoin` reads exactly `name` and `requestId` (field order of FR-296: `name` then `requestId`, first failing field named, extra member named); `PlayerJoinedEvent` encodes `type, seq, playerId, name` and nothing else, decoder refuses extras; `JoinReply` key order `playerId, name, playerToken, match`; `PlayerListItem` `playerId, name, joinedSeq`; cursor list `players [joinedSeq]` round-trips and is refused on the other seven lists (and theirs here); `isPlayerId('player:<12 chars>')` yes; a name is only ever written as a JSON string (a name made of `"` or `\` cannot occur, a test pushes allowed edge characters through `JSON.parse(encode(...))`).
  - Commit: `feat(protocol): add names, join and the joined event`.
  - Mutation proofs: length 25 accepted; accent not stripped in the key; combining mark accepted without NFC; two spaces accepted; `playerToken` moved before `playerId`; cursor accepted on the matches list.
  - Done when: tests green; mutations caught; protocol purity green; FR-384 moved (10 / 19) in this commit.
  - Size: L (about 650).

- [x] **T3. Settings: the player cap and the reserved namespace.** (words only; blocked on Q3)
  - Depends on: T1.
  - Files: `apps/server/src/service/settings.ts` (`MBRG_MAX_PLAYERS` default 200, whole 1 to 10,000; a client credential with the reserved namespace is refused: problem `MBRG_CLIENTS`), `apps/server/test/{server-settings,service-settings,service-seam}.test.ts`, `apps/server/test/helpers/{main-child,service-harness,server-harness}.ts`.
  - Tests first: 25 variables in order; default 200; `0`, `10001`, `x` are problems naming the variable only; a client with namespace `player` (or the namespace Q3 chooses) is refused at start; `web`, `discord` and all existing test namespaces still start; FR-260 scans run over 25.
  - Commit: `feat(server): add the player cap and reserve the player namespace`.
  - Mutation proofs: reserved namespace not checked; default 100.
  - Done when: tests green; mutations caught; no id moved.
  - Size: S (about 150).

- [x] **T4. Store and ids: players, token digests, name keys.** (words only)
  - Depends on: T2, T3.
  - Files: `apps/server/src/service/ids.ts` (`PLAYER_TOKEN_BYTES = 32`, `PLAYER_ID_BYTES = 9`, `newPlayerToken`, `newPlayerLocalId`), `apps/server/src/store/{store,sqlite,faults}.ts` (`insertPlayer`, `playerCount`, `playerByTokenDigest(matchId, digest)`, `playersAfter(matchId, after, limit)`, `playerNames(matchId, ids)`), `apps/server/test/{service-ids,store-players}.test.ts`.
  - Tests first: token is 43 base64url characters from 32 drawn bytes, one draw per value, independent of the secret, match id and host token (the fake random source shows three distinct draws); the local id is 12 characters of the FR-297 set; `insertPlayer` stores only the digest (a dump of the table has no token text; the plain token is not an argument of the store); the unique `(match_id, name_key)` refuses a second key as `invalid-write` mapped to a dedicated code the service reads (not a generic failure); `playerByTokenDigest` finds the row by index and never across matches; `playersAfter` keyset in join order, `limit + 1` rows, no repeat or skip at page boundaries (limits 1, 2, 500); `playerCount`; rollback with the transaction; the fault seam wraps the new ops.
  - Commit: `feat(server): store players as token digests`.
  - Mutation proofs: token stored plain; lookup not scoped by match; keyset `>=`; name key unique index removed.
  - Done when: tests green; mutations caught; no id moved.
  - Size: M (about 450).

- [x] **T5. Core: the join decision and the player count in the view.** (words only)
  - Depends on: T4.
  - Files: `apps/server/src/core/{lobby,view}.ts` (`joinDecision(view, count, max)`; `CoreMatch.playerCount?`, `CORE_MATCH_KEYS` gains it; `publicOf` writes `playerCount` when the stage is `lobby`/`expired` or the count is positive), `apps/server/test/{core-lobby,core-view}.test.ts` and the pinned key test.
  - Tests first: stages `lobby`, `phase-1`, `phase-2`, `locked` accept (the running ones: a join mid-match); `finished` -> `match-finished`, `halted` -> `match-halted`, `expired` -> `match-expired`; the cap: `count = max - 1` accepts, `count = max` is `match-full`, and the stage errors come before `match-full`; the new `lastSeq` is `lastSeq + 1`; `publicOf` omits `playerCount` for a running match with no player (the 008 bytes) and writes it otherwise; no secret-looking key is added to the core view (`CORE_MATCH_KEYS` test).
  - Commit: `feat(server): add the pure join decision`.
  - Mutation proofs: `match-full` before the stage errors; `playerCount` always written; count `>` vs `>=`.
  - Done when: tests green; mutations caught; no id moved.
  - Size: S (about 250).

- [x] **T6. Service: join with a name and a token.** FR-377, FR-376, FR-380 (close)
  - Depends on: T5; Q5.
  - Files: `apps/server/src/service/matches.ts` (`join(request)`: memo, decision, draw, `insertPlayer`, `appendEvents(player-joined)`, `updateMatch`, memo, publish after commit), `apps/server/test/{service-join,service-join-race}.test.ts`, `service-seam`/`service-create` method lists.
  - Tests first (fake clock, fake random, fake scheduler): a join in `lobby` returns `{playerId, name, playerToken, match}` with `playerCount` 1; the stored name is the trimmed NFC text as given (case kept for display), the key is the normalised one; `name-taken` for the same key (case, accent, surrounding spaces) and the check runs after the shape check (`invalid-request ['name']` first) and after the stage/cap checks per `joinDecision`; a taken name stores nothing, draws nothing, emits nothing; the `player-joined` event (id, name only) has the next `seq`, is stored in the same transaction as the player and the `lastSeq` update, and is published after commit in join order; a subscriber that connects late replays all joins (FR-376 replay via `eventsAfter`); a join while `phase-1`/`phase-2`/`locked` works, the player's earlier phases have no rows and no points, their predictions from the next open phase score as any other (a scripted match finishing with a late joiner on the leaderboard); a join after `finished`, `halted` or `expired` is refused with the closed codes; the cap: with `MBRG_MAX_PLAYERS = 3`, the fourth join is `match-full`; a repeated join with the same source scope, request id and content returns the first reply, token included, joins nobody twice, writes no event; same id with other content is `request-id-reused`; the memo row holds the token for 24 h and the purge deletes it at 24 h + 1 ms while the player's digest stays; two interleaved joins with the same name key (the second sees the unique violation inside its transaction) give exactly one `name-taken`; `unavailable` leaves nothing; `unknown-match`.
  - Commit: `feat(server): let players join a match`.
  - Mutation proofs: event appended after the commit; name key without accent folding; unique violation reported as `unavailable`; token drawn before the checks (draw count test); late joiner scoring earlier phases; memo not purged.
  - Done when: tests green; mutations caught; FR-377, FR-376, FR-380 moved (13 / 16).
  - Size: L (about 700).

- [x] **T7. Identity: the player role and token submissions.** FR-378 (close)
  - Depends on: T6.
  - Files: `apps/server/src/http/identity.ts` (`Identity` gains the `player` role; `playerIdentity(identity, found)`; `submitterOf(identity, localId)`), `apps/server/src/http/limits.ts` (`limitKeys` case `player`), `apps/server/src/service/matches.ts` (`playerTokenOf(matchId, token)` indexed digest lookup returning `{playerId}`; `submit` and `ownPredictions` take a resolved player id and a memo-scope digest of the token), `apps/server/test/{http-identity,http-limits,service-player-token}.test.ts`.
  - Tests first: a token matching a player of the match is role `player` for that match only (the same token on another match: not a player, anonymous); only the digest is compared with `sameDigest` (constant-time helper), the lookup runs for a `candidate` identity and never for an operator or client; an unknown, truncated or wrong-case token is anonymous; the identity holds a digest and ids, never the token text; `limitKeys` for a player: its own `read:`/`command:` bucket by digest with the client limits (two players behind one address do not share a bucket); `submitterOf`: a client identity behaves exactly as `playerIdFor` (008 tests pass unchanged), a player identity with `localId` equal to its own gets its id, any other local id is `forbidden` (after `invalid-player-id` for a malformed one, FR-301 order), no credential `forbidden`; service: a player token submits a victim prediction in an open phase and it is stored under `player:<local>`; a prediction for another player's id is refused with nothing stored; the own-predictions read with a player token returns only that player's predictions, and a `playerId` of another player is `forbidden`; the client-credential path is byte-identical to 008 (existing suites unchanged); a token of a finished or expired match can still read its own predictions (reads only).
  - Commit: `feat(server): authenticate players by their match token`.
  - Mutation proofs: token accepted on another match; `playerIdFor` used for a player (impersonation allowed); player bucket shared by address; token compared with `===`; lookup also run for client roles.
  - Done when: tests green; mutations caught; FR-378 moved (14 / 15).
  - Size: M (about 550).

- [x] **T8. Service: the players list and the no-recovery rule.** FR-382 (close)
  - Depends on: T6, T7.
  - Files: `apps/server/src/service/matches.ts` (`players(matchId, request)` paged read: id, name, join order), `apps/server/test/{service-players,service-no-recovery}.test.ts`, `service-seam` method list.
  - Tests first: the list is ordered by join order, paged (limits 1, 2, 500, cursors never repeat or skip, a cursor of another list is `invalid-request ['cursor']`), shows only id, name and join order — a table scan of the reply bytes finds no token, digest or prediction; a lobby, a running and a finished match all answer; `unknown-match`; `unavailable` under the fault seam; reading changes nothing in the database dump; FR-382: the service has no method that changes a name, issues a second token for a player, or reads a token back (the method list is pinned), a second `join` with another request id and the same name is `name-taken` even for the same source, and the token exists in clear text only in the join reply and its memo row (a dump scan over every table and the log sink).
  - Commit: `feat(server): list the players of a match`.
  - Mutation proofs: digest column in the reply; name changeable through a repeated join; list ordered by name.
  - Done when: tests green; mutations caught; FR-382 moved (15 / 14).
  - Size: M (about 350).

- [ ] **T9. Service proofs: restart, kills, impersonation, lobby-to-match flow.** (words only for the pending ids)
  - Depends on: T6, T7, T8.
  - Files: `apps/server/test/{service-players-durability,service-players-flow}.test.ts`, `apps/server/test/helpers/{durability-script,db-scan}.ts`, `apps/server/test/service-db-secrecy.test.ts` (token allowance: plain tokens only in `memo`).
  - Tests first: a full flow on the file DB with the fake clock: create public, three joins with names, start, predictions by token and by client credential side by side, finish; the leaderboard (read through the existing service read, ids only) has both kinds; kill points at every write boundary of join recover to the uninterrupted dump (no player without its event, no event without its player); restart in the lobby keeps players, names, join order and tokens valid; the database scan: after the whole flow, no table except `memo` contains any token text (base64url, hex, bytes) and `memo` rows are gone after 24 h; the 008 secrecy scans (secret, seeds, absorber) pass unchanged with players present; impersonation matrix (token A with ids of B, of a client namespace, malformed ids) all refused with nothing stored.
  - Commit: `test(server): prove players across restarts, kills and impersonation`.
  - Mutation proofs: the event written before the player row (kill test); token written to the `players` table (scan); allowance widened to all tables (scan test fails).
  - Done when: tests green; mutations caught; no id moved.
  - Size: M (about 500).

- [ ] **T10. Close M3: closing-state test, process checks, PR.** (no pending id named in titles)
  - Depends on: T1 to T9.
  - Files: `packages/sim/test/traceability.test.ts` (closing-state test for M3: 15 done / 14 pending), `specs/011-playable-matches/PROGRESS.md`, `MEMORY.md` (local).
  - Steps: as M1 T9; protected paths clean; no `package.json`/lockfile change; the PR lists Q3, Q5, the ledger and the changed tests.
  - Commit: `test: pin the spec 011 ledger after M3`.
  - Done when: CI green; counts 15 / 14; `MEMORY.md` updated (next: M4).
  - Size: S (about 80).
