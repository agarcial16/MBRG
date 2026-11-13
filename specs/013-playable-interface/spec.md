# Spec 013 — Playable interface (create, join, lobby, predict)
Status: approved (by the user on 2026-11-01; amended 2026-11-10 (FR-409, outline) and 2026-11-11 (FR-434..445) at the user's request; OQ2 and OQ5 follow the proposals: tour 30 % longer, banner 3 s, deployment shape decided with the first deployment). Tier: Light SDD (UI, visual design, animation). Depends on 008, 009, 010 and 011 (implemented). Ids continue 011: FR-393 onwards, NFR-77 onwards. The Discord bot stays spec 012.

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
- FR-409: WHEN a prediction window closes (the victim window or the absorber window), THE SYSTEM SHALL show "PREDICCIONES FINALIZADAS" for a short beat of about 2 s (a viewer-side hold; the server timeline is unchanged), then "REVELANDO…" during the reveal, and show no victim, absorber or faction highlight until the beat is over (NFR-71 of 010, FR-322 of 009). Amended 2026-11-10 at the user's request: the text used to flash by because the server sends the close and the reveal together. Cost: the 2 s hold shortens what a player sees of the next window by about 2 s; a real server phase would avoid that but is a Full-SDD change and is out of scope.
- FR-410: WHEN a round ends and the user has not moved the camera since the round began, THE SYSTEM SHALL return to the default view; a camera moved by the user (drag, wheel, pinch, minimap) is left where it is.
- FR-411: THE SYSTEM SHALL play the tour with a slow-fast-slow (bell-shaped) speed profile and a total duration longer than today's (the exact figure is OQ5), keeping the 009 reveal-timing rules and goldens or amending them in this spec.
- FR-412: WHEN the phone minimap is shown, THE SYSTEM SHALL zoom the main camera with a two-finger pinch on it, clamped to the camera limits.
- FR-434 (added 2026-11-11 after the user's test on a real phone): WHEN two fingers touch the map, THE SYSTEM SHALL zoom the camera around the midpoint of the fingers as they spread or close, and pan with the midpoint, clamped to the camera limits, with no jump when a finger lifts or lands (a single finger still pans), and the browser's own page zoom and scroll never take the gesture. The pinch on the minimap of FR-412 stays.
- FR-435 (added 2026-11-11): WHEN a round is forced (a short phase-2 window), THE SYSTEM SHALL still show the victim reveal animation: if the full tour does not fit the time left, it plays compressed down to the length of the still tour (1,800 ms) instead of being skipped as too short.
- FR-436 (added 2026-11-11): WHEN the victim has a single candidate absorber (forced absorber), THE SYSTEM SHALL play a short absorption animation (the victim's territory taken by its only neighbour, about 2 s, no candidate roulette) when the round is applied, instead of skipping it; with reduced motion it shows the result at once.
- FR-437 (added 2026-11-11, real-phone test): THE SYSTEM SHALL draw the faction and province names on the map with the same font on every device: a bundled open sans font (Noto Sans, weight 600, OFL, with its licence file next to it in `public/fonts`), loaded before the names are measured, so the name looks the same on a phone as on a PC. No other family is used for the map names.
- FR-438 (added 2026-11-11, real-phone test): THE SYSTEM SHALL start showing the province lines and province names at a zoom that scales with the screen: the fade thresholds (today 1.5 and 2.0 in screen pixels per map pixel, label and territory-line fades) are multiplied by min(1, fit / fit_ref), where fit is the zoom at which the whole map fits the viewport and fit_ref the fit of the 1280x720 desk reference, so the provinces appear at the same relative magnification on a phone as on a PC, and nothing changes for a viewport at least as large as the reference.
- FR-439 (added 2026-11-11, second real-phone test): ON THE PHONE the bottom dock SHALL fold to a slim bar (its tabs only) while a victim reveal, a finalised beat or an absorber animation plays, so it never covers the animation, and reopen on its own when the animation ends. The player can fold and unfold it by hand; folding never hides the round controls of FR-441.
- FR-440 (added 2026-11-11): ON THE PHONE the chronicle and the faction table (territories, losses, conquests) SHALL each be reachable in full, with nothing clipped, in their own dock tabs: the tabs become "Orden" (prediction and result), "Crónica", "Facciones" and "Ranking". All of them scroll inside the dock. The "Orden" tab opens by itself when a prediction window opens.
- FR-441 (added 2026-11-11): THE SYSTEM SHALL keep the round controls (first, previous, next, last, "Vista", "Saltar") in a strip of their own that is always visible with the dock open, on every tab, and does not disappear when a tab is pressed.
- FR-442 (added 2026-11-11): THE SYSTEM SHALL list a round in the round selector only once it has been played (applied), plus the round in play, and SHALL NOT show the total number of rounds before the match is finished (neither in the selector nor in the top bar, which reads "Ronda N" and, once finished, "Ronda N de M"). With many rounds the selector is a horizontally scrolling strip that keeps the current round in view, with a compact "Ronda N" label, on desk and phone; it never wraps into several rows.
- FR-443 (added 2026-11-11): ON THE PHONE the default view and the framing of animations SHALL use the map area that is visible (between the top bar and the open dock, or the full screen with the dock folded), so the map is not centred under the dock and no large empty ground band appears.
- FR-444 (added 2026-11-11): THE SYSTEM SHALL let the player reach the state before round 1 ("Inicio", round 0) with the round selector: it is the first entry of the selector, always present, and the "first" button goes to it.
- FR-445 (added 2026-11-11, after the dock rework): ON THE PHONE the open dock SHALL take no more than about 40 % of the screen height (about 340 px on a 390x844 screen, and no more than 45 % on a 360x640 one): tabs, a content pane that scrolls, and the round strip in at most two compact rows; the selector shows its own "Ronda N" label only once, with no duplicate "Inicio" text next to the "Inicio" entry.
- FR-446 (added 2026-11-11, after the phone test): ON THE PHONE the state card of a finished match (the winner) SHALL be one slim line under the top bar, left of the minimap, without its body text, so it never covers the map the player is reviewing.
- FR-447 (added 2026-11-11, real-phone test): the label canvas SHALL have exactly the box of the map canvas (the same height as the body, 100vh), so that on a phone with the address bar showing the names are not squashed and shifted against the map.
- FR-448 (added 2026-11-11, after the phone test): WHEN a match is finished and the leaderboard is known, the state card SHALL also name the player or players who won it (first place with points) in its own colour (verdigris), as "Gana la partida: Ana · 7 pts" (a tie lists up to three names and a count); to a winning viewer it reads "¡Has ganado la partida!". Nothing is shown when nobody scored.
- FR-449 (added 2026-11-12, after the phone test): WHILE a victim reveal or an absorber tour runs (and during the finalised beat) the results panel, the player total, the place and the who-guessed-right lines SHALL keep what they showed before the tour: whether the player was right or wrong, the points and the place appear only once the tour has ended. The "Tu resultado" panel no longer repeats the total and the place; the player chip shows them: "Ana · 2 pts · 1.º" (amends spec 015 FR-427).
- FR-450 (added 2026-11-12, after the phone test): the matches the page creates SHALL close the prediction window (L2, the wait between "Predicciones finalizadas" and the animation of the absorber) at 5 s in every pace, or the server minimum when it is higher, so the wait never drags. A forced round keeps the same L2 after its short phase.

## Non-functional requirements
- NFR-77: Every new text lives in the strings module, in Spanish; touch targets, focus, contrast and reduced motion follow NFR-65 to NFR-67 of 010.
- NFR-78: No token is logged, put in a URL query sent to the server, stored in an event or kept in sessionless memory beyond the match; the personal link carries it in the fragment (never sent to the server).
- NFR-79: Anti-spoiler and determinism unchanged: no request for a future round; the displayed data is only what the server published; scans and goldens of 008, 009, 010 and 011 pass.
- NFR-80: Pure parts (forms, name rule, token store, candidate order, banner and overlay state, camera-return rule, speed profile, results model) are tested in Node; no change in `packages/*`, `apps/server`, `tools`, `maps` unless a gap is approved.

## Design (agreed with the user, 2026-11-01)
Reuses the look of 010: wood panels with gilt rules, small-caps headings (Cormorant SC), Spectral text, parchment bands, the same buttons and chips. No new palette. Desktop: the bottom panel switches to "Tu predicción" while a phase is open; the chosen faction is outlined in white on the map (amended 2026-11-10: gilt was easy to confuse with the ochre and yellow factions); the lobby shows the players list on the left and the share panel (link, "Copiar enlace", "Empezar") bottom right over a dimmed map; the create screen is one wood panel on the parchment with map, pace and a create button. Phone: keeps the 010 skeleton (top bar, map between parchment bands, bottom dock with tabs Partida / Orden / Ranking); the dock shows players and "Empezar" in the lobby, "Tu predicción" in an open phase, and the ranking after a scored phase. Wireframes were shown in the session; the reviewed screenshots of done criterion 2 replace them.

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
