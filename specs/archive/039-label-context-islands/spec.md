# Spec 039 — Conquered-label context, tiny island markers and main-piece capture framing
Status: implemented (approved 2026-11-26, user: "si")
Tier: Light SDD (viewer labels, island markers and capture framing; no server, protocol, sim or shared change). Depends on 032 (readable labels), 037 (close-zoom faction labels), 038 (capture mode). Ids: FR-727..FR-734, NFR-192..NFR-196 (highest in use: FR-726, NFR-191).

## Context and goal
Reviewing the round captures from spec 038 and inspecting zoomed-in conquests in the viewer exposed three visual problems:
1. **Ambiguous conquered province names**: when zooming to province level inside a multi-territory empire (e.g. Kazakhstan after absorbing Uzbekistan), the former country's territory label renders at 100 % opacity while the faction label fades out, making it look like an independent country or causing confusion about who conquered whom.
2. **Invisible tiny island territories**: micro-island nations and small island territories (e.g. Pacific archipelagos) shrink to a few pixels at overview and mid-zoom, becoming nearly invisible against the ocean both in the live viewer and in captures.
3. **Ocean-heavy round captures**: when an absorber owns a tiny distant island far from its mainland (e.g. Peru with a distant Pacific territory), framing every pixel of the absorber pulls the camera out to mostly empty ocean.

Goal: make conquered territory context immediately legible in both the viewer and capture mode, highlight tiny island territories with Pacific-style dashed maritime borders in the viewer and captures, focus round captures on the conquest, and exclude tiny distant outlier islands from the round-capture framing box.

## Users
- **Spectator / player**: immediately distinguishes an independent country from a conquered province at province zoom, spots tiny island territories at overview/mid-zoom, and sees a clear, focused annexation frame in Discord round images.
- **Reviewer (the user)**: verifies the visual improvements via desktop, mobile and capture before/after screenshots and an inline comparison slider.

## User stories
- US-1. As a spectator zooming into a conquered empire, I want former territory names to appear softer at province zoom and reach full opacity only when I zoom in close, so that I always know I am inside another faction's territory.
- US-2. As a spectator looking at a world or archipelago map, I want tiny island territories to be outlined with a Pacific-style dashed maritime border in their owner's colour so that I can see who owns them without zooming all the way in.
- US-3. As a spectator in Discord, I want each round image to focus cleanly on the absorber's main landmass and the annexed territory without being zoomed out over empty ocean by a tiny distant island, and without dimmed neighbour labels competing with the conquest.

