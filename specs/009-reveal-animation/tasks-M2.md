### M2 — Decisions, tour playback driver, goldens (`feat/009-m2-tour-decisions`; 20 / 27 -> 30 / 17)
**Status: approved by the user on 2026-10-25.** Plan sections 4.3, 4.7, 10, 11. Rules of `tasks.md` apply. Estimate about 1,740 changed lines (golden JSON apart); checkpoint: stop and report at 2,610 for the branch. Branch cut from `rewrite` after M1 is merged.

Titles: FR-316, FR-319, FR-320, FR-336, FR-338, FR-349 first named in T2; FR-342, FR-344 in T3; NFR-59, NFR-60 in T4.

- [x] **T1. Branch and bookkeeping.**
  - Files: `specs/009-reveal-animation/tasks-M2.md` (DRAFT marker removed), traceability comments.
  - Done when: suite green; 20 / 27. Size: S (about 30).

- [x] **T2. When a tour plays: freshness, participants, budget, manual timing, reduced motion.** FR-316, FR-319, FR-320, FR-336, FR-338, FR-349
  - Depends on: T1.
  - Files: `apps/web/src/core/tour-plan.ts` (new), `apps/web/test/tour-plan.test.ts` (new).
  - Tests first (plan 4.7): victim plays for an event with age 0 and 5,000, not 5,001; never for public data (also a halted match's kept victim fields); not when `displayed !== k - 1`; participants differing from the held owners, a victim outside them, or n < 2 -> skip `mismatch`; budget = c2 - estimate - 1,000; `scaleFor`: >= D nominal, ratio 0.5 exact plays compressed, below skips; timing `manual` or `c2 === null` nominal (`FR-338`); absorber: age from `appliedAt`, d >= 2 and absorber among candidates, budget appliedAt + (I - L1 - L2) x 1,000 - estimate - 1,000 - Dt (A11; the edge-case figures 2,206 + Dt and 3,411 + Dt reproduced), k = T nominal, no `schedule` needed; reduced motion: victim still tour (budget rule with D = 1,800, A5), absorber none; ages never negative (estimate below the instant).
  - Commit: `feat(web): decide when a reveal tour plays`.
  - Mutation proofs: `age < 5000`; budget without the 1,000 margin; absorber budget without Dt; public data treated as fresh; `>=` 0.5 turned into `>`.
  - Done when: tests green; 26 / 21. Size: M (about 550).

- [x] **T3. Tour playback driver.** FR-342, FR-344
  - Depends on: T2.
  - Files: `apps/web/src/core/tour-playback.ts` (new), `apps/web/test/tour-playback.test.ts` (new).
  - Tests first: t = 0 at the handling reading (A1); frames at any reading draw that t (dropped frames, a 10 s gap -> final state on the first frame with t >= D); a sequence (victim then absorber) starts the second at the first's end instant; an absorber tour's end hands over the 005 step with `startMs` = the end frame's reading; `complete` gives the final state and the step at once; `motionChanged` completes (`FR-344`); the result hook fires once, on the first frame with t >= τ_H; inputs untouched; no clock read (throwing clock).
  - Commit: `feat(web): play reveal tours frame by frame`.
  - Mutation proofs: t from the first frame instead of the handling reading; second tour started at its first frame; result hook every frame.
  - Done when: tests green; 28 / 19. Size: M (about 450).

- [x] **T4. Goldens and purity scan.** NFR-59, NFR-60
  - Depends on: T3.
  - Files: `apps/web/src/core/tour-digest.ts` (new), `apps/web/test/golden/{tours.json,generate-tours.ts,tours-model.ts}` (new; independent values; the hand-run generator and its model re-implement plan 4.1 to 4.3 without importing `src`), `apps/web/test/golden/{tour-frame-pins.json,generate-tour-frame-pins.ts}` and `apps/web/test/helpers/tour-pins.ts` (new; regression pins written by the code under test, A13), `apps/web/test/{tour-golden,tour-scans}.test.ts` (new; the digest tests live in `tour-golden.test.ts`).
  - Tests first: for the dev map, seed 1, debug keys and the match id `Ab3dE5fG7hI9jK1m`: every round's σ, stops, instants, D of both tours equal the golden; frame digests at t = 0, 400, 1,000, τ_H - 1, τ_H, τ_H + 800, D - 1, D at 1920 x 1080 equal the pinned regression values (stated in the file); the purity scan of every `core/tour-*.ts` (no DOM, three, clock, timers, `Math.random`, `@mbrg/sim`, protocol record types; no banned word; no `seed` identifier) with planted violations flagged and plain code accepted.
  - Commit: `test(web): pin the reveal tours in goldens`.
  - Mutation proofs: one constant of the generator changed in `src` (golden fails); a planted `Math.random` in a tour module (scan fails).
  - Done when: tests green; generator output equals the committed JSON byte for byte when re-run; 30 / 17. Size: L (about 650 + JSON).

- [x] **T5. Close M2.**
  - Files: traceability closing state 30 / 17, PROGRESS, plan figures, `MEMORY.md` (local).
  - Done when: suite, typecheck, `CI=1` green; scope diff clean; PR opened by the coordinator after the review. Size: S (about 60).
