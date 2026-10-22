# Plan 008 — Server and predictions
Spec: `specs/008-server-and-predictions/spec.md` (approved by the user on 2026-10-21, D25). Covers FR-231 to FR-315 and NFR-47 to NFR-57 (96 ids). Delivery in milestones (spec D18, D24): M1, M2a, M2b, M3a, M3b, M4, M5, each with its own branch cut from an up-to-date `rewrite`, its own PR into `rewrite`, squash merge with the user's OK and CI green. GitHub issues: one per milestone only if the user wants them (spec "Splitting").

This plan is at overview level for the whole spec and detailed for **M1** (branch `feat/008-m1-secret-and-sim-exports`), **M2a** (section 16), **M2b** and **M2b'** (section 17) and **M3a** (section 18). M3b to M5 get their detailed sections and tasks in a later revision of this plan, each approved before its first task.

**Gate.** This plan and `tasks.md` were approved by the user for M1 and M2a, and for M2b and M2b' on 2026-10-22, and for M3a on 2026-10-22 (section 18 with C1 to C8 as recommended, `tasks.md`; C2 recorded in the spec as D26). The items of section 1 were answered by the user on 2026-10-21/22 (U1 to U5, now decisions).

## 0. Starting point and guards (read before coding)
- `rewrite` at 14127e6 (spec 007 merged, PR #27). Node: `.nvmrc` = `24`, root `engines` = `>=24`; CI uses `.nvmrc`. TypeScript `^7.0.2` (type-check only, `noEmit`), Vitest `^5.0.4`. Workspaces: `packages/*`, `tools/build-map`, `apps/web`.
- `@mbrg/sim` and `@mbrg/shared` export TypeScript sources (`"exports": { ".": "./src/index.ts" }`), `moduleResolution: bundler`, relative imports **without extensions**. Vitest and Vite consume them directly; plain Node cannot (section 7).
- `tools/build-map` already has `tsx` 4.23.15 and `@types/node` 24.19.2 as pinned development dependencies (003b approval); both are in the lockfile.
- Sim exports today: `MODE`, `getRounds`, `getState`, `ownerOf`, `totalRounds`. Asserted exactly in three tests: `packages/sim/test/candidates.test.ts` lines 86 to 88 (FR-81, also asserts `absorptionCandidates` is not exported), `packages/sim/test/match.test.ts` line 146, `packages/shared/test/no-regression.test.ts` lines 30 to 33 (NFR-22). These are the only earlier tests that M1 edits besides the traceability test (spec D21, NFR-55).
- Internal sim code reused: `playRound(map, state, seed)` (`internal.ts`), `absorptionCandidates(map, state, faction)` (`candidates.ts`, returns `{ how, factions }`, **throws** for a non-living faction), `livingFactions(state)` (`factions.ts`), `checkSeed` (`inputs.ts`), `validateMap` (shared).
- `packages/sim/test/purity.test.ts` scans every file of `sim/src` and `shared/src` for `Date`, `crypto`, `process`, `globalThis`, Node built-ins and similar: **no keyed function, digest or clock may live in sim or shared**. The HMAC lives in the server layer.
- `packages/sim/test/language.test.ts` pins `SIM_KINDS` as the kinds produced through the existing APIs; it is not edited: the new kinds are produced only by the new exports and get their own language test.
- Traceability (`packages/sim/test/traceability.test.ts`): ranges `FR [[1, 230]]`, `NFR [[1, 46]]`; 276 ids, 274 expected; asserts `FR-231`, `NFR-47` are NOT ids yet; self-trace list ends with `NFR-44`.
- MEMORY lessons that apply: full `npm test` for mutation proofs; back a file up before reverting; perf and long statistical tests run alone; non-round constants in fixtures; quote the path (spaces); Write/Edit tools for sources (CRLF); own-property rule for `unknown` input; never link `node_modules` into a worktree.

## 1. User decisions for the plan (answered 2026-10-21/22)
Nothing is left open before T1 except the formal approval of this plan and `tasks.md`.
| # | Decision (user, 2026-10-21/22) | Discarded |
|---|---|---|
| U1 | **New workspaces `apps/server`** (skeleton in M1: `package.json`, `tsconfig.json`, `tsconfig.test.json`, the secret module, the entry point, tests) **and `packages/protocol`** (created in M2a), with their root `workspaces` and `typecheck` entries. | `packages/server`. |
| U2 | **Reuse `tsx` 4.23.15 and `@types/node` 24.19.2** as development dependencies of `apps/server`, pinned exactly (already in the lockfile for `tools/build-map`; nothing new is downloaded). Approved as the "ask first" dependency item for the new workspace. `tsx` runs the server from TypeScript sources (section 7); `@types/node` types `node:sqlite`, `node:crypto`, `node:http`. | Bundling the server with Vite; Node's built-in type stripping. |
| U3 | **Keep root `engines: >=24` and `.nvmrc: 24`.** T5 records the exact Node version in section 13; raising the minimum comes back to the user. | Pinning an exact minor now. |
| U4 | **Export names `playRoundWithSeed(map, state, roundSeed)`, `absorptionCandidatesOf(map, state, faction)`, `livingFactions(map, state)`**; inside sim the internal `livingFactions(state)` is imported under an alias where both are needed. The three export-list assertions (section 0) become the exact list of 8 names and keep asserting that `absorptionCandidates` is not exported (spec D21). | `playRoundFrom` / `candidatesOf` / `livingFactionsOf`. |
| U5 | **No type stripping and no import-line changes in `packages/sim/src` or `packages/shared/src`**; the server runs through `tsx` (U2). | Adding `.ts` extensions to every import (with `allowImportingTsExtensions`). |

## 2. Architecture (whole spec)
```
@mbrg/shared (pure, unchanged)      @mbrg/sim (pure engine + 3 exports, FR-313)
            \                          /
             @mbrg/protocol (pure, new in M2a): wire types, own-property readers, error kinds and
             their fixed order (FR-301), timing rules (FR-233), canonical forms: map-digest bytes,
             state-digest text, canonical request body (FR-282), cursor format (FR-279)
                     |                                   |
apps/server (new): core/ (pure)          apps/web (existing): live client (M5), pure parts in src/core,
  stage machine, schedule, anchors,        DOM/network in src/ui; debug scene unchanged (FR-309)
  late rule, effective and reported
  time, advance decision, prediction
  validation, scoring, ranking, paging
  shell: clock, random, secret (HMAC), SQLite store, HTTP router, SSE hub, rate limiter, settings
```
- **Pure core, effectful shell.** Every decision is a pure function `decide(view, input, now) -> { writes, events, reply }` over a match view loaded from the store; the shell runs `writes` in one storage transaction, then publishes `events`, then sends `reply` (FR-290, FR-292). Round seeds reach the core through a `roundSeed(k)` function parameter: in production the HMAC of section 5, in tests the test-only source of FR-260, which only `createServer(options)` accepts and `main.ts` never passes.
- **Public view.** Reply and event builders take a `PublicMatch` type that has no field for the secret, round seeds, the pending absorber or the pending state (FR-257, NFR-47(b)); a type-level test pins its keys.
- **One engine.** The core calls `playRoundWithSeed` at the phase-1 close and again at the application (FR-241, FR-243, FR-256); `absorptionCandidatesOf` and `livingFactions` validate predictions and give n and d (FR-262 to FR-264, FR-271, FR-272).

## 3. Package layout (spec notes, P13)
```
packages/sim/src/                        (M1)
  inputs.ts (edit)      + checkState(map, state), checkFaction(map, faction)        FR-313
  types.ts (edit)       + SimError kinds 'invalid-state', 'invalid-faction'        FR-313
  exports.ts (new)      playRoundWithSeed, absorptionCandidatesOf, livingFactions FR-313
  index.ts (edit)       re-exports the three functions                              FR-313, NFR-55
packages/protocol/                       (M2a) pure; depends on @mbrg/shared, @mbrg/sim (types only)
  src/{index,errors,timing,wire,read,canonical,cursor}.ts
apps/server/                             (skeleton M1; core M2a; store M2b; http M3)
  package.json, tsconfig.json, tsconfig.test.json
  src/secret.ts         newSecret(random), commitment(secret), roundSeed(secret, k)  FR-252   (M1)
  src/warnings.ts       installWarningFilter(): drops only the node:sqlite ExperimentalWarning (M1, D7)
  src/main.ts           production entry: settings from the environment, filter, dynamic store import
  src/server.ts         createServer(options) (clock, random, store, settings, test-only seed source)
  src/core/*.ts         pure decisions (M2a, M4)
  src/store/*.ts        SQLite adapter, schema, transactions, lock (M2b)
  src/http/*.ts         router, auth, limits, cors, sse (M3a, M3b)
  test/                 unit, integration, goldens (test/golden/*.json), platform checks
  scripts/load.ts       NFR-49 procedure (M3b)
apps/web/src/           live client (M5): core/live-*.ts (pure), ui/live-*.ts, strings additions
```
The root Vitest `include` already covers `packages/*/test` and `apps/*/test`. The root `typecheck` script gains `tsc -p apps/server/tsconfig.json && tsc -p apps/server/tsconfig.test.json` (M1) and the protocol pair (M2a).

## 4. Data model (M2b; listed now so M1 golden data match it)
All instants are INTEGER milliseconds (spec Definitions). One SQLite file; `PRAGMA user_version` holds the schema version (FR-291).
| Table | Columns (key first) | Spec |
|---|---|---|
| `meta` | `schema_version` | FR-291 |
| `matches` | `id`, `map_id`, `map_digest`, `secret` (32 bytes, plain, D14), `commitment`, `timing` (`manual` or I, L1, L2 seconds), `created_ms`, `stage`, `n`, `t`, `t0_ms`, `c1_ms`, `c2_ms`, `a_ms`, `last_step_ms`, `victim`, `reveal_ms`, `halt_reason`, `winner`, `host_token_digest` | FR-231, FR-293 |
| `states` | (`match_id`, `round`), `owners_json`, `state_digest` | FR-281(c) |
| `records` | (`match_id`, `round`), `eliminated`, `absorber`, `transferred_json` | FR-281(c), (d) |
| `steps` | (`match_id`, `round`, `kind`), `instant_ms`, `cause`, `first_seq`, `last_seq` | FR-240, FR-293 |
| `predictions` | (`match_id`, `player_id`, `kind`, `round` (0 for winner)), `choice`, `version`, `stored_ms`, `winner_candidates` | FR-267 |
| `results` | (`match_id`, `round`, `kind`, `player_id`), `choice`, `correct`, `points` | FR-271 to FR-273 |
| `events` | (`match_id`, `seq`), `type`, `payload_json` | FR-289 |
| `memo` | (`scope`, `request_id`), `content_digest`, `reply_json`, `created_ms` | FR-282, FR-238 |
The absorber and the pending state are never written before the application (FR-256); a storage check test reads every table after each step (NFR-47(d)).

## 5. Secret, commitment and round seeds (FR-252, D5) — fixed once
Published verification rule; it never changes for stored matches. A change would need a new rule name and a spec change.
- **Secret**: 32 bytes from the injected random source (production: `crypto.getRandomValues` of the platform). Published at the end as 64 lowercase hexadecimal characters.
- **Commitment**: SHA-256 of the 32 raw secret bytes, as 64 lowercase hexadecimal characters.
- **Message for round k** (k a whole number from 1 to 2^31 − 1): the ASCII bytes of `mbrg/round-seed/v1/` followed by k in decimal without sign or leading zeros (for example `mbrg/round-seed/v1/1`).
- **Round seed**: `s_k` = the first 4 bytes of HMAC-SHA-256(key = the 32 raw secret bytes, message) read as an unsigned 32-bit big-endian integer.
- Verification (published with the secret, FR-259): recompute the commitment, every `s_k`, then `playRoundWithSeed` from `getState(map, 0, 0)`.
- Test vectors (pinned in T7): secret = bytes 0x00..0x1f; k = 1, 2, 3, 4, 70 and 2^31 − 1; each value computed twice, with `node:crypto` `createHmac` and with the platform's Web Crypto `subtle.sign` in Node, which must agree; plus RFC 4231 test case 2 through the same helper to prove the HMAC primitive.

## 6. The sim exports (FR-313, D6, D21) — M1
- `checkState(map, state)` (internal): `state` is an own-property object with exactly `mode`, `round`, `owners`; `mode === 'classic'`; `round` a whole number 0..T (`-0` as 0); `owners` an array with one `[territoryId, factionId]` pair per land territory of the map, in map order, each pair an own-property array of length 2, each faction a faction of the map. Any failure gives one `invalid-state` error (no detail, like `invalid-seed`).
- `playRoundWithSeed(map, state, roundSeed)`: errors together in this order: map validation errors, `invalid-state`, `invalid-seed`; then `round-out-of-range { round: state.round + 1, total: T }` if `state.round === T` or fewer than 2 living factions; then the internal `playRound` on a normalised copy (input never mutated), which returns `isolated-faction` as today.
- `absorptionCandidatesOf(map, state, faction)`: map validation errors, `invalid-state`, `invalid-faction` (not a whole number, or not a faction id of the map); a map faction with no territory gives `ok([])` (the internal function is not called, since it throws); otherwise the internal result's `factions` only.
- `livingFactions(map, state)`: map validation errors, `invalid-state`; otherwise the internal `livingFactions(state)`.
- Equivalence (FR-312): for every map of the existing golden fixtures and the dev map, seeds 0 to 999, chaining `playRoundWithSeed` with a constant seed from `getState(map, 0, 0)` gives exactly `getState` and `getRounds` at every round 0..T.
- Cost: validating the map on every call is the 001 style; the server calls these a few times per step, so no cache is added (a cache would be a later, measured change).

## 7. Running the server from TypeScript sources (D7 open check) — M1
| Option | Works with today's sources? | New dependency? | Verdict |
|---|---|---|---|
| Built-in type stripping (Node 24) | No: relative imports without `.ts` extensions fail to resolve; would rewrite every import of sim and shared (U5) | None | Rejected |
| TypeScript compiler emit | No: emitted ESM keeps extensionless imports, which plain Node does not resolve (`moduleResolution: bundler`) | None | Rejected |
| `tsx` (already pinned for `tools/build-map`) | Yes: resolves extensionless imports and workspace `exports` pointing to `.ts` | Reuse in a new workspace (U2, approved) | **Chosen (U2, U5)** |
| Vite bundle to one `.js` file, run by `node` | Yes | Reuse of `apps/web`'s Vite | Discarded (U2) |
T6 proves the chosen runner: a child process starts `apps/server/src/main.ts --check`, which imports `@mbrg/sim`, `@mbrg/shared` and `node:sqlite`, opens an in-memory database and exits 0.

## 8. D7 checks: `node:sqlite` and the experimental warning — M1
- T5 (in-process, Vitest on the installed Node): `import('node:sqlite')` with no flag; `new DatabaseSync(':memory:')` and a file database under the OS temporary directory; a transaction commits and a failed one rolls back; with `PRAGMA locking_mode = EXCLUSIVE` and a write, a second connection to the same file fails (busy/locked). Records `process.version` and the module's stability label (from the Node documentation of that version, written into section 13).
- T6 (child processes, `process.execPath` with the chosen runner): import `node:sqlite` without the filter and record whether stderr contains an `ExperimentalWarning` about SQLite; with `installWarningFilter()` installed **before** the dynamic import, stderr has no SQLite warning, while a planted `process.emitWarning('planted', 'TestWarning')` is still printed (only that one warning is filtered, spec D7).
- If any check fails: stop and return to the user (raising the Node minimum is the user's call, U3; spec fallback). No third-party SQLite library without approval.

## 9. Test strategy (whole spec)
- **Vitest only** (constitution 4); no mocking or event-source library (NFR-52).
- **Unit (pure)**: sim exports (M1); secret derivation (M1); protocol readers, timing rules, error order, canonical forms (M2a); core decisions with a **fake clock** (`now`, `advance(ms)`, `set(ms)` including backwards) and a **fake random source** (seeded bytes) (M2a); scoring and ranking (M4); live viewer core (M5).
- **Integration**: the server in-process via `createServer` with the fake clock, **in-memory SQLite** (`:memory:`), the test-only round-seed source; HTTP on port 0 with the platform `fetch`; event streams read by a hand-written reader over the `fetch` body (M3); one file-database restart test and the kill test of NFR-57 (an adapter wrapper that aborts before transaction n, then a reopen) (M2b).
- **Goldens**: `apps/server/test/golden/*.json` for fixed secrets on the dev map: round seeds, victims, records, state digests, map digest of `maps/dev` (M1), lifecycle and step rows (M2b), results and leaderboard (M4). `packages/sim/test/golden` is never touched.
- **Anti-spoiler** (NFR-47): (a) twin matches with equal public data and different futures via the test-only seed source (M2b, M3); (b) public-view type keys (M2a); (c) planted secret scan in decimal, hex, base64, base64url, raw bytes over replies, events, logs (M3a); (d) storage check (M2b); (e) absorber uniformity (M1); (f) `main.ts` offers no seed-source option (M2b).
- **Traceability**: section 11.
- **Mutation proofs** per task (stated in `tasks.md`), with the full `npm test`.

## 10. Performance procedure NFR-49 (M3b)
`apps/server/scripts/load.ts`, run alone on the reference PC (spec NFR-49 setup): start the server with raised limits (FR-299(f)) and a file database; create 10 matches with clock timing (I = 120, L1 = 30, L2 = 10); open 1,000 event streams (100 per match) with the hand-written reader; after 10 s warm-up, send 100 submissions per second for 60 s from 1,000 player ids through one client credential; record the 95th percentile reply time, and for every step the delay from its instant to the last stream's receipt; then stop, start again with 100 stored matches and record the time to ready. Figures go into the PR and section 13; a failure stops for an exact fix or a spec change.

## 11. Traceability across milestones
- M1 T1 extends the ranges to `FR [[1, 315]]`, `NFR [[1, 57]]` (372 ids, 370 expected), asserts `FR-316` and `NFR-58` are not ids, and adds a pinned `PENDING_008` literal list of the 96 ids of this spec; the "every expected id appears in a test name" test checks `expected` minus `PENDING_008`; a second test asserts that **no pending id is already traced**, so each task removes the ids it traces in the same commit.
- An id leaves the pending set when it is first traced, even if a later milestone completes it. The ledger below records the partial ids until their last milestone; each milestone's PR lists the ledger.
| Id | Parts and milestones |
|---|---|
| NFR-47 | (e) M1; (b) M2a; (f) M2b (done); (a), (d) M2b' T5' (done); (c) M3a |
| NFR-48 | seeds and records M1; core timelines M2a; lifecycle goldens M2b' T4' (done); results M4 |
| NFR-50 | fake-clock logic M2a; real-clock measurement M2b' T3' (done: recorded in section 13, not in CI) |
| NFR-51 | sim scans M1; server core M2a |
| NFR-52 | store and lifecycle M2b (done); network M3 |
| NFR-53 | manifest test M1; rechecked in every milestone |
| NFR-54 | store (memo keys by digest, no credential text in the database) M2b (done); logs M3a |
| NFR-55 | export lists and traceability M1; every milestone |
| NFR-57 | kill and restart M2b' T6' (done: states, records, step rows, events, predictions, memo; results stored empty); results part (results and leaderboard after a kill) still open, M4 |
| FR-241, FR-243, FR-246 | storage M2b (done); scoring parts M4 |
| FR-251 | halting M2b' T2'; scoring part M4 |
| FR-238 | memo storage, retention and purge at tick M2b (done); purge timer M2b' T3' |
| FR-239, FR-244, FR-248 | pure rules M2a; shell step (advance, tick) M2b; timer loop, start-up detection and the 3 s retry M2b' T3' |
| FR-249 | pure rule M2a; across restarts M2b' T4' |
| FR-250, FR-251, FR-294 | M2b' (T2', T4') (done; FR-251 (c) scoring M4; the map check is not run for submissions, which perform no step) |
| FR-255, FR-256 | pure core M2a; storage check M2b' T5'; log scan NFR-47 (c) M3a |
| FR-259, FR-260 | commitment at creation, secret revealed in the `match-finished` event and the finished public data M2b (done); HTTP reply M3a. FR-259 "secret never revealed when halted": service-level test M2b' T2'. FR-260 and NFR-47 (f) were asserted against `createMatchService` and a `main.ts` that has no listener: **re-assert when M3a adds `createServer` and the listener** |
| FR-315 | storage and recovery data M2b (done); "restart after every step" M2b' T4' (NFR-48 lifecycle) |
| FR-245, FR-266 | decisions and storage M2b (done); `match-halted` on a halted match (FR-245) and `match-halted` to a submission (FR-266) through the service: M2b' T2' (no service-level test yet) |
| FR-243 (halt with victim-mismatch), FR-241, FR-243 (map check before the step) | halting and map check through the service: M2b' T2' (FR-250 and FR-251 already carry it) |
| FR-270, FR-281, FR-282, FR-288, FR-289, FR-290, FR-301, FR-302 | core or storage M2a/M2b (FR-270 storage, FR-282 stored replies and the advance memo, FR-288 data, FR-289 data and numbering by the store, FR-290 publication after commit done in M2b); HTTP or stream M3a/M3b |
| FR-292 | durability settings M2b (done); `unavailable` and the 3 s retry M2b' T3' (done); `unavailable` over HTTP M3a |
| FR-293 | storage of the recovery data M2b (done); use of it at restart M2b' T4' (done) |
| FR-300 | digests M2b (done); constant-time comparison and header reading M3a |
| FR-283, FR-284, FR-286 | M3a (credential reading, namespaces); FR-287 M3b; results parts M4 |
| FR-240, FR-295 | pure decision M2a; storage transaction and per-match serialisation M2b (done) |
| FR-262 to FR-267, FR-269 | decisions M2a; storage and the empty-phase rule M2b (done); replies over HTTP M3a; results filled M4 |
| FR-253, FR-254, FR-257, FR-258 | public view, encoder and core decisions M2a; replies over HTTP M3a, events M3b |
- **M2a target**: 32 more ids move to `DONE_008` (section 16); after M2a `DONE_008` holds 40 and `PENDING_008` 56 ids.
- **M2b target** (section 17.3): M2b moves 23 ids (`DONE_008` 63 / `PENDING_008` 33), M2b' moves 4 (67 / 29).
- **M3a target** (section 18.10): M3a moves 9 ids (FR-279, FR-280, FR-281, FR-283, FR-284, FR-285, FR-286, FR-298, FR-299): `DONE_008` 76, `PENDING_008` 20 (FR-271 to FR-278, FR-287, FR-303 to FR-311, NFR-49, NFR-56).
- **M2a closing state** (T10): `DONE_008` holds 40 ids and `PENDING_008` 56 (asserted explicitly in `traceability.test.ts`). Closed in M2a (32): FR-233, FR-234, FR-237, FR-239, FR-240 (decision part), FR-244, FR-247, FR-248, FR-249, FR-253, FR-254, FR-255, FR-256, FR-257, FR-258, FR-261 to FR-269, FR-282 (content part), FR-295, FR-296, FR-297, FR-301 (kinds and order), FR-302 (reported time), FR-314, NFR-50. Partial, still to complete (every part still open, by milestone): FR-240 and FR-295 (storage transaction and per-match serialisation, M2b); FR-249 "also across restarts" (store, M2b; only the pure rule is proven); FR-255 and FR-256 "not store, cache or log" (checked only in the pure core; storage check NFR-47 (d) M2b, log scan NFR-47 (c) M3a); FR-267 persistence of the prediction row (M2b); FR-269 "empty result for that phase" (results stored M2b, filled M4); FR-239, FR-244, FR-247, FR-248 timer loop, authorisation, start-up detection, storage-failure retry and the 3 s retry (shell: M2b/M3a); FR-237 creation reply and the too-few-factions reply over the wire (M3a); FR-262 to FR-266 complete at the decision level only (replies M3a, storage M2b); FR-253, FR-254, FR-257, FR-258 (replies over HTTP M3a, events M3b); FR-282 (transport M3a; letter (a) is only the key encoding); FR-301 and FR-302 (HTTP M3a; `map-validation` is a stand-in kind, the wire kind for 001 validation errors is left to M3a); NFR-47 (b) done only by structure (events are built from CoreMatch plus the engine result in `steps.ts`, not from PublicMatch; equivalent, not literally "event builders take only the public view type"), (a), (d), (f) M2b, (c) M3a; NFR-48 core timelines done (the publicDigest, recordDigest and event-type lists in `core-timelines.json` are code-generated regression pins, not independent; rows, anchors and stage are hand-derived), lifecycle M2b, results M4; NFR-50 only the fake-clock logic part, "by measurement (real clock)" not done (M2b/M3a); NFR-51 protocol and server core done; NFR-53 and NFR-55 rechecked every milestone. FR-248 letters a to c and the cutoff clause are traced by T7/T8 titles. No id was left untraced: FR-283/FR-284 (M3) appear in no M2a title.
- **M2b closing state** (T8): `DONE_008` holds 63 ids and `PENDING_008` 33 (asserted explicitly in `traceability.test.ts`, which also pins the 23 ids M2b closed). Closed in M2b (23): FR-231, FR-232, FR-235, FR-236, FR-238, FR-241, FR-242, FR-243, FR-245, FR-246, FR-259, FR-260, FR-270 (storage), FR-288 (data), FR-289 (data), FR-290, FR-291, FR-292 (durability settings), FR-293, FR-300 (digests), FR-315, NFR-52 (store and lifecycle), NFR-54 (store). Partial, every part still open by milestone: FR-238 purge timer, FR-239/FR-244/FR-248 timer loop, start-up detection and the 3 s retry (M2b' T3'); FR-249 across restarts (M2b' T4'); FR-250 and FR-251 (halting, map-digest check) M2b' T2'; FR-294 M2b' T4'; FR-255 and FR-256 storage check (M2b' T5'), log scan NFR-47 (c) (M3a); NFR-47 (a), (d) M2b' T5', (c) M3a; NFR-48 lifecycle goldens M2b' T4', results M4; NFR-50 real-clock measurement M2b' T3'; NFR-57 durability M2b' T6'; FR-292 (unavailable, retry) M2b' T3'; FR-293 use at restart M2b' T4'; FR-300 constant-time comparison and header reading M3a; FR-283, FR-284 credential reading and namespaces M3a; FR-282 transport and FR-286 M3a; FR-287 and the stream parts of FR-288, FR-289, FR-290 M3b; FR-270 read over HTTP and FR-237/FR-259 replies M3a; NFR-54 logs M3a; NFR-52 network M3; scoring parts of FR-241, FR-243, FR-246 and results parts M4. No M2b title names FR-283 or FR-284.
- **M2b' closing state** (T7'): `DONE_008` holds 67 ids and `PENDING_008` 29 (asserted explicitly in `traceability.test.ts`, whose closing-state test pins the 23 M2b ids and the 4 M2b' ids as done and the 29 M3a to M5 ids, as a literal list, as pending). Closed in M2b' (4): FR-250, FR-251 (halting; scoring part (c) M4), FR-294, NFR-57 (M2b part: states, records, step rows, events, predictions, memo). Parts completed in M2b' (ids already done): FR-238 purge timer, FR-239 / FR-244 / FR-248 timer loop, start-up detection and the 3 s retry, FR-249 across restarts, FR-255 / FR-256 storage check, FR-292 (unavailable, retry), FR-293 use at restart, FR-315 restart after every step, FR-245 / FR-266 / FR-259 / FR-243 / FR-241 through the service with a halted match, NFR-47 (a), (d), NFR-48 (lifecycle), NFR-50 (real clock, measured). **Every part still open, with the milestone that completes it**: NFR-57 results part and NFR-48 results (M4); NFR-47 (c) log scan, with the log parts of FR-255 / FR-256 (M3a); FR-283, FR-284, FR-285, FR-286 credential reading, namespaces and the constant-time comparison of FR-300 (M3a); FR-287 and the stream parts of FR-288, FR-289, FR-290 (M3b); FR-292 transport and the HTTP parts of FR-237, FR-253, FR-254, FR-257, FR-258, FR-259, FR-262 to FR-267, FR-270 (read), FR-281 (non-result), FR-282 (transport), FR-301, FR-302 (M3a; events M3b); NFR-52 network (M3), NFR-54 logs (M3a); FR-260 and NFR-47 (f) re-asserted against `createServer` and the listener (M3a); `main.ts` does not call `start()` yet (wired with the listener in M3a); programming errors in clock steps are retried every 3 s and reported as `error`, but the service has no log (M3a logs them); scoring parts of FR-241, FR-243, FR-246, FR-251 (c) and the results of FR-269 (M4). Not decided: a running clock match with a NULL anchor (corruption only) never steps; halting it would need a spec decision. Not covered by tests: a kill during the recovery of `start()` itself, and a kill after `COMMIT` but before publication (needs the M3b event replay); the FR-250 map check is not done for submissions (they perform no step). No M2b' title names FR-283 or FR-284. The B1 fix of the M2b' review (a failed enumeration at `start()` is retried) completes the FR-294 / FR-292 (retry) parts already counted; the ledger stays 67 / 29. **Follow-ups recommended by the M2b' reviewer, still open for M3a**: log the original cause of native SQLite errors (`StoreError` keeps no `cause`) or narrow the mapping to the busy / locked / I/O / full codes (today every `ERR_SQLITE_ERROR`, constraint violations included, maps to `store-failure`, so a programming error of that kind replies `unavailable` and a clock step retries it every 3 s, reported only as `unavailable`); the base64 scan of the database matches only an aligned, complete encoding of a secret (a known limitation).
- **M1 closing state**: the M1 ids FR-252, FR-312, FR-313, NFR-47, NFR-48, NFR-51, NFR-53, NFR-55 (8 ids) are in `DONE_008`; `PENDING_008` holds exactly 88 ids (96 - 8; the test asserts both numbers). Of these, NFR-47 is only partly covered (part (e), the absorber uniformity) and NFR-48 only for seeds and records (round-seed goldens): the other parts of NFR-47 ((a) to (d), (f)) and the lifecycle and results parts of NFR-48 are completed by the milestones of the ledger above, and their test titles must name the part they cover (for example `NFR-47 (b) ...`), because the id can no longer be reported missing. NFR-55 stays partial in every milestone.
- M5 removes the pending set (an empty list) and the spec goes to `implemented` after M5's acceptance.

## 12. Milestones (delivery)
| Milestone | Branch | Content | Ids | Depends on |
|---|---|---|---|---|
| **M1** | `feat/008-m1-secret-and-sim-exports` | Sim exports, export-list edits, `apps/server` skeleton, secret and round seeds, D7 checks, seed goldens, absorber uniformity, traceability with the pending set | FR-252, FR-312, FR-313; NFR-47(e), NFR-48 (seeds), NFR-51 (sim), NFR-53, NFR-55 | none |
| M2a | `feat/008-m2a-protocol-and-core` | Protocol package; pure core: timing rules, schedule and anchors, stage machine, late step, effective and reported time, advance decision, prediction validation and cutoffs, public view, error order, canonical forms | FR-233, FR-234, FR-237, FR-239, FR-240 (decision), FR-244, FR-247 to FR-249, FR-253 to FR-258, FR-261 to FR-269, FR-282 (content), FR-295 to FR-297, FR-301 (kinds), FR-302 (reported time), FR-314; NFR-47(b), NFR-50, NFR-51 | M1 |
| M2b | `feat/008-m2b-store-and-lifecycle` | SQLite store, transactions and lock, lifecycle service with the fake clock, creation, memo, events storage, steps and predictions through the service (section 17, split B1 approved 2026-10-22) | FR-231, FR-232, FR-235, FR-236, FR-238, FR-240 to FR-243, FR-245, FR-246, FR-259, FR-260, FR-270 (storage), FR-288, FR-289 (data), FR-290 to FR-293, FR-300 (digests), FR-315; NFR-47(f), NFR-52, NFR-54 (store) | M2a |
| M2b' | `feat/008-m2b2-halting-and-recovery` | Halting and map check, timer loop and 3 s retry, restart recovery, lifecycle goldens, storage anti-spoiler checks, kill-and-restart durability | FR-250, FR-251, FR-294; FR-249 (restarts), FR-292 (unavailable, retry); NFR-47(a), (d), NFR-48 (lifecycle), NFR-50 (real clock), NFR-57 | M2b |
| M3a | `feat/008-m3a-http-api` | HTTP commands and reads, credentials and namespaces, cross-origin, limits, paging, map files, entry point and shutdown (section 18); closes FR-279, FR-280, FR-281, FR-283, FR-284, FR-285, FR-286, FR-298, FR-299 | FR-257 (HTTP), FR-270 (read), FR-279, FR-280, FR-281 (non-result), FR-282 (transport), FR-283 to FR-286, FR-298 to FR-300, FR-301, FR-302 (HTTP); FR-260, NFR-47(c), (f), NFR-52, NFR-54 (logs) | M2b' |
| M3b | `feat/008-m3b-event-stream` | Server-Sent Events, replay, heartbeat, NFR-49 procedure | FR-287, FR-288, FR-289 (stream), FR-290 (stream); NFR-49 | M3a |
| M4 | `feat/008-m4-scoring-and-results` | Scoring, results, leaderboard reads | FR-271 to FR-278, FR-281(e) to (g), scoring parts of FR-241, FR-243, FR-246, FR-251(c); NFR-48 (results), NFR-57 (results) | M2b, M3a |
| M5 | `feat/008-m5-live-viewer` | Live viewer, address rules, map digest in the browser, web test client, production build check | FR-303 to FR-311; NFR-56 | M3b, M4 |

## 13. Recorded figures and checks
**M1 closing summary**: delivers the three sim exports with state/faction checks (FR-312, FR-313), the `apps/server` skeleton with the tsx runner and warning filter, the secret/commitment/round-seed derivation (FR-252), the D7 checks (NFR-53), the dev-map seed goldens, the absorber uniformity (NFR-47(e), worst 0.2227 pp) and the traceability pending set (NFR-55). Earlier tests edited (only as the plan allows): `packages/sim/test/{candidates,match,traceability}.test.ts`, `packages/shared/test/no-regression.test.ts`, `apps/web/test/{shaped-deps,labels-render}.test.ts` (lockfile-entry pins now ignore `apps/server`). Lockfile diff = the workspace entry and link only. New dependencies: `tsx` 4.23.15 and `@types/node` 24.19.2, dev dependencies of `apps/server` (approved U2). Node `v24.0.0` (local), `node:sqlite` prints an `ExperimentalWarning` (filtered by the server). **Version dependence (noted after the merge, PR #28, 061119b):** CI runs Node `v24.21.0`, which no longer prints that warning; the M1 runner test was made version tolerant (it records whether the warning appears and checks the filter only drops that one). The filter stays harmless where the warning is absent. Map digest of `maps/dev`: `4d1698a310b46a6507fd128dad87f20873065d44a71b2ee5a78c062eb5c1e679`.

**M2a closing summary** (branch `feat/008-m2a-protocol-and-core`, 11 commits over `rewrite`): delivers `packages/protocol` (error order, ids, timing reader, command readers, wire types, `encodePublicMatch`, canonical forms) and the pure core in `apps/server/src/core` (time and anchors, stage machine and steps, creation checks, advance decision with late-step catch-up, prediction decision with cutoffs, reads, memo decision), `clock.ts` (the only clock reader) and `seeds.ts` (PD6 adapter), plus the fake clock/random and core driver helpers and six hand-derived core timeline goldens. Figures: 52 files, +7413/-27 lines (`git diff --shortstat rewrite`) of which protocol src 797, server src about 770, `core-timelines.json` 2448; the rest are tests and docs. Full `npm test`: 132 files, 2418 passed, 2 skipped, 72.0 s (`CI=1`: 68.6 s); `npm run typecheck` 3.5 s. Process checks: `git diff --exit-code rewrite -- packages/shared/src packages/sim/src packages/sim/test/golden maps/dev apps/server/test/golden/dev-secrets.json` clean; `git diff --stat rewrite` lists only planned files (protocol new, server core/tests/helpers/golden, root `typecheck` entry, lockfile workspace lines only, traceability test, specs); purity scans (no clock, random, `node:*`, process or I/O in `packages/protocol/src` or `apps/server/src/core`) green; `npm ci --dry-run` ok. New dependencies: none (the protocol manifest has only `@mbrg/shared` and `@mbrg/sim`; lockfile gained `packages/protocol`, its link and the `@mbrg/protocol` line of `apps/server`). **A1** (approved): `apps/web/test/{shaped-deps,labels-render}.test.ts` lockfile filters now ignore every spec 008 workspace entry and link (`SPEC_008_ENTRY`), same meaning, no later edit needed. **Defect found by the T9 goldens:** FR-244 keeps C1 after a manual phase-1 close and C2 after a manual phase-2 close, so an early manual advance leaves anchors out of order and `encodePublicMatch` (which required C1 <= C2 <= A) threw; fixed in `d10f188` by checking the order per stage; the spec and `anchorsAfterStep` are unchanged. **Node 24.21.0 in CI** prints no SQLite warning: the M1 runner test is version tolerant and no M2a test depends on the warning (checked by search).

**M2a hand-offs and decisions to confirm** (for the PR body and M2b):
- `createMatch` returns `lastSeq` 0 but `encodePublicMatch` requires `lastSeq >= 1`, and the core has no builder for the creation `schedule` event (FR-289 (c)): consider a `creationEvents` function in M2b.
- No match-finished or results events yet: M4 will insert results events in `steps.ts` and re-pin the goldens.
- `PredictionReply` lives in `apps/server/src/core`, not in `packages/protocol`.
- `StepMismatchReply` is a bespoke shape unlike `ErrorReply`, and `round-not-applied` carries N as `items: ['N']`: unify with the HTTP status mapping in M3a.
- `decideAdvance` returns `ok: false` plus an `outcome` to store when an advance halts the match, and `ok: true` / performed with a halted match when a chained L2 = 0 application halts: document both for the shell.
- The chained application row after a manual or late phase-2 close with L2 = 0 gets cause `clock` (pinned by tests, not stated by the spec): **confirmed by the user on 2026-10-22 (B3)**, no core change.
- `memoKey` embeds the raw credential (plaintext host token for advances conflicts with FR-300 and NFR-54): key by digest in M2b.
- The core cannot detect a map-digest mismatch (the shell passes `map: null` or an invalid map; untested at core level).
- The finished public view needs the secret hex from the shell.
- `packages/protocol/package.json` declares `@mbrg/shared` and `@mbrg/sim` but `src` imports neither. Kept in M2a on purpose; **the user decided on 2026-10-22 (B2) to drop both** in M2b T2 (nothing in `src` imports them): `packages/protocol/test/manifest.test.ts` pins exactly those two dependencies; dropping them is a change to that test and the lockfile entry, to decide in M2b if nothing needs them.
- In `locked`, `victim.a` is the stale reveal-time A while `schedule.a` is the shifted one (follows FR-288 "same fields"); spec 009 must be told.
- Optional tightening, not done: `encodePublicMatch` does not check `victim.c2`/`victim.a` against the schedule, `reportedTime >= victim.revealedAt`, or `lastSeq >= victim.seq`.

**M2b closing summary** (branch `feat/008-m2b-store-and-lifecycle`, 9 commits over `rewrite` before the closing one): delivers the SQLite store (`apps/server/src/store/{store,sqlite,schema,faults}.ts`, the only user of `node:sqlite`: WAL, `synchronous = FULL`, foreign keys, exclusive lock, `user_version` 1, atomic transactions, never-replaced records, rowid-ordered steps, contiguous event numbering, memo with digest scopes) and the lifecycle service (`apps/server/src/service/{matches,maps,ids,settings,scheduler}.ts`: creation in FR-301 order with memo, advance and clock ticks (one transaction per decision, publication after commit), predictions with memo replays, own predictions, finish and secret reveal), the `creationEvents` and digest-keyed `memoKey` core edits, `PredictionReply` in the protocol, and `main.ts` building the service from settings. Figures: 44 files, +5243/-195 lines (`git diff --shortstat rewrite`, after the ledger commit; this figure line itself shifts it by a few lines) of which store src 633, service src 741, `core-timelines.json` about 240 changed lines; the rest are tests and docs. Full `npm test`: 141 files, 2587 passed, 2 skipped, 70.6 s and 67.6 s (`CI=1`: 65.1 s), no flaky test seen; `npm run typecheck` 3.2 s. Process checks: `git diff --exit-code rewrite -- packages/shared/src packages/sim/src packages/sim/test/golden maps/dev apps/server/test/golden/dev-secrets.json` clean; `git diff --stat rewrite` lists only planned files; the only golden change is `core-timelines.json` (re-pinned in T2 as its own reviewed commit: every publicDigest changed because the creation event takes seq 1 and the view starts at lastSeq 1; verified by rebuilding the old digests with seq 1); scans: `node:sqlite` imported only in `store/sqlite.ts`, timers only in `service/scheduler.ts`, no logging in `service/*`, `core` and `protocol` never import the store or the service. New dependencies: none; `packages/protocol/package.json` lost its two unused dependencies (B2) and the lockfile changed only that entry; `npm ci --dry-run` ok. Earlier tests edited: `apps/server/test/{core-create,core-memo,core-predictions,core-steps,core-timeline-golden}.test.ts` and the core-driver/core-timelines helpers (creation event, memo key by digest, seq offset), `packages/protocol/test/manifest.test.ts` (no dependencies, B2) and `apps/server/test/platform-runner.test.ts` (M1 test: `main.ts` without settings now exits 1 naming the variables instead of exiting 0; the settings come from the environment, FR-260). **WAL result**: `journal_mode = wal` plus `locking_mode = EXCLUSIVE` works on Windows (Node `v24.0.0`; same process and a child process get `database-locked`, no DELETE fallback); the in-memory database reads `memory` (tests assert that, not `wal`); CI (Linux, Node `v24.21.0`) confirms on the PR. No test depends on the SQLite warning (absent on `v24.21.0`) or on a version-specific journal behaviour.

**M2b hand-offs and decisions to confirm** (for the PR body, M2b' and M3a):
- The service takes the credential as TEXT and the caller as `{ credential, namespace }`; reading the header, the namespaces and the constant-time comparison are M3a (FR-283, FR-284, FR-300). The command path texts are exported as `advancePath` / `submissionPath` (and the creation path) so that HTTP routing and the canonical content share one definition.
- `ownPredictions` reads one local id per call; a namespace-wide listing needs a new store operation (M3a).
- **Resolved by M2b' T3'**: a storage failure now replies `unavailable` (commands) or is retried 3 s later (clock steps). Original text: a storage failure currently throws; mapping it to `unavailable` is M2b' T3' (the fault seam exists in `store/faults.ts`).
- **Resolved by M2b' T3'** (`start()` / `close()`, the timer loop, the memo-purge timer and the retry exist; a failed enumeration at `start()` is retried since the B1 fix of the M2b' review). Original text: the service has no `start()` / `close()` yet (planned in 17.1). After every decision it already arms the scheduler for the next due instant of that match (FR-239, tested with the fake scheduler in T6) and `tick()` performs one due step per running match and purges the memos; M2b' T2'/T3' add the map check and the arming of every stored running match at start, the real timer loop, the memo-purge timer and the retry; no log is written anywhere in the service.
- The reported time sent so far is kept per match in memory (`sentMax`); M2b' T4' must rebuild it after a restart (FR-249 across restarts).
- The advance request-id memo was added in T7 (FR-282 covers advances); scope = presenting credential digest and match.
- Settings come from `MBRG_OPERATOR_CREDENTIAL`, `MBRG_MAPS`, `MBRG_MAX_RUNNING_MATCHES`, `MBRG_DATABASE`; `main.ts` prints `service ready; no listener yet`; `.gitignore` lists `*.sqlite*`.
- Decisions the plan did not fix (confirm in the PR): the memo of a creation stores the outcome JSON under the operator-credential digest; no random value is drawn for a refused creation; draws are separate (secret 32 bytes, id 12, token 32); `tick()` and `purgeMemos` are public service methods; `subscribe` listeners run after commit outside the transaction; the memo stores a content digest, so the service passes the digest as `content` to `decideMemo`; `credentialDigest` lives in `service/ids.ts`.

**M2b review hand-offs (added after the M2b review; for M2b' and M3a):**
- **Resolved by M2b' T3'** (every clock step is isolated per match and re-armed; store errors are classified by `isStorageFailure`). Original text: **no isolation between matches** (M2b' T3'): `tick()` and timer callbacks do not isolate matches. An exception in one `tickMatch` (storage failure, or the `RangeError` 'inconsistent stored data') aborts the loop for later matches, and a throwing scheduler callback is uncaught and not re-armed. T3' must isolate per match and classify store errors for `unavailable` (a programming `RangeError` and a storage failure are indistinguishable today).
- `getMatch` throws `store-failure` if the `victim-revealed` event is missing or `reveal_ms` / victim differ; this also blocks `tick` for every match (same isolation issue). Candidates and living exist only in that event, kept for the life of the match (FR-289).
- A NULL anchor column on a running clock match reads as anchors null and the match never steps (corruption only).
- Re-entrancy: `settle` publishes then arms with the stale view; a subscriber that advances inside its callback leaves a stale wake-up (self-heals). T3' should arm before publishing, or arm from the stored view.
- FR-282 (d) applied literally: too-many-matches and unknown-map replies are memoised 24 h under the creation scope, so a retry with the same request id after a slot frees replays `too-many-matches` (per spec; state it in the PR or raise it as a clarification).
- `submit` / `advance` memoise `unknown-match` for arbitrary ids: a storage growth vector until M3a rate limits. M3a should consider not memoising unknown ids.
- **Persisted format, FROZEN**: `advancePath`, `submissionPath` and the creation `/matches` are hashed into `memo.content_digest = sha256(ascii(canonicalBody(method, path, body)))`, hex, no prefix; bodies are validated as ASCII before hashing. Unifying `StepMismatchReply` in M3a changes the shape of replies in `reply_json` for at most 24 h.
- `sentMax` after a restart is not strictly required to rebuild (the effective instant is already >= the last step instant; the Definitions say "by this process"): T4' should say so and may take the maximum with the stored events' reported times. `sentMax` is never pruned (tiny leak per match).
- M3a hand-offs: `submit` throws `TypeError` for a bad identity or namespace (M3a must map it); `ownPredictions` takes one local id per call (a namespace-wide listing needs a store operation); `ownPredictions` and `publicMatch` load the full match including the owners JSON per call (measure in M3b NFR-49).
- `main.ts` builds the service and closes the store (placeholder): M2b' needs `start()` / `close()`, arming every stored running match and the purge timer.
- Linux, Node 24.21.0: the first Linux evidence of the WAL plus the exclusive lock is the PR CI run. Same-process lock semantics differ on Linux (POSIX locks) and only the in-process lock test exists; the child-process lock check was done by hand on Windows: consider adding a child-process lock test in T3' or T6'.
- Temp-dir cleanup in tests uses `rmSync` without `maxRetries`. **Resolved after the M2b' review**: `withTempDir` in `test/helpers/service-harness.ts` now passes `maxRetries: 5, retryDelay: 100`.
- **Optional, small** (not required): ignore `*.db` in `.gitignore` or document that `MBRG_DATABASE` must end in `.sqlite`; the 200 ms wait for a 30 ms timer in `service-steps` is a flake risk (use a larger margin); the store memo/purge test titles say FR-293 but concern FR-282 / FR-238; the planted-id test comment says 'M2a id' but uses FR-250.

**M2b' T3' figures and decisions:**
- **NFR-50 (real clock, measured)**: `apps/server/scripts/clock-accuracy.ts` (hand-run `node --import tsx scripts/clock-accuracy.ts` from `apps/server`, not in CI), system clock, real scheduler, in-memory database, dev map, I = 6, L1 = 2, L2 = 1, 10 rounds = 3 matches in sequence (the dev map has T = 4), 30 steps, 60 s. Windows, Node `v24.0.0`, run alone: run 1 worst 22 ms (median 13, p95 19, earliest 4), run 2 worst 18 ms (median 10, p95 18, earliest 3); no step early, none beyond 1,000 ms, every step cause `clock`. Target met (within 1,000 ms).
- Decisions not fixed by the plan: `Store.memoOldest()` (the purge timer is armed at oldest + 24 h + 1 ms, only after `start()`, so the M2b scheduler tests keep their pending lists); `InjectedFault` extends `StoreError` (`store-failure`) and the SQLite adapter maps native `ERR_SQLITE_ERROR` / closed-connection errors to `store-failure` or `database-locked` (a raw constraint failure is therefore `unavailable`); a failing clock step for a programming error is also isolated and retried every 3 s, reported as `error` in `TickReport.failed` (the service logs nothing: M3a should log it); `start()` returns `halted` for matches halted by its map check; `main.ts` still builds and closes the service (calling `start()` belongs with the listener, M3a); `scripts` added to `apps/server/tsconfig.json`; child-process lock test added (`FR-291 (child process)`, `test/fixtures/open-store.ts`).

**M2b' T4' decisions (restart recovery and lifecycle goldens):**
- **`sentMax` after a restart: a rebuild is not required by the spec** (the effective instant is already >= the stored last step instant, so step, reveal and application instants never decrease, and the Definitions bound the reported time only "by this process"). **Implemented anyway, as the cheap maximum with the stored events**: the first time a process computes the reported time of a match, `sentMax` starts from the largest `reportedTime` of the match's stored events (one read of its events per match and process, in `timesOf`; `remember` after the commit never reads the store). So the reported time of events and of replies never falls below any stored reported time across a restart (tested with the clock set back one hour); a reported time that was only sent in a reply or a read and never stored may still be higher than the first one after a restart, as the Definitions allow. `sentMax` is still never pruned.
- A restart = close the service and the store, open a new store and a new service on the same file, `start()`. Lifecycle goldens: `golden/service-timelines.json` (six M2a scenarios through the service; match id, public data digests, event numbers and a digest of every stored event are generated pins, written only by the hand-run `golden/generate-service-timelines.ts`); the hand-derived rows, anchors and stages of `helpers/core-timelines.ts` and the core golden (rows, event types, anchors, stage, victim, record digest, effective and reported times) are checked independently; the one known difference is the shell's `match-finished` event after round T (the core has none). Every scenario equals the golden with an in-memory database, a file database, a restart after every action, and every tick performed by `start()` of a restarted server; with predictions, the restarted runs store the same predictions.
- Robustness pinned (not changed): a running clock match whose anchor column is NULL (corruption only) is read with no anchors, never steps and is not armed; `start()` does not throw and the other matches go on. Halting such a match would need a spec decision.

**M2b' T6' figures and decisions (durability, NFR-57 M2b part):**
- Script (`test/helpers/durability-script.ts`, shared with the child fixture): one dev-map clock match, 4 rounds, predictions with request ids (one replaced, one replayed, one without id; 24 submissions), 5 manual advances (operator and host token) and 7 clock-tick steps, a tick 25 h after the finish that purges the memo: 45 transactions. A kill before each of them (45 runs) and inside each after every write and before its commit (`abortWrite`, 136 runs), then a new store and service on the file, `start()`, the request in flight sent again. Windows, file alone: 7.0 s and 19.9 s (own timeouts 300 s / 600 s).
- Seam addition: `FaultPlan.abortWrite` (kind `abort-inside`): the connection is closed inside the transaction with no commit and no rollback statement. Each restarted service draws from a fresh fake random source with the same seed (a creation lost in a kill gets the same id and token).
- **Real kill (seam fidelity)**: `test/fixtures/kill-child.ts` runs the script in a child (`node --import tsx`), prints its stop point with a synchronous write and blocks (`Atomics.wait`); the parent kills that PID (`SIGKILL`, exit `null` / `SIGKILL` on Windows) between two decisions and inside the round-1 application transaction (after the match row, record and step row, before the events). In both cases the killed file equals byte for byte (raw dump) the file the seam leaves at the same point, and a new server recovers to the uninterrupted run. Result: the seam is faithful at both points.

**M2b' closing summary** (branch `feat/008-m2b2-halting-and-recovery`, 8 commits over `rewrite` before the closing one): delivers halting through the service (`service/maps.ts` `mapForStep`: the listed package is read, its digest compared with the stored one and validated before every step and at `start()`; `map-changed`, `victim-mismatch`; a halted match publishes `match-halted`, never reveals the secret, refuses submissions and advances, does not count as running), the timer loop (`start()` arms every stored running match after the map check and one overdue late step; `close()`; memo-purge timer; every clock step isolated per match and retried 3 s later; storage failures reply `unavailable`), restart recovery (a new store and service on the same file resume at the stored stage, round and anchors; `sentMax` from the stored events), the lifecycle goldens, the storage anti-spoiler checks (twins and database scans) and kill-and-restart durability (fault seam at 181 points plus a real child-process kill). Ids: 67 done / 29 pending (section 11, M2b' closing state). Figures: 32 files, +6251/-127 lines (`git diff --shortstat rewrite` before the closing commit, which adds the docs lines) of which store and service src +401/-88, `scripts/clock-accuracy.ts` 114, `service-timelines.json` 2854; the rest are tests, helpers, fixtures and docs. Full `npm test` on the user's PC with a game loading the CPU (about 55 to 76 %): before the timeout commit 124.4 s with 2 load timeouts ('NFR-47 the bulk draw', 'FR-218 FR-228 the sums of every dev-map label'); after it 109.6 s with 1 load timeout ('FR-174 the labels of rounds 0..4 ... white with a black halo', `apps/web/test/label-input.test.ts`, not in the timeout commit) and 132.3 s green; `CI=1 npm test` 112.2 s green: 149 files, 2688 passed, 2 skipped; `npm run typecheck` 4.8 s. CI (Linux, no load) passed every earlier unmutated run.
- **Process checks**: `git diff --exit-code rewrite -- packages/shared/src packages/sim/src packages/sim/test/golden maps/dev apps/server/test/golden/dev-secrets.json apps/server/test/golden/core-timelines.json` clean (no golden re-pinned); `git diff --stat rewrite` lists only planned files; new goldens: `apps/server/test/golden/service-timelines.json` and its hand-run generator `golden/generate-service-timelines.ts`; scans: `node:sqlite` only under `src/store` (`sqlite.ts`), timers only in `service/scheduler.ts`, no logging in `service`, `store` or `core` (only the entry point `main.ts` prints), no production module imports `store/faults.ts`; no third-party dependency: every `package.json` and the lockfile are unchanged; `npm ci --dry-run` ok.
- **NFR-50 (real clock)**: worst 22 ms / 18 ms, median 13 / 10 ms, 30 steps in 60 s, Windows, Node `v24.0.0` (details under T3' below); the Linux CI figure was not measured (the script is not in CI).
- **Kill fidelity (T6')**: a real `SIGKILL` of a child running the service, between two decisions and inside the round-1 application, leaves the file byte for byte equal (raw dump) to the one the `abortWrite` seam leaves at the same point, and recovery equals the uninterrupted run: the seam is faithful at both points.
- **Earlier tests edited in M2b'**: `apps/server/test/{service-seam,service-create}.test.ts` (T3': service key lists gain `start` / `close`; the FR-231 injected-fault creation now replies `unavailable`); `apps/server/test/helpers/db-scan.ts` extended (T5': `dumpRows`, `encodingsOf`, `storedFutureViolations`); `packages/sim/test/traceability.test.ts` (bookkeeping). **Timeout commit** (`test: give the slow tests an explicit timeout`, for the user's confirmation): a test-level `{ timeout: 60_000 }` only, no assertion or logic change, on `apps/web/test/label-centre.test.ts` ('FR-218 FR-228 the sums of every dev-map label ...', 'FR-228 dyadic ...'), `apps/server/test/absorber-uniformity.test.ts` ('NFR-47 the bulk draw ...'), `apps/web/test/centred-figures.test.ts` ('NFR-46 Francia at round 4 (n 1,165,291 ...'), `apps/web/test/label-shape.test.ts` ('NFR-38 the squared distance to the nearest non-set unit centre ...'), `apps/server/test/service-db-secrecy.test.ts` ('NFR-47 (d) FR-255 (storage) FR-256 (storage) a full match and a halted one ...'). Reason: load-induced flakiness at the 5 s default on the user's PC; alone they take 0.9 to 4.1 s. Also near the limit under load but not edited: 'FR-174 the labels of rounds 0..4 ...' (`label-input.test.ts`, timed out once at 5.2 s) and 'FR-218 FR-228 the box row interval ...' (`label-centre.test.ts`, 4.9 s).
- **Decisions the plan did not fix (confirm in the PR)**: the SQLite adapter maps native `ERR_SQLITE_ERROR` and closed-connection errors to `store-failure` / `database-locked`, so a raw constraint failure replies `unavailable`; `Store.memoOldest()` (the purge timer is armed at oldest + 24 h + 1 ms, only after `start()`); `sentMax` rebuilt from the stored events' reported times (not required by the spec); the fault seam gained `failTransaction` lists, `failWrite` and `abortWrite` (connection closed inside the transaction, no commit, no rollback); the storage scans add the rule "winner only when finished, halt reason only when halted"; `mapForStep` also validates the package in the shell; `scripts/clock-accuracy.ts` is type-checked through `scripts` in `apps/server/tsconfig.json`; shared helper `test/helpers/durability-script.ts` and fixtures `test/fixtures/{kill-child,open-store}.ts` not in the file lists; the earlier tests edited above.
- **Open points for M3a**: detail its tasks first (planner); wire `start()` with the listener in `main.ts`; log the programming errors of clock steps (now retried every 3 s and reported as `error` only); map `unavailable` and the other kinds to HTTP; credential reading, namespaces and the constant-time comparison (FR-283 to FR-286, FR-300); NFR-47 (c) log scan; re-assert FR-260 and NFR-47 (f) against `createServer`; the M2b hand-offs above (`TypeError` of `submit`, `unknown-match` memo growth, namespace-wide `ownPredictions`, frozen `memo.content_digest`, `StepMismatchReply` unification). For M3b: a kill after `COMMIT` but before publication needs the event replay; for M4: NFR-57 and NFR-48 results parts. Not tested: a kill during the recovery of `start()` itself. NULL-anchor corruption: the match never steps (a halt needs a spec decision).
- **B1 of the M2b' review (blocker, fixed)**: `start()` turned a storage failure of its enumeration of the running matches (`store.runningMatchIds()`, a read outside any transaction) into an empty list, so one transient locked or I/O failure on that first read left every stored match unchecked, unstepped and unarmed, with nothing to retry it (FR-294, FR-292). Fix (`fix(server): retry the start check after a storage failure`): `start()` enumerates on its own; a storage failure there arms one retry of the WHOLE start check (memo purge, map check, late step, arming, purge timer) RETRY_MS (3 s) later through the scheduler, isolated like the other wake-ups and repeated until it succeeds, cancelled by `close()`; `StartReport` gains the optional `retry: { kind: 'unavailable', at }` (absent on success, so earlier reports are unchanged); a programming error of the enumeration is rethrown by `start()` (inside the retry callback nothing escapes and it is re-armed, like `stepSafely`). `tick()` keeps the empty list (its matches are already armed). The fault seam gained `FaultPlan.failRunningIds` (kind `read`). Tests: `service-restart.test.ts` 'FR-294 FR-292 (retry) a start whose enumeration ...' (two failed enumerations, then the map-changed match halts, the overdue one steps late at t + 6 s and is armed; `close()` cancels the retry; a planted `TypeError` is rethrown, nothing armed). Mutations proved with the full suite: enumeration swallowed to `[]` again, retry interval 3,001 ms. Also after the review: `withTempDir` removes with `maxRetries`; a separate commit `test: give one more slow test an explicit timeout` adds `{ timeout: 60_000 }` to 'FR-174 the labels of rounds 0..4 ...' (`label-input.test.ts`), for the user's confirmation; 'FR-218 FR-228 the box row interval ...' (`label-centre.test.ts`) was not edited: it already has a 120,000 ms timeout argument (since 14127e6), so it cannot time out at the 5 s default. Also seen once under load and passing alone (14.9 s for its file): 'FR-224 the territory layout takes no owners ...' (`label-centred-place.test.ts`), not edited. Note: blanket 60 s test timeouts could hide a roughly 10x slowdown of those tests; a single vitest `testTimeout` (about 15 s) would be less blanket (optional, not done).

(Filled during M1: Node version, `node:sqlite` stability label, experimental warning yes/no, runner check, test vectors, dev-map golden digests, absorber uniformity worst deviation. Later milestones add their figures.)

- **T5 (`node:sqlite`)**: Node `v24.0.0` (win32; CI: `v24.21.0`, no warning there, see above). `import('node:sqlite')` works with no flag. Stability label: 1.1 Active development (from the Node 24 documentation, not checked online here); a plain import prints `ExperimentalWarning: SQLite is an experimental feature and might change at any time` (warning present: yes). In-memory and file databases, commit, rollback and the `PRAGMA locking_mode = EXCLUSIVE` lock (second connection fails with locked/busy) all pass on Windows. `engines` (>=24) and `.nvmrc` (24) untouched (U3). Lockfile gained only the `apps/server` workspace entry and its link (`tsx` 4.23.15, `@types/node` 24.19.2 were already locked).
- **T6 (runner and warning filter)**: `tsx` 4.23.15 runs `apps/server/src/main.ts --check` from `apps/server` and from the repository root (`node --import tsx`; scripts `start` = `tsx src/main.ts`, `check` = `tsx src/main.ts --check`): imports `@mbrg/sim`, `@mbrg/shared` and `node:sqlite` through the workspace links, opens `:memory:`, prints `check ok`, exits 0. Without the filter stderr has the SQLite `ExperimentalWarning` (yes). `installWarningFilter()` wraps `process.emitWarning` and drops only name `ExperimentalWarning` + message matching /sqlite/i; with it installed first the SQLite warning is gone, a planted `TestWarning` and another `ExperimentalWarning` still print. Mutation (filter drops everything) fails the planted-warning test.
- **T7 (secret and round seeds)**: `apps/server/src/secret.ts` (imports only `node:crypto`). Vectors pinned in `apps/server/test/secret.test.ts`: 5 fixed secrets (ascending 0x00..0x1f, all 0x00, all 0xff, bytes (7i+3) mod 256, SHA-256 of a label) x k = 1, 2, 3, 4, 70, 255, 256, 65536, 2^31-1, each equal through `createHmac`, a pure-JS HMAC built on `createHash`, and (secret 0x00..0x1f, k in 1, 2, 3, 4, 70, 2^31-1) Web Crypto `subtle.sign`; RFC 4231 test case 2 passes through the helper. Secret 0x00..0x1f: commitment `630dcd2966c4336691125448bbb25b4ff412a49c732db2c8abc1b8581bd710dd`; s_1..s_4 = 3730603940, 4041377160, 3246583532, 361591214; s_70 = 330976203; s_(2^31-1) = 282600578. Mutations proved: little-endian read, message without `v1/`, key as hex text.
- **T8 (dev-map goldens, uniformity)**: `apps/server/test/golden/dev-secrets.json` pins 3 secrets (0x00..0x1f, 0x20..0x3f, 32 x 0xa5) x rounds 1..4 (dev map T = 4): seed, victim, absorber, transferred, state digest; produced by an independent script (createHmac, own sfc32 victim redraw, digests from the spec text; absorber and transfers from the sim). Map digest of maps/dev `4d1698a310b46a6507fd128dad87f20873065d44a71b2ee5a78c062eb5c1e679`. NFR-47(e): seeds 0..2^20-1, worst deviation 0.2227 pp (tolerance 2 pp), loop 447 ms (whole file about 3 s); bulk draw equals `playRoundWithSeed` on seeds 0..9999. Mutations: roundSeed ignoring k fails goldens + secret tests; biased pickIndex fails uniformity + goldens.

## 14. Risks
- **`node:sqlite` API movement** (experimental or release-candidate status): wrap it behind the storage interface (M2b) so a change touches one file; T5/T6 pin the behaviour on the installed version.
- **Windows file locking and temporary files**: tests use unique temporary paths and close every database in `finally`; the lock test runs on Windows and in CI (Linux).
- **Export-list tests in three places** (M1): forgetting one fails CI; T3 edits all three in one commit.
- **Byte-identical replies (FR-257)** need a fixed field order: wire builders write fields in a documented order, never by spreading objects (M2a).
- **Clock edge cases**: every instant is integer ms; the fake clock is the only clock in tests; real-clock tests (NFR-50) are measurements, not CI.
- **1,000 streams on Windows** (NFR-49): measure early in M3b; a failure is a spec change, not a silent lower target.
- **HMAC message format**: fixed in section 5 before any match exists; T7 pins test vectors so that an accidental change fails.
- **Statistical test runtime** (NFR-47(e)): 2^20 seeds through the full step on the dev map may take tens of seconds; T8 uses the engine's own draw functions for the bulk, proven equal to the step on a 10,000-seed prefix, and runs alone if slow.

## 15. Decisions of this plan (planner, with the discarded alternative)
- PD1. HMAC message `mbrg/round-seed/v1/<k>`, first 4 bytes big-endian (section 5). Discarded: including the match id (the secret is already unique per match).
- PD2. Sim wrappers in a new `exports.ts`, internal functions untouched (section 6). Discarded: editing `internal.ts` signatures (would change 001 tests).
- PD3. `tsx` as the runner (section 7; user decisions U2, U5). Discarded: type stripping, compiler emit, a Vite bundle.
- PD4. Pending-set traceability with "no pending id already traced" (section 11). Discarded: adding ranges per milestone (ids would be missing from the ranges while their tests exist).
- PD5. Golden data of the server in `apps/server/test/golden` (section 9). Discarded: `packages/sim/test/golden` (must stay byte-identical).
- PD6 (M2a). The core receives round seeds as a function `seedOf(k)` and never imports `secret.ts` (which imports `node:crypto`); a one-line shell adapter binds `seedOf = (k) => roundSeed(secret, k)`. Discarded: the core holding the secret bytes (a secret field in the core view would make FR-253 a convention instead of a type rule).
- PD7 (M2a). The core view type has **no absorber field and no pending-state field**; the phase-1 close returns only the victim, its candidates and the living factions, and drops the rest of the engine result before returning (FR-256 by construction). Discarded: returning the full engine result and filtering in the shell.
- PD8 (M2a). Canonical forms (state text, map-digest bytes, canonical body) live in `packages/protocol` as pure byte/text builders; hashing is done by the caller with the platform's crypto (server: `node:crypto`; viewer in M5: Web Crypto). No change to `packages/shared` (spec P32 placement; no "ask first" needed). Discarded: a pure-TypeScript SHA-256 in shared.

## 16. M2a detail (protocol package and pure match core)
Branch `feat/008-m2a-protocol-and-core` from `rewrite` at 061119b or later; one PR; tasks in `tasks.md`.
### 16.1 Files
```
packages/protocol/                         NEW workspace (covered by the root `packages/*` glob)
  package.json        name @mbrg/protocol, private, type module, exports ./src/index.ts,
                      dependencies @mbrg/shared, @mbrg/sim (workspace only; types and pure reads)
  tsconfig.json       extends the base, types []
  src/errors.ts       ERROR_ORDER (FR-301 list), ErrorKind, firstError, listsSeveral    FR-301
  src/ids.ts          local player id, request id, map id, namespace text rules       FR-297
  src/timing.ts       timing reader: shape -> invalid-request, rules (a)-(d) -> invalid-timing FR-233, FR-234
  src/read.ts         own-property readers of the command bodies (creation, advance,
                      submission), documented field order, first failing field        FR-296
  src/wire.ts         wire types: commands, replies, PublicMatch, events (payload types only)
  src/public.ts       encodePublicMatch: fixed field order, stage-dependent fields    FR-253, FR-254, FR-257
  src/canonical.ts    stateText, mapDigestBytes(files), canonicalBody(method, path, body) FR-282
  src/index.ts
  test/*.test.ts      unit tests, protocol purity scan                                 NFR-51 (protocol)
apps/server/src/core/                      PURE (no node:*, no clock, no randomness)
  time.ts             toMs, anchors(t0, timing), effectiveInstant, reportedTime, onTime/overdue FR-239, FR-249, FR-302, NFR-50
  view.ts             CoreMatch (no absorber, no pending state), stage, anchors, lastStepMs
  steps.ts            nextStep, closePhase1, closePhase2, apply, dueStep            FR-240, FR-247, FR-255, FR-256, FR-269
  advance.ts          decideAdvance (expected step), late steps, shifted anchors      FR-244, FR-248, FR-295
  predictions.ts      decideSubmission: stage, choice, cutoff, replace / no-op, version FR-261..FR-268
  reads.ts            readRound (round-not-applied), publicView(core) -> PublicMatch   FR-254, FR-258
  create.ts           creation checks: map T >= 1, timing                              FR-233, FR-237
  memo.ts             decideMemo: replay / request-id-reused / new, retention, memoisable kinds FR-282
apps/server/src/clock.ts                   systemClock (the only Date.now reader)    FR-314
apps/server/src/seeds.ts                   seedOf(secret) adapter over secret.ts      PD6
apps/server/test/helpers/{fake-clock.ts,fake-random.ts,core-driver.ts}
apps/server/test/golden/core-timelines.json
```
### 16.2 Core decision shape
`decideX(view: CoreMatch, input, now: number, deps: { seedOf(k): number }) -> { view: CoreMatch, steps: StepRow[], events: EventDraft[], reply: Reply }`, all plain JSON, no I/O. The shell (M2b) loads the view, calls the decision under the per-match serialisation, stores `view` + `steps` + `events` in one transaction (FR-240, FR-290), then publishes. M2a tests call the decisions directly through a small driver (`core-driver.ts`) that keeps the view in memory and advances a fake clock.
### 16.3 Earlier-test and manifest edits in M2a
- `apps/web/test/shaped-deps.test.ts` (line 43) and `apps/web/test/labels-render.test.ts` (line 53): their lockfile filters ignore `apps/server` and `node_modules/@mbrg/server` since M1; they must also ignore `packages/protocol` and `node_modules/@mbrg/protocol` (meaning unchanged: the viewer's lockfile view stays the spec 005/004 one). Needs the user's confirmation (tasks.md "Needs a user decision before T1").
- `apps/server/test/manifest.test.ts` (spec 008's own test): runtime dependencies become `@mbrg/protocol`, `@mbrg/shared`, `@mbrg/sim`; a new protocol manifest test pins no third-party dependency (NFR-53, already traced).
- Root `package.json`: `typecheck` gains `tsc -p packages/protocol/tsconfig.json` (protocol tests are already covered by the root `tsconfig.test.json` glob `packages/*/test`); `workspaces` unchanged (the `packages/*` glob covers it). Lockfile: only the `packages/protocol` entry, its link, and the new `@mbrg/protocol` dependency line of `apps/server`.
### 16.4 Ids
Traced and moved to `DONE_008` in M2a (32): FR-233, FR-234, FR-237, FR-239, FR-240, FR-244, FR-247, FR-248, FR-249, FR-253, FR-254, FR-255, FR-256, FR-257, FR-258, FR-261 to FR-269, FR-282, FR-295, FR-296, FR-297, FR-301, FR-302, FR-314, NFR-50. Partial parts also covered (already in `DONE_008`): NFR-47 (b), NFR-48 (lifecycle, core timelines), NFR-51 (protocol and server core), NFR-53 (protocol manifest), NFR-55. Test titles of partial ids name the part.
### 16.5 Risks of M2a
- **Size**: 10 tasks; T6 to T8 are the heaviest. If T6 or T7 overruns (more than one sitting), split the PR after T5 into M2a (protocol and time) and M2a' (stage machine, advances, predictions, memo, goldens), per D24's spirit; ids do not change.
- **Defect found by the T9 goldens (fixed in `fix(protocol): order schedule instants by stage`)**: FR-244 keeps C1 after a manual phase-1 close (C2 = t + L1) and C2 after a manual phase-2 close (A = t + L2), so an early manual advance leaves anchors out of order (C1 > C2, C2 > A) and `encodePublicMatch` (which required C1 <= C2 <= A) threw. Fix: the order is checked per stage (phase-1 all three, phase-2 C2 <= A, locked none); `anchorsAfterStep` and the spec are unchanged. Exposed by scenarios `mid-round-advances` and `backward-jump` of `core-timelines.json`.
- **Decision API drift before M2b**: the decision shape of section 16.2 is pinned by the driver tests; M2b only adds storage around it.
- **Victim recomputation cost**: the application recomputes the engine step (P26); one step on the dev map is well under 1 ms (M1 figures), so no cache.

## 17. M2b detail (store, lifecycle service, halting, recovery, durability)
Split (D24; approved by the user on 2026-10-22, B1 in `tasks.md`; B2 to B4 also approved: drop the protocol dependencies, cause `clock` confirmed, `PredictionReply` moved to the protocol in M2b with the other reply shapes left to M3a): **M2b** = store, creation, steps and predictions through the service (branch `feat/008-m2b-store-and-lifecycle`, 8 tasks); **M2b'** = halting, map check, timer and recovery, anti-spoiler and durability at the service level (branch `feat/008-m2b2-halting-and-recovery`, 7 tasks). Each has its own PR from `rewrite` (M2b' after M2b is merged). Ids do not change.
### 17.1 Files
```
packages/protocol/src/
  wire.ts (edit)          + PredictionReply (moved from apps/server/src/core/predictions.ts, B4)
apps/server/src/core/                       PURE (unchanged rules)
  create.ts (edit)        + creationEvents(view, reportedTime): the `schedule` event seq 1, view lastSeq 1   FR-289 (c)
  memo.ts (edit)          memoKey takes a credential DIGEST, never the credential text                       FR-300, NFR-54
apps/server/src/store/                      the only users of node:sqlite (FR-291)
  store.ts                Store interface: transaction(fn), match rows, states, records, steps, predictions,
                          events (eventsAfter), memo (get, put, purge), runningCount                         FR-291, FR-293
  sqlite.ts               openStore(path | ':memory:'): PRAGMAs, exclusive lock, schema v1, version check     FR-291, FR-292
  schema.ts               CREATE TABLE statements of section 4 (+ `matches.secret`, plain, D14)
  faults.ts               test seam: a Store wrapper that fails or aborts before transaction n (NFR-57)
apps/server/src/service/
  matches.ts              createMatchService({ store, clock, random, maps, settings, scheduler, testSeedSource? }):
                          create, advance, submit, ownPredictions, tick, start, close                         FR-231..FR-246, FR-290, FR-295
  maps.ts                 map list: id -> folder; reads the 3 files, mapDigestBytes + node:crypto SHA-256      FR-250
  ids.ts                  match id (12 bytes), host token (32 bytes), base64url; credential digests             FR-236, FR-300
  scheduler.ts            Scheduler interface (at(instant, fn), cancel); the real one uses timers; tests a
                          fake scheduler driven by the fake clock                                               FR-239, FR-292
  settings.ts             operator credential, map list, running-match limit (default 20), database path
apps/server/src/main.ts (edit)              builds the service from settings only (no test seed source)  FR-260, NFR-47 (f)
apps/server/test/helpers/{service-harness.ts,fake-scheduler.ts,db-scan.ts}
apps/server/test/golden/service-timelines.json
```
### 17.2 Store decisions (planner, M2b)
- PD9. One SQLite file per server; `PRAGMA journal_mode = WAL`, `synchronous = FULL`, `foreign_keys = ON`, `locking_mode = EXCLUSIVE` and an immediate write transaction at open to take the lock; a second process (or connection) gets `database-locked` and the server refuses to start (FR-291, FR-292 durability). `PRAGMA user_version` = 1; 0 means a new file (schema created in one transaction); any other value refuses to start. Discarded: `journal_mode = DELETE` (slower commits, same durability).
- PD10. Every decision runs synchronously inside one `BEGIN IMMEDIATE ... COMMIT` (node:sqlite is synchronous and the process single-threaded, so per-match serialisation, FR-295, holds by construction); events are published to in-process subscribers only after `COMMIT` returns (FR-290). Discarded: an async queue per match (no concurrency to manage).
- PD11. The absorber and the pending state are never written: they exist only inside `performStep` (PD7); `records` and `states` get a row only for applied rounds. Round seeds are never stored (recomputed from the plain secret, D14).
- PD12. Credential digests: `sha256("mbrg/credential/v1/" + text)` hex for host tokens (stored) and for memo scopes (operator credential, host token, client credential); no credential text is ever written; the creation-reply memo holds the plain host token for 24 h (D23) and is purged at the first tick after retention.
- PD13. A storage failure inside a decision rolls back, the reply is `unavailable`, and a failed clock step is retried by the scheduler 3 s later; when it is retried after its instant + 1 s it is overdue and follows FR-248 (late, anchors shifted).
### 17.3 Ids
M2b moves 23 ids to `DONE_008` (FR-231, FR-232, FR-235, FR-236, FR-238, FR-241, FR-242, FR-243, FR-245, FR-246, FR-259, FR-260, FR-270, FR-288, FR-289, FR-290, FR-291, FR-292, FR-293, FR-300, FR-315, NFR-52, NFR-54): `DONE_008` 63, `PENDING_008` 33. M2b' moves 4 (FR-250, FR-251, FR-294, NFR-57): `DONE_008` 67, `PENDING_008` 29. Partial parts completed: FR-240 and FR-295 (storage, serialisation), FR-249 (across restarts, M2b'), FR-255 and FR-256 (storage check, M2b'), FR-262 to FR-267 (storage), FR-269 (no result rows for an empty phase), FR-239, FR-244, FR-247, FR-248 (timer, authorisation, start-up and retry), NFR-47 (a), (d), (f), NFR-48 (lifecycle), NFR-50 (real-clock measurement, recorded, not in CI). Left for M3a/M3b/M4 as in section 11. **M2b closed (T8): 63 / 33 as planned; the ledger by id and part is in section 11 and the closing summary in section 13. M2b' closed (T7'): 67 / 29 as planned (sections 11 and 13).** Differences from 17.1 (at the M2b close; `start`/`close` were added in M2b' T3'): the service has no `start`/`close` yet (M2b' T2'/T3'), `service-timelines.json` belongs to M2b' T4'; `scheduler` is an optional service option (the timer is armed in M2b' T3').
**Ledger additions after the M2b review** (parts still open, by milestone): FR-315 "restart after every step" M2b' T4'; FR-245, FR-266 and FR-259 through the service with a halted match (`match-halted` replies, secret never revealed) M2b' T2'; FR-243 halt with `victim-mismatch` and FR-241 / FR-243 map check before the step M2b' T2'; FR-260 and NFR-47 (f) re-asserted in M3a when `createServer` and the listener exist. The review hand-offs are in section 13.
### 17.4 Risks of M2b
- **Size**: 15 tasks in total, hence the split (B1). Without the split, T6 and the recovery/durability tasks would not fit 10 tasks.
- **Re-pinning `core-timelines.json`**: `creationEvents` shifts every event sequence number by one and adds a first `schedule` event; the re-pin is a reviewed, separate commit whose diff must show only those two changes.
- **WAL with an exclusive lock on Windows**: checked in T3 on Windows and in CI (Linux); a failure falls back to `journal_mode = DELETE` (PD9 alternative) without a spec change. **Checked in M2b T3 (Windows, Node v24.0.0): WAL with `locking_mode = EXCLUSIVE` works, no fallback needed**: `journal_mode` reads back `wal`, a second connection in the same process and a second Node process both fail with `database-locked` while the first is open and succeed after it closes. The Linux result comes from CI: not yet seen, to be confirmed on the M2b PR (the in-memory database reads `memory`, and no test depends on the SQLite warning or on a Node-version-specific journal behaviour; CI runs Node `v24.21.0`).
- **Fault injection fidelity** (NFR-57): the abort happens before `COMMIT` and the connection is closed without commit, which is what a process kill leaves; a real child-process kill test is added once as a check of the seam.
- **Real-clock accuracy** (NFR-50 measurement): measured by a script with the real scheduler on the reference PC, recorded in section 13, not run in CI.

## 18. M3a detail (HTTP commands and reads, credentials, limits)
Branch `feat/008-m3a-http-api` from `rewrite` at 93727f4 or later (M2b' merged, PR #31); one PR; 10 tasks (`tasks.md`). **No new dependency (D9)**: the listener, routing, body limit, JSON parsing, CORS, rate limiting and shutdown use `node:http`, `node:crypto`, `node:fs` and the language only; the lockfile, root `package.json`, `engines` and `.nvmrc` do not change. Events and the SSE route are M3b; scoring, results and the leaderboard are M4 (their paths answer `unknown-path` until then); the viewer is M5.
**DECIDED 2026-10-22**: the user approved this section, the 10 M3a tasks and C1 to C8 as recommended (`tasks.md`, M3a): C1 the status table of 18.4 (403 always, 500 with body kind `unavailable`); C2 `unknown-match` not memoised, recorded in the spec as D26 (FR-282 (d) amended in T1's docs commit, before T5); C3 own predictions namespace-wide, paged, optional `?playerId=`; C4 the defaults of 18.5, PD21 and 18.8; C5 the logging policy of 18.7; C6 the `ErrorReply` optional fields `stage`, `appliedRounds`, `retryAfter`; C7 `MBRG_CLIENTS` as a JSON array; C8 one M3a with the checkpoint after T7 (18.12).
### 18.1 Files
```
packages/protocol/src/
  errors.ts (edit)        ErrorReply gains the named optional fields `stage`, `appliedRounds`, `retryAfter` (C6);
                          constructors roundNotApplied(n), stepMismatch(stage, n), rateLimited(seconds)      FR-301
  wire.ts (edit)          + MatchSummary, OwnPrediction, StateReply, RecordReply, Page<T>
  encode.ts (new)         fixed-key-order encoders of every reply (error, creation, advance, prediction, own
                          prediction, summary, state, record, page); encodePublicMatch unchanged            FR-257, FR-301
  page.ts (new)           readPageQuery (limit 1..500 default 100, cursor), encodeCursor/decodeCursor per list
                          tag, pageOf (keyset helper for tests)                                              FR-279
apps/server/src/core/
  reads.ts, advance.ts (edit)  use the unified constructors (StepMismatchReply removed as a separate type)
  memo.ts (edit)          `unknown-match` joins NON_MEMOISABLE_KINDS (C2, spec D26)                           FR-282 (d)
apps/server/src/store/
  store.ts, sqlite.ts (edit)   + listMatches, recordsAfter, predictionsInNamespace, hostTokenDigest;
                          StoreError keeps `cause` and the SQLite code; storage-failure classification by
                          primary result code                                                                 FR-292, FR-279, FR-270, NFR-54
  faults.ts (edit)        pass-through of the new operations
apps/server/src/service/
  matches.ts (edit)       + listMatches, stateAt, recordAt, records, ownPredictionsPage (namespace-wide, optional
                          local id), hostTokenMatches, mapFile; `onFailure(failure, cause)` option;
                          reads reply `unavailable` on a storage failure                                      FR-281, FR-258, FR-302, FR-270
  maps.ts (edit)          MapCatalog.file(mapId, name) -> { size, open() } (the stored bytes)                   FR-281 (j)
  settings.ts (edit)      ServerSettings = Settings + clients, allowedOrigins, host, port, limits               FR-283, FR-299 (b)
apps/server/src/http/                       the only users of node:http
  limits.ts (pure)        sliding-window limiter, two-phase admit/cancel, retry-after seconds                 FR-299
  identity.ts (pure)      Bearer parsing, operator / client / host / anonymous, all-compare, player id          FR-283, FR-284, FR-300
  cors.ts (pure)          CORS decision and headers                                                           FR-286
  status.ts (pure)        kind -> HTTP status table, success statuses, extra headers                           FR-301
  log.ts                  closed LogEvent union, describeError (name, code, SQLite code, frames; no message)   NFR-54
  body.ts                 bounded body reader (4096 bytes), JSON parse                                         FR-298, FR-296
  router.ts               route table, path parameters, query validation                                       FR-280, FR-281
  respond.ts              writes encoded replies: status, headers, CORS, Retry-After, Allow
  server.ts               createServer({ service, settings, clock, log, scheduler }): the pipeline of 18.2     FR-280..FR-286, FR-298..FR-302
  shutdown.ts             graceful shutdown with an injected scheduler for the grace period, signal wiring
apps/server/src/main.ts (rewrite)           settings -> store -> service (onFailure -> log) -> start() -> listen -> signals
apps/server/test/helpers/{http-client.ts,server-harness.ts}   fetch-based JSON client, raw `node:net` client, harness
```
### 18.2 The request pipeline, in the FR-301 order
Every request runs these stages in order; the first stage that fails answers, so the reply kind is the first applicable in the fixed order.
1. **Identify and admit** (`rate-limited`): the method gives the class (GET and OPTIONS are reads, POST a command); the `Authorization` header is read as `Bearer <token>` (anything else is anonymous); the token is compared, in time independent of its content, with the operator credential and every client credential (all comparisons always run) and, only for `POST /matches/{id}/advance`, with the match's host token (`hostTokenMatches`); a token that matches nothing is anonymous. The limiter admits the request under its credential key or, when anonymous, its address key (the TCP peer; forwarding headers are not trusted). A request over a limit is answered 429 here, before any routing.
2. **Route** (`unknown-path`, `method-not-allowed`): the table of 18.3. `OPTIONS` on a known path is the preflight (CORS, 204); on an unknown path `unknown-path`.
3. **Body** (`too-large`, then `invalid-request`): a `Content-Length` above 4,096 is answered at once without reading the body; a body without length (chunked) is counted while read and answered as soon as it passes 4,096; a body that is not UTF-8 JSON of the required type, or a query that breaks the rules of the route (unknown parameter, `limit`, `cursor`, `playerId`), is `invalid-request` naming the first failing field.
4. **Shape** (`invalid-request`, `invalid-player-id`): the readers of the protocol (`readCreation` shape part, `readAdvance`, `readSubmission`) run before the credential check, as FR-301 orders them.
5. **Authorization** (`forbidden`): routes that need a client credential (submission, own predictions) require one; creation and advance are authorized by the service (operator credential, host token) in its own order.
6. **Per-player limit** (`rate-limited`): a submission is counted under (match, player id) once its body is read; if it is over, the ticket of stage 1 is cancelled, so a rate-limited request is counted nowhere (FR-299 (c)).
7. **Decision**: the service call; its outcome (success, or an `ErrorReply`) is mapped by `status.ts` and encoded by the protocol encoders.
8. **Unexpected exception**: caught at the top; logged once through the closed `LogEvent` (18.7); answered 500 with the body `{"kind":"unavailable"}` (C1); a response already started is ended, nothing is written twice.
### 18.3 Routes (M3a)
| Method and path | Credential | Limiter class | Call |
|---|---|---|---|
| `POST /matches` | operator (service) | command | `create` |
| `GET /matches` | none | read | `listMatches` (paged) |
| `GET /matches/{id}` | none | read | `publicMatch` |
| `POST /matches/{id}/advance` | operator or host token (service) | command (host token: advances) | `advance` |
| `POST /matches/{id}/predictions` | client | command, then (match, player id) | `submit` |
| `GET /matches/{id}/predictions` | client | read | `ownPredictionsPage` (paged; `?playerId=` optional local id) |
| `GET /matches/{id}/states/{round}` | none | read | `stateAt` |
| `GET /matches/{id}/records` | none | read | `records` (paged) |
| `GET /matches/{id}/records/{round}` | none | read | `recordAt` (round >= 1; 0 is `invalid-request`) |
| `GET /maps/{mapId}/{file}` | none | read | `mapFile` (`map.json`, `ids.png`, `presentation.json`) |
| `OPTIONS` of the above | none | read (anonymous, address) | CORS preflight |
Path parameters are matched literally against their character sets (no percent-decoding): a malformed match id is `unknown-match`, a malformed map id `unknown-map`, a file name outside the three `unknown-path`, a round segment that is not `0` or a number without leading zero `invalid-request ['round']`. Trailing slashes, empty segments and `HEAD` are not offered. No other path exists in M3a (there is no health path: FR-281 lists "exactly" these reads).
### 18.4 Status table (C1; one status per kind, a pure function)
| Kind | Status | Extra |
|---|---|---|
| `rate-limited` | 429 | `Retry-After` |
| `unknown-path`, `unknown-match`, `unknown-map`, `round-not-applied` | 404 | |
| `method-not-allowed` | 405 | `Allow` |
| `too-large` | 413 | `Connection: close` |
| `invalid-request`, `invalid-player-id` | 400 | |
| `forbidden` | 403 | (never 401: one kind, one status, nothing about the header leaks) |
| `request-id-reused`, `too-many-matches`, `match-halted`, `match-finished`, `step-mismatch`, `stale-cursor`, `prediction-closed` | 409 | |
| `map-validation`, `too-few-factions`, `invalid-timing`, `invalid-choice` | 422 | |
| `unavailable` | 503 | |
| unexpected exception | 500 | body kind `unavailable` |
Success: creation 201; advance, submission, reads, map files 200; preflight 204. A memoised reply gets the status of its kind or success again.
### 18.4b CORS (FR-286, `cors.ts`, applied to every reply including errors)
| Request | Answer |
|---|---|
| no `Origin` header | no CORS headers (not a browser cross-origin request) |
| credential-free read (GET without `Authorization`), any origin | `Access-Control-Allow-Origin: *`; `Access-Control-Expose-Headers: retry-after`; never `Allow-Credentials` |
| any request carrying `Authorization`, from an allowed origin (`MBRG_ALLOWED_ORIGINS`) | `Access-Control-Allow-Origin: <that origin>`, `Vary: Origin`, `Expose-Headers: retry-after` |
| any request carrying `Authorization`, from another origin | no permission headers (the browser blocks the reply; the server still processes the request, since CORS binds browsers only and a command always needs a credential) |
| preflight (`OPTIONS`) of a read path whose `Access-Control-Request-Headers` do not list `authorization` | 204 with `Allow-Origin: *`, `Allow-Methods: GET`, `Max-Age: 600` |
| preflight of a command path, or listing `authorization`, from an allowed origin | 204 with `Allow-Origin: <origin>`, `Vary: Origin`, `Allow-Methods: GET, POST`, `Allow-Headers: authorization, content-type`, `Max-Age: 600` |
| the same preflight from another origin | 204 with no permission headers |
### 18.5 Settings (T3), names consistent with the existing `MBRG_*`
| Variable | Meaning | Default | Refused when |
|---|---|---|---|
| `MBRG_CLIENTS` | JSON array of `{ "namespace", "credential" }` | none | not an array, element with other keys, namespace outside `[a-z0-9]{1,16}`, duplicate namespace, credential outside `[A-Za-z0-9_-]{22,256}`, two equal credentials, one equal to the operator credential |
| `MBRG_ALLOWED_ORIGINS` | comma-separated origins for credentialed requests | none | an item that is not `http(s)://host[:port]` (no path, query or `*`) |
| `MBRG_HOST` | listener address | `127.0.0.1` | empty or with whitespace |
| `MBRG_PORT` | listener port (`0` = any free port, for tests) | `8787` | not a whole number 0..65535 |
| `MBRG_LIMIT_COMMANDS` / `_READS` | per credential per minute | 600 / 1,200 | not a whole number 1..1,000,000 |
| `MBRG_LIMIT_SUBMISSIONS` | per player id per match per minute | 30 | same |
| `MBRG_LIMIT_ADVANCES` | per host token per minute | 30 | same |
| `MBRG_LIMIT_ANONYMOUS` | per network address per minute | 120 | same |
`MBRG_OPERATOR_CREDENTIAL` now also needs the credential character set and length (FR-283). The operator credential uses the client values for commands and reads (C4). A problem names the variable, never its value. The stream limits (50 per credential, 5 per address) join in M3b. NFR-49 runs with these variables raised (FR-299 (f)); there is no switch that turns limits off.
### 18.6 Limiter (pure)
Per key an array of accepted request instants; `admit(keys, now)` prunes entries older than 60,000 ms, refuses when any key already holds its limit, and otherwise records `now` under every key and returns a ticket; the wait of a refusal is the largest over the exceeded keys of `ceil((oldest + 60,000 - now) / 1000)` with a minimum of 1. `ticket.cancel()` removes the instants it recorded. Keys exist only for the operator, the configured client namespaces, host tokens of existing matches (checked against the store before a key is created), addresses and (match, player id) pairs; a key with no instants is deleted at the next prune, and a full sweep runs every 1,000 admissions, so memory follows the traffic of the last minute. State is in memory only (FR-299 (d)).
### 18.7 Logging policy (C5)
- Output is a closed union `LogEvent` (`listening`, `start-report`, `step-failed`, `request-failed`, `shutdown`, `fatal`, `listen-failed`) rendered by `main.ts` as one JSON line: lifecycle events on stdout, failures on stderr. The union has no field that can hold a credential, token, secret, round seed, player id, choice, path, query or body.
- A cause is described by `describeError`: error name, `code` when it is an upper-case identifier, the SQLite result code and `errstr` when the platform gives them, the cause chain to depth 3, and up to 8 stack frames as `function file:line`. **The message is never logged** (it may quote values; Node's JSON errors quote the input).
- There is no per-request access log (paths carry match ids and query strings carry player ids). Client errors (4xx) and expected 503 from a storage failure are not logged per request; the failure of a clock step and any 500 are.
### 18.8 Entry point and shutdown
`main.ts`: `readSettings` (problems named, exit 1) -> `openStore` -> `createMatchService({ ..., onFailure })` -> `service.start()` (log the counts of the report) -> `createServer(...).listen(port, host)` -> `listening` event with the bound port -> signal handlers. `SIGINT`/`SIGTERM`: stop accepting, close idle connections, wait up to 5,000 ms for requests in flight (the grace period is armed through the scheduler interface, so timers stay in `scheduler.ts`), close the remaining connections, `service.close()` (cancels every wake-up, closes the store and releases the lock), exit 0; a second signal exits at once with 1. `uncaughtException`/`unhandledRejection`: log `fatal` through the closed union, run the same shutdown, exit 1. A listen error (port in use) logs `listen-failed` with the error code, closes the service and exits 1. Windows cannot deliver a signal to a child process, so the real-signal test runs on POSIX (CI Linux) and is skipped on Windows; the shutdown function itself and the signal wiring (a fake process emitter) are tested on both.
### 18.9 Hand-offs of M2b and M2b' and where each is resolved
| Hand-off | Resolved in |
|---|---|
| `main.ts` must call `start()` and keep the process alive | T9 |
| map `unavailable` and the other kinds to HTTP statuses | T6 (table), T7 |
| log `error` failures of clock steps; keep the original cause of native SQLite errors | T4 (cause, classification), T9 (`onFailure`, log) |
| resolve credentials and namespaces; `submit` throws `TypeError` for a bad identity | T6 (identity from settings), T7 (the pipeline builds the identity; a `TypeError` is an unexpected exception: 500 and one log event) |
| `ownPredictions` one local id per call | T4 (namespace read), T5 (`ownPredictionsPage`), C3 |
| `unknown-match` memo growth | T5 (C2), T6 and T7 (limits) |
| `StepMismatchReply` and `round-not-applied` shapes vs `ErrorReply` | T2 (C6); memoised `step-mismatch` replies keep their stored shape |
| memo content digest frozen (`sha256(ascii(canonicalBody(method, path, body)))`, paths `/matches`, `/matches/{id}/advance`, `/matches/{id}/predictions`) | T7: the routes build their paths with `CREATION_PATH`, `advancePath`, `submissionPath`; a test replays through HTTP a command first made through the service API |
| FR-300 constant-time comparison (transport part) | T6 |
| re-assert FR-260 and NFR-47 (f) against `createServer` and the listener | T9 |
| NFR-47 (c) log scan; NFR-54 logs | T9 |
| NFR-52 network integration tests | T7, T8, T9 |
| FR-250 is not checked for submissions | unchanged: they perform no step |
| `ownPredictions`/`publicMatch` load the whole match per call | measured in M3b (NFR-49) |
### 18.10 Ids and ledger
M3a closes (first trace) 9 ids: FR-279 (T2), FR-283 and FR-299 (T3), FR-281 (T5), FR-284 and FR-286 (T6), FR-280 and FR-298 (T7), FR-285 (T8); counts after each task: T2 68 / 28, T3 70 / 26, T5 71 / 25, T6 73 / 23, T7 75 / 21, T8 76 / 20; **M3a closing state 76 / 20**. The 20 left: FR-271 to FR-278 (M4; NFR-48 and NFR-57 results parts are also M4 but those ids are already done), FR-287 and NFR-49 (M3b), FR-303 to FR-311 and NFR-56 (M5). Test titles of earlier tasks do not name an id that a later task closes (they cite the neighbouring done id with its part, for example `FR-301 (rate-limited reply)`). Parts completed in M3a for ids already done: FR-257, FR-258 (encoders, reads, twin test over HTTP); FR-270 (read); FR-279 (HTTP paging; the leaderboard `stale-cursor` part is M4); FR-281 (a) to (d), (h), (j) (results (e) to (g) M4, stream (i) M3b); FR-285 (the event stream part is M3b); FR-292 (`unavailable` over HTTP; error classification); FR-296, FR-297 (transport); FR-300 (transport); FR-301 (status table, order over HTTP); FR-302 (HTTP); FR-231 to FR-238, FR-244, FR-245, FR-259, FR-261 to FR-267 (replies over HTTP); FR-260, NFR-47 (f) (re-asserted); FR-255, FR-256 and NFR-47 (c) (log scan); FR-239, FR-294 (`start()` wired); NFR-52 (network); NFR-54 (logs).
### 18.11 Decisions of this plan (planner, with the discarded alternative)
- PD14. The pipeline admits (rate limit) before routing, since `rate-limited` is first in the FR-301 order; the per-player-id limit runs after the body is read and cancels the earlier ticket. Discarded: counting rate-limited requests (against FR-299 (c)).
- PD15. Pure decision modules (`limits`, `identity`, `cors`, `status`) take the clock reading and the settings as parameters; only `server.ts`, `body.ts`, `respond.ts`, `shutdown.ts` and `main.ts` touch `node:http` or the process. Discarded: one large handler.
- PD16. Host-token classification reads one stored digest (`hostTokenDigest`) only for `advance` requests that did not match the operator or a client; it never creates a limiter key for an unverified token. Discarded: a key per presented token (unbounded memory).
- PD17. No access log; closed log events; messages of errors are never logged (18.7). Discarded: logging error messages (they can quote request values).
- PD18. `createServer` receives a built service; the test-only seed source is a parameter of `createMatchService` only, so `createServer` and `main.ts` have no way to take one (FR-260). Discarded: passing the seam through `createServer`.
- PD19. Wire replies are built by protocol encoders with a fixed key order and optional members omitted (FR-257); the HTTP layer never serialises a service object directly. Discarded: `JSON.stringify` of service results.
- PD20. Keyset cursors: `base64url(JSON [list, ...key])`, validated by list tag and key shape only; the cursor is opaque to clients and carries no secret (match ids and player ids it names are public to the reader of that list). Discarded: signed cursors (no forgery risk: a forged cursor only chooses where a read starts).
- PD21. Connection hardening by the platform's server options: `maxHeaderSize` 8,192 bytes, `headersTimeout` 10,000 ms, `requestTimeout` 30,000 ms, `keepAliveTimeout` 5,000 ms; the tests read the options back and test the body limit with a raw socket. Discarded: custom socket timers.
### 18.12 Risks of M3a
- **Size**: 10 tasks; T7 (pipeline), T8 (reads and CORS) and T9 (entry point) are the heaviest. Checkpoint after T7: if the branch passes about 3,500 changed lines or T7 needs more than one sitting, split per D24 into M3a (T1 to T6: protocol, settings, store, service, pure modules; closes FR-279, FR-283, FR-299, FR-281, FR-284, FR-286) and M3a' (T7 to T10: pipeline, reads, entry point; closes FR-280, FR-298, FR-285). Ids do not change.
- **Native SQLite error codes** (T4): `errcode`/`errstr` exist on the errors of the installed Node (v24.0.0 locally, v24.21.0 in CI) only if the platform provides them; T4 checks both and falls back to the message pattern, recording the result.
- **Client reset on a large rejected body**: a server that closes while the client still sends may make a client see a reset instead of the 413; tests use headers-only (`Content-Length` above the limit) and a chunked body cut at the limit, with a raw socket.
- **Real signals on Windows**: not deliverable to a child; covered by the in-process shutdown tests and a POSIX-only child test (CI).
- **Rate-limit defaults for spectators behind one address**: 120 requests per minute per anonymous address (approved default P16); a viewer uses a handful of reads and one stream, so a normal crowd behind one NAT is not limited; raise the variable if needed.
- **Behind a proxy** every client shares the proxy address (forwarding headers are not trusted); out of scope (D14), noted for deployment.
- **Memo growth** by arbitrary match ids: closed by C2 (decided 2026-10-22, spec D26: not memoising `unknown-match`) plus the per-credential limits.