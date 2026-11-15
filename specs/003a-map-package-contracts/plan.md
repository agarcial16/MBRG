# Plan 003a — Map package contracts
Spec: `specs/003a-map-package-contracts/spec.md` (`Status: approved`). Covers FR-82 to FR-104, FR-106 to FR-110, NFR-15, NFR-18, NFR-19, NFR-22. User decisions applied (section 12): new purity/language test files (002 files untouched), NFR-22 test pins the public exports, −0 channel invalid, adjacency errors by map position, no GitHub issues.

## 0. Starting point (branch `rewrite`, ceb26de)
- `packages/shared/src`: `types.ts` (`LandTerritory`, `SeaZone`, `MapEntry`, `MapData`, `Result`), `errors.ts` (`ValidationError`, `VALIDATION_KIND_ORDER`, FR-64 table), `ids.ts` (`isValidId`, `MAX_ID = 0xffffff`), `kinds.ts` (`entryKind`, `isSeaZone`), `validate-structural.ts` (local `isPlainObject`, own-property reads, walk by index), `validate-relational.ts`, `validate.ts` (`sortErrors`, `validateMap(input: unknown)`), `index.ts`.
- `packages/sim/src`: unchanged by this spec (exact-export test pins `MODE, getRounds, getState, ownerOf, totalRounds`).
- Tests: 311 green; goldens `sim/test/golden/*.json` (4 from 001, 4 `sea-*` from 002). `sim/test/traceability.test.ts` expects FR-1..FR-81 and NFR-1..NFR-13 minus `RETIRED = ['FR-6', 'FR-25']`, pins the self-trace set `FR-55, FR-56, NFR-13`, and scans `packages/*/test/**/*.test.ts`. `sim/test/purity.test.ts` scans `../src/**/*.ts` and `../../shared/src/**/*.ts`. `sim/test/language.test.ts` holds the literal kind list and the ASCII-only check over sim and shared `src`.
- Compiler: `lib: ["ES2022"]` for `src` (no `String.prototype.isWellFormed`, which is ES2024); Unicode property escapes (`\p{...}` with the `u` flag) and `String.prototype.normalize` are available. Node >= 24 (ICU with Unicode 15.1 or later).
- `specs/003a-map-package-contracts/` and `specs/003b-builder-and-dev-map/` are untracked. Only the 003a folder is committed on the feature branch (T1); 003b stays untracked (draft).

## 1. "Ask first" items (AGENTS.md)
| Item | What this plan does | Status |
|---|---|---|
| Map format, map validation | Unchanged. No field added; `validateMap` and its files untouched. | No change (FR-82, NFR-22) |
| `MatchState` / `RoundRecord`, sim | Unchanged; no file under `packages/sim/src` is edited. | No change (NFR-22) |
| New formats (presentation data, id image values) | Typed and checked exactly as FR-84..FR-90 and FR-106..FR-110. | Approved with the spec |
| Public API of `@mbrg/shared` | Additive only: new types, checks and contract functions (section 3). Nothing existing is renamed or removed. | Decision P1 |
| New dependency | None. | — |
| Deleting files | None. No golden is touched. | — |
| 001/002 test files | Only `sim/test/traceability.test.ts` is edited (NFR-19). `language.test.ts` and `purity.test.ts` stay untouched (user decision; NFR-15/NFR-18 use new test files). | NFR-22 |

