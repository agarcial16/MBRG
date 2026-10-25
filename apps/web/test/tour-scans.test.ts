import { describe, expect, it } from 'vitest';
import { codeOnly, stripComments } from './helpers/scan';

// NFR-60 (purity of the tour modules): every `src/core/tour.ts` and `src/core/tour-*.ts` is pure and uses none of the
// words the 004/005 scans ban. The lists are copied from the plan (tasks.md naming rule, plan section 13).
const modules = import.meta.glob(['../src/core/tour.ts', '../src/core/tour-*.ts'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const sources = Object.entries(modules).map(([path, src]) => [path.replace('../src/core/', ''), src] as const);

const FORBIDDEN_NAMES =
  /\b(window|document|navigator|performance|Date|crypto|fetch|requestAnimationFrame|cancelAnimationFrame|setTimeout|setInterval|clearTimeout|clearInterval|queueMicrotask|globalThis|localStorage|sessionStorage|indexedDB|process|require|WebSocket|XMLHttpRequest|HTMLElement|Image|OffscreenCanvas)\b/g;
const FORBIDDEN_IMPORT = /\b(?:from|import)\s*\(?\s*['"](three(?:\/[^'"]*)?|node:[^'"]*|@mbrg\/sim(?:\/[^'"]*)?|@mbrg\/protocol(?:\/[^'"]*)?)['"]/g;
const RECORD_TYPES = /\b(RoundRecord|RecordReply|StateReply|MatchState|PublicMatch|PublicVictim|RoundAppliedEvent|VictimRevealedEvent)\b/g;
const BANNED_WORDS = /\b(animate[ds]?|animating|animations?|tween(?:s|ed|ing)?|keyframes?|transitions?)\b/gi;
const SEED_IDENTIFIER = /\b\w*seed\w*\b/gi;

/** Violations of the NFR-60 rule in one tour source (comments and strings do not count, except import specifiers). */
function tourViolations(src: string): string[] {
  const found: string[] = [];
  const code = codeOnly(src);
  for (const m of code.matchAll(FORBIDDEN_NAMES)) found.push(`forbidden name ${m[1]}`);
  if (/\bMath\s*\.\s*random\b/.test(code)) found.push('Math.random');
  if (/\bimport\s*\.\s*meta\b/.test(code)) found.push('import.meta');
  for (const m of code.matchAll(RECORD_TYPES)) found.push(`record type ${m[1]}`);
  for (const m of code.matchAll(BANNED_WORDS)) found.push(`banned word ${m[1]}`);
  for (const m of code.matchAll(SEED_IDENTIFIER)) found.push(`seed identifier ${m[0]}`);
  // Import specifiers are strings: read before they are stripped.
  for (const m of stripComments(src).matchAll(FORBIDDEN_IMPORT)) found.push(`forbidden import ${m[1]}`);
  return found;
}

describe('tour module purity scan', () => {
  it('NFR-60 the scan covers every tour module of the core', () => {
    const names = sources.map(([path]) => path).sort();
    for (const expected of ['tour-camera.ts', 'tour-digest.ts', 'tour-frame.ts', 'tour-key.ts', 'tour-params.ts', 'tour-plan.ts', 'tour-playback.ts', 'tour.ts']) {
      expect(names, expected).toContain(expected);
    }
    expect(names.every((n) => n === 'tour.ts' || n.startsWith('tour-'))).toBe(true);
  });

  it('NFR-60 no tour module uses the DOM, three, a clock, a timer, Math.random, the sim, the protocol records, a banned word or a seed identifier', () => {
    for (const [path, src] of sources) expect(tourViolations(src), path).toStrictEqual([]);
  });

  it('NFR-60 planted violations are flagged', () => {
    const planted: Array<[string, string]> = [
      ['const t = Date.now();', 'forbidden name Date'],
      ['const t = performance.now();', 'forbidden name performance'],
      ['document.title = x;', 'forbidden name document'],
      ['const w = window.innerWidth;', 'forbidden name window'],
      ['setTimeout(f, 10);', 'forbidden name setTimeout'],
      ['requestAnimationFrame(f);', 'forbidden name requestAnimationFrame'],
      ['const r = Math.random();', 'Math.random'],
      ["import * as THREE from 'three';", 'forbidden import three'],
      ["import { getState } from '@mbrg/sim';", 'forbidden import @mbrg/sim'],
      ["import type { RecordReply } from '@mbrg/protocol';", 'forbidden import @mbrg/protocol'],
      ["import { readFileSync } from 'node:fs';", 'forbidden import node:fs'],
      ['let r: RoundRecord;', 'record type RoundRecord'],
      ['const x: MatchState = s;', 'record type MatchState'],
      ['function animate() {}', 'banned word animate'],
      ['const animation = 1;', 'banned word animation'],
      ['const tweens = [];', 'banned word tweens'],
      ['const keyframes = [];', 'banned word keyframes'],
      ['const transition = 1;', 'banned word transition'],
      ['const transitions = [];', 'banned word transitions'],
      ['const seed = 1;', 'seed identifier seed'],
      ['const roundSeed = 1;', 'seed identifier roundSeed'],
    ];
    for (const [code, expected] of planted) expect(tourViolations(code), code).toContain(expected);
  });

  it('NFR-60 plain code is accepted, and a banned word in a comment or a string is not code', () => {
    const plain = [
      "import { fnv1a32 } from './tour-key';",
      "import type { Tour } from './tour';",
      'export const dwell = (i: number): number => 120 + Math.floor((580 * i * i) / 100);',
      '// The animation of the old design and the transition step are not used; seed is a word here.',
      "const label = 'transition of the seed';",
      'const sigma = fnv1a32(text);',
      'const tourDate = 3;',
    ].join('\n');
    expect(tourViolations(plain)).toStrictEqual([]);
  });
});
