import { afterEach, describe, expect, it, vi } from 'vitest';
import { assignFactionColors } from '../src/core/colors';
import { renderReference } from '../src/core/borders';
import { frameStats } from '../src/core/perf';
import { pointerInfo, sceneAt } from '../src/core/scene';
import type { SimPort } from '../src/core/scene';
import { THEME } from '../src/core/theme';
import { getRounds, getState, ownerOf, totalRounds } from '@mbrg/sim';
import { buildEntryIndex } from '../src/core/entries';
import { DEV_MAP, DEV_PRESENTATION } from './helpers/dev-map';
import { gridFrom, ownersOf } from './helpers/grids';
import { codeOnly, stripComments } from './helpers/scan';

// NFR-25 (viewer logic purity). The forbidden lists are copied from the plan (section 10), not imported.
const all = import.meta.glob('../src/**/*.ts', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const sources = Object.entries(all).map(([path, src]) => [path.replace('../src/', ''), src] as const);
const core = sources.filter(([path]) => path.startsWith('core/'));

const FORBIDDEN_NAMES =
  /\b(window|document|navigator|performance|Date|crypto|fetch|requestAnimationFrame|cancelAnimationFrame|setTimeout|setInterval|queueMicrotask|globalThis|localStorage|sessionStorage|indexedDB|process|require|DecompressionStream|CompressionStream|XMLHttpRequest|WebSocket)\b/g;
const FORBIDDEN_RANDOM = /\bMath\s*\.\s*random\b/;
const FORBIDDEN_IMPORT = /\b(?:from|import)\s*\(?\s*['"](three(?:\/[^'"]*)?|node:[^'"]*)['"]/g;
const IMPORT_META = /\bimport\s*\.\s*meta\b/;

/** Violations of the NFR-25 rule in one `src/core` source (comments and strings do not count). */
function coreViolations(src: string): string[] {
  const found: string[] = [];
  const code = codeOnly(src);
  for (const m of code.matchAll(FORBIDDEN_NAMES)) found.push(`forbidden name ${m[1]}`);
  if (FORBIDDEN_RANDOM.test(code)) found.push('Math.random');
  if (IMPORT_META.test(code)) found.push('import.meta');
  // Import specifiers are strings, so they are read before the strings are stripped.
  for (const m of stripComments(src).matchAll(FORBIDDEN_IMPORT)) found.push(`forbidden import ${m[1]}`);
  return found;
}

/** Clock reads and system randomness anywhere in `src` except `ui/clock.ts`. */
function clockViolations(path: string, src: string): string[] {
  if (path === 'ui/clock.ts') return [];
  const code = codeOnly(src);
  const found: string[] = [];
  if (/\bperformance\b/.test(code)) found.push('performance');
  if (/\bDate\b/.test(code)) found.push('Date');
  if (FORBIDDEN_RANDOM.test(code)) found.push('Math.random');
  if (/\bcrypto\b/.test(code)) found.push('crypto');
  return found;
}

describe('NFR-25 the core sources are pure', () => {
  it('NFR-25 the scan sees the core sources (not vacuous)', () => {
    const names = core.map(([path]) => path);
    for (const wanted of ['core/camera.ts', 'core/address.ts', 'core/navigation.ts', 'core/colors.ts', 'core/borders.ts', 'core/scene.ts', 'core/perf.ts']) {
      expect(names).toContain(wanted);
    }
    expect(core.length).toBeGreaterThanOrEqual(14);
  });

  it('NFR-25 no source in src/core uses the DOM, three, the clock, randomness, the network or node modules', () => {
    for (const [path, src] of core) expect(coreViolations(src), path).toStrictEqual([]);
  });

  it('NFR-25 the scan flags each kind of planted violation', () => {
    const planted: string[] = [
      'const w = window.innerWidth;',
      'document.body.append(1);',
      'const t = performance.now();',
      'const t = Date.now();',
      'const d = new Date();',
      'const r = Math.random();',
      'const r = Math . random ();',
      'crypto.getRandomValues(a);',
      'const r = await fetch(u);',
      'requestAnimationFrame(f);',
      'setTimeout(f, 1);',
      'setInterval(f, 1);',
      'const n = navigator.userAgent;',
      "import { Scene } from 'three';",
      "import { x } from 'three/examples/jsm/y';",
      "import fs from 'node:fs';",
      "import { z } from 'node:zlib';",
      "const m = import.meta.glob('x');",
      'const s = new DecompressionStream("deflate");',
    ];
    for (const src of planted) expect(coreViolations(src), src).not.toStrictEqual([]);
  });

  it('NFR-25 the scan lets comments, strings and plain code through', () => {
    const fine = [
      '// uses window and Date.now() and Math.random() in a comment only',
      '/* performance.now() fetch( */ const a = 1;',
      "const s = 'Date.now() window fetch(';",
      'const label = `performance ${1}`;',
      "import type { Rgb } from '@mbrg/shared';",
      "import { x } from './threes';",
      'const updated = 1; const documented = 2;',
    ];
    for (const src of fine) expect(coreViolations(src), src).toStrictEqual([]);
  });
});

describe('NFR-25 clock reads only in ui/clock.ts', () => {
  it('NFR-25 no source in src reads the clock or system randomness, except ui/clock.ts', () => {
    expect(sources.length).toBeGreaterThanOrEqual(15);
    for (const [path, src] of sources) expect(clockViolations(path, src), path).toStrictEqual([]);
  });

  it('NFR-25 a planted clock read is flagged anywhere but in ui/clock.ts', () => {
    for (const path of ['core/camera.ts', 'render/renderer.ts', 'ui/main.ts', 'ui/panel.ts', 'ui/load.ts']) {
      expect(clockViolations(path, 'const t = performance.now();'), path).toStrictEqual(['performance']);
      expect(clockViolations(path, 'const t = Date.now();'), path).toStrictEqual(['Date']);
      expect(clockViolations(path, 'const t = new Date().getTime();'), path).toStrictEqual(['Date']);
    }
    expect(clockViolations('ui/clock.ts', 'const t = performance.now();')).toStrictEqual([]);
  });
});

describe('NFR-25 the pure functions run with the clock and randomness disabled', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function disableAmbientState(): void {
    const boom = (name: string) => () => {
      throw new Error(`${name} was called by a pure function`);
    };
    vi.spyOn(Math, 'random').mockImplementation(boom('Math.random'));
    vi.spyOn(Date, 'now').mockImplementation(boom('Date.now'));
    vi.spyOn(performance, 'now').mockImplementation(boom('performance.now'));
  }

  it('NFR-25 the clock really throws while disabled (the guard is armed)', () => {
    disableAmbientState();
    expect(() => Math.random()).toThrow();
    expect(() => Date.now()).toThrow();
    expect(() => performance.now()).toThrow();
  });

  it('NFR-25 sceneAt, assignFactionColors, renderReference, pointerInfo and frameStats do not touch the clock or randomness', () => {
    const sim: SimPort = { totalRounds, getState, getRounds, ownerOf };
    const expectedScene = sceneAt(DEV_MAP, DEV_PRESENTATION, 1, 2, sim);
    const expectedColors = assignFactionColors(DEV_MAP, DEV_PRESENTATION, THEME);
    const grid = gridFrom([[1, 1, 2, 2], [1, 1, 2, 2], [3, 3, 0, 0]], { 1: 'land', 2: 'land', 3: 'sea' });
    const owners = ownersOf({ 1: 1, 2: 2 }, 3);
    const colorList: [number, number, number][] = [[0, 0, 0], [200, 50, 50], [50, 200, 50]];
    const cam = { x: 2, y: 1.5, scale: 8 };
    const vp = { width: 32, height: 24 };
    const expectedPixels = renderReference(grid, owners, colorList, THEME, cam, vp, 1);

    disableAmbientState();
    const scene = sceneAt(DEV_MAP, DEV_PRESENTATION, 1, 2, sim);
    expect(scene).toStrictEqual(expectedScene);
    expect(assignFactionColors(DEV_MAP, DEV_PRESENTATION, THEME)).toStrictEqual(expectedColors);
    expect(renderReference(grid, owners, colorList, THEME, cam, vp, 1)).toStrictEqual(expectedPixels);
    expect(frameStats([3, 1, 2])).toStrictEqual({ count: 3, median: 2, p95: 3 });
    if (!scene.ok) throw new Error('scene');
    const index = buildEntryIndex(DEV_MAP, 1, 1, [DEV_MAP.territories[0]!.id]);
    expect(pointerInfo(index, scene.value, DEV_PRESENTATION, { x: 0.5, y: 0.5 }).fill).toBe('land');
  });
});
