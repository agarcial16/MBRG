# Spec 012 — Discord bot
Status: implemented pending the hand run (approved by the user on 2026-11-13). Tier: Light SDD (Discord bot; a separate app that only consumes the server's public interface). Depends on 008, 009 and 011 (implemented). Ids continue 013/015: FR-451 onwards, NFR-88 onwards.

## Context and goal
The server already offers everything a chat client needs: public matches, a lobby, per-phase predictions by a client credential in the namespace `discord`, public results, a leaderboard and an event stream (008, 011). This spec adds the Discord client: a channel follows one match, members predict with buttons, and the bot announces each round and the results. Players predict; they never control the match.

## Users
- Channel member: predicts and reads the announcements.
- Channel manager (Discord permission "Manage Channel"): starts and stops a match in the channel.
- Operator: runs the bot with a Discord token and a `discord` client credential from the environment.

## User stories
- US-1. As a channel manager, I want to create and start a match in a channel so that my community can play.
- US-2. As a member, I want to choose the victim, the absorber and the winner with buttons so that nobody sees my choice before the phase is scored.
- US-3. As a member, I want an announcement at each phase and round, with who guessed right, and a leaderboard on demand.

## Definitions
- **Followed match**: the one match a channel announces; a channel follows at most one at a time.
- **Local player id**: the member's Discord user id; the server builds `discord:<id>` (008 FR-284).

## Functional requirements
- FR-451: WHEN a channel manager runs `/mbrg create` with a public map and a pace, THE SYSTEM SHALL create a public match through the server (011 FR-369), make the channel follow it and post the lobby message with the match name, map and a Start button.
- FR-452: WHEN a channel manager presses Start or runs `/mbrg start`, THE SYSTEM SHALL start the match with the host token it holds; for anyone else it replies, visible only to them, that they cannot.
- FR-453: THE SYSTEM SHALL post one message per event of the followed match: round opened (phase 1), victim revealed (phase 2, or "forced absorber" when the server marks it so), round applied (victim, absorber, factions left) and match finished (winner). Each open-phase message carries ONE "Predict" button and a link to the viewer at that round (FR-462); never a button per candidate.
- FR-454: WHEN a member presses "Predict" or runs `/mbrg predict`, THE SYSTEM SHALL offer the open phase's candidates only to that member: a select menu when there are 25 or fewer; otherwise the button opens a text window where the member types part of a name, and the bot answers with the matching candidates (ignoring case and accents, at most 25; a single match is chosen at once; none matching says so). `/mbrg predict` stays as a shortcut with autocomplete (up to 25 suggestions filtered by the typed text). The choice is submitted through the `discord` client credential and answered only to that member ("Chosen: X"); a later choice replaces it while the phase is open.
- FR-462: THE SYSTEM SHALL build the viewer link from a configured base address; WHEN none is configured, THE SYSTEM SHALL post no link.
- FR-463: THE SYSTEM SHALL NOT require any join command: a member's first valid prediction makes them a player, also in a match already running.
- FR-455: IF the phase is closed, THE SYSTEM SHALL reply only to the member with a plain sentence and change nothing; IF the server refuses for any other reason (forced absorber, rate limit, finished), THE SYSTEM SHALL reply only to the member with a plain sentence.
- FR-456: WHEN a phase is scored, THE SYSTEM SHALL post who guessed right (the members as mentions, at most 10, then "and N more") and never any wrong guess, any count of guesses before scoring, or any unscored phase (008 P12).
- FR-457: WHEN a member runs `/mbrg board`, THE SYSTEM SHALL reply with the leaderboard (rank, mention, points; first 10) of the followed match.
- FR-458: WHEN a manager runs `/mbrg stop`, THE SYSTEM SHALL make the channel stop following; the match itself continues on the server.
- FR-459: WHEN the bot restarts, THE SYSTEM SHALL keep following the same matches and resume from the event after the last one it announced, announcing none twice and none lost within the server's retention.
- FR-460: IF the event stream drops, THEN THE SYSTEM SHALL reconnect with backoff and resume from the last announced event; WHILE disconnected, it SHALL NOT announce anything.
- FR-461: THE SYSTEM SHALL show every sentence from a single strings module (Spanish).

## Non-functional requirements
- NFR-88 (Secrecy): the bot holds nothing about a future round: it reads only public data and events, and a test with a planted secret in a fake server proves no message contains it.
- NFR-89 (Privacy): the Discord token, the `discord` credential, host tokens and Discord ids never appear in a log, a commit or a message other than the mention of that member; the stored state keeps host tokens only for followed matches.
- NFR-90 (Testability): the decisions (event to message, press to submission, command to action) are pure functions tested with Vitest without Discord; only a thin shell touches the Discord library.
- NFR-91 (Limits): Discord's own limits (3 s to answer an interaction, 5 buttons per row, 2,000 characters per message) are handled: long lists are cut, answers are deferred when needed.

## Edge cases
- A channel already following a match runs `/mbrg create`: refused with a sentence, nothing created.
- Two presses at once from one member: the last one the server stores wins.
- A member leaves the server: their points stay; the mention shows as an unknown user.
- A match with more than 25 candidates (a 100+ faction map): the text-window path of FR-454 (or the command's autocomplete); the channel never receives a list of candidates.
- The server is down at start: the command replies that the server is unavailable.

## Out of scope
- Server changes (the interface is used as it is), a web dashboard for the bot, several simultaneous matches per channel, direct messages, voice, accounts across matches, other modes, translating the bot.
- Round animation as a GIF or video, and a map image per round: a later spec (needs server-side rendering, heavy dependencies and its own secrecy review). This version only links to the viewer.

## Done criteria
- Pure-logic tests green; `npm test` and `npm run typecheck` green; secrecy test (NFR-88) green.
- A hand run on a test Discord server: create, start, predict, one full round announced, leaderboard, restart in the middle of a match without loss or repeat.
- Reviewer reports each FR as covered.

## Open questions
Decided by the user on 2026-11-13 (the spec was approved the same day):
- OQ1: the dependency `discord.js` is approved.
- OQ2: the bot keeps "channel -> match, host token, last event" in one small JSON file next to the bot, outside git, written atomically.
- OQ3: the bot creates only public matches; it never holds the operator credential.
- Review decisions (2026-11-13, all as proposed): the bot reads the full phase results (not the server's names-only winners list, which omits `discord:` players) and keeps only player id and correct flag; a channel stops following when the match finishes or halts (the final leaderboard is announced at the end); the winner prediction is not offered in this version; mentions never ping. Accepted limits: a crash between posting and saving may repeat one announcement (never lose one); a crash between creating a match and saving its host token loses that token.
- OQ4: the bot is a separate app in the same repo (the user asked for it to be apart): proposal `apps/bot`, to confirm with the plan.
