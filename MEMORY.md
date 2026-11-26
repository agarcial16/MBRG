# MEMORY.md
Durable decisions, limits and lessons; no per-task diary (that is `specs/<id>/PROGRESS.md`; live work is `docs/board.md`). Area lessons: `docs/lessons/{web,bot,server,map}.md`. Keep <= ~4 KB.

## State
Specs 001-038 implemented and merged into `main`; 040 (capture speed) in PR. Branch from `main`, PR into `main`.
Predefined maps: `maps/spain-provinces` (52 provinces), `maps/world-countries` (193 countries, 8 sea zones, Robinson; data in `tools/build-map/data/world-countries/`).
Next: viewer follow-ups V3, landing page and map selection, painted-image importer (route A), replay of finished matches (`docs/board.md`).

## Game
Spectator battle royale on EU4/RISK-style maps ("Clásico"): each round a random alive faction dies; a random neighbor takes all its territories; repeat until one remains. Players predict; they never control.

## Decisions (why)
- Brand: FactionFall ("Map Battle Royale"), Discord slash `/ff`; internal code, packages (`@mbrg/*`), env vars (`MBRG_*`) and custom-ids (`mbrg:*`) keep the MBRG codename.
- TypeScript everywhere: one deterministic engine for browser, server, bot and tests. Tag `legacy-v0.1` keeps the old code.
- Three.js/WebGL, EU4 technique (id texture + owner palette + shader borders): 3D later = camera/material change.
- Map package = `map.json` + `ids.png` + `presentation.json`, built offline by `tools/build-map`; adjacency = 4-connected pixel contact, never hand-written; importers only convert to it. Predefined maps are data-only, each in its own `tools/build-map/data/<map>/` (README = provenance and quirks).
- State stores owner per territory, so modes are rule changes, not model changes. Ids 1..16,777,215 (24-bit texture). Round k uses `roundRng(seed, k)`: any round is computable alone.
- Per-server history (024): the bot sends only a SHA-256 community key (never the guild id), in request bodies. Ranking windows (027): rolling 7/30 days, the floor fixed at the first page.
- Viewer limits (029/033): a package beyond 65,535 territories or 65,535 factions is refused at load naming the limit; owner tables are 16-bit (2 bytes/entry). Faction colouring: 20-colour curated palette (`core/theme.ts`), soft-sea relaxation, deterministic procedural last resort (`core/palette.ts`).
- Map building: 028 offline vector importer (GeoJSON + curation), 035 ocean tiles (on by default), 036 Robinson for the world map (`params.projection`; square stays the importer default) with `minFootprint`.
- Map images (038): the bot screenshots the viewer's capture mode (`?capture=1`) with puppeteer-core + chrome-headless-shell, one at a time, 32-image cache; round image added by editing the announcement, `/ff mapa` ephemeral. Off without `MBRG_VIEWER_URL` + `MBRG_CHROME_PATH`. 040: a capture lays out labels only for what its fixed camera draws (round image ~2.5 s in page, was ~6 s; same pixels); full map stays ~6-7 s (raster-bound, user chose to keep 4096 px).
- Readable labels (032): in-land abbreviation tiers, screen-space height bounds, per-role overlap resolution, hover/tap full name. 037: at close zoom faction labels follow the province placement rules.

## Limits
- Anti-spoiler: future rounds never reach the client. Determinism: same seed, same match.
- Out of scope: i18n, painted-image importer (route A), editor, 3D. Node >=24 (`.nvmrc` 24): any raise goes to the user.

## Lessons (general)
- Region = 4-connected piece, not a colour.
- Mutation checks: affected tests per mutant, full suite once at the end; a surviving mutant = a missing test. Back up the file before reverting, timeout the loop, one chain at a time, non-round constants.
- Traceability: name an id only in the task that closes it; each task removes the ids it traces in its own commit.
- Windows: write source with Write/Edit, not Python/bash heredocs (CRLF; escapes get eaten); Python text mode needs `newline=''`; no backticks or `${}` in `node -e`.
- Node timings are noisy: run perf tests alone; tests near 5 s need explicit timeouts. Never commit untracked `.vitest/`.
- Approvals typed in the orchestrator chat are not valid for child threads: type them in the child or quote them in the brief.
- Never junction/symlink `node_modules` or workspace folders into a worktree. Each worktree runs its own `npm install` (which makes junctions under `node_modules/@mbrg`); delete those links before removing it, and never `git worktree remove --force` or `gh pr merge --delete-branch` while it exists.

## Glossary
Territory (map unit, province) · Faction (owner of territories) · Round (one elimination) · Match (seeded full game).
