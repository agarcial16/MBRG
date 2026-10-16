import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkIdImage, checkPresentation, validateMap } from '@mbrg/shared';
import { describe, expect, it } from 'vitest';
import { buildInMemory } from '../src/core/build';
import { formatJson } from '../src/core/json';
import { parseBuildInputs } from '../src/core/parse-inputs';
import { fromRgb, toRgb } from '../src/core/png-check';
import { labelPieces } from '../src/core/pieces';
import { WATER } from '../src/core/rasterize';
import { formatReport } from '../src/core/report';
import { selfCheck } from '../src/core/self-check';
import type { BuildInputs, BuildOutcome, PngCodec } from '../src/core/types';
import { pngCodec } from '../src/io/png-codec';
import { MINI_IDS, inputTexts, miniInputs } from './helpers/fixtures';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..', '..', '..');
const text = (bytes: Uint8Array): string => new TextDecoder().decode(bytes);

type Built = Extract<BuildOutcome, { ok: true }>;

function build(inputs: BuildInputs = miniInputs(), codec: PngCodec = pngCodec): BuildOutcome {
  return buildInMemory(inputs, codec);
}

function buildOk(inputs: BuildInputs = miniInputs()): Built {
  const outcome = build(inputs);
  if (!outcome.ok) throw new Error('mini build failed: ' + JSON.stringify(outcome.errors));
  return outcome;
}

function same(a: Uint8Array, b: Uint8Array): boolean {
  return Buffer.from(a).equals(Buffer.from(b));
}

/** The mini inputs with one change applied to a deep copy. */
function mini(change: (inputs: BuildInputs) => void): BuildInputs {
  const inputs = structuredClone(miniInputs());
  change(inputs);
  return inputs;
}

describe('FR-112 determinism: inputs fully determine the output', () => {
  it('FR-112 and FR-125 building twice from the same inputs gives identical bytes of all three artifacts', () => {
    const a = buildOk();
    const b = buildOk();
    expect(same(a.files.map, b.files.map)).toBe(true);
    expect(same(a.files.presentation, b.files.presentation)).toBe(true);
    expect(same(a.files.image, b.files.image)).toBe(true);
    expect(a.report).toBe(b.report);
  });

  it('FR-112 inputs read from their texts give the same bytes as the same inputs in memory', () => {
    const parsed = parseBuildInputs(inputTexts(miniInputs()));
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.errors));
    const fromText = buildOk(parsed.value);
    const direct = buildOk();
    expect(same(fromText.files.map, direct.files.map)).toBe(true);
    expect(same(fromText.files.presentation, direct.files.presentation)).toBe(true);
    expect(same(fromText.files.image, direct.files.image)).toBe(true);
  });

  it('FR-112 the build takes only the inputs and a codec: no seed, round, match state or round record', () => {
    expect(buildInMemory.length).toBe(2);
    const built = buildOk();
    for (const bytes of [built.files.map, built.files.presentation]) {
      expect(text(bytes)).not.toMatch(/seed|round|match/i);
    }
  });

  it('FR-112 the build does not modify its inputs', () => {
    const inputs = miniInputs();
    const before = JSON.stringify(inputs);
    buildOk(inputs);
    expect(JSON.stringify(inputs)).toBe(before);
  });

  it('FR-112 a grouping failure comes first and carries no preview', () => {
    const outcome = build(mini((i) => (i.grouping.excluded = [])));
    expect(outcome).toStrictEqual({ ok: false, errors: [{ kind: 'unassigned-province', province: 'CC-X' }] });
    expect('preview' in outcome).toBe(false);
  });
});

describe('FR-114 the frame comes from the non-excluded provinces only', () => {
  it('FR-114 an excluded province far outside the land changes neither the centre, the frame nor the pixels', () => {
    const far = mini((i) => {
      const x = i.provinces.find((p) => p.props.adm1_code === 'CC-X')!;
      x.polygons = [
        {
          outer: {
            coords: [
              [60, -50],
              [70, -50],
              [70, -40],
              [60, -40],
              [60, -50],
            ],
          },
          holes: [],
        },
      ];
    });
    const without = mini((i) => {
      i.provinces = i.provinces.filter((p) => p.props.adm1_code !== 'CC-X');
      i.grouping.excluded = [];
    });
    const a = buildOk(far);
    const b = buildOk(without);
    const frameLines = (r: string): string[] =>
      r.split('\n').filter((l) => l.startsWith('projectionCenter:') || l.startsWith('frame:'));
    expect(frameLines(a.report)).toHaveLength(2);
    expect(frameLines(a.report)).toStrictEqual(frameLines(b.report));
    expect(a.pixels).toStrictEqual(b.pixels);
    expect(same(a.files.image, b.files.image)).toBe(true);
    expect(same(a.files.map, b.files.map)).toBe(true);
  });
});

