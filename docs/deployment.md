# Deploying MBRG

How to run the real stack — game server, Discord bot and viewer web app — on a
small Linux VPS. It mirrors the code exactly: every variable named here is read
by `apps/server/src/service/settings.ts` or `apps/bot/src/core/env.ts`, and every
default named here is a constant in those files.

**Secrets** (constitution rule 5) live only in environment variables: never
committed, never logged. Both apps validate themselves by printing variable
*names*, never values. Everything below uses placeholders like `<generate-one>`.

## Prerequisites

- **Node >= 24** (`.nvmrc` pins 24). The server uses `node:sqlite` (built in).
  For systemd, install Node from NodeSource so `npm` is at a fixed path.
- A **checkout** of this repo on the VPS, then `npm install` from the root.
- A **Discord application** with a bot token: Developer Portal -> New
  Application -> Bot -> Reset Token. You never need privileged intents.
- A **public origin** for the game server (e.g. `https://game.example.com`) and
  one for the viewer (e.g. `https://mbrg.example.com`). TLS comes from a reverse
  proxy; the server itself keeps listening on localhost.

Sanity-check the platform before anything else:

```sh
npm run check -w @mbrg/server     # prints "check ok"
```

## Credentials

A credential is 22–256 characters of `[A-Za-z0-9_-]` (base64url) with at least
128 bits of entropy. A value made only of hex digits is read as hex, so it
needs **32 or more** characters. Generate either way:

```sh
openssl rand -hex 32                                            # 64 hex chars
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
```

You need two: the **operator credential** (full control of the server) and the
**discord client credential** (the bot). A third, for the viewer's internal test
client page, is optional and dev-only.

## The game server

Run from the repo root: `npm run start -w @mbrg/server` (`tsx src/main.ts`).

Two variables are required; the rest have defaults:

| Variable | Meaning | Default |
|---|---|---|
| `MBRG_OPERATOR_CREDENTIAL` | operator credential; the only one that may create running matches directly | **required** |
| `MBRG_MAPS` | JSON object of map id -> package folder (holds `map.json`, `ids.png`, `presentation.json`), e.g. `{"dev":"/opt/mbrg/maps/dev"}`. Ids: `[a-z0-9-]{1,64}`. Use **absolute** paths: a relative path resolves from `apps/server`, the npm workspace cwd, and a wrong one fails map validation. | **required** |
| `MBRG_CLIENTS` | JSON array of `{"namespace":"...","credential":"..."}`. Namespace `[a-z0-9]{1,16}`, `player` is reserved; duplicate namespaces/credentials, or a client credential equal to the operator's, are refused at start. | none |
| `MBRG_DATABASE` | SQLite file path (or `:memory:`). Put it somewhere backed up. | `mbrg.sqlite` (cwd) |
| `MBRG_HOST` / `MBRG_PORT` | listener bind. Keep `127.0.0.1` and put the reverse proxy in front. | `127.0.0.1` / `8787` |
| `MBRG_ALLOWED_ORIGINS` | comma-separated origins allowed to send credentialed (Bearer) cross-origin requests, matched exactly, e.g. `https://mbrg.example.com`. Credential-free reads are open to any origin (see Viewer). | none |
| `MBRG_PUBLIC_MAPS` | map ids (each in `MBRG_MAPS`) that may be used for public creation — the bot's `/mbrg create`. Empty or absent: public creation is **off**. | none |
| `MBRG_FORCED_PHASE_SECONDS` | forced-absorber phase span, 1–3600. The hand run used 10. | 5 |
| `MBRG_MAX_RUNNING_MATCHES` | cap of running matches. | 20 |
| `MBRG_MAX_PLAYERS` | most players one match holds, 1–10000. | 200 |
| `MBRG_TRUSTED_PROXY_HOPS` | reverse proxies in front of the listener. **Set to 1** behind one nginx/Caddy so anonymous rate limits see the real address. | 0 |
| `MBRG_PUBLIC_*`, `MBRG_MAX_OPEN_LOBBIES`, `MBRG_MAX_PUBLIC_RUNNING`, `MBRG_LOBBY_EXPIRY_HOURS` | public-creation bounds: `MIN_INTERVAL` (30, must exceed `MIN_PHASE1`+`MIN_PHASE2`), `MIN_PHASE1` (10), `MIN_PHASE2` (5), `MAX_INTERVAL` (3600), open-lobby cap (50), running-public cap (20), lobby expiry in hours (24). | as listed |
| `MBRG_LIMIT_*` | per-minute rate limits: commands 600, reads 1200, submissions 30, advances 30, anonymous 120, streams 50, anonymousStreams 5, createSource 5, createAll 30, joinSource 20, joinMatch 120. | as listed |

Invalid settings: the server prints `invalid settings: <names>` and exits 1.
Logs are JSON lines with closed events only (`{"event":"listening","port":8787}`);
SIGINT/SIGTERM flush and stop it within 5 s.

**Creating matches is the bot's job**: `/mbrg create` in Discord, which needs
`MBRG_PUBLIC_MAPS` set. The operator credential can also create a running match
directly (`POST /matches`), but a normal deployment never does.

A minimal production set (the values of the verified hand run, with fake
credentials):

```sh
MBRG_OPERATOR_CREDENTIAL=<generate-one>
MBRG_MAPS={"dev":"/opt/mbrg/maps/dev"}
MBRG_CLIENTS=[{"namespace":"discord","credential":"<generate-one>"}]
MBRG_PUBLIC_MAPS=dev
MBRG_FORCED_PHASE_SECONDS=10
MBRG_DATABASE=/var/lib/mbrg/mbrg.sqlite
MBRG_TRUSTED_PROXY_HOPS=1
```

## The Discord bot

