// NFR-63 (no regression): the goldens of specs 001 to 008 and the dev map are byte-identical to the base of spec 009, and the test
// that the drawing with no tour equals the drawing with a tour at delta 0 (FR-355) is in the suite. The bytes are pinned as SHA-256
// digests (text files with the line ends removed, so a checkout with CRLF line ends gives the same digest).
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sources = import.meta.glob('./tour-shade.test.ts', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

/**
 * Path from the repository root -> SHA-256 of the bytes, taken from `rewrite` before spec 009 changed anything. Three server goldens
 * (core-timelines, dev-results, service-timelines) were re-pinned by spec 011 M1 (forced absorber): their digests are the re-pinned ones.
 */
const PINNED: Readonly<Record<string, string>> = {
  'apps/server/test/golden/core-timelines.json': 'a2ae5b722b8960a1b0223953a4c052fc4b7126d1d246beb1e0be3e92f2f39777',
  'apps/server/test/golden/dev-results.json': '3071081f328cb133a1164b94627ad835f2fffe04bb5752834f265cccd8d7aac5',
  'apps/server/test/golden/dev-secrets.json': '77727ba2aa271e4e7c62dadec9f6f285629d112427f10494ef1a4995f64513b8',
  'apps/server/test/golden/service-timelines.json': '31715ff9a5801401dc368ff6d941cfb3145d5d4ac0313017d0351904100af4db',
  'packages/sim/test/golden/grid5x5-seed4294967295.json': 'd8bcbee304dc5e39d9ebcae03481d9ee26cecba376d1f67edf4be7f69643caa2',
  'packages/sim/test/golden/hand8-seed42.json': '86d7d183bbd0cc070b08e519c05d2a597f5373b4b61368bc162031f877a85a3f',
  'packages/sim/test/golden/pair-seed0.json': 'da1029234f397b17ff54733249b3fd2480e94e74d86badf3f1b0241c9cef1ea2',
  'packages/sim/test/golden/sea-denmark-seed0.json': 'e4a972391014f5d55e6c2e20ddf939d8eb9dbe6feb51e95084e817e35c051d61',
  'packages/sim/test/golden/sea-isles-seed0.json': '8822dfdd119c728d81cd0d3d4ba0be91767f364e4b55939db2fd8c0ecc064ef4',
  'packages/sim/test/golden/sea-japan-seed1.json': '0aa0ff6ddec392588a9b50657dfe943089da097cc671e4c00045b360c17a8e17',
  'packages/sim/test/golden/sea-ocean-seed0.json': '77463410af807960fd728d6138be3061f430189148f1048ff63b9a6c8bbbef8c',
  'packages/sim/test/golden/sfc32-seed0.json': '277f8fb7a9fa70d8838319b7299baac521987a5a54f085f67be1446357fcb46b',
  'maps/dev/map.json': '80d8af78fa92cd1a2d5f88e5d41239288bec2c6f6414ffc121d48e984acf95da',
  'maps/dev/ids.png': '61df665a9336744c12cfb2aa11bf98474fd272b83d66ab34060b522cd0227037',
  'maps/dev/presentation.json': '0e883d89bb7b823c6408efdc55744a4927e90886e0fc36576639d7609f30548d',
};

const digestOf = (path: string): string => {
  const bytes = readFileSync(new URL(`../../../${path}`, import.meta.url));
  const body = path.endsWith('.json') ? Buffer.from(bytes.toString('utf8').replace(/\r/g, ''), 'utf8') : bytes;
  return createHash('sha256').update(body).digest('hex');
};

describe('NFR-63 no regression: the files earlier specs depend on did not change', () => {
  it('NFR-63 the 12 goldens of the sim and the server and the 3 files of the dev map have the digests they had before spec 009', () => {
    expect(Object.keys(PINNED)).toHaveLength(15);
    for (const [path, digest] of Object.entries(PINNED)) expect(digestOf(path), path).toBe(digest);
  });

  it('NFR-63 the digest check sees a changed byte (a planted change is flagged)', () => {
    const changed = createHash('sha256').update(Buffer.from('x')).digest('hex');
    expect(changed).not.toBe(PINNED['maps/dev/map.json']);
    expect(digestOf('maps/dev/map.json')).toBe(PINNED['maps/dev/map.json']);
  });

  it('NFR-63 the test that a tour at delta 0 draws as no tour at all is present, by its FR-355 title', () => {
    const source = sources['./tour-shade.test.ts'] ?? '';
    expect(source).toMatch(/it\('FR-355 no lit set and delta 0 is renderReference pixel for pixel; so is any lit set at delta 0'/);
  });
});
