import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { MapData, MapEntry } from '@mbrg/shared';
import type { BuiltPresentation, PngCodec } from '../src/core/types';
import { realImportFs, runImportMode } from '../src/cli/import';
import { paletteExhaustedFaction, splitFactions, viewerLimits, type ReportFaction } from '../src/importer/report';
import { sha256Hex } from '../src/importer/sha256';
import { pngCodec } from '../src/io/png-codec';
import { bytesOf, collection, feat, textBytes } from './helpers/geo-fixture';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'mbrg-report-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** A land entry of a synthetic map. */
const land = (id: number, owner: number, neighbors: number[]): MapEntry => ({ id, kind: 'land', owner, neighbors }) as MapEntry;
/** A sea entry of a synthetic map. */
const sea = (id: number, neighbors: number[]): MapEntry => ({ id, kind: 'sea', neighbors }) as MapEntry;
const mapOf = (...entries: MapEntry[]): MapData => ({ territories: entries });
const bare: BuiltPresentation = { factions: [], territories: [] };

/** `count` one-territory factions around one shared sea zone: they are all direct candidates of each other. */
function factionsAroundSea(count: number): MapData {
  const ids = Array.from({ length: count }, (_, i) => i + 1);
  return mapOf(...ids.map((id): MapEntry => land(id, id, [1000])), sea(1000, ids));
}

