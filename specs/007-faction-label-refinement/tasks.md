# Tasks 007 — Label refinement (faction and territory labels)
Plan: `specs/007-faction-label-refinement/plan.md`. Prerequisites: spec approved by the user (2026-10-21, with P14 to P21); plan and tasks approved by the user; plan section 14 decisions U1-U5 confirmed. Any later change goes to the spec first, then the plan, then these tasks.

Amendment of 2026-10-21 (spec D19, plan section 16): after the T8 screenshots the user chose arc gain 1 for the 007 rule and a 75 deg tangent limit for territory arcs (faction arcs stay at 45 deg; straight frames stay within 45 deg). Follow-up task T8b, between T8 and T9.

Rules for every task:
- Delivery: branch `feat/007-faction-label-refinement` cut from an up-to-date `rewrite`; one PR into `rewrite`, squash merge only with the user's OK and CI green. No GitHub issues. Never push to `main` or `rewrite`. One commit per task unless stated (English, conventional prefix, one line <= 72 chars).
- Tests first: write them, see them fail (red) for the right reason, then code. Prove guards and prunes by temporary mutation (back the file up first; never `git checkout` a file with uncommitted edits); use the FULL `npm test` for mutation proofs, with a timeout for loops.
- Before each commit: `npm test`, `npm run typecheck` and `$env:CI='1'; npm test` (PowerShell) all green. Quote the path (it contains spaces).
- No new dependency. No edit to the map package, `MatchState`, `packages/*/src`, goldens or `maps/dev`. Earlier tests edited only as plan section 10 lists. `src/core` stays pure; `src/render` gets no seed/round/sim; no new UI string; every source ASCII-only, comments included.
- Read plan section 0 (guards) before writing code: no word `transition` in new sources (say "step"), no `kind:` literal, optional fields omitted (never `undefined`), new parameters only in `core/centre-params.ts`, `LABEL_PARAMS` and `SHAPE_PARAMS` untouched.
- Test titles start with the FR/NFR ids they verify. Check with `rg -n "(it|test|describe)\(['\"\`][^'\"\`]*\bFR-NNN\b" apps/*/test packages/*/test tools/*/test`.
- Visual tasks (T6, T8) are not done without screenshots of the debug scene from fixed `seed`/`round`/`x`/`y`/`zoom` (and `transition`) addresses, reviewed by the user (NFR-45).
- After each task: tick it, update `MEMORY.md` locally (state, decisions with why, mistakes to avoid; <= ~50 lines), and stop.

- [x] **T1. Branch, commit spec / plan / tasks; traceability with the pending set; centre parameters.** NFR-44, FR-219, FR-221, FR-230
  - Files: `specs/007-faction-label-refinement/{spec,plan,tasks}.md` (as approved), `packages/sim/test/traceability.test.ts`, `apps/web/src/core/centre-params.ts`, `apps/web/test/label-centre.test.ts` (parameters part).
  - Tests first: plan section 10 item 1 (ranges 1..230 / 1..46, pinned `PENDING_007` of 18 ids, counts 276 / 274 / 256 expected, `FR-231` / `NFR-47` not ids, self-trace list with NFR-44); `CENTRE_PARAMS` pinned (7 / 50, 45, [15, -15, 30, -30, 45, -45], 1 / 10); `LABEL_PARAMS` and `SHAPE_PARAMS` still equal their 005 / 006 pins.
  - Commits: `docs: add spec, plan and tasks 007`; `test: trace spec 007 ids and pin the centre parameters`.
  - Done when: full suite, typecheck and `CI=1` green; a renamed title of a 006 id is still reported missing (mutation); `rg` finds NFR-44, FR-219, FR-221, FR-230 in titles.

- [x] **T2. Exact centre arithmetic, purity scan, "before" figures.** FR-218, FR-222, FR-228, FR-230, NFR-46
  - Files: `apps/web/src/core/label-centre.ts`, `apps/web/test/{label-centre.test.ts,centred-purity.test.ts,centred-figures.test.ts,helpers/centred-figures.ts,helpers/centred-grids.ts}`, `specs/007-faction-label-refinement/plan.md` (section 15 before columns).
  - Tests first: plan section 13 `label-centre.test.ts` list (sums above 2^53, `isqrt`, `dyadic`, row intervals equal the spec inequality for unit centres and boxes, `endStep`, exact keys, `factionHeightCap`, n <= 51); `centred-purity.test.ts` number scan with planted violations; `centred-figures.test.ts` "before" columns (006 frames from the retained 006 functions, n, C, rho, offsets, side gaps) with the recorded aspects.
  - Code: plan sections 5 and 9 (BigInt only in decisions).
  - Commit: `feat(web): add exact centre of mass and centre disc tests`.
  - Done when: tests green; before figures recorded in plan section 15 (Galicia and Castilla-La Mancha side gaps included); mutations proved (`<=` -> `<` in the disc test, interval end off by one, kEnd one less); `rg` finds the listed ids.

