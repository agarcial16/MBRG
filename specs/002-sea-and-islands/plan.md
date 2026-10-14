# Plan 002 — Sea and islands
Spec: `specs/002-sea-and-islands/spec.md` (`Status: approved`). Planner calls approved with the spec: retired ids FR-6/FR-25 are rejected in test titles (so `'FR-5 FR-6 a valid map ...'` drops FR-6); a present `kind: undefined` is an invalid kind; FR-81 is an internal operation only.

## 0. Starting point (branch `rewrite`, 8f60ea8)
- `packages/shared/src`: `types.ts` (`Territory {id, owner, neighbors}`, `MapData`), `errors.ts` (union + `VALIDATION_KIND_ORDER`, 16 kinds), `validate-structural.ts` (index walk, own-property reads, `TERRITORY_FIELDS`), `validate-relational.ts` (neighbor checks, FR-25/FR-26 faction map, BFS over all entries), `validate.ts` (`firstPosition`, `sortErrors`, `validateMap`).
- `packages/sim/src`: `internal.ts` (`initialState`, `ownerOf`, `livingFactions`, `neighborFactions`, `playRound`), `match.ts`, `rng.ts` (sfc32, `roundRng`, `pickIndex`), `types.ts`, `inputs.ts`, `index.ts` (exports exactly `MODE, getRounds, getState, ownerOf, totalRounds`; a test pins this list).
- Tests: 14 files, 169 tests; goldens `sim/test/golden/{pair-seed0,hand8-seed42,grid5x5-seed4294967295,sfc32-seed0}.json` via `toMatchFileSnapshot`; traceability expects FR-1..FR-54, NFR-1..NFR-6.
- `specs/002-sea-and-islands/` is untracked; it is committed first on the feature branch (T1).

## 1. "Ask first" items (AGENTS.md)
| Item | What this plan does | Status |
|---|---|---|
| Map format | Optional `kind` entry field; sea entries have no `owner` (FR-57). Nothing else. | Approved by the user in the spec |
| `MatchState` / `RoundRecord` | Unchanged (types, fields, meaning). Sea zones never appear. | No change |
| Public types of `@mbrg/shared` | `Territory` becomes `LandTerritory`; new `SeaZone`, `MapEntry`, `EntryKind`; `MapData.territories: MapEntry[]` (section 3). Typing of the approved format change, not a new format change. | Decision D1 |
| New dependency | None. | — |
| Deleting files | None. No golden file is deleted or regenerated. | — |
| `@mbrg/sim` public API | Unchanged; the FR-81 operation lives in internal code, not exported (the exact-export test stays as is). | — |

## 2. Files and responsibilities
```
packages/shared/src/
  types.ts                LandTerritory, SeaZone, MapEntry, MapData                 FR-57
  kinds.ts        (new)   EntryKind, entryKind(entry), isSeaZone(entry)              FR-58, FR-63
  errors.ts               union: + invalid-kind, + sea-owner, - multiple-initial-territories;
                          VALIDATION_KIND_ORDER = FR-64 table                        FR-64, FR-69
  validate-structural.ts  kind check, owner checks on land only, sea-owner,
                          'kind' allowed field                                        FR-58, FR-61, FR-65..FR-68
  validate-relational.ts  FR-25 removed; factions = own valid owners of land entries;
                          connectivity unchanged (already all entries)                FR-66, FR-69, FR-70, FR-71
  validate.ts             firstPosition handles invalid-kind and sea-owner            FR-62, FR-64
  index.ts                re-export new types and kinds helpers
packages/sim/src/
  internal.ts             initialState skips sea; playRound uses candidates            FR-72, FR-75, FR-79
  candidates.ts   (new)   absorptionCandidates (FR-81), coast/sea-sharing/widening    FR-75..FR-78, FR-81
  (match.ts, rng.ts, types.ts, inputs.ts, index.ts unchanged)
packages/shared/test/     kinds.test.ts (new), validate-sea.test.ts (new); edits listed in section 9
packages/sim/test/
  helpers/sea-maps.ts (new)   seaMap builder + fixtures (sections 7, 8)
  candidates.test.ts  (new)   FR-75..FR-78, FR-81, NFR-7 candidates
  match-sea.test.ts   (new)   FR-60, FR-62, FR-63, FR-72..FR-74, FR-79, FR-80, faction order
  golden-sea.test.ts  (new)   NFR-9 goldens + property tests; NFR-7 001 goldens read raw
  golden/sea-*.json   (new)   4 golden files
  fairness-sea.test.ts, scale-sea.test.ts (new)   NFR-10, NFR-11
  language.test.ts, traceability.test.ts, match.test.ts, ...  edited (section 9)
```
Decision: new code in two new files (`kinds.ts`, `candidates.ts`) instead of growing `validate-structural.ts` / `internal.ts`. `candidates.ts` is internal: `index.ts` does not re-export it. Discarded: putting candidate search in `internal.ts` (mixes the round engine with graph search; harder to review FR by FR).

