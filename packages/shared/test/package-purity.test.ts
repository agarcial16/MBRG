import { afterEach, describe, expect, it, vi } from 'vitest';
import purityTest002 from '../../sim/test/purity.test.ts?raw';
import {
  checkIdImage,
  checkPresentation,
  contactPairs,
  decodePixel,
  encodePixel,
  factionOrder,
  isValidColor,
  isValidName,
} from '../src/index';
import { image, twoLandMap, twoLandPresentation } from './helpers/package-fixtures';

// Same files and same pattern as the 002 purity scan (`shared/src/**/*.ts`), seen from this folder.
const sources = import.meta.glob('../src/**/*.ts', { query: '?raw', import: 'default', eager: true }) as Record<
  string,
  string
>;

/** Every source file added by spec 003a (the 002 scan must cover each one). */
const NEW_SOURCES = [
  'contact',
  'faction-order',
  'id-image',
  'image-input',
  'names',
  'package-errors',
  'package-types',
  'pixel-codec',
  'presentation',
];

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('NFR-15 shared purity of the map package contracts', () => {
  it('NFR-15 every new source file is inside the glob the 002 purity scan uses', () => {
    // The 002 scan is not edited: prove it still uses this glob, then that each new file matches it.
    expect(purityTest002).toContain("import.meta.glob('../../shared/src/**/*.ts'");
    const files = Object.keys(sources);
    for (const name of NEW_SOURCES) {
      expect(files, name).toContain(`../src/${name}.ts`);
    }
  });

  it('NFR-15 the new sources name no clock, randomness, I/O or DOM API', () => {
    // Complements the 002 scan (which stays authoritative) on exactly the new files.
    const forbidden =
      /\b(Math\s*\.\s*random|Date|performance|crypto|fetch|document|window|process|require|globalThis|setTimeout|setInterval)\b/;
    const stripped = (src: string) =>
      src.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '').replace(/'(?:\\.|[^'\\\n])*'/g, '');
    for (const name of NEW_SOURCES) {
      const src = sources[`../src/${name}.ts`] as string;
      expect(forbidden.test(stripped(src)), name).toBe(false);
      expect(/\bfrom\s*['"](?:node:|fs|path|crypto|os)/.test(src), name).toBe(false);
    }
  });

  it('NFR-15 every check and function runs on valid and invalid inputs with clock and randomness throwing', () => {
    const boom = () => {
      throw new Error('impure access');
    };
    vi.spyOn(Math, 'random').mockImplementation(boom);
    vi.spyOn(Date, 'now').mockImplementation(boom);
    vi.stubGlobal('performance', { now: boom });
    vi.stubGlobal('crypto', { getRandomValues: boom, randomUUID: boom });

    const map = twoLandMap();
    const good = twoLandPresentation();
    const bad = { factions: [3], territories: 'x', extra: 1 };
    const im = image(['AB'], { A: 1, B: 2 });
    const outcomes: boolean[] = [];

    outcomes.push(checkPresentation(map, good).ok, checkPresentation(map, bad).ok, checkPresentation(null, null).ok);
    outcomes.push(
      checkIdImage(map, im.width, im.height, im.pixels).ok,
      checkIdImage(map, 2, 1, [1, 99]).ok,
      checkIdImage(map, 'x', 1, null).ok,
    );
    outcomes.push(encodePixel(65536).ok, encodePixel(-1).ok, decodePixel(1, 0, 0).ok, decodePixel(256, 0, 0).ok);
    outcomes.push(contactPairs(2, 1, [1, 2]).ok, contactPairs(2, 1, [1]).ok);
    outcomes.push(isValidName('Espana'), isValidName(''), isValidColor('#00ff7a'), isValidColor('red'));
    expect(factionOrder(map)).toStrictEqual([10, 20]);

    // Valid inputs succeed and invalid ones fail, so each call really ran to completion.
    expect(outcomes).toStrictEqual([
      true, false, false,
      true, false, false,
      true, false, true, false,
      true, false,
      true, false, true, false,
    ]);
  });
});
