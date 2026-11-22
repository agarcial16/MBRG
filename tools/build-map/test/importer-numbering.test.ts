import { describe, expect, it } from 'vitest';
import { buildMapData } from '../src/core/adjacency';
import { formatJson } from '../src/core/json';
import { checkCuration } from '../src/importer/check-curation';
import { parseCuration } from '../src/importer/curation';
import { numberMap, type NumberingInput } from '../src/importer/numbering';
import type { ImportFeature } from '../src/importer/types';
import { ring, textBytes } from './helpers/geo-fixture';

function feature(index: number, props: Record<string, unknown>): ImportFeature {
  return { index, props, polygons: [{ outer: { coords: ring(index * 2, 0) as [number, number][] }, holes: [] }] };
}

/** The numbering of a sound curation, through the same stage the import runs. */
function numbered(change: (c: Record<string, any>) => void, features: ImportFeature[]) {
  const c: Record<string, any> = {
    primary: 'p.geojson',
    columns: { key: 'code', name: ['name'] },
    params: { side: 64, margin: 0.02, minPieceSize: 2, projection: 'laea' },
  };
  change(c);
  const parsed = parseCuration(textBytes(JSON.stringify(c)), 'c.json');
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.errors));
  const stage = checkCuration(features, parsed.value);
  if (!stage.ok) throw new Error(JSON.stringify(stage.errors));
  return numberMap({ territories: stage.value.territories, factions: stage.value.factions, factionOf: stage.value.factionOf, seas: parsed.value.seas });
}