## 3. Shared types (FR-57, FR-58)
```ts
type TerritoryId = number; type FactionId = number;            // unchanged
interface LandTerritory { id: TerritoryId; owner: FactionId; neighbors: TerritoryId[]; kind?: 'land' }
interface SeaZone      { id: TerritoryId; neighbors: TerritoryId[]; kind: 'sea' }   // no owner
type MapEntry = LandTerritory | SeaZone;
interface MapData { territories: MapEntry[] }
type EntryKind = 'land' | 'sea' | 'invalid';
```
- `entryKind(entry: object): EntryKind` (pure, `kinds.ts`): `!Object.hasOwn(entry, 'kind')` -> `'land'`; value `=== 'land'` -> `'land'`; `=== 'sea'` -> `'sea'`; anything else (undefined present, null, `''`, `'Sea'`, numbers, booleans, lists, objects) -> `'invalid'`. Inherited `kind` is ignored (own-property presence, FR-58). Used by validation; the only place where the kind rule lives.
- `isSeaZone(t: MapEntry): t is SeaZone` = `entryKind(t) === 'sea'` (same own-property rule as validation: an inherited `kind` is not sea, FR-58). Used by sim on validated maps (narrows the union, so `t.owner` is only reachable on land).
- `kind?: 'land'` keeps every 001 map (no `kind`) assignable to `MapData`; runtime validation, not the type, rejects a present `kind: undefined`.
- Decision D1: rename `Territory` to `LandTerritory` and add `MapEntry`. Discarded: keeping the name `Territory` for the union (001 code and readers take "territory" as owned land, inviting `t.owner` on sea zones) and making `owner` optional on one interface (loses the compile-time guarantee that sea has no owner).
- `ValidationError` gains `{ kind: 'invalid-kind'; position: number; id?: TerritoryId }` and `{ kind: 'sea-owner'; position: number; id?: TerritoryId }`; `multiple-initial-territories` is removed from the union (FR-69). `id` omitted (never undefined) when invalid, as in 001.
- `VALIDATION_KIND_ORDER` = FR-64 table: invalid-map, invalid-territories, invalid-territory, invalid-territory-id, invalid-neighbors, duplicate-territory-id, **invalid-kind**, missing-owner, invalid-owner, **sea-owner**, unknown-field, unknown-neighbor, self-neighbor, duplicate-neighbor, asymmetric-adjacency, too-few-factions, disconnected-map.

