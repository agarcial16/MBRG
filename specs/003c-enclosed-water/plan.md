# Plan 003c — Enclosed water becomes sea

Covers FR-162 to FR-166, NFR-30, NFR-31. Branch `feat/003c-enclosed-water` (from `rewrite`), one PR, squash merge with the user's OK. No GitHub issues (one PR).

## 1. Starting point
- `tools/build-map/src/core/sea.ts` `assignSeaZones`: layered BFS from the seed pixels; water not reached becomes 0.
- `tools/build-map/src/core/pieces.ts` `cleanupPieces` (FR-117, incremental) and `test/helpers/cleanup-direct.ts` (literal loop, the reference). A sea piece below S with no contact with another sea zone becomes background today.
- `tools/build-map/src/core/{build,report}.ts` wire both and write the report.
- Dev map: `maps/dev` (5 factions, 70 land, 17 sea). Measured before writing the spec: 99 land-only enclosed sets, about 790 pixels; 137 other background components are other land (not water) and stay.
- 004 is paused on `feat/004-viewer` (748ed5d) and resumes on top of this branch.

## 2. Files and responsibilities
| File | Change | Covers |
|---|---|---|
| `src/core/sea.ts` | `assignSeaZones` keeps its signature and result (it delegates to `assignSeaZonesDetailed`, which returns `{ pixels, enclosed }`); the BFS is kept, then it labels each 4-connected set of still unlabelled water pixels and gives each whole set to the nearest zone (section 3). Returns `{ pixels, enclosed }` where `enclosed` lists, per set, the pixel count and the zone id. | FR-162, FR-164 |
| `src/core/pieces.ts` | In the loop, a sea piece with no candidate target is kept, not turned into background; sea pieces touched by a repainted pixel of another zone are pushed again (section 4). | FR-163 |
| `test/helpers/cleanup-direct.ts` | The literal loop skips pieces that FR-163 keeps (selects the smallest eligible piece below S). | FR-163 |
| `src/core/build.ts`, `src/core/report.ts` | Pass `enclosed` to the report; `ReportFacts.enclosed`; two new report lines (section 5). | FR-165 |
| `maps/dev/*` | Rebuilt with the real command. | FR-166 |
| `specs/003b-builder-and-dev-map/spec.md` | One note under FR-116, FR-117, FR-124 and the island edge case: "amended by 003c (FR-162, FR-163, FR-165)". The text of 003b is not otherwise edited. | process |
| `packages/sim/test/traceability.test.ts` | Id ranges (section 6). | NFR-31 |
| tests | see section 7 | all |

## 3. Enclosed water (FR-162, FR-164)
```
assignSeaZones(width, pixels, seeds, ids):
  1. BFS as today -> label[] (zone index) for reachable water.        // unchanged, same result
  2. sets = 4-connected components of water pixels with label = -1, in row-major order of their first pixel.
  3. for each set:
       best = (d2 = infinity, zone = none)
       for each pixel p of the set that has a neighbour outside the set (or is on the image edge):
          for r = 1 .. while r*r <= best.d2:                          // rings of Chebyshev radius r
             for each pixel q on ring r around p, inside the image, with label[q] >= 0:
                d2 = (qx-px)^2 + (qy-py)^2
                if d2 < best.d2 or (d2 == best.d2 and label[q] < best.zone): best = (d2, label[q])
       every pixel of the set takes ids[best.zone]
  4. water pixels are never 0 afterwards.
```
- Every pixel of the set is searched, pruned by the best squared distance found so far (a ring of radius r is searched only while r*r <= best), so interior pixels of a big set cost little. A boundary-only shortcut was rejected: it is not provably exact for non-convex sets. The test compares with an all-pairs brute force on random fixtures.
- Labels used for distance are those of step 1 only (a set never measures to another set), so the result does not depend on the order of the sets.
- Ties between zones at equal distance: lowest seed position (= lowest `label`). Ties between pixels of one zone do not matter.
- The ring search stops when `r*r > best.d2`; the first ring that holds a labelled pixel sets `best`, so the cost is about the area of a disc of radius equal to the distance. A set with no labelled pixel anywhere cannot happen (seeds are water and labelled), so `best.zone` always ends set.
- Pure and deterministic (NFR-14); no clock, no randomness.
- Discarded: a Euclidean distance transform over the whole image (nearest-feature index returns one arbitrary zone at ties, which breaks the tie rule), and Manhattan or BFS distance through land (user chose "straight line").