describe('FR-605 numbering, names and presentation values', () => {
  // factions: Z and m listed (in that order), then a and b; territory keys mix cases: code-unit order puts B2 before a1
  const make = () =>
    numbered(
      (x) => {
        x.factionBy = { property: 'c', nameProperty: 'cn' };
        x.factions = [{ key: 'Z', name: 'Zeta', color: '#112233' }, { key: 'm', name: 'Mu' }];
        x.units = { S1: { kind: 'sea' }, s2: { kind: 'sea' } };
        x.seas = [{ name: 'North Sea', lon: 1, lat: 2 }, { name: 'Atlantic', lon: 3, lat: 4 }];
      },
      [
        feature(0, { code: 'a1', name: ' padded ', c: 'b', cn: 'Beta' }),
        feature(1, { code: 'B2', name: 'Bravo', c: 'b', cn: 'Beta' }),
        feature(2, { code: 'c3', name: 'Charlie', c: 'Z' }),
        feature(3, { code: 'D4', name: 'Delta', c: 'm' }),
        feature(4, { code: 'e5', name: 'Echo', c: 'a', cn: 'Alfa' }),
        feature(5, { code: 's2', name: 'Strait' }),
        feature(6, { code: 'S1', name: 'Gulf' }),
      ],
    );

  it('FR-605 numbers the factions 1..K in faction order: the listed ones in list order, then the others in code-unit order', () => {
    expect(make().factions).toStrictEqual([
      { id: 1, key: 'Z', name: 'Zeta', color: '#112233' },
      { id: 2, key: 'm', name: 'Mu' },
      { id: 3, key: 'a', name: 'Alfa' },
      { id: 4, key: 'b', name: 'Beta' },
    ]);
  });

  it('FR-605 numbers the land territories 1..L grouped by faction and, inside a faction, in code-unit order of the territory key', () => {
    expect(make().land.map((l) => [l.id, l.territory.key, l.owner])).toStrictEqual([
      [1, 'c3', 1],
      [2, 'D4', 2],
      [3, 'e5', 3],
      // B2 sorts before a1 by code unit (a locale order would put a1 first)
      [4, 'B2', 4],
      [5, 'a1', 4],
    ]);
  });

  it('FR-605 numbers the sea zones after the land: sea territories in code-unit order of key, then the seeds in list order', () => {
    expect(make().sea.map((s) => [s.id, s.name, s.territory?.key ?? null, s.seed ?? null])).toStrictEqual([
      [6, 'Gulf', 'S1', null],
      [7, 'Strait', 's2', null],
      [8, 'North Sea', null, 0],
      [9, 'Atlantic', null, 1],
    ]);
  });

  it('FR-605 gives the plan the piece cleanup and the map builder take, with the ids in map order', () => {
    const n = make();
    expect(n.plan.factions.map((f) => [f.id, f.country, f.color])).toStrictEqual([[1, 'Z', '#112233'], [2, 'm', undefined], [3, 'a', undefined], [4, 'b', undefined]]);
    expect(n.plan.land.map((l) => [l.id, l.key, l.country, l.owner, l.provinces])).toStrictEqual([
      [1, 'c3', 'Z', 1, ['c3']],
      [2, 'D4', 'm', 2, ['D4']],
      [3, 'e5', 'a', 3, ['e5']],
      [4, 'B2', 'b', 4, ['B2']],
      [5, 'a1', 'b', 4, ['a1']],
    ]);
    expect(n.plan.land.map((l) => l.name)).toStrictEqual(['Charlie', 'Delta', 'Echo', 'Bravo', ' padded ']);
    expect(n.plan.sea.map((s) => [s.id, s.seed, s.name])).toStrictEqual([[6, -1, 'Gulf'], [7, -1, 'Strait'], [8, 0, 'North Sea'], [9, 1, 'Atlantic']]);
    expect(n.pieceEntries).toStrictEqual([
      { id: 1, kind: 'land', owner: 1 },
      { id: 2, kind: 'land', owner: 2 },
      { id: 3, kind: 'land', owner: 3 },
      { id: 4, kind: 'land', owner: 4 },
      { id: 5, kind: 'land', owner: 4 },
      { id: 6, kind: 'sea' },
      { id: 7, kind: 'sea' },
      { id: 8, kind: 'sea' },
      { id: 9, kind: 'sea' },
    ]);
  });

  it('FR-605 builds the map with the unchanged buildMapData: neighbours ascending in map order, links only from pixel contact, no link field', () => {
    const n = make();
    const pixels = Uint32Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    const map = buildMapData(3, pixels, n.plan);
    expect(map.territories).toStrictEqual([
      { id: 1, owner: 1, neighbors: [2, 4] },
      { id: 2, owner: 2, neighbors: [1, 3, 5] },
      { id: 3, owner: 3, neighbors: [2, 6] },
      { id: 4, owner: 4, neighbors: [1, 5, 7] },
      { id: 5, owner: 4, neighbors: [2, 4, 6, 8] },
      { id: 6, kind: 'sea', neighbors: [3, 5, 9] },
      { id: 7, kind: 'sea', neighbors: [4, 8] },
      { id: 8, kind: 'sea', neighbors: [5, 7, 9] },
      { id: 9, kind: 'sea', neighbors: [6, 8] },
    ]);
    expect(JSON.stringify(map)).not.toMatch(/link/i);
  });

  it('FR-605 holds the faction names and colors and the name of every entry, exactly as given and never trimmed', () => {
    const n = make();
    expect(n.presentation).toStrictEqual({
      factions: [
        { id: 1, name: 'Zeta', color: '#112233' },
        { id: 2, name: 'Mu' },
        { id: 3, name: 'Alfa' },
        { id: 4, name: 'Beta' },
      ],
      territories: [
        { id: 1, name: 'Charlie' },
        { id: 2, name: 'Delta' },
        { id: 3, name: 'Echo' },
        { id: 4, name: 'Bravo' },
        // a source name with padding is kept as it is; the self-check reports it
        { id: 5, name: ' padded ' },
        { id: 6, name: 'Gulf' },
        { id: 7, name: 'Strait' },
        { id: 8, name: 'North Sea' },
        { id: 9, name: 'Atlantic' },
      ],
    });
  });

  it('FR-605 formats the presentation with formatJson: the 003b layout, id then name then color, raw UTF-8', () => {
    const odd = numbered(
      (x) => {
        x.factionBy = { property: 'c', nameProperty: 'cn' };
        x.factions = [{ key: 'k', name: 'España', color: '#00ff00' }];
      },
      [feature(0, { code: 'u', name: 'Zürich', c: 'k' })],
    );
    const text = new TextDecoder().decode(formatJson(odd.presentation));
    expect(text).toBe(
      '{\n  "factions": [\n    {\n      "id": 1,\n      "name": "España",\n      "color": "#00ff00"\n    }\n  ],\n  "territories": [\n    {\n      "id": 1,\n      "name": "Zürich"\n    }\n  ]\n}\n',
    );
    expect(text).not.toContain('\\u');
  });

  it('FR-605 leaves an entry with no name without a name field, and never invents one', () => {
    const input: NumberingInput = {
      territories: [{ key: 'T', kind: 'land', name: undefined, units: [] }, { key: 'W', kind: 'sea', name: undefined, units: [] }],
      factions: [{ key: 'f', name: 'Efe' }],
      factionOf: new Map([['T', 'f']]),
      seas: [],
    };
    const n = numberMap(input);
    expect(n.presentation.territories).toStrictEqual([{ id: 1 }, { id: 2 }]);
  });

  it('FR-605 never reads a territory of one kind as the other, and skips a land territory with no faction', () => {
    const input: NumberingInput = {
      territories: [
        { key: 'L', kind: 'land', name: 'Land', units: [] },
        { key: 'S', kind: 'sea', name: 'Sea', units: [] },
      ],
      factions: [{ key: 'f', name: 'Efe' }],
      factionOf: new Map([['L', 'f'], ['S', 'f']]),
      seas: [],
    };
    const n = numberMap(input);
    expect(n.land.map((l) => l.territory.key)).toStrictEqual(['L']);
    expect(n.sea.map((s) => s.territory?.key)).toStrictEqual(['S']);
  });

  it('FR-605 gives the same numbering for the same input, whatever the order the territories arrive in', () => {
    const a = make();
    const b = make();
    expect(JSON.stringify(a.presentation)).toBe(JSON.stringify(b.presentation));
    const reversed = numberMap({
      territories: [...a.land.map((l) => l.territory), ...a.sea.flatMap((s) => (s.territory === undefined ? [] : [s.territory]))].reverse(),
      factions: a.factions.map((f) => (f.color === undefined ? { key: f.key, name: f.name } : { key: f.key, name: f.name, color: f.color })),
      factionOf: new Map(a.land.map((l) => [l.territory.key, a.factions[l.owner - 1]!.key])),
      seas: [{ name: 'North Sea', lon: 1, lat: 2 }, { name: 'Atlantic', lon: 3, lat: 4 }],
    });
    expect(reversed.land.map((l) => [l.id, l.territory.key])).toStrictEqual(a.land.map((l) => [l.id, l.territory.key]));
    expect(reversed.sea.map((s) => [s.id, s.name])).toStrictEqual(a.sea.map((s) => [s.id, s.name]));
  });
});
