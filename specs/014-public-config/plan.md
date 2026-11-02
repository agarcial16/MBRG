# Plan 014 — Public match config read
Status: draft (waits for approval). Spec: `spec.md` (approved). Branch: `feat/014-public-config`. Full SDD (protocol + server), one milestone, one PR.

## 1. Files and responsibilities
| File | Change | Covers |
|---|---|---|
| `packages/protocol/src/wire.ts` | `PublicConfig` type, `PUBLIC_CONFIG_KEYS` (fixed order) | FR-413, FR-416 |
| `packages/protocol/src/encode.ts` | `encodePublicConfig(config): string` | FR-416, FR-417 |
| `packages/protocol/src/decode.ts` | `readPublicConfig(input): Decoded<PublicConfig>` | FR-416 |
| `packages/protocol/src/index.ts` | export the four names above | FR-416 |
| `apps/server/src/service/public-config.ts` (new, pure) | `publicConfigOf(settings: Settings): PublicConfig` | FR-413, FR-414, FR-415, FR-421, NFR-83 |
| `apps/server/src/service/matches.ts` | `publicConfig(): { ok: true; reply: PublicConfig }` calling `publicConfigOf` on the service's own settings object | FR-421 |
| `apps/server/src/http/server.ts` | one `GET /config` route in `productionRoutes` (`body: 'none'`, `checkQuery: noQuery`, `decide` -> `replyOf(service.publicConfig(), 200, encodePublicConfig)`) | FR-413, FR-417..419 |
| `packages/protocol/test/golden/config-014.json` (new) | fixed examples, canonical text, SHA-256 | FR-416 |
| tests (below), `packages/sim/test/traceability.test.ts`, `specs/014-public-config/PROGRESS.md` | | NFR-81, NFR-82 |

Not touched: `settings.ts` (values, defaults, validation), `router.ts`, `limits.ts`, `respond.ts`, `cors.ts`, `status.ts`, any `packages/sim` or `packages/shared` source, the map format, the database, the stream hub.

Protected files: none of the protected roots (`packages/sim/src`, `packages/shared/src`, `maps/dev`, goldens, web goldens) is edited, and `protected-files.json` lists neither `packages/protocol` nor `apps/server/src`. So **no re-pin is expected**; `wire-008.json` and `protected-files.json` stay byte-identical. If a task finds it must edit a protected file, it stops and asks.

## 2. Wire shape (proposal; decision D1)
Flat object, canonical text with fixed key order and no whitespace:
`{"maps":[...],"minInterval":N,"maxInterval":N,"minPhase1":N,"minPhase2":N,"maxPlayers":N,"enabled":B}`
(the order of FR-413: maps, bounds as interval short/long then L1, L2, player cap, enabled). Numbers are whole, in seconds. Source of each field: `publicCreation.maps`, `.minInterval`, `.maxInterval`, `.minPhase1`, `.minPhase2`, `Settings.maxPlayers`, `maps.length > 0`.

## 3. Pure functions
```
publicConfigOf(settings: Settings): PublicConfig      // no clock, no random, no I/O, no match
  { maps: [...settings.publicCreation.maps], minInterval, maxInterval, minPhase1, minPhase2,
    maxPlayers: settings.maxPlayers, enabled: maps.length > 0 }
encodePublicConfig(c) -> string                        // explicit field-by-field text, fixed order
readPublicConfig(x)   -> Decoded<PublicConfig>         // exact key set; types; each map id isMapId; whole numbers >= 1;
                                                       // no duplicate map; enabled === (maps.length > 0)
```
Seed and round are not parameters: the read has no match, no round and no randomness (NFR-83). The route passes no request data (query is refused, credential and role are ignored).

## 4. Decisions
- D1 Flat shape, order as FR-413. Discarded: nested `{bounds:{...}}` (more bytes, a second order to pin, no benefit for the one consumer).
- D2 `publicConfigOf` is a pure function over the same `Settings` object the service holds, and `createPublic` reads that object too, so the published values and the enforced ones cannot drift (FR-421). Discarded: copying values into a config object at start (a second source of truth) and reading env again in the route.
- D3 The service exposes `publicConfig()` and the route calls it, like every other route. Discarded: closing over `settings` in `productionRoutes` (the route table would hold a rule). No storage read, so no `unavailable` path and no fault-seam case.
- D4 Explicit field-by-field encoder (not `JSON.stringify(object)` of the input), so an extra property on the input object can never reach the wire (FR-415). Discarded: stringify of the whole settings slice (leaks by construction).
- D5 `enabled` is derived, never stored (FR-414). The decoder also refuses an `enabled` that disagrees with `maps` and a duplicate map id: a small tightening that the spec's refusal list does not forbid. Discarded: accept-and-trust (a client could show a wrong state). Needs the user's nod (see report).
- D6 The route is a normal anonymous GET: the existing pipeline already gives CORS `*`, the anonymous per-minute count, 405 with `Allow: GET, OPTIONS`, `noQuery`, and body discard. No new pipeline code, no special case for the route. A bearer is ignored by `decide`; the limiter bucket follows the existing identity rule (a credential is counted as that credential; the body is identical). Discarded: a pipeline bypass for config (would break FR-418).
- D7 Golden: `packages/protocol/test/golden/config-014.json` holds 3 fixed examples (defaults with one map, several maps with custom bounds, disabled) with canonical text and SHA-256 (taken with `node:crypto` inside the test; the golden stores the hex). It is created once by hand from the encoder output and reviewed; no generator script (the file is tiny). Discarded: hash computed only from the encoder in-test with no stored pin (proves nothing).

