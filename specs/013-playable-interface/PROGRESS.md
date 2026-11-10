# Progress — spec 013 playable interface

Light SDD, three parts on one branch (`feat/013-playable-interface`): A create/share/join/lobby (FR-393..400), B prediction and results (FR-401..407), C banner, camera, tour, overlay, pinch (FR-408..412). Ids 393..412 and 77..80 are not in the traceability ledger (`packages/sim/test/traceability.test.ts` says so), so nothing to update there.

## Part A — create, share, join, lobby (FR-393..FR-400, NFR-77, NFR-78)

### A1. Token store and personal link (commit `df6dfe0`)
- `core/play-token.ts`: per-match player and host token in an injected storage (strict read, a throwing storage loads nothing), `matchLink`, `personalLink` (credentials in the `#` fragment), `readFragment`. Tests `test/play-token.test.ts` (FR-397, NFR-78).

### A2. Form rules and sentences (commit `eb63738`)
- `core/play-forms.ts`: paces Rápido/Normal/Lento as a timing inside the public bounds (`paceTiming`), `createBody`, `readCreation` (local strict decoder, see decisions), one sentence per refusal (`createFailure`, `joinFailure`, `startFailure`), `checkName` (the protocol's `readName`, same reader as the server), `durationText`. Strings added to `core/strings.ts`. Tests `test/play-forms.test.ts` (FR-393..396, FR-398).

### A3. Lobby model (commit `79c58ba`)
- `core/lobby-model.ts`: players list from the players read plus `player-joined` events (dedup, join order), `lobbyStageOf`, `lobbyView` (host sees Empezar enabled from 1 player, others wait), `afterJoin` ("Predices desde la próxima fase" in a running match). `test/lobby-model.test.ts` (FR-398..400). `test/live-model.test.ts` gets an FR-400 test: `player-joined` was already an accepted frame in the live model (no fault, no resync), nothing to change there.

### A4. Network calls (commit `1de6c8b`)
- `ui/live-net.ts`: `createPlayNet` (config, create, join, start with the host token as the only `Authorization`, players read over all pages). `fetch(` stays only in `ui/live-net.ts`/`ui/load.ts`. `test/play-net.test.ts`.

### A5. Shells and wiring (this commit)
- Core: `core/play-entry.ts` (`entryScreen`: join / lobby / match / closed), `adoptFragment` in `play-token.ts`, lobby model tracks the last event number of any event (for reconnection).
- UI: `ui/play-dom.ts`, `play-create.ts` (create section on the start screen), `play-join.ts` (join + closed screens + personal link block), `play-lobby.ts`, `play-main.ts` (the door: `startMatchEntry`, `enterCreated`), `entry.ts` now opens the door instead of the match scene, `live-start.ts` mounts the create section, CSS block "create, join and lobby" in `live-panel-style.ts` (tokens only).
- Tests: `test/play-entry.test.ts`, `test/play-shell.test.ts` (thin source scans: Spanish only through strings, no token logged or put in an address, order name check -> join, lobby reads no round, wiring).
- Mutation checks (affected files only, all killed): pace clamp, player dedup, fragment key count, creation id agreement, `credentials: 'omit'`.
- Result: `npm test` 316 files / 5005 passed, 4 skipped; `npm run typecheck` clean.

### Decisions the spec did not cover
1. `protocol` has no decoder for the creation reply: `readCreation` in `core/play-forms.ts` reads it strictly (exact 3 keys, `readPublicMatch`, id agreement, credential text). A protocol decoder would be cleaner but protocol is out of scope.
2. After creating, the host lands on the join screen (with the share link and "copy"), joins with a name (OQ6), then is in the lobby with "Empezar". FR-394 says "enter the lobby"; the host must have a name first.
3. A match link with no stored player opens the join screen also for a running match, with "Solo mirar" to watch without joining. A finished match without a player shows the plain sentence plus "Solo mirar"; an expired lobby shows the sentence plus a link to create.
4. Pace targets (before the public bounds): Normal 60 s / L1 30 / L2 15, Lento 300 / 150 / 60; Rápido is the shortest timing allowed. Map names are not published by `/config`, so the select shows the map ids.
5. Personal link is offered in the lobby and on the "ya estás dentro" screen of a running match; Part B should add it to the player chip.

### Untested
- No DOM environment in the repo (Node vitest, no jsdom): the shells are scanned, not run. Clipboard/share sheet, focus order, touch targets, the real lobby stream and the full flow against the local server are for the hand run (done criterion 3).
- Visual evidence not produced (done at the end).

### Needs for the debug scene / screenshots (done criterion 2)
The create screen needs a config reply (fake `GET /config`), the join screen a lobby match, the lobby (host and guest) a stored host token / player in `localStorage` and a few `player-joined` events. Easiest: the local server (`apps/server`) with `MBRG_PUBLIC_*` settings, two browser profiles; or a tiny fake `fetch`. Screens to capture at 1280 x 720 and 390 x 844: create, join (host and guest), lobby (host and guest), join in a running match (notice), closed.

### Next step
Part B: prediction (FR-401..405) and results (FR-406, FR-407). Needs from A: `loadPlayer` credentials, `createPlayNet` pattern (add submit/own-predictions with the player token as Bearer), the door passes the player to the match scene (`watch()` in `play-main.ts` currently starts the unchanged live scene), and `STRINGS` keys are only added with the code that uses them.

## Part B — prediction and results (FR-401..FR-407, NFR-77, NFR-78)

### B1. Prediction rules (commit `ad36f6d`)
- `core/predict-model.ts`: `offerOf` (phase 1 = living factions, phase 2 = candidates, forced, none with a reason; ordered by territories, ties by id), the sent book (highest version wins), `pickFor` (body with the LOCAL player id), `submitFailure`/`noOfferText` sentences, `factionAt` (map tap -> owner) and `isTap`. `test/predict-model.test.ts`. Mutants: 7 run, 5 killed, 1 equivalent (entry 0), 1 killed after adding a same-version test.
### B2. Results rules (commit `c6d2f7a`)
- `core/results-model.ts`: `scoredOf` (a `results` event), `latestScored`, `resultView`, `chipText`, `boardPage` (names, paged, player highlighted), `winnersView` (3 names + count, "ver todos" paged). `test/results-model.test.ts`; 6 mutants, all killed (one needed a 3-name line test).
### B3. Network (commit `1eefa40`)
- `createPlayNet` gained `submit`, `ownPredictions` (player token as Bearer; local id as the only query), `playerResults`, `leaderboard`, `winners` (all pages, credential-free). The token is checked with `isCredentialText` before any request. `test/play-net.test.ts`; 5 mutants killed.
### B4. View model (commit `ae3e524`) and shells (commit `ceed0f2`)
- `core/play-view.ts`: the immutable session state with its transitions and `playHud` (chip, "Tu predicción" block with countdown from the server clock offset, results panel, board, winners lines).
- `ui/play-session.ts` (thin): runs the calls, holds the state. Scores, leaderboard and winners reads wait while a victim reveal or an absorber tour runs (`hold`), so a right guess cannot give the victim away before the tour (FR-409/FR-322). `ui/live-panel.ts`: chip (opens the personal link), prediction block, results block, board in the right column (Ranking tab on a phone), winners lines under the chronicle. The parts that hold buttons are rebuilt only when their data change (a per-second refresh would drop the keyboard focus). `ui/input.ts`: `onTap` (drag-safe). `ui/live-main.ts`/`play-main.ts`: the joined player reaches the scene; `runner.onFrame` feeds `results` events.
- Tests: `test/play-view.test.ts` (9 mutants, all killed after one extra case), `test/play-session.test.ts` (fake PlayNet, 19 tests; 10 mutants, all killed after two extra cases), `test/play-shell.test.ts` (thin scans).
- Result: `npm test` 320 files / 5082 passed, 4 skipped; `npm run typecheck` clean.

### Decisions the spec did not cover
1. Tests were written after the first version of the pure modules (the modules and tests went in together); red was proven afterwards by mutants, not by a failing first run.
2. The bottom panel does not "switch" to Tu predicción: the block is added at the top of the command panel and the replay navigation stays (hiding it during an open phase would stop the user browsing rounds).
3. NOT done: the chosen faction outlined in gilt on the map (design note). It needs a render/shader change in the map scene; left for Part C or the user's call.
4. Winners lines are fetched for the round on display (both phases) and when a `results` event arrives; a refused read (unscored, forced) simply shows no line. Rounds never displayed since the page opened get no line.
5. The chip shows the name from the player results read, else the leaderboard row, else the local id; total and rank appear after the first scored phase.
6. Failure outcome for a bad round in `winners` is `bad-round` (the word `invalid-round` is a debug marker the production build scan forbids).
7. A tap on the map does nothing for a spectator but shows "Solo estás mirando"; the spectator also sees the leaderboard and the winners lines.

### Untested
- No DOM: the panel, the pick buttons, the chip popover, the pager, focus order and touch targets are scanned, not run. The tap rule is tested; the pointer events are not. A hand run (done criterion 3) must check: tap on the map sends, the chip opens the personal link, the board pages, the right column does not overlap the minimap at 1280 x 720, the dock Ranking tab at 390 x 844.
- The real server: reads of `GET .../winners` after a real `results` event; the exact moment of the `results` events relative to the tours.
- Screenshots for done criterion 2 (phase 1 and 2 choice, forced round, results, leaderboard, who guessed right) are not produced: needs a browser and a fake or local server with a joined player.

### Next step (Part C)
Banner, camera return, tour pacing, finalised overlay ("PREDICCIONES FINALIZADAS" / "REVELANDO…"), phone pinch. Hooks from B: `offerOf` returns the reason `closed`/`revealing` (the overlay can reuse it), `TourHold` in `play-session.ts` is the one place that knows the reveal state, `attachInput` already tells taps from drags (the pinch goes next to it).

## Part C — banner, camera, tour, overlay, pinch, outline (FR-408..FR-412, NFR-77, NFR-79, NFR-80)

Commits: `e729383` (tour pace), `26e60e0` (gilt outline), `a69f593` (banner, overlays, camera return, pinch). Tests written first and SEEN failing (module missing / assertions red) before each code step.

- FR-411 pace: `core/tour.ts` gets `TourPace = 'classic' | 'bell'` (`spec.pace`, `nominalEnd(..., pace)`), `BELL_PARAMS` in `tour-params.ts`, `viewChoice(..., pace)`, `TourRequest.pace`, `pacedFor(request, player)` in `live-view.ts`. Bell dwell = dmin + (dmax - dmin) (2(i-1) - (H-2))^2 / (H-2)^2: slowest at both ends, fastest in the middle. Ends: 12 stops 7,168 ms (classic 5,349, +34 %), 6 stops 4,625 (3,487, +33 %), absorber 3,225 (2,411, +34 %). **No golden changed**: classic stays the default; the live scene uses the bell pace only when a player is present (spectators keep the 009 pace). `tours.json`, `tour-frame-pins.json` and the 009 tests pass untouched.
- FR-408: `core/round-banner.ts` (state over the displayed round: starts only on +1 at the live edge, never on first sight, jump or replay; waits while the reveal/absorber tour runs; 3 s; dismiss) and the panel `round-banner` (one button: tap, Enter, Space; Escape also dismisses). One `after()` timer refreshes the panel when it ends. Reduced motion: `data-fade="off"`, no animation.
- FR-409: `core/round-overlay.ts` reuses `offerOf` (`closed` while phase 2 has no victim, `revealing` during the reveal tour); it names nobody. Shown to spectators too.
- FR-410: `core/camera-return.ts` + `live-main.ts`: `userMoved` is the one function for drag, wheel, minimap and pinch; `settleCamera` runs at the end of the absorber tour or of a step with no tour (never after the victim tour); a camera in the address counts as moved.
- FR-412: `core/pinch.ts` (ratio -> `cameraZoomed`, clamped) and the minimap pointer handling in `live-panel.ts` (two touches pinch; one drags).
- Outline (left from B): `core/pick-outline.ts` (`pickedColor` rule, `PICK_CLASSES` faction/coast/outer, gilt = token), `uPick`/`uPickColor` in `render/shader.ts` generated from the same class list, `MapScene.setPick`, `MapView.setPick`; `live-main` sets it from the sent choice (`pickedOf`). Not a pixel render test: rule + shader text + uniform are tested; the look is for the screenshots.
- Existing scans amended in `live-scans.test.ts` (skip handler now also dismisses the banner; `userCamera(` count 4 -> 3 as `userMoved` is the single path). `round-shell.test.ts` adds the part C scans.
- Mutants (affected files): 12 run, all killed after two extra tests (banner jump with a record, overlay stage guard).
- Result: `npm test` 327 files / 5130 passed, 4 skipped; `npm run typecheck` clean.

### Decisions the spec did not cover
1. Bell pace only with a player present (the instruction to keep the old pace otherwise). The live model's `absorberTourDecision` still budgets with the classic end; the view re-checks with the bell end (`viewChoice`), so a tour too long for its window is compressed or dropped there.
2. "Phase-2 window closed, before the reveal" read as stage `phase-2` with no victim yet (after the phase-1 close).
3. The camera return at "round end" = end of the absorber tour or a step played with no tour; a move by the user during the round keeps the camera for that round.
4. Outline covers only the perimeter lines (faction, coast, outer) on the chosen faction's side, off during a colour front.

### Untested / for the browser pass (not mine)
Banner look and 3 s timing, fade vs reduced motion, overlay position (desktop 110 px, phone 100 px), outline thickness/colour on the real map, bell pace feel, camera return, pinch on a real touch screen (multi-pointer capture), banner not blocking the minimap.

### Debug scene needs (screenshots 1280 x 720 and 390 x 844)
A match with a joined player: either the local server (`apps/server`, two profiles, fixed seed, host starts, a short pace such as Rápido) or a fake `PlayNet`/`fetch` serving `GET /config`, a lobby/running public match, the players read and the event stream with `schedule`, `victim-revealed`, `round-applied`, `results`. States to capture: phase 1 and 2 with a choice (outline), forced round, overlay "PREDICCIONES FINALIZADAS" (phase 2 before the reveal event) and "REVELANDO…" (during the victim tour), banner just after `round-applied` (and with `prefers-reduced-motion`), pinch on the phone minimap (emulated two-touch).

### Next step
Reviewer pass, then the browser screenshots (done criterion 2) and the hand run (criterion 3).

### Double-tap guard (reviewer fix)
`repeatsPick` (core/predict-model) blocks a tap that repeats an in-flight or already confirmed choice for the phase; `pick()` uses it. A different choice still goes through. Tests red then green; two mutants (in-flight, confirmed) killed. Full npm test and typecheck green (one earlier tour-pins-debug failure was a flake under load, green alone and on rerun).

## Screenshot-pass fixes
### 1. Lobby closed at once (blocker)
`lobbyAfterFrame` ignores a `schedule` event whose stage is `lobby` (the server emits it at seq 1 on creation and the stream replays from 0); stage `expired` reports `ended`; other stages still report `started`. Regression test uses the real fresh-lobby sequence (schedule lobby seq 1, then player-joined). Full npm test (327 files / 5136) and typecheck green. Test written together with the fix (not seen red separately).
### 2-4. Phone card, phone top bar and dock, desk command panel (one commit: they share one stylesheet and were edited together)
- Cause of the clipped phone join/lobby: the phone rule `top: 58px` beat the centring `top: 50%` but kept `translate(-50%, -50%)`, so the card moved up by half its height. The centred states (loading, start, error) now keep `top: 50%` on the phone; every `.hud-card` has `max-height: calc(100vh - 24px)`, border-box, and scrolls.
- Phone top bar is a grid (round + phase under it | countdown | chip): round never wraps, the phase label is shown (small, under the round), the chip shrinks with an ellipsis. Dock panes got padding on all sides.
- Orden tab: a second prediction renderer (`predictRenderer`) fills it for a player (own signature); the "available when you can play" note remains only for a page without a player session.
- Desk: `.hud-left` is now border-box and 280 px wide (its padding was added to the 262 px width and ran under the command panel, hiding the Conq. column); the command panel starts at 304 px; prediction and result sit side by side, track and buttons share a row, the title is hidden while a prediction is shown, max-height keeps it on screen. Expected height about 230 px instead of 400.
- Tests: CSS scans in play-shell.test.ts (rules, ordering, renderer wiring). apps/web tests 1870 green, typecheck green. Full npm test is rerun at the end of the series.
- NEEDS BROWSER RE-CHECK: phone-join, phone-lobby-guest, phone-* top bar (390x844, long names), phone Orden and Ranking tabs, desk-phase1/2-choice, desk-forced-round, desk-results (1280x720 and 1024 wide: the command panel wraps there).
### 5. Create screen touch targets, button wrapping, lobby layout
- Cause of the 36 px targets: `showStart` never set `data-layout` on its root, so the phone rules (44 px) did not apply. It now sets it; `.hud-input` has 44 px on the phone too. Buttons are `white-space: nowrap` and the link input shrinks, so "Compartir..." stays on one line.
- Lobby: two columns on the desk (players list left; share, personal link and "Empezar" right), one column on the phone.
- DEVIATION from the design: the lobby is not drawn over a dimmed map. The lobby has no map loaded (the map scene starts at the match), and loading it would mean a map read and a scene in the lobby, a bigger risk than this fix pass. It stays a centred card on the parchment.
- NEEDS BROWSER RE-CHECK: phone-create, desk-create, desk-lobby-host(-2players), phone-lobby-guest.
### 6. Small items
- "1 viva de N" singular (`hudAliveOfOne`).
- A phase-2 result with no row on a forced round says the forced absorber was applied (`resultForced`), not "No predijiste". The forced flag comes from the revealed victim of that round; if the victim was already cleared by the round being applied when the scores arrive, the old text still shows (best effort, not testable without the server order of `results` and `round-applied`: check in the hand run).
- Phase timer: `scheduleOf` makes the countdown (top bar and prediction block) read C2 and A of the revealed victim in phase 2 and locked, so a forced round (phase 2 = min(L1, F)) never counts to a stale C2. Unit test added. The "Ronda 0 de 4" seen in desk-forced-round is the debug scene before any round is applied; not changed.
- Full npm test (327 files / 5146 passed, 4 skipped) and typecheck green after this step.

## Second screenshot pass fixes
Final state: full `npm test` 327 files / 5162 passed, 4 skipped; `npm run typecheck` clean. One commit per group.
### 1. Forced-round result text (2193ab2)
- Cause (real server order): `round-applied` clears the revealed victim in the model, THEN `results` phase 2 is announced; a forced round has no absorber row. `forced` was read from `model.victim`, already gone, so "No predijiste" showed. The session now remembers forced rounds (`forcedRounds`, filled from every view of a forced victim) and `playHud` takes them. Failing test first (play-session.test.ts, real order: forced view, applied model without victim, `results` 2).
- Also: `withScores` keeps an already named scored phase over the rows' latest (a slow start read could move the panel back to the victim row). The victim row says "No predijiste" only when the player really has no victim row; if the debug scene player did predict, that was this race.
### 2. Phone dock, chip, ranking (bd0fa4c)
- Dock pane: one fixed height `clamp(250px, 37vh - 50px, 330px)` for every tab and state (about 37% of 844), tabs margin removed, `<p>` margins of the prediction block zeroed (these were most of the old height), no scrollbar when content fits. Open phase: prediction block + track + buttons (result and "Partida en directo" title hidden); no open phase: the result replaces the empty "Ahora no hay ninguna fase abierta" prediction (`data-offer` on the command panel).
- Chip: name and score are two spans; only the name ellipsizes (`chipParts`).
- State card on the phone starts at 168 px (under the minimap).
- Ranking: list scrolls inside the fixed pane; own row sticky, and pinned under the list (`mine`) when it is not on the page or not listed (name + total from the own scores, rank "-"). Tests in results-model, play-shell.
- NOT FIXED: the parchment band above the map is the camera framing a northern faction (FR-147 allows the centre on the map edge); removing it means changing the camera clamp, a spec 004/009 behaviour with tests. Needs a decision.
### 3. Desk panel (9e14d87)
- Compact controls (30 px buttons, 26 px dots), phase sentence hidden while a prediction shows, tighter paddings; estimated 1024 wide: about 230 px, 1280: about 190 px (CSS reasoning, not measured).
- Seal row reserved (hidden placeholder) while there is something to choose: no 30 px jump.
- Pick outline: extra shader band of `PICK_REACH` = 3 screen px inside the faction perimeter (4 probes, only for the picked faction), same gilt token. Shader not compiled here (no browser): check it compiles and reads well.
- Scrollbars: `.hud *` uses `scrollbar-color` with gilt-dim / umber tokens.
- Banner on the desk rides at max(90px, 18vh) so it never sits over the panel.
- Round mismatch: the top bar showed the drawn round (applied), the prediction block, results and chronicle the round in play (applied + 1). The bar now names the round in play at the live edge (phase-1, phase-2, locked; displayed = applied), else the drawn one. `panelView.round` (spec 009 FR-330/345, "round line already says k") is untouched; only `topBar` changed, and its 010 test was updated. Seen red? The new topBar test was written with the code (not run red first).
### 4. Small items
- Error line and "Solo mirar" have margins; share row no-wrap on the desk (buttons `flex: none`); dev footer links 32 px (44 px on the phone); `setPointerCapture` in try/catch.
### Needs a browser re-check
Phone dock heights (390x844, long name chip, 5+ factions in picks which scroll after 2 rows), ranking pane with a pinned row, desk 1024 panel height and button rows, shader outline compile and look, Crónica scrollbar colour, banner position, dev footer links, desk lobby "Compartir…" on one line.

## Third screenshot pass (browser loop, real server, Rápido/Lento public matches)
Verified in a real browser (chrome-devtools) against `apps/server/src/main.ts` with public creation, 6 bot players predicting, 390x844, 1024x720 and 1280x720.
### 1. Forced-round result (74fdf59)
- Real cause (logged the events the session received): the `victim-revealed` event HAS `forced: true`, but the live model built `PublicVictim` without it, so `model.victim.forced` was never true: the forced offer, `forcedRounds` and `resultForced` all depended on a field that never arrived. 2193ab2 fixed the wrong thing (order of `results` vs `round-applied`). Test written first and seen red (live-model.test.ts: the victim keeps `forced`). Verified: rounds 1/2/4 forced in real matches show "El absorbente estaba forzado..." on phone and desk, also after the round was applied.
### 2. Phone control row (0459bbd + follow-up)
- The five controls have short faces (`« ‹ › » Vista`, strings in core/strings.ts; the full words are the aria-label and tooltip). Dots and buttons are one row (`.hud-controls`, 44 px high, pinned to the bottom of the command block, command block min-height 212 so they do not move between states). The Partida pane no longer scrolls (262/262 in open, closed, results and finished); the chronicle list is hidden while a phase is open. The seal sits on the head row; the victim line is shown in phase 2.
### 3. Desk panel
- Measured at 1024x720: 135-215 px in every state (was 271-381), 5-6 controls in one row of 30 px at a fixed y (the Saltar button no longer wraps). The result is one line (title and totals line hidden on the desk: the chip already shows the total); when no phase is open it replaces the prediction block and may use two lines. 1280x720: 112-215 px.
- Also: chip gap ("Ana · 0 pts"), desk banner clears the winner card.
### Not done / notes
- After a layout change at run time (viewport resize) the result block was empty until the next update (seen once; not investigated).
- phone-phase1-choice, phone-phase1-picked, phone-phase2-* and desk-1024-phase2-* were captured just before the controls were wrapped in `.hud-controls` (pinned to the bottom): the rest is identical. The other images are from the final CSS.
- Screens whose names say "forced-round", "finished", "ranking" and (1024) "results" are the end-of-match state of a real forced round 4 (7 players ranked, own row pinned).

## Finalised beat and white outline (FR-409 amendment, 2026-11-10)
### 1. Beat (57f9b42)
- `core/finalised-beat.ts`: `BEAT_MS` = 2000 and pure `beatOf` (fresh close, live edge, round in play, not halted). The live model keeps `beat`; `phase-closed` starts it, frames that follow wait in `queue`, a `tick` at `beat.until` drains them (victim, tour, schedule or round-applied, absorber tour start then). `arm-timer` carries the beat end. Resync, public read, halt and fatal clear it. No beat for a replay (`displayed < applied`), an old close (reconnection replay) or a late join (no `phase-closed` is received).
- Nothing of the reveal is on the model during the beat; `offerOf` gives `finalised` (no pick, spectators see `not-joined`); `overlayOf` shows PREDICCIONES FINALIZADAS for everyone; `TourHold.finalised` holds scores/winners reads (a `results` frame arrives before the model sees the reveal). Phase 2: the close beat shows the overlay while the stage is `locked`; the absorber stays hidden if `round-applied` comes inside the beat (L2 = 0).
- Tests: `test/finalised-beat.test.ts` (seen red: missing module, then green), play-session hold, scans. Existing harnesses moved with it: Driver (`beats` flag, auto-release), live-runner `releaseBeats`, live-net watcher, and OUTSIDE apps/web `apps/server/test/helpers/viewer-kit.ts` (beats run out at once on the frozen manual clock) and one assertion each in `viewer-tour.test.ts` (tour `at` is one beat after the frozen clock). Needs the user's OK: the diff leaves apps/web.
- Browser (real server, Rápido 30 s, 4 rounds): beat on screen 2,002-2,060 ms at phase 1 close and 2,050 ms at phase 2 close (polled every 25-50 ms), then REVELANDO… 5.3 s, then phase 2. No victim, highlight or chronicle line during the beat (desk and phone). Screens: beat-desk-finalised, beat-desk-finalised-phase2, beat-desk-revealing, beat-phone-finalised.
### 2. White outline
- `PICK_WHITE` replaces the gilt (band of 3 px and perimeter classes unchanged). Checked in the browser on España (ochre), Francia (green), Italia (purple), desk and phone: readable on all; against the neutral grey land it is weaker but visible. No dark hairline added. Screens: outline-white-*.png.
- Phone: the overlay used to overlap the minimap; now left-aligned, `max-width: calc(100vw - 130px)` (right edge 268 px < minimap 278 px). CSS changed before its test was written (test pins the rule).
### Not done
- The phase-1 countdown reads 0:01 during the beat (the clock offset), not 0:00. Controls row on the phone dock shows only two arrows in the Orden-less open-phase state (seen in captures, not touched).

## Real-phone fixes (FR-434..436, 2026-11-11)
### 1. Pinch (4898b1f)
- `core/pointer-gesture.ts` (pure): fingers map + anchor re-taken whenever a finger lands or lifts (no jump); one finger pans (`panTo`), two zoom about the midpoint and pan with it, inside `clampCamera`/`scaleLimits`; `multi` flag keeps a pinch from ending in a tap. `ui/input.ts` uses it (mouse and wheel unchanged), `setPointerCapture` in try/catch, Safari `gesturestart/gesturechange` prevented on the canvas, `overscroll-behavior: none` on the page body. HUD panels keep their own scrolling (touch-action only on the canvas). Tests: test/pointer-gesture.test.ts (seen red: missing module).
- Browser (390x844 mobile+touch emulation, synthetic two-pointer PointerEvents): debug scene zoom 0.461 -> 4.151 on spread and back to the fit scale on close; live match zoom 0.190 -> 0.476. Screens: pinch-zoomed-in, pinch-live-phone. NOT tested on a physical phone; no tap-after-pinch run in the browser (covered by unit test only).
### 2. Forced rounds (d5d102f, 6e16ae3)
- Cause: phase 2 of a forced round is 5 s; the 2 s finalised beat leaves a budget of C2 - estimate - 1000 = 2000 ms; classic (5,349) and bell victim tours need >= half of their length, so the tour was skipped as too short; the absorber tour was skipped for d = 1 (`no-candidates`).
- Victim: `VictimInput.forced` (from `victim-revealed.forced`) -> decision/effect/`TourRequest` carry `forced`; `viewChoice(..., forced)` never skips: it plays in the time left, at least 1,800 ms (`squeeze`: `buildTour` accepts a budget below half). Non-forced rounds unchanged.
- Absorber: one candidate plays a short absorption (`TOUR_PARAMS.single`, hold 1,700 + fade 300 = 2,000 ms, one stop, camera frames victim + absorber then returns to the overview); reduced motion shows the result at once; `overviewAfter` of the last victim tour only when no candidates are held.
- Test changes by the new rule: tour-plan (`[13]` plays), live-model-tour (a d = 1 round has a tour, so complete-tour appears where it did not), live-view-tour, and OUTSIDE apps/web `apps/server/test/viewer-tour.test.ts` (two filters `>= 2` -> `>= 1`). Needs the user's OK.
- Browser (real server, Rápido, rounds 2-4 forced): victim reveal on the canvas: dimmed map, highlight changes between factions over about 1.4 s, camera eases onto the victim; absorption: dim with victim and candidate lit, camera back to overview in about 1.7 s, then the colour front. Screens: forced-sheet-round2/3 (200-300 ms contact sheets), forced-absorb-sheet-round3/3b.
### Not done / notes
- The applied round of a forced match reaches the viewer about 3 s after the phase-2 close (the next round's phase 1 starts as it plays): server timeline, untouched.
- Contact sheets come from a recorder with `preserveDrawingBuffer`; plain screenshots were too slow for a 2 s animation.

## Map name font and earlier provinces on phones (FR-437, FR-438, 2026-11-11)
### 1. Bundled font (FR-437)
- Noto Sans weight 600, latin + latin-ext woff2 in `public/fonts` (13 KB + 60 KB). Source: Google Fonts CSS API (Chrome user agent), files `https://fonts.gstatic.com/s/notosans/v42/o-0mIpQlx3QUlC5A4PNB6Ryti20_6n1iPHjcz6L1SoM-jCpoiyAjBO9a6VI.woff2` (latin) and `...BO9U6VLKzA.woff2` (latin-ext). Licence: SIL OFL 1.1, text from `https://raw.githubusercontent.com/notofonts/latin-greek-cyrillic/main/OFL.txt` saved as `OFL-NotoSans.txt`.
- `LABEL_PARAMS.font.families` is now `['"Noto Sans"', 'sans-serif']` (the generic family is only the failure fallback). `render`-independent `ui/map-font.ts` declares the @font-face (not in the HUD CSS, so the debug scene loads it) and `ensureMapFont()` awaits `document.fonts.load` for both subsets (no timer: the timer scan allows `setTimeout` only in live-timer; a failed load resolves and the generic fallback is used). Awaited in `main.ts` (debug) and in `live-main.ts` `open` before any view exists, so aspects (map-view) and advances are measured with the real font.
- `fontEpoch()` moves when fonts settle; map-view puts it in the view (`MapView.fonts`) and the label layer drops its glyph-advance cache when it changes.
- Pins changed ONLY for the family string: `label-centre.test.ts` and `label-review-set.test.ts` (LABEL_PARAMS pins). No golden changed.
### 2. Detail scale (FR-438)
- `core/detail-scale.ts`: `detailFactor(image, vp) = min(1, fit/fit_ref)` (ref 1280x720; 1 for a degenerate input) and `scaledFade(params, k)`. Used by the label layer (`MapView.detail`) and by the shader uniform in `map-scene.setView` (territory lines), so names and lines fade in together. Desk and larger: factor exactly 1, same numbers (no golden or pin moved). The reference CPU renderers (`borders.ts`, `transition-shade.ts`) are not used by the page and were left on the base thresholds.
- minPx (9) stays: a name is still not drawn below 9 px even when its fade has started, so on a phone the small provinces appear a little after the big ones, never unreadable. `tour-camera` still bounds the framing by the base `fadeStart`; at phone fit this is above the scaled value only for large framings: not changed.
### Browser (chrome-devtools, debug scene seed 1 round 0; 390x844 dpr 2.75 mobile+touch Android UA, and 1280x720)
- Image 2048 px: phone fit 0.19, desk fit 0.352, factor 0.54: provinces fade in at 0.81..1.08 on the phone. Before: phone at zoom 0.9 shows no province line or name; after: lines and names visible with the faction names fading. Desk at 1.7 shows provinces both before and after. Phone and desk names now use the same Noto Sans (`document.fonts` reports both faces loaded).
- Note: the emulated Chrome still has Segoe UI on this Windows PC, so the Android fallback itself was not reproduced; the fix removes the dependency. NOT tested on a physical phone.
- Screens (specs/013-playable-interface/screens): labels-phone-before/after, labels-desk-before/after, provinces-phone-before-z0.9, provinces-phone-after-z0.9, provinces-desk-z1.7 (before) and -after.
- Tests: new detail-scale.test.ts, map-font.test.ts, two in labels-render.test.ts (seen red first); full `npm test` 5224 passed, typecheck green.
