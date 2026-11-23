# PROGRESS — spec 034 (windowed round timeline and jump-to-round)

## Step 1 — Merge `origin/main` (#99) and capture BEFORE screenshots
- Merged `origin/main` (`6724626`, PR #99 HUD layout polish) into `feat/034-round-timeline` (`ac292ec`).
- Installed workspace dependencies (`npm install`).
- Captured BEFORE screenshots under `.claude/review/034/` (gitignored): `before-long-desk.png`, `before-long-phone.png` (51 rounds), `before-short-desk.png`, `before-short-phone.png` (5 applied rounds, round 3 displayed, round 6 in play). Confirmed desktop horizontal overflow of `.hud-command` and phone clipping of "Inicio" and round 51.
- Marked `specs/034-round-timeline/spec.md` as `Status: approved`.
- Branch: `feat/034-round-timeline` · State: ready for tests-first (red) · Next: add unit + shell tests for FR-660..FR-666 / NFR-170..NFR-172.

## Step 2 — Tests first (red) and pure/shell implementation (green)
- Added unit tests in `apps/web/test/live-track.test.ts` covering `windowCapacity`, `roundWindow`, `shiftWindow`, `windowPageStep`, `swipeShift`, and `parseJumpRound` across 0, 1, 10, 52, and 250 rounds (FR-660..FR-666, NFR-170), and updated `apps/web/test/live-hud-shell.test.ts` (superseding the old `stripScroll` / `overflow-x: auto` pin with spec 034's dynamic sliding window, pinned Inicio, pager arrows, wheel/swipe shift, click-to-jump label, and no-overflow rules). Verified 7/7 new/updated tests failed red before implementation.
- Implemented pure windowing and jump validation in `apps/web/src/core/live-track.ts` (`TRACK_METRICS`, `windowCapacity`, `windowPageStep`, `shiftWindow`, `swipeShift`, `roundWindow`, `parseJumpRound`; strictly bounded to `[0, applied]`, zero total-round leakage).
- Added spec 034 Spanish strings block in `apps/web/src/core/strings.ts` (`hudTrackWindowPrev`, `hudTrackWindowNext`, `hudTrackWindowPrevShort`, `hudTrackWindowNextShort`, `hudJumpTrigger`, `hudJumpInput`, `hudJumpInvalid`).
- Wired dynamic sliding window, pinned "Inicio" chip, flanking window-pager arrows, mouse wheel + horizontal touch swipe shifting, and click-to-jump `Ronda N` inline numeric input (`Enter` submits, `Escape`/blur cancels, Spanish validation error) in `apps/web/src/ui/live-panel.ts`, and fixed command-panel horizontal overflow (`overflow-x: hidden`, `min-width: 0`) in `apps/web/src/ui/live-panel-style.ts`.
- Targeted suites (`live-track`, `live-hud-shell`, `play-shell`, `strings-language`, `live-view-tour`, `anti-spoiler`): 6/6 files, 159/159 tests green; `npm run typecheck` green.

## Step 3 — Visual verification & polish
- Captured AFTER screenshots under `.claude/review/034/`: `after-long-desk.png`, `after-long-phone.png`, `after-short-desk.png`, `after-short-phone.png`.
- Visual polish pass: tightened desktop `.hud-track` gap to `4px`, matched `TRACK_METRICS.desk` to `26px` slot / `4px` gap, and widened `.hud-command` `max-width` to `740px` (still clear of left column and bottom-right minimap) so desktop shows 9 numbered rounds (`43..51`) alongside pinned "Inicio" with zero horizontal scroll or clipped text.
- Verified phone 390×844 renders pinned "Inicio", pager arrows, 4 numbered rounds (`48..51`), and all 5 nav buttons cleanly inside 390 px with zero horizontal overflow.
- Branch: `feat/034-round-timeline` · State: implementation and visual captures complete · Next: full `npm test` + `npm run typecheck`, commit+push, mark PR #100 ready, verify CI.

## Step 4 — Verification, commit, push, and PR ready
- `npm run typecheck`: green (0 errors).
- `npm test`: 420/431 active files passed on initial parallel run (6,271 passed, 6 skipped); 9/11 parallel CPU-timeout untouched files passed on `--maxWorkers=2` rerun (only untouched `service-twins.test.ts` and `tour-shade.test.ts` timed out under local CPU load; verifying alone + CI).
- Posted desktop and phone before/after screenshots under `.claude/review/034/` and interactive before/after slider widget (0 console errors).
- Diff restricted to `apps/web` (round track / command panel + tests) and `specs/034-round-timeline/`; zero protected paths touched.
- Handover:
  - Branch: `feat/034-round-timeline`
  - State: implemented, tested, pushed, PR #100 marked ready for review.
  - Next step: Light-SDD review and squash merge into `main`.

## Step 5 — Reviewer fixes on PR #100
- Phone `jumpError` overlay (FR-664): made `.hud[data-layout="phone"] .hud-strip` `position: relative` and positioned `.hud[data-layout="phone"] .hud-jump-error` as an overlay (`position: absolute; bottom: calc(100% + 4px)`) so validation errors float above the strip without changing its 92 px height or pushing `.hud-nav` off-screen.
- Phone window-pager arrows: raised `.hud[data-layout="phone"] .hud-track-pager` `min-width` from `30px` to `${PHONE.chip}px` (`36px`) to match sibling controls.
- Removed dead `stripScroll` and unused `RoundTrack.label` from `apps/web/src/core/live-track.ts` and their obsolete tests from `apps/web/test/live-track.test.ts`; added phone error overlay + pager width pins in `apps/web/test/live-hud-shell.test.ts` (seen red, then green).
- Captured `.claude/review/034/after-phone-jump-error.png` verifying unclipped nav row and floating error banner; `npm run typecheck` + 6 affected web test suites (157/157 tests) green.
- Handover:
  - Branch: `feat/034-round-timeline`
  - State: review fixes implemented, tested, pushed to PR #100.
  - Next step: reviewer re-check and squash merge into `main`.

## Step 6 — Hand-test feedback on jump-to-round box (digits-only + clamp)
- Amended `specs/034-round-timeline/spec.md` (`FR-663 (amended after hand test)` and edge cases): jump input accepts digits only (`inputmode="numeric"`, blocks/strips non-digits as typed and on paste), clamps submitted values to `[0, applied]` (`<= 0` jumps to Inicio `0`, `> applied` jumps to `applied`), and closes without jumping or showing an error on empty input.
- Tests first (seen red, then green): updated `apps/web/test/live-track.test.ts` (`sanitizeJumpInput`, clamping `parseJumpRound` to `[0, applied]`, `{ outcome: 'close' }` on empty input) and `apps/web/test/live-hud-shell.test.ts` (`sanitizeJumpInput`, `input` + `paste` listeners, no `.hud-jump-error` / `hudJumpInvalid`).
- Implemented `sanitizeJumpInput` and clamping `parseJumpRound` in `apps/web/src/core/live-track.ts`, wired digits-only `keydown`/`paste`/`input` handlers and removed `jumpError` in `apps/web/src/ui/live-panel.ts` and `apps/web/src/ui/live-panel-style.ts`, and removed unused `STRINGS.hudJumpInvalid` from `apps/web/src/core/strings.ts`.
- Captured desktop (1280×720) and mobile (390×844) screenshots of the jump box under `.claude/review/034-jump/` (`jump-desk.png`, `jump-phone.png`).
- Handover:
  - Branch: `feat/034-round-timeline`
  - State: hand-test jump box changes implemented, tested, pushed to PR #100.
  - Next step: review and squash merge PR #100 into `main`.
