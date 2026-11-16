# Progress — spec 019 viewer leaderboard at scale

Light SDD, `apps/web` only. Branch cut from `feat/019-viewer-leaderboard`. Spec approved 2026-11-16 (see `spec.md`).

## Task 1 — measurement plan (before any change)

How: `apps/web/test/board-measure.test.ts` (manual: `MBRG_MEASURE=1 npx vitest run apps/web/test/board-measure.test.ts`, skipped in `npm test`) drives today's `createPlayNet().leaderboard()` + `players()` against `test/helpers/board-server.ts` (synthetic players: accented and long names, 40 distinct totals so ties are common, 90% scored, paged with `limit`/`cursor` and a generation like the real server), then times `completeBoard` and `boardPage` (median of 9, Node 24). The DOM and the click were read in the built-in browser pane on the debug scene (`board-debug` launch config: dev-map match, seed 7, 3 rounds applied, 1,000 players) as a spectator (`spectate=1`), desktop 1024 x 768.

| N | requests per full read (board + roster) | KB | merge + sort + rank (ms) | page slice (ms) | rows held |
|---:|---:|---:|---:|---:|---:|
| 20 | 2 | 4 | 0.02 | <0.01 | 20 |
| 200 | 2 | 37 | 0.11 | <0.01 | 200 |
| 1,000 | 4 | 189 | 0.32 | <0.01 | 1,000 |
| 10,000 | 38 | 1,922 | 4.6 | <0.01 | 10,000 |

Browser, N = 1,000: panel DOM = 47 nodes (10 rows + pager + title, constant at any N); a click on "Siguiente" rebuilt the column in 2.9 ms (the whole `replaceChildren`, so the keyboard focus is lost); the roster is read once, the leaderboard again after every scored phase (at 10,000: 18 requests, about 1 MB, each phase).

Findings:
- The cost of today's panel is the network and memory, not the paint: 10,000 players means 38 requests and about 1.9 MB before the first row shows, 20 requests (about 1 MB) per scored phase, and 10,000 rows kept and re-sorted on every refresh.
- A spectator without a player session DOES see the leaderboard today (verified in the browser with `spectate=1`: the right column filled with the board). Decision 3 of the spec needs no fix.
- At 360 px with long names: not measured in this task (done with the screenshots).

### Figures fixed for NFR-105 (checked after the change, at N = 1,000 and 10,000)
- DOM of the panel: at most 60 rows (the window is 24 to 40 rows; hard cap 60), at any N.
- Opening a match reads ONE leaderboard page (limit 500), no roster; at 10,000 players that is 1 request, about 70 KB, instead of 38 and 1.9 MB.
- Paint of a window (the rows in or near the view, patched by key): at most 4 ms median and 8 ms worst of 20 at N = 10,000 in Node (a frame is 16.7 ms, the rest is for the browser).
- Merge of a loaded page into the model: at most 5 ms per page of 500 at N = 10,000, no sort of the whole list (the server order is kept).
- The per-second refresh builds or moves no row: 0 DOM writes when nothing changed (counted in the test).

## Task 2 — tests first, then the code

- Pure modules and tests: `core/board-window.ts` (`test/board-window.test.ts`: cap of 60 rows at any size, offsets, scroll-to-row), `core/board-model.ts` (`test/board-model.test.ts`: cursor paging on demand, `stale-cursor` restart, retry with no request loop, ranking with ties across page borders, tail of 0-point players, accent-insensitive search over scored and roster, 20-page cap, go-to-my-place with cancel and cap, secrecy by `boardFrozen`), `test/board-session.test.ts` (the session over the real `PlayNet` and the synthetic server: one page on open, refresh from the first page, stale cursor mid-scroll, hold during a tour, jump, retry, search).
- Code: `ui/board-panel.ts` (windowed DOM patched by key, search, go-to-my-place, pinned row, loading/retry row, keyboard: the scroller is focusable), CSS in `live-panel-style.ts`, strings, `ui/live-net.ts` (`leaderboardPage`, `playersPage`; the all-pages leaderboard read of the player screen is gone), `ui/play-session.ts` (the read pump; no read while a tour holds), `core/play-view.ts` (`board` state replaces rows/page; no per-second sort), `results-model.ts` (old `boardPage`/`completeBoard` removed with their tests).
- Decisions: the roster is read lazily, only after every scored row is read (search, scroll to the end, go-to-my-place); the viewer's rank in the pinned row shows "-" until the list holds their row (the server has no rank lookup, out of scope); a read that is still in flight when a refresh starts is dropped; the first read waits while a tour holds (stricter than before).
- `npm test` all tests green; `npm run typecheck` clean; nothing under server, protocol or bot changed.

### After the change (Node, `MBRG_MEASURE=1 npx vitest run apps/web/test/board-measure.test.ts`)
| N | requests on open | KB on open | merge of a page (ms) | window of rows (ms) | rows held |
|---:|---:|---:|---:|---:|---:|
| 1,000 | 1 (was 4) | 67 (was 189) | 0.09 | <0.01 | 500 |
| 10,000 | 1 (was 38) | 66 (was 1,922) | 0.09 | <0.01 | 500 |

Browser (debug scene, 1,000 players, spectator and player): DOM of the panel 15 to 76 nodes, 17 to 21 rows at any scroll position (cap 60); a MutationObserver over the panel saw 0 mutations in 3.5 s of per-second HUD ticks; the focus stays on the own row after "Ir a mi puesto" (aria-label "Puesto 51, ... (tú)"); search "MARIA garcia 1" listed the 2 matches with their ranks. All NFR-105 figures are met.

### Visual evidence and what is not verified
- Desktop 1024 x 640, 1,000 players, fixed scene (seed 7, round 3): top with the own row pinned, own place after "Ir a mi puesto", middle (rank 476, pinned row visible) and a search result were seen in the built-in browser pane and read as correct.
- 360 px: the pane's screenshot tool was unreliable at that size (tiled or cropped images); the top view with the dock's Ranking tab was seen, and the own-place and search views at 360 px were checked by DOM measurement only (no horizontal scroll, 44 px controls, names with ellipsis and a `title`), not by eye. Not screenshotted: search at 360 px, own place at 360 px.
- Not verified: real screen reader, touch scrolling on a device, behaviour against the real `apps/server` (only the synthetic server, which mimics its cursor and `stale-cursor`), a 10,000-player run in the browser (Node only).

## Task 3 — review (reviewer agent, Sonnet)
Verdict was "changes needed"; fixed: (1) the 20-page cap now survives typing more characters (`boardQuery` keeps the page count of a running search); (2) every read carries an epoch and a reply of an earlier refresh is dropped, first page included; (4) a refresh keeps as many rows as were loaded (tail included) so the list does not shrink; (5) refresh pages no longer count against the seek cap. Tests added in `board-model.test.ts`. Not changed (noted): (3) while a tour holds, scrolling past loaded rows, searching or "Ir a mi puesto" show "Cargando…" / "buscando…" until the tour ends (secrecy first); the retry button is rebuilt on a version change; the pinned row repeats while a search lists the own row.
Final: `npm test` 349 files, 5,513 passed; `npm run typecheck` clean.
