### M5 — Names in the reads, who guessed right, goldens, proofs and close (`feat/011-m5-names-reads-and-proofs`; 21 / 8 -> 29 / 0)

Plan sections 4, 9, 11, 12 (M5 row), 13, 15 (Q12). Branch cut from `rewrite` after M4 is merged. Blocked on: Q12 (who is listed in the "guessed right" read).

**Ids that M5 may name:** FR-383 (T3), FR-386 (T4), FR-373 (T5), FR-390 and FR-392 (T6), NFR-73 and NFR-74 (T7), NFR-75 (T9). All other ids are closed and may be cited with part names.

**Hand-offs from M4**: routes `POST /matches` (public and operator), `POST /matches/:id/start`, `POST /matches/:id/players`, `GET /matches/:id/players`; player token role; 30 variables; the results reads exist since 008 M4' (`PhaseResult`, `PlayerResultsPage`, `LeaderboardRow` with fixed key lists, cursor lists, `isScored`, `readResultsRound`); `players` table has `name` and `player_id`.

- [x] **T1. Branch and bookkeeping targets.** (no pending id named)
  - Depends on: M4 merged; Q12 answered.
  - Files: `packages/sim/test/traceability.test.ts` (comments), `specs/011-playable-matches/PROGRESS.md`.
  - Commit: `test: prepare the spec 011 bookkeeping for M5`.
  - Done when: suite, typecheck, `CI=1` green; counts 21 / 8.
  - Size: S (about 30).

- [x] **T2. Protocol: the optional `name` and the winners page.** (words only)
  - Depends on: T1.
  - Files: `packages/protocol/src/{wire,encode,decode,page,index}.ts`, tests `packages/protocol/test/{encode-results,decode,page}.test.ts`.
  - Tests first: `name` is the LAST key of `PHASE_RESULT_KEYS`, `LEADERBOARD_ROW_KEYS` and `PLAYER_RESULTS_PAGE_KEYS`, written only when present (a row without `name` encodes to the exact 008 bytes; SHA-256 pins of one 008 page of each shape); the name is a string of 1 to 24 characters passing the name rules, anything else is refused by the encoder; `PhaseWinnersPage` shape `round, phase, items{playerId, name}, next?` (no `victim`/`record`, no choice, no points: only who was right); cursor list `phase-winners [playerId]` round-trips and is refused on the other lists; the existing keys, their order and the paging cursors are unchanged (`CURSOR_LISTS` test: 7 old + 2 from M3/M5).
  - Commit: `feat(protocol): carry names in the results and add the winners page`.
  - Mutation proofs: `name` placed second; `name: ""` accepted; `correct` field added to the winners item.
  - Done when: tests green; mutations caught; no id moved.
  - Size: M (about 350).

- [x] **T3. Store and service: names next to player ids.** FR-383 (close)
  - Depends on: T2.
  - Files: `apps/server/src/store/{store,sqlite,faults}.ts` (the results reads left-join `players` by `(match_id, player_id)`), `apps/server/src/service/matches.ts` (reads attach `name` when present), tests `apps/server/test/{service-results-names,store-results-names}.test.ts`; earlier results tests change only if they pin key lists (listed in `PROGRESS.md`).
  - Tests first: a match with web players (names) and client-credential players (no names): phase results, player results and leaderboard rows carry `name` for web players and have no `name` member for the others; order, rank, paging, totals and cursors are identical to the same match without names (the 008 results goldens pass unchanged); a player whose name differs only by case from another is two rows with two names; a name is returned exactly as stored (NFC trimmed text); a player id with no `players` row (any client-credential id, even one that looks like `player:xxxx` but was never joined) has no name; names never change the leaderboard generation or `stale-cursor` behaviour; unscored phases still answer `round-not-applied` with the same bytes; reads write nothing.
  - Commit: `feat(server): show player names in the results reads`.
  - Mutation proofs: inner join (drops client-credential players); `name` first in the row; name looked up by `name_key`.
  - Done when: tests green; mutations caught; FR-383 moved (22 / 7).
  - Size: M (about 450).