Run from the repo root: `npm run start -w @mbrg/bot`.

| Variable | Meaning |
|---|---|
| `DISCORD_TOKEN` | the bot token from the Developer Portal. **required** |
| `MBRG_SERVER_URL` | the game server origin, e.g. `http://127.0.0.1:8787` (same host) or `https://game.example.com`. Trailing slashes are trimmed. **required** |
| `MBRG_DISCORD_CREDENTIAL` | the bot's client credential. **required** — and the same value must appear in the server's `MBRG_CLIENTS` with namespace `discord`: the pair is configured **twice, identical**, once on each side. Player ids become `discord:<user id>`. |
| `MBRG_BOT_STATE_FILE` | path of the bot's JSON state (channels followed, last matches). A missing file is an empty state; writes are atomic (temp file + rename). **required** |
| `MBRG_VIEWER_URL` | the viewer's public base address, e.g. `https://mbrg.example.com`. Announcements link to `<viewer>?match=<id>&round=N&spectate=1`. Without it the bot posts no viewer links. optional |

A missing variable prints `Falta la variable de entorno <NAME>.` (UI strings are
Spanish) and exits 1 — no connection is attempted. On success it prints
`Bot listo.` and registers its slash commands globally on the application.

**Invite**: Developer Portal -> OAuth2 -> URL Generator, scopes
`bot` + `applications.commands`, permissions **Send Messages**, **Embed
Links**, **Read Message History** (the bot sends announcements, posts embeds —
falling back to plain text if a channel lacks the permission — and fetches its
own board messages to disable their buttons). Intents: **Guilds only**; enable
no privileged intents (no message content, no member data). The manage commands
(`create`, `stop`) check **Manage Channels on the invoking member**, not on the
bot — grant that role to whoever should manage matches in a channel.

## The viewer

**Production**: bake the server origin at build time, then serve the static
output with any file server (the same nginx/Caddy works):

```sh
VITE_MBRG_SERVER=https://game.example.com npm run build -w @mbrg/web
# serve apps/web/dist
```

Without `VITE_MBRG_SERVER` a production build falls back to the page's own
origin, so only bake nothing if viewer and server share one origin.

CORS: the viewer's reads (match list, states, records, map files, event stream)
carry no credential, so the server answers them from **any** origin. Only a page
that sends the Bearer header cross-origin needs `MBRG_ALLOWED_ORIGINS` on the
game server — in practice the internal test client below, if you host it.

`VITE_MBRG_WEB_CREDENTIAL` exists only for that internal test client page (a
form to submit predictions from the browser): put it in
`apps/web/.env.local`, which git ignores, and never in a production build.

**Development alternative**: `npm run dev` (Vite on :5173) talks to
`http://127.0.0.1:8787` by default — the server's own host and default port —
so a local server and a dev viewer need no configuration at all.

## Keeping it up: systemd

Two units, one per process. Keep the environment in files **outside the repo**,
readable only by the service user, so no checkout, backup or log ever touches
them:

```sh
sudo install -o mbrg -g mbrg -m 600 /dev/null /etc/mbrg/server.env
sudo install -o mbrg -g mbrg -m 600 /dev/null /etc/mbrg/bot.env
# paste each environment block above into its file
```

```ini
# /etc/systemd/system/mbrg-server.service
[Unit]
Description=MBRG game server
After=network-online.target

[Service]
User=mbrg
WorkingDirectory=/opt/mbrg
EnvironmentFile=/etc/mbrg/server.env
ExecStart=/usr/bin/npm run start -w @mbrg/server
Restart=on-failure
# the server flushes on SIGTERM within 5 s
TimeoutStopSec=10

[Install]
WantedBy=multi-user.target
```

```ini
# /etc/systemd/system/mbrg-bot.service
[Unit]
Description=MBRG Discord bot
After=network-online.target mbrg-server.service

[Service]
User=mbrg
WorkingDirectory=/opt/mbrg
EnvironmentFile=/etc/mbrg/bot.env
ExecStart=/usr/bin/npm run start -w @mbrg/bot
Restart=on-failure
# the bot disconnects on SIGTERM
TimeoutStopSec=10

[Install]
WantedBy=multi-user.target
```

`/opt/mbrg` is the repo checkout; with Node from nvm instead of NodeSource,
replace `/usr/bin/npm` with the absolute path of that Node's `npm`. Then:

```sh
sudo systemctl daemon-reload
sudo systemctl enable --now mbrg-server mbrg-bot
```

Docker would also work, but it is not set up here: the stack is minimal on
purpose and new tooling needs a decision.

## TLS

Do not hand-roll TLS. Put nginx or Caddy in front: one vhost proxies
`https://game.example.com` to `http://127.0.0.1:8787`, another serves
`apps/web/dist` for the viewer; both get automatic certificates (Caddy by
default, nginx with certbot). Remember `MBRG_TRUSTED_PROXY_HOPS=1` on the
server.

## Verify it works

Mirrors the hand-run checks of 2026-11-19/20 (with throwaway credentials):

1. `npm run check -w @mbrg/server` prints `check ok`.
2. The server log shows `{"event":"listening","port":8787}` (nothing else at
   start unless it recovers matches).
3. `curl http://127.0.0.1:8787/config` answers `200` with your public-creation
   config: `{"maps":["dev"],...,"enabled":true}`.
4. The bot log shows `Bot listo.`; stopping it with a missing variable instead
   prints only that variable's name.
5. `/mbrg create` in a Discord channel announces a lobby, and its viewer link
   opens the waiting map.
6. Stop the server (`systemctl stop mbrg-server`) and open the same viewer
   link: the page shows its own failure notice — no crash, no leaked detail.
   Start it again and the viewer recovers.
