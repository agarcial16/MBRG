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
