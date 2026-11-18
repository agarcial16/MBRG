# Tasks 024 — Per-Discord-server match history
Plan: `plan.md`. Spec: `spec.md` (approved 2026-11-18). Status: draft, awaiting approval. One file per milestone; each task is at most 20-30 minutes and ends with tests green, a PROGRESS.md entry and one commit.

## Milestones
| Milestone | File | Content | Tasks |
|---|---|---|---|
| M1 | `tasks-M1.md` | Ledger, `community` at creation, policy, schema v5, creation service and HTTP | 4 |
| M2 | `tasks-M2.md` | History read: protocol, pure core, store reads, service and route, twins | 5 |
| M3 | `tasks-M3.md` | Bot: key and create, embed, paging, command, e2e and closing | 5 |

14 tasks in 3 milestones.

## Rules for every task
- Delivery: branch `feat/024-server-history`; one PR into `main` at the end (split per milestone if the branch passes about 3,000 changed lines); squash merge only with the user's OK and CI green. One commit per task: English, one line, conventional prefix, at most 72 characters, ending with the `Co-Authored-By` line of the implementing model.
- Models (AGENTS.md): implementers medium tier; reviewer of M1 and M2 strong tier (persistence, secrecy), of M3 medium tier.
- Tests first: see them fail for the right reason, then code. Prove guards by temporary mutation (back the file up first; affected test files per mutant; full suite once at the end of the task).
- Per task run only the affected tests; at the end of each milestone `npm test` and `npm run typecheck`; before the PR also `CI=1 npm test`. Use Write/Edit for sources. Quote the worktree path (it has spaces).
- Protected, byte-identical in every task (NFR-120): `git diff --exit-code main -- packages/shared/src packages/sim/src packages/sim/test/golden maps/dev apps/server/test/golden apps/web/src`. Any other pinned test changed is listed in `PROGRESS.md` with its reason.
- Ledger: T1.1 adds the ranges and `PENDING_024` with all 25 ids; each task removes the ids it traces in its own commit; T3.5 leaves it empty. A partial id is traced by part-named titles.
- Privacy: no guild id, community key or Discord id in a log line, error, commit message, PROGRESS entry or test title; tests plant values no other text contains.
- `PROGRESS.md` entry after each task: what changed, tests run and result, what is untested, next step (branch, state).
- A requirements change goes to the spec first, then plan, then tasks, then code.
