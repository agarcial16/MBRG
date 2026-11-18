### M3 — Bot and e2e (0 / 4)
Plan sections 1, 4 (PD4, PD6). Depends on M2. Rebase on the 024 branch before T3.1.

- [ ] **T3.1. Subcommand, orders and translation.** FR-569 (command part), FR-571 (direct-message part)
  - Files: `apps/bot/src/discord/translate.ts`, `core/actions.ts`, `core/strings.ts`, tests.
  - Done when: `/mbrg ranking` takes an optional order word (`puntos`, `aciertos`, `victorias`, `precisión`) mapped to the wire enum; the community key is built and passed as in 024 (the raw guild id is in no interaction, state file, request or log line: scan with a planted id); an interaction without a guild is refused privately and sends nothing; an older server refusing the key or the route gets the "ranking unavailable" reply and no retry loop (as 024 FR-558); `dm_permission: false` unchanged.
- [ ] **T3.2. Pure ranking embed.** FR-569 (text parts), FR-570, FR-571 (unavailable part), NFR-125 (embed part)
  - Files: new `apps/bot/src/core/ranking.ts`, `core/strings.ts`, tests.
  - Done when: per row the rank (or "—" in the accuracy tail), the mention, the ordering statistic first, then "pts", "aciertos X/Y", "victorias", "partidas", "precisión P %" with P the whole percent rounded down (floor of 100 x correct / scored; 199/200 shows 99 %); a player with no scored prediction shows no precision; a "Tu puesto" line with the asker's rank and statistics, absent when the asker is unqualified in the accuracy order (their row still appears in the tail) or has no row (a sentence saying they have not played a finished match here); the line "Menos de 10 predicciones: sin puesto en precisión" precedes the unranked rows on the first page where they appear; "Página N/M" with M from the snapshot total; the empty reply of FR-570 (no buttons) and the unavailable reply of FR-571; a worst case (24-character names, 20-digit ids, every statistic at its widest, the note and the asker line) renders an embed within every 017 NFR-94 limit.
- [ ] **T3.3. Boards, paging and failure wiring.** FR-569 (paging part), FR-570 (closed), FR-571 (closed)
  - Files: `apps/bot/src/core/custom-ids.ts`, `io/boards.ts`, `io/server-client.ts`, `io/handler.ts`, tests.
  - Done when: page 1 is asked with limit 10 and the asker's id; the cursor stack lives in the bot's memory per message (PD6) and the buttons follow the paging rules of 024 FR-555; a server refusal or a transport failure replies privately that the ranking is unavailable, without a retry loop; the empty case carries no buttons.
- [ ] **T3.4. e2e step and close.** FR-572, NFR-126 (closed)
  - Files: `apps/bot/test/e2e/`, the traceability ledger.
  - Done when: the harness reads the ranking after two finished matches in community A, in every order, and checks every statistic, rank, shown name and the asker's line against the pinned plan; another server shows the empty reply; the ledger moves FR-563..FR-572 and NFR-123..NFR-126 to `DONE_025` and `PENDING_025` is left empty; hand run as the done criteria of the spec.
