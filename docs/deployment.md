# Deploying FactionFall

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
| `MBRG_MAPS` | JSON object of map id -> package folder (holds `map.json`, `ids.png`, `presentation.json`), e.g. `{"dev":"/opt/mbrg/maps/dev","spain-provinces":"/opt/mbrg/maps/spain-provinces","world-countries":"/opt/mbrg/maps/world-countries"}`. Predefined packages are committed under `maps/` (`dev`, `spain-provinces`, `world-countries`). Ids: `[a-z0-9-]{1,64}`. Use **absolute** paths: a relative path resolves from `apps/server`, the npm workspace cwd, and a wrong one fails map validation. | **required** |
| `MBRG_CLIENTS` | JSON array of `{"namespace":"...","credential":"..."}`. Namespace `[a-z0-9]{1,16}`, `player` is reserved; duplicate namespaces/credentials, or a client credential equal to the operator's, are refused at start. | none |
| `MBRG_DATABASE` | SQLite file path (or `:memory:`). Put it somewhere backed up. | `mbrg.sqlite` (cwd) |
| `MBRG_HOST` / `MBRG_PORT` | listener bind. Keep `127.0.0.1` and put the reverse proxy in front. | `127.0.0.1` / `8787` |
| `MBRG_ALLOWED_ORIGINS` | comma-separated origins allowed to send credentialed (Bearer) cross-origin requests, matched exactly, e.g. `https://mbrg.example.com`. Credential-free reads are open to any origin (see Viewer). | none |
| `MBRG_PUBLIC_MAPS` | map ids (each in `MBRG_MAPS`) that may be used for public creation — the bot's `/ff create`. Empty or absent: public creation is **off**. | none |
| `MBRG_FORCED_PHASE_SECONDS` | forced-absorber phase span, 1–3600. The hand run used 10. | 5 |
| `MBRG_MAX_RUNNING_MATCHES` | cap of running matches. | 20 |
| `MBRG_MAX_PLAYERS` | most players one match holds, 1–10000. | 200 |
| `MBRG_TRUSTED_PROXY_HOPS` | reverse proxies in front of the listener. **Set to 1** behind one nginx/Caddy so anonymous rate limits see the real address. | 0 |
| `MBRG_PUBLIC_*`, `MBRG_MAX_OPEN_LOBBIES`, `MBRG_MAX_PUBLIC_RUNNING`, `MBRG_LOBBY_EXPIRY_HOURS` | public-creation bounds: `MIN_INTERVAL` (30, must exceed `MIN_PHASE1`+`MIN_PHASE2`), `MIN_PHASE1` (10), `MIN_PHASE2` (5), `MAX_INTERVAL` (3600), open-lobby cap (50), running-public cap (20), lobby expiry in hours (24). | as listed |
| `MBRG_LIMIT_*` | per-minute rate limits: commands 600, reads 1200, submissions 30, advances 30, anonymous 120, streams 50, anonymousStreams 5, createSource 5, createAll 30, joinSource 20, joinMatch 120. | as listed |

Invalid settings: the server prints `invalid settings: <names>` and exits 1.
Logs are JSON lines with closed events only (`{"event":"listening","port":8787}`);
SIGINT/SIGTERM flush and stop it within 5 s.

**Creating matches is the bot's job**: `/ff create` in Discord, which needs
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
5. `/ff create` in a Discord channel announces a lobby, and its viewer link
   opens the waiting map.
6. Stop the server (`systemctl stop mbrg-server`) and open the same viewer
   link: the page shows its own failure notice — no crash, no leaked detail.
   Start it again and the viewer recovers.

## Adding a map

Map packages (`map.json`, `presentation.json`, `ids.png`) are built offline on
local files with the `import-map` command in `@mbrg/build-map`. It opens no
network connection, and neither the server nor the viewer runs it or accepts
uploads. Exit status is `0` on success, `1` on failure (one JSON error per line
on stderr, nothing written in the output folder), and `2` on usage error.

### Before you start: CRS, geometry and licences

- **Reprojection and simplification**: the importer accepts only GeoJSON
  `FeatureCollection` files of `Polygon` / `MultiPolygon` geometries in degrees
  (`CRS84`, `EPSG:4326` or `EPSG:4258`) and never reprojects, simplifies or
  repairs geometry (`projected-crs` at extraction, `coordinates-not-degrees` at
  import). If a source is in a projected coordinate system (for example UTM
  metres) or too dense for the 256 MiB / 20,000,000-position caps, reproject or
  simplify it first with outside tools (such as `ogr2ogr -t_srs EPSG:4326` or
  `mapshaper`) before importing.
- **Licences**: a source dataset's licence travels with every map package built
  from it. Keep any required attribution or share-alike terms with your
  deployment, and do not commit licensed sources or large generated maps to the
  repository.

### Operator steps

1. **Extract (only when the source is a shapefile)**: convert a `.shp` (with
   its `.dbf` beside it, plus optional `.cpg` and `.prj`) into a GeoJSON source.
   If neither `.cpg` nor `--encoding` names an encoding (`utf-8`,
   `windows-1252` or `iso-8859-1`), extraction fails with
   `unknown-dbf-encoding`.

   ```sh
   npm run import-map -w @mbrg/build-map -- extract --shp=<file.shp> --out=<file.geojson> [--keep=<name,...>] [--encoding=<utf-8|windows-1252|iso-8859-1>] [--round=<6..15>]
   ```