## Definitions
- **Subordinate territory**: a land territory owned by a faction whose name differs from the territory's name, or whose owning faction controls more than one land territory (i.e. a province inside a multi-territory union rather than an independent single-territory country).
- **Tiny island territory**: a land territory whose pieces have no land contact with any other territory (pure island pieces) and whose largest piece's on-screen bounding-box side falls below the island-marker visibility threshold at the current zoom.
- **Island cluster**: a spatial group of pieces belonging to one tiny island territory that lie close enough to be enclosed by a single rounded dashed maritime frame without spanning unrelated ocean.
- **Main landmass (for capture framing)**: the significant pieces of the absorber (and the round's victim) that exclude tiny distant outlier pieces.

## Functional requirements
Conquered-label opacity (viewer and capture)
- **FR-727 (Subordinate territory opacity ramp)**: WHILE the map is rendered at province zoom (`scale >= fadeStart`), THE SYSTEM SHALL render territory labels of subordinate territories at a reduced base opacity (45 % of full territory opacity) and ramp them smoothly to 100 % only when zoomed in close (`closeDetailStart` to `closeDetailFull`, scaled by the screen detail factor); territory labels of independent single-territory factions whose name matches their faction SHALL render at 100 % territory opacity.
- **FR-728 (Capture focus on conquest)**: WHILE in round-capture mode for round `k >= 1`, THE SYSTEM SHALL attenuate labels of dimmed (non-absorber) territories and factions to match the dimmed map emphasis (~35 % opacity) so the conquest stands out, and SHALL keep the absorber's faction label visible at 100 % opacity even when the capture camera scale exceeds `fadeStart`.

Tiny island markers (viewer and capture)
- **FR-729 (Pacific-style dashed maritime border)**: WHILE a tiny island territory (pure island whose largest piece spans at most 1.2 % of the map's longer side) is on screen and its largest piece's on-screen bounding-box side is below the upper fade threshold (18 CSS px), THE SYSTEM SHALL draw a rounded dashed maritime border around each of its island clusters using the owning faction's colour, a dark outer halo for contrast over ocean, and a faint translucent tint inside the frame, with a viewport-scaled minimum readable frame size so single-pixel islands remain clearly visible on both desktop and mobile.
- **FR-730 (Zoom fade and dim consistency)**: THE SYSTEM SHALL render the maritime border at full strength while the territory's largest piece is at or below 10 CSS px on screen, fade it smoothly to 0 % between 10 and 18 CSS px as the real land becomes legible, and attenuate its opacity alongside dimmed factions during reveal tours and round captures.
- **FR-731 (No coastal-skerry or major-island clutter)**: THE SYSTEM SHALL NOT draw island markers for territories that touch another land territory, major island nations above 1.2 % of the map's longer side, or territories whose largest piece is already clearly visible on screen.

Capture framing
- **FR-732 (Main-piece annexation framing)**: WHEN computing the round-capture camera frame for round `k >= 1`, THE SYSTEM SHALL exclude tiny distant outlier pieces of the absorber (pieces that are a tiny fraction of the absorber's area and lie far from its main region) while always retaining the absorber's main region and the victim's main transferred piece, then apply the existing 15 % margin and 20 % minimum-width rules.
- **FR-733 (Fallback when all pieces are small)**: IF all pieces of the absorber are small (e.g. an island-only faction absorbing another island), THEN THE SYSTEM SHALL retain the absorber's largest pieces so the framing box is never empty and always frames the annexation cleanly.
- **FR-734 (Step, tour and anti-spoiler invariants)**: THE SYSTEM SHALL preserve smooth transitions during round steps and reveal tours, keep all Spec 032/037 label invariants (no overlaps, no off-land boxes or leader lines, hover/tap full-name readout), and never expose future rounds or unrevealed identities.

## Non-functional requirements
- **NFR-192 (Purity and determinism)**: Subordinate-territory classification, close-zoom opacity ramp, tiny-island cluster detection, and main-piece capture framing are pure deterministic functions covered by unit tests; the same `(match, round, frame)` always produces identical framing, labels and markers.
- **NFR-193 (Performance and layout isolation)**: Changes do not alter the label-placement layout algorithm (coordinating with parallel capture-perf work); island-cluster geometry is computed once per map load so pan/zoom remains within 16.7 ms median / 33.3 ms p95 frame time on desktop.
- **NFR-194 (Visual verification)**: Before/after screenshots saved under `.claude/review/039/` covering desktop and mobile (390×844) viewer views (conquered union at province zoom and close zoom, Pacific island markers) plus 038 round captures (a land conquest and the Peru distant-island case), presented with an inline before/after comparison slider widget.
- **NFR-195 (UI polish pass)**: Run the `unslop-ui` pass on any new visual/UI styling before completion.
- **NFR-196 (Scope and dependencies)**: Zero new runtime dependencies; code changes stay within `apps/web` (plus spec and doc updates).

## Edge cases
- **Independent country on round 0**: every single-territory country whose territory name equals its faction name keeps 100 % territory label opacity.
- **Multi-province starting faction** (e.g. a map where a faction starts with several provinces): its provinces are subordinate territories from round 0, so they soften at province zoom and reach 100 % at close zoom.
- **Multi-piece archipelago** (e.g. Kiribati, Maldives, Cape Verde): pieces within cluster range share one rounded dashed frame; widely separated pieces of the same territory form separate tight frames rather than one giant ocean box.
- **Round 0 capture or full-map capture**: no conquest dimming is applied (round 0 has no absorber; full-map capture shows the whole world with Pacific island markers visible).
- **Reduced motion**: opacity and framing apply directly without extra timers.

## Out of scope
- Changes to `packages/shared`, `packages/sim`, `packages/protocol`, `apps/server`, `apps/bot`, `tools/build-map`, or map package formats.
- Changing the label placement/layout algorithm (owned by spec 040).
- Hand-authored EEZ polygons or per-country overrides.

## Done criteria
- Unit tests (written first) covering subordinate-territory opacity ramp, capture focus dimming and absorber faction visibility, tiny-island cluster detection and zoom fade, and main-piece annexation framing (including outlier exclusion and island-only fallback).
- `npm run typecheck` and `npm test` green.
- Before/after screenshots (desktop, mobile, conquest capture, Peru capture) under `.claude/review/039/` and inline before/after slider widget shown in this thread.
- `unslop-ui` pass completed.
- PR into `main` with `Status: implemented`, spec archived to `specs/archive/039-label-context-islands/`, and `MEMORY.md` and `docs/board.md` updated.

## Open questions
- None. All design choices confirmed by the user on 2026-11-26 (subordinate province opacity ramp in viewer + capture; capture focus dimming of non-absorber labels; Option B Pacific-style dashed maritime borders in viewer + capture; main-piece capture framing for distant islands). Awaiting explicit approval of this spec before implementation.
