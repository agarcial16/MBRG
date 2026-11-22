# PROGRESS — spec 031 (viewer visual refresh & reveal camera composition)

## Step 1 — Setup & one-page spec
- Branch `feat/031-viewer-refresh` created from `main` (`b69b6f3`), `npm install` completed cleanly (Node v24.0.0), baseline `npm run typecheck` green.
- Confirmed "Carta general" in today's UI is `STRINGS.hudMinimap` (`'Carta general'`), rendered as the `.hud-title` header inside `.hud-mini`.
- Written `specs/031-viewer-refresh/spec.md` (`Status: approved`, outside the traceability ledger).

## Step 2 — Before captures & tests first (red)
- Captured desktop 1280x800 BEFORE screenshots at fixed seed=7, round 2 applied -> Round 3 phase-2 (`before-midmatch.png`) and Round 3 reveal (`before-reveal.png`) under `.claude/review/031-viewer-refresh/` (gitignored).
- Added and updated tests first (verified red: 5 failed files, 6 failed tests across the new/changed pins):
  - New `apps/web/test/reveal-camera.test.ts`: pins `freeRects`, `frontBoxOf`, and `composeRevealCamera` border cases — callout on top/bottom/left/right, front wider than visible area (fitScale clamp + maximal unoccluded visibility), front already centred (zero drift without occlusion, clean dodge with top-centre or dead-centre callout), aspect-driven beside vs below choice, near-edge map clamping, sidebar-cropped available rect, tiny-front scale ceiling, and full-screen occlusion fallback.
  - Updated `apps/web/test/live-stats.test.ts`: added `totalTerritories` and `territoryShare` unit tests.
  - Updated `apps/web/test/round-banner.test.ts`: pinned structured `BannerView.duel` (eyebrow, victim/absorber ids and names, taken count, map-control percentage when round owners are held, fallback detail text).
  - Updated `apps/web/test/live-hud-shell.test.ts`: replaced `STRINGS.hudMinimap` assertion (dropped with the "Carta general" header) with absence check + kept `STRINGS.hudMinimapHint`; added spec 031 checks (52 px top bar, territory-share bars, floating pill, scrubber rail, duel callout, no `.hud-mini .hud-title`).
  - Updated `apps/web/test/round-shell.test.ts`: updated FR-408 banner pin (Direction 3 duel callout floats without a full-screen 45% black dim blocking the annexation front) and added wiring scan for `composeRevealCamera`, `frontBox`, and `revealCamera`.
  - Updated `apps/web/test/play-shell.test.ts`: updated desktop `.hud-banner` positioning pin from `padding-top: max(150px, 22vh)` to Direction 3 upper-left placement (`padding: 66px 16px 16px 312px`).

## Step 3 — Implementation & visual verification
- Pure modules:
  - New `apps/web/src/core/reveal-camera.ts`: `composeRevealCamera`, `freeRects`, `frontBoxOf`, `REVEAL_EASE_MS`.
  - `apps/web/src/core/live-stats.ts`: added `totalTerritories` and `territoryShare`.
  - `apps/web/src/core/round-banner.ts`: added `BannerDuel` (`duel` on `BannerView`) with absorber map-control percentage from held round owners.
  - `apps/web/src/core/hud-tokens.ts` & `apps/web/src/core/table.ts`: refined cartographic brass obsidian palette (higher contrast, added `pillBg`/`pillEdge`/`allyBg`/`allyEdge` tokens with WCAG AA pairs in `PAIRS`; panel opacity `0.90`, blur `8 px`).
  - `apps/web/src/core/strings.ts`: removed unused `hudMinimap` ("Carta general"); added clearly separated spec 031 block at end of `STRINGS` (`hudBrand`, `bannerDuelEyebrow`, `bannerDuelArrow`, `bannerDuelDetail`). Start screen / root route and its strings untouched.
- UI & camera wiring:
  - `apps/web/src/ui/map-view.ts`: added `frontBox()` and `revealCamera(target, durationMs)` smooth ease (instant under reduced motion, cancelled immediately by `userCamera` / resize).
  - `apps/web/src/ui/live-panel.ts` & `apps/web/src/ui/live-panel-style.ts`: slim 52 px desktop top bar with brand wordmark, phase pill, live dot; floating victim pill (reusing single `write(victim, view.victim)` with swatch hidden while `revealing`); recessed chronicle cards; proportional territory-share bars behind living faction rows; headerless bottom-corner minimap (204 px); centred Direction 2 bottom hub with connected horizontal scrubber rail stopping cleanly at the last dot; Direction 3 reveal duel callout with split victim/absorber top accent bar and `victim -> absorber` badges; exposed `calloutRect()` and `mapAreaRect()`.
  - `apps/web/src/ui/live-main.ts`: passed `targetColor` (never while `revealing`), composed reveal camera via `composeRevealCamera` around live `calloutRect()` and `mapAreaRect()`, deferred overview return while callout is visible and returned via `settleCamera()` when dismissed/expired.
- Visual review:
  - Captured desktop 1280x800 AFTER screenshots (`after-midmatch.png`, `after-reveal.png`) at identical seed=7 / Round 3.
  - Visual polish pass after inspecting initial after captures: constrained `.hud-track` (`flex: 0 1 auto`) so the horizontal scrubber rail terminates cleanly at the last round dot instead of trailing across empty space, and added `box-sizing: border-box; max-width: 680px` on `.hud-command` so the bottom hub floats symmetrically centred between the left panel and bottom-right minimap.
  - Built and previewed inline draggable before/after slider widget (`before-after.html`, 0 console errors).
- Tests run: all 12 targeted web suites green (212/212 tests); `npm run typecheck` green; full `npm test` running.

## Step 4 — Final verification, captures & PR
- Verified `npm run typecheck` green (0 errors) and full `npm test` green: 421/427 active files passed on the initial parallel run (6,198 passed), and all 6 untouched files that hit parallel CPU timeouts (`label-centred-place`, `scene`, `tour-camera`, `tour-shade`, `http-history`, `service-restart`) passed 6/6 (114/114 tests) when rerun with `--maxWorkers=2`.
- Verified protected paths (`packages/*`, `apps/server/*`, `apps/bot/*`, `maps/dev/*`, spec 009 tour goldens) and root route / start menu (spec 030) are byte-identical vs `main`.
- Captured deterministic before (`main`) and after (`feat/031-viewer-refresh`) screenshots at seed 7, Round 3 under `.claude/review/031-viewer-refresh/` (gitignored): desktop 1280×800 mid-match (Phase 2), desktop 1280×800 reveal (duel callout + `composeRevealCamera` framing), and mobile 390×844 mid-match; rendered interactive before/after draggable slider widget (desktop + mobile, 0 console errors).
- Handover:
  - Branch: `feat/031-viewer-refresh`
  - State: implemented, verified, and PR opened into `main`.
  - Next step: Light-SDD review and squash merge into `main`.
