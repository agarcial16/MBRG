# Spec 025 — Per-Discord-server ranking
Status: draft
Tier: Full SDD (touches a server read, the protocol and the secrecy of rounds). Depends on 024 (community key, counted matches, history paging) and on 008, 017, 018 and 022. Ids: FR-563 to FR-572, NFR-123 to NFR-126 (split from 024, which keeps FR-545 to FR-562 and NFR-117 to NFR-122).

Answers of 2026-11-18 (user, via orchestrator): split from 024 (OQ10 B); a match is won by the highest points above 0, ties all win (OQ11 A); the four statistics plus accuracy as an order, only for players with at least 10 scored predictions (OQ12).

## Context and goal
Spec 024 links each match the bot creates to its Discord server (the community) and lists the server's finished matches. This spec adds a server-wide ranking of members across those matches: who has the most points, the most correct predictions, the most matches won and the best accuracy. No schema change: it reads the community storage of 024 and the existing results.

## Users
- **Server member**: wants to compare themselves with the rest of the server across all finished matches.

## User stories
- US-1. As a server member, I want a server-wide ranking (points, correct predictions, matches won, accuracy) so that I can compare myself with the rest of the server.
- US-2. As a server member, I want to see my own place even when I am not on the page shown.

## Definitions
- **Community**, **counted match**, **asker**: as in 024.
- **Match won by a player**: in a counted match, the player's total points in that match are above 0 and no player of the match has more; every tied player wins it.
- **Accuracy**: correct predictions divided by scored predictions, over the counted matches.
- **Qualified for accuracy**: a player with at least 10 scored predictions.

## Functional requirements
- FR-563: WHEN a client credential asks for a page of the ranking of a community, THE SYSTEM SHALL answer with one row per player of the credential's namespace who has at least one scored row in a counted match of that community, holding: player id, latest stored name (022) when known, total points, correct predictions, scored predictions, matches played, matches won.
- FR-564: THE SYSTEM SHALL compute each statistic only over the counted matches of that community and namespace: total points = sum of the player's points; correct predictions = number of the player's scored results marked correct (victim, absorber and winner alike); scored predictions = number of the player's scored results; matches played = counted matches with at least one scored result of the player; matches won = counted matches the player won (Definitions).
- FR-565: THE ranking request SHALL name one order among total points (default), correct predictions, matches won and accuracy; rows are ranked by that statistic descending, then by total points, then by player id for a stable order; players equal on the ordering statistic share the rank (competition ranking, as the leaderboard of 008). Pages hold 10 rows; the reply carries the total number of rows.
- FR-566: WHILE the order is accuracy, THE SYSTEM SHALL rank only qualified players by accuracy (equal accuracy compared exactly as fractions, never as rounded percentages); players not qualified SHALL follow every qualified player, without a rank, ordered by total points, then by player id, and SHALL be counted in the total.
- FR-567: WHEN the ranking request names a player id of the credential's namespace, THE SYSTEM SHALL add that player's row and rank under the same order (no rank when not qualified for accuracy), or mark that the player has no row.
- FR-568: THE ranking read SHALL follow 024 FR-552 (only a client credential; an empty reply with total 0 for another namespace or an unknown key), 024 FR-553 (the key is never echoed or logged) and 024 FR-561 (a match not `finished` changes no byte of the reply).
- FR-569: WHEN a member runs `/mbrg ranking` with an optional order (puntos, aciertos, victorias, precisión), THE bot SHALL reply publicly with page 1 of the ranking embed: per row the rank, mention, the ordering statistic first, then the others ("pts", "aciertos X/Y", "victorias", "partidas", "precisión P %" rounded to a whole percent); a "Tu puesto" line for the asker (or a sentence saying they have not played a finished match here); the page indicator and buttons under the paging rules of 024 FR-555. In the accuracy order, rows without a rank show "—" and the line "Menos de 10 predicciones: sin puesto en precisión" precedes them on the first page where they appear.
- FR-570: IF the community has no counted match, THEN THE bot SHALL reply publicly with one sentence saying there is no ranking yet, without buttons.
- FR-571: IF `/mbrg ranking` runs outside a Discord server, THEN THE bot SHALL refuse privately with one sentence and send nothing to the server; IF the server refuses or cannot answer, THEN THE bot SHALL reply privately that the ranking is unavailable and SHALL NOT retry in a loop (as 024 FR-557, FR-558).
- FR-572: THE e2e harness (023) SHALL gain a step that reads the ranking after two finished matches in community A, in every order, and checks every statistic against the pinned plan.

## Non-functional requirements
- NFR-123 (Secrecy): the ranking counts only counted matches; a test with a running match of the same community (predictions stored and scored for some rounds) proves no ranking reply, before or after any of its steps, differs from the reply without it.
- NFR-124 (Privacy and isolation): 024 NFR-118 and NFR-119 apply to the ranking read; the source scan of 024 lists this read as the only other reader of the community storage; a twin test with two communities and two namespaces proves isolation.
- NFR-125 (Limits): a ranking page holds 10 rows and the worst-case embed stays under Discord's 6,000-character limit (tested); a page read stays under 200 ms with 1,000 counted matches and 200 players in one community on the test machine; no schema change.
- NFR-126 (Testability): the statistics, the "won" rule, the accuracy qualification and order, and the bot's embed text are pure functions tested with Vitest (ties, a 0-point match nobody wins, exactly 9 and 10 scored predictions, equal accuracies of different fractions such as 1/2 and 5/10); HTTP tests run against a real server.

## Edge cases
- A counted match where everyone has 0 points: nobody wins it; it still counts as played for those with a scored result.
- Three players tied on the top points of a match: each gets one win.
- A player with 9 scored predictions in the accuracy order: listed after the ranked players, "—" instead of a rank; with 10 they are ranked.
- Same accuracy from different fractions (5/10 and 10/20): same rank; then ordered by total points.
- The asker has no row: "Tu puesto" says they have not played a finished match in this server.
- A member changed their display name: the latest stored name is shown; the mention always resolves.

## Out of scope
- Ranking by time window (week, month), streaks, or per-faction statistics.
- A viewer page for the ranking.
- Rankings across Discord servers or for open (non-bot) matches.

## Done criteria
- Tests first for every id; traceability ledger extended; secrecy and isolation tests green; goldens unchanged.
- `npm test`, `npm run typecheck` and CI green.
- e2e harness step of FR-572.
- Hand run: after two finished matches in one server, `/mbrg ranking` in each order matches the matches' leaderboards; another server shows nothing.
- The user accepts; status becomes `implemented`; MEMORY.md and docs/board.md updated in the feature PR.

## Open questions
None: all answered (see the answers line at the top).
