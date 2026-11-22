import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const deployment = (): string => readFileSync(join(repo, 'docs', 'deployment.md'), 'utf8');

describe('FR-613 the deployment guide documents adding a map', () => {
  it('FR-613 holds the Adding a map section with every operator step, exact CLI commands, viewer-limits guidance, date-range note and licence reminder', () => {
    const text = deployment();
    const heading = '## Adding a map';
    const at = text.indexOf(heading);
    expect(at).toBeGreaterThan(0);
    const section = text.slice(at);

    // Exact CLI commands mirroring tools/build-map/src/cli/import.ts
    expect(section).toContain('npm run import-map -w @mbrg/build-map -- extract --shp=<file.shp> --out=<file.geojson> [--keep=<name,...>] [--encoding=<utf-8|windows-1252|iso-8859-1>] [--round=<6..15>]');
    expect(section).toContain('npm run import-map -w @mbrg/build-map -- inspect --source=<file.geojson> [--draft=<file.json>]');
    expect(section).toContain('npm run import-map -w @mbrg/build-map -- import --curation=<file.json> --out=<folder> [--preview[=<file>]]');

    // Operator steps: outside tools, extract, inspect, curation (with date-range note), import + preview, review, MBRG_MAPS absolute path, MBRG_PUBLIC_MAPS
    expect(section).toMatch(/reproject/i);
    expect(section).toMatch(/simplif/i);
    expect(section).toContain('MBRG_MAPS');
    expect(section).toMatch(/absolute/i);
    expect(section).toContain('MBRG_PUBLIC_MAPS');
    expect(section).toContain('conflicting-unit-property');
    expect(section).toMatch(/per-period/i);

    // Viewer limits guidance (FR-607 / FR-613)
    expect(section).toContain('viewerLimits');
    expect(section).toContain('requiredTextureSize');
    expect(section).toContain('2,048');
    expect(section).toContain('255');
    expect(section).toContain('65,535');
    expect(section).toMatch(/internal error/i);
    expect(section).toContain('V1');
    expect(section).toContain('V2');

    // Licence reminder
    expect(section).toMatch(/licen[cs]e/i);
  });
});
