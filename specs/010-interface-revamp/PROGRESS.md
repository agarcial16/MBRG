# PROGRESS 010

## 2026-10-27 — Milestone a (tokens, layout, top bar, states, accessibility shell)
- Pure modules (new): `core/hud-tokens.ts` (palette table, contrast pairs, `cssVariables`), `core/hud-layout.ts` (breakpoint 1024, zones, dock tabs, phone sizes), `core/live-hud.ts` (`hudState`, `topBar`, `stateCard`, `errorCard`). `core/live-text.ts` gains `countdownTime` (the time alone; `countdownText` uses it). 16 new strings (`hud*`).
- Shell: `ui/live-panel.ts` rewritten as the HUD (same file name and the same `createLivePanel`, so the 008/009 scans of the live panel keep their meaning), `ui/live-panel-style.ts` (the stylesheet as a string, tokens only, layout by `data-layout`, no width media query), `ui/message.ts` and the loading screen use the same card (`showCard`). The dock starts folded on a phone; the selected tab folds it again.
- Earlier tests edited (meaning): `traceability.test.ts` ranges and counts extended to FR-368 / NFR-71, a spec 010 ledger (8 closed, 12 pending) and the "ids beyond the last" probe moved to FR-369 / NFR-72. Nothing else changed.
- Closed ids: FR-356, FR-357, FR-358, FR-365, NFR-65, NFR-66, NFR-67, NFR-70. Pending: FR-359 to FR-364 (milestone b), FR-366 (c), FR-367 (fonts are not self-hosted yet: the stylesheet falls back to Georgia; needs the user's OK to download two OFL font files), FR-368 (c), NFR-68 (shell part done; the figures come with the phone measurement), NFR-69, NFR-71.
- Tests: `hud-tokens` (5), `hud-layout` (5), `live-hud` (10), `live-hud-shell` (15), traceability +1. Mutants (full suite each, restored): `>=` to `>` at the breakpoint (1 failure), muted colour darkened (1 failure, contrast pair): both caught.
- Browser (dev-live fixture): phone layout folded dock (132 px measured, budget 160) and the desktop layout (zones placed as in the mockup, checked through a 1280 px iframe because the pane is narrower); no console errors. Screenshots in `.claude/review/010-a/` (not in git).
- Not done / untested: fonts, minimap (b), chronicle and factions columns (b), replay band and round track (b), terra incognita and the start screen (c), a real phone.
- Next step: fonts (needs OK), then milestone b.
