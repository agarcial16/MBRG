# Plan 003b — Builder and dev map
Spec: `specs/003b-builder-and-dev-map/spec.md` (`Status: approved`, amended in plan review 2026-10-15 without new ids). Covers FR-105, FR-111 to FR-131, NFR-14, NFR-16, NFR-17, NFR-20, NFR-21, NFR-23, and the 003b parts of NFR-18, NFR-19 and NFR-22 (owned by 003a). Delivery: one spec, **two PRs**, tasks as GitHub issues (spec "Delivery"). User decisions of the plan review are in section 14.

## 0. Starting point (branch `rewrite`, 79d1bac)
- Workspaces: `packages/*` only. `packages/shared` exports TS source (`./src/index.ts`) with **extensionless** relative imports (`from './types'`); erasable syntax only.
- Public `@mbrg/shared` runtime exports pinned by `shared/test/no-regression.test.ts`: `validateMap, checkPresentation, checkIdImage, contactPairs, encodePixel, decodePixel, factionOrder, isValidName, isValidColor, isValidId, MAX_ID, entryKind, isSeaZone, VALIDATION_KIND_ORDER, PRESENTATION_KIND_ORDER, ID_IMAGE_KIND_ORDER`. The builder uses only these.
- Config: root `package.json` (`workspaces: ["packages/*"]`, `typecheck` = three `tsc -p`, devDependencies `typescript`, `vitest`); `vitest.config.ts` includes `packages/*/test/**/*.test.ts`; `tsconfig.test.json` includes `packages/*/test` with types `vite/client`; `tsconfig.base.json` `lib: ES2022`, `moduleResolution: bundler`, `verbatimModuleSyntax`. No `@types/node` installed. `.nvmrc` = `24`; CI uses `node-version-file: .nvmrc`. `.gitattributes` = `* text=auto eol=lf` (JSON artifacts stay LF on Windows checkouts). `.gitignore` has no builder entry.
- Traceability (`packages/sim/test/traceability.test.ts`): glob `../../*/test/**/*.test.ts` (packages only); `LAST_FR = 131`, `LAST_NFR = 23`; `PENDING_003B` = 28 ids with a pin test; self-trace pin `FR-55, FR-56, NFR-13, NFR-19`; the "ends at the last spec ids" test asserts `FR-105` and `NFR-23` are NOT expected (must change in PR1).
- 002 purity and ASCII scans cover `packages/*/src` only; the builder needs its own scans (NFR-14, NFR-18).
- `specs/003b-builder-and-dev-map/` is untracked; it is committed as the first commit of PR1.

## 1. "Ask first" items and approved dependencies
| Item | What this plan does | Status |
|---|---|---|
| Map format, presentation format, `MatchState`, sim, shared sources | Unchanged; the builder only produces artifacts. | No change (NFR-22) |
| Id image PNG file format (FR-105) | Exactly as FR-105, checked by our own pre-decode check (section 4). | Approved with the spec |
| New exports of `@mbrg/shared` | None. | Forbidden by the spec |
| Config extensions | Root `workspaces`, root `typecheck`, vitest `include`, test type-check configuration (a builder test tsconfig, section 2), traceability glob, `.gitignore`. No root script, no CI workflow edit, no `.gitattributes` edit. | Spec "Repository placement" |
| Projection, rasterization | **Own code**, no library. Discarded `d3-geo` (resampling/clipping add vertices, against FR-114), `proj4` (heavy, ellipsoid-oriented), canvas libraries (antialiasing, native binaries: NFR-23), `point-in-polygon` (too slow per point, different boundary rule). | Own code (always allowed) |
| Dependencies | Exactly the five below, approved by the user on 2026-10-15. Exact versions pinned in `tools/build-map/package.json` and the lockfile; licences re-checked on npm at install time and recorded in the table (update it in the installing commit if npm says otherwise). | **Approved** |

