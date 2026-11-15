# Spec 012 - Progress

## Implementation (Light SDD, one implementer) - 2026-11-13

### What changed
- New workspace `apps/bot` (root `workspaces` + `typecheck` script; only new dependency `discord.js` 14.28.1, pinned; `@mbrg/protocol` for wire readers; no `@mbrg/sim`/`@mbrg/shared`, nothing from apps/web or apps/server).
- `src/core/*` (pure): `strings.ts` (FR-461), `text.ts` (case/accent-blind matching, max 25), `limits.ts` (2,000 chars, 5 per row), `sse-parser.ts`, `backoff.ts`, `state.ts` (channel -> match, host token, last seq, applied rounds, forced round), `announce.ts` (event -> messages, needs, follow advance, viewer link), `results.ts` (winners <= 10 mentions + "y N mas", board), `predict.ts` (open phase, offer, text resolution, refusal sentences), `actions.ts` (interaction -> action, delivery), `custom-ids.ts`, `names.ts`, `paces.ts`, `env.ts`, `decode-results.ts`.
- `src/io/*`: `server-client.ts` (fetch; credential only on predictions, host token only on start), `stream.ts` (SSE with backoff, resume by `Last-Event-ID`), `state-file.ts` (temp file + rename), `follower.ts` (announce in order: read, post, then save the new last seq), `handler.ts`.
- `src/discord/*`: `translate.ts` (pure translations and raw payloads), `shell.ts` (only file importing discord.js), `src/main.ts` (env only).
- Tests (`apps/bot/test`, 85): core units, full-bot flow against an in-process fake server on `node:http` (`helpers/fake-server.ts`, `journey.ts`, `harness.ts`), translations, scans (ASCII, purity, import boundaries, start-up refusal by child process).
- `apps/web/test/shaped-deps.test.ts` and `labels-render.test.ts` pin the lockfile entries of the viewer; they now skip the entries owned only by the bot (`apps/web/test/helpers/lock-owners.ts`, closure of `apps/bot` minus everything reachable from other workspaces). No web source touched.

### Decisions the spec did not cover
- D1 (who guessed right): `GET .../results/:round/:phase/winners` joins the `players` table, so it never lists `discord:` players, and the protocol decoder refuses them. The bot reads `GET .../results/:round/:phase` instead (paged, limit 500) through its own reader that keeps only `{playerId, correct}` and drops choice/points/wrong guesses at decode. Needs a user nod; the alternative is a server change (out of scope).
- D2: "round opened" = `schedule` event with stage `phase-1` (round = applied + 1, kept in the state). "Factions left" = distinct owners of `GET /states/:round` of the applied round (public, never a future round).
- D3: phase 2 results of a forced round are never asked for nor announced (state keeps `forcedRound`).
- D4: a match ends the channel's following when `match-finished` or `match-halted` is announced (host token dropped, stream closed).
- D5: mentions never ping (`allowedMentions.parse = []`); other-namespace players are ignored in who-guessed-right.
- D6: winner predictions are not offered (FR-453/454 only define phases 1 and 2); `/mbrg create` uses the paces fast/normal/slow of the web create screen.
- D7: delivery: create/stop/board are deferred public, start/predict-text/choose/find deferred private, the Predict press and autocomplete answer directly (a text window cannot follow a deferral); server calls there have a 2.5 s timeout.
- D8: a post is saved after it is sent, so a crash between the two can repeat one event; a graceful restart never does.

### Tests run
- `npx vitest run apps/bot`: 85 passed. Mutation proofs (each killed by the bot suite): resume check `<=` to `<`, 10 mentions to 11, forced-round skip, `Last-Event-ID` fixed to 0, no lower-casing, no posting, wrong guesses kept.
- Full `npm test`: 341 files, 5398 passed, 4 skipped (one server flake under load, green alone and on rerun); `npm run typecheck` clean.

### Untested (hand run, with the user's own token)
- The Discord shell itself (`discord/shell.ts`, `main.ts` login): permission read of "Manage Channel", real deferral timing (3 s), the text window and select menus as Discord renders them, command registration, `allowedMentions`, ephemeral flags on follow-ups, a mention of a member who left, a crash between post and save.

### Next step
- Hand run on a test Discord server per the done criteria; reviewer pass.

## Hand-run changes: FR-464 to FR-467 (Light SDD)

