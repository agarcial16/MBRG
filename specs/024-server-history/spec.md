# Spec 024 — Per-Discord-server match history
Status: approved (by the user on 2026-11-18)
Tier: Full SDD (touches server persistence, the protocol and the secrecy of rounds). Depends on 008, 011, 012, 017, 018, 021 and 022 (implemented). Ids continue 023: FR-545 to FR-562 and FR-573, NFR-117 to NFR-122. The server-wide ranking is spec 025 (FR-563 to FR-572), which builds on the community storage of this spec.

Answers of 2026-11-18 (user, via orchestrator): OQ1 A (finished only), OQ2 top 5 + asker's own points, OQ3 ranking as its own spec (025, OQ10 split), OQ4 A (bot only), OQ5 B (bot-side SHA-256), OQ6 keep everything, page over all finished matches, OQ7 A (old matches not listed), OQ8 A (retention as today), OQ9 B (public, 017 paging rules).
QA review of 2ea1b85 (Opus) addressed: keyset paging with a snapshot total (FR-549), finish instant and date (FR-550, FR-554), body transport (FR-573), player count and top 5 (FR-550), DM rule cites 012 (FR-557), verifiable limits (NFR-121).

## Context and goal
Each Discord channel follows one match at a time, and the bot remembers only the last match of each channel (012 FR-466): once a new match starts, the old one is gone from Discord. Nothing records which Discord server (guild) a match belongs to: the server stores the match, its client-only policy and the `discord` namespace (018), and players as `discord:<id>` (022), but no guild. The goal is that the members of a Discord server can list every finished match played in that server (who won, the top 5 scorers, their own points, a link to the viewer), without exposing anything about a running match and without letting another server, or the public, learn which matches belong to which server.

## Findings that shape the design (explored 2026-11-18)
- The public match summaries list already lists every match, so the matches themselves are not secret; what is new and must stay private is the link between a match and a Discord server.
- Finished matches are never purged; only lobbies that expired without starting are purged after 24 h (011). Discord user ids already live in the store as player ids, and display names per match (022); none is logged.
- A finished match publishes its secret, every round and its whole leaderboard (008 FR-246). A running match must never publish a round not yet revealed (008, 012 NFR-88).
- Every list read pages with opaque keyset cursors and carries no total (008 FR-279); the bot's 017 board shows "Página N/M" because it reads a whole leaderboard and pages it locally, which an unbounded history cannot do.
- The match has no stored "finished at" member; the instant of a match's last step (the application of its last round) is stored with the match and with that step.
- The bot's commands are registered unavailable in direct messages (`dm_permission: false`, 012); the Discord interaction carries the guild id.
- Discord embed limits (017 NFR-94): 6,000 characters in all, 25 fields, description 4,096, field value 1,024.

## Users
- **Server member**: plays in the matches of their Discord server and wants to look back at them.
- **Bot operator**: runs the bot and the server; cares about privacy and storage.

## User stories
- US-1. As a server member, I want to list the finished matches of my Discord server so that I can see who won, who scored most and how I did.
- US-2. As a server member, I want to open a past match in the viewer from that list so that I can replay it.
- US-3. As a bot operator, I want the link between matches and Discord servers to stay private and minimal so that no other server, viewer or log can learn a server's activity.

## Definitions
- **Community**: the Discord server (guild) a match was created in, identified to the server by the **community key**: the lowercase hexadecimal SHA-256 digest of the guild id, computed by the bot. The key is an identifier, not anonymity: anyone who knows the guild id (every member does) can compute it. It only keeps the raw id out of the server, its database and its replies.
- **Counted match**: a match with a community, in stage `finished`. Halted, running, lobby and expired matches are never counted (OQ1 A).
- **Finish instant**: the instant of the step that applied the last round of a counted match (the step after which it became `finished`). No step follows it, so it is fixed once the match is counted, and it is public (the match is over).
- **History order**: finish instant descending, then match id ascending. Every counted match has a distinct position.
- **Player count** of a match: the number of rows of its public leaderboard (008 FR-277: every player id with at least one scored prediction, 0-point players included).
- **Top 5** of a match: the first 5 rows of its leaderboard, in its order (rank, then player id), among the rows with more than 0 points.
- **Entry**: what the history shows of one counted match.
- **Asker**: the member who ran the command.

