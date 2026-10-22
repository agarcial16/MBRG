# Tasks 008 — Server and predictions
Plan: `specs/008-server-and-predictions/plan.md`. Prerequisites: spec approved by the user (2026-10-21, D25); plan section 1 decisions U1 to U5 answered by the user (2026-10-21/22: workspaces `apps/server` and `packages/protocol`; `tsx` 4.23.15 and `@types/node` 24.19.2 reused as pinned dev dependencies of `apps/server`; no type stripping and no import-line changes in sim or shared; `engines >=24` and `.nvmrc 24` kept, any raise back to the user; exports `playRoundWithSeed`, `absorptionCandidatesOf`, `livingFactions`); **plan and tasks still awaiting the user's formal approval**. Any later change goes to the spec first, then the plan, then these tasks.

This file details **M1** (merged, PR #28, 061119b) and **M2a** (pending the user's approval, plan section 16). M2b to M5 are listed as headings at the end and are detailed (at most 10 tasks each) in a later revision, approved before their first task. The M1 rules below apply to every milestone, with the M2a additions in the M2a section.

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

## M2a — Protocol package and pure match core (`feat/008-m2a-protocol-and-core`)
Depends on M1 (merged). Plan section 16. Status: **approved 2026-10-22** (with A1: filter widened once, in T2).

**Needs a user decision before T1**
- **A1. Lockfile-filter edits in two earlier viewer tests.** `apps/web/test/shaped-deps.test.ts` (line 43) and `apps/web/test/labels-render.test.ts` (line 53) ignore the `apps/server` lockfile entries since M1; the new workspace adds `packages/protocol` and `node_modules/@mbrg/protocol`, which they must also ignore (same meaning: the viewer's own dependencies are unchanged). Recommendation: approve, and write the filter once as "every spec 008 workspace entry and its link" so M2b to M5 need no further edit. Alternative: put the wire types inside `apps/server` (no new workspace, no edit), against U1 and P13 (the bot and the viewer need them).
- Not a user decision (already approved): the `packages/protocol` workspace (U1); no new third-party dependency (the lockfile gains only the workspace entry and links); the root `typecheck` script gains `tsc -p packages/protocol/tsconfig.json` (spec "Repository configuration"); `workspaces` unchanged (the `packages/*` glob covers it).

M2a rules (in addition to the M1 rules):
- Branch `feat/008-m2a-protocol-and-core` from an up-to-date `rewrite` (061119b or later); one PR; squash with the user's OK and CI green.
- `packages/protocol/src` and `apps/server/src/core` are pure: no `node:*` import, no `Date`, `performance`, `Math.random`, `crypto`, `process`, `globalThis`, timers; they never import `apps/server/src/secret.ts`. Only `apps/server/src/clock.ts` reads the system clock, only `secret.ts` draws random bytes.
- The core view and every decision output have no absorber field and no pending-state field (plan PD7).
- No edit to `packages/sim/src`, `packages/shared/src`, any golden of M1, `maps/dev`. Earlier tests edited: only A1 and the traceability test; `apps/server/test/manifest.test.ts` (spec 008's own) is updated for the new runtime dependency.
- Traceability bookkeeping: a task that traces an id moves it from `PENDING_008` to `DONE_008` in the same commit, updates the `DONE_008` comment (task and id) and the two pinned counts; partial ids already in `DONE_008` are cited with their part (for example `NFR-47 (b)`).
- Fake clock and fake random only in tests (`apps/server/test/helpers`); the core gets `now` as a parameter and seeds through `seedOf(k)` (plan PD6).

- [x] **T1. Branch, commit plan / tasks; bookkeeping check.** NFR-55
  - Depends on: M1; user approval of plan section 16 and A1.
  - Files: `specs/008-server-and-predictions/{plan,tasks}.md` (as approved), `packages/sim/test/traceability.test.ts`.
  - Tests first: the counts test reads `DONE_008` and `PENDING_008` from their literals and asserts their sizes (8 / 88 now) with the M2a target noted in a comment (40 / 56); a planted M2a id (for example `FR-233`) in a dummy title is reported by "no pending id is already traced" (the existing planted test uses FR-231, which stays pending until M2b).
  - Commits: `docs: detail spec 008 milestone M2a`; `test: prepare the spec 008 bookkeeping for M2a`.
  - Done when: suite, typecheck and `CI=1` green; no id moved yet; `rg` finds NFR-55.

- [x] **T2. `packages/protocol` workspace, error kinds and their fixed order.** FR-301 (kinds and order); NFR-51 (protocol); NFR-53 (protocol manifest)
  - Depends on: T1.
  - Files: `packages/protocol/{package.json,tsconfig.json,src/index.ts,src/errors.ts}`, `packages/protocol/test/{errors.test.ts,purity.test.ts,manifest.test.ts}`, root `package.json` (`typecheck`), `package-lock.json` (workspace entry and link only), `apps/web/test/{shaped-deps,labels-render}.test.ts` (A1 filter), `packages/sim/test/traceability.test.ts`.
  - Tests first: `ERROR_ORDER` equals the FR-301 list literally (21 kinds plus the map-validation group at its position, 22 entries in order); `firstError` returns the first kind present in that order for every pair of kinds; only map validation errors and `invalid-timing` may carry several items; `already-performed` and the halt reasons are not error kinds; every kind is English kebab-case; the error shape has no field able to carry a secret or token (key list pinned). Purity scan over `packages/protocol/src` with planted violations (`Date.now`, `Math.random`, `node:fs`, `crypto`). Manifest: `@mbrg/protocol` private, module, dependencies only `@mbrg/shared` and `@mbrg/sim`, no dev dependencies; lockfile gains only `packages/protocol` and `node_modules/@mbrg/protocol`.
  - Commit: `feat(protocol): add the protocol package and error order`.
  - Done when: tests green; `npm ci` from the lockfile succeeds; the two viewer lockfile tests still assert the spec 005 / 004 views; mutation: swapping two kinds in `ERROR_ORDER` fails; FR-301 moved to `DONE_008`; `rg` finds FR-301.

- [x] **T3. Request readers: own-property rule, ids, timing split.** FR-233, FR-234, FR-296, FR-297
  - Depends on: T2.
  - Files: `packages/protocol/src/{ids.ts,timing.ts,read.ts,wire.ts}`, `packages/protocol/test/{ids.test.ts,timing.test.ts,read.test.ts}`, `packages/sim/test/traceability.test.ts`.
  - Tests first: creation body `{ mapId, timing, requestId }`, advance body `{ round, step, requestId? }`, submission body `{ kind, round?, faction, playerId, requestId? }` (round present exactly for victim and absorber); each reader rejects unknown, missing, inherited (prototype) and wrongly typed fields with `invalid-request` naming the first failing field in the documented order; timing `manual` accepted; a missing timing field, a missing value or a text value (`"3600"`) is `invalid-request`; I = 3.5 or L1 = 0 is `invalid-timing` rule (a); L2 = -1 rule (b); I = L1 + L2 rule (c); I = 2,592,001 rule (d); several failed rules listed in (a)-(d) order; I = 3, L1 = 1, L2 = 0 and I = 2,592,000 accepted; no default filled in (FR-234); local player id 1..64 of `A-Za-z0-9_-.`, `discord:1` and the empty text `invalid-player-id`; request id same set, else `invalid-request`; map id 1..64 of `a-z0-9-`.
  - Commit: `feat(protocol): read command bodies and timing settings`.
  - Done when: tests green; mutations proved (own-property check removed, rule (c) `<=` to `<`, `:` allowed in local ids); FR-233, FR-234, FR-296, FR-297 moved; `rg` finds them.

- [x] **T4. Canonical forms and the public view encoder.** FR-253, FR-254, FR-257, FR-282 (canonical content); NFR-47 (b)
  - Depends on: T3.
  - Files: `packages/protocol/src/{canonical.ts,public.ts,wire.ts}`, `packages/protocol/test/{canonical.test.ts,public.test.ts}`, `apps/server/test/canonical-digests.test.ts`, `packages/sim/test/traceability.test.ts`.
  - Tests first: `stateText` equals the M1 helper for every state of `golden/dev-secrets.json`; `mapDigestBytes` hashed with `node:crypto` gives the pinned `4d1698a3...e679` for `maps/dev`; `canonicalBody` ignores key order and whitespace, drops only the request-id field, and differs for another method, path or value. `PublicMatch` (NFR-47 (b)): its key list is pinned exactly and has no secret, seed, absorber or pending-state key (type-level and runtime check); `encodePublicMatch` writes fields in the documented order (byte-stable for equal inputs, independent of input key order); stage rules: victim fields only in `phase-2`, `locked` and `halted` after a reveal; winner and secret hex only in `finished`; an encoder input of another stage carrying them is rejected (FR-253, FR-254). FR-257 (core part): two inputs with equal public fields encode to identical bytes.
  - Commit: `feat(protocol): add canonical forms and the public view`.
  - Done when: tests green; mutation: a spread-built encoder (key order of the input) fails the byte-stability test; FR-253, FR-254, FR-257, FR-282 moved; `rg` finds them and `NFR-47 (b)`.

- [x] **T5. Core time rules, schedule anchors and the injectable clock.** FR-239, FR-249, FR-302, FR-314, NFR-50; NFR-51 (server core)
  - Depends on: T2 (T3 for timing types).
  - Files: `apps/server/src/core/{time.ts,view.ts}`, `apps/server/src/clock.ts`, `apps/server/package.json` (runtime dependency `@mbrg/protocol`), `package-lock.json` (that line only), `apps/server/test/{core-time.test.ts,core-purity.test.ts,manifest.test.ts (dependency list)}`, `apps/server/test/helpers/{fake-clock.ts,fake-random.ts}`, `packages/sim/test/traceability.test.ts`.
  - Tests first: anchors from t0 and (I, L1, L2) in integer ms (C1 = t0 + 1000(I − L1 − L2), C2, A = t0 + 1000 I) for host settings including I = 3, L1 = 1, L2 = 0; `effectiveInstant = max(reading, lastStepMs)`; `reportedTime` never decreases under a fake clock set backwards and is never below any step instant; on time at +1000 ms, overdue at +1001 ms; `dueStep` returns nothing before the instant and the step at or after it (NFR-50 logic: never earlier, within the tolerance); `lastStepMs` changes only through a step row (a prediction or read leaves it unchanged); timing `manual` has no anchors. FR-314: the core reads time only from its `now` parameter; `clock.ts` is the only server source reading `Date.now`; `secret.ts` the only one drawing random bytes (source scan with planted violations); fake clock `now`, `advance`, `set` (backwards allowed). Manifest test: runtime dependencies `@mbrg/protocol`, `@mbrg/shared`, `@mbrg/sim`.
  - Commit: `feat(server): add core time rules and the injectable clock`.
  - Done when: tests green; mutations proved (`max` replaced by the reading, tolerance 1000 to 999, reported time without its memory); FR-239, FR-249, FR-302, FR-314, NFR-50 moved; `rg` finds them and `NFR-51 (server core)`.

- [x] **T6. Stage machine and steps; secrecy by construction.** FR-237, FR-240 (decision), FR-247, FR-255, FR-256, FR-258, FR-269
  - Depends on: T5.
  - Files: `apps/server/src/core/{steps.ts,reads.ts,create.ts,view.ts}`, `apps/server/src/seeds.ts`, `apps/server/test/{core-steps.test.ts,core-reads.test.ts}`, `apps/server/test/helpers/core-driver.ts`, `packages/sim/test/traceability.test.ts`.
  - Tests first: creation check: dev map accepted (T = 4), a one-faction map `too-few-factions`, a two-faction map gives T = 1 with winner predictions closing at its phase-1 close; phase-1 close calls `seedOf(k)` exactly once, runs `playRoundWithSeed` from the state at k − 1 and returns victim, reveal instant (the step instant), candidates and living factions, with no absorber or pending state anywhere in the returned JSON (deep scan for the engine's absorber id in a case where it differs from every returned faction id, and a key-list check) (FR-255, FR-256); phase-2 close calls no seed; the application recomputes, checks the victim (`victim-mismatch` outcome on a forced difference), returns the record and state of round k and the anchors of k + 1, or `finished` with the winner and no schedule after round T; L2 = 0: phase-2 close and application in one decision with the same instant, phase-2 close first (FR-240); a step already performed is never performed again (FR-247); phases with no prediction proceed as scheduled (FR-269); `readRound(j)` for j > N gives `round-not-applied` with only N, equal for N + 1, N + 2, T + 5 (FR-258). `seeds.ts` binds `seedOf` to the M1 `roundSeed` (equal to the dev-secrets golden seeds).
  - Commit: `feat(server): add the pure stage machine and round steps`.
  - Done when: tests green; mutations proved (returning the full engine result, calling `seedOf` at the phase-2 close, skipping the victim check, ordering the L2 = 0 rows the other way); FR-237, FR-240, FR-247, FR-255, FR-256, FR-258, FR-269 moved; `rg` finds them.

- [x] **T7. Manual advance, late steps and the advance decision.** FR-244, FR-248, FR-295 (decision); FR-247 (advances)
  - Depends on: T6.
  - Files: `apps/server/src/core/advance.ts`, `apps/server/test/core-advance.test.ts`, `packages/sim/test/traceability.test.ts`.
  - Tests first: an advance naming the next step performs it with cause `manual` at `now` and shifted anchors: after a phase-1 close at t, C2 = t + L1 and A = t + L1 + L2; after a phase-2 close at t, only that step and A = t + L2 (stage `locked`), with L2 = 0 the application at once (D22); after an application, round k + 1 anchored at t; timing `manual`: one step per advance, three per round. Naming an already performed step: no step, `already-performed` with the stored row and the current view; naming any other step: `step-mismatch` with stage and N (FR-295). Sequences: two advances naming the same step give one step and one `already-performed`; a clock step then an advance naming it gives `already-performed`. Late steps (FR-248): an overdue step (restart, retry, stall, forward jump) is performed alone with cause `late` at the effective instant and the rest rescheduled from it (down across C1, C2 and A: only the phase-1 close, then full L1 and L2; down across C2: only the phase-2 close, application at start + L2; down across A: the application); an on-time step keeps its scheduled instant and shifts nothing; a backward jump makes steps wait.
  - Commit: `feat(server): add manual advances and late-step catch-up`.
  - Done when: tests green; mutations proved (phase-2 advance also applying, late rule performing two steps, on-time step shifting anchors, `already-performed` performing again); FR-244, FR-248, FR-295 moved; `rg` finds them.

- [ ] **T8. Prediction acceptance, closing and replacement.** FR-261 to FR-268
  - Depends on: T6 (T7 for stage changes in sequences).
  - Files: `apps/server/src/core/predictions.ts`, `apps/server/test/core-predictions.test.ts`, `packages/sim/test/traceability.test.ts`.
  - Tests first: victim open only in `phase-1`, absorber only in `phase-2`, winner until the phase-1 close of round T; a per-round prediction for another round, at the cutoff instant (exclusive) or after: `prediction-closed`, one millisecond before: accepted; finished: `match-finished`; halted: `match-halted`; victim must be living (`livingFactions`), absorber a candidate of the revealed victim (`absorptionCandidatesOf`), winner a winner candidate (revealed victim excluded), else `invalid-choice`; validation and replies equal for twin views with the same public data and different futures (FR-265); one prediction per key: a new choice replaces and increments the version, the same choice changes nothing and keeps the version; a delayed older resubmission without a request id overwrites (P37); a winner change stores the winner-candidate count at that instant; phases and the winner are independent; a missed cutoff gives no prediction and no penalty (FR-268).
  - Commit: `feat(server): add prediction acceptance and closing rules`.
  - Done when: tests green; mutations proved (cutoff `>=` to `>`, winner candidates including the victim, equal resubmission incrementing the version); FR-261 to FR-268 moved; `rg` finds them.

- [ ] **T9. Memo decision and core timeline goldens with the fake clock.** FR-282 (d), (e) at the core level; NFR-48 (lifecycle, core timelines); NFR-50
  - Depends on: T4, T7, T8.
  - Files: `apps/server/src/core/memo.ts`, `apps/server/test/{core-memo.test.ts,core-timeline-golden.test.ts}`, `apps/server/test/golden/core-timelines.json`.
  - Tests first: memo decision: no entry gives `new`; same scope, id and canonical content within 24 h gives `replay` of the stored reply (also after a cutoff); different content `request-id-reused`; at 24 h + 1 ms the id is new; replies `rate-limited`, `unknown-path`, `method-not-allowed`, `too-large`, `invalid-request`, `invalid-player-id`, `forbidden`, `unavailable` are not memoisable. Goldens: scripted dev-map matches through the driver with the fake clock and `seedOf` from M1 secret 0x00..0x1f and 32 x 0xa5: (1) I = 120, L1 = 30, L2 = 10 on time; (2) L2 = 0; (3) timing `manual` with three advances per round; (4) a manual phase-1 close and a manual phase-2 close mid-round; (5) a downtime across C1 and C2 and a forward jump; (6) a backward jump of 1 h. Pinned per step: round, kind, instant, cause, anchors after, stage, victim, record digest, encoded public view digest; victims and records equal `golden/dev-secrets.json` for every scenario (timing never changes outcomes, FR-315 core part noted, traced in M2b).
  - Commit: `test(server): pin core timelines and the memo decision`.
  - Done when: tests green; regenerating the golden is a separate, reviewed step (the test never writes it); mutation: an off-by-one ms in C1 changes the golden; `rg` finds `FR-282 (d)`, `NFR-48 (lifecycle`.

- [ ] **T10. Close M2a: ledger, process checks, PR.** NFR-55; done criteria of M2a
  - Depends on: T1 to T9.
  - Files: `packages/sim/test/traceability.test.ts` (assert `DONE_008` 40 and `PENDING_008` 56), `specs/008-server-and-predictions/plan.md` (sections 11 and 13: M2a figures, partial ids), `MEMORY.md` (local).
  - Steps: `git diff --exit-code rewrite -- packages/shared/src packages/sim/src packages/sim/test/golden maps/dev apps/server/test/golden/dev-secrets.json` clean; `git diff --stat rewrite -- packages apps tools` shows only the planned files; purity scans green; PR body lists the ledger, the moved ids and A1. Push, PR, CI green, squash only with the user's OK.
  - Commit: `test: pin the spec 008 pending set after M2a`.
  - Done when: CI green; counts 40 / 56; `MEMORY.md` updated (next: detail M2b).

## Later milestones (headings only; detailed later, at most 10 tasks each)
- **M2b. SQLite store, lifecycle service with the fake clock, halting, memo, recovery, durability.** FR-231, FR-232, FR-235, FR-236, FR-238, FR-240 to FR-243, FR-245, FR-246, FR-250, FR-251, FR-259, FR-260, FR-270 (storage), FR-288, FR-289 (data), FR-290 to FR-294, FR-300 (digests), FR-315; NFR-47(a), (d), (f), NFR-48 (lifecycle), NFR-52, NFR-54 (store), NFR-57. Depends on M2a.
- **M3a. HTTP commands and reads, credentials, cross-origin, limits, paging, map files.** FR-257 (HTTP), FR-270 (read), FR-279, FR-280, FR-281 (non-result), FR-282 (transport), FR-283 to FR-286, FR-298 to FR-300, FR-301, FR-302 (HTTP); NFR-47(c), NFR-52, NFR-54 (logs). Depends on M2b.
- **M3b. Server-Sent Events, replay, heartbeat, performance procedure.** FR-287, FR-288, FR-289 (stream), FR-290 (stream); NFR-49. Depends on M3a.
- **M4. Scoring, results and leaderboard.** FR-271 to FR-278, FR-281(e) to (g), scoring parts of FR-241, FR-243, FR-246, FR-251(c); NFR-48 (results), NFR-57 (results). Depends on M2b, M3a.
- **M5. Live viewer and web test client.** FR-303 to FR-311; NFR-56; screenshots reviewed by the user. Depends on M3b, M4. Closes the pending set; spec 008 becomes `implemented` after acceptance.