- [ ] **T4. The "who guessed right" read.** FR-386 (close); Q12
  - Depends on: T3.
  - Files: `apps/server/src/store/*` (`winnersAfter(matchId, kind, round, after, limit)`: rows with `correct = 1` joined to `players`), `apps/server/src/service/matches.ts` (`phaseWinners(matchId, round, phase, request)` using `readResultsRound`/`isScored`), `apps/server/src/http/server.ts` (`GET /matches/:id/results/:round/:phase/winners`), tests `apps/server/test/{service-winners,http-winners,http-winners-twins}.test.ts`.
  - Tests first: a scored phase lists the named players who guessed right, ordered by player id, paged (limit 1, 2, 500; no repeat or skip; foreign cursor refused); no wrong guess, no choice, no points, no count of wrong guesses anywhere in the reply (scan of the bytes); an unscored phase (phase 2 of the pending round, phase 1 before its reveal, the winner phase, any round above N + 1, in every stage) answers `round-not-applied` naming only N, byte-identical across stages and rounds (P12 holds); a phase nobody predicted or nobody got right answers an empty page; client-credential players are omitted (Q12) or listed per the answer; the route has the same shape errors and order as the other results routes (`round` 0/01/-1 400, `phase` 0/3/x 400, `unknown-match` 404, `unavailable` 503, `POST` 405); CORS `*`; the anonymous limit counts it; twins (same public data, different absorber, during phase 2 and `locked`) give byte-identical bodies for every request; a forced round's phase 2 lists nobody (no absorber rows); it never lists a player who joined after the phase closed.
  - Commit: `feat(server): list who guessed each scored phase right`.
  - Mutation proofs: `correct = 0` rows listed; unscored phase readable in `locked`; ordered by name; the winner phase readable before the finish; twins differ by the planted absorber.
  - Done when: tests green; mutations caught; FR-386 moved (23 / 6).
  - Size: L (about 600).

- [ ] **T5. The lobby's public data, end to end.** FR-373 (close)
  - Depends on: T3.
  - Files: `apps/server/test/{http-lobby-public,service-lobby-public}.test.ts` (tests only unless a defect shows).
  - Tests first: for a lobby with three players, `GET /matches/:id` shows stage `lobby`, map id, timing, `playerCount` 3, and `GET /matches/:id/players` shows the three names in join order; nothing about a round exists: no `schedule`, `victim`, `winner`, `matchSecret`, `haltReason`, no `results` or `victim-revealed` event in the stream, the state is the round-0 state; after `start` the lobby fields disappear in the way plan P5 states (`playerCount` stays because players exist) and the 008 fields appear; an expired lobby shows stage `expired`, keeps its players list until removed, then `unknown-match`; the match list `GET /matches` includes lobbies with stage `lobby` and the 008 summary fields only (no player data); a match with no players and a running stage has no `playerCount` (008 bytes).
  - Commit: `test(server): prove the lobby's public data`.
  - Mutation proofs: `playerCount` leaked as 0 for a running match without players; a `schedule` in the lobby view.
  - Done when: tests green; mutations caught; FR-373 moved (24 / 5).
  - Size: S (about 250).

- [ ] **T6. Goldens, persistence and the 008 byte pins.** FR-390, FR-392 (close)
  - Depends on: T3, T4, T5.
  - Files: `apps/server/test/golden/dev-lobby.json` and its hand-run generator `golden/generate-dev-lobby.ts` (independent: own arithmetic and the dev secrets; imports nothing from `core/lobby.ts` or `core/scoring.ts`), `apps/server/test/{lobby-golden,lobby-durability,wire-compat-008}.test.ts`, `apps/server/test/golden/wire-008.json` (SHA-256 pins of 008 encoder outputs for a fixed 008 match: public views in every stage, every event type, the three results shapes, the error replies of the 22 old kinds).
  - Tests first: golden: for the three dev secrets, a scripted lobby (create, joins with accented and edge-case names in a fixed order, start, a mid-match join, predictions by token and by client credential, the finish) gives the same events (types, seq, names), players list, public data per stage, phase results with names, the winners page of every scored phase, the leaderboard with names and the forced rounds' empty absorber phases — with timing `manual` and clock settings, a restart after every step and every join, in-memory and file databases; a few figures are literals in the test (non-round totals, join order); durability: every kill point (creation, join, start, expiry, steps) recovers to the uninterrupted dump and reads; a restarted lobby is a lobby with its players and valid tokens (persistence: players, names, token digests, stage are stored in the transaction of the event they cause); `wire-compat-008`: every listed 008 wire form encodes to the pinned SHA-256 except the ones the spec names (victim forced, lobby stages, optional fields); the sim package, the map format and `MatchState` files are byte-equal to `rewrite` (the protected-path check also runs as a test over file hashes).
  - Commit: `test(server): pin the lobby goldens, durability and the 008 wire forms`.
  - Mutation proofs: one golden figure changed (the literal test also fails); player row written after the commit (durability); an extra member on the 008 public view (wire pin fails).
  - Done when: tests green; mutations caught; FR-390 and FR-392 moved (26 / 3).
  - Size: L (about 650; golden JSON ~500 apart).

