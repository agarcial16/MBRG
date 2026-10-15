# Plan 004 — Viewer
Spec: `specs/004-viewer/spec.md` (`Status: approved`). Covers FR-132 to FR-161 and NFR-24 to NFR-29. Delivery: one branch `feat/004-viewer` from an up-to-date `rewrite`, one PR, squash merge with the user's OK and CI green. No GitHub issues (one PR is enough; AGENTS.md).

## 0. Starting point (branch `rewrite`, c105588)
- Workspaces: `packages/*`, `tools/build-map`. No `apps/` directory yet. Root scripts: `test`, `typecheck` only (no `dev`/`build` yet, although AGENTS.md lists them).
- `@mbrg/shared` and `@mbrg/sim` export TS source with extensionless imports. Their export lists are pinned by the 003a no-regression test. The viewer uses only: shared `validateMap`, `checkPresentation`, `checkIdImage`, `decodePixel`, `factionOrder`, `entryKind`/`isSeaZone`; sim `getState`, `getRounds`, `totalRounds`, `ownerOf`.
- Dev map: `maps/dev/{map.json, presentation.json, ids.png}`, 2048 x 2048, factions 1..5 (DEU, ESP, FRA, ITA, PRT), 70 land + 17 sea entries, no preferred colours, so T = 4.
- Vitest 5.0.4 runs in Node (no DOM emulation). `vite` 8.3.4 is already in the lockfile as a vitest dependency. `three` is not installed.
- Traceability (`packages/sim/test/traceability.test.ts`): glob over `packages/*/test` and `tools/*/test`; `LAST_FR = 131`, `LAST_NFR = 23`; the count test is pinned at 152; "ends at the last spec ids" asserts `FR-132`/`NFR-24` are NOT expected.
- 003b NFR-20 test (`tools/build-map/test/libraries.test.ts`) already globs `apps/*/src/**/*.ts` for builder-library imports. It does not read any viewer manifest.
- Local Node is now **24.0.0** (`.nvmrc` = `24`, CI takes the latest 24.x). Vite 8 needs Node >= 22.12, so this is fine. `DecompressionStream` is global in Node 24 and in the target browsers, so the viewer's PNG decoder runs unchanged in tests.

## 1. "Ask first" items (user must confirm before T1 installs anything)
| Item | Proposal | Status |
|---|---|---|
| `vite` (development server / bundler) | **8.3.4**, exact, devDependency of `apps/web`. It is the version vitest 5.0.4 already locks, so npm dedupes and no second Vite is installed. Licence MIT. Published 2026-10-08, i.e. 7 days old at install (2026-10-15). | **Confirmed by the user 2026-10-15. Exception to the 14-day rule accepted explicitly by the user (only 7 days old, already in the lockfile via vitest).** |
| `three` (graphics library) | **0.186.1**, exact, dependency of `apps/web`. Licence MIT, no runtime dependencies. Published 2026-09-24 (21 days old at install; 0.186.0 is from 2026-09-08). | **Confirmed by the user 2026-10-15** |
| `@types/three` (type declarations) | **0.186.0**, exact, devDependency of `apps/web` (matches the `three` 0.186 minor). Licence MIT. Brings (installed ranges resolved by the lockfile, licences checked on npm 2026-10-15 against the 003b NFR-20 list): `fflate` 0.8.3 MIT, `@types/webxr` 0.5.24 MIT, `meshoptimizer` 1.1.1 MIT, `@types/stats.js` 0.17.4 MIT, `@tweenjs/tween.js` 23.1.3 MIT, `@dimforge/rapier3d-compat` 0.12.0 Apache-2.0. All are on the list. Not covered by NFR-26 as first written; **spec amended (decision Q6) mirroring the 003b build-tooling exception.** Discarded: an own minimal `src/render/three.d.ts`. | **U1 approved by the user 2026-10-15 (option A)** |
| `@types/node` | Not added to the viewer. Viewer tests read committed files through Vite imports (`?raw` for JSON, `?inline` for the PNG as a base64 data URL decoded with `atob`), so no Node types are needed. | No change |
| Any other library (DOM emulation, browser automation, UI framework, PNG decoder) | None (spec). | Forbidden |
| Map format, presentation, id image, `MatchState`, shared/sim exports | Unchanged (NFR-29). | No change |
| Config extensions (spec) | Root `workspaces` + `apps/web`; root scripts `dev`, `build` (delegating to the workspace), `typecheck` + two `tsc -p` for `apps/web`; vitest `include` + `apps/*/test/**/*.test.ts`; traceability glob + `apps/*/test`. `.gitignore` already has `dist/`. No CI workflow edit. | Allowed by spec |

