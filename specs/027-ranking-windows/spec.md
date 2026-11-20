# Spec 027 — Ranking by time window
Status: approved (by the user on 2026-11-20 via the orchestrator, all five open questions taken as recommended)
Tier: Full SDD (touches a server read, the protocol and the secrecy of rounds). Depends on 024 (community key, counted matches, history order, snapshot paging, body transport) and 025 (the ranking read, its statistics, orders, accuracy qualification, cursor and bot command), and on 008, 017 and 022. Ids: FR-575 to FR-585, NFR-127 to NFR-131 (FR-574 left free).

This draft assumes the recommended answer of each open question (rolling windows, a second option on `/mbrg ranking`, the qualification measured inside the window, the bound as a parameter of the existing reads). A different answer changes the requirements that name that question.

## Context and goal
Spec 025 ranks the members of a Discord server over every finished match of that server. In an active server the all-time ranking freezes: early players stay on top, a newcomer cannot catch up, and last week's form is invisible. Its "Out of scope" left ranking by time window as a later spec. This spec adds two windows beside all time: the last 7 days and the last 30 days. A window only cuts the oldest side of the counted matches; everything else (statistics, orders, ties, accuracy rule, paging, privacy, secrecy) is 025 unchanged, applied to the matches inside the window. No schema change: like 025 (NFR-125), the windowed ranking is computed when it is read.

## Users
- **Server member**: wants to see who is playing well now, not only who has played the most.

## User stories
- US-1. As a server member, I want the ranking of the last 7 days or the last 30 days so that recent form counts and a newcomer can reach the top.
- US-2. As a server member, I want my own place within that window, even when I am not on the page shown.
- US-3. As a server member, I want the all-time ranking to stay exactly as it is when I ask for no window.

