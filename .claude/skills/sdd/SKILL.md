---
name: sdd
description: Use whenever you work with Spec-Driven Development in this project (docs/constitution.md or any file inside specs/) - writing, reviewing or changing specs, plans and tasks, or implementing and validating tasks of a spec.
---
# Spec-Driven Development (SDD)
Tiers (Full / Light / Small), models and orchestration: see AGENTS.md. This file holds the flow and the templates.
## Flow
Constitution → Spec → Clarification → Plan → Tasks → Implementation → Validation → Change.
- Never move to the next phase without the user's explicit approval.
- The spec rules: if something is not in the spec, it is not implemented. If a decision is missing, stop and ask.
- A requirements change is made first in the spec, then in the plan and tasks, and last in the code.
- Each spec lives in `specs/NNN-name/` (implemented ones move to `specs/archive/`): `spec.md`, `plan.md`, `tasks.md` and `PROGRESS.md` (per-task log).
- At the end of each task, append to `PROGRESS.md`. The last entry always states branch, state and next step, so another model can resume from it alone. Update `MEMORY.md` only for durable decisions and lessons.
- The feature PR sets `Status: implemented` and updates `MEMORY.md` and `docs/board.md`. GitHub issues only if a spec is split into several PRs.
## Light SDD
A one-page spec (goal, requirements with ids, out of scope, done criteria), approval, ONE implementer for the whole spec (tests first, one PROGRESS entry per logical step), ONE reviewer at the end. No plan or task files unless a split is needed (a branch past ~3,000 changed lines).
## Full SDD limits
- `plan.md` <= ~6 KB. At most 3 milestones; more means splitting the spec.
- A single `tasks.md` when there are <= 10 tasks. Above that, `tasks.md` keeps the rules and a milestone index and each milestone has `tasks-<milestone>.md` (agents read only the active one).
- One implementer call per milestone (its tasks in order), not per task. One reviewer call per milestone.
## Spec template (spec.md)
```
# Spec NNN — <Name>
Status: draft | approved | implemented
## Context and goal
## Users
## User stories
- US-1. As a <role>, I want <action> so that <benefit>.
## Definitions (only if terms could be read in more than one way)
## Functional requirements
## Non-functional requirements
## Edge cases
## Out of scope
## Done criteria
## Open questions
- [NEEDS CLARIFICATION] <question>
```
The spec describes WHAT and WHY. No stack, architecture or file names.
## Requirements in EARS
- FR-x: WHEN <event>, THE SYSTEM SHALL <response>.
- FR-x: IF <unwanted condition>, THEN THE SYSTEM SHALL <response>.
- FR-x: WHILE <state>, THE SYSTEM SHALL <response>.
- FR-x: THE SYSTEM SHALL <permanent behavior>.
Every FR must be verifiable: no "fast", "intense" or "nice" without a measurable criterion.
## Plan (plan.md)
Files and responsibilities · Pure functions (seed and round as parameters, never ambient state) · Algorithm in pseudocode · Interface · Justified decisions with their discarded alternative · Test strategy with Vitest. State which FR each part covers.
## Tasks
```
- [ ] **Tn. <Description>.** FR-x, FR-y
  - Done when: <verifiable check>.
```
At most 20-30 min per task, in dependency order.
## Implementation
Tests first (red), then the code, `npm test` green, tick the task, append to `PROGRESS.md`. Within a milestone, tasks run in order; stop at the end of the milestone.