describe('FR-607 the viewer limits', () => {
  it('FR-607 reports the required texture size max(W, H, entries + 1) and warns only above the viewer limits', () => {
    const factions: ReportFaction[] = [{ id: 1, key: 'A' }, { id: 2, key: 'B' }];
    const map = factionsAroundSea(2);
    // five entries, side 96: the entries add nothing to the texture the viewer needs
    expect(viewerLimits(map, bare, 96, 96, 5, factions)).toStrictEqual({ requiredTextureSize: 96, warnings: [] });
    // the entry cap and its boundary: 65,535 entries draw, 65,536 warn (at this size the texture warns with them)
    expect(viewerLimits(map, bare, 96, 96, 65535, factions).warnings).toStrictEqual([{ kind: 'textureAbove2048', size: 65536 }]);
    expect(viewerLimits(map, bare, 96, 96, 65536, factions).warnings).toStrictEqual([
      { kind: 'textureAbove2048', size: 65537 },
      { kind: 'entriesAbove65535', entries: 65536 },
    ]);
    expect(viewerLimits(map, bare, 96, 96, 70000, factions)).toStrictEqual({
      requiredTextureSize: 70001,
      warnings: [
        { kind: 'textureAbove2048', size: 70001 },
        { kind: 'entriesAbove65535', entries: 70000 },
      ],
    });
    // a big side warns above the 2048 that WebGL 2 guarantees; 300 factions fit the 65,535-faction owner table
    const crowd: ReportFaction[] = Array.from({ length: 300 }, (_, i) => ({ id: i + 1, key: 'f' + (i + 1) }));
    expect(viewerLimits(map, bare, 4096, 4096, 100, crowd).warnings).toStrictEqual([{ kind: 'textureAbove2048', size: 4096 }]);
    // the faction boundary (spec 033 FR-646): 255, 256 and 65,535 factions draw, 65,536 warn
    const edge: ReportFaction[] = Array.from({ length: 65536 }, (_, i) => ({ id: i + 1, key: 'e' + (i + 1) }));
    expect(viewerLimits(map, bare, 96, 96, 100, edge.slice(0, 255)).warnings).toStrictEqual([]);
    expect(viewerLimits(map, bare, 96, 96, 100, edge.slice(0, 256)).warnings).toStrictEqual([]);
    expect(viewerLimits(map, bare, 96, 96, 100, edge.slice(0, 65535)).warnings).toStrictEqual([]);
    expect(viewerLimits(map, bare, 96, 96, 100, edge).warnings).toStrictEqual([{ kind: 'factionsAbove65535', factions: 65536 }]);
    // the texture boundary: 2048 needs no warning, 2049 does
    expect(viewerLimits(map, bare, 2048, 2048, 100, factions).warnings).toStrictEqual([]);
    expect(viewerLimits(map, bare, 2049, 2049, 100, factions).warnings).toStrictEqual([{ kind: 'textureAbove2048', size: 2049 }]);
  });

  /** `count` one-territory factions, each a land neighbour of all the others. */
  function landClique(count: number): MapData {
    const ids = Array.from({ length: count }, (_, i) => i + 1);
    return mapOf(...ids.map((id): MapEntry => land(id, id, ids.filter((other) => other !== id))));
  }

  it('FR-607 / FR-646 colours maps without exhaustion: 20 curated palette colours plus the procedural last resort', () => {
    // the shipped viewer theme enables the procedural last resort (FR-642), so colouring never fails
    expect(paletteExhaustedFaction(factionsAroundSea(12), bare)).toBeUndefined();
    expect(paletteExhaustedFaction(factionsAroundSea(13), bare)).toBeUndefined();
    expect(paletteExhaustedFaction(factionsAroundSea(21), bare)).toBeUndefined();
    expect(paletteExhaustedFaction(landClique(21), bare)).toBeUndefined();
  });

  it('FR-607 / FR-646 keeps the 20-colour guard for a custom finite theme without the procedural fallback', () => {
    // twenty factions around one sea zone take the twenty curated colours; the soft sea-zone step colours a 21st
    expect(paletteExhaustedFaction(factionsAroundSea(20), bare, { procedural: false })).toBeUndefined();
    expect(paletteExhaustedFaction(factionsAroundSea(21), bare, { procedural: false })).toBeUndefined();
    // a 21st land clique member has no curated colour left: every one is on a land neighbour
    expect(paletteExhaustedFaction(landClique(21), bare, { procedural: false })).toBe(21);
    // a preferred colour of its own saves it
    const saved: BuiltPresentation = { factions: [{ id: 21, name: 'TwentyFirst', color: '#010203' }], territories: [] };
    expect(paletteExhaustedFaction(landClique(21), saved, { procedural: false })).toBeUndefined();
    // factions that touch nothing take any palette colour: only candidates block a reuse
    const apart = mapOf(...Array.from({ length: 21 }, (_, i): MapEntry => land(i + 1, i + 1, [])));
    expect(paletteExhaustedFaction(apart, bare, { procedural: false })).toBeUndefined();
  });

  it('FR-607 / FR-646 never fails the import and never warns for a map the viewer colours without exhaustion', () => {
    const factions: ReportFaction[] = Array.from({ length: 21 }, (_, i) => ({ id: i + 1, key: 'F' + (i + 1) }));
    const map = factionsAroundSea(21);
    expect(viewerLimits(map, bare, 96, 96, 22, factions)).toStrictEqual({ requiredTextureSize: 96, warnings: [] });
  });
});

describe('FR-609 the factions split over land', () => {
  it('FR-609 lists every faction whose land territories form more than one group over land links', () => {
    // faction 1 owns two lands that do not touch; faction 2 owns two touching lands; faction 3 one land
    const map = mapOf(
      land(1, 1, [4]),
      land(2, 1, []),
      land(3, 2, [5]),
      land(4, 3, [1]),
      land(5, 2, [3]),
    );
    expect(splitFactions(map)).toStrictEqual([{ id: 1, groups: 2 }]);
    // a faction joined only through a sea zone is still split over land links
    const viaSea = mapOf(land(1, 1, [3]), land(2, 1, [3]), sea(3, [1, 2]));
    expect(splitFactions(viaSea)).toStrictEqual([{ id: 1, groups: 2 }]);
  });
});

