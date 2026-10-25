import { afterEach, describe, expect, it, vi } from 'vitest';
import { getRounds, getState, ownerOf, totalRounds } from '@mbrg/sim';
import { frontField } from '../src/core/front';
import { instantLabels, labelsAt } from '../src/core/label-frame';
import { fitLabel } from '../src/core/label-layout';
import { LABEL_PARAMS } from '../src/core/label-params';
import { forwardOf, progressAt } from '../src/core/progress';
import { frame, request, startPlayback } from '../src/core/playback';
import { buildPieceIndex } from '../src/core/regions';
import type { SimPort } from '../src/core/scene';
import { sceneAt } from '../src/core/scene';
import { stepScenes } from '../src/core/step';
import { THEME } from '../src/core/theme';
import { shadeTransition } from '../src/core/transition-shade';
import { DEV_MAP, DEV_PRESENTATION } from './helpers/dev-map';
import { gridOf } from './helpers/grids';
import { codeOnly, stripComments } from './helpers/scan';

// NFR-33 and NFR-37 for the label and transition sources (spec 005). Forbidden lists are copied from the
// plan, not imported; the 004 NFR-25 scan (purity.test.ts) already covers every file of src/core.
const all = import.meta.glob('../src/**/*.ts', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const sources = Object.entries(all).map(([path, src]) => [path.replace('../src/', ''), src] as const);
const sourceOf = (path: string): string => sources.find(([p]) => p === path)?.[1] ?? '';

const NEW_CORE = [
  'core/regions.ts',
  'core/label-params.ts',
  'core/label-layout.ts',
  'core/label-input.ts',
  'core/label-frame.ts',
  'core/front.ts',
  'core/transition-shade.ts',
  'core/progress.ts',
  'core/playback.ts',
  'core/step.ts',
];

const FORBIDDEN_NAMES =
  /\b(window|document|navigator|performance|Date|crypto|fetch|requestAnimationFrame|cancelAnimationFrame|setTimeout|setInterval|queueMicrotask|globalThis|localStorage|sessionStorage|indexedDB|process|require|matchMedia)\b/;

/** Importers of the clock module (`./clock` or `../ui/clock`). */
function importsClock(src: string): boolean {
  return /\bfrom\s*['"][^'"]*\/clock['"]/.test(stripComments(src));
}

/** Calls of fillText or strokeText whose first argument is a string literal. */
function textLiterals(src: string): string[] {
  const found: string[] = [];
  for (const m of stripComments(src).matchAll(/\b(fillText|strokeText)\s*\(\s*(['"`])/g)) found.push(m[1]!);
  return found;
}

describe('NFR-33 the label and transition core sources are pure', () => {
  it('NFR-33 the scan sees every new core file (not vacuous)', () => {
    for (const path of NEW_CORE) expect(sourceOf(path).length, path).toBeGreaterThan(0);
  });

  it('FR-174 NFR-33 no source chooses an ink by contrast: no contrast module and no contrast, luminance or labelInk identifier', () => {
    expect(sources.map(([p]) => p).filter((p) => /contrast/.test(p))).toStrictEqual([]);
    const hits = sources.filter(([, src]) => /(?:contrastw*|w*[Ll]uminancew*|labelInk)/.test(stripComments(src))).map(([p]) => p);
    expect(hits).toStrictEqual([]);
  });

  it('NFR-33 none of them names the DOM, the clock, a timer, the animation frame, randomness or a media query', () => {
    for (const path of NEW_CORE) {
      const code = codeOnly(sourceOf(path));
      expect(FORBIDDEN_NAMES.exec(code)?.[0], path).toBeUndefined();
      expect(/\bMath\s*\.\s*random\b/.test(code), path).toBe(false);
    }
  });

  it('NFR-33 a planted clock read is flagged by the scan', () => {
    for (const src of ['const t = performance.now();', 'const t = Date.now();', 'requestAnimationFrame(f);', 'window.matchMedia(q);']) {
      expect(FORBIDDEN_NAMES.test(codeOnly(src)), src).toBe(true);
    }
  });
});

describe('NFR-33 the clock is read only by the part that drives the animation', () => {
  it('NFR-33 (live clock) only ui/main.ts, ui/frame-loop.ts, ui/live-main.ts and ui/client-main.ts import the clock module (the live runner gets its clock injected)', () => {
    const importers = sources.filter(([, src]) => importsClock(src)).map(([path]) => path).sort();
    expect(importers).toStrictEqual(['ui/client-main.ts', 'ui/frame-loop.ts', 'ui/live-main.ts', 'ui/main.ts']);
  });

  it('NFR-33 a planted import of the clock is recognised', () => {
    expect(importsClock("import { now } from './clock';")).toBe(true);
    expect(importsClock("import { now } from '../ui/clock';")).toBe(true);
    expect(importsClock("// import { now } from './clock';")).toBe(false);
    expect(importsClock("import { clock } from './clocks';")).toBe(false);
  });

  it('NFR-33 only ui/frame-loop.ts uses the animation frame API', () => {
    const users = sources
      .filter(([, src]) => /\b(requestAnimationFrame|cancelAnimationFrame)\b/.test(codeOnly(src)))
      .map(([path]) => path);
    expect(users).toStrictEqual(['ui/frame-loop.ts']);
  });
});

describe('NFR-37 the label layer draws only the texts it is given', () => {
  it('NFR-37 no fillText or strokeText call receives a string literal', () => {
    expect(sourceOf('render/labels-layer.ts')).toContain('fillText');
    for (const [path, src] of sources) expect(textLiterals(src), path).toStrictEqual([]);
  });

  it('NFR-37 the scan flags a planted literal in each text call', () => {
    for (const src of ["ctx.fillText('Hola', 0, 0);", 'ctx.strokeText("Hola", 0, 0);', 'ctx.fillText(`Hola`, 0, 0);']) {
      expect(textLiterals(src), src).not.toStrictEqual([]);
    }
    expect(textLiterals('ctx.fillText(label.text, 0, 0); ctx.strokeText(text, 0, 0);')).toStrictEqual([]);
  });
});

describe('NFR-33 the layout, front, frame, progress and playback run with the clock and randomness disabled', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const sim: SimPort = { totalRounds, getState, getRounds, ownerOf };
  const grid = gridOf(16, 12, (x) => (x < 8 ? 1 : 2), { 1: 'land', 2: 'land' });

  function work(): unknown {
    const p = buildPieceIndex(grid);
    const box = fitLabel(p, [0], 1.5, { margin: 1, maxHeight: 5 });
    if (box === undefined) throw new Error('no box');
    const field = frontField(p, new Set([2]), [0, 1, 2], 1);
    const labels = labelsAt(
      {
        earlier: { factions: [{ faction: 1, text: 'A', box, aspect: 1.5 }], territories: [] },
        later: { factions: [{ faction: 1, text: 'A', box, aspect: 1.5 }], territories: [] },
        eliminated: 2,
        absorber: 1,
        transferred: new Set([2]),
      },
      0.4,
    );
    const play = request(startPlayback(2), 3, 100, false);
    const drawn = frame(play.state, 700, LABEL_PARAMS.durationMs);
    const prog = progressAt(300, LABEL_PARAMS.durationMs);
    const shade = shadeTransition(
      grid,
      [0, 1, 2],
      [0, 1, 1],
      [[0, 0, 0], [200, 30, 30], [30, 200, 30]],
      THEME,
      field,
      0.5,
      { x: 8, y: 6, scale: 4 },
      { width: 64, height: 48 },
      32,
      24,
    );
    const stepped = stepScenes(
      DEV_MAP,
      DEV_PRESENTATION,
      1,
      (() => {
        const s = sceneAt(DEV_MAP, DEV_PRESENTATION, 1, 1, sim);
        if (!s.ok) throw new Error('scene');
        return s.value;
      })(),
      2,
      sim,
    );
    return { box, field, labels, play, drawn, prog, shade, stepped, fwd: forwardOf(prog.p, 'backward'), i: instantLabels({ factions: [], territories: [] }) };
  }

  it('NFR-33 the same results come back while Math.random, Date.now and performance.now throw', () => {
    const expected = work();
    const boom = (name: string) => () => {
      throw new Error(`${name} was called by a pure function`);
    };
    vi.spyOn(Math, 'random').mockImplementation(boom('Math.random'));
    vi.spyOn(Date, 'now').mockImplementation(boom('Date.now'));
    vi.spyOn(performance, 'now').mockImplementation(boom('performance.now'));
    expect(() => performance.now()).toThrow();
    expect(work()).toStrictEqual(expected);
  });
});
