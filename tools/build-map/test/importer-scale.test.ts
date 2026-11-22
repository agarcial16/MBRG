import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { rasterize } from '../src/core/rasterize';
import { importFixture, scaleCuration } from '../src/cli/scale-import';
import { generateScaleFixture, NFR_136, type ScaleOptions } from '../src/importer/scale-fixture';

// The rasterizer is wrapped so a test can prove that no pixel work ran (NFR-135).
vi.mock('../src/core/rasterize', async (importOriginal) => {
  const original = await importOriginal<typeof import('../src/core/rasterize')>();
  return { ...original, rasterize: vi.fn(original.rasterize) };
});

const folders: string[] = [];
afterEach(() => {
  for (const folder of folders.splice(0)) rmSync(join(folder, '..'), { recursive: true, force: true });
});

/** NFR-136's own fixture, pinned: 8,132 land units in 52 factions, 59 sea zones, at least 5,000,000 positions. */
describe('NFR-136 the scale fixture of the suite tests', () => {
  it('NFR-136 keeps the full fixture of the spec (its generation is pinned byte-identical by the T1.10 tests)', () => {
    expect(NFR_136).toStrictEqual({
      units: 8132,
      islandUnits: 88,
      columns: 116,
      factions: 52,
      seas: 59,
      verticesPerSide: 154,
      side: 4096,
      minPieceSize: 8,
      insetAt: [20, 3570],
    });
    const fixture = generateScaleFixture(NFR_136);
    expect(fixture.counts).toStrictEqual({ units: 8132, factions: 52, seas: 59, positions: 5_020_447 });
    // the curation the real import needs: the province factions named by their own key
    const curation = JSON.parse(new TextDecoder().decode(scaleCuration(fixture, 'prov', 'prov'))) as { factionBy: unknown };
    expect(curation.factionBy).toStrictEqual({ property: 'prov', nameProperty: 'prov' });
  });
});

describe('the suite scale tests (NFR-136, FR-607, FR-614, NFR-135)', () => {
  it(
    'NFR-136 imports a 1,000-unit fixture at side 2,048 end to end',
    () => {
      const options: ScaleOptions = {
        units: 1000,
        islandUnits: 12,
        columns: 50,
        factions: 12,
        seas: 10,
        verticesPerSide: 30,
        side: 2048,
        minPieceSize: 8,
        insetAt: [10, 1785],
      };
      const fixture = generateScaleFixture(options);
      const r = importFixture(fixture, scaleCuration(fixture, 'prov', 'prov'), () => 0);
      folders.push(r.folder);
      expect(r.errors).toBe('');
      expect(r.status).toBe(0);
      expect(r.report).toContain('units: 1000');
      expect(r.report).toContain('factions: 12');
      expect(r.report).toContain('seaZones: 10');
      expect(r.report).toContain('landTerritories: 1000');
      expect(r.report).toContain('insets: 1');
      expect(r.report).toContain('warnings: 0');
    },
    180_000,
  );

  it(
    'FR-607 shows the viewer-limits warning for 300 single-unit factions, and the importer caps nothing',
    () => {
      const options: ScaleOptions = {
        units: 500,
        islandUnits: 4,
        columns: 30,
        factions: 300,
        seas: 4,
        verticesPerSide: 4,
        side: 128,
        minPieceSize: 1,
        insetAt: [1, 111],
      };
      const fixture = generateScaleFixture(options);
      const r = importFixture(fixture, scaleCuration(fixture, 'prov', 'prov'), () => 0);
      folders.push(r.folder);
      expect(r.errors).toBe('');
      expect(r.status).toBe(0);
      expect(r.report).toContain('factions: 300');
      expect(r.report).toContain('    - factionsAbove255=300');
    },
    60_000,
  );

  it('NFR-135 refuses a 10,000-faction curation with too-many-factions before any pixel buffer exists', () => {
    const options: ScaleOptions = {
      units: 10_100,
      islandUnits: 100,
      columns: 100,
      factions: 10_100,
      seas: 4,
      verticesPerSide: 4,
      side: 64,
      minPieceSize: 1,
      insetAt: [2, 40],
    };
    const fixture = generateScaleFixture(options);
    vi.mocked(rasterize).mockClear();
    const r = importFixture(fixture, scaleCuration(fixture, 'prov', 'prov'), () => 0);
    folders.push(r.folder);
    expect(r.status).toBe(1);
    expect(r.errors).toContain('"kind":"too-many-factions"');
    expect(r.errors).toContain('"cap":9999');
    // the failure is found in the curation stage: no raster was ever computed
    expect(vi.mocked(rasterize)).not.toHaveBeenCalled();
  });
});
