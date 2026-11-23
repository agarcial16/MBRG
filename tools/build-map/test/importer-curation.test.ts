import { describe, expect, it } from 'vitest';
import { readBounded, type ImportFs } from '../src/cli/import';
import { CURATION_MAX_BYTES, parseCuration, usedProperties, type Curation } from '../src/importer/curation';
import { textBytes } from './helpers/geo-fixture';

const MIB = 1024 * 1024;

/** A complete, valid curation using every member. */
function full(): Record<string, any> {
  return {
    primary: 'provinces.geojson',
    context: ['countries.geojson'],
    columns: { key: 'code', name: ['name_es', 'name'] },
    select: [{ property: 'adm0', eq: 'ESP' }, { bbox: [-10, 35, 5, 44], mode: 'intersects' }],
    exclude: ['ES-CE'],
    params: { side: 2048, margin: 0.02, minPieceSize: 40, projection: 'laea', gapFill: 12 },
    units: { 'ES-M': { name: 'Madrid', kind: 'land', territory: 'centro', faction: 'es' }, 'ES-CE': { kind: 'exclude' } },
    territoryBy: { property: 'group', nameProperty: 'group_name' },
    territoryNames: { centro: 'Centro' },
    factions: [{ key: 'es', name: 'Espana', color: '#aa0000' }],
    factionBy: { property: 'adm0', nameProperty: 'adm0_name' },
    seas: [{ name: 'Mar', lon: 3.5, lat: 55 }],
    insets: [{ select: [{ property: 'region', in: ['IC', 8019] }], at: [10, 20] }],
  };
}
const minimal = () => ({
  primary: 'p.geojson',
  columns: { key: 'code', name: ['name'] },
  params: { side: 2048, margin: 0.02, minPieceSize: 40, projection: 'laea' },
});

const parse = (value: unknown) => parseCuration(textBytes(JSON.stringify(value)), 'c.json');
function paths(value: unknown): string[] {
  const r = parse(value);
  if (r.ok) throw new Error(`expected errors for ${JSON.stringify(value).slice(0, 200)}`);
  return r.errors.map((e) => {
    if (e.kind !== 'invalid-curation') throw new Error(`unexpected kind ${e.kind}`);
    return e.path;
  });
}
function parsed(value: unknown): Curation {
  const r = parse(value);
  if (!r.ok) throw new Error(`expected a curation, got ${JSON.stringify(r.errors)}`);
  return r.value;
}
function changed(change: (c: Record<string, any>) => void, base: () => Record<string, any> = full): Record<string, any> {
  const c = base();
  change(c);
  return c;
}

