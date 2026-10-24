# Tasks 008 — Server and predictions
Plan: `specs/008-server-and-predictions/plan.md`. Prerequisites: spec approved by the user (2026-10-21, D25); plan section 1 decisions U1 to U5 answered by the user (2026-10-21/22: workspaces `apps/server` and `packages/protocol`; `tsx` 4.23.15 and `@types/node` 24.19.2 reused as pinned dev dependencies of `apps/server`; no type stripping and no import-line changes in sim or shared; `engines >=24` and `.nvmrc 24` kept, any raise back to the user; exports `playRoundWithSeed`, `absorptionCandidatesOf`, `livingFactions`); **plan and tasks approved by the user (M1 and M2a)**. Any later change goes to the spec first, then the plan, then these tasks.

This file details **M1** (merged, PR #28, 061119b), **M2a** (merged, PR #29, ac1263a) and **M2b / M2b'** (approved by the user: M2b on 2026-10-22, M2b' on 2026-10-22; plan section 17; M2b merged, PR #30, b9effa5; M2b' merged, PR #31, 93727f4) and **M3a / M3a'** (approved by the user on 2026-10-22 with C1 to C8, plan section 18; split into M3a and M3a' on 2026-10-23 under C8). M3b / M3b' are detailed in `tasks-M3b.md` (plan section 19, approved by the user on 2026-10-23: E1 to E10 and D28); M4 and M5 are listed as headings at the end and are detailed (at most 10 tasks each) in a later revision, approved before their first task. The M1 rules below apply to every milestone, with the M2a additions in the M2a section.

Rules for every task:
- Delivery: branch `feat/008-m1-secret-and-sim-exports` cut from an up-to-date `rewrite` (14127e6 or later); one PR into `rewrite`, squash merge only with the user's OK and CI green. GitHub issues only if the user asks for one per milestone. Never push to `main` or `rewrite`. One commit per task unless stated (English, conventional prefix, one line <= 72 chars).
- Tests first: write them, see them fail (red) for the right reason, then code. Prove guards by temporary mutation (back the file up first; never `git checkout` a file with uncommitted edits); use the FULL `npm test` for mutation proofs, with a timeout for loops.
- Before each commit: `npm test`, `npm run typecheck` and `$env:CI='1'; npm test` (PowerShell) all green. Quote the path (it contains spaces).
- No new dependency beyond U2 (`tsx` 4.23.15 and `@types/node` 24.19.2 in `apps/server`, pinned exactly). No import-line changes in sim or shared (U5). No change to `engines` or `.nvmrc` (U3). No edit to the map package, `MatchState`, `RoundRecord`, `packages/shared/src`, `packages/sim/test/golden`, `maps/dev`. In `packages/sim/src` only the files of plan section 3. Earlier tests edited only as plan section 0 lists (the three export-list assertions and the traceability test).
- No keyed function, digest, clock or randomness in sim or shared (purity scan); the HMAC lives in `apps/server`.
- Test titles start with the FR/NFR ids they verify; a task that traces an id removes it from `PENDING_008` in the same commit. Check with `rg -n "(it|test|describe)\(['\"\`][^'\"\`]*\bFR-NNN\b" apps/*/test packages/*/test tools/*/test`.
- After each task: tick it, update `MEMORY.md` locally (state, decisions with why, mistakes to avoid; <= ~50 lines), and stop.


## Milestone files
One file per milestone; read only the active one plus the rules above. Do not read the merged ones unless a task points at them.

| Milestone | File | Status |
|---|---|---|
| M1 | `tasks-M1.md` | merged (PR #28) |
| M2a | `tasks-M2a.md` | merged (PR #29) |
| M2b, M2b' | `tasks-M2b.md` | merged (PR #30, #31) |
| M3a | `tasks-M3a.md` | merged (PR #32) |
| M3a' | `tasks-M3a2.md` | merged (PR #33) |
| M3b, M3b' | `tasks-M3b.md` | merged (PR #34, #35) |
| M4, M4' | `tasks-M4.md` | approved by the user (2026-10-23; plan section 20, G1 to G10, spec clarification D29); M4 merged (PR #36); M4' done (T1' to T6'), PR pending |

Progress per task lives in `specs/008-server-and-predictions/PROGRESS.md`.
## Later milestones (headings only; detailed later, at most 10 tasks each)
- **M3b / M3b'. Server-Sent Events, replay, heartbeat, stream limits, performance procedure.** Detailed in `tasks-M3b.md` (approved, plan section 19): M3b (T1 to T6) moves no id; M3b' (T1' to T5') closes FR-287 (letter (d) in M4) and NFR-49. Depends on M3a'.
- **M4 / M4'. Scoring, results and leaderboard.** Detailed in `tasks-M4.md` (plan section 20, approved by the user on 2026-10-23): M4 (T1 to T5) closes FR-274, FR-271, FR-272, FR-273 (82 / 14) and adds the `results` event with the re-pinned sequences; M4' (T1' to T6') closes FR-275 to FR-278 (86 / 10) with the reads, routes, goldens and durability. Depends on M3b'.
- **M5. Live viewer and web test client.** FR-303 to FR-311; NFR-56; screenshots reviewed by the user. Depends on M3b', M4. Closes the pending set; spec 008 becomes `implemented` after acceptance.
