### M4 — Drawing, debug shell, figures, debug screenshots (`feat/009-m4-tour-drawing`; 41 / 6 -> 46 / 1)
**Status: approved by the user on 2026-10-25/26, with the browser-pin rules of plan section 14 (approved 2026-10-26).** Plan sections 4.6, 8, 10, 12. Rules of `tasks.md` apply. Estimate about 2,240 changed lines; checkpoint: stop and report above 1,300 at the end of T3. Branch cut from `rewrite` after M3 is merged. Visual tasks need the user's review of the screenshot page before closing.

Titles: FR-326, FR-355 first named in T2; FR-341 in T4; NFR-58, NFR-62 in T5. Parts of closed ids are named, for example `FR-333 (shell)`: FR-339 (round request, skip), FR-340 (completeRunning), FR-351 and FR-352 (frozen drawing, address camera counted as taken, removal at the next address update) are titled with their part (`FR-339 (shell)`, `FR-340 (completeRunning)`, `FR-351 (frozen drawing)`, `FR-352 (address)`).

- [x] **T1. Branch and bookkeeping.** Done when: suite green; 41 / 6. Size: S (about 30).

- [x] **T2. Dim shading: reference, shader port, map scene.** FR-326, FR-355
  - Files: `apps/web/src/core/tour-shade.ts` (new), `apps/web/src/render/{shader,map-scene}.ts`, `apps/web/test/tour-shade.test.ts` (new), `apps/web/test/labels-render.test.ts` (only if it pins the uniform set).
  - Tests first: `dimByte` at δ 0, 0.65 and a non-round 0.37 over all 256 values; `shadeTour` over the dev map at 1920 x 1080: lit land unchanged, other land, sea, outside and border pixels of unlit units dimmed, border pixels of lit units unchanged; at δ = 0 and no lit set equal to `renderReference` pixel for pixel (`FR-355`); the shader text has exactly `uDim`, `uLit`, the gate `uDim > 0.0` and the same operations in the same order as the reference (line-by-line port check as for `borders.ts`); `setTour` changes uniforms only (nothing uploaded); the FR-155 and FR-159 scans pass.
  - Commit: `feat(web): dim the map outside the tour's factions`.
  - Mutation proofs: dim applied to lit units too; border pixel lit by its neighbour's unit; sea counted as lit; the gate removed from the shader text (caught by the port check).
  - Done when: tests green; 43 / 4. Size: M (about 500).

- [ ] **T3. Overlay and the map view driver.** (parts: FR-329, FR-333, FR-335, FR-340, FR-342, FR-344 (shell))
  - Files: `apps/web/src/render/labels-layer.ts`, `apps/web/src/ui/map-view.ts`, `apps/web/src/core/playback.ts` (`completeRunning`), `apps/web/test/{map-view-tour-scan,playback}.test.ts`.
  - Tests first: `completeRunning` (pure); overlay draw log with a fake 2D context (ring black 4 under white 2, triangle with halo, drawn after the texts, never with a label alpha); map-view scan: the tour paint path calls no layout function (NFR-58 pure part is named in M4 T5), `userCamera` marks taken and the tour's camera does not, the reduced-motion watcher completes a tour, `beginTour` completes a running step first; **strict test: `completeTour` with no tour running is a no-op** (it must not complete a plain 005 step, e.g. after a stale or mismatched reveal under fast manual timing); **guard (plan section 9): until the end frame of an absorber tour the painted owners, labels and legend are those of k - 1 (round-k `StepData` and prepared layout are never shown early).**
  - Commit: `feat(web): draw reveal tours in the map view`.
  - Mutation proofs: overlay drawn before the labels; tour camera marking taken; layout called on the first tour frame.
  - Done when: tests green; no id moved (43 / 4); every 004 to 007 test unchanged and green. Size: L (about 650).

- [ ] **T4. Debug shell: `reveal=on`, frozen tours, panel and pointer during tours, skip.** FR-341
  - Files: `apps/web/src/ui/{main,panel,input,url}.ts`, `apps/web/test/{ui-driver,address-reveal}.test.ts`.
  - Tests first: Escape calls `onSkip` (ui-driver fake); skip completes a victim tour, and an absorber tour then starts the 005 step; `on` chains victim -> absorber (d >= 2) -> step and skips the absorber at d = 1; frozen values draw N - 1 at t with no clock and the panel at N; panel record line and pointer per A2; the address keeps `reveal` per A6 and writes the tour camera at the end (A7); **debug legend guard (plan section 9): with `reveal=on` or a frozen value the legend follows the drawn state N - 1 until the tours stop (victim not yet eliminated, absorber count old), then shows N; test over a whole chain and a frozen value.**
  - Browser-pin rules (A13, approved 2026-10-26; Node part here): a second pins file `golden/tour-frame-pins-debug.json` (regression pins by the code under test, hand-run generator) computed under the frozen debug-scene rules (no address camera, area exactly 1920 x 1080, start camera overview with leg 1 skipped for the victim tour and victim framing for the absorber tour, framing boxes from `placeCentredFactions` label-set pieces); today's pins stay as an extra case; a test that the digests are identical with non-round aspects (2.7 and 9.3) and with the `placeCentredFactions` boxes; the panel digest line is the digest of the frame the map view actually drew.
  - Commit: `feat(web): play reveal tours in the debug scene`.
  - Mutation proofs: Escape ignored; absorber tour played at d = 1; frozen value kept after a round change.
  - Done when: tests green; 44 / 3. Size: M (about 550).

- [ ] **T5. Figures, review rounds, screenshots.** NFR-58, NFR-62
  - Files: `apps/web/src/ui/{main,panel}.ts` (tour figures), `apps/web/src/core/{perf,panel-text}.ts`, `apps/web/test/{tour-review,perf}.test.ts` (new / edit), `.claude/review/009-m4-tours.html` (not in git).
  - Tests first: the new STRINGS keys of the tour figures (NFR-64: Spanish, used by code, language scan green); tour figures text (median, 95th percentile over the tour's frames only, first-frame latency, layouts during the tour); a test finds the NFR-62 rounds for seed 1 (first with d >= 3, one with d = 2, the smallest victim by area and whether it is tiny at the overview) and pins them; the tour paint path computes no layout (`NFR-58` pure part).
  - Browser (pane visible; kill only our PIDs; check :5173 first): the figures of plan section 10, three runs, rounds 1 to T; the frame digests shown while frozen equal `tour-frame-pins.json` for the NFR-62 frames, using pins computed under the frozen debug-scene rules (plan section 14, approved by the user 2026-10-26; the pins file and its Node tests are made in T4); the screenshot page of plan section 12 items 1 and 2.
  - Commit: `feat(web): measure reveal tours in the debug panel`.
  - Done when: tests green; figures within budget or reported; the user reviewed the page; 46 / 1. Size: M (about 450).

- [ ] **T6. Close M4.**
  - Files: traceability closing state 46 / 1, PROGRESS, plan figures, `MEMORY.md` (local).
  - Done when: suite, typecheck, `CI=1` green; scope diff clean; PR opened with figures and the review page reference. Size: S (about 60).
