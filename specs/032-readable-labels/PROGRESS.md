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
