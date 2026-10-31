### M4 — HTTP surface and limits (`feat/011-m4-http-surface`; 15 / 14 -> 21 / 8)

Plan sections 1 (P1, P8, P9, P12 to P14), 8, 12 (M4 row), 15 (Q8, Q11). Branch cut from `rewrite` after M3 is merged. This is the only milestone that changes the request pipeline (`http/server.ts`). Blocked on: Q8 (rate defaults), Q11 (CORS of public POSTs).

**Ids that M4 may name:** FR-379 (T3), FR-369 and FR-370 (T4), FR-381 (T5), FR-385 (T6), NFR-72 (T8). Parts of ids closed earlier are cited with part names (`FR-376 (stream)`, `FR-384 (logs)`, `FR-373 (public data)` is NOT yet citable: FR-373 closes in M5, describe it in words).

**Hand-offs from M3**: service methods `createPublic`, `start`, `join`, `players`, `playerTokenOf`, `submit`/`ownPredictions` with a resolved player id; `identity.ts` has the `player` role and `submitterOf`; `limitKeys` handles `player`; settings list of 25; status table has the five new kinds (M1, M2, M3 added `forced-absorber`, `match-started`, `match-expired`; this milestone adds `name-taken` and `match-full` if M3 did not; check); `Route` has `hostParam`, `authorize`, `playerLimit`.

- [x] **T1. Branch and bookkeeping targets.** (no pending id named)
  - Depends on: M3 merged; Q8, Q11 answered.
  - Files: `packages/sim/test/traceability.test.ts` (comments), `specs/011-playable-matches/PROGRESS.md`.
  - Commit: `test: prepare the spec 011 bookkeeping for M4`.
  - Done when: suite, typecheck, `CI=1` green; counts 15 / 14.
  - Size: S (about 30).

- [x] **T2. Rate settings, trusted proxy hops and the source of a request.** (words only)
  - Depends on: T1; Q8.
  - Files: `apps/server/src/service/settings.ts` (`MBRG_LIMIT_CREATE_SOURCE`, `MBRG_LIMIT_CREATE_ALL`, `MBRG_LIMIT_JOIN_SOURCE`, `MBRG_LIMIT_JOIN_MATCH`, `MBRG_TRUSTED_PROXY_HOPS`; `Limits` gains four entries; 30 variables), `apps/server/src/http/source.ts` (new, pure: `sourceOf(peer, forwardedValues, hops)`), `apps/server/src/http/limits.ts` (`createKeys(source, limits)`, `joinKeys(source, matchId, limits)`), tests `apps/server/test/{server-settings,service-settings,service-seam,http-source,http-limits}.test.ts`, `helpers/main-child.ts`.
  - Tests first: 30 variables in order; defaults (the starred values of plan 14.1); `LIMIT` rules reused; `MBRG_TRUSTED_PROXY_HOPS` 0 to 8, default 0; `sourceOf` with hops 0 ignores `X-Forwarded-For` entirely (a forged header changes nothing); hops 1 takes the last entry, hops 2 the second from the right; fewer entries than hops falls back to the peer; entries that are not IP literals, empty, over 64 characters or more than 16 entries fall back to the peer; several header lines are joined in order; the result is a string used only as a limiter key (and hashed in the memo scope, never stored raw); `createKeys` returns the per-source and the overall key with their limits; `joinKeys` the per-source and per-match keys.
  - Commit: `feat(server): add the creation and join limits and the proxy hops`.
  - Mutation proofs: leftmost entry used; hops 0 reading the header; `create-all` key per source.
  - Done when: tests green; mutations caught; no id moved.
  - Size: M (about 400).

- [x] **T3. Pipeline: the player role and token submissions over HTTP.** FR-379 (close)
  - Depends on: T2.
  - Files: `apps/server/src/http/{router,server}.ts` (`Route.holders`/`matchParam` replace the single `hostParam` internally while keeping `hostParam` working for advance; stage 1 asks `service.playerTokenOf` for a `candidate` on a route that lists `player`), the submission and own-predictions routes (`shape`/`authorize`/`playerLimit`/`decide` use `submitterOf`), tests `apps/server/test/{http-player-token,http-pipeline,http-commands,http-reads}.test.ts`.
  - Tests first (real listener, port 0, fake clock): with a player token, `POST /matches/:id/predictions` stores for `player:<local>` and answers exactly the 008 reply bytes; the body `playerId` of another player or a client-style id is 403 `forbidden`, a malformed one 400 `invalid-player-id` (checked first), no Bearer 403, a client credential behaves as in 008 (existing suites unchanged); the token of match A on match B is 403; `GET /matches/:id/predictions` with a player token returns its own predictions only and 403 for another `playerId`; the per-player submission limit applies to a player id exactly as to a client's; the stage-1 lookup costs one indexed read and only for routes that list `player`; a token never appears in any reply or log (scan); a host token on a submission route is 403; an advance route still accepts the host token and the operator only.
  - Commit: `feat(server): accept player tokens for predictions`.
  - Mutation proofs: lookup run on every route; `playerId` of the body trusted; token accepted across matches; host token accepted on the submission route.
  - Done when: tests green; mutations caught; FR-379 moved (16 / 13).
  - Size: M (about 600).

