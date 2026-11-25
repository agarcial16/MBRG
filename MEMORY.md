# MEMORY.md
Durable decisions, limits and lessons; no per-task diary (that is `specs/<id>/PROGRESS.md`; live work is `docs/board.md`). Area lessons: `docs/lessons/{web,bot,server,map}.md`. Keep <= ~4 KB.

## State
Specs 001-029 implemented (028, the vector map importer, in PR #94 awaiting merge; hand run 1 on Spain by municipalities passed review) and 035 (ocean tiles, PR #101 stacked on #94). Branch from `main`, PR into `main`.
Predefined maps: `maps/spain-provinces` (52 provinces), `maps/world-countries` (193 countries, 8 sea zones, Robinson; data in `tools/build-map/data/world-countries/`). Next: viewer follow-ups V1-V3 (`docs/board.md`), painted-image importer (route A), replay of finished matches.

## Game
Spectator battle royale on EU4/RISK-style maps ("Clásico"): each round a random alive faction dies; a random neighbor takes all its territories; repeat until one remains. Players predict; they never control.

## Decisions (why)
- Brand: FactionFall ("Map Battle Royale"), Discord slash `/ff`; internal code, packages (`@mbrg/*`), env vars (`MBRG_*`), and custom-ids (`mbrg:*`) keep the MBRG codename.
- TypeScript everywhere: one deterministic engine for browser, server, bot and tests. Tag `legacy-v0.1` keeps the old code.
- Three.js/WebGL, EU4 technique (id texture + owner palette + shader borders): 3D later = camera/material change.
- Map package = `map.json` + `ids.png` + `presentation.json`, built offline by `tools/build-map`; adjacency = 4-connected pixel contact, no hand-written links; importers only convert to it.
- Predefined maps are data-only (builder source never changes): each has its own `tools/build-map/data/<map>/` dir (README holds provenance, rules and the file-name quirks).
- State stores owner per territory, so modes are rule changes, not model changes. Ids 1..16,777,215 (24-bit texture). Round k uses `roundRng(seed, k)`: any round is computable alone.
- Per-server history (024): the bot sends only a SHA-256 community key (never the guild id), in request bodies. Ranking windows (027): rolling 7/30 days, the floor fixed at the first page.
- Viewer count refusal (029) & many factions (033): a package beyond the viewer's tables (over 65,535 territories or 65,535 factions) is refused at load naming the limit; `checkCounts` reads `MAX_ENTRIES`/`MAX_FACTIONS` from `core/entries.ts`. Owner tables are 16-bit (`Uint16Array` / RG8 GPU texture, 2 bytes/entry, matching the 16-bit entry index). Faction colouring uses a 20-colour curated base palette (original 12 first + 8 Spec 031-aligned colours rotating in steps 1-2), soft-sea relaxation (PR #98), and a deterministic procedural last resort (`core/palette.ts`, >= 65,535 distinct colours) only when land neighbours exhaust curated colours; `palette-exhausted` stays as a defensive guard for custom finite themes.
- Robinson (036): `params.projection: "robinson"` in the builder (a W x H globe rectangle; the importer's stays square) and the importer, own code, default unchanged; `minFootprint` (builder) grows units under N px to N. World map: 4096 x 2179 (width kept at 4096 for 4096-texture devices), every country >= 9 px, a second Pacific seed (a flat map cuts the Pacific at 180).
- Vector map importer (028): offline `import-map` (`extract`/`inspect`/`import`) in `@mbrg/build-map`, GeoJSON + curation JSON, up to 9,999 factions; its viewer-limit warnings follow spec 033 FR-646 (65,535 factions, 20-colour palette, no palette warning under the shipped theme); no new third-party deps; `@mbrg/shared` and `apps/web` untouched.
- Readable labels (032) & close-zoom faction labels (037): in-land precomputed abbreviation tiers (full -> prefix + `.` -> plain acronym), screen-space height bounds (`minPx` 9, viewport ceiling 25%), per-role screen overlap resolution (`minGapPx` 4), no off-land/leader lines, and always-on map hover/tap full-name readout. At close zoom (`scale >= 1.0`, crossfading `0.85..1.0`, scaled by `detailFactor`), faction labels use territory placement rules (reusing single-territory tiers in O(1) for seamless 1-country transitions and centring multi-territory unions cleanly).
- Sea is an explicit entry kind (no owner); enclosed water joins the nearest sea zone; lakes stay background.
- Ocean tiles (035): the importer splits every curated sea (basin) into ownerless sea tiles, on by default (`params.tiling: false` turns it off; the dev-map equivalence curation does). Two tiers plus a far tier (coast tile, 2x open sea, 4x far), count by `targetTiles` (default min(600, 2 x land territories)); borders are Voronoi-like and links stay pixel contact; names come from an operator-given marine-areas GeoJSON (`tiling.names`; Natural Earth under `tools/build-map/data/marine-ne/`, public domain), else `<sea> <n>`. No sim, format or viewer change.

## Limits
- Anti-spoiler: future rounds never reach the client. Determinism: same seed, same match.
- Out of scope: i18n, painted-image importer (route A), editor, 3D. Node >=24 (`.nvmrc` 24): any raise goes to the user.

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
