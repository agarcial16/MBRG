# Tasks 008 — Server and predictions
Plan: `specs/008-server-and-predictions/plan.md`. Prerequisites: spec approved by the user (2026-10-21, D25); plan section 1 decisions U1 to U5 answered by the user (2026-10-21/22: workspaces `apps/server` and `packages/protocol`; `tsx` 4.23.15 and `@types/node` 24.19.2 reused as pinned dev dependencies of `apps/server`; no type stripping and no import-line changes in sim or shared; `engines >=24` and `.nvmrc 24` kept, any raise back to the user; exports `playRoundWithSeed`, `absorptionCandidatesOf`, `livingFactions`); **plan and tasks still awaiting the user's formal approval**. Any later change goes to the spec first, then the plan, then these tasks.

This file details **M1** only. M2a to M5 are listed as headings at the end and are detailed (at most 10 tasks each) in a later revision, approved before their first task.

Rules for every task:
- Delivery: branch `feat/008-m1-secret-and-sim-exports` cut from an up-to-date `rewrite` (14127e6 or later); one PR into `rewrite`, squash merge only with the user's OK and CI green. GitHub issues only if the user asks for one per milestone. Never push to `main` or `rewrite`. One commit per task unless stated (English, conventional prefix, one line <= 72 chars).
- Tests first: write them, see them fail (red) for the right reason, then code. Prove guards by temporary mutation (back the file up first; never `git checkout` a file with uncommitted edits); use the FULL `npm test` for mutation proofs, with a timeout for loops.
- Before each commit: `npm test`, `npm run typecheck` and `$env:CI='1'; npm test` (PowerShell) all green. Quote the path (it contains spaces).
- No new dependency beyond U2 (`tsx` 4.23.15 and `@types/node` 24.19.2 in `apps/server`, pinned exactly). No import-line changes in sim or shared (U5). No change to `engines` or `.nvmrc` (U3). No edit to the map package, `MatchState`, `RoundRecord`, `packages/shared/src`, `packages/sim/test/golden`, `maps/dev`. In `packages/sim/src` only the files of plan section 3. Earlier tests edited only as plan section 0 lists (the three export-list assertions and the traceability test).
- No keyed function, digest, clock or randomness in sim or shared (purity scan); the HMAC lives in `apps/server`.
- Test titles start with the FR/NFR ids they verify; a task that traces an id removes it from `PENDING_008` in the same commit. Check with `rg -n "(it|test|describe)\(['\"\`][^'\"\`]*\bFR-NNN\b" apps/*/test packages/*/test tools/*/test`.
- After each task: tick it, update `MEMORY.md` locally (state, decisions with why, mistakes to avoid; <= ~50 lines), and stop.

## M1 — Secret and sim exports (`feat/008-m1-secret-and-sim-exports`)

- [x] **T1. Branch, commit spec / plan / tasks; traceability with the 008 pending set.** NFR-55
  - Files: `specs/008-server-and-predictions/{spec,plan,tasks}.md` (as approved), `packages/sim/test/traceability.test.ts`.
  - Tests first (plan section 11): ranges `[[1, 315]]` / `[[1, 57]]`; counts 372 ids, 370 expected; `FR-316` and `NFR-58` are not ids; a literal `PENDING_008` of the 96 ids FR-231..FR-315, NFR-47..NFR-57 computed independently with literal bounds; "every expected id appears in a test name" checks `expected` minus `PENDING_008`; "no pending id is already traced"; a test titled with NFR-55 joins the self-trace list.
  - Commits: `docs: add spec, plan and tasks 008`; `test: trace spec 008 ids with a pending set`.
  - Done when: suite, typecheck and `CI=1` green; mutation: tracing a pending id in a dummy title makes "no pending id is already traced" fail; removing a 007 id from a title is still reported missing; `rg` finds NFR-55 in a title.

