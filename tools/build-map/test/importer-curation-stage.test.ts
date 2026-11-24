import { describe, expect, it } from 'vitest';
import { checkCuration } from '../src/importer/check-curation';
import { CURATION_KIND_ORDER } from '../src/importer/errors';
import { parseCuration, type Curation } from '../src/importer/curation';
import type { ImportFeature } from '../src/importer/types';
import { ring, textBytes } from './helpers/geo-fixture';

function curation(change: (c: Record<string, any>) => void = () => undefined): Curation {
  const c: Record<string, any> = {
    primary: 'p.geojson',
    columns: { key: 'code', name: ['name'] },
    params: { side: 2048, margin: 0.02, minPieceSize: 40, projection: 'laea' },
  };
  change(c);
  const r = parseCuration(textBytes(JSON.stringify(c)), 'c.json');
  if (!r.ok) throw new Error(`fixture curation is invalid: ${JSON.stringify(r.errors)}`);
  return r.value;
}

function feature(index: number, props: Record<string, unknown>): ImportFeature {
  return { index, props, polygons: [{ outer: { coords: ring(index * 2, 0) as [number, number][] }, holes: [] }] };
}

const LONG_TERRITORY = 'T'.repeat(257);
const LONG_FACTION = 'F'.repeat(257);

/** A curation that breaks one rule of every kind, together (the kinds the stage can find). */
function everythingWrong(): { c: Curation; features: ImportFeature[] } {
  const c = curation((x) => {
    x.select = [{ property: 'adm', eq: 'ESP' }];
    x.exclude = ['GONE'];
    x.territoryBy = { property: 'g', nameProperty: 'gn' };
    x.territoryNames = { m: 'Mixed', '': 'Empty key', t1: ' padded' };
    x.factionBy = { property: 'c', nameProperty: 'cn' };
    x.factions = [
      { key: 'f1', name: '', color: '#GGG' },
      { key: 'f1', name: 'Dup' },
      { key: 'idle', name: 'Idle' },
      { key: LONG_FACTION, name: 'Long' },
    ];
    x.seas = [{ name: '', lon: 0, lat: 0 }];
    x.units = {
      GHOST: { name: '' },
      S1: { kind: 'sea', faction: 'x' },
      E: { kind: 'sea', territory: 'm' },
      F: { territory: 'm' },
      U1: { faction: 'f1' },
      LONGT: { territory: LONG_TERRITORY, faction: LONG_FACTION },
    };
  });
  const esp = { adm: 'ESP' };
  const features = [
    feature(0, { ...esp }),
    feature(1, { code: null, ...esp }),
    feature(2, { code: 'A', name: 'A', ...esp, g: 'ga', gn: 'GA', c: 'p', cn: 'P' }),
    feature(3, { code: 'A', name: 'A', adm: 'FRA', g: 'ga', gn: 'GA', c: 'p', cn: 'P' }),
    feature(4, { code: 'B', name: 'B', ...esp, c: 'p', cn: 'P' }),
    feature(5, { code: 'C', name: 'C', ...esp, g: 'x', gn: 'One', c: 'p', cn: 'P' }),
    feature(6, { code: 'D', name: 'D', ...esp, g: 'x', gn: 'Two', c: 'p', cn: 'P' }),
    feature(7, { code: 'E', name: 'E', ...esp, g: 'ignored' }),
    feature(8, { code: 'F', name: 'F', ...esp, c: 'p', cn: 'P' }),
    feature(9, { code: 'G', ...esp, g: 'solo', c: 'p', cn: 'P' }),
    feature(10, { code: 'H', name: 'H', ...esp, g: 'h' }),
    feature(11, { code: 'I', name: 'I', ...esp, g: 'y', gn: 'Y', c: 'p', cn: 'P' }),
    feature(12, { code: 'J', name: 'J', ...esp, g: 'y', gn: 'Y', c: 'q', cn: 'Q' }),
    feature(13, { code: 'K', name: 'K', ...esp, g: 'k', gn: 'K', c: 'zz' }),
    feature(14, { code: 'S1', name: 'S1', ...esp, g: 's1' }),
    feature(15, { code: 'U1', name: 'U1', ...esp, g: 'u1' }),
    feature(16, { code: 'LONGT', name: 'L', ...esp }),
  ];
  return { c, features };
}