- [x] **T4. Public creation over HTTP.** FR-369, FR-370 (close)
  - Depends on: T3.
  - Files: `apps/server/src/http/server.ts` (`POST /matches`: no Bearer, or an unrecognised one, goes to `service.createPublic` with the source; operator Bearer goes to `service.create` as before; creation rate keys through the second limiter phase after the body is read), tests `apps/server/test/{http-public-create,http-public-limits}.test.ts`.
  - Tests first: anonymous creation with a listed map and an in-bounds timing answers 201 with exactly `{matchId, match(stage lobby), hostToken}` bytes and nothing else secret (scan: no secret, seed, absorber, other match data); the operator path still answers 201 and a `phase-1` match; a bad credential is treated as anonymous (not 403) so the public path is not an oracle for credentials; every refusal is the closed code at the right status (`unknown-map` 404, `invalid-timing` 422 listing public rules, `invalid-request` 400, `too-many-matches` 409 at the open-lobby cap, `rate-limited` 429 with `Retry-After`) and creates and stores nothing (database dump before/after equal, no random draw); the per-source limit at its edge (limit - 1, limit, limit + 1 requests inside the 60 s window; the window slides on the fake clock) and the overall limit across sources at its edge; a refused (rate-limited) request is counted nowhere; the memo replay over HTTP returns the first reply (token included) for the same source, request id and content; two sources with the same id do not see each other's reply; the open-lobby cap boundary with the fake clock after an expiry; a public map list of one map rejects the others; `manual` per Q9.
  - Commit: `feat(server): let anyone create a lobby over HTTP`.
  - Mutation proofs: overall key per source; rate check before the body is read (a malformed body costs a slot); operator credential honoured on the public branch; cap `>` vs `>=`; refusal storing the memo.
  - Done when: tests green; mutations caught; FR-369, FR-370 moved (18 / 11).
  - Size: L (about 650).

