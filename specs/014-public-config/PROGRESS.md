# Progress 014 — Public match config read
Branch: `feat/014-public-config`. Ledger (done / pending of 12): 12 / 0.

Entry format per task: what changed · tests run and results · mutation proofs (mutant -> test that failed) · untested · next step.

## Protected files and goldens
No re-pin expected (plan section 1). Record here any exception with its reason.

## Log
(empty)

### T1 Bookkeeping targets (ledger 0 / 12)
- Changed: `packages/sim/test/traceability.test.ts` only: `FR_RANGES` `[[1,392],[413,421]]`, `NFR_RANGES` `[[1,76],[81,83]]`; `PENDING_014` (12 literal ids) and empty `DONE_014` with the targets of the table; totals 468 / 466 / 466 became 480 / 478 / 478 (also the independent list test); `PENDING_014` joins the "every id has a test name" exclusion; two new tests (12 literal ids, no overlap, every done id has a title, no pending id already traced).
- Tests: red first (the pinned 468 failed after the ranges moved; one list-order failure fixed in the independent list). Final: `npm test` 302/303 files; the one failure (`service-players-flow`, 4 tests) passes alone in 1.9 s (load flake, same as the known timeouts under CPU load); `CI=1 npm test` 303 files / 4803 passed / 4 skipped; typecheck green.
- Mutations (full `npm test`, restored byte for byte): `FR-421` dropped from `PENDING_014` -> the 12-ids test and the "every expected id has a test name" test failed; `FR-413` in both lists -> the 12-ids test and the closed/pending test failed.
- Untested: nothing new. Next: T2 (FR-416).

### T2 Protocol shape, encoder, decoder, golden (ledger 1 / 11: FR-416)
- Changed: `packages/protocol/src/{wire,encode,decode,index}.ts` (`PublicConfig`, `PUBLIC_CONFIG_KEYS`, `encodePublicConfig`, `readPublicConfig`); `packages/protocol/test/public-config.test.ts` (37 tests); `packages/protocol/test/golden/config-014.json` (made by hand: texts typed, hashes taken from the typed text by a scratch script, not from the encoder); `traceability.test.ts` (FR-416 pending -> done). `purity.test.ts` globs `src/**`, no change needed (the golden hash is taken in the test with `node:crypto`; no crypto in src).
- Decisions (user-approved): flat shape; the decoder refuses a duplicate map (`maps[i]`) and an `enabled` that disagrees with `maps`. The encoder also refuses both, an extra or inherited key (throws `RangeError`, like the other encoders) so nothing outside the list reaches the text.
- Tests: red first (36 of 37 failed before the code). Green: `npm test` 304 files / 4840 passed / 4 skipped; typecheck green; `CI=1 npm test` same.
- Mutations (full `npm test` each, restored byte for byte): two keys swapped in `PUBLIC_CONFIG_KEYS` -> 8 failures (key list, 3 text, literal, SHA pins); `enabled` dropped from the written keys -> text and SHA tests fail; decoder key set widened to the input's own keys -> "refuses an unknown field"; decoder `isMapId` skipped -> "map id of a bad shape"; encoder `JSON.stringify(config)` -> "key order whatever the input order" and "refuses a value out of shape".
- Untested: nothing server-side yet. Next: T3 (service read, FR-414).

