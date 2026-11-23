# Lessons: web viewer (`apps/web`)
Read before touching the viewer, labels, the live model or the interface.

## Decisions
- Label layout is computed in the viewer; every label is white text + black 1 px halo (no contrast choice). The colour front expands from the contact border on round steps; manual stepping only.
- The reveal animation (spec 009) must not leak the victim early. Scores and winners reads wait for the reveal tours (a right guess names the victim).
- The viewer may depend on the workspace `@mbrg/protocol`; live modules never import `@mbrg/sim` (D30).
- NFR-43 round-change budget is 200 ms (D20, user). The browser is 1.6-2x slower than Node: measure in the browser before promising a budget.
- Kept as they are (user, 2026-11-15): camera and label `minPx` on phone.
- Goldens (009): `tours.json` is independent (BigInt model); `tour-frame-pins.json` are regression pins made by the code under test; both are hand-run via `npx tsx`. NFR-63 is held by pinned SHA-256 of earlier goldens and `maps/dev`.

## Lessons
- Live model: the retry/reconnect policy lives in the pure model (inputs failed/opened/bytes/dropped/tick; effects arm-timer/open-stream{via}). A protocol-fault resync must not reset the failure count on a mere byte or read (only an accepted frame does), or a bad server gives a 1 s loop.
- Name internal fields `outcome`, not `kind` (the NFR-28 scan lists every `kind:` literal). The panel scan (live-view-tour) forbids the word `view` in any attribute/dataset value. The production-build scan forbids `invalid-round`/`invalid-seed` strings in shipped code.
- Every STRINGS key must be used by code: add a string in the task that uses it.
- The wire decoder refuses candidates outside `living`: fixtures with d >= 2 use living factions.
- A model flag that outlives the view (`touring`) can only be conservative (an extra no-op `complete-tour`).
- A per-second panel refresh must not rebuild buttons (keyboard focus): key the rebuild on a signature.
- A real phone differs from emulators: `100vh` (large viewport) vs `height:100%` (visible) made the label canvas drift; both canvases share one box. Emulators never show it.
- Regexes written through a bash heredoc lose their backslashes: use `toContain` or the Write tool.
- The MCP browser pane throttles rAF while hidden: frame stats are valid only with the pane visible (16.7 ms). A browser pass with a hidden pane gives no valid timing.
- A squash-merged base branch conflicts a stacked PR: merge the base with `-X ours`, then check the diff is only the PR's own work.
- Faction colouring (`core/colors.ts`): large ocean sea zones (e.g. 54 countries on `world-countries`) form cliques larger than the 12-colour palette, so `assignFactionColors` keeps land neighbours strict and relaxes sea-only candidates to a least-used fallback (`FR-141` amendment 2026-11-23).

## Open
- No connecting-state timeout, no live-net read timeouts, no SSE parser line cap (user's order, spec 008).
- Hand tests left for later (user): (1) on a real phone, results/right-wrong/points stay hidden until the tour ends and the chip shows the place (`2.º`) (FR-449); (2) a NEW match shows the 5 s wait after predictions close (FR-450; old matches keep L2 = 15 s); (3) chip density at 360 px with long names; short-L1 and frame figures of 009 not browser-checked.
