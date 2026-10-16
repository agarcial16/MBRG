import { describe, expect, it } from 'vitest';
import ownSource from './traceability.test.ts?raw';

const testSources = import.meta.glob(
  ['../../*/test/**/*.test.ts', '../../../tools/*/test/**/*.test.ts', '../../../apps/*/test/**/*.test.ts'],
  {
    query: '?raw',
    import: 'default',
    eager: true,
  },
) as Record<string, string>;

const ciWorkflow = Object.values(
  import.meta.glob('../../../.github/workflows/ci.yml', {
    query: '?raw',
    import: 'default',
    eager: true,
  }) as Record<string, string>,
)[0];

// Matches it('t'), describe('t') and the second call of it.each([...])('t').
const TITLE = /(?:\b(?:it|test|describe)(?:\.\w+)*|\]\))\(\s*(['"`])((?:\\.|(?!\1)[^\\])*)\1/g;
const ID = /\b(?:FR|NFR)-\d+\b/g;

/** Requirement ids found in test/describe titles, excluding this file. */
export function tracedIds(sources: Record<string, string>): Set<string> {
  const found = new Set<string>();
  for (const [path, src] of Object.entries(sources)) {
    if (path.endsWith('traceability.test.ts')) continue;
    for (const m of src.matchAll(TITLE)) {
      for (const id of m[2]!.matchAll(ID)) found.add(id[0]);
    }
  }
  return found;
}

/** Ids retired by spec 002 (superseded by FR-60, FR-69 and FR-70): never allowed in a test title. */
const RETIRED = ['FR-6', 'FR-25'];

/** Ids traced by the test titles of this very file (the scan of other files skips it). */
const OWN_SOURCE = ownSource;
// Only real declarations (an it/describe call opening its line); code quoted inside a string is ignored.
const OWN_DECLARATIONS = OWN_SOURCE.split(/\r?\n/)
  .filter((l) => /^\s*(?:it|test|describe)(?:\.\w+)*\(/.test(l))
  .join('\n');
const TRACED_HERE = [...tracedIds({ 'x/own.test.ts': OWN_DECLARATIONS })];

// Id ranges of the specs: 001-003c, the viewer spec 004 (FR-132..FR-161, NFR-24..NFR-29)
// and spec 005 (FR-167..FR-194, NFR-32..NFR-37).
const FR_RANGES: readonly (readonly [number, number])[] = [[1, 194]];
const NFR_RANGES: readonly (readonly [number, number])[] = [[1, 37]];
const idsOf = (prefix: string, ranges: readonly (readonly [number, number])[]): string[] =>
  ranges.flatMap(([from, to]) => Array.from({ length: to - from + 1 }, (_, i) => `${prefix}-${from + i}`));

/** Spec 005 ids still being implemented: not yet required in a test title. Removed in task T10. */
const PENDING_005 = [...idsOf('FR', [[167, 194]]), ...idsOf('NFR', [[32, 37]])];

const specIds = [...idsOf('FR', FR_RANGES), ...idsOf('NFR', NFR_RANGES)];
const expected = specIds.filter((id) => !RETIRED.includes(id) && !PENDING_005.includes(id));

describe('traceability', () => {
  it('the glob finds the test sources', () => {
    expect(Object.keys(testSources).length).toBeGreaterThanOrEqual(10);
  });

  it('NFR-19 the scanned sources include the viewer tests', () => {
    const viewer = Object.keys(testSources).filter((p) => p.includes('/apps/web/test/'));
    expect(viewer.length).toBeGreaterThanOrEqual(10);
  });

  it('NFR-19 the scanned sources include the builder tests', () => {
    const builder = Object.keys(testSources).filter((p) => p.includes('/tools/build-map/test/'));
    expect(builder.length).toBeGreaterThanOrEqual(1);
  });

  it('title extraction matches whole ids only and reads it.each titles', () => {
    const found = tracedIds({
      'x/a.test.ts': "it('FR-10 a', () => {}); it.each([[1]])('FR-12 %s', () => {});",
    });
    expect([...found].sort()).toStrictEqual(['FR-10', 'FR-12']);
  });

  it('NFR-13 the expected list holds the highest ids and excludes the retired ids', () => {
    expect(expected).toContain('FR-81');
    expect(expected).toContain('NFR-13');
    expect(expected).toContain('FR-60');
    expect(expected).toContain('NFR-6');
    for (const id of RETIRED) expect(expected).not.toContain(id);
  });

  it('NFR-13 NFR-19 the expected list ends at the last spec ids and excludes retired ids', () => {
    expect(FR_RANGES).toStrictEqual([[1, 194]]);
    expect(NFR_RANGES).toStrictEqual([[1, 37]]);
    const everything = new Set([...expected, ...RETIRED, ...PENDING_005]);
    expect([...everything].sort()).toStrictEqual([...specIds].sort());
    expect(everything.size).toBe(231);
    expect(specIds.length - RETIRED.length).toBe(229);
    expect(expected.length).toBe(195);
    expect(expected).toContain('NFR-31');
    for (const id of ['FR-110', 'NFR-22', 'FR-104']) expect(expected).toContain(id);
    for (const id of ['FR-105', 'FR-126', 'NFR-14', 'NFR-23', 'FR-131', 'NFR-21']) {
      expect(expected).toContain(id);
    }
    for (const id of ['FR-132', 'FR-161', 'NFR-24', 'NFR-29', 'FR-166', 'NFR-31']) {
      expect(expected).toContain(id);
    }
    for (const id of ['FR-194', 'NFR-37']) expect(specIds).toContain(id);
    for (const id of ['FR-195', 'NFR-38']) {
      expect(specIds).not.toContain(id);
      expect(expected).not.toContain(id);
    }
    for (const id of ['FR-6', 'FR-25']) expect(expected).not.toContain(id);
  });

  it('NFR-35 the pending set is exactly the 34 ids of spec 005 and none of them is expected yet', () => {
    // Independent computation with literal bounds.
    const literal = [
      ...Array.from({ length: 28 }, (_, i) => `FR-${167 + i}`),
      ...Array.from({ length: 6 }, (_, i) => `NFR-${32 + i}`),
    ];
    expect(PENDING_005).toStrictEqual(literal);
    expect(PENDING_005).toHaveLength(34);
    expect(PENDING_005[0]).toBe('FR-167');
    expect(PENDING_005).toContain('FR-194');
    expect(PENDING_005).toContain('NFR-37');
    for (const id of PENDING_005) {
      expect(specIds, id).toContain(id);
      expect(expected, id).not.toContain(id);
    }
  });

  it('NFR-19 the expected list excludes only the retired ids and the pending ids of spec 005', () => {
    // Independent computation with literal bounds: the 001-004 ids can never hide in the pending set.
    const all = [
      ...Array.from({ length: 166 }, (_, i) => `FR-${i + 1}`),
      ...Array.from({ length: 31 }, (_, i) => `NFR-${i + 1}`),
    ];
    expect(RETIRED).toStrictEqual(['FR-6', 'FR-25']);
    expect(all.filter((id) => !RETIRED.includes(id))).toHaveLength(195);
    expect(expected).toHaveLength(195);
    expect(expected).toStrictEqual(all.filter((id) => id !== 'FR-6' && id !== 'FR-25'));
    for (const id of ['FR-127', 'FR-131', 'NFR-16', 'NFR-17', 'NFR-21']) {
      expect(expected).toContain(id);
    }
  });

  it('NFR-13 extraction does not mistake ids sharing a retired prefix for retired ids', () => {
    const found = tracedIds({ 'x/a.test.ts': "it('NFR-6 FR-60 FR-69 a', () => {});" });
    expect([...found].sort()).toStrictEqual(['FR-60', 'FR-69', 'NFR-6']);
    expect(found.has('FR-6')).toBe(false);
  });

  it('NFR-13 a retired id in a test title is detected and none is in use', () => {
    const planted = tracedIds({ 'x/a.test.ts': "it('FR-25 FR-6 a', () => {});" });
    expect(RETIRED.filter((id) => planted.has(id))).toStrictEqual(['FR-6', 'FR-25']);
    const used = tracedIds(testSources);
    expect(RETIRED.filter((id) => used.has(id))).toStrictEqual([]);
  });

  it('NFR-13 NFR-19 NFR-31 NFR-35 this file self-traces exactly the ids it verifies', () => {
    expect([...TRACED_HERE].sort()).toStrictEqual(['FR-55', 'FR-56', 'NFR-13', 'NFR-19', 'NFR-31', 'NFR-35']);
  });

  it('NFR-31 the ids of spec 003c are all expected', () => {
    for (const id of ['FR-162', 'FR-163', 'FR-164', 'FR-165', 'FR-166', 'NFR-30', 'NFR-31']) {
      expect(expected).toContain(id);
    }
  });

  it('NFR-13 NFR-19 every expected requirement id appears in a test name', () => {
    const found = tracedIds(testSources);
    for (const id of TRACED_HERE) found.add(id);
    const missing = expected.filter((id) => !found.has(id));
    expect(missing, `ids without a test name: ${missing.join(', ')}`).toStrictEqual([]);
  });

  // FR-55/FR-56 are about the hosted CI. A unit test cannot run GitHub; it only
  // checks the workflow configuration. Real proof is the CI demonstration PRs.
  it('FR-55 workflow runs typecheck and tests on pull requests and pushes to main and rewrite', () => {
    expect(ciWorkflow).toBeDefined();
    expect(ciWorkflow).toMatch(/pull_request:\s*\n\s*branches:\s*\[main, rewrite\]/);
    expect(ciWorkflow).toMatch(/push:\s*\n\s*branches:\s*\[main, rewrite\]/);
    expect(ciWorkflow).toMatch(/run:\s*npm run typecheck/);
    expect(ciWorkflow).toMatch(/run:\s*npm test/);
  });

  it('FR-56 workflow never masks a failing step', () => {
    expect(ciWorkflow).not.toMatch(/continue-on-error/);
    expect(ciWorkflow).not.toMatch(/\|\|\s*(true|exit 0)/);
  });
});
