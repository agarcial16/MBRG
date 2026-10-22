# Plan 008 — Server and predictions
Spec: `specs/008-server-and-predictions/spec.md` (approved by the user on 2026-10-21, D25). Covers FR-231 to FR-315 and NFR-47 to NFR-57 (96 ids). Delivery in milestones (spec D18, D24): M1, M2a, M2b, M3a, M3b, M4, M5, each with its own branch cut from an up-to-date `rewrite`, its own PR into `rewrite`, squash merge with the user's OK and CI green. GitHub issues: one per milestone only if the user wants them (spec "Splitting").

This plan is at overview level for the whole spec and detailed for **M1** (branch `feat/008-m1-secret-and-sim-exports`). M2 to M5 get their detailed sections and tasks in a later revision of this plan, each approved before its first task.

**Gate.** This plan and `tasks.md` need the user's formal approval before T1 starts. The items of section 1 were answered by the user on 2026-10-21/22 (U1 to U5, now decisions).

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
| NFR-47 | (e) M1; (b) M2a; (a), (d), (f) M2b; (c) M3a |
| NFR-48 | seeds and records M1; lifecycle M2b; results M4 |
| NFR-51 | sim scans M1; server core M2a |
| NFR-52 | store and lifecycle M2b; network M3 |
| NFR-53 | manifest test M1; rechecked in every milestone |
| NFR-54 | store M2b; logs M3a |
| NFR-55 | export lists and traceability M1; every milestone |
| NFR-57 | M2b; results part M4 |
| FR-241, FR-243, FR-246, FR-251 | storage M2b; scoring parts M4 |
| FR-270, FR-281, FR-282, FR-288, FR-289, FR-301, FR-302 | core or storage M2a/M2b; HTTP or stream M3a/M3b |
- M5 removes the pending set (an empty list) and the spec goes to `implemented` after M5's acceptance.

## 12. Milestones (delivery)
| Milestone | Branch | Content | Ids | Depends on |
|---|---|---|---|---|
| **M1** | `feat/008-m1-secret-and-sim-exports` | Sim exports, export-list edits, `apps/server` skeleton, secret and round seeds, D7 checks, seed goldens, absorber uniformity, traceability with the pending set | FR-252, FR-312, FR-313; NFR-47(e), NFR-48 (seeds), NFR-51 (sim), NFR-53, NFR-55 | none |
| M2a | `feat/008-m2a-protocol-and-core` | Protocol package; pure core: timing rules, schedule and anchors, stage machine, late step, effective and reported time, advance decision, prediction validation and cutoffs, public view, error order, canonical forms | FR-233, FR-234, FR-237, FR-239, FR-240 (decision), FR-244, FR-247 to FR-249, FR-253 to FR-258, FR-261 to FR-269, FR-282 (content), FR-295 to FR-297, FR-301 (kinds), FR-302 (reported time), FR-314; NFR-47(b), NFR-50, NFR-51 | M1 |
| M2b | `feat/008-m2b-store-and-lifecycle` | SQLite store, transactions and lock, lifecycle service with the fake clock, creation, halting, map check, memo, events storage, recovery, durability | FR-231, FR-232, FR-235, FR-236, FR-238, FR-240 to FR-243, FR-245, FR-246, FR-250, FR-251, FR-259, FR-260, FR-270 (storage), FR-288, FR-289 (data), FR-290 to FR-294, FR-300 (digests), FR-315; NFR-47(a), (d), (f), NFR-48 (lifecycle), NFR-52, NFR-54 (store), NFR-57 | M2a |
| M3a | `feat/008-m3a-http-api` | HTTP commands and reads, credentials and namespaces, cross-origin, limits, paging, map files | FR-257 (HTTP), FR-270 (read), FR-279, FR-280, FR-281 (non-result), FR-282 (transport), FR-283 to FR-286, FR-298 to FR-300, FR-301, FR-302 (HTTP); NFR-47(c), NFR-52, NFR-54 (logs) | M2b |
| M3b | `feat/008-m3b-event-stream` | Server-Sent Events, replay, heartbeat, NFR-49 procedure | FR-287, FR-288, FR-289 (stream), FR-290 (stream); NFR-49 | M3a |
| M4 | `feat/008-m4-scoring-and-results` | Scoring, results, leaderboard reads | FR-271 to FR-278, FR-281(e) to (g), scoring parts of FR-241, FR-243, FR-246, FR-251(c); NFR-48 (results), NFR-57 (results) | M2b, M3a |
| M5 | `feat/008-m5-live-viewer` | Live viewer, address rules, map digest in the browser, web test client, production build check | FR-303 to FR-311; NFR-56 | M3b, M4 |

## 13. Recorded figures and checks
(Filled during M1: Node version, `node:sqlite` stability label, experimental warning yes/no, runner check, test vectors, dev-map golden digests, absorber uniformity worst deviation. Later milestones add their figures.)

- **T5 (`node:sqlite`)**: Node `v24.0.0` (win32). `import('node:sqlite')` works with no flag. Stability label: 1.1 Active development (from the Node 24 documentation, not checked online here); a plain import prints `ExperimentalWarning: SQLite is an experimental feature and might change at any time` (warning present: yes). In-memory and file databases, commit, rollback and the `PRAGMA locking_mode = EXCLUSIVE` lock (second connection fails with locked/busy) all pass on Windows. `engines` (>=24) and `.nvmrc` (24) untouched (U3). Lockfile gained only the `apps/server` workspace entry and its link (`tsx` 4.23.15, `@types/node` 24.19.2 were already locked).
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