### T3 Service read from the settings (ledger 2 / 10: FR-414)
- Changed: `apps/server/src/service/public-config.ts` (new, pure `publicConfigOf(settings)`, field by field, fresh array), `matches.ts` (`publicConfig()` on `MatchService`, reads the service's own `settings` object at call time, returns `{ ok: true, reply }`), `apps/server/test/service-public-config.test.ts` (12 tests), `traceability.test.ts` (FR-414 done).
- Existing tests touched (one entry each, reason: the service gained one method): the three pinned method lists in `service-create.test.ts`, `service-no-recovery.test.ts`, `service-seam.test.ts` now include `publicConfig` (sorted between `players` and `publicMatch`). Nothing else changed.
- Tests: red first (module missing). Green: `npm test` 305 files / 4852 passed / 4 skipped; typecheck green; `CI=1 npm test` same.
- Mutations (full `npm test` each, restored byte for byte): `enabled` as `length >= 0` -> 4 failures; `enabled: true` -> 4; `maxInterval` read from `minInterval` -> 6; `maxPlayers` omitted -> 8; maps `.sort()` -> 3 (order tests); snapshot of the config taken when the service is built -> 2 ("one object, no copy" test). Before the method lists were extended, the mutants also tripped the three pinned lists (that run is not counted).
- Untested: the HTTP surface (T4). Next: T4 (route, FR-413 / FR-418 / FR-419).

### T4 The route GET /config (ledger 5 / 7: FR-413, FR-418, FR-419)
- Changed: `apps/server/src/http/server.ts` (one route entry in `productionRoutes`: `GET /config`, `body: 'none'`, `checkQuery: noQuery`, `decide` -> `replyOf(service.publicConfig(), 200, encodePublicConfig)`; header and doc comments name it), `apps/server/test/http-config.test.ts` (18 tests, real listener, fake clock), `traceability.test.ts` (FR-413, FR-418, FR-419 done). No route-list pin test exists, so none was extended. Router, limiter, CORS and status code untouched.
- Findings: the request class follows the method (`classOf`: POST is a command), so "marked as a command" is the route method POST; CORS `*` holds for a GET without `Authorization` (a credentialed GET follows the allowed-origin rule as for every read; its body is identical, asserted).
- Tests: red first (15 of 18 failed). Green: `npm test` 306 files / 4870 passed / 4 skipped; typecheck green; `CI=1 npm test` same.
- Mutations (full `npm test` each, restored byte for byte): `body: 'object'` -> 9 failures; `checkQuery` removed -> 2 (query tests); method POST (command class) -> 16; CORS origin echoed instead of `*` (cors.ts) -> 11 (http-config plus the three older CORS files); status 201 -> 7.
- Untested: secrecy scans and stability (T5), creation boundary (T6). Next: T5.

### T5 Secrecy, stability and the mutation table (ledger 9 / 3: FR-415, FR-417, NFR-81, NFR-83)
- Changed: `apps/server/test/config-secrecy.test.ts` (8 tests), `apps/server/test/config-mutants.test.ts` (new, 18 tests), `traceability.test.ts` (4 ids done). No source touched. Planted values (operator and client credentials, namespace, origin, hidden map id and folder, host, port, database path, 11 limit values, running cap, open-lobby and running caps, lobby expiry, forced span) are scanned in raw, hex, base64, base64url (decimal and hex for numbers) over the real listener, the service, and settings read from the environment. 50 reads across no match, open lobbies with a join, running, finished (4 rounds), halted (map lost), clock jumps both ways and five callers are one byte string. NFR-83: a throwing store proxy with clock and random spies (service) and a store proxy armed during `GET /config` plus the draw count (listener); protected-files and dev-secrets/dev map hashes checked in the same file.
- Tests: red first through the ledger (the pending ids were already traced); the new tests pass on the existing code, so their red proof is the mutants. Green: `npm test` 308 files / 4900 passed / 4 skipped; typecheck green.
- Mutations (the five files of the area per mutant, restored byte for byte, full suite at the end): `lobbyExpiryHours` added to the encoder output -> 18 failures (secrecy, mutants, http-config, service, protocol); `host` added -> 20; match count added -> 18; time stamp added -> 18; `enabled` flipped in `publicConfigOf` -> 22.
- Untested: creation boundary (T6). Next: T6 (FR-421).

### T6 Creation boundary (ledger 10 / 2: FR-421)
- Changed: `apps/server/test/config-creation-boundary.test.ts` (new, 25 tests), `traceability.test.ts` (FR-421 done). No source touched. The config is read first (service `publicConfig()` and `GET /config` decoded with `readPublicConfig`); every case derives from it, for the default bounds (map `dev`) and a non-default set (three maps in a fixed order, 61 / 7000 / 12 / 8, cap 6), each on the service (`createPublic`) and over HTTP (`POST /matches`): every listed map creates; interval = min and = max ok, min - 1 -> `invalid-timing` with `e`, max + 1 -> `h`; shortest L1 and L2 ok, each minus 1 -> `f` / `g`; a map not listed (also one the server holds, `hidden`) -> `unknown-map`; `maxPlayers` joins ok then `match-full` (service for both sets, HTTP for the cap-6 set; 200 joins over HTTP skipped for cost); disabled config (bounds kept) -> `unknown-map` for any map. Fresh source and request id per creation, limits raised.
- Tests: red first through the ledger (FR-421 traced while pending); the boundary tests pass on the existing code (their red proof is the mutants). One fixture slip fixed: `Dev` is an invalid-shape id (`invalid-request`), replaced by `dev2`. Green: `npm test` 309 files / 4925 passed / 4 skipped; typecheck green.
- Mutations (boundary file per mutant, on `publicConfigOf`, restored byte for byte, full suite at the end): `minInterval + 1` -> 6 failures; `maxInterval` read from `minInterval` -> 6; extra map `hidden` listed -> 18; `maxPlayers - 1` -> 9.
- Untested: nothing new. Next: T7 (FR-420, NFR-82, close).

### T7 Close: existing wire unchanged, ledger (ledger 12 / 0: FR-420, NFR-82)
- Changed: `apps/server/test/config-unchanged.test.ts` (new, 4 tests), `packages/sim/test/traceability.test.ts` (FR-420 and NFR-82 done, `PENDING_014` empty, closing-state test `NFR-82 ...`, NFR-82 added to the self-traced list, the 014 title check also counts the ids traced by this file). No source touched. The test pins: the production route table = the 18 routes of the end of spec 011 plus exactly `GET /config`; the 27 error kinds and the 30 settings variables as literals; SHA-256 of `wire-008.json`, `core-timelines`, `dev-lobby`, `dev-results`, `dev-secrets`, `service-timelines` and `protected-files.json`, taken from `git show 831ba9e:<file>` (the end of spec 011); the pin lists neither protocol nor server sources.
- No re-pin: the protected roots are `packages/sim/src`, `packages/shared/src`, `maps/dev`, the sim and web goldens; `protected-files.json` lists neither `packages/protocol` nor `apps/server/src`. `git diff --stat 831ba9e HEAD` over `apps/server/test/golden`, `apps/web`, `packages/sim/src`, `packages/shared/src` shows only `traceability.test.ts` (a test, not a golden).
- Tests: red first through the ledger (FR-420 traced while pending); a second red: `NFR-82` in a ledger title changes the self-traced list (fixed). Green: `npm test` 310 files / 4930 passed / 4 skipped; `CI=1 npm test` same; typecheck green.
- Mutations (`config-unchanged` per mutant, restored byte for byte): a second route (`GET /config2`) -> 1 failure (route table); a settings variable added -> 1 (variables); an error kind added -> 1 (error kinds).
- Untested: the browser (no UI in this spec). Next: the user opens the PR and merges; then set the spec status to `implemented`; spec 013 reads `GET /config`.

## Hand-off to spec 013
The web create screen reads `GET /config` (anonymous, CORS `*`), decodes it with `readPublicConfig` from `@mbrg/protocol`, offers only the listed `maps` and timings inside the bounds, shows "creation off" when `enabled` is false, and still handles a server refusal (settings change at a server restart). It adds its own FR range to the ledger.

## PR body
**Summary.** Spec 014: one anonymous read, `GET /config`, publishes what public creation enforces: the public map ids (operator order), the timing bounds in seconds (shortest interval, longest interval, shortest L1, shortest L2), the player cap and `enabled` (true exactly when the map list is not empty). The values come from the same settings object `createPublic` reads, so a creation inside the config is never refused for map or timing. New protocol names: `PublicConfig`, `PUBLIC_CONFIG_KEYS`, `encodePublicConfig`, `readPublicConfig`. Decisions D1 to D7 (flat shape; one settings object; the service owns the read; field-by-field encoder; `enabled` derived and checked by the decoder; normal anonymous GET pipeline; hand-made SHA-256 golden `config-014.json`). The decoder also refuses a duplicate map and an `enabled` that disagrees with `maps` (D5, approved). No existing byte changed: wire-008, the 011 goldens and `protected-files.json` are byte-identical; no re-pin; the route table gains only `GET /config`.

**Test results.** `npm test`: 310 files, 4930 passed, 4 skipped; `CI=1 npm test` the same; `npm run typecheck` green. Every task has mutation proofs in `PROGRESS.md`.

**Ledger (12 ids, 12 done / 0 pending).** FR-413 route and body (T4); FR-414 `enabled` derivation (T3); FR-415 no private value (T5); FR-416 encoder, decoder, golden (T2); FR-417 identical bytes (T5); FR-418 anonymous GET pipeline (T4); FR-419 405 and `Allow` (T4); FR-420 existing wire unchanged (T7); FR-421 creation at each bound (T6); NFR-81 mutation table (T5); NFR-82 ledger (T7); NFR-83 no storage, clock or random (T5).

**Out of scope.** The web create screen (spec 013), the Discord bot (012), any change to settings, limits, router, CORS, the map format or the simulation, and a config for operator creation.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
