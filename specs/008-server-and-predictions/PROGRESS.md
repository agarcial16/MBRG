# PROGRESS 008 — Server and predictions
Per-task log, newest entry last. Detail lives here; `MEMORY.md` keeps only durable decisions and lessons. Keep entries short: if this file passes ~150 lines, summarize merged milestones into one line each.

Entry format:
- **Task** (id, branch, commit) and date.
- **Changed**: what and which files.
- **Tests run**: commands and results (counts, timings of slow tests).
- **Untested / open**: what is not verified yet.
- **Next step**.

## Merged milestones (summary)
- M1 PR #28 (061119b), M2a PR #29 (ac1263a): protocol package, pure match core, sim exports.
- M2b PR #30 (b9effa5): store (`src/store`: only `node:sqlite` user; WAL + exclusive lock on Windows and Linux CI; `faults.ts` seam) and service (`src/service`; `scheduler.ts` = only timers). Credential TEXT + namespace. One tx per decision, publish after commit, memo keys by digest.
- M2b' PR #31 (93727f4), ledger 67/29: halting (`mapForStep` before every step and at start), `start()`/`close()`, `stepSafely` retry 3 s, storage failure -> `unavailable`, restart = new store + service on the file + `start()`. Lifecycle golden `service-timelines.json`, durability (181 seam points + real SIGKILL == seam file). NFR-50 worst 22 ms (Windows). Review B1 fixed (start() enumeration failure arms a 3 s retry). Slow tests got `{ timeout: 60_000 }`; load-flaky once: 'FR-224 the territory layout takes no owners'.
- M3a PR #32, ledger 73/23 (split from M3a' on 2026-10-23 under C8 at +4,580/-121): ErrorReply unification + `encode.ts` + `page.ts`; `ServerSettings` (13 `MBRG_*`); store reads + `classifyStoreError` by errcode (CI Node 24.21 errcode unchecked; sqlite codes 7, 9, 15, 22 -> store-failure); service reads (outcome unions, `unknown-match` not memoised, D26); pure `http/{limits,identity,cors,status}.ts`. D27: hex-only credentials < 32 refused (proposed, not in spec). CORS `*` for credential-free GET (spec FR-286 wins over a "never *" brief). Map-validation kept 422. Closing commits 458dc3f, f1399f4, 25b229d, b5f735d.
- Digests: 006 D11 23c90b67d52cbcfa, 005 box 5f8e31fd50523b09, 007 0b3472aa148ea55e.

## Active: M3a' (`feat/008-m3a2-http-server`, T1' done)
- **T1'** (feat/008-m3a2-http-server, commit: see git log "test: prepare the spec 008 bookkeeping for M3a'"), 2026-10-23.
  - Changed: `traceability.test.ts` comment only (targets T2' 75/21, T3' 76/20, T5' 76/20 already present from M3a; added that T5' pins the 3 M3a' ids done). Counts stay 73/23; the closing-state test already holds the 3 M3a' ids as a literal list (asserted pending). `tasks-M3a2.md` T1' ticked. Plan/tasks docs already committed in d3b7af1, so no separate docs commit.
  - Tests run: `npm test` 161 files, 2836 passed, 2 skipped (82 s); `npm run typecheck` clean. `CI=1` run not separately done.
  - Untested / open: nothing new.
  - Next step: T2' (pipeline + command routes).

Plan after T1': T2' pipeline + commands (FR-280, 298; 75/21), T3' reads/CORS wire/maps (FR-285; 76/20), T4' main/shutdown/log/re-assertions, T5' close. Hand-offs: `req.headersDistinct.authorization` to `readBearer`; bad namespace TypeError -> 500 + one log; purity scan expects 6 platform files (log, body, router, respond, server, shutdown).
- **T2'a** (feat/008-m3a2-http-server, commit: see git log "feat(server): add the http pipeline modules"), 2026-10-23. First half of T2' (platform modules; no command routes).
  - Changed: `src/http/{server,router,body,respond,log}.ts` (+1,313 lines with tests). `createServer({service, settings, clock, log, routes?})`: `node:http` with `CONNECTION_OPTIONS`; stages admit (identity via `headersDistinct.authorization`, host-token check only for a found route with `hostParam`, limiter) -> route -> body (Content-Length > 4,096 answered before reading, chunked counting, UTF-8/JSON object) -> query -> shape -> authorize -> `ticket.extend` -> decide -> unexpected (one `request-failed` event: stage + error name; 500 `{"kind":"unavailable"}`). `productionRoutes` is empty until T2'b/T3'. Router: no percent-decoding, empty segment/trailing slash/absolute-form -> unknown-path, `Allow` = methods of the path + OPTIONS sorted, HEAD -> 405 on known path, OPTIONS on known path -> 204 preflight; `parseRoundSegment`: past 2^53-1 -> `beyond` (round-not-applied), leading zero/sign/fraction -> `invalid`. `addressOf(undefined, ordinal)` gives `unknown-peer-<n>` per socket. Tests: `http-pipeline` (26 tests), `http-body` (10 tests), `helpers/{http-client,server-harness}.ts`; `http-purity` tolerates the absence of `shutdown.ts` until T4'.
  - Tests run: `npm test` 163 files, 2873 passed, 2 skipped (84 s); typecheck clean. Mutations (full suite, one at a time, all caught): declared length +1, chunk count +1 (first survived: equivalent via `parseBodyBytes`; killed by a chunked body that never ends), 405 -> 400, Allow dropped, per-player `extend` replaced by `admit`, 500 body with the message, log event with `message`.
  - Untested / open: `CI=1` run; the production routes and the status of replayed commands (T2'b); CORS on the wire and map files (T3'); the 500 path when the log sink throws is coded, not tested.
  - Next step: T2'b (routes create/advance/submit, `http-commands.test.ts`, FR-280 and FR-298 out of PENDING_008, 75 / 21).
