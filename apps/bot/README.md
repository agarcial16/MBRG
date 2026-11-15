# MBRG Discord bot (operator guide)

The bot lets a Discord channel follow one public MBRG match: it announces each round as an embed, members predict with buttons,
and `/mbrg board` shows a paged leaderboard. Specs: `specs/012-discord-bot` and `specs/017-bot-embeds`.

## Run

Set these environment variables, then `npm run start -w @mbrg/bot` from the repository root.

| Variable | Required | Meaning |
| --- | --- | --- |
| `DISCORD_TOKEN` | yes | The bot token of your Discord application. Never commit it. |
| `MBRG_SERVER_URL` | yes | Base address of the MBRG server. |
| `MBRG_DISCORD_CREDENTIAL` | yes | The `discord` client credential of the server. |
| `MBRG_BOT_STATE_FILE` | yes | Path of the small JSON file where the bot keeps its followed matches (keep it out of git). |
| `MBRG_VIEWER_URL` | no | Base address of the viewer; without it the announcements carry no "Ver en el visor" link. |

## Invite the bot to a server

In the [Discord developer portal](https://discord.com/developers/applications), open your application, then **OAuth2 > URL Generator**:

1. Scopes: `bot` and `applications.commands`.
2. Bot permissions (permission integer `84992`):
   - **View Channels**
   - **Send Messages**
   - **Embed Links** (spec 017: without it the bot still announces everything, but as the plain text of spec 012 and logs one
     `embed-links-missing` warning per channel; the leaderboard also falls back to text)
   - **Read Message History** (needed to disable the leaderboard buttons after 5 minutes)
3. Open the generated URL and choose the server.

The bot needs no privileged gateway intent (it uses `Guilds` only). A channel manager (Discord permission **Manage Channel**) runs
`/mbrg create`; only the member who ran it can start the match.

If a channel overrides the permissions of the bot role, grant **Embed Links** and **Read Message History** in that channel too.

## What members see

- Each announcement (round opened, victim revealed, round applied, scored phase, match finished, match halted) is an embed with its
  own color; the bot's avatar is the thumbnail. Mentions never ping.
- `/mbrg board` posts the leaderboard in the channel, 10 rows per page, with **Anterior** and **Siguiente**. Only the member who ran
  the command can page it; anyone else gets a private sentence. After 5 minutes its buttons are disabled.
- When a match finishes the bot posts the winner and then the public leaderboard (page 1). Any member can press its buttons and
  gets a private page with their own "Tu puesto" line; the public message never changes.
- After a bot restart the old leaderboard buttons are no longer served: a press gets a private "caducó" sentence. Announcement
  resume is unchanged.
