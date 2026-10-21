import { afterEach, describe, expect, it, vi } from 'vitest';
import { CENTRE_PARAMS } from '../src/core/centre-params';
import { boxRowInterval, centreSums, endStep, factionHeightCap, regionBox, unitRowInterval } from '../src/core/label-centre';
import { handRegions } from './helpers/centred-grids';
import { codeOnly } from './helpers/scan';

// Number scan and purity of the spec 007 core files (NFR-44, FR-228; plan 007 sections 2 and 13). The 006 purity
// tests have fixed file lists and are not edited: this test has its own list, extended by each later task.
const all = import.meta.glob('../src/**/*.ts', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const sourceOf = (path: string): string => Object.entries(all).find(([p]) => p === `../src/${path}`)?.[1] ?? '';

/** The files of plan 007 section 2 marked [N] (and the parameter module) that exist so far. */
const CENTRED_FILES = ['core/centre-params.ts', 'core/label-centre.ts', 'core/label-centred.ts', 'core/label-shape.ts'];

const ALLOWED_MATH = new Set(['sqrt', 'abs', 'min', 'max', 'floor', 'ceil', 'PI']);

/** Violations of the number rules in the code of one source (comments and strings stripped): as the 006 scan. */
function numberViolations(src: string): string[] {
  const code = codeOnly(src);
  const found: string[] = [];
  // `**` and `**=` with anything but a BigInt literal exponent (digits followed by n).
  for (const m of code.matchAll(/\*\*=?(?!\s*\d+n\b)/g)) found.push(`power operator at ${m.index}`);
  for (const m of code.matchAll(/\bMath\s*\.\s*([A-Za-z0-9_]+)/g)) {
    if (!ALLOWED_MATH.has(m[1]!)) found.push(`Math.${m[1]!}`);
  }
  // Destructured or aliased Math members escape the dotted scan: refuse any other use of the name.
  for (const m of code.matchAll(/\bMath\b(?!\s*\.)/g)) found.push(`bare Math at ${m.index}`);
  return found;
}

/** Ambient state in the code of one source: DOM, clock, randomness, timers, other layers. */
function ambientViolations(src: string): string[] {
  const code = codeOnly(src);
  const found: string[] = [];
  for (const m of code.matchAll(/\b(document|window|navigator|performance|Date|requestAnimationFrame|setTimeout|setInterval|crypto|localStorage|fetch|console)\b/g)) found.push(m[1]!);
  for (const m of code.matchAll(/\bMath\s*\.\s*random\b/g)) found.push(m[0]);
  for (const m of src.matchAll(/from\s+'(\.\.\/(?:ui|render)[^']*)'/g)) found.push(`import ${m[1]!}`);
  return found;
}

describe('NFR-44 FR-228 the number scan of the centred core files', () => {
  it('NFR-44 FR-228 the scan sees every listed file that exists (not vacuous)', () => {
    for (const path of CENTRED_FILES) expect(sourceOf(path).length, path).toBeGreaterThan(0);
  });

  it('NFR-44 FR-228 a planted violation of each kind is flagged and a BigInt square is not', () => {
    for (const src of [
      'const d = x ** 2;',
      'const d = x**2;',
      'x **= 2;',
      'const d = x ** (1 / 2);',
      'const d = a ** 2n ** y;',
      'const d = Math.pow(x, 2);',
      'const d = Math.hypot(x, y);',
      'const d = Math.sin(x);',
      'const d = Math.atan2(y, x);',
      'const d = Math.round(x);',
      'const d = Math.trunc(x);',
      'const { sqrt } = Math;',
    ]) {
      expect(numberViolations(src).length, src).toBeGreaterThan(0);
    }
    for (const src of [
      'const d = a ** 2n;',
      'const d = (a - b) ** 2n + (c - e) ** 3n;',
      'const d = Math.sqrt(x) + Math.abs(y) + Math.min(a, b) + Math.max(a, b) + Math.floor(a) + Math.ceil(b) + Math.PI;',
    ]) {
      expect(numberViolations(src), src).toStrictEqual([]);
    }
    expect(numberViolations('// x ** 2\nconst s = "Math.sin(x)"; /* Math.pow */')).toStrictEqual([]);
  });

  it('NFR-44 FR-228 the centred files use none of the excluded operations on doubles', () => {
    for (const path of CENTRED_FILES) expect(numberViolations(sourceOf(path)), path).toStrictEqual([]);
  });
});

describe('NFR-44 the centred core files are pure', () => {
  it('NFR-44 a planted DOM, clock, randomness or layer import is flagged and clean code is not', () => {
    for (const src of [
      'const t = Date.now();',
      'const t = performance.now();',
      'const r = Math.random();',
      'const e = document.body;',
      'const w = window.innerWidth;',
      'requestAnimationFrame(f);',
      'setTimeout(f, 1);',
      "import { x } from '../ui/main';",
      "import { x } from '../render/labels-layer';",
      'console.log(1);',
    ]) {
      expect(ambientViolations(src).length, src).toBeGreaterThan(0);
    }
    expect(ambientViolations("import { x } from './regions';\nconst d = 3n * 4n; // Date.now() performance.now()")).toStrictEqual([]);
  });

  it('NFR-44 the centred files read no ambient state', () => {
    for (const path of CENTRED_FILES) expect(ambientViolations(sourceOf(path)), path).toStrictEqual([]);
  });

  describe('results do not depend on the clock or on randomness', () => {
    afterEach(() => vi.restoreAllMocks());

    it('NFR-44 FR-228 the exact centre functions give equal results while Math.random, Date.now and performance.now throw', () => {
      const run = (): unknown => {
        const out: unknown[] = [];
        for (const r of handRegions()) {
          const s = centreSums(r.p, r.pieces);
          const b = regionBox(r.p, r.pieces);
          const k = endStep(s, CENTRE_PARAMS, b);
          out.push(s, b, k, factionHeightCap(s.n, r.aspect, CENTRE_PARAMS.factionAreaShare));
          for (let cy = b.ymin - 2; cy <= b.ymax + 2; cy++) out.push(unitRowInterval(s, CENTRE_PARAMS, 1, cy), unitRowInterval(s, CENTRE_PARAMS, k, cy), boxRowInterval(s, CENTRE_PARAMS, 2, cy, 5, 5 * r.aspect));
        }
        return out;
      };
      const plain = run();
      const boom = (): never => {
        throw new Error('ambient state read');
      };
      vi.spyOn(Math, 'random').mockImplementation(boom);
      vi.spyOn(Date, 'now').mockImplementation(boom);
      vi.spyOn(performance, 'now').mockImplementation(boom);
      expect(run()).toStrictEqual(plain);
    });
  });
});