describe('FR-120 and FR-122 the mini package is complete and valid', () => {
  it('FR-122 the mini package passes validateMap, checkPresentation and checkIdImage and the image decodes back', () => {
    const built = buildOk();
    const map: unknown = JSON.parse(text(built.files.map));
    const presentation: unknown = JSON.parse(text(built.files.presentation));
    expect(validateMap(map).ok).toBe(true);
    expect(checkPresentation(map, presentation).ok).toBe(true);
    const decoded = pngCodec.decode(built.files.image);
    if (!decoded.ok) throw new Error('the written image does not read back');
    expect(decoded.value.width).toBe(64);
    expect(decoded.value.height).toBe(64);
    const pixels = fromRgb(decoded.value.rgb);
    expect(checkIdImage(map, 64, 64, pixels).ok).toBe(true);
    expect(pixels).toStrictEqual(built.pixels);
  });

  it('FR-122 the entries are numbered and linked as the fixture lays them out', () => {
    const built = buildOk();
    expect(built.map.territories.map((t) => t.id)).toStrictEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(built.map.territories.map((t) => ('owner' in t ? t.owner : 'sea'))).toStrictEqual([
      1, 1, 2, 3, 3, 'sea', 'sea', 'sea',
    ]);
    const links = new Map(built.map.territories.map((t) => [t.id, t.neighbors]));
    // The island touches only sea zones; centro touches este (BB-W against CC-E).
    expect(links.get(MINI_IDS.land.isla)!.every((id) => id >= 6)).toBe(true);
    expect(links.get(MINI_IDS.land.centro)).toContain(MINI_IDS.land.este);
    // The lake and the excluded province are background, never a sea zone.
    expect(built.pixels.includes(WATER)).toBe(false);
  });

  it('FR-122 FR-162 the pixel counts and every link of the mini image are pinned (the lake is sea zone 6; other land and excluded are background)', () => {
    const built = buildOk();
    const counts: Record<number, number> = {};
    for (const v of built.pixels) counts[v] = (counts[v] ?? 0) + 1;
    expect(counts).toStrictEqual({ 0: 223, 1: 289, 2: 290, 3: 553, 4: 289, 5: 99, 6: 549, 7: 771, 8: 1033 });
    expect(built.map).toStrictEqual({
      territories: [
        { id: 1, owner: 1, neighbors: [2, 3, 6] },
        { id: 2, owner: 1, neighbors: [1, 3, 6, 8] },
        { id: 3, owner: 2, neighbors: [1, 2, 4, 6, 7, 8] },
        { id: 4, owner: 3, neighbors: [3, 7, 8] },
        { id: 5, owner: 3, neighbors: [7] },
        { id: 6, kind: 'sea', neighbors: [1, 2, 3, 7, 8] },
        { id: 7, kind: 'sea', neighbors: [3, 4, 5, 6, 8] },
        { id: 8, kind: 'sea', neighbors: [2, 3, 4, 6, 7] },
      ],
    });
  });

  it('FR-122 factions and territories are named from the sources and the table, in map order', () => {
    const built = buildOk();
    expect(built.presentation).toStrictEqual({
      factions: [
        { id: 1, name: 'Alfa' },
        { id: 2, name: 'Bretaña' },
        { id: 3, name: 'Cielo' },
      ],
      territories: [
        { id: 1, name: 'Norte A' },
        { id: 2, name: 'Sur A' },
        { id: 3, name: 'Centro' },
        { id: 4, name: 'Este C' },
        { id: 5, name: 'Isla C' },
        { id: 6, name: 'Mar del Norte' },
        { id: 7, name: 'Mar Este' },
        { id: 8, name: 'Mar del Sur' },
      ],
    });
  });
});

