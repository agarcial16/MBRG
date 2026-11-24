import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runImportMode, realImportFs } from '../src/cli/import';

/** The repository root: the sample lives under `tools/build-map/data/importer`. */
const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const sample = join(root, 'tools', 'build-map', 'data', 'importer', 'sample');
const expected = join(sample, 'expected');

let out: string;
beforeEach(() => {
  out = mkdtempSync(join(tmpdir(), 'mbrg-sample-'));
});
afterEach(() => {
  rmSync(out, { recursive: true, force: true });
});

function importSample(): { status: number; stdout: string; stderr: string } {
  // the output folder of a previous run in the same test is emptied first (an empty folder is fine)
  rmSync(out, { recursive: true, force: true });
  let stdout = '';
  let stderr = '';
  const status = runImportMode([`--curation=${join(sample, 'curation.json')}`, `--out=${out}`], {
    fs: realImportFs,
    root,
    stdout: (s) => (stdout += s),
    stderr: (s) => (stderr += s),
  });
  return { status, stdout, stderr };
}

describe('FR-612 the synthetic sample', () => {
  it('FR-612 is small: the primary source stays under 200 KB', () => {
    expect(statSync(join(sample, 'primary.json')).size).toBeLessThan(200 * 1024);
  });

  it(
    'FR-612 imports to the three expected files byte for byte',
    () => {
      const r = importSample();
      expect(r.stderr).toBe('');
      expect(r.status).toBe(0);
      for (const artifact of ['map.json', 'presentation.json', 'ids.png']) {
        expect(readFileSync(join(out, artifact)).equals(readFileSync(join(expected, artifact))), artifact).toBe(true);
      }
    },
    120_000,
  );

  it(
    'FR-612 gives the same three files for the same import',
    () => {
      const first = importSample();
      expect(first.stderr).toBe('');
      expect(first.status).toBe(0);
      const bytes = (['map.json', 'presentation.json', 'ids.png'] as const).map((artifact) =>
        readFileSync(join(out, artifact)),
      );
      const second = importSample();
      expect(second.status).toBe(0);
      expect(second.stderr).toBe('');
      for (const [i, artifact] of (['map.json', 'presentation.json', 'ids.png'] as const).entries()) {
        expect(readFileSync(join(out, artifact)).equals(bytes[i]!), artifact).toBe(true);
      }
    },
    120_000,
  );

  it(
    'FR-612 exercises every case it exists for: two features in one unit, a territoryBy merge, a factionBy exception, a sea unit and a seed, a lake, an inset, a gap fill, an excluded unit and a date-range filter',
    () => {
      const r = importSample();
      expect(r.stderr).toBe('');
      // the unit made of two features (NORDB) and the territoryBy merge (ESTE)
      expect(r.stdout).toContain('multiFeatureUnits: 1');
      expect(r.stdout).toContain('multiUnitTerritories: 1');
      // the factions of factionBy plus the per-unit exception (C3 owns the south)
      expect(r.stdout).toContain('factions: 3');
      // a sea unit (Mar Interior) and a seed (Mar Abierto)
      expect(r.stdout).toContain('seaZones: 2');
      // the lake: enclosed water that joins a zone instead of the sea
      expect(r.stdout).toContain('enclosedWaterSets: 1');
      expect(r.stdout).toContain('enclosedWaterPixels: 132');
      // the inset of the island group
      expect(r.stdout).toContain('insets: 1');
      // the gap-filled pond inside the middle territory
      expect(r.stdout).toContain('gapFilledSets: 1');
      // the excluded unit never became a territory: nine units, eight selected, six land territories
      expect(r.stdout).toContain('units: 9');
      expect(r.stdout).toContain('selectedUnits: 8');
      expect(r.stdout).toContain('landTerritories: 6');
      // the date-range filter is part of the curation and every unit passes it
      const curation = JSON.parse(readFileSync(join(sample, 'curation.json'), 'utf8')) as { select: unknown[] };
      expect(curation.select).toStrictEqual([
        { property: 'from', gte: '1900-01-01' },
        { property: 'to', lte: '2000-01-01' },
      ]);
    },
    120_000,
  );

  it('FR-612 is not added to maps/, to the server settings or to the e2e harness', () => {
    // not a map package folder
    expect(readdirSync(join(root, 'maps'))).not.toContain('sample');
    expect(existsSync(join(root, 'maps', 'sample'))).toBe(false);
    // no server source or server test names it, and the e2e harness (023) does not either
    const offenders: string[] = [];
    const walk = (folder: string): void => {
      for (const name of readdirSync(folder)) {
        const path = join(folder, name);
        if (statSync(path).isDirectory()) {
          walk(path);
          continue;
        }
        if (!name.endsWith('.ts')) continue;
        if (readFileSync(path, 'utf8').includes('importer/sample')) offenders.push(path);
      }
    };
    walk(join(root, 'apps', 'server'));
    walk(join(root, 'apps', 'bot', 'test', 'e2e'));
    expect(offenders).toStrictEqual([]);
    // and the committed expected package really is the sample's own output (same folder, locked)
    expect(basename(expected)).toBe('expected');
    expect(existsSync(join(expected, 'map.json'))).toBe(true);
  });

  it('FR-612 never touches its locked expected package when importing elsewhere', () => {
    const before = (['map.json', 'presentation.json', 'ids.png'] as const).map((artifact) =>
      readFileSync(join(expected, artifact)),
    );
    const r = importSample();
    expect(r.status).toBe(0);
    for (const [i, artifact] of (['map.json', 'presentation.json', 'ids.png'] as const).entries()) {
      expect(readFileSync(join(expected, artifact)).equals(before[i]!), artifact).toBe(true);
    }
  });
});