- [x] **T2. State and faction input checks and the two new error kinds (internal).** FR-313
  - Files: `packages/sim/src/{inputs.ts,types.ts}`, `packages/sim/test/inputs-state.test.ts`.
  - Tests first: `checkState` accepts `getState(map, s, r).value` for every round of the golden maps and `-0` as round; rejects: missing or extra own key, inherited keys (own-property rule), mode other than `classic`, round negative, fractional, text, NaN, above T; owners in another order, a missing or extra territory, a sea zone listed, a pair of length 1 or 3, an unknown faction; `checkFaction` accepts every map faction, rejects 0, 1.5, `'1'`, an id not in the map; the kinds `invalid-state` and `invalid-faction` are English kebab-case identifiers; `language.test.ts` stays unchanged and green.
  - Code: plan section 6 (`checkState`, `checkFaction`; `SimError` gains the two kinds).
  - Commit: `feat(sim): add state and faction input checks`.
  - Done when: tests green; the existing export lists unchanged (nothing exported yet); mutations proved (order check removed, own-property check removed, `round <= T` to `< T`); `rg` finds FR-313.

- [x] **T3. The three sim exports and the export-list edits.** FR-313, NFR-51, NFR-55
  - Files: `packages/sim/src/{exports.ts,index.ts}`, `packages/sim/test/exports.test.ts`, edits to `packages/sim/test/candidates.test.ts` (lines 86 to 88), `packages/sim/test/match.test.ts` (line 146), `packages/shared/test/no-regression.test.ts` (lines 30 to 33).
  - Tests first: `playRoundWithSeed` errors together in the order map errors, `invalid-state`, `invalid-seed`; `round-out-of-range { round: state.round + 1, total: T }` at round T and with fewer than 2 living factions; `isolated-faction` on the lonely map of `language.test.ts`; equal to the internal `playRound` on 200 (state, seed) pairs; input not mutated (deep-frozen input). `absorptionCandidatesOf`: equals the internal `factions` for every living faction of every golden map state; `[]` for a map faction with no territory (no throw); `invalid-faction` for a non-map id; `how` absent. `livingFactions`: equals the internal function; `invalid-state` on a bad state. Export lists: exactly the 8 names (U4: the five existing plus `playRoundWithSeed`, `absorptionCandidatesOf`, `livingFactions`) in all three files, and `absorptionCandidates` still not exported. NFR-51: the sim purity scan covers `exports.ts` (planted `Date.now` in a copy is caught).
  - Code: plan section 6.
  - Commit: `feat(sim): export round step with seed, candidates, living factions`.
  - Done when: tests green; `git diff rewrite -- packages/sim/src` shows only `inputs.ts`, `types.ts`, `exports.ts`, `index.ts`; mutations proved (skip the round-T check, call the internal candidates for a dead faction, return `how`); `rg` finds FR-313, NFR-51, NFR-55.

- [x] **T4. Chained round step equals `getState` / `getRounds`.** FR-312, NFR-48
  - Files: `packages/sim/test/exports-chain.test.ts`.
  - Tests first: for every golden fixture map and the dev map (`maps/dev/map.json`), seeds 0 to 999, chaining `playRoundWithSeed` with that constant seed from `getState(map, 0, 0)` gives `getState(map, seed, r)` and the records of `getRounds(map, seed, T)` at every round 0..T (`toStrictEqual`); the round-0 state does not depend on the seed (seeds 0, 1, 2^32 − 1); NFR-48 (sim part): `packages/sim/test/golden` files unchanged (byte compare with their git blobs is a process check; the test asserts their records still equal `getRounds`).
  - Commit: `test(sim): chained round step equals getState and getRounds`.
  - Done when: tests green (runtime logged; above 5 s gets a timeout and the dev-map loop runs 1000 seeds only in that test); mutation: a seed off by one in the chain fails; `rg` finds FR-312, NFR-48.

