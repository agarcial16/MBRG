// The reveal tour (spec 009): stops, timing and camera legs. Pure; this part holds the stops only.
import { TOUR_PARAMS } from './tour-params';
import { pick, tourStream } from './tour-key';
import type { TourKind } from './tour-key';

/**
 * What the stops depend on, and nothing else (FR-317): the kind, the result the tour ends on, the factions
 * it visits and sigma. No absorber, record, state or round data can be passed.
 */
export interface StopsInput {
  readonly kind: TourKind;
  readonly result: number;
  readonly set: readonly number[];
  readonly sigma: number;
}

/** H: 12 stops for a victim tour with three or more participants, 6 with two, 6 for an absorber tour. */
export function stopCount(kind: TourKind, setSize: number): number {
  if (setSize < 2) throw new RangeError('a tour needs at least two factions');
  if (kind === 'absorber') return TOUR_PARAMS.absorber.stops;
  return setSize >= 3 ? TOUR_PARAMS.victim.stops : TOUR_PARAMS.victim.pairStops;
}

/**
 * The stops s_1 ... s_H, drawn backwards from s_H = result with the stream of sigma. The set is sorted
 * ascending first, so the input order does not matter. For i = H-1 down to 1, s_i is drawn from the set
 * minus s_{i+1} ... s_H, or from the set minus s_{i+1} when that is empty.
 */
export function drawStops(input: StopsInput): number[] {
  const set = [...new Set(input.set)].sort((a, b) => a - b);
  if (!set.includes(input.result)) throw new RangeError('the result must belong to the set');
  const count = stopCount(input.kind, set.length);
  const stream = tourStream(input.sigma);
  const stops = new Array<number>(count);
  stops[count - 1] = input.result;
  for (let i = count - 2; i >= 0; i--) {
    const used = new Set(stops.slice(i + 1));
    let eligible = set.filter((f) => !used.has(f));
    if (eligible.length === 0) eligible = set.filter((f) => f !== stops[i + 1]);
    stops[i] = eligible[pick(stream, eligible.length)]!;
  }
  return stops;
}
