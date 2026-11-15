# Tasks 014 — Public match config read
Spec: `spec.md`. Plan: `plan.md`. Branch: `feat/014-public-config`. One milestone (7 tasks, one PR); no per-milestone task files. After each task append to `PROGRESS.md` (what changed, tests run, mutations, untested, next step).

## Shared rules
- Tests first (red), then code, then `npm test` and `npm run typecheck` green; one task, one commit; then stop.
- Test titles start with their id (`FR-413 ...`) so the ledger traces them. A task moves its ids from `PENDING_014` to `DONE_014` in its own commit.
- Mutation proofs: apply each mutant by hand, run only the affected test files, see red, revert; record in `PROGRESS.md`. Full suite once at the end of each task.
- Commits: English, conventional, one line <= 72 chars. Quote the repo path in shell commands (it has spaces).
- Protected files and goldens (`wire-008.json`, `protected-files.json`, 011 goldens) are never edited. No re-pin is expected; if one seems needed, stop and ask.
- No new dependency, no change to `settings.ts`, `packages/sim`, `packages/shared`, the map format or any existing route/error code.
- Ledger counts (12 ids: FR-413..421, NFR-81..83), done / pending: T1 0/12; T2 1/11; T3 2/10; T4 5/7; T5 9/3; T6 10/2; T7 12/0.

## Index
| Task | Ids moved | Done / pending |
|---|---|---|
| T1 bookkeeping | none | 0 / 12 |
| T2 protocol shape, encoder, decoder, golden | FR-416 | 1 / 11 |
| T3 service read from settings | FR-414 | 2 / 10 |
| T4 the route | FR-413, FR-418, FR-419 | 5 / 7 |
| T5 secrecy, stability, mutation table | FR-415, FR-417, NFR-81, NFR-83 | 9 / 3 |
| T6 creation boundary | FR-421 | 10 / 2 |
| T7 close | FR-420, NFR-82 | 12 / 0 |

## Tasks
- [x] **T1. Bookkeeping targets.** (no id moved)
  - Files: `packages/sim/test/traceability.test.ts`, `specs/014-public-config/PROGRESS.md` (skeleton exists).
  - Tests first: extend the ledger: `FR_RANGES` `[[1,392],[413,421]]`, `NFR_RANGES` `[[1,76],[81,83]]`; new `PENDING_014` (12 literal ids) and empty `DONE_014`, with a comment of the targets of this table; the pinned totals 468 / 466 / 466 become 480 / 478 / 478; a test that `PENDING_014 + DONE_014` is the 12 literal ids with no overlap and that every `DONE_014` id has a test title.
  - Commit: `test: prepare the spec 014 bookkeeping`.
  - Mutation proofs: an id dropped from the lists; an id in both lists (each fails the ledger test).
  - Done when: suite, typecheck green; 0 / 12.
  - Size: S (about 40).

- [x] **T2. Protocol shape, encoder, decoder and SHA-256 golden.** FR-416
  - Depends on: T1.
  - Files: `packages/protocol/src/{wire,encode,decode,index}.ts`, `packages/protocol/test/public-config.test.ts`, `packages/protocol/test/golden/config-014.json` (new), `packages/protocol/test/purity.test.ts` (only if it enumerates files).
  - Tests first: three fixed examples (one map and defaults; three maps, custom bounds; disabled: `[]`, bounds present) give exactly the canonical text of plan section 2 (key order, no whitespace, whole numbers); SHA-256 of each equals the golden hex; round trip; decoder refuses unknown field, each of the 7 missing fields, wrong types (float, negative, 0, numeric string, null, `maps` not an array), map ids of bad shape, duplicate map, `enabled` that disagrees with `maps` (D5); a property added to the input object never reaches the encoded text; purity scan passes.
  - Commit: `feat(protocol): add the public config encoder and decoder`.
  - Mutation proofs: two keys swapped in the encoder (golden fails); `enabled` dropped; decoder accepting an extra field; decoder skipping `isMapId`; encoder using `JSON.stringify(input)`.
  - Done when: tests green; mutations caught; FR-416 moved (1 / 11).
  - Size: M (about 350).

- [x] **T3. Service read from the settings (same object as creation).** FR-414
  - Depends on: T2.
  - Files: `apps/server/src/service/public-config.ts` (new), `apps/server/src/service/matches.ts` (`publicConfig()`), `apps/server/test/service-public-config.test.ts`.
  - Tests first: defaults (empty maps: `enabled` false, `[]`, 30 / 3600 / 10 / 5, cap 200); operator values published as set; map order kept, one and many maps; disabled keeps bounds and cap; a new map list set on the service's settings object changes the next read (one object, no copy); the result is a fresh array; sentinel values in every non-public setting never appear; no storage access (the read answers with a throwing store seam).
  - Commit: `feat(server): read the public config from the settings`.
  - Mutation proofs: `enabled` true when empty; `enabled` constant true; `maxInterval` read from `minInterval`; cap omitted; maps sorted; copy of settings taken at start.
  - Done when: tests green; mutations caught; FR-414 moved (2 / 10).
  - Size: S (about 200).