## 4. Validation (FR-58, FR-61..FR-71, FR-9 and FR-11 as referenced)
**Structural** (changes marked `+`/`~`; input stays `unknown`, every list walked by index, never `forEach`/`every`/`for...of` on possibly sparse input):
```
TERRITORY_FIELDS = ['id', 'owner', 'neighbors', 'kind']                          ~ FR-68
for position in 0..list.length-1:
  t = list[position]; if !isPlainObject(t): invalid-territory (blocking); continue   FR-14 (all elements)
  id check -> invalid-territory-id (blocking)          (any kind)                  FR-15, FR-61
  neighbors check -> invalid-neighbors (blocking)      (any kind)                  FR-16, FR-61
  k = entryKind(t)                                                                + FR-58
  if k == 'invalid': invalid-kind(position, idData)   non-blocking, no owner check + FR-66
  elif k == 'sea':  if hasOwn(t,'owner'): sea-owner(position, idData)  non-blocking + FR-67
  else (land):      missing-owner / invalid-owner exactly as 001                   ~ FR-65
  unknown-field for own keys not in TERRITORY_FIELDS (so 'owner' and 'kind' never)  ~ FR-68
duplicate-territory-id over valid ids of all object entries (blocking)            FR-20, FR-61
```
`blocking` is set only by the 001 blocking kinds; `invalid-kind` and `sea-owner` use `errors.push`, never `block` (FR-64, FR-66). Therefore whether the relational phase runs is the same as 001 for every map (NFR-8).

**Relational** (precondition unchanged: dense list of objects with unique valid ids and valid neighbor lists; entries may be land, sea or invalid-kind):
```
neighbor checks (FR-21..FR-24): unchanged, over every entry of any kind          FR-61, FR-66
factions = Set of t.owner for t with entryKind(t)=='land' && hasOwn(t,'owner') && isValidId(t.owner)  ~ FR-70
  (FR-25 block deleted)                                                           FR-69
if factions.size < 2: too-few-factions(size)                                       FR-70
connectivity: unchanged BFS over all entries, mutual links only                   FR-71, FR-62
```
Note: 001 reads `t.owner` without `Object.hasOwn` in the relational phase, so an inherited valid owner (non-JSON input) counts as a faction while the structural phase reports `missing-owner`. Reading the owner as an own property fixes this, matching 001 FR-26 and 002 FR-70 (decision D4).

**Sort** (`validate.ts`): `firstPosition` returns `e.position` for `invalid-kind` and `sea-owner` too. Kind rank comes from the new `VALIDATION_KIND_ORDER`. Ties keep emission order (stable sort), as in 001.

Coverage: FR-58, FR-61, FR-64..FR-68 structural; FR-66 (relational part), FR-69, FR-70, FR-71 relational; FR-62 (error positions and group order follow entry positions, sea included) and FR-63 (adding `"kind": "land"` changes nothing: `entryKind` = land either way, and `kind` is an allowed field) by construction.

## 5. Simulation (FR-72..FR-81)
**Faction derivation and state (FR-72, FR-73, FR-80).** `initialState(map)` walks `map.territories` by index and emits `[id, owner]` only for `!isSeaZone(t)`. Everything else derives from `state.owners`, so with no change: `livingFactions` = land owners in faction order (Definitions, FR-35); `totalRounds` = land factions − 1 (FR-80); `ownerOf(state, seaId)` = `undefined`, same as an unknown id (FR-72); `transferred` lists land ids only (FR-79); `MODE` stays `classic` (FR-74).

