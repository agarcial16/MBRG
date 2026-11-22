# MEMORY.md
Durable decisions, limits and lessons; no per-task diary (that is `specs/<id>/PROGRESS.md`; live work is `docs/board.md`). Area lessons: `docs/lessons/{web,bot,server,map}.md`. Keep <= ~4 KB.

## State
Specs 001-027 implemented; Spec 028 (vector map importer) M1-M3 implemented on `feat/028-map-importer` (awaiting final review, PR and hand runs 1 & 2). Branch from `main`, PR into `main`.
Next candidates: viewer follow-ups V1-V3 (`docs/board.md`), painted-image importer (route A), viewer replay of finished matches. Deployment guide updated with "Adding a map".

## Game
Spectator battle royale on EU4/RISK-style maps ("Clásico"): each round a random alive faction dies; a random neighbor takes all its territories; repeat until one remains. Players predict; they never control.

## Decisions (why)
- TypeScript everywhere: one deterministic engine for browser, server, bot and tests (`legacy-v0.1` keeps old code).
- Three.js/WebGL, EU4 technique (id texture + owner palette + shader borders): 3D later = camera/material change.
- Map package = `map.json` + `ids.png` + `presentation.json`, built offline by `tools/build-map`; adjacency = 4-connected pixel contact, no hand-written links.
- State stores owner per territory, so modes are rule changes, not model changes. Ids 1..16,777,215 (24-bit texture). Round k uses `roundRng(seed, k)`.
- Per-server history (024): bot sends only a SHA-256 community key in request bodies; finished matches list once settled (> `TOLERANCE_MS`) so paging keeps one snapshot.
- Ranking windows (027): rolling 7/30 days; server fixes floor at first page, cursor carries it; wire member `period` (absent = all time).
- Sea is explicit (no owner); enclosed water joins nearest sea zone; lakes stay background.
- Vector map importer (028): offline `import-map` (`extract`/`inspect`/`import`) in `@mbrg/build-map`, GeoJSON + curation JSON, up to 9,999 factions & 2^28 pixel guard; viewer limits (>2,048 texture, >65,535 entries, >255 factions, 12-colour palette) warn only (enforced by viewer V1-V2); no new third-party deps (Equal Earth, SHA-256, DBF reader are own code; `@mbrg/shared` and `apps/web` untouched per NFR-22).

## Limits
- Anti-spoiler: future rounds never reach the client. Determinism: same seed, same match.
- Out of scope: i18n, painted-image importer (route A), editor, 3D. Node >=24 (`.nvmrc` 24): any raise goes to the user.

## Lessons (general)
- Region = 4-connected piece, not a color. Test at real scale early; synthetic fixtures must mimic real quirks (NUL-padded DBF); fixtures for tunables use literals.
- Mutation checks: affected tests per mutant, full suite once at end; back up file before reverting; timeout in loops; surviving mutant = missing test.
- Traceability: name an id only in the task that closes it; each task removes the ids it traces in its own commit.
- Windows: edit source with Write/Edit (avoid heredocs/CRLF/escape traps); `node -e` avoids backticks/${}; kill browsers/servers by PID only; check :5173 before starting dev server.
- Node timings are noisy: run perf tests alone; under CPU load tests near 5 s need explicit timeouts. Never commit `.vitest/`.
- Approvals in orchestrator chat are not accepted by child threads: type in child or quote literally in brief.
- Worktrees: never junction/symlink `node_modules` or workspace folders. `npm install` creates junctions in `node_modules/@mbrg`; delete those links first before removing a worktree, never `git worktree remove --force` or `gh pr merge --delete-branch` while worktree exists.
- Headless E2E screenshots: measure height first (`--dump-dom` + title probe) before `--screenshot --window-size=W,H`.

## Glossary
Territory (map unit, province) · Faction (owner of territories) · Round (one elimination) · Match (seeded full game).
