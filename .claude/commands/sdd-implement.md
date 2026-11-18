---
description: SDD · Implement ONE task, tests first (usage - /sdd-implement 002-name T3)
argument-hint: NNN-name Tn
disable-model-invocation: true
---
Implement ONLY task $2 of specs/$1/tasks.md, following specs/$1/plan.md, docs/constitution.md and the sdd skill.

1. Write the tests first and check that they fail.
2. Write the code until they pass.
3. Run `npm test` and `npm run typecheck`, and show me the result.
4. Mark $2 as done in tasks.md and state which FRs it covers.

Then STOP. Do not start the next task.
