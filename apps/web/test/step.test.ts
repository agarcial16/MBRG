import { beforeAll, describe, expect, it } from 'vitest';
import { getRounds, getState, ownerOf, totalRounds } from '@mbrg/sim';
import { buildEntryIndex } from '../src/core/entries';
import type { EntryIndex } from '../src/core/entries';
import { decodeIdPng } from '../src/core/png';
import { pointerInfo, sceneAt } from '../src/core/scene';
import type { Scene, SimPort } from '../src/core/scene';
import { frozenScenes, stepScenes } from '../src/core/step';
import { inflateStream } from '../src/ui/load';
import { DEV_MAP, DEV_PRESENTATION, devPngBytes } from './helpers/dev-map';

const REAL: SimPort = { totalRounds, getState, getRounds, ownerOf };
const T = 4;

/** The real sim wrapped so every request is recorded, in order. */
function recordingSim(): { sim: SimPort; calls: string[] } {
  const calls: string[] = [];
  const sim: SimPort = {
    totalRounds: (map) => {
      calls.push('total');
      return totalRounds(map);
    },
    getState: (map, seed, round) => {
      calls.push(`state:${String(round)}`);
      return getState(map, seed, round);
    },
    getRounds: (map, seed, round) => {
      calls.push(`rounds:${String(round)}`);
      return getRounds(map, seed, round);
    },
    ownerOf,
  };
  return { sim, calls };
}

function sceneOf(n: number, seed = 1): Scene {
  const r = sceneAt(DEV_MAP, DEV_PRESENTATION, seed, n, REAL);
  if (!r.ok) throw new Error('sceneAt failed');
  return r.value;
}

/** The highest round named in a recorded call list. */
const highest = (calls: readonly string[]): number =>
  Math.max(-1, ...calls.filter((c) => c !== 'total').map((c) => Number(c.slice(c.indexOf(':') + 1))));

function step(from: number, to: number, sim: SimPort = REAL, seed = 1) {
  const r = stepScenes(DEV_MAP, DEV_PRESENTATION, seed, sceneOf(from, seed), to, sim);
  if (!r.ok) throw new Error('stepScenes failed');
  return r.value;
}

function frozen(n: number, sim: SimPort = REAL, seed = 1) {
  const r = frozenScenes(DEV_MAP, DEV_PRESENTATION, seed, n, sim);
  if (!r.ok) throw new Error('frozenScenes failed');
  return r.value;
}

