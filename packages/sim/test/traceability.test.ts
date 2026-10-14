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

const expected = [
  ...Array.from({ length: 54 }, (_, i) => `FR-${i + 1}`),
  ...Array.from({ length: 6 }, (_, i) => `NFR-${i + 1}`),
];

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

  it('every FR-1..FR-54 and NFR-1..NFR-6 appears in a test name', () => {
    const found = tracedIds(testSources);
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
