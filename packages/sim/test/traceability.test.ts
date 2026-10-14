import { describe, expect, it } from 'vitest';

const testSources = import.meta.glob('../../*/test/**/*.test.ts', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

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

/** FR-55, FR-56 and NFR-13 are traced by the tests in this file, which the scan skips. */
const TRACED_HERE = ['FR-55', 'FR-56', 'NFR-13'];

/**
 * Spec 002 ids that no test names yet. Each task removes the ids it covers; T10 deletes this list.
 * A test below fails if an id stays here after a test names it.
 */
const PENDING: string[] = [
  'FR-73', 'FR-74', 'FR-75', 'FR-76', 'FR-77', 'FR-78', 'FR-79', 'FR-80', 'FR-81',
  'NFR-7', 'NFR-9', 'NFR-10', 'NFR-11',
];

const expected = [
  ...Array.from({ length: 81 }, (_, i) => `FR-${i + 1}`),
  ...Array.from({ length: 13 }, (_, i) => `NFR-${i + 1}`),
].filter((id) => !RETIRED.includes(id));

describe('traceability', () => {
  it('the glob finds the test sources', () => {
    expect(Object.keys(testSources).length).toBeGreaterThanOrEqual(10);
  });

  it('title extraction matches whole ids only and reads it.each titles', () => {
    const found = tracedIds({
      'x/a.test.ts': "it('FR-10 a', () => {}); it.each([[1]])('FR-12 %s', () => {});",
    });
    expect([...found].sort()).toStrictEqual(['FR-10', 'FR-12']);
  });

  it('NFR-13 the expected list holds FR-81 and NFR-13 and excludes the retired ids', () => {
    expect(expected).toContain('FR-81');
    expect(expected).toContain('NFR-13');
    expect(expected).toContain('FR-60');
    expect(expected).toContain('NFR-6');
    for (const id of RETIRED) expect(expected).not.toContain(id);
  });

  it('NFR-13 extraction does not mistake FR-60 or NFR-6 for a retired id', () => {
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

  it('NFR-13 every expected requirement id appears in a test name, except the pending ones', () => {
    const found = tracedIds(testSources);
    for (const id of TRACED_HERE) found.add(id);
    const missing = expected.filter((id) => !found.has(id) && !PENDING.includes(id));
    expect(missing, `ids without a test name: ${missing.join(', ')}`).toStrictEqual([]);
  });

  it('NFR-13 pending ids are real expected ids and no test names them yet', () => {
    const found = tracedIds(testSources);
    expect(PENDING.filter((id) => !expected.includes(id))).toStrictEqual([]);
    expect(PENDING.filter((id) => found.has(id)), 'remove covered ids from PENDING').toStrictEqual([]);
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
