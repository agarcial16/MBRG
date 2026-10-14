# Plan 001 — Foundations
Spec: `specs/001-foundations/spec.md` (`Status: approved`; FR-3 updated with the id rule decided in D1).

## 0. Starting point
After the legacy removal the repo has no `package.json`, no `tsconfig`, no `packages/`, no `apps/`, no `.github/`. A stale `node_modules/` (gitignored) remains from the legacy code. Everything below is created from scratch. `AGENTS.md` and `MEMORY.md` are gitignored (local only).

## 1. "Ask first" items (AGENTS.md) raised by this plan
| Item | What this plan does | Status |
|---|---|---|
| New dependency | Root devDependencies `typescript` (7.x; the user approved this deviation from the original 5.x during validation fixes, round 1) and `vitest` (current major). Both are part of the declared stack (constitution 1 and 4); no other package. No `@types/node`, no PRNG library, no `tsx`. Node 24 LTS. | Approved (D4) |
| Map format | Defined for the first time by the spec (FR-1, FR-2). **Id rule** (integer 1..16,777,215, 0 reserved) is now in spec FR-3 (§4). | Confirmed, spec updated (D1) |
| `MatchState` | Defined for the first time in §5: `{ mode, round, owners: [territoryId, factionId][] }`. Adds a `mode` field (FR-30). | Confirmed (D2) |
| Deleting files outside the task | Delete the stale root `node_modules/` before the first `npm install` (gitignored, legacy), in T1. | Authorized (D5) |

## 2. Layout and responsibilities
```
package.json              workspaces ["packages/*"], scripts test/typecheck, engines.node
package-lock.json         committed
.nvmrc                    Node LTS used locally and by CI (24)
tsconfig.base.json        strict, ES2022, moduleResolution "bundler", noEmit, lib ["ES2022"] (no DOM)
tsconfig.test.json        extends base; includes packages/*/test; types ["vite/client"] (import.meta.glob)
vitest.config.ts          include packages/*/test/**/*.test.ts
.github/workflows/ci.yml  FR-55, FR-56
packages/shared/
  package.json            name @mbrg/shared, "exports": { ".": "./src/index.ts" }
  tsconfig.json           extends base, include src, types []
  src/index.ts            public re-exports only
  src/types.ts            TerritoryId, FactionId, Territory, MapData, Result<T,E>     FR-1, FR-2, FR-8
  src/ids.ts              isValidId                                                   FR-3
  src/errors.ts           ValidationError union, VALIDATION_KIND_ORDER                FR-10, FR-11
  src/validate.ts         validateMap (orchestrates phases + sort)                    FR-9, FR-11, FR-28
  src/validate-structural.ts                                                          FR-4, FR-12..FR-20
  src/validate-relational.ts                                                          FR-5..FR-7, FR-21..FR-27
  test/*.test.ts
packages/sim/
  package.json            name @mbrg/sim, depends on @mbrg/shared ("*"), exports ./src/index.ts
  tsconfig.json
  src/index.ts            public API (§6); does NOT export internal.ts
  src/rng.ts              sfc32, roundRng(seed, round), pickIndex(rng, n)             FR-52, FR-35, FR-36
  src/types.ts            MatchState, RoundRecord, SimError, MODE                     FR-30, FR-34, FR-40, FR-49, FR-53
  src/inputs.ts           checkSeed, checkRound                                       FR-31, FR-32, FR-45..FR-47
  src/internal.ts         initialState, playRound, livingFactions, neighborFactions   FR-33, FR-35..FR-41
  src/match.ts            totalRounds, getState, getRounds, ownerOf                   FR-29, FR-42..FR-50, FR-54
  test/*.test.ts, test/golden/*.json, test/helpers/maps.ts (grid/ring builders)
```
Decision: packages export their **TypeScript source** (`exports` -> `./src/index.ts`), consumed directly by Vitest and `tsc` with bundler resolution. Discarded: project references with a `dist/` build step (more config, build ordering in CI, nothing consumes JS output yet).

Decision: `src` compiles with `lib: ["ES2022"]` and `types: []`, so any DOM or Node global in `shared`/`sim` is a type error (first line of NFR-1). Tests use a separate config. Discarded: one config for everything (would let DOM/Vite types leak into `src`).