## Definitions
- **Community**, **counted match**, **finish instant**, **history order**, **asker**: as in 024. **Points of a player in a match**, **match won**, **accuracy**, **qualified for accuracy**, **shown name**, **order**: as in 025.
- **Window**: one of *all time* (the default), *last 7 days*, *last 30 days* (OQ1 A, rolling). A window is not a calendar unit: it starts at an instant, not at a date, so it needs no time zone.
- **Window length**: 7 × 86,400,000 ms for the last 7 days, 30 × 86,400,000 ms for the last 30 days; all time has none.
- **Floor** of a windowed walk: the server clock at the read of the walk's first page, in whole milliseconds, minus the window length. It is fixed by the first page and never recomputed during the walk.
- **In the window**: a counted match whose finish instant is at or after the floor (a match finished exactly at the floor is in; one finished 1 ms before is out). All time has no floor: every counted match is in.
- **Head** of a walk: as 025 (024 FR-549): the newest settled counted match of the community and namespace at the first page, chosen without regard to the window. The window cuts only the oldest side; it never moves the head. When the head itself is older than the floor, the windowed snapshot is empty.
- **Windowed snapshot**: the counted matches of the community and namespace at or after the head in history order (025's snapshot) AND in the window. For all time it is exactly 025's snapshot.

## Functional requirements
- FR-575: THE ranking request SHALL name at most one window among all time, last 7 days and last 30 days; a request naming none asks for all time. IF it names any other value, THEN THE SYSTEM SHALL answer `invalid-request` naming the member, as for an unknown order. The request SHALL NOT carry a floor or any instant: the floor is always the server's (Definitions).
- FR-576: WHEN a client credential asks for the first page (no cursor) of a windowed ranking, THE SYSTEM SHALL fix the head as 025 and the floor from its own clock (Definitions), and SHALL answer over the windowed snapshot. Every later page of that walk SHALL use the head and the floor its cursor carries, so a walk never repeats or skips a row, its total never changes, and no match enters or leaves the window while it is paged, whatever time passes between pages.
- FR-577: THE SYSTEM SHALL compute every row, statistic, shown name, rank, accuracy qualification (OQ3 A: at least 10 scored predictions inside the window), unranked tail, total and asker row of 025 FR-563 to FR-567 over the windowed snapshot only: a scored result or a stored name of a counted match outside the window SHALL NOT change any byte of a windowed reply. A player whose only scored rows are outside the window has no row.
- FR-578: THE ranking cursor of a windowed walk SHALL carry its window and its floor beside the order and the head (025 FR-565). IF a request names a window different from the one its cursor carries, THEN THE SYSTEM SHALL answer `invalid-request` naming the cursor, as for an order mismatch.
- FR-579: THE windowed ranking read SHALL follow 025 FR-568 in full (only a client credential; an empty reply with total 0 for another namespace, an unknown key or an empty windowed snapshot, byte-identical between them; the key never echoed or logged; key, player id, order, window, page size and cursor only in the request body; nothing stored, not memoised; a match not `finished` changes no byte of the reply).
- FR-580: WHEN a member runs `/mbrg ranking` with an optional window word (OQ2 A: "semana" for the last 7 days, "mes" for the last 30 days; no word for all time) beside the optional order word of 025 FR-569, in any combination, THE bot SHALL reply publicly with page 1 of the ranking embed of that window and order, as 025 FR-569; the title SHALL name the window ("Ranking del servidor · últimos 7 días", "Ranking del servidor · últimos 30 días"); the all-time title stays "Ranking del servidor". The window words are command choices, so no other word can be sent.
- FR-581: WHILE the window is not all time, THE "Tu puesto" line of 025 FR-569 SHALL give the asker's rank and statistics inside the window; an asker not qualified inside the window in the accuracy order gets no line (as 025); an asker with no row in the window gets the sentence "No has jugado ninguna partida terminada en este servidor en los últimos N días." (N is 7 or 30).
- FR-582: IF the windowed snapshot has no row (no counted match in the window, or none with a scored result), THEN THE bot SHALL reply publicly with one sentence naming the window ("Nadie ha jugado una partida terminada en este servidor en los últimos N días.", N 7 or 30), without buttons; the all-time empty sentence of 025 FR-570 is unchanged.
- FR-583: THE windowed ranking message SHALL follow the paging rules of 024 FR-555 as 025 does: only the asker pages it; the bot keeps the window of the walk with its order and pages; Next follows the cursor of the page shown and Previous returns to a page already shown, so every press of one message shows the same windowed snapshot and the same "Página N/M".
- FR-584: THE failure rules of 025 FR-571 (private "unavailable" reply, no retry loop, the direct-message refusal of 024 FR-557) SHALL apply to `/mbrg ranking` with a window.
- FR-585: THE e2e harness (023) SHALL gain a step that, after the two finished matches of 025 FR-572, reads the ranking in each window (both matches are in every window, so the three rankings are equal) and reads the last-7-days ranking of community B (empty).

## Non-functional requirements
- NFR-127 (Secrecy): 025 NFR-123 applies to every window: a test with a running match of the same community, inside the window (predictions stored and scored for some rounds, a planted 022 name differing from the finished matches' name), proves no windowed reply, before or after any of its steps, differs from the reply without it.
- NFR-128 (Privacy and isolation): 025 NFR-124 applies unchanged: the windowed ranking is the same read, so the source scan lists no new reader of the community storage; the window and the floor travel only in the request body and the opaque cursor and are never logged; a twin test with two communities and two namespaces proves isolation in each window.
- NFR-129 (Compatibility): a request that names no window, or names all time, gets the reply 025 gives, byte for byte, cursor included; every existing golden, pinned byte and 025 test stays unchanged; `MatchState`, the map format and the store schema do not change; a cursor issued before this spec keeps working as an all-time cursor.
- NFR-130 (Limits): no schema change and no stored or precomputed aggregate (025 NFR-125 model): the window adds one lower bound on the finish instant to the reads 025 already makes (OQ4 A). Verified by a test with 1,000 counted matches of 10 scored players each in one community, spread over 60 days (and 1,000 in another): the store statements per windowed page equal those of an all-time page with 10 matches, and the query plans show index lookups only. A worst-case test (24-character names, 20-digit ids, every statistic at its widest, the windowed title, the accuracy note and the asker's window sentence) renders an embed within every 017 NFR-94 limit (6,000 characters, 25 fields, description 4,096, field value 1,024).
- NFR-131 (Testability and determinism): the floor is computed from the server's injected clock, never from ambient time in a pure function; the window membership, the floor, the window words and the titles and sentences are pure functions tested with Vitest (a match finished exactly at the floor is in, 1 ms before is out; 9 and 10 scored predictions inside a window with more outside; a head older than the floor gives an empty snapshot); HTTP tests run against a real server with an injected clock, including a walk whose pages are read across a clock advance of more than the window length.

## Edge cases
- A player with 50 scored predictions all time but 6 in the last 7 days: in the accuracy order of that window they are in the unranked tail with "—".
- The newest counted match finished 10 days ago: the last-7-days ranking is empty (FR-582 sentence); the last-30-days one lists it.
- A match finishes while the asker pages a windowed ranking: the walk keeps its head and floor; a new `/mbrg ranking` counts it.
- A walk paged over the 5-minute life of its buttons: the floor does not move, so a match that falls out of the window during those minutes stays in that walk.
- A match finished exactly at the floor instant: in the window.
- The asker played only before the window: the window sentence of FR-581, while the all-time ranking shows their place.
- A shown name stored only in a match outside the window: not used; the row shows the mention (a Discord player) or the fallback name.
- A client forges a cursor with another floor: it can only read its own community's counted matches under its own namespace, which the all-time ranking already exposes to it; a floor later than the head gives the empty reply.
- Two members in different time zones ask at the same moment: same window, since the window is an instant, not a local date.

## Out of scope
- Calendar windows (ISO week, calendar month) and any time zone, global or per server (OQ1).
- Arbitrary date ranges, windows other than 7 and 30 days, or comparing windows (movement since last week).
- Automatic weekly or monthly ranking posts, season resets or prizes.
- Stored or precomputed per-window aggregates (a later spec if a community outgrows read-time computation).
- A viewer page for the ranking (as 025); streaks; per-faction statistics; rankings across Discord servers or for open (non-bot) matches.
- Showing the window's start date in the embed (OQ5 B).

## Done criteria
- Tests first for every id; traceability ledger extended with FR-575 to FR-585 and NFR-127 to NFR-131; secrecy, isolation and compatibility tests green; goldens unchanged.
- `npm test`, `npm run typecheck` and CI green.
- e2e harness step of FR-585.
- Hand run: in one Discord server, `/mbrg ranking` with "semana", "mes" and no window, in two orders each, matches the leaderboards of the finished matches inside each window; another server shows nothing.
- The user accepts; status becomes `implemented`; MEMORY.md and docs/board.md updated in the feature PR.

## Open questions
- [NEEDS CLARIFICATION] OQ1. Rolling or calendar window? **A (recommended):** rolling, the last 7 and 30 days from the first page's server clock: no time zone, no boundary, never empty at the start of a week, buildable on the existing reads. **B:** calendar (ISO week, calendar month) in a zone fixed for everyone (UTC, or Europe/Madrid for the Spanish UI): a member elsewhere sees the week turn at a foreign hour, and on Monday morning the week ranking is empty. **C:** calendar in a per-server zone: needs a stored setting and a command to set it, which is a schema change outside the 025 NFR-125 model; a spec of its own. The specs deliberately fix no per-user time zone (024 shows dates as Discord timestamps for that reason).
- [NEEDS CLARIFICATION] OQ2. The command surface? **A (recommended):** a second optional option on `/mbrg ranking`, choices "semana" and "mes", no word for all time (as no order word means points); one command, every combination of order and window. **B:** separate subcommands (`/mbrg semana`, `/mbrg mes`): shorter to type, but two more subcommands and the order option repeated on each. Sub-question: under A, also offer an explicit "siempre" choice? Recommended no (absent already means all time). Sub-question: words "semana"/"mes" or "7 días"/"30 días"? Recommended "semana"/"mes", with the title saying "últimos 7 días" so the rolling meaning is explicit.
- [NEEDS CLARIFICATION] OQ3. Where is the accuracy qualification (at least 10 scored predictions) measured? **A (recommended):** inside the window, like every other statistic: one scope for the whole reply. **B:** over all time: a veteran with 3 predictions this week would rank on 3 predictions, and the read needs a second, all-time pass. **C:** inside the window with a lower threshold for windows (for example 5): more players ranked in a quiet week, at the cost of two thresholds to explain.
- [NEEDS CLARIFICATION] OQ4. How does the store take the window? **A (recommended):** the floor becomes an optional bound of the two reads 025 already makes (results and names of the snapshot): one comparison each, no new read, the all-time path unchanged. **B:** two new windowed reads beside them: duplicates the snapshot logic and its tests. (Settled as the head rule above: the head is not a question; it stays the newest settled counted match, the window cutting only the oldest side.)
- [NEEDS CLARIFICATION] OQ5. Show when the window starts ("desde <fecha>", a Discord timestamp in each reader's own zone)? **A:** yes: needs the floor as one more member of the ranking reply (a protocol addition). **B (recommended):** no: the title "últimos 7 días" says it, and the reply shape stays 025's.
