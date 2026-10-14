import { describe, expect, it } from 'vitest';
import type { MapData } from '@mbrg/shared';
import { getRounds, totalRounds } from '../src/index';
import { gridMap, mapFrom, pairMap } from './helpers/maps';

// The 001 goldens are read as raw text (never through toMatchFileSnapshot), so a snapshot
// update can never rewrite them.
const raw = import.meta.glob('./golden/*.json', { query: '?raw', import: 'default', eager: true }) as Record<
  string,
  string
>;

const handMap = (): MapData =>
  mapFrom(
    [1, 2, 3, 4, 5, 6, 7, 8],
    [[1, 2], [2, 3], [3, 4], [4, 5], [4, 6], [5, 6], [6, 7], [7, 8], [1, 5], [4, 8]],
  );

/** Adds `kind: 'land'` to every `every`-th entry (1 = all entries, 2 = every other entry). */
const withKind = (map: MapData, every: number): MapData => ({
  territories: map.territories.map((t, i) => (i % every === 0 && t.kind !== 'sea' ? { ...t, kind: 'land' as const } : t)),
});

const CASES: [string, () => MapData, number, string][] = [
  ['pair', pairMap, 0, './golden/pair-seed0.json'],
  ['hand8', handMap, 42, './golden/hand8-seed42.json'],
  ['grid5x5', () => gridMap(5, 5), 4294967295, './golden/grid5x5-seed4294967295.json'],
];

describe('001 goldens unchanged by kind land (NFR-7, FR-63)', () => {
  for (const [name, build, seed, file] of CASES) {
    for (const [label, every] of [
      ['every entry', 1],
      ['every other entry', 2],
    ] as const) {
      it(`NFR-7 FR-63 ${name} with kind land on ${label} equals the 001 golden file`, () => {
        const text = raw[file];
        expect(text, `missing golden ${file}`).toBeTypeOf('string');
        const map = withKind(build(), every);
        const t = totalRounds(map);
        if (!t.ok) throw new Error('unexpected failure');
        const r = getRounds(map, seed, t.value);
        if (!r.ok) throw new Error('unexpected failure');
        expect(r.value).toStrictEqual(JSON.parse(text!));
      });
    }
  }
});
