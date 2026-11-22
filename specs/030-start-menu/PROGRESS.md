# Progress — Spec 030 (Start menu landing)

## Step 1 — Spec & baseline capture
- Branch: `feat/030-start-menu` (branched from `main` at `b69b6f3`).
- Wrote approved one-page Light SDD spec (`specs/030-start-menu/spec.md`, IDs FR-610..FR-616, NFR-140..NFR-142).
- Ran `npm install` in fresh worktree; captured baseline (before) screenshots of `/` at 1280x720 and 390x844 under `.claude/review/030-start-menu/`.

## Step 2 — Landing implementation, static atlas plates & verification
- Branch: `feat/030-start-menu`.
- Audited WIP commit `39d954d` against spec 030 and mockup `landing-c-dynamic-maps.png`:
  - Kept: `chooseScene` root routing (`apps/web/src/core/live-address.ts`), spectator link preservation in `matchAddress` (`apps/web/src/core/start-screen.ts`), `landing-atlas.ts` catalog & deterministic map-interleaving rotation, Spanish spec-030 strings block in `strings.ts`, inline SVG Logo 1 crown/map architecture, dark/gilt `--hud-*` landing stylesheet, expandable create drawer, and unit/scan tests.
  - Added/fixed:
    1. Generated and committed the four deterministic static mid-round WebP atlas plates for `maps/dev` (`apps/web/public/atlas/dev-s42-r2.webp`, `dev-s7-r2.webp`, `dev-s19-r3.webp`, `dev-s101-r1.webp`, ~32–36 KB each) rendered from `@mbrg/sim` + `renderReference` in dark atmospheric cartographic tones with largest-component interior faction labels.
    2. Added `safeLocalStorage()` guard in `apps/web/src/ui/live-start.ts` so throwing `window.localStorage` getters (strict private browsing / sandbox) cleanly fall back to visit index 0 without throwing.
    3. Refined Logo 1 bottom-right island polygon and stroke width (`1.4`), widened desktop console to `590px` with `17px` pitch so the Spanish pitch line sits cleanly on one line without an orphan word, tightened mobile kicker letter-spacing + `min-width: 0` on phone controls so 390x844 has zero horizontal overflow (`scrollWidth === 390`), and adjusted atlas framing (`54% 48%`).
    4. Added RIFF/WEBP byte and size verification for every `ATLAS_PLATES` asset in `apps/web/test/landing.test.ts`.
- Verification: `npm run typecheck` and `npm test` (full suite) run and green; desktop (1280x720) and mobile (390x844) before/after screenshots verified with zero horizontal overflow.
- Untested: real physical phone touch feel and live server match-creation roundtrip from the drawer (existing `mountCreate` shell unchanged).
- State: ready for reviewer pass and PR merge into `main`.
- Next step: reviewer inspects PR and visual before/after slider, then squash-merge into `main`.

## Step 3 — Final verification, visual captures & PR
- Branch: `feat/030-start-menu`.
- Verified `npm run typecheck`, `npm run build` (all 4 WebP atlas plates present in `apps/web/dist/atlas/`), and Vite dev server serving `/` (landing) and `/atlas/*.webp` (`200 OK`, `RIFF/WEBP`).
- Full test suite (`vitest run`, 132 files / 2111 tests): 127 files passed (1 skipped) on initial run; 4 untouched label/panel test files (`label-axis`, `label-input`, `label-steps`, `panel-text`) hit 5 s timeouts under parallel CPU load and passed 78/78 in 5.16 s when rerun without contention (`landing.test.ts` 12/12 passed).
- Captured fresh desktop (1280x720) and mobile (390x844) before (`/?seed=1`, `main` root) and after (`/`, landing) screenshots under `.claude/review/030-start-menu/` with verified zero horizontal overflow (`scrollWidth === innerWidth`), and rendered the interactive before/after slider widget.
- Untested: real physical phone touch feel and live server match-creation roundtrip from the drawer.
- State: PR opened into `main`; awaiting reviewer pass and CI.
- Next step: reviewer inspects PR and visual before/after captures, then squash-merge into `main`.

## Step 4 — Brand update to FactionFall
- Branch: `feat/030-start-menu`.
- Updated the landing brand strings (`landingBrand: 'FactionFall'`, `landingSubtitle: 'MAP BATTLE ROYALE'`), refined `.landing-title` tracking (`0.085em` desktop, `clamp(24px, 7.6vw, 34px)` + `0.06em` on phone) so the 11-character wordmark fits cleanly without overflow, and synced `apps/web/test/landing.test.ts` and `specs/030-start-menu/spec.md`.
- Verification: `npm run typecheck` and `npm test` run and green.
- Untested: real physical phone touch feel.
- State: pushed to PR #92 (`feat/030-start-menu`); ready for review and merge into `main`.
- Next step: review and squash-merge PR #92 into `main`.
