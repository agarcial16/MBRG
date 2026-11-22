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