/** Three land units of two countries in a row, a marine region on top, a strip of context land and a seed below. */
function world() {
  const rect = (x0: number, y0: number, x1: number, y1: number): unknown => ({ type: 'Polygon', coordinates: [[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]] });
  const features: unknown[] = [
    feat({ code: 'A', name: 'Alfa', adm: 'X' }, rect(0, 0, 2, 2)),
    feat({ code: 'B', name: 'Beta', adm: 'X' }, rect(2, 0, 4, 2)),
    feat({ code: 'C', name: 'Gamma', adm: 'Y' }, rect(4, 0, 6, 2)),
    feat({ code: 'D', name: 'North Gulf' }, rect(0, 2, 6, 3.5)),
  ];
  const curation = {
    primary: 'primary.geojson',
    context: ['context.geojson'],
    columns: { key: 'code', name: ['name'] },
    params: { side: 96, margin: 0.02, minPieceSize: 4, projection: 'laea', tiling: false },
    factionBy: { property: 'adm' },
    factions: [{ key: 'X', name: 'Xland' }, { key: 'Y', name: 'Yland' }],
    units: { D: { kind: 'sea' } },
    seas: [{ name: 'South Sea', lon: 3, lat: -0.7 }],
  };
  return { features, curation };
}

function write(w: { features: unknown[]; curation: Record<string, unknown> } = world()): { curation: string; primary: Uint8Array; context: Uint8Array; curationBytes: Uint8Array } {
  const primary = bytesOf(collection(w.features));
  const context = bytesOf(collection([feat({ name: 'Strip' }, { type: 'Polygon', coordinates: [[[0, -1.5], [6, -1.5], [6, -1.2], [0, -1.2], [0, -1.5]]] })]));
  const curationBytes = textBytes(JSON.stringify(w.curation));
  const put = (name: string, content: Uint8Array): void => {
    const file = join(dir, 'in', name);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, content);
  };
  put('primary.geojson', primary);
  put('context.geojson', context);
  put('curation.json', curationBytes);
  return { curation: join(dir, 'in', 'curation.json'), primary, context, curationBytes };
}

function run(args: string[], codec?: PngCodec): { status: number; stdout: string; stderr: string } {
  let stdout = '';
  let stderr = '';
  const status = runImportMode(args, { fs: realImportFs, root: dir, stdout: (s) => (stdout += s), stderr: (s) => (stderr += s), ...(codec === undefined ? {} : { codec }) });
  return { status, stdout, stderr };
}

const out = (name = 'pkg'): string => join(dir, name);

/** The top-level labels of a report, in order. */
const topLabels = (report: string): string[] =>
  report
    .split('\n')
    .filter((line) => line !== '' && !line.startsWith(' '))
    .map((line) => line.slice(0, line.indexOf(':')));

const REPORT_LABELS = [
  'curation',
  'curationSha256',
  'sources',
  'featuresRead',
  'skippedNullGeometries',
  'units',
  'selectedUnits',
  'noOwnerUnits',
  'multiFeatureUnits',
  'projection',
  'projectionCenter',
  'frame',
  'pixelSideKm',
  'insets',
  'factions',
  'landTerritories',
  'multiUnitTerritories',
  'seaZones',
  'viewerLimits',
  'smallestPiece',
  'reassignedPieces',
  'gapFilledSets',
  'contextGap',
  'contextGapPixels',
  'exclaveBridges',
  'thinCoastFactions',
  'enclosedWaterSets',
  'enclosedWaterPixels',
  'enclosedWaterZones',
  'enclosedReach',
  'enclosedLakes',
  'multiPieceEntries',
  'splitFactions',
];