## 3. Shared types (FR-1, FR-2, FR-8, FR-10)
```ts
type TerritoryId = number;           // §4
type FactionId = number;             // separate namespace by convention (FR-8)
interface Territory { id: TerritoryId; owner: FactionId; neighbors: TerritoryId[] }
interface MapData { territories: Territory[] }
type Result<T, E> = { ok: true; value: T } | { ok: false; errors: E[] };

type FieldLocation = { at: 'map' } | { at: 'territory'; position: number; id?: TerritoryId };
type ValidationError =
  | { kind: 'invalid-map' }
  | { kind: 'invalid-territories' }
  | { kind: 'invalid-territory'; position: number }
  | { kind: 'invalid-territory-id'; position: number }
  | { kind: 'invalid-neighbors'; position: number; id?: TerritoryId }
  | { kind: 'duplicate-territory-id'; id: TerritoryId; positions: number[] }
  | { kind: 'missing-owner'; position: number; id?: TerritoryId }
  | { kind: 'invalid-owner'; position: number; id?: TerritoryId }
  | { kind: 'unknown-field'; location: FieldLocation; field: string }
  | { kind: 'unknown-neighbor'; territory: TerritoryId; neighbor: unknown /* valid id */ }
  | { kind: 'self-neighbor'; territory: TerritoryId }
  | { kind: 'duplicate-neighbor'; territory: TerritoryId; neighbor: TerritoryId }
  | { kind: 'asymmetric-adjacency'; from: TerritoryId; to: TerritoryId }
  | { kind: 'multiple-initial-territories'; faction: FactionId; territories: TerritoryId[] }
  | { kind: 'too-few-factions'; count: number }
  | { kind: 'disconnected-map'; groups: TerritoryId[][] };
```
`id?` is omitted (not `undefined`) when the territory id is invalid, so JSON round-trips deep-equal. Ids are plain `number` aliases, not branded types. Discarded: branded types (casts everywhere, no runtime value since input is `unknown` anyway).

## 4. Id type decision (FR-3) — confirmed (D1), in spec FR-3
**Decision: ids are integers.** Rule (now spec FR-3):
> A valid id is a value of number type that is an integer from 1 to 16,777,215 (2^24 − 1) inclusive; 0 is reserved. The same rule applies to territory ids and faction ids. Invalid ids are reported through the existing kinds of their field (`invalid-territory-id`, `invalid-neighbors`, `invalid-owner`); no new error kind.

Why:
- **Id-bitmap compatibility.** The future `ids.png` stores one territory id per pixel in RGB (8 bits × 3 = 24 bits). An integer id is the pixel value with no lookup table; 0 stays reserved for "no territory" (sea/background pixels, deferred spec), which is why the range starts at 1. Alpha is not used (premultiplied alpha corrupts values in WebGL).
- **FR-53 round-trip.** Integers survive `JSON.stringify`/`JSON.parse` with their type. The range starting at 1 also excludes `0` and `-0` (JSON writes `-0` as `0`, which would break deep-equality).
- One rule for both namespaces keeps a single `isValidId` and lets a faction id index a palette texture later.
Discarded: **text ids** (readable in hand-written maps, but need a text-to-colour table for the bitmap, allow invisible differences such as whitespace/Unicode normalisation, and reserve no "no territory" value naturally); **any safe integer** (does not fit in a pixel).
Consequence: names (deferred) will live outside the id; hand-written test maps use small integers.
Implementation: `isValidId(x): x is number` = `typeof x === 'number' && Number.isInteger(x) && x >= 1 && x <= 0xFFFFFF`. This excludes everything FR-3 lists (null, booleans, lists, objects, text including empty text, NaN, ±Infinity, non-integers).

## 5. Sim types (FR-30, FR-34, FR-40, FR-49, FR-53) — confirmed (D2)
```ts
const MODE = 'classic';
interface MatchState { mode: 'classic'; round: number; owners: [TerritoryId, FactionId][] } // map order
interface RoundRecord { round: number; eliminated: FactionId; absorber: FactionId; transferred: TerritoryId[] } // map order
type SimError =
  | { kind: 'invalid-seed' }
  | { kind: 'invalid-round' }
  | { kind: 'round-out-of-range'; round: number; total: number }
  | { kind: 'isolated-faction'; faction: FactionId; round: number };
type MatchError = ValidationError | SimError;
```
Decision: `owners` is a list of `[territoryId, factionId]` pairs in map order; lookup by id via `ownerOf(state, id)` (FR-34). Self-describing (readable without the map), JSON-safe, no per-faction list. Discarded: object keyed by id (JSON keys become text, breaks FR-53); array of owners indexed by position (silently misread if paired with a differently ordered map).
`invalid-seed` / `invalid-round` carry no data: the offending value may be NaN/Infinity/non-JSON (spec lists no data).
No field holds the seed or PRNG state (FR-49).

