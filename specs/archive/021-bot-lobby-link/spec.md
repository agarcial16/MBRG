# Spec 021 — Viewer link in the bot's lobby message
Status: implemented (approved 2026-11-17, OQ1 as proposed; hand-tested 2026-11-17; merged in #70). Tier: Light SDD (the Discord bot only: no change under `packages/`, `apps/server` or `apps/web`). Depends on 012, 016, 017 and 020 (implemented). Ids continue 020: FR-526 onwards, NFR-111 onwards.

## Goal
`/mbrg create` posts a lobby message with the match id and a Start button, but no way to open the match in the viewer; the link only appears with the first round. A creator who wants to open the viewer before pressing Start has to copy the id by hand. This spec adds the "Ver en el visor" link button to the lobby message.

## Requirements
- FR-526: WHEN a viewer address is configured, THE SYSTEM SHALL add a link button "Ver en el visor" to the lobby message, next to the Start button. WHEN none is configured it SHALL add nothing (as 012 FR-462).
- FR-527: THE lobby link SHALL carry only the match id (`?match=<id>`) and NOT `spectate=1`: the viewer then shows the waiting screen of a client-only lobby (020 FR-520) and enters the scene by itself when the match starts. This is the one viewer link of the bot that is not marked spectator; 016 FR-469 is amended to say so.
- FR-528: THE Start button keeps its behavior (only the creator, 012 FR-464); the lobby text and the strings stay in the strings module (012 FR-461).
- FR-529: WHEN the match has started, THE SYSTEM SHALL leave the lobby message as it is (no edit of its link).

## Non-functional requirements
- NFR-111 (Testability): the lobby message is built by the pure `lobbyMessage`; a Vitest test shows it carries the link with a viewer address and none without, that the link has no `spectate`, and that a viewer address with its own query keeps working.

## Out of scope
- Any change of the viewer (020 already handles the link) and of the server.
- Editing the lobby message after the start.

## Done criteria
- Tests first for FR-526 to FR-529; `npm test` and `npm run typecheck` green.
- Hand run: `/mbrg create` shows the link; opening it before Start shows the waiting screen, and pressing Start enters the scene.

## Open questions (proposed answers)
- OQ1: link text "Ver en el visor" as in the round messages (proposed) or "Abrir el visor".
