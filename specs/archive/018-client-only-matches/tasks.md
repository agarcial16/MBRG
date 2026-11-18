# Tasks 018 — Client-only matches
Plan: `plan.md`. Spec: `spec.md` (approved 2026-11-15). Status: draft, reviewed once by the reviewer agent (3 blockers fixed), awaiting the user's approval of plan and tasks. One file per milestone; each task is at most 20-30 minutes and ends with tests green, a PROGRESS.md entry and one commit.

## Milestones
| Milestone | File | Content | Tasks |
|---|---|---|---|
| M1 | `tasks-M1.md` | Protocol codecs, error kind and status, pure policy decisions | 4 |
| M2 | `tasks-M2.md` | Storage: schema v3, upgrade from v1 and v2, store methods, list flag | 5 |
| M3 | `tasks-M3.md` | Service and HTTP: create, join, submit, views, reads | 8 |
| M4 | `tasks-M4.md` | Twin, secrecy scan, ledger, compatibility, docs | 4 |
| M5 | `tasks-M5.md` | Bot opt-in (create call only) | 2 |

23 tasks in 5 milestones, at most 8 each (the per-milestone split is the split the SDD skill asks for above 10).

## Rules for every task
- Delivery: this branch (`claude/sharp-goldstine-b56ba8`, cut from `feat/018-client-only-matches`); one PR into `main` (never `rewrite`, it is retired) at the end of the spec, or per milestone if the branch would pass about 3,000 changed lines; squash merge only with the user's OK and CI green. One commit per task: English, one line, conventional prefix, at most 72 characters, ending with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- Tests first: write them, see them fail for the right reason, then code. Prove guards by temporary mutation (back the file up first; never `git checkout` a file with uncommitted edits).
- Before each commit: `npm test`, `npm run typecheck` and `CI=1 npm test` green. Use the Write/Edit tools for sources. Quote the worktree path (it has spaces).
- Protected, byte-identical in every task (NFR-102): `git diff --exit-code main -- packages/shared/src packages/sim/src packages/sim/test/golden maps/dev apps/server/test/golden/dev-secrets.json apps/web`. Any other golden or test changed is listed in `PROGRESS.md` with its reason.
- `PROGRESS.md` entry after each task: what changed, tests run and result, what is untested, next step.
- Ids in test titles: the ledger in `traceability.test.ts` is extended in T4.3; until then tests use descriptive titles (as 011 did) so the ledger stays green.
- A requirements change goes to the spec first, then plan, then tasks, then code.