2. **Inspect the source and generate a draft curation**: print feature counts,
   skipped null geometries, coordinate bounds, property types, uniqueness (key
   candidates) and sample values. Pass `--draft` to write a starter curation
   file (it refuses an existing file or a package folder holding `map.json`; an
   unedited draft always fails import with `invalid-curation`).

   ```sh
   npm run import-map -w @mbrg/build-map -- inspect --source=<file.geojson> [--draft=<file.json>]
   ```

3. **Write the curation file**: edit the draft JSON to set `columns.key`,
   `columns.name`, optional `context` sources (other land drawn as background),
   `select` / `exclude`, `params` (`side`, `margin`, `minPieceSize`,
   `projection`: `laea` or `equal-earth`, optional `gapFill`), per-unit
   overrides (`units`), grouping (`territoryBy`, `territoryNames`, `factions`,
   `factionBy`), `seas` seeds, and optional `insets`.

   > **Date-ranged / multi-period sources**: units are formed by `columns.key`
   > **before** `select` filters run. In a multi-period collection (one feature
   > per entity and period), key by a **per-period** unique property (such as a
   > feature id), not a country code shared across periods — otherwise features
   > from different periods merge into one unit with differing date values and
   > fail with `conflicting-unit-property` regardless of the `select` date
   > filter.

4. **Import with a preview**: build the package into a new or empty output
   folder (`--out` fails with `output-not-empty` if it holds anything, so a
   listed package is never overwritten while running matches depend on it; to
   re-import a corrected map, use a new folder). `--preview` writes a PNG
   outside the output folder (default `tools/build-map/out/import-preview.png`;
   a path inside `--out` is a usage error). Even if an import fails at or after
   the pixel steps, the last computed assignment is still written to the
   preview image.

   ```sh
   npm run import-map -w @mbrg/build-map -- import --curation=<file.json> --out=<folder> [--preview[=<file>]]
   ```

5. **Review the report and preview**: check the preview PNG (borders, insets,
   sea zones, narrow straits) and the report printed to stdout, especially the
   `viewerLimits` section:
   - `requiredTextureSize` (`max(W, H, entries + 1)`): a value above **2,048**
     (`textureAbove2048`) exceeds the WebGL 2 guaranteed minimum and leaves out
     devices with a smaller texture limit (those devices show the viewer's
     capability message).
   - `factionsAbove255` (more than **255** factions) or `entriesAbove65535`
     (more than **65,535** entries): a package exceeding either limit is **not
     drawable by today's viewer**. The viewer **refuses it at load with a
     Spanish message naming the limit** (spec 029) and draws no map, instead of
     the internal error of earlier versions; listing it still gives players an
     unplayable map, so do not list it on the server until follow-up **V2**
     (many factions) or **V3** (tiling) ships. A texture above the device's
     maximum and a failed colour assignment also stop with a message (follow-up
     **V1** is covered by these refusals).
   - `contextGap`, `contextGapPixels`, `thinCoastFactions`: thin water (at most
     `params.contextGap` pixels wide; the default is a strip of 3.5 km at the
     map's pixel size, at most 16; 0 turns it off) between a land territory and
     other land (a context source or an unselected unit) is turned into other
     land, because two sources rarely fit along a shared border and the strip
     would otherwise be a sea zone linking every territory on that border.
     `thinCoastFactions` lists any faction whose every sea contact is thin
     water: it should be empty (an inland province in it means a sliver or a
     notch is still joined to a zone; raise `contextGap` or set `gapFill`). Set
     `params.gapFill` above the largest inland reservoir (Spain by municipalities:
     5000) so enclosed water inside the land is not a zone. A territory this leaves with no
     neighbour (an exclave such as Llívia or Kaliningrad) is linked by thin
     bridges to its (up to) 3 nearest territories within `params.exclaveReach`
     pixels (default 64; the report lists them as `exclaveBridges`); with none in
     reach the import fails as `unreachable-exclave`. An inset that holds a sea
     seed is a sea of its own (no main-map zone flows into it); `insets[i].sea`
     names the `seas` entry whose zone owns all the water of the rectangle, so
     the Canary Islands can belong to the Atlantic zone.
     Enclosed water (a lake or inland sea no zone reaches through water) joins the
     nearest zone only within `params.enclosedReach` pixels (default 250 km at the
     pixel size; 0 = no limit); farther sets become other land and are listed as
     `enclosedLakes`, so the Caspian is never part of the Indian Ocean. Give an
     inland sea a seed in `seas` to keep it as water of its own. Land with no owner
     (a null `SUBJECTO`, say) is declared with `factionBy.noOwner` (a list of values,
     `null` for an absent or empty one): it is other land, listed as `noOwnerUnits`;
     factions left inside it are linked by the exclave rule, so raise
     `exclaveReach` if the import fails with `unreachable-exclave`.
   - `paletteExhaustedFaction`: the first faction for which the viewer's
     12-colour assignment fails; supply explicit `color` values in `factions`
     (or wait for **V2**) before listing.

6. **List the package on the server**: copy the output folder (`map.json`,
   `presentation.json`, `ids.png`) onto the VPS, add its map id and **absolute**
   path to `MBRG_MAPS` (for example
   `{"dev":"/opt/mbrg/maps/dev","spain":"/opt/mbrg/maps/spain"}`), and
   optionally add the id to `MBRG_PUBLIC_MAPS` so Discord `/mbrg create` offers
   it. Restart the server (`systemctl restart mbrg-server`) and check
   `GET /config` if the map is public.
