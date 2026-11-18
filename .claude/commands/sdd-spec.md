---
description: SDD · Interview and write the spec (usage - /sdd-spec NNN-name initial idea)
argument-hint: NNN-name initial idea
disable-model-invocation: true
allowed-tools: Read, Glob, Grep, Write, Edit, AskUserQuestion, EnterPlanMode, ExitPlanMode
---
Do NOT write code at any point. Read docs/constitution.md and MEMORY.md, and use the sdd skill.

Arguments: $ARGUMENTS
The first word is the spec folder name (specs/<name>/); the rest is the initial idea.

Work in plan mode: enter it first, and do not write any file until I approve.

Your job:
1. Ask me questions ONE at a time to remove ambiguity (edge cases, errors, what is out of scope for this version). Maximum 5 questions.
2. With my answers, draft specs/<name>/spec.md following the sdd skill template, with EARS requirements and "Status: draft". Present the full draft for my approval (ExitPlanMode).
3. Only after I approve, write the file.
4. Only WHAT and WHY: no stack, architecture or file names.