describe('FR-592 the curation file schema: what it accepts', () => {
  it('FR-592 accepts a curation with every member and returns it with the members read as the schema says', () => {
    const c = parsed(full());
    expect(c.primary).toBe('provinces.geojson');
    expect(c.context).toStrictEqual(['countries.geojson']);
    expect(c.columns).toStrictEqual({ key: 'code', name: ['name_es', 'name'] });
    expect(c.select).toStrictEqual([{ property: 'adm0', eq: 'ESP' }, { bbox: [-10, 35, 5, 44], mode: 'intersects' }]);
    expect(c.exclude).toStrictEqual(['ES-CE']);
    expect(c.params).toStrictEqual({ side: 2048, margin: 0.02, minPieceSize: 40, projection: 'laea', gapFill: 12 });
    expect([...c.units.keys()]).toStrictEqual(['ES-M', 'ES-CE']);
    expect(c.units.get('ES-M')).toStrictEqual({ name: 'Madrid', kind: 'land', territory: 'centro', faction: 'es' });
    expect(c.territoryBy).toStrictEqual({ property: 'group', nameProperty: 'group_name' });
    expect(c.territoryNames.get('centro')).toBe('Centro');
    expect(c.factions).toStrictEqual([{ key: 'es', name: 'Espana', color: '#aa0000' }]);
    expect(c.factionBy).toStrictEqual({ property: 'adm0', nameProperty: 'adm0_name' });
    expect(c.seas).toStrictEqual([{ name: 'Mar', lon: 3.5, lat: 55 }]);
    expect(c.insets).toStrictEqual([{ select: [{ property: 'region', in: ['IC', 8019] }], at: [10, 20] }]);
  });

  it('FR-592 accepts a curation with the optional members absent and gives them empty', () => {
    const c = parsed(minimal());
    expect(c.context).toStrictEqual([]);
    expect(c.select).toStrictEqual([]);
    expect(c.exclude).toStrictEqual([]);
    expect(c.units.size).toBe(0);
    expect(c.territoryNames.size).toBe(0);
    expect(c.factions).toStrictEqual([]);
    expect(c.seas).toStrictEqual([]);
    expect(c.insets).toStrictEqual([]);
    expect(c.territoryBy).toBeUndefined();
    expect(c.factionBy).toBeUndefined();
    expect(c.params.gapFill).toBeUndefined();
  });

  it('FR-592 accepts the edges of every range and cap', () => {
    for (const side of [64, 16384]) expect(parse(changed((c) => (c.params.side = side), minimal)).ok, `side ${side}`).toBe(true);
    for (const margin of [0, 0.5]) expect(parse(changed((c) => (c.params.margin = margin), minimal)).ok, `margin ${margin}`).toBe(true);
    for (const n of [1, 10000]) expect(parse(changed((c) => (c.params.minPieceSize = n), minimal)).ok, `S ${n}`).toBe(true);
    for (const n of [1, 10000]) expect(parse(changed((c) => (c.params.gapFill = n), minimal)).ok, `gap ${n}`).toBe(true);
    for (const n of [0, 16]) expect(parse(changed((c) => (c.params.contextGap = n), minimal)).ok, `context gap ${n}`).toBe(true);
    for (const n of [0, 1024]) expect(parse(changed((c) => (c.params.exclaveReach = n), minimal)).ok, `exclave reach ${n}`).toBe(true);
    for (const projection of ['laea', 'equal-earth']) expect(parse(changed((c) => (c.params.projection = projection), minimal)).ok).toBe(true);
    for (const n of [1, 2, 3]) expect(parse(changed((c) => (c.columns.name = Array.from({ length: n }, (_, i) => `n${i}`)), minimal)).ok, `names ${n}`).toBe(true);
    expect(parse(changed((c) => (c.context = Array.from({ length: 8 }, (_, i) => `c${i}.geojson`)), minimal)).ok).toBe(true);
    expect(parse(changed((c) => (c.factions = Array.from({ length: 9999 }, (_, i) => ({ key: `f${i}`, name: `F${i}` }))), minimal)).ok).toBe(true);
    expect(parse(changed((c) => (c.seas = Array.from({ length: 1024 }, (_, i) => ({ name: `s${i}`, lon: 0, lat: 0 }))), minimal)).ok).toBe(true);
  });

  it('FR-592 reads every filter shape and a text or integer value in each', () => {
    const select = [
      { property: 'a', eq: 'x' },
      { property: 'a', eq: 8019 },
      { property: 'a', in: [] },
      { property: 'a', in: ['x', 1] },
      { property: 'd', gte: '1914-06-28' },
      { property: 'd', lte: 1939 },
      { bbox: [0, 0, 1, 1], mode: 'within' },
    ];
    expect(parsed(changed((c) => (c.select = select), minimal)).select).toStrictEqual(select);
  });

  it('FR-592 passes key lengths: a territory, faction or name key of any length is not a schema error', () => {
    const long = 'k'.repeat(300);
    const c = changed((x) => {
      x.units = { u1: { territory: '', faction: long }, [long]: { territory: long } };
      x.factions = [{ key: '', name: 'Empty' }, { key: long, name: 'Long' }];
      x.territoryNames = { '': 'x', [long]: 'y' };
    });
    const r = parse(c);
    expect(r.ok).toBe(true);
    expect(JSON.stringify(r.ok ? [] : r.errors)).not.toContain('invalid-key');
  });

  it('FR-592 keeps a unit key named __proto__ as plain data', () => {
    const c = parsed(changed((x) => (x.units = JSON.parse('{"__proto__":{"kind":"sea"}}')), minimal));
    expect(c.units.get('__proto__')).toStrictEqual({ kind: 'sea' });
    expect(({} as Record<string, unknown>)['kind']).toBeUndefined();
  });

  it('FR-592 gives the same curation twice on the same bytes', () => {
    const bytes = textBytes(JSON.stringify(full()));
    expect(parseCuration(bytes, 'c.json')).toStrictEqual(parseCuration(bytes, 'c.json'));
  });
});

