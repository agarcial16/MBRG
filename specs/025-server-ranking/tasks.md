# Tasks 025 — Per-Discord-server ranking
Plan: `plan.md`. Spec: `spec.md` (approved 2026-11-18). Status: draft (presented 2026-11-19). One file per milestone; each task is at most 20-30 minutes and ends with tests green, a PROGRESS.md entry and one commit.

## Milestones
| Milestone | File | Content | Tasks |
|---|---|---|---|
| M1 | `tasks-M1.md` | Ledger, protocol of the ranking read, store reads, pure core | 4 |
| M2 | `tasks-M2.md` | Service and route `POST /ranking`, secrecy and isolation twins, bounded work | 4 |
| M3 | `tasks-M3.md` | Bot: subcommand and orders, embed, paging, e2e and closing | 4 |

12 tasks in 3 milestones.

## Rules for every task
- Delivery: branch `feat/025-server-ranking` on top of the 024 branch; one PR into `main` at the end (rebase when 024 lands); squash merge only with the user's OK and CI green. One commit per task: English, one line, conventional prefix, at most 72 characters, ending with the `Co-Authored-By` line of the implementing model.
- Models (AGENTS.md): implementers medium tier; the reviewer is strong tier (server reads, secrecy); with Claude at its limit the implementer runs on `opencode-go/glm-5.3` and the strong-tier review happens before merge, once Claude is back.
- Tests first: see them fail for the right reason, then code. Prove guards by temporary mutation (back the file up first; affected test files per mutant; full suite once at the end of the task).
- Per task run only the affected tests; at the end of each milestone `npm test` and `npm run typecheck`; before the PR also `CI=1 npm test`. Use Write/Edit for sources. Quote the worktree path (it has spaces).
- Protected, byte-identical in every task (as 024 NFR-120): `git diff --exit-code <024 head> -- packages/shared/src packages/sim/src packages/sim/test/golden maps/dev apps/server/test/golden apps/web/src`. Any other pinned test changed is listed in `PROGRESS.md` with its reason.
- Ledger: T1.1 adds the ranges and `PENDING_025` with all 14 ids; each task removes the ids it traces in its own commit; T3.4 leaves it empty. A partial id is traced by part-named titles.
- Privacy: no guild id, community key or Discord id in a log line, error, commit message, PROGRESS entry or test title; tests plant values no other text contains.
- `PROGRESS.md` entry after each task: what changed, tests run and result, what is untested, next step (branch, state).
- A requirements change goes to the spec first, then plan, then tasks, then code.
