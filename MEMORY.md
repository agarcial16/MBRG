# MEMORY.md
Durable decisions, limits and lessons; no per-task diary (that is `specs/<id>/PROGRESS.md`; live work is `docs/board.md`). Area lessons: `docs/lessons/{web,bot,server,map}.md`. Keep <= ~4 KB.

## State
Specs 001-027 and 029 implemented (028, the map importer, queued). Branch from `main`, PR into `main`.
Predefined maps: `maps/spain-provinces` (52 provinces) and `maps/world-countries` (193 sovereign countries, 7 sea zones; data in `tools/build-map/data/world-countries/`, provenance and micro-country decisions in its README). Next big feature: the map importer. Deployment guide done (#84).

## Game
Spectator battle royale on EU4/RISK-style maps ("Clásico"): each round a random alive faction dies; a random neighbor takes all its territories; repeat until one remains. Players predict; they never control.

## Decisions (why)
- Brand: FactionFall ("Map Battle Royale"), Discord slash `/ff`; internal code, packages (`@mbrg/*`), env vars (`MBRG_*`), and custom-ids (`mbrg:*`) keep the MBRG codename.
- TypeScript everywhere: one deterministic engine for browser, server, bot and tests. Tag `legacy-v0.1` keeps the old code.
- Three.js/WebGL, EU4 technique (id texture + owner palette + shader borders): 3D later = camera/material change.
- Map package = `map.json` + `ids.png` + `presentation.json`, built offline by `tools/build-map`; adjacency = 4-connected pixel contact, no hand-written links; importers only convert to it.
- Predefined maps are data-only (builder source never changes): each has its own `tools/build-map/data/<map>/` dir (inner `natural-earth/` + `dev-map/` names are fixed by the CLI). One faction per admin unit via an `adm1_code := adm0_a3` (or the reverse) rewrite in the committed subset; the world map uses the 1:50m admin-0 dataset provided under the extract CLI's fixed 1:10m file names (documented in its README).
- State stores owner per territory, so modes are rule changes, not model changes. Ids 1..16,777,215 (24-bit texture). Round k uses `roundRng(seed, k)`: any round is computable alone.
- Per-server history (024): the bot sends only a SHA-256 community key (never the guild id), in request bodies; a finished match is listed once settled (> `TOLERANCE_MS` after its finish) so a paging walk keeps one snapshot.
- Ranking windows (027): rolling 7/30 days; the server fixes the floor at the first page and the cursor carries it; wire member `period` (absent = all time).
- Viewer count refusal (029): a package beyond the viewer's tables (over 65,535 territories or 255 factions) is refused at load naming the limit; `checkCounts` reads the sizes from `core/entries.ts` so widening the tables (V2/V3) widens the refusal with them.
- Readable labels (032): in-land precomputed abbreviation tiers (full -> prefix + `.` -> plain acronym), screen-space height bounds (`minPx` 9, `maxPx` 48 faction / 28 territory), per-role screen overlap resolution (`minGapPx` 4), no off-land/leader lines, and always-on map hover/tap full-name readout.
- Sea is an explicit entry kind (no owner); enclosed water joins the nearest sea zone; lakes stay background.

## Limits
- Anti-spoiler: future rounds never reach the client. Determinism: same seed, same match.
- Out of scope: i18n, importers, editor, 3D. Node >=24 (`.nvmrc` 24): any raise goes to the user.

## Lessons (general)
- Region = 4-connected piece, not a color. Test at real scale early; tiny ASCII tests hid real bugs. Synthetic fixtures must mimic real file quirks (NUL-padded DBF); a fixture for a tunable value uses a literal.
- Mutation checks: affected tests per mutant, full suite once at the end; back up the file before reverting; timeout in loops; never two chains at once; a surviving mutant = a missing test (use non-round constants).
- Traceability: name an id only in the task that closes it (never in an earlier title); each task removes the ids it traces in its own commit.
- Windows: write source with Write/Edit, not Python/bash heredocs (CRLF; `\n`/`\b` escapes get eaten; no backticks or `${}` in `node -e`); Python text-mode `open()` needs `newline=''`; `cat > file` or `python -` without stdin hangs; Write needs a prior Read.
- Kill browsers and servers by PID only (never Stop-Process msedge); check :5173 before starting a dev server.
- Node timings are noisy: run perf tests alone; under CPU load tests near 5 s need explicit timeouts. Untracked `.vitest/` is harmless, never commit it.
- Approvals typed in the orchestrator chat are not accepted by child threads: type them in the child or quote them in the brief.
- Never junction/symlink `node_modules` or workspace folders into a worktree (a forced remove followed the links and deleted real files).
- E2E screenshots without a desktop browser: headless Chrome `--screenshot --window-size=W,H` (a file:// URL is fine), but measure the page first — window height is a guess otherwise.
- Worktrees: `npm install` creates junctions in `node_modules/@mbrg` (workspaces). Before deleting a worktree, delete those junctions first (link only), then the folder; never `git worktree remove --force` and never `gh pr merge --delete-branch` while the branch's worktree exists (gh removes it and follows the links).

## Glossary
Territory (map unit, province) · Faction (owner of territories) · Round (one elimination) · Match (seeded full game).
