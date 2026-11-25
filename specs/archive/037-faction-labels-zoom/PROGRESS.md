# Progress — Spec 037 (Province-style faction labels at close zoom)

## 2026-11-25 — Implementation, tests, and visual verification
- **Branch**: `feat/037-faction-labels-zoom`
- **Changes**:
  - `apps/web/src/core/label-readable.ts`: added `closeStart = 0.85` / `closeFull = 1.0` to `READABLE_PARAMS`, pure `factionCloseBlend(scale, detail, params)`, dual `tiers` (far) + `closeTiers` (territory-rule) computation in `placeReadableFactions` with O(1) single-territory reuse (`TerritoryTierReuse`), zoom-band crossfade + identical-tier deduplication in `resolveFrameLabels`, and close-tier selection in `stepReadableLabels` and `upgradeTourDraws`.
  - `apps/web/src/ui/map-view.ts`: precomputed `mainPieceOf`, passed `territoryReuse` to `placeReadableFactions`, and threaded `detailFactor(image, viewport)` into `resolveFrameLabels`, `stepReadableLabels`, and `upgradeTourDraws`.
  - `apps/web/test/label-readable.test.ts`: added 4 unit tests covering FR-707..FR-712 (zoom blend + `detailFactor` scaling, far/close/crossfade/dedup resolution, round-step & tour close-tier selection, single-territory O(1) reuse + multi-territory Serbia+Hungary union on `maps/world-countries`).
- **Visual checks (`.claude/review/037/`)**:
  - Captured desktop (1280×720, `zoom=1.25`) and mobile (390×844, `zoom=0.38`) before/after screenshots of `maps/world-countries` (seed 10, round 46: Balkans Serbia+Hungary union and West Africa), plus mobile whole-world fit (`4096×2179` -> `390×207.5` CSS px, zero crop, ~318 px top/bottom letterbox) and micro-country tapability check (Malta, San Marino, Liechtenstein, Maldives: 9 map px each, 24–32 CSS px at `zoom=8`, 48–64 CSS px at `zoom=16`, 96–128 CSS px at `zoom=32`).
- **State**: ready for PR review into `main`.
- **Next step**: user reviews PR and before/after slider, then squash-merges into `main`.