**Candidates (`candidates.ts`, FR-75..FR-78, FR-81).**
```ts
type Candidates =
  | { how: 'direct'; factions: FactionId[] }
  | { how: 'widened'; distance: number; factions: FactionId[] }   // distance >= 1
  | { how: 'none'; factions: [] };
function absorptionCandidates(map: MapData, state: MatchState, faction: FactionId): Candidates
```
Pure; takes no RNG and no seed (structurally cannot consume draws). Precondition: `faction` is living in `state` (throws a programming error otherwise, like `playRound` with < 2 factions). Map: one that passed every check except connectivity.
```
owner   = Map(state.owners)                 // land only; sea ids -> undefined
entry   = Map(id -> map entry)
linked(a, b) = a.id != b.id && a.neighbors.includes(b.id) && b.neighbors.includes(a.id)
found = Set<FactionId>()
toucher(z):   for n in z.neighbors: m = entry(n); if m && !sea(m) && linked(z, m)
                and owner(m.id) !== faction: found.add(owner(m.id))
-- direct (FR-76)
coast = [] (map order of discovery, deduplicated)
for t in map.territories (index walk) with owner(t.id) === faction:
  for n in t.neighbors: m = entry(n); if !m or !linked(t, m): continue
    if sea(m): add m to coast
    else if owner(n) !== faction: found.add(owner(n))      // land-neighbor factions (= 001)
for z in coast: toucher(z)                                  // sea-sharing factions
if found: return { how: 'direct', factions: order(found) }
-- widening (FR-77), breadth-first one sea hop per step
visited = Set(coast ids); frontier = coast; d = 0
loop:
  next = sea zones m linked to some z in frontier, not visited (mark visited)
  if next empty: return { how: 'none', factions: [] }        // FR-78
  d += 1; for z in next: toucher(z)
  if found: return { how: 'widened', distance: d, factions: order(found) }
  frontier = next
order(found) = livingFactions(state).filter(f => found.has(f))   // faction order, each once
```
- Each faction appears once however many zones/links reach it, and nothing is weighted (FR-75). Zones reached at distance < d were already checked empty, so testing only `next` gives exactly "touches a zone in the sea reach at d".
- Landlocked faction (empty coast) with no land neighbours: no sea distance exists, returns `none` (FR-78; impossible on a connected map, spec Edge cases).
- On a map without sea zones `coast` is empty, so `found` is exactly 001's `neighborFactions` set and `order` is the same expression: `direct` with the same list, or `none` exactly where 001 returned `isolated-faction` (FR-76, NFR-7).
- Cost per call: O(entries + links); NFR-11 map: ~600 entries × 499 rounds × 2 calls (getState + getRounds), well under 1 s.
- `neighborFactions` stays (001 FR-36 tests use it) as "land-neighbor factions"; it already ignores sea ids because `owner(seaId)` is undefined.

**playRound (FR-75, FR-78, FR-79).** Only the candidate line changes:
```
rng = roundRng(seed, k); E = living[pickIndex(rng, living.length)]          // draw 1, as 001
c = absorptionCandidates(map, state, E)
if c.factions.length == 0: return isolated-faction(E, k)                    // FR-78, as 001
A = c.factions[pickIndex(rng, c.factions.length)]                           // draw 2, as 001
```
Decision: compute candidates in a separate pure function and keep the two `pickIndex` calls in `playRound`. Discarded: picking per distance while widening (extra draws, breaks FR-75 and NFR-7).

## 6. PRNG consumption analysis (FR-75, NFR-7)
- Each round k builds a fresh stream `roundRng(seed, k)` (sfc32 + 15 discards); nothing carries between rounds.
- Draws per round: `pickIndex(rng, |living|)` then `pickIndex(rng, |candidates|)`; each consumes 1 uint32 plus a rejection redraw with probability < n / 2^32. Candidate search takes no RNG argument, so widening can never consume draws.
- Maps without sea: |living| and the candidate list (content and order) are identical to 001 in every round (section 5), so both picks return the same indices and every state and record is deep-equal (NFR-7). Proven by the unchanged 001 goldens plus the NFR-7 candidate test.
- Maps with sea: same procedure; only the candidate list differs. Verified by a test that replays the two draws by hand (`roundRng`, `livingFactions`, `absorptionCandidates`, `pickIndex`) and checks the recorded eliminated/absorber for seeds 0..199 on a widening map (T7).

