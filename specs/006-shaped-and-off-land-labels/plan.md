# Plan 006 — Shaped and off-land labels
Spec: `specs/006-shaped-and-off-land-labels/spec.md` (approved by the user on 2026-10-19; the status line is set to `approved` in T1, on the user's instruction). Covers FR-195 to FR-216 and NFR-38 to NFR-42. Delivery: the existing branch `feat/006-label-orientation` (from `rewrite`), one PR into `rewrite`, squash merge with the user's OK and CI green. No GitHub issues (one PR is enough; AGENTS.md).

**Gate.** This plan and `tasks.md` need the user's approval, and the decisions of section 14 (U1 to U4) their confirmation, before T1 starts.

## 0. Starting point and guards (read before coding)
- Branch `feat/006-label-orientation` at 2f6f25c (spec 005 merged, PR #25). 1652 tests green. Dev map 2048 x 2048, 70 land + 17 sea entries, 5 factions, seed 1 gives T = 4.
- 005 label code: `core/regions.ts` (piece index, main region, main piece), `core/label-layout.ts` (`fitLabel`, `territoryBoxes`, `factionBoxes` with reuse of the round being left), `core/label-input.ts` (`labelTexts`, `roundLabels`), `core/label-frame.ts` (`LabelDraw`, `instantLabels`, `labelsAt`, `drawable`, `screenBox`), `core/label-params.ts` (`LABEL_PARAMS`), `render/labels-layer.ts` (Canvas 2D, halo stroke then fill, horizontal stretch), `ui/text-metrics.ts` (aspects at `REFERENCE_PX` = 100), `ui/main.ts` (wiring).
- Traceability (`packages/sim/test/traceability.test.ts`): ranges `FR [[1, 194]]`, `NFR [[1, 37]]`, 231 ids, 229 expected; asserts `FR-195`, `NFR-38` are NOT ids yet.
- Guards of 004/005 that new code must respect (none of these tests is on the NFR-41 list):
  - `anti-spoiler.test.ts`: no identifier containing `seed` or `round` in `src/render/**` (only `Math.round` exempt; `background`, `around` are flagged); the whole words `transition`, `lerp` (allowed only in `src/core`), `animate`, `animation`, `tween`, `keyframes`, `setTimeout`, `setInterval`; rAF only in `ui/frame-loop.ts`. **New sources say "step", never "transition".**
  - `strings-language.test.ts`: every viewer source except `core/strings.ts` is ASCII-only, comments included (write "deg", "theta", "beta", "cup", "cap", never the symbols); every `STRINGS` key is used outside the module; placeholders only from the pinned list (`count`, `value`, `kind`, `total`, `ms`, ...: **no new placeholder name**); no `kind: '<literal>'` (new discriminants are named `shape`).
  - `label-review-set.test.ts` pins `LABEL_PARAMS` with `toStrictEqual`: **new parameters go in a new module** (`core/shape-params.ts`), `LABEL_PARAMS` is not touched. It also pins the 005 `LABEL_REVIEW_SET` (scene names starting with `step-`): **new scenes go in a new module** (`core/shaped-review-set.ts`).
  - `panel-text.test.ts` pins `perfLines` at 3 lines (4 with the FR-190 figure): the FR-214 counts are a **separate** function and panel line.
  - `label-input.test.ts` pins the key lists of the label inputs and many 005 tests use `toStrictEqual`: **optional fields are omitted, never set to `undefined`** (a horizontal in-land label has exactly its 005 keys).
  - `labels-purity.test.ts` (NFR-33): fixed `NEW_CORE` list; new core files get their own purity test (section 13), that test is not edited.

## 1. "Ask first" items
| Item | Proposal | Status |
|---|---|---|
| New dependency | **None** (NFR-42). Rotated and arc text, and leader lines, use the Canvas 2D API already used by 005 (`rotate`, `translate`, `beginPath`, `moveTo`, `lineTo`, `stroke`). Hashing is a hand-written FNV-1a. | No change |
| Map format, presentation data, id image, `MatchState`, `RoundRecord`, sim/shared exports | **Unchanged** (spec "Compatibility"). | No change |
| Edits to earlier tests | Only the explicit list of section 10 (NFR-41). | Allowed by spec |
| New test fixture of measured text aspects | `apps/web/test/helpers/measured-aspects.ts`: literal aspect ratios of every name, measured once in the reference browser (D10). Test data, not map data. | Confirm (U2) |
| Files outside `apps/web`, `packages/sim/test/traceability.test.ts`, `specs/006-*` | None. | No change |

## 2. Files and responsibilities
```
apps/web/src/core/              PURE (NFR-25 / NFR-33 purity; NFR-39 number scan where marked [N])
  shape-params.ts      [N] SHAPE_PARAMS (angleStep, shapeGain, arcBends, offLandHeight per role,
                           offLandReach, leaderGap), ANGLE_CS table (C, S per multiple of 15 deg)     FR-196, FR-203, FR-207
  label-axis.ts        [N] setSums, axisAngle (exact, BigInt), axisExtent, shapesOf (shape order)   FR-196, FR-199, NFR-39
  label-shape.ts       [N] inStraight, arcExists, inArc, cosK, squared distance transform,
                           shapedCandidate (pruned), shapedHeight (unpruned, for tests/review),
                           inLandFrame (FR-198 choice)                                               FR-195, FR-197..FR-199, NFR-38
  label-offland.ts     [N] footprint raster, inGrownBox, offLandBox search, leaderLine               FR-203..FR-207, FR-215
  label-place.ts       [N] placeTerritories (once), placeFactions (per state, in-land reuse)        FR-206, FR-209, FR-215, FR-216
  label-frame.ts (edit)[N] ShapedDraw, AnyLabelDraw, frameOf, screenFrame, drawable for every
                           frame, instantLabels / labelsAt with the FR-210 / FR-211 rules           FR-208, FR-210..FR-213
  label-input.ts (edit)[N] roundLabels: optional 5th argument `placed` (D3)                         FR-209, FR-212
  label-layout.ts (edit)[N] FR-169 prefilter squares as products x * x (NFR-39), nothing else      NFR-39
  label-counts.ts      [N] labelCounts: exclusive categories per role                               FR-214
  label-digest.ts      [N] digestNumbers (FNV-1a 64 over float64 bits), layoutDigest               NFR-39
  glyph-layout.ts          GLYPH_REFERENCE_PX, glyphOffsets, arcGlyphs, straightMatrix (drawing
                           side: trigonometry allowed, outside the NFR-39 scan, FR-213 last sentence) FR-200..FR-202
  panel-text.ts (edit)     labelCountsLine(counts) (new export; perfLines unchanged)                FR-214
  strings.ts (edit)        label count texts (Spanish, existing placeholder names only)             FR-214, NFR-42
  shaped-review-set.ts     SHAPED_REVIEW_SET, recorded hits (section 12)                            NFR-40
apps/web/src/render/
  labels-layer.ts (edit)   draw(readonly AnyLabelDraw[], view): leader-line pass, then texts; box
                           labels exactly as 005; straight = rotate + stretch along the reading
                           direction; arc = glyph by glyph, no stretch; per-text glyph advances cached FR-200..FR-202, FR-207, FR-208
apps/web/src/ui/
  main.ts (edit)           territory placement at load; faction placement per state with reuse of
                           the round being left; counts to the panel; FR-190 figure includes placement FR-209, FR-214, FR-216
  panel.ts (edit)          one more line: the label counts                                          FR-214
apps/web/test/
  label-axis.test.ts  label-shape.test.ts  label-offland.test.ts  label-place.test.ts
  label-steps.test.ts  label-counts.test.ts  glyph-layout.test.ts  labels-shaped-render.test.ts
  shaped-purity.test.ts  shaped-review-set.test.ts  shaped-perf.test.ts  shaped-deps.test.ts
  helpers/label-reference.ts (brute-force definitions)  helpers/shaped-grids.ts (hand grids, seeded generator)
  helpers/label-digest-run.ts (dev-map digest, shared by Node test and browser console, D11)
  helpers/measured-aspects.ts (T9, D10)
packages/sim/test/traceability.test.ts (edit)                                                       NFR-41
```
No function takes a seed or a round: layout, placement and step functions take owners, entries, parameters, aspects, scale and f (FR-213). Seeds and rounds appear only in tests, the review set and the existing `step.ts` / `playback.ts` / `address.ts`.

## 3. Decisions (each with the discarded alternative)
- D1. **Exact axis angle by counting passed boundaries.** For B < 0 the set is mirrored (A, -B), the result negated, and -90 wrapped to +90. For the doubled angle psi in [0, 180] the number m of passed boundaries 15, 45, ..., 165 (passed when B cos b - A sin b > 0, decided exactly by the (p, q) table of section 5) gives theta* = 15 m; a value of 0 at a boundary is "not passed", which is the tie towards 0 deg; A = B = 0 gives 0. Sums are whole numbers below 2^53; products with `BigInt`. Discarded: `Math.atan2` then rounding (engine-dependent near boundaries, and banned by NFR-39).
- D2. **Shaped height by a descending scan with an exact distance-transform filter.** For each h from Hmax down to the bound (ceil(G x hH), or 1 when hH is undefined) every shape is tried; the first h with any fitting frame is hS. Candidate centres are only set units (the centre's own unit centre lies in every footprint, so it must belong to the set), and only those whose exact squared distance to the nearest non-set unit centre (integer Meijster transform over the set's box plus a one-unit ring; outside the image is non-set) is at least (rho - EPS)^2, with rho the radius of a disc proved to lie inside the grown footprint (straight: min(h a, h)/2 + M; arc: min(h/2 + M, R (phi - phi^3/6)), clamped at 0) and EPS = 1e-6, far above any rounding of the pinned formulas for coordinates below 2^12. Discarded: binary search on h (exact only if the float evaluation of K(phi) is monotone to the last bit, which is not guaranteed); a disc test without EPS (could reject a frame the pinned formulas accept).
- D3. **005 call sites unchanged; the placement is an optional fifth argument of `roundLabels`.** `placed` holds an entry only for labels whose drawn frame is not their horizontal in-land candidate (a shaped in-land frame, or an off-land box); every other label takes the 005 path, so a label that stays horizontal and in-land is the 005 label bit for bit (NFR-41), and the 005 tests that call `roundLabels` with four arguments keep their meaning. The viewer always passes `placed`. Discarded: replacing the `roundLabels` inputs by a new placement type (every 005 call site in `label-input.test.ts`, `labels-perf.test.ts` would change, which NFR-41 does not allow for the NFR-32 test).
- D4. **Draw data: the 005 `LabelDraw` stays the box label; `ShapedDraw` is new.** `LabelDraw` (horizontal in-land box or off-land box) gains only an optional `leader`; `ShapedDraw` has `frame: ShapedFrame` and no box (FR-212); `AnyLabelDraw = LabelDraw | ShapedDraw`. A box label's frame data (shape horizontal, centre, angle 0, curvature 0, h, w) is given by its box; `frameOf(draw)` returns it for every label. Discarded: one draw type with an optional box and a required frame (every 005 fixture would need a new field).
- D5. **Off-land boxes of faction labels are recomputed for every state; in-land frames are reused.** The in-land frame (horizontal candidate, shaped candidate, FR-198 choice) of a faction whose main region has the same pieces, aspect and parameters as in the round being left is reused, as in 005 D5; off-land boxes are always searched again (FR-216 allows reuse, does not require it, and on the dev map few factions go off-land). Discarded: reuse keyed on the whole obstacle set (more code for no measurable gain).
- D6. **Obstacles as a local footprint raster.** For one label's search, the grown footprints of the obstacles (FR-215) that meet the search window are rasterised into a window bitmap of unit centres (membership by the pinned formulas), plus the label's own set; a 2-D prefix sum makes each candidate box O(1). Including the label's own in-land frame is harmless: it lies inside its set, and the grown box may hold no unit of the set. Discarded: pairwise footprint intersection tests per candidate (slow, and the arc test would need the same raster anyway).
- D7. **Gap and anchor from boundary units only.** The units nearest to an axis-aligned box outside the set always have their 4-neighbour towards the box outside the set (a step towards the box strictly reduces the distance), so the minimum squared gap and the first such unit in row-major order are found over boundary units only. Tested against all units. Discarded: every unit of the set (same result, slower for faction sets).
- D8. **Interpolation rules in `labelsAt`, crossfade as two draws.** Case (a) is the 005 code unchanged; case (b) produces a `ShapedDraw` of shape straight with centre, h and angle lerped (angle without wrap), and at f = 0 and f = 1 returns the endpoint draw itself; case (c) and the FR-211 "differs" case push the earlier draw at factor 1 - f and the later at f, omitting factor 0. Equality of drawn frames between rounds is a deep comparison of box, frame, offLand and leader. Discarded: interpolating arcs (P5) or moving off-land boxes (P1).
- D9. **Straight labels drawn as whole strings, arcs glyph by glyph.** Straight: `translate(centre)`, `rotate(-theta)`, `scale(wScreen / measured, 1)`, halo stroke then fill, exactly like 005 plus one rotation, so the stretch is along the reading direction (FR-202 (c)). Arc: glyph advances measured once per text at `GLYPH_REFERENCE_PX` (cached in the layer), scaled to w; each glyph translated to its point of the middle line, rotated to the tangent, drawn unstretched. Box labels keep the 005 code path untouched (P7). Discarded: glyph by glyph also for straight labels (loses the browser's kerning and changes nothing measurable inside the FR-202 tolerance).
- D10. **Review-set hits found with recorded browser aspects.** The aspects of every name are measured once in Chrome on the reference PC (scratchpad console snippet calling `measureAspects`), pasted as literals into `test/helpers/measured-aspects.ts`, and used by the NFR-40 hit-finding tests, so the frames found in Node are the frames on the screenshots; the browser check of T10 compares the live aspects with the recorded ones. The layout and hash tests keep the injected constants 4 (factions) and 3 (territories) of 005. Discarded: injected constants for the hits (a hit in Node might not exist on screen).
- D11. **One digest helper for Node and browser.** `test/helpers/label-digest-run.ts` loads the dev map, places territory labels and faction labels of seed 1 at rounds 0..T with aspects 4 / 3, and returns `layoutDigest(...)`; the Node test pins the value; in the browser the same module is imported in the DevTools console from the Vite dev server (`await import('/test/helpers/label-digest-run.ts')`) and its value recorded in the PR. Discarded: a debug address parameter (an address change needs a spec).
- D12. **Exhaustive no-hit searches are opt-in.** Hit-finding tests run the ordered search up to the recorded first hit (cheap when the hit is early). Proving that a dropped step scene has no hit in seeds 1..1000 places faction labels for about 4000 states (minutes in Node); that check runs only with `MBRG_SLOW=1` and its log is pasted in the PR. Discarded: always running it (CI time); not running it at all (a drop would be unproved).

## 4. Interface (TypeScript sketch)
```ts
// shape-params.ts
interface ShapeParams { angleStep: number /* 15, fixed */; shapeGain: number /* 1.5, fixed */; arcBends: readonly number[] /* [30, 60], fixed */;
                        offLandHeight: { faction: number /* 18, 10..40 */; territory: number /* 5, 3..12 */ };
                        offLandReach: number /* 24, fixed */; leaderGap: number /* 6, fixed */ }
SHAPE_PARAMS: ShapeParams;  cs(theta: number): { c: number; s: number }   // only -75..90 in steps of 15, from the spec table
// label-axis.ts
type Shape = { shape: 'straight'; angle: number } | { shape: 'arc'; angle: number; bend: number /* signed degrees */ };
axisAngle(p: PieceIndex, pieces: readonly number[]): number                 // theta*, exact (D1)
axisExtent(p: PieceIndex, pieces: readonly number[], angle: number): number // L
shapesOf(angle: number, extent: number, sp: ShapeParams): Shape[]           // shape order; no arc when L = 0
// label-shape.ts
interface StraightFrame { shape: 'straight'; cx: number; cy: number; angle: number; h: number; w: number }
interface ArcFrame { shape: 'arc'; cx: number; cy: number; angle: number; h: number; w: number; bend: number; radius: number }
type ShapedFrame = StraightFrame | ArcFrame;
type InLandFrame = { shape: 'horizontal'; box: LabelBox } | ShapedFrame;
inStraight(f: StraightFrame, margin: number, px: number, py: number): boolean
arcExists(f: ArcFrame, extent: number, margin: number): boolean
inArc(f: ArcFrame, margin: number, px: number, py: number): boolean
cosK(phi: number): number
shapedCandidate(p, pieces, aspect, params: LayoutParams, sp, minHeight: number): ShapedFrame | undefined
shapedHeight(p, pieces, aspect, params, sp): number | undefined             // hS without prune (tests, review set)
inLandFrame(p, pieces, aspect, horizontal: LabelBox | undefined, params, sp): InLandFrame | undefined
// label-offland.ts
interface LeaderLine { x1: number; y1: number; x2: number; y2: number }      // box point -> anchor unit centre
interface OffLand { shape: 'off-land'; box: LabelBox; gap2: number; anchor: number /* row-major unit */; leader?: LeaderLine }
offLandBox(p, pieces, aspect, height: number, obstacles: readonly (InLandFrame | OffLand)[], params, sp): OffLand | undefined
// label-place.ts
type Placed = ShapedFrame | OffLand;     // only labels whose drawn frame is not the horizontal in-land candidate (D3)
interface TerritoryLayout { boxes: readonly (LabelBox | undefined)[]; inLand: readonly (InLandFrame | undefined)[];
                            placed: readonly (Placed | undefined)[]; eligible: Uint8Array /* aspect and main piece */ }
placeTerritories(p, aspects: ArrayLike<number | undefined>, params, sp): TerritoryLayout
interface FactionLayout { boxes: FactionBoxes /* 005 result */; inLand: ReadonlyMap<number, InLandFrame | undefined>;
                          placed: ReadonlyMap<number, Placed>; recomputed: readonly number[] }
placeFactions(p, owners, aspects: ReadonlyMap<number, number>, params, sp, previous?: FactionLayout): FactionLayout
// label-frame.ts
LabelDraw (005) += { leader?: LeaderLine }
interface ShapedDraw { text: string; role: LabelRole; frame: ShapedFrame; factor: number; ink: Rgb; halo: Rgb }
type AnyLabelDraw = LabelDraw | ShapedDraw;
FactionLabelInput, TerritoryLabelInput += { frame?: ShapedFrame; offLand?: true; leader?: LeaderLine }  // box undefined when frame is set
interface FrameData { shape: 'horizontal' | 'straight' | 'arc'; cx: number; cy: number; angle: number; curvature: number; h: number; w: number }
frameOf(d: AnyLabelDraw): FrameData                                        // curvature = sign(bend) / radius, 0 otherwise
screenFrame(f: FrameData, cam: Camera, vp: Viewport): FrameData             // centre to screen, h, w times scale, curvature / scale
drawable(label: AnyLabelDraw, scale, params): boolean                       // frame height x scale >= P and alpha > 0
instantLabels(round: RoundLabels): AnyLabelDraw[];  labelsAt(input: StepLabels, forward: number): AnyLabelDraw[]
// label-input.ts
roundLabels(texts, table, boxes: FactionBoxes, territoryBoxes, placed?: { factions: ReadonlyMap<number, Placed>; territories: readonly (Placed | undefined)[] }): RoundLabels
// label-counts.ts
interface Counts { horizontal: number; straight: number; arc: number; offLand: number; none: number }
labelCounts(texts, table, factions: FactionLayout, territories: TerritoryLayout): { faction: Counts; territory: Counts }
// glyph-layout.ts (drawing side)
GLYPH_REFERENCE_PX = 100;  glyphOffsets(advances: readonly number[], w: number): { start: number; advance: number }[]
arcGlyphs(f: ArcFrame, offsets): { x: number; y: number; angle: number }[]  // map coordinates, tangent screen angle in degrees
straightMatrix(f: FrameData /* screen */, measured: number, dpr: number): [a, b, c, d, e, f]
// label-digest.ts
digestNumbers(values: Iterable<number>): string;  layoutDigest(t: TerritoryLayout, f: readonly FactionLayout[]): string
// panel-text.ts
labelCountsLine(c: { faction: Counts; territory: Counts }): string
// render/labels-layer.ts
attachLabelLayer(canvas) -> { resize(vp, dpr); draw(labels: readonly AnyLabelDraw[], view: MapView) }
```

## 5. Number reference implementation (FR-196, FR-199, NFR-39)
```
setSums(set): n, Sx, Sy, Sxx, Syy, Sxy over whole unit coordinates (x, y)      // doubles, exact below 2^53
A = (n*Sxx - Sx*Sx) - (n*Syy - Sy*Sy), B = -2*(n*Sxy - Sx*Sy)                  // BigInt
axisAngle: if A = B = 0 -> 0
  mirror = B < 0; if mirror: B = -B
  m = count of boundaries b in [15, 45, 75, 105, 135, 165] with sideOf(b) > 0  // 0 = not passed (tie to 0)
  theta = 15 m; if mirror: theta = -theta; if theta = -90: theta = 90
sideOf(b) = sign(p + q*sqrt3) with (p, q):
  15: (A + B, B - A)   45: (B - A, 0)    75: (-(A + B), B - A)
 105: (B - A, -(A + B)) 135: (-(A + B), 0) 165: (A - B, -(A + B))
sign(p + q*sqrt3): q = 0 -> sign p; p = 0 -> sign q; same signs -> that sign;
  else sign of the larger of p*p and 3*q*q, with the sign of its own term     // BigInt
```
- `cs(theta)` returns the spec table values written with `Math.sqrt` (for negative angles (C, -S)); a test pins every entry against the literal expressions.
- Extent, straight fit, arc existence and membership, K(phi), off-land grown box, squared gap, set centre distance and leader line: literally the spec formulas, in the written order (one function each, the spec line quoted in a comment). The arc K polynomial is evaluated from the innermost bracket (k = 12) outwards: `t = 1 - z / 552; t = 1 - (z / 462) * t; t = 1 - (z / 380) * t; ...; K = 1 - (z / 2) * t`, denominators (2k - 1)(2k) for k = 12 down to 1.
- The FR-169 prefilter of `fitLabel` uses `d * d` instead of `d ** 2` (its exact BigInt decision is unchanged, so the boxes are the same; pinned by the 005 digest test of T2).

## 6. Shaped in-land search (FR-195, FR-197, FR-198, NFR-38)
```
inLandFrame(set, a, hBox):                        // hBox = 005 box (horizontal candidate, FR-195)
  hH = hBox?.h
  bound = hH undefined ? 1 : ceil(G * hH)         // G * hH exact (1.5 * integer)
  if bound > Hmax: return hBox (horizontal)        // FR-198 last clause; skip (NFR-38)
  shaped = shapedCandidate(set, a, bound)
  return shaped ?? hBox                            // shaped has h >= bound, so it wins FR-198
shapedCandidate(set, a, bound):
  theta = axisAngle(set); L = axisExtent(set, theta); shapes = shapesOf(theta, L)
  edt = exact squared distance to the nearest non-set unit centre, over box(set) + 1 ring
  for h = Hmax down to bound:
    for shape in shapes (shape order):
      fits = [c for c in set units if edt[c] >= (rho(shape, h) - EPS)^2 and frame(shape, c, h) exists and fits]
      if fits not empty:                          // first shape in order at the largest h (FR-197)
        n = |fits|; (Sx, Sy) = sums of whole unit coords of the centres
        winner = min over fits of ((n x - Sx)^2 + (n y - Sy)^2 as BigInt, y, x)
        return frame(shape, winner, h)
  return undefined
fits(frame): every unit centre in the grown footprint's conservative bounding box that is inside by the
  pinned formula belongs to the set (outside the image belongs to no set); early exit at the first miss
```
- Exactness of the prunes (tested against `helpers/label-reference.ts`, which enumerates every h, every shape, every centre on a padded window and every unit centre): centres outside the set never fit; the EDT filter only removes centres with a non-set unit strictly inside an inscribed disc; heights below `bound` cannot win FR-198.
- `shapedHeight` is the same scan with bound 1 and no FR-198 skip; it serves the review-set test "stays horizontal although a shaped frame fits" and the hS tests.

## 7. Off-land placement (FR-203 to FR-207, FR-209, FR-215, FR-216)
```
placeRole(labels in placement order, role):       // entries ascending, or factions ascending
  inLand[l] = inLandFrame(l)                       // all decided first (FR-215)
  obstacles = [inLand[l] for every l with one]
  for l in order:
    if inLand[l] undefined or inLand[l].h < offLandHeight(role):          // FR-203
      box = offLandBox(l.set, l.aspect, offLandHeight(role), obstacles)
      if box: placed[l] = box; obstacles.push(box)                         // later labels see it (FR-205)
      else if inLand[l] is shaped: placed[l] = inLand[l]                   // FR-206 fallback
    else if inLand[l] is shaped: placed[l] = inLand[l]
offLandBox(set, a, h):
  w = h a; window = box(set) grown by Dr + w + M + 1, clipped by "grown box inside the image"
  raster obstacles meeting the window + own set; prefix sums
  for y0, x0 in the window:                                               // whole numbers
    reject if grown box has an own-set unit or a blocked unit (prefix sums) // FR-204
    g2 = min over boundary units of the set (D7); reject if g2 > 576       // Dr^2
    key = (g2, centre-to-set-centre squared distance, y0, x0)              // FR-205, pinned doubles
  best key wins; anchor = first unit in row-major order with g2; leader iff g2 > 36 (Gl^2)  // FR-207
```
- Territory role: once per load over every entry with an aspect and a main piece (`eligible`), owner-independent (FR-209). Faction role: per displayed state over the factions of the 005 `FactionBoxes`; in-land frames reused per D5; off-land always searched again (D5).
- The leader line is from the clamped box point to the anchor's centre (spec formula).

## 8. Drawing data and step rules (FR-208, FR-210 to FR-213)
- `roundLabels(..., placed)`: a faction label is listed as in 005; with `placed` its fields become: shaped -> `box` undefined, `frame`; off-land -> `box` = off-land box, `offLand: true`, `leader` if any. A territory label is listed for an owned land entry with a text and either a 005 box or a placed entry. Without `placed`, the 005 output exactly.
- `instantLabels`: box labels as 005 (`leader` copied when present); shaped inputs give `ShapedDraw`.
- `labelsAt(input, f)` (FR-210, FR-211), with "in-land" meaning not `offLand`:
  - eliminated: its earlier drawn frame at 1 - f (none when it has no drawn frame or f = 1).
  - absorber: (a) both in-land horizontal -> 005 code unchanged; (b) both in-land, each horizontal or straight, not both horizontal -> f = 0 / f = 1 the endpoint draw itself, else a straight `ShapedDraw` with centre, h, angle lerped (`a + (b - a) * t`), w = h x aspect, factor 1; (c) otherwise earlier at 1 - f, later at f, each with its leader, factor 0 omitted.
  - other factions: same drawn frame and leader at both rounds (deep equal) -> one draw at factor 1 (earlier below f = 0.5, later from 0.5, same data); otherwise crossfade as (c).
  - territories: as 005 (the same at both rounds, FR-209).
  - Order: factions by index (earlier draw before later draw of one faction), then territories by entry.
- FR-212: the rendering part receives only `AnyLabelDraw[]` and the view; `frameOf` gives shape, centre, angle, curvature (sign(bend) / radius), h and w for every label; no seed, round, round count or record (type test and the existing FR-159 scan).
- FR-208: off-land labels are box labels, so the 005 opacity, factor, P and ink rules apply unchanged.

## 9. Label layer (FR-200 to FR-202, FR-207)
- Pass 1, leader lines: for every drawable label with a `leader` (alpha = `labelAlpha`): black line 3 CSS px wide, then white line 1 CSS px wide, both on the segment, `globalAlpha` = alpha (P12). Nothing is called when no label has a leader, so the 005 fake context keeps working.
- Pass 2, texts in the order given: box labels exactly as 005 (D2 of 005); straight: D9 transform, `textAlign = 'center'`, `textBaseline = 'middle'`, halo 2 CSS px under the same transform; arc: for each glyph of `arcGlyphs`, `translate`, `rotate(-angle)`, font `h x scale`, halo stroke then fill of the glyph, no stretch.
- Cull: box labels as 005; shaped labels by a bounding circle of radius (w / 2 + h) x scale around the screen centre.
- `glyph-layout.ts` (pure, Node-tested, may use `Math.sin`/`Math.cos`): `glyphOffsets` scales the measured advances by one factor so their sum is w; `arcGlyphs` places the midpoint of each advance on the middle line at arc length s from c (s from -w/2 to w/2), tangent angle theta + sign(bend) x (s / R) in degrees; `straightMatrix` composes translate, rotate and the stretch along the reading direction. `GLYPH_REFERENCE_PX` equals `ui/text-metrics.ts` `REFERENCE_PX` (test).

## 10. Earlier tests (NFR-41) — the explicit list
**Edited** (each in an NFR-41 category; nothing else may change; if any other earlier test fails or stops compiling, stop: it is a plan or spec change):
1. `packages/sim/test/traceability.test.ts` (traceability), T1 and T10:
   - Constants: `FR_RANGES` `[[1, 194]]` -> `[[1, 216]]`; `NFR_RANGES` `[[1, 37]]` -> `[[1, 42]]`; new pinned `PENDING_006` (FR-195..FR-216, NFR-38..NFR-42, 27 ids) excluded from `expected` until T10; header comment names spec 006.
   - "NFR-13 NFR-19 the expected list ends at the last spec ids and excludes retired ids": old `[[1, 194]]`, `[[1, 37]]`, everything = expected + retired, size 231, 229, 229, `FR-195`/`NFR-38` not ids; new (T1) `[[1, 216]]`, `[[1, 42]]`, everything = expected + retired + pending, size 258, `specIds.length - RETIRED.length` 256, `expected.length` 229, `FR-216`/`NFR-42` are ids, `FR-217`/`NFR-43` are not; (T10) pending removed, `expected.length` 256.
   - "NFR-19 the expected list excludes only the retired ids": old literal 194 / 37, 229; new literal 216 / 42, 256 without the retired ids; `expected` equals that list minus `PENDING_006` (229) in T1, equals it (256) in T10.
   - "NFR-13 NFR-19 NFR-31 NFR-35 this file self-traces exactly the ids it verifies": old `['FR-55', 'FR-56', 'NFR-13', 'NFR-19', 'NFR-31', 'NFR-35']`; new the same plus `'NFR-41'` (new test "NFR-41 the 27 ids of spec 006 are pinned while pending" in T1, "NFR-41 the 27 ids of spec 006 are all expected" in T10).
2. `apps/web/test/labels-render.test.ts`, "FR-175 type-level: attachLabelLayer takes a canvas and gives resize and draw" (pins the label draw type): old `...['draw']>().parameters.toEqualTypeOf<[readonly LabelDraw[], MapView]>()`; new `toEqualTypeOf<[readonly AnyLabelDraw[], MapView]>()` (plus the type import). T7.
3. `apps/web/test/label-frame.test.ts`, helper `byText` used only by: "FR-181 the eliminated faction keeps its earlier box with the factor 1 - f", "FR-181 the absorber with a box at both rounds interpolates x0, y0 and h linearly, w = h x aspect, factor 1", "FR-181 the absorber with a box at the later round only keeps that box and fades in with the factor f", "FR-181 the absorber with a box at the earlier round only keeps that box and fades out with the factor 1 - f", "FR-171 FR-181 a transferred territory label is identical at every f: ...", "FR-181 a transferred territory label keeps its box and the factor 1 at every f", "FR-181 every other label is drawn as at both rounds with the factor 1", "FR-189 an instant label has the factor 1, the fixed white ink with a black halo, and labels without a box are left out" (drawn box equals the 005 box / every other label as at both rounds / labels exist only with a box). Old `byText(labels: readonly LabelDraw[], text): LabelDraw`; new `byText(labels: readonly AnyLabelDraw[], text): LabelDraw`, which also fails when the found label is a `ShapedDraw`. Every `expect` line unchanged. T6.

**Other earlier tests that assert a label box, and what happens to them** (none edited):
- Kept on the horizontal candidate (they call `fitLabel`, `territoryBoxes` or `factionBoxes`, which stay the 005 functions, FR-195): `label-layout.test.ts` — every FR-169 / FR-170 test, "FR-171 a faction box lies in its main region and a faction without land has no label", "FR-171 a faction that absorbed another gets the box of its new main region", "FR-171 a faction whose main region did not change keeps its box without being laid out again", "FR-171 a previous result of another piece index, other parameters or another aspect is not reused", "FR-170 a faction whose main region has no box keeps a label entry without a box", "FR-171 a faction with no aspect given gets no label entry", "FR-171 territory boxes use only the main piece of each entry and ignore owners", "FR-168 and FR-170 an entry without aspect, without land or too small for height 1 has no territory box", "FR-169 and NFR-33 every faction box of rounds 0..4 lies inside its main region with the margin (time logged)", "FR-169 FR-171 territory boxes lie in their main piece and are equal at rounds 0..4 (time logged)", "FR-171 and FR-189 the reuse of the round being left equals a full recomputation for every step and jump of seed 1"; `label-review-set.test.ts` — "NFR-34 FR-167 FR-169 Italia has at least two regions at round 0 and its label box lies in its main region only", "NFR-34 the dense-area scene holds at least five territory labels drawable at its scale (injected aspect 3)", "NFR-34 the crossfade point has faction labels in view below L0 and territory labels in view above L1"; `labels-perf.test.ts` — all three NFR-32 tests; `labels-purity.test.ts` — "NFR-33 the same results come back while Math.random, Date.now and performance.now throw".
- Kept, asserting the drawn box through the four-argument `roundLabels` (no placement, so the drawn box is the horizontal candidate by D3; the placed case is tested by new tests): `label-input.test.ts` — "FR-167 FR-174 each faction label has its faction name and its box, and no fill", "FR-168 FR-174 a territory label exists for each owned land entry with a box and no fill key", "FR-171 the territory boxes are the same objects at every round and the labels hold nothing of the owner", "FR-174 FR-189 roundLabels takes no colours, ...", "FR-174 the labels of rounds 0..4 and of every step between them ...", "FR-168 FR-170 an entry without owner or without a box has no territory label".
- Kept, asserting the drawn box given as input (the inputs are drawn frames; 005 fixtures are in-land horizontal, which 006 draws exactly as 005): every other test of `label-frame.test.ts` and the FR-172 / FR-173 / FR-174 / FR-175 drawing tests of `labels-render.test.ts` ("draws horizontal text": box labels are still drawn horizontally, through the unchanged 005 path).
- Not edited: `anti-spoiler.test.ts`, `strings-language.test.ts`, `labels-purity.test.ts`, `panel-text.test.ts`, `label-review-set.test.ts`, every 001 to 004 test.

## 11. Traceability
- T1: section 10 item 1 with `PENDING_006`; expected stays 229 (the 005 meaning). A renamed 005 title must still be reported missing (mutation).
- T10: `PENDING_006` removed; expected 256; every id in a test title. Ids that need screenshots or measurements are traced by their pure parts: FR-200 / FR-201 / FR-202 by `glyph-layout.test.ts` and `labels-shaped-render.test.ts` (reference glyph layout, per-glyph transform, no stretch on arcs, stretch only along the reading direction); FR-207 by the leader geometry and the layer's line calls; NFR-38 by `shaped-perf.test.ts` (compute-once and reuse counts, timings logged); NFR-40 by `shaped-review-set.test.ts`.

## 12. Visual verification (NFR-40) and measurement (NFR-38)
- `core/shaped-review-set.ts` `SHAPED_REVIEW_SET` (new module, 005 set untouched), scenes as debug-scene addresses (seed, round, camera, optional `transition`):
  1. `steep-straight`, 2. `diagonal-straight`, 3. `arc-cup` (bend > 0), 4. `arc-cap` (bend < 0), 5. `kept-horizontal` (hS defined, hS < G x hH): each the first hit over territory labels in entry order, then faction labels of seed 1 at rounds 0..T in round then faction order, with the recorded aspects (D10). Territory hits: camera on the frame centre at scale max(L1 + 1, P / h + 0.5); faction hits: at the hit round, camera on the frame centre at L0 - 0.25.
  6. `off-land-island` (main piece with no land neighbour), 7. `off-land-inland`, 8. `off-land-leader`: first territory hits in entry order; scale L1 + 1.
  9. `off-land-faction-fit`: first round of seed 1 with an off-land faction label, at fit scale.
  10. `crossfade-shaped-*` and `crossfade-off-land-*` at L0, (L0 + L1) / 2 and L1, on scenes 1 (or the first shaped hit) and 6.
  11. `step-straight-*`, `step-arc-*`, `step-off-land-*`: the first (seed in 1..1000, then round) whose absorber's drawn frames are (b) horizontal and straight, (c) one arc, (c) one in-land and one off-land; `transition` 0, 0.25, 0.5, 0.75, 1; camera on the midpoint of the two frame centres at L0 - 0.25.
- **Recorded hits** (filled in T9; empty until then): | scene | hit (entry / seed, round, faction) | frame | — a scene with no hit is dropped; the drop and the `MBRG_SLOW=1` log (D12) go in the PR.
- `shaped-review-set.test.ts` pins each hit (the search finds it first) and checks that each address parses and holds what its label says.
- Screenshots: Chrome on the reference PC, 1920 x 1080 drawing area, DPR recorded; the 005 `LABEL_REVIEW_SET` retaken with the 006 code plus every scene above; attached to the PR, not committed. The user accepts every screenshot and the value of `offLandHeight` (2 or 3 candidate values in range, chosen by the user). The crossfade shots are checked for off-land territory labels appearing mid-crossfade (spec edge case).
- NFR-38 procedure (T10, as 005 plan section 12): dev map, reference PC, 1920 x 1080; FR-190 figure (now 005 boxes + shaped + off-land faction placement + front) for steps 0->1, 1->2, 3->4, 4->3 and the jump 0->4; round-change figure; frame stats for 10 s of a step loop and 10 s of pan and zoom at (L0 + L1) / 2; first frame (territory placement at load included). Thresholds 100 ms, 150 ms, median 16.7 ms, p95 33.3 ms, 2 s. A failing figure stops the task: propose an exact speed-up or a spec change (fewer shapes, smaller Dr), never an approximation.
- Browser determinism (T10): the D11 digest in Chrome equals the pinned Node value (and in Edge and Firefox when available on the reference PC); live aspects equal the recorded ones. Recorded in the PR.

## 13. Test strategy (Vitest, Node, no DOM), by file
Titles start with the ids they verify; exact `toStrictEqual`; random grids from a fixed-seed generator in `helpers/shaped-grids.ts` (never `Math.random`); brute-force references in `helpers/label-reference.ts` written from the spec text, independently of `src`.
- `label-axis.test.ts` FR-196, FR-199, NFR-39: theta* for hand sets in every 15 deg sector (lines of units at known angles), exact ties at doubled 45 / 135 (towards 15 / 60, and mirrored), A = B = 0 -> 0, Sxx = Syy with tiny Sxy > 0 -> 45, wrap -90 -> +90; equal to `Math.atan2` in the test on 500 random sets whose doubled angle is more than 1e-6 deg from every boundary; sums above 2^53 (dev map faction sets) handled; `cs` pinned to the literal expressions; shapes and order for theta* = 90 (90, 75, -75; no arc), -75 (-75, 90, -60), +-15 (0 dropped), 0 with arcs; L by the formula; the sideOf table against a high-precision evaluation (BigInt scaled sqrt3).
- `label-shape.test.ts` FR-195, FR-197, FR-198, FR-199, NFR-38: `inStraight` / `inArc` / `arcExists` equal the reference on edge points (inside on the edge), `cosK` within 1e-13 of cos on [0, pi/2 + 1]; arc existence (ends past +-90, inner radius <= 0, L = 0); `inLandFrame` equals the brute-force definition on 200 fixed-seed random grids and on hand grids (vertical strip -> +90 bottom to top, diagonal band, cup and cap bands, region on the image edge, Hmax horizontal kept, near-compact region kept horizontal), with injected aspects; shape order and centre tie on symmetric grids; `shapedCandidate` with the prune equals `shapedHeight` + G rule; mutations: EPS = 0, bound off by one, ties swapped, wrap removed.
- `label-offland.test.ts` FR-203, FR-204, FR-205, FR-206, FR-207, FR-215: `offLandBox` equals the brute-force reference (every x0, y0 in a large window, every unit, every obstacle point) on hand and random grids; trigger at hIn = offLandHeight - 1 / offLandHeight; grown box outside the image refused; own-set unit refused, own other pieces allowed; Dr limit (576 accepted, 577 refused); gap ties by centre distance, then y0, x0; placement order (an earlier box pushes a later one away or out to FR-206); in-land frames of labels that go off-land still block; fallback to the in-land frame or none; leader iff g2 > 36; leader end points; D7 boundary-only equals all units.
- `label-place.test.ts` FR-206, FR-209, FR-213, FR-215, FR-216, NFR-39, NFR-41: territory layout independent of owners (equal at rounds 0..T); dev map: no two drawn labels of the same role conflict (territories once, factions at every round of seed 1, fallbacks included); FR-216: for every step and jump between rounds 0..T of seed 1, `placeFactions` with `previous` equals a computation from that state alone, and a step recomputes only the changed factions' in-land frames; NFR-41: every label whose drawn frame is in-land horizontal has exactly its 005 box (seed 1, every round); the D11 digest pinned; the 005 box digest pinned (T2).
- `label-steps.test.ts` FR-210, FR-211, FR-212: f = 0, 0.25, 0.5, 0.75, 1 for: case (a) equal to the 005 interpolation; case (b) horizontal -> straight and straight -> horizontal, +90 -> -75 passing through 0 (no wrap), endpoints equal to the instant draws; case (c) arc pairs, in-land <-> off-land, one-sided (FR-206 none at one round); a third faction whose off-land box moves (crossfade) and one that is unchanged (one draw); eliminated off-land label with its leader; whole output at f = 0 / f = 1 equals `instantLabels` of the earlier / later round; backward = forward mirrored; `roundLabels` with `placed` (keys per category, territory without 005 box listed when placed off-land); `frameOf` / `screenFrame` values; type test: draw data has no seed, round or record.
- `label-counts.test.ts` FR-214: categories exclusive and summing to the eligible labels; fallbacks counted by shape; no-aspect, no-land and unowned entries in no category; `labelCountsLine` text through `STRINGS`.
- `glyph-layout.test.ts` FR-200, FR-201, FR-202: offsets sum to w and keep the measured proportions; arc glyph points at distance R from the circle centre, the middle at c with tangent theta, cup ends above the middle for bend > 0 at theta = 0 and below for bend < 0; reference points equal frame x scale within 1 px or 1 %; `straightMatrix` = translate x rotate x stretch along the reading direction (stretch axis checked on rotated unit vectors); `GLYPH_REFERENCE_PX` = `REFERENCE_PX`.
- `labels-shaped-render.test.ts` FR-200, FR-201, FR-202, FR-207, FR-208, FR-212: a recording context with a full affine matrix (`rotate` included): straight label rotated by -theta with the stretch along the reading direction, +90 reads bottom to top; arc label glyph by glyph with no stretch (matrix is a rotation x scale(dpr)); halo 2 CSS px before each fill; leader lines 3 px black then 1 px white at the label alpha, before every text, only for drawable labels; off-land label drawn like any box label; box labels draw exactly the 005 calls (call log equal to the 005 log).
- `shaped-purity.test.ts` NFR-39, FR-213, NFR-33: the [N] files of section 2 plus `regions.ts` use no `**` with a Number exponent (only `** <digits>n`), no `Math.pow`, `Math.hypot`, trigonometric, exponential or logarithmic function: every `Math.<name>` is one of `sqrt`, `abs`, `min`, `max`, `floor`, `ceil`, `PI` (comments stripped; a planted violation of each kind is flagged, a planted `** 2n` is not); the new core files name no DOM, clock or randomness; layout, placement, steps and counts give equal results while `Math.random`, `Date.now`, `performance.now` throw; `glyph-layout.ts` is imported by no [N] file.
- `shaped-deps.test.ts` NFR-42: the viewer manifest and lockfile equal the 005 set; new `STRINGS` keys are used and Spanish only in `strings.ts` (the 004 test does the scan; this test pins the new keys).
- `shaped-review-set.test.ts` NFR-40 (section 12). `shaped-perf.test.ts` NFR-38 (logged, not asserted: territory placement once at load, per-step faction placement time on seed 1, recomputed counts).

## 14. Decisions the user must confirm (with this plan)
- U1. NFR-41 edits limited to the three items of section 10; in `label-frame.test.ts` the change is the `byText` helper's type (no assertion changes) (D3, D4).
- U2. A committed test fixture with the text aspects measured once in Chrome on the reference PC, used to find the review-set hits (D10).
- U3. The "no hit in seeds 1..1000" proof of a dropped step scene runs only with `MBRG_SLOW=1`, its log in the PR (D12).
- U4. Off-land boxes of faction labels are searched again at every state; only in-land frames are reused (D5).

## 15. Risks
- Faction layout cost (7 shapes, descending heights): the bound ceil(G x hH) and the EDT filter remove most work on the dev map's large regions; measured in Node in T5 and in the browser in T10. If 100 ms fails, an exact speed-up first (e.g. per-shape maximum EDT bound, row-run checks of footprints), then a spec change.
- Float edge cases: the pinned formulas decide; the references use the same formulas; EPS only in prunes.
- Arc text kerning and halo overlap between glyphs: judged on screenshots (spec risk).
- Placement order effects and shape flicker across rounds: visible in the review set; accepted by the spec.
- `offLandHeight` tuning changes the D11 digest and the review hits: T9 re-pins both after the user's choice.
- 004/005 scans (section 0): `round` in render identifiers, the word `transition`, non-ASCII comments, new placeholders.
- Windows path with spaces: quote; `$env:CI='1'; npm test` before commits.