describe('FR-609 the report of a successful import', () => {
  it('FR-609 prints the deterministic report with English labels, the digests and the counts of the world', () => {
    const w = write();
    const r = run([`--curation=${w.curation}`, `--out=${out()}`]);
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
    expect(topLabels(r.stdout)).toStrictEqual(REPORT_LABELS);
    // the digests are of the exact bytes that were read
    expect(r.stdout).toContain(`curationSha256: ${sha256Hex(w.curationBytes)}`);
    expect(r.stdout).toContain(`  - file=primary.geojson sha256=${sha256Hex(w.primary)} features=4 skippedNullGeometries=0`);
    expect(r.stdout).toContain(`  - file=context.geojson sha256=${sha256Hex(w.context)} features=1 skippedNullGeometries=0`);
    // the counts of the fixture world
    expect(r.stdout).toContain('units: 4');
    expect(r.stdout).toContain('selectedUnits: 4');
    expect(r.stdout).toContain('multiFeatureUnits: 0');
    expect(r.stdout).toContain('projection: laea');
    expect(r.stdout).toContain('insets: 0');
    expect(r.stdout).toContain('factions: 2');
    expect(r.stdout).toContain('landTerritories: 3');
    expect(r.stdout).toContain('multiUnitTerritories: 0');
    expect(r.stdout).toContain('seaZones: 2');
    // the viewer limits of the fixture: five entries, side 96, two factions, no warning
    expect(r.stdout).toContain('requiredTextureSize: 96');
    expect(r.stdout).toContain('warnings: 0');
    // the pixel side in kilometres is the frame side over W times 6,371
    const kmLine = r.stdout.split('\n').find((line) => line.startsWith('pixelSideKm:'))!;
    expect(Number(kmLine.split(' ')[1])).toBeGreaterThan(0);
    // the smallest piece of the final image exists and is a whole number of pixels
    const smallest = Number(r.stdout.split('\n').find((line) => line.startsWith('smallestPiece:'))!.split(' ')[1]);
    expect(Number.isInteger(smallest)).toBe(true);
    expect(smallest).toBeGreaterThan(0);
    expect(r.stdout).toContain('smallestPiece: ');
    expect(r.stdout).toContain('reassignedPieces: 0');
    expect(r.stdout).toContain('gapFilledSets: 0');
    expect(r.stdout).toContain('enclosedWaterSets: ');
    expect(r.stdout).toContain('multiPieceEntries: ');
    expect(r.stdout).toContain('splitFactions: 0');
    expect(r.stdout.endsWith('\n')).toBe(true);
  });

  it('FR-609 gives the same report bytes for the same import', () => {
    const w = write();
    const first = run([`--curation=${w.curation}`, `--out=${out()}`]);
    const second = run([`--curation=${w.curation}`, `--out=${out('two')}`]);
    expect(first.status).toBe(0);
    expect(second.status).toBe(0);
    expect(first.stdout).toBe(second.stdout);
  });

  it('FR-607 / FR-646 prints no faction-count or palette warning for 300 factions inside the viewer limits', () => {
    // 300 one-territory factions with zero-padded keys: within the 65,535-faction owner table, and the viewer
    // colours them without exhaustion (20 curated colours, soft sea preference, procedural last resort)
    const rect = (x0: number, y0: number, x1: number, y1: number): unknown => ({ type: 'Polygon', coordinates: [[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]] });
    const features: unknown[] = [feat({ code: 'SEA', name: 'Shared Sea', adm: 'Z' }, rect(0, -1, 13, 0))];
    for (let i = 0; i < 300; i++) {
      const key = 'f' + String(i).padStart(3, '0');
      const x = i < 13 ? i : (i - 13) % 20;
      const y = i < 13 ? 0 : 1 + Math.floor((i - 13) / 20);
      features.push(feat({ code: 'u' + i, name: 'U' + i, f: key, fn: 'F' + i }, rect(x, y, x + 1, y + 1)));
    }
    const crowd = {
      features,
      curation: {
        primary: 'primary.geojson',
        columns: { key: 'code', name: ['name'] },
        params: { side: 64, margin: 0.02, minPieceSize: 1, projection: 'laea', tiling: false },
        factionBy: { property: 'f', nameProperty: 'fn' },
        units: { SEA: { kind: 'sea' } },
      },
    };
    const written = write(crowd);
    const r = run([`--curation=${written.curation}`, `--out=${out()}`]);
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('factions: 300');
    expect(r.stdout).toContain('landTerritories: 300');
    expect(r.stdout).toContain('seaZones: 1');
    expect(r.stdout).toContain('  warnings: 0');
    expect(r.stdout).not.toContain('factionsAbove');
    expect(r.stdout).not.toContain('paletteExhaustedFaction');
  });
});

