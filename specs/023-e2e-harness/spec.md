# Spec 023 — E2E harness: real server + real bot core, faked Discord
Status: implemented

## Context and goal
Every bot change today is checked against a fake server (`apps/bot/test/helpers/fake-server.ts`), so a drift between the bot and the real server's replies and events only shows up in a live Discord channel. Goal: one scripted match, played by the REAL server (real routes, service, store, map package) and the REAL bot core (server client, follower, handler), with only Discord faked at the poster level. The same script serves three ends: a test in `npm test` (contract drift), a secrecy check, and a one-command local run that prints what the channel would show and draws the embeds.

## Users
- **Developer**: wants proof in `npm test` that the bot still talks to the real server.
- **User (channel reader)**: wants to read the match as the channel would show it, without opening Discord.

## User stories
- US-1. As a developer, I want a test that plays a whole match against the real server and real bot core so that contract drift the fake server hides fails CI.
- US-2. As a user, I want `npm run e2e` to print the channel transcript and draw the embeds so I can review a change without opening Discord.

## Definitions
- **Scripted match**: a fixed scenario (map, round seeds, players, choices) whose outcome is fully deterministic; the script computes each round's victim/absorber with `@mbrg/sim` from the same seeds the server is given.
- **Channel post**: any message the fake poster receives (text, embed, buttons), edits included.

## Functional requirements
- **FR-540.** THE SYSTEM SHALL provide a test, run as part of `npm test`, that boots the real `apps/server` (production routes, real service, real store, real map package from `maps/dev`) and the real bot core with the fake Discord poster, and plays a full scripted match through the real HTTP interface: create, start, at least four named players predicting, every round to the end, phase results and the final leaderboard. WHEN any bot-visible reply or event of the real server no longer matches what the bot reads, THE SYSTEM SHALL fail that test.
- **FR-541.** WHILE the scripted match of FR-540 runs, THE SYSTEM SHALL check every channel post made before a round's reveal and fail WHEN a post names that round's victim, any later round's victim, or carries the host token; the check covers text, embeds and button labels/urls.
- **FR-542.** THE SYSTEM SHALL provide a command (`npm run e2e`) that runs the same scripted match (same harness, same script) and prints a readable text transcript of the channel — each message's text, embed as text (title, fields, footer, colour), and buttons with their labels/styles — plus the viewer URL of the match.
- **FR-543.** THE SAME COMMAND SHALL write a local HTML file that draws every posted message with its embed (title, colour bar, description, fields, footer) and its buttons, in a generic Discord-like dark style with no Discord logos or branding.
- **FR-544.** The e2e harness SHALL be deterministic (two runs produce the same transcript), SHALL pass the map folder as an absolute path (never a relative `MBRG_MAPS`), and SHALL boot the server in-process with a fake clock and fake scheduler so the whole match finishes in seconds of real time.

## Non-functional requirements
- No new dependency (ask first). No real Discord connection, no token, no rate-limit or permission behaviour of real Discord.

## Edge cases
- A round whose victim has one absorber candidate (forced): the script predicts only the victim there; the bot must not offer the phase (already covered by unit tests, exercised here for free).
- The last round: winner announcement plus the final public leaderboard post.

## Out of scope
Driving real Discord (ToS; see bot lessons), rate limits, permissions, `apps/bot/src/discord/shell.ts` itself, the web viewer, new strings or embed content (the harness only records what exists).

## Done criteria
- `npm test` and `npm run typecheck` green; the FR-540/541 test runs inside `npm test`.
- `npm run e2e` prints the full transcript with the viewer URL and writes the HTML file; its path is printed.
- Screenshots of the HTML preview posted in the implementing thread (AGENTS.md visual checks); no before/after widget (there is no "before").
- Spec `Status: implemented`, `docs/board.md` row updated, `MEMORY.md` touched if a durable lesson emerged, in the same PR.
