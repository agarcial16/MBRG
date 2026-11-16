# Spec 017 — Bot embeds and paged leaderboard
Status: approved by the user on 2026-11-15. Tier: Light SDD (Discord bot; no server change). Builds on 012 (implemented). Ids continue 016: FR-472 onwards, NFR-92 onwards.

## Context and goal
The bot's announcements are plain text, and the leaderboard shows only 10 rows with a viewer link. This spec makes the announcements Discord embeds that highlight who matters, and replaces the 10-row text board with a paged embed. Players predict; they never control the match. Nothing about a future round is ever shown (012 NFR-88).

## Users
- Channel member: reads announcements, pages the leaderboard.
- Channel manager and operator: invite the bot with the right permissions.

## User stories
- US-1. As a member, I want each announcement to show victim, absorber, who guessed right and the winner at a glance.
- US-2. As a member, I want to page the whole leaderboard and always see my own rank.

## Functional requirements
- FR-472: THE SYSTEM SHALL post every event announcement of 012 FR-453 and FR-456 as an embed with a color per message type (round opened, victim revealed, round applied, scored phase, match finished, match halted), a title and fields; no image of any kind (no thumbnail, no avatar, no map image, no animation). Changed 2026-11-16 by the user after the hand run: the default avatar thumbnail was too big and distracting.
- FR-473: THE SYSTEM SHALL highlight in the embeds: the victim (revealed and applied), the absorber (applied), the members who guessed right (mentions, at most 10 then "and N more", 012 FR-456) and the final winner.
- FR-474: THE SYSTEM SHALL keep the Predict flow of 012 FR-453, FR-454, FR-465 working in the open-phase embed: one Predict button, the viewer link button, the per-second countdown label and the disabled "cerrado" state; editing the countdown never changes the embed text.
- FR-475: IF the bot lacks the channel permission Embed Links, THEN THE SYSTEM SHALL post the same announcement as the plain text of 012 and log one operator warning per channel (no member data); it SHALL NOT drop the announcement.
- FR-476: THE SYSTEM SHALL list Embed Links among the permissions in the bot's invite instructions (operator documentation).
- FR-477: WHEN a member runs `/mbrg board`, THE SYSTEM SHALL reply in the channel with a leaderboard embed of the followed or last match (012 FR-466): 10 rows per page (rank, mention, points), ranked by points, ties sharing the server's rank, with a page indicator "Página N/M" and Previous and Next buttons.
- FR-478: WHEN a match finishes, THE SYSTEM SHALL post the winner embed followed by the public leaderboard embed, page 1, with the same buttons.
- FR-479: THE SYSTEM SHALL show on every page a "Tu puesto" line with the rank and points of the member who ran the command (of the member with no points: a sentence saying so); the final post has no single asker, so its buttons show each presser their own "Tu puesto" privately (see FR-480).
- FR-480: WHEN a member other than the one who ran `/mbrg board` presses Previous or Next, THE SYSTEM SHALL change nothing and reply only to them with a private sentence; on the final post (no asker) every member pages for themselves with a private (ephemeral) page, so the public message never changes.
- FR-481: THE SYSTEM SHALL disable the buttons of a leaderboard message 5 minutes after it was posted (edited once; a failed edit is ignored); Previous is disabled on page 1 and Next on the last page.
- FR-482: THE SYSTEM SHALL replace the "Clasificación completa" viewer link of 012 FR-468 by the paging; the link and its string are removed.
- FR-483: THE SYSTEM SHALL take names only from Discord (mentions, member display names); a row of another namespace shows its name from the server's leaderboard row, else "Jugador". No server change.
- FR-484: THE SYSTEM SHALL keep every sentence, field name and title in the strings module (Spanish).

## Non-functional requirements
- NFR-92 (Secrecy): no embed carries data of a future round, a wrong guess or a guess count before scoring; the 012 secrecy test is extended to the embeds.
- NFR-93 (Testability): the embed content, paging and permission decisions are pure functions tested with Vitest; only the Discord shell uses discord.js. No new dependency.
- NFR-94 (Limits): Discord limits (embed 6,000 chars, 25 fields, description 4,096, field value 1,024, 5 buttons per row) are respected; long lists are cut. Mentions never ping.

## Edge cases
- Leaderboard with 0 rows: one embed saying there are no points yet, no buttons.
- The asker is on the current page: the line still shows (no duplicate marking required).
- Leaderboard changes while a page is open: each press re-reads the server's board; the page count may change, and the page is clamped.
- A press after the 5 minutes (race with the edit): a private sentence that it expired.
- Bot restarts: old leaderboard buttons are no longer served; a press gets a private sentence that it expired. Announcement resume (012 FR-459) is unchanged.
- A member left the server: the mention shows as unknown, as in 012.

## Out of scope
Map images, GIF or video; names in the viewer; server changes; new dependencies; per-faction images or flags; web dashboard.

## Done criteria
- Pure-logic tests green (embeds, paging, permission fallback, secrecy); `npm test` and `npm run typecheck` green.
- Hand run on a test server: each announcement type as an embed, Predict countdown inside an embed, board paging by the asker and a refusal for another member, final post, disabled buttons after 5 minutes, and the plain-text fallback with Embed Links removed.
- Reviewer reports each FR as covered.

## Open questions
- FR-479/480 on the final post: proposed that it is public and any member pages privately (ephemeral). Alternative: public final post without buttons (top 10 only). Which?
- `/mbrg board`: reply public in the channel (proposed, so the buttons can be edited and others see it) or ephemeral to the asker only?
- Where do invite instructions live today? None exist in the repo docs; FR-476 assumes a new short section in the bot's operator doc.

Decisions (user, 2026-11-15, all as proposed):
- Final post: public, with paging buttons whose pages are private to the member who presses.
- `/mbrg board`: public reply in the channel (the asker alone pages it).
- Invite instructions: a short section in the bot operator doc, including Embed Links.

## Implementation notes (2026-11-15, found in review; the spec is fixed to match the code)
- FR-481 and the restart edge case apply to the public leaderboard messages (the `/mbrg board` reply and the final post). The private pages of the final post (FR-480) are ephemeral: their buttons carry the match, are not disabled after 5 minutes and keep working until Discord drops them.
- A leaderboard of one page shows both buttons disabled and is not registered for expiry.
- The final post is also posted when there are 0 rows (the "no points yet" embed, no buttons).
- FR-475 also covers an unreadable permission: if Discord refuses an embed send, the bot resends the same announcement as plain text.
- The invite also needs Read Message History (the bot fetches a message to disable its buttons).
