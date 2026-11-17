# Tasks 022 — Display names for client players
Plan: `plan.md`. Spec: `spec.md` (approved 2026-11-17). Status: draft, awaiting the user's approval of plan and tasks (typed in this chat). One file per milestone; each task is at most 20-30 minutes and ends with tests green, a PROGRESS.md entry and one commit.

## Milestones
| Milestone | File | Content | Tasks |
|---|---|---|---|
| M1 | `tasks-M1.md` | Protocol: `name` in the submission body, digest pins, winners with client ids | 3 |
| M2 | `tasks-M2.md` | Pure decisions of the server core | 2 |
| M3 | `tasks-M3.md` | Storage: schema v4, upgrade from v1, v2 and v3, store methods, winners join, purge | 5 |
| M4 | `tasks-M4.md` | Service and HTTP: submit, reads, replacement, roster untouched | 4 |
| M5 | `tasks-M5.md` | Twin, secrecy, ledger, compatibility | 4 |
| M6 | `tasks-M6.md` | Bot: name cleaning, Who, every prediction | 3 |
| M7 | `tasks-M7.md` | Viewer check (tests; no source change expected) | 2 |

23 tasks in 7 milestones, at most 5 each (the per-milestone split is the split the SDD skill asks for above 10).

## Rules for every task
- Delivery: this branch (`claude/ecstatic-mahavira-bf3159`, cut from `feat/022-client-display-names`); one PR into `main` at the end of the spec (or per milestone if the branch would pass about 3,000 changed lines); squash merge only with the user's OK typed in this session and CI green. One commit per task: English, one line, conventional prefix, at most 72 characters, ending with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- Models: planner and reviewer of M3, M4 and M5 on Opus; implementers on Sonnet (AGENTS.md).
- Tests first: write them, see them fail for the right reason, then code. Prove guards by temporary mutation (back the file up first; never `git checkout` a file with uncommitted edits; run the affected test files per mutant, the full suite once at the end of the task).
- Per task run only the affected tests; at the end of each milestone run the full `npm test` and `npm run typecheck`; before the PR also `CI=1 npm test`. Use the Write/Edit tools for sources. Quote the worktree path (it has spaces).
- Protected, byte-identical in every task (NFR-114): `git diff --exit-code main -- packages/shared/src packages/sim/src packages/sim/test/golden maps/dev apps/server/test/golden/dev-secrets.json`. `apps/web/src` is also untouched unless M7 finds a gap (then stop and report; the spec decides). Any other golden or test changed is listed in `PROGRESS.md` with its reason.
- Do not touch the lobby message of the bot (`apps/bot/src/core/announce.ts`): spec 021 works there and on one line of `io/handler.ts`. Rebase on `main` before M6 and before T5.3.
- Secrecy: a display name is personal data (NFR-113): never in a log line, error, metric, commit message, PROGRESS entry or test title; tests plant a string no other text contains.
- `PROGRESS.md` entry after each task: what changed, tests run and result, what is untested, next step.
- Ids in test titles: the ledger in `traceability.test.ts` is extended in T5.3; until then tests use descriptive titles so the ledger stays green.
- A requirements change goes to the spec first, then plan, then tasks, then code.
