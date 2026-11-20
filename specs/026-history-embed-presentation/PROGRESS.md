# PROGRESS — spec 026 (history embed presentation pass)

## Step 1 — the spec
- Written `specs/026-history-embed-presentation/spec.md`: goal, the three approved changes (compact top line, link merged into the asker's line, ordinal in the field name), out of scope, done criteria. Status: approved (mockup approved 2026-11-20).
- Decision recorded there: the podium is positional (first three rows get 🥇🥈🥉, the rest their position number), because the mockup shows three different medals and the line reads as "the top 5, numbered"; the server rank stays in the asker's "puesto R" and equal points keep ties visible.
- Noted: the winner line is already bold in both renders (`strings.ts` historyWinner); change 3 only adds the ordinal, the winner line keeps its shape.
- Tests run: none yet (spec only). Untested: everything below. Next: the pinned expectations, tests first.