describe('FR-187 a step asks the sim only for rounds up to the displayed round', () => {
  it('FR-187 a forward step from N asks only for T, the state of N + 1 and the records up to N + 1', () => {
    for (let n = 0; n < T; n++) {
      const from = sceneOf(n);
      const { sim, calls } = recordingSim();
      const r = stepScenes(DEV_MAP, DEV_PRESENTATION, 1, from, n + 1, sim);
      expect(r.ok).toBe(true);
      expect(calls, `from ${n}`).toStrictEqual(['total', `state:${n + 1}`, `rounds:${n + 1}`]);
    }
  });

  it('FR-187 a backward step from N asks only for rounds N - 1 and below, never N (the round-N scene is the one already held)', () => {
    for (let n = 1; n <= T; n++) {
      const from = sceneOf(n);
      const { sim, calls } = recordingSim();
      const r = stepScenes(DEV_MAP, DEV_PRESENTATION, 1, from, n - 1, sim);
      expect(r.ok).toBe(true);
      expect(calls, `from ${n}`).toStrictEqual(n - 1 === 0 ? ['total', 'state:0'] : ['total', `state:${n - 1}`, `rounds:${n - 1}`]);
      expect(highest(calls)).toBe(n - 1);
    }
  });

  it('FR-187 a frozen progress at round N asks only for rounds N - 1 and N', () => {
    for (let n = 1; n <= T; n++) {
      const { sim, calls } = recordingSim();
      const r = frozenScenes(DEV_MAP, DEV_PRESENTATION, 1, n, sim);
      expect(r.ok).toBe(true);
      const rounds = new Set(calls.filter((c) => c !== 'total').map((c) => Number(c.slice(c.indexOf(':') + 1))));
      expect([...rounds].sort((a, b) => a - b), `n ${n}`).toStrictEqual(n - 1 === 0 ? [0, 1] : [n - 1, n]);
      expect(highest(calls)).toBe(n);
    }
  });

  it('FR-187 after a step the highest round asked is the displayed round (forward) or below it (backward): nothing above N is kept or asked', () => {
    const fwd = recordingSim();
    const forward = step(2, 3, fwd.sim);
    expect(highest(fwd.calls)).toBe(forward.scene.round);
    const back = recordingSim();
    const backward = step(3, 2, back.sim);
    expect(highest(back.calls)).toBe(backward.scene.round);
    expect(backward.scene.round).toBe(2);
  });

  it('FR-187 the round above the displayed one is held only inside the step data: the shown scene is the target round', () => {
    const back = step(3, 2);
    expect(back.scene).toStrictEqual(sceneOf(2));
    expect(back.scene.round).toBe(2);
    expect(back.data.later).toStrictEqual(sceneOf(3).owners);
    expect(back.scene.record).toStrictEqual(sceneOf(2).record);
  });

  it('FR-187 a step between rounds that are not consecutive is a RangeError and asks the sim nothing', () => {
    const { sim, calls } = recordingSim();
    for (const to of [0, 4, 5, -1]) {
      expect(() => stepScenes(DEV_MAP, DEV_PRESENTATION, 1, sceneOf(2), to, sim), `to ${to}`).toThrow(RangeError);
    }
    expect(() => stepScenes(DEV_MAP, DEV_PRESENTATION, 1, sceneOf(2), 2, sim)).toThrow(RangeError);
    expect(() => stepScenes(DEV_MAP, DEV_PRESENTATION, 1, sceneOf(2), 2.5, sim)).toThrow(RangeError);
    expect(calls).toStrictEqual([]);
  });

  it('FR-187 a frozen progress needs a round of at least 1', () => {
    expect(() => frozenScenes(DEV_MAP, DEV_PRESENTATION, 1, 0, REAL)).toThrow(RangeError);
    expect(() => frozenScenes(DEV_MAP, DEV_PRESENTATION, 1, 1.5, REAL)).toThrow(RangeError);
  });

  it('FR-187 a sim error is returned, not thrown (round above T)', () => {
    const r = stepScenes(DEV_MAP, DEV_PRESENTATION, 1, sceneOf(T), T + 1, REAL);
    expect(r.ok).toBe(false);
    const f = frozenScenes(DEV_MAP, DEV_PRESENTATION, 1, T + 1, REAL);
    expect(f.ok).toBe(false);
  });
});

