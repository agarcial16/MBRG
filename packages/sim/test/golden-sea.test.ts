import { describe, expect, it } from 'vitest';
import { isSeaZone, validateMap } from '@mbrg/shared';
import type { FactionId, MapData } from '@mbrg/shared';
import { getRounds, getState, totalRounds } from '../src/index';
import { absorptionCandidates } from '../src/candidates';
import type { MatchState, RoundRecord } from '../src/types';
import { gridMap, mapFrom, pairMap } from './helpers/maps';
import { denmarkMap, isleMap, japanMap, oceanMap } from './helpers/sea-maps';

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

// ---- NFR-9: new goldens with sea zones ----
// Each (map, seed, round k) was found once by a throwaway local search (not committed): the first
// seed where the named property holds at some round. The search range was 0..11 and the committed
// goldens were found within seeds 0..1. The golden files are
// written only with `npx vitest -u packages/sim/test/golden-sea.test.ts`; CI never writes them.

const pretty = (x: unknown): string => JSON.stringify(x, null, 2) + '\n';

function play(map: MapData, seed: number): RoundRecord[] {
  const t = totalRounds(map);
  if (!t.ok) throw new Error('unexpected failure');
  const r = getRounds(map, seed, t.value);
  if (!r.ok) throw new Error('unexpected failure');
  return r.value;
}

/** State before round k (k - 1 rounds played) and the record of round k. */
function before(map: MapData, seed: number, k: number): { state: MatchState; record: RoundRecord } {
  const s = getState(map, seed, k - 1);
  if (!s.ok) throw new Error('unexpected failure');
  return { state: s.value, record: play(map, seed)[k - 1]! };
}

/** Factions of land entries mutually linked to `from`, and the owners map for a state. */
function landOwnersAround(map: MapData, state: MatchState, faction: FactionId) {
  const owner = new Map(state.owners);
  const byId = new Map(map.territories.map((t) => [t.id, t]));
  const landNeighbors = new Set<FactionId>();
  const seaSharing = new Set<FactionId>();
  for (const t of map.territories) {
    if (isSeaZone(t) || owner.get(t.id) !== faction) continue;
    for (const n of t.neighbors) {
      const m = byId.get(n);
      if (m === undefined || !m.neighbors.includes(t.id)) continue;
      if (isSeaZone(m)) {
        for (const z of m.neighbors) {
          const q = byId.get(z);
          const o = q === undefined || isSeaZone(q) || !q.neighbors.includes(m.id) ? undefined : owner.get(q.id);
          if (o !== undefined && o !== faction) seaSharing.add(o);
        }
      } else {
        const o = owner.get(m.id);
        if (o !== undefined && o !== faction) landNeighbors.add(o);
      }
    }
  }
  return { landNeighbors, seaSharing };
}

const GOLDENS: { name: string; build: () => MapData; seed: number; k: number; total: number }[] = [
  { name: 'isles', build: isleMap, seed: 0, k: 1, total: 5 },
  { name: 'denmark', build: denmarkMap, seed: 0, k: 2, total: 3 },
  { name: 'ocean', build: oceanMap, seed: 0, k: 2, total: 4 },
  { name: 'japan', build: japanMap, seed: 1, k: 2, total: 3 },
];

describe('new golden matches with sea zones (NFR-9, FR-51)', () => {
  for (const g of GOLDENS) {
    it(`NFR-9 FR-51 ${g.name} map is valid and plays T = ${g.total} rounds`, () => {
      expect(validateMap(g.build())).toStrictEqual({ ok: true, value: expect.anything() });
      const t = totalRounds(g.build());
      expect(t).toStrictEqual({ ok: true, value: g.total });
    });
  }

  it('NFR-9 FR-51 isles seed 0 matches the golden file', async () => {
    await expect(pretty(play(isleMap(), 0))).toMatchFileSnapshot('./golden/sea-isles-seed0.json');
  });
  it('NFR-9 FR-51 denmark seed 0 matches the golden file', async () => {
    await expect(pretty(play(denmarkMap(), 0))).toMatchFileSnapshot('./golden/sea-denmark-seed0.json');
  });
  it('NFR-9 FR-51 ocean seed 0 matches the golden file', async () => {
    await expect(pretty(play(oceanMap(), 0))).toMatchFileSnapshot('./golden/sea-ocean-seed0.json');
  });
  it('NFR-9 FR-51 japan seed 1 matches the golden file', async () => {
    await expect(pretty(play(japanMap(), 1))).toMatchFileSnapshot('./golden/sea-japan-seed1.json');
  });

  it('NFR-9 isles seed 0 round 1 (i): no land neighbor, direct candidates, absorber shares the sea', () => {
    const map = isleMap();
    const { state, record } = before(map, 0, 1);
    const around = landOwnersAround(map, state, record.eliminated);
    expect(around.landNeighbors.size).toBe(0);
    const c = absorptionCandidates(map, state, record.eliminated);
    expect(c.how).toBe('direct');
    expect(c.factions).toStrictEqual([30, 60]);
    expect(around.seaSharing.has(record.absorber)).toBe(true);
    expect(record).toMatchObject({ round: 1, eliminated: 50, absorber: 60 });
  });

  it('NFR-9 denmark seed 0 round 2 (ii): direct candidates mix a land-only and a sea-only faction', () => {
    const map = denmarkMap();
    const { state, record } = before(map, 0, 2);
    expect(record.eliminated).toBe(20);
    const around = landOwnersAround(map, state, record.eliminated);
    const c = absorptionCandidates(map, state, record.eliminated);
    expect(c).toStrictEqual({ how: 'direct', factions: [10, 50] });
    expect(c.factions.some((f) => around.landNeighbors.has(f) && !around.seaSharing.has(f))).toBe(true);
    expect(c.factions.some((f) => around.seaSharing.has(f) && !around.landNeighbors.has(f))).toBe(true);
  });

  it('NFR-9 ocean seed 0 round 2 (iii): candidates found by widening at distance 2 or more', () => {
    const map = oceanMap();
    const { state, record } = before(map, 0, 2);
    const c = absorptionCandidates(map, state, record.eliminated);
    expect(c.how).toBe('widened');
    if (c.how !== 'widened') return;
    expect(c.distance).toBeGreaterThanOrEqual(2);
    expect(c).toStrictEqual({ how: 'widened', distance: 3, factions: [30, 40, 50] });
    expect(c.factions).toContain(record.absorber);
  });

  it('NFR-9 japan seed 1 round 2 (iv): scattered islands transfer 2 or more territories', () => {
    const map = japanMap();
    // Round 0: faction 10 owns 3 islands and none is linked to another through its own land.
    const owner = new Map(map.territories.map((t) => [t.id, 'owner' in t ? t.owner : undefined]));
    const islands = map.territories.filter((t) => 'owner' in t && t.owner === 10);
    expect(islands.length).toBeGreaterThanOrEqual(2);
    for (const t of islands) expect(t.neighbors.some((n) => owner.get(n) === 10)).toBe(false);
    const { record } = before(map, 1, 2);
    expect(record.eliminated).toBe(10);
    expect(record.transferred.length).toBeGreaterThanOrEqual(2);
  });
});