| `lightningcss` (+ its platform packages), transitive dev dependency of `vite` 8 | Licence **MPL-2.0**, not on the 003b NFR-20 allowed list. Already in the lockfile since 001 via vitest/vite; dev-only build tooling, never shipped in the viewer bundle. **Accepted by the user 2026-10-15 for build tooling only**: it may stay as a transitive dev dependency; it must never be a direct dependency nor be imported by sources. Why: removing it is impossible without dropping vite, and MPL-2.0 is file-level copyleft that does not affect our code. | **Accepted by the user 2026-10-15** |

Licences are re-checked on npm at install time (allowed list as in 003b NFR-20) and recorded in this table in the installing commit, transitive packages included (three has no runtime dependencies; vite's are already in the lockfile).

## 2. Files and responsibilities
```
apps/web/                                   new workspace "@mbrg/web", private, type module
  package.json        dependencies: three (exact), @mbrg/shared, @mbrg/sim; devDependencies: vite (exact), [@types/three exact, U1]
                      scripts: "dev": "vite", "build": "vite build", "preview": "vite preview"           FR-132
  index.html          <html lang="es">, a canvas and an empty panel container; no visible text (NFR-28)
  vite.config.ts      root apps/web; no plugins; build.target es2022                                   FR-132
  tsconfig.json       extends base, lib ES2022 + DOM, types ["vite/client"], include src
  tsconfig.test.json  extends root tsconfig.test.json, include test (types vite/client only)
  src/core/           PURE (NFR-25 scan): no DOM, no three, no clock, no randomness, no fetch
    strings.ts        STRINGS: every Spanish UI text and message template                              NFR-28 (scanned as the only text module)
    camera.ts         fitScale, initialCamera, screenToMap, mapToScreen, panTo, zoomAt, clampCamera,
                      resizeCamera, MAX_SCALE = 32, WHEEL_BASE = 1.2                                   FR-144..FR-149
    address.ts        parseAddress(search, total, image, viewport), formatAddress(scene)                 FR-150, FR-151, FR-153
    navigation.ts     navigate(n, total, action), parseTypedRound(text, total), controlsState(n, total)  FR-154
    theme.ts          PALETTE (12), SEA, BACKGROUND, BORDER_COLORS, BORDER_WIDTHS, TERRITORY_LINE params FR-139, FR-142, FR-143
    colors.ts         assignFactionColors(map, presentation, palette) -> Result<Map<faction, rgb>, error> FR-141
    lines.ts          smoothstep, territoryOpacity(scale, params), territoryLineColor(rgb, darken)       FR-138, FR-140
    png.ts            decodeIdPng(bytes, inflate) -> Result<{width, height, values: Uint32Array}>       FR-134
    package.ts        checkPackage(map, presentation, w, h, values) -> errors (validateMap, checkPresentation, checkIdImage) FR-133
    entries.ts        buildEntryIndex(map, values) -> { indexOf, ids, kinds, indexPixels: Uint8Array RG }; ownerTable(index, owners) FR-134, NFR-24
    capabilities.ts   checkCapabilities({ webgl2, maxTextureSize }, w, h, tableSize)                    FR-135
    borders.ts        fillClass, borderClass(a, b, index, owners), REFERENCE: renderReference(...)       FR-136..FR-140
    scene.ts          sceneAt(pkg, seed, n, sim) -> displayed scene | error; legend; roundSummary; pointerInfo FR-152, FR-156, FR-157, FR-160
    perf.ts           frameStats(samples) -> { median, p95 }; ring buffer of 120                         FR-158
    review-set.ts     REVIEW_SET: the NFR-27 scenes (label, seed, round, x, y, zoom)                     NFR-27
  src/render/         THREE.JS, never imports @mbrg/sim, no seed anywhere (FR-159 scan)
    shader.ts         GLSL3 vertex/fragment sources (port of core/borders.ts)                           FR-136..FR-140
    map-scene.ts      createMapScene(index, factionColors, theme) -> { scene, camera, material, setOwners(table), setView(view) } FR-134, NFR-24
    renderer.ts       attachRenderer(canvas, mapScene) -> { resize, draw, maxTextureSize }               FR-135
  src/ui/             DOM shell (thin; not unit-tested beyond scans)
    main.ts           startup: load -> check -> sim scene -> render; error screen                       FR-132, FR-133, FR-135, FR-151, FR-152
    load.ts           fetch of the three package URLs (Vite `?url` imports of maps/dev files)             FR-132
    input.ts          pointer drag, wheel, keyboard, reset button                                       FR-145, FR-146, FR-148, FR-154
    panel.ts          debug panel DOM (seed, N/T, record, legend, pointer readout, perf)                 FR-156, FR-157, FR-158
    url.ts            history.replaceState(formatAddress(...))                                          FR-153
    clock.ts          the ONLY clock reads (performance.now) for FR-158                                 NFR-25
  test/
    helpers/grids.ts        tiny ASCII-free id grids and maps (quadripoint, strait, edge, same owner)
    helpers/dev-map.ts      dev map loaded through Vite imports (?raw JSON, ?inline PNG)
    helpers/scan.ts         source scanner (strip comments/strings, as 002/003b)
    libraries.test.ts       NFR-26          strings-language.test.ts NFR-28
    camera.test.ts          FR-144..FR-149  address.test.ts         FR-150, FR-151, FR-153
    navigation.test.ts      FR-154          colors.test.ts          FR-141, FR-142, FR-143
    lines.test.ts           FR-138, FR-140  png.test.ts             FR-134
    package.test.ts         FR-132, FR-133, FR-135, NFR-24   borders.test.ts  FR-136..FR-140
    scene.test.ts           FR-152, FR-155..FR-158, FR-160   anti-spoiler.test.ts FR-159, FR-161
    map-scene.test.ts       FR-134 (texture flags), NFR-24 (round change touches only the owner table)
    purity.test.ts          NFR-25          review-set.test.ts      NFR-27
```
Decisions:
- P1. **Pure core + thin shells.** Every rule the spec makes testable lives in `src/core` and is tested in Node. `src/render` holds only Three.js objects and the GLSL port; `src/ui` holds only DOM wiring. Discarded: logic inside DOM/WebGL code, which cannot be tested without a DOM-emulation or browser-automation library, both forbidden.
- P2. **Seed and round are parameters.** `sceneAt(pkg, seed, n, sim)`, `parseAddress(search, total, ...)` and `navigate(n, total, action)` take them explicitly. `assignFactionColors` takes neither (FR-141). The render layer never receives them (FR-159). The sim is injected as `{ getState, getRounds, totalRounds, ownerOf }`, so FR-160 is tested by recording calls. Discarded: a module-level "current match" object (ambient state, hides which rounds were computed).
- P3. **Map package served from `maps/dev/` unchanged.** `load.ts` imports the three files with Vite `?url`: dev serves them from the repo, build copies them byte-identical as hashed assets, all same-origin. Discarded: copying into `apps/web/public/` (a second copy that can drift from `maps/dev`).
- P4. **Own PNG decoder** (`core/png.ts`): chunk walk with the 003b FR-105 allow-list, IHDR checks, IDAT joined and inflated by an injected `inflate` (browser and Node 24 `DecompressionStream('deflate')`), row unfiltering (types 0-4), then `decodePixel`. It is exact by construction: no colour management, no premultiplication. Discarded: `createImageBitmap` + canvas `getImageData` (browsers may colour-manage or premultiply; FR-134 forbids it) and any PNG library (forbidden).
- P5. **Dense entry index.** At load, every pixel's 24-bit id is mapped to a dense index 0..E (0 = outside, map order 1..E) and packed as 2 bytes (RG8) per pixel. The GPU texture is RG8 unorm with `NearestFilter`; the shader recovers the index with `round(texel * 255.0)`, which is exact for 8-bit unorm. Discarded: R16UI integer textures (Three.js support and driver quirks), and a direct 24-bit id lookup (the table would be 16 M entries).
- P6. **Per-entry tables, owners separate from colours.** Static `kindTable` (outside/land/sea per index) and `factionColorTable` (index -> RGB). Dynamic `ownerTable` (entry index -> faction index), the only texture updated on a round change (NFR-24). Border class compares **owner indexes, never colours**, because two non-candidate factions may share a palette colour (FR-141 step 2, FR-137). Discarded: one colour-per-entry table (would read "same colour" as "same owner").
- P7. **Everything drawn in one fragment shader on one full-screen quad.** The fragment's CSS position gives the map point `p = centre + (frag - viewport/2) / scale`. The view (centre, scale, dpr, viewport) and `territoryOpacity` are uniforms computed in TS from `core/camera.ts` and `core/lines.ts`, so the shader holds no policy of its own. Three.js is used for renderer, `RawShaderMaterial`, `DataTexture`, `PlaneGeometry`, `OrthographicCamera`; colour management is off (`ColorManagement.enabled = false`, `outputColorSpace = LinearSRGBColorSpace`, no tone mapping, `antialias: false`), so the RGB bytes of the theme reach the screen unchanged. Discarded: one mesh per territory (seams; the lesson of the old viewer) and Three.js `OrbitControls` (3D-oriented, own pure camera is testable).
- P8. **CPU reference renderer.** `core/borders.ts` `renderReference(grid, owners, view, theme)` computes, per output pixel, exactly what the shader computes (fill class, border class by offset sampling, width, territory opacity). Unit tests assert FR-136..FR-140 on it; `shader.ts` is a line-by-line port with the same names. Shader/reference parity is checked visually by the T6 screenshots. Discarded: no reference at all (the border rules would then be verifiable only by eye).

## 3. Interface (TypeScript sketch)
```ts
type Rgb = [number, number, number];                                  // 0..255 each
type FillClass = 'land' | 'sea' | 'outside';
type BorderClass = 'faction' | 'territory' | 'coast' | 'sea-zone' | 'outer' | 'shore';
interface Camera { x: number; y: number; scale: number }              // view centre in map units; screen px per unit
interface Viewport { width: number; height: number }                  // CSS px
interface TerritoryLineParams { fadeStart: number; fadeFull: number; maxOpacity: number; darken: number }
interface Theme { palette: Rgb[]; sea: Rgb; background: Rgb; border: Record<Exclude<BorderClass,'territory'>, Rgb>;
                  width: Record<BorderClass, 1 | 2>; territoryLine: TerritoryLineParams }
interface EntryIndex { ids: number[]; kinds: ('land'|'sea')[]; indexOf: Map<number, number>;
                       width: number; height: number; indexPixels: Uint8Array /* RG8, row-major */ }
interface SimPort {                                                   // injected (P2)
  totalRounds(map: unknown): Result<number, MatchError>;
  getState(map: unknown, seed: number, round: number): Result<MatchState, MatchError>;
  getRounds(map: unknown, seed: number, round: number): Result<RoundRecord[], MatchError>;
  ownerOf(state: MatchState, territory: number): number | undefined;
}
interface Scene { seed: number; round: number; total: number; owners: Map<number, number>;   // territory -> faction
                  record?: RoundRecord; legend: LegendRow[]; living: number }
type AddressResult = { seed: number; round: number; camera?: Camera; problems: AddressProblem[] };
type AddressProblem = { param: 'seed' | 'round' | 'x' | 'y' | 'zoom'; text: string; reason: 'invalid' | 'out-of-range' | 'repeated' };
type NavAction = 'first' | 'previous' | 'next' | 'last' | { to: number };

fitScale(image: {w: number; h: number}, vp: Viewport): number
zoomAt(cam: Camera, screen: {sx: number; sy: number}, steps: number, image, vp): Camera   // keeps map point under pointer
parseAddress(search: string, total: number, image, vp): AddressResult
formatAddress(seed: number, round: number, cam: Camera): string
navigate(n: number, total: number, action: NavAction): number | 'invalid'
assignFactionColors(map: MapData, presentation: PresentationData, theme: Theme): Result<Map<number, Rgb>, { kind: 'palette-exhausted'; faction: number }>
territoryOpacity(scale: number, p: TerritoryLineParams): number
decodeIdPng(bytes: Uint8Array, inflate: (z: Uint8Array) => Promise<Uint8Array>): Promise<Result<{width; height; values: Uint32Array}, { kind: 'invalid-png' }>>
checkPackage(map, presentation, w, h, values): (ValidationError | PresentationError | IdImageError)[]
buildEntryIndex(map: MapData, w: number, h: number, values: Uint32Array): EntryIndex
ownerTable(index: EntryIndex, owners: Map<number, number>, factionIndex: Map<number, number>): Uint8Array  // per entry only
sceneAt(map: MapData, presentation, seed: number, n: number, sim: SimPort): Result<Scene, MatchError>
renderReference(index: EntryIndex, owners: Uint8Array, colors, theme, cam: Camera, vp: Viewport, dpr: number): Uint8Array // RGBA
```
`palette-exhausted` is a viewer-internal kind shown in the FR-141 message (English identifier, listed in the language test).

## 4. Camera (FR-144 to FR-149)
- `fitScale = min(vp.width / W, vp.height / H)`. Initial camera: centre (W/2, H/2), fit scale. Scale limits: [fitScale, 32]. If fit scale > 32 (huge screen, tiny map), both limits are 32.
- `screenToMap(s) = cam + (s - vp/2) / scale`; `mapToScreen` is its inverse. Drag: at pointer down, store the map point m0; on move, choose a centre so that `mapToScreen(m0) = pointer`, then clamp. Within 1 px holds unless the clamp moves the centre (FR-147 wins; edge case documented in tests).
- Wheel: `steps = -deltaY / 100` for pixel mode (`deltaMode` 1 counts lines x 33, mode 2 pages x 800 before dividing), `newScale = clamp(scale * 1.2^steps)`, and the centre is moved so the map point under the pointer stays fixed. One mouse notch (about 100 px) is one step of 1.2 ("fixed factor per wheel step", decision U4).
- Clamp: centre x in [0, W], y in [0, H] (FR-147). Resize: keep the centre, scale = max(scale, newFit) (FR-148). Reset = initial camera. A round change never calls the camera (FR-149, tested on `sceneAt` output having no camera).

## 5. Address and navigation (FR-150, FR-151, FR-153, FR-154)
- `seed`, `round`: `/^[0-9]+$/` only (no sign, space, exponent, fraction, empty); value via `Number` and then range check (seed <= 4,294,967,295; round <= T). A repeated parameter (`URLSearchParams.getAll(name).length > 1`) is `repeated`. Absent -> defaults 1 / 0. Any seed/round problem -> displayed round 0, the problems listed, no clamping. If the seed is invalid, round 0 needs no seed: `sceneAt` is called with seed 1 for round 0 only, which gives the same state for any seed (001 FR-43), and the panel shows the invalid text.
- `x`, `y`, `zoom`: `/^[0-9]+(\.[0-9]+)?$/`; used only if all three are valid; then clamped (zoom to [fit, 32], centre to the image). Any one invalid -> camera problem, initial camera.
- `formatAddress` writes `?seed=S&round=N&x=X&y=Y&zoom=Z` with x and y to 1 decimal and zoom to 3 decimals. Parse(format(scene)) is the same scene within those decimals (round-trip test). `ui/url.ts` uses `history.replaceState` only (scan: no `pushState`, no `location.assign`/`reload`).
- `navigate`: first -> 0, previous -> n-1, next -> n+1, last -> T; `{to}` valid only if 0 <= to <= T. Out of bounds -> `'invalid'`, round kept. `controlsState(n, T)` gives the disabled flags. `parseTypedRound` uses the same digit rule. The shortcuts are ignored when the event target is an input or textarea (`ui/input.ts`; the pure predicate `shortcutApplies(targetTag)` is tested).

## 6. Theme and colours (FR-139, FR-141, FR-142, FR-143) — proposed values, confirmed at the T10 review
| Role | Value |
|---|---|
| Palette (in order) | `#c0504d` red, `#e8b04b` ochre, `#6aa84f` green, `#8e6bbf` purple, `#e07b39` orange, `#4bb3a7` teal, `#d16fa6` pink, `#a3c24a` lime, `#8b5a3c` brown, `#f2d65c` yellow, `#c98fd6` lilac, `#d4a373` tan |
| Sea fill | `#9cc0dc` |
| Background fill (outside, other land, lakes) | `#bdb8aa` (warm grey, not a water colour) |
| Border `faction` / `outer` | `#4a3b2c` (dark brown) / `#6b655a` (grey-brown) |
| Border `coast` / `shore` / `sea-zone` | `#2f5573` / `#46708f` / `#7fa6c6` |
| Widths (CSS px) | `faction` 2, `outer` 2, `coast` 1, `sea-zone` 1, `shore` 1, `territory` 1 |
| Territory line (initial, tuned in T9) | `fadeStart` 4, `fadeFull` 12, `maxOpacity` 0.30, `darken` 0.65 |
- Dev map result (step 1): DEU red, ESP ochre, FRA green, ITA purple, PRT orange.
- `assignFactionColors`: walks `factionOrder(map)`. Preferred colours are used as given. For the others: step 1 is the first palette colour not used by any already-coloured faction and not equal to any preferred colour of the map. Step 2 is the first palette colour not used by an already-coloured direct candidate at round 0 and not equal to a direct candidate's preferred colour. Otherwise `palette-exhausted`. Direct candidates at round 0 are computed in the viewer from the map: land neighbour owners plus owners of land touching a shared sea zone, as 002 defines. This is a small pure function (no new sim export) and is tested against the 002 definition on fixtures. Colours never depend on seed, round or camera (signature has none).
- Tests check that the palette entries are pairwise distinct, distinct from sea, background and border colours, at least 12 of them, and that none is near-black (each sum of channels > 120). Sea, background and borders must also be pairwise distinct (FR-142, FR-143).

## 7. Loading (FR-132 to FR-135, NFR-24)
1. `load.ts` fetches the three `?url` assets (same origin; no other URL in the sources; scan).
2. `decodeIdPng` (P4) runs, then JSON.parse of map and presentation; any failure is a read error -> error screen (FR-133).
3. `checkPackage` runs `validateMap`, then `checkPresentation`, then `checkIdImage`. If any errors: error screen with count + first `kind`, no drawing (FR-133).
4. `checkCapabilities`: no WebGL2 context -> `no-webgl2`; `maxTextureSize < max(W, H)` or < the entry-table width -> `texture-too-small` (FR-135). Viewer-internal kinds, listed in the language test.
5. `assignFactionColors` (FR-141 error -> error screen), `buildEntryIndex`, `createMapScene`: uploads the index texture once, plus the static tables. Then `sceneAt` -> `ownerTable` -> `setOwners` -> first draw; time recorded (FR-158).
- The RG8 index texture for 2048 x 2048 is 8 MB. Decode + checks + index take about 0.3-0.5 s in JS (003b measured checks at ~0.11 s), within the 2 s of NFR-24.

## 8. Borders: rule shared by reference and shader (FR-136 to FR-140)
For an output pixel at CSS position f with device pixel ratio r:
```
p = cam + (f - vp/2) / scale                     // map point (continuous)
a = indexAt(floor(p))                            // outside (0) if p is outside the image
fill = land ? factionColor[owner[a]] : sea ? SEA : BACKGROUND
for each direction d in (+x, -x, +y, -y):
  for each class width w in (2, 1):              // half-width w/2 CSS px on each side of the edge
    b = indexAt(floor(p + d * (w / 2) / scale))
    if b != a: c = borderClass(a, b); if width[c] == w: candidate(c)
pick the highest-priority candidate: faction > outer > coast > shore > sea-zone > territory
territory: colour = floor(ownerColor * darken), alpha = territoryOpacity(scale), blended over fill
others: opaque class colour
```
- Each side of an edge paints w/2, so the line is w CSS px wide and centred on the edge, at every scale (FR-139). It is continuous along straight runs because the test is per pixel against the neighbouring cell. Corner-only contacts produce no line of their own (quadripoint test).
- `borderClass` uses kinds and **owner indexes** (P6): different owners `faction`, same owner `territory`, land/sea `coast`, sea/sea `sea-zone`, land/outside `outer`, sea/outside `shore`. Outside the image counts as outside.
- `territoryOpacity(s) = maxOpacity * smoothstep(fadeStart, fadeFull, s)` as in the spec Definitions. It is computed in TS per frame and sent as a uniform; non-decreasing in s (property test over a grid of scales).
- At scale < 1 (fit scale on the dev map is about 0.5), sampling picks one cell per pixel, so small pieces may drop out: accepted edge case (no mipmaps, FR-134).

## 9. Debug scene (FR-152, FR-155 to FR-161)
- `sceneAt(map, presentation, seed, n, sim)` calls `sim.totalRounds(map)`, `sim.getState(map, seed, n)` and, if n >= 1, `sim.getRounds(map, seed, n)`, keeping only the last record. It never calls with a round other than n (FR-160, recorded-calls test). Nothing is cached across calls: the UI keeps only the current `Scene`. Legend: faction order, colour, id, name, territory count at n, alive (count > 0). `living` = alive count. The record shows eliminated/absorber names and `transferred.length`.
- A round change is `sceneAt` -> `ownerTable` -> `setOwners` -> `draw()`, all synchronous in one handler. No timer, no tween, no time uniform (FR-155; scan of `src/render` and `src/ui` for `requestAnimationFrame` loops tied to round changes, `setTimeout`, `transition`, time uniforms). Rendering is on demand: frames are drawn on camera change, round change or resize. During continuous drags/wheels a rAF loop runs and records frame times; it is idle otherwise.
- `pointerInfo(index, scene, presentation, mapPoint)` returns coordinates, value, fill class, name and owner name, or the "fuera del mapa" string key for outside (FR-157).
- `frameStats` gives the median and p95 of the last 120 frame intervals. Load time and round-change time are measured by `ui/clock.ts` (FR-158).
- Anti-spoiler scans (FR-159, FR-161): `src/render/**` imports no `@mbrg/sim` and contains no identifier `seed`, `round` or `RoundRecord`. The exported functions of `map-scene.ts`/`renderer.ts` take only index, colours, theme, owner table and view (type-level test with `expectTypeOf`). `src/**` contains no `fetch(` except in `load.ts` (whose URLs are the three `?url` imports), and no `XMLHttpRequest`, `WebSocket`, `sendBeacon`, `EventSource` or `navigator.` network use. The panel is labelled `STRINGS.debugTitle` ("Escena de depuración").

## 10. Language and purity scans (NFR-25, NFR-28)
- NFR-25: scan `apps/web/src/core/**` (comments and strings stripped) for `window`, `document`, `navigator`, `performance`, `Date`, `Math.random`, `crypto`, `fetch`, `requestAnimationFrame`, `setTimeout`, and imports of `three` or any `node:` module. Planted sources must be flagged. `performance.now` is allowed only in `src/ui/clock.ts`. Also a run of `sceneAt`, `assignFactionColors` and `renderReference` while `Math.random`/`Date.now`/`performance.now` throw.
- NFR-28 scan rule (the spec leaves it to the plan): in `apps/web/src/**` except `core/strings.ts`, (a) source is ASCII-only, and (b) no string or template literal containing a space-separated word of 2+ letters is assigned to a DOM text sink (`textContent`, `innerText`, `innerHTML`, `title`, `placeholder`, `ariaLabel`, `setAttribute('aria-label'|'title'|'placeholder', …)`, `alert`, `confirm`). (c) `index.html` has no text nodes other than whitespace, and `document.title` is set from `STRINGS`. `strings.ts` values are non-empty; the test lists the keys and checks that every key is used. Viewer-internal kinds (`palette-exhausted`, `no-webgl2`, `texture-too-small`, `invalid-png`) and `AddressProblem` reasons are English and listed literally.

## 11. Traceability and the 003b manifest test (NFR-26, NFR-29), task T8
- `packages/sim/test/traceability.test.ts`: glob + `'../../../apps/*/test/**/*.test.ts'`; `LAST_FR = 161`, `LAST_NFR = 29`. The "ends at" test becomes: not-contained `FR-162, NFR-30, FR-6, FR-25`; contained `FR-132, FR-161, NFR-24, NFR-29`. The count test goes from 152 to **188** (152 + 30 ids FR-132..FR-161 + 6 ids NFR-24..NFR-29), asserted as a literal. New test `NFR-19 the scanned sources include the viewer tests`. Self-trace pin unchanged (`FR-55, FR-56, NFR-13, NFR-19`).
- `tools/build-map/test/libraries.test.ts` (003b NFR-20, viewer clause only): add `NFR-20 the viewer manifest declares none of the builder libraries` (reads `apps/web/package.json`) and keep the existing `apps/*/src` import scan, now non-vacuous (assert at least one `apps/web/src` file is scanned). No other edit.
- NFR-26 itself is traced in the new `apps/web/test/libraries.test.ts`, written in T1: the viewer's third-party deps are exactly `three` (dependency), `vite` (devDependency) and, if U1 is approved, `@types/three` (devDependency), each exact and equal to the lockfile; installed licences in the allowed list; `three` imported only from `src/render/**`; `vite` only from `vite.config.ts`; no builder library in the manifest; shared/sim still without third-party deps.
- NFR-29 process check before the PR: `git diff --exit-code rewrite -- packages/*/src packages/sim/test/golden maps/dev` clean; `git diff --stat rewrite -- packages tools` shows only the two test files above (plus `package-lock.json` and root config files). Test `NFR-29 the dev map package and goldens are unchanged`: a SHA-256 of the three `maps/dev` files and of the golden files, compared with literals recorded in T8 from the `rewrite` tip.

## 12. Visual verification, tuning and measurement (NFR-24, NFR-27)
- `core/review-set.ts` holds the NFR-27 scenes as literal addresses (seed 1; rounds 0, 1, 2, 4 at fit; zoomed scenes at scale >= 8; territory-line scenes at far (<= fadeStart), mid (strictly between) and near (32)). `review-set.test.ts` checks each against the dev map: every address parses with no problem, and each named point holds what its label says. Balearic point -> a Baleares pixel; Messina -> a sea pixel with Sicilia and Calabria within 20 units; coast/sea-zone -> a `sea-zone` edge within 10 units; lake -> background surrounded by land; faction border -> a `faction` edge at round 0; former border -> an edge between a territory transferred in round 1 and an absorber territory (read via the real sim). The territory-line zooms are tested against the current `TERRITORY_LINE` params (so retuning keeps the set valid).
- Screenshots: taken by the developer in Chrome on the reference PC, browser window with a 1920 x 1080 drawing area, DPR as on that PC (recorded), one per review-set address. They are attached to the PR (not committed, spec Q5) in a table: label, address, what to look at. The user accepts or rejects each. Rejection goes back to theme values (or a spec change if a rule is wrong).
- Territory-line tuning (T9): start from section 6 values. The developer prepares 2-3 candidate sets within the spec ranges (`fadeStart` 2-8, `fadeFull` <= 16 and > fadeStart, `maxOpacity` 0.25-0.35, `darken` 0.5-0.8) with far/mid/near screenshots of the same addresses. The user picks one. The chosen values become literals in `theme.ts`, a test pins them and their ranges, and this plan records them.
- Measurement (T10): FR-158 panel values on the reference PC, with the scripted pan/zoom procedure: 10 s of continuous drag across the map at scale 2, then 10 s of wheel zoom between fit and 32. Record load ms, median/p95 frame ms, round-change ms for 0->1, 3->4, 4->0. If any NFR-24 threshold fails: stop and propose a fix or a spec change.

## 13. Test strategy (Vitest), FR by FR
Titles start with the ids they verify; Node environment; no DOM; exact `toStrictEqual`.
- `camera.test.ts` FR-144..FR-149: fit on 2048x2048 in 1920x1080 (scale 1080/2048, centred); drag keeps the grabbed point within 1 px; zoomAt keeps the pointer point within 1 px for steps in/out; limits fit and 32 (beyond stops at limit); centre clamp after pan/zoom/resize; resize keeps centre, raises scale to new fit; reset; tiny viewport 200x150; FR-149 via `sceneAt` returning no camera and the UI handler signature (no camera argument).
- `address.test.ts` FR-150, FR-151, FR-153: defaults; every spec edge case (`12abc`, `-1`, `1e3`, `4294967296`, `1.5`, `99`, empty, repeated, ` 1`, `+1`, `0x10`); boundaries 0 and 4,294,967,295, round T; camera all-or-nothing, `zoom=1000` -> 32, `x=abc` -> problem + initial; format/parse round trip.
- `navigation.test.ts` FR-154: each action at 0, middle, T; disabled flags; typed round valid/invalid; `shortcutApplies('INPUT')` false.
- `colors.test.ts` FR-141..FR-143: dev map -> 5 first palette colours in faction order; preferred used as given and skipped by others; step 2 when step 1 runs out (fixture with 13 factions, of which a far pair share a colour while candidates differ); `palette-exhausted` names the faction; candidates via land and via shared sea; determinism (twice equal; signature has no seed/round); theme distinctness rules.
- `lines.test.ts` FR-138, FR-140: opacity 0 at <= fadeStart, Amax at >= fadeFull and at 32, smoothstep midpoint = Amax/2, non-decreasing; darken = floor(c*D), black stays black; params inside spec ranges.
- `png.test.ts` FR-134: synthetic PNGs built in the test (CompressionStream) with values 0, 1, 255, 256, 65,535, 65,536, 16,777,215 and filter types 0-4 decode exactly; rejected: PLTE, gAMA, sRGB, iCCP, tEXt, depth 16, colour type 6, interlace, bad CRC, truncated, data after IEND; the dev map PNG decodes to 2048x2048 and passes `checkIdImage`.
- `package.test.ts` FR-132, FR-133, FR-135, NFR-24: `checkPackage` order (map errors only, then presentation, then image); a corrupted value -> `unknown-pixel-id` first kind; capabilities (no WebGL2, max 1024 < 2048); `ownerTable` length = entries + 1 and contains no pixel data; `load.ts` URLs are exactly the three `maps/dev` `?url` imports (scan).
- `borders.test.ts` FR-136..FR-140 on `renderReference` with tiny grids: each class with its colour and width at scales 1, 4, 16, 32 (2 px vs 1 px measured in output pixels, at DPR 1 and 2); no line inside one value; same-owner `territory` faint vs absent by scale; absorption: change the owner table -> former `faction` edge becomes `territory` in the same render; quadripoint; image edge -> `outer`/`shore`; outside area = background; camera moves change positions only (classes equal at shifted coordinates); fill decided from ids even when a palette colour equals the border colour (planted theme).
- `scene.test.ts` FR-152, FR-155..FR-158, FR-160: dev map seed 1: T = 4; owners equal `ownerOf` on `getState`; record of round n only; sim error -> error result with kind; recorded calls equal exactly [(n)] per request, stepping 0->1->2 calls 1 then 2 only, never 3; legend and living counts; panel data of n has no field for rounds > n; `pointerInfo` for land, sea, outside; `frameStats` median/p95 on known samples and the 120 window.
- `anti-spoiler.test.ts` FR-159, FR-161: render scans and type-level signature; network scan; debug title string present.
- `map-scene.test.ts` FR-134, NFR-24 (Three.js objects in Node, no WebGL): index texture `NearestFilter` min/mag, `generateMipmaps false`, `flipY false`, `premultiplyAlpha false`, `colorSpace NoColorSpace`, `unpackAlignment 1`; `setOwners` changes only the owner texture's data and `needsUpdate`, and the index texture version stays the same.
- `purity.test.ts` NFR-25; `strings-language.test.ts` NFR-28; `libraries.test.ts` NFR-26; `review-set.test.ts` NFR-27; traceability/manifest edits NFR-29 (section 11).

## 14. Decisions the user must confirm
- U1. **Approved 2026-10-15 (option A).** `@types/three` 0.186.0 as a viewer devDependency; NFR-26 amended in the spec (decision Q6: three ships no TS types; discarded: own minimal `three.d.ts`).
- U2. **Confirmed 2026-10-15.** `vite` 8.3.4 (already locked by vitest; 7 days old, exception to the 14-day rule accepted by the user), `three` 0.186.1 (21 days old), `@types/three` 0.186.0.
- U2b. **Accepted 2026-10-15.** MPL-2.0 of vite's transitive dev dependency `lightningcss` (and platform packages), for build tooling only (see section 1).
- U3. Palette, sea, background and border colours of section 6 (confirmed again at the T10 review).
- U4. Wheel step: one notch (about 100 px of `deltaY`) = factor 1.2; trackpads scale proportionally.
- U5. Own PNG decoder in the viewer (P4) instead of browser image decoding.
- U6. Map package served from `maps/dev/` through Vite asset imports (P3), not copied.

## 15. Risks
- Shader/reference drift: same names and structure, one rule section (8). Screenshots in T6 and T10 are the check; a mismatch is a bug in the port.
- Shimmer at fit scale (no mipmaps): accepted in the spec; review at fit scale shows it.
- GPU precision of `p` at scale 32 on 2048 units: float32 is enough (2048 * 32 = 65,536 < 2^24). Use `highp`.
- `DecompressionStream` performance for a 12 MB inflate: measured in T10; fallback is chunked reads (no library).
- Vite + TS-source workspaces with extensionless imports: covered by the T1 smoke build.
- Windows path with spaces: quote; `$env:CI='1'; npm test` before commits.