describe('FR-187 the data of a step is the sim data of the two rounds', () => {
  it('FR-187 a forward step: scene is the new round, earlier and later owners are the two scenes, the record names the rest', () => {
    for (let n = 0; n < T; n++) {
      const s = step(n, n + 1);
      const a = sceneOf(n);
      const b = sceneOf(n + 1);
      expect(s.scene).toStrictEqual(b);
      expect(s.data.earlier).toStrictEqual(a.owners);
      expect(s.data.later).toStrictEqual(b.owners);
      expect(s.data.eliminated).toBe(b.record!.eliminated);
      expect(s.data.absorber).toBe(b.record!.absorber);
      expect(s.data.transferred).toStrictEqual(b.record!.transferred);
    }
  });

  it('FR-187 a backward step carries the same step data as the forward step between the same rounds', () => {
    for (let n = 1; n <= T; n++) {
      expect(step(n, n - 1).data, `${n} -> ${n - 1}`).toStrictEqual(step(n - 1, n).data);
    }
  });

  it('FR-187 the frozen data of round N equals the data of the step N - 1 -> N and the scene is round N', () => {
    for (let n = 1; n <= T; n++) {
      const f = frozen(n);
      expect(f.scene).toStrictEqual(sceneOf(n));
      expect(f.data).toStrictEqual(step(n - 1, n).data);
    }
  });

  it('FR-187 the eliminated faction owned the transferred territories before and the absorber after', () => {
    for (let n = 1; n <= T; n++) {
      const { data } = frozen(n);
      expect(data.transferred.length).toBeGreaterThan(0);
      for (const id of data.transferred) {
        expect(data.earlier.get(id), `round ${n} ${id}`).toBe(data.eliminated);
        expect(data.later.get(id), `round ${n} ${id}`).toBe(data.absorber);
      }
    }
  });

  it('FR-187 another seed gives the data of that seed', () => {
    const a = step(0, 1, REAL, 1).data;
    const b = step(0, 1, REAL, 2).data;
    const direct = sceneOf(1, 2);
    expect(b.eliminated).toBe(direct.record!.eliminated);
    expect(JSON.stringify([...a.later])).not.toBe(JSON.stringify([...b.later]));
  });
});

describe('FR-188 the step data holds no seed, round or record', () => {
  it('FR-188 the step data has exactly the keys earlier, later, eliminated, absorber, transferred', () => {
    for (const d of [step(1, 2).data, step(2, 1).data, frozen(3).data]) {
      expect(Object.keys(d).sort()).toStrictEqual(['absorber', 'earlier', 'eliminated', 'later', 'transferred']);
    }
  });

  it('FR-188 no value reachable in the step data is a seed, a round, a count or a record', () => {
    const data = step(2, 3, REAL, 12345).data;
    const reachable: unknown[] = [];
    const walk = (value: unknown): void => {
      reachable.push(value);
      if (value instanceof Map) for (const [k, v] of value) (walk(k), walk(v));
      else if (Array.isArray(value)) value.forEach(walk);
      else if (typeof value === 'object' && value !== null) Object.values(value).forEach(walk);
    };
    walk(data);
    const objects = reachable.filter((v): v is object => typeof v === 'object' && v !== null && !(v instanceof Map) && !Array.isArray(v));
    expect(objects.length).toBe(1);
    expect(reachable).not.toContain(12345);
    expect(reachable.filter((v) => typeof v === 'object' && v !== null && 'round' in (v as object))).toStrictEqual([]);
  });
});

describe('FR-185 the pointer readout reads the displayed round during a step', () => {
  let index: EntryIndex;
  beforeAll(async () => {
    const decoded = await decodeIdPng(devPngBytes(), inflateStream);
    if (!decoded.ok) throw new Error('png');
    index = buildEntryIndex(DEV_MAP, decoded.value.width, decoded.value.height, decoded.value.values);
  });

  const nameOf = (faction: number) => DEV_PRESENTATION.factions.find((f) => f.id === faction)!.name;

  function pointOf(id: number) {
    const entry = index.indexOf.get(id)!;
    const p = index.cells.indexOf(entry);
    return { x: (p % index.width) + 0.5, y: Math.floor(p / index.width) + 0.5 };
  }

  it('FR-185 forward: the unit still drawn in the eliminated colour reads the absorber, the owner of the round being entered', () => {
    const s = step(0, 1);
    const moved = s.data.transferred[0]!;
    expect(pointerInfo(index, s.scene, DEV_PRESENTATION, pointOf(moved)).owner).toBe(nameOf(s.data.absorber));
  });

  it('FR-185 backward: the readout reads the eliminated faction, the owner of the round being entered', () => {
    const s = step(1, 0);
    const moved = s.data.transferred[0]!;
    expect(s.scene.round).toBe(0);
    expect(pointerInfo(index, s.scene, DEV_PRESENTATION, pointOf(moved)).owner).toBe(nameOf(s.data.eliminated));
  });
});
