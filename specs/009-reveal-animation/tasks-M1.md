### M1 — Pure tour core (`feat/009-m1-tour-core`; 0 / 47 -> 20 / 27)
**Status: approved by the user on 2026-10-25.** Plan sections 3, 4.1 to 4.5, 5. The rules of `tasks.md` apply. Estimate about 2,240 changed lines; checkpoint: stop and report above 1,100 at the end of T3 or 3,360 at any point.

Titles: FR-318, FR-321, FR-322 first named in T2; FR-323, FR-324, FR-325, FR-343, FR-346 in T3; FR-331, FR-332, FR-334, FR-335, FR-348 in T4; FR-327, FR-328, FR-329, FR-333, FR-347, FR-353, FR-354 in T5.

- [x] **T1. Branch, docs, bookkeeping targets.**
  - Depends on: plan, tasks and amendments approved; amendments recorded in `spec.md`; `rewrite` up to date (spec 008 `implemented` merged).
  - Files: `specs/009-reveal-animation/{plan,tasks,tasks-M1}.md` (DRAFT markers removed), `packages/sim/test/traceability.test.ts`.
  - Tests first: ranges `FR [[1, 355]]`, `NFR [[1, 64]]`; `FR-356` and `NFR-65` are not ids; a pinned literal `PENDING_009` of the 47 ids; "every expected id appears in a test name" checks expected minus `PENDING_009`; "no pending 009 id is already traced"; a planted-id detection test over a synthetic list (titles name no 009 id).
  - Commits: `docs: plan spec 009 milestone M1`; `test: track the spec 009 ids as pending`.
  - Mutation proof: drop one id from `PENDING_009` -> the "every id traced" test fails.
  - Done when: suite green; 0 / 47; the `rg` of the titles rule finds nothing.
  - Size: S (about 80).

- [x] **T2. Animation key, hash, stream and stops.** FR-318, FR-321, FR-322
  - Depends on: T1.
  - Files: `apps/web/src/core/{tour-params,tour-key,tour}.ts` (new; `tour.ts` stops only), `apps/web/test/{tour-key,tour-stops}.test.ts` (new).
  - Tests first: FNV-1a vectors (`''`, `'a'`, `'foobar'`, published values) and the key texts of plan 4.1 (live and debug, absorber suffix, a non-ASCII text refused); mulberry32 first outputs for two non-round σ pinned from an inline independent formula in the test; `pick` bounds (0 and m - 1 reachable, m = 1 gives 0); the stream differs from the sim's `roundRng` for the same 32-bit input; H = 12 for n >= 3, 6 for n = 2, s_H = result, no two consecutive equal, s_{H-1} != result, every set member before any repeat, result only at the end when |set| <= H - 1; over every round of the dev map for seeds 1 to 100 (participants from the sim in the test) and hand-made sets of 2, 3, 11, 12 and 70 factions; same σ and set give the same stops in any input order (PD2); the input type has no absorber, record, state or seed field (type-level key test).
  - Commit: `feat(web): draw the stops of a reveal tour`.
  - Mutation proofs: drop the "not s_{i+1}" exclusion; draw forwards instead of backwards; H = 12 for n = 2; pick with `Math.round`; skip the sort.
  - Done when: tests green; mutants caught; FR-318, FR-321, FR-322 leave `PENDING_009` (3 / 44).
  - Size: M (about 500).