describe('FR-610 the preview', () => {
  it('FR-610 writes the preview outside the output folder on a successful import, with the codec it is given', () => {
    const w = write();
    const preview = join(dir, 'look.png');
    let encodes = 0;
    const codec: PngCodec = { ...pngCodec, encode: (width, height, rgb) => { encodes++; return pngCodec.encode(width, height, rgb); } };
    const r = run([`--curation=${w.curation}`, `--out=${out()}`, `--preview=${preview}`], codec);
    expect(r.status).toBe(0);
    // the package image and the preview are the two encodes of a successful import
    expect(encodes).toBe(2);
    const decoded = pngCodec.decode(readFileSync(preview));
    expect(decoded.ok && decoded.value.width).toBe(96);
    expect(existsSync(join(out(), 'map.json'))).toBe(true);
  });

  it('FR-610 writes the preview at its default path under the root when --preview has no value', () => {
    const w = write();
    const r = run([`--curation=${w.curation}`, `--out=${out()}`, '--preview']);
    expect(r.status).toBe(0);
    expect(existsSync(join(dir, 'tools', 'build-map', 'out', 'import-preview.png'))).toBe(true);
  });

  it('FR-610 refuses a preview path inside the output folder as a usage error, before anything is read', () => {
    const w = write();
    let reads = 0;
    const counting = { ...realImportFs, size: (p: string) => { reads++; return realImportFs.size(p); } };
    let stderr = '';
    const status = runImportMode([`--curation=${w.curation}`, `--out=${out()}`, `--preview=${join(out(), 'look.png')}`], {
      fs: counting,
      root: dir,
      stdout: () => undefined,
      stderr: (s) => (stderr += s),
    });
    expect(status).toBe(2);
    expect(stderr).toContain('"kind":"usage-error"');
    expect(stderr).toContain('"reason":"preview-inside-package"');
    expect(reads).toBe(0);
    expect(existsSync(out())).toBe(false);
  });

  it('FR-610 still writes the preview of the last assignment when the import fails at the pixel steps', () => {
    // a minimum piece size no territory can keep: the import fails after the pixels are composed
    const w = world();
    const strict = { ...w, curation: { ...w.curation, params: { ...w.curation.params, minPieceSize: 10000 } } };
    const written = write(strict);
    const preview = join(dir, 'failed.png');
    const r = run([`--curation=${written.curation}`, `--out=${out()}`, `--preview=${preview}`]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('territory-below-min-size');
    expect(existsSync(preview)).toBe(true);
    const decoded = pngCodec.decode(readFileSync(preview));
    expect(decoded.ok && decoded.value.width).toBe(96);
    expect(existsSync(join(out(), 'map.json'))).toBe(false);
  });

  it('FR-610 writes no preview when the import fails before the pixel steps', () => {
    const w = world();
    const broken = { ...w, curation: { ...w.curation, columns: { ...w.curation.columns, key: 'missing' } } };
    const written = write(broken);
    const preview = join(dir, 'none.png');
    const r = run([`--curation=${written.curation}`, `--out=${out()}`, `--preview=${preview}`]);
    expect(r.status).toBe(1);
    expect(existsSync(preview)).toBe(false);
    expect(existsSync(join(out(), 'map.json'))).toBe(false);
  });

  it('FR-610 stops a successful import before the package changes when the preview cannot be written', () => {
    const w = write();
    const preview = join(dir, 'blocked.png');
    const failing = {
      ...realImportFs,
      writeFile: (p: string, bytes: Uint8Array) => {
        if (p === preview) throw new Error('no');
        return realImportFs.writeFile(p, bytes);
      },
    };
    let stderr = '';
    const status = runImportMode([`--curation=${w.curation}`, `--out=${out()}`, `--preview=${preview}`], {
      fs: failing,
      root: dir,
      stdout: () => undefined,
      stderr: (s) => (stderr += s),
    });
    expect(status).toBe(1);
    expect(stderr).toContain('"kind":"preview-write-failed"');
    expect(existsSync(join(out(), 'map.json'))).toBe(false);
  });
});

