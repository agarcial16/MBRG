# Spec 032 — Readable map labels
Status: draft
Tier: Light SDD (viewer labels). Ids outside the traceability ledger: FR-620..FR-627, NFR-150..NFR-153.

## Context and goal
Today's label system (built across specs 005, 006 and 007) computes one in-land frame per faction (on its main region) and per land territory (on its main piece) in map units, trying horizontal, straight (up to 45°) and arc frames inside widening centre discs. Heights are uncapped for territories and bounded only by 10% of region area for factions; labels whose in-land height falls below `offLandHeight` (18 map units for factions, 3 for territories) are placed off-land as horizontal boxes up to 24 map units away (with a leader line past 6 map units). On screen, every label is drawn at `height * scale` CSS pixels whenever that reaches `minPx` (9 px), with no upper screen-pixel cap and no name shortening.

Playtesting on dense real maps exposed three visual failures:
1. **Crowded initial whole-map zoom**: on 52-province Spain (round 0–2), almost every one-territory faction falls below `offLandHeight`, pushing dozens of horizontal labels off-land over neighbouring provinces so they appear cramped, visually overlapping and hard to match to their land; labels only settle as factions absorb neighbours in later rounds.
2. **Oversized labels when zoomed in**: because drawn font size scales linearly with zoom without an upper bound, zooming to province or municipality level produces giant labels that dominate the viewport.
3. **Long names on tiny territories**: on municipality maps and small countries, long multi-word names cannot fit inside their polygon and spawn long leader lines that cross neighbouring labels.

Goal: make map labels legible, uncluttered and well-proportioned across all zoom levels and across every map — from whole-map overview to close-up — by bounding on-screen size, eliminating crowding/overlap at far zoom, and deterministically abbreviating names that do not fit while keeping full names accessible.

## Users
- **Spectator / player**: reads faction and territory names cleanly at overview zoom, mid-zoom and close-up without clutter or oversized text, and can inspect the full name of any shortened or hidden label.
- **Reviewer (the user)**: verifies legibility from fixed-scene before/after screenshots on desktop and mobile.

## User stories
- US-1. As a spectator, I want faction names at the initial whole-map zoom to be legible and free of overlap so that I can identify factions from round 0.
- US-2. As a spectator, I want labels to stay within comfortable screen-size bounds when I zoom in so that names remain readable without becoming gigantic.
- US-3. As a spectator, I want long names on small territories to shorten cleanly (e.g. `Val.` or acronyms) when they do not fit, while still letting me read the full name on demand.

## Definitions
- **Display form**: the string rendered on the map for a label — either its full name from presentation data or a shorter deterministic abbreviation derived from it.
- **Readable size**: an on-screen label height within `[minPx, maxPx]` CSS pixels.
- **Label role**: `faction` or `territory` (unchanged from spec 005).
- **Fit scale**: the initial overview scale where the whole map fits the visible area.

## Functional requirements
- FR-620: WHILE the map is rendered at any scale from the fit scale to the maximum scale outside a round transition, THE SYSTEM SHALL draw no two labels of the same role whose on-screen footprints overlap, and SHALL maintain a minimum clear visual gap between adjacent drawn labels of the same role, including at the initial whole-map zoom on dense maps.
- FR-621: THE SYSTEM SHALL bound the drawn on-screen height of every label (horizontal, straight, arc and off-land) to `[minPx, maxPx]` CSS pixels: labels whose height would fall below `minPx` SHALL NOT be drawn, and labels whose height would exceed `maxPx` SHALL be capped at `maxPx` while keeping their centre, reading angle and curvature centred within their region.
- FR-622: WHEN a label's full name does not fit inside its region at a readable size, THE SYSTEM SHALL derive a deterministic, ordered list of shorter display forms from the full name alone (with no per-map or per-name exceptions and no randomness), combining acronym forms for multi-word names and/or prefix truncation ending with `"."` (e.g. `Val.`), preserving diacritics and casing.
- FR-623: THE SYSTEM SHALL display the fullest candidate form from FR-622 that fits inside its region at a readable size; WHEN a faction expands in later rounds or the user zooms in so that a fuller form fits, THE SYSTEM SHALL display that fuller form (up to the full name).
- FR-624: IF even the shortest candidate form of FR-622 cannot fit inside a region at a readable size, THEN THE SYSTEM SHALL apply the dense-fallback policy decided in Open Question 2 without overlapping other drawn labels or cluttering the map with crossing leader lines.
- FR-625: WHILE any faction or territory label is abbreviated or hidden on the map, THE SYSTEM SHALL keep its full name reachable without leaving the match view (via map hover/tap readout for both factions and territories, in addition to the existing faction list and chronicle).
- FR-626: THE SYSTEM SHALL apply FR-620 to FR-625 uniformly across every map (predefined and imported, from small regional maps to world and municipality maps) using only the existing map package and presentation data.
- FR-627: WHILE a round-step transition or reveal tour is playing, THE SYSTEM SHALL keep label transitions smooth across display-form changes (interpolating or crossfading) and SHALL never expose future rounds or unrevealed victim/absorber identities via labels or hover/tap readouts.

