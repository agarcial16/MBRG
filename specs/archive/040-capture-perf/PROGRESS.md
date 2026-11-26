# Spec 040 — Progress

## 2026-11-26 — Profile and spec draft
- Profiled the capture page with a CDP CPU profile (unminified build, headless shell 155, SwiftShader): world-countries round image 5.4-6.5 s, of which label layout ~3.3 s (`placeReadableFactions` 2.3 s, `placeReadableTerritories` 1.0 s); full map 8-9 s (layout 3.9 s + ~3 s native raster of 9 M pixels). Tools used: `profile.mjs`/`agg.mjs` in the session scratchpad (not committed).
- Prototype (uncommitted, in the working tree): `LayoutScope` + `layoutScopeOf` in `apps/web/src/core/label-readable.ts`, `start.layoutForCamera` in `ui/map-view.ts` (camera built before the layout), set by `ui/capture-main.ts`. PNGs byte-identical to the unscoped build in 7 cases (dev, world-countries rounds 1-3 and full 0/3, world-1815 full). Round image 2.3-2.9 s, full map 6.5-6.9 s (world-countries).
- Spec written (`spec.md`, Status: draft). Waiting for the user's approval typed in this thread and the full-map decision (A keep 4096 px / B cap at 2048 px).
- Branch `feat/040-capture-perf`. State: spec draft + prototype. Next step: on approval, tests first (scope helpers, scoped vs full `resolveFrameLabels` equality on `maps/dev` and `maps/world-countries`), then `capture-perf.ts`, 3-run before/after measurements (time + peak memory) for world-countries and world-1815, MEMORY.md / board.md / lessons, PR.

## 2026-11-26 — Approved and implemented
- User approval typed in the spec thread: option A (full map keeps 4096 px). Spec set to `Status: implemented` and archived.
- **Code**: `apps/web/src/core/label-readable.ts` (`LayoutScope`, `layoutScopeOf`, optional `scope` on `placeReadableTerritories` / `placeReadableFactions`), `apps/web/src/ui/map-view.ts` (`start.layoutForCamera`; the first camera is built before the layout), `apps/web/src/ui/capture-main.ts` (sets it). `apps/bot/test/real/capture-perf.ts` (manual: N cold captures per map and frame, time + peak browser memory; `MBRG_PERF_MAPS`, `MBRG_PERF_RUNS`, `MBRG_PERF_FULL`, `MBRG_PERF_VIEWER_PORT`; a failed capture is reported and left out of the medians).
- **Tests**: `apps/web/test/layout-scope.test.ts` (15 tests on `maps/spain-provinces`, ~12 s): region/margin tests, far/close flags, scoped vs whole layout give the same `resolveFrameLabels` result for 7 cameras (far, blend, close, wide, largest piece), tiers of in-scope regions equal the whole layout's, empty-kind fallback (aspects x16), scene wiring scan. Mutation checks: no region filter, no close fallback, pad 0, close flag always true all fail a test. Surviving: the far-kind fallback when the close tiers are empty (`close!.length === 0`): no map tried has a faction with empty close and non-empty far tiers (swept aspects x0.1..x60), so it is untested by data, kept for symmetry. `npm run typecheck` green; `npm test`: 6990 passed, 4 timeouts of 5 s under the full parallel run (http-sse, service-timeline-golden, build-map sample, labels-perf) that pass when run alone (52 tests, 4.9 s).
- **Pixel identity** (same match, production build before vs after, PNG `cmp`): dev round 2 / full 3, world-countries round 1 and 3 / full 3, world-1815 round 3 / full 2: all byte-identical (7 cases).
- **Measurements** (capture-perf.ts, real server + production viewer + chrome-headless-shell 155, SwiftShader, Windows 11; cold browser each run; peak = sum of working sets of all browser processes). The machine was ~85 % busy with an unrelated game for the whole session, so absolute times are inflated and noisy (runs that hit the 20 s limit were dropped, which flatters "before"); compare before and after of the same pass. Runs per row: n, min / median / max in ms; peak memory max in MB.

| map, frame | before | after |
|---|---|---|
| world-countries round | n 3: 8614 / 8671 / 9062; 584 MB | n 6: 3612 / 4139 / 6925; 541 MB |
| world-1815 round | n 3: 9944 / 10973 / 11109; 674 MB | n 3: 4006 / 5466 / 6723; 657 MB |
| dev round | n 6: 3399 / 3672 / 6954; 473 MB | n 6: 2961 / 4182 / 10523; 454 MB |
| world-countries full | n 3: 12137 / 13262 / 19476; 678 MB | n 6: 5846 / 7557 / 10369; 719 MB |
| world-1815 full | n 3: 16146 / 16729 / 16731; 971 MB | n 3: 11827 / 12268 / 13032; 923 MB |

  In-page time (CDP profile / `profile.mjs`, same machine, lighter load): world-countries round 5.4-6.5 s -> 2.3-2.9 s, world-1815 round 7.0 -> 2.9-3.4 s, world-countries full 9.2 -> 5.8-6.9 s, world-1815 full 13.5 -> 11.0 s. Memory stays far under 1 GB (max 971 MB before the change on world-1815 full, 923 after; idle is 0 MB as before: the browser still closes after 10 s). dev map captures did not get faster (its layout is tiny; noise).
- NFR-200: met on `world-countries` (median 4.1 s end to end, 2.3-2.9 s in page); `world-1815` median 5.5 s end to end on a loaded machine (3.4 s in page): borderline, re-run `capture-perf.ts` on a quiet machine to confirm. The full map stays raster-bound as decided (A).
- Not done / untested: Linux; a persistent layout cache (option left for the full map); real Discord.
- Branch `feat/040-capture-perf`. State: implemented, PR to open. Next step: user review and word to merge (do not merge without it); after merge nothing else pending for this spec.

## 2026-11-26 — Merged main (spec 039) and re-checked
- `origin/main` (039, #109) merged into the branch; conflicts only in `MEMORY.md`, `docs/board.md` and one line of `map-view.ts` (039 gave `cameraFor` a second argument `pieces`; `first` uses it). `npm run typecheck` green.
- Pixel identity re-checked against a build of `origin/main` (same match, `cmp`): dev round 2 / full 3, world-countries round 1 and 3 / full 3, world-1815 round 3 / full 2: byte-identical (7 of 7). In page (lighter load), main -> this branch: world-countries round 5.6-6.1 s -> 1.9-2.5 s, world-1815 round 6.0 -> 2.0 s (039's main-piece framing makes the view smaller too), world-countries full 8.3 -> 5.4 s, world-1815 full 12.6 -> 9.8 s.
- Branch `feat/040-capture-perf`. State: implemented, PR open. Next step: the user's word to merge.
