# Progress — spec 021 bot lobby link

## What changed
- `apps/bot/src/core/announce.ts`: new pure `lobbyLink` (only `?match=<id>`, no `spectate`/`round`, keeps a base query, none on a bad/missing base); `lobbyMessage(matchId, mapId, viewerUrl?)` appends the "Ver en el visor" link button after Start (FR-526, FR-527). Strings reuse `STRINGS.viewerButton` (FR-528).
- `apps/bot/src/io/handler.ts` + `main.ts`: `viewerUrl` option passed to `lobbyMessage` (minimal edit). Start button and the lobby message after start are untouched (FR-528, FR-529).
- `specs/012-discord-bot/spec.md` FR-469: one clause saying the lobby link is the one non-spectator link.
- Tests: `apps/bot/test/core-announce.test.ts` (FR-526, FR-527, NFR-111); harness passes `viewerUrl` to the handler.

## Tests run
- `npm run typecheck`: green.
- `npm test`: 5618 passed; 2 failures in `tools/build-map/test/libraries.test.ts` (NFR-20 licences of `shapefile`), unrelated to this change (not touched; likely the worktree's installed packages).
- Note: the tests were written before the code but the red run was not executed separately.

## Untested
- Hand run with real Discord: `/mbrg create` shows the link; open it before Start (waiting screen); press Start (enters the scene). This is the user's.

## Next step
- User hand run, then OK to merge.
