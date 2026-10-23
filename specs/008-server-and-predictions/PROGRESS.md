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

## Active: M3a' (`feat/008-m3a2-http-server`, not started)
Next step: T1' bookkeeping (ledger 73/23), per `tasks-M3a2.md`. Plan: T2' pipeline + commands (FR-280, 298; 75/21), T3' reads/CORS wire/maps (FR-285; 76/20), T4' main/shutdown/log/re-assertions, T5' close. Hand-offs: `req.headersDistinct.authorization` to `readBearer`; bad namespace TypeError -> 500 + one log; purity scan expects 6 platform files (log, body, router, respond, server, shutdown).
