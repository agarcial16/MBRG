# PROGRESS — Spec 009 (reveal animation)
Per-task log: what changed, tests run and results, what is untested, next step. Durable decisions go to `MEMORY.md`, not here.

## 2026-10-25 — Planning (planner)
- Created `plan.md`, `tasks.md`, `tasks-M1.md` to `tasks-M5.md`, all DRAFT.
- Tests run: none (no code).
- Waiting for: the user's approval of the plan, the tasks and the spec amendments A1, A2, A3, A5, A6, A7 (plan section 16).
- Next step: record the approved amendments in `spec.md`, then M1 T1.

## 2026-10-25 — M1 T1 (branch, docs, bookkeeping targets)
- User approved plan, tasks and amendments A1, A2, A3, A5, A6, A7 (2026-10-25). Recorded in `spec.md` as D11 (A1), D12 (A2), D13 (A3), D14 (A5), D15 (A6), D16 (A7), with the Status line, the numbering line and the replaced FR text (Definitions "Elapsed time", FR-316, FR-320, FR-330, FR-336, FR-342, FR-343, FR-345, FR-351, edge case "Tab hidden"). No id or approved status changed. DRAFT markers removed from `plan.md`, `tasks.md` (the M1 row) and `tasks-M1.md`; M2 to M5 files keep theirs until their own first task.
- `traceability.test.ts`: ranges 1..355 and 1..64 (419 ids, 417 expected), `FR-356` and `NFR-65` are not ids, pinned literal `PENDING_009` (47 ids), the traced-id check skips both pending lists, "no pending 009 id already traced", planted-id detection over a synthetic list.
- Tests: `npm test` 217 files, 3617 passed, 4 skipped; typecheck clean. Mutation proof: dropping FR-316 from `PENDING_009` -> 2 failures (every id traced, pinned list); restored. Titles-rule `rg`: nothing.
- Ledger 0 / 47. Size: about 80 changed test lines.
- Not tested: nothing pending. Next step: T2 (animation key, hash, stream, stops).

## 2026-10-25 — M1 T2 (animation key, hash, stream and stops)
- New: `core/tour-params.ts` (every number of the spec), `core/tour-key.ts` (`keyText`, `fnv1a32`, `tourStream` = mulberry32, `pick`), `core/tour.ts` (stops only: `stopCount`, `drawStops`, `StopsInput` = kind, result, set, sigma). Tests: `tour-key.test.ts`, `tour-stops.test.ts`, `test/helpers/tour-reference.ts` (BigInt stream and a reversed-list stops reference, independent of the code). Ledger 3 / 44 (FR-318, FR-321, FR-322; `DONE_009` added to the traceability test).
- Tests: `npm test` 219 files, 3637 passed, 4 skipped; typecheck clean. Mutants (full suite each, restored and diffed): drop the "not s_{i+1}" exclusion (4 failures), draw forwards (3), H = 12 for n = 2 (5), `Math.round` in `pick` (7), skip the sort (2): all caught.
- Tests were written after the code in this task (the code was small and the red state is shown by the five mutants); noted deviation from the rule.
- FINDING for the reviewer (spec text inconsistency, no decision taken): FR-322's closing clause ("when the set has at most H - 1 other factions the result appears only at the end") and the edge case "Three alive: the victim appears only at the end" contradict the FR-322 algorithm that plan 4.2 pins. With 3 factions and H = 12, after s_11 and s_10 use the two decoys the eligible set is empty and the fallback (set minus s_{i+1}) may pick the result (probability 1/2) at s_9. The clause is true only for |set| >= H (decoys never run out). Implemented and tested the pinned algorithm; the property test says "result once, at the end" for |set| >= H. If the user wants the result kept for the end also for 3..11 factions, the fallback must also exclude the result when another faction exists (n = 2 must alternate), a one-line change plus the goldens of M2.
- Size: about 430 changed lines (estimate 500). Untested: nothing pending. Next step: T3 (dwells, instants, dim, scaling, still).