## 6. Public API
`@mbrg/shared`:
- `isValidId(x: unknown): x is number` (FR-3)
- `validateMap(input: unknown): Result<MapData, ValidationError>` (FR-9..FR-28). On success `value` is the same input object, typed; never copied or mutated (FR-28).

`@mbrg/sim` (all pure; seed and round are always parameters, never ambient state):
- `totalRounds(map: unknown): Result<number, ValidationError>` — T = factions − 1 (FR-42).
- `getState(map: unknown, seed: unknown, round: unknown): Result<MatchState, MatchError>` (FR-43)
- `getRounds(map: unknown, seed: unknown, round: unknown): Result<RoundRecord[], MatchError>` (FR-44)
- `ownerOf(state: MatchState, territory: TerritoryId): FactionId | undefined` (FR-34)
- `MODE`, types.

Internal (`src/internal.ts`, imported by tests via relative path, not re-exported; FR-39):
- `initialState(map: MapData): MatchState`
- `playRound(map: MapData, state: MatchState, seed: number): Result<{ state: MatchState; record: RoundRecord }, SimError>`

## 7. Validation phases (FR-9 .. FR-28)
`isPlainObject(x)` = `typeof x === 'object' && x !== null && !Array.isArray(x)`; "has field" = `Object.hasOwn`. Input is only read.

**Structural** (collects everything, then decides):
```
if !isPlainObject(m): return [invalid-map]                                  FR-12
for f of sorted(Object.keys(m)) if f != 'territories': unknown-field(map, f) FR-19, FR-4
if !hasOwn(m,'territories') or !Array.isArray(m.territories): invalid-territories (blocking); goto end  FR-13
for each entry t at position p:
  if !isPlainObject(t): invalid-territory(p) (blocking); continue           FR-14
  idOk = hasOwn(t,'id') && isValidId(t.id); else invalid-territory-id(p) (blocking)   FR-15
  idData = idOk ? { id } : {}
  if !hasOwn(t,'neighbors') or !Array.isArray or some entry !isValidId: invalid-neighbors(p, idData) (blocking)  FR-16
  if !hasOwn(t,'owner') or t.owner === null: missing-owner(p, idData)        FR-17
  else if !isValidId(t.owner): invalid-owner(p, idData)                      FR-18
  for f of sorted(keys(t)) not in {id, owner, neighbors}: unknown-field(territory p, f)  FR-19
for each valid id shared by >= 2 positions: duplicate-territory-id(id, positions asc) (blocking)  FR-20
end: if any blocking -> return sort(errors)                                  FR-9
```
**Relational** (all entries are objects with unique valid ids and valid neighbor lists):
```
index = Map(id -> position)
for each territory A in map order, for each neighbor n in list order:
  if !index.has(n): unknown-neighbor(A, n)                                   FR-21
  else if n == A.id: self-neighbor(A) once per territory                     FR-22
  else if !B.neighbors.includes(A.id): asymmetric(A, n) once per pair       FR-24
  if n seen earlier in A's list: duplicate-neighbor(A, n) once per repeated id  FR-23
factions = Map(owner -> [territory ids]) over territories with a valid owner, insertion = map order
  each with > 1 territory: multiple-initial-territories(f, ids)             FR-25, FR-6
  if factions.size < 2: too-few-factions(size)                               FR-26
if territories >= 2: BFS over mutual links only (known, distinct, both list each other)  FR-27
  groups ordered by lowest position, ids in map order; > 1 group -> disconnected-map(groups)
return sort(structural non-blocking errors ++ relational errors)
```
**Sort** (FR-11): stable sort by `(kindIndex, firstPosition)` where `kindIndex` follows the FR-10 table and `firstPosition` is −1 for errors that name no territory or the top level (`invalid-map`, `invalid-territories`, top-level `unknown-field`, `too-few-factions`, `disconnected-map`; the last two occur at most once), otherwise the position of the first territory the error names (for `asymmetric-adjacency` the listing territory A). Emission order already follows neighbor-list order and field-name order (`<` code-unit comparison, not `localeCompare`), and `Array.prototype.sort` is stable (ES2019), so ties keep it.
Decisions: a self-link repeated twice gives `self-neighbor` once plus `duplicate-neighbor` once; a repeated one-way link gives one `asymmetric-adjacency`. Discarded: reporting per occurrence (noisy, same fix).

