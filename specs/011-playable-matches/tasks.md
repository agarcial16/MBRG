# Tasks 011 — Playable matches (server and protocol)
Plan: `specs/011-playable-matches/plan.md`. Spec: `spec.md` (approved by the user, 2026-10-30). Status: approved by the user on 2026-10-30; the questions of plan section 15 (Q1 to Q13) are answered as recorded in spec D7 (Q2: phase 2 = the absorber window of length L1 is shortened to min(L1, F); A moves earlier by the time saved; `locked` keeps L2; the next round is anchored at the application as in 008). Tasks marked "blocked on Q#" are unblocked. Any later change goes to the spec first, then the plan, then these tasks.

Rules for every task:
- Delivery: one branch per milestone, cut from an up-to-date `rewrite`; one PR into `rewrite` (never `main`, never push to `rewrite`); squash merge only with the user's OK and CI green. One commit per task unless stated (English, conventional prefix, one line <= 72 chars). GitHub issues only if the user asks.
- Tests first: write them, see them fail (red) for the right reason, then code. Prove guards by temporary mutation (back the file up first; never `git checkout` a file with uncommitted edits); use the FULL `npm test` for mutation proofs, with a timeout for loops; never run two mutation chains at once.
- Before each commit: `npm test`, `npm run typecheck` and `$env:CI='1'; npm test` (PowerShell) all green. Quote the path (it contains spaces). Use the Write/Edit tools for sources (CRLF, escapes).
- Not edited, ever, in this spec: `packages/sim/src`, `packages/shared/src`, `packages/sim/test/golden`, `maps/dev`, `apps/server/test/golden/dev-secrets.json`, the map format, `MatchState`, the 009 tour goldens. Check with `git diff --exit-code rewrite -- packages/shared/src packages/sim/src packages/sim/test/golden maps/dev apps/server/test/golden/dev-secrets.json` (clean at the end of every task). `apps/web` only as Q7 allows (M2 T8).
- No new dependency; no change to `package.json`, lockfile, `engines` or `.nvmrc` (workspace entries unchanged: no new workspace). `node:sqlite` only in `store/sqlite.ts`; timers only in `service/scheduler.ts`; no clock, random, I/O in `core/` or `packages/protocol/src`; no logging outside `main.ts` and the log sink; no production import of `store/faults.ts`.
- Secrecy/determinism: new reads and the lobby show nothing about a future round; tokens never appear in a read, an event, a log or an error; names are untrusted text (JSON strings only, bounded, never logged beyond length and a hash). Round seeds reach the core only through `seedOf`.
- Test titles start with the FR/NFR ids they verify. **Titles rule:** no task or test title names a pending id before the task that closes it (each task lists the ids it may name; the closing task removes them from `PENDING_011` and adds them to `DONE_011` in its own commit). Earlier tasks describe the part in words. Check before every commit (must find only ids already closed):
  `rg -n "(it|test|describe)\(['\"\`][^'\"\`]*\b(FR-3(69|7[0-9]|8[0-9]|9[0-2])|NFR-7[2-6])\b" apps/*/test packages/*/test tools/*/test`
- After each task: tick it, append to `specs/011-playable-matches/PROGRESS.md` (what changed, tests run and results, what is untested, next step), update `MEMORY.md` locally only for durable decisions/lessons, and stop.
- Every existing test or golden changed by a task is listed in `PROGRESS.md` with its reason (NFR-75); the list of plan section 12 is the expectation, a surprise is reported.
- Checkpoints: stop and report at 1.5x a task's size estimate, and if a branch passes ~2,500 changed lines (golden JSON apart) before its last two tasks.

## Milestone files
One file per milestone; read only the active one plus these rules.

| Milestone | File | Branch | Content | Ledger (done / pending) |
|---|---|---|---|---|
| M1 | `tasks-M1.md` | `feat/011-m1-forced-absorber` | ledger extension, forced absorber (protocol, core, settings, goldens re-pin) | 3 / 26 |
| M2 | `tasks-M2.md` | `feat/011-m2-lobby-and-public-creation` | schema v2, lobby stage, public creation with caps, start, expiry (service level) | 9 / 20 |
| M3 | `tasks-M3.md` | `feat/011-m3-players-and-identity` | names, join, player token, token submissions, players list (service level) | 15 / 14 |
| M4 | `tasks-M4.md` | `feat/011-m4-http-surface` | routes, player role in the pipeline, rate limits, proxy hops, CORS, stream | 21 / 8 |
| M5 | `tasks-M5.md` | `feat/011-m5-names-reads-and-proofs` | names in reads, who-guessed-right, goldens, real-server proofs, hand run, close | 29 / 0 |

Dependencies: M1 -> M2 -> M3 -> M4 -> M5 (each branch cut after the previous PR is merged). Blocking questions: Q1 (M2), Q2 (M1 T3, T5), Q3 (M3), Q4 (M2), Q5 (M3), Q6 (M2), Q7 (M2 T8), Q8 (M2, M4), Q9 (M2), Q10 (M2), Q11 (M4), Q12 (M5), Q13 (M2 T9).

Progress per task lives in `specs/011-playable-matches/PROGRESS.md`.