- [x] **T5. `apps/server` skeleton and the `node:sqlite` check.** NFR-53
  - Files: `apps/server/{package.json,tsconfig.json,tsconfig.test.json}`, root `package.json` (workspace entry, `typecheck` script), `package-lock.json` (workspace link only), `apps/server/test/platform-sqlite.test.ts`, `apps/server/test/manifest.test.ts`, `specs/008-server-and-predictions/plan.md` (section 13: Node version, stability label).
  - Tests first (plan section 8): `import('node:sqlite')` without a flag; memory and temporary-file databases; commit and rollback; exclusive lock makes a second connection fail; every database closed in `finally`. NFR-53 manifest: `apps/server` depends only on `@mbrg/*` (runtime) and exactly the U2 development dependencies at their pinned versions; `packages/sim` and `packages/shared` keep no third-party dependency; `package-lock.json` gains no new package (only the workspace link).
  - Commit: `chore(server): add the server workspace and sqlite checks`.
  - Done when: tests green on Windows; `npm ci` succeeds from the lockfile; exact Node version and figures recorded in plan section 13 (`engines` and `.nvmrc` untouched, U3); if a check fails, stop and report to the user (plan section 8); `rg` finds NFR-53.

- [x] **T6. Runner and experimental-warning filter.** NFR-53
  - Files: `apps/server/src/{warnings.ts,main.ts}`, `apps/server/package.json` (`start` and `check` scripts with the U2 runner), `apps/server/test/platform-runner.test.ts`, plan section 13.
  - Tests first (plan sections 7 and 8, child processes with `process.execPath`, 20 s timeout): `main.ts --check` imports `@mbrg/sim`, `@mbrg/shared`, `node:sqlite`, opens `:memory:`, exits 0; without the filter stderr's SQLite `ExperimentalWarning` presence is recorded (assert the recorded value); with the filter stderr has no SQLite warning and still has a planted `TestWarning`; `warnings.ts` unit test: only a warning whose name is `ExperimentalWarning` and whose message mentions SQLite is dropped.
  - Code: `installWarningFilter()` installed before the dynamic `import('node:sqlite')`; `main.ts` does nothing else in M1 (prints a one-line "check ok" in check mode).
  - Commit: `feat(server): add the entry point and the sqlite warning filter`.
  - Done when: tests green; plan section 13 records the runner and warning result; mutation: a filter that drops every warning fails the planted-warning test; `rg` finds NFR-53.

- [x] **T7. Secret, commitment and per-round seed derivation.** FR-252
  - Files: `apps/server/src/secret.ts`, `apps/server/test/secret.test.ts`, plan section 13 (test vectors).
  - Tests first (plan section 5): RFC 4231 test case 2 through the HMAC helper; the message bytes for k = 1 and k = 70 are exactly `mbrg/round-seed/v1/1` and `mbrg/round-seed/v1/70`; pinned `s_k` for secret 0x00..0x1f at k = 1, 2, 3, 4, 70, 2^31 − 1, each equal through `createHmac` and through Web Crypto `subtle.sign`; k = 0, −1, 1.5, 2^31 and text rejected; a secret of 31 or 33 bytes rejected; commitment = SHA-256 hex of the raw bytes, 64 lowercase characters; `newSecret(random)` takes exactly 32 bytes from the injected source and never calls the platform source when one is injected; `secret.ts` reads no clock and no `Math.random` (source scan).
  - Commit: `feat(server): derive round seeds from the match secret`.
  - Done when: tests green; vectors recorded in plan section 13; mutations proved (little-endian read, message without `v1/`, key hex text instead of raw bytes); `rg` finds FR-252.

