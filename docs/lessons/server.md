# Lessons: server, protocol, persistence (`apps/server`, `packages/protocol`)
Read before touching the server, the protocol, scoring or the store.

## Decisions
- `tsx` + `@types/node` are dev deps of `apps/server`; engines >=24, `.nvmrc` 24 (any raise goes to the user).
- Only `store/` uses `node:sqlite`; only `scheduler.ts` has timers; one transaction per decision, publish after commit.
- Playable matches (spec 011): operator matches have no lobby; forced round phase 2 = min(L1, F), A earlier; client namespace `player` is reserved; the plain token lives only in the 24 h memo row (the table keeps the digest); public matches are never `manual` (the hand run uses a long clock timing + host `advance`); only named players appear in who-guessed-right; open-lobby cap at creation, public-running cap at start.
- Server default forced phase is 5 s (`DEFAULT_FORCED_PHASE_SECONDS`); the test server uses `MBRG_FORCED_PHASE_SECONDS=10` and the user keeps 10 s for now. Making 10 s the default needs a Full-SDD spec.
- A relative `MBRG_MAPS` path resolves from `apps/server` (npm workspace cwd): use an absolute path or the server answers `map-validation`/`invalid-map`.
- `startServer` of the test helpers builds TWO fake schedulers on the same fake clock: the hub's (exposed as `harness.scheduler`, heartbeats only) and the service's (`harness.base.scheduler`, where the match steps are armed). Driving the clock through the wrong one moves nothing; the e2e harness (spec 023) uses `base.scheduler`.

## Lessons: tests and traceability
- Twins keep ONE secret (the commitment is public) and differ by round seeds, so they run in process.
- Fake-random secrets force round 1 (d = 1): old fixtures that predict an absorber or rely on L1 need a secret in 00-1f.
- A test file must not declare a function named like an import (`join`). The event encoder refuses extra members, so a secret cannot ride in an event.
- A write-order bug is caught only by pinning the order of writes per transaction. A fault test needs a failure INSIDE the transaction (`failWrite`) to see a publication moved before the commit.
- A self-tracing test file is excluded from `tracedIds`: closing ids named only there need `TRACED_HERE`. A test that closes an id only the ledger file names needs that id in the self-traced list. Partial ids need part-named titles.
- Use a box object for values assigned in `store.transaction` callbacks. Tests must not depend on the SQLite warning.
- `withTempDir` is sync only (use `withTempDirAsync`, and close servers/readers INSIDE its body before it removes a database file on Windows). Child-process tests kill by PID in `finally`.
- A claimed "(HTTP)" part needs a wire test. A mutation pattern can match the wrong statement: check the failing files name the intended one. A mutation test of a refusal path needs an assertion on the OTHER key too.
- In-memory stores cannot be read back: wrap the store to record writes, and read a closed file database.
- A defence-in-depth check (service re-checks what the route checked) hides a removed route check: test each layer with a stub that accepts anything.
- A golden generator must not share code with the code under test. A golden re-pin is verified by a script comparing old and new JSON (only numbers, digests, added events). Scripts with backticks or `${}` go in an `.cjs` file in the scratchpad, not `node -e`/heredoc.

## Lessons: HTTP, stream, scoring
- Bound EVERY request body and send `Connection: close` on a reply while a body over 4,096 is unread; answer Node's own 431/400/408 in a `clientError` handler. The log has closed error fields only (no message, no stack).
- `main.ts` exits through a flush; shutdown logic is in `http/shutdown.ts` with injected deps; a `res` 'close' hook closes connections that go idle. A pipelined request behind an in-flight one reaches a kept-alive connection during shutdown.
- A hub's open is ONE synchronous turn (read, register, write); the gauge place is taken at stage 1 and released in a `finally` unless the hub took it.
- Windows: 1,000 sockets opened at once overflow the listen backlog: open in batches of 100. Kill tests use `process.execPath` + `--import tsx` and a blocking listener (`fixtures/kill-child.ts`), never POSIX tools.
- Scoring: the core stays pure; `performStep` returns `scored` descriptors (n, d, winner) and the shell scores stored predictions inside the decision transaction; `persist` calls `putResults` only for a phase with rows (a no-prediction match keeps its old write sequence).

## Lessons: per-server history (spec 024)
- The server never learns a Discord server id: the bot sends the community key (lowercase hex SHA-256 of the id) only in request BODIES; the key is read by the history read alone (source scan pins the files that name `communities`). A new read of it needs its own spec and its own scan.
- Finish instant = `matches.last_step_ms` of a finished match; a step run on time keeps its SCHEDULED instant (up to `TOLERANCE_MS` before the commit), so a match is listed only once SETTLED (`last_step_ms < now - TOLERANCE_MS`). That is what keeps a walk's snapshot exact.
- The snapshot guarantee breaks if the wall clock jumps BACKWARD by more than `TOLERANCE_MS` in the middle of a walk (a match finishing then could carry an instant older than the walk's head, and join or skip the walk). Accepted: a stepped clock is an operator fault, a slewed one is fine; any change to the settled bound must keep "a later finish always sorts newer than the head".
- Statement-count tests count Store method calls (a Proxy), the SQL per method is pinned by the query-plan test; a test that plays a full match takes an explicit 120 s timeout (the suites run in parallel).
