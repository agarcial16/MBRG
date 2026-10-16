// Data of a round step (FR-185, FR-187, FR-188). Pure: seed and rounds are parameters and the sim is the
// injected port of the debug scene, so the calls it receives can be recorded in tests.
// Only the rounds 0..N are ever asked for, N being the round on display after the change: a forward step
// asks for N + 1 (the round it is entering), a backward step asks for N - 1 and reuses the scene already
// held for the round it leaves, and a frozen progress asks for N - 1 and N.
import type { FactionId, MapData, PresentationData, Result, TerritoryId } from '@mbrg/shared';
import { sceneAt } from './scene';
import type { Scene, SceneError, SimPort } from './scene';

/**
 * What the drawing of a step needs besides the map: the owner of every land territory at the earlier and at
 * the later round and who is involved. It holds no seed, no round number, no round count and no record
 * (FR-188); the caller drops it when the step is done, which releases the later round of a backward step
 * (FR-187).
 */
export interface StepData {
  earlier: ReadonlyMap<TerritoryId, FactionId>;
  later: ReadonlyMap<TerritoryId, FactionId>;
  eliminated: FactionId;
  absorber: FactionId;
  /** The territories that change owner, as listed by the record of the later round. */
  transferred: readonly TerritoryId[];
}

/** The scene of the round on display after the change (the pointer readout reads it, FR-185) and the step data. */
export interface StepScenes {
  scene: Scene;
  data: StepData;
}

function dataOf(earlier: Scene, later: Scene): StepData {
  const record = later.record;
  if (record === undefined) throw new RangeError('The later round of a step has no record');
  return {
    earlier: earlier.owners,
    later: later.owners,
    eliminated: record.eliminated,
    absorber: record.absorber,
    transferred: record.transferred,
  };
}

/**
 * The scene of round `to` and the data of the step from the displayed scene `from`. `to` must differ from
 * `from.round` by exactly one. The sim is asked about round `to` only.
 */
export function stepScenes(
  map: MapData,
  presentation: PresentationData,
  seed: number,
  from: Scene,
  to: number,
  sim: SimPort,
): Result<StepScenes, SceneError> {
  if (!Number.isInteger(to) || Math.abs(to - from.round) !== 1) throw new RangeError('A step moves the displayed round by exactly one');
  const target = sceneAt(map, presentation, seed, to, sim);
  if (!target.ok) return target;
  const forward = to > from.round;
  const data = forward ? dataOf(from, target.value) : dataOf(target.value, from);
  return { ok: true, value: { scene: target.value, data } };
}

/** The scene of round `n` and the data of the step n - 1 -> n, frozen at a forward progress (FR-191). Asks for n - 1 and n only. */
export function frozenScenes(
  map: MapData,
  presentation: PresentationData,
  seed: number,
  n: number,
  sim: SimPort,
): Result<StepScenes, SceneError> {
  if (!Number.isInteger(n) || n < 1) throw new RangeError('A frozen progress needs a round of at least 1');
  const earlier = sceneAt(map, presentation, seed, n - 1, sim);
  if (!earlier.ok) return earlier;
  return stepScenes(map, presentation, seed, earlier.value, n, sim);
}