## 2. Files and responsibilities
```
packages/shared/src/
  package-types.ts   (new)  PresentationData, FactionPresentation, TerritoryPresentation,
                            PresentationList, IdImage, ContactPair, Rgb                 FR-84..FR-86, FR-106, FR-108
  package-errors.ts  (new)  PresentationError, PresentationLocation, PRESENTATION_KIND_ORDER,
                            IdImageError, InvalidImageError, ID_IMAGE_KIND_ORDER       FR-92, FR-110
  names.ts           (new)  isValidName, isValidColor                                  FR-87, FR-88
  faction-order.ts   (new)  factionOrder(map): FactionId[] (round 0, first appearance) FR-102, FR-103, FR-94, FR-101
  presentation.ts    (new)  checkPresentation(map, data)                               FR-89..FR-104
  pixel-codec.ts     (new)  encodePixel(value), decodePixel(r, g, b)                   FR-106
  image-input.ts     (new)  imageInputError(width, height, pixels) -> invalid-image?   FR-110 (invalid-image)
  contact.ts         (new)  contactPairs(width, height, pixels)                        FR-108
  id-image.ts        (new)  checkIdImage(map, width, height, pixels)                   FR-107, FR-109, FR-110
  index.ts                  additive re-exports (section 3)
  (types.ts, errors.ts, ids.ts, kinds.ts, validate*.ts: unchanged)
packages/shared/test/
  helpers/package-fixtures.ts (new)  valid package fixture, presentationFor(map), image(rows, legend)
  names.test.ts                (new)  FR-87, FR-88
  presentation-structural.test.ts (new)  FR-84..FR-86, FR-89, FR-91..FR-99
  presentation-relational.test.ts (new)  FR-90, FR-93, FR-94, FR-100..FR-103
  pixel-codec.test.ts          (new)  FR-106
  contact.test.ts              (new)  FR-108, FR-110 (invalid-image via contact)
  id-image.test.ts             (new)  FR-107..FR-110
  map-package.test.ts          (new)  FR-82, FR-83, FR-104
  package-purity.test.ts       (new)  NFR-15
  package-language.test.ts     (new)  NFR-18 (003a literal lists)
  no-regression.test.ts        (new)  NFR-22 (public exports of shared and sim)
packages/sim/test/
  traceability.test.ts         edited only as NFR-19 requires (section 9)
```
Decision: one file per contract (names, presentation, codec, contact, id image) and a separate `faction-order.ts`. Discarded: adding to `types.ts`/`errors.ts`/`validate*.ts` (001/002 files; mixing would make NFR-22 harder to review and `VALIDATION_KIND_ORDER` must not change). Discarded: importing `livingFactions` from `@mbrg/sim` (shared must not depend on sim) or moving it to shared (edits sim, NFR-22).

