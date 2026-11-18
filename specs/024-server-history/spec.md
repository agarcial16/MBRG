# Spec 024 — Per-Discord-server match history
Status: draft
Tier: Full SDD (touches server persistence, the protocol and the secrecy of rounds). Depends on 008, 011, 012, 017, 018 and 022 (implemented). Ids continue 023: FR-545 onwards, NFR-117 onwards.

## Context and goal
Each Discord channel follows one match at a time, and the bot remembers only the last match of each channel (012 FR-466): once a new match starts, the old one is gone from Discord. Nothing records which Discord server (guild) a match belongs to: the server stores the match, its client-only policy and the `discord` namespace (018), and players as `discord:<id>` (022), but no guild. The goal is that the members of a Discord server can list the matches played in that server (who won, who scored most, when, on which map) and open any of them in the viewer, without exposing anything about a running match and without letting another server, or the public, learn which matches belong to which server.

The FRs below are written for the recommended answer of each open question; an answer that differs changes the FRs it names.

## Findings that shape the design (explored 2026-11-18)
- The public match summaries list already lists every match, so the matches themselves are not secret; what is new and must stay private is the link between a match and a Discord server.
- Finished matches are never purged; only lobbies that expired without starting are purged after 24 h (011). Discord user ids already live in the store as player ids and display names per match (022); none is logged.
- A finished match publishes its secret and every round; a halted match publishes only the rounds applied before the halt; a running match must never publish a round not yet revealed (008, NFR-88 of 012).
- The bot keeps its state per channel (a JSON file) and does not read the guild today; the Discord interaction carries it.

## Users
- **Server member**: plays in the matches of their Discord server and wants to look back at them.
- **Bot operator**: runs the bot and the server; cares about privacy and storage.

## User stories
- US-1. As a server member, I want to list the past matches of my Discord server so that I can see who won and who predicted best.
- US-2. As a server member, I want to open a past match in the viewer from that list so that I can replay it.
- US-3. As a bot operator, I want the link between matches and Discord servers to stay private and minimal so that no server, viewer or log can learn another server's activity.

## Definitions
- **Community**: the Discord server (guild) a match was created in, as the bot identifies it to the server: an opaque key, never the raw guild id (OQ5).
- **History of a community**: its matches in a terminal stage (`finished` or `halted` after starting), newest first.
- **Entry**: what the history shows of one match (OQ2).

## Functional requirements
- FR-545: WHEN a member runs `/mbrg create` in a Discord server, THE bot SHALL send the community key of that server with the creation, and THE SYSTEM SHALL store it with the match in the same transaction as the match. The key is accepted only from a client credential and only with the client-only policy (018); an operator or player creation with a key is `invalid-request` naming the member.
- FR-546: THE SYSTEM SHALL accept as a community key only a fixed-length lowercase hexadecimal digest (OQ5); any other value is `invalid-request` naming the member, and nothing is stored.
- FR-547: THE SYSTEM SHALL offer no route, setting or command that changes or removes the community of an existing match; a restart, start, step, halt or expiry keeps it. The only deletion is the existing purge of an expired lobby, which takes the row with the match.
- FR-548: WHEN a client credential asks for the history of a community, THE SYSTEM SHALL answer with the entries of the matches whose community is that key AND whose owning namespace (018) is the credential's namespace, newest first by the instant the match ended, paged: at most 10 entries per page, at most 50 entries in all (OQ6), with the total count capped at 50.
- FR-549: THE SYSTEM SHALL list in a history only matches in stage `finished` or `halted` that had started; a match in `lobby`, `expired` or running SHALL NOT appear in, change the count of, or change any byte of a history reply.
- FR-550: THE entry of a match SHALL hold only data its public reads already give at that moment: match id, map id, the instant it ended, its stage, the winning faction (finished only), the number of scored players, and the top scorer(s) (player id, name when 022 stored one, points; ties all listed, at most 3). It SHALL hold no community key, no namespace, no secret beyond what the finished view already publishes, and no unrevealed round.
- FR-551: IF a history request comes from any caller other than a client credential (no credential, a player token, an operator), THEN THE SYSTEM SHALL answer `forbidden` with the same reply as any other forbidden caller. A client credential of another namespace, or a key with no matches, gets an empty history (same reply as a community that never played), so a reply never tells whether a key exists elsewhere.
- FR-552: THE SYSTEM SHALL carry no community key in any public read, summary, event, error reply or log line; the history is the only read that takes it, and it never echoes it.
- FR-553: WHEN a member runs `/mbrg history` in a Discord server, THE bot SHALL reply privately to that member (ephemeral) with page 1 of the history embed: per entry the date, map name, result ("Ganó <faction>" or "Detenida"), the top scorer(s) as mentions with points, and the viewer link of the match (021); a page indicator "Página N/M" and Previous/Next buttons as in 017 (Previous disabled on page 1, Next on the last page).
- FR-554: WHEN the member presses Previous or Next, THE bot SHALL re-read that page from the server and replace its private reply; the page is clamped when the count changed. Buttons follow the 017 expiry: disabled after 5 minutes; after a bot restart a press gets a private "expired" sentence.
- FR-555: IF the community has no entries, THEN THE bot SHALL reply privately with one sentence saying the server has no finished matches yet, without buttons.
- FR-556: IF `/mbrg history` or `/mbrg create` runs outside a Discord server (a direct message), THEN THE bot SHALL refuse privately with one sentence and send nothing to the server.
- FR-557: IF the server refuses or cannot answer the history read, THEN THE bot SHALL reply privately that the history is unavailable, as for any other server failure (012), and SHALL NOT retry in a loop.
- FR-558: THE SYSTEM SHALL move the store to schema version 5 by adding storage only: no row of any existing table is rewritten; a version 1 to 4 file upgrades in place and its matches have no community, so they appear in no history (OQ7); a version 6 file is refused by the existing unknown-version rule.
- FR-559: THE bot SHALL compute the community key from the guild id alone, deterministically, so the same server always gets the same key across restarts and bot versions; the raw guild id SHALL NOT be sent to the server, stored in the bot state or logged.

