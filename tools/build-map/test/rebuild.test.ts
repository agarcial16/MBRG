import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkIdImage, checkPresentation, validateMap } from '@mbrg/shared';
import { afterAll, describe, expect, it } from 'vitest';
import { runBuild } from '../src/cli/build';
import { fromRgb } from '../src/core/png-check';
import { realFs } from '../src/io/fs-ops';
import { pngCodec } from '../src/io/png-codec';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');
const data = join(root, 'tools', 'build-map', 'data');
const committed = join(root, 'maps', 'dev');

/** NFR-16 thresholds (milliseconds). */
const BUILD_LIMIT_MS = 60_000;
const CHECKS_LIMIT_MS = 1_000;
/** FR-130: the per-test timeout is above the build threshold, so a slow build fails on its assertion. */
const TEST_TIMEOUT_MS = 180_000;

const temp = mkdtempSync(join(tmpdir(), 'mbrg-rebuild-'));
afterAll(() => rmSync(temp, { recursive: true, force: true }));

interface Rebuild {
  status: number;
  stderr: string;
  buildMs: number;
}

let cached: Rebuild | undefined;

/** One full rebuild from the committed inputs into the temp directory (done once per test run). */
function rebuild(): Rebuild {
  if (cached !== undefined) return cached;
  let stderr = '';
  const started = performance.now();
  const status = runBuild([`--data=${data}`, `--out=${temp}`], {
    fs: realFs,
    codec: pngCodec,
    root,
    stdout: () => undefined,
    stderr: (s) => (stderr += s),
  });
  cached = { status, stderr, buildMs: performance.now() - started };
  return cached;
}

function decode(file: string): { width: number; height: number; pixels: Uint32Array } {
  const decoded = pngCodec.decode(new Uint8Array(readFileSync(file)));
  if (!decoded.ok) throw new Error(JSON.stringify(decoded.errors));
  return { width: decoded.value.width, height: decoded.value.height, pixels: fromRgb(decoded.value.rgb) };
}

describe('FR-130 and NFR-16 the dev map rebuild', () => {
  it(
    'FR-130 the rebuild from the committed inputs succeeds and writes the three artifacts',
    { timeout: TEST_TIMEOUT_MS },
    () => {
      const result = rebuild();
      expect(result.stderr).toBe('');
      expect(result.status).toBe(0);
      expect(readdirSync(temp).sort()).toStrictEqual(['ids.png', 'map.json', 'presentation.json']);
    },
  );

  it(
    'FR-130 the rebuilt map and presentation data are byte-identical to the committed ones',
    { timeout: TEST_TIMEOUT_MS },
    () => {
      expect(rebuild().status).toBe(0);
      for (const name of ['map.json', 'presentation.json']) {
        expect(readFileSync(join(temp, name)).equals(readFileSync(join(committed, name)))).toBe(true);
      }
    },
  );

  it(
    'FR-130 the rebuilt id image decodes to the same pixel values as the committed one',
    { timeout: TEST_TIMEOUT_MS },
    () => {
      expect(rebuild().status).toBe(0);
      const fresh = decode(join(temp, 'ids.png'));
      const stored = decode(join(committed, 'ids.png'));
      expect([fresh.width, fresh.height]).toStrictEqual([stored.width, stored.height]);
      expect(fresh.pixels.length).toBe(stored.pixels.length);
      expect(fresh.pixels.every((value, i) => value === stored.pixels[i])).toBe(true);
    },
  );

  it(
    'NFR-16 one full dev map build, from reading the inputs to the three artifacts written, takes under 60 seconds',
    { timeout: TEST_TIMEOUT_MS },
    () => {
      const result = rebuild();
      expect(result.status).toBe(0);
      expect(result.buildMs).toBeLessThan(BUILD_LIMIT_MS);
    },
  );

  it(
    'NFR-16 map validation, presentation check and id image check of the dev map take under 1 second together',
    { timeout: TEST_TIMEOUT_MS },
    () => {
      const map = JSON.parse(readFileSync(join(committed, 'map.json'), 'utf8')) as unknown;
      const presentation = JSON.parse(readFileSync(join(committed, 'presentation.json'), 'utf8')) as unknown;
      const image = decode(join(committed, 'ids.png'));
      const started = performance.now();
      const mapResult = validateMap(map);
      const presentationResult = mapResult.ok ? checkPresentation(map, presentation) : mapResult;
      const imageResult = mapResult.ok ? checkIdImage(map, image.width, image.height, image.pixels) : mapResult;
      const checksMs = performance.now() - started;
      expect(mapResult.ok).toBe(true);
      expect(presentationResult.ok).toBe(true);
      expect(imageResult.ok).toBe(true);
      expect(checksMs).toBeLessThan(CHECKS_LIMIT_MS);
    },
  );
});
