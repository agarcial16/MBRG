# Spec 032 — Progress

## 2026-11-23 — Setup & before screenshots
- Branch: `feat/032-readable-labels` (merged `origin/main` with #98 colouring and #99 HUD polish).
- Spec marked `approved` per user approval ("apruebo ... 032").
- Capturing before screenshots for `spain-provinces` (overview + zoomed-in, desktop + phone) and `spain-municipios-3` (zoomed-in, desktop + phone) under `.claude/review/032/`.
- State: baseline ready; no implementation code written yet.
- Next step: Step 1 — pure deterministic abbreviation module (`core/label-abbreviate.ts`) with tests first (FR-622, NFR-150).

## 2026-11-23 — Step 1: Pure core modules (`label-abbreviate`, `label-readable`, `map-readout`)
- Added `apps/web/src/core/label-abbreviate.ts` (FR-622, FR-626): deterministic abbreviation ladder (full name -> prefix + `.` -> plain uppercase acronym only if still needed, preserving diacritics/casing).
- Added `apps/web/src/core/label-readable.ts` (FR-620, FR-621, FR-623, FR-624, NFR-150): per-role screen-space size bounds (`minPx` = 9, `maxPx` = 48 faction / 28 territory), precomputed in-land tier builder (no off-land boxes or leader lines), zoom-in tier selection, and per-role screen-space overlap resolution with `minGapPx` = 4 px.
- Added `apps/web/src/core/map-readout.ts` (FR-625, FR-627): pure map coordinate -> full territory + full faction name resolver respecting reveal-tour hiding.
- Tests: `label-abbreviate.test.ts` (5), `label-readable.test.ts` (9), `map-readout.test.ts` (3) — 17/17 green.
- Branch: `feat/032-readable-labels`; State: core modules complete and tested.
- Next step: Step 2 — wire screen-space capping, tier selection & overlap resolution into `render/labels-layer.ts` and `ui/map-view.ts`, plus render tests.

## 2026-11-23 — Steps 2 & 3: Render cap, tier/overlap wiring, and always-on hover/tap readout
- Updated `apps/web/src/render/labels-layer.ts` (FR-621): clamped on-screen height to `[minPx=9, maxPx]` (48 px faction, 28 px territory) for horizontal, straight and arc frames while keeping centre, angle and curvature centred.
- Updated `apps/web/src/ui/map-view.ts` (FR-620, FR-623, FR-624, FR-626, FR-627): switched map layout to precomputed in-land abbreviation tiers (`placeReadableFactions`, `placeReadableTerritories`, zero off-land/leader lines) and screen-space overlap resolution (`resolveFrameLabels`) outside round steps.
- Wired always-on hover/tap full-name readout (FR-625, FR-627) into `apps/web/src/ui/live-main.ts`, `apps/web/src/ui/live-panel.ts`, `apps/web/src/ui/live-panel-style.ts`, and `apps/web/src/core/strings.ts` (`STRINGS.mapTipLine`).
- Branch: `feat/032-readable-labels`; State: implementation wired, running typecheck, tests, and after screenshots.
- Next step: review before/after screenshots, run full `npm test` + `npm run typecheck`, build before/after slider widget, mark spec `implemented`, push and ready PR #96.

## 2026-11-23 — Final verification & PR ready
- Fixed `map-view.ts` (`current.layout.boxes` + 1-arg `present(drawn)`) and `live-main.ts` (`setCamera: (next) => userMoved(next)`) so `map-view-tour-scan.test.ts` (16/16) and `round-shell.test.ts` (12/12) pass without modifying any scan test.
- Captured before/after desktop & phone screenshots under `.claude/review/032/` for `spain-provinces` (overview + zoomed-in) and `spain-municipios-3` (zoomed-in, 8,220 territories), and rendered desktop + phone before/after slider widgets.
- Verification: `npm run typecheck` green across all 12 tsconfigs; full `npm test` green (426/434 passed on first run + 8/8 re-verified cleanly after fixing the 2 scan assertions and clearing concurrent Chrome CPU load; 19/19 new spec 032 tests green).
- Marked `specs/032-readable-labels/spec.md` as `Status: implemented` and updated `MEMORY.md`.
- Untested: real-device phone touch readout and browser frame-time benchmark on 8,220-territory municipality map.
- Branch: `feat/032-readable-labels`; State: pushed and PR #96 marked ready for review.
- Next step: reviewer reviews PR #96 before merge.

## 2026-11-23 — Review fixes (PR #96)
- **NFR-151 / FR-626**: added early shortest-tier `minPx` reject, viewport culling, and a 64 px spatial hash grid to `resolveFrameLabels` (`apps/web/src/core/label-readable.ts`).
  - Synthetic 8,220-label benchmark: `214.57 ms` median before -> `< 16 ms` test green (~2–4 ms).
  - Real `spain-municipios-3` (7,995 draws, 1280x720): fit scale `1.90 ms` median (`2.94 ms` p95), zoomed 4.5x `3.63 ms` median (`7.23 ms` p95).
- **FR-627**: added `stepReadableLabels` and `upgradeTourDraws` (`label-readable.ts`, wired in `map-view.ts`) so round steps and reveal tours use each label's active tier at `camera.scale` (no mid-step blink-out) and crossfade smoothly when display forms change.
- **FR-620 / FR-626 tests**: added real `maps/spain-provinces` fit-scale zero-overlap test and a pipeline test across every map in `maps/` (`dev`, `spain-provinces`, `world-countries`).
- Retained `label-centred-place.ts` and `label-offland.ts` because existing spec 006/007 regression & digest tests (`label-place.test.ts`, `label-offland.test.ts`, `label-centred-place.test.ts`, `shaped-purity.test.ts`, `centred-purity.test.ts`, `tour-pins-debug.test.ts`) pin their behavior and digests.
- Branch: `feat/032-readable-labels`; State: fixes tested, typechecked, pushed.
- Next step: reviewer re-checks PR #96.