describe('FR-592 the curation file schema: what it refuses, each with its member path', () => {
  it('FR-592 refuses an unknown member at every level', () => {
    expect(paths(changed((c) => (c.extra = 1)))).toStrictEqual(['extra']);
    expect(paths(changed((c) => (c.params.extra = 1)))).toStrictEqual(['params.extra']);
    expect(paths(changed((c) => (c.columns.extra = 1)))).toStrictEqual(['columns.extra']);
    expect(paths(changed((c) => (c.units['ES-M'].extra = 1)))).toStrictEqual(['units.ES-M.extra']);
    expect(paths(changed((c) => (c.select[0].extra = 1)))).toStrictEqual(['select[0].extra']);
    expect(paths(changed((c) => (c.territoryBy.extra = 1)))).toStrictEqual(['territoryBy.extra']);
    expect(paths(changed((c) => (c.factionBy.extra = 1)))).toStrictEqual(['factionBy.extra']);
    expect(paths(changed((c) => (c.factions[0].extra = 1)))).toStrictEqual(['factions[0].extra']);
    expect(paths(changed((c) => (c.seas[0].extra = 1)))).toStrictEqual(['seas[0].extra']);
    expect(paths(changed((c) => (c.insets[0].extra = 1)))).toStrictEqual(['insets[0].extra']);
  });

  it('FR-592 refuses a missing required member: primary, columns, params and the members inside them', () => {
    expect(paths({})).toStrictEqual(['primary', 'columns', 'params']);
    expect(paths(changed((c) => delete c.columns.key, minimal))).toStrictEqual(['columns.key']);
    expect(paths(changed((c) => delete c.columns.name, minimal))).toStrictEqual(['columns.name']);
    for (const member of ['side', 'margin', 'minPieceSize', 'projection']) {
      expect(paths(changed((c) => delete c.params[member], minimal)), member).toStrictEqual([`params.${member}`]);
    }
  });

  it('FR-592 refuses a member of the wrong type', () => {
    expect(paths(changed((c) => (c.primary = 7)))).toStrictEqual(['primary']);
    expect(paths(changed((c) => (c.context = 'a.geojson')))).toStrictEqual(['context']);
    expect(paths(changed((c) => (c.context = [7])))).toStrictEqual(['context[0]']);
    expect(paths(changed((c) => (c.columns = []) ))).toStrictEqual(['columns']);
    expect(paths(changed((c) => (c.columns.key = 7)))).toStrictEqual(['columns.key']);
    expect(paths(changed((c) => (c.columns.name = 'name')))).toStrictEqual(['columns.name']);
    expect(paths(changed((c) => (c.columns.name = ['a', 7])))).toStrictEqual(['columns.name[1]']);
    expect(paths(changed((c) => (c.select = {})))).toStrictEqual(['select']);
    expect(paths(changed((c) => (c.exclude = ['a', 7])))).toStrictEqual(['exclude[1]']);
    expect(paths(changed((c) => (c.units = [])))).toStrictEqual(['units']);
    expect(paths(changed((c) => (c.units['ES-M'] = 'x')))).toStrictEqual(['units.ES-M']);
    expect(paths(changed((c) => (c.units['ES-M'].name = 7)))).toStrictEqual(['units.ES-M.name']);
    expect(paths(changed((c) => (c.units['ES-M'].kind = 'water')))).toStrictEqual(['units.ES-M.kind']);
    expect(paths(changed((c) => (c.units['ES-M'].territory = 7)))).toStrictEqual(['units.ES-M.territory']);
    expect(paths(changed((c) => (c.units['ES-M'].faction = null)))).toStrictEqual(['units.ES-M.faction']);
    expect(paths(changed((c) => (c.territoryBy = 'group')))).toStrictEqual(['territoryBy']);
    expect(paths(changed((c) => delete c.territoryBy.property))).toStrictEqual(['territoryBy.property']);
    expect(paths(changed((c) => (c.territoryBy.nameProperty = 7)))).toStrictEqual(['territoryBy.nameProperty']);
    expect(paths(changed((c) => (c.territoryNames.centro = 7)))).toStrictEqual(['territoryNames.centro']);
    expect(paths(changed((c) => (c.factions = [{ key: 'a' }])))).toStrictEqual(['factions[0].name']);
    expect(paths(changed((c) => (c.factions[0].color = 7)))).toStrictEqual(['factions[0].color']);
    expect(paths(changed((c) => (c.factionBy = []) ))).toStrictEqual(['factionBy']);
    expect(paths(changed((c) => (c.seas[0].lon = '3')))).toStrictEqual(['seas[0].lon']);
    expect(paths(changed((c) => delete c.seas[0].name))).toStrictEqual(['seas[0].name']);
  });

  it('FR-592 refuses an empty territoryBy or factionBy property as invalid-curation naming the member', () => {
    expect(paths(changed((c) => (c.territoryBy.property = '')))).toStrictEqual(['territoryBy.property']);
    expect(paths(changed((c) => (c.factionBy.property = '')))).toStrictEqual(['factionBy.property']);
    expect(paths(changed((c) => { c.territoryBy.property = ''; c.factionBy.property = ''; }))).toStrictEqual(['territoryBy.property', 'factionBy.property']);
    // a filled rule and an absent rule are fine
    expect(parsed(changed((c) => delete c.territoryBy)).territoryBy).toBeUndefined();
    expect(parsed(changed((c) => (c.factionBy = { property: 'x' }))).factionBy).toStrictEqual({ property: 'x' });
  });

  it('FR-592 refuses an empty columns.key and a name list outside 1 to 3', () => {
    expect(paths(changed((c) => (c.columns.key = ''), minimal))).toStrictEqual(['columns.key']);
    expect(paths(changed((c) => (c.columns.name = []), minimal))).toStrictEqual(['columns.name']);
    expect(paths(changed((c) => (c.columns.name = ['a', 'b', 'c', 'd']), minimal))).toStrictEqual(['columns.name']);
  });

  it('FR-592 refuses a list over its length: context over 8, factions over 9,999, seas over 1,024', () => {
    expect(paths(changed((c) => (c.context = Array.from({ length: 9 }, (_, i) => `c${i}`)), minimal))).toStrictEqual(['context']);
    expect(
      paths(changed((c) => (c.factions = Array.from({ length: 10000 }, (_, i) => ({ key: `f${i}`, name: `F${i}` }))), minimal)),
    ).toStrictEqual(['factions']);
    expect(
      paths(changed((c) => (c.seas = Array.from({ length: 1025 }, (_, i) => ({ name: `s${i}`, lon: 0, lat: 0 }))), minimal)),
    ).toStrictEqual(['seas']);
  });

  it('FR-592 refuses an inset without select or at, or with an at that is not two integers', () => {
    expect(paths(changed((c) => (c.insets = [{ at: [0, 0] }])))).toStrictEqual(['insets[0].select']);
    expect(paths(changed((c) => (c.insets = [{ select: [] }])))).toStrictEqual(['insets[0].at']);
    expect(paths(changed((c) => (c.insets = [{}])))).toStrictEqual(['insets[0].select', 'insets[0].at']);
    expect(paths(changed((c) => (c.insets = [{ select: [], at: [1] }])))).toStrictEqual(['insets[0].at']);
    expect(paths(changed((c) => (c.insets = [{ select: [], at: [1, 2, 3] }])))).toStrictEqual(['insets[0].at']);
    expect(paths(changed((c) => (c.insets = [{ select: [], at: [1.5, 2] }])))).toStrictEqual(['insets[0].at[0]']);
    expect(paths(changed((c) => (c.insets = [{ select: [], at: [1, '2'] }])))).toStrictEqual(['insets[0].at[1]']);
    expect(paths(changed((c) => (c.insets = [{ select: [{ property: 'a' }], at: [1, 2] }])))).toStrictEqual(['insets[0].select[0]']);
    expect(paths(changed((c) => (c.insets = 'x')))).toStrictEqual(['insets']);
  });

  it('FR-592 refuses a side outside 64 to 16,384 (16,385 and 100,000 included) or not an integer', () => {
    for (const side of [63, 0, -64, 16385, 100000, 100.5, '2048', null]) {
      expect(paths(changed((c) => (c.params.side = side), minimal)), String(side)).toStrictEqual(['params.side']);
    }
  });

  it('FR-592 refuses a margin outside 0 to 0.5 or not a number', () => {
    for (const margin of [-0.001, 0.501, 1, '0.1', null]) {
      expect(paths(changed((c) => (c.params.margin = margin), minimal)), String(margin)).toStrictEqual(['params.margin']);
    }
  });

  it('FR-592 refuses a minimum piece size outside 1 to 10,000 or not an integer', () => {
    for (const n of [0, 10001, -1, 2.5, '40']) {
      expect(paths(changed((c) => (c.params.minPieceSize = n), minimal)), String(n)).toStrictEqual(['params.minPieceSize']);
    }
  });

  it('FR-592 refuses a projection other than laea and equal-earth', () => {
    for (const p of ['mercator', 'LAEA', 'equal_earth', '', 1, null]) {
      expect(paths(changed((c) => (c.params.projection = p), minimal)), String(p)).toStrictEqual(['params.projection']);
    }
  });

  it('FR-592 refuses a gap fill outside 1 to 10,000 or not an integer', () => {
    for (const n of [0, 10001, -3, 1.5, '5', null]) {
      expect(paths(changed((c) => (c.params.gapFill = n), minimal)), String(n)).toStrictEqual(['params.gapFill']);
    }
  });

  it('FR-592 refuses a context gap outside 0 to 16 or not an integer', () => {
    for (const n of [-1, 17, 1.5, '3', null]) {
      expect(paths(changed((c) => (c.params.contextGap = n), minimal)), String(n)).toStrictEqual(['params.contextGap']);
    }
  });

  it('FR-592 refuses an exclave reach outside 0 to 1,024 or not an integer', () => {
    for (const n of [-1, 1025, 1.5, '64', null]) {
      expect(paths(changed((c) => (c.params.exclaveReach = n), minimal)), String(n)).toStrictEqual(['params.exclaveReach']);
    }
  });

  it('FR-592 accepts an enclosed reach of 0 to 16,384 and refuses one outside it or not an integer', () => {
    for (const n of [0, 1, 16384]) expect(parse(changed((c) => (c.params.enclosedReach = n), minimal)).ok, `enclosed reach ${n}`).toBe(true);
    expect(parsed(changed((c) => (c.params.enclosedReach = 40), minimal)).params.enclosedReach).toBe(40);
    expect(parsed(minimal()).params.enclosedReach).toBeUndefined();
    for (const n of [-1, 16385, 1.5, '40', null]) {
      expect(paths(changed((c) => (c.params.enclosedReach = n), minimal)), String(n)).toStrictEqual(['params.enclosedReach']);
    }
  });

  it('FR-597 reads the no-owner values of factionBy: texts, integers and null, in order, and refuses anything else', () => {
    const rule = (noOwner: unknown) => changed((c) => (c.factionBy = { property: 'adm0', noOwner }));
    expect(parsed(rule([null, 'Unclaimed', 0])).factionBy).toStrictEqual({ property: 'adm0', noOwner: [null, 'Unclaimed', 0] });
    expect(parsed(rule([])).factionBy).toStrictEqual({ property: 'adm0', noOwner: [] });
    for (const bad of ['Unclaimed', {}, 1]) expect(paths(rule(bad)), JSON.stringify(bad)).toStrictEqual(['factionBy.noOwner']);
    expect(paths(rule([null, true, 1.5, {}]))).toStrictEqual(['factionBy.noOwner[1]', 'factionBy.noOwner[2]', 'factionBy.noOwner[3]']);
    expect(paths(rule(Array.from({ length: 65 }, (_, i) => `v${i}`)))).toStrictEqual(['factionBy.noOwner']);
    expect(parse(rule(Array.from({ length: 64 }, (_, i) => `v${i}`))).ok).toBe(true);
  });

  it('FR-592 refuses a malformed filter: no operator, two operators, a value that is no text or integer, a bad box', () => {
    const bad = (filter: unknown) => paths(changed((c) => (c.select = [filter]), minimal));
    expect(bad({ property: 'a' })).toStrictEqual(['select[0]']);
    expect(bad({ eq: 'x' })).toStrictEqual(['select[0].property']);
    expect(bad({ property: 'a', eq: 'x', gte: 'y' })).toStrictEqual(['select[0].gte']);
    expect(bad({ property: 'a', eq: 1.5 })).toStrictEqual(['select[0].eq']);
    expect(bad({ property: 'a', eq: true })).toStrictEqual(['select[0].eq']);
    expect(bad({ property: 'a', in: 'x' })).toStrictEqual(['select[0].in']);
    expect(bad({ property: 'a', in: ['x', 2.5] })).toStrictEqual(['select[0].in[1]']);
    expect(bad({ property: 'a', gte: [] })).toStrictEqual(['select[0].gte']);
    expect(bad({ property: 7, lte: 1 })).toStrictEqual(['select[0].property']);
    expect(bad({ bbox: [0, 0, 1], mode: 'within' })).toStrictEqual(['select[0].bbox']);
    expect(bad({ bbox: [0, 0, 1, '1'], mode: 'within' })).toStrictEqual(['select[0].bbox[3]']);
    expect(bad({ bbox: [0, 0, 1, 1], mode: 'inside' })).toStrictEqual(['select[0].mode']);
    expect(bad({ bbox: [0, 0, 1, 1] })).toStrictEqual(['select[0].mode']);
    expect(bad({ bbox: [0, 0, 1, 1], mode: 'within', property: 'a' })).toStrictEqual(['select[0].property']);
    expect(bad('x')).toStrictEqual(['select[0]']);
  });

  it('FR-592 reports every problem of one curation together, in a fixed order: unknown members first in their object, then the members in spec order', () => {
    const c = changed((x) => {
      x.params.side = 1;
      x.columns.key = '';
      x.bogus = 1;
    });
    expect(paths(c)).toStrictEqual(['bogus', 'columns.key', 'params.side']);
  });

  it('FR-592 refuses text that is no JSON object, bytes that are no UTF-8, with the whole file as the path', () => {
    for (const value of [[], null, 'text', 7]) expect(paths(value), JSON.stringify(value)).toStrictEqual(['']);
    const broken = parseCuration(textBytes('{"primary": '), 'c.json');
    expect(broken.ok ? [] : broken.errors).toStrictEqual([{ kind: 'invalid-curation', path: '' }]);
    const bad = parseCuration(Uint8Array.of(0x7b, 0xff, 0x7d), 'c.json');
    expect(bad.ok ? [] : bad.errors).toStrictEqual([{ kind: 'invalid-curation', path: '' }]);
  });

  it('FR-592 reads no member through the prototype chain', () => {
    Object.defineProperty(Object.prototype, 'primary', { value: 'p.geojson', configurable: true, writable: true });
    Object.defineProperty(Object.prototype, 'columns', { value: { key: 'k', name: ['n'] }, configurable: true, writable: true });
    try {
      expect(paths({})).toContain('primary');
      expect(paths({})).toContain('columns');
    } finally {
      delete (Object.prototype as Record<string, unknown>)['primary'];
      delete (Object.prototype as Record<string, unknown>)['columns'];
    }
  });
});

