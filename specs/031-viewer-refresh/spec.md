# Spec 031 — Viewer visual refresh & reveal camera composition
Status: approved (user's approved recipe of 2026-11-21).
Tier: Light SDD (presentation and reveal camera composition in `apps/web`). Outside the traceability ledger (like specs 012/013/026): no ledger FR/NFR ids are added and `packages/sim/test/traceability.test.ts` is untouched.

## Context and goal
Refresh the desktop match viewer (`apps/web`) by combining the three approved visual directions chosen from the 2026-11-21 exploration (`viewer-1-cartographic-polish.png`, `viewer-2-cinema-broadcast.png`, `viewer-3-annexation-drama.png`) while keeping game rules, wire contracts, routes, anti-spoiler guarantees, and the existing mobile layout intact.

## Approved changes

### 1. Base — Refined cartographic brass (Direction 1)
- **Contrast and surface tokens**: deepen the obsidian-wood panel ground (`--hud-panel`, `--hud-wood`, `--hud-umber`) and refine brass/parchment/muted text tokens so every text pair meets WCAG AA (>= 4.5:1; >= 3:1 for large text and outlines) on opaque and translucent surfaces.
- **Slim ~52 px desktop top bar**: compact 52 px height on desktop with a subtle brand wordmark, round label, phase badge pill, live indicator dot, horizontally and vertically centred countdown, and right-aligned player chip.
- **Territory-share bars**: every living faction row in the factions table renders a subtle background colour bar in the faction's own colour, proportional to its share of total territories (`territories / totalTerritories`). Chronicle entries render as clean recessed cards with a brass accent on the active pending round.
- **Floating victim pill**: on desktop, the announced round victim floats cleanly at upper-centre below the top bar with the victim's faction swatch (hidden while a victim reveal tour has not yet stopped — anti-spoiler preserved: text stays "revelando…" with no name or colour until revealed).

### 2. Bottom-corner minimap & bottom hub (Direction 2)
- **Docked bottom-corner minimap**: compact, headerless minimap docked in the bottom-right corner on desktop, preserving click/drag pan, wheel zoom, pinch zoom, and the viewport rectangle.
- **Removed "Carta general" panel**: drop the "Carta general" panel header/chrome from the minimap and remove the now-unused `STRINGS.hudMinimap` entry (keep `STRINGS.hudMinimapHint` for canvas accessibility).
- **Bottom hub (round scrubber)**: centre the bottom command/scrubber hub neatly between the left sidebar and the bottom-right minimap, with a connected horizontal rail behind the round dots, active/live dot styling, compact navigation buttons, and integrated prediction picks and seal.

### 3. Reveal duel callout & camera composition (Direction 3)
- **Reveal duel callout**: upgrade the live round-applied banner into a duel callout card showing a split victim/absorber top accent bar, round eyebrow (`Ronda N · Eliminación y absorción`), `victim → absorber` duel badges (victim struck through, absorber highlighted), and the absorption summary (`{absorber} absorbe +{count} territorios · controla el {share}% del mapa`). Dismissible by click/tap, Enter, Space, or Escape; never shown before the absorber tour ends.
- **Camera composition around the overlay (pure function + wiring)**:
  - Provide a pure function `composeRevealCamera` (given the annexation front's bounding box in map units, the callout's occlusion rectangle in CSS px, the available map area, viewport, and image size -> target `{ x, y, scale }` clamped to valid camera bounds) that frames the annexation front so it remains fully visible in the occlusion-free map region remaining under, beside, or above the callout — never hidden behind it.
  - Handle all border cases cleanly: front wider than the visible area (clamps at fit scale and maximises unoccluded visibility), callout on each side (top, bottom, left, right), front already centred (zero spurious drift when unoccluded; pans cleanly into free area when occluded), near-edge map clamping, and empty/full occlusion.
  - Wire into the live reveal flow: when a round reveals at the live edge and the user has not moved the camera, measure the visible duel callout and smoothly ease the camera to the composed target (instant under `prefers-reduced-motion`; cancelled immediately on user pan/zoom/minimap input); return to the default overview once the callout expires or is dismissed (unless the user moved the camera).

## Out of scope
- Mobile layout polish (Direction 4, deferred to a later pass).
- Map tiling, meshes, shaders, map faction palette, or label placement.
- Root route / start screen and its strings (owned by sibling spec 030; new strings live in a separate block at the end of `STRINGS`).
- Any change outside `apps/web` and `specs/031-viewer-refresh/` (`packages/*`, `apps/server`, `apps/bot`, `maps/dev`, spec 009 tour goldens untouched).

## Done criteria
- Pure unit tests written first (seen red, then green) covering `composeRevealCamera` (including all border cases above), territory-share calculation, duel callout view data, and token contrast.
- Existing HUD/shell scan tests updated only where this spec intentionally supersedes an earlier visual pin, with every changed pin listed in `PROGRESS.md`.
- Desktop before/after screenshots at a fixed seed and round (mid-match with both panels, and the reveal moment with the composed camera) saved under `.claude/review/031-viewer-refresh/`, posted as Markdown images, plus an inline before/after draggable slider widget.
- `npm test` and `npm run typecheck` green; protected paths byte-identical vs `main`.
