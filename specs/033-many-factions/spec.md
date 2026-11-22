# Spec 033 — Many Factions in the Viewer
Status: draft
Tier: Light SDD (viewer `apps/web` and importer report `tools/build-map` only; **no map format, protocol, `packages/shared`, `packages/sim`, `apps/server`, or `apps/bot` change**). Depends on 004 (viewer rendering, capabilities, colour assignment), 005/009/013 (fronts, reveal tours, chosen-faction outline), 029 (viewer count refusal), and 028 (importer `viewerLimits` report, currently on `feat/028-map-importer`). Ids: FR-620 to FR-626, NFR-145 to NFR-149 (outside the `packages/sim` traceability ledger, as in specs 029–031).

## Context and goal
The imported historical map "world in 1815" (`world-1815-4`: 302 factions, 410 land territories, 14 sea zones, 424 total entries, 2048 × 2048) is refused by today's viewer: *"El mapa tiene 302 facciones y el visor puede dibujar como máximo 255."* In addition, even if the 255 count limit were lifted alone, the same map — and the already-merged `maps/world-countries` (193 factions, 7 sea zones) — fail colour assignment with `palette-exhausted` (at **Goa** in 1815 and **Dinamarca** in `world-countries`).

User decision (quoted): **"Subir el límite del visor"** — raise the viewer's capacity rather than merging factions in curation. This spec implements follow-up **V2 (many factions)** anticipated by specs 028 and 029.

