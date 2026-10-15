import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { checkGrouping } from '../src/core/grouping';
import { parseBuildInputs } from '../src/core/parse-inputs';
import type { BuildInputs, InputName } from '../src/core/types';
import { INPUT_FILES, readInputTexts } from '../src/io/read-inputs';
import { realFs } from '../src/io/fs-ops';

const data = join(dirname(fileURLToPath(import.meta.url)), '..', 'data');

function loadInputs(): BuildInputs {
  const texts = readInputTexts(data, realFs) as Record<InputName, string>;
  const parsed = parseBuildInputs(texts);
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.errors));
  return parsed.value;
}

const PER_COUNTRY: Record<string, number> = { DEU: 16, ESP: 16, FRA: 13, ITA: 20, PRT: 5 };
const EXCLUDED = [
  'ESP-5815', // Ceuta
  'ESP-5829', // Las Palmas (Canarias)
  'ESP-5835', // Melilla
  'ESP-5842', // Santa Cruz de Tenerife (Canarias)
  'FRA-1442', // Martinique
  'FRA-2000', // Guyane francaise
  'FRA-4601', // La Reunion
  'FRA-4602', // Mayotte
  'FRA-4603', // Guadeloupe
  'PRT-735', // Azores
  'PRT-736', // Madeira
];

describe('FR-127 the committed dev map inputs (grouping, sea seeds, parameters)', () => {
  it('FR-127 the input files exist and parse as the seven build inputs', () => {
    expect(Object.keys(INPUT_FILES).length).toBe(7);
    expect(() => loadInputs()).not.toThrow();
  });

  it('FR-127 exactly 70 land territories: Germany 16, Spain 16, France 13, Italy 20, Portugal 5', () => {
    const { grouping } = loadInputs();
    expect(grouping.countries.map((c) => c.country)).toStrictEqual(['DEU', 'ESP', 'FRA', 'ITA', 'PRT']);
    const counts: Record<string, number> = {};
    for (const t of grouping.territories) counts[t.country as string] = (counts[t.country as string] ?? 0) + 1;
    expect(counts).toStrictEqual(PER_COUNTRY);
    expect(grouping.territories.length).toBe(70);
    expect(16 + 16 + 13 + 20 + 5).toBe(70);
  });

  it('FR-127 every source province of the five countries is assigned or excluded exactly once', () => {
    const { grouping, provinces, countries } = loadInputs();
    expect(checkGrouping(grouping, provinces, countries)).toStrictEqual([]);
    const listed = [...grouping.territories.flatMap((t) => t.provinces), ...grouping.excluded];
    expect(listed.length).toBe(299);
    expect(new Set(listed).size).toBe(299);
  });

  it('FR-127 the excluded list is exactly Canarias, Ceuta, Melilla, Azores, Madeira and the French overseas regions', () => {
    const { grouping } = loadInputs();
    expect([...grouping.excluded].sort()).toStrictEqual([...EXCLUDED].sort());
  });

  it('FR-127 every territory has a key, a name, and no preferred colour; no faction has a preferred colour', () => {
    const { grouping } = loadInputs();
    for (const t of grouping.territories) {
      expect(typeof t.name === 'string' && t.name.length > 0, t.key).toBe(true);
      expect(t.color, t.key).toBeUndefined();
    }
    for (const c of grouping.countries) expect(c.color, c.country).toBeUndefined();
    expect(new Set(grouping.territories.map((t) => t.key)).size).toBe(70);
    expect(new Set(grouping.territories.map((t) => t.name)).size).toBe(70);
  });

  it('FR-127 between 10 and 20 named sea zone seeds with unique Spanish-looking names', () => {
    const { seeds } = loadInputs();
    expect(seeds.length).toBeGreaterThanOrEqual(10);
    expect(seeds.length).toBeLessThanOrEqual(20);
    for (const s of seeds) expect(s.name.trim().length).toBeGreaterThan(0);
    expect(new Set(seeds.map((s) => s.name)).size).toBe(seeds.length);
  });

  it('FR-127 the parameters are W = 2048, margin 2% and S = 40', () => {
    expect(loadInputs().params).toStrictEqual({ width: 2048, margin: 0.02, minPieceSize: 40 });
  });

  it('FR-127 the grouping and seed files are plain JSON text with LF line ends', () => {
    for (const file of ['dev-map/grouping.json', 'dev-map/sea-seeds.json', 'dev-map/params.json']) {
      const text = readFileSync(join(data, file), 'utf-8');
      expect(text.includes('\r'), file).toBe(false);
      expect(text.endsWith('\n'), file).toBe(true);
    }
  });
});
