import { describe, expect, it } from 'vitest';
import type { MapData } from '@mbrg/shared';
import { getRounds, getState, playRoundWithSeed, totalRounds } from '../src/index';
import type { MatchState, RoundRecord } from '../src/types';
import { gridMap, mapFrom, pairMap } from './helpers/maps';
import { denmarkMap, isleMap, japanMap, oceanMap } from './helpers/sea-maps';

const devText = Object.values(
  import.meta.glob('../../../maps/dev/map.json', { query: '?raw', import: 'default', eager: true }) as Record<string, string>,
)[0];
const devMap = (): MapData => JSON.parse(devText ?? '') as MapData;

const handMap = (): MapData =>
  mapFrom([1, 2, 3, 4, 5, 6, 7, 8], [[1, 2], [2, 3], [3, 4], [4, 5], [4, 6], [5, 6], [6, 7], [7, 8], [1, 5], [4, 8]]);

const GOLDEN_MAPS: [string, () => MapData][] = [
  ['pair', pairMap],
  ['hand8', handMap],
  ['grid5x5', () => gridMap(5, 5)],
  ['isle', isleMap],
  ['denmark', denmarkMap],
  ['ocean', oceanMap],
  ['japan', japanMap],
];

function ok<T>(r: { ok: true; value: T } | { ok: false; errors: unknown[] }): T {
  if (!r.ok) throw new Error('unexpected failure: ' + JSON.stringify(r.errors));
  return r.value;
}

/** Chains the round step from the round-0 state, the same constant round seed at every round. */
function chain(map: MapData, seed: number, t: number): { states: MatchState[]; records: RoundRecord[] } {
  const states: MatchState[] = [ok(getState(map, 0, 0))];
  const records: RoundRecord[] = [];
  for (let r = 0; r < t; r++) {
    const step = ok(playRoundWithSeed(map, states[r], seed));
    states.push(step.state);
    records.push(step.record);
  }
  return { states, records };
}

/** Compares the chain with getRounds at T and getState at every round 0..T. */
function checkSeed(name: string, map: MapData, t: number, seed: number): void {
  const { states, records } = chain(map, seed, t);
  expect(records, `${name} s${seed} records`).toStrictEqual(ok(getRounds(map, seed, t)));
  for (let r = 0; r <= t; r++) {
    expect(states[r], `${name} s${seed} r${r}`).toStrictEqual(ok(getState(map, seed, r)));
  }
}

describe('FR-312 NFR-48 the chained round step equals getState and getRounds', () => {
  for (const [name, make] of GOLDEN_MAPS) {
    it(`FR-312 ${name}: seeds 0..999, every round 0..T, states and records`, { timeout: 120_000 }, () => {
      const map = make();
      const t = ok(totalRounds(map));
      for (let seed = 0; seed < 1000; seed++) checkSeed(name, map, t, seed);
    });
  }

  it('FR-312 dev map: seeds 0..999, every round 0..T, states and records', { timeout: 120_000 }, () => {
    const map = devMap();
    const t = ok(totalRounds(map));
    expect(t).toBeGreaterThan(2);
    for (let seed = 0; seed < 1000; seed++) checkSeed('dev', map, t, seed);
  });

  it('FR-312 the largest round seed 2^32 - 1 chains too, on the dev map', () => {
    const map = devMap();
    checkSeed('dev', map, ok(totalRounds(map)), 4294967295);
  });

  it('FR-312 the round-0 state does not depend on the seed (0, 1, 2^32 - 1)', () => {
    for (const [name, make] of [...GOLDEN_MAPS, ['dev', devMap] as [string, () => MapData]]) {
      const map = make();
      const first = ok(getState(map, 0, 0));
      for (const seed of [0, 1, 4294967295]) expect(ok(getState(map, seed, 0)), `${name} s${seed}`).toStrictEqual(first);
    }
  });
});

describe('NFR-48 the 001 golden record files still equal getRounds (sim part)', () => {
  const raw = import.meta.glob('./golden/*.json', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
  const CASES: [string, () => MapData, number, string][] = [
    ['pair', pairMap, 0, './golden/pair-seed0.json'],
    ['hand8', handMap, 42, './golden/hand8-seed42.json'],
    ['grid5x5', () => gridMap(5, 5), 4294967295, './golden/grid5x5-seed4294967295.json'],
    ['isle', isleMap, 0, './golden/sea-isles-seed0.json'],
    ['denmark', denmarkMap, 0, './golden/sea-denmark-seed0.json'],
    ['ocean', oceanMap, 0, './golden/sea-ocean-seed0.json'],
    ['japan', japanMap, 1, './golden/sea-japan-seed1.json'],
  ];
  for (const [name, make, seed, file] of CASES) {
    it(`NFR-48 ${name} seed ${seed}: the golden file equals getRounds and the chained records`, () => {
      const text = raw[file];
      expect(text, `missing golden ${file}`).toBeTypeOf('string');
      const map = make();
      const t = ok(totalRounds(map));
      const golden = JSON.parse(text ?? '') as RoundRecord[];
      expect(ok(getRounds(map, seed, t))).toStrictEqual(golden);
      expect(chain(map, seed, t).records).toStrictEqual(golden);
    });
  }
});