- [ ] **T7. Secrecy and token scans over the whole feature.** NFR-73, NFR-74 (close)
  - Depends on: T6.
  - Files: `apps/server/test/{token-scan,lobby-secrecy}.test.ts`, `apps/server/test/helpers/db-scan.ts` (additions only).
  - Tests first: NFR-73: over a full scripted session (public create, joins, start, predictions, rate-limited and rejected requests, restart, expiry) with the planted tokens in every encoding (plain, hex, base64, base64url, bytes): no token appears in any read body, event frame, log line, error body or header; the database holds a token only as a digest, except the 24 h `memo` rows, which are gone 24 h + 1 ms later; tokens never appear in `request-failed` events or the closed log fields; names appear in logs only as length and hash. NFR-74: nothing about a future round is readable in the lobby or by the new reads (players, winners, names in results): the 008 storage check `storedFutureViolations` runs over every new scenario and finds nothing; twin matches for every new read; the 008 secrecy suites run unchanged in the same run (`git diff` shows none of them edited); the sim and shared sources are byte-equal to `rewrite`.
  - Commit: `test(server): scan tokens, names and secrecy across the feature`.
  - Mutation proofs: token in a `players` column; name logged raw; a pending absorber in a winners reply.
  - Done when: tests green; mutations caught; NFR-73 and NFR-74 moved (28 / 1).
  - Size: M (about 450).

- [ ] **T8. Hand run with the fixture.** (no id; done criterion 3)
  - Depends on: T7.
  - Files: `apps/server/scripts/hand-run-playable.ts` (new; spawns the server on the dev map, drives HTTP with `node:http`, prints a transcript), `specs/011-playable-matches/PROGRESS.md` (transcript summary), `apps/server/test/hand-run-script.test.ts` (the pure parts of the script: the step list and the assertions, a smoke run on port 0 with the fake clock).
  - Steps: create a lobby anonymously, two joins with two tokens, start (manual timing), each player predicts with its own token, the host advances every step, the leaderboard shows both names; transcript with the figures and any failure; no secret printed (token prefixes only).
  - Commit: `feat(server): add the playable-match hand run script`.
  - Done when: smoke test green; a hand run executed by the implementer and recorded; the user runs it for acceptance (done criterion 3).
  - Size: S (about 250).

- [ ] **T9. Close M5 and spec 011: ledger, change list, PR.** NFR-75 (close)
  - Depends on: T1 to T8.
  - Files: `packages/sim/test/traceability.test.ts` (closing-state test for M5: 29 done / 0 pending; `PENDING_011 = []`; the pending-id tests run over an empty set and a synthetic list, as 008 M5'), `specs/011-playable-matches/PROGRESS.md` (the complete list of existing tests and goldens changed, with the reason of each, per milestone: NFR-75), `plan.md` (closing summary and figures), `MEMORY.md` (local; proposal for AGENTS.md only if a rule became permanent).
  - Tests first: the ledger test pins 29 done and an empty pending list. The list of changed tests and goldens is checked by hand against `git diff --name-only rewrite -- "*.test.ts" "*/golden/*.json"` (not by a test).
  - Steps: protected paths clean; scans (sqlite only in `store/sqlite.ts`, timers only in `scheduler.ts`, purity of core and protocol, no logging outside `main.ts`/log sink, no production import of `faults.ts`); no `package.json`/lockfile/`.nvmrc` change; `SCHEMA_VERSION` 2; the full suite once, `CI=1` once; the PR lists the five ledgers, Q1 to Q13 answers, the 30 variables, the routes, the changed tests/goldens. Push, PR, CI green, squash only with the user's OK. Spec status stays `approved` until the user accepts; then it becomes `implemented`.
  - Commit: `test: pin the spec 011 ledger at 29 of 29`.
  - Done when: CI green; counts 29 / 0; `MEMORY.md` updated.
  - Size: S (about 120).