## 8. Simulation (FR-33 .. FR-54)
**PRNG (FR-52, NFR-2).** `sfc32` (Small Fast Chaotic, 128-bit state, passes PractRand), implemented in ~15 lines with `Math.imul` and `>>> 0`, so results are bit-identical on any JS engine. Discarded: `mulberry32` (only 2^32 states; nearby seeds are shifted copies of one sequence), a PRNG npm package (new dependency), `Math.random` (forbidden).

**Per-round stream.** `roundRng(seed, round)` = `sfc32(0x9E3779B9, seed, round, 1)` then discard 15 outputs. Each round's randomness depends only on `(seed, round)`, so `playRound` is a pure function of `(map, state, seed)` and needs no PRNG state in `MatchState` (FR-49), and FR-39 can start from a hand-built state. Discarded: one stream for the whole match (PRNG state would have to travel between rounds or be replayed, and the internal operation could not start from an arbitrary state). Fairness of this derivation is checked empirically by NFR-5.

**Uniform pick.** `pickIndex(rng, n)`: rejection sampling on uint32 — `limit = 2^32 − (2^32 mod n)`; draw until `x < limit`; return `x mod n`. Exactly uniform. Discarded: `Math.floor(float * n)` (tiny bias, float path).

**Faction order.** Per the spec definition, a faction's map order is the position of the first territory it owns **in the current state**; `livingFactions(state)` = distinct owners of `state.owners` in first-seen order (one pass). With one territory per faction at round 0 this equals initial order; after absorptions a faction may move earlier (confirmed, D3). Discarded: frozen initial order (would need a spec wording change).

**playRound(map, state, seed)** — pseudocode:
```
k = state.round + 1
living = livingFactions(state)          // precondition: living.length >= 2 (FR-41, see below)
rng = roundRng(seed, k)
E = living[pickIndex(rng, living.length)]                                         FR-35
ownerByTerritory = Map(state.owners)
N = distinct ownerByTerritory(n) for t owned by E, for n in map.neighbors(t), n mutual, owner != E
N sorted by faction order (index in living)                                       FR-36
if N empty: return error isolated-faction(E, k)                                   FR-38
A = N[pickIndex(rng, N.length)]
owners' = owners with E -> A; transferred = ids changed, map order                FR-37, FR-40
return { state: { mode, round: k, owners' }, record: { round: k, eliminated: E, absorber: A, transferred } }
```
FR-41: `getState`/`getRounds` never call `playRound` beyond T, so with one living faction no round is ever played; tests cover it through the public API (round T+1 is `round-out-of-range`, records stop at T, state at T has one owner). `playRound` throws a programming error if called with fewer than 2 living factions (contract violation, not a spec error kind). Discarded: a new `match-finished` error kind (not in the spec; would need a spec update).

**getState / getRounds(map, seed, N)** (FR-43..FR-48):
```
errors = validateMap(map).errors ?? []
seedOk = checkSeed(seed)  else push invalid-seed                                 FR-31, FR-32
roundOk = checkRound(N)   else push invalid-round                                FR-45
if map valid and roundOk and N > T: push round-out-of-range(N, T)               FR-46
if errors: return { ok: false, errors }  (order: map, seed, round, out-of-range) FR-47, FR-29
s = initialState(map); records = []
repeat N times: { s, record } = playRound(map, s, seed >>> 0); records.push(record)
return s  /  records
```
`-0` is normalised with `>>> 0` (seed) and `+ 0` (round). `getState` returns only the round-N state; `getRounds` only records 1..N (FR-48). Recomputing from round 0 on every call makes FR-50 hold by construction and FR-54 hold because the state is literally the fold of the records. Cost: O(N × territories × degree), about 1 ms-scale for 500 territories (NFR-3). Discarded: caching previous rounds (hidden state, would need invalidation; no measured need).

