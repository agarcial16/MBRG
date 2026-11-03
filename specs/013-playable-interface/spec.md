# Spec 013 — Playable interface (create, join, lobby, predict)
Status: approved (by the user on 2026-11-01; OQ2 and OQ5 follow the proposals: tour 30 % longer, banner 3 s, deployment shape decided with the first deployment). Tier: Light SDD (UI, visual design, animation). Depends on 008, 009, 010 and 011 (implemented). Ids continue 011: FR-393 onwards, NFR-77 onwards. The Discord bot stays spec 012.

## Goal
Let a person who is not the operator play in the browser, end to end: create a match, share the link, join with a name, wait in the lobby, predict the victim and the absorber from the HUD or by tapping the map, and read points, a named leaderboard and "who guessed right". It also closes the visual items deferred from 009 and 010 (round banner, camera, tour pacing, reveal overlay, phone zoom). The server, the protocol, the sim and the map format do not change; the anti-spoiler rule holds.

## Definitions
- **Personal token**: the secret player token or host token returned once by the server; it never leaves the browser except as `Authorization: Bearer` to the same server.
- **Forced round**: a round marked forced by the server (011, FR-387).

## Functional requirements
**Create and share**
- FR-393: WHEN a visitor opens the start screen, THE SYSTEM SHALL offer "Crear partida": the public map list, a timing choice (Rápido / Normal / Lento) limited to the public bounds read from the public config read of spec 014 (this requirement is blocked until 014 is implemented; the rest of 013 is not), and a create button; the operator credential is never requested or stored.
- FR-394: WHEN creation succeeds, THE SYSTEM SHALL keep the host token in the browser, show the match link with a copy button (and the phone share sheet where it exists) and enter the lobby.
- FR-395: IF creation is refused (`too-many-matches`, `rate-limited`, invalid timing, network), THEN THE SYSTEM SHALL show one plain sentence per code and keep the form values.

**Join and lobby**
- FR-396: WHEN a visitor opens a match link with no stored player token, THE SYSTEM SHALL show the join screen with a name field that applies the name rule of FR-377 before sending, and maps `name-taken`, `match-full`, `match-expired` and a finished match to plain sentences.
- FR-397: THE SYSTEM SHALL keep the personal token per match in `localStorage`; WHEN the same browser reopens the link it resumes as that player without asking again. It offers a personal link (FR-382) that restores the token in another browser, with a warning that the link is the player.
- FR-398: WHILE the match is in `lobby`, THE SYSTEM SHALL show the player count, the list of names (read from the players read, updated by `player-joined` events) and the share link; the host also sees "Empezar" (enabled with at least one player); others see "Esperando al anfitrión". No round data is shown.
- FR-399: WHEN the host presses "Empezar" and the server accepts, THE SYSTEM SHALL leave the lobby for the match screen for every connected client on the first `schedule` event, without reload.
- FR-400: WHEN a `player-joined` event arrives, THE SYSTEM SHALL add the player to the list and never treat it as a protocol fault; joining a running match shows "Predices desde la próxima fase".

**Prediction**
- FR-401: WHILE phase 1 is open and the player has joined, THE SYSTEM SHALL let the player choose the victim from the HUD bar (living factions) and by tapping a living faction on the map, send the choice on the tap or click itself, with no confirm step, show it as sent, allow changing it by choosing another until the phase closes, and show the "already predicted" seal (010).
- FR-402: WHILE phase 2 is open, THE SYSTEM SHALL do the same for the absorber among the candidates, ordered by territory count (largest first, ties by faction id).
- FR-403: IF the round is forced, THEN THE SYSTEM SHALL offer no absorber choice, show "Absorbente forzado" with the faction, say that it gives no points, and use the shorter phase 2 the server sets.
- FR-404: IF a submission is refused or fails (closed phase, forced absorber, network), THEN THE SYSTEM SHALL keep the previous choice, show one plain sentence and allow retry while the phase is open. A tap on the map while no phase is open or in replay does nothing but show the reason.
- FR-405: THE SYSTEM SHALL show the countdown of the open phase from the server clock offset, and offer no prediction on a past round.

**Results**
- FR-406: WHEN a phase is scored, THE SYSTEM SHALL show the player's result (right or wrong, points, total, rank) in the player chip and a results panel, and the leaderboard with names (paged) in the right column, highlighting the player.
- FR-407: WHEN scored data exists for a round, THE SYSTEM SHALL render the "who guessed right" line of the chronicle with the names (first names and a count, then "ver todos" paged); it is hidden for forced and unscored phases and never shows a wrong guess.