describe('FR-592 the size of the curation file', () => {
  it('FR-592 a curation over 16 MiB fails before parsing: no byte of it is read, decoded or parsed', () => {
    expect(CURATION_MAX_BYTES).toBe(16 * MIB);
    const trap = new Proxy(
      {},
      {
        get(_t, key) {
          if (key === 'length') return 17 * MIB;
          throw new Error(`the bytes were touched: ${String(key)}`);
        },
      },
    ) as unknown as Uint8Array;
    const r = parseCuration(trap, 'c.json');
    expect(r.ok ? [] : r.errors).toStrictEqual([{ kind: 'source-too-large', file: 'c.json', what: 'bytes', cap: 16 * MIB, found: 17 * MIB }]);
  });

  it('FR-592 the command refuses a 17 MiB curation file on its size alone, over a fake file system', () => {
    let reads = 0;
    const fs: ImportFs = {
      readFile: () => {
        reads++;
        return new Uint8Array(0);
      },
      writeFile: () => undefined,
      rename: () => undefined,
      unlink: () => undefined,
      mkdir: () => undefined,
      size: () => 17 * MIB,
      entries: () => undefined,
    };
    const r = readBounded(fs, '/x/c.json', 'c.json', CURATION_MAX_BYTES);
    expect(r).toStrictEqual({ ok: false, errors: [{ kind: 'source-too-large', file: 'c.json', what: 'bytes', cap: 16 * MIB, found: 17 * MIB }] });
    expect(reads).toBe(0);
  });

  it('FR-592 a curation of exactly 16 MiB is read, and one byte more is not', () => {
    const pad = (n: number) => {
      const head = textBytes('{"primary":"p","columns":{"key":"k","name":["n"]},"params":{"side":64,"margin":0,"minPieceSize":1,"projection":"laea"}}');
      const out = new Uint8Array(n).fill(0x20);
      out.set(head, 0);
      return out;
    };
    expect(parseCuration(pad(16 * MIB), 'c.json').ok).toBe(true);
    const over = parseCuration(pad(16 * MIB + 1), 'c.json');
    expect(over.ok ? [] : over.errors).toHaveLength(1);
  });
});

