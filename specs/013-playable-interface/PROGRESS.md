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
