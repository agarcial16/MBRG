### M3 — Bot and e2e (0 / 5)
Plan sections 1, 4, 5, 6 (PD5, PD6). Depends on M2. Rebase on `main` before T3.1.

- [ ] **T3.1. Community key and creation.** FR-548, FR-545 (bot part), FR-557
  - Files: new `apps/bot/src/io/community.ts`, `discord/translate.ts`, `core/actions.ts`, `io/server-client.ts`, `io/handler.ts`, tests `discord-translate.test.ts`, `bot-create-client-only.test.ts`, `bot-scans.test.ts`.
  - Done when: the key is the lowercase hex SHA-256 of the guild id (pinned vector) and stable; `translate` puts only the key in the `Interaction` (the raw guild id is in no interaction, state file, request or log line: scan with a planted id); `/mbrg create` sends `community`; an interaction without a guild is refused privately and sends nothing; an older server refusing `community` gets the "server unavailable" reply and no retry without it; `dm_permission: false` is unchanged.
- [ ] **T3.2. History embed (pure).** FR-554, FR-556, FR-559, NFR-121 (embed part), NFR-122
  - Files: new `apps/bot/src/core/history.ts`, `core/strings.ts`, new `apps/bot/test/core-history.test.ts`.
  - Done when: an entry shows `<t:SECONDS:d>`, map name (map id when unknown), "Ganó <faction>" (number when unnamed), "N jugadores", top 5 as mentions with points, "y N más", "Nadie sumó puntos", the asker's line in both forms and the viewer link; the empty history is one sentence without buttons; the plain-text fallback carries the same lines; the worst case (5 entries, 24-character names, longest map name, 20-digit ids) is within 6,000 characters, 25 fields, description 4,096 and every field value 1,024; mentions never ping.
- [ ] **T3.3. Paging of a history message.** FR-555
  - Files: `core/custom-ids.ts` (`mbrg:hs:p|n:<page>`), `io/boards.ts` (history walks: asker, key, cursor stack, total, expiry), `core/actions.ts`, tests `core-board.test.ts` or new `core-history-paging.test.ts`.
  - Done when: Next follows the page's cursor and Previous returns to a shown page with the same snapshot; only the asker pages in place; another presser gets a private sentence and nothing changes; Previous is disabled on page 1 and Next on the last; buttons are disabled after 5 minutes; after a restart a press is answered as expired; no custom id holds a cursor, key or user id.
- [ ] **T3.4. `/mbrg history` command.** FR-554, FR-558, FR-573 (bot part)
  - Files: `discord/translate.ts` (subcommand `history`), `io/server-client.ts` (`POST /history`), `io/handler.ts`, `apps/bot/test/helpers/fake-server.ts`, new `bot-flow-history.test.ts`.
  - Done when: the command replies publicly with page 1 for the asker's community and local id; a server refusal or outage is a private "unavailable" sentence with one request and no retry; the request body holds the key and the path holds nothing of it; the bot logs no body.
- [ ] **T3.5. e2e step and closing.** FR-562
  - Files: `apps/bot/test/e2e/script.ts`, `plan.ts`, `world.ts`, `e2e.test.ts`, `traceability.test.ts`, `MEMORY.md`, `docs/board.md`, `docs/lessons/{server,bot}.md` if a lesson appeared, `specs/024-server-history/spec.md` (Status: implemented, in the PR).
  - Done when: the e2e run finishes a match in community A, reads the history in A (listed) and B (empty) against the real server; `PENDING_024` is empty and the ledger green; full `npm test`, `npm run typecheck` and `CI=1 npm test` green; the protected diff is empty.
