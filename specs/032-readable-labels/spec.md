# Spec 032 — Readable map labels
Status: approved
Tier: Light SDD (viewer labels). Ids outside the traceability ledger: FR-620..FR-627, NFR-150..NFR-153.

## Context and goal
Today's label system (built across specs 005, 006 and 007) computes one in-land frame per faction (on its main region) and per land territory (on its main piece) in map units, trying horizontal, straight (up to 45°) and arc frames inside widening centre discs. Heights are uncapped for territories and bounded only by 10% of region area for factions; labels whose in-land height falls below `offLandHeight` (18 map units for factions, 3 for territories) are placed off-land as horizontal boxes up to 24 map units away (with a leader line past 6 map units). On screen, every label is drawn at `height * scale` CSS pixels whenever that reaches `minPx` (9 px), with no upper screen-pixel cap and no name shortening.

Playtesting on dense real maps exposed three visual failures:
1. **Crowded initial whole-map zoom**: on 52-province Spain (round 0–2), almost every one-territory faction falls below `offLandHeight`, pushing dozens of horizontal labels off-land over neighbouring provinces so they appear cramped, visually overlapping and hard to match to their land; labels only settle as factions absorb neighbours in later rounds.
2. **Oversized labels when zoomed in**: because drawn font size scales linearly with zoom without an upper bound, zooming to province or municipality level produces giant labels that dominate the viewport.
3. **Long names on tiny territories**: on municipality maps and small countries, long multi-word names cannot fit inside their polygon and spawn long leader lines that cross neighbouring labels.

Goal: make map labels legible, uncluttered and well-proportioned across all zoom levels and across every map — from whole-map overview to close-up — by bounding on-screen size per role, removing off-land/leader-line clutter in favour of hiding unreadable labels until zoom or growth, deterministically abbreviating names that do not fit, and showing full faction and territory names on hover/tap.

## Users
- **Spectator / player**: reads faction and territory names cleanly at overview zoom, mid-zoom and close-up without clutter or oversized text, and inspects the full faction and territory name on any region via hover or tap.
- **Reviewer (the user)**: verifies legibility from fixed-scene before/after screenshots on desktop and mobile.

## User stories
- US-1. As a spectator, I want faction names at the initial whole-map zoom to be legible and free of overlap so that I can identify factions from round 0.
- US-2. As a spectator, I want labels to stay within comfortable screen-size bounds when I zoom in so that names remain readable without becoming gigantic.
- US-3. As a spectator, I want long names on small territories to shorten cleanly (prefix with `"."` first, then plain acronyms if needed) when they do not fit, expand back to full names as I zoom in, and always show the full faction and territory name on hover/tap.

## Definitions
- **Display form**: the string rendered on the map for a label — either its full name from presentation data or a shorter deterministic abbreviation derived from it.
- **Readable size**: an on-screen label height within `[minPx, maxPx]` CSS pixels for its role (`minPx` = 9 px; `maxPx` = 48 px for faction labels, 28 px for territory labels).
- **Label role**: `faction` or `territory` (unchanged from spec 005).
- **Fit scale**: the initial overview scale where the whole map fits the visible area.

## Functional requirements
- FR-620: WHILE the map is rendered at any scale from the fit scale to the maximum scale outside a round transition, THE SYSTEM SHALL draw no two labels of the same role whose on-screen footprints overlap, and SHALL maintain a minimum clear visual gap between adjacent drawn labels of the same role, including at the initial whole-map zoom on dense maps.
- FR-621: THE SYSTEM SHALL bound the drawn on-screen height of every label (horizontal, straight and arc) per role: `minPx` = 9 CSS px (labels below `minPx` SHALL NOT be drawn) and `maxPx` = 48 CSS px for faction labels and 28 CSS px for territory labels; labels whose scaled height would exceed their role's `maxPx` SHALL be capped at `maxPx` while keeping their centre, reading angle and curvature centred within their region.
- FR-622: WHEN a label's full name does not fit inside its region at a readable size, THE SYSTEM SHALL derive a deterministic, ordered list of shorter display forms from the full name alone (no per-map or per-name exceptions, no randomness, preserving diacritics and casing):
  1. **Full name**.
  2. **Prefix with `"."` first**: for multi-word names, abbreviate leading significant words to dotted initials while keeping the trailing significant word (e.g. `Santa Cruz de Tenerife` → `S. C. Tenerife`), followed by shorter prefix truncations ending with `"."` (e.g. `Valencia` → `Val.`).
  3. **Plain uppercase acronym (no dots)** only if prefix-with-dot forms are still too long, built from the initials of significant words (ignoring connector words such as `de`, `del`, `la`, `las`, `los`, `el`, `y`, `of`, `the`, e.g. `Santa Cruz de Tenerife` → `SCT`).
