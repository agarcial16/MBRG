# Spec 017 - Progress

## Implementation (Light SDD, one implementer) - 2026-11-15

### What changed (only `apps/bot` and this folder)
- `core/embeds.ts` (new): one embed per announcement type with its own color; victim, absorber, right guessers (mentions, max 10 then "y N mas") and winner as fields (FR-472, FR-473). Each `OutMessage` keeps `text` = the plain text of 012, the fallback (FR-475).
- `core/board.ts` (new): `boardView(rows, page, {matchId, kind, viewerId})` gives the embed, its text fallback and the Previous/Next buttons; 10 rows per page, ranked by points with the server's rank, "Pagina N/M" footer, "Tu puesto" field, clamped page, disabled buttons at the ends, 0 rows = one embed with no buttons (FR-477, FR-479, FR-481, FR-483).
- `core/send-mode.ts` (new): embed or text, and one warning per channel (FR-475). `core/limits.ts`: `fitEmbed` cuts to Discord's limits (NFR-94).
- `core/actions.ts`: `board-press` interaction -> `board-page` action: the asker pages in place, another member gets a private sentence, the final post (no asker) gives each presser a new private page, expired or unknown message gives "caduco" (FR-480, FR-481). `core/custom-ids.ts`: `mbrg:bd:<p|n>:<page>` (public) and `mbrg:bm:<p|n>:<page>:<match>` (private pages).
- `io/boards.ts` (new): in-memory registry by message id with injected clock and timer; 5 minutes after posting it asks the poster to disable the buttons once, a failed edit is ignored. `io/follower.ts` registers the final post; `io/handler.ts` serves `board` and `board-page`; `io/server-client.ts`: `leaderboard(matchId)` now reads every page (`rankOf` and the 10-row read are gone).
- `discord/translate.ts`, `discord/shell.ts`: embed payloads (avatar thumbnail, no ping), Embed Links read per channel, in-place `update` delivery, `disable` that edits only the components. `main.ts` wires the registry.
- The "Clasificacion completa" viewer link and its string are removed (FR-482). All new sentences are in `core/strings.ts` (FR-484; the ASCII scan and the dead-string scan still pass).
- `apps/bot/README.md` (new): operator guide with the invite instructions, including Embed Links (FR-476).

### Decisions the spec did not fix
- D1: private pages (from the final post) carry the match in their button ids (`mbrg:bm:...`) because an ephemeral message is not registered; they keep working until Discord drops them and are not disabled after 5 minutes. Only the public messages are registered and disabled.
- D2: a leaderboard of a single page is not registered (nothing to page; both buttons show disabled).
- D3: the final post is posted also with 0 rows (one embed "Todavia no hay puntos", no buttons), following the edge case; 012 posted only the winner.
- D4: Read Message History is also needed in the invite (the bot fetches a message to disable its buttons), so the permission integer is 84992.
- D5: the bot's own plain-text fallback of the board shows the same page (title, rows, page, own line); buttons stay.

### Tests
- `npx vitest run apps/bot`: 161 passed (new: `core-embeds`, `core-board`, `bot-flow-board`, extra cases in `discord-translate`; the 012 board tests were rewritten for the paged embed, the 012 flow tests now also expect the final board post).
- Mutation proofs (each killed by the suite, then reverted): (1) any member may page the asker's board (2 tests fail); (2) Embed Links ignored, always embed (1 fails); (3) no 5-minute expiry check (2 fail); (4) page not clamped (2 fail).
- NFR-92: the 012 secrecy test (planted secrets) now also asserts every announcement of the journey was an embed, and it scans them; the private-data test (NFR-89) scans the embeds.

### Untested on real Discord (hand run needed)
- That the permission read (`permissionsFor(...).has(EmbedLinks)`) matches what Discord enforces, and that an interaction reply (board press, `/mbrg board`) with embeds behaves the same with and without Embed Links.
- The rendering: colors, thumbnail (avatar URL), footer, mentions inside embeds (name shown, no ping, a member who left shows as unknown).
- The in-place edit of the public board (`deferUpdate` + `editReply`) and the private page of the final post (new ephemeral reply, then edit of that ephemeral message by its own buttons).
- The 5-minute disable (fetch message, set `disabled` on every component, edit) and the Read Message History need.
- Editing the countdown on an embed message (content cleared, embed kept), and the switch embed <-> text when the permission changes between edits.
- Real timing: a board read of many pages inside Discord's 3 s (the reply is deferred, but each page of the server is a request).
