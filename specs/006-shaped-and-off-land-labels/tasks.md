# Tasks 006 — Shaped and off-land labels
Plan: `specs/006-shaped-and-off-land-labels/plan.md`. Prerequisites: spec approved by the user (2026-10-19); plan and tasks approved by the user; plan section 14 decisions U1-U4 confirmed. Any later change goes to the spec first, then the plan, then these tasks.

Amendment of 2026-10-19 (spec D9, plan section 16): `shapeGain` G is 1.25 instead of 1.5. T1 to T8 were implemented with 1.5; the code and test follow-up of plan section 16 was done as step 1 of T9 (commit `fix(web): lower the shape gain to 1.25`), before the T9 screenshots.

Rules for every task:
- Delivery: branch `feat/006-label-orientation` (from an up-to-date `rewrite`), one PR into `rewrite`, squash merge only with the user's OK and CI green. No GitHub issues. Never push to `main` or `rewrite`. One commit per task unless stated (English, conventional prefix, one line <= 72 chars).
- Tests first: write them, see them fail (red) for the right reason, then code. Prove scans and guards by temporary mutation (back the file up first; never `git checkout` a file with uncommitted edits); use the FULL `npm test` for mutation proofs, with a timeout for loops.
- Before each commit: `npm test`, `npm run typecheck` and `$env:CI='1'; npm test` (PowerShell) all green. Quote the path (it contains spaces).
- No new dependency (NFR-42). No edit to the map package, `MatchState`, `packages/*/src`, goldens or `maps/dev`. Earlier tests edited only as plan section 10 lists. `src/core` stays pure; `src/render` gets no seed/round/sim; Spanish only in `src/core/strings.ts`; every other source ASCII-only, comments included.
- Read plan section 0 (guards) before writing code: no word `transition` in new sources (say "step"), no identifier containing `round` in `src/render`, no `kind:` literal, no new string placeholder name, optional fields omitted (never `undefined`), new parameters only in `core/shape-params.ts`.
- Test titles start with the FR/NFR ids they verify. Check with `rg -n "(it|test|describe)\(['\"\`][^'\"\`]*\bFR-NNN\b" apps/*/test packages/*/test tools/*/test`.
- Visual tasks (T8, T9) are not done without screenshots of the debug scene from fixed `seed`/`round`/`x`/`y`/`zoom` (and `transition`) addresses, reviewed and accepted by the user (NFR-40).
- After each task: tick it, update `MEMORY.md` locally (state, decisions with why, mistakes to avoid; <= ~50 lines), and stop.

