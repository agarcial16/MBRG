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
