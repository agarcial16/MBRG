---
description: SDD · New requirement - spec first, then code (usage - /sdd-change NNN-name new requirement)
argument-hint: NNN-name new requirement
disable-model-invocation: true
allowed-tools: Read, Glob, Grep, Write, Edit
---
Arguments: $ARGUMENTS
The first word is the spec folder (specs/<name>/); the rest is the new requirement.
Do NOT touch code. Use the sdd skill.

1. Update specs/<name>/spec.md: new FR (or change to an existing one) in EARS, its edge cases and what stays out of scope.
2. State which parts of plan.md and tasks.md would need to change afterwards.
3. Show me the spec diff and wait for my approval.
