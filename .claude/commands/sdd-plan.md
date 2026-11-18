---
description: SDD · Generate the technical plan of an approved spec
argument-hint: NNN-name
disable-model-invocation: true
allowed-tools: Read, Glob, Grep, Write, Edit
---
Read docs/constitution.md, AGENTS.md and specs/$1/spec.md. Use the sdd skill.
Do NOT write code.

Generate specs/$1/plan.md with: files created or modified and the responsibility of each, pure logic functions (seed and round as parameters, never ambient state), algorithm in pseudocode, how it is rendered in the interface, justified technical decisions (with the discarded alternative) and test strategy with Vitest.

Everything must respect the constitution and cover all FRs. Mark which FR each part covers. If the spec is not approved or has open questions, stop and tell me.
