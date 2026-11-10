# PROGRESS 015 (visual refresh)

## Logic part (FR-427, FR-430 rule, FR-432, FR-433) - no browser
Changed
- FR-427: chip text is name + points ("Ana · 0 pts"), no "Tú:" and no rank; points show from the start (0 before any score). `chipParts(name, total)` drops the rank; `chipText` (accessible label) keeps `· puesto N` when known. Strings: `chipName` '{name}', `chipStats` ' · {total} pts', new `chipRank`.
- FR-432: `completeBoard(rows, roster)` in `core/results-model.ts` adds every joined player missing from the server rows with 0 points, orders by points, rank = 1 + players with more points (ties share the rank). `PlayState.lobby` (the lobby model) holds the roster: read once in `start()` of `ui/play-session.ts` (one extra `players` read, no polling) and updated by `player-joined` frames in `onFrame` (no request). Panel and Ranking tab share `PlayHud.board`, so both get it. Server untouched.
- FR-433: verified existing behaviour (own row 'name (tú)' via `boardYou`, pinned under the list, fallback row when unlisted); pinned by new tests.
- FR-430 (rule only): removed `border-top` of `.hud-predict` in `ui/live-panel-style.ts`. No scan pinned it before; added a test that the rule has no border.

Tests: red seen first (13 failing), then `npm test` 327 files / 5176 passed, 4 skipped; `npm run typecheck` clean.

Untested (no browser): how the chip and the longer board look; FR-422..426, 428, 429, 431 (CSS/visual) not started.
Next: the visual tasks, by someone with a browser (chip box height/centering FR-428/429 now has a shorter text, check ellipsis of name vs " · N pts").