- [x] **T3. Dwells, instants, dim ramp, scaling, still and absorber timing.** FR-323, FR-324, FR-325, FR-343, FR-346
  - Depends on: T2.
  - Files: `apps/web/src/core/tour.ts`, `apps/web/test/tour-timing.test.ts` (new).
  - Tests first: integer dwell formula equals the real formula for H = 6 and 12 (every i); τ_H = 3,549 / 1,687, D = 5,349 / 3,487; absorber τ_H = 1,311, D = 2,411 (`FR-346`); nominal victim D within 3,000..6,000; δ(t) at 0, 150, 299, 300, τ_H + Dhold - 1, τ_H + Dhold + 150, D - 1, D (hand values, 0.65 max); scaling by budgets 4,013 and 2,700 (non-round): each duration floored, D from scaled values, c >= 0.5 boundary exact (A4); still tour (`FR-343 (still tour)`): one stop, τ_H = 0, no camera leg, D = 1,800.
  - Commit: `feat(web): time the stops and the dim of a reveal tour`.
  - Mutation proofs: `(i - 1) / (H - 1)`; hold 1,500 for the absorber; fade-out without the `1 -`; scaled D summed before flooring.
  - Done when: tests green; 8 / 39.
  - Size: M (about 400).

- [x] **T4. Framing boxes, framing, easing and camera legs.** FR-331, FR-332, FR-334, FR-335, FR-348
  - Depends on: T3.
  - Files: `apps/web/src/core/{tour-camera,tour}.ts`, `apps/web/test/tour-camera.test.ts` (new).
  - Tests first: framing box from label-set pieces on the dev map (a two-piece faction uses its main region only; fallback to all land when no label entry, PD6); framing scale for a small, a medium and a huge box (fit-scale fallback), cap min(4 fit, L0), then clamped; ease: centre linear, scale geometric, smoothstep at s = 0, E/2, E; victim legs: overview from 0 over 800 (skipped when the start is the overview), victim framing from τ_H over 1,200, camera at τ_H - 1 is leg 1's value (no early move toward the victim); absorber leg to victim + candidates over 800; after D the camera stays (no return to overview, FR-334); resize: same t, start clamped to the new area, recomputed targets, no jump at the resize instant beyond the clamp (FR-335).
  - Commit: `feat(web): move the camera of a reveal tour`.
  - Mutation proofs: linear scale easing; leg 2 starting at 0; cap 4 fit without L0; start camera not clamped after a resize.
  - Done when: tests green; 13 / 34.
  - Size: L (about 600).

- [ ] **T5. Frame function, highlight, label factors, marker and edge indicator.** FR-327, FR-328, FR-329, FR-333, FR-347, FR-353, FR-354
  - Depends on: T4.
  - Files: `apps/web/src/core/tour-frame.ts` (new), `apps/web/test/tour-frame.test.ts` (new).
  - Tests first: highlight is the latest stop at any t (a frame after three stops shows the third; no crossfade); lit = [highlight] (victim), [victim, highlight] (absorber); factors 1 and 1 - δ/δmax, hidden at full dark; `tourLabelDraws` keeps the order and keys of `instantLabels` and equals it for other = 1; tiny below 24 px in both sides only; marker radius 16 + half diagonal; indicator only when the box is wholly outside, tip on the inset rectangle, direction to the box centre; taken -> no camera, stops and dim go on; at t >= D the frame is the final state; the frame type has no result, seed, round, count or record field (`FR-353` type-level); same inputs give the same frame with `Math.random`, `Date.now`, `performance.now` throwing (`FR-354`).
  - Commit: `feat(web): compute each frame of a reveal tour`.
  - Mutation proofs: highlight = first stop with τ >= t; tiny with "or"; indicator also when partly visible; territory labels kept at factor 1.
  - Done when: tests green; 20 / 27.
  - Size: L (about 600).

- [ ] **T6. Close M1.**
  - Depends on: T5.
  - Files: `packages/sim/test/traceability.test.ts` (closing state: the 20 ids done, the 27 others as a literal list in the body), `specs/009-reveal-animation/{PROGRESS,plan}.md`, `MEMORY.md` (local).
  - Tests first: the closing-state test pins 20 / 27.
  - Commit: `test: pin the spec 009 M1 closing state`.
  - Done when: suite, typecheck, `CI=1` green; `git diff --exit-code rewrite -- packages/shared packages/sim/src packages/protocol apps/server/src maps` clean; figures (changed lines per task, suite counts) in PROGRESS; PR opened for review.
  - Size: S (about 60).
