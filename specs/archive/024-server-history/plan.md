# Plan 024 — Per-Discord-server match history
Spec: `spec.md` (approved 2026-11-18). Status: approved (by the user on 2026-11-18). Milestones: M1 key at creation + schema v5, M2 history read, M3 bot + e2e.

## 1. Files and responsibilities
- `packages/protocol/src/wire.ts`, `read.ts`: optional `community` in the creation body (64 lowercase hex), in `CREATION_FIELDS`; `readHistoryRequest` (body `{ community, playerId?, limit?, cursor? }`; `playerId` is the local id, as the 008 own-predictions read). FR-546, FR-573.
- `packages/protocol/src/page.ts`: cursor list `history`, key `[headFinishedAt, headMatchId, finishedAt, matchId]`. FR-549.
- `packages/protocol/src/encode.ts`, `decode.ts`: `HistoryEntry`, `HistoryPage` = the 008 page shape plus `total`. FR-549, FR-550, FR-551.
- `apps/server/src/http/body.ts`: a repeated `community` member is refused by name (as `joinPolicy`, 018). FR-546.
- `apps/server/src/core/policy.ts`: `creationPolicy` takes the key: only a client credential with `joinPolicy: 'client'`; else `invalid-request` naming `community`. FR-545.
- `apps/server/src/core/history.ts` (new, pure): history order, snapshot test, entry from ranked leaderboard rows (top 5 above 0, `more`, player count, asker row). FR-549, FR-550, FR-551, FR-561.
- `apps/server/src/store/schema.ts`, `sqlite.ts`, `store.ts`: schema v5, `insertCommunity`, `historyAfter`, `historyCount`, purge. FR-547, FR-560.
- `apps/server/src/service/matches.ts`: key stored in the creation transaction; `history(request)` read. FR-545, FR-549 to FR-553.
- `apps/server/src/http/server.ts`: route `POST /history`. FR-552, FR-573.
- Bot: `io/community.ts` (new: SHA-256 of the guild id), `discord/translate.ts` (reads the guild, passes only the key; `history` subcommand), `core/actions.ts` (`history` interaction and action), `core/history.ts` (new, pure embed), `core/custom-ids.ts` (`mbrg:hs:p|n:<page>`), `io/boards.ts` (history walks), `io/server-client.ts`, `io/handler.ts`, `core/strings.ts`. FR-548, FR-554 to FR-559.
- `apps/bot/test/e2e/`: history step. FR-562.

## 2. Schema v5 (FR-560)
`communities (match_id TEXT PRIMARY KEY REFERENCES matches(id), community TEXT NOT NULL)` + index `communities_by_key (community, match_id)`. Upgrade v1..v4 adds only this; a fresh file creates v1..v5; v6 refused. Written once at creation, never updated (FR-547); `purgeExpired` deletes it with its match.

## 3. Reads (FR-549, FR-561, NFR-121)
- `historyAfter(key, namespace, settledBefore, head?, after?, limit)`: `communities` by key, joined to `client_matches` (namespace) and `matches` (`stage = 'finished'` and `last_step_ms < settledBefore`; the service passes the clock minus `TOLERANCE_MS`: a match that finishes after a read then always sorts newer than the head that read took), ordered by `last_step_ms DESC, id ASC`, keyset after `after`, bounded by `head`. Finish instant = `matches.last_step_ms` of a finished match (no step follows the last application; a test pins it equal to that step's instant).
- `historyCount(key, namespace, settledBefore, head)`: same filter, `COUNT(*)`.
- Per entry: the existing `leaderboardTotals` + `rankLeaderboard` + `clientNames`. Statements per page: 2 + 2 × entries (at most 12), whatever the stored matches.
- First page: head = its first entry; the cursor carries head and the last key. Total = count at or after head.

## 4. Pure functions
- Server `core/history.ts`: `compareHistory(a, b)`, `withinSnapshot(key, head)`, `entryOf(match, ranked, names, askerId?)`.
- Bot `core/history.ts`: `historyEmbed(page, ctx)` → `OutMessage` (embed, plain fallback, buttons); `historyEmpty()`; date `<t:SECONDS:d>`; each entry's viewer link without a round, so the viewer opens the match's last round.
- Bot `io/community.ts`: `communityKey(guildId)` = lowercase hex SHA-256 of the guild id text (ASCII).

## 5. Interface
- `POST /history`, `Authorization: Bearer <client credential>`, body `{ community, playerId?, limit?, cursor? }` → `200 { items, total, next? }`. Not memoised, stores nothing. Non-client caller: `forbidden`. Unknown key or other namespace: `{ items: [], total: 0 }`.
- Entry: `{ matchId, mapId, finishedAt, winner, playerCount, top: [{ playerId, name?, points, rank }], more, asker? }`; `asker` (with `playerId` only) = `{ points, rank }` or `{ played: false }`.

## 6. Decisions (discarded alternative)
- PD1 Finish instant from `matches.last_step_ms`, no write at finish. Discarded: a `finished_ms` column set by the last step (adds a write to the pinned step transactions).
- PD2 Separate `communities` table. Discarded: a column on `client_matches` (rewrites an existing table).
- PD3 Snapshot head in the cursor; total counted up to the head. Discarded: totals without snapshot (N/M drifts) and `stale-cursor` (forces restarts).
- PD4 POST read with the key in the body. Discarded: GET query (access logs, constitution §5) and a custom header (no precedent).
- PD5 The bot keeps the pages it has SHOWN, each with its own `next` cursor, in memory per message: page 1 has no cursor (asking for it again opens a new snapshot), Previous and a repeated Next answer from memory with no request. Discarded: cursor in the button id (100-character limit, cursor up to 256) and a bare cursor stack (Previous could not replay a shown page without a new request).
- PD6 An older server (`invalid-request` naming `community`): the bot says the server is unavailable and never retries without the key (as 018 FR-505); bot and server ship together.

## 7. Tests (Vitest)
- Protocol: reader, cursor round-trip and refusal, encode/decode, digest pins of bodies without `community`.
- Server core: order, snapshot, top 5, `more`, asker, 0-point and empty matches.
- Store: v1..v4 upgrade, v6 refusal, closed-file read, purge, `last_step_ms` pin, query plans (no `SCAN` of `matches`, `results`, `communities`), statement count 10 vs 1,000 matches.
- HTTP real server: creation, forbidden, isolation twins, snapshot walk across a finishing match, log scan, no key in path.
- Secrecy twin: running match of the same community; replies byte-identical before and after each step.
- Bot: key, translate (raw id never in Interaction, state or log), embed worst case (017 NFR-94), paging, failure; e2e step.
- Ledger: ranges FR-545..562, FR-573, NFR-117..122 with `PENDING_024`.
