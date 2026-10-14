import { describe, expect, it } from 'vitest';
import { validateMap } from '@mbrg/shared';
import { MODE, getRounds, getState, totalRounds } from '../src/index';
import { initialState, playRound } from '../src/internal';
import { gridMap, mapFrom, pairMap } from './helpers/maps';

// Literal lists copied from the spec (FR-64, FR-32, FR-38, FR-45, FR-46), not imported from src.
const VALIDATION_KINDS = [
  'invalid-map',
  'invalid-territories',
  'invalid-territory',
  'invalid-territory-id',
  'invalid-neighbors',
  'duplicate-territory-id',
  'missing-owner',
  'invalid-owner',
  'unknown-field',
  'unknown-neighbor',
  'self-neighbor',
  'duplicate-neighbor',
  'asymmetric-adjacency',
  'too-few-factions',
  'disconnected-map',
];
const SIM_KINDS = ['invalid-seed', 'invalid-round', 'round-out-of-range', 'isolated-faction'];
const SPEC_KINDS = [...VALIDATION_KINDS, ...SIM_KINDS];

const t = (id: unknown, owner: unknown, neighbors: unknown) => ({ id, owner, neighbors });

/** Inputs chosen so that, together, they produce every validation kind. */
const BAD_MAPS: unknown[] = [
  null,
  {},
  {
    version: 1,
    territories: [3, t('x', 1, []), t(1, null, 5), t(2, 'y', []), t(2, 1, []), { ...t(9, 1, []), name: 'n' }],
  },
  { territories: [t(1, 1, [1, 9, 2, 2]), t(2, 1, [3]), t(3, 3, []), t(4, 1, [])] },
  { territories: [] },
];

function collectKinds(): Set<string> {
  const kinds = new Set<string>();
  const add = (errors: { kind: string }[]) => errors.forEach((e) => kinds.add(e.kind));
  for (const m of BAD_MAPS) {
    const r = validateMap(m);
    if (!r.ok) add(r.errors);
    const s = getState(m, 'x', 'y');
    if (!s.ok) add(s.errors);
    const rr = getRounds(m, 1, 0);
    if (!rr.ok) add(rr.errors);
    const tr = totalRounds(m);
    if (!tr.ok) add(tr.errors);
  }
  const good = gridMap(2, 2);
  for (const [seed, round] of [
    [-1, 0],
    [0, 1.5],
    [0, 99],
  ] as const) {
    const r = getState(good, seed, round);
    if (!r.ok) add(r.errors);
  }
  // isolated-faction through the internal operation (FR-39)
  const lonely = mapFrom([1, 2, 3], [[1, 2]]);
  for (let seed = 0; seed < 50; seed++) {
    const r = playRound(lonely, initialState(lonely), seed);
    if (!r.ok) add(r.errors);
  }
  return kinds;
}

describe('NFR-6 language', () => {
  it('NFR-6 NFR-12 every error kind produced is in the literal spec list, and all of them are produced', () => {
    const produced = collectKinds();
    for (const k of produced) expect(SPEC_KINDS).toContain(k);
    expect([...produced].sort()).toStrictEqual([...SPEC_KINDS].sort());
  });

  it('NFR-6 FR-30 the mode identifier is the English id classic', () => {
    expect(MODE).toBe('classic');
    const s = getState(pairMap(), 0, 0);
    expect(s.ok && s.value.mode).toBe('classic');
  });

  it('NFR-6 state and record field names are the English names of the spec', () => {
    const map = gridMap(3, 3);
    const s = getState(map, 5, 3);
    const r = getRounds(map, 5, 3);
    if (!s.ok || !r.ok) throw new Error('unexpected failure');
    expect(Object.keys(s.value).sort()).toStrictEqual(['mode', 'owners', 'round']);
    for (const rec of r.value) {
      expect(Object.keys(rec).sort()).toStrictEqual(['absorber', 'eliminated', 'round', 'transferred']);
    }
  });

  it('NFR-6 sim and shared sources contain only ASCII, except the UI-string name "Clásico" quoted in a comment', () => {
    const files = {
      ...import.meta.glob('../src/**/*.ts', { query: '?raw', import: 'default', eager: true }),
      ...import.meta.glob('../../shared/src/**/*.ts', { query: '?raw', import: 'default', eager: true }),
    } as Record<string, string>;
    expect(Object.keys(files).length).toBeGreaterThanOrEqual(12);
    const offenders = Object.entries(files)
      .filter(([, src]) => /[^\x00-\x7F]/.test(src.replaceAll('Clásico', 'Classico')))
      .map(([f]) => f);
    expect(offenders).toStrictEqual([]);
  });
});

describe('NFR-4 anti-spoiler', () => {
  it('NFR-4 FR-48 FR-49 round-N results hold only rounds 0..N and never the seed', () => {
    const map = gridMap(4, 4);
    const seed = 123456789;
    const total = 15;
    for (let n = 0; n <= total; n++) {
      const s = getState(map, seed, n);
      const r = getRounds(map, seed, n);
      if (!s.ok || !r.ok) throw new Error('unexpected failure');
      expect(s.value.round).toBe(n);
      expect(r.value.map((x) => x.round)).toStrictEqual(Array.from({ length: n }, (_, i) => i + 1));
      const text = JSON.stringify([s.value, r.value]);
      expect(text).not.toMatch(/seed/i);
      expect(text).not.toContain(String(seed));
      expect(Object.keys(s.value).sort()).toStrictEqual(['mode', 'owners', 'round']);
    }
    const past = getRounds(map, seed, total + 1);
    expect(past).toStrictEqual({ ok: false, errors: [{ kind: 'round-out-of-range', round: 16, total: 15 }] });
  });
});
