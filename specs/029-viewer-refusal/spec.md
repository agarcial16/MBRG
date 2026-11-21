# Spec 029 — Viewer capability refusal (counts)
Status: approved (by the user on 2026-11-21). Tier: Light SDD (viewer UI only). Depends on 004 (package load, capability check, error screen) and 011/013 (the live scene's package load). Ids continue 027: FR-586 onwards, NFR-132 onwards. They stay outside the sim ledger (as 012/013/017/022 ids do).

## Context and goal
The map format allows up to 16,777,215 ids and any number of factions, but the viewer draws with fixed-size tables: an entry index of two bytes per pixel (at most 65,535 territories plus the outside slot) and an owner table of one byte per entry (at most 255 factions, index 0 meaning none). Today an oversized texture and an exhausted palette already stop the load with a Spanish message, but a package with more than 65,535 territories or more than 255 factions passes every check and dies later inside the drawing setup with an internal error (an uncaught RangeError) instead of the error screen. Goal: the viewer never crashes on a package beyond its capacity; it refuses the load naming which limit was passed (factions, territories, or texture size).

## Users
- Viewer user: opens a match link; when the map is beyond the viewer's capacity, wants a clear sentence, not a broken page.

## User stories
- US-1. As a viewer user, I want a package with too many territories or too many factions to be refused with a message naming that limit, so that I know the map is the problem.

## Definitions
- **Territory count**: the number of entries of the map (land plus sea).
- **Faction count**: the number of distinct owners of land entries (the faction order).
- **Viewer limits**: the table sizes the drawing is built on (65,535 territories, 255 factions). A later widening of the tables widens the refusal with them.

## Functional requirements
- FR-586: WHEN a package load reaches the viewer's checks with a territory count above the viewer's territory limit, THEN THE SYSTEM SHALL refuse the load with the error screen message that names the territory limit, and SHALL draw no map. The refusal SHALL come before any browser-dependent check, so the named cause is the viewer's own limit.
- FR-587: WHEN a package load reaches the viewer's checks with a faction count above the viewer's faction limit, THEN THE SYSTEM SHALL refuse the load with the error screen message that names the faction limit, and SHALL draw no map.
- FR-588: WHEN both counts are above their limits, THEN THE SYSTEM SHALL name the territory limit first.
- FR-589: THE SYSTEM SHALL read both limits from the table sizes the drawing is built on, never from inline numbers, so a later widening of the tables widens the refusal with them.
- FR-590: THE viewer SHALL change nothing for a package at or under every limit: same checks, same messages, same drawing (byte-identical behaviour for valid maps).

## Non-functional requirements
- NFR-132: The new messages are Spanish and live in the strings module with the rest; the error kinds stay English identifiers listed by the language scan. Every strings key is used by code.
- NFR-133: Tests use synthetic packages that pass the map format checks and sit just above each limit and exactly at each border; the existing oversized-texture and palette refusals keep their tests and messages unchanged.
- NFR-134: No change in `packages/*`, `apps/server`, `apps/bot` or the map format; the drawing tables themselves do not change (only who reads their sizes).

## Edge cases
- Exactly 65,535 territories or exactly 255 factions: not refused; the load continues as today.
- More than 65,535 territories on a browser whose texture check would also refuse it: the territory message is shown, not the texture one (FR-586 order).
- More than 255 factions whose palette would also be exhausted: the faction message is shown (the refusal comes first).
- A package that is both over a count limit and an invalid map: the map-format errors keep coming first, as today.

## Out of scope
- Raising the limits: the procedural palette (V2) and tiling or mesh drawing (V3) are later specs.
- Any change to the sim, the server, the bot or the map format.

## Done criteria
1. Suite and typecheck green.
2. Unit tests per FR with synthetic packages just above each limit and exactly at each border.
3. The existing texture and palette messages keep working (their tests unchanged and green).
4. Screenshots of the error screen on a synthetic over-limit package, reviewed by the user; the capture files are review evidence and are not committed.