### What changed
- FR-464: `Followed` keeps `creatorId` (optional, so older state files still load). `decide` takes a third argument `{creatorId, hasLast}`; Start (button and command) is allowed only when the interaction's user id equals the creator; an entry with no creator (older file) falls back to the manager rule. New sentence `onlyCreator`. Interactions `start` and `button` carry `userId` (translate.ts, shell.ts). Stop keeps `canManage`. The lobby sentence says only the creator starts.
- FR-465: `Followed.phases {l1, l2}` (seconds from the chosen pace, optional) is stored at create. The poster port now returns the id of the first posted part and has `edit`. The follower runs a countdown per channel with an injected repeating timer (`every`, default `setInterval`): a tick every 5 s edits the open-phase message (same buttons) adding "Quedan unos N s." with N = length - 5k; it ends when N <= 0, on `phase-closed`, `victim-revealed`, `round-applied`, `match-finished`, `match-halted`, a `schedule` that is not phase-2, a stream drop (new `onDrop` hook of the stream), unfollow and `stopAll`. A failed edit is swallowed; no new message. Phase 2 uses `l2` (5 s at every pace today, so it never gets an edit: the first tick reaches 0).
- FR-466: state has an optional `last` map (channel -> `{matchId, mapId}`, no host token). `retire` (follower `unfollow`: finished, halted, stop) moves the entry there; a new create replaces it. `/mbrg board` reads the followed match or else the last one; none says `notFollowing` (existing string). `followAll` only opens streams for followed entries.
- FR-467: cause of the missing board: `needOf`/`buildAnnouncement` never asked for it on `match-finished` (only the winner line existed). Now `match-finished` needs the first 10 leaderboard rows and posts them right after the winner; with no points at all only the winner is posted (no "no points yet" line after the end).

### Decisions the spec did not cover
- D9: older state entries (no `creatorId`) keep the manager rule for Start, so a lobby left from before the change can still be started.
- D10: the countdown does not stop on `results` or a `schedule` of phase 2 (they follow the reveal at once and would have cancelled the phase-2 countdown); it stops on events that close or replace the open phase.
- D11: an empty final leaderboard is not posted.
- D12: a failed read of the final leaderboard retries the `match-finished` event like any other read (the winner message is not sent before it succeeds).

### Tests run
- `npx vitest run apps/bot`: 107 passed (85 before; the existing ones only gained the user id; one FR-452 test was rewritten as FR-464). New: `bot-flow-v2.test.ts` (countdown with a fake ticker, last match, final board), `core-state-v2.test.ts` (state, countdown texts, final board text).
- Mutants killed by the bot suite: Start allowed to anyone; `closesPhase` always true.
- Full `npm test`: 343 files, 5420 passed, 4 skipped; `npm run typecheck` clean.

### Untested
- Real Discord: `channel.messages.edit` on the first part, edit rate limits (one edit per 5 s per channel), message ids returned by `send`, the creator rule through real interactions.

### Next step
- Hand run again with the user's token; reviewer pass.

## Second hand run: FR-465 (corrected), FR-468, FR-469 (Light SDD)

### What changed
- FR-465: the countdown no longer uses the pace. `openPhaseSeconds(event)` reads the server's schedule: phase 1 = `schedule.c1 - reportedTime` of the phase-1 `schedule` event; phase 2 = `c2 - reportedTime` of a free `victim-revealed` (forced reveals, events without anchors and anchors already past give none). Seconds are taken at receipt and counted down locally in 5 s steps with the injected timer. The seconds go in the label of the Predict button ("Predecir · 8 s", `STRINGS.predictCountdown`); the text and other buttons are untouched (the edit port already carried the whole `OutMessage`). Phase 2 now edits too. The posted message keeps the plain "Predecir" and the first edit comes 5 s later. The old "Quedan unos N s." string, `Followed.phases` and its write at create are removed; `parseState` still reads a valid `phases` of an older file and drops it.
- FR-468: `boardMessages(rows, {own, link})`: first 10, then (asker outside them) `Tu puesto: <row>`, then `Clasificación completa: <url>` (only with a viewer address). `/mbrg board` asks `leaderboard(10)` and, if the asker `discord:<id>` is not there and there are 10 rows, `client.rankOf` pages the leaderboard (limit 500, `cursor`) to find it (the server has no own-rank read; not changed). A failed search only leaves the line out. The final post (match-finished) has the top 10 and the link, no asker. `HandlerOptions.viewerUrl` is new (main.ts passes it).
- FR-469: `viewerLink` adds `spectate=1`; `boardLink` (`?match=<id>&spectate=1`) is new.

### Decisions the spec did not cover
- D13: the link and the own row are text lines of the leaderboard message (not buttons); with an empty board neither is shown.
- D14: the own-row search is capped at 40 pages of 500 (as the results paging).

### Tests run
- `npx vitest run apps/bot`: 115 passed (107 before; the old pace-based countdown tests were rewritten, new ones for phase 2, no schedule, paging of the own rank, link, spectate).
- Mutants killed (bot suite): countdown seconds computed from a wrong anchor/time formula (5 tests fail); `rankOf` stopping after the first page (own-row test fails).
- Full `npm test` and `npm run typecheck`: see the commit report.

### Untested
- Real Discord: editing the button label of a posted message (`messages.edit` with components), 5 s edit rate; real server pagination cursor of the leaderboard with more than 500 players.

### Next step
- Hand run again; reviewer pass.
