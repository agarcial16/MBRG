# PROGRESS — spec 023 e2e harness

## 1. Spec approved and harness implemented (tests first)
- Spec approved by the user in the implementing thread.
- `apps/bot/test/e2e/plan.ts`: the golden scripted match — seeds [11, 22, 33, 44] on `maps/dev` (r1 Francia→Alemania, r2 España→Portugal, r3 Portugal→Alemania, r4 forced Alemania→Italia), 4 named players (Ana, Bruno, Carla, Diego), their picks, and the 21 exact channel texts the run must produce (scoring: victim = living factions at N, absorber = candidate count; 13/6/3/0 points).
- `apps/bot/test/e2e/world.ts`: boots the REAL server in-process (`startServer` with `productionRoutes`, a `discord` client credential matching the bot's, public creation on with the `dev` map from its absolute folder, `testSeedSource` with the plan's seeds, fake clock + fake scheduler) and the REAL bot core via the unit-test `boot()` (changed to take `{ url }` instead of the fake server — `apps/bot/test/helpers/harness.ts`).
- `apps/bot/test/e2e/script.ts`: `playScriptedMatch` — drives create/start/predictions through the bot's handler, moves the server's fake clock with `scheduler.runTo` to each phase anchor read live from `GET /matches/:id`, records every post/edit/private reply with stage labels, and checks secrecy live (no victim/absorber name before its reveal stage, no "Ronda N" beyond the open round, no host token anywhere).
- `apps/bot/test/e2e/render.ts`: the text transcript and the Discord-like generic dark HTML page (embeds with colour bar/title/fields/footer, buttons, mention pills, posted + edited button states).
- `apps/bot/test/e2e.test.ts`: 3 tests (FR-540 exact journey/buttons/embeds/edits/leaderboard names; FR-541 secrecy; FR-542/543 renderers).
- `apps/bot/test/e2e/run.ts` + `npm run e2e` (root → workspace): prints the transcript with the viewer URL, writes `e2e-preview/transcript.txt` and `e2e-preview/embeds.html` (gitignored), exit 1 on secrecy violations.
- Decisions: the command lives at `apps/bot/test/e2e/run.ts` so `tsconfig.test.json` covers everything without new project files; no `@mbrg/sim` dependency in the bot workspace — the outcomes are pinned in the plan (a golden; a change to map/sim/seeds breaks the test on purpose).
- Tests run: `npx vitest run apps/bot/test/e2e.test.ts` → 3 passed; `npm test` → 379 files, 5708 tests passed (1 file, 6 tests skipped, pre-existing); `npm run typecheck` → clean.
- `npm run e2e` run twice: identical transcript hashes (deterministic, FR-544).
- Untested here: real Discord shell (out of scope), rate limits under load.

## 2. Screenshots and PR
- Visual check: `npm run e2e` output screenshotted with headless Chrome at exact page height (measured via a temporary DOM probe, since no desktop browser was attached to this session): desktop top, desktop full (900x5110), mobile full (390x5410), saved under `.claude/review/023-e2e-harness/` and posted in the implementing thread.
- Branch: `feat/023-e2e-harness`. State: implemented, tests + typecheck green, PR open to `main`, not merged. Next step: the Sonnet reviewer checks the PR; after merge, move the spec to `specs/archive/`.