- [x] **T8. Dev-map seed goldens and absorber uniformity.** NFR-47, NFR-48
  - Files: `apps/server/test/{seed-golden.test.ts,absorber-uniformity.test.ts,helpers/digests.ts,golden/dev-secrets.json}`, plan section 13.
  - Tests first: for three fixed secrets (0x00..0x1f, 0x20..0x3f, and 32 bytes of 0xa5): every `s_k`, victim, absorber, record and state digest of the dev map from round 1 to T, computed by chaining `playRoundWithSeed` with `roundSeed(secret, k)`, equal to the golden file; the map digest of `maps/dev` per the spec definition (helper in the test folder, node:crypto) pinned; the state digest text built per the spec definition (helper). NFR-47(e): over round seeds 0 to 2^20 − 1 on the dev map's round-1 state, for each victim, the absorber share of every candidate within ±2 percentage points of uniform; the bulk loop uses the engine's own draw functions and is proven equal to `playRoundWithSeed` on the first 10,000 seeds.
  - Commit: `test(server): pin dev-map round-seed goldens and absorber uniformity`.
  - Done when: tests green; worst deviation and runtime recorded in plan section 13 (above 5 s: own timeout, run alone for timing); mutation: a seed source that reuses s_1 for every round changes the golden (fails); `rg` finds NFR-47, NFR-48.

- [x] **T9. Close M1: ledger, process checks, PR.** NFR-55, done criteria of M1
  - Files: `packages/sim/test/traceability.test.ts` (assert the pending set now holds exactly 88 ids: the M1 ids FR-252, FR-312, FR-313, NFR-47, NFR-48, NFR-51, NFR-53, NFR-55 were removed by the tasks that traced them), `specs/008-server-and-predictions/plan.md` (sections 11 and 13 updated), `MEMORY.md` (local).
  - Steps: `git diff --exit-code rewrite -- packages/shared/src packages/sim/test/golden maps/dev` clean; `git diff --stat rewrite -- packages apps tools` shows only the planned files; full suite, typecheck and `CI=1` green; PR body lists the ledger of plan section 11, the figures of section 13 and the U1 to U5 decisions (2026-10-21/22). Push, PR, CI green, squash only with the user's OK.
  - Commit: `test: pin the spec 008 pending set after M1`.
  - Done when: CI green; ledger and figures in the PR; `MEMORY.md` updated (state, decisions, lessons; next: detail M2a).

## Later milestones (headings only; detailed later, at most 10 tasks each)
- **M2a. Protocol package and pure match core.** FR-233, FR-234, FR-237, FR-239, FR-240 (decision), FR-244, FR-247 to FR-249, FR-253 to FR-258, FR-261 to FR-269, FR-282 (content), FR-295 to FR-297, FR-301 (kinds), FR-302 (reported time), FR-314; NFR-47(b), NFR-50, NFR-51. Depends on M1.
- **M2b. SQLite store, lifecycle service with the fake clock, halting, memo, recovery, durability.** FR-231, FR-232, FR-235, FR-236, FR-238, FR-240 to FR-243, FR-245, FR-246, FR-250, FR-251, FR-259, FR-260, FR-270 (storage), FR-288, FR-289 (data), FR-290 to FR-294, FR-300 (digests), FR-315; NFR-47(a), (d), (f), NFR-48 (lifecycle), NFR-52, NFR-54 (store), NFR-57. Depends on M2a.
- **M3a. HTTP commands and reads, credentials, cross-origin, limits, paging, map files.** FR-257 (HTTP), FR-270 (read), FR-279, FR-280, FR-281 (non-result), FR-282 (transport), FR-283 to FR-286, FR-298 to FR-300, FR-301, FR-302 (HTTP); NFR-47(c), NFR-52, NFR-54 (logs). Depends on M2b.
- **M3b. Server-Sent Events, replay, heartbeat, performance procedure.** FR-287, FR-288, FR-289 (stream), FR-290 (stream); NFR-49. Depends on M3a.
- **M4. Scoring, results and leaderboard.** FR-271 to FR-278, FR-281(e) to (g), scoring parts of FR-241, FR-243, FR-246, FR-251(c); NFR-48 (results), NFR-57 (results). Depends on M2b, M3a.
- **M5. Live viewer and web test client.** FR-303 to FR-311; NFR-56; screenshots reviewed by the user. Depends on M3b, M4. Closes the pending set; spec 008 becomes `implemented` after acceptance.