describe('FR-122 self-check failures', () => {
  it('FR-122 a map error is reported alone: the other checks add nothing', () => {
    // An island enclosed by other land has no link: the map is disconnected.
    const inputs = mini((i) => {
      i.otherLand.push({
        props: { adm0_a3: 'EEE' },
        polygons: [
          {
            outer: {
              coords: [
                [9, 3.5],
                [11.6, 3.5],
                [11.6, 6.6],
                [9, 6.6],
                [9, 3.5],
              ],
            },
            // The hole is exactly the island: no water is left around it (FR-162 would give any water
            // to a sea zone, which would link the island), so it touches only other land.
            holes: [
              {
                coords: [
                  [9.5, 4],
                  [11, 4],
                  [11, 6],
                  [9.5, 6],
                  [9.5, 4],
                ],
              },
            ],
          },
        ],
      });
      // A presentation error as well: the map error must still stand alone.
      i.countries[0]!.name_es = 'Alfa ';
    });
    const outcome = build(inputs);
    if (outcome.ok) throw new Error('the build should fail');
    expect(outcome.errors).toHaveLength(1);
    const error = outcome.errors[0]!;
    expect(error.kind).toBe('disconnected-map');
    expect((error as { groups: number[][] }).groups).toContainEqual([MINI_IDS.land.isla]);
    expect(outcome.preview).toBeDefined();
  });

  it('FR-122 a name that is not valid fails the build and is never repaired', () => {
    const outcome = build(mini((i) => (i.countries[0]!.name_es = 'Alfa ')));
    if (outcome.ok) throw new Error('the build should fail');
    expect(outcome.errors).toStrictEqual([{ kind: 'invalid-name', list: 'factions', position: 0, id: 1 }]);
  });

  it('FR-122 a PNG that decodes to other values is png-round-trip-mismatch', () => {
    const altering: PngCodec = {
      encode: pngCodec.encode,
      decode(bytes) {
        const decoded = pngCodec.decode(bytes);
        if (!decoded.ok) return decoded;
        const rgb = decoded.value.rgb.slice();
        rgb[rgb.length - 1] = (rgb[rgb.length - 1]! + 1) % 256;
        return { ok: true, value: { ...decoded.value, rgb } };
      },
    };
    const outcome = build(miniInputs(), altering);
    if (outcome.ok) throw new Error('the build should fail');
    expect(outcome.errors).toStrictEqual([{ kind: 'png-round-trip-mismatch' }]);
    expect(outcome.preview).toBeDefined();
  });

  it('FR-122 a PNG that does not read back is invalid-png and a wrong size is png-round-trip-mismatch', () => {
    const unreadable: PngCodec = { encode: pngCodec.encode, decode: () => ({ ok: false, errors: [{ kind: 'invalid-png' }] }) };
    const failed = build(miniInputs(), unreadable);
    if (failed.ok) throw new Error('the build should fail');
    expect(failed.errors).toStrictEqual([{ kind: 'invalid-png' }]);

    const smaller: PngCodec = {
      encode: pngCodec.encode,
      decode: () => ({ ok: true, value: { width: 1, height: 1, rgb: new Uint8Array(3) } }),
    };
    const wrong = build(miniInputs(), smaller);
    if (wrong.ok) throw new Error('the build should fail');
    expect(wrong.errors).toStrictEqual([{ kind: 'png-round-trip-mismatch' }]);
  });

  // A valid map of two land territories (1, 2; two factions) and one sea zone (3), 2 x 2 pixels.
  const tinyMap = {
    territories: [
      { id: 1, owner: 1, neighbors: [2, 3] },
      { id: 2, owner: 2, neighbors: [1, 3] },
      { id: 3, kind: 'sea', neighbors: [1, 2] },
    ],
  };
  const names = {
    factions: [{ id: 1, name: 'Uno' }, { id: 2, name: 'Dos' }],
    territories: [{ id: 1, name: 'Tierra uno' }, { id: 2, name: 'Tierra dos' }, { id: 3, name: 'Mar' }],
  };
  const alteringDecode: PngCodec = {
    encode: pngCodec.encode,
    decode(bytes) {
      const decoded = pngCodec.decode(bytes);
      if (!decoded.ok) return decoded;
      const rgb = decoded.value.rgb.slice();
      rgb[0] = (rgb[0]! + 1) % 256;
      return { ok: true, value: { ...decoded.value, rgb } };
    },
  };

  it('FR-122 map errors only when the map is invalid, even if everything else is wrong too', () => {
    const badMap = { territories: [{ id: 1, owner: 1, neighbors: [] }] };
    const rejected = validateMap(badMap);
    if (rejected.ok) throw new Error('the map should be invalid');
    const pixels = Uint32Array.from([1, 1, 1, 1]);
    const png = pngCodec.encode(2, 2, toRgb(pixels));
    const errors = selfCheck(badMap, { factions: [{ id: 1 }], territories: [] }, 2, pixels, png, alteringDecode);
    expect(errors).toStrictEqual(rejected.errors);
  });

  it('FR-122 with a valid map the order is presentation errors, id image errors, then the round trip', () => {
    // Pixels without the sea zone: it is missing and both links to it have no contact.
    const pixels = Uint32Array.from([1, 2, 2, 2]);
    const png = pngCodec.encode(2, 2, toRgb(pixels));
    const presentation = { ...names, factions: [{ id: 1 }, { id: 2, name: 'Dos' }] };
    expect(selfCheck(tinyMap, presentation, 2, pixels, png, alteringDecode)).toStrictEqual([
      { kind: 'invalid-name', list: 'factions', position: 0, id: 1 },
      { kind: 'missing-territory-pixels', territory: 3 },
      { kind: 'extra-adjacency', a: 1, b: 3 },
      { kind: 'extra-adjacency', a: 2, b: 3 },
      { kind: 'png-round-trip-mismatch' },
    ]);
  });

  it('FR-122 a clean package has no error', () => {
    const pixels = Uint32Array.from([1, 2, 3, 3]);
    const png = pngCodec.encode(2, 2, toRgb(pixels));
    expect(selfCheck(tinyMap, names, 2, pixels, png, pngCodec)).toStrictEqual([]);
  });
});

