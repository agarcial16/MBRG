# Spec 011 — Playable matches (server and protocol)
Status: approved (by the user on 2026-10-30). Tier: Full SDD (touches `apps/server`, `packages/protocol`, the secrecy of future rounds and persistence). Depends on 008 and 009 (implemented) and 010. Ids continue 010: FR-369 onwards, NFR-72 onwards. The web interface that uses this (create/join screens, lobby, prediction on the map, leaderboard) is spec 013; the Discord bot stays spec 012.

## Goal
Let people who are not the operator play: anyone can create a match from the browser, share a link, wait in a lobby, join with a name, predict, and see a leaderboard with names. The server gains public match creation with limits, a lobby stage with a manual start, per-player identity without accounts (a name and a secret token per match), names in the public reads, and the rule that a forced absorber is not predicted. The simulation, the map format and the viewer's anti-spoiler rule do not change.

## User decisions (chat, 2026-10-27)
- Any visitor may create a match, with limits (the operator credential never reaches the browser).
- Identity without accounts: a name per match plus a secret token per player, so nobody can predict in another player's name.
- Lobby: a waiting room, the match starts when the host presses "start".
- Single candidate rule: when the victim has only one possible absorber, the absorber is not predicted, gives no points, and the phase lasts less.
- Split: this spec is the server and protocol; the interface is spec 013.

## Definitions
- **Lobby**: the stage of a created match before round 1. No clock runs, no event of a round is published, and the match's secret is already drawn but derives nothing public.
- **Host**: the creator, holding the host token of 008 (FR-236). **Player**: a joined participant holding a player token.
- **Player id** (public, server-generated, opaque) and **player token** (secret, 256 random bits, shown once). **Name**: the display text of the player in this match.
- **Forced absorber**: the victim has exactly one absorption candidate in the state at k − 1 (d = 1).