describe('FR-592 the draft and the properties a curation uses', () => {
  it('FR-592 the draft of the inspect mode (hand-built here) fails with invalid-curation on columns.key', () => {
    const draft = {
      primary: 'source.geojson',
      context: [],
      columns: { key: '', name: [] },
      select: [],
      exclude: [],
      params: { side: 2048, margin: 0.02, minPieceSize: 40, projection: 'laea' },
      units: {},
      territoryNames: {},
      factions: [],
      seas: [],
      insets: [],
    };
    expect(paths(draft)).toContain('columns.key');
    expect(paths(draft)).toStrictEqual(['columns.key', 'columns.name']);
  });

  it('FR-592 the properties a curation uses are the key, the names, every filter, both groupings and their name properties', () => {
    expect(usedProperties(parsed(full()))).toStrictEqual(['code', 'name_es', 'name', 'adm0', 'region', 'group', 'group_name', 'adm0_name']);
    expect(usedProperties(parsed(minimal()))).toStrictEqual(['code', 'name']);
  });

  it('FR-592 every path is kept as the text written, to be read relative to the curation file', () => {
    const c = parsed(changed((x) => {
      x.primary = '../data/ES/provinces.geojson';
      x.context = ['a/b.geojson', 'c.geojson'];
    }));
    expect(c.primary).toBe('../data/ES/provinces.geojson');
    expect(c.context).toStrictEqual(['a/b.geojson', 'c.geojson']);
  });
});
