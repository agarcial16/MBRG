# Plan 007 — Label refinement (faction and territory labels)
Spec: `specs/007-faction-label-refinement/spec.md` (approved by the user on 2026-10-21 with P14 to P21). Covers FR-217 to FR-230 and NFR-43 to NFR-46 (18 ids). Delivery: branch `feat/007-faction-label-refinement` cut from an up-to-date `rewrite` (6aaa9f2 or later); the spec, plan and tasks are untracked now and are committed there in T1. One PR into `rewrite`, squash merge with the user's OK and CI green. No GitHub issues (one PR is enough; AGENTS.md).

**Gate.** This plan and `tasks.md` need the user's approval, and the decisions of section 14 (U1 to U5) their confirmation, before T1 starts.

## 0. Starting point and guards (read before coding)
- `rewrite` at 6aaa9f2 (spec 006 merged, PR #26). Dev map 2048 x 2048, 70 land + 17 sea entries, 5 factions; seed 1 gives T = 4, so **round 4 is round T** (Francia alone over Iberia, France, Germany and north Italy: n = 1,165,291, C = (932, 1056)).
- 006 label code (unchanged by this spec unless stated): `core/label-axis.ts` (`setSums`, `axisAngle`, `axisExtent`, `wrapAngle`, `shapesOf`), `core/label-shape.ts` (`inStraight`, `arcRadius`, `arcExists`, `cosK`, `inArc`, `DISC_EPS`, `discAllows`, `squaredDistanceMap`, footprints, `shapedCandidate`, `shapedHeight`, `inLandFrame`), `core/label-offland.ts` (`offLandBox`, `placeRole`, `Placed`), `core/label-place.ts` (`placeTerritories`, `placeFactions`, `TerritoryLayout`, `FactionLayout`), `core/label-input.ts` (`roundLabels(..., placed)`), `core/label-frame.ts` (draw data, `instantLabels`, `labelsAt` with the FR-210 / FR-211 rules), `core/label-counts.ts`, `core/label-digest.ts`, `core/shape-params.ts` (`SHAPE_PARAMS`, `cs`), `core/glyph-layout.ts`, `render/labels-layer.ts`, `ui/main.ts` (wiring, lines 141-152).
- Traceability (`packages/sim/test/traceability.test.ts`): ranges `FR [[1, 216]]`, `NFR [[1, 42]]`; 258 ids, 256 expected; asserts `FR-217`, `NFR-43` are NOT ids yet; self-trace list ends with `NFR-41`.
- Guards of 004 to 006 that new code must respect (none of these tests is edited):
  - `anti-spoiler.test.ts`: no identifier containing `seed` or `round` in `src/render/**`; the whole word `transition` is forbidden in core files (say "step"); rAF only in `ui/frame-loop.ts`.
  - `strings-language.test.ts`: every viewer source except `core/strings.ts` is ASCII-only, comments included (write "deg", "rho", "theta"); no new placeholder name; no `kind: '<literal>'` (discriminants are named `shape`). This spec adds **no** UI string.
  - `label-review-set.test.ts` pins `LABEL_PARAMS`; `shape-params.test.ts` pins `SHAPE_PARAMS`: **new parameters go in a new module** (`core/centre-params.ts`); neither pinned object is touched (Hmax stays 120 in `LABEL_PARAMS`: the 005 boxes still use it; the 007 rule simply does not read it).
  - `label-input.test.ts` and many 005 tests use `toStrictEqual`: optional fields are omitted, never set to `undefined`.
  - `labels-purity.test.ts` and `shaped-purity.test.ts` have fixed file lists: new core files get their own purity and number scan (`centred-purity.test.ts`); those two tests are not edited.
  - `shaped-review-set.test.ts` pins the 006 hits computed with the 006 functions: they stay valid because those functions are kept (U1).
- MEMORY lessons that apply: full `npm test` for mutation proofs; back a file up before reverting; perf tests run alone; non-round constants in fixtures; Windows path with spaces quoted; Write/Edit tools for sources.

## 1. "Ask first" items
| Item | Proposal | Status |
|---|---|---|
| New dependency | **None.** Exact arithmetic with the language's `BigInt`; drawing unchanged. | No change |
| Map format, presentation data, id image, `MatchState`, `RoundRecord`, sim/shared exports | **Unchanged** (spec "Compatibility"). | No change |
| Approved 005 parameter Hmax | Not read by the 007 rule (spec D16, P17); `LABEL_PARAMS.maxHeight` stays 120 for the retained 005 boxes. | Allowed by spec |
| Edits to earlier tests | Only the traceability test (section 10). | Allowed by spec (NFR-44) |
| Files outside `apps/web`, `packages/sim/test/traceability.test.ts`, `specs/007-*` | None. | No change |

## 2. Files and responsibilities
```
apps/web/src/core/              PURE (NFR-39 number scan where marked [N])
  centre-params.ts      [N] CENTRE_PARAMS: centreFraction 7/50 (num, den as whole numbers), angleLimit 45,
                            straightAngles [15, -15, 30, -30, 45, -45], factionAreaShare 1/10;
                            since D19 (T8b): arcGain 1/1, arcTangentLimit { faction 45, territory 75 } FR-219, FR-221, FR-230
  label-centre.ts       [N] centreSums (n, Sx, Sy as BigInt), isqrt (BigInt), dyadic(w) -> (W, E),
                            unit-centre disc test and per-row x interval, box disc test and per-row x0
                            interval, endStep (kEnd), exact centre-distance and centre-coordinate keys,
                            factionHeightCap (FR-230)                                               FR-218, FR-222, FR-228, FR-230
  label-centred.ts      [N] centredCandidate (horizontal + straight, uncapped, FR-220 order), arcCandidate
                            (disc, tangent limit, uncapped, P14 order), centredInLand (FR-221 choice and
                            FR-222 widening), boxFits (005 fit columns / rows on run lengths)       FR-218..FR-222, FR-228, FR-230, NFR-43
  label-shape.ts (edit) [N] the arc search body of shapedCandidate extracted into an exported arcSearch
                            with options (centre filter, top height, minimum height, tangent limit,
                            winner rule); shapedCandidate calls it with the 006 options (bit-identical,
                            guarded by the unchanged 006 D11 digest, U5); arcWithinLimit(f, extent, limit) FR-221
  label-centred-place.ts [N] placeCentredTerritories (once), placeCentredFactions (per state, in-land reuse);
                            they return the 006 layout types, whose `boxes` hold the 007 horizontal frames
                            (section 7), so roundLabels, labelCounts, labelsAt and the layer are unchanged FR-217, FR-223..FR-225, FR-229
  label-digest.ts (edit)[N] centredLayoutDigest (new export; layoutDigest unchanged)               NFR-44
  centred-review-set.ts     CENTRED_REVIEW_SET, recorded hits and figures (section 12)              NFR-45
apps/web/src/ui/
  main.ts (edit)            placeCentredTerritories once at load, placeCentredFactions per state with the
                            round being left as `previous`; FR-190 figure around the 007 placement   FR-217, FR-223, FR-229, NFR-43
apps/web/test/
  label-centre.test.ts  label-centred.test.ts  label-centred-arc.test.ts  label-centred-place.test.ts
  centred-steps.test.ts  centred-purity.test.ts  centred-review-set.test.ts  centred-perf.test.ts
  centred-figures.test.ts
  helpers/centred-reference.ts (brute-force definitions from the spec text, independent of src)
  helpers/centred-grids.ts (hand grids, seeded generator)  helpers/centred-figures.ts (NFR-46 table)
  helpers/centred-digest-run.ts (dev-map 007 digest, shared by the Node test and the browser console)
packages/sim/test/traceability.test.ts (edit)                                                       NFR-44
```
No function takes a seed or a round: layout and placement take the piece index, owners, pieces, aspects and parameters (006 FR-213). Seeds and rounds appear only in tests, the review set and the existing `step.ts` / `playback.ts` / `address.ts`.

## 3. Decisions (each with the discarded alternative)
- PD1. **Keep the 005 / 006 functions; add the 007 rule beside them** (U1). `fitLabel`, `territoryBoxes`, `factionBoxes`, `inLandFrame`, `placeTerritories`, `placeFactions` stay byte-for-byte; the viewer switches to the 007 placement. They serve as the "before" reference of NFR-46 and of the changed-label list, and every 005 / 006 test keeps its meaning without edits. The 005 box digest (`5f8e31fd50523b09`) and the 006 D11 digest (`23c90b67d52cbcfa`) stay pinned on those functions; the drawn layout gets a new 007 digest, pinned once in T5 with the changed-label list (NFR-44). Discarded: changing `placeTerritories` / `placeFactions` in place (every 006 placement test, the NFR-41 test and the D11 digest would be edited, and the "before" figures would need a copy of the old code anyway).
- PD2. **The 007 horizontal frame travels in the layout's `boxes`.** `placeCentred*` return a `TerritoryLayout` whose `boxes[entry]` is the 007 horizontal in-land box (undefined when the in-land frame is straight, arc or none) and a `FactionLayout` whose `boxes.labels` hold the same pieces and aspect with `box` replaced in the same way; the 005 result is kept in a new field `base` (used only for reuse). `placed` keeps the 006 meaning (shaped frames, off-land boxes, FR-206 fallbacks) because `placeRole` is reused unchanged. So `roundLabels`, `labelCounts`, `instantLabels`, `labelsAt`, `frameOf` and the layer need no change, and a label with no 007 frame never falls back to its 005 box. Discarded: a new horizontal variant of `Placed` (edits to `roundLabels`, `labelCounts`, `layoutDigest` and their 006 tests).
- PD3. **Exact disc tests by per-row intervals.** For a row (unit row cy, or box row y0) the set of whole cx (or x0) inside the disc of step k is an interval computed once with `isqrt` on BigInt (section 5); every candidate in the interval is in the disc with no per-candidate BigInt work. A unit test compares the intervals with the direct inequality of the spec for every row of random regions and every k up to kEnd. Discarded: the BigInt inequality per candidate (about 72,700 BigInt tests per angle and height for Francia).
- PD4. **Straight heights by binary search, horizontal heights by a relaxed bound and a descending scan.** For a straight angle, with the centre set fixed (the set units in the disc), the pinned fit limits ((h x a) / 2 + M and h / 2 + M) are monotone in h, so "some centre fits" is monotone and a binary search gives the exact largest height (the 006 code already relies on it: "for straight shapes ub is exact"). A horizontal box centre moves with h (x0, y0 whole), so monotonicity does not hold; instead a monotone necessary condition R(h) (section 6) gives an upper bound by binary search, and an exact scan descends from it to the best straight height (a horizontal frame lower than that cannot win; equal height wins by FR-220 step 2). Discarded: a descending scan from the EDT bound for every shape (hundreds of levels on Francia); a binary search on the horizontal predicate itself (not monotone, could miss the answer).
- PD5. **Distance prune with an exact safety margin.** With d2 the exact squared distance (whole number, the 006 `squaredDistanceMap`) from a unit centre to the nearest unit centre outside the set, m = min(1, a) as an exact dyadic and eps = 1/1024: a straight frame of height h at that unit centre is skipped iff (h m + 2M - 2 eps) > 0 and 4 d2 < (h m + 2M - 2 eps)^2; a horizontal box whose centre lies in unit u is skipped iff (h m + 2M - 2 - 2 eps) > 0 and 4 d2(u) < (h m + 2M - 2 - 2 eps)^2 (the centre is within 1 of u's centre). All in BigInt after scaling by 1024 x 2^E. eps is far above the rounding of the pinned formulas for coordinates below 2^12 (as 006 `DISC_EPS`), so a skipped frame is always rejected by the pinned fit test; the brute-force tests prove equality. Arc frames keep the 006 inscribed-disc filter (`discAllows`, proved in 006 D2); no new arc prune. Discarded: the bound without margin (a frame on the edge could be accepted by the pinned formulas and skipped by the prune); double comparisons (spec FR-228, NFR-43 ask for exact decisions).
- PD6. **One arc search for 006 and 007** (U5). The body of `shapedCandidate` restricted to arc shapes becomes `arcSearch(p, pieces, aspect, margin, shapes, options)`; the 006 call passes all shapes in shape order, centres = all set units, top = Hmax, the 006 mean-of-centres winner; the 007 call passes the arc shapes that meet the tangent limit, centres = set units in the disc, top = the smallest of the arc existence bound floor(2 (R - M)) and the faction cap, minimum height ceil(Ga x hC) (G = 1.25 until T8b; the 007 arc gain Ga = 1 from T8b, spec D19, so the arc wins ties; the 006 call keeps `SHAPE_PARAMS.shapeGain`), tangent limit per role, winner = nearest to C, then y, then x (P14). The 006 D11 digest and every 006 test must stay unchanged. Discarded: a copy of the arc search in `label-centred.ts` (two copies of the subtlest code of 006 to keep in step).
- PD7. **Widening as a loop over k with cached per-label data.** The sums, the distance map, the run lengths and θ* / L are computed once per label; each step k only recomputes the disc intervals and the searches. The loop stops at the first k whose in-land frame reaches `offLandHeight` of the role, or at kEnd (P15). Discarded: recomputing everything per k (the distance map dominates the cost of small labels).
- PD8. **Faction cap as a height limit.** Every frame has w = h x a, so 10 h w <= n is a largest height hCap per label (found exactly by a short descending check from floor of an integer square root bound); it is the top of every search of a faction label. Territory labels have no cap. Discarded: checking the cap per frame (same result, more work).
- PD9. **Reuse of faction in-land frames as 006 D5.** A faction whose main region has the same pieces (005 `base` label identical), the same aspect and equal parameters (`LayoutParams`, `ShapeParams`, `CENTRE_PARAMS`) keeps its 007 in-land frame; off-land boxes are searched again for every state. Discarded: reuse keyed on the obstacle set (no gain on the dev map).
- PD10. **Review-set hits and figures with the recorded browser aspects** (006 `helpers/measured-aspects.ts`); the digest and layout tests keep the injected aspects 4 (factions) and 3 (territories) of 005 / 006. Discarded: injected constants for the hits (a hit in Node might not exist on screen).

## 4. Interface (TypeScript sketch)
```ts
// centre-params.ts
interface CentreParams { centreFraction: { num: number; den: number } /* 7 / 50 */; angleLimit: number /* 45 */;
                         straightAngles: readonly number[] /* [15, -15, 30, -30, 45, -45], FR-220 order */;
                         factionAreaShare: { num: number; den: number } /* 1 / 10 */;
                         arcGain: { num: number; den: number } /* 1 / 1, spec D19 (T8b) */;
                         arcTangentLimit: { faction: number /* 45 */; territory: number /* 75, spec D19 (T8b) */ } }
CENTRE_PARAMS: CentreParams
// label-centre.ts
interface CentreSums { n: bigint; sx: bigint; sy: bigint }
centreSums(p: PieceIndex, pieces: readonly number[]): CentreSums
isqrt(v: bigint): bigint                                        // floor of the square root, v >= 0
dyadic(w: number): { W: bigint; E: number }                    // w = W / 2^E exactly, smallest E
unitRowInterval(s: CentreSums, cp: CentreParams, k: number, cy: number): [number, number] | undefined
boxRowInterval(s, cp, k, y0: number, h: number, w: number): [number, number] | undefined
inDiscUnit(s, cp, k, cx, cy): boolean;  inDiscBox(s, cp, k, x0, y0, h, w): boolean   // the spec inequalities (tests)
endStep(s, cp, bbox: { xmin; xmax; ymin; ymax }): number      // kEnd
type CentreKey = { num: bigint; den: bigint }                  // squared distance to C, exact
unitDistance(s, cx, cy): CentreKey;  boxDistance(s, x0, y0, h, w): CentreKey;  compareKeys(a, b): number
factionHeightCap(n: bigint, aspect: number, share): number     // largest h with den * h * w <= num * n
// label-centred.ts
type CentredFrame = { shape: 'horizontal'; box: LabelBox } | StraightFrame      // the 006 types
centredCandidate(p, pieces, aspect, margin, cp, k, cache, top: number | undefined): CentredFrame | undefined
arcCandidate(p, pieces, aspect, margin, sp, cp, k, cache, minHeight, top): ArcFrame | undefined
centredInLand(p, pieces, aspect, role: LabelRole, params: LayoutParams, sp: ShapeParams, cp: CentreParams):
  { frame: InLandFrame | undefined; k: number }                // FR-221 choice after the FR-222 widening
// label-shape.ts (edit)
arcSearch(p, pieces, aspect, margin, shapes: readonly Shape[], o: ArcSearchOptions): ArcFrame | undefined
arcWithinLimit(f: ArcFrame, extent: number, limit: number): boolean   // theta - alpha >= -limit, theta + alpha <= limit
// label-centred-place.ts
interface CentredTerritoryLayout extends TerritoryLayout { steps: readonly (number | undefined)[] }
interface CentredFactionLayout extends FactionLayout { base: FactionBoxes; steps: ReadonlyMap<number, number>; centreParams: CentreParams }
placeCentredTerritories(p, aspects, params, sp, cp): CentredTerritoryLayout
placeCentredFactions(p, owners, aspects, params, sp, cp, previous?: CentredFactionLayout): CentredFactionLayout
// label-digest.ts (edit)
centredLayoutDigest(t: CentredTerritoryLayout, f: readonly CentredFactionLayout[]): string
```

## 5. Exact arithmetic (FR-218, FR-222, FR-228, FR-230)
```
centreSums: n, Sx = sum x, Sy = sum y over whole unit coordinates (BigInt; Sx can exceed 2^53 on factions)
q = num / den = 7 / 50;  rho^2 = q^2 n;  disc of step k: dist^2 <= k^2 q^2 n
unit centre (cx + 0.5, cy + 0.5):  den^2 ((n cx - Sx)^2 + (n cy - Sy)^2) <= num^2 k^2 n^3
  row cy: Y = n cy - Sy; R = num^2 k^2 n^3 - den^2 Y^2; none if R < 0;
  |n cx - Sx| <= isqrt(R / den^2) = T  ->  cx in [ceil((Sx - T) / n), floor((Sx + T) / n)]  (BigInt floor division)
box (x0, y0, h, w = W / 2^E):
  X = 2^(E+1) (n x0 - Sx) + n W - 2^E n;  Y = 2^E (2 (n y0 - Sy) + n h - n)
  in disc iff den^2 (X^2 + Y^2) <= num^2 k^2 n^3 2^(2E+2)       // spec Definitions, with 2500 = den^2, 49 = num^2
  row y0: T = isqrt((num^2 k^2 n^3 2^(2E+2) - den^2 Y^2) / den^2); x0 range from |X| <= T, X linear in x0 (step 2^(E+1) n)
isqrt: Newton on BigInt from a power-of-two start, then fix-up so that r^2 <= v < (r + 1)^2 (tested on 10^5 values and edges)
  using floor(R / den^2) is exact for the interval: |X| <= sqrt(R) / den  <=>  |X| <= isqrt(floor(R / den^2)) for whole X
dyadic(w): E = 0; while w is not a whole number: w = w * 2, E = E + 1 (exact doubling); W = BigInt(w)
endStep: corners (X, Y) of [xmin, xmax + 1] x [ymin, ymax + 1]: D = max over corners of (2 n X - 2 Sx - n)^2 + (2 n Y - 2 Sy - n)^2;
  kEnd = smallest k >= 1 with den^2 D <= 4 num^2 k^2 n^3  (k from isqrt, then fix-up by one)
keys: unit centre: (n cx - Sx)^2 + (n cy - Sy)^2 over n^2; box: (X^2 + Y^2) over (2^(E+1) n)^2; compare by cross products
centre y / x of a box: (2 y0 + h) / 2 and (2^(E+1) x0 + W) / 2^(E+1): compared exactly as rationals
factionHeightCap: largest h >= 0 with den * h * W(h) <= num * n * 2^E(h)  (W, E of the double h * a); start at
  isqrt(num * n / (den * a_low)) + 2 with a_low a lower dyadic bound of a, descend while the test fails
```
- Every function here uses only BigInt arithmetic and whole-number Number values; the number scan of `centred-purity.test.ts` checks it (section 13).

## 6. Search (FR-219 to FR-222, NFR-43)
```
centredInLand(set, a, role):
  cache = { sums, bbox, d2 map (006 squaredDistanceMap), right-run lengths, theta*, L }      // once (PD7)
  top = role = faction ? hCap : undefined                                                     // FR-230 (PD8)
  for k = 1 .. kEnd:
    c = centredCandidate(set, a, k, top)
    arc = arcCandidate(set, a, k, minHeight = c ? ceil(Ga x c.h) : 1, top, limit = arcTangentLimit[role])
                                                                                              // Ga = num/den exact; 1/1 since D19 (T8b): minHeight = c.h
    frame = arc ?? c                                                                          // FR-221: arc if it reaches ceil(Ga hC): arcs win ties
    if frame and height(frame) >= offLandHeight(role): return { frame, k }                    // FR-222 stop (P15)
    last = { frame, k }
  return last                                                                                 // at kEnd (none if nothing fits)

centredCandidate(set, a, k, top):
  U = set units in the disc of step k (row intervals, PD3), sorted by d2 descending
  for theta in straightAngles:                                                                // P14 order of step 3, 4
    h_theta = largest h <= top with some u in U: straight(u, theta, h) fits
              (binary search on h, PD4; candidates filtered by the PD5 bound; early stop on the first fit)
  hS = max h_theta (undefined if none)
  ub = binary search of R(h) = "some unit u within distance (k rho_up + 1) of C has
       d2(u) allowing h - 2 by PD5, and its row run of set units through u has length >= floor(h a + 2M) - 1"
       // monotone in h, necessary for a horizontal box of height h with centre in the disc (rho_up = isqrt bound >= rho)
  hH = first h from min(ub, top) down to max(hS, 1) with a box (x0, y0 whole, row interval PD3) that fits (boxFits)
  hC = max(hH, hS); winners = fitting frames at hC: horizontal ones if hH = hC, else the straight ones of the
       first theta in order with h_theta = hC; winner = smallest key (exact), then centre y, then centre x
boxFits(x0, y0, h, w): rows y0 - M .. y0 + h + M - 1 each have a run of set units from column x0 - M
  of length >= 2M + 1 + floor(w - 0.5)                                                       // the 005 FR-169 fit, as in fitLabel
arcCandidate: arcSearch with the arc shapes of shapesOf(theta*, L) that meet arcWithinLimit(limit) at their
  existence (limit 45 for both roles until T8b; faction 45 / territory 75 from T8b, spec D19), centres = U,
  top = min(floor(2 (R - M)), top), minHeight, winner P14
```
- Exactness: `helpers/centred-reference.ts` enumerates every height from 1 to a bound derived from the grid size, every angle, every centre (unit centres and whole x0, y0) on a padded window and every unit centre, applies the spec inequalities directly (BigInt, no intervals), the 006 pinned fit formulas and the FR-220 / P14 order; `centredInLand` must equal it on every test grid.
- The size of the work for Francia at round 4 is about 72,700 disc centres per angle; the binary search tests about log2(hCap = 170) = 8 heights per angle; the PD5 filter removes most centres at large h. Measured in Node in T3 / T4 and in the browser in T9.

## 7. Placement, data and steps (FR-217, FR-223 to FR-227, FR-229)
- `placeCentredTerritories`: for every eligible entry (main piece and valid aspect, as 006) `centredInLand(role territory)`; then `placeRole(..., offLandHeight.territory)` unchanged (006 off-land rules, FR-217); `boxes[entry]` = the 007 horizontal box or undefined (PD2); owner-independent (FR-224).
- `placeCentredFactions`: `base = factionBoxes(p, owners, aspects, params, previous?.base)` (only for the pieces and aspects of each main region, and for reuse); in-land frames reused by PD9, else `centredInLand(role faction)`; `placeRole(..., offLandHeight.faction)`; `boxes` = `base` with each `box` replaced (PD2); `recomputed` lists the factions whose in-land frame was computed.
- Origin-free (FR-223): `centredInLand` reads only the pieces, the aspect and the parameters; the test gives the same pieces to every faction index and to territory-style inputs and checks equal in-land frames.
- Steps (FR-226): `labelsAt` is unchanged: a horizontal 007 frame is a box label, a straight one a `ShapedDraw`, so the 006 cases (a) box / box, (b) box / straight and straight / straight, (c) crossfades apply as they are; frames taller than 120 are ordinary input. Tests in `centred-steps.test.ts` run the 006 step rules on 007 layouts of seed 1.
- Natural proportions (FR-227): `straightMatrix` and the layer are unchanged; a test checks that for 007 straight frames (h up to hCap, angles to 45 deg) the only stretch is along the reading direction and equals w / measured length.
- Counts (FR-229): `labelCounts` on the 007 layouts unchanged (PD2); the panel line is the 006 one.

## 8. Drawing side
No change to `label-frame.ts`, `glyph-layout.ts`, `render/labels-layer.ts`, `ui/panel.ts`, `strings.ts`. `ui/main.ts` changes only the two placement calls, the `previous` type and the FR-190 timer span.

## 9. Number reference implementation
- The 006 formulas are used unchanged for fit, existence and membership (`inStraight`, `inArc`, `arcExists`, `cosK`, straight footprints, `boxFits` = the 005 rule).
- New pinned formula: `arcWithinLimit`: alpha = ((h x a) x |bend|) / (2 x L) (degrees, the 006 expression), allowed iff (theta - alpha) >= -limit and (theta + alpha) <= limit, theta the frame's angle; evaluated in that order.
- Every decision of section 5 is BigInt; no double comparison decides a disc, a key, kEnd or the cap.

## 10. Earlier tests (NFR-44) — the explicit list
**Edited** (nothing else may change; if any other earlier test fails or stops compiling, stop: it is a plan or spec change):
1. `packages/sim/test/traceability.test.ts`, T1 and T9:
   - Constants: `FR_RANGES` `[[1, 216]]` -> `[[1, 230]]`; `NFR_RANGES` `[[1, 42]]` -> `[[1, 46]]`; new pinned `PENDING_007` (FR-217..FR-230, NFR-43..NFR-46, 18 ids) excluded from `expected` until T9; header comment names spec 007.
   - "NFR-13 NFR-19 the expected list ends at the last spec ids and excludes retired ids": old `[[1, 216]]`, `[[1, 42]]`, size 258, 256, 256, `FR-216` / `NFR-42` ids, `FR-217` / `NFR-43` not; new (T1) `[[1, 230]]`, `[[1, 46]]`, everything = expected + retired + pending, size 276, `specIds.length - RETIRED.length` 274, `expected.length` 256, `FR-230` / `NFR-46` ids, `FR-231` / `NFR-47` not; (T9) pending removed, `expected.length` 274.
   - "NFR-19 the expected list excludes only the retired ids": old literal 216 / 42, 256; new literal 230 / 46, 274 without the retired ids; `expected` equals that list minus `PENDING_007` (256) in T1, equals it (274) in T9.
   - "NFR-13 NFR-19 NFR-31 NFR-35 this file self-traces exactly the ids it verifies": old list ending `'NFR-41'`; new the same plus `'NFR-44'` (new test "NFR-44 the 18 ids of spec 007 are pinned while pending" in T1, renamed "NFR-44 the 18 ids of spec 007 are all expected" in T9).

**Kept unchanged, and why their meaning holds** (PD1): every 005 test of `fitLabel` / `territoryBoxes` / `factionBoxes`; every 006 test of `inLandFrame`, `shapedCandidate`, `placeTerritories`, `placeFactions` (including "NFR-41 every label drawn as an in-land horizontal frame has exactly its 005 box" and the D11 digest test), of `roundLabels`, `labelsAt`, `labelCounts`, `glyph-layout`, the layer and the review sets: they test functions this spec does not change (the `arcSearch` extraction of PD6 is required to leave `shapedCandidate` bit-identical). No 001 to 004 test is touched.

## 11. Traceability
- T1: section 10 item 1 with `PENDING_007`; expected stays 256. A renamed 006 title must still be reported missing (mutation).
- T9: `PENDING_007` removed; expected 274; every id in a test title. Ids checked by screenshots or measurements are traced by their pure parts (spec "Done criteria"): FR-227 by `centred-steps.test.ts` (stretch only along the reading direction for 007 straight frames); NFR-43 by `label-centred.test.ts` / `label-centred-arc.test.ts` (pruned search equals the reference) and `centred-perf.test.ts` (timings logged, not asserted); NFR-45 by `centred-review-set.test.ts` (hit finding, addresses); NFR-46 by `centred-figures.test.ts` (the figures are computed by the test helper and the recorded table is compared with them).

## 12. Visual verification (NFR-45), figures (NFR-46) and performance (NFR-43)
- `core/centred-review-set.ts` `CENTRED_REVIEW_SET` (new module; the 005 and 006 sets untouched), debug-scene addresses (seed, round, x, y, zoom, optional `transition`), each taken **before** (viewer still on the 006 placement, before T7) and **after** (T8) at the same address:
  1. `fit-r0` .. `fit-r4`: seed 1, rounds 0 to 4, fit scale (round 4 = round T).
  2. `francia-r4`: seed 1 round 4, camera on C = (932, 1056) at fit scale; shown beside reference B (U2).
  3. `italia-r0` .. `italia-r3`: seed 1, camera on the centre of mass of Italia's main region at the round, scale L0 - 0.25. From T8b also `espana-r2` (the same camera rule): both are faction arcs under D19.
  4. `step-straight-0` .. `-1`: the first (seed 1 first, then seeds 2..1000, then round) whose absorber's drawn frames are horizontal at one round and straight at the other with the 007 rule; `transition` 0, 0.25, 0.5, 0.75, 1; camera on the midpoint of the two frame centres at L0 - 0.25. No hit: dropped, proved with `MBRG_SLOW=1` (U3).
  5. Territory close-ups: Galicia, Castilla-La Mancha, Bremen, Hamburgo, Trentino-Alto Adigio, Friuli-Venecia Julia, and every territory whose 006 frame is steeper than 45 deg (found by a test over the 006 territory layout in entry order; for example Baviera at -75); camera on the territory's centre of mass, scale max(L1 + 1, P / h + 0.5) with h the smaller of the 006 and 007 heights, so before and after share the camera. From T8b also every territory whose frame is an arc in 006 or in the D19 layout (the former "arc turned straight" close-ups become "turned into, or kept as, arc" close-ups), same camera rule.
- Screenshots: Chrome on the reference PC, 1920 x 1080 drawing area, DPR recorded; attached to the PR, not committed (stored in the session scratchpad meanwhile). The user accepts every after shot, Galicia and Castilla-La Mancha explicitly with their figures.
- **Recorded figures** (section 15; NFR-46): produced by `helpers/centred-figures.ts` with the recorded aspects (PD10): per territory label and per faction label at rounds 0..4 of seed 1: name, n, C, rho, step k, 006 frame (shape, angle, h, centre), 007 frame, centre offset (units and fraction of sqrt n), side gaps of horizontal frames, arc candidate height, in-land / off-land status in 006 and 007. "Before" columns in T2 (006 frames, C, n, rho, offsets of the 006 frames); "after" columns in T8. Check after T3 (U4): Francia at round 4 has a straight centred candidate at step 1; if not, stop (spec change on q).
- NFR-43 procedure (T9, as 006 plan section 12): dev map, reference PC, 1920 x 1080; FR-190 figure for the steps 0->1, 1->2, 2->3, 3->4, 4->3 (each <= 100 ms, with reuse) and for the jumps 0->4 and 4->0 and the faction layout of a fresh load at `?seed=1&round=4` (each <= 150 ms, P19); every round change drawn within 150 ms of the request; frame stats for 10 s of a step loop and 10 s of pan and zoom at (L0 + L1) / 2 (median <= 16.7 ms, p95 <= 33.3 ms); first frame <= 2 s with the territory placement at load. Node timings logged first in T3 to T5 (`centred-perf.test.ts`, run alone). A failing figure stops the task: an exact speed-up, or a spec change (smaller q, fewer angles), never an approximation.
- Browser determinism (T9): the 007 digest from `helpers/centred-digest-run.ts` in Chrome equals the Node pin (Edge and Firefox when available); recorded in the PR.

## 13. Test strategy (Vitest, Node, no DOM), by file
Titles start with the ids they verify; exact `toStrictEqual`; random grids from a fixed-seed generator in `helpers/centred-grids.ts` (never `Math.random`); references in `helpers/centred-reference.ts` written from the spec text.
- `label-centre.test.ts` FR-218, FR-222, FR-228, FR-230: `centreSums` against direct sums (also above 2^53, dev-map Francia); `isqrt` on 10^5 values and at squares +-1; `dyadic` round trip for heights x measured aspects; row intervals equal the direct spec inequality for every row of 200 random regions and k = 1..kEnd (unit centres and boxes, aspects above and below 1); `endStep`: disc at kEnd contains every corner and at kEnd - 1 does not; keys and centre comparisons against rational arithmetic; `factionHeightCap` equals a linear scan; n <= 51 gives rho < 1 (disc may be empty).
- `label-centred.test.ts` FR-219, FR-220, FR-222, NFR-43: `centredCandidate` equals the reference on 200 random grids and hand grids (large diagonal band, compact block, two lobes, crescent with C outside the land, region of 40 units, aspect 0.6, aspect 8.5 on an irregular region, region on the image edge); heights above 120 reached; tie order steps 2 to 7 on symmetric grids (horizontal vs straight at equal h, +theta vs -theta, equal distances); PD5 prune equals no prune; mutations: eps = 0 on a planted edge grid, `<=` -> `<` in a disc test, R(h) without the -1 slack, tie steps swapped, angle list order swapped.
- `label-centred-arc.test.ts` FR-221, FR-222, FR-230: `arcCandidate` equals the reference (disc, tangent limit per role, uncapped top, P14 winner); gain rule at ceil(Ga hC) - 1 / ceil(Ga hC) (G = 1.25 until T8b, Ga = 1 from T8b: equal height wins); widening: stops at the first k reaching `offLandHeight`, a tiny arc does not stop it, ends at kEnd with the unrestricted tallest frame; faction cap on all three shapes; `shapedCandidate` (006) bit-identical after the PD6 extraction (a digest of its results on 200 random grids taken before the extraction, plus the unchanged D11 digest).
- `label-centred-place.test.ts` FR-217, FR-223, FR-224, FR-225, FR-229, NFR-44: territory layout independent of owners (rounds 0..4); origin-free: the same pieces given to each faction index give equal in-land frames, and a faction layout equals the territory rule on the same set and aspect (same role parameters); no same-role conflict on the dev map (territories once, factions every round of seed 1); reuse equals a computation from the state alone for every step and jump of seed 1; `boxes` hold only 007 horizontal boxes (a label with no 007 frame has no box); `labelCounts` on 007 layouts; 007 digest pinned and the changed-label list (role, name, 006 frame, 007 frame) written to the test log and recorded in section 15; 005 box digest and 006 D11 digest unchanged.
- `centred-steps.test.ts` FR-226, FR-227: the 006 step rules on 007 layouts of seed 1 at f = 0, 0.25, 0.5, 0.75, 1 (horizontal <-> straight interpolation, arc crossfade, Italia 2 -> 3 crossfade), f = 0 / f = 1 equal the instant drawings; `straightMatrix` stretch only along the reading direction for frames up to hCap at +-45 deg.
- `centred-purity.test.ts` NFR-44, FR-228: the [N] files of section 2 pass the 006 number scan (only `sqrt`, `abs`, `min`, `max`, `floor`, `ceil`, `PI` from `Math`; no `**` with a Number exponent; BigInt `** <digits>n` allowed); no DOM, clock or randomness; results equal while `Math.random`, `Date.now`, `performance.now` throw; planted violations flagged.
- `centred-review-set.test.ts` NFR-45: hits found in the stated order and pinned; addresses parse and hold what their label says; steep-territory list equals the 006 layout scan.
- `centred-figures.test.ts` NFR-46: the recorded table of section 15 equals the helper output (before columns from T2, after columns from T8); every 007 centre offset <= k rho of its step; Francia round 4 straight with centre within rho of C.
- `centred-perf.test.ts` NFR-43 (logged, not asserted): territory placement at load, faction placement per step and from scratch on seed 1, widening steps used, recomputed counts.

## 14. Decisions the user must confirm (with this plan)
- U1. Keep the 005 / 006 functions as the "before" reference; the viewer switches to the 007 placement. Consequence for NFR-44: the 005 box digest and the 006 D11 digest stay pinned unchanged (they pin functions this spec does not change), and the "re-pin once" of the spec is a **new** pinned 007 layout digest with the changed-label list, taken in T5. Alternative: change the 006 placement in place and edit the 006 placement tests and the D11 pin.
- U2. Reference B: the user provides the image of the render chosen on 2026-10-20 (it is not in the repository); if it is not available, `francia-r4` is compared with the recorded B figures (+40 deg, h 155, centre (905, 941)).
- U3. The "no hit in seeds 1..1000" proof of a dropped step scene runs only with `MBRG_SLOW=1`, its log in the PR (as 006 D12).
- U4. Checkpoint after T3: if Francia at round 4 has no straight centred candidate within rho at step 1, implementation stops for a spec change on q (rather than tuning q in code).
- U5. The arc search of `shapedCandidate` is extracted into a shared `arcSearch` used by 006 and 007 (guarded by the unchanged D11 digest and a random-grid digest). Alternative: a separate copy for 007.

## 15. Recorded figures and hits
Filled in T2 (before), T5 (changed-label list, 007 digest), T6 (hits) and T8 (after).

**Before (T2).** The retained 006 placement (`placeTerritories`, `placeFactions`) with the aspects measured in Chrome (PD10), seed 1, rounds 0..4. The full table (70 territory labels + 15 faction labels = 85 rows, from `helpers/centred-figures.ts`) is printed by `centred-figures.test.ts` and pinned there by the digest `0ce16eeca4e27140` of its lines; the review rows below are pinned one by one. Offset = centre of the 006 in-land frame minus C (units, and fraction of sqrt n); side gaps (L, R) only for horizontal frames. All 85 labels are in-land in 006 (0 off-land). C is (Sx / n + 0.5, Sy / n + 0.5); rho = 0.14 sqrt n.
| label | role | n | C | rho | 006 frame (shape, angle, h, centre) | offset | side gaps | after: 007 frame / k / arc h |
|---|---|---|---|---|---|---|---|---|
| Galicia | territory | 19,980 | (204.3, 1208.3) | 19.8 | straight +90, h 50, (224.5, 1207.5) | (20.2, -0.8) d 20.2 = 0.143 sqrt n | - | T8 |
| Castilla-La Mancha | territory | 53,635 | (504.8, 1537.7) | 32.4 | horizontal, h 29, (497.7, 1586.5) | (-7.1, 48.8) d 49.3 = 0.213 sqrt n | L 20.0, R 10.6 | T8 |
| Baviera | territory | 47,174 | (1448.5, 689.0) | 30.4 | straight -75, h 73, (1433.5, 693.5) | (-15.0, 4.5) d 15.6 = 0.072 | - | T8 |
| Bremen | territory | 215 | (1269.2, 318.5) | 2.1 | straight -30, h 3, (1269.5, 318.5) | d 0.3 | - | T8 |
| Hamburgo | territory | 517 | (1334.3, 275.3) | 3.2 | straight -30, h 4, (1335.5, 277.5) | d 2.5 = 0.109 | - | T8 |
| Trentino-Alto Adigio | territory | 9,115 | (1459.9, 916.6) | 13.4 | straight +45, h 14, (1465.5, 921.5) | d 7.4 = 0.078 | - | T8 |
| Friuli-Venecia Julia | territory | 4,935 | (1573.5, 931.6) | 9.8 | straight -45, h 9, (1576.5, 935.5) | d 4.9 = 0.069 | - | T8 |
| Italia r0, r1, r2 | faction | 169,251 | (1550.1, 1180.8) | 57.6 | horizontal, h 120, (1364.2, 1047.0) | (-186.0, -133.8) d 229.1 = 0.557 | L 62.0, R 66.7 | T8 |
| Italia r3 | faction | 393,071 | (424.5, 1466.4) | 87.8 | horizontal, h 120, (416.2, 1467.0) | d 8.4 = 0.013 | L 234.0, R 302.7 | T8 |
| Francia r4 | faction | 1,165,291 | (932.4, 1056.7) | 151.1 | horizontal, h 120, (628.9, 1267.0) | (-303.5, 210.3) d 369.2 = 0.342 | L 310.0, R 1004.2 | T8 |
Notes on the before figures:
- The 006 steep territory frames (steeper than 45 deg) are the ones the 007 limit removes (for example Galicia +90, Baviera -75); the complete list is the T6 scan over this layout.
- **Evidence corrected in T3 (a data fix, not a change to q).** The spec quoted the 006 Francia label at round 4 as horizontal h 120 "centred at (343, 1214), 610 units from C". (343, 1214) is the top-left corner (x0, y0) of the 006 box, not its centre. The retained 006 code gives, for every aspect tried (2 to 6, the measured 3.23 and the injected 4), h 120 at centres (523..811, 1148..1277) (injected aspect 4: centre (583, 1274), 411 units from C; measured 3.23: (628.9, 1267.0), 369 units from C), or (1107, 742) at aspect 6. All are horizontal h 120 and far beyond rho = 151 (2.4 to 2.7 rho), so the conclusion of the spec ("the 006 rule leaves Francia far from the centre") holds. C, n and rho of the evidence are reproduced exactly (n 1,165,291; C (932.4, 1056.7); rho 151.1). The spec text (Measured evidence, "Why the 006 rule gives these results" item 2, D10) is corrected accordingly.
- **q check (NFR-46).** The two evidence frames lie within rho at q = 7/50 of the exact C: the +40 deg h 160 frame at (972, 916) is 146.2 units away (0.135 sqrt n) and reference B at (905, 941) is 118.9 away (0.109 sqrt n); with q = 3/25 (rho 129.5) the h 160 frame would be excluded. q = 7/50 stands.
- With the measured aspects, Italia (faction 4) is horizontal h 120 in rounds 0 to 2 (the arc of the spec evidence appears with the injected aspect 4); Portugal at round 0 and 1 is an arc (+75 deg, h 76) and is the only 006 arc among the faction labels.

**T3 check (U4, centred candidate at step 1, faction cap of FR-230, Francia at round 4).**
| aspect | cap | frame found | centre | from C | height range (hS / hH) |
|---|---|---|---|---|---|
| 3.23 (measured) | 189 | straight -30 deg, h 189 (at the cap) | (956.5, 982.5) | 78.0 = 0.52 rho | 189 / none above 189 |
| 4 (injected) | 170 | straight +45 deg, h 170 (at the cap) | (833.5, 1120.5) | 117.7 = 0.78 rho | 170 / none above 170 |
Both are straight frames within the disc of step 1 (rho 151.1), so q = 7/50 stands and U4 passes. Both reach the cap n/10: at round 4 the cap decides the height, not the fit. Node timings (T3, `centred-perf.test.ts` run alone, per label, step 1, membership-only cache): Francia round 4 about 55 to 95 ms (cache 27 ms, candidate 25-65 ms; the slower figure is aspect 4); all faction labels of a round from scratch 34 to 57 ms; 70 territory labels about 270 ms (69 have a frame at step 1; one needs the widening of T4). The exact distance map costs about 110 to 140 ms for Francia and saves nothing on the dev map, so the cache builds it only on request (`distance`); the prune on top of it is kept and proved equal to the plain definition. Arcs (T4) and the off-land search are not included yet.

**T4 check (arcs, FR-221 choice, widening, faction cap; dev map, seed 1, measured aspects, Node, `centred-perf.test.ts` run alone).**
- **Territory label with no centred frame at step 1: Liguria.** It is the only one of the 70 eligible territory labels; the widening gives a straight +30 deg frame of h 7 at step 2 of kEnd 13 (reaches `offLandHeight` 3). The other 69 stop at step 1. Frame kinds of the 70 territory labels after T4: 15 horizontal, 55 straight, 0 arc, 0 none. No arc beats the G rule on the dev map, for territories or factions (45 deg limit, G = 1.25); arcs are covered by constructed grids (thin circular bands with long text aspects).
- Faction labels in-land search from scratch (k = step used / kEnd): round 0 Alemania horizontal h75, Espana horizontal h102, Francia horizontal h106, Italia straight -15 h87, Portugal straight +30 h39 (all k 1); round 1 Francia h136; round 3 Francia h136, Italia horizontal h133; round 4 Francia straight -30 h189 (the cap) k 1/10.
- Node times: 70 territory labels with arcs and widening 562 ms in total (slowest Castilla-La Mancha 20.5 ms); faction labels per round from scratch 41 to 60 ms; Francia at round 4 56 ms. The arc search builds the exact distance map only for labels where an arc can exist (|theta*| <= 45 deg, L > 0); the T3 cost of that map is therefore paid only there.
- `arcSearch` extraction guard: digest of `shapedCandidate` on 1,280 cases (hand grids, 18 circular bands, 200 random grids; 540 frames, 75 arcs, 465 straight) `f8efcdfda2a05c86` taken on the unchanged code before the extraction and equal after; 006 D11 digest `23c90b67d52cbcfa` and 005 box digest `5f8e31fd50523b09` unchanged.

**T5 check (role placements, 007 digest, changed-label list; `placeCentredTerritories`, `placeCentredFactions`).**
- **007 digest `767ff73c98c1fa4d`** (`centredLayoutDigest` in `label-digest.ts`; dev map seed 1, injected aspects 3 / 4, territories once + factions rounds 0..4 each from scratch; includes each frame's widening step). 006 D11 digest `23c90b67d52cbcfa` and 005 box digest `5f8e31fd50523b09` unchanged. Pinned in `label-centred-place.test.ts`; browser run: `devCentredDigest()` from `test/helpers/centred-digest-run.ts` (T9).
- Deviation from PD2 / section 7: `placeCentredFactions` builds `boxes.labels` itself (main regions + the 007 frame) and does not call the 005 `factionBoxes`, so there is no `base` field and no 005 fit cost per state; reuse key = same piece index, pieces, aspect and equal layout / shape / centre parameters. `steps` (widening step per label) is carried in both layouts and in the digest.
- **Changed labels versus 006** (drawn frame differs; 85 labels = 70 territories + 15 faction labels over rounds 0..4):
  Both aspect sets: 82 of 85 changed = 67 of 70 territory labels + all 15 faction labels (3 territory labels keep their 006 frame).
Territory shapes: 006 39 horizontal / 22 straight / 9 arc (both aspect sets); 007 injected 14 / 56 / 0, measured 15 / 55 / 0 (0 off-land, 0 none).
  - Injected aspects, territories (67 changed): arc -> straight 8 (Baden-Wurtemberg, Renania-Palatinado, Sajonia-Anhalt, Extremadura, Occitania, Lacio, Marcas, Toscana); horizontal -> straight 36 (Bremen, Hamburgo, Mecklemburgo-Pomerania Occidental, Sajonia, Sarre, Schleswig-Holstein, Turingia, Islas Baleares, Castilla-La Mancha, Castilla y Leon, Cataluna, La Rioja, Madrid, Murcia, Pais Vasco, Alta Francia, Bretana, Centro-Valle del Loira, Isla de Francia, Normandia, Nueva Aquitania, Abruzos, Apulia, Calabria, Campania, Friuli-Venecia Julia, Liguria, Lombardia, Molise, Piamonte, Sicilia, Umbria, Valle de Aosta, Veneto, Algarve, Centro); straight -> horizontal 1 (Lisboa); straight, angle changed 9 (Baviera -75 -> -45, Hesse 60 -> 45, Aragon 75 -> 45, Galicia 90 -> -45, Comunidad Valenciana 90 -> -45, Corcega 90 -> -45, Cerdena 90 -> -45, Trentino-Alto Adigio 60 -> 45, Alentejo -75 -> -45); straight, same angle, moved or resized 3 (Renania del Norte-Westfalia, Paises del Loira, Basilicata); horizontal, moved or resized 10 (Baja Sajonia, Berlin, Brandeburgo h35 -> 18, Andalucia, Asturias, Cantabria, Navarra, Borgona-Franco Condado, Provenza-Alpes-Costa Azul, Emilia-Romana).
  - Injected aspects, faction labels (15 of 15 changed): horizontal, moved or resized 9 (Alemania r0 h105 -> 77, Espana r0 120 -> 91, Francia r0 120 -> 95, Espana r1 120 -> 91, Francia r1 120 -> 122, Espana r2 120 -> 99, Francia r2 120 -> 122, Francia r3 120 -> 122, Italia r3 120 -> 99); arc -> straight 3 (Italia r0, r1, r2: arc +30 h107 -> straight -30 h65); straight angle changed 2 (Portugal r0, r1: +75 h74 -> +30 h38); horizontal -> straight 1 (Francia r4: h120 -> straight +45 h170).
  - Measured aspects: territories arc -> straight 9, horizontal -> straight 25, straight angle changed 16, horizontal moved or resized 12, straight -> horizontal 1 (Sajonia-Anhalt), straight same angle moved or resized 4 (67 of 70 changed); faction labels (15 of 15 changed) horizontal moved or resized 9 (Alemania r0 h99 -> 75, Espana r0 120 -> 102, Francia r0 120 -> 106, Espana r1 120 -> 102, Francia r1 120 -> 136, Espana r2 120 -> 111, Francia r2 120 -> 136, Francia r3 120 -> 136, Italia r3 120 -> 133), horizontal -> straight 4 (Italia r0, r1, r2 and Francia r4), arc -> straight 2 (Portugal r0, r1).
  - The complete per-label list (name, 006 frame, 007 frame) is printed by `label-centred-place.test.ts` (run with `--silent=false`) and pinned there by kind counts.
- Reading: with the injected aspects 56 of 70 territory labels are straight in 007 (measured 55) versus 22 in 006; 0 arcs win G (the FR-221 factor 1.25 is never met on the dev map); all steep 006 frames (more than 45 deg) became +-45 deg or flatter and shorter (Galicia +90 h50 -> -45 h44, Baviera -75 h79 -> -45 h72 with the injected aspect).
- Node times (`centred-perf.test.ts`, run alone, measured aspects): territories at load 329 ms (1 widened: Liguria); factions from scratch per round 38 to 54 ms; steps with reuse 17 to 61 ms (round 3 -> 4 61 ms, the slowest); jump 0 -> 4 53 ms. All well under the 100 / 150 ms budgets of NFR-43 before the browser run (T9).

**T6 check (hits, review set, "before" screenshots; measured aspects, seed 1; `centred-review-set.ts`, pinned by `centred-review-set.test.ts`).**
- **Step hit (spec NFR-45: horizontal before, straight after):** seed 1, step round 3 -> 4, absorber Francia: horizontal h136 centre (1089.7, 734.0) -> straight -30 deg h189 centre (956.5, 982.5); found first at seed 1 (the search stops there, so the `MBRG_SLOW=1` no-hit proof of U3 is not needed; the slow test only logs the seed-1 hit). Scene `step-straight-0 .. -1` at round 4 with `transition` 0, 0.25, 0.5, 0.75, 1, camera on (1023.1, 858.3) at scale L0 - 0.25 = 1.25. The step Italia 2 -> 3 (Italia absorbs Espana) goes straight -15 h87 -> horizontal h133: it is an interpolated straight frame (006 FR-210 b), not a crossfade; pinned in `centred-steps.test.ts`. No arc exists in 007 on the dev map, so no arc or off-land step scene.
- **Dropped scene:** the 006 `steep-straight` scene (no 007 frame is steeper than 45 deg; asserted over every layout).
- **Steep 006 territory frames (> 45 deg), entry order, 13:** Baviera, Hesse, Sajonia-Anhalt, Aragon, Extremadura, Galicia, Region de Murcia, Corcega, Calabria, Cerdena, Piamonte, Alentejo, Lisboa (Galicia is in the named list). Heights 006 -> 007 and centres are in the module.
- **Shape changes:** 25 horizontal -> straight and 9 arc -> straight territory labels (the 006 / 007 lists are computed by the test); close-ups of Castilla y Leon, Normandia, Sicilia (horizontal -> straight) and Baden-Wurtemberg, Occitania, Toscana (arc -> straight).
- **Scene count:** 39 (fit r0-r4 5, `francia-r4` 1, Italia r0-r3 4, step 5, named close-ups 6, steep close-ups 12, shape-change close-ups 6). Camera for a close-up: exact centre of mass, scale `hitScale(min(006 h, 007 h))` (3.0, Bremen 3.5). Reference B is not an image: its figures (+40 deg, h155, centre (905, 941)) are the comparison for `francia-r4`.
- **"Before" screenshots:** all 39 taken in Chrome (devtools MCP, 1920 x 988 viewport, the debug panel left visible) on the 006 placement (`ui/main.ts` unchanged; the panel counts 39 horizontal / 22 straight / 9 arc confirm it), stored in the session scratchpad `t6-before/<scene label>.png` and not committed.

**T8 check ("after" screenshots and figures; measured aspects, seed 1; `centred-figures.test.ts` after columns, pinned by the digest `ba6fd9cbf0eda6da` of the 85 lines and by the rows below).** Same labels and order as the before table; k is the widening step, "d / k rho" the centre offset in units of the allowed radius.
| label | role | 006 frame, offset from C (before) | 007 frame, offset from C (after) | k | d / k rho |
|---|---|---|---|---|---|
| Galicia | territory | straight +90 h50, 20.2 = 0.143 sqrt n | straight -45 h44 @(198.5, 1214.5), 8.5 = 0.060 | 1 | 0.43 |
| Castilla-La Mancha | territory | horizontal h29, 49.3 = 0.213 sqrt n, side gaps L 20.0 / R 10.6 | straight +45 h33 @(501.5, 1524.5), 13.6 = 0.059 (no side gaps: not a horizontal frame) | 1 | 0.42 |
| Baviera | territory | straight -75 h73, 15.6 | straight -45 h66, 11.7 | 1 | 0.38 |
| Bremen / Hamburgo | territory | straight -30 h3 / h4, 0.3 / 2.5 | straight -15 h3 / -30 h4, 0.3 / 2.5 | 1 | 0.15 / 0.78 |
| Trentino-Alto Adigio / Friuli-Venecia Julia | territory | straight +45 h14 / -45 h9 | straight +45 h14 / -30 h9, 6.8 / 3.5 | 1 | 0.51 / 0.36 |
| Liguria | territory | horizontal h10, 37.8 = 0.62 sqrt n (L 48.0) | straight +30 h7, 16.6 (the only label widened) | 2 | 0.97 |
| Italia r0, r1, r2 | faction | horizontal h120, 229.1 = 0.557 sqrt n (L 62.0 / R 66.7) | straight -15 h87 @(1542.5, 1208.5), 28.8 = 0.070 | 1 | 0.50 |
| Italia r3 | faction | horizontal h120, 8.4 | horizontal h133, 0.1 | 1 | 0.00 |
| Francia r4 | faction | horizontal h120, 369.2 = 0.342 sqrt n (L 310.0 / R 1004.2) | straight -30 h189 @(956.5, 982.5), 78.0 = 0.072 sqrt n | 1 | 0.52 |
- Checks in the test: every 85 frames is in-land, every offset <= k rho (largest ratio 0.97, Liguria; all others <= 0.78), every label but Liguria at step 1 (within rho); Francia r4 is straight within rho of C (0.52 rho, reference B at 0.109 sqrt n would be 118.9 units); shape counts after: territories 15 horizontal / 55 straight / 0 arc; faction labels (15) 9 horizontal / 6 straight / 0 arc.
- Francia at r4, last letter: at fit the final "a" ends about 25 px from the Gulf of Lion coast (checked zoomed at scale 1.25 in `t8-extra-francia-a-zoom.png`): inside land, not touching.
- **Screenshots:** the 39 after shots (same 39 addresses as the before set, 1920 x 988, debug panel visible, dev server) are in the session scratchpad `t8-after/`; 39 side-by-side pairs "before | after" in `t8-pairs/` (fit scenes and `francia-r4` show the map area, 1120 x 988 each; the others a 880 x 580 crop around the viewport centre). Not committed. User acceptance pending.
- **Panel round-change figure (FR-190, Chrome via chrome-devtools, 5 runs, ms; T9 re-checks):** dev server 2->3: 80, 60, 60, 54, 70; 3->4: 101, 97, 102, 105, 109; production build (`vite preview`) 2->3: 103, 56, 55, 66, 53; 3->4: 122, 133, 127, 100, 100 (backward steps 4->3 78-112, 3->2 59-88). Both exceed the 100 ms budget at 3->4 (the heaviest step: Francia re-fit, Node 61 ms); no code was changed. For T9 and the user.

### 15.1 T8b re-pin (spec D19, arc gain 1; 2026-10-21)
The T8 rows above are the pre-D19 values (kept for the record). After T8b: 007 digest `0b3472aa148ea55e` (was `767ff73c98c1fa4d`), figures digest `c0a00656027bb9bc` (was `ba6fd9cbf0eda6da`); 005 `5f8e31fd50523b09`, 006 D11 `23c90b67d52cbcfa` and `shapedCandidate` `f8efcdfda2a05c86` unchanged.
- Measured aspects, territories: 7 horizontal / 22 straight / 41 arc (006: 39 / 22 / 9); faction labels over rounds 0..4: 7 horizontal / 6 straight / 2 arc (Espana r2 arc h111, Italia r3 arc h133, ties with the horizontal frame won by the arc). 7 of the 9 006 territory arcs return (not Comunidad Valenciana nor Nueva Aquitania, both straight 45 now). Largest territory arc end tangent 73.08 deg (limit 75). Portugal r0, r1: straight 30 h39 (no arc, known limit). Italia r0 to r2: straight -15 h87. Francia r4: straight -30 h189 at (956.5, 982.5), 78.0 from C (0.52 rho), unchanged. Only Liguria is widened (k2).
- Changed labels versus 006: 82 of 85 (measured), 83 of 85 (injected aspects): kinds listed in `label-centred-place.test.ts`.
- Review set: 78 scenes (39 before): `espana-r2`, `step-curve-0 .. -1` (Espana 1 to 2, horizontal to arc, crossfade), 3 `to-straight-*`, 36 `arc-*`. Italia 2 to 3 is now a crossfade (straight to arc).
- Exact speed-up of the arc search (same frames, same digests, checked against the brute-force reference): the arc search no longer builds the exact distance map (set map of the cache, no inscribed-disc prune), looks only at the disc cells nearest to C first and stops after the first fit plus the `nearestFrame` tolerance, fills run lengths per row on demand and shares footprints between its two searches. Node times (ms, measured aspects, `centred-perf.test.ts` alone): before the speed-up steps 0->1 93, 1->2 92, 2->3 94, 3->4 229, 4->3 175, jump 0->4 212, from scratch rounds 116, 181, 223, 171, 214; after: steps 24-46, 32-35, 31-33, 93-94, 79-81, jump 98-105, from scratch 50-99 (territories at load 466-510 ms). Step 3 -> 4 (Francia) is the tightest (93 of 100 ms); the browser must be re-measured in T9.
- Screenshots (session scratchpad, not committed): after set `t8b-after/` (78), new before shots from the 006 build `t8b-before-new/` (45), reused `t6-before/` (33), pairs `t8b-pairs/` (78). User acceptance PENDING.

## 16. Amendment of 2026-10-21: arc gain and territory tangent limit (spec D19)
Made after the T8 "after" screenshots (no arc left; the 9 territory arcs of 006 became straight). Follow-up task T8b, before T9. No change to the 006 rule.
- `CENTRE_PARAMS` gains `arcGain: { num: 1, den: 1 }` (exact rational, both roles) and `arcTangentLimit: { faction: 45, territory: 75 }`; pinned in the T1 parameters test ("FR-219 FR-221 FR-230 CENTRE_PARAMS holds the decided values", extended). `SHAPE_PARAMS.shapeGain` stays 1.25 and its 006 pin is untouched.
- `centredInLand`: the arc minimum height is ceil(Ga x hC) computed exactly as (num x hC + den - 1) div den (whole numbers); `arcCandidate` receives the tangent limit of the label's role; `arcWithinLimit` already takes the limit as a parameter. 007 tests that write 1.25 or 45 as literals for the 007 rule are rewritten to read `CENTRE_PARAMS` (007 tests, not earlier tests: NFR-44 does not restrict them); each hand grid whose meaning depended on 1.25 or on a 45 deg territory arc is re-checked by a scan, not by guessing.
- New tests first: an arc of the same height as the centred candidate wins (both roles), one lower loses; the full order of FR-221 (arc, then horizontal, then straight at equal height); a territory arc with end tangents between 45 and 75 deg exists and a faction arc with the same tangents does not; a straight territory frame at 60 deg is still never a candidate; the reference of `helpers/centred-reference.ts` reads Ga and the role limits.
- Re-pinned in T8b: the 007 digest (`767ff73c98c1fa4d` today, `label-centred-place.test.ts`), the changed-label list, the T8 "after" columns of section 15 and their figures digest (`ba6fd9cbf0eda6da` today; new rows: arc counts per role, the 006 arcs back, the largest territory arc tangent), the review-set hits whose frame changed. Must NOT change: the 005 box digest `5f8e31fd50523b09`, the 006 D11 digest `23c90b67d52cbcfa`, the `shapedCandidate` random-grid digest `f8efcdfda2a05c86`. The final 007 digest is the one T9 checks in the browser.
- Step scenes: the T6 note "no arc exists in 007, so no arc step scene" no longer holds. Italia 2 -> 3 (straight -15 h87 -> an arc at round 3 per the probe) becomes a crossfade (006 FR-210 c) and its `centred-steps.test.ts` pin is rewritten; a step scene with an arc (first hit, seed 1 first) is added at forward progress 0, 0.25, 0.5, 0.75, 1. The `step-straight` hit (seed 1, Francia 3 -> 4) is re-checked, not assumed.
- Close-ups: the "arc -> straight" close-ups of T6 (Baden-Wurtemberg, Occitania, Toscana) become "006 arc -> 007 arc or not" close-ups; every territory that is an arc in 006 or after T8b gets a close-up (camera rule of section 12), so the scene count grows from 39; the before shots of the new scenes are taken from `rewrite` (006 placement), not from the T8 build.
- Expected on the dev map (probe of 2026-10-21 with the measured aspects, to be confirmed by the tests, not pinned from here): 41 territory arcs, 7 of the 9 006 arcs back, territory tangents up to about 73 deg; 2 faction arcs (España at round 2, Italia at round 3); Portugal (faction 5) has no arc (known limit, spec edge case). A difference is investigated before re-pinning.
- Francia at round 4 must still be straight within rho (NFR-46); if an arc wins there, stop and report (it would contradict the accepted D10 option B).
- Screenshots: every plan section 12 scene retaken after T8b, plus `espana-r2` and the arc close-ups; before / after pairs rebuilt (before = the 006 shots of T6). User acceptance PENDING again.

## 17. Risks
- Cost of uncapped searches on large regions: bounded by the disc, the faction cap (hCap about 170 for Francia at round 4), binary search per straight angle and the PD5 prune; measured in Node in T3 / T4 before the browser. If the budget fails: exact speed-ups first (per-angle EDT maxima, row-run bounds), then a spec change.
- Horizontal relaxed bound R(h) too loose on irregular regions (long descending scans): logged in `centred-perf.test.ts`; an exact tighter bound may be added with its proof and reference test.
- PD6 extraction could change 006 arcs: guarded by the unchanged D11 digest and the random-grid digest of `shapedCandidate`.
- Territory labels that lose their 006 steep frames (D17) or shrink inside the disc: listed in section 15 and shown in the close-ups.
- More frequent faction shape changes between rounds (no G between horizontal and straight): visible in the fit-scale and step scenes; accepted by the spec.
- D19 cost: with Ga = 1 the arc search starts at hC instead of ceil(1.25 hC), and territory arcs at 75 deg add shapes that exist, so the arc search does more work; the T8 panel figure already exceeded 100 ms at step 3 -> 4 (Francia). Measured in Node in T8b and in the browser in T9; same rule: exact speed-up or spec change.
- Windows path with spaces: quote; `$env:CI='1'; npm test` before commits.