## 5. Test strategy (Vitest, tests first, each test title starts with its id for the ledger)
- Protocol (`packages/protocol/test/public-config.test.ts`, extend `purity.test.ts` list if it enumerates files): canonical text for the three examples; SHA-256 equals the golden; encode then read round-trips; read refuses an unknown field, each missing field (7 cases), wrong types (string number, float, negative, 0, boolean as string, `maps` not an array, null), map id shapes (`""`, uppercase, 65 chars, `a/b`), duplicate map, `enabled` disagreeing; key order in the encoder output; the purity scan still passes.
- Service (`apps/server/test/service-public-config.test.ts`): defaults (maps empty -> enabled false, `[]`, bounds 30/3600/10/5, cap 200); operator values published as set; order kept; one and many maps; disabled keeps bounds and cap; `publicConfigOf` does not read `operatorCredential`, `clients`, `allowedOrigins`, `host`, `port`, `databasePath`, `limits`, `maxOpenLobbies`, `lobbyExpiryHours`, `forcedPhaseSeconds` (a settings object with sentinel values for all of them: none appears in the bytes); the output is a fresh array (mutating it does not change the settings).
- HTTP (`apps/server/test/http-config.test.ts`, real listener, port 0, fake clock, `productionRoutes`): 200 with `application/json`, same headers/shape as `GET /matches/:id/players`, body byte-equal to `encodePublicConfig`; `Access-Control-Allow-Origin: *`; `?x=1` -> 400 `invalid-request ['x']`; `POST`/`PUT` -> 405 with `Allow: GET, OPTIONS`; `HEAD` as the other reads; `OPTIONS` preflight as the other reads; anonymous limit: `limit` requests ok then `rate-limited` 429 with `Retry-After`, counted with the other anonymous reads (mixed with `GET /matches`); a body sent with GET is discarded; a client or operator credential, a bad Bearer and a player token give the same bytes.
- Scans and stability (`apps/server/test/config-secrecy.test.ts`): settings with planted values (credential, client credentials, origins, host, port, db path, map folders, limit values, lobby expiry, open-lobby cap) in decimal, hex, base64, base64url, raw: none in the body; the key list of the decoded body equals `PUBLIC_CONFIG_KEYS`; 50 calls across states (no matches, open lobbies, running, finished, halted), clock moves and callers: byte-identical; the route never calls the match store, clock `now` result, or random (a service seam spy / fault seam that throws on any storage access: the read still answers 200). The dev maps and sim sources are untouched (protected-files test unchanged).
- Mutation table (NFR-81): a test builds mutants of the output (field dropped, field added, a leaked setting added, `enabled` flipped, map order reversed) and asserts each differs from the golden bytes and is refused by `readPublicConfig` or by the consistency check; plus manual source mutations recorded in `PROGRESS.md` per task.
- Boundary (`apps/server/test/config-creation-boundary.test.ts`, FR-421): read the config from the running service, then create with the real creation path (`createPublic` / `POST /matches`) at each published bound and at the first value outside it: every listed map ok; `interval` = min ok, min - 1 -> `invalid-timing`; interval = max ok, max + 1 -> `invalid-timing`; L1 = min ok (with L2 and interval consistent), min - 1 refused; L2 likewise; a map id not in the list -> `unknown-map`; run for the defaults and for a non-default settings set (the values derive from the read, not from literals); the player cap: join `maxPlayers` ok then `match-full`. Each creation uses a fresh source/request id so rate limits do not interfere.
- Existing suites: `wire-008.json`, `protected-files.json`, the 011 goldens and `http-cors*`, `http-pipeline`, `http-purity` pass unmodified (FR-420). Test that pins the route list, if any, is extended only by the one new entry and the reason is logged.
- Ledger (`traceability.test.ts`): `FR_RANGES` [[1,392],[413,421]], `NFR_RANGES` [[1,76],[81,83]]; `PENDING_014` of 12 ids moving to `DONE_014`. Dependent counts (468 / 466 / 466) move by +12 (480 / 478 / 478). The gap 393..412 and 77..80 belongs to specs 012 and 013 and is not ledgered here.

## 6. FR coverage
| FR / NFR | Part |
|---|---|
| FR-413 | `publicConfigOf`, route, T4 body test |
| FR-414 | `enabled` derivation, disabled cases (T3) |
| FR-415 | field-by-field encoder, sentinel scan (T5) |
| FR-416 | wire/encode/decode, golden (T2) |
| FR-417 | pure function, repeat test (T5) |
| FR-418 | existing pipeline, HTTP test (T4) |
| FR-419 | existing router, HTTP test (T4) |
| FR-420 | untouched goldens and pins, route-list diff (T7) |
| FR-421 | one settings object, boundary test (T6) |
| NFR-81 | mutation table and per-task proofs (T5) |
| NFR-82 | ledger (T1, T7) |
| NFR-83 | no storage/clock/random, sim and map format unchanged (T5) |

## 7. Hand-offs
- To spec 013 (web create screen): it reads `GET /config` (anonymous, CORS `*`), decodes with `readPublicConfig` from `@mbrg/protocol`, offers only `maps` and timings inside the bounds, shows "creation off" when `enabled` is false, and still handles a server refusal (settings can change at the next server start). It adds its own FR range to the ledger.
- From 011: settings keys and `createPublic` rules are consumed, not changed.
- Model: Sonnet suffices for implementer/reviewer (read-only publication of already public settings); the secrecy scan (T5) gets a careful review, Opus only if the reviewer finds the service touching match data.
