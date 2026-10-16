# Tasks 005 — Labels and transitions
Plan: `specs/005-labels-and-transitions/plan.md`. Prerequisites: spec `Status: approved`; plan and tasks approved by the user; plan section 14 decisions U1-U6 confirmed (all met 2026-10-16). Any later change goes to the spec first, then the plan, then these tasks.

Rules for every task:
- Delivery: branch `feat/005-labels-and-transitions` (from an up-to-date `rewrite`), one PR into `rewrite`, squash merge only with the user's OK and CI green. No GitHub issues. Never push to `main` or `rewrite`. One commit per task (T1 and T10 have two).
- Tests first: write them, see them fail (red) for the right reason, then code. Prove new scans and guards by temporary mutation (back the file up first; never `git checkout` a file with uncommitted edits); use the FULL `npm test` for mutation proofs.
- Before each commit: `npm test`, `npm run typecheck` and `$env:CI='1'; npm test` (PowerShell) all green. Quote the path (it contains spaces).
- No new dependency (NFR-36). No edit to the map package, `MatchState`, `packages/*/src`, goldens or `maps/dev`. Earlier tests edited only as plan section 10/11 lists. `src/core` stays pure; `src/render` gets no seed/round/sim; Spanish text only in `src/core/strings.ts`; other viewer sources ASCII-only.
- Read plan section 0 (004 guards) before writing code: no `kind: '<literal>'` in new sources, no identifier containing `round` in `src/render`, the word `transition` only where plan section 10 allows it.
- Test titles start with the FR/NFR ids they verify. Check with `rg -n "(it|test|describe)\(['\"\`][^'\"\`]*\bFR-NN\b" apps/*/test packages/*/test tools/*/test`.
- Visual tasks (T8, T9) are not done without screenshots of the debug scene from fixed `seed`/`round`/`x`/`y`/`zoom` (and `transition`) addresses, reviewed and accepted by the user (NFR-34).
- After each task: tick it, update `MEMORY.md` locally (state, decisions with why, mistakes), and stop.

- [x] **T1. Commit plan and tasks; traceability ranges with the pending set; FR-155 scan amendments; no-dependency check.** NFR-35, NFR-36
  - Files: `specs/005-labels-and-transitions/{spec,plan,tasks}.md`, `packages/sim/test/traceability.test.ts`, `apps/web/test/anti-spoiler.test.ts`, `apps/web/test/labels-render.test.ts` (NFR-36 part only).
  - Tests first: plan section 11 (ranges FR 1..194 / NFR 1..37, pinned `PENDING_005` of the 34 new ids, counts 231 / 229 / 195 expected while pending, `FR-195`/`NFR-38` not expected); plan section 10 exceptions 1-4, each with a planted source flagged outside its allowed file and accepted inside it; NFR-36: `apps/web/package.json` dependencies and the lockfile entries equal the 004 set.
  - Commits: `docs: add plan and tasks 005`; `test: trace spec 005 ids and amend the animation scan`.
  - Done when: full suite green; a renamed title of a 004 id is still reported missing (mutation); `rg` finds NFR-35 and NFR-36 in titles.

- [x] **T2. Piece index, regions, main region and main piece.** FR-167, FR-168, FR-171, FR-189
  - Files: `apps/web/src/core/regions.ts`, `apps/web/test/{regions.test.ts,helpers/label-grids.ts}`.
  - Tests first: plan section 13 `regions.test.ts` list (split pieces, multi-entry regions, same-colour factions apart, strait, tie by first unit, recompute after an owner change, dev map Espana + Baleares and Italia >= 2 regions).
  - Code: plan D3 and section 5 (regions only).
  - Commit: `feat(web): add piece index and label regions`.
  - Done when: tests green; dev map piece index built in Node (time logged); `rg` finds the listed ids.

- [x] **T3. Label layout: fit, largest height, tie rule, reuse of the round being left.** FR-169, FR-170, FR-171, FR-189, NFR-33
  - Files: `apps/web/src/core/{label-params.ts,label-layout.ts}`, `apps/web/test/label-layout.test.ts`.
  - Tests first: plan section 13 `label-layout.test.ts` list, including the brute-force comparison on 200 fixed-seed random grids, the image-edge case (D12), w < 0.5, dev map with injected aspects (boxes inside the main region with margin M; territory boxes equal at rounds 0..4), and `previous` reuse equal to full recomputation for every step and jump of seed 1. Mutations proved: off-by-one on the row limit, tie order swapped, non-monotone search start.
  - Code: plan D4, D5 and section 5; parameter proposals of section 9 in `label-params.ts`.
  - Commit: `feat(web): add the label layout`.
  - Done when: tests green; dev map faction and territory layout time logged; `rg` finds the listed ids.

