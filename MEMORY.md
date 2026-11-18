# MEMORY.md
Durable decisions, limits and lessons; no per-task diary (that is `specs/<id>/PROGRESS.md`; live work is `docs/board.md`). Area lessons: `docs/lessons/{web,bot,server,map}.md`. Keep <= ~4 KB.

## State
Specs 001-022 implemented. Branch from `main`, PR into `main`.
Next candidates: e2e test automation (next, Light SDD: one start command + fake Discord at handler level; never drive real Discord: ToS, bots cannot press buttons or run slash commands); deployment guide; per-server history.

## Game
Spectator battle royale on EU4/RISK-style maps ("Clásico"): each round a random alive faction dies; a random neighbor takes all its territories; repeat until one remains. Players predict; they never control.

## Decisions (why)
- TypeScript everywhere: one deterministic engine for browser, server, bot and tests. Tag `legacy-v0.1` keeps the old code.
- Three.js/WebGL, EU4 technique (id texture + owner palette + shader borders): 3D later = camera/material change.
- Map package = `map.json` + `ids.png` + `presentation.json`, built offline by `tools/build-map`; adjacency = 4-connected pixel contact, no hand-written links; importers only convert to it.
- State stores owner per territory, so modes are rule changes, not model changes. Ids 1..16,777,215 (24-bit texture). Round k uses `roundRng(seed, k)`: any round is computable alone.
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

## Glossary
Territory (map unit, province) · Faction (owner of territories) · Round (one elimination) · Match (seeded full game).
