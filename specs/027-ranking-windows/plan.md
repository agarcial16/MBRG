# Plan 027 — Ranking by time window
Spec: `spec.md` (approved 2026-11-20). Status: approved (by the user on 2026-11-20). Milestones: M1 protocol + store bound + pure core, M2 service + route + proofs, M3 bot + e2e. Rides on the code of 025 (ranking read, cursor, bot command) and 024 (community key, settled head). No schema change; the reply shape is 025's (OQ5 B).

## 1. Files and responsibilities
- `packages/protocol/src/wire.ts`, `read.ts`: `RANKING_PERIODS = ['all', 'last-7-days', 'last-30-days']`, member `period` in `RANKING_FIELDS` (after `order`); `readRankingRequest` reads it (PD1, PD2). FR-575, FR-578 (reader part).
- `packages/protocol/src/page.ts`: the `ranking` key gains a windowed form (PD3). FR-578.
- `encode.ts`, `decode.ts`: unchanged (reply unchanged).
- `apps/server/src/store/sqlite.ts`, `store.ts`, `faults.ts`: optional `floor` on `rankingResults` and `rankingNames` (PD4). FR-577 (read part), NFR-130.
- `apps/server/src/core/ranking.ts` (pure): `PERIOD_LENGTH_MS`, `periodFloorOf(period, now)`, `isInPeriod(finishedAt, floor)`. NFR-131.
- `apps/server/src/service/matches.ts` (`ranking`), `http/server.ts` (`POST /ranking` passes `period`). FR-576 to FR-579.
- Bot: `discord/translate.ts` (option `period`, choices `semana`, `mes`), `core/actions.ts`, `core/ranking.ts` (period words, titles, sentences), `core/strings.ts`, `core/model.ts` + `io/boards.ts` (the walk keeps its period), `io/server-client.ts`, `io/handler.ts`. FR-580 to FR-584.
- `apps/bot/test/e2e/`: period step. FR-585.

## 2. Store bound (OQ4 A)
- Both reads gain one optional trailing parameter `floor?: number` and one condition `AND (? IS NULL OR m.last_step_ms >= ?)`: NULL turns it off, so the all-time call reads the same rows as 025. A floor is a safe integer (it may be negative under a test clock near 0); anything else is a RangeError.
- Statements per page unchanged (head read on the first page, results, names); the service still makes exactly 5 store calls to community reads (pinned by the source scan). `EXPLAIN QUERY PLAN` unchanged: the floor filters rows reached by `communities_by_key` and primary keys, no new index, no `SCAN`.
- Names take the same floor: a name stored only outside the window is never read (FR-577).

## 3. Pure core
- `PERIOD_LENGTH_MS`: 7 × 86,400,000 and 30 × 86,400,000; `periodFloorOf('all', now)` is undefined, otherwise `now - length` (`now` in whole ms, passed in). `isInPeriod(at, floor)`: `floor === undefined || at >= floor` — the oracle of every test.
- `statsOf`, `shownNameOf`, `rankingOf` unchanged: they fold whatever rows the bounded reads return, so qualification, ranks, tail, total and asker are measured inside the window (OQ3 A).

## 4. Service and interface
- Request body `{ community, order?, period?, playerId?, limit?, cursor? }`; reply `{ items, total, next?, asker? }` unchanged.
- Service (pseudocode):
  ```
  if after: head = after[1..2]; floor = after[5] (undefined for a 4-part key)
  else: now = wholeMs(clock.now()); head = historyAfter(now - TOLERANCE_MS, limit 1)[0]; floor = periodFloorOf(period, now)
  no head -> { items: [], total: 0 }
  rows = rankingResults(key, ns, head, floor)
  windowed and rows empty -> { items: [], total: 0 }            // FR-579, PD5
  cursor names no row of rows -> { items: [], total: 0 }        // 025 rule
  page = rankingOf(statsOf(rows), shownNameOf(rankingNames(key, ns, head, floor)), ...)
  next = all ? [order, headAt, headId, localId] : [order, headAt, headId, localId, periodIndex, floor]
  ```
- The service request takes `period?` (absent = all) and rechecks that a cursor's period equals the request's (defence in depth).

## 5. Decisions (discarded alternative)
- PD1 Rolling windows from the server clock (OQ1 A). Discarded: calendar weeks/months (a time zone to choose; empty on Monday morning).
- PD2 Wire member `period`, values `all`, `last-7-days`, `last-30-days`; the reader drops `all`, so no member and `all` give the same decoded request. Discarded: a member named `window` — the purity scans of `packages/protocol/src` and `apps/server/src/core` forbid that identifier (browser global), and weakening a guard for a name is wrong.
- PD3 The windowed cursor is a 6-part key `[order, headAt, headId, localId, periodIndex (1|2), floor]`; an all-time walk keeps the 025 4-part key, so 025 cursors keep working and an all-time `next` is byte-identical (NFR-129). A 6-part key with index 0 is not a key. A period mismatch either way is `invalid-request ['cursor']`, as the order mismatch. Longest windowed cursor (64-character ids, negative floor): 178 JSON characters, 238 base64url, under 256. Discarded: a separate `ranking-period` list (a new list tag and a second decode path) and always a 6-part key (changes every all-time cursor).
- PD4 The floor is a parameter of the two existing reads. Discarded: two new windowed reads (duplicate SQL and tests, and the 5-call source scan would grow).
- PD5 The floor comes from the injected clock at the first page and travels in the cursor; the request never carries it (FR-575). The same clock reading gives the settle bound and the floor. A windowed snapshot with no row answers the bare empty reply, even when the request names a player (FR-579: identical to an unknown key); the all-time path keeps 025's `asker: { played: false }` in that case (NFR-129). Discarded: recomputing the floor per page (rows would leave the window mid-walk).
- PD6 Bot: the window words are a second optional option `period` (English name like `order`, Spanish choices), sent on the wire only when not all time, so an all-time body is byte-identical to 025's. Discarded: always sending `period: 'all'` (an older server would refuse it).

## 6. Tests (Vitest)
- Protocol: reader (three values, `all` equal to absence, other values named, repeated member), windowed cursor round-trip, longest cursor length, refusals (index 0, 5 or 7 parts, mismatch both ways); the 025 tests green.
- Core: floor and membership (at the floor in, 1 ms before out), 9 vs 10 scored inside a window with more outside.
- Store: bound, head older than floor gives `[]`, names outside never read, query plans, argument checks.
- HTTP real server, injected clock: pages per period against a leaderboard oracle filtered by `isInPeriod`; a walk across a clock advance of 31 days; empty-reply bytes; log scan; nothing stored.
- Twins: secrecy and isolation per period. Bounds: 1,000 matches over 60 days. Compatibility: no `period` and `all` byte-identical to the 025 reply, cursor included.
- Bot: option, titles, sentences, worst-case embed, paging keeps the period, e2e step. Ledger: FR-575..FR-585, NFR-127..NFR-131 with `PENDING_027`.