### Approved dependencies (builder workspace `tools/build-map` only; never in `packages/*` or the viewer)
| Package | Version | Kind | Area (NFR-20) | Licence | Used by | Transitive packages (licences to re-check at install) |
|---|---|---|---|---|---|---|
| `pngjs` | 7.0.0 | dependency | 2 PNG | MIT (re-checked on npm 2026-10-15) | builder (`src/io/png-codec.ts` adapter only) | none |
| `@types/pngjs` | 6.0.5 (installed 2026-10-15) | devDependency | tooling exception (types of an approved library) | MIT | type check | `@types/node` |
| `tsx` | 4.23.15 (installed 2026-10-15) | devDependency | tooling exception (TypeScript launcher) | MIT | `build-map` and `extract` scripts | installed: `esbuild` 0.28.2 (MIT) with its 26 per-platform `@esbuild/*` binary packages (MIT), optional `fsevents` 2.3.3 (MIT); no `get-tsconfig` or `resolve-pkg-maps` in this tsx version |
| `@types/node` | 24.19.2 (installed 2026-10-15; matches `.nvmrc`) | devDependency | tooling exception (runtime type declarations) | MIT | type check of builder src and tests | `undici-types` 7.24.6 (MIT, installed) |
| `shapefile` | 0.6.6 (installed 2026-10-15, user-approved) | dependency | 4 Natural Earth reading | BSD-3-Clause (re-checked on npm at install) | extraction only (`src/extract/read-shapefile.ts` adapter) | installed: `array-source` 0.0.4, `path-source` 0.1.3, `slice-source` 0.4.1, `stream-source` 0.3.5, `file-source` 0.6.1 (all BSD-3-Clause, same author), `commander` 2.20.3 (MIT, its own CLI only), `text-encoding` 0.6.4 (deprecated polyfill; licence `Unlicense` = public domain dedication, LICENSE.md checked; the `(Unlicense OR Apache-2.0)` expression belongs to 0.7.0) |
- `shapefile` ships no TypeScript types and `@types/shapefile` is not approved: an own minimal declaration `src/extract/shapefile.d.ts` (only `open(shp, dbf, { encoding })` and `read()`).
- Risks recorded: `shapefile` is unmaintained since 2017 and depends on the deprecated `text-encoding`; mitigated by using it only in the offline extraction, passing `ArrayBuffer`s only (never paths or URLs: `path-source` can read files and fetch URLs), the synthetic-fixture test, and the manual reproduction from real files. `tsx` brings `esbuild` native binaries that differ per platform; it only strips types of our code (no data transformation), and the CI rebuild test (FR-130) runs under Vitest, not tsx, so artifact bytes do not depend on it. `pngjs` has low release activity (last 2023); its output is checked by our own pre-decode check and the round trip on every build (FR-122).

### NFR-14 boundary for the libraries (flagged)
- `pngjs` loads Node built-ins `stream`, `util`, `zlib`, `assert` and uses `Buffer` at import time (its async API is stream-based). It therefore **cannot live in the scanned pure core** (whose only allowed built-in is `node:zlib` `deflateSync`/`inflateSync`). Boundary, as amended in spec NFR-14:
  - **core (pure, scanned)**: pixel values <-> raw RGB bytes, and `checkPngFile(bytes)`, our own FR-105 pre-decode check (signature, chunk walk with CRC-32, allow-list `IHDR`, `IDAT`+, `IEND`, IHDR fields, `inflateSync` of the joined IDAT data, decompressed length, row filter bytes 0-4). This is the only core use of the `node:zlib` exemption.
  - **adapter (not scanned as core, `src/io/png-codec.ts`)**: `pngCodec = { encode(w, h, rgb), decode(bytes) }` over `PNG.sync.write` / `PNG.sync.read`, both in memory. `decode` always calls `checkPngFile` first and never passes a rejected file to pngjs.
  - `buildInMemory(inputs, codec)` receives the codec as a parameter, so the build still runs from in-memory inputs to in-memory outputs; the NFR-14 throwing-clock test runs it with the real pngjs codec (covers library code).
- `shapefile` imports `path-source`/`stream-source` (file and network capable). It is used only in `src/extract/read-shapefile.ts` (not scanned as pure); the rest of `src/extract` is pure and scanned. NFR-14 does not cover the extraction step; this keeps the pure part testable without files.