## 4. Keeping isolated sea pieces (FR-163)
In `cleanupPieces`, when the piece is a sea piece and `anySea === -1` (no other sea zone touches it):
- do not reassign it and do not record a reassignment; `continue` (it is not turned into background and is not counted by the vanished-entry check);
- it can become eligible later: after a reassignment whose target is a sea zone, every sea piece 4-adjacent to the repainted pixels with a different value and size below S is pushed to the heap again (the stale check ignores duplicates). A land piece never makes a sea piece eligible, because land is not a sea target for it;
- when it grows by a merge, the existing push after the merge applies.
The literal loop in `cleanup-direct.ts` recomputes the pieces each time and picks the smallest *eligible* piece below S, so both stay identical. Required fixtures: isolated sea speck below S (kept), a speck that becomes eligible after a land piece joins a neighbouring zone (cascade), speck touching another zone (reassigned as before), land pieces unchanged, ties.

## 5. Report (FR-165)
Two lines after `reassignedPieces` block, deterministic, English labels:
```
enclosedWaterSets: <sets>
enclosedWaterPixels: <pixels>
enclosedWaterZones: <count of zones that received a set>
  - zone=<id> sets=<n> pixels=<n>        (ascending zone id)
```
`enclosed` lines are always written (zero values when none). The report format of 003b therefore changes by these lines only (NFR-31 allows editing the test whose subject is the report format).

## 6. Traceability (NFR-31)
`packages/sim/test/traceability.test.ts` expects ids as ranges so the gap FR-132..FR-161 / NFR-24..NFR-29 (spec 004, still on its branch) does not break this branch: FR 1..131 and 162..166, NFR 1..23 and 30..31, minus the retired FR-6 and FR-25. Until the tests of T2..T4 exist, the ids of this spec are in a pinned pending set (as in 003a and 003b), removed in T5. Spec 004 T8, when it resumes, turns the ranges into FR 1..166 and NFR 1..31.

## 7. Test strategy (Vitest, mutation proofs with the full suite)
- `sea.test.ts` FR-162, FR-164: lake inside land goes to the nearest zone; whole set to one zone; tie goes to the lower seed position; nearest by straight line, not by BFS (a zone close in a straight line but far through water wins); the ring search equals an all-pairs brute force on seeded random fixtures; sets do not measure to other sets (shuffle of set order gives the same output); no water pixel is 0 after; other land and background are untouched; the input is not changed; the old test "a lake becomes background" is replaced. Mutations: tie rule, nearest vs farthest, per-pixel instead of whole set, skipping boundary-only pixels.
- `pieces.test.ts` FR-163 plus direct-loop equality (section 4 fixtures).
- `build.test.ts` FR-164, FR-165, NFR-30: the mini image counts and links are re-pinned (lake joins a zone); the island whose water reaches no seed now builds (no `disconnected-map` for that cause) and the other `disconnected-map` cause keeps failing; the exact report text with the new lines; a fixture without enclosed water gives byte-identical `map.json`, `presentation.json` and id image to the pre-change builder (expected bytes captured before the change in T2 and kept as literals or hashes).
- `dev-map.test.ts` and `rebuild.test.ts` FR-166: counts unchanged (5, 70, 17), same ids/names/owners/order, no water pixel is 0, NFR-17 sizes re-pinned, the committed files equal a fresh rebuild.
- Process check (FR-166): a throw-away script in the scratchpad lists links of old `maps/dev` (from git `rewrite`) versus new; the output is shown to the user.

## 8. Risks
- The rebuild can change links beyond the expected land-sea ones if cleanup cascades differ; the link comparison is the guard and the user reviews it.
- Performance: sets are tiny on the dev map; a huge unseeded sea would be slower. The rebuild test keeps the 60 s limit (003b).
- 137 other background components are other land and must stay background; the test checks pixel values that were land or other land are untouched.
