import { describe, expect, it } from 'vitest';
import { codeOnly, stripComments } from './helpers/scan';

// Source scans that keep the live viewer and the debug scene apart (spec 008 D30; plan 21.13). They read the viewer sources
// through Vite `?raw` imports, like the other viewer scans.
const all = import.meta.glob('../src/**/*.ts', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const sources = Object.entries(all).map(([path, src]) => [path.replace('../src/', ''), src] as const);

const LIVE_FILE = /^(?:core|ui)\/live-[a-z-]+\.ts$|^ui\/web-crypto\.ts$/;
/** The pages around the live core: the development test client and the entry that chooses the scene. `entry.ts` alone may name the debug shell. */
const PAGE_FILE = /^ui\/(?:client-main|entry|enter|message)\.ts$|^core\/client-form\.ts$/;
/** Modules of the debug scene, and the two shared ones both scenes use: none of them may import a live module. */
const DEBUG_SIDE = ['ui/main.ts', 'ui/load.ts', 'core/scene.ts', 'core/step.ts', 'core/playback.ts'];

const SPECIFIER = /\b(?:import|export)\b[^;'"`]*?\bfrom\s*(['"])([^'"]+)\1|\bimport\s*\(\s*(['"])([^'"]+)\3\s*\)|\bimport\s*(['"])([^'"]+)\5/g;
const specifiers = (src: string): string[] => [...stripComments(src).matchAll(SPECIFIER)].map((m) => (m[2] ?? m[4] ?? m[6]) as string);
const last = (specifier: string): string => specifier.split('/').pop() as string;

/** Imports of the sim, the scene module or the debug shell from one live module. */
export function liveImportViolations(src: string): string[] {
  const found: string[] = [];
  for (const s of specifiers(src)) {
    if (/^@mbrg\/sim(\/|$)/.test(s)) found.push(`sim import ${s}`);
    if (s.startsWith('.') && ['scene', 'main', 'load'].includes(last(s).replace(/\.ts$/, ''))) found.push(`debug module import ${s}`);
  }
  return found;
}

/** Imports of a live module from one debug-side module. */
export function debugImportViolations(src: string): string[] {
  return specifiers(src).filter((s) => s.startsWith('.')).filter((s) => /^(live-|web-crypto$)/.test(last(s).replace(/\.ts$/, ''))).map((s) => `live import ${s}`);
}

/** An identifier holding `seed` (any case) in the code of one source; strings and comments do not count. */
export function seedIdentifiers(src: string): string[] {
  return [...codeOnly(src).matchAll(/[A-Za-z_$][\w$]*/g)].map((m) => m[0]).filter((word) => /seed/i.test(word));
}

const files = (re: RegExp): string[] => sources.filter(([, src]) => re.test(codeOnly(src))).map(([path]) => path).sort();
const live = sources.filter(([path]) => LIVE_FILE.test(path));
const pages = sources.filter(([path]) => PAGE_FILE.test(path));

describe('FR-161 (live modules) the live viewer and the debug scene stay apart', () => {
  it('NFR-55 (viewer scans) the scan sees the live modules (not vacuous)', () => {
    const names = live.map(([path]) => path);
    for (const wanted of ['core/live-model.ts', 'core/live-rounds.ts', 'core/live-address.ts', 'core/live-retry.ts', 'core/live-sse.ts', 'core/live-text.ts', 'ui/live-net.ts', 'ui/web-crypto.ts']) {
      expect(names, wanted).toContain(wanted);
    }
    expect(pages.map(([path]) => path).sort()).toStrictEqual(['core/client-form.ts', 'ui/client-main.ts', 'ui/enter.ts', 'ui/entry.ts', 'ui/message.ts']);
    for (const wanted of DEBUG_SIDE) expect(sources.map(([path]) => path), wanted).toContain(wanted);
  });

  it('FR-161 (live modules) no live module imports the sim, the scene module, the debug shell or the debug loader', () => {
    for (const [path, src] of live) expect(liveImportViolations(src), path).toStrictEqual([]);
  });

  it('FR-161 (live modules) no page of the live viewer or of the test client imports the sim, and none but the entry names the debug scene', () => {
    for (const [path, src] of pages) {
      const found = liveImportViolations(src);
      expect(path === 'ui/entry.ts' ? found.filter((v) => v.startsWith('sim import')) : found, path).toStrictEqual([]);
      expect(seedIdentifiers(src), path).toStrictEqual([]);
    }
  });

  it('FR-161 (live modules) no debug-side module imports a live module', () => {
    for (const [path, src] of sources) {
      if (DEBUG_SIDE.includes(path)) expect(debugImportViolations(src), path).toStrictEqual([]);
    }
  });

  it('FR-161 (live modules) no live module has a seed identifier (a string such as the debug address name is not an identifier)', () => {
    for (const [path, src] of live) expect(seedIdentifiers(src), path).toStrictEqual([]);
  });

  it('NFR-55 (viewer scans) fetch( is called in ui/load.ts and ui/live-net.ts only, and the platform crypto is named in ui/web-crypto.ts only', () => {
    expect(files(/\bfetch\s*\(/)).toStrictEqual(['ui/live-net.ts', 'ui/load.ts']);
    expect(files(/\bcrypto\b/)).toStrictEqual(['ui/web-crypto.ts']);
  });

  it('FR-161 (live modules) the live scene hands the transport a bound fetch (a bare reference throws Illegal invocation in a browser)', () => {
    const main = sources.find(([path]) => path === 'ui/live-main.ts');
    expect(main).toBeDefined();
    const code = codeOnly(main![1]);
    expect(code).toMatch(/\bfetch\s*:\s*fetch\.bind\(globalThis\)/);
    expect(code).not.toMatch(/\bfetch\s*\(/);
    // A bare reference (`fetch: fetch`) is what this scan would not accept.
    expect(/\bfetch\s*:\s*fetch\.bind\(globalThis\)/.test(codeOnly('createLiveNet({ base, fetch: fetch, x })'))).toBe(false);
  });

  it('FR-303 (shell) the runner and the live model touch no DOM, history or location: the scene is reached only through its port', () => {
    for (const path of ['ui/live-runner.ts', 'core/live-model.ts', 'core/live-view.ts', 'ui/live-timer.ts']) {
      const source = sources.find(([p]) => p === path);
      expect(source, path).toBeDefined();
      expect(codeOnly(source![1]).match(/\b(?:document|window|history|location|localStorage|navigator)\b/g) ?? [], path).toStrictEqual([]);
    }
  });

  it('NFR-55 (viewer scans) each scan flags a planted violation and lets plain code through', () => {
    expect(liveImportViolations("import { getState } from '@mbrg/sim';")).toStrictEqual(['sim import @mbrg/sim']);
    expect(liveImportViolations("import type { MatchState } from '@mbrg/sim/types';")).toHaveLength(1);
    expect(liveImportViolations("export { x } from '@mbrg/sim';")).toHaveLength(1);
    expect(liveImportViolations("const m = await import('@mbrg/sim');")).toHaveLength(1);
    expect(liveImportViolations("import { sceneAt } from '../core/scene';")).toHaveLength(1);
    expect(liveImportViolations("import './main';")).toHaveLength(1);
    expect(liveImportViolations("import { loadPackage } from './load';")).toHaveLength(1);
    expect(liveImportViolations("import { reduce } from './live-model'; import type { Scene } from 'three'; import { x } from '@mbrg/protocol';")).toStrictEqual([]);
    expect(debugImportViolations("import { reduce } from '../core/live-model';")).toHaveLength(1);
    expect(debugImportViolations("import { sha256Hex } from './web-crypto';")).toHaveLength(1);
    expect(debugImportViolations("import { sceneAt } from '../core/scene'; import { x } from './panel';")).toStrictEqual([]);
    expect(seedIdentifiers('const seed = 1;')).toStrictEqual(['seed']);
    expect(seedIdentifiers('function f(roundSeed: number, Seeded: 1) {}')).toStrictEqual(['roundSeed', 'Seeded']);
    expect(seedIdentifiers("params.has('seed'); // seed in a comment\nconst note = 'seed';")).toStrictEqual([]);
  });
});

describe('FR-316 (shell) the live scene routes the tours and the user through the map view', () => {
  const main = codeOnly(sources.find(([path]) => path === 'ui/live-main.ts')?.[1] ?? '');
  const panel = codeOnly(sources.find(([path]) => path === 'ui/live-panel.ts')?.[1] ?? '');

  it('FR-316 (shell) the scan sees the live scene and its panel (not vacuous)', () => {
    expect(main).toContain('startLiveScene');
    expect(panel).toContain('createLivePanel');
  });

  it('FR-316 (shell) both tours start at the reading of the feed that produced them (D11), never at a later reading', () => {
    expect(main).toMatch(/view\.beginTour\(\[request\], at\)/);
    expect(main).toMatch(/view\.beginTour\(\[request\], at, \{ target: to, owners: data\.later, data \}\)/);
  });

  it('FR-345 (shell) a step with no tour and an instant draw complete a running tour before they ask the view for a round', () => {
    expect(main).toMatch(/view\.completeTour\(started\);\s*const outcome = view\.request\(round, started\);/);
    expect(main).toMatch(/view\.completeTour\(started\);\s*const outcome = view\.request\(to, started\);/);
  });

  it('FR-330 (shell) the tour report feeds the panel: the result hook refreshes it at once and the skip control follows the run', () => {
    expect(main).toMatch(/onTour: \(status\) => \{[\s\S]*?showSkip\(!status\.runEnded\)[\s\S]*?runner\?\.refreshPanel\(\)/);
    expect(main).toMatch(/liveTourPanel\(model, tour, import\.meta\.env\.DEV\)/);
  });

  it('FR-341 (live) the skip button and the Escape key both complete the running tour', () => {
    expect(main).toMatch(/onSkip: \(\) => view\?\.completeTour\(now\(\)\)/);
    expect(main).toMatch(/onSkip: \(\) => created\.completeTour\(now\(\)\)/);
    expect(panel).toMatch(/skipLabel\(\), handlers\.onSkip\)/);
  });

  it('FR-333 (shell) the camera is written to the address once, at the end of a run (A7); the user camera takes the tour camera', () => {
    expect(main).toMatch(/if \(status\.runEnded\) syncAddress\(lastRound, created\.camera\(\)\)/);
    expect(main.match(/syncAddress\(/g)?.length).toBeGreaterThan(0);
    expect(main).not.toMatch(/\.setCamera\(/);
    expect(main.match(/userCamera\(/g)).toHaveLength(2);
  });
});
