# Tasks 004 — Viewer
Plan: `specs/004-viewer/plan.md`. Prerequisites: spec `Status: approved`; plan and tasks approved by the user; plan section 14 decisions confirmed (U1 `@types/three` needs a spec amendment of NFR-26 first, or the fallback; U2 exact versions confirmed before any `npm install`). Any later change goes to the spec first, then the plan, then these tasks.

Rules for every task:
- Delivery: one branch `feat/004-viewer` from an up-to-date `rewrite` (`git pull --ff-only origin rewrite`), one PR into `rewrite`, squash merge only with the user's OK and CI green. No GitHub issues. Never push to `main` or `rewrite`. One commit per task (T1 has two).
- Tests first: write them, see them fail (red) for the right reason, then code. Prove new scans and guards by temporary mutation (back the file up first; never `git checkout` a file with uncommitted edits); use the FULL `npm test` for mutation proofs.
- Before each commit: `npm test`, `npm run typecheck` and `$env:CI='1'; npm test` (PowerShell) all green. Quote the path (it contains spaces). Local Node is 24.0.0 (`.nvmrc` = 24).
- `apps/web/src/core` stays pure (NFR-25); `three` only in `src/render`; `@mbrg/sim` never in `src/render`; Spanish text only in `src/core/strings.ts`; all other viewer sources ASCII-only. No edit to `packages/*/src`, goldens, `maps/dev` or any 001-003b test except the two files of T8 (NFR-29).
- Only the confirmed packages (`three`, `vite`, and `@types/three` if U1 is approved), in `apps/web/package.json` only, exact versions in the manifest and the lockfile, licences re-checked and recorded in plan section 1 in the same commit. Anything else: stop and ask.
- Test titles start with the FR/NFR ids they verify. Check each task's ids with `rg -n "(it|test|describe)\(['\"\`][^'\"\`]*\bFR-NN\b" apps/*/test packages/*/test tools/*/test`.
- Visual tasks (T6, T7, T9, T10) are not done without screenshots of the debug scene from fixed `seed`/`round`/`x`/`y`/`zoom` addresses, reviewed and accepted by the user (NFR-27).
- After each task: tick it, update `MEMORY.md` locally (state, decisions with why, mistakes), and stop. The reviewer validates each task FR by FR.

- [x] **T1. Commit spec docs; viewer workspace, confirmed dependencies, config extensions, manifest test.** NFR-26
  - Step 0 (before installing): `npm view vite@8.3.4 time`, `npm view three time --json`, `npm view three dist-tags`, `npm view @types/three versions --json`. Choose the newest stable `three` at least 14 days old and the matching `@types/three`; write them into plan section 1; **show the user and wait for OK**.
  - Files: `specs/004-viewer/{spec,plan,tasks}.md` (first commit); root `package.json` (`workspaces` + `apps/web`; scripts `dev`, `build` delegating to `-w @mbrg/web`; `typecheck` + `tsc -p apps/web/tsconfig.json && tsc -p apps/web/tsconfig.test.json`), `vitest.config.ts` (`include` + `apps/*/test/**/*.test.ts`); `apps/web/{package.json,index.html,vite.config.ts,tsconfig.json,tsconfig.test.json}`, `apps/web/src/ui/main.ts` (stub that imports `@mbrg/shared` and `three` and logs nothing), `apps/web/test/libraries.test.ts`.
  - Tests first: plan section 11 NFR-26 list (exact deps, lockfile equality, licences, `three` imported only under `src/render` once that exists, `vite` only in `vite.config.ts`, no builder library, shared/sim still without third-party deps).
  - Smoke: `npm run dev` serves a blank page with no console error; `npm run build` succeeds and `apps/web/dist` is gitignored.
  - Commits: `docs: add spec, plan and tasks 004 viewer`; `chore(web): add viewer workspace and tooling`.
  - Done when: `npm ci` is clean; the lockfile diff is the workspace link plus the confirmed packages (and three's/vite's transitive packages, if any); typecheck covers `apps/web` src and tests; NFR-26 green; licences recorded.

- [x] **T2. Camera, address parameters, round navigation, UI strings.** FR-144, FR-145, FR-146, FR-147, FR-148, FR-149, FR-150, FR-151, FR-153, FR-154, NFR-28
  - Files: `apps/web/src/core/{camera.ts,address.ts,navigation.ts,strings.ts}`, `apps/web/test/{camera.test.ts,address.test.ts,navigation.test.ts,strings-language.test.ts,helpers/scan.ts}`.
  - Tests first: plan section 13 camera, address and navigation lists (every spec edge case of the address, the 1-px pointer rules, limits, clamp, resize, reset, format/parse round trip); NFR-28 scan rule of plan section 10 (ASCII outside `strings.ts`, no literal text into DOM sinks, `index.html` without text, every `STRINGS` key used and non-empty, English viewer-internal kinds listed), proven by planting a Spanish literal.
  - Code: plan sections 4 and 5.
  - Commit: `feat(web): add camera, address parsing and round navigation`.
  - Done when: tests green; `rg` finds every listed id.

- [x] **T3. Theme, faction colours, territory line maths, border rules (CPU reference).** FR-136, FR-137, FR-138, FR-139, FR-140, FR-141, FR-142, FR-143
  - Files: `apps/web/src/core/{theme.ts,colors.ts,lines.ts,borders.ts}`, `apps/web/test/{colors.test.ts,lines.test.ts,borders.test.ts,helpers/grids.ts}`.
  - Tests first: plan section 13 colours, lines and borders lists (dev map -> DEU red, ESP ochre, FRA green, ITA purple, PRT orange; step 2; `palette-exhausted`; distinctness; opacity at S0/S1/32 and monotonic; every border class, colour and width at DPR 1 and 2; quadripoint; image edge; absorption flips `faction` to `territory` in the same render; camera-independent classes; owners compared by index, not colour).
  - Code: plan sections 6 and 8 (`renderReference` is the normative rule the shader ports).
  - Commit: `feat(web): add theme, faction colours and border rules`.
  - Done when: tests green; `rg` finds FR-136..FR-143.

- [x] **T4. Map package loading: PNG decode, checks, entry index, owner table, capabilities.** FR-132, FR-133, FR-134, FR-135, NFR-24 (per-entry update)
  - Files: `apps/web/src/core/{png.ts,package.ts,entries.ts,capabilities.ts}`, `apps/web/src/ui/load.ts`, `apps/web/test/{png.test.ts,package.test.ts,helpers/dev-map.ts}`.
  - Tests first: plan section 13 png and package lists (exact values over all three channels, filters 0-4, every rejected chunk/format, the dev map PNG decodes and passes `checkIdImage`; error order and first kind; capabilities; `ownerTable` holds per-entry data only; `load.ts` fetches exactly the three `maps/dev` `?url` assets).
  - Code: plan sections 2 (P3-P6) and 7.
  - Commit: `feat(web): load, decode and check the map package`.
  - Done when: tests green; the dev map loads in a Node test in under 2 s (logged, not asserted); `rg` finds FR-132..FR-135, NFR-24.

- [x] **T5. Debug scene model, performance statistics, anti-spoiler and purity scans.** FR-152, FR-155, FR-156, FR-157, FR-158, FR-159, FR-160, FR-161, NFR-25
  - Files: `apps/web/src/core/{scene.ts,perf.ts}`, `apps/web/test/{scene.test.ts,anti-spoiler.test.ts,purity.test.ts}`.
  - Tests first: plan section 13 scene, anti-spoiler and purity lists. The recorded-calls sim proves FR-160: stepping 0 -> 1 -> 2 requests only 1, then 2, never 3; jump to T requests only T. The panel data has no field for rounds after n. Scans: `src/render` without `@mbrg/sim`/seed/round; no network API outside `load.ts`; NFR-25 forbidden APIs in `src/core`, clock only in `src/ui/clock.ts`; each scan proven by a planted source. Throwing-clock run of `sceneAt`, `assignFactionColors`, `renderReference`.
  - Code: plan section 9.
  - Commit: `feat(web): add debug scene model and anti-spoiler checks`.
  - Done when: tests green; `rg` finds FR-152, FR-155..FR-161, NFR-25.

- [x] **T6. Three.js rendering part and first drawn scene.** (screenshots accepted 2026-10-16) FR-134 (texture flags), FR-136, FR-138, FR-139, FR-140, FR-159, NFR-24 (owner texture only)
  - Files: `apps/web/src/render/{shader.ts,map-scene.ts,renderer.ts}`, `apps/web/src/ui/main.ts` (load -> check -> colours -> index -> `sceneAt(seed 1, round 0)` -> draw at fit; error screen for FR-133/FR-135/FR-141/FR-152), `apps/web/test/map-scene.test.ts`.
  - Tests first: plan section 13 map-scene list (Nearest, no mipmaps, no flipY, no premultiply, NoColorSpace, unpack alignment 1; `setOwners` touches only the owner texture; colour management off; exported signatures take no seed/round, as a type-level test).
  - Code: plan sections 2 (P7) and 8: the GLSL is a line-by-line port of `renderReference`.
  - Visual check: screenshots of `?seed=1&round=0` and `?seed=1&round=1` at fit and at zoom 8 and 32 on one border. Compare by eye with `renderReference` output on the same small window (written to the scratchpad as a PNG by a throwaway script, not committed). **User reviews and accepts.**
  - Commit: `feat(web): render the id image with owner colours and borders`.
  - Done when: tests green; the dev map is drawn in Chrome on the reference PC; screenshots accepted; `rg` finds the listed ids in titles.
  - Review 2026-10-15: screenshots NOT accepted: the `faction` border was too thin to see at zoom 8 and 32. Spec amended (FR-139, decision Q2). T6 stays unticked until T6b is done and the regenerated screenshots are accepted; then T6 and T6b are ticked together.

- [x] **T6b. Border width amendment.** (screenshots accepted 2026-10-16) FR-138, FR-139, FR-140 (spec amendment 2026-10-15)
  - Files: `apps/web/src/core/theme.ts` (`BorderWidth = 1 | 2 | 4`; `BORDER_WIDTHS` `faction` 4, `territory` 4, `outer` 2, `coast`/`sea-zone`/`shore` 1; `Theme.width` typed with `BorderWidth`), `apps/web/src/core/borders.ts` (export `WIDTH_LEVELS = [4, 2, 1]` used by `shade`), `apps/web/src/render/shader.ts` (width list and loop bound generated from `WIDTH_LEVELS`, no hard-coded `2.0`/`1.0`/`wi < 2`), `apps/web/test/borders.test.ts`, `apps/web/test/map-scene.test.ts` (and `apps/web/test/lines.test.ts` only if it pins widths). No other source file; `map-scene.ts` keeps filling `uWidths` from `theme.width`.
  - Tests first (red against the current 2/1 values): `FR-139` widths pinned (`faction` = `territory` = 4, `outer` 2, others 1) and every width in `WIDTH_LEVELS`; measured in `renderReference` output at DPR 1 and 2 and at scales 1, 3, 4, 5, 7, 8, 10, 16, 32: `faction` and `territory` bands 4 px (± 0.5), centred on the edge, continuous along a straight run; `FR-138` the same grid before/after an owner change paints the former border on exactly the same pixels, only colour/alpha differ (opaque `faction` -> darkened owner colour at territory opacity; at a scale <= `fadeStart` the pixels equal the fill); `FR-139` overlap order: T-junction and quadripoint with 4 px lines (`faction` wins the overlap square), `faction` line ending at a coast leaves sea pixels with the 1 px `coast` line only, `territory` yields to `coast`; small territory: a 2-unit-wide territory at scale 0.5 is fully covered by its lines (accepted edge case, asserted); `FR-140` classes unchanged by camera moves with 4 px lines. `map-scene.test.ts`: the generated fragment shader contains the width levels `4.0, 2.0, 1.0` from `WIDTH_LEVELS` and no hard-coded width loop; `uWidths` equals `BORDER_PRIORITY.map(c => theme.width[c])`. Prove the shader guard by temporary mutation (hard-code `wi < 2`), full `npm test`.
  - Visual check: regenerate the T6 screenshots with the new widths (same set 01-08 and the same addresses as in the scratchpad `t6-shots/addresses.txt`) plus 09: `small-territory-fit` (seed 1, round 0, fit scale, centred on the land territory with the fewest map units, chosen by a throwaway script and recorded in `addresses.txt`). Re-run the `renderReference` pixel comparison on the zoom 8 and 32 shots. **User reviews and accepts the whole regenerated set**; a rejection goes back to the spec (FR-139), not to ad-hoc values.
  - Commit: `feat(web): widen faction and territory borders to 4 px`.
  - Done when: tests green (also `CI=1`), typecheck green; `rg` finds FR-138, FR-139, FR-140 in the new titles; the regenerated 01-09 screenshots accepted by the user; T6 and T6b ticked; `MEMORY.md` updated (widths, why, the small-territory decision).

- [x] **T7. DOM shell: camera input, round controls, debug panel, address sync, timings.** (accepted 2026-10-16; user then asked territory lines from zoom 1.5, done in 748ed5d) FR-145, FR-146, FR-148 (reset), FR-151, FR-153, FR-154, FR-155, FR-156, FR-157, FR-158
  - Files: `apps/web/src/ui/{input.ts,panel.ts,url.ts,clock.ts,main.ts}`, `apps/web/src/core/strings.ts` (new keys), tests extended in `navigation.test.ts` (`shortcutApplies`), `strings-language.test.ts` (new keys), `anti-spoiler.test.ts` (`url.ts` uses `replaceState` only; no `pushState`/`reload`).
  - Tests first: the extended scans and pure predicates above; every new UI text added to `STRINGS` with a test that it is used.
  - Code: plan sections 4, 5 and 9 (on-demand drawing; rAF only while dragging or zooming; round change drawn synchronously).
  - Visual check: screenshots of the panel at round 0 and round 4 (legend, record, pointer readout over land, sea and outside, timings) and of an invalid-address message (`?seed=12abc`). **User reviews and accepts.**
  - Commit: `feat(web): add debug panel, controls and address sync`.
  - Done when: tests green; manual check: drag, wheel, reset, arrows/Home/End, typed round, copied address reproduces the scene; screenshots accepted.

- [x] **T8. Traceability extension and 003b NFR-20 manifest test update.** NFR-29 (and NFR-19/NFR-20 cross-references)
  - Files: `packages/sim/test/traceability.test.ts`, `tools/build-map/test/libraries.test.ts`, `apps/web/test/no-regression.test.ts`.
  - Tests first: traceability: glob + `apps/*/test`, `LAST_FR = 161`, `LAST_NFR = 29`, the "ends at" test (contains FR-132, FR-161, NFR-24, NFR-29; not FR-162, NFR-30), count **188**, `NFR-19 the scanned sources include the viewer tests`; self-trace pin unchanged. Prove it by temporarily renaming one viewer title (the id is reported missing), then revert. 003b test: `NFR-20 the viewer manifest declares none of the builder libraries` + the `apps/*/src` scan made non-vacuous. `NFR-29 the dev map package and goldens are unchanged` (SHA-256 literals taken from the `rewrite` tip).
  - UPDATE 2026-10-16: spec 003c (PR #23, merged into `rewrite`, 2647280) rebuilt `maps/dev` and added ids FR-162..FR-166, NFR-30, NFR-31 to the traceability test as ranges. This task now joins the ranges into FR 1..166 and NFR 1..31 (count 159 + 004's 30 FR + 6 NFR = 195 expected; recompute), and the NFR-29 SHA-256 literals are those of the 003c package: map `80d8af78fa92cd1a2d5f88e5d41239288bec2c6f6414ffc121d48e984acf95da` (11,834 B), ids.png `61df665a9336744c12cfb2aa11bf98474fd272b83d66ab34060b522cd0227037` (71,377 B), presentation `0e883d89bb7b823c6408efdc55744a4927e90886e0fc36576639d7609f30548d` (5,347 B). The numbers 188 and `LAST_FR = 161` above are superseded.
  - Steps: NFR-29 process check of plan section 11.
  - DONE 2026-10-16: ranges FR 1..166 / NFR 1..31 (expected 195, 194 while NFR-27 is pending until the review-set tests of T9/T10), `apps/web/test/no-regression.test.ts` (NFR-29, SHA-256 of the 003c dev map and of the eight goldens), 003b libraries test viewer clause. Mutation proved (renamed NFR-29 titles reported missing).
  - Commit: `test: trace spec 004 requirements`.
  - Done when: full suite green with every FR-1..FR-161 / NFR-1..NFR-29 id (minus FR-6, FR-25) traced; `git diff --stat rewrite -- packages tools` lists only the two edited test files.

- [x] **T9. Territory line tuning with the user.** (done 2026-10-16: user asked lines to start at 1.5 and be complete at 1.7 or 2; `fadeStart` 1.5, `fadeFull` 2 chosen; the user confirms with the far/mid/near screenshots in T10) FR-138, FR-139, FR-140 (final values), NFR-27 (territory scenes)
  - Files: `apps/web/src/core/{theme.ts,review-set.ts}`, `apps/web/test/{lines.test.ts,review-set.test.ts}`, `specs/004-viewer/plan.md` (section 6 final values).
  - Tests first: `review-set.test.ts` for the territory-line scenes. Use one area inside one faction that includes a former faction border after round 1. Far zoom <= `fadeStart`, mid strictly between, near = 32. Each address must parse cleanly and point where its label says. Pin the chosen params and assert they are inside the spec ranges.
  - Steps: prepare 2-3 candidate sets within the ranges (plan section 12); for each, far/mid/near screenshots of the same addresses; **user chooses one and accepts**; write it into `theme.ts` and plan section 6.
  - Commit: `feat(web): tune territory lines`.
  - Done when: tests green; the user's choice recorded (values + date) in the plan and `MEMORY.md`.

- [ ] **T10. Full visual review, performance measurement, close the PR.** (implemented 2026-10-16: 20 screenshots in the scratchpad `review/` with `review-addresses.txt`; NFR-24 measured; awaiting user acceptance, then status -> implemented and merge) NFR-24, NFR-27, done criteria
  - Files: `apps/web/src/core/review-set.ts` (complete NFR-27 set), `apps/web/test/review-set.test.ts`, `specs/004-viewer/spec.md` (status -> `implemented`, last, after review), `MEMORY.md` (local).
  - Tests first: the complete review set: seed 1, rounds 0, 1, 2, 4 at fit; at round 0 and round 1, zoomed views (>= 8) of a faction border, a former border, Baleares, Messina, a coast with a `sea-zone` edge, and a lake; at round 0, `small-territory-fit` (amendment 2026-10-15). Each point is checked against the dev map as plan section 12 says.
  - Steps: screenshots of every review-set address (1920 x 1080 drawing area, Chrome, reference PC). The PR table lists label, address and what to look at. **User accepts every screenshot**, including palette, sea, background and border colours (FR-142). Measure NFR-24 with the plan section 12 procedure and record the figures in the PR; if a threshold fails, stop and propose a fix or a spec change. Run the NFR-29 process check. Push, open the PR, wait for CI green, and squash merge only with the user's OK.
  - Commits: `test(web): add the visual review set`; `docs: mark spec 004 implemented`.
  - Done when: CI green on the PR; all screenshots accepted; NFR-24 figures within thresholds and recorded; `MEMORY.md` updated (state, decisions, lessons; next step spec 005).