**Between rounds and reveal**
- FR-408: WHEN a round is applied, THE SYSTEM SHALL show a centred banner (round number, victim, absorber, territories taken) over a dimmed map for 3 s, dismissible by tap or key; with reduced motion it is shown without fade.
- FR-409: WHILE the phase-2 window is closed and before the victim is revealed, THE SYSTEM SHALL show "PREDICCIONES FINALIZADAS", then "REVELANDO…", and show no victim, absorber or faction highlight until the reveal event (NFR-71 of 010, FR-322 of 009).
- FR-410: WHEN a round ends and the user has not moved the camera since the round began, THE SYSTEM SHALL return to the default view; a camera moved by the user (drag, wheel, pinch, minimap) is left where it is.
- FR-411: THE SYSTEM SHALL play the tour with a slow-fast-slow (bell-shaped) speed profile and a total duration longer than today's (the exact figure is OQ5), keeping the 009 reveal-timing rules and goldens or amending them in this spec.
- FR-412: WHEN the phone minimap is shown, THE SYSTEM SHALL zoom the main camera with a two-finger pinch on it, clamped to the camera limits.

## Non-functional requirements
- NFR-77: Every new text lives in the strings module, in Spanish; touch targets, focus, contrast and reduced motion follow NFR-65 to NFR-67 of 010.
- NFR-78: No token is logged, put in a URL query sent to the server, stored in an event or kept in sessionless memory beyond the match; the personal link carries it in the fragment (never sent to the server).
- NFR-79: Anti-spoiler and determinism unchanged: no request for a future round; the displayed data is only what the server published; scans and goldens of 008, 009, 010 and 011 pass.
- NFR-80: Pure parts (forms, name rule, token store, candidate order, banner and overlay state, camera-return rule, speed profile, results model) are tested in Node; no change in `packages/*`, `apps/server`, `tools`, `maps` unless a gap is approved.

## Design (agreed with the user, 2026-11-01)
Reuses the look of 010: wood panels with gilt rules, small-caps headings (Cormorant SC), Spectral text, parchment bands, the same buttons and chips. No new palette. Desktop: the bottom panel switches to "Tu predicción" while a phase is open; the chosen faction is outlined in gilt on the map; the lobby shows the players list on the left and the share panel (link, "Copiar enlace", "Empezar") bottom right over a dimmed map; the create screen is one wood panel on the parchment with map, pace and a create button. Phone: keeps the 010 skeleton (top bar, map between parchment bands, bottom dock with tabs Partida / Orden / Ranking); the dock shows players and "Empezar" in the lobby, "Tu predicción" in an open phase, and the ranking after a scored phase. Wireframes were shown in the session; the reviewed screenshots of done criterion 2 replace them.

## Edge cases
Token present but the server answers unknown player (match removed): clear it and show the join screen. Two tabs, one player: both submit, the last wins. Join while the host starts: the start wins, the joiner lands in a running match. Name with accents or emoji: refused by the rule, message shows the allowed characters. Lobby `expired`: plain state with a link to create. Phase closing while a submission is in flight: the server answer rules. Host closes the tab: the lobby waits; others see the host is absent only if the server says so (none today).

## Out of scope
Server, protocol, sim and map format changes; Discord bot; accounts, recovery, name change, kicking, chat, profanity filters; sound; i18n; ordering by border length; new maps.

## Done criteria
1. A test for each id above; typecheck and CI green; the diff touches only `apps/web` and `specs/`.
2. Reviewed screenshots of the debug scene (fixed seed and round) at 1280 x 720 and 390 x 844: create, share, join, lobby (host and guest), phase 1 and 2 choice, forced round, banner, finalised overlay, results, leaderboard, who guessed right, pinch minimap.
3. A hand run against the local server: create, two browsers join, start, predict by bar and by map, read the named leaderboard; user accepts.
4. One PR into `rewrite`; if it passes about 3,000 changed lines it splits into (a) create, join, lobby, token; (b) prediction and results; (c) banner, camera, tour, overlay, pinch.

## Open questions (answers: user 2026-11-01; OQ3 and OQ4 checked against the server code)
- OQ1: decided: add a small public read (spec 014) with the allowed maps and the timing bounds. It is a server change, so it gets its own small Full-SDD spec (014), implemented before the create screen; the rest of 013 does not depend on it.
- OQ2: deferred (deployment shape). For local development the viewer reads the server origin `http://127.0.0.1:8787` and the server allows only the configured origin; the production shape is decided with the first deployment.
- OQ3: answered by the code: `forced` is in the public victim data and in `victim-revealed`, available when phase 2 starts.
- OQ4: answered by the code: `GET /matches/:id/predictions` with the player token returns the player's own predictions and `GET /matches/:id/players/:playerId/results` the scored ones.
- OQ5: decided: tour 30 % longer than now, banner 3 s.
- OQ6: decided: the host plays like anyone else (joins with a name); a match starts with at least one joined player.
- OQ7: decided: the personal link carries the token in the URL fragment (`#`), which is never sent to the server or logged.
