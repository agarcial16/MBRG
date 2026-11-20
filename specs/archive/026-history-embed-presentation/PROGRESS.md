# PROGRESS — spec 026 (history embed presentation pass)

## Step 1 — the spec
- Written `specs/026-history-embed-presentation/spec.md`: goal, the three approved changes (compact top line, link merged into the asker's line, ordinal in the field name), out of scope, done criteria. Status: approved (mockup approved 2026-11-20).
- Decision recorded there: the podium is positional (first three rows get 🥇🥈🥉, the rest their position number), because the mockup shows three different medals and the line reads as "the top 5, numbered"; the server rank stays in the asker's "puesto R" and equal points keep ties visible.
- Noted: the winner line is already bold in both renders (`strings.ts` historyWinner); change 3 only adds the ordinal, the winner line keeps its shape.
- Tests run: none yet (spec only). Untested: everything below. Next: the pinned expectations, tests first.

## Step 2 — tests first (the pinned expectations updated by design)
Changed pins, each with its reason (all in `apps/bot/test/`):
- `core-history.test.ts`:
  - field name pins: `<t:…:d> · europe` → `#N · <t:…:d> · europe` — change 3 puts the ordinal in the field name; page 2 of 12 pins #7/#6/#5; a new test pins a full page's ordinals (#7..#3), a partial last page (#2/#1) and an out-of-range page clamped like the footer.
  - top pins: the five `N. <@…> - P pts` lines → the single compact line `🥇 <@a> P · 🥈 … · 🥉 … · 4. … · 5. …` (medals for the first three rows, position numbers for the rest); "y N más" now ends that same line instead of having one of its own.
  - asker/link pins: the viewer link moved from its own line onto the asker's line, for both forms ("Tus puntos: …" and "No jugaste esta partida", with ` · [Ver en el visor](URL)`); the no-asker entry keeps the link line last, as today.
  - the FR-475 fallback pin rewritten as an exact expected text: the same lines as the embed with the bare URL in place of the markdown link.
  - NFR-121 worst case: pins that each field value is now exactly three lines (winner, compact top, asker's line with the merged link) on top of every NFR-94 limit check — the compact line makes the value smaller and the test proves it.
- `bot-flow-history.test.ts`: the `slice(-2)` pins `['Tus puntos: …', '[Ver en el visor](…)']` → full field-value pins with the link merged into the asker line, plus the ordinals through the whole bot flow (#3/#2/#1 for 3 matches).
- `e2e.test.ts` (the history step of FR-562): the field-name regex gains `#1 ·`; the top-line pin builds the compact line from the leaderboard oracle (medals for the first three scored rows, position numbers after, "y N más" when more than 5 scored); the asker line and the link collapse into one pinned line; the zero-points and outsider asks pin the merged link too.
- `core-history-paging.test.ts` and `bot-flow-history-paging.test.ts`: NO pin changed — they pin ids, buttons, walks and the winner line, none of which moves; both files green against the old code before the change (verified by running them).
- Tests run after this step: `npx vitest run` on `core-history.test.ts`, `bot-flow-history.test.ts` and both paging files: 11 failures, all and only the by-design pins above (the two paging files fully green). Note: one edit wrote a missing closing paren on a new line (caught by the transform, fixed on the spot).
- Untested: the code that must satisfy these pins. Next: the code.

## Step 3 — the code
- `apps/bot/src/core/strings.ts`: `historyEntry` gains `{n}` (`#{n} · {date} · {map}`); new `historyGold`/`historySilver`/`historyBronze` (`🥇 {who} {points}` …), `historyTopRow` (`{n}. {who} {points}`) and `historySep` (` · `); `historyWinner` kept (already bold, both renders); `historyMore`, `historyOwn`, `historyNotPlayed`, `historyNobody`, `viewerButton` reused unchanged.
- `apps/bot/src/core/history.ts`: the ordinal computed in the bot from the walk's snapshot total and the clamped page (N = total − (page−1)·5 − index, newest first); the top compacted onto one line (positional medals then position numbers, ` · y N más` merged at the end, "Nadie sumó puntos" replacing the whole line when nobody scored); the link merged into the asker's line for both renders (markdown in the embed, bare URL in the fallback), kept as its own last line when the entry has no asker and absent without a configured viewer.
- `apps/bot/test/core-history.test.ts`: added the missing `STRINGS` import my rewritten fallback pin needed.
- Tests run: the eight bot suites around the change (`core-history`, `core-history-paging`, `bot-flow-history`, `bot-flow-history-paging`, `discord-translate`, `core-board`, `core-announce`, `core-ranking`) — 146 green.
- Mutation proofs (each killed tests, then reverted; only the affected files rerun):
  - ordinal off by one (`- index` → `- index - 1`): 5 failures in `core-history.test.ts` (the ordinal pins: page 2 of 12, partial last page, clamped page).
  - medals miscounted (podium of two): 4 failures across `core-history.test.ts` and `bot-flow-history.test.ts` (the exact compact-line pins, 🥉 at the third cell).
  - link dropped from the asker's line (own line always): 5 failures across the two files (the exact asker-line pins and the full-value flow pins).
- Untested: the rest of the repo suite (full run next) and `npm run typecheck`. Next: the full verification.

## Step 4 — the full verification
- `npm run typecheck` — green (all twelve tsconfig projects).
- `git diff --exit-code origin/main -- packages/shared/src packages/sim/src packages/sim/test/golden maps/dev apps/server/test/golden apps/web/src` — empty: protected paths byte-identical.
- First full `npm test`: one real failure — the FR-461 ASCII scan caught the medal emoji and middle dots I had put in a `core/history.ts` doc comment (only `core/strings.ts` may hold non-ASCII). Fixed by rewording the comment (names, not glyphs); the strings live in strings.ts as the spec requires. That is the one deviation the scan caught and closed.
- The next two full runs showed 15 timeouts in the heavy `apps/server`/`apps/web` perf tests (restart-after-every-step, tour-shade at 1920x1080, label placement) under full-suite CPU contention — the MEMORY lesson "Node timings are noisy: run perf tests alone". Rerun alone: all five server files green (73 tests), all five web files green (121 tests); a final clean full run: 412 files passed, 6056 tests passed, 6 skipped, 0 failed. No bot test ever failed after the code landed.
- Untested: nothing known. Next: push and the PR.

## Step 5 — the PR and the handover
- Branch `feat/history-embed-presentation` pushed; PR opened into `main`: https://github.com/agarcial16/MBRG/pull/85, head `32c36aa` (the board row now carries it).
- `MEMORY.md` updated per repo convention (specs 001-026, candidate line); the spec status stays `approved` as ordered — the merge acceptance bumps it to `implemented` and moves this folder to `specs/archive/`.
- Handover: branch `feat/history-embed-presentation`, state: spec, tests, code, mutation proofs and full verification complete (`npm test` 412 files green, `npm run typecheck` green, protected paths byte-identical); next step: the reviewer reads PR #85, then squash-merge and archive the spec.





## Closing (2026-11-20)
- The Sonnet review approved with no objections (the positional podium ratified against FR-554's wording, the ordinal math pinned page by page, the worst case asserted, mutants re-applied and killed). The user accepted the PR ("mergea"). This closing commit flips the status to implemented, archives the spec, and leaves MEMORY (001-026, deployment guide done) and the board (spec 027 queued) ready for the squash.
- Next: spec 027 (ranking by time window) drafting. Branch feat/history-embed-presentation, state: DONE.
