# Spec 016 — Spectator link and one "only watching" line
Status: approved by the user on 2026-11-15. Tier: Light SDD (UI, apps/web only). Depends on 013. Ids: FR-470 and FR-471 (FR-451..469 are taken by spec 012 on its branch).

## Goal
The Discord bot posts a link for people who only want to watch. Opening it must show the live scene at once, with no name door and no player created. Separately, a spectator who taps the map sees the sentence "Solo estás mirando: únete a una partida para predecir." twice in the "Tu predicción" panel (once plain, once in red); it must show once.

## Requirements
- FR-470: WHEN the match address carries `spectate=1` (for example `?match=<id>&round=2&spectate=1`), THE SYSTEM SHALL open the live scene as a spectator directly, never showing the join, lobby or closed screens and never creating a player. A stored player token for that match is neither used nor deleted: it applies again to a link without `spectate`. The address kept in sync while watching keeps `spectate=1`, so a reload stays a spectator. Without the parameter (or with any other value) nothing changes.
- FR-471: WHILE a spectator sees the "Tu predicción" panel, THE SYSTEM SHALL show the sentence "Solo estás mirando: únete a una partida para predecir." exactly once (the plain line); a notice that repeats the panel's own line is not drawn.

## Out of scope
Server, protocol, bot code, new strings, the join flow, the map format.

## Done criteria
- Tests for FR-470 (parser, entry decision, address sync) and FR-471 (panel view) written first and green; typecheck and full `npm test` green.
- Screenshot of the live scene of a spectator with the panel open, if a browser is available.
