---
description: SDD · Review the spec like a QA (only detect, do not solve)
argument-hint: NNN-name
disable-model-invocation: true
allowed-tools: Read, Glob, Grep
---
Review specs/$1/spec.md as a very professional QA would. Use the sdd skill.

List:
1. Remaining ambiguities (requirements that cannot be verified).
2. Contradictions between requirements.
3. Edge cases not covered.
4. Conflicts with docs/constitution.md.

Do not propose solutions yet: only detect. Format: numbered list. Do not modify any file.
