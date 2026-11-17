# Spec 022 — Display names for client players
Status: approved by the user on 2026-11-17 (OQ1 to OQ4 as proposed; the name is the member display name in the server). Tier: Full SDD (touches the protocol, the server, persistence and the secrecy of scoring). Depends on 008, 011, 012, 013, 018 and 019 (implemented). Ids continue 021: FR-530 onwards, NFR-112 onwards.

## Context and goal
A player created by a client credential (the Discord bot) is only `discord:<id>`: the server stores a prediction under that id and creates no `players` row, so it has no name and the viewer shows the number (019 `localName`). The goal is that the leaderboard, the winners and the own-place row of the viewer show the Discord display name of the member, without opening the roster early and without changing open (`player:`) matches.

## Findings that shape the design (explored 2026-11-17)
- The server writes `players` rows only in the open join; `GET /players` and `player-joined` list only those. Client players are in neither.
- Names reach the viewer through `LeaderboardRow.name?`, the phase winners and the own-player read, all built from the `players` table; an absent name makes the viewer fall back to the id.
- `readSubmission` refuses unknown members, so a `name` in the submission body is an `invalid-request` today. `readName` (1 to 24 characters, letters, digits, space, `_`, `.`, `-`) is the existing name rule.
- The leaderboard lists only players already scored; the roster would also list players who have predicted but are not scored yet, which 008 P12 forbids revealing.

## Requirements
- FR-530: THE submission body SHALL accept an optional member `name`, read with the existing name rule (`readName`); a body without it stays byte-identical in its content digest (as `joinPolicy` in 018). An invalid `name` is `invalid-request` naming `name`.
- FR-531: WHEN a client credential submits with a `name`, THE SYSTEM SHALL store it for that player in that match (the latest accepted name wins), in one new table `client_names (match_id, player_id, name)`; a body without `name` changes nothing. The write is in the same transaction as the prediction.
- FR-532: THE SYSTEM SHALL NOT require names of client players to be unique and SHALL NOT apply `name-taken` to them; two members may share a display name (the rank tells them apart).
- FR-533: THE leaderboard rows, the phase winners and the own-player read SHALL carry the stored name of a client player, as they carry the name of an open player today (the `name` member present only when known).
- FR-534: THE SYSTEM SHALL NOT list client players in `GET /players`, in the lobby or in any event before they are scored, and SHALL emit no `player-joined` for them (008 P12: who predicted stays secret until scoring).
- FR-535: THE name of a client player SHALL be visible only where its player id is already visible (the leaderboard after scoring, winners, the player's own read); a test with a planted name proves no read or event shows it earlier.
- FR-536: THE store SHALL move to schema version 4 by adding `client_names` in one transaction, writing no row of any existing table; a version 1, 2 or 3 file upgrades and a version 5 file is refused; the purge removes the rows with the match.
- FR-537: THE bot SHALL send, with every prediction, the member's display name in that server (the nickname when they have one there, else their global display name, else their username: what Discord shows in the channel) made valid for the name rule: normalized, characters outside the rule replaced, spaces collapsed and trimmed, cut to 24 characters; WHEN nothing valid remains it SHALL send no `name`.
- FR-538: THE viewer SHALL show the name where the server sends it, with no change to its fallback to the local id (019 `localName`); a duplicated name is shown with the rank, and the search of 019 finds players by this name.
- FR-539: WHEN a member changes their display name, THE next prediction SHALL replace the stored name; past announcements are not rewritten.

## Non-functional requirements
- NFR-112 (Secrecy): no read, event, log line or error before scoring contains a client name or reveals that a client player predicted; a source scan proves `client_names` is read only by the three reads of FR-533.
- NFR-113 (Privacy): display names are personal data; they are kept only for the life of the match (purge with it), never logged, and never copied to a log line, a metric or an error. 
- NFR-114 (Compatibility): the 008, 011, 014 and 018 goldens and pinned bytes stay unchanged; a body without `name`, an open match and a client-only match without names behave exactly as before (twin test as in 018 NFR-101).
- NFR-115 (Limits): the existing body-size and rate limits apply; a name adds at most 24 characters per request and one write.
- NFR-116 (Testability): the name cleaning of the bot and the validation and storage decisions are pure and tested without Discord or HTTP; HTTP tests run on a real server as in 018.

## Out of scope
- Names for the bot's own announcements (they use mentions already).
- A roster of client players, profiles, avatars, or renaming through any other route.
- Cross-match history and accounts.

## Done criteria
- Tests first for every id; ledger extended; secrecy and twin tests; goldens green.
- `npm test`, `npm run typecheck` and CI green.
- Hand run: a Discord member predicts; after scoring the viewer's leaderboard and own-place row show the display name; a member with an emoji-only name shows the id; the roster of the lobby never lists them.
- The user accepts; status becomes `implemented`.

## Open questions (proposed answers)
- OQ1: store the name per match (proposed) or per namespace across matches (needs a longer retention and its own privacy review).
- OQ2: if the name rule is too strict for common Discord names, widen it for client names only (proposed: no, clean in the bot, keep one rule).
- OQ3: should the bot send the name only on the first prediction of a match (proposed: on every one, so a change is picked up, FR-539).
- OQ4: an older server refuses a body with `name`: the bot and the server ship together (proposed) or the bot retries without `name` once.