- [x] **T3. Centred candidate: horizontal and straight, uncapped, FR-220 order, exact prunes.** FR-219, FR-220, FR-228, NFR-43
  - Files: `apps/web/src/core/label-centred.ts` (centred part), `apps/web/test/{label-centred.test.ts,helpers/centred-reference.ts,centred-perf.test.ts}`.
  - Tests first: plan section 13 `label-centred.test.ts` list (reference equality on 200 random and the hand grids, heights above 120, aspect below 1, tie steps 2 to 7, prune equals no prune).
  - Code: plan PD3, PD4, PD5 and section 6 (`centredCandidate`, `boxFits`, relaxed bound R(h)).
  - Commit: `feat(web): add the centred label candidate`.
  - Done when: tests green; Node time logged for territories and for Francia at round 4; **U4 checkpoint**: Francia at round 4 has a straight centred candidate at step 1 (else stop for a spec change); mutations proved (eps = 0, R(h) slack removed, tie steps swapped, angle order swapped); `rg` finds the listed ids.

- [x] **T4. Arc candidate, FR-221 choice, widening and the faction cap.** FR-221, FR-222, FR-230, NFR-43
  - Files: `apps/web/src/core/{label-shape.ts (arcSearch extraction, arcWithinLimit),label-centred.ts}`, `apps/web/test/{label-centred-arc.test.ts,helpers/centred-reference.ts}`.
  - Tests first: a digest of `shapedCandidate` results on 200 random grids taken on the current code **before** the extraction; plan section 13 `label-centred-arc.test.ts` list (disc, tangent limit 45 both roles, uncapped top, P14 winner, G at ceil(1.25 hC) - 1 / ceil(1.25 hC), widening stop and kEnd, tiny arc does not stop it, faction cap on every shape).
  - Code: plan PD6, PD7, PD8 and section 6 (`arcCandidate`, `centredInLand`).
  - Commit: `feat(web): add centred arcs, widening and the faction size cap`.
  - Done when: tests green; the `shapedCandidate` random-grid digest and the 006 D11 digest unchanged; mutations proved (tangent limit 90, widening stopping on any frame, cap off by one, G bound off by one); `rg` finds the listed ids.

- [x] **T5. Role placements, origin-free checks, 007 digest and changed-label list.** FR-217, FR-223, FR-224, FR-225, FR-229, NFR-44
  - Files: `apps/web/src/core/{label-centred-place.ts,label-digest.ts}`, `apps/web/test/{label-centred-place.test.ts,helpers/centred-digest-run.ts,centred-perf.test.ts}`, `specs/007-faction-label-refinement/plan.md` (section 15 changed-label list and digest).
  - Tests first: plan section 13 `label-centred-place.test.ts` list (owner independence, origin-free equality, no same-role conflict, reuse equals a fresh computation for every step and jump of seed 1, `boxes` hold only 007 horizontal boxes, counts, 007 digest pinned, 005 and 006 digests unchanged).
  - Code: plan PD2, PD9 and section 7.
  - Commit: `feat(web): place centred labels per role`.
  - Done when: tests green; Node times logged (territories at load, factions per step and from scratch); changed-label list and 007 digest recorded; mutations proved (reuse of a changed region, territory placement reading owners, 005 box leaking into `boxes`); `rg` finds the listed ids.

- [x] **T6. Step and drawing checks; review set; "before" screenshots.** FR-226, FR-227, NFR-45
  - Files: `apps/web/src/core/centred-review-set.ts`, `apps/web/test/{centred-steps.test.ts,centred-review-set.test.ts}`, `specs/007-faction-label-refinement/plan.md` (section 15 hits).
  - Tests first: plan section 13 `centred-steps.test.ts` (006 step rules on 007 layouts at f = 0, 0.25, 0.5, 0.75, 1; Italia 2 -> 3 crossfade; stretch only along the reading direction) and `centred-review-set.test.ts` (hits in order, addresses, steep-territory list).
  - Steps: find and pin the hits (step scene: seed 1 first, else seeds 2..1000; no-hit proof with `MBRG_SLOW=1`, U3); take the **before** screenshots of every plan section 12 scene with the viewer still on the 006 placement.
  - Commit: `feat(web): add the centred label review set`.
  - Done when: tests green; hits recorded; before screenshots stored (scratchpad) with their addresses; `rg` finds the listed ids.

- [x] **T7. UI wiring and first visual check.** FR-217, FR-223, FR-229, NFR-43 (wiring)
  - Files: `apps/web/src/ui/main.ts`.
  - Tests first: none new (wiring only); the 004 to 006 scans (anti-spoiler, strings, purity) stay green.
  - Code: `placeCentredTerritories` once at load; `placeCentredFactions` per state with the round being left as `previous`; FR-190 figure around the 007 placement and the front.
  - Visual check: `?seed=1&round=0` and `?seed=1&round=4` at fit with the debug panel counts; manual next / previous steps.
  - Commit: `feat(web): wire centred labels`.
  - Done when: tests green; the counts shown match `labelCounts` for the shown state; first screenshots shown to the user.