- FR-623: THE SYSTEM SHALL display the fullest candidate form from FR-622 that fits inside its region at a readable size; WHEN a faction expands in later rounds or the user zooms in so that a fuller form fits, THE SYSTEM SHALL display that fuller form (up to the full name), selecting from precomputed tiers so panning and zooming stay smooth.
- FR-624: IF even the shortest candidate form of FR-622 cannot fit inside a region at a readable size (`>= minPx`), THEN THE SYSTEM SHALL hide that label until zoom or faction growth makes a form fit; THE SYSTEM SHALL NOT place off-land labels or draw leader lines.
- FR-625: WHEN the user hovers (desktop) or taps (mobile) any land territory on the map, THE SYSTEM SHALL show a lightweight readout displaying both the territory's full name and its owning faction's full name (in addition to the existing faction list and chronicle); moving off land or dismissing hides the readout.
- FR-626: THE SYSTEM SHALL apply FR-620 to FR-625 uniformly across every map (predefined and imported, from small regional maps to world and municipality maps) using only the existing map package and presentation data.
- FR-627: WHILE a round-step transition or reveal tour is playing, THE SYSTEM SHALL keep label transitions smooth across display-form changes (interpolating or crossfading) and SHALL never expose future rounds or unrevealed victim/absorber identities via labels or hover/tap readouts.

## Non-functional requirements
- NFR-150 (Purity and determinism): Name shortening, display-form selection, size clamping and overlap resolution are pure deterministic functions (no DOM, clock or randomness) covered by unit tests.
- NFR-151 (Performance): Round-change label computation stays within the existing 200 ms budget, and pan/zoom stays within 16.7 ms median / 33.3 ms p95 frame time on desktop.
- NFR-152 (Visual verification): Before/after screenshots (desktop and mobile) at fixed seeds and rounds covering whole-map overview, mid-zoom and close-up on dense maps (including Spain and a small-territory map), reviewed and accepted by the user.
- NFR-153 (Dependencies and language): No new runtime dependencies; any new UI strings live in the Spanish strings module.

## Edge cases
- Very short names (1–4 characters, e.g. `Jaén`, `Lugo`, `León`): never lengthened by adding `"."`; only abbreviated if the shortened form is strictly shorter than the full name.
- Multi-word names with articles/prepositions (`Santa Cruz de Tenerife`, `Casas de San Galindo`, `La Rioja`, `Ciudad Real`, `Islas Baleares`): connector words (`de`, `del`, `la`, `las`, `los`, `el`, `y`, `of`, `the`, etc.) skipped cleanly when forming initials/acronyms.
- Hyphenated names (`Castilla-La Mancha`, `Friuli-Venecia Julia`) and diacritics (`Álava`, `Cádiz`, `Guipúzcoa`, `Masegoso de Tajuña`): split and truncated on Unicode code-point/grapheme boundaries without breaking accents.
- Duplicate abbreviations between two nearby regions (e.g. `Valderrebollo` and `Valdemoro` both yielding `Val.`): accepted because hover/tap always displays the full territory and faction names (FR-625).
- Round T (single remaining faction) and close zoom on large regions: capped cleanly by `maxPx` (48 px faction / 28 px territory) so names never overflow the screen.
- Reduced motion preference: round changes and display-form swaps apply immediately without animation.

## Out of scope
- Changes to the map package format, presentation schema, builder, simulator, server, Discord bot, or game rules.
- Per-map hand-authored abbreviations or manual label coordinates.
- Multi-line wrapped labels, letter-spacing (tracking), or custom label font/ink/halo restyling.
- Off-land labels and leader lines (superseded by FR-624).
- Sea zone labels.

## Done criteria
- Pure unit tests (written first) covering deterministic abbreviation rules (prefix + `"."` before plain acronyms, short names, multi-word names, diacritics, hyphens), per-role screen-size clamping (`minPx` = 9, `maxPx` = 48 / 28), overlap-free layout at fit scale, hiding unreadable labels with no off-land/leader lines, zoom/growth form expansion, and anti-spoiler safety of hover/tap readouts.
- `npm test` and `npm run typecheck` green; no changes outside `apps/web` and `specs/032-readable-labels/`.
- Desktop and mobile before/after screenshots saved under `.claude/review/032-readable-labels/` with an inline before/after slider widget, reviewed and accepted by the user.

## Open questions
- None. Decisions recorded from user answers (2026-11-22): prefix + `"."` before plain acronyms; hide unreadable labels (no off-land/leader lines); separate `maxPx` per role (48 px faction, 28 px territory); always-on hover/tap readout showing full faction and territory names; zoom-in expansion back to full names kept. Awaiting explicit spec approval before implementation.
