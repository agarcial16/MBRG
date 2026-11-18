# Plan 025 — Per-Discord-server ranking
Spec: `spec.md` (approved 2026-11-18). Status: draft (presented 2026-11-19). Milestones: M1 protocol + store reads + pure core, M2 service + route + proofs, M3 bot + e2e. Stacks on the code of 024 (community key, counted matches, history order, snapshot paging, body transport). No schema change (NFR-125).

## 1. Files and responsibilities
- `packages/protocol/src/read.ts`, `wire.ts`: `readRankingRequest` (body `{ community, order?, playerId?, limit?, cursor? }`; `order` one of `points` (default), `correct`, `wins`, `accuracy`; `playerId` is the local id, as the 008 own-predictions read). FR-563 (shape part), FR-565 (shape part), FR-573.
- `packages/protocol/src/page.ts`: cursor list `ranking`, key `[headFinishedAt, headMatchId, localId]` — an identity keyset (see PD3). FR-565 (cursor part).
- `packages/protocol/src/encode.ts`, `decode.ts`: `RankingRow`, `RankingPage` (008 page shape plus `total`), `asker`. FR-563 (wire part), FR-567 (wire part).
- `apps/server/src/store/sqlite.ts`, `store.ts`: `rankingResults(key, namespace, head)`, `rankingNames(key, namespace, head)`; no schema change. FR-564 (read part), NFR-125 (store part).
- `apps/server/src/core/ranking.ts` (new, pure): statistics, won rule, shown name, order, ranks, keyset slice, asker row. FR-563 to FR-567.
- `apps/server/src/service/matches.ts`: `ranking(request)`; `apps/server/src/http/server.ts`: route `POST /ranking`. FR-563 to FR-568.
- Bot: `discord/translate.ts` (`ranking` subcommand with an order word), `core/actions.ts`, `core/ranking.ts` (new, pure embed), `core/custom-ids.ts`, `io/boards.ts` (ranking walks), `io/server-client.ts`, `io/handler.ts`, `core/strings.ts`. FR-569 to FR-571.
- `apps/bot/test/e2e/`: ranking step. FR-572.

## 2. Reads (no schema, NFR-125)
- `rankingResults`: ONE statement — `communities INDEXED BY communities_by_key` → `matches` by primary key (`stage = 'finished'`, head bound "at or after" as the history read) → `results` through their existing per-match key, aggregated per (match, player): match id, finish instant (`last_step_ms`), player id, points, correct, scored. A counted match with no scored result contributes no row (nothing is played or won through it).
- `rankingNames`: ONE statement over the same counted matches joined to the 022 names; names of matches in any other stage are never read.
- Statements per page: 2, whatever the stored matches; a counting store wrapper pins 10 vs 1,000 counted matches. `EXPLAIN QUERY PLAN`: no `SCAN` of `matches`, `results`, `communities` or the names table.
- `total` and the asker row are computed by the core from the same rows; no extra statement, nothing written, nothing memoised.

## 3. Pure functions
- `statsOf(matchRows)`: per player total points, correct predictions, scored predictions, matches played, matches won; a match is won by every player with points above 0 equal to that match's maximum. FR-564.
- `shownNameOf(names)`: the name of the most recent counted match in history order that stored one for the player. FR-563.
- `rankRows(stats, order)`: competition ranking by the order statistic descending, then total points descending, then player id ascending; accuracy ranks only qualified players (at least 10 scored predictions) by exact fractions; the rest follow in one unranked tail by points, then id, still counted in the total. The keyset comparator is `(segment, primary, points, id)`, `segment` 0 ranked, 1 tail. FR-565, FR-566.
- `pageOf(rows, after?, limit)`: keyset slice anchored to the snapshot head; `next` only when a row lies beyond the page. FR-565, FR-567.
- Bot `core/ranking.ts`: `rankingEmbed(page, ctx)` (rows, the "Tu puesto" line, the accuracy note, "Página N/M", buttons), `rankingEmpty()`, `rankingUnavailable()`, `floorPercent`. FR-569, FR-570, FR-571.

## 4. Interface
- `POST /ranking`, `Authorization: Bearer <client credential>`, body `{ community, order?, playerId?, limit?, cursor? }` → `200 { items, total, next?, asker? }`. Same rules as `POST /history` (FR-568): non-client callers get the forbidden bytes; another namespace or an unknown key gets `{ items: [], total: 0 }`; nothing stored or memoised; the key never in a reply, header or log line.
- Row: `{ playerId, name?, points, correct, scored, played, won }`. `asker` (named by `playerId`) = the row plus its `rank` (no `rank` when unqualified in the accuracy order) or `{ played: false }`.

## 5. Decisions (discarded alternative)
- PD1 Ranking computed at read time from `results`; no aggregate table. Discarded: a stored per-community aggregate (a schema change, forbidden by NFR-125, and a new write in the pinned step transactions).
- PD2 Two statements per request (results, names), aggregation in the pure core. Discarded: per-match read loops (the statement count would grow with the community) and full SQL aggregation (the won rule and the shown-name rule would stop being pure, NFR-126).
- PD3 Identity keyset: the cursor names the snapshot head and the local id of the row the page ended on; inside a snapshot the rows, their statistics and every order are frozen (a counted match is immutable and a newer one is excluded by the head bound), so the local id identifies the row's place in any order. Discarded: the row's order values in the key (the longest such key overflows the 256-character cursor limit) and a second list for the accuracy tail (two cursors to keep consistent inside one walk).
- PD4 Order words only in the bot (`puntos`, `aciertos`, `victorias`, `precisión`); the wire takes the enum. Discarded: Spanish words on the wire (the protocol stays language-neutral).
- PD5 Accuracy compared as exact fractions (cross-multiplied). Discarded: floating point (equal accuracies of different fractions could drift) and rounded percentages (199/200 would tie with 99/100).
- PD6 The cursor stack lives in the bot's memory per message, as 024 PD5.

## 6. Tests (Vitest)
- Protocol: request reader (orders, malformed members by name, repeated members), cursor round-trip and refusal (another list, a re-encoded text, the tail segment), encode/decode, digest pins of bodies without `community`.
- Core: statistics and the won rule (a three-way tie at the top, an all-0 match nobody wins but everyone played), the shown name (latest counted match, other stages ignored), orders and ranks (competition ranking, 9 vs 10 scored predictions, 1/2 vs 5/10, 199/200 shown as 99 %, the unranked tail), keyset walks (no repeat, no skip, no empty trailing page), the asker (rank, unranked in accuracy, no row).
- Store: argument checks, head bound, closed-file read, query plans (no `SCAN`), statement count 10 vs 1,000 counted matches, matches of other stages never read.
- HTTP real server: pages of 10 with `total` against the leaderboard oracle, a walk across a match that finishes in between, forbidden bytes, isolation twins, log scan, no storage or memoisation, source scan (`communities` read only by the history and ranking reads).
- Secrecy twin: a running match of the same community with predictions scored and a planted 022 name differing from the finished matches'; byte-identical replies before and after each of its steps, in every order.
- Bot: order words, worst-case embed (017 NFR-94), empty, unavailable, direct-message rule; the e2e step of FR-572.
- Ledger: ranges FR-563..FR-572 and NFR-123..NFR-126 with `PENDING_025`.