## 3. Types and interface (FR-84..FR-88, FR-92, FR-106, FR-108, FR-110)
```ts
type PresentationList = 'factions' | 'territories';
interface FactionPresentation   { id: FactionId; name: string; color?: string }
interface TerritoryPresentation { id: TerritoryId; name: string }
interface PresentationData { factions: FactionPresentation[]; territories: TerritoryPresentation[] }

type PresentationLocation =
  | { at: 'presentation' }
  | { at: 'entry'; list: PresentationList; position: number; id?: number };
type PresentationError =                                   // FR-92 table, `id?` omitted (never undefined) if not valid
  | { kind: 'invalid-presentation' }
  | { kind: 'invalid-presentation-list'; list: PresentationList }
  | { kind: 'invalid-presentation-entry'; list: PresentationList; position: number }
  | { kind: 'invalid-presentation-id'; list: PresentationList; position: number }
  | { kind: 'duplicate-presentation-id'; list: PresentationList; id: number; positions: number[] }
  | { kind: 'invalid-name'; list: PresentationList; position: number; id?: number }
  | { kind: 'invalid-color'; list: 'factions'; position: number; id?: number }
  | { kind: 'presentation-unknown-field'; location: PresentationLocation; field: string }
  | { kind: 'unknown-presentation-id'; list: PresentationList; id: number }
  | { kind: 'missing-presentation'; list: PresentationList; id: number }
  | { kind: 'duplicate-faction-name'; name: string; factions: FactionId[] }
  | { kind: 'duplicate-color'; color: string; factions: FactionId[] };
const PRESENTATION_KIND_ORDER: readonly PresentationError['kind'][]  // table order of FR-92

type InvalidImageError = { kind: 'invalid-image' };
type IdImageError =
  | InvalidImageError
  | { kind: 'unknown-pixel-id'; id: number; pixelCount: number; firstPixel: { x: number; y: number } }
  | { kind: 'missing-territory-pixels'; territory: TerritoryId }
  | { kind: 'missing-adjacency'; a: TerritoryId; b: TerritoryId }
  | { kind: 'extra-adjacency'; a: TerritoryId; b: TerritoryId };
const ID_IMAGE_KIND_ORDER: readonly IdImageError['kind'][]          // table order of FR-110

type Rgb = [r: number, g: number, b: number];
type ContactPair = [a: number, b: number];                          // a < b
interface IdImage { width: number; height: number; pixels: ArrayLike<number> }

isValidName(x: unknown): x is string                                                 // FR-87
isValidColor(x: unknown): x is string                                                // FR-88
checkPresentation(map: unknown, data: unknown): Result<PresentationData, ValidationError | PresentationError>
encodePixel(value: unknown): Result<Rgb, InvalidImageError>                          // FR-106
decodePixel(r: unknown, g: unknown, b: unknown): Result<number, InvalidImageError>    // FR-106
contactPairs(width: unknown, height: unknown, pixels: unknown): Result<ContactPair[], InvalidImageError>  // FR-108
checkIdImage(map: unknown, width: unknown, height: unknown, pixels: unknown): Result<IdImage, ValidationError | IdImageError>
```
- Inputs are typed `unknown` (as `validateMap`): the checks must classify wrong types, not trust them.
- Every function is pure and takes no seed, round, clock or RNG (FR-83, NFR-15). Results on success return the input objects themselves (`value` is the same reference, as `validateMap`); nothing is copied, normalized or repaired (FR-104).
- Decision P1: export all of the above from `@mbrg/shared` `index.ts` (003b and 004 reuse them; FR-106, FR-108 call them contract surface). `factionOrder` is also exported (amended by the user's decision during review: the viewer needs the deterministic faction order of FR-102/FR-103 to assign colours); `imageInputError` stays internal (not exported). Discarded: a separate `@mbrg/shared/package` entry point (new package config for no gain).
- Decision P2: outside their domain, `encodePixel`, `decodePixel` and `contactPairs` return `{ ok: false, errors: [{ kind: 'invalid-image' }] }` (the spec allows `invalid-image` or an equivalent; reuse keeps one kind). Discarded: throwing (the spec says "reports ... returns no result"; every other check here returns `Result`).
- Decision P3: contact pairs as a sorted array of `[a, b]` with `a < b`, ascending by `a` then `b`. Deterministic and JSON-plain. Discarded: `Set<string>` keys (order and key format leak into callers).

## 4. Name and colour rules (FR-87, FR-88)
```
isValidName(x):
  typeof x === 'string'                                        else false
  wellFormed(x): index walk over code units; a high surrogate must be followed by a low one,
                 a low one must follow a high one                                     rule 1
  n = number of code points (for...of over the well-formed string); 1 <= n <= 80     rule 2
  x.normalize('NFC') === x                                                           rule 3
  !/^\p{White_Space}|\p{White_Space}$/u.test(x)                                      rule 4
  !/[\p{Cc}\p{Cf}\p{Cs}\p{Co}  ]/u.test(x)                                  rules 5, 6
  no code point c with 0xFDD0 <= c <= 0xFDEF or (c & 0xFFFE) === 0xFFFE              rule 7 (66 code points)
isValidColor(x): typeof x === 'string' && /^#[0-9a-f]{6}$/.test(x)                  FR-88
```
- Own well-formedness scan instead of `isWellFormed` (ES2024). Discarded: raising `lib` to ES2024 in `tsconfig.base.json` (touches every package config for one call).
- Sources stay ASCII-only (002 language test scans `shared/src`): every special character is written as a `\u` / `\u{...}` escape, never literally. `localeCompare`, `toLowerCase`, `trim` are never used.
- The FR-87 runtime check (Unicode >= 15.1) is a test, not code: `/\p{Cn}/u.test('⿼') === false`.

## 5. Presentation check (FR-89..FR-104)
```
checkPresentation(map, data):
  m = validateMap(map); if !m.ok: return m (exactly the map errors)                FR-91
  if !isObject(data): return fail([invalid-presentation])                          FR-95  (object = non-null, not a list)
  errors = []; blocking = false
  for f of ownKeys(data) sorted by code unit, f not in {factions, territories}:
    presentation-unknown-field({at:'presentation'}, f)                              FR-89, FR-99, FR-83
  for list of ['factions', 'territories']:                                          FR-94 factions first
    v = hasOwn(data, list) ? data[list] : undefined
    if !Array.isArray(v): block(invalid-presentation-list(list)); continue          FR-95
    firstPositions = Map(id -> positions[])                 // insertion order = first position order
    for position in 0..v.length-1 (index walk; holes are not objects):
      e = v[position]; if !isObject(e): block(invalid-presentation-entry); continue FR-96
      id = hasOwn(e,'id') && isValidId(e.id) ? e.id : undefined; idData = id ? {id} : {}
      if id undefined: block(invalid-presentation-id) else record position         FR-96
      if !(hasOwn(e,'name') && isValidName(e.name)): invalid-name(list, position, idData)   FR-97
      if list == factions && hasOwn(e,'color') && !isValidColor(e.color): invalid-color     FR-98
      allowed = factions: [id, name, color]; territories: [id, name]
      for f of ownKeys(e) sorted, f not allowed: presentation-unknown-field({at:'entry', list, position, ...idData}, f)  FR-99
    for [id, ps] of firstPositions with ps.length > 1: block(duplicate-presentation-id(list, id, ps))  FR-96
  if !blocking:                                                                     FR-93
    order = factionOrder(validMap); entryIds = map order of all entries (land and sea)
    factions list (position order): id not in order -> unknown-presentation-id     FR-100
    territories list (position order): id not in entryIds -> unknown-presentation-id
    order minus listed faction ids -> missing-presentation (faction order)          FR-101
    entryIds minus listed territory ids -> missing-presentation (map order)
    group faction entries with id in order and valid name by exact name;
      groups of >= 2 -> duplicate-faction-name(name, ids in faction order),
      emitted by faction order of the group's first faction                         FR-102
    same for own valid colours (absent / invalid colour excluded) -> duplicate-color FR-103
  sorted = stable sort of errors by PRESENTATION_KIND_ORDER rank only
  return errors.length ? fail(sorted) : ok(data)
factionOrder(map): index walk over entries; entryKind == 'land' with own valid owner; first appearance order.
```
- Ordering (FR-94) comes from emission order plus a stable sort by kind rank: top level before `factions` before `territories`, entries in position order, fields in code-unit order, duplicates by first position (Map insertion order), relational kinds emitted in faction / map / first-faction order. Decision: same technique as 001 `sortErrors` for relational kinds. Discarded: a comparator with per-kind keys (needs hidden position data on `unknown-presentation-id` / `missing-presentation`, whose data fields are normative and carry no position).
- `invalid-presentation` returns alone (FR-95); `invalid-presentation-list` for one list does not stop the other list's checks (FR-93 "every structural check").
- Field presence is own-property (`Object.hasOwn`); an inherited `name` counts as missing (`invalid-name`), an inherited `color` as absent (FR-89).
- `isObject` = `typeof x === 'object' && x !== null && !Array.isArray(x)` (Definitions "Object"); a local copy, not exported from `validate-structural.ts` (001 file stays untouched).
- Coverage: FR-84..FR-86 (allowed fields, entry shape), FR-89, FR-91..FR-104.

## 6. Pixel codec (FR-106)
```
encodePixel(v): if typeof v != 'number' || !Number.isInteger(v) || Object.is(v, -0) || v < 0 || v > 0xffffff: invalid-image
                ok([v >> 16 & 255, v >> 8 & 255, v & 255])     // after the check, bit ops cannot wrap
decodePixel(r, g, b): each channel: typeof number, integer, !Object.is(c, -0), 0..255  else invalid-image
                ok(r * 65536 + g * 256 + b)
```
Tests: the seven listed pairs both ways; round trips `decode(encode(v)) = v` for v in {0..1023} plus boundaries and every power of two up to 2^23, and `encode(decode(r,g,b)) = (r,g,b)` for every r, g, b in {0, 1, 127, 128, 254, 255} (216 triples). Discarded: all 16,777,216 values (slow on CI, no extra coverage of a three-line formula).

## 7. Image input, contact and id image check (FR-107..FR-110)
```
imageInputError(w, h, p):                                                           FR-110 invalid-image
  w, h: typeof number, Number.isInteger, >= 1
  p: Array.isArray(p) || (ArrayBuffer.isView(p) && !(p instanceof DataView))
  p.length === w * h
  index walk i in 0..len-1: x = p[i]; typeof number (holes, text, null, BigInt fail), integer, !Object.is(x, -0), 0..0xffffff
  -> { kind: 'invalid-image' } or undefined
contactPairs(w, h, p):                                                              FR-108
  if imageInputError: fail
  keys = Set<number>
  for y, x (row-major): v = p[y*w+x]; if v == 0 continue
    right (x+1 < w): u = p[i+1]; down (y+1 < h): u = p[i+w]
    if u != 0 && u != v: keys.add(min * 2^24 + max)       // < 2^48, exact in a double
  ok(sorted numeric keys mapped to [floor(k / 2^24), k mod 2^24])
checkIdImage(map, w, h, p):                                                         FR-109
  m = validateMap(map); if !m.ok: return m
  if imageInputError: fail([invalid-image])                                         reported alone
  pos = Map(entry id -> map position)
  unknown = Map(value -> {count, firstIndex})  (insertion = first pixel row-major)  unknown-pixel-id
  present = Set(values in pos)
  missing-territory-pixels: entries without a pixel, map order                      FR-107
  contact = contactPairs(...) filtered to pairs with both values in pos             FR-110 note
  linked = for entry a (map order), n in a.neighbors with pos(n) > pos(a): pair    (map is valid: links mutual)
  missing-adjacency: contact pair not linked; extra-adjacency: linked pair not in contact   FR-108
    a = the entry earlier in map order; emitted ordered by (pos a, pos b), map position, not id value (FR-110)
  return errors.length ? fail(errors in kind order) : ok({ width: w, height: h, pixels: p })
```
- One pass over pixels for counts and one for contact: O(W x H + links). No performance requirement here (003b NFR-16), but the algorithm is linear so 003b need not change it.
- Decision: the check calls `contactPairs` (the contract function) instead of its own contact loop, so the builder (003b FR-118) and the check can never disagree. Discarded: a fused single pass (faster, but two contact implementations).
- Typed arrays of any element type are accepted when every value passes the checks (`Uint32Array`, `Float64Array` with integers); `BigInt64Array` fails because its elements are `bigint`.
- Coverage: FR-107, FR-108 (both directions, corner-only, through background, single pair, pieces, strait), FR-109, FR-110.

## 8. Fixtures (`shared/test/helpers/package-fixtures.ts`)
- `image(rows: string[], legend: Record<string, number>)`: ASCII rows to `{ width, height, pixels: number[] }`, `.` = 0. Small grids are for unit cases only (lesson: they hide scale bugs; real scale is 003b).
- `validPackage()`: a sea map with 3 land factions, one faction with two pieces (an island on a sea zone), one sea zone, links exactly equal to the image contacts; `presentationFor(map)` builds a valid presentation (Spanish names, one preferred colour); returns `{ map, presentation, image }`.
- Quadripoint `AB/CD`, background line `A.B`, strait `A S B` (S sea), single-pair contact, exclave and unknown-id images as named constants.
- `deepFreeze` helper for FR-104 tests (frozen inputs must not throw and must stay deep-equal to a `structuredClone` taken before).

## 9. Traceability (NFR-19) and no regression (NFR-22)
Edits to `sim/test/traceability.test.ts` (the only 001/002 test file edited):
```ts
const LAST_FR = 131; const LAST_NFR = 23;
/** NFR-19: 003b ids, not yet required; removed by 003b ("NFR-19 completion"). */
const PENDING_003B = ['FR-105', ...FR-111..FR-131, 'NFR-14', 'NFR-16', 'NFR-17', 'NFR-20', 'NFR-21', 'NFR-23'];
const expected = [FR-1..FR-LAST_FR, NFR-1..NFR-LAST_NFR].filter(not RETIRED, not PENDING_003B);
```
Tests (titles; meta-tests that plant ids name no real id):
- `NFR-13 NFR-19 the expected list ends at FR-131 and NFR-23 and excludes retired and pending ids` (contains FR-110, NFR-22, FR-104; not FR-132, NFR-24, FR-6, FR-25, FR-105, NFR-23).
- `NFR-19 the pending set is exactly the 003b ids` (`toStrictEqual` with the literal list of 28 ids, sorted).
- `NFR-13 NFR-19 this file self-traces exactly the ids it verifies` -> `['FR-55', 'FR-56', 'NFR-13', 'NFR-19']`.
- Existing `NFR-13 every expected requirement id appears in a test name` keeps its assertion (gains NFR-19 in its title).
Decision: change traceability in one late task (T9), after every 003a id has a titled test. Dependency order does not require it first: the current expected list stops at FR-81, so new FR-82+ titles break nothing meanwhile. Discarded: a second, temporary work set (as 002's `PENDING`) from T1 (NFR-19 pins the pending set to exactly the 003b ids, so a second set would be extra churn in the only editable 001/002 file). Mitigation for "ids can hide gaps": each task's done criteria include an `rg` check that its ids appear in test titles.

NFR-22, automated (`shared/test/no-regression.test.ts`, user decision): the test titled NFR-22 asserts the public surface is unchanged: `Object.keys` of `@mbrg/sim` equals exactly `MODE, getRounds, getState, ownerOf, totalRounds`; every runtime export of `@mbrg/shared` that existed before 003a (`VALIDATION_KIND_ORDER, isValidId, MAX_ID, validateMap, entryKind, isSeaZone`) is still exported, and the full sorted list of runtime exports equals that list plus exactly the 003a additions of section 3 (additive only, pinned). `VALIDATION_KIND_ORDER` is checked by its existing 002 test; goldens are guarded by the existing golden tests (CI never writes snapshots).
NFR-22, process check (T9, T10): `git diff --exit-code rewrite -- packages/sim/src packages/shared/src/{types,errors,ids,kinds,validate,validate-structural,validate-relational}.ts packages/sim/test/golden` is clean, and `git diff --stat rewrite -- packages/*/test` shows only new files plus `traceability.test.ts`.

## 10. Test strategy (Vitest), FR by FR
- Titles start with the ids they verify; exact `toStrictEqual` on error lists (field names and order are normative).
- `names.test.ts`: FR-87 every invalid edge case of the spec one by one (`""`, `" España"`, `"España\n"`, 81 code points, decomposed `España`, U+0085, U+2028, U+2029 mid-name, U+200D, U+00AD, U+FEFF, U+E000, U+FDD0, U+FFFE, U+FFFF, U+10FFFF, lone high and lone low surrogate, non-text values); valid: 80 astral code points (160 code units), `"Castilla  y León"`, `"España"`; the 66 noncharacters counted; unassigned non-noncharacter accepted; runtime Unicode 15.1 (`U+2FFC` not Cn). FR-88: valid `#00ff7a`; invalid null, `"#FFFFFF"`, `"#fff"`, `"red"`, `"#00ff7a "`, `"#00ff7a\n"`, 8-digit, number.
- `presentation-structural.test.ts`: FR-95 null, `[]`, 3, `"x"` -> only `invalid-presentation`; lists missing / objects / null; FR-96 element list, null, primitive, hole; bad ids (0, -1, 1.5, "1", missing, inherited); duplicates incl. the 7/3 first-position example; separate namespaces; FR-97/FR-98 with and without valid id ("`id` if valid" omitted, not undefined); FR-99 top-level `version`, `seed`, entry `anchor`, `color` on territory; inherited `name`/`color` (FR-89); every structural kind except `invalid-presentation` at once (exact list and order, FR-94); FR-93 blocking: duplicates + unknown id -> structural only; FR-91 invalid map + bad data -> exactly `validateMap` errors.
- `presentation-relational.test.ts`: FR-90 sea zone entry required; FR-100 faction id equal to a territory id; FR-101; FR-102 participation (unknown id, invalid name excluded), "España"/"españa", faction "Portugal" = territory "Portugal", repeated territory names; FR-103 participation (absent, invalid colour excluded), far-apart factions; every relational kind at once with exact order (FR-94); list order irrelevant (shuffled lists give the same result).
- `pixel-codec.test.ts`: section 6.
- `contact.test.ts`: quadripoint `AB/CD` -> exactly A-B, A-C, B-D, C-D; `A.B` none; single pair; several pieces (union); unknown ids still paired (needs no map); plain list and `Uint32Array` equal results; output sorted with `a < b`; every `invalid-image` input of the edge cases.
- `id-image.test.ts`: each kind with exact data fields; `invalid-image` inputs (W x H mismatch, 16,777,216, -1, 1.5, -0, NaN, `"1"`, BigInt, hole, W `"2"`, plain object, H 0); invalid map -> map errors only; quadripoint with A-D linked -> `extra-adjacency`; through background; strait as sea zone, and direct link across -> `extra-adjacency`; single pair -> `missing-adjacency` when unlinked; exclave valid; unknown id U touching A and B -> one `unknown-pixel-id` only; linked entry with no pixel -> `missing-territory-pixels` + one `extra-adjacency` per link; same image against a map with other links; all kinds at once in table order.
- `map-package.test.ts`: FR-82 and FR-83 exactly as worded; FR-104 deep-frozen inputs to every check and function, deep-equal after.
- `package-purity.test.ts`: NFR-15. The existing 002 scan (glob `../../shared/src/**/*.ts`) already covers the new sources; the new test asserts each new file matches that same glob and runs every new function with throwing `Math.random`, `Date.now`, `performance.now`, `crypto`.
- `package-language.test.ts`: NFR-18 literal lists of the new kinds (FR-92, FR-110) and data field names, copied from the spec; bad inputs produce every kind; every produced key is in the list; no `colour`.
- `no-regression.test.ts`: NFR-22 public exports (section 9).
- Pixel codec and contact: a −0 channel and a −0 value are `invalid-image`.

## 11. Risks
- **Unicode data drift** between runtimes: guarded by the U+2FFC test; names in fixtures use only characters assigned before 15.1.
- **Non-ASCII in `src`** (002 ASCII check): write every special code point as an escape.
- **Ordering subtleties** (FR-94, FR-110): covered by the all-kinds-at-once tests with exact lists.
- **Sparse lists / typed arrays**: index walks only, never `forEach`/`every`/`for...of` on input lists (holes).
- **Late traceability (T9)** could expose a missing title: per-task `rg` checks.
- **Windows path with spaces**: quote paths; run `$env:CI='1'; npm test` so snapshots are never written.

## 12. User decisions (resolved 2026-10-15)
- Purity and language (NFR-15, NFR-18): new test files; the 002 `purity.test.ts` and `language.test.ts` stay untouched (spec wording of NFR-15/NFR-18 aligned).
- NFR-22: the titled test pins the public exports of shared and sim (section 9); goldens stay guarded by the existing tests; the `git diff` check remains a process check in T9/T10.
- FR-106: a −0 channel is invalid in decode (spec clarified). FR-110: adjacency errors ordered by map position of `a`, then `b` (spec clarified).
- Workflow: no GitHub issues; tasks tracked in `tasks.md`; single PR on branch `feat/003a-map-package-contracts` into `rewrite`, one commit per task, squash merge only with the user's OK.