- [x] **T4. The route: `GET /config` (CORS `*`, limit, 405/Allow, no query).** FR-413, FR-418, FR-419
  - Depends on: T3.
  - Files: `apps/server/src/http/server.ts` (one route entry; update the header comment list of read routes), `apps/server/test/http-config.test.ts`, and the route-list pin test only if one exists (extend by this one entry).
  - Tests first (real listener, port 0, fake clock): 200, `application/json`, body byte-equal to `encodePublicConfig` of the settings, same header set as `GET /matches/:id/players`; `Access-Control-Allow-Origin: *`; `?a=1` is 400 `invalid-request ['a']`, with several, the first in sorted order; `POST`, `PUT`, `DELETE` are 405 `method-not-allowed` with `Allow: GET, OPTIONS`; `HEAD` and `OPTIONS` as the other reads (compare with `GET /matches`); limit - 1, limit, limit + 1 requests inside the window (mixed with another anonymous read) give 200 / 200 / 429 `rate-limited` with `Retry-After`; a GET with a body is answered, the body discarded, an oversized one `too-large` as other reads; client, operator, bad Bearer and player token give identical bytes (the limiter bucket follows the existing identity rule); `Content-Length` matches the bytes; trailing slash `/config/` and `/Config` are `unknown-path`.
  - Commit: `feat(server): publish the public config at GET /config`.
  - Mutation proofs: route registered with `body: 'object'`; `checkQuery` removed; route marked as a command (class `command`); CORS origin echoed instead of `*`; status 201.
  - Done when: tests green; mutations caught; FR-413, FR-418, FR-419 moved (5 / 7).
  - Size: M (about 400).

- [x] **T5. Secrecy, stability and the mutation table.** FR-415, FR-417, NFR-81, NFR-83
  - Depends on: T4.
  - Files: `apps/server/test/config-secrecy.test.ts`, `apps/server/test/config-mutants.test.ts` (new).
  - Tests first: settings with planted values for operator credential, client credentials and namespaces, allowed origins, host, port, database path, map folders, every limit value, lobby expiry, open-lobby and running caps, forced phase span, in decimal, hex, base64, base64url and raw: none appears in the body (over the real listener and the service); the decoded key set equals `PUBLIC_CONFIG_KEYS`; no key named like token, digest, namespace, origin, host, port, path, folder, count, limit, expiry; 50 reads across states (no match, open lobbies, running, finished, halted), clock jumps and callers are byte-identical; a store seam that throws on any access and a clock/random spy: the read answers 200 and the spy is never called (NFR-83); protected-files and dev-secrets pins pass in the same run. NFR-81 table: mutants of the output (field dropped, field added, leaked setting added, `enabled` flipped, map order reversed) each differ from the golden bytes and each is refused by the consistency check or the decoder.
  - Commit: `test(server): scan the public config for secrets and drift`.
  - Mutation proofs: `lobbyExpiryHours` added to the encoder; `host` added; a match count added; time stamp added; `enabled` flipped.
  - Done when: tests green; mutations caught; FR-415, FR-417, NFR-81, NFR-83 moved (9 / 3).
  - Size: M (about 400).

- [x] **T6. Creation boundary: a creation inside the config is never refused.** FR-421
  - Depends on: T4.
  - Files: `apps/server/test/config-creation-boundary.test.ts` (additions to helpers only if needed).
  - Tests first: read the config (service and over HTTP), then derive every case from it, for the default settings and for a non-default set (several maps, other bounds): each listed map creates ok; interval = min and = max ok; min - 1 and max + 1 give `invalid-timing`; L1 = min and L2 = min ok (other fields valid), each minus 1 refused; a map id not listed gives `unknown-map`; `maxPlayers` joins ok, the next is `match-full`; disabled config: creation is refused with `unknown-map` for any map. Fresh source and request id per creation so rate limits and memo do not interfere.
  - Commit: `test(server): create at each published bound and just outside`.
  - Mutation proofs: published `minInterval` + 1; published `maxInterval` read from another setting; published map list with an extra map; published `maxPlayers` - 1 (each fails a boundary case).
  - Done when: tests green; mutations caught; FR-421 moved (10 / 2).
  - Size: M (about 300).

- [x] **T7. Close: existing wire unchanged, ledger, PROGRESS, PR.** FR-420, NFR-82
  - Depends on: T1 to T6.
  - Files: `apps/server/test/config-unchanged.test.ts` (new), `packages/sim/test/traceability.test.ts` (closing-state test: 12 done / 0 pending, ledger lists each of the 12 ids with a test), `specs/014-public-config/PROGRESS.md`, `MEMORY.md` (local, short), `specs/014-public-config/spec.md` status line to `implemented` only after the user merges.
  - Tests first: the production route table equals the previous list plus exactly `GET /config`; the existing error kinds and settings variable list (30) are unchanged; `wire-008.json`, the 011 goldens and `protected-files.json` are byte-identical to `main` (hash compare in test, or `git diff --stat` recorded in `PROGRESS.md`); no re-pin exists, so `PROGRESS.md` states "no re-pin" with the reason (the protected roots do not include protocol or server sources).
  - Steps: full `npm test`, `npm run typecheck`, `CI=1` run; `PROGRESS.md` holds per-task mutation proofs, counts and the hand-off to 013; PR body lists the FR/NFR ledger, the new route, the new protocol names, the decisions D1 to D7, and "no existing byte changed".
  - Commit: `test: pin the spec 014 ledger and the unchanged wire`.
  - Mutation proofs: a second route added to the table; a settings variable added; an error kind added (each fails the unchanged test).
  - Done when: CI green; ledger 12 / 0; PR opened; `MEMORY.md` updated (next: spec 013 reads `GET /config`).
  - Size: S (about 150).
