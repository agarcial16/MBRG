# Spec 037 — Province-style faction labels at close zoom
Status: implemented (approved 2026-11-25, user: "ok")
Tier: Light SDD (UI, `apps/web` viewer labels). Depends on 007 (centred labels), 013 (`detailFactor`), 032 (readable labels). Ids: FR-707..FR-712, NFR-183..NFR-186 (highest in use: FR-706, NFR-182).

## Context and goal
In the current viewer, faction labels (`scale < 1.5`) and territory/province labels (`scale >= 2`, crossfading `1.5..2.0`) use different placement rules inside `centredInLand`:
- **Faction**: 10% area cap (`factionAreaShare = 1/10`), arc tangent limit `45°`, and widening stop height `offLandHeight.faction = 18` (which pushes labels away from a narrow centre of mass into a wider lobe).
- **Territory**: no area cap, arc tangent limit `75°`, and widening stop height `offLandHeight.territory = 3` (which keeps labels anchored to the region's centre of mass).

Hand testing on `maps/world-countries` exposed two visual problems:
1. **Single-territory discontinuity**: a country that is 1 territory = 1 faction changes abruptly in size, angle and position when zooming across `1.5..2.0`, even showing both overlapping during the fade.
2. **Off-centre multi-territory unions**: when a faction absorbs a neighbour (e.g. Serbia absorbing Hungary), the faction label is pushed horizontally into one lobe (Hungary) instead of sitting cleanly across the union's centre of mass using the cleanest shape for that union.

Goal: keep today's moderate faction label style at far zoom (`scale < 1`), and switch faction labels to the territory/province placement rules at close zoom (`scale >= 1`, scaled by `detailFactor` on small screens), so single-territory factions match their province labels seamlessly and multi-territory factions place one label cleanly on their union without forcing any specific orientation.

## Functional requirements
- **FR-707 (Dual faction label styles)**: For each alive faction's main region, THE SYSTEM SHALL compute two in-land tier layouts using existing pure layout rules:
  1. **Far style**: current faction rules (`role = 'faction'`, 10% area cap, `arcTangentLimit.faction`, `offLandHeight.faction`, `TIER_THRESHOLD.faction`).
  2. **Close style**: territory placement rules (`role = 'territory'`, no area cap, `arcTangentLimit.territory`, `offLandHeight.territory`, `TIER_THRESHOLD.territory`).
  Placement remains purely geometry-driven from the region's pieces; no orientation (horizontal, diagonal, vertical or arc) is forced.
- **FR-708 (Zoom threshold and transition)**: THE SYSTEM SHALL define `closeStart = 0.85` and `closeFull = 1.0`, both scaled by `detailFactor` alongside `fadeStart`/`fadeFull`:
  - At `scale <= closeStart`: faction labels render in **far style** only.
  - At `scale >= closeFull` (up to `fadeFull`): faction labels render in **close style** only.
  - Between `closeStart` and `closeFull`: THE SYSTEM SHALL crossfade smoothly from far style (`1 - t`) to close style (`t = smoothstep(closeStart, closeFull, scale)`), keeping same-role overlap resolution active without abrupt pops.
- **FR-709 (Single-territory identity)**: WHEN a faction's main region is a single piece identical to its territory's main piece and its display name equals the territory's name, its close-style tiers SHALL reuse that territory's precomputed tiers directly (O(1), bit-for-bit identical frame, height, angle, curvature and display text), so zooming from `closeFull` through `fadeStart..fadeFull` produces zero shift and no ghost double-label.
- **FR-710 (Multi-territory union placement)**: WHEN a faction owns multiple connected territories, its close-style label SHALL be a single label computed on the union's main region with the close (territory) placement rules, naturally picking the cleanest fitting shape near the union's centre of mass.
- **FR-711 (Round steps and reveal tours)**: DURING round-step animations and reveal tours, faction labels SHALL use the style matching the active camera scale (far below `closeFull`, close at/above `closeFull`, with smooth transitions), never exposing future rounds or unrevealed victim/absorber identities.
- **FR-712 (Readable-label invariants)**: All Spec 032 invariants remain intact for both styles across every map: in-land only (no off-land boxes or leader lines), `minPx = 9`, `maxViewportFraction = 0.25`, `minGapPx = 4` same-role overlap resolution, deterministic abbreviation tiers, and always-on hover/tap full-name readout.

## Non-functional requirements
- **NFR-183 (Purity and determinism)**: Dual-style faction layout, single-territory tier reuse, and zoom-band selection/blending are pure deterministic functions (no DOM, clock, or randomness) covered by unit tests.
- **NFR-184 (Performance)**: Round-change label computation stays within the 200 ms budget (single-territory factions reuse territory tiers in O(1); unchanged factions reuse previous tiers across rounds); pan/zoom stays within 16.7 ms median / 33.3 ms p95 on desktop.
- **NFR-185 (Visual verification)**: Before/after screenshots (desktop and mobile 390×844) of `maps/world-countries` around the Balkans and West Africa saved under `.claude/review/037/` with an inline before/after slider widget, plus a mobile fit and micro-country tap check.
- **NFR-186 (Scope and dependencies)**: Zero new runtime dependencies; code changes stay within `apps/web` (plus spec/docs updates).

## Edge cases
- **Small screens / mobile**: scaling `closeStart`/`closeFull` by `detailFactor` ensures the far→close transition always happens before `fadeStart` (`1.5 * detailFactor`), never after faction labels have already faded out.
- **Identical far and close tiers**: when a faction's far and close chosen tiers have identical text and geometry at a given scale, draw once at full faction opacity during `closeStart..closeFull` (avoiding alpha-compositing dip).
- **Single-territory faction during `fadeStart..fadeFull`**: when the active close faction tier and territory tier are identical, avoid alpha dip where practical or keep geometry bit-for-bit aligned so there is no ghosting.
- **Disconnected multi-territory faction**: close style places on the faction's main connected region (same rule as far style).
- **Reduced motion**: round steps and style transitions apply cleanly without extra timers.

## Out of scope
- Changes to `packages/shared`, `packages/sim`, `packages/protocol`, `apps/server`, `apps/bot`, `tools/build-map`, or map packages.
- Changing territory (province) label placement rules or `fadeStart`/`fadeFull` (`1.5..2.0`).
- Per-map or per-country manual label overrides.

## Done criteria
- Pure unit tests covering dual-style faction tiers, single-territory O(1) reuse and bit-for-bit identity with territory tiers, multi-territory union close placement, `detailFactor`-scaled `closeStart..closeFull` zoom transitions, overlap resolution, and round-step / tour compatibility.
- `npm run typecheck` and `npm test` green.
- Desktop and mobile (390×844) before/after screenshots under `.claude/review/037/`, inline before/after slider widget in chat, and mobile fit/tap report.
- PR into `main` with `Status: implemented`, `MEMORY.md` and `docs/board.md` updated, and spec archived to `specs/archive/037-faction-labels-zoom/`.
