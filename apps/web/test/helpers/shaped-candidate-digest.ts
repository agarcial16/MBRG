/**
 * A digest of the results of `shapedCandidate` (006) on fixed-seed random and hand regions, for the guard of the
 * `arcSearch` extraction (spec 007 plan PD6, U5): the value pinned in `label-centred-arc.test.ts` was taken on the
 * code BEFORE the extraction and must not change. Test code; the hash is the 006 digest of float64 bits.
 */
import { digestNumbers } from '../../src/core/label-digest';
import { LABEL_PARAMS } from '../../src/core/label-params';
import { shapedCandidate } from '../../src/core/label-shape';
import type { ShapedFrame } from '../../src/core/label-shape';
import { SHAPE_PARAMS } from '../../src/core/shape-params';
import { arcRegions, handRegions, randomRegions } from './centred-grids';
import type { TestRegion } from './centred-grids';

function numbersOf(frame: ShapedFrame | undefined, out: number[]): void {
  if (frame === undefined) out.push(-1);
  else if (frame.shape === 'straight') out.push(2, frame.cx, frame.cy, frame.angle, frame.h, frame.w);
  else out.push(3, frame.cx, frame.cy, frame.angle, frame.h, frame.w, frame.bend, frame.radius);
}

/** Aspects tried on every region besides its own: a short and a long label. */
const EXTRA_ASPECTS: readonly number[] = [1, 3.5];

/** Minimum heights tried: none, and a small bound (the FR-198 prune value). */
const MIN_HEIGHTS: readonly number[] = [1, 5];

export interface ShapedDigest {
  digest: string;
  cases: number;
  defined: number;
  arcs: number;
  straights: number;
}

/** The digest over the hand grids, circular bands and `count` random grids, each at its own aspect and at the extra ones. */
export function shapedCandidateDigest(count = 200): ShapedDigest {
  const regions: TestRegion[] = [...handRegions(), ...arcRegions(), ...randomRegions(count)];
  const numbers: number[] = [];
  let cases = 0;
  let defined = 0;
  let arcs = 0;
  let straights = 0;
  for (const r of regions) {
    for (const aspect of new Set([r.aspect, ...EXTRA_ASPECTS])) {
      for (const minHeight of MIN_HEIGHTS) {
        const frame = shapedCandidate(r.p, r.pieces, aspect, LABEL_PARAMS, SHAPE_PARAMS, minHeight);
        numbersOf(frame, numbers);
        cases++;
        if (frame !== undefined) {
          defined++;
          if (frame.shape === 'arc') arcs++;
          else straights++;
        }
      }
    }
  }
  return { digest: digestNumbers(numbers), cases, defined, arcs, straights };
}