- [x] **T4. Label drawing data: crossfade, minimum size, ink and halo, screen box, transition rules.** FR-172, FR-174, FR-175, FR-181, FR-189
  - Files: `apps/web/src/core/{contrast.ts,label-frame.ts}`, `apps/web/test/{contrast.test.ts,label-frame.test.ts}`.
  - Tests first: plan section 13 `contrast.test.ts` and `label-frame.test.ts` lists (opacities at L0/L1, sum 1, below P not drawable, ink has the higher contrast and black on ties, `screenBox` = box x scale, every FR-181 rule at f = 0, 0.3, 0.5, 1, endpoints equal the instant labels, backward = forward mirrored).
  - Code: plan section 6.
  - Commit: `feat(web): add label opacity, ink and transition rules`.
  - Done when: tests green; `rg` finds the listed ids.

- [x] **T5. Front distances and the transition reference drawing.** FR-179, FR-180, FR-189, NFR-33
  - Files: `apps/web/src/core/{front.ts,transition-shade.ts}`, `apps/web/test/{front.test.ts,transition-shade.test.ts}`.
  - Tests first: plan section 13 `front.test.ts` and `transition-shade.test.ts` lists (contact and seed sets, naive comparison for empty contact (D13), per-piece normalisation, 1-unit piece, f = 0 equals the earlier `renderReference` pixel for pixel, f = 1 equals the later, no line along the front, interpolated lines, D8 order, backward = forward reversed). Mutations proved: `<=` instead of `<` on the front, normalisation over all pieces, `absorbed` below `outer`.
  - Code: plan D6, D7, D8, D13 and section 7.
  - Commit: `feat(web): add the colour front and its reference drawing`.
  - Done when: tests green; dev map seed 1 round 1 front computed in Node (time logged); `rg` finds the listed ids.

- [x] **T6. Progress, playback state machine, step data and the `transition` address parameter.** FR-176, FR-177, FR-178, FR-182, FR-183, FR-184, FR-185, FR-186, FR-187, FR-191, FR-192, FR-193, FR-194, NFR-37
  - Files: `apps/web/src/core/{progress.ts,playback.ts,step.ts,address.ts,strings.ts}`, `apps/web/test/{progress.test.ts,playback.test.ts,step.test.ts,address-transition.test.ts}`. Also `core/scene.ts`: one type export, `SceneError` (so `step.ts` does not name the sim package, FR-159 scan).
  - Tests first: plan section 13 lists for those four files (every one-step control animates, everything else instant, reduced motion, typed equal does nothing (U4), the 4 -> 5 then previous example, motion change completes, displayed round set at once, recorded sim calls for forward/backward/frozen steps, every address edge case of the spec, message names `transition`, camera untouched, text kept while frozen). New `STRINGS.transitionInvalid` used and tested by the 004 strings test unchanged.
  - Code: plan D10, D11 and section 8.
  - Commit: `feat(web): add round-step playback and the transition parameter`.
  - Done when: tests green (the 004 address and strings tests unchanged and green); `rg` finds the listed ids.

- [ ] **T7. Rendering part: front branch of the shader, `setFront`, label layer.** FR-173, FR-175, FR-179, FR-180, FR-188
  - Files: `apps/web/src/render/{shader.ts,map-scene.ts,labels-layer.ts}`, `apps/web/index.html`, `apps/web/test/labels-render.test.ts`.
  - Tests first: plan section 13 `labels-render.test.ts` list (label canvas order and `pointer-events:none`; type-level signatures of `setFront` and `attachLabelLayer`; `setFront` uploads only the earlier owners and the front (R32F, Nearest, no mipmaps, no flip); `setFront(undefined)` turns the branch off; `uProgress` declared once; priority constants generated from `TRANSITION_PRIORITY`; the 004 map-scene tests still green unchanged).
  - Code: plan D1, D2, D6 and section 7 (GLSL port of `shadeTransition`, same names).
  - Commit: `feat(web): draw the colour front and the label layer`.
  - Done when: tests green; the FR-159 render scan passes on the new files; `rg` finds the listed ids.

