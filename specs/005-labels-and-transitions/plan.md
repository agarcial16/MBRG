# Plan 005 — Labels and transitions
Spec: `specs/005-labels-and-transitions/spec.md` (`Status: approved`). Covers FR-167 to FR-194 and NFR-32 to NFR-37. Delivery: the existing branch `feat/005-labels-and-transitions` (from `rewrite`), one PR into `rewrite`, squash merge with the user's OK and CI green. No GitHub issues (one PR is enough; AGENTS.md).

**Gate.** Passed 2026-10-16: the user approved the spec, this plan and the tasks; the spec reads `Status: approved` (set on the user's instruction). Amended 2026-10-16 after the T8 review: fixed white ink with a black halo for every label (spec amendment, FR-174; see section 3 "Amendments" and task T4b).

## 0. Starting point (branch `feat/005-labels-and-transitions`, f41f36c)
- Viewer of 004 merged (PR #24): `apps/web/src/{core,render,ui}`. One full-screen quad, one fragment shader (`render/shader.ts`, port of `core/borders.ts` `shade`), four data textures (index RG8, kinds R8, owners R8, colours RGBA8). A round change is synchronous: `sceneAt` -> `ownerTable` -> `setOwners` -> `draw` (`ui/main.ts`). rAF is used only in `ui/main.ts` to coalesce camera draws. Clock reads only in `ui/clock.ts` (`now()`).
- Dev map: 2048 x 2048, 5 factions (DEU, ESP, FRA, ITA, PRT), 70 land + 17 sea entries, seed 1 gives T = 4; round 1 = Alemania absorbed by Francia. Fit scale on 1920 x 1080 is about 0.527.
- Traceability (`packages/sim/test/traceability.test.ts`): ranges `FR [[1, 166]]`, `NFR [[1, 31]]`, 197 ids, 195 expected; the "ends at" test asserts `FR-167` and `NFR-32` are NOT expected.
- 004 guards this spec must respect (read before coding):
  - `anti-spoiler.test.ts` FR-159: no identifier containing `seed` or `round` in `src/render/**` (only `Math.round` exempt; `background`, `around`, `roundRect` are flagged), no `seed` in render text, no import of scene/address/navigation/perf/ui from render.
  - `anti-spoiler.test.ts` FR-155: the words `transition`, `lerp`, `animate`, `animation`, `tween`, `keyframes`, `setTimeout`, `setInterval` (whole words) anywhere in `src/**`, uniforms named `progress`/`uProgress`/`uTime`/`uMix`, and rAF outside `src/ui/` are violations. Amended in T1 (section 10).
  - `strings-language.test.ts` NFR-28: every `kind: '<literal>'` in a viewer source must be in its `INTERNAL_KINDS` list. That test is NOT on the NFR-35 list of editable tests, so **new sources never write `kind:` with a string literal** (the label field is called `role`).
  - `borders.test.ts` FR-137: `core/borders.ts` must not contain `luminance`/`brightness`. Since the 2026-10-16 amendment there is no contrast rule at all (fixed ink, D15), so nothing new may compute a luminance; the 004 test stays untouched.
  - `map-scene.test.ts` FR-159 type test pins `createMapScene(EntryIndex, readonly Rgb[], MapTheme)`, `setOwners(Uint8Array)`, `setView(MapView)`, `keyof MapView`, `attachRenderer(HTMLCanvasElement, MapScene)`: all kept; new capabilities are new members/functions.
  - `scene.test.ts` FR-155 pins the keys of `Scene`: `Scene` is NOT changed; transition data lives outside it.
  - `review-set.test.ts` NFR-27 checks the 004 set: the label/transition scenes go into a new module, so that test is untouched.

## 1. "Ask first" items
| Item | Proposal | Status |
|---|---|---|
| New dependency | **None** (NFR-36). Text is drawn with the browser's Canvas 2D API; the colour front uses the existing Three.js. | No change |
| Map format, presentation data, id image, `MatchState`, `RoundRecord`, shared/sim exports | **Unchanged** (spec "Compatibility"). The viewer reads names from `presentation.json` (003a). | No change |
| Edits to earlier tests | Only those NFR-35 allows: the FR-155 scan (explicit list, section 10), the NFR-25 clock rule (not needed: see D9), the NFR-24 / FR-140 tests (not needed: new textures and methods are added beside the pinned ones, see D6), the traceability test. | Allowed by spec |
| `apps/web/index.html` | One more element: a second canvas `labels` over the map canvas (no text). | Allowed (not an ask-first item) |
| Files outside `apps/web`, `packages/sim/test/traceability.test.ts` and `specs/005-*` | None. | No change |

## 2. Files and responsibilities
```
apps/web/
  index.html                  + <canvas id="labels"> between #map and #panel, pointer-events:none     FR-173
  src/core/                   PURE (NFR-25 / NFR-33 scan applies to every new file)
    label-params.ts           LABEL_PARAMS (labelFont, M, Hmax, P, L0, L1, Dt), fontString(px)           FR-169, FR-172, FR-182
    regions.ts                buildPieceIndex(grid), regionsOf(pieces, owners), mainRegions, mainPieces  FR-167, FR-168, FR-171, FR-189
    label-layout.ts           fitLabel(pieces, pieceSet, aspect, params), territoryBoxes(...),
                              factionBoxes(pieces, owners, aspects, params, previous?)                   FR-169, FR-170, FR-171, FR-189
    label-frame.ts            LABEL_INK (#FFFFFF), LABEL_HALO (#000000), labelOpacity(role, scale, params),
                              labelsAt(input, f), instantLabels(round), screenBox(box, cam, vp),
                              drawable(label, scale, params)                                  FR-172, FR-174, FR-175, FR-181, FR-189
    label-input.ts            labelTexts(map, presentation, factionIndex), roundLabels(texts, table, boxes,
                              territoryBoxes): names + boxes of one round, no colours (added in T8)     FR-167, FR-168, FR-171, FR-174
    front.ts                  transferredPieces, contactSet, seedSet, frontField(...) -> FrontField     FR-179, FR-189
    transition-shade.ts       TRANSITION_PRIORITY, shadeTransition(...), renderTransitionReference(...)   FR-179, FR-180
    progress.ts               progressAt(elapsedMs, durationMs) -> { p, done }, forwardOf(p, direction)  FR-182
    playback.ts               pure state machine: request / frame / reduced-motion events                FR-176..FR-178, FR-182..FR-184, FR-186, FR-191, FR-194
    step.ts                   stepScenes(map, presentation, seed, from, to, sim) and frozenScenes(...): the
                              scenes and transition inputs of a change, asking only rounds 0..N        FR-187, FR-188
    address.ts (edit)         `transition` parameter: parse, problem, format (text kept as written)      FR-191, FR-192, FR-193
    panel-text.ts (edit)      perfLines: one more line for the labels + front time                       FR-190
    strings.ts (edit)         transitionInvalid, perfLabels                                             FR-192, FR-190, NFR-37
    label-review-set.ts       LABEL_REVIEW_SET: NFR-34 scenes (seed, round, camera, transition)         NFR-34
  src/render/                 no seed, no round, no sim (FR-159 scan); receives only FR-188 data
    shader.ts (edit)          transition branch: uOwnersBefore, uFront (R32F box), uFrontBox, uProgress,
                              uFrontOn; priority list generated from TRANSITION_PRIORITY                 FR-179, FR-180
    map-scene.ts (edit)       + setFront(front: MapFront | undefined) (new member; pinned members unchanged) FR-188, NFR-32
    labels-layer.ts           attachLabelLayer(canvas) -> { resize(vp, dpr), draw(labels, view) }: Canvas 2D,
                              halo stroke + fill, device-pixel resolution, horizontal fit correction     FR-172..FR-175
  src/ui/
    frame-loop.ts             the ONLY requestAnimationFrame user: one coalesced frame per display frame,
                              keeps requesting while a transition runs                                  FR-182, NFR-33
    text-metrics.ts           measureAspects(texts, font) via a Canvas 2D measureText at 100 px          FR-175 (aspect input)
    motion.ts                 matchMedia('(prefers-reduced-motion: reduce)') + change listener          FR-177, FR-184
    main.ts (edit)            wiring: pieces + territory boxes at load, step/playback on round change,
                              labels each frame, FR-190 timing, frozen address                          FR-176..FR-194
    panel.ts, url.ts (edit)   labels timing line; address keeps `transition` while frozen                FR-190, FR-193
  test/
    regions.test.ts  label-layout.test.ts  label-input.test.ts  label-frame.test.ts  front.test.ts
    transition-shade.test.ts  progress.test.ts  playback.test.ts  step.test.ts  address-transition.test.ts
    labels-render.test.ts (render part, Node)  label-review-set.test.ts  labels-purity.test.ts
    labels-perf.test.ts (dev map, logged)  helpers/label-grids.ts
packages/sim/test/traceability.test.ts (edit)                                                           NFR-35
```

## 3. Decisions (each with the discarded alternative)
- D1. **Labels on a Canvas 2D overlay**, redrawn each frame with `fillText`/`strokeText` at font size h x scale in CSS px on a canvas of round(css x dpr) device pixels with `setTransform(dpr, 0, 0, dpr, 0, 0)`. Glyphs are rasterised at their displayed size every frame, so no bitmap is ever enlarged (FR-175), and the overlay is above every WebGL line by construction (FR-173). Discarded: (a) text baked into Three.js textures (a texture per label would have to be re-rasterised at each scale to avoid enlargement; complex and slow); (b) one DOM element per label (layout cost per frame, harder to scan for NFR-28/NFR-37, CSS scaling may enlarge a bitmap).
- D2. **Exact horizontal box.** The text aspect ratio a is measured once per text at 100 px (`ui/text-metrics.ts`). At draw time the layer measures the text at the drawn size and applies a horizontal scale `w_screen / measured` (a vector transform, not a bitmap scale) so the drawn advance width equals h x a x scale; vertically the font size is h x scale. Text is drawn with `textAlign = 'center'`, `textBaseline = 'middle'` at the box centre. Discarded: trusting proportional advance widths (hinting at small sizes can break the 1 % rule of FR-175).
- D3. **Piece index once per load.** `buildPieceIndex(grid)` flood-fills every land map unit into pieces (4-connected, same entry), stores per piece: entry, size, first unit (row-major), bounding box, units (CSR arrays), and the list of 4-adjacent land pieces of other entries. Regions at a round are connected components of that piece graph whose entries share an owner (union-find over piece edges): no per-pixel flood fill on a round change. Discarded: flood-filling the 4 M-unit image on every change (tens of ms per change, budget is 100 ms).
- D4. **Layout by binary search on h with a 2-D prefix sum.** Fitting is monotone in h (a fitting box of height h contains, at the same x0, y0, a fitting box of height h - 1, because the grown rectangle shrinks in both axes), so the largest h is found by binary search over 1..Hmax; each probe scans every (x0, y0) of the set's bounding box with an O(1) prefix-sum test. The winner is then chosen among all fitting boxes of that height (FR-169 tie rule). Discarded: trying every h downwards (up to 200 full scans) and approximate methods (distance transform, pole of inaccessibility: not the spec rule).
- D5. **Faction boxes reuse the round being left.** `factionBoxes(..., previous)` returns, for a faction whose main region has exactly the same piece list as in `previous`, the previous box; it recomputes the others. The result is equal to a full recomputation (tested), so FR-171 holds; on a step only the absorber (and the eliminated faction, which disappears) is laid out again. `previous` is only the result of the round being left and is dropped after the change (FR-187 spirit: nothing derived from a round above N is kept outside a backward transition). Discarded: a long-lived cache keyed by region (would keep data of later rounds after stepping back).
- D6. **Colour front as a float texture over the bounding box of the transferred pieces.** `frontField` returns `{ x0, y0, width, height, values: Float32Array }` with the normalised front distance of each unit of a transferred piece (−1 elsewhere in the box). The shader reads it (R32F, `NearestFilter`, `texelFetch`) only for entries whose owner differs between `uOwnersBefore` and `uOwners`. Comparisons use float32 on both sides: the reference compares `values[i] < Math.fround(f)`. A step uploads three things: the owner table (as before), the earlier owner table and the front box. `setOwners` is unchanged, so the 004 NFR-24 tests keep their meaning; `setFront` is a new member with its own tests. Discarded: (a) quantising distances to 8 bits (changes which units are coloured at a given f); (b) a full 2048 x 2048 float texture (16 MB per step); (c) per-unit integer distance plus per-piece maximum (two lookups, same result).
- D7. **Endpoints are exact by construction.** At f = 0 the transition formula itself reduces to the earlier drawing (alpha 1 on the interpolated line, `lerp(a, b, 0) = a`, no unit below 0); this is asserted on the reference. At f = 1 both the reference and the viewer draw the instant drawing of the later round (no front, `setFront(undefined)`), because FR-180 puts the interpolated line at `faction` priority only while f < 1. `lerp(a, b, t)` is written `a + (b - a) * t`, which is exact when a = b and at t = 0. Discarded: running the general formula at f = 1 (the line would still outrank `coast`/`outer` there).
- D8. **Overlap at equal rank.** FR-180 gives the interpolated line the rank of `faction`. Where a real `faction` line and an interpolated line meet on one pixel, the real `faction` line wins: `TRANSITION_PRIORITY = ['faction', 'absorbed', 'outer', 'coast', 'shore', 'sea-zone', 'territory']`. Why: both are the same colour at f = 0, and at f = 1 `faction` outranks `territory`, so this order is continuous at both ends. Discarded: interpolated line first (a real border would flicker to the interpolated colour at T-junctions). **To confirm (U3).** `BORDER_PRIORITY` of 004 is not touched; `absorbed` uses the `faction` width.
- D9. **Clock stays in `ui/clock.ts`.** The transition clock is `now()` from `ui/clock.ts`, called only by `ui/frame-loop.ts` and `ui/main.ts`; the 004 NFR-25 clock scan therefore needs no edit, and a new test pins which files import `now`. `t` is `now()` at the frame minus `now()` at the request (FR-182). Discarded: the rAF timestamp argument (a second clock source, harder to pin).
- D10. **Pure playback state machine.** `core/playback.ts` holds the displayed round, the running transition (`{ earlier, later, direction, startMs, data }`) or the frozen progress, and reacts to `request(target, nowMs, reduced)`, `frame(nowMs)` and `motionChanged()`. The UI only feeds it `now()` and draws what it returns, so FR-176 to FR-178, FR-182 to FR-184, FR-186 and FR-194 are tested in Node. Discarded: logic inside rAF callbacks (untestable without a browser).
- D11. **Frozen `transition` keeps its text.** The address keeps the value as written (`0.25` stays `0.25`) while frozen (FR-193), so copying the address reproduces the same drawing. Discarded: re-formatting with a fixed number of decimals (would change the frozen f).
- D12. **Grown box beyond the image does not fit.** The spec says positions outside the image never belong to a region or piece; a box whose grown rectangle leaves the image therefore does not fit. Test on a grid whose region touches the image edge.
- D13. **Seed set without contact by boundary brute force.** The units of a piece that reach the minimum squared distance to the absorber's earlier land are always piece units with a 4-neighbour outside the piece, and the nearest absorber units are absorber units with a 4-neighbour not owned by the absorber (moving one step towards the other unit strictly reduces the distance otherwise). So the minimum is taken over boundary x boundary pairs only, exactly. Tested against the naive all-pairs rule on small grids. Discarded: a full Euclidean distance transform of the image (exact but ~4 M units per step for a rare case).
- D14. **Round-change time.** The first frame of a change (instant, or the first transition frame at t = 0) is drawn synchronously in the request handler, after the new faction boxes and front are computed; the FR-158 round-change figure is request -> end of that draw, and its label set already uses the new boxes (NFR-32). Discarded: waiting for the next rAF (adds up to one frame of latency to the measurement).
- D15. **Fixed ink as two constants in `label-frame.ts`; `contrast.ts` is deleted.** `LABEL_INK = [255, 255, 255]` and `LABEL_HALO = [0, 0, 0]` are exported by `label-frame.ts`, which puts them in every `LabelDraw`; the label inputs carry no fill colour and `roundLabels` takes no colour list. Why: a module named after a rule that no longer exists invites the contrast choice back, and fill inputs nobody reads are dead data. `LabelDraw` keeps its `ink` and `halo` fields because FR-188 still gives the rendering part each label's text colour, so `labels-layer.ts` and its tests stay as they are. Discarded: (a) keeping `contrast.ts` with only two constants (a misleading name, and the WCAG helpers would be dead code); (b) hard-coding the colours in `labels-layer.ts` (FR-188 and FR-189 put the text colour in the pure data, and the ink rule would then not be testable in Node).

### Amendments
- 2026-10-16 (user-approved spec change after the T8 screenshot review): every label (faction and territory) is drawn with white text #FFFFFF and a 1 px black halo #000000, never chosen by contrast (FR-174 rewritten; FR-171 and FR-181 no longer change the ink of transferred territory labels; NFR-33 no longer mentions the contrast choice; done criteria test the "ink rule"). Plan: D15, sections 2, 4, 6, 13 and 15; work in task T4b. Vertical, diagonal and curved labels and labels that go past their land are moved to a later spec; mobile layout comes later. U1-U6 stay confirmed. No id is added or removed (`PENDING_005` unchanged).

## 4. Interface (TypeScript sketch)
```ts
type LabelRole = 'faction' | 'territory';                 // field `role`, never `kind` (section 0)
interface LabelParams { font: { weight: number; families: readonly string[] }; margin: number; maxHeight: number;
                        minPx: number; fadeStart: number; fadeFull: number; durationMs: number }
interface LabelBox { x0: number; y0: number; h: number; w: number }      // map coordinates; w = h * aspect
interface PieceIndex { width; height; pieceOf: Int32Array /* -1 = not land */; entryOf: Int32Array; size: Int32Array;
                       first: Int32Array; box: Int32Array /* 4 per piece */; unitStart: Int32Array; units: Int32Array;
                       nbStart: Int32Array; nb: Int32Array }
interface Region { owner: number /* faction index */; pieces: number[] /* ascending */; size: number; first: number }
interface LabelDraw { text: string; role: LabelRole; box: LabelBox; factor: number; ink: Rgb /* always LABEL_INK */; halo: Rgb /* always LABEL_HALO */ }
interface FactionLabelInput { faction: number; text: string; box: LabelBox | undefined; aspect: number }   // no fill (D15)
interface TerritoryLabelInput { entry: number; text: string; box: LabelBox | undefined }                    // no fill (D15)
interface FrontField { x0: number; y0: number; width: number; height: number; values: Float32Array }
interface MapFront { before: Uint8Array /* owner table of the earlier round */; field: FrontField; forward: number /* f */ }
type Direction = 'forward' | 'backward';

buildPieceIndex(grid: IndexGrid): PieceIndex
regionsOf(p: PieceIndex, owners: ArrayLike<number> /* per entry */): Region[]
mainRegions(regions: Region[]): Map<number, Region>          // faction index -> main region
mainPieces(p: PieceIndex): Int32Array                        // entry index -> main piece (-1 none)
fitLabel(p: PieceIndex, pieces: readonly number[], aspect: number, params: LabelParams): LabelBox | undefined
territoryBoxes(p, aspects: readonly number[] /* per entry */, params): (LabelBox | undefined)[]
factionBoxes(p, owners, aspects: ReadonlyMap<number, number>, params, previous?: FactionBoxes): FactionBoxes
LABEL_INK: Rgb /* [255, 255, 255] */;  LABEL_HALO: Rgb /* [0, 0, 0] */
labelTexts(map, presentation, factionIndex): LabelTexts
roundLabels(texts: LabelTexts, table: ArrayLike<number>, boxes: FactionBoxes, territoryBoxes): RoundLabels   // no colour list
labelOpacity(role: LabelRole, scale: number, params): number
instantLabels(round: RoundLabels): LabelDraw[]
labelsAt(input: StepLabels, forward: number): LabelDraw[]   // input: texts, boxes and aspects at the earlier and later round, eliminated, absorber, transferred
screenBox(box: LabelBox, cam: Camera, vp: Viewport): { x: number; y: number; w: number; h: number }
drawable(label: LabelDraw, scale: number, params): boolean      // h * scale >= P and opacity * factor > 0
frontField(p: PieceIndex, transferred: ReadonlySet<number> /* entries */, before: ArrayLike<number>, absorber: number): FrontField
shadeTransition(grid, before, after, colors, theme, front: FrontField, forward: number, cam, vp, fx, fy): Shaded
renderTransitionReference(grid, before, after, colors, theme, front, forward, cam, vp, dpr): Uint8Array
progressAt(elapsedMs: number, durationMs: number): { p: number; done: boolean }   // p = smoothstep(0, 1, t / Dt)
forwardOf(p: number, direction: Direction): number
stepScenes(map, presentation, seed: number, from: Scene, to: number, sim: SimPort): Result<StepData, MatchError>
frozenScenes(map, presentation, seed: number, n: number, sim: SimPort): Result<StepData, MatchError>   // rounds n-1 and n
AddressResult += { transition?: { value: number; text: string } };  AddressParam += 'transition'
formatAddress(seed, round, cam, transitionText?: string): string     // 3-argument calls unchanged
MapScene += { setFront(front: MapFront | undefined): void }
attachLabelLayer(canvas: HTMLCanvasElement): { resize(vp: Viewport, dpr: number): void; draw(labels: readonly LabelDraw[], view: MapView): void }
```
Seed and round appear only in `step.ts`, `playback.ts` and `address.ts` (as parameters); every layout, front, frame and shading function takes owners, entries, params, scale and f, never a seed or a round (FR-189, FR-188).

## 5. Label layout algorithm (FR-167 to FR-171)
```
fits(S, x0, y0, h, w):                                    // S = set of pieces; membership via pieceOf
  cols = x0 - M .. x0 + M + floor(w - 0.5)                // units with x0-M <= x+0.5 <= x0+w+M
  rows = y0 - M .. y0 + h + M - 1                         // units with y0-M <= y+0.5 <= y0+h+M
  return the rectangle lies inside the image and every unit in it belongs to S   // prefix sum over S's bbox
fitLabel(S, a):
  build mask + prefix sum over bbox(S)
  if no box fits at h = 1: return undefined               // FR-170
  binary search the largest h in 1..Hmax with some fitting (x0, y0)        // monotone (D4)
  boxes = all (x0, y0) fitting at that h; w = h * a
  mean = (sum of centres) / count, centre = (x0 + w/2, y0 + h/2)
  winner = min by (squared distance of centre to mean, y0, x0)             // FR-169
```
- M is a whole number (D12 needs integer row/column limits); `floor(w - 0.5)` handles w < 0.5.
- Faction label: S = main region at the displayed round (largest size; tie by smallest first unit). Territory label: S = {main piece} (largest piece of the entry; same tie). A faction without land territory has no label (FR-171).
- Territory boxes are computed once at load from `mainPieces` and never recomputed (FR-171; test: equal at every round of the dev map).
- `aspects` are passed in; tests inject fixed values (e.g. 4.0 for every faction, 3.0 for every territory) so the dev-map layout is reproducible in Node.

## 6. Label drawing data (FR-172, FR-174, FR-175, FR-181)
- Opacity: territory `smoothstep(L0, L1, s)`, faction `1 - smoothstep(L0, L1, s)` (`core/lines.ts` `smoothstep` reused), times the factor. Exactly L0: faction 1, territory 0; exactly L1: the reverse. Sum is 1 for every s.
- Not drawn when `box.h * s < P` (h may be fractional during interpolation), or when opacity x factor is 0.
- Ink (FR-174, amended 2026-10-16, D15): every label, faction or territory, at every round, every f and over any fill, has `ink = LABEL_INK` (white #FFFFFF) and `halo = LABEL_HALO` (black #000000). No luminance or contrast is computed; the fill under a label is not an input. Halo: `strokeText` with `lineWidth = 2` CSS px and `lineJoin = 'round'` drawn before `fillText`, i.e. 1 screen pixel outside the glyph outline; the layer sets `globalAlpha` once per label, so text and halo take the same opacity (FR-174 last clause, FR-172). `labels-layer.ts` is unchanged by the amendment.
- `screenBox(box, cam, vp)`: `x = (x0 - cam.x) * s + vp.width/2`, `y = (y0 - cam.y) * s + vp.height/2`, `w = box.w * s`, `h = box.h * s`; the layer draws the text with font size h and horizontal correction to w (D2). Labels whose screen box misses the drawing area are skipped (same result).
- `labelsAt(input, f)` (FR-181), with integer boxes at both ends so `lerp` is exact at f = 0 and 1:
  - eliminated faction: earlier box, factor 1 - f (none if no earlier box);
  - absorber: boxes at both rounds -> `{x0, y0, h}` = lerp(earlier, later, f), `w = h * a`, factor 1; only later -> later box, factor f; only earlier -> earlier box, factor 1 - f;
  - territory labels of transferred territories: same box, factor 1 and the fixed ink at every f, like every other territory label (amended 2026-10-16: the ink no longer switches at f = 0.5);
  - every other label: as at both rounds (factor 1). The code may still read these labels from the earlier round below f = 0.5 and from the later round from 0.5 on; both give the same box, text and ink, so the output does not depend on f (tested).
  - Outside a transition `labelsAt` is called with one round (factor 1 everywhere).
- Font (`labelFont`, proposal U1): weight 600, families `"Segoe UI", "Helvetica Neue", Arial, sans-serif` (generic fallback last). No web font file (no new asset, NFR-36).

## 7. Colour front and transition shading (FR-179, FR-180)
```
transferred pieces = connected components of the piece graph restricted to pieces of transferred entries
for each transferred piece P:
  contact = units of P with a 4-neighbour unit of a land entry owned by the absorber at the earlier round
  seeds   = contact, or (if empty) the units of P at minimum squared centre distance to the absorber's earlier land (D13)
  d       = multi-source BFS inside P from seeds (4-adjacent steps)
  n(u)    = d(u) / max(d over P), or 0 when max = 0          -> Float32 in the front box
shadeTransition at (fx, fy), with forward progress f (0 <= f < 1; f >= 1 returns shade(grid, after, ...)):
  a = cell under the point; transferred(a) = before[a] != after[a]
  fill = land ? colour(transferred(a) && !(n(cell) < fround(f)) ? before[a] : after[a]) : sea/background
  for each width level and direction (as shade), b = neighbour cell:
    land/land: before differ & after same -> 'absorbed'; after differ -> 'faction'; else 'territory'
    other pairs: borderClass as in 004
  winner by TRANSITION_PRIORITY ('absorbed' at the faction width)
  'absorbed':  line = lerp(theme.border.faction, darken(colour(after[a])), f); alpha = lerp(1, territoryOpacity(s), f)
  'territory': line = lerp(darken(colour(before[a])), darken(colour(after[a])), f); alpha = territoryOpacity(s)
  colour = round(fill * (1 - alpha) + line * alpha); other classes as shade
```
- Same value on both sides never gets a line, whatever the front colours (FR-180 last sentence, test with a front crossing one entry).
- Backward transitions use the same earlier/later tables and front with f = 1 - p; tested as the forward frames in reverse order (equal pixels for f and the mirrored p).
- The shader is a line-by-line port (same names); parity is checked by a pixel diff of browser frames against `renderTransitionReference` on the frozen frames (as 004 T6).

## 8. Playback, address and data (FR-176 to FR-178, FR-182 to FR-187, FR-191 to FR-194)
- `request(target, nowMs, reduced)`: (1) if a transition runs, complete it (its later/earlier state becomes the displayed drawing; FR-183); (2) if frozen and target != displayed, unfreeze to the full state of N and mark the address to drop `transition` (FR-194); (3) target == displayed -> nothing (FR-178; a typed equal round does not complete a running transition either, see U4); (4) |target - N| = 1 and not reduced -> start `{ direction, startMs: nowMs }`; otherwise instant (FR-176 to FR-178). The displayed round, panel, controls and address take the target in the same call (FR-186).
- `frame(nowMs)`: t = nowMs - startMs; `t >= Dt` -> draw the final state and end (FR-182, also after a hidden page: the next frame has a large t); else `p = smoothstep(0, 1, t / Dt)`, `f = forwardOf(p, direction)`.
- `motionChanged()` while running -> complete (FR-184). Reduced motion at request -> instant; a frozen `transition` still applies (FR-177).
- `stepScenes(from, to)`: forward uses the new scene (its record) and the old scene's owners; backward uses the old scene (round N, its record) as the later round and the new scene as the earlier. It calls `sceneAt` for `to` only, so the sim is asked about rounds 0..to, and the later scene of a backward step is the one already held; `playback` drops it when the transition completes (FR-187, recorded-calls test). `frozenScenes(n)` asks for n - 1 and n only.
- Address: `transition` uses the camera syntax `/^[0-9]+(\.[0-9]+)?$/`; valid when 0 <= value <= 1, not repeated, and the displayed round N >= 1 (after seed/round handling). Otherwise an `AddressProblem { param: 'transition', reason: 'invalid' | 'out-of-range' | 'repeated' }` (existing reasons only, so the 004 reasons test is unchanged), message `STRINGS.transitionInvalid` naming `transition`, camera untouched (FR-192). `formatAddress(seed, round, cam, text)` appends `&transition=<text>` while frozen (FR-193).
- Data to the rendering part (FR-188): `setOwners(table)`, `setFront({ before, field, forward } | undefined)`, `setView(view)` and `labels.draw(LabelDraw[], view)`; nothing else. A type-level test pins these signatures; the FR-159 scan keeps seed/round names out of `src/render`.
- FR-190: `main.ts` measures with `now()` around `factionBoxes` + `frontField` of each change; `perfLines` gains one line (`STRINGS.perfLabels`) when the figure exists (the three 004 lines are unchanged).

## 9. Label parameters (approved in T9 on 2026-10-16, within the spec ranges)
| Parameter | Approved value | Spec range |
|---|---|---|
| `labelFont` | weight 600, `"Segoe UI", "Helvetica Neue", Arial, sans-serif` | list with a generic fallback |
| `labelMargin` M | 2 map units | 1..4 (whole number, D12) |
| `labelMaxHeight` Hmax | 120 map units | 20..200 |
| `labelMinPx` P | 9 screen px | 6..14 |
| `labelFadeStart` L0 / `labelFadeFull` L1 | 1.5 / 2 (equal to the territory lines of 004; was proposed as 1.25 / 2) | 0.5 <= L0 < L1 <= 8 |
| `transitionDuration` Dt | 1500 ms | 800..3000 |
Approved by the user on 2026-10-16 after reviewing the T9 screenshots; pinned by a test in `label-review-set.test.ts`. Every candidate was shot with the amended style (white text, black 1 px halo, after T4b); the ink is fixed by the spec and is not a tuned parameter.

## 10. Earlier tests amended (NFR-35) — the explicit list
The FR-155 scan in `apps/web/test/anti-spoiler.test.ts` keeps every rule and adds exactly these exceptions (each with a planted-violation test that stays red outside the exception):
1. The whole word `transition` only in `core/address.ts`, `core/playback.ts`, `ui/main.ts`, `ui/url.ts` (the address parameter and its handling).
2. The whole word `lerp` only in `src/core/**` (pure interpolation helpers).
3. One uniform named `uProgress`, declared exactly once, only in `render/shader.ts` (the forward progress f).
4. `requestAnimationFrame`/`cancelAnimationFrame` only in `ui/frame-loop.ts` (tightened from "anywhere in `src/ui`"; the camera frames of 004 move there).
The NFR-25 clock scan of `purity.test.ts` is not edited (D9). The 004 NFR-24 and FR-140 tests are not edited (D6, `renderReference` unchanged). The traceability test is edited in T1 and T10.

## 11. Traceability
- T1: `FR_RANGES = [[1, 194]]`, `NFR_RANGES = [[1, 37]]`; a pinned `PENDING_005` set holding all 34 new ids (FR-167..FR-194, NFR-32..NFR-37) is excluded from `expected` while the work is in progress; counts become everything 231, expected 229 - 34 = 195 (unchanged meaning); the "ends at" test asserts `FR-194`, `NFR-37` are in the ranges and `FR-195`, `NFR-38` are not; the literal-bounds test uses 194 and 37. A test titled with NFR-35 pins the pending set exactly.
- T10: the pending set is removed; expected = 229 literal; every id must be in a test title. Ids needing screenshots or measurements (FR-175, NFR-32, NFR-34) are traced by their pure parts (screen box maths, compute-once and reuse properties with a logged dev-map timing, review-set address checks).

## 12. Visual verification (NFR-34) and measurement (NFR-32)
- `core/label-review-set.ts` `LABEL_REVIEW_SET` (new module; 004 set untouched): faction labels at fit for seed 1 rounds 0, 1 and 4 (T); crossfade at one point at scales L0 - 0.25, (L0 + L1)/2, L1 + 1; territory labels in a dense area (smallest-territory area of Alemania) and on a small island (Baleares) at a scale above L1; Italia (two or more regions, Messina strait) at fit; transition 0 -> 1 at `transition=0, 0.25, 0.5, 0.75, 1` (`round=1`); a transfer with an empty contact set at the same five values if a test over seeds 1..1000 finds one (first seed, then first round; the found seed and round are written here in T9) or the scene is dropped. **Found in T9 (2026-10-16):** the search over seeds 1..1000 stops at the first step: seed 1, round 1 (Alemania absorbed by Francia). Its transferred pieces without contact are islands and coast slivers of Schleswig-Holstein and Mecklemburgo-Pomerania Occidental (Rugen, 569 units, is the largest); the scene is centred on Rugen at scale 12 (`EMPTY_CONTACT` in `label-review-set.ts`, pinned by its test). Round 3 of seed 1 (Islas Baleares and a 19,980-unit piece) is the next hit with large pieces; it is not in the set.
- `label-review-set.test.ts` checks every address parses without problems and that each point holds what its label says (Italia has >= 2 regions at round 0 and its label box lies in its main region; the island point is Baleares; the dense area holds >= 5 territory labels drawable at the chosen scale; the empty-contact scene really has a transferred piece with no contact).
- Screenshots: Chrome on the reference PC, 1920 x 1080 drawing area, DPR recorded; one per address; attached to the PR (not committed); the user accepts each and the parameter values. A backward transition is not screenshotted (tests). Every screenshot of this set (and the T8 set retaken) uses the amended label style; shots taken with contrast-chosen ink do not count.
- **Measured in T10 (2026-10-16, Chrome via DevTools, 1920 x 1080 window of 988 px drawing height, DPR 1, local dev server, seed 1):** first run failed (FR-190 figure median/max over 12 changes: 2->3 90/112 ms, 3->2 90/123, 3->4 148/170, 4->3 113/135; thresholds 100 ms). Fix (no approximation, results identical, hash of every box and front value of seeds 1..3 equal before and after): `fitLabel` uses a vertical-run table instead of a prefix sum, prunes heights and widths by the longest runs, tries the cap first and merges the tie passes; the front uses typed masks, an inlined search with slots and bucket arrays with a lower-bound skip. Final figures are in the pull request.
- Parity: frozen frames vs `renderTransitionReference` pixel diff on a zoomed window (scratchpad script, not committed); differences only on float ties, as in 004.
- NFR-32 procedure (T10): dev map, reference PC, 1920 x 1080: FR-190 figure for steps 0->1, 1->2, 3->4, 4->3 and the jump 0->4; round-change figure for the same; frame stats for 10 s of a transition loop (repeated next/previous) and 10 s of pan and zoom at scale (L0 + L1)/2 with labels drawn. Thresholds: 100 ms, 150 ms, median <= 16.7 ms, p95 <= 33.3 ms. A failing figure stops the task: propose a fix or a spec change.

## 13. Test strategy (Vitest, Node, no DOM), by file
Titles start with the ids they verify; exact `toStrictEqual`; hand-made grids from `test/helpers/label-grids.ts`; random grids from a fixed-seed generator written in the test (never `Math.random`).
- `regions.test.ts` FR-167, FR-168, FR-171, FR-189: pieces of an entry split in two; region spans several entries of one owner; same-colour different factions are two regions; two regions of one faction (strait); main region and main piece tie by first unit; regions recomputed after an owner change; dev map: Espana has the Baleares as a second region, Italia >= 2 regions.
- `label-layout.test.ts` FR-169, FR-170, FR-171, FR-189, NFR-33: `fitLabel` equals a brute-force implementation of the spec definition (every h, every x0, y0, every unit centre) on 200 random grids and on hand grids; maximal height; tie rule (mean centre, then y0, then x0) on symmetric grids; no box -> undefined; grown box over the image edge does not fit; w < 0.5; dev map with injected aspects: every faction box inside its main region with margin M, territory boxes equal at rounds 0..4, same inputs same boxes; `factionBoxes` with `previous` equals a full recomputation for every step and jump of seed 1.
- `contrast.test.ts`: deleted with `contrast.ts` in T4b (D15); its FR-174 titles move to `label-frame.test.ts` and `label-input.test.ts`.
- `label-frame.test.ts` FR-171, FR-172, FR-174, FR-175, FR-181, FR-189: opacities at L0, L1, below, above, midpoint; sum 1; below-P not drawable; `screenBox` equals box x scale and moves with the camera (FR-175 pure part); FR-181 every rule at f = 0, 0.3, 0.5, 1; `labelsAt(f = 0)` equals the instant labels of the earlier round and `labelsAt(f = 1)` of the later round; backward = forward mirrored. **Ink rule (FR-174, done criteria):** every `LabelDraw` of `instantLabels` and of `labelsAt` at f = 0, 0.25, 0.49, 0.5, 0.75, 1 has `ink` [255, 255, 255] and `halo` [0, 0, 0], for faction and territory roles, including the eliminated faction, the absorber and transferred territories; `LABEL_INK`/`LABEL_HALO` pinned as those literals. FR-171/FR-181: a transferred territory label is `toStrictEqual` at every f (box, factor 1, ink, halo). Dev map: for seed 1, every round 0..4 and every step at those f values, every label has white ink and a black halo.
- `label-input.test.ts` FR-167, FR-168, FR-171, FR-174: names and boxes as before; the inputs have no fill key (key list); the territory labels of a round do not depend on the owner colours (two different colour lists are not even an input: `roundLabels` takes none); through `instantLabels`, labels on white, black and the palette's lightest fill all come out white with a black halo.
- `front.test.ts` FR-179, FR-189: contact set; seed set without contact equals the naive all-pairs rule (random grids); BFS distances; normalisation per piece; 1-unit piece; several pieces finish together; one piece over several transferred entries; dev map seed 1 round 1 field covers exactly the transferred units.
- `transition-shade.test.ts` FR-179, FR-180: f = 0 equals `renderReference` of the earlier owners pixel for pixel; f = 1 equals the later; front monotone in f; no line along the front inside one value; absorbed line colour/alpha interpolation at f = 0.5; transferred/transferred territory line colour; third-party `faction` lines unchanged; D8 overlap order at a T-junction; backward frames = forward frames reversed.
- `progress.test.ts` FR-182: p(0) = 0, p(Dt) = 1, smoothstep midpoint, done at t >= Dt (also t = 10 x Dt); `forwardOf`.
- `playback.test.ts` FR-176, FR-177, FR-178, FR-182, FR-183, FR-184, FR-185, FR-186, FR-191, FR-194: every control of 004 FR-154 that moves by one animates (next, previous, first from 1, last from T - 1, typed N +- 1); jumps, load, error path and reduced motion are instant; typed equal does nothing; request during a transition completes then handles (the 4 -> 5 then previous example); motion change completes; displayed round equals the target at once; frozen survives camera events and is dropped on a round change.
- `step.test.ts` FR-187, FR-188: recorded sim calls: step forward from N asks only N + 1; backward asks only N - 1 and keeps the round-N scene only in the step data; frozen asks N - 1 and N; no call above the displayed round after completion; the step data given to the rendering part has no seed, round or record field (key list).
- `address-transition.test.ts` FR-191, FR-192, FR-193: `0`, `1`, `0.5`, `0.25` valid; `2`, `abc`, `-0.5`, `1e-1`, `.5`, empty, repeated invalid; round 0 (also `?round=0&transition=0.5` and an invalid seed) -> problem; camera unaffected by a transition problem; message names `transition`; format keeps the text while frozen and drops it otherwise; 3-argument `formatAddress` unchanged.
- `labels-render.test.ts` FR-173, FR-174, FR-175, FR-179, FR-180, FR-188, NFR-36 (unchanged by the amendment: the layer draws the `ink`/`halo` it receives, halo stroke before the fill): `index.html` has `#labels` after `#map` and before `#panel`, with `pointer-events:none`; type-level test of `setFront`, `attachLabelLayer`; `setFront` uploads the earlier owners and the front texture (R32F, Nearest, no mipmaps) and leaves index/kinds/colours alone; `setFront(undefined)` turns the branch off; the shader declares `uProgress` once and its priority constants come from `TRANSITION_PRIORITY`; no new package in `apps/web/package.json` or the lockfile (NFR-36).
- `labels-purity.test.ts` NFR-33, NFR-37: the new core files (`regions`, `label-params`, `label-layout`, `label-input`, `label-frame`, `front`, `transition-shade`, `progress`, `playback`, `step`; `contrast` removed from the list in T4b) are in the NFR-25 scan (non-vacuous list); layout, front, frame, input, progress and playback run with `Math.random`/`Date.now`/`performance.now` throwing; only `ui/main.ts` and `ui/frame-loop.ts` import `now`; `fillText`/`strokeText` receive no string literal (only label texts), so map names are the only new text (NFR-37).
- `labels-perf.test.ts` NFR-32 (pure part, logged not asserted): dev map piece index time; territory boxes once at load; per-step `factionBoxes` + `frontField` time for each step of seed 1; asserts that a step recomputes only the changed factions (call count).
- `label-review-set.test.ts` NFR-34 (section 12). Edited 004 tests: `anti-spoiler.test.ts` (section 10), `traceability.test.ts` (section 11), both titled with NFR-35.

## 14. Decisions the user must confirm
**Confirmed by the user 2026-10-16:** U1-U6 as written below.
- U1. `labelFont` = weight 600, `"Segoe UI", "Helvetica Neue", Arial, sans-serif`, and the parameter proposals of section 9 as the starting point for T9.
- U2. Canvas 2D overlay for labels (D1) with horizontal width correction (D2).
- U3. At a pixel where a real `faction` line meets the interpolated line, the `faction` line wins (D8).
- U4. A typed round equal to the displayed round during a transition does nothing (the transition keeps playing), since FR-178 calls it "no change".
- U5. A label box whose margin would leave the id image does not fit (D12); M is a whole number.
- U6. The round-change figure is request -> end of the first synchronous frame of the change (D14).

## 15. Risks
- Layout time on large regions: binary search x bounding box scan (France is roughly 1 M units of bounding box: about 9 scans). Mitigated by D3 and D5; measured in `labels-perf.test.ts` (Node) and T10 (browser). If the 100 ms figure fails, next step is a row-run pre-filter, not an approximation.
- Very large glyphs: at scale 32 a territory label can be thousands of pixels tall; Canvas 2D cost is checked at scale 32 in T8 screenshots and by the frame stats; off-screen labels are skipped.
- Fonts differ per machine: the layout is reproducible for a given font; screenshots and the user's acceptance are on the reference PC; tests inject aspects.
- Fixed white ink (amendment 2026-10-16): on very light fills, small labels (near P = 9 px) are readable only through the 1 px halo. The spec accepts it; the T8 retake and the T9 review set (crossfade and dense-area scenes) are where the user judges it. If it is not good enough, the fix is a spec change (halo width or P), not a return to the contrast choice.
- T4b changes code already shipped in T4 and T8 (`label-frame.ts`, `label-input.ts`, `ui/main.ts`) and deletes `contrast.ts` and its test: the full suite and `rg` for FR-171, FR-174, FR-181 and NFR-33 must still find each id in a title after the deletion.
- Float32 vs double in the shader (front compare, interpolated colours, rounding ties): same formulas, `Math.fround` for the front compare; parity checked by pixel diff (a few tie pixels accepted, as in 004).
- 004 scans: identifiers containing `round` in render code, `kind:` literals and the word `transition` outside the allowed list fail existing tests; read section 0 before writing code.
- R32F textures: guaranteed sampleable with `NearestFilter` in WebGL2; the upload is the front bounding box only.
- Windows path with spaces: quote; `$env:CI='1'; npm test` before commits.
