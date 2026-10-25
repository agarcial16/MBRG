import { describe, expect, it } from 'vitest';
import { codeOnly, stripComments } from './helpers/scan';

// The shared drawing shell (spec 008 H5, extracted from the debug scene): it takes owner tables and step data, never a
// seed, a round count or the sim; it reads no clock and has none of the banned words of FR-155.
const all = import.meta.glob('../src/ui/map-view.ts', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const mapView = Object.values(all)[0] as string | undefined;

const specifiers = (src: string): string[] => [...stripComments(src).matchAll(/\b(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g)].map((m) => m[1]!);

/** Violations of the map-view rules in one source. */
export function mapViewViolations(src: string): string[] {
  const found: string[] = [];
  for (const s of specifiers(src)) {
    if (/^@mbrg\/sim(\/|$)/.test(s)) found.push(`imports the sim: ${s}`);
    if (/(^|\/)(scene|main|load|clock|panel|url)$/.test(s)) found.push(`imports a scene-side or clock module: ${s}`);
    if (/(^|\/)live-[a-z-]+$/.test(s) || /(^|\/)web-crypto$/.test(s)) found.push(`imports a live module: ${s}`);
  }
  const code = codeOnly(src);
  for (const m of code.matchAll(/\b\w*seed\w*\b/gi)) found.push(`identifier ${m[0]}`);
  for (const m of code.matchAll(/\b(?:total|totalRounds|roundCount|rounds)\b/g)) found.push(`round count ${m[0]}`);
  const banned = /\b(setTimeout|setInterval|transition|transitions|animate|animation|animations|tween|tweens|keyframes|requestIdleCallback|requestAnimationFrame|cancelAnimationFrame|performance|Date|crypto|fetch|EventSource)\b/.exec(code);
  if (banned) found.push(`banned word ${banned[1]}`);
  return found;
}

describe('FR-156 (map view) the shared drawing shell knows no seed, round count, sim or clock', () => {
  it('FR-156 (map view) the scan sees src/ui/map-view.ts (not vacuous)', () => {
    expect(mapView).toBeDefined();
    expect(mapView!).toContain('createMapView');
  });

  it('FR-156 (map view) map-view.ts has no violation', () => {
    expect(mapViewViolations(mapView!)).toStrictEqual([]);
  });

  it('FR-176 (map view) a changed round is laid out with the layout of the displayed round, and the first round without one (label continuity)', () => {
    const code = codeOnly(mapView!);
    expect(code).toMatch(/prepare:[^;]*const round = viewOf\(ownerTable\(index, ownersAt, owners\), current\);/);
    expect(code).toMatch(/current = viewOf\(ownerTable\(index, start\.owners, owners\)\);/);
    expect(code).toMatch(/stepOf\(current, round, data\) : stepOf\(round, current, data\)/);
  });

  it('FR-176 (map view) the scan flags a planted sim import, seed, round count, clock and timer', () => {
    const planted: [string, RegExp][] = [
      ["import { getState } from '@mbrg/sim';", /imports the sim/],
      ["import { sceneAt } from '../core/scene';", /scene-side/],
      ["import { now } from './clock';", /scene-side or clock/],
      ["import { x } from './live-model';", /live module/],
      ['const seed = 1;', /identifier seed/],
      ['const total = 4;', /round count total/],
      ['setTimeout(f, 1);', /banned word setTimeout/],
      ['requestAnimationFrame(f);', /banned word requestAnimationFrame/],
      ['const t = performance.now();', /banned word performance/],
    ];
    for (const [src, expected] of planted) {
      expect(mapViewViolations(src).join('|'), src).toMatch(expected);
    }
    expect(mapViewViolations("// seed total setTimeout\nconst a = 'seed';")).toStrictEqual([]);
  });
});