describe('FR-123 groundwork: when a failed build still carries a preview', () => {
  it('FR-123 a seed on land fails after rasterization and keeps the pixels computed so far', () => {
    const outcome = build(mini((i) => i.seeds.push({ name: 'En tierra', lon: 1.5, lat: 1.5 })));
    if (outcome.ok) throw new Error('the build should fail');
    expect(outcome.errors).toStrictEqual([{ kind: 'seed-not-water', seed: 3, name: 'En tierra' }]);
    const preview = outcome.preview!;
    expect(preview.width).toBe(64);
    expect(preview.pixels.includes(WATER)).toBe(true);
    expect(preview.pixels.includes(MINI_IDS.land.sur)).toBe(true);
  });

  it('FR-123 a territory left without pixels is vanished-entry and keeps the assigned pixels', () => {
    // The island (99 pixels) is a whole entry; with S = 120 reassigning it would leave the entry empty.
    const outcome = build(
      mini((i) => {
        i.params.minPieceSize = 120;
      }),
    );
    if (outcome.ok) throw new Error('the build should fail');
    expect(outcome.errors).toStrictEqual([{ kind: 'vanished-entry', territory: MINI_IDS.land.isla }]);
    expect(outcome.preview!.pixels.includes(MINI_IDS.land.isla)).toBe(true);
    expect(outcome.preview!.pixels.includes(WATER)).toBe(false);
  });

  it('FR-163 a zone seeded in the lake stays below S as a sea piece of its own and the build succeeds', () => {
    // The lake zone (about 25 pixels) is below S = 40 but touches no other sea zone: it is kept.
    const built = buildOk(
      mini((i) => {
        i.seeds.push({ name: 'Lago', lon: 4.5, lat: 4.5 });
        i.params.minPieceSize = 40;
      }),
    );
    expect(built.pixels.includes(9)).toBe(true);
    expect(built.map.territories.find((t) => t.id === 9)).toMatchObject({ kind: 'sea' });
  });
});

