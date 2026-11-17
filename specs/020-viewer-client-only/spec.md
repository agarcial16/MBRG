# Spec 020 — Viewer closes the join door of client-only matches
Status: implemented (approved 2026-11-17, OQ1 and OQ2 as proposed; hand-tested 2026-11-17; merged in #69). Tier: Light SDD (viewer only: no change under `packages/` or `apps/server`). Depends on 018 (`clientOnly`, `joins-closed`) and 016 (spectator link). Ids continue 019: FR-519 onwards, NFR-109 onwards.

## Goal
A match created from Discord is client-only (018): the server refuses every join from outside the Discord client. Today the viewer still shows the "join with a name" screen for such a match, and only after the user types a name does it fail with a generic sentence. This spec makes the viewer read `clientOnly` and never offer a door that the server will close.

## Requirements
- FR-519: WHEN the viewer opens a match link and the public read of the match carries `clientOnly: true`, THE SYSTEM SHALL NOT show the join screen. A running match opens the scene as a spectator, exactly as a `spectate=1` link does (016 FR-470); the stored player, if any, is not used.
- FR-520: WHEN the match is client-only and still in its lobby, THE SYSTEM SHALL show one plain screen saying that the match is played from Discord and starts when the creator starts it, with no name field and no join button. The screen opens the scene by itself once the match starts (the lobby model already ends on the first `schedule` event).
- FR-521: WHEN the match is client-only and over or expired, THE SYSTEM SHALL behave as today for a match with no stored player (`closed-ended` with its "watch" action, `closed-expired` without).
- FR-522: IN the spectator scene of a client-only match, THE SYSTEM SHALL replace the sentence shown when a spectator taps a predict control ("únete a una partida para predecir") by one that says predictions are made from Discord. A spectator of an open match keeps the current sentence.
- FR-523: IF a join is still refused with `joins-closed` (a stale page, a link opened before the match was read), THE SYSTEM SHALL show the Discord sentence of FR-520 instead of the generic "no se ha podido entrar" one, and offer "Solo mirar".
- FR-524: THE SYSTEM SHALL keep the whole flow unchanged for a match without `clientOnly` (open matches, their join screen, lobby and stored players).
- FR-525: ALL new sentences SHALL live in `apps/web/src/core/strings.ts` (Spanish).

## Non-functional requirements
- NFR-109 (Secrecy): the change reads only the public match view; no request is added and no future-round data is touched.
- NFR-110 (Purity): the decision "which screen" stays in the pure `core/play-entry.ts` (inputs: stage, has player, client-only), tested with Vitest without a DOM.

## Out of scope
- Any change to the server, the protocol or the bot (018 already carries `clientOnly`).
- Showing the Discord names of players (a later server spec).
- Hiding the "create a match" screen of the viewer.

## Done criteria
- Pure tests (written first) for FR-519 to FR-524: each stage x has-player x client-only combination of `entryScreen`, the `joins-closed` sentence, the spectator sentence.
- `npm test` and `npm run typecheck` green.
- Hand run: a match created from Discord opens in the viewer as a spectator (running) or on the plain screen (lobby, and it enters the scene when the creator presses Start); an open viewer-created match still shows the join screen.

## Open questions (proposed answers)
- OQ1 (decided: plain waiting screen): in the lobby of a client-only match, a plain waiting screen (proposed) or open the scene at once as a spectator (the lobby has nothing to watch).
- OQ2 (decided: no link): should the plain screen offer the Discord channel link? Proposed: no (the viewer does not know it).