- [x] **T1. Commit spec, plan and tasks; traceability with the pending set; shape parameters; no-dependency check.** NFR-41, NFR-42, FR-196, FR-203, FR-207
  - Files: `specs/006-shaped-and-off-land-labels/{spec,plan,tasks}.md` (spec status line -> `approved`, on the user's instruction), `packages/sim/test/traceability.test.ts`, `apps/web/src/core/shape-params.ts`, `apps/web/test/shaped-deps.test.ts`.
  - Tests first: plan section 10 item 1 (ranges 1..216 / 1..42, pinned `PENDING_006` of 27 ids, counts 258 / 256 / 229 expected, `FR-217` / `NFR-43` not ids, self-trace list with NFR-41); `SHAPE_PARAMS` pinned (15, 1.5 [1.25 since spec D9, plan section 16], [30, 60], territory 5 / faction 18 inside 3..12 / 10..40, 24, 6, M < Gl <= Dr); `cs(theta)` pinned to the spec table expressions for -75..90; NFR-42 manifest and lockfile equal the 005 set.
  - Commits: `docs: add plan and tasks 006`; `test: trace spec 006 ids and pin the shape parameters`.
  - Done when: full suite, typecheck and `CI=1` green; a renamed title of a 005 id is still reported missing (mutation); `LABEL_PARAMS` and the 005 review-set test untouched; `rg` finds NFR-41, NFR-42 in titles.

- [x] **T2. Number reference: exact axis angle, extent, shapes, frame membership; the NFR-39 scan.** FR-196, FR-199, NFR-39, NFR-41
  - Files: `apps/web/src/core/{label-axis.ts,label-shape.ts (membership part),label-digest.ts,label-layout.ts}`, `apps/web/test/{label-axis.test.ts,label-shape.test.ts,shaped-purity.test.ts,helpers/label-reference.ts,helpers/shaped-grids.ts}`.
  - Tests first: plan section 13 `label-axis.test.ts` list and the membership part of `label-shape.test.ts` (`inStraight`, `arcExists`, `inArc`, `cosK`, edge points inside); `shaped-purity.test.ts` number scan with planted violations (`** 2`, `Math.pow`, `Math.hypot`, `Math.sin`, `Math.exp`, `Math.log`) flagged and `** 2n` accepted, red on the current `label-layout.ts` prefilter; a pinned digest of every 005 box (territory boxes + faction boxes of seed 1 rounds 0..4, aspects 3 / 4) taken on the current code before the prefilter change.
  - Code: plan D1 and section 5; `fitLabel` prefilter `d * d` (nothing else in `label-layout.ts`).
  - Commit: `feat(web): add the exact axis angle and frame membership`.
  - Done when: tests green; the 005 box digest unchanged after the prefilter change; mutations proved (tie towards 0 flipped, wrap removed, one (p, q) row swapped, `<=` -> `<` on an edge); `rg` finds FR-196, FR-199, NFR-39.

- [x] **T3. Shaped candidate and the in-land frame choice.** FR-195, FR-197, FR-198, FR-199, NFR-38
  - Files: `apps/web/src/core/label-shape.ts`, `apps/web/test/{label-shape.test.ts,helpers/label-reference.ts}`.
  - Tests first: plan section 13 `label-shape.test.ts` search list: `inLandFrame` equals the brute-force definition on 200 fixed-seed random grids and on the hand grids (vertical strip at +90 bottom to top, diagonal band, cup and cap bands, image edge, Hmax kept horizontal, near-compact kept horizontal); shape order and the exact centre tie; pruned search equals `shapedHeight` + G rule; FR-195 horizontal candidate is the 005 box object.
  - Code: plan D2 and section 6 (EDT filter with EPS, descending scan, bound ceil(G x hH), skip above Hmax).
  - Commit: `feat(web): add shaped label frames`.
  - Done when: tests green; dev map shaped search time logged (territories, factions of seed 1 round 0); mutations proved (EPS = 0 on a planted edge grid, bound off by one, shape order swapped, tie y/x swapped); `rg` finds the listed ids.

- [x] **T4. Off-land search, fallback and leader line geometry.** FR-203, FR-204, FR-205, FR-206, FR-207, FR-215
  - Files: `apps/web/src/core/label-offland.ts`, `apps/web/test/{label-offland.test.ts,helpers/label-reference.ts}`.
  - Tests first: plan section 13 `label-offland.test.ts` list (brute-force equality on hand and random grids; trigger at offLandHeight - 1 and offLandHeight; image edge; own set refused, own other pieces allowed; g2 576 / 577; tie order; placement order and FR-206 fallback; blocking by in-land frames of labels that go off-land; leader iff g2 > 36 and its end points; D7 boundary-only equals all units).
  - Code: plan D6, D7 and section 7 (`offLandBox`, footprint raster, `leaderLine`).
  - Commit: `feat(web): add off-land label boxes`.
  - Done when: tests green; mutations proved (gap `<=` -> `<`, obstacle list without earlier boxes, anchor tie by column first); `rg` finds the listed ids.

- [x] **T5. Role placements: territories once, factions per state with reuse; dev-map checks and the layout digest.** FR-206, FR-209, FR-213, FR-215, FR-216, NFR-39, NFR-41
  - Files: `apps/web/src/core/label-place.ts`, `apps/web/test/{label-place.test.ts,helpers/label-digest-run.ts,shaped-perf.test.ts}`.
  - Tests first: plan section 13 `label-place.test.ts` list (territory layout equal at rounds 0..T; no same-role conflict on the dev map, fallbacks included; FR-216 reuse equals a fresh computation for every step and jump of seed 1, and a step recomputes only changed in-land frames; NFR-41 horizontal in-land labels keep their 005 box at every round; D11 digest pinned); `shaped-perf.test.ts` (logged times, recompute counts).
  - Code: plan D5 and section 7 (`placeTerritories`, `placeFactions`).
  - Commit: `feat(web): place shaped and off-land labels per role`.
  - Done when: tests green; Node times logged for territory placement at load and per-step faction placement; mutations proved (reuse of a changed region, off-land reused across a changed obstacle set, territory placement reading owners); `rg` finds the listed ids.

- [x] **T6. Drawing data and step rules.** FR-208, FR-210, FR-211, FR-212, FR-213, FR-214 (pure counts)
  - Files: `apps/web/src/core/{label-frame.ts,label-input.ts,label-counts.ts,panel-text.ts,strings.ts}`, `apps/web/test/{label-steps.test.ts,label-counts.test.ts,label-frame.test.ts (byText only, plan section 10 item 3)}`.
  - Tests first: plan section 13 `label-steps.test.ts` and `label-counts.test.ts` lists (cases (a), (b), (c) at f = 0, 0.25, 0.5, 0.75, 1; +90 -> -75 without wrap; third faction crossfade vs unchanged; f = 0 / f = 1 equal the instant draws; backward = forward mirrored; `roundLabels` with `placed`; `frameOf` / `screenFrame`; no seed/round/record in draw data; exclusive counts and `labelCountsLine`). The `byText` edit is made first and the whole 005 `label-frame.test.ts` must stay green unchanged otherwise.
  - Code: plan D3, D4, D8 and section 8.
  - Commit: `feat(web): add shaped label draw data and step rules`.
  - Done when: tests green, every 005 label test green; mutations proved (angle wrapped in case (b), case (b) at f = 1 drawn as straight instead of the endpoint, factor-0 draw listed, unchanged third faction crossfaded); `rg` finds the listed ids.

- [x] **T7. Label layer: straight and arc text, leader lines.** FR-200, FR-201, FR-202, FR-207, FR-208, FR-212, NFR-42
  - Files: `apps/web/src/core/glyph-layout.ts`, `apps/web/src/render/labels-layer.ts`, `apps/web/test/{glyph-layout.test.ts,labels-shaped-render.test.ts,labels-render.test.ts (type-level test only, plan section 10 item 2)}`.
  - Tests first: plan section 13 `glyph-layout.test.ts` and `labels-shaped-render.test.ts` lists (rotation by -theta, stretch only along the reading direction, +90 bottom to top, arc glyphs unstretched on the middle line, halo before fill, leader lines 3 px black then 1 px white at the label alpha before every text and only for drawable labels, box labels produce exactly the 005 call log); the type-level edit; `glyph-layout.ts` not imported by any [N] file.
  - Code: plan D9 and section 9.
  - Commit: `feat(web): draw rotated and arc labels with leader lines`.
  - Done when: tests green, the 005 render tests green unchanged except the listed type test; the FR-159 render scan passes; `rg` finds the listed ids.

- [x] **T8. UI wiring, debug counts and first visual check.** FR-209, FR-214, FR-216, NFR-38 (wiring), NFR-42
  - Files: `apps/web/src/ui/{main.ts,panel.ts}`.
  - Tests first: none new beyond T6 (counts text) unless wiring logic moves into `src/core`; the 004/005 scans (anti-spoiler, strings, purity) stay green.
  - Code: `placeTerritories` once at load; `placeFactions` per state with the round being left as `previous`; `roundLabels(..., placed)`; counts line under the timings; FR-190 figure around 005 boxes + placement + front.
  - Visual check: screenshots of `?seed=1&round=0`, `?seed=1&round=1`, `?seed=1&round=4` at fit; one territory view above L1 on the dense area and one on Baleares; `?seed=1&round=1&transition=0.5` at fit; the debug panel counts visible on each. Manual: next/previous steps, reduced motion. **User reviews and accepts.**
  - Commit: `feat(web): wire shaped and off-land labels`.
  - Done when: tests green; screenshots accepted (PENDING: user review of the T8 screenshots); counts match `labelCounts` for the shown state; `rg` finds the listed ids.

- [x] **T9 (user decision and acceptance recorded: territory offLandHeight 3 chosen 2026-10-19; screenshots accepted). Review set with recorded hits; `offLandHeight` tuning.** NFR-40 (and the final value of `offLandHeight`, FR-203)
  - Files: `apps/web/src/core/{shaped-review-set.ts,shape-params.ts}`, `apps/web/test/{shaped-review-set.test.ts,helpers/measured-aspects.ts,label-place.test.ts (re-pinned digest)}`, `specs/006-shaped-and-off-land-labels/plan.md` (section 12 recorded hits, chosen value, date).
  - Steps: measure aspects in Chrome on the reference PC and record them (D10); tests first: hit-finding in the stated order for every scene of plan section 12 (first hit pinned; dropped scenes listed, their `MBRG_SLOW=1` proof logged, D12), each address parses and holds what its label says; 2-3 `offLandHeight` candidates in range; screenshots of the 005 `LABEL_REVIEW_SET` retaken and of the whole `SHAPED_REVIEW_SET` for each candidate; **user chooses the value and accepts every screenshot**; then pin the value, re-pin the hits and the D11 digest.
  - Commit: `feat(web): add the shaped label review set`.
  - Done when: tests green; hits and value recorded in the plan and `MEMORY.md`; screenshots accepted.

- [ ] **T10. Performance, browser determinism, no-regression check, close the pending set, PR.** NFR-38, NFR-39, NFR-41, done criteria
  - Files: `packages/sim/test/traceability.test.ts` (pending set removed, 256 expected, plan section 10 item 1), `specs/006-shaped-and-off-land-labels/spec.md` (status -> `implemented`, last, after review), `MEMORY.md` (local).
  - Tests first: traceability with no pending set (every FR-195..FR-216 and NFR-38..NFR-42 in a title).
  - Steps: NFR-38 procedure of plan section 12 on the reference PC; D11 digest in Chrome (and Edge, Firefox when available) equal to the Node pin; live aspects equal the recorded ones; figures in the PR; if a threshold fails, stop and propose an exact fix or a spec change. Process check: `git diff --exit-code rewrite -- packages/*/src packages/sim/test/golden maps/dev` clean; `git diff --stat rewrite -- apps/web/test packages tools` shows only the edits of plan section 10 plus new files. Push, PR, CI green, squash only with the user's OK.
  - Commits: `test: trace every spec 006 id`; `docs: mark spec 006 implemented`.
  - Done when: CI green; NFR-38 figures within thresholds and recorded; digest equal in the browser; all screenshots accepted; `MEMORY.md` updated (state, decisions, lessons; next: roadmap step 3).