## Non-functional requirements
- NFR-150 (Purity and determinism): Name shortening, display-form selection, size clamping and overlap resolution are pure deterministic functions (no DOM, clock or randomness) covered by unit tests.
- NFR-151 (Performance): Round-change label computation stays within the existing 200 ms budget, and pan/zoom stays within 16.7 ms median / 33.3 ms p95 frame time on desktop.
- NFR-152 (Visual verification): Before/after screenshots (desktop and mobile) at fixed seeds and rounds covering whole-map overview, mid-zoom and close-up on dense maps (including Spain and a small-territory map), reviewed and accepted by the user.
- NFR-153 (Dependencies and language): No new runtime dependencies; any new UI strings live in the Spanish strings module.

## Edge cases
- Very short names (1–4 characters, e.g. `Jaén`, `Lugo`, `León`): never lengthened by adding `"."`; only abbreviated if the shortened form is strictly shorter than the full name.
- Multi-word names with articles/prepositions (`Santa Cruz de Tenerife`, `Casas de San Galindo`, `La Rioja`, `Ciudad Real`, `Islas Baleares`): connector words (`de`, `del`, `la`, `las`, `los`, `el`, `y`, `of`, `the`, etc.) handled cleanly so acronyms and truncations remain recognizable.
- Hyphenated names (`Castilla-La Mancha`, `Friuli-Venecia Julia`) and diacritics (`Álava`, `Cádiz`, `Guipúzcoa`, `Masegoso de Tajuña`): split and truncated on grapheme/Unicode code-point boundaries without breaking accents.
- Duplicate abbreviations between two nearby regions (e.g. `Valderrebollo` and `Valdemoro` both yielding `Val.`): either disambiguated deterministically or allowed with full name on hover/tap (see Open Question 1).
- Round T (single remaining faction) and close zoom on large regions: capped cleanly by `maxPx` so the winner's name never overflows the screen.
- Reduced motion preference: round changes and display-form swaps apply immediately without animation.

## Out of scope
- Changes to the map package format, presentation schema, builder, simulator, server, Discord bot, or game rules.
- Per-map hand-authored abbreviations or manual label coordinates.
- Multi-line wrapped labels, letter-spacing (tracking), or custom label font/ink/halo restyling.
- Sea zone labels.

## Done criteria
- Pure unit tests (written first) covering deterministic abbreviation rules (short names, multi-word names, diacritics, hyphens), screen-size clamping (`minPx`..`maxPx`), overlap-free layout at fit scale, zoom/growth form expansion, and anti-spoiler safety of hover/tap readouts.
- `npm test` and `npm run typecheck` green; no changes outside `apps/web` and `specs/032-readable-labels/`.
- Desktop and mobile before/after screenshots saved under `.claude/review/032-readable-labels/` with an inline before/after slider widget, reviewed and accepted by the user.

## Open questions
- [NEEDS CLARIFICATION] **Q1 — Abbreviation style & priority**: When a name does not fit, what shortening ladder do you prefer?
  - (A) Multi-word names try acronym first (ignoring connectors like `de/la/del`, e.g. `Santa Cruz de Tenerife` → `SCT`, `Masegoso de Tajuña` → `MT`), then prefix + `.` (`Sant.` / `Val.`); single-word names use prefix + `.` (`Valderrebollo` → `Val.`).
  - (B) Always prefix truncation with `.` (e.g. `Santa C.` → `Sant.`, `Valderrebollo` → `Val.`), with acronyms only as a last resort.
  - (C) Dotted initials (`S.C.T.`, `M.T.`) vs plain uppercase acronyms (`SCT`, `MT`)? And if two neighbours collide on the same abbreviation (`Val.`), should we extend by 1–2 chars (`Vald.`) or accept duplicates since hover/tap shows the full name?
- [NEEDS CLARIFICATION] **Q2 — Fallback when even the shortest abbreviation does not fit at far zoom**: On dense maps at fit scale (52-province Spain, 193-country World, municipalities), when a region is too small for even its shortest form:
  - (A) Hide the label at far zoom and reveal it as you zoom in (or as the faction grows), keeping the full name reachable on hover/tap — no crowded off-land labels over neighbouring land.
  - (B) Allow off-land placement only over open water/background (islands, coastal micro-states), and hide crowded inland ones until zoom.
  - (C) Keep off-land placement everywhere (as today) with stricter collision avoidance and a shorter leader-line reach.
- [NEEDS CLARIFICATION] **Q3 — Upper size cap (`maxPx`) when zoomed in**: What feels right as the maximum on-screen font height?
  - (A) Moderate cartographic cap (~28–36 CSS px) so zoomed-in names stay crisp and never dominate the screen.
  - (B) Larger display cap (~44–56 CSS px) for faction names and a smaller cap (~24–32 CSS px) for territory names.
- [NEEDS CLARIFICATION] **Q4 — Full-name readout on the map**: Should hovering (desktop) / tapping (mobile) any region on the map show a small floating tooltip with the full faction name (and territory name when zoomed in), or only when the region's label is abbreviated/hidden?
- [NEEDS CLARIFICATION] **Q5 — Zoom-in expansion of abbreviated labels**: Confirm that an abbreviated label (e.g. `Val.`) should automatically expand to its full name (`Valderrebollo`) as the user zooms in (using precomputed tiers so panning/zooming stays smooth at 60 fps).
