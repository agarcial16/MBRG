import { beforeAll, describe, expect, it } from 'vitest';
import { getRounds, getState, ownerOf, totalRounds } from '@mbrg/sim';
import { buildEntryIndex, factionIndexOf, ownerTable } from '../src/core/entries';
import type { EntryIndex } from '../src/core/entries';
import { digestNumbers } from '../src/core/label-digest';
import { factionBoxes, territoryBoxes } from '../src/core/label-layout';
import type { LabelBox } from '../src/core/label-layout';
import { LABEL_PARAMS } from '../src/core/label-params';
import { decodeIdPng } from '../src/core/png';
import { buildPieceIndex } from '../src/core/regions';
import type { PieceIndex } from '../src/core/regions';
import { sceneAt } from '../src/core/scene';
import type { SimPort } from '../src/core/scene';
import { inflateStream } from '../src/ui/load';
import { DEV_MAP, DEV_PRESENTATION, devPngBytes } from './helpers/dev-map';
import { codeOnly } from './helpers/scan';

// Number scan (NFR-39) and the 005 box digest (NFR-41). Forbidden operations are copied from the spec
// ("Number reference"), not imported.
const all = import.meta.glob('../src/**/*.ts', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const sourceOf = (path: string): string => Object.entries(all).find(([p]) => p === `../src/${path}`)?.[1] ?? '';

/** The files of plan section 2 marked [N] that exist so far, plus the 005 files the spec puts under NFR-39. */
const NUMBER_FILES = [
  'core/shape-params.ts',
  'core/label-axis.ts',
  'core/label-shape.ts',
  'core/label-digest.ts',
  'core/label-offland.ts',
  'core/label-place.ts',
  'core/label-frame.ts',
  'core/label-input.ts',
  'core/label-counts.ts',
  'core/label-layout.ts',
  'core/regions.ts',
];

const ALLOWED_MATH = new Set(['sqrt', 'abs', 'min', 'max', 'floor', 'ceil', 'PI']);

/** Violations of the NFR-39 operation list in the code of one source (comments and strings stripped). */
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

describe('NFR-39 the number scan', () => {
  it('NFR-39 the scan sees every listed file that exists (not vacuous)', () => {
    for (const path of NUMBER_FILES) expect(sourceOf(path).length, path).toBeGreaterThan(0);
  });

  it('NFR-39 a planted violation of each kind is flagged and a BigInt square is not', () => {
    for (const src of [
      'const d = x ** 2;',
      'const d = x**2;',
      'x **= 2;',
      'const d = x ** (1 / 2);',
      'const d = Math.pow(x, 2);',
      'const d = Math.hypot(x, y);',
      'const d = Math.sin(x);',
      'const d = Math.cos(x);',
      'const d = Math.atan2(y, x);',
      'const d = Math.exp(x);',
      'const d = Math.log(x);',
      'const d = Math.round(x);',
      'const { sin } = Math;',
    ]) {
      expect(numberViolations(src).length, src).toBeGreaterThan(0);
    }
    for (const src of ['const d = a ** 2n;', 'const d = (a - b) ** 2n + (c - e) ** 2n;', 'const d = Math.sqrt(x) + Math.abs(y) + Math.min(a, b) + Math.max(a, b) + Math.floor(a) + Math.ceil(b) + Math.PI;']) {
      expect(numberViolations(src), src).toStrictEqual([]);
    }
    // comments and strings are not code
    expect(numberViolations('// x ** 2\nconst s = "Math.sin(x)"; /* Math.pow */')).toStrictEqual([]);
  });

  it('NFR-39 the number files use none of the excluded operations on doubles', () => {
    for (const path of NUMBER_FILES) expect(numberViolations(sourceOf(path)), path).toStrictEqual([]);
  });
});

describe('NFR-39 NFR-41 the digest of the 005 boxes', () => {
  it('NFR-39 digestNumbers is FNV-1a 64 over big-endian float64 bits', () => {
    expect(digestNumbers([])).toBe('cbf29ce484222325');
    const reference = (values: number[]): string => {
      const view = new DataView(new ArrayBuffer(8));
      let h = 0xcbf29ce484222325n;
      for (const v of values) {
        view.setFloat64(0, v);
        for (let i = 0; i < 8; i++) h = ((h ^ BigInt(view.getUint8(i))) * 0x100000001b3n) % (1n << 64n);
      }
      return h.toString(16).padStart(16, '0');
    };
    for (const values of [[0], [-0], [1], [1.5, -2, 3], [Number.MAX_SAFE_INTEGER, 0.1, 1e-300]]) {
      expect(digestNumbers(values), String(values)).toBe(reference(values));
    }
    expect(digestNumbers([0])).not.toBe(digestNumbers([-0]));
    expect(digestNumbers([1, 2])).not.toBe(digestNumbers([2, 1]));
    // an iterable that is not an array
    expect(digestNumbers(new Set([1, 2]))).toBe(digestNumbers([1, 2]));
  });

  let index: EntryIndex;
  let p: PieceIndex;
  const REAL: SimPort = { totalRounds, getState, getRounds, ownerOf };
  const factionIndex = factionIndexOf(DEV_MAP);
  const factionAspects = new Map<number, number>([...factionIndex.values()].map((f) => [f, 4]));
  const territoryAspects: number[] = [];

  beforeAll(async () => {
    const decoded = await decodeIdPng(devPngBytes(), inflateStream);
    if (!decoded.ok) throw new Error('png');
    index = buildEntryIndex(DEV_MAP, decoded.value.width, decoded.value.height, decoded.value.values);
    p = buildPieceIndex(index);
    for (let e = 0; e < index.fills.length; e++) territoryAspects.push(index.fills[e] === 'land' ? 3 : 0);
  });

  /** A box as numbers; an absent box as -1 (heights are positive, so no box can look like it). */
  const boxNumbers = (box: LabelBox | undefined): number[] => (box === undefined ? [-1] : [box.x0, box.y0, box.h, box.w]);

  it('NFR-41 the digest of every 005 box (territories, factions of seed 1 rounds 0..4, aspects 3 / 4) is pinned', () => {
    const numbers: number[] = [];
    for (const box of territoryBoxes(p, territoryAspects, LABEL_PARAMS)) numbers.push(...boxNumbers(box));
    for (let round = 0; round <= 4; round++) {
      const scene = sceneAt(DEV_MAP, DEV_PRESENTATION, 1, round, REAL);
      if (!scene.ok) throw new Error('scene');
      const boxes = factionBoxes(p, ownerTable(index, scene.value.owners, factionIndex), factionAspects, LABEL_PARAMS);
      for (const [faction, label] of boxes.labels) numbers.push(faction, ...boxNumbers(label.box));
    }
    const digest = digestNumbers(numbers);
    console.log(`shaped-purity: 005 box digest ${digest} over ${numbers.length} numbers`);
    expect(digest).toBe('5f8e31fd50523b09');
  });
});
