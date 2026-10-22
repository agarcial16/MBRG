# Tasks 008 — Server and predictions
Plan: `specs/008-server-and-predictions/plan.md`. Prerequisites: spec approved by the user (2026-10-21, D25); plan section 1 decisions U1 to U5 answered by the user (2026-10-21/22: workspaces `apps/server` and `packages/protocol`; `tsx` 4.23.15 and `@types/node` 24.19.2 reused as pinned dev dependencies of `apps/server`; no type stripping and no import-line changes in sim or shared; `engines >=24` and `.nvmrc 24` kept, any raise back to the user; exports `playRoundWithSeed`, `absorptionCandidatesOf`, `livingFactions`); **plan and tasks approved by the user (M1 and M2a)**. Any later change goes to the spec first, then the plan, then these tasks.

This file details **M1** (merged, PR #28, 061119b), **M2a** (merged, PR #29, ac1263a) and **M2b / M2b'** (pending the user's approval, plan section 17). M3a to M5 are listed as headings at the end and are detailed (at most 10 tasks each) in a later revision, approved before their first task. The M1 rules below apply to every milestone, with the M2a additions in the M2a section.

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

**User decisions (2026-10-22, approved)**
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

- [x] **T8. Prediction acceptance, closing and replacement.** FR-261 to FR-268
  - Depends on: T6 (T7 for stage changes in sequences).
  - Files: `apps/server/src/core/predictions.ts`, `apps/server/test/core-predictions.test.ts`, `packages/sim/test/traceability.test.ts`.
  - Tests first: victim open only in `phase-1`, absorber only in `phase-2`, winner until the phase-1 close of round T; a per-round prediction for another round, at the cutoff instant (exclusive) or after: `prediction-closed`, one millisecond before: accepted; finished: `match-finished`; halted: `match-halted`; victim must be living (`livingFactions`), absorber a candidate of the revealed victim (`absorptionCandidatesOf`), winner a winner candidate (revealed victim excluded), else `invalid-choice`; validation and replies equal for twin views with the same public data and different futures (FR-265); one prediction per key: a new choice replaces and increments the version, the same choice changes nothing and keeps the version; a delayed older resubmission without a request id overwrites (P37); a winner change stores the winner-candidate count at that instant; phases and the winner are independent; a missed cutoff gives no prediction and no penalty (FR-268).
  - Commit: `feat(server): add prediction acceptance and closing rules`.
  - Done when: tests green; mutations proved (cutoff `>=` to `>`, winner candidates including the victim, equal resubmission incrementing the version); FR-261 to FR-268 moved; `rg` finds them.

- [x] **T9. Memo decision and core timeline goldens with the fake clock.** FR-282 (d), (e) at the core level; NFR-48 (lifecycle, core timelines); NFR-50
  - Depends on: T4, T7, T8.
  - Files: `apps/server/src/core/memo.ts`, `apps/server/test/{core-memo.test.ts,core-timeline-golden.test.ts}`, `apps/server/test/golden/core-timelines.json`.
  - Tests first: memo decision: no entry gives `new`; same scope, id and canonical content within 24 h gives `replay` of the stored reply (also after a cutoff); different content `request-id-reused`; at 24 h + 1 ms the id is new; replies `rate-limited`, `unknown-path`, `method-not-allowed`, `too-large`, `invalid-request`, `invalid-player-id`, `forbidden`, `unavailable` are not memoisable. Goldens: scripted dev-map matches through the driver with the fake clock and `seedOf` from M1 secret 0x00..0x1f and 32 x 0xa5: (1) I = 120, L1 = 30, L2 = 10 on time; (2) L2 = 0; (3) timing `manual` with three advances per round; (4) a manual phase-1 close and a manual phase-2 close mid-round; (5) a downtime across C1 and C2 and a forward jump; (6) a backward jump of 1 h. Pinned per step: round, kind, instant, cause, anchors after, stage, victim, record digest, encoded public view digest; victims and records equal `golden/dev-secrets.json` for every scenario (timing never changes outcomes, FR-315 core part noted, traced in M2b).
  - Commit: `test(server): pin core timelines and the memo decision`.
  - Done when: tests green; regenerating the golden is a separate, reviewed step (the test never writes it); mutation: an off-by-one ms in C1 changes the golden; `rg` finds `FR-282 (d)` and `NFR-48 (core timelines`; the lifecycle part of NFR-48 is M2b and the results part M4.

- [x] **T10. Close M2a: ledger, process checks, PR.** NFR-55; done criteria of M2a
  - Depends on: T1 to T9.
  - Files: `packages/sim/test/traceability.test.ts` (assert `DONE_008` 40 and `PENDING_008` 56), `specs/008-server-and-predictions/plan.md` (sections 11 and 13: M2a figures, partial ids), `MEMORY.md` (local).
  - Steps: `git diff --exit-code rewrite -- packages/shared/src packages/sim/src packages/sim/test/golden maps/dev apps/server/test/golden/dev-secrets.json` clean; `git diff --stat rewrite -- packages apps tools` shows only the planned files; purity scans green; PR body lists the ledger, the moved ids and A1. Push, PR, CI green, squash only with the user's OK.
  - Commit: `test: pin the spec 008 pending set after M2a`.
  - Done when: CI green; counts 40 / 56; `MEMORY.md` updated (next: detail M2b).

## M2b — SQLite store and lifecycle service (`feat/008-m2b-store-and-lifecycle`), then M2b' — halting and recovery (`feat/008-m2b2-halting-and-recovery`)
Depends on M2a (merged, ac1263a). Plan section 17. Status: **approved by the user on 2026-10-22**, together with B1 to B4 (decisions below).

**Needs a user decision before T1**
- **B1. DECIDED 2026-10-22: split.** Split per D24 into M2b (store, creation, steps and predictions through the service; 8 tasks) and M2b' (halting, map check, timer and recovery, anti-spoiler and durability at the service level; 7 tasks), two PRs. Recommendation: split (15 tasks do not fit 10). Alternative: one PR of 10 larger tasks (recovery, timer and durability merged into two tasks; harder to review).
- **B2. DECIDED 2026-10-22: drop both.** `packages/protocol` dependencies. Its manifest declares `@mbrg/shared` and `@mbrg/sim`, but `src` imports neither. Recommendation: drop both (the bot can then use the protocol without the engine; edits `packages/protocol/test/manifest.test.ts` and the lockfile entry only, no download). Alternative: keep them for future type imports.
- **B3. DECIDED 2026-10-22: confirm `clock`, no core change.** Cause of the chained application after a manual or late phase-2 close with L2 = 0: the merged core stores it with cause `clock` (the application falls due by the schedule at that instant; the caller's cause stays on the phase-2 close row). Recommendation: confirm `clock` and state it in the plan (no spec change: FR-240 lists the causes, not this case). Alternative: the application inherits `manual` / `late` (a core change and a re-pin of `core-timelines.json`).
- **B4. DECIDED 2026-10-22: as recommended.** Reply shapes. Recommendation: move `PredictionReply` from `apps/server/src/core/predictions.ts` to `packages/protocol` in M2b (the memo stores replies and the bot needs the type); leave the unification of `StepMismatchReply` and the `round-not-applied` items with `ErrorReply` to M3a, together with the HTTP status mapping. Alternative: do both in M2b, or both in M3a.
- Not a user decision: no new dependency (`node:sqlite`, `node:crypto`, timers are built in); root `package.json`, `workspaces`, `engines`, `.nvmrc` unchanged; lockfile unchanged unless B2 drops the two protocol dependency lines; SQLite settings are plan PD9 to PD13. For spec 009 (not 008): in `locked`, `victim.a` keeps the reveal-time A while `schedule.a` is the shifted one (FR-288 "same fields"); the coordinator should tell spec 009.

M2b / M2b' rules (in addition to the M1 and M2a rules):
- Branches from an up-to-date `rewrite`; M2b' starts after M2b is merged. One PR each; squash with the user's OK and CI green.
- `node:sqlite` is imported only in `apps/server/src/store/`; `apps/server/src/core` and `packages/protocol/src` never import the store, the service, timers or `node:*` (scan, FR-291). Random bytes only through `secret.ts` (an exported byte-drawing helper there serves `service/ids.ts`); the system clock only through `clock.ts`; timers only in `service/scheduler.ts` (the M2a scan allow-list is extended by that one file if it forbids timers).
- No credential text is ever written to the database (digests, PD12); the plain host token exists only in the 24 h creation memo (D23).
- The absorber and the pending state are never written (PD11); tests inspect the database, not only the API.
- Tests use the fake clock, the fake scheduler, the fake random source and in-memory SQLite, plus temporary-file databases for lock, restart and durability tests (unique paths, closed in `finally`); no mocking library (NFR-52).
- Bookkeeping as in M2a: a task that traces an id moves it to `DONE_008` in the same commit; partial ids already done are cited with their part.

### M2b

- [x] **T1. Branch, commit plan / tasks; bookkeeping targets.** NFR-55
  - Depends on: M2a; user approval of plan section 17 and B1 to B4.
  - Files: `specs/008-server-and-predictions/{plan,tasks}.md`, `packages/sim/test/traceability.test.ts`.
  - Tests first: counts still 40 / 56, with the M2b target 63 / 33 and the M2b' target 67 / 29 noted in comments; the planted-id test still uses FR-231 (pending until T5), so T5 switches it to a still-pending M3a id (FR-283).
  - Commits: `docs: detail spec 008 milestones M2b and M2b'`; `test: prepare the spec 008 bookkeeping for M2b`.
  - Done when: suite, typecheck and `CI=1` green; no id moved; `rg` finds NFR-55.

- [x] **T2. Hand-offs from M2a: creation event, memo key by digest, reply placement.** FR-289 (c); FR-300 (digests); NFR-54 (store, memo keys)
  - Depends on: T1.
  - Files: `apps/server/src/core/{create.ts,memo.ts,predictions.ts}`, `packages/protocol/src/{wire.ts,index.ts}` (B4), `packages/protocol/{package.json,test/manifest.test.ts}` and `package-lock.json` (only if B2 drops the dependencies), `apps/server/test/{core-create.test.ts,core-memo.test.ts}`, `apps/server/test/helpers/core-driver.ts`, `apps/server/test/golden/core-timelines.json` (re-pin, reviewed), `packages/sim/test/traceability.test.ts`.
  - Tests first: `creationEvents(view, reportedTime)` returns one `schedule` event with seq 1 (stage `phase-1`, the anchors with a clock, none with `manual`) and the view with `lastSeq` 1, which `encodePublicMatch` accepts (FR-289 (c)); `memoKey` takes a credential digest: the key built for a credential contains no substring of the credential text, two credentials give different keys, the same credential the same key (FR-300 (digests), NFR-54 (store)); `PredictionReply` is exported by the protocol and the core imports it from there (B4); with B2, the protocol manifest has no dependencies. Re-pin: `core-timelines.json` regenerated by a separate reviewed step; its diff shows only seq + 1 for every event and one first `schedule` event per scenario.
  - Commit: `feat(server): add the creation event and digest memo keys`.
  - Done when: tests green; mutations proved (creation event with seq 0, memo key built from the credential text); FR-289, FR-300 moved; `rg` finds `FR-289 (c)`, `FR-300 (digests)`.

- [x] **T3. SQLite store: open, settings, schema version, exclusive lock.** FR-291; FR-292 (durability settings)
  - Depends on: T1.
  - Files: `apps/server/src/store/{store.ts,sqlite.ts,schema.ts}`, `apps/server/test/{store-open.test.ts,store-purity.test.ts}`, `packages/sim/test/traceability.test.ts`.
  - Tests first: `openStore(':memory:')` and a temporary file create schema version 1 in one transaction; reopening a version-1 file keeps the data; a file with `user_version` 2 is refused (`unknown-schema-version`); the PRAGMAs read back as PD9 (`journal_mode` wal on a file, `synchronous` full, `foreign_keys` on, `locking_mode` exclusive); a second `openStore` on the same file fails with `database-locked` while the first is open and succeeds after it closes (on Windows and Linux); `node:sqlite` is imported only under `src/store/`, and `src/core` / `packages/protocol/src` import neither the store nor the service (scan with planted violations).
  - Commit: `feat(server): open the sqlite store with an exclusive lock`.
  - Done when: tests green; mutations proved (version check removed, lock PRAGMA removed); FR-291, FR-292 moved (FR-292 (unavailable, retry) completed in M2b' T3'); `rg` finds them.

- [ ] **T4. Store operations and atomic transactions.** FR-293; FR-270 (storage); FR-240 (storage); FR-267 (persistence)
  - Depends on: T3.
  - Files: `apps/server/src/store/{store.ts,sqlite.ts}`, `apps/server/test/{store-ops.test.ts,helpers/db-scan.ts}`, `packages/sim/test/traceability.test.ts`.
  - Tests first: a `CoreMatch` round-trips through `matches` for every field of `CORE_MATCH_KEYS` in every stage (anchors null and set, victim fields, winner, halt reason) plus the plain secret column (D14) and the host-token digest (FR-293); states and records per applied round; two step rows written in one transaction keep their order and instant (FR-240 (storage)); a prediction is upserted by (match, player, kind, round) with its version and winner-candidate count, and read back per player id (FR-267 (persistence), FR-270 (storage)); events get unique increasing `seq` and `eventsAfter(seq)` returns them in order; memo entries are read by key and purged after 24 h; a transaction that throws leaves no row of any table; `db-scan.ts` lists every table and column: no column for an absorber outside `records`, none for a pending state, none for a credential text.
  - Commit: `feat(server): store matches, steps, predictions, events and memos`.
  - Done when: tests green; mutations proved (steps written in two transactions, prediction key without the round, memo purge off by one ms); FR-270, FR-293 moved; `rg` finds them and the partial parts.

- [ ] **T5. Lifecycle service: creation, ids, map list, memo, test-only seed seam.** FR-231, FR-232, FR-235, FR-236, FR-238, FR-259 (commitment), FR-260; NFR-47 (f); NFR-54 (store)
  - Depends on: T2, T4.
  - Files: `apps/server/src/service/{matches.ts,maps.ts,ids.ts,settings.ts}`, `apps/server/src/secret.ts` (exported byte-drawing helper only), `apps/server/src/main.ts`, `apps/server/test/{service-create.test.ts,service-seam.test.ts,helpers/service-harness.ts}`, `packages/sim/test/traceability.test.ts` (planted-id test switched to FR-283).
  - Tests first: creation with the operator credential stores the match, the secret, the host-token digest and the creation event before replying with match id, public data at round 0 (commitment, `lastSeq` 1) and host token (FR-231, FR-259 (commitment)); errors in the FR-301 order: `forbidden`, `unknown-map`, map validation errors, `too-few-factions`, `invalid-timing`, `too-many-matches` at the 21st running match (halted and finished do not count) (FR-232); timing and map fixed after creation (FR-235); match id from 12 random bytes and host token from 32, drawn separately, in the credential character set (FR-236); a repeated creation with the same request id and content within 24 h returns the first reply with the same host token and creates nothing; a different content `request-id-reused`; after the purge the database holds no plain host token (FR-238, NFR-54 (store)); the test-only seed source is accepted only by the service constructor; `main.ts` builds the service from settings with none, and an environment variable named like a seed source changes nothing (FR-260, NFR-47 (f)).
  - Commit: `feat(server): create matches through the lifecycle service`.
  - Done when: tests green; mutations proved (match id and host token from one draw, host token stored in plain, memo replay ignoring the content); FR-231, FR-232, FR-235, FR-236, FR-238, FR-259, FR-260, NFR-54 moved; `rg` finds them and `NFR-47 (f)`.

- [ ] **T6. Steps through the service: advance, clock ticks, one transaction per decision, finish.** FR-241, FR-242, FR-243, FR-245, FR-246, FR-288 (data), FR-290, FR-315; NFR-52 (store and lifecycle); FR-295 (serialisation); FR-247 (shell)
  - Depends on: T5.
  - Files: `apps/server/src/service/{matches.ts,scheduler.ts}`, `apps/server/test/{service-steps.test.ts,helpers/fake-scheduler.ts}`, `packages/sim/test/traceability.test.ts`.
  - Tests first: with the fake clock and scheduler, a dev-map match runs from creation to T: each phase-1 close stores its step row, victim, reveal instant and events in one transaction and publishes after the commit (a subscriber reading the database inside its callback sees the rows) (FR-241, FR-290); each phase-2 close stores its row and the `locked` stage (FR-242); each application stores row, state, record and the next anchors (FR-243); after round T the match is finished, the winner stored, a `match-finished` event carries the secret hex and the rule, and the public data of the finished match shows the secret (FR-246); an advance without the operator credential or the host token is `forbidden`, on a finished match `match-finished` (FR-245); the public data in `phase-2` and `locked` carries the stored victim fields (FR-288 (data)); two advances naming the same step and a clock step racing an advance perform one step (FR-295 (serialisation), FR-247 (shell)); victims and records equal `golden/dev-secrets.json` for timing `manual`, two clock settings and mid-round advances (FR-315).
  - Commit: `feat(server): run match steps through the lifecycle service`.
  - Done when: tests green; mutations proved (events published before commit, application stored in two transactions, advance check skipping the host token); FR-241, FR-242, FR-243, FR-245, FR-246, FR-288, FR-290, FR-315, NFR-52 moved; `rg` finds them.

- [ ] **T7. Predictions through the service: storage, memo replays, own predictions.** FR-262 to FR-267 (storage); FR-269 (no result rows for an empty phase); FR-270 (storage); FR-282 (b), (c) (stored replies)
  - Depends on: T6.
  - Files: `apps/server/src/service/matches.ts`, `apps/server/test/service-predictions.test.ts`.
  - Tests first: accepted submissions are stored before the reply (a failing commit gives no reply of acceptance); the cutoff uses the effective instant from the stored last step instant, not a client time; a replacement increments the stored version; an equal resubmission writes nothing; a submission with a request id is memoised under the client-credential digest and replayed after the cutoff; rejections `prediction-closed` and `invalid-choice` are memoised, `invalid-player-id` is not; `ownPredictions` returns only the caller's namespaced player ids; a phase with no prediction leaves no result row and the match goes on (FR-269).
  - Commit: `feat(server): store predictions through the lifecycle service`.
  - Done when: tests green; mutations proved (reply before commit, memo of a non-memoisable kind); no new id moved (partial parts only, titles name them).

- [ ] **T8. Close M2b: ledger, process checks, PR.** NFR-55
  - Depends on: T1 to T7.
  - Files: `packages/sim/test/traceability.test.ts` (assert 63 / 33), `specs/008-server-and-predictions/plan.md` (sections 11 and 13: M2b figures, partial parts), `MEMORY.md` (local).
  - Steps: `git diff --exit-code rewrite -- packages/shared/src packages/sim/src packages/sim/test/golden maps/dev apps/server/test/golden/dev-secrets.json` clean; `git diff --stat rewrite` shows only planned files (and the reviewed `core-timelines.json` re-pin); purity and store scans green; PR body lists the ledger, the moved ids and B1 to B4. Push, PR, CI green, squash only with the user's OK.
  - Commit: `test: pin the spec 008 pending set after M2b`.
  - Done when: CI green; counts 63 / 33; `MEMORY.md` updated (next: M2b').

### M2b'

- [ ] **T1'. Branch, commit plan / tasks; bookkeeping targets.** NFR-55
  - Depends on: M2b merged.
  - Files: `specs/008-server-and-predictions/{plan,tasks}.md`, `packages/sim/test/traceability.test.ts`.
  - Tests first: counts 63 / 33, target 67 / 29 in a comment.
  - Commits: `docs: start spec 008 milestone M2b'`; `test: prepare the spec 008 bookkeeping for M2b'`.
  - Done when: suite, typecheck and `CI=1` green.

- [ ] **T2'. Map check and halting through the service.** FR-250, FR-251
  - Depends on: T1'.
  - Files: `apps/server/src/service/{matches.ts,maps.ts}`, `apps/server/test/service-halting.test.ts`, `packages/sim/test/traceability.test.ts`.
  - Tests first: the shell passes `map: null` when the listed package is missing, fails validation or has another digest than the stored one, at start and before every step; the match halts with `map-changed`; an `isolated-faction` map halts with `isolated-faction`; a forced victim difference halts with `victim-mismatch` (FR-250); a halted match stores stage and reason, publishes `match-halted`, performs no further step, never stores or sends the secret hex, keeps the victim fields when the victim was revealed, answers `match-halted` to submissions and advances, serves its public data with the reason, and does not count toward the running-match limit; predictions of the halting round that were not scored stay as stored (scoring itself is M4) (FR-251).
  - Commit: `feat(server): halt matches on map changes and engine errors`.
  - Done when: tests green; mutations proved (digest check skipped before a step, halted match counted as running, secret revealed on halt); FR-250, FR-251 moved; `rg` finds them.

- [ ] **T3'. Timer loop, storage failures and the 3 s retry.** FR-292 (unavailable, retry); FR-239, FR-244, FR-248 (timer, start-up and retry); NFR-50 (real clock, measured)
  - Depends on: T2'.
  - Files: `apps/server/src/service/{matches.ts,scheduler.ts}`, `apps/server/src/store/faults.ts`, `apps/server/test/{service-timer.test.ts,service-faults.test.ts}`, `apps/server/scripts/clock-accuracy.ts`, plan section 13.
  - Tests first: the scheduler is armed for the next due instant after every decision and at start; a fake clock jump forward makes the next tick perform one late step at the effective instant and shift the anchors (FR-248); a backward jump makes it wait (FR-249 (shell)); a storage failure (fault seam) inside a submission or an advance gives `unavailable` and leaves the database unchanged; a failed clock step is retried 3 s later, on time if within the tolerance, else late (PD13). NFR-50 measurement: the script runs a real-clock match with I = 6, L1 = 2, L2 = 1 for 10 rounds and records the worst delay from scheduled to performed (target within 1,000 ms) in plan section 13; not run in CI.
  - Commit: `feat(server): schedule steps and retry after storage failures`.
  - Done when: tests green; figure recorded; mutations proved (retry at 0 s, two overdue steps performed, `unavailable` after a partial write); no new id moved; `rg` finds `FR-292 (unavailable`.

- [ ] **T4'. Restart recovery and lifecycle goldens.** FR-294; FR-249 (across restarts); NFR-48 (lifecycle)
  - Depends on: T3'.
  - Files: `apps/server/test/{service-restart.test.ts,service-timeline-golden.test.ts}`, `apps/server/test/golden/service-timelines.json`, `packages/sim/test/traceability.test.ts`.
  - Tests first: with a temporary file database, a scripted match is stopped and restarted after every step: the restarted service resumes at the stored stage, round and anchors, never repeats or skips a step, applies the map check and then the late rule (FR-294); stored instants never decrease across a restart with a clock set back (FR-249 (across restarts)); events stored before a stop are read back with their sequence numbers; golden service timelines for the six M2a scenarios (rows, anchors, stages, event types and seqs, victims, record and state digests) equal the core goldens re-pinned in M2b T2 and stay equal with a restart after every step (NFR-48 (lifecycle)).
  - Commit: `test(server): resume matches after a restart`.
  - Done when: tests green; mutation: resuming from the creation anchors instead of the stored ones fails; FR-294 moved; `rg` finds it and `NFR-48 (lifecycle)`.

- [ ] **T5'. Anti-spoiler at the service level.** NFR-47 (a), (d); FR-255, FR-256 (storage)
  - Depends on: T4'.
  - Files: `apps/server/test/{service-twins.test.ts,service-db-secrecy.test.ts}`, `apps/server/test/helpers/db-scan.ts`.
  - Tests first: (a) two services with test seed sources that give the same victims up to round k and different absorbers (and later rounds): every reply, stored event payload and public data before round k's application is byte-identical apart from match id, host token, commitment and reported time; (d) after every step of a scripted match, the database holds no `records` or `states` row for a round above N, no event about a round above N, no round seed of the planted secret (scanned in decimal, hexadecimal, base64 and base64url over every text and blob column), and no column able to hold an absorber outside `records` (FR-255, FR-256 (storage)).
  - Commit: `test(server): check that storage never holds the future`.
  - Done when: tests green; mutation: storing the engine's absorber in the match row during phase 2 fails (d); no new id moved; `rg` finds `NFR-47 (a)`, `NFR-47 (d)`.

- [ ] **T6'. Durability: kill and restart between every transaction.** NFR-57 (M2b part)
  - Depends on: T4'.
  - Files: `apps/server/src/store/faults.ts`, `apps/server/test/{service-durability.test.ts,fixtures/kill-child.ts}`, `packages/sim/test/traceability.test.ts`.
  - Tests first: for a scripted match with predictions, for every n, the fault seam aborts before the n-th commit and closes the connection without committing; a new service on the same file resumes; the final states, records, step rows, events and predictions equal those of an uninterrupted run (results empty until M4); no accepted prediction is lost, no step repeated or skipped. Once, a real child process running the service is killed (`SIGKILL` / `taskkill`) between two commits to validate the seam.
  - Commit: `test(server): survive a kill between any two transactions`.
  - Done when: tests green (runtime logged; above 5 s gets its own timeout); mutation: a commit split in two fails; NFR-57 moved; `rg` finds `NFR-57`.

- [ ] **T7'. Close M2b': ledger, process checks, PR.** NFR-55
  - Depends on: T1' to T6'.
  - Files: `packages/sim/test/traceability.test.ts` (assert 67 / 29), `specs/008-server-and-predictions/plan.md` (sections 11 and 13), `MEMORY.md` (local).
  - Steps: as M2b T8; PR body lists the ledger and the NFR-50 figure.
  - Commit: `test: pin the spec 008 pending set after M2b'`.
  - Done when: CI green; counts 67 / 29; `MEMORY.md` updated (next: detail M3a).

## Later milestones (headings only; detailed later, at most 10 tasks each)
- **M3a. HTTP commands and reads, credentials, cross-origin, limits, paging, map files.** FR-257 (HTTP), FR-270 (read), FR-279, FR-280, FR-281 (non-result), FR-282 (transport), FR-283 to FR-286, FR-298 to FR-300, FR-301, FR-302 (HTTP); NFR-47(c), NFR-52, NFR-54 (logs); also the `StepMismatchReply` / `round-not-applied` shape unification with the HTTP status mapping (B4). Depends on M2b'.
- **M3b. Server-Sent Events, replay, heartbeat, performance procedure.** FR-287, FR-288, FR-289 (stream), FR-290 (stream); NFR-49. Depends on M3a.
- **M4. Scoring, results and leaderboard.** FR-271 to FR-278, FR-281(e) to (g), scoring parts of FR-241, FR-243, FR-246, FR-251(c); NFR-48 (results), NFR-57 (results). Depends on M2b', M3a.
- **M5. Live viewer and web test client.** FR-303 to FR-311; NFR-56; screenshots reviewed by the user. Depends on M3b, M4. Closes the pending set; spec 008 becomes `implemented` after acceptance.