## 2. Files and responsibilities
```
tools/build-map/                              (new workspace "@mbrg/build-map", private, type module)
  package.json        dependencies: pngjs (PR2: + shapefile); devDependencies: tsx, @types/node, @types/pngjs; "@mbrg/shared": "*"
                      scripts: "build-map": "tsx src/cli/build.ts", "extract": "tsx src/cli/extract.ts"   FR-111, FR-131
  tsconfig.json       extends base, types ["node"], include src                             (config)
  tsconfig.test.json  extends root tsconfig.test.json, types ["vite/client", "node"], include test (config; root typecheck runs it)
  src/core/           PURE (NFR-14 scan): no fs/clock/random; only node:zlib deflateSync/inflateSync
    types.ts          BuildInputs, BuildParams, SourceFeature, Ring, CountryRecord, GroupingTable,
                      SeaSeed, SourceMeta, PngCodec, BuildError union, BuildOutcome          FR-112
    errors.ts         GROUPING_KIND_ORDER, SEED_KIND_ORDER, sortByKindThenKeys             FR-113, FR-116
    parse-inputs.ts   parseBuildInputs(texts) -> inputs | invalid-input(reason)            FR-112
    crc32.ts, png-check.ts   checkPngFile(bytes) (pre-decode check), toRgb / fromRgb       FR-105, NFR-23
    grouping.ts       checkGrouping(table, provinces, countries)                           FR-113
    numbering.ts      numberEntries(plan, seeds)                                           FR-119, FR-120
    projection.ts     projectionCenter, project, unproject, frameFor, toPixel              FR-114 (FR-131 box check)
    rings.ts          normalizeRing (collapse, zero-area)                                  FR-115 rules 4-5
    rasterize.ts      rasterize(width, layers)                                             FR-115, NFR-23
    sea.ts            seedPixels, assignSeaZones                                           FR-116
    pieces.ts         labelPieces, cleanupPieces (incremental)                             FR-117
    adjacency.ts      buildMapData(width, pixels, entries)                                 FR-118, FR-119
    presentation.ts   buildPresentation(numbered, countries, provinces, seeds)            FR-121
    self-check.ts     selfCheck(map, presentation, width, pixels, png, codec)              FR-122
    json.ts           formatJson(value) -> Uint8Array                                      FR-125
    report.ts         formatReport(facts)                                                  FR-124
    preview.ts        previewColors, previewRgb                                            FR-126
    build.ts          buildInMemory(inputs, codec): BuildOutcome                           FR-112..FR-126
  src/io/             I/O and library adapters, never imported by core
    png-codec.ts      pngCodec over pngjs sync API, checkPngFile before decode             FR-105, NFR-23
    read-inputs.ts    readInputTexts(dataDir)                                              FR-111, FR-112
    fs-ops.ts         FsOps interface + real implementation (node:fs)                      FR-123
    write-package.ts  writePackage(outDir, files, fs)                                      FR-123
  src/cli/
    build.ts          runBuild(args, deps): exit status; main()                            FR-111, FR-123, FR-126
    extract.ts        runExtract(args, deps) (PR2)                                         FR-131
  src/extract/        (PR2)
    read-shapefile.ts adapter over `shapefile` (ArrayBuffers only) -> plain records         FR-131 (not pure-scanned)
    shapefile.d.ts    minimal module declaration
    extract.ts        extract(records, versions, selected, box, decimals) PURE, scanned    FR-131
  data/               (PR2) committed inputs
    natural-earth/provinces.json, countries.json, other-land.json, source-meta.json, PROVENANCE.md   FR-131, NFR-21
    dev-map/grouping.json, sea-seeds.json, params.json, extraction-box.json                          FR-127, FR-131
  out/                gitignored; default preview location                                FR-126
  test/
    helpers/fixtures.ts       in-memory lon/lat fixture "mini" + pixel-space ring helpers + seeded LCG
    helpers/cleanup-direct.ts the literal FR-117 loop (reference, test-only)
    helpers/scan.ts           source scanner (copy of the 002 technique: strip comments/strings)
    helpers/png-bytes.ts      hand-built PNG byte strings (planted chunks, malformed files) for FR-105 tests
    helpers/ne-fixture.ts     (PR2) synthetic Natural Earth SHP/DBF/.cpg/VERSION.txt writer
    libraries.test.ts         NFR-20                     png.test.ts            FR-105, NFR-23
    inputs.test.ts            FR-112 (invalid-input)     grouping.test.ts       FR-112, FR-113
    numbering-names.test.ts   FR-119..FR-121             projection.test.ts     FR-114
    rasterize.test.ts         FR-115, NFR-23             sea.test.ts            FR-116
    pieces.test.ts            FR-117                     adjacency.test.ts      FR-118
    build.test.ts             FR-112, FR-122, FR-124, FR-125   preview.test.ts  FR-126
    command.test.ts           FR-111, FR-123, FR-126     builder-purity.test.ts NFR-14, NFR-23
    builder-language.test.ts  NFR-18 (003b lists)
    scale-probe.test.ts       NFR-16 measurement, PR1 only, no id in title; deleted in PR2
    extract.test.ts           FR-131 (PR2)               dev-map.test.ts        FR-127..FR-129, FR-131 box, NFR-17, NFR-21 (PR2)
    rebuild.test.ts           FR-130, NFR-16 (PR2)
maps/dev/map.json, presentation.json, ids.png          (PR2) committed dev map package     FR-127, FR-128
```
Decisions:
- P1. `src/core` and the pure part of `src/extract` hold all logic; file access and library adapters are in `src/io`, `src/cli`, `src/extract/read-shapefile.ts`. Discarded: steps with I/O mixed in (NFR-14 needs "in-memory inputs to in-memory outputs").
- P2. Dev map package at `maps/dev/` (repo root, outside builder and viewer). Discarded: `apps/web/public/...` (the viewer does not exist; spec 004 decides how to serve it). Confirm at review.
- P3. Committed inputs as JSON (GeoJSON-shaped `FeatureCollection`s, `[lon, lat]`), written by `formatJson`. Discarded: committing shapefiles (binary diffs; would put the shapefile reader into the builder, which NFR-20 forbids).
- P4. No function takes a seed or a round: FR-112 forbids them as builder input. Every function is a pure function of its explicit arguments (inputs, params, codec); determinism comes from fixed iteration orders, never from ambient state.
- P5. Builder test type check in its own `tools/build-map/tsconfig.test.json` so `@types/node` never reaches the type check of `packages/*` tests. Discarded: adding `node` to the root `tsconfig.test.json` types (leaks Node types into the pure packages' tests).

## 3. Interface (TypeScript sketch)
```ts
interface Ring { coords: [number, number][] }                    // lon, lat (source) or u, v (pixel space)
interface SourceFeature { props: Record<string, unknown>; polygons: { outer: Ring; holes: Ring[] }[] }
interface CountryRecord { adm0_a3: string; name?: unknown; name_es?: unknown }
interface GroupingTable {
  countries: { country: string; color?: string }[];
  territories: { key: string; country?: string; provinces: string[]; name?: unknown; color?: unknown }[];
  excluded: string[];
}
interface SeaSeed { name: string; lon: number; lat: number }
interface BuildParams { width: number; margin: number; minPieceSize: number }
interface BuildInputs {                                           // exactly these keys (FR-112)
  provinces: SourceFeature[]; countries: CountryRecord[]; otherLand: SourceFeature[];
  grouping: GroupingTable; seeds: SeaSeed[]; meta: { version: string }; params: BuildParams;
}
interface PngCodec {
  encode(width: number, height: number, rgb: Uint8Array): Uint8Array;
  decode(bytes: Uint8Array): Result<{ width: number; height: number; rgb: Uint8Array }, PngError>;
}
type InputError = { kind: 'invalid-input'; reason: string };     // FR-112, English reason text
type GroupingError =                                              // FR-113, kinds in table order
  | { kind: 'duplicate-country' | 'unknown-country' | 'empty-country'; country: string }
  | { kind: 'duplicate-territory-key' | 'invalid-territory-country' | 'territory-color'
        | 'empty-territory' | 'missing-territory-name'; territory: string }
  | { kind: 'unknown-province' | 'duplicate-province-assignment' | 'unassigned-province'; province: string }
  | { kind: 'province-country-mismatch'; province: string; territory: string };
type SeedError =                                                  // FR-116
  | { kind: 'no-sea-seeds' }
  | { kind: 'seed-outside-frame' | 'seed-not-water'; seed: number; name: string }
  | { kind: 'duplicate-seed-pixel'; seeds: number[]; x: number; y: number };
type PngError = { kind: 'invalid-png' };                         // FR-105, no data field
type BuildError = InputError | GroupingError | SeedError | { kind: 'vanished-entry'; territory: number }
  | ValidationError | PresentationError | IdImageError | { kind: 'png-round-trip-mismatch' } | PngError;
type Artifact = 'map' | 'presentation' | 'image';
type WriteError = { kind: 'write-failed'; artifact: Artifact }
  | { kind: 'partial-write'; replaced: Artifact[]; notReplaced: Artifact[] };       // FR-123
interface PreviewSource { width: number; pixels: Uint32Array; owners: number[]; kinds: ('land'|'sea')[]; colors: (string|undefined)[] }
type BuildOutcome =
  | { ok: true; map: MapData; presentation: PresentationData; pixels: Uint32Array; width: number;
      files: Record<Artifact, Uint8Array>; report: string; preview: PreviewSource }
  | { ok: false; errors: BuildError[]; preview?: PreviewSource };        // preview only after rasterization (FR-123)

parseBuildInputs(texts: Record<InputName, string>): Result<BuildInputs, InputError>
buildInMemory(inputs: BuildInputs, codec: PngCodec): BuildOutcome
checkPngFile(bytes: Uint8Array): Result<{ width: number; height: number }, PngError>
writePackage(outDir: string, files: Record<Artifact, Uint8Array>, fs: FsOps): Result<void, WriteError>
runBuild(args: string[], deps: { fs: FsOps; codec: PngCodec; stdout(s: string): void; stderr(s: string): void }): number
```

## 4. PNG file (FR-105, NFR-23) — pngjs 7.0.0 behind our check
```
toRgb(values): Uint8Array(3 * n) via encodePixel (shared FR-106);  fromRgb(rgb): values via decodePixel
pngCodec.encode(w, h, rgb): PNG.sync.write({ width: w, height: h, data: rgb },
    { colorType: 2, inputColorType: 2, inputHasAlpha: false, bitDepth: 8, filterType: 0,
      deflateLevel: 9, deflateStrategy: 0 })            // every option explicit; no gamma option -> no gAMA
pngCodec.decode(bytes):
  c = checkPngFile(bytes); if !c.ok: return c           // pngjs never sees a rejected file
  img = PNG.sync.read(Buffer.from(bytes), { skipRescale: true })   // returns RGBA, alpha 255
  rgb = drop every 4th byte; return { width, height, rgb }
checkPngFile(bytes):  (core, own code)
  8-byte signature; walk chunks: length (<= remaining), type, data, CRC-32 must match
  chunk types exactly IHDR, IDAT+ (consecutive), IEND; nothing after IEND
  IHDR 13 bytes: w, h >= 1, depth 8, colour type 2, compression 0, filter method 0, interlace 0
  data = inflateSync(joined IDAT data) (throws -> invalid-png); length == h * (1 + 3w); each row filter byte in 0..4
  any failure -> { ok: false, errors: [{ kind: 'invalid-png' }] }
```
- Decision: the FR-105 allow-list and malformation checks are our own code and run before pngjs (pngjs accepts ancillary chunks silently; spec FR-105 "checks run before any pixel decoding"). Discarded: trusting pngjs's parser errors (it ignores unknown ancillary chunks and would decode palette/alpha files).
- Every written file is checked by `checkPngFile` in the FR-122 round trip, so a pngjs output outside FR-105 fails the build (`invalid-png`).

## 5. Inputs, grouping, numbering and names (FR-112, FR-113, FR-119, FR-120, FR-121)
```
parseBuildInputs(texts):                                                   FR-112
  in input order: provinces, countries, otherLand, grouping, seeds, meta, params
  per input: JSON.parse failure, wrong shape/type, W not integer >= 1, margin not finite >= 0, S not integer >= 1,
    non-numeric or non-finite coordinate, seed without text name -> invalid-input { reason } (one per malformed input)
  any invalid-input -> fail before every other check (no preview)
checkGrouping(table, provinces, countries):                                FR-113
  duplicate-country, unknown-country, duplicate-territory-key, invalid-territory-country, territory-color,
  empty-territory, missing-territory-name, unknown-province, duplicate-province-assignment,
  province-country-mismatch, unassigned-province, empty-country   (conditions as the FR-113 table)
  dedupe: one error per distinct (kind, data) (e.g. unknown code listed twice -> one error)
  sort: GROUPING_KIND_ORDER rank, then first data field, then second (territory), code-unit `<` (never localeCompare)
numberEntries:                                                             FR-119, FR-120
  factions = selected codes sorted by code unit -> ids 1..K
  land = by faction order, within a faction by key (code unit) -> ids 1..L; sea = seeds in list order -> L+1..
buildPresentation:                                                         FR-121
  faction: name_es if present else name if present else no field; land: table name if present, else for one
  province name_es / name; sea: seed name; colour only from the table; never trim/normalize/fall back on invalid
```
"Present" = own field holding a non-empty string (spec Definitions).

## 6. Projection and rasterization (FR-114, FR-115, NFR-23)
```
projectionCenter: lon0 = (minLon + maxLon) / 2, lat0 = (minLat + maxLat) / 2 over all non-excluded province vertices
project(lon, lat): LAEA on the unit sphere, north up (R = 1: scale cancels in the frame)
  k = sqrt(2 / (1 + sin f0 sin f + cos f0 cos f cos(l - l0))); X = k cos f sin(l - l0); Y = k (cos f0 sin f - sin f0 cos f cos(l - l0))
unproject(X, Y): standard inverse, used only by the FR-131 box-coverage test
frameFor: bbox of projected non-excluded vertices -> square (shorter side expanded symmetrically) -> + margin * side each side
toPixel(X, Y): u = (X - west) / pixel, v = (north - Y) / pixel; inside iff 0 <= u < W and 0 <= v < W; pixel (floor u, floor v)
```
Rasterization works in continuous pixel space (u, v), so unit tests place centres exactly on edges with dyadic coordinates.
```
normalizeRing(ring in SOURCE coords): collapse consecutive equal vertices (incl. closing duplicate);
  ignored if < 3 distinct vertices or shoelace area == 0 exactly                       rules 4, 5
rasterize(W, layers):  layers = land territories in map order, then OTHER (other land + excluded provinces)
  out = Uint32Array(W*W) = WATER sentinel; edges bucketed by row range, edges outside 0..W culled
  per row y (vc = y + 0.5), per layer in order: mask = union over polygons of [inOuter && !any hole strictlyInside]
    crossings u* = u1 + (vc - v1)(u2 - u1)/(v2 - v1) for edges with (v1 > vc) != (v2 > vc); even-odd between pairs
    boundary = centre equals a crossing of any edge with vc in [vmin, vmax] (incl. vertices; horizontal edges at vc: [umin, umax])
    assign only pixels still WATER: land layer -> id; OTHER -> 0
```
- Decision: scanline over bucketed edges, first in map order wins. Discarded: per-pixel point-in-polygon (too slow at 4.2 M centres), coverage fills (NFR-23).
- Floats: fixed evaluation order; V8's `Math` trig is platform-independent for one V8 version, verified by the CI rebuild test (FR-130) against files built on Windows.

## 7. Sea zones, pieces, adjacency (FR-116, FR-117, FR-118)
```
seedPixels: errors in SEED_KIND_ORDER then seed position: no-sea-seeds; seed-outside-frame; seed-not-water; duplicate-seed-pixel
assignSeaZones: layered multi-source BFS; next-layer WATER pixel takes the MIN seed index among labelled previous-layer neighbours; unreached -> 0
```
Discarded: plain FIFO multi-source BFS (ties go to dequeue order, not to the first seed).
```
cleanupPieces(W, pixels, entries, S):                       incremental
  label 4-connected pieces of non-zero values; per piece value, size, firstIndex; min-heap of pieces < S by (size, firstIndex)
  pop P: contact counts by scanning P's pixels' 4-neighbours
  target land: same-faction land > any land > sea > 0; sea: other sea > 0; best = highest count >= 1, tie -> first in map order
  P's entry would vanish -> vanished-entry(id), stop
  repaint; merge with touched target pieces (union-find); push merged if < S; record for the report
```
- Identity with the literal loop (FR-117): `test/helpers/cleanup-direct.ts` implements the spec loop verbatim; compared on hand fixtures (ties, cascades/merges, every land step 1-4, sea, zero contact, corner-only, vanished-entry) and on 500 seeded generated grids. Discarded: shipping only the direct loop (too slow at 2048).
- `buildMapData` reuses `contactPairs` (003a FR-108); neighbours ascending id (= map order); land `{ id, owner, neighbors }`, sea `{ id, kind: 'sea', neighbors }`. Discarded: own contact loop.

## 8. Assembly, self-check, report, JSON, preview (FR-112, FR-122, FR-124, FR-125, FR-126)
```
buildInMemory(inputs, codec):
  checkGrouping -> fail (no preview)
  numberEntries; frameFor; pixels = rasterize
  seedPixels -> fail WITH preview; assignSeaZones; cleanupPieces -> vanished-entry: fail WITH preview
  map = buildMapData; presentation = buildPresentation; png = codec.encode(W, W, toRgb(pixels))
  selfCheck: validateMap errors alone if any; else checkPresentation errors, then checkIdImage errors,
             then invalid-png / png-round-trip-mismatch from codec.decode(png) vs pixels      -> fail WITH preview
  files = { map: formatJson(map), presentation: formatJson(presentation), image: png }; report = formatReport(...)
```
- `invalid-input` is produced before `buildInMemory` (by `parseBuildInputs`); the CLI reports it and stops (no preview).
- `png-round-trip-mismatch` is tested by a test codec whose `decode` alters one value (the codec parameter is the seam).
- `formatJson(v)` = UTF-8 (`TextEncoder`, no BOM) of `JSON.stringify(v, null, 2) + '\n'`, objects built in FR-125 key order. Discarded: a hand-written serializer.
- Report: English `label: value` lines: `sourceVersion`, `width`, `height`, `projectionCenter` (`lon`, `lat`), `frame` (`west`, `north`, `side`), `factions`, `landTerritories`, `seaZones`, `smallestPiece`, `reassignedPieces` (`entry`, `pixels`, `to` = id or `background`), `excludedProvinces`, `multiPieceEntries`. Numbers via `String(n)`.
- Preview: preferred colours, then sea `#3c6e9e`, background `#cdc6b4`, then a fixed 16-colour palette; any colour already used is skipped (also for sea/background), fallback `#000001` upwards; border pixels `floor(c / 2)`; encoded with the same codec.

## 9. Command and file writes (FR-111, FR-123, FR-126)
```
runBuild(args, deps):    args [--preview[=path]]  (defaults: data tools/build-map/data, out maps/dev, preview out/preview.png)
  texts = readInputTexts(dataDir) (local fixed names; read failure -> invalid-input); inputs = parseBuildInputs(texts)
  outcome = buildInMemory(inputs, deps.codec)
  preview inside the package dir -> usage-error(reason preview-inside-package, preview); return 2, nothing read or written
  fail: preview requested and outcome.preview -> write preview; errors one JSON per line on stderr; return 1
  preview write failure (either path) -> preview-write-failed(preview) JSON line; success path: package untouched, return 1
  writePackage; fail -> print error; return 1;  success: report on stdout; preview if requested; return 0
writePackage:
  write map.json.tmp, presentation.json.tmp, ids.png.tmp (order map, presentation, image)
    failure -> remove temps written; write-failed(artifact)
  rename in the same order
    first rename fails -> remove all temps; write-failed(artifact of that rename)
    later rename fails -> remove the temps not renamed; partial-write(replaced, notReplaced)
```
- `FsOps` = `{ readFile, writeFile, rename, unlink, mkdir }`; tests wrap the real one on a temp dir to fail at the n-th call.
- Preview default `tools/build-map/out/preview.png`; `.gitignore` gains `tools/build-map/out/`.

## 10. Extraction step (FR-131, PR2)
```
runExtract(args): --ne <dir>: reads ne_10m_admin_1_states_provinces.{shp,dbf} + .VERSION.txt and
                  ne_10m_admin_0_countries.{shp,dbf} + .VERSION.txt as ArrayBuffers; selected countries from
                  data/dev-map/grouping.json; box from data/dev-map/extraction-box.json; writes data/natural-earth/*.json
read-shapefile.ts: shapefile.open(shpBuffer, dbfBuffer, { encoding: 'utf-8' }); read all -> GeoJSON features
                   (ring classification by the library); DBF space padding removed (decoding, spec FR-131)
extract(records, versionTexts, selected, box, decimals = 5):   PURE
  version texts per dataset, trailing line breaks removed: missing or different -> invalid-source-version(files sorted)
  fields matched case-insensitively, written lower case
  provinces: admin-1 with adm0_a3 in selected -> { adm1_code, adm0_a3, name, name_es }, whole features
  countries: admin-0 of selected -> { adm0_a3, name, name_es }, no geometry
  other land: per POLYGON of non-selected admin-0 features, kept whole if its own bbox intersects the box -> { adm0_a3 }
  round to `decimals`, collapse consecutive equal vertices, never simplify; sort by adm1_code / adm0_a3; formatJson
```
- Decision: 5 decimals (about 1 m; a pixel is about 1 km). Discarded: 6 (size against 10 MB), 4 (more collapsed rings).
- Per-polygon selection (user decision) keeps Kaliningrad but drops the far parts of the United States, Russia, Norway etc. Clipping only if the output still exceeds 10 MB, stated in `PROVENANCE.md`.

## 11. Traceability (NFR-19 completion) and no regression (NFR-22)
Edits only in `packages/sim/test/traceability.test.ts`; meta-test titles name no id other than NFR-13/NFR-19 (self-trace pin stays `FR-55, FR-56, NFR-13, NFR-19`).
- **PR1, T1**: glob becomes `../../*/test/**/*.test.ts` + `../../../tools/*/test/**/*.test.ts`. New test `NFR-19 the scanned sources include the builder tests`.
- **PR1, T9 (pending set at PR1 merge)**: `PENDING_003B` = exactly `FR-127, FR-128, FR-129, FR-130, FR-131, NFR-16, NFR-17, NFR-21`; pin test `NFR-19 the pending set is exactly the 003b dev map ids` (8-id literal, `toHaveLength(8)`); "ends at the last spec ids": not-contained `FR-132, NFR-24, FR-6, FR-25, FR-127, NFR-21`, contained `FR-105, FR-126, NFR-14, NFR-23`; `everything.size` stays 154.
- **PR2, T15 (at PR2 merge: no pending set)**: `PENDING_003B` and its pin test deleted; `expected` = FR-1..FR-131 + NFR-1..NFR-23 minus `RETIRED`; test `NFR-19 the expected list excludes only the retired ids` asserts equality with that computed list and length 152.
- NFR-22 process check at the end of each PR: `git diff --exit-code rewrite -- packages/*/src packages/sim/test/golden` clean; `git diff --stat rewrite -- packages/*/test` shows only `traceability.test.ts`; `packages/*/package.json` unchanged.

## 12. Measurement (NFR-16), size (NFR-17) and provenance (NFR-21)
- **PR1, T9**: `scale-probe.test.ts` runs one full build of a generated 2048 x 2048 fixture through `runBuild` (inputs written to a temp dir, three artifacts written; about 70 territories, ~200 k vertices, other land, islands, 15 seeds), timeout 300 s, asserts only exit 0, logs `buildMs` and `checksMs` (validateMap + checkPresentation + checkIdImage on the result). Numbers from a local run and the PR1 CI log go to the PR1 description and `MEMORY.md`. Rule: CI build <= 30 s and checks <= 0.5 s -> 60 s / 1 s confirmed; otherwise stop and propose new thresholds through a spec change before T14.
- **PR2**: T12 re-measures on the real dev map; T14 asserts NFR-16 in the rebuild test (one full build, measured from reading the committed inputs to the three artifacts written in a temp dir) and deletes the probe. FR-125 build-twice stays on a fixture (PR1); the dev map is built once per test run.
- Size: T11 measures the extracted data (<= 10 MB; per-polygon selection first, clipping only if exceeded); T13 checks PNG <= 2 MB and JSON <= 500 KB together.
- `tools/build-map/data/natural-earth/PROVENANCE.md`: source (Natural Earth 1:10m admin-1 states/provinces and admin-0 countries), version (from `source-meta.json`), files used, extraction box, per-polygon other-land selection, properties kept, rounding to 5 decimals and collapsing, clipping (only if used), the `extract` command, the Portugal district approximation, licence "public domain, Made with Natural Earth". Natural Earth files are downloaded locally outside the repo and never committed.

## 13. Test strategy (Vitest), FR by FR
Titles start with the ids they verify; exact `toStrictEqual` on error lists. PR1 fixtures are small and in memory; temp directories only in `command.test.ts` and the probe.
- `libraries.test.ts` NFR-20: builder `dependencies`+`devDependencies` minus `@mbrg/*` equal exactly `pngjs`, `tsx`, `@types/node`, `@types/pngjs` (PR2: + `shapefile`), each `^\d+\.\d+\.\d+$` and equal to `package-lock.json`; `tsx` and `@types/*` only in `devDependencies`; installed licence of each in the allowed list; `packages/shared` and `packages/sim` have no non-`@mbrg/*` dependency; no source of shared/sim (and `apps/web` if present) imports an approved package (planted import detected); `pngjs` imported only from `src/io/png-codec.ts`, `shapefile` only from `src/extract/read-shapefile.ts`.
- `png.test.ts` FR-105, NFR-23: codec round trip of a 3 x 3 image with 0, 1, 255, 256, 65,535, 65,536, 16,777,215; written chunks exactly IHDR, IDAT+, IEND and IHDR fields; `invalid-png` for planted `PLTE`, `tRNS`, `gAMA`, `cHRM`, `sRGB`, `iCCP`, `cICP`, `tIME`, `tEXt`, `zTXt`, `iTXt`, depth 16, colour types 0/3/4/6, interlace 1, non-consecutive IDAT, data after IEND, bad signature, CRC mismatch, truncation, bad deflate data, wrong length, filter type 5, width 0; pngjs is not called on a rejected file (spy); filters 1-4 decode.
- `inputs.test.ts` FR-112: each malformed input of the FR-112 list -> one `invalid-input` with English `reason`; several -> input order; `BuildInputs` keys pinned; no seed/round accepted; outputs contain no seed.
- `grouping.test.ts` FR-113: each kind alone; spec edge cases; all kinds at once in table order; code-unit order and the `territory` secondary order; once per distinct data (unknown code listed twice, shared key with colours).
- `numbering-names.test.ts` FR-119..FR-121; `projection.test.ts` FR-114; `rasterize.test.ts` FR-115, NFR-23 (edges, shared vertices, holes, overlapping holes and polygons, orientation, duplicates, zero-area rings, other land, map order, values only from input ids); `sea.test.ts` FR-116; `pieces.test.ts` FR-117; `adjacency.test.ts` FR-118 — as in plan sections 5-7.
- `build.test.ts` FR-112, FR-122, FR-124, FR-125: mini package passes the three 003a checks; FR-122 order (map errors alone; `invalid-name`; `missing-territory-pixels`; `png-round-trip-mismatch` via the altering test codec); report lines; exact JSON bytes of a tiny package (key orders, `[]`, raw `España`, LF, final newline, no BOM); build twice on the fixture -> identical bytes of all three artifacts; `.nvmrc` holds one version and CI uses `node-version-file: .nvmrc`.
- `preview.test.ts` FR-126: preferred colours, pairwise distinct even when preferred colours equal the defaults, darkening `floor(c / 2)`, interior exact.
- `command.test.ts` FR-111, FR-123, FR-126: temp dirs; `fetch` stubbed to throw and a scan of `src/io`, `src/cli` for network modules; failed build leaves previous artifacts byte-identical; write failure at each artifact -> `write-failed`, temps removed; first rename failure -> `write-failed`, temps removed; later rename failure -> `partial-write`, remaining temps removed; preview on a failure after rasterization only; default preview under `tools/build-map/out/` and `.gitignore` has that line; exit statuses; unreadable input file -> `invalid-input`.
- `builder-purity.test.ts` NFR-14, NFR-23: in-memory build with the real pngjs codec while `Math.random`, `Date.now`, `performance.now`, `crypto` throw; scan of `src/core/**` and `src/extract/extract.ts`: no forbidden API, built-in imports only `node:zlib` named `deflateSync`/`inflateSync`, no import of `pngjs`/`shapefile`; exemption list equals exactly those two; planted `node:fs`, `gzipSync`, namespace/default zlib import, `require`, dynamic import, `pngjs` import flagged.
- `builder-language.test.ts` NFR-18 (literal lists): kinds `invalid-input`, `invalid-png`, the 12 FR-113 kinds, 4 FR-116 kinds, `vanished-entry`, `png-round-trip-mismatch`, `write-failed`, `partial-write`, `preview-write-failed`, `usage-error` (+ `invalid-source-version` in PR2); fields `reason`, `country`, `territory`, `province`, `seed`, `name`, `seeds`, `x`, `y`, `artifact`, `replaced`, `notReplaced`, `preview` (+ `files` in PR2); report labels of section 8; every kind produced by bad inputs; ASCII-only `tools/build-map/src`.
- PR2: `extract.test.ts` FR-131 on the synthetic fixture (selection, kept properties, whole features, per-polygon other land incl. a feature with one near and one far polygon, rounding, collapsing, padding removed, metadata, `invalid-source-version` for missing and different texts, two runs byte-identical); `dev-map.test.ts` FR-127, FR-128, FR-129, box coverage (FR-131), NFR-17, NFR-21; `rebuild.test.ts` FR-130, NFR-16 (timeout 180 s, one full build < 60 s, checks < 1 s, JSON bytes equal, decoded pixels equal).

## 14. Decisions of the plan review (user, 2026-10-15) and remaining items
- Dependencies: pngjs 7.0.0, @types/pngjs, tsx, @types/node (PR1), shapefile 0.6.6 (PR2). tsx and @types/* allowed by the amended spec (build tooling exception, NFR-20), builder workspace only.
- O3 `invalid-input` (`reason`) for malformed inputs (spec FR-112). O4 first rename failure = `write-failed`, temp cleanup (spec FR-123). O5 other land per polygon (spec FR-131). O6 one version text per dataset, trailing line breaks ignored (spec FR-131). O7 malformed PNG = `invalid-png`, checks before decoding (spec FR-105). O8 "no runtime dependency" = no third-party dependency (spec NFR-20). O9 FR-113 once per distinct data, secondary order by `territory`; DBF padding removal is decoding (spec FR-113, FR-131). O10 build-twice on a fixture; NFR-16 = one full dev map build with writes (spec FR-125, NFR-16).
- Still to confirm at review (plan choices, not spec gaps): dev map location `maps/dev/` (P2); exact versions of tsx, @types/node, @types/pngjs chosen at install; `text-encoding` licence verified at PR2 install (if not in the NFR-20 list, stop and ask).

## 15. Risks
- Performance at 2048 (scanline in JS): edges outside the frame culled; measured in T9 before PR2.
- PNG bytes may differ across OS/zlib builds: tolerated by FR-125/FR-130 (decoded pixels compared).
- pngjs or a future version writing an extra chunk: caught by `checkPngFile` in every build's round trip.
- `shapefile`/`text-encoding` unmaintained: offline extraction only; fixture test + manual reproduction.
- Grouping-table authoring (about 300 admin-1 codes) is error-prone: FR-113 errors and the preview catch it; the user reviews the preview.
- Windows paths with spaces: quote; `$env:CI='1'; npm test` so snapshots are never written.