## Functional requirements
- FR-545: WHEN a member runs `/mbrg create` in a Discord server, THE bot SHALL send the community key of that server with the creation, and THE SYSTEM SHALL store it with the match in the same transaction as the match. The key is accepted only from a client credential and only with the client-only policy (018); any other creation with a key is `invalid-request` naming the member.
- FR-546: THE SYSTEM SHALL accept as a community key only a string of exactly 64 lowercase hexadecimal characters; any other value is `invalid-request` naming the member, and nothing is stored.
- FR-547: THE SYSTEM SHALL offer no route, setting or command that changes or removes the community of an existing match; a restart, start, step, halt or expiry keeps it. The only deletion is the existing purge of a lobby that expired without starting, which takes the row with its match. Counted matches are never deleted (OQ8 A).
- FR-548: THE bot SHALL compute the community key from the guild id alone, so the same server always gets the same key across restarts and bot versions; the raw guild id SHALL NOT be sent to the server, stored in the bot state or logged.
- FR-549: WHEN a client credential asks for a page of the history of a community, THE SYSTEM SHALL answer with the entries of the counted matches whose community is that key AND whose owning namespace (018) is the credential's namespace, in history order, paged with the keyset cursors of 008 FR-279 (page size 1 to 500 as there; the bot asks for 5). Paging is anchored to a snapshot: the first page (no cursor) fixes the newest counted match at that moment, and every later page of the same walk lists and counts only counted matches at or after that position in history order. Each page carries the total number of counted matches of the snapshot (an addition to the 008 list replies, needed for "Página N/M"), so following cursors never repeats or skips an entry and the total never changes during one walk. A match that finishes during a walk appears on the next walk: to make that exact, a counted match is listed only once it is SETTLED, that is when its finish instant is more than 1,000 ms (`TOLERANCE_MS` of 008) behind the server clock at the read (a step run on time keeps its scheduled instant, up to `TOLERANCE_MS` before the instant it is committed at, so without this a match finishing just after the first page could carry an older instant than the snapshot head and join the walk). There is no cap on the total (OQ6).
- FR-550: THE entry of a match SHALL hold only data its public reads already give: match id, map id, the finish instant, the winning faction, the player count, the top 5 (player id, name when 022 stored one for that match, points, rank) and the number of rows with more than 0 points left out of the top 5. It SHALL hold no community key and no namespace.
- FR-551: WHEN the history request names a player id of the credential's namespace, THE SYSTEM SHALL add to each entry that player's leaderboard row in that match (points and rank, 0 points included), or mark that the player has no row in it. A request without it carries no such member.
- FR-552: IF a history request comes from any caller other than a client credential (no credential, a player token, an operator), THEN THE SYSTEM SHALL answer `forbidden` with the same reply as any other forbidden caller. A client credential of another namespace, or a key with no counted match, gets an empty history with total 0 (the same reply as a community that never played), so a reply never tells whether a key exists elsewhere.
- FR-553: THE SYSTEM SHALL carry no community key in any public read, summary, event, error reply or log line; the history read is the only read that takes it, and it never echoes it.
- FR-573: THE history read SHALL take the community key, the optional player id, the page size and the cursor only in the request body, sent with the client credential in the `Authorization` header; none of them SHALL appear in the request path or query, so no proxy or platform access log can hold them. The read stores nothing, is not memoised (008 memo is for writes) and its body is bounded by the existing body limits. The bot SHALL NOT log the body or the key.
- FR-554: WHEN a member runs `/mbrg history` in a Discord server, THE bot SHALL reply publicly in the channel with page 1 of the history embed: per entry the date of the finish instant as a Discord timestamp in short-date style (shown by Discord in each reader's own time zone and locale, so no zone is fixed by the bot), the map name, "Ganó <faction>", "N jugadores" (the player count), the top 5 as mentions with points, "y N más" when rows with more than 0 points were left out (N as given by FR-550), the asker's own line ("Tus puntos: N (puesto R)" or "No jugaste esta partida"), and the viewer link of the match (021); a page indicator "Página N/M" (M from the snapshot total) and Previous/Next buttons.
- FR-555: THE history message SHALL follow the 017 paging rules: only the asker pages it, in place; another member pressing a button gets a private sentence and nothing changes; Previous is disabled on page 1 and Next on the last page; the buttons are disabled 5 minutes after posting; after a bot restart a press gets a private "expired" sentence. Next follows the cursor of the page shown; Previous returns to a page already shown (the bot keeps the cursors of the pages of that message while its buttons live), so every press shows the same snapshot.
- FR-556: IF the community has no counted match, THEN THE bot SHALL reply publicly with one sentence saying the server has no finished matches yet, without buttons.
- FR-557: THE commands SHALL stay unavailable in direct messages as registered by 012 (`/mbrg` has no direct-message permission; unchanged). IF an interaction nonetheless arrives without a server, THEN THE bot SHALL refuse it privately with one sentence and send nothing to the server (a defensive check, not a behaviour change).
- FR-558: IF the server refuses or cannot answer a history read, THEN THE bot SHALL reply privately to the member that the history is unavailable, as for any other server failure (012), and SHALL NOT retry in a loop.
- FR-559: IF a map package of an entry is no longer served, THEN THE bot SHALL show the map id instead of its name; a faction without a name shows its number, as the existing announcements do.
- FR-560: THE SYSTEM SHALL move the store to schema version 5 by adding storage only: no row of any existing table is rewritten; a version 1 to 4 file upgrades in place, and its matches have no community and appear in no history (OQ7 A); a version 6 file is refused by the existing unknown-version rule.
- FR-561: THE SYSTEM SHALL list a match in a history only once its stage is `finished` and its finish instant is settled (FR-549: more than `TOLERANCE_MS` behind the server clock, so at most about a second after the finish): a match of the community in any other stage SHALL NOT appear in, change the total of, or change any byte of a history reply.
- FR-562: THE e2e harness (023) SHALL gain a step that finishes a match in community A and reads the history in A (listed) and in B (empty).

## Non-functional requirements
- NFR-117 (Secrecy): the history reads only counted matches (stage `finished`), whose rounds, secret and leaderboard are already public; a test with a running match of the same community (rounds pending, predictions stored and scored) proves that no history reply, before or after any of its steps, differs from the reply without it; the 008/011/018/022 secrecy tests pass unchanged.
- NFR-118 (Privacy): no raw guild id leaves the bot; the community key and the asker's player id travel only in request bodies (FR-573) and are never logged, never in a public read, event or error (source scan as in 022 NFR-112: the community storage is read only by the history read, and by the reads of later specs that name this NFR); Discord ids and names in replies are only those already visible in the public leaderboards of counted matches.
- NFR-119 (Isolation): a reply for community A under namespace N never contains or counts a match of another community or another namespace; a twin test with two communities and two namespaces proves it.
- NFR-120 (Compatibility): every existing golden and pinned byte stays unchanged; a creation body without the key keeps its content digest (as `joinPolicy` in 018); the 008 list reads keep their replies (the total is only on the new read); `MatchState` and the map format do not change.
- NFR-121 (Limits): a history page holds 5 entries; a worst-case test (5 entries, 24-character names, longest map name, 20-digit ids, top 5 full, "y N más", the asker's line and the viewer link) renders an embed within every 017 NFR-94 limit: 6,000 characters in all, at most 25 fields, description at most 4,096 and every field value at most 1,024. A page read is bounded work: a test with 1,000 counted matches in one community (and 1,000 in another) counts the store statements of one page and finds the same constant number as with 10 matches, and the query plans show index lookups only (no full scan of the matches, results or community storage). The existing body, rate and size limits apply.
- NFR-122 (Testability): key computation, entry selection, snapshot paging, the cursor stack, the top 5 and the bot's embed text are pure functions tested with Vitest; HTTP tests run against a real server.

## Edge cases
- Matches created before this spec, or by an older bot: no community; never listed (OQ7 A).
- Halted match: never listed, even after starting (OQ1 A).
- Finished match where nobody has more than 0 points (or nobody scored): no top 5, the line "Nadie sumó puntos"; the player count may still be above 0.
- More than 5 rows with points, ties at the 5th place included: 5 rows shown in leaderboard order, then "y N más".
- The asker played under another namespace, or never predicted: "No jugaste esta partida"; the asker has a 0-point row: "Tus puntos: 0 (puesto R)".
- Two members with the same display name: told apart by mention.
- A match finishes while the asker pages: the walk keeps its snapshot (same pages, same M); a new `/mbrg history` shows it on page 1.
- The bot is in several servers: each sees only its own. A server that removed and re-added the bot: same key, same history.
- Two deployments sharing one namespace credential: they share history only for the same guild (same key) — the same operator, accepted.

## Out of scope
- The server-wide ranking (spec 025).
- A viewer page for the history (OQ4 A).
- Per-channel history; open (non-bot) matches; anything across Discord servers.
- Deleting a server's history, or purging finished matches (OQ8 A).
- Backfilling existing matches (OQ7 A).
- Totals on the existing 008 list reads.

## Done criteria
- Tests first for every id; traceability ledger extended; secrecy, isolation and compatibility (twin) tests green; goldens unchanged.
- `npm test`, `npm run typecheck` and CI green.
- e2e harness step of FR-562.
- Hand run: create and finish two matches in one Discord server and halt a third; `/mbrg history` lists the two finished ones newest first with the asker's points and working viewer links; another server shows nothing.
- The user accepts; status becomes `implemented`; MEMORY.md and docs/board.md updated in the feature PR.

## Open questions
None: all answered (see the answers line at the top).