## 9. Test strategy (Vitest)
- Test names start with the requirement id (`'FR-21 ...'`, `'NFR-5 ...'`), so done-criteria traceability is checkable by a test that reads all test sources through `import.meta.glob('...', { query: '?raw', eager: true })` and asserts every FR-1..FR-54 (except FR-55, FR-56) and NFR-1..NFR-6 appears.
- Validation: one test per error kind; one map with every structural kind (exact list and order); one with every relational kind; 3-group disconnected map; unknown-field + `structuredClone` deep-equal check (FR-28); all spec edge cases.
- Expected error-kind list (NFR-6) is written literally in the test, not imported from `src` (would be tautological).
- Sim: hand-built maps (2-faction pair, 4-node line, 6-ring, 5×5 grid) in `test/helpers/maps.ts`.
- **Golden files (NFR-2, FR-51).** `test/golden/<name>.json` holding the full `getRounds(map, seed, T)` output for at least 3 pairs: 2-faction pair / seed 0; 8-territory hand map / seed 42; 5×5 grid / seed 4294967295. Written with Vitest's built-in `toMatchFileSnapshot` (no extra tool); regenerated deliberately with `npx vitest -u`, and the diff is reviewed in the PR. Vitest in CI mode never writes missing snapshots, so a missing or changed golden fails CI. A second golden pins the first 8 outputs of `sfc32` for seed 0 to localise PRNG drift. The 2-faction golden is also asserted by hand (only one possible outcome shape). Discarded: a separate generator script (needs `tsx` or a build step).
- Fairness (NFR-5): 6-ring plus one chord (a faction with 3 neighbors), seeds 0..9,999, via `getRounds(map, seed, 2)`. Expected std. errors ~0.4 pp (a) and ~1.2 pp (b) vs ±3/±5 pp bounds.
- Scale (NFR-3): 20×25 grid, 500 factions; `validateMap` + `getRounds(T)` + `getState(T)` under 1000 ms measured with `performance.now()` in the test.
- Purity (NFR-1): `vi.spyOn(Math, 'random')`, `vi.spyOn(Date, 'now')`, `vi.stubGlobal` for `performance`/`crypto` throwing, then validate + full match; and a source scan of `packages/{shared,sim}/src/**/*.ts` (raw glob) for `Math.random`, `Date`, `performance`, `crypto`, `fetch`, `XMLHttpRequest`, `document`, `window`, `localStorage`, `process`, `require(`, `node:`, `setTimeout`, `setInterval`.
- JSON round-trip (FR-53): `JSON.parse(JSON.stringify(x))` `toStrictEqual` x for states and records; ids stay `number`.

## 10. CI workflow (FR-55, FR-56)
`.github/workflows/ci.yml`: `on: pull_request: branches [main, rewrite]` and `push: branches [main, rewrite]`; one job on `ubuntu-latest`: `actions/checkout@v4`, `actions/setup-node@v4` with `node-version-file: .nvmrc` and `cache: npm`, `npm ci`, `npm run typecheck`, `npm test`. Any non-zero exit fails the check (FR-56). Demonstration: one passing PR and one intentionally failing PR (closed unmerged). Branch protection is out of scope. Discarded: a Windows/OS matrix (runtime determinism off CI is out of scope; doubles minutes).

## 11. User decisions (all resolved)
- D1. Confirmed: ids are integers 1..16,777,215 (24 bits, 0 reserved) for territory and faction ids; added to spec FR-3.
- D2. Confirmed: `MatchState = { mode: 'classic', round, owners: [territoryId, factionId][] }`; `RoundRecord = { round, eliminated, absorber, transferred }`; neither ever contains the seed.
- D3. Confirmed: faction map order = first territory it owns **in the current state** (literal spec definition); no spec wording change.
- D4. Approved: devDependencies `typescript` + `vitest` only; Node 24 LTS in `.nvmrc`/CI.
- D5. Authorized: delete the stale legacy `node_modules/` in T1 before the first `npm install`.

No open decisions remain; no task is blocked.

## 12. Risks
- **Faction-order rule (D3).** Changing it later would change every golden file.
- **Golden churn.** Any PRNG/picking change rewrites goldens; mitigated by the PRNG golden and review of `-u` diffs.
- **`vite/client` types** in tests may pull DOM typings; confined to `tsconfig.test.json`, `src` stays DOM-free and the source scan backs it up.
- **Perf test flakiness** on slow CI runners; threshold is ~100× expected cost.
- **Path with spaces** on Windows: npm scripts must not build paths by string concatenation; quote paths in docs.
- **`gh` CLI** not installed yet: needed only for the CI demonstration PRs (can be done in the web UI).