## Non-functional requirements
- NFR-117 (Secrecy): the history reads only terminal-stage matches, and its entries are built only from the fields their public reads already show; a test with a running match in the same community (rounds pending, predictions stored) proves no history reply, before or after any step, differs from the reply without it, and the 008/011/018/022 secrecy tests pass unchanged.
- NFR-118 (Privacy): no raw guild id leaves the bot; the community key is never logged, never in a public read, event or error (source scan as in 022 NFR-112: the community storage is read only by the history read); Discord ids and names in entries are only those already visible in the match's public leaderboard.
- NFR-119 (Isolation): a history reply for community A under namespace N never contains a match of another community or another namespace; a twin test with two communities and two namespaces proves it.
- NFR-120 (Compatibility): every existing golden and pinned byte stays unchanged; a creation body without the key keeps its content digest (as `joinPolicy` in 018); `MatchState` and the map format do not change.
- NFR-121 (Limits): a history reply holds at most 10 entries; the read is bounded by the existing body, rate and size limits; reading a page costs one indexed lookup by community (no full scan of matches), checked with 1,000 stored matches.
- NFR-122 (Testability): key computation, entry selection, paging and the bot's embed text are pure functions tested with Vitest; HTTP tests run against a real server; the e2e harness (023) gains one history step.

## Edge cases
- Matches created before this spec, or by an older bot: no community; never listed (OQ7).
- Match halted before its first round: listed as "Detenida" with no winner and no top scorer; a lobby that expired without starting: never listed.
- Finished match with no scored players: entry without top scorer ("Sin aciertos").
- Ties for top scorer: up to 3 listed, then "y N más".
- A match finishes while a member pages: the next press shows it on page 1 and the page is clamped.
- The bot is in several servers: each sees only its own; the same channel id never matters, only the server.
- A server that removed and re-added the bot: same key, same history.
- A deleted map package: the entry shows the map id instead of its name.
- Two bots sharing a namespace credential on different deployments: they share histories only for the same guild (same key) — acceptable, same operator.

## Out of scope
- Per-server cumulative ranking or member statistics across matches (OQ3 option B: later spec).
- A viewer page for the history (OQ4 option B/C).
- Per-channel history; history of open (non-bot) matches; history across Discord servers.
- Deleting a server's history, or purging finished matches by age (OQ8 options B/C: later spec).
- Backfilling existing matches.

## Done criteria
- Tests first for every id; traceability ledger extended; secrecy, isolation and compatibility (twin) tests green; goldens unchanged.
- `npm test`, `npm run typecheck` and CI green.
- e2e harness: a scripted match in community A finishes; `/mbrg history` in A shows it; in community B it does not; while a second match in A runs, the history is byte-identical.
- Hand run: create, finish and halt a match in one Discord server; `/mbrg history` lists both newest first with the viewer links working; another server shows none.
- The user accepts; status becomes `implemented`; MEMORY.md and docs/board.md updated in the feature PR.

## Open questions
- [NEEDS CLARIFICATION] OQ1 — What counts as history? A: finished matches only. B: finished and halted (after starting) (recommended: a halted match was still played and its applied rounds are public). C: B plus running matches shown as "en curso" with public data only (more to prove for secrecy).
- [NEEDS CLARIFICATION] OQ2 — What does an entry show? A: date, map, winner faction, viewer link. B: A plus the top scorer(s) with points and the number of players (recommended: one indexed read of data already public). C: B plus the asker's own points in that match (one more read per entry).
- [NEEDS CLARIFICATION] OQ3 — Per-server cumulative ranking? A: no, match list only (recommended for this spec; keeps it within 3 milestones). B: also `/mbrg history ranking`: total points, matches played and top-scorer count per member across the server's matches. C: B only, no list.
- [NEEDS CLARIFICATION] OQ4 — Where is it shown? A: bot only, private paged embed (recommended: the guild link stays inside Discord, no new public surface). B: bot plus a viewer page reached by a link the bot hands out (needs an unguessable link per server and its own privacy rules). C: viewer only.
- [NEEDS CLARIFICATION] OQ5 — How is the server identified in storage? A: raw guild id, like `discord:<id>` player ids today. B: an unkeyed SHA-256 digest of the guild id computed by the bot (recommended: the server and its database never see the raw id; no new secret; deterministic). C: a keyed digest with a new bot secret (strongest, but losing the secret orphans every history; a new environment variable).
- [NEEDS CLARIFICATION] OQ6 — How far back? A: last 50 matches, 10 per page (recommended). B: everything stored, paged. C: last 30 days.
- [NEEDS CLARIFICATION] OQ7 — Matches without a community (all existing ones)? A: never listed (recommended: no migration, no rewritten rows). B: best-effort backfill from the bot's channel state (only the last match of each channel is known; needs Discord lookups).
- [NEEDS CLARIFICATION] OQ8 — Retention and deletion? A: as today: finished matches are kept; history only limits what is shown (recommended for this spec). B: an operator purge of finished matches older than N days (affects every read, its own spec). C: a server-admin command that forgets the server's history (removes the community link only).
- [NEEDS CLARIFICATION] OQ9 — Who sees the reply? A: private to the asker (recommended: no channel noise, no 017 asker/presser rules). B: public in the channel with the 017 paging rules.