describe('FR-124 build report', () => {
  it('FR-124 the report lists the version, size, centre, frame, counts, pieces and exclusions', () => {
    const built = buildOk();
    const lines = built.report.split('\n');
    expect(built.report.endsWith('\n')).toBe(true);
    expect(lines).toContain('sourceVersion: 5.1.2');
    expect(lines).toContain('width: 64');
    expect(lines).toContain('height: 64');
    expect(lines.find((l) => l.startsWith('projectionCenter: '))).toMatch(/^projectionCenter: lon=\S+ lat=\S+$/);
    expect(lines.find((l) => l.startsWith('frame: '))).toMatch(/^frame: west=\S+ north=\S+ side=\S+$/);
    expect(lines).toContain('factions: 3');
    expect(lines).toContain('landTerritories: 5');
    expect(lines).toContain('seaZones: 3');
    const smallest = Math.min(...labelPieces(64, built.pixels).pieces.map((p) => p.size));
    expect(lines).toContain(`smallestPiece: ${smallest}`);
    expect(lines).toContain('excludedProvinces: 1');
    expect(lines).toContain('  - CC-X');
  });

  it('FR-124 every reassigned piece is listed with its former entry, pixel count and new entry', () => {
    const built = buildOk();
    const at = built.report.split('\n').indexOf('reassignedPieces: 1');
    expect(at).toBeGreaterThan(-1);
    // The tiny islet of norte (entry 1) is absorbed by the sea zone around it (Mar del Norte, 6).
    expect(built.report.split('\n')[at + 1]).toMatch(/^ {2}- entry=1 pixels=1 to=6$/);
  });

  it('FR-124 every entry with more than one piece is listed', () => {
    const built = buildOk();
    const lines = built.report.split('\n');
    const at = lines.findIndex((l) => l.startsWith('multiPieceEntries: '));
    expect(at).toBeGreaterThan(-1);
    const { pieces } = labelPieces(64, built.pixels);
    const counts = new Map<number, number>();
    for (const piece of pieces) counts.set(piece.value, (counts.get(piece.value) ?? 0) + 1);
    const expected = [...counts].filter(([, n]) => n > 1).sort((a, b) => a[0] - b[0]);
    expect(expected.map(([id]) => id)).toContain(MINI_IDS.land.sur);
    expect(lines[at]).toBe(`multiPieceEntries: ${expected.length}`);
    expect(lines.slice(at + 1, at + 1 + expected.length)).toStrictEqual(
      expected.map(([id, n]) => `  - entry=${id} pieces=${n}`),
    );
  });

  it('FR-124 the exact text for given facts: labels, order, background and empty lists', () => {
    const report = formatReport({
      version: '1.2.3',
      width: 8,
      height: 8,
      center: { lon0: 5.5, lat0: -3 },
      frame: { west: -0.25, north: 2, side: 4 },
      factions: 2,
      landTerritories: 3,
      seaZones: 1,
      smallestPiece: 7,
      reassigned: [
        { entry: 4, pixels: 2, to: 0 },
        { entry: 1, pixels: 3, to: 2 },
      ],
      excluded: ['ZZ-1', 'AA-2'],
      multiPiece: [{ entry: 3, pieces: 2 }],
    });
    expect(report).toBe(
      [
        'sourceVersion: 1.2.3',
        'width: 8',
        'height: 8',
        'projectionCenter: lon=5.5 lat=-3',
        'frame: west=-0.25 north=2 side=4',
        'factions: 2',
        'landTerritories: 3',
        'seaZones: 1',
        'smallestPiece: 7',
        'reassignedPieces: 2',
        '  - entry=4 pixels=2 to=background',
        '  - entry=1 pixels=3 to=2',
        'excludedProvinces: 2',
        '  - AA-2',
        '  - ZZ-1',
        'multiPieceEntries: 1',
        '  - entry=3 pieces=2',
        '',
      ].join('\n'),
    );
    const empty = formatReport({
      version: 'v',
      width: 1,
      height: 1,
      center: { lon0: 0, lat0: 0 },
      frame: { west: 0, north: 0, side: 1 },
      factions: 0,
      landTerritories: 0,
      seaZones: 0,
      smallestPiece: 1,
      reassigned: [],
      excluded: [],
      multiPiece: [],
    });
    expect(empty).toContain('reassignedPieces: 0\nexcludedProvinces: 0\nmultiPieceEntries: 0\n');
  });
});

