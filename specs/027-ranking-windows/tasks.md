# Tasks 027 — Ranking by time window
Plan: `plan.md`. Spec: `spec.md` (approved 2026-11-20). Status: draft (presented 2026-11-20). One file per milestone; each task is at most 20-30 minutes and ends with tests green, a PROGRESS.md entry and one commit.

## Milestones
| Milestone | File | Content | Tasks |
|---|---|---|---|
| M1 | `tasks-M1.md` | Ledger, protocol of the period and the windowed cursor, store bound, pure floor | 3 |
| M2 | `tasks-M2.md` | Service and route, secrecy and isolation twins per period, bounded work, byte-identical all-time reply | 4 |
| M3 | `tasks-M3.md` | Bot: period option, titles and sentences, paging, failures, e2e and closing | 4 |

11 tasks in 3 milestones.

## Rules for every task
- Delivery: branch `feat/027-ranking-windows` from `main`; one PR into `main` at the end; squash merge only with the user's OK and CI green. One commit per task: English, one line, conventional prefix, at most 72 characters, ending with the `Co-Authored-By` line of the implementing model.
- Models (AGENTS.md): implementers medium tier; the reviewer is strong tier (server read, secrecy); with Claude at its limit the implementer runs on `opencode-go/glm-5.3` and the strong-tier review happens before merge, once Claude is back.
- Tests first: see them fail for the right reason, then code. Prove guards by temporary mutation (back the file up first; affected test files per mutant; full suite once at the end of the task).
- Per task run only the affected tests; at the end of each milestone `npm test` and `npm run typecheck`; before the PR also `CI=1 npm test`. Use Write/Edit for sources. Quote the worktree path (it has spaces).
- Protected, byte-identical in every task: `git diff --exit-code main -- packages/shared/src packages/sim/src packages/sim/test/golden maps/dev apps/server/test/golden apps/web/src packages/protocol/src/encode.ts packages/protocol/src/decode.ts`, and the 025 test files `apps/server/test/{core-ranking,store-ranking,service-ranking,http-ranking,ranking-secrecy,ranking-isolation,ranking-snapshot,ranking-bounds,history-source-scan}.test.ts` and `apps/bot/test/{core-ranking,core-ranking-paging,core-actions-ranking,bot-flow-ranking,bot-flow-ranking-paging}.test.ts` (NFR-129). Exactly two pinned tests change, by definition of the spec: the `RANKING_FIELDS` list in `packages/protocol/test/ranking.test.ts` (FR-575, T1.1) and the "one option" ranking subcommand test in `apps/bot/test/discord-translate.test.ts` (FR-580, T3.1); each is listed in `PROGRESS.md` with its reason. Any other pinned test changed stops the task.
- Naming: the identifier `window` never appears in code (the purity scans forbid it); the concept is `period` in code and on the wire (plan PD2).
- Ledger: T1.1 adds the ranges FR-575..FR-585 and NFR-127..NFR-131 and `PENDING_027` with all 16 ids (FR-574 stays free); an id is named in the header of the one task that closes it, which moves it to `DONE_027` in its own commit; earlier parts are traced by part-named test titles; T3.4 leaves `PENDING_027` empty.
- Clock: every server test of a period uses the injected fake clock; no test reads ambient time; instants are planted (a match at the floor, 1 ms before).
- Privacy: no guild id, community key, floor or Discord id in a log line, error, commit message, PROGRESS entry or test title; tests plant values no other text contains.
- `PROGRESS.md` entry after each task: what changed, tests run and result, what is untested, next step (branch, state).
- A requirements change goes to the spec first, then plan, then tasks, then code.
