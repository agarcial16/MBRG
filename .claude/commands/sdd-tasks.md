---
description: SDD · Split the plan into small, verifiable tasks
argument-hint: NNN-name
disable-model-invocation: true
allowed-tools: Read, Glob, Grep, Write, Edit
---
From specs/$1/spec.md and specs/$1/plan.md, generate specs/$1/tasks.md following the sdd skill format:
- Small tasks (max 20-30 min each), in dependency order.
- Each with the FRs it covers and a verifiable "Done when:" line.
- Checkboxes.
- Aim for no more than 10: if there are more, propose splitting the spec.