describe('FR-599 the complete curation stage', () => {
  it('FR-599 reports every problem of the curation in one pass, once per distinct data, in the FR-599 kind order and then the first data field', () => {
    const { c, features } = everythingWrong();
    const r = checkCuration(features, c);
    expect(r.ok).toBe(false);
    expect(r.ok ? [] : r.errors).toStrictEqual([
      { kind: 'missing-unit-key', feature: 0 },
      { kind: 'invalid-unit-key', feature: 1 },
      { kind: 'conflicting-unit-property', unit: 'A', property: 'adm' },
      { kind: 'unknown-unit', unit: 'GHOST' },
      { kind: 'unknown-unit', unit: 'GONE' },
      { kind: 'invalid-name', path: 'factions[0].name' },
      { kind: 'invalid-name', path: 'seas[0].name' },
      { kind: 'invalid-name', path: 'territoryNames.t1' },
      { kind: 'invalid-name', path: 'units.GHOST.name' },
      { kind: 'invalid-color', path: 'factions[0].color' },
      { kind: 'invalid-key', territory: '' },
      { kind: 'invalid-key', faction: LONG_FACTION },
      { kind: 'invalid-key', territory: LONG_TERRITORY },
      { kind: 'duplicate-faction-key', faction: 'f1' },
      { kind: 'sea-with-faction', unit: 'S1' },
      { kind: 'missing-group-value', unit: 'B', property: 'g' },
      { kind: 'mixed-territory-kind', territory: 'm' },
      { kind: 'conflicting-group-name', territory: 'x' },
      { kind: 'missing-territory-name', territory: 'solo' },
      { kind: 'missing-faction', unit: 'H' },
      { kind: 'split-territory-faction', territory: 'y', factions: ['p', 'q'] },
      { kind: 'missing-faction-name', faction: 'zz' },
      { kind: 'faction-without-territory', faction: 'idle' },
    ]);
  });

  it('FR-599 lists the kinds in the literal order of the spec, every kind of the stage after invalid-curation', () => {
    const { c, features } = everythingWrong();
    const r = checkCuration(features, c);
    const kinds: string[] = [...new Set((r.ok ? [] : r.errors).map((e) => e.kind))];
    const ranks = kinds.map((k) => CURATION_KIND_ORDER.indexOf(k));
    expect(ranks.every((rank) => rank >= 1)).toBe(true);
    expect([...ranks].sort((a, b) => a - b)).toStrictEqual(ranks);
    // the kinds this fixture cannot hold are empty-selection (it selects units) and too-many-factions (its own test)
    expect(CURATION_KIND_ORDER.filter((k) => !kinds.includes(k))).toStrictEqual(['invalid-curation', 'empty-selection', 'too-many-factions']);
  });

  it('FR-599 does not depend on how many times it runs, and never changes the curation or the features it reads', () => {
    const { c, features } = everythingWrong();
    const before = JSON.stringify([features, [...c.units], c.factions]);
    const a = JSON.stringify(checkCuration(features, c));
    const b = JSON.stringify(checkCuration(features, c));
    expect(a).toBe(b);
    expect(JSON.stringify([features, [...c.units], c.factions])).toBe(before);
  });

  it('FR-599 reports an empty selection alone, and the too many factions of the land territories', () => {
    const c = curation((x) => (x.select = [{ property: 'adm', eq: 'NOPE' }]));
    expect(checkCuration([feature(0, { code: 'A', name: 'a', adm: 'ESP' })], c)).toStrictEqual({ ok: false, errors: [{ kind: 'empty-selection' }] });
    const many = curation((x) => (x.factionBy = { property: 'f', nameProperty: 'f' }));
    const features = Array.from({ length: 10000 }, (_, i) => feature(i, { code: `u${i}`, name: `u${i}`, f: `f${i}` }));
    expect(checkCuration(features, many)).toStrictEqual({ ok: false, errors: [{ kind: 'too-many-factions', cap: 9999, count: 10000 }] });
  });

  it('FR-599 validates the names and colors the curation gives (PD9) and leaves the names of the source to the self-check', () => {
    // a source name with padding and a source faction name that is too long pass the stage
    const c = curation((x) => (x.factionBy = { property: 'c', nameProperty: 'cn' }));
    const ok = checkCuration([feature(0, { code: 'A', name: '  padded  ', c: 'p', cn: 'x'.repeat(200) })], c);
    expect(ok.ok).toBe(true);
    // the same texts given by the curation fail
    const bad = curation((x) => {
      x.units = { A: { name: '  padded  ' } };
      x.factions = [{ key: 'p', name: 'x'.repeat(81), color: '#ABCDEF' }];
      x.factionBy = { property: 'c' };
    });
    const r = checkCuration([feature(0, { code: 'A', name: 'a', c: 'p' })], bad);
    expect(r.ok ? [] : r.errors).toStrictEqual([
      { kind: 'invalid-name', path: 'factions[0].name' },
      { kind: 'invalid-name', path: 'units.A.name' },
      { kind: 'invalid-color', path: 'factions[0].color' },
    ]);
  });

  it('FR-599 hands the next stage the units, the selection, the territories and the factions of a sound curation', () => {
    const c = curation((x) => {
      x.select = [{ property: 'adm', eq: 'ESP' }];
      x.territoryBy = { property: 'g', nameProperty: 'gn' };
      x.factionBy = { property: 'c', nameProperty: 'cn' };
      x.units = { S: { kind: 'sea' } };
    });
    const r = checkCuration(
      [
        feature(0, { code: 'A', name: 'a', adm: 'ESP', g: 'x', gn: 'Ex', c: 'p', cn: 'Pe' }),
        feature(1, { code: 'B', name: 'b', adm: 'ESP', g: 'x', gn: 'Ex', c: 'p', cn: 'Pe' }),
        feature(2, { code: 'F', name: 'f', adm: 'FRA', g: 'f', gn: 'Ef', c: 'q', cn: 'Cu' }),
        feature(3, { code: 'S', name: 'Gulf', adm: 'ESP', g: 'wet' }),
      ],
      c,
    );
    if (!r.ok) throw new Error(JSON.stringify(r.errors));
    expect(r.value.units.map((u) => u.key)).toStrictEqual(['A', 'B', 'F', 'S']);
    expect(r.value.selection.selected.map((u) => u.key)).toStrictEqual(['A', 'B', 'S']);
    expect(r.value.selection.other.map((u) => u.key)).toStrictEqual(['F']);
    expect(r.value.territories.map((t) => [t.key, t.kind, t.name])).toStrictEqual([
      ['x', 'land', 'Ex'],
      ['wet', 'sea', 'Gulf'],
    ]);
    expect(r.value.factions).toStrictEqual([{ key: 'p', name: 'Pe' }]);
    expect([...r.value.factionOf]).toStrictEqual([['x', 'p']]);
  });
});