- [ ] **T8. UI wiring and first visual check.** FR-176, FR-177, FR-178, FR-182, FR-183, FR-184, FR-185, FR-186, FR-190, NFR-33, NFR-37
  - Files: `apps/web/src/ui/{frame-loop.ts,text-metrics.ts,motion.ts,main.ts,panel.ts,url.ts}`, `apps/web/src/core/{panel-text.ts,strings.ts}`, `apps/web/test/labels-purity.test.ts`, panel-text test additions in a new `describe` (the 004 `perfLines` cases unchanged).
  - Tests first: plan section 13 `labels-purity.test.ts` (new core files scanned, throwing-clock run, `now` imported only by `ui/main.ts` and `ui/frame-loop.ts`, rAF only in `ui/frame-loop.ts`, no literal into `fillText`/`strokeText`); FR-190 `perfLines` line with and without the figure.
  - Code: piece index, territory boxes and aspects at load; `stepScenes` + `factionBoxes` + `frontField` + playback on each request; first frame drawn synchronously (D14); frames from `frame-loop.ts`; reduced-motion listener; frozen address on load.
  - Visual check: screenshots of `?seed=1&round=0`, `?seed=1&round=1`, `?seed=1&round=4` at fit; `?seed=1&round=1&transition=0.5` at fit and at zoom 8 on the former Alemania-Francia border (004 `formerBorder`); one territory-label view at zoom 32. Manual check: next/previous play forwards/backwards, previous during a forward step, reduced motion (DevTools emulation) is instant, pointer readout during a step names the displayed round's owner. Pixel diff of the zoom-8 frozen frame against `renderTransitionReference`. **User reviews and accepts.**
  - Commit: `feat(web): wire labels and round-step transitions`.
  - Done when: tests green; screenshots accepted; `rg` finds the listed ids.

- [ ] **T9. Label parameter tuning and the label review set.** NFR-34 (and the final values of FR-169, FR-172, FR-182 parameters)
  - Files: `apps/web/src/core/{label-params.ts,label-review-set.ts}`, `apps/web/test/{label-layout.test.ts,label-review-set.test.ts}` (pinned values), `specs/005-labels-and-transitions/plan.md` (sections 9 and 12: chosen values, date, found empty-contact seed and round).
  - Tests first: plan section 12 checks for every review-set address; the search over seeds 1..1000 for a transferred piece with an empty contact set (first hit recorded, or the scene dropped and the test asserts none exists); the chosen parameters pinned and inside the spec ranges.
  - Steps: 2-3 candidate parameter sets; screenshots of the whole `LABEL_REVIEW_SET` for each; **user chooses one and accepts every screenshot** (including `labelFont`, L0, L1, P, M, Hmax, Dt).
  - Commit: `feat(web): tune labels and add the label review set`.
  - Done when: tests green; choice recorded in the plan and `MEMORY.md`; screenshots accepted.

- [ ] **T10. Performance measurement, no-regression check, close the pending set, PR.** NFR-32, NFR-35, done criteria
  - Files: `apps/web/test/labels-perf.test.ts`, `packages/sim/test/traceability.test.ts` (pending set removed, 229 expected), `specs/005-labels-and-transitions/spec.md` (status -> `implemented`, last, after review), `MEMORY.md` (local).
  - Tests first: `labels-perf.test.ts` (plan section 13: changed factions only, timings logged); traceability with no pending set (every FR-167..FR-194 and NFR-32..NFR-37 in a title).
  - Steps: NFR-32 procedure of plan section 12 on the reference PC; figures in the PR; if any threshold fails, stop and propose a fix or a spec change. NFR-35 process check: `git diff --exit-code rewrite -- packages/*/src packages/sim/test/golden maps/dev` clean; `git diff --stat rewrite -- apps/web/test packages tools` shows only the edited tests of plan sections 10 and 11 plus new files. Push, PR, CI green, squash only with the user's OK.
  - Commits: `test(web): measure labels and transitions`; `docs: mark spec 005 implemented`.
  - Done when: CI green; NFR-32 figures within thresholds and recorded; all screenshots accepted; `MEMORY.md` updated (state, decisions, lessons; next: roadmap step 3).
