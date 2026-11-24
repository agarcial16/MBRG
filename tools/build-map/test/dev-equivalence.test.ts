import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { realImportFs, runImportMode } from '../src/cli/import';
import { pngCodec } from '../src/io/png-codec';

/** The repository root: the curation and `maps/dev` live there. */
const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

describe('FR-611 the dev map equivalence', () => {
  let out: string;
  beforeEach(() => {
    out = mkdtempSync(join(tmpdir(), 'mbrg-dev-equiv-'));
  });
  afterEach(() => {
    rmSync(out, { recursive: true, force: true });
  });

  it(
    'FR-611 NFR-132 imports the committed dev-map curation into the bytes of maps/dev: the generalised pipeline is the 003b one',
    () => {
      const curation = join(root, 'tools', 'build-map', 'data', 'importer', 'dev-map.curation.json');
      let stdout = '';
      let stderr = '';
      const status = runImportMode([`--curation=${curation}`, `--out=${out}`], {
        fs: realImportFs,
        root,
        stdout: (s) => (stdout += s),
        stderr: (s) => (stderr += s),
      });
      expect(stderr).toBe('');
      expect(status).toBe(0);
      // the report names the dev map's own facts
      expect(stdout).toContain('factions: 5');
      expect(stdout).toContain('landTerritories: 70');
      expect(stdout).toContain('seaZones: 17');
      expect(stdout).toContain('projection: laea');
      // map.json and presentation.json byte for byte
      expect(readFileSync(join(out, 'map.json')).equals(readFileSync(join(root, 'maps', 'dev', 'map.json')))).toBe(true);
      expect(readFileSync(join(out, 'presentation.json')).equals(readFileSync(join(root, 'maps', 'dev', 'presentation.json')))).toBe(true);
      // ids.png decodes to the same pixel values (003b FR-130), and holds the same bytes
      const a = pngCodec.decode(readFileSync(join(out, 'ids.png')));
      const b = pngCodec.decode(readFileSync(join(root, 'maps', 'dev', 'ids.png')));
      expect(a.ok && b.ok).toBe(true);
      if (a.ok && b.ok) {
        expect(a.value.width).toBe(2048);
        expect(b.value.width).toBe(2048);
        expect(Buffer.from(a.value.rgb).equals(Buffer.from(b.value.rgb))).toBe(true);
      }
      expect(readFileSync(join(out, 'ids.png')).equals(readFileSync(join(root, 'maps', 'dev', 'ids.png')))).toBe(true);
    },
    240_000,
  );
});