## Requirements
**Public creation**
- FR-369: A caller without the operator credential may create a match with a map id of the public map list (a new operator setting, a subset of the map list), a timing setting inside public bounds (new settings, narrower than FR-233's) and a client request id. The reply carries the match id and the host token, as FR-231 does, and nothing else secret. The operator-credential path of 008 is unchanged.
- FR-370: Public creation is limited: a maximum of open lobbies and of running public matches (settings), and a creation rate per source and overall (settings), each refused with a closed error code (`too-many-matches` or the new `rate-limited` path of 008) and tested at its limit. A refused request creates and stores nothing.
- FR-371: A created match starts in stage `lobby`. Repeated creation with the same request id and content returns the first reply (FR-238 applies unchanged).
- FR-372: A lobby that is not started within 24 hours (setting) becomes `expired`: it rejects joins and start, keeps its record for the retention of FR-282 and is then removed. A started match is never expired by this rule.

**Lobby and start**
- FR-373: The lobby is public: its public data shows the stage, the map, the timing, the player count and the players' names, and never anything of a round.
- FR-374: WHEN the host presents the host token with a `start` command, THE SYSTEM SHALL move the match to stage `phase-1` of round 1, store the first `schedule` event (as FR-289(c) did at creation) with the clock anchored at the start instant, and publish it. A `start` by anyone else is `forbidden`; a second `start` returns the first reply and starts nothing twice; `start` on an expired or started match is refused with a closed code.
- FR-375: Under `manual` timing the host steps the match as in 008 after the start.
- FR-376: The lobby publishes `player-joined` events on the match stream (player id and name only) with sequence numbers as FR-289 defines; a client that subscribes late misses nothing.

**Identity**
- FR-377: A caller without any credential may `join` a match that is in `lobby` or running, not finished, not expired, with a name. The name is trimmed, 1 to 24 characters of letters, digits, spaces and `_-.`, with no leading or trailing space and no two spaces in a row; unique in the match ignoring case and accents, or refused with `name-taken`. The reply carries the player id and the player token, once.
- FR-378: The server stores only a one-way digest of the token (as it does for the host token) and never logs it. A request carries the token as `Authorization: Bearer`; a token that matches a player of the match in the path gives the role `player` for that match only.
- FR-379: A prediction submission and the read of own predictions accept the player token as well as a client credential. A player token submits only for its own player id; the client-credential path (spec 012) is unchanged and its ids keep their namespace.
- FR-380: Joining a running match is allowed; the player predicts from the next open phase and has no points for earlier ones. A match has at most a number of players set by the operator (default 200); beyond it `match-full`.
- FR-381: Join is rate limited per source and per match. A repeated join with the same client request id and content returns the first reply, token included, and joins nobody twice (memo as FR-282).
- FR-382: There is no account, no recovery and no name change. A lost token is a lost player; the interface may offer a personal link (spec 013) but the server issues the token only at join.

**Names in the reads**
- FR-383: The leaderboard, the phase results and the player results carry the player's name next to the player id for web players (an added field; the existing fields, their order and the paging of FR-279 do not change). Players of a client credential have no name and the field is absent.
- FR-384: THE SYSTEM SHALL treat names as untrusted text everywhere: sent as JSON strings only, compared after normalisation, never inserted into a log line beyond its length and a hash, and bounded as FR-377.
- FR-385: A new public read lists the players of a match (id, name, join order, paged by FR-279). It exposes no token and no prediction.
- FR-386: A new public read returns, for a scored phase, the names of the players who guessed right, ordered by player id and paged (the "who guessed right" line of the chronicle). It exposes no wrong guess and no unscored phase (FR-270, P12 hold).

**Forced absorber**
- FR-387: IF the victim has exactly one absorption candidate (d = 1), THEN an absorber prediction for that round is refused with `forced-absorber`, no absorber points exist for the round (this amends FR-272 for d = 1: d = 1 never scores) and the public data and the `victim-revealed` event mark the round as forced (a derived field, no new secret).
- FR-388: IF the absorber is forced, phase 2 closes after `min(L2, F)` seconds, F a setting (default 5 s), instead of L2; the next round's anchors do not move. Under `manual` timing the host steps as before. Tested with the fake clock at L2 below, equal to and above F, and with L2 = 0.
- FR-389: The winner prediction and the victim prediction rules do not change; a round with two factions living (a forced absorber at once) still predicts the victim.

**Persistence and compatibility**
- FR-390: Players, names, token digests and the lobby stage are stored in the same transaction as the event they cause, with the recovery of FR-289 and the restart behaviour of 008 (a restarted lobby is still a lobby; a started match resumes as before).
- FR-391: A database written by 008 opens unchanged: matches without players behave as before and the new tables are created when missing (no data migration). OQ1 asks the user to confirm that no migration of old data is needed.
- FR-392: The protocol package gains the new commands, reads, events and error codes with encoders, decoders and canonical forms; every 008 wire form that is not listed above keeps its bytes (the 008 goldens pass unchanged except where this spec names a change).

**Non-functional**
- NFR-72: Anonymous creation and join cannot exhaust memory, storage or sockets: every new list and body is bounded (as FR-290's family of limits), and a test drives each limit to its edge.
- NFR-73: Tokens never appear in a read, an event, a log or an error; only digests are stored. A scan and a test over the log prove it.
- NFR-74: Secrecy and determinism hold: nothing about a future round is readable in the lobby or by any new read, and the simulation package, the map format and the 008 secrecy tests are unchanged.
- NFR-75: The existing 008 and 009 suites pass; every golden or test changed by this spec is listed in `PROGRESS.md` with its reason.
- NFR-76: Time rules (expiry, forced phase 2, rate limits) use the fake clock in tests; only the scheduler holds timers (008).

## Out of scope
The web interface (spec 013); the Discord bot (012); accounts, passwords, recovery, name change, kicking or banning, profanity filters; chat; spectator counts; changes to the sim, the map format or `MatchState`; modes other than "Clásico"; leaderboards across matches; ordering of candidate neighbours by border length (needs adjacency weights the map format lacks; spec 013 orders by territory count).

## Open questions (answered by the user, 2026-10-30)
- OQ1: no existing database needs migrating (decided: no). FR-391 creates the new tables when missing.
- OQ2: accepted. Public bounds I >= 30 s, L1 >= 10 s, L2 >= 5 s and the dev map only until the user adds maps; all are settings.
- OQ3: accepted. No automatic start; the lobby starts only by the host.
- OQ4: accepted. A setting for the number of trusted proxy hops, default 0.

## Done criteria
1. Tests for every id above, written first; typecheck and CI green; ledger in `packages/sim/test/traceability.test.ts` extended.
2. Real-server tests (HTTP and stream) for: public creation and its limits, lobby, start, join with name rules, token-only submission, impersonation refused, forced absorber (refusal, no points, short phase 2), names in reads, who-guessed-right read, restart of a lobby.
3. A hand run with the fixture: create, join with two tokens, start, predict, see names in the leaderboard.
4. The user accepts the result; the spec becomes `implemented`.

## Decisions
- D1 (user): public creation with limits. D2 (user): player token. D3 (user): lobby with manual start. D4 (user): server spec 011, interface spec 013.
- D5 (planner proposal): names are server-stored and public; tokens are digests only; the player id is generated by the server, not chosen.
- D6 (planner proposal): the forced-absorber rule is derived from the candidates the server already computes (FR-313(b) of 008), so it adds no engine change.