- [ ] **T8. "After" screenshots and figures; user acceptance.** NFR-45, NFR-46 (PENDING user review of the screenshots: after shots, pairs and figures done; not ticked until the user accepts every pair)
  - Files: `apps/web/test/centred-figures.test.ts` (after columns), `specs/007-faction-label-refinement/plan.md` (section 15 after columns).
  - Steps: after screenshots of every plan section 12 scene at the same addresses; before / after pairs side by side (`francia-r4` beside reference B, U2; Italia rounds 0-3; Galicia; Castilla-La Mancha; the step frames); figures recorded and checked (every offset <= k rho; Francia round 4 straight within rho of C). **User reviews and accepts every pair, Galicia and Castilla-La Mancha explicitly.** A rejection is a spec change (spec first), not a code tweak.
  - Commit: `test(web): record centred label figures`.
  - Done when: tests green; figures recorded; screenshots accepted by the user. Superseded for acceptance by T8b (spec D19, 2026-10-21): the user rejected the loss of curvature; the T8 after shots are retaken in T8b.

- [ ] **T8b. Arc gain and territory tangent limit (spec D19, plan section 16).** FR-221, FR-222, NFR-44, NFR-45, NFR-46 (user acceptance PENDING again)
  - Files: `apps/web/src/core/{centre-params.ts,label-centred.ts,centred-review-set.ts}`, `apps/web/test/{label-centre.test.ts (parameters pin),label-centred-arc.test.ts,label-centred-place.test.ts (007 digest),centred-steps.test.ts,centred-review-set.test.ts,centred-figures.test.ts,helpers/centred-reference.ts}`, `specs/007-faction-label-refinement/plan.md` (section 15 re-pinned figures, changed-label list, hits; date).
  - Tests first: `CENTRE_PARAMS` pin extended (`arcGain` 1/1, `arcTangentLimit` faction 45 / territory 75); an arc of equal height wins (both roles) and a lower one loses; FR-221 order arc > horizontal > straight at equal height; a territory arc with tangents between 45 and 75 deg exists, the same faction arc does not; no straight frame steeper than 45 deg in either role; the reference reads Ga and the role limits; red on the current code.
  - Code: plan section 16 (exact ceil(Ga x hC), per-role tangent limit). `SHAPE_PARAMS` and every 006 function untouched.
  - Re-pin: 007 digest, figures digest and after columns (arc counts per role, 006 arcs back, largest territory tangent), changed-label list, review hits (Italia 2 -> 3 now a crossfade, new arc step scene, arc close-ups, `espana-r2`). Unchanged and asserted: 005 box digest, 006 D11 digest, `shapedCandidate` random-grid digest. Compare with the probe (41 territory arcs, 7 of 9 006 arcs back, tangents up to about 73 deg, faction arcs Espana r2 and Italia r3, no arc for Portugal); a difference is investigated before re-pinning. Stop if Francia at round 4 is no longer straight within rho.
  - Screenshots: every plan section 12 scene retaken with the D19 build, plus the new arc scenes (their before shots from the 006 placement); before / after pairs rebuilt. **User reviews and accepts every pair.**
  - Commit: `feat(web): arc gain 1 and 75 deg territory arcs (spec 007 D19)`.
  - Done when: tests green, also with `CI=1`; Node times logged (territories at load, factions per step incl. 3 -> 4); mutations proved (gain back to 1.25, territory limit 45, faction limit 75, equal-height tie to the centred candidate); screenshots accepted by the user (PENDING); `rg` finds the listed ids.

- [ ] **T9. Performance, browser determinism, close the pending set, PR.** NFR-43, NFR-44, done criteria
  - Files: `packages/sim/test/traceability.test.ts` (pending set removed, 274 expected, plan section 10 item 1), `specs/007-faction-label-refinement/spec.md` (status -> `implemented`, last, after review), `MEMORY.md` (local).
  - Tests first: traceability with no pending set (every FR-217..FR-230 and NFR-43..NFR-46 in a title).
  - Steps: NFR-43 procedure of plan section 12 on the reference PC (steps <= 100 ms, jumps and fresh load <= 150 ms, round change <= 150 ms, frames median 16.7 / p95 33.3, first frame <= 2 s); the final 007 digest (the one re-pinned in T8b) in Chrome (Edge, Firefox when available) equal to the Node pin; figures in the PR; if a threshold fails, stop and propose an exact fix or a spec change. Process check: `git diff --exit-code rewrite -- packages/*/src packages/sim/test/golden maps/dev` clean; `git diff --stat rewrite -- apps/web/test packages tools` shows only the traceability edit plus new files. Push, PR, CI green, squash only with the user's OK.
  - Commits: `test: trace every spec 007 id`; `docs: mark spec 007 implemented`.
  - Done when: CI green; NFR-43 figures within thresholds and recorded; digest equal in the browser; all screenshots accepted; `MEMORY.md` updated (state, decisions, lessons; next: roadmap step 3).