### Real limits verified in the codebase today
1. **Map format & `ids.png` territory encoding (no limit bottleneck):** `ids.png` is an 8-bit RGB PNG (24 bits per pixel: `R × 65,536 + G × 256 + B`), supporting territory and faction ids `1..16,777,215` (`0xffffff`, `0` = outside). `packages/shared`, `packages/sim`, `packages/protocol`, `apps/server`, and `apps/bot` impose no 255-faction or 65,535-territory cap.
2. **Viewer territory-entry table:** dense 16-bit entry index (two bytes per pixel, `0` = outside, `1..65,535` = land + sea entries). Lookup tables are 1D strips (`entries + 1` texels wide), bounded by WebGL 2's `maxTextureSize` (guaranteed ≥ 2,048).
3. **Viewer faction encoding (current bottleneck #1):** per-entry owner table uses a single 8-bit channel (`0` = none, `1..255` = faction index), capping the viewer at **255 factions**. Pick-outline and reveal-tour inputs also guard against indices > 255 (even though shader uniforms are already 32-bit integers). The faction-colour table is `factions + 1` texels wide; because every faction owns at least one land territory, `factions + 1 ≤ entries + 1` always holds on valid maps.
4. **Viewer palette & neighbour rule (current bottleneck #2):** fixed 12-colour palette; step 2 forbids reusing a colour held by any direct candidate (land neighbours **plus** every faction touching a shared sea zone). Large ocean sea zones create huge cliques (`world-1815-4` sea zone 417 touches **77** factions; `maps/world-countries` sea zone 197 touches **54** factions), and colonial empires create non-planar land borders (max land degree 69 in 1815, chromatic number 5). Twelve fixed colours inevitably exhaust.
5. **Importer report (`viewerLimits`, Spec 028):** warns on `textureAbove2048`, `entriesAbove65535`, `factionsAbove255`, and `paletteExhaustedFaction` (using an importer-local copy of the 12-colour viewer rule).

### Why the new faction ceiling is 65,535
Every faction in a valid map owns at least one land territory, so `factions ≤ land territories ≤ entries ≤ 65,535`. Widening the owner table from 1 byte per entry (max 255) to **2 bytes per entry (max 65,535)** — matching the 16-bit encoding already used for the entry index — aligns the faction ceiling with the territory ceiling at minimal cost (850 B for 1815's 424 entries; 128 KB at the 65,535 extreme). Lower arbitrary caps such as 1,023 save zero texture bytes over 16-bit two-channel storage and would still reject Spec 028's 8,132-faction municipal stress proof and 9,999-faction importer cap.

### Goal
Enable the viewer to load, colour, draw, step, pick, and reveal any valid map up to **65,535 factions** (within device texture limits), keeping neighbouring factions visually distinguishable on large maps like `world-1815-4` and `maps/world-countries`, preserving existing small-map behaviour, keeping clear Spanish refusals for remaining limits, and aligning the importer's `viewerLimits` report.

## Users
- **Viewer user (spectator / player):** opens a match on a large world or historical map (hundreds to thousands of factions) and sees every faction rendered with clear borders and distinguishable neighbours instead of a count or palette refusal.
- **Map author / operator:** imports a 300+ faction map and gets accurate `viewerLimits` warnings reflecting what the viewer actually supports.

## User stories
- US-1. As a viewer user, I want maps with more than 255 factions (such as the 302-faction 1815 world map) to load and render cleanly without hitting a 255-faction or 12-colour palette refusal.
- US-2. As a viewer user, I want factions that touch across land borders (and, where possible, across shared sea zones) to have clearly distinguishable colours that stay fixed throughout the match.
- US-3. As a map author, I want the importer's `viewerLimits` report to reflect the raised faction ceiling and procedural palette so valid maps no longer emit stale warnings.

## Definitions
- **Land-adjacent neighbours:** two distinct factions that own 4-adjacent land territories with mutual neighbour links in the map.
- **Sea-adjacent candidates:** two distinct factions that are not land-adjacent but both own land territories mutually linked to the same sea zone (direct candidates at round 0 via sea, 002 FR-75/FR-76).
- **Direct candidates:** the union of land-adjacent neighbours and sea-adjacent candidates at round 0.
- **Base palette:** the existing 12 curated viewer colours in their fixed assignment order (004 FR-142).
- **Procedural palette:** a deterministic, seedless sequence of at least 65,535 pairwise distinct RGB colours extending the base palette.
- **Colour separation:** a deterministic distance metric in perceptual or weighted RGB space (exact formula and threshold pinned in implementation tests) ensuring two colours are visibly distinguishable rather than differing by a few RGB units.

## Functional requirements
- FR-620: THE SYSTEM SHALL support loading, drawing, round stepping, colour-front animation, reveal-tour dimming, and chosen-faction outlining for valid maps with up to **65,535** distinct factions (indices `1..65,535`, with `0` reserved for no owner), without changing the map package format or any non-viewer package.
- FR-621: WHILE assigning colours to factions (in faction order, using only the map and presentation data), THE SYSTEM SHALL use each faction's preferred colour from presentation data verbatim when given, and for factions without a preferred colour SHALL first try the 12 base palette colours in their fixed order: (1) the first base colour used by no already-coloured faction and equal to no preferred colour of the map; else (2) the first base colour used by no already-coloured or preferred direct candidate at round 0. As a result, every map that already loads without palette exhaustion (`maps/dev`, `maps/spain-provinces`, and any map of at most 12 factions) SHALL receive byte-identical colours.
- FR-622: WHEN no colour from the 12 base palette colours satisfies FR-621 for a faction, THE SYSTEM SHALL deterministically select a colour from the procedural palette of at least **65,535** pairwise distinct RGB colours; every generated colour SHALL be independent of seed, round, time, and camera, pairwise distinct from every other procedural colour and from all 12 base colours, distinct from the sea colour, background colour, and every border class colour, never near-black (RGB channel sum > 120, preserving 004 FR-143), and never near-white (keeping white labels and the white selection outline legible).
- FR-623: WHILE assigning procedural colours under FR-622, THE SYSTEM SHALL enforce neighbour distinguishability in priority order: (a) choose the first procedural colour that is unused by any already-coloured or preferred direct candidate AND has at least the minimum colour separation from every already-coloured or preferred land-adjacent neighbour; (b) IF no colour in the primary cartographic gamut satisfies (a), relax exact sea-adjacent distinctness first while preserving minimum colour separation from all land-adjacent neighbours; (c) IF a pathological graph still exhausts the separated band, pick the first procedural colour unused by any land-adjacent neighbour. Two land-adjacent factions SHALL NEVER receive the same colour (unless forced by identical preferred colours, which package validation forbids), and every valid map up to 65,535 factions (including `maps/world-countries` and `world-1815-4`) SHALL be coloured without failure.
- FR-624: THE SYSTEM SHALL keep refusing unloadable packages before drawing, with Spanish messages from the UI strings module in strict order: (1) package, map, presentation, and id-image validation errors (004 FR-133); (2) viewer count limits read dynamically from the drawing table sizes — territories above 65,535 named before factions above 65,535 (029 FR-586 to FR-589); (3) browser graphics capability limits — missing WebGL 2, or `maxTextureSize < max(width, height, entries + 1, factions + 1)` (004 FR-135); and (4) defensive `palette-exhausted` refusal only if a caller explicitly supplies a finite custom palette without procedural extension.
- FR-625: WHEN the displayed round changes, THE SYSTEM SHALL update only per-entry owner data (at most 2 bytes per entry plus the outside slot, never pixel data), keeping borders, colour fronts, reveal dimming, and chosen-faction outlines exact for every faction index in `1..65,535` (including indices ≥ 256, where both bytes are non-zero).
- FR-626: WHEN the map importer (Spec 028) formats its `viewerLimits` report section, THE SYSTEM SHALL update the faction-count warning threshold from 255 to 65,535 (no faction-count warning for 256..65,535 factions), SHALL align its palette-exhaustion check with FR-621 to FR-623 so maps coloured by the procedural palette emit no `paletteExhaustedFaction` warning, and SHALL keep reporting `requiredTextureSize`, `textureAbove2048`, and `entriesAbove65535` unchanged.

## Non-functional requirements
- NFR-145 (Performance bounds):
  - Pure colour assignment (including neighbour-graph construction) SHALL complete in at most **50 ms** for a 500-faction map (including `world-1815-4`: 302 factions, 424 entries) and at most **250 ms** for a 10,000-faction synthetic map in Node (no O(F²) scan over total factions).
  - In the browser on the reference machine (Windows 11, Chrome/Edge, 1920 × 1080): `maps/dev` keeps all 004 NFR-24 / 009 NFR-43 budgets; on `world-1815-4` (2048 × 2048, 424 entries, 302 factions), median frame time ≤ **16.7 ms**, 95th percentile ≤ **33.3 ms**, round change ≤ **200 ms**, and time to first frame measured and recorded in the PR (target ≤ **3,000 ms**, split between table/colour setup and initial label layout).
- NFR-146 (Purity and determinism): colour assignment, procedural palette generation, owner-table encoding, and count/capability checks are pure, deterministic functions with no DOM, WebGL, clock, I/O, or system randomness, verified by Node tests and the existing purity scan.
- NFR-147 (Scope and compatibility): changes live only in `apps/web` and (once Spec 028 merges) `tools/build-map`. Zero changes to `packages/shared`, `packages/sim`, `packages/protocol`, `apps/server`, `apps/bot`, the map format, `MatchState`, `maps/dev`, or existing goldens. No new third-party dependencies.
- NFR-148 (Language): code, comments, error kinds, and report labels stay in English; all viewer user-visible messages stay in Spanish in the single UI strings module, with every string key used by code.
- NFR-149 (Visual verification): before merge, desktop and mobile screenshots of the viewer rendering `world-1815-4` (round 0 overview, zoomed land-border clusters around Goa/India and Central Europe, and a post-absorption round step), `maps/world-countries` (previously failing at Dinamarca), and a `maps/dev` regression view are saved under `.claude/review/033-many-factions/` (gitignored), posted as Markdown images, and accompanied by a desktop and mobile before/after comparison widget.

## Edge cases
- **Faction index 255, 256, and 65,535:** exact encoding/decoding across the 8-bit/16-bit boundary (`255`, `256`, `257`, `65,535`) in owner tables, border classification, colour fronts, reveal-tour lighting (`lit`), and chosen-faction pick outline (`pick`).
- **Count boundary (`65,535` vs `65,536`):** a synthetic map with 65,535 territories and 65,535 factions passes `checkCounts`; 65,536 territories is refused with `too-many-territories` (and because valid maps satisfy `factions ≤ entries`, any valid map exceeding 65,535 factions also exceeds 65,535 entries and names territories first per 029 FR-588, while `checkCounts` still checks factions dynamically against the table size per FR-589).
- **Large sea-zone clique (`world-1815-4` sea zone 417 with 77 factions; `maps/world-countries` sea zone 197 with 54 factions):** all factions around the sea zone receive distinct colours without exhaustion; Goa and Dinamarca load cleanly.
- **High-degree land hub (`world-1815-4` with land degree 69, or a synthetic star graph of 300 land neighbours):** every spoke receives a colour distinct from the hub and separated in colour from it; no crash or exhaustion.
- **Preferred colour colliding with a procedural colour:** the procedural picker skips any colour equal to a preferred colour of a direct candidate (and keeps land-border separation from land neighbours' preferred colours), while the preferred colour itself is used verbatim.
- **Device `maxTextureSize` smaller than `entries + 1` (e.g. a 3,000-entry / 3,000-faction map on a 2,048-max GPU):** passes `checkCounts` (≤ 65,535), then cleanly refused by `checkCapabilities` (`texture-too-small`) naming the required size.
- **Round changes and later-round absorptions:** faction colours never change between rounds; faction indices ≥ 256 absorb and are absorbed with borders becoming territory lines identically to indices ≤ 255.

## Out of scope
- Raising the 65,535 territory-entry ceiling or packing lookup textures / tiling the id image for devices whose `maxTextureSize` is smaller than the map or table width (follow-up V3).
- HUD/UI redesign for browsing or searching thousands of factions in the sidebar, leaderboard, or Discord embeds (separate UX work if needed).
- Label layout performance overhaul at thousands of factions (existing incremental per-step layout stays untouched; load timing on `world-1815-4` is measured and recorded).
- Any change to `packages/shared`, `packages/sim`, `packages/protocol`, `apps/server`, `apps/bot`, map validation, or the map package format.

## Done criteria
1. `npm run typecheck` and `npm test` green, with unit tests written first for every FR/NFR: 16-bit owner table & boundary indices (`255`, `256`, `65,535`) across borders, fronts, tours, and pick outline; procedural palette determinism, uniqueness (≥ 65,535), gamut/contrast rules, and land/sea distinguishability; backward-identical colours on `maps/dev` and `maps/spain-provinces`; refusal order and boundaries; and Node perf bounds (500 and 10,000 factions).
2. `world-1815-4` (302 factions, 424 entries) and `maps/world-countries` (193 factions) both load, colour, step, and render cleanly in the viewer with zero `too-many-factions` or `palette-exhausted` errors.
3. Browser measurements (first frame, median/p95 frame time, round change) recorded in the PR for `world-1815-4` and `maps/dev`.
4. Reviewed desktop + mobile screenshots and before/after comparison widget posted in the thread (captures under `.claude/review/033-many-factions/`, not committed).
5. `viewerLimits` update (FR-626) applied to `tools/build-map` when Spec 028 is on `main` (see OQ3).

## Open questions
- [NEEDS CLARIFICATION] **OQ1 — Procedural palette trigger (preserve FR-141 step-2 reuse vs. earlier unique colours):**
  - **A (recommended):** Keep FR-141 steps 1–2 unchanged — reuse the 12 curated colours when no direct candidate uses them, spilling into procedural colours only when all 12 are blocked. Keeps `maps/dev`, `maps/spain-provinces`, and existing FR-141 step-2 tests byte-identical while unblocking `maps/world-countries` and `world-1815-4`.
  - **B:** Assign unique procedural colours to more factions (e.g. first 48–64) before reusing, reducing late-match fill coincidences after absorptions at the cost of changing `maps/spain-provinces` colours and updating FR-141 step-2 tests.
- [NEEDS CLARIFICATION] **OQ2 — `palette-exhausted` refusal path:**
  - **A (recommended):** Keep `palette-exhausted` as a defensive refusal only when a caller injects a finite custom palette without procedural extension (never triggered by the viewer's default palette for any valid map ≤ 65,535 factions), preserving 004/029 string and error-kind contracts.
  - **B:** Retire `palette-exhausted` and remove `STRINGS.paletteExhausted` completely, since no valid map ≤ 65,535 factions can exhaust the procedural palette.
- [NEEDS CLARIFICATION] **OQ3 — Importer `viewerLimits` timing (`feat/028-map-importer` is not yet on `main`):**
  - **A (recommended):** Implement the `apps/web` changes of Spec 033 on `main` now, and apply FR-626 (`factionsAbove255` → 65,535 and procedural palette alignment in `tools/build-map`) when Spec 028 merges to `main` (or right after).
  - **B:** Wait for `feat/028-map-importer` to merge into `main` first so Spec 033 updates both `apps/web` and `tools/build-map` in a single PR.