## 7. Golden strategy (NFR-7, NFR-9, FR-51)
- **001 goldens are frozen.** `pair-seed0`, `hand8-seed42`, `grid5x5-seed4294967295`, `sfc32-seed0` are never regenerated and never edited. `golden.test.ts` and `rng.test.ts` stay byte-identical except titles if a task requires it (none planned). Never run `npx vitest -u` without a file filter in this spec; new goldens are written only with `npx vitest -u packages/sim/test/golden-sea.test.ts`, then `git diff --exit-code -- packages/sim/test/golden` must be empty for the four 001 files and `git status` must show only the new `sea-*.json` files. CI never writes snapshots, so a drift fails CI.
- **NFR-7 / FR-63 with `kind: "land"`.** `golden-sea.test.ts` reads the 001 golden files read-only (`import.meta.glob('./golden/*.json', { query: '?raw' })`), and asserts that `getRounds` on pair / hand8 / grid5x5 with `"kind": "land"` added to every entry (and to every other entry) deep-equals `JSON.parse(golden)`. Discarded: pointing a second `toMatchFileSnapshot` at the 001 files (a `-u` run could rewrite them).
- **New goldens (NFR-9, at least 4 pairs)**, maps in `helpers/sea-maps.ts`, files `golden/sea-<name>-seed<S>.json`, full `getRounds(map, S, T)` pretty-printed like 001:
  | Name | Map sketch | Property at round k (via `getState(k-1)` + `absorptionCandidates`) |
  |---|---|---|
  | `sea-isles` | 3-faction continent line A-B-C; island factions D (on zone S1 with A) and E, F (on S2 with C) | (i) eliminated has no land-neighbor faction, `how: 'direct'`, recorded absorber is sea-sharing |
  | `sea-denmark` | Germany G (land to Denmark's Jutland, no coast on K), Denmark Dk = Jutland + Zealand (Zealand on Kattegat K), Sweden Sw on K, Poland P land to G | (ii) direct candidates contain a land-only faction (G) and a sea-only one (Sw) |
  | `sea-ocean` | chain S1-S2-S3-S4, S2 and S3 open ocean; island factions X, Y on S1, Z, W on S4; one coastal continent pair | (iii) `how: 'widened'`, `distance >= 2` |
  | `sea-japan` | faction J owns 3 islands on 3 different zones (no J land link between them); continent factions | (iv) map assertion: J's islands not linked through J's land at round 0; record k transfers >= 2 territories |
  Seed S and round k: the implementer searches seeds 0..999 once with a throwaway local script (not committed) for the smallest S where the property holds at some round, then hard-codes S and k with a comment. Each map is also asserted valid and its T checked.
- **Exact-distance fixtures (NFR-9 tail)**: hand-built maps + states in `candidates.test.ts` giving `widened` with distance exactly 1 and exactly 2.

## 8. Fixtures for NFR-10 and NFR-11
- `seaMap(entries)` builder: entries `{ id, owner?, sea?, links }`, symmetric links added both ways; sea entries get `kind: 'sea'` and no `owner`. Same idea as `mapFrom`, which stays untouched (001 goldens depend on it).
- **NFR-10**: land e (E), l (L), s (S), b (B); sea z1, z2. Links: e-l, e-b, e-z1, e-z2, s-z1, s-z2, b-z1. L only land, S only sea (2 shared zones), B both. Round-0 check: `absorptionCandidates(E) = { how: 'direct', factions: [L, S, B] in faction order }`. Then seeds 0..9,999, `getRounds(map, seed, 1)`, conditioned on `eliminated === E` (~2,500 samples, std. error ~0.9 pp), each candidate 33.3 % ± 5 pp.
- **NFR-11**: land i = 0..499 has id i+1, owner i+1 (500 factions), listed first; sea k = 0..99 has id 501+k, listed after, 10×10 grid row-major, 4-way sea links; sea k linked to land 5k..5k+4. (The spec's "numbered 0 to 499" are labels; ids start at 1 because 0 is reserved.) Test asserts validity, no land-to-land link, T = 499, and `validateMap + totalRounds + getRounds(T) + getState(T)` under 1000 ms with `performance.now()`.

## 9. Test migration from 001 (why each changes)
| File / test | Change | Why |
|---|---|---|
| `shared/test/validate-relational.test.ts` `'FR-25 FR-6 a faction owning several territories ...'` | Retitle `FR-60 FR-69 ...`; expect only `asymmetric-adjacency` + `disconnected-map` | FR-6/FR-25 retired; no `multiple-initial-territories` |
| same, `'FR-26 FR-25 all territories owned by one faction ...'` | Retitle `FR-70 FR-69 ...`; expect only `too-few-factions` 1 | Superseded edge case |
| same, `'FR-5 FR-6 a valid map (one territory per faction ...)'` | Retitle `FR-5 FR-59 ...` (drop FR-6), same assertion | Retired id rejected in titles |
| same, `'FR-9 FR-11 FR-21..FR-27 every relational kind at once'` | Add `FR-64` to title; remove the `multiple-initial-territories` line | FR-64 table |
| `shared/test/ids.test.ts` `'FR-10 kind order ...'` | Retitle `FR-10 FR-64 ...`; expected list = FR-64 table | FR-10 replaced by FR-64 |
| `shared/test/map-shape.test.ts` FR-2 tests | Use `LandTerritory`; assert land keys `id, owner, neighbors` (+ optional `kind`) and sea keys `id, neighbors, kind`; dropping `owner` from a sea entry stays valid | FR-2 refined by FR-57 (NFR-13: refined ids assert new behaviour) |
| `shared/test/validate-structural.test.ts` `'FR-9 blocking errors are flagged ...'` | Add an `invalid-kind` and a `sea-owner` map to `nonBlocking` | FR-64 marks |
| `sim/test/match.test.ts` `'FR-29 a map that fails validation ...'` | Build a one-faction map with `mapFrom([1, 1], ...)`, expect `too-few-factions` (no `.owner` assignment on the union) | Kind removed; type change |
| `sim/test/language.test.ts` | `VALIDATION_KINDS` = FR-64 list (drop `multiple-initial-territories`, add `invalid-kind`, `sea-owner`); `BAD_MAPS` gains entries producing both; comment cites FR-64 / NFR-12 | NFR-12 |
| `sim/test/traceability.test.ts` | Expected = FR-1..FR-81 and NFR-1..NFR-13 minus `RETIRED = ['FR-6', 'FR-25']`; new test fails if a retired id appears in any title; new test that the list contains FR-81, NFR-13 and not FR-6/FR-25; extraction self-test shows `NFR-6` and `FR-60` do not yield `FR-6` | NFR-13 |
| `MEMORY.md` lesson "Test maps with 2+ territories per faction are invalid (FR-6)" | Replace | FR-60 |
Unchanged: `golden.test.ts`, `rng.test.ts`, `fairness.test.ts`, `scale.test.ts`, `purity.test.ts`, `smoke.test.ts`, `internal.test.ts` (its maps have no sea; `neighborFactions` and FR-38 tests stay valid), `helpers/maps.ts`.

Traceability during the work (lesson from 001): T2 introduces `PENDING`, the set of 002 ids not yet covered; the check expects FR-1..FR-81 / NFR-1..NFR-13 minus retired minus `PENDING`. Each task removes the ids it covers from `PENDING`; T10 deletes `PENDING`. The check therefore runs from T2 on and catches gaps early.

## 10. Test strategy (Vitest), FR by FR
- Titles start with the ids they verify; no title contains FR-6 or FR-25.
- `kinds.test.ts`: FR-58 `entryKind` on: no field, `'land'`, `'sea'`, own `undefined`, null, `''`, `'Sea'`, `'neutral'`, 1, true, [], {}; inherited `kind: 'sea'` via `Object.create` is land. FR-57 `isSeaZone`.
- `validate-sea.test.ts`: FR-61 (sea with invalid id, invalid neighbors, sea/land duplicate id, invalid-kind entry with invalid id); FR-64 every structural kind at once (incl. invalid-kind, sea-owner; exact order) and every relational kind at once; FR-65 `kind: 'land'` without owner -> missing-owner; FR-66 invalid-kind + unknown/self/duplicate/asymmetric on the same entry in one pass, invalid-kind + blocking elsewhere -> structural only, invalid-kind as the only bridge -> no `disconnected-map`, only owners on invalid-kind entries -> too-few-factions; FR-67 sea owner 3 / null / present undefined; FR-68 `kind` never unknown-field, `name` on sea and on invalid-kind is; FR-69 multi-territory faction, no error; FR-70 sea and invalid-kind owners never counted, map of only sea -> too-few-factions 0 (+ disconnected), one faction + seas -> 1; FR-71 islands through sea connected, disconnected groups listing sea ids, sea with empty list own group, one-way land-sea link -> asymmetric + split; FR-62 moved sea zone changes only positions/group order; FR-63 `kind: 'land'` added to all / some entries of valid and invalid maps gives identical results; NFR-8 (a) property over the 001 validation fixtures (no `kind`) and (b) one test per listed difference; FR-28 no mutation with sea.
- `candidates.test.ts`: FR-75/FR-76 island through shared zone, Denmark mix, counted once (both land and sea; several zones), landlocked with land neighbours, unshared coast (no widening), lake touched by 2+, bay touched by 1; FR-77 distance exactly 1 and exactly 2, open ocean zones; FR-78 `none` on disconnected maps with and without sea, and `playRound` -> `isolated-faction`; FR-81 return shape, not in `@mbrg/sim` exports, no RNG parameter; NFR-7 candidates direct and equal `neighborFactions` for every round of reference matches on maps without sea, including a multi-territory map.
- `match-sea.test.ts`: FR-72 no sea in states, `ownerOf` sea id undefined (internal and public); FR-73 seas never in records, never counted; FR-74 mode; FR-75 hand replay of both draws (section 6); FR-79 transferred land only, map order; FR-80 T and finish with multi-territory factions; FR-60 multi-territory and exclave maps play; faction order examples Y,X,Y,Z,X -> [Y,X,Z] and Y,Y,Z,X,Z -> [Y,Z,X] with seas interleaved (titled FR-35 FR-60); FR-62 moving a sea zone: states and records deep-equal for seeds 0..99, all rounds; FR-63 match unchanged with `kind: 'land'`; FR-53 JSON round-trip on a sea match.
- `golden-sea.test.ts`: NFR-9 four goldens + four property tests; NFR-7 / FR-63 001 goldens with `kind: 'land'`.
- `fairness-sea.test.ts` NFR-10; `scale-sea.test.ts` NFR-11; purity and language with a sea map (NFR-12, NFR-1).

## 11. Risks
- **Golden drift** (highest impact): a candidate-order or extra-draw bug changes 001 matches. Mitigation: 001 goldens frozen and read-only, NFR-7 candidate test, hand replay of draws, `-u` only with a file filter, `git diff --exit-code` on the four files in T7, T8 and T10.
- **Type ripple**: `MapData.territories: MapEntry[]` breaks any `t.owner` read; compile errors are the checklist (T1). Test helpers building land-only maps stay assignable.
- **Ordering subtleties**: `firstPosition` must include the two new kinds; covered by the every-structural-kind test.
- **Retired id false positives** (`NFR-6`, `FR-60`..`FR-69` contain the text `FR-6`): the retired check reuses the whole-id extractor; self-test covers it.
- **ASCII rule** in `src` (NFR-6 test): do not paste spec symbols (`≥`, `×`, `−`, `→`) into code comments.
- **Seed search for goldens** may need map tweaks if a property never occurs in 0..999; adjust the map, not the property.
- **Perf** on CI: NFR-11 cost is small (section 5), threshold generous.
- **Windows path with spaces**: quote paths in commands; run `CI=1` locally as `$env:CI='1'; npm test` (PowerShell) so snapshots are never written.

## 12. Decisions needing the user (recommended default first)
- D1. Public shared types: rename `Territory` -> `LandTerritory`, add `SeaZone`, `MapEntry`, `EntryKind`; `MapData.territories: MapEntry[]`. Default: yes. Alternative: keep `Territory` as the union name.
- D2. Branch and PR: one branch `feat/002-sea-and-islands` from up-to-date `rewrite`, one commit per task, one PR into `rewrite` after T10, squash merge only with the user's OK (as spec 001, PR #1). Default: yes. Alternative: one PR per task.
- D3. GitHub issues (AGENTS.md workflow): one issue per task T1..T10, referenced in the PR. Default: yes if `gh` is installed, otherwise list the tasks in the PR description.
- D4. Fix the 001 relational read of `owner` (inherited owner counted as faction although reported `missing-owner`) by reading own properties, with a test. Default: yes (matches 001 FR-26 and 002 FR-70; only non-JSON input is affected).