- [x] **T5. Start and join over HTTP.** FR-381 (close)
  - Depends on: T4.
  - Files: `apps/server/src/http/server.ts` (`POST /matches/:id/start` with `hostParam: 'id'`; `POST /matches/:id/players` anonymous with join rate keys, 201 with the join reply), tests `apps/server/test/{http-start,http-join,http-join-limits}.test.ts`, `apps/server/test/http-status.test.ts`.
  - Tests first: join answers 201 with exactly the `JoinReply` bytes (token once); `name-taken` 409, `match-full` 409, `match-expired` 409, `match-finished`/`match-halted` 409, `invalid-request ['name']` 400 for each name rule edge, `unknown-match` 404; the per-source and per-match join limits at their edges (limit - 1, limit, limit + 1; fake clock; a refusal counts nowhere; a join refused for its name does not burn the per-match budget of others beyond its own admitted slot — the spec's "rate limited" counts admitted requests); a repeated join with the same request id and content returns the first reply, token included, and joins nobody twice (over HTTP, same source); `start` with the host token: 200 with the public data in `phase-1`, a second `start` with the same request id replays, without or with another id `match-started` 409, expired `match-expired` 409, a wrong, player or missing token 403, the operator credential 403 (P14), unknown match 404, `step-mismatch` for an `advance` sent to a lobby (stage `lobby`); methods: `GET /matches/:id/start` is 405 with `Allow: POST, OPTIONS`; the 4,096-byte body rule applies to both; `Connection: close` rules as 008.
  - Commit: `feat(server): start and join matches over HTTP`.
  - Mutation proofs: join limit per source only; start accepting a player token; token in the 409 reply; the per-match key shared across matches.
  - Done when: tests green; mutations caught; FR-381 moved (19 / 10).
  - Size: L (about 650).

- [x] **T6. The players list and the joined event on the wire.** FR-385 (close); parts `FR-376 (stream)`
  - Depends on: T5.
  - Files: `apps/server/src/http/server.ts` (`GET /matches/:id/players`, credential-free), tests `apps/server/test/{http-players,stream-players}.test.ts`.
  - Tests first: 200 bodies byte-equal to the protocol encoders; items in join order with id, name, join order and nothing else; `limit`/`cursor` rules as the other list routes (400 naming the field, `invalid-request ['cursor']` for a foreign cursor); `unknown-match`; `unavailable` under the fault seam; `POST` is 405; the anonymous per-minute limit counts the route; no token, digest, prediction, or count of predictions appears (scan); the stream: a client subscribed to a lobby receives each `player-joined` frame in order with the stored `seq` and `id:` line, a subscriber that connects after three joins and sends `Last-Event-ID: 0` replays them, `Last-Event-ID` in the middle gets the rest, the heartbeat and limits of 008 apply to lobby streams, the `start` event follows the joins, the expiry event ends the lobby's story; the hub is not changed (the existing stream suites pass unchanged).
  - Commit: `feat(server): list players and stream the joins`.
  - Mutation proofs: token or digest in an item; list ordered by name; the stream frame dropping `name`.
  - Done when: tests green; mutations caught; FR-385 moved (20 / 9).
  - Size: M (about 500).

- [x] **T7. CORS, logs and error bytes for the new paths.** (parts `FR-384 (logs)`)
  - Depends on: T5, T6.
  - Files: `apps/server/src/http/{cors,respond,log}.ts` as needed, tests `apps/server/test/{http-cors-public,server-log-scan}.test.ts`, `apps/server/test/http-cors*.test.ts` (new paths in the pinned path list).
  - Tests first (Q11): the public `POST` create/join/start preflights and replies follow the plan's rule (allowed origins only; a foreign origin gets no permission; `Authorization` headers per FR-286 unchanged); `GET` players and results stay `*`; `Retry-After` and `Allow` on the new paths; the log scan over a whole scripted session (create, three joins, start, predictions, rate-limited and rejected requests): no token, no host token, no name text, no secret appears in any log line; a name appears in the log only as its length and a hash (a join with a 24-character name of edge characters is logged by length + hash); `request-failed` events carry name and stage only (008); error bodies never echo a name or a token (a join with a name that fails the rules answers `invalid-request ['name']` without the text).
  - Commit: `test(server): scan the new routes for tokens, names and CORS`.
  - Mutation proofs: name logged raw; `*` sent on a public POST; token echoed in an error body.
  - Done when: tests green; mutations caught; no id moved.
  - Size: M (about 400).

- [x] **T8. Bounds of anonymous creation and join, driven to their edges.** NFR-72 (close)
  - Depends on: T4, T5, T6.
  - Files: `apps/server/test/{anonymous-bounds,anonymous-bounds-wire}.test.ts`, helpers (additions only).
  - Tests first (service plus real listener, fake clock; sockets opened in batches of 100 on Windows): each list and body is bounded and tested at its edge: players per match (`maxPlayers`, then `match-full`), open lobbies, public running matches, names (24), request body (4,096), players page (500), request ids (credential set and length), memo rows after N creations/joins at the rate limit (at most N, purged at 24 h + 1 ms), anonymous streams (5 per address), event backlog of a lobby with 200 joins (replay ordered and bounded by the page of the read and by the stream's own limits), limiter key count after a flood from 10,000 distinct fake sources (keys pruned after the window; `keyCount` returns to 0 after 60 s + sweep), a 10,000-join flood at the rate limit stores at most the limit and leaves memory in the per-window bound; no test depends on wall-clock sleeping.
  - Commit: `test(server): drive every anonymous bound to its edge`.
  - Mutation proofs: cap removed (the edge test fails); memo purge removed for the new scopes; limiter keys never pruned.
  - Done when: tests green; mutations caught; NFR-72 moved (21 / 8).
  - Size: M (about 450).

- [x] **T9. Real-server flow and lobby secrecy on the wire.** (words only for pending ids; parts of closed ids named)
  - Depends on: T7, T8.
  - Files: `apps/server/test/{http-lobby-flow,http-lobby-twins}.test.ts`, `apps/server/test/helpers/{http-client,stream-run}.ts` (additions only).
  - Tests first (child process kill by PID in `finally`, port 0, fake clock where possible): create (anonymous), two joins with tokens, a stream open from before the first join, start, predictions by token, the stream shows `schedule`/`victim-revealed`/... after the start; `GET /matches/:id` in the lobby contains stage, map, timing, player count and no field of a round; twins (two lobbies with equal public data, different secrets via the test seed source) give byte-identical lobby reads and streams; the planted-secret scan (decimal, hex, base64, base64url, raw bytes) over every lobby reply and event finds nothing; a restart of the real server process in the lobby keeps the players and the tokens; `main.ts` offers no seed-source option (008 scan re-run over 30 variables).
  - Commit: `test(server): prove the lobby flow and its secrecy over HTTP`.
  - Mutation proofs: `commitment` replaced by a value derived from future data in the lobby view (twins fail); secret in a lobby event (scan fails).
  - Done when: tests green; mutations caught; no id moved.
  - Size: M (about 450).

- [x] **T10. Close M4: closing-state test, process checks, PR.** (no pending id named in titles)
  - Depends on: T1 to T9.
  - Files: `packages/sim/test/traceability.test.ts` (closing-state test for M4: 21 done / 8 pending), `specs/011-playable-matches/PROGRESS.md`, `MEMORY.md` (local).
  - Steps: as M1 T9; the PR lists Q8, Q11, the ledger, the new routes and variables (30), the changed tests.
  - Commit: `test: pin the spec 011 ledger after M4`.
  - Done when: CI green; counts 21 / 8; `MEMORY.md` updated (next: M5).
  - Size: S (about 80).
