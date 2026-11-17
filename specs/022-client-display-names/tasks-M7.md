### M7 — Viewer check (0 / 2)
Plan sections 2 and 3. Depends on M4. Tests only: `apps/web/src` is expected not to change (FR-538 asks for no change to the fallback). If a test shows a gap, stop and report it: a source change in the viewer needs the user's decision.

- [ ] **T7.1. Models show the name.** FR-538
  - Files: tests in `apps/web/test` next to the existing board, results and play-view model tests (new file `client-names-view.test.ts` if no fit).
  - Done when: rows with a `name` show it in the leaderboard, the own-place row (`me`), the phase winners list and the end-of-match results; a row without `name` still shows the local id (019 `localName`, bytes of the existing tests unchanged); two rows with the same name are shown with their different ranks; the search of 019 finds a player by this name (case and accent rules as 019 states) and by its id as before.
- [ ] **T7.2. Wire to viewer.** FR-538
  - Files: test `apps/web/test/client-names-wire.test.ts` (new; `apps/web` may import `@mbrg/protocol`, D30).
  - Done when: leaderboard, phase winners and own-player replies encoded by the protocol with cleaned Discord-style names (spaces, dots, accents, a 24-code-point name) decode through the viewer's readers and reach the models with the name intact; a reply with a name outside the rule is refused by the decoder as today (no new leniency).
