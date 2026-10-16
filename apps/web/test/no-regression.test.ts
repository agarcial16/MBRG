import { describe, expect, it } from 'vitest';
import * as shared from '@mbrg/shared';
import * as sim from '@mbrg/sim';
import { DEV_MAP_TEXT, DEV_PRESENTATION_TEXT, devPngBytes } from './helpers/dev-map';

// NFR-29: the viewer changes nothing outside itself. The dev map package and the golden files are
// byte-identical to the `rewrite` tip this branch was rebased on (spec 003c rebuilt the dev map on
// 2026-10-16; the literals below are the SHA-256 of that package and of the 001/002 goldens).
const goldens = import.meta.glob('../../../packages/sim/test/golden/*.json', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as BufferSource));
  return [...digest].map((b) => b.toString(16).padStart(2, '0')).join('');
}
const text = (value: string): Uint8Array => new TextEncoder().encode(value);

describe('NFR-29 the dev map package and the goldens are unchanged', () => {
  it('NFR-29 the three dev map files have the SHA-256 and sizes of the spec 003c package', async () => {
    expect(await sha256(text(DEV_MAP_TEXT))).toBe('80d8af78fa92cd1a2d5f88e5d41239288bec2c6f6414ffc121d48e984acf95da');
    expect(text(DEV_MAP_TEXT).length).toBe(11834);
    expect(await sha256(text(DEV_PRESENTATION_TEXT))).toBe('0e883d89bb7b823c6408efdc55744a4927e90886e0fc36576639d7609f30548d');
    expect(text(DEV_PRESENTATION_TEXT).length).toBe(5347);
    expect(await sha256(devPngBytes())).toBe('61df665a9336744c12cfb2aa11bf98474fd272b83d66ab34060b522cd0227037');
    expect(devPngBytes().length).toBe(71377);
  });

  it('NFR-29 the eight golden files of the sim are byte-identical', async () => {
    const expected: Record<string, string> = {
      'grid5x5-seed4294967295.json': 'd8bcbee304dc5e39d9ebcae03481d9ee26cecba376d1f67edf4be7f69643caa2',
      'hand8-seed42.json': '86d7d183bbd0cc070b08e519c05d2a597f5373b4b61368bc162031f877a85a3f',
      'pair-seed0.json': 'da1029234f397b17ff54733249b3fd2480e94e74d86badf3f1b0241c9cef1ea2',
      'sea-denmark-seed0.json': 'e4a972391014f5d55e6c2e20ddf939d8eb9dbe6feb51e95084e817e35c051d61',
      'sea-isles-seed0.json': '8822dfdd119c728d81cd0d3d4ba0be91767f364e4b55939db2fd8c0ecc064ef4',
      'sea-japan-seed1.json': '0aa0ff6ddec392588a9b50657dfe943089da097cc671e4c00045b360c17a8e17',
      'sea-ocean-seed0.json': '77463410af807960fd728d6138be3061f430189148f1048ff63b9a6c8bbbef8c',
      'sfc32-seed0.json': '277f8fb7a9fa70d8838319b7299baac521987a5a54f085f67be1446357fcb46b',
    };
    const found: Record<string, string> = {};
    for (const [path, content] of Object.entries(goldens)) {
      found[path.slice(path.lastIndexOf('/') + 1)] = await sha256(text(content));
    }
    expect(found).toStrictEqual(expected);
  });

  it('NFR-29 the shared and sim packages export exactly what the viewer reads and nothing new is added for it', () => {
    // The viewer imports only these names from the two packages (a new export would be a spec change).
    for (const name of ['entryKind', 'factionOrder', 'decodePixel', 'validateMap', 'checkPresentation', 'checkIdImage']) {
      expect(typeof (shared as Record<string, unknown>)[name], name).toBe('function');
    }
    for (const name of ['totalRounds', 'getState', 'getRounds', 'ownerOf']) {
      expect(typeof (sim as Record<string, unknown>)[name], name).toBe('function');
    }
  });
});