describe('FR-125 fixed JSON formatting', () => {
  it('FR-125 exact bytes of a tiny map: key order, one item per line, empty list as [] and the final newline', () => {
    const map = {
      territories: [
        { id: 1, owner: 1, neighbors: [2] },
        { id: 2, kind: 'sea', neighbors: [] },
      ],
    };
    expect(text(formatJson(map))).toBe(
      [
        '{',
        '  "territories": [',
        '    {',
        '      "id": 1,',
        '      "owner": 1,',
        '      "neighbors": [',
        '        2',
        '      ]',
        '    },',
        '    {',
        '      "id": 2,',
        '      "kind": "sea",',
        '      "neighbors": []',
        '    }',
        '  ]',
        '}',
        '',
      ].join('\n'),
    );
  });

  it('FR-125 non-ASCII text is raw UTF-8: no escape, no byte order mark, LF only, one final newline', () => {
    const bytes = formatJson({
      factions: [{ id: 1, name: 'España', color: '#aabbcc' }],
      territories: [],
    });
    const out = text(bytes);
    expect(out).toContain('"name": "España"');
    expect(out).not.toContain('\\u');
    expect(out).not.toContain('\r');
    expect(bytes[0]).toBe(0x7b);
    expect(bytes[bytes.length - 1]).toBe(0x0a);
    expect(bytes[bytes.length - 2]).not.toBe(0x0a);
    expect(Array.from(bytes)).toContain(0xc3);
    expect(out).toContain('"territories": []');
  });

  it('FR-125 the written map and presentation use the fixed key orders and equal formatJson of their data', () => {
    const built = buildOk();
    const map = JSON.parse(text(built.files.map)) as { territories: Record<string, unknown>[] };
    const presentation = JSON.parse(text(built.files.presentation)) as {
      factions: Record<string, unknown>[];
      territories: Record<string, unknown>[];
    };
    expect(Object.keys(map)).toStrictEqual(['territories']);
    for (const entry of map.territories) {
      expect(Object.keys(entry)).toStrictEqual(entry['kind'] === 'sea' ? ['id', 'kind', 'neighbors'] : ['id', 'owner', 'neighbors']);
    }
    expect(Object.keys(presentation)).toStrictEqual(['factions', 'territories']);
    for (const f of presentation.factions) expect(Object.keys(f)).toStrictEqual(['id', 'name']);
    for (const t of presentation.territories) expect(Object.keys(t)).toStrictEqual(['id', 'name']);
    expect(same(built.files.map, formatJson(map))).toBe(true);
    expect(same(built.files.presentation, formatJson(presentation))).toBe(true);
    for (const bytes of [built.files.map, built.files.presentation]) {
      expect(text(bytes)).not.toContain('\\u');
      expect(text(bytes)).not.toContain('\r');
      expect(bytes[bytes.length - 1]).toBe(0x0a);
    }
    expect(text(built.files.presentation)).toContain('Bretaña');
  });

  it('FR-125 a faction colour is written after the name', () => {
    const outcome = buildOk(mini((i) => (i.grouping.countries[0]!.color = '#102030')));
    const presentation = JSON.parse(text(outcome.files.presentation)) as { factions: Record<string, unknown>[] };
    expect(Object.keys(presentation.factions[0]!)).toStrictEqual(['id', 'name', 'color']);
    expect(presentation.factions[0]!['color']).toBe('#102030');
  });
});

describe('FR-125 the runtime version file and the CI workflow agree', () => {
  it('FR-125 .nvmrc exists and holds one version', () => {
    const file = join(repo, '.nvmrc');
    expect(existsSync(file)).toBe(true);
    const lines = readFileSync(file, 'utf8').split(/\r?\n/).filter((l) => l.trim() !== '');
    expect(lines).toHaveLength(1);
    expect(lines[0]!.trim()).toMatch(/^v?\d+(\.\d+){0,2}$/);
  });

  it('FR-125 the CI workflow takes its Node version from .nvmrc and states no other', () => {
    const dir = join(repo, '.github', 'workflows');
    const workflows = readdirSync(dir).filter((f) => /\.ya?ml$/.test(f));
    expect(workflows.length).toBeGreaterThan(0);
    const all = workflows.map((f) => readFileSync(join(dir, f), 'utf8')).join('\n');
    expect(all).toMatch(/node-version-file:\s*\.nvmrc/);
    expect(all).not.toMatch(/^\s*node-version:/m);
  });
});
