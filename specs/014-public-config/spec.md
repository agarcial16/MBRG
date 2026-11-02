# Spec 014 — Public match config read
Status: approved (by the user on 2026-11-01)

## Context and goal
Spec 011 lets anyone create a match from a public map list inside public timing bounds, and caps the players of a match. The values live in operator settings and no read publishes them. Spec 013's create-match screen therefore cannot offer only valid maps or timings, and would learn the limits by being refused. Goal: one credential-free read that publishes exactly the public creation options, nothing else.

## Users
- Web visitor (spec 013 create screen). Third-party client developer. Operator (decides what is published through existing settings).

## User stories
- US-1. As a visitor, I want to see which maps and timings I may choose so that I never submit a creation the server will refuse.
- US-2. As a visitor, I want to know whether public creation is on so that the screen can say so instead of failing.
- US-3. As an operator, I want the read to expose no secret and no operator data so that publishing it is safe.

## Definitions
- Public config: the object described by FR-413. Proposed path: `GET /config` (shorter, and it is the only config the server publishes; `/public-config` rejected as redundant).
- Timing bounds: the settings of spec 011 FR-369 (shortest and longest round interval, shortest L1, shortest L2; defaults 30, 3,600, 10 and 5 seconds).

## Functional requirements
- FR-413: THE SYSTEM SHALL offer one read, `GET /config`, that needs no credential and returns the public config: the ids of the maps open to public creation (in the operator's order), the timing bounds in seconds (shortest interval, longest interval, shortest L1, shortest L2), the player cap per match (spec 011 FR-380), and whether public creation is enabled.
- FR-414: THE SYSTEM SHALL report public creation as enabled if and only if the public map list is not empty (spec 011 settings); WHILE it is disabled, the map list is empty and the bounds and player cap are still published.
- FR-415: THE SYSTEM SHALL return in the public config no credential, token or digest, no operator or client data (namespaces, allowed origins, host, port, database path, folders), no map folder, no open-lobby or running-match count, no rate-limit value and no lobby expiry, and no field not listed in FR-413.
- FR-416: THE SYSTEM SHALL encode the public config in a canonical form (fixed field order, no whitespace, whole numbers only) with an encoder and a decoder in the protocol package; the decoder refuses unknown fields, missing fields, wrong types and a map id that is not a configured-map-id shape. The canonical bytes of a fixed example are pinned by SHA-256 in a golden.
- FR-417: WHEN the read is called repeatedly with unchanged settings, THE SYSTEM SHALL return byte-identical bodies, whatever the state of matches, the time or the caller.
- FR-418: THE SYSTEM SHALL treat the read like the other anonymous GET reads: same response shape and content type, CORS `*` for the reply, counted in the anonymous per-minute limit (and refused with the existing `rate-limited` code at it), no query string accepted (as an existing no-query read), and no body.
- FR-419: IF the method is POST or PUT (or any method that is not GET, HEAD or OPTIONS as the other reads handle them), THEN THE SYSTEM SHALL answer 405 with an `Allow` header listing the allowed methods, as the other reads do.
- FR-420: THE SYSTEM SHALL leave every existing wire byte unchanged: the spec 008 and 011 goldens and the protected-files pin pass unmodified, and no existing route, setting, error code or event changes. The one expected re-pin is the protected file list, if a protected file gains the new route; it is named in `PROGRESS.md` with its reason.
- FR-421: THE SYSTEM SHALL publish the values the creation path itself enforces, from the same settings object, so that a creation inside the published config is never refused for map or timing bounds (a test creates at each bound and at the first value outside it).

## Non-functional requirements
- NFR-81: Tests come first. Mutation proofs show that dropping a field, adding a field, leaking a setting (credential, origin, limit) and flipping `enabled` each fail a test.
- NFR-82: The traceability ledger covers FR-413 to FR-421 and NFR-81 to NFR-83, each with at least one test.
- NFR-83: Secrecy and determinism hold: the read touches no match, no clock and no random source; the simulation package and the map format are unchanged.

## Edge cases
- Public creation off (empty map list): `enabled` false, `maps` empty, bounds still present.
- One map, or many: order is the operator's, no duplicates.
- Settings that equal the defaults, and settings changed by the operator: both published as set.
- Anonymous limit exhausted: the read is refused like any other anonymous read; it does not bypass the limit.
- A request carrying a credential: same body as without one (no role changes the reply).

## Out of scope
- Any write, any per-client or per-role config, any live counts (open lobbies, running matches, free slots).
- Publishing rate limits, lobby expiry, forced-phase span or map metadata (names, previews; maps keep their own reads).
- Server-pushed config changes (events) and cache validators.
- Changing settings, their defaults or their validation.
- The create screen itself (spec 013).

## Done criteria
- FR-413 to FR-421 and NFR-81 to NFR-83 each traced to a passing test in the ledger.
- Golden with SHA-256 pin added; 008 and 011 goldens and protected-files pin pass (or the one named re-pin is explained).
- Mutation proofs recorded in `PROGRESS.md`; `npm run typecheck` and `npm test` green; CI green.
- Spec 013 can build its create screen from this read alone.

## Decisions (user, 2026-11-01)
- Path `GET /config`.
- The longest interval is published; `lobbyExpiryHours` is not.
- Only the player cap is published among the limits (no open-lobby cap, no creation rates).
- No cache-lifetime header: identical to the other anonymous reads.
