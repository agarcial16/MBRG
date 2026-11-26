# Spec 040 — Progress

## 2026-11-26 — Profile and spec draft
- Profiled the capture page with a CDP CPU profile (unminified build, headless shell 155, SwiftShader): world-countries round image 5.4-6.5 s, of which label layout ~3.3 s (`placeReadableFactions` 2.3 s, `placeReadableTerritories` 1.0 s); full map 8-9 s (layout 3.9 s + ~3 s native raster of 9 M pixels). Tools used: `profile.mjs`/`agg.mjs` in the session scratchpad (not committed).
- Prototype (uncommitted, in the working tree): `LayoutScope` + `layoutScopeOf` in `apps/web/src/core/label-readable.ts`, `start.layoutForCamera` in `ui/map-view.ts` (camera built before the layout), set by `ui/capture-main.ts`. PNGs byte-identical to the unscoped build in 7 cases (dev, world-countries rounds 1-3 and full 0/3, world-1815 full). Round image 2.3-2.9 s, full map 6.5-6.9 s (world-countries).
- Spec written (`spec.md`, Status: draft). Waiting for the user's approval typed in this thread and the full-map decision (A keep 4096 px / B cap at 2048 px).
- Branch `feat/040-capture-perf`. State: spec draft + prototype. Next step: on approval, tests first (scope helpers, scoped vs full `resolveFrameLabels` equality on `maps/dev` and `maps/world-countries`), then `capture-perf.ts`, 3-run before/after measurements (time + peak memory) for world-countries and world-1815, MEMORY.md / board.md / lessons, PR.
