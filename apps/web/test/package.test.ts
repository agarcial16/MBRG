import { describe, expect, it } from 'vitest';
import { checkIdImage, checkPresentation, factionOrder, validateMap } from '@mbrg/shared';
import type { MapData, Rgb } from '@mbrg/shared';
import { capabilityMessage, checkCapabilities } from '../src/core/capabilities';
import { buildEntryIndex, factionColorList, factionIndexOf, ownerTable } from '../src/core/entries';
import { checkPackage, packageErrorMessage, parsePackage } from '../src/core/package';
import { renderReference, shade } from '../src/core/borders';
import { THEME } from '../src/core/theme';
import { STRINGS } from '../src/core/strings';
import { inflateStream, loadPackage } from '../src/ui/load';
import loadSource from '../src/ui/load.ts?raw';
import mapUrl from '../../../maps/dev/map.json?url';
import presentationUrl from '../../../maps/dev/presentation.json?url';
import imageUrl from '../../../maps/dev/ids.png?url';
import { DEV_MAP, DEV_MAP_TEXT, DEV_PRESENTATION, DEV_PRESENTATION_TEXT, devPngBytes } from './helpers/dev-map';
import { codeOnly, stripComments } from './helpers/scan';
import { makePng } from './helpers/png-builder';

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

/** The decoded dev map image, loaded once for the whole file. */
const decodedPromise = parsePackage({ map: DEV_MAP_TEXT, presentation: DEV_PRESENTATION_TEXT, image: devPngBytes() }, inflateStream);

async function devValues(): Promise<{ width: number; height: number; values: Uint32Array }> {
  const r = await decodedPromise;
  if (!r.ok) throw new Error('dev package did not parse');
  return r.value;
}

describe('FR-133 package checks and their order', () => {
  it('FR-133 the committed dev package has no error', async () => {
    const { width, height, values } = await devValues();
    expect(checkPackage(DEV_MAP, DEV_PRESENTATION, width, height, values)).toStrictEqual([]);
  });

  it('FR-133 an invalid map reports exactly the map errors and nothing from the other checks', async () => {
    const { width, height, values } = await devValues();
    const map = clone(DEV_MAP);
    map.territories[0]!.neighbors.push(999999);
    const expected = validateMap(map);
    expect(expected.ok).toBe(false);
    const errors = checkPackage(map, DEV_PRESENTATION, width, height, values);
    expect(errors).toStrictEqual(expected.ok ? [] : expected.errors);
    expect(errors[0]!.kind).toBe('unknown-neighbor');
  });

  it('FR-133 an invalid presentation is reported before any id image error, in that order', async () => {
    const { width, height, values } = await devValues();
    const presentation = clone(DEV_PRESENTATION);
    presentation.factions.pop();
    const bad = values.slice();
    bad[0] = 0xabcdef; // an id that is not in the map
    const p = checkPresentation(DEV_MAP, presentation);
    const i = checkIdImage(DEV_MAP, width, height, bad);
    expect(p.ok).toBe(false);
    expect(i.ok).toBe(false);
    const errors = checkPackage(DEV_MAP, presentation, width, height, bad);
    expect(errors).toStrictEqual([...(p.ok ? [] : p.errors), ...(i.ok ? [] : i.errors)]);
    expect(errors[0]!.kind).toBe('missing-presentation');
    expect(errors.at(-1)!.kind).toBe('unknown-pixel-id');
  });

  it('FR-133 a corrupted pixel value reports unknown-pixel-id as the first kind', async () => {
    const { width, height, values } = await devValues();
    const bad = values.slice();
    bad[5 * width + 7] = 0xfedcba;
    const errors = checkPackage(DEV_MAP, DEV_PRESENTATION, width, height, bad);
    expect(errors[0]).toStrictEqual({ kind: 'unknown-pixel-id', id: 0xfedcba, pixelCount: 1, firstPixel: { x: 7, y: 5 } });
  });

  it('FR-133 an image of the wrong length reports invalid-image', async () => {
    const { width, height, values } = await devValues();
    const errors = checkPackage(DEV_MAP, DEV_PRESENTATION, width, height + 1, values);
    expect(errors).toStrictEqual([{ kind: 'invalid-image' }]);
  });

  it('FR-133 the message gives the number of errors and the kind of the first one, from the strings module', () => {
    const text = packageErrorMessage([{ kind: 'unknown-pixel-id' }, { kind: 'missing-territory-pixels' }, { kind: 'extra-adjacency' }]);
    expect(text).toContain('3');
    expect(text).toContain('unknown-pixel-id');
    expect(text).not.toContain('extra-adjacency');
    expect(text).toBe(STRINGS.packageErrors.replace('{count}', '3').replace('{kind}', 'unknown-pixel-id'));
  });

  it('FR-133 a file that cannot be decoded or parsed is a read error with its kind, never a drawing', async () => {
    const png = devPngBytes();
    const badPng = await parsePackage({ map: DEV_MAP_TEXT, presentation: DEV_PRESENTATION_TEXT, image: png.slice(0, 100) }, inflateStream);
    expect(badPng).toStrictEqual({ ok: false, errors: [{ kind: 'invalid-png' }] });
    const badMap = await parsePackage({ map: '{"territories": [', presentation: DEV_PRESENTATION_TEXT, image: png }, inflateStream);
    expect(badMap).toStrictEqual({ ok: false, errors: [{ kind: 'invalid-json', artifact: 'map' }] });
    const badPresentation = await parsePackage({ map: DEV_MAP_TEXT, presentation: '', image: png }, inflateStream);
    expect(badPresentation).toStrictEqual({ ok: false, errors: [{ kind: 'invalid-json', artifact: 'presentation' }] });
    expect(packageErrorMessage([{ kind: 'invalid-png' }])).toContain('invalid-png');
  });

  it('FR-133 an image that decodes with altered values fails the check, so nothing is drawn', async () => {
    const values = new Uint32Array(4).fill(0xabcdef);
    const image = await makePng({ width: 2, height: 2, values });
    const r = await parsePackage({ map: DEV_MAP_TEXT, presentation: DEV_PRESENTATION_TEXT, image }, inflateStream);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const errors = checkPackage(r.value.map, r.value.presentation, r.value.width, r.value.height, r.value.values);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]!.kind).toBe('unknown-pixel-id');
  });
});

describe('FR-135 capabilities', () => {
  const ok = { webgl2: true, maxTextureSize: 16384 };

  it('FR-135 a capable browser has no error', () => {
    expect(checkCapabilities(ok, 2048, 2048, 88)).toStrictEqual([]);
  });

  it('FR-135 no WebGL2 context is no-webgl2 and the message names the missing capability', () => {
    const errors = checkCapabilities({ webgl2: false, maxTextureSize: 16384 }, 2048, 2048, 88);
    expect(errors).toStrictEqual([{ kind: 'no-webgl2' }]);
    expect(capabilityMessage(errors[0]!)).toBe(STRINGS.noWebgl2);
  });

  it('FR-135 a maximum texture size below W or H is texture-too-small, with the sizes in the message', () => {
    const errors = checkCapabilities({ webgl2: true, maxTextureSize: 1024 }, 2048, 2048, 88);
    expect(errors).toStrictEqual([{ kind: 'texture-too-small', maxTextureSize: 1024, required: 2048 }]);
    const text = capabilityMessage(errors[0]!);
    expect(text).toContain('1024');
    expect(text).toContain('2048');
  });

  it('FR-135 the limit is met exactly at W, at H and at the entry table size, and missed one below', () => {
    expect(checkCapabilities({ webgl2: true, maxTextureSize: 2048 }, 2048, 1024, 88)).toStrictEqual([]);
    expect(checkCapabilities({ webgl2: true, maxTextureSize: 2048 }, 1024, 2048, 88)).toStrictEqual([]);
    expect(checkCapabilities({ webgl2: true, maxTextureSize: 2047 }, 1024, 2048, 88)).toStrictEqual([
      { kind: 'texture-too-small', maxTextureSize: 2047, required: 2048 },
    ]);
    expect(checkCapabilities({ webgl2: true, maxTextureSize: 2047 }, 2048, 1024, 88)).toHaveLength(1);
    expect(checkCapabilities({ webgl2: true, maxTextureSize: 100 }, 64, 64, 100)).toStrictEqual([]);
    expect(checkCapabilities({ webgl2: true, maxTextureSize: 100 }, 64, 64, 101)).toStrictEqual([
      { kind: 'texture-too-small', maxTextureSize: 100, required: 101 },
    ]);
  });

  it('FR-135 without WebGL2 the texture size is not reported on top', () => {
    expect(checkCapabilities({ webgl2: false, maxTextureSize: 0 }, 2048, 2048, 88)).toStrictEqual([{ kind: 'no-webgl2' }]);
  });
});

describe('FR-134 entry index', () => {
  it('FR-134 every pixel maps to the dense index of its id, and back, with the kinds of the map', async () => {
    const { width, height, values } = await devValues();
    const index = buildEntryIndex(DEV_MAP, width, height, values);
    expect(index.width).toBe(2048);
    expect(index.height).toBe(2048);
    expect(index.ids).toStrictEqual([0, ...DEV_MAP.territories.map((t) => t.id)]);
    expect(index.fills[0]).toBe('outside');
    expect(index.fills.length).toBe(DEV_MAP.territories.length + 1);
    DEV_MAP.territories.forEach((t, i) => {
      expect(index.indexOf.get(t.id)).toBe(i + 1);
      expect(index.fills[i + 1]).toBe((t as { kind?: string }).kind === 'sea' ? 'sea' : 'land');
    });
    expect(index.fills.filter((f) => f === 'land')).toHaveLength(70);
    expect(index.fills.filter((f) => f === 'sea')).toHaveLength(17);
    expect(index.cells.length).toBe(width * height);
    let wrong = 0;
    for (let p = 0; p < values.length; p++) {
      if (index.ids[index.cells[p]!] !== values[p]) wrong++;
    }
    expect(wrong).toBe(0);
  });

  it('FR-134 the packed texture holds the index as two bytes per pixel, low byte first, nothing else', async () => {
    const { width, height, values } = await devValues();
    const index = buildEntryIndex(DEV_MAP, width, height, values);
    expect(index.indexPixels).toBeInstanceOf(Uint8Array);
    expect(index.indexPixels.length).toBe(width * height * 2);
    let wrong = 0;
    for (let p = 0; p < values.length; p++) {
      const entry = index.indexPixels[p * 2]! + index.indexPixels[p * 2 + 1]! * 256;
      if (entry !== index.cells[p]) wrong++;
    }
    expect(wrong).toBe(0);
  });

  it('FR-134 pixels of value 0 are outside (index 0)', () => {
    const map: MapData = { territories: [{ id: 5, owner: 1, neighbors: [] }, { id: 9, owner: 2, neighbors: [] }] };
    const index = buildEntryIndex(map, 3, 1, Uint32Array.from([0, 9, 5]));
    expect(Array.from(index.cells)).toStrictEqual([0, 2, 1]);
    expect(Array.from(index.indexPixels)).toStrictEqual([0, 0, 2, 0, 1, 0]);
  });

  it('FR-134 more than 255 entries use the high byte', () => {
    const territories = Array.from({ length: 300 }, (_, i) => ({ id: i + 1, owner: 1, neighbors: [] as number[] }));
    const index = buildEntryIndex({ territories }, 2, 1, Uint32Array.from([300, 256]));
    expect(Array.from(index.indexPixels)).toStrictEqual([300 & 255, 300 >> 8, 0, 1]);
  });

  it('FR-134 a pixel id that is not in the map is refused, never drawn as outside', () => {
    const map: MapData = { territories: [{ id: 5, owner: 1, neighbors: [] }] };
    expect(() => buildEntryIndex(map, 1, 1, Uint32Array.from([6]))).toThrow(RangeError);
  });

  it('FR-134 the index is the grid the border reference reads: a dev map land pixel is drawn in its owner colour', async () => {
    const { width, height, values } = await devValues();
    const index = buildEntryIndex(DEV_MAP, width, height, values);
    const order = factionOrder(DEV_MAP);
    const colors = new Map<number, Rgb>(order.map((f, i) => [f, THEME.palette[i]!]));
    const list = factionColorList(DEV_MAP, colors);
    const factions = factionIndexOf(DEV_MAP);
    const owners = new Map<number, number>();
    for (const t of DEV_MAP.territories) if ('owner' in t) owners.set(t.id, t.owner);
    const table = ownerTable(index, owners, factions);
    // pick one land pixel in the middle of a territory and one sea pixel, away from borders
    const probe = (wanted: 'land' | 'sea'): [number, number] => {
      for (let y = 8; y < height - 8; y += 3) {
        for (let x = 8; x < width - 8; x += 3) {
          const e = index.cells[y * width + x]!;
          if (index.fills[e] !== wanted) continue;
          let same = true;
          for (let dy = -4; dy <= 4 && same; dy += 2) for (let dx = -4; dx <= 4; dx += 2) if (index.cells[(y + dy) * width + x + dx] !== e) same = false;
          if (same) return [x, y];
        }
      }
      throw new Error('no probe');
    };
    const [lx, ly] = probe('land');
    const land = shade(index, table, list, THEME, { x: lx + 0.5, y: ly + 0.5, scale: 8 }, { width: 8, height: 8 }, 4, 4);
    expect(land.fill).toBe('land');
    expect(land.color).toStrictEqual(list[table[index.cells[ly * width + lx]!]!]);
    const [sx, sy] = probe('sea');
    const sea = shade(index, table, list, THEME, { x: sx + 0.5, y: sy + 0.5, scale: 8 }, { width: 8, height: 8 }, 4, 4);
    expect(sea.color).toStrictEqual(THEME.sea);
    const rgba = renderReference(index, table, list, THEME, { x: lx + 0.5, y: ly + 0.5, scale: 8 }, { width: 4, height: 4 }, 1);
    expect(rgba.length).toBe(4 * 4 * 4);
  });
});

describe('NFR-24 owner table: per-entry data only', () => {
  const map: MapData = {
    territories: [
      { id: 10, owner: 7, neighbors: [20, 30] },
      { id: 20, owner: 8, neighbors: [10, 30] },
      { id: 30, kind: 'sea', neighbors: [10, 20] },
    ],
  };
  const index = buildEntryIndex(map, 3, 1, Uint32Array.from([10, 30, 20]));

  it('NFR-24 the table has one byte per entry plus the outside slot, with no pixel data', () => {
    const factions = factionIndexOf(map);
    expect(Array.from(factions)).toStrictEqual([[7, 1], [8, 2]]);
    const table = ownerTable(index, new Map([[10, 7], [20, 8]]), factions);
    expect(table).toBeInstanceOf(Uint8Array);
    expect(Array.from(table)).toStrictEqual([0, 1, 2, 0]);
    expect(table.length).toBe(index.ids.length);
  });

  it('NFR-24 on the dev map a round change output has E + 1 bytes, not W x H', async () => {
    const { width, height, values } = await devValues();
    const dev = buildEntryIndex(DEV_MAP, width, height, values);
    const owners = new Map<number, number>();
    for (const t of DEV_MAP.territories) if ('owner' in t) owners.set(t.id, t.owner);
    const table = ownerTable(dev, owners, factionIndexOf(DEV_MAP));
    expect(table.length).toBe(88);
    expect(table.length).toBeLessThan(width);
    expect(table[0]).toBe(0);
    for (let i = 1; i < table.length; i++) expect(table[i], `entry ${i}`).toBe(dev.fills[i] === 'land' ? table[i] : 0);
    expect(new Set(Array.from(table))).toStrictEqual(new Set([0, 1, 2, 3, 4, 5]));
  });

  it('NFR-24 the owner changes and nothing else changes when a territory is absorbed', () => {
    const factions = factionIndexOf(map);
    const before = ownerTable(index, new Map([[10, 7], [20, 8]]), factions);
    const after = ownerTable(index, new Map([[10, 7], [20, 7]]), factions);
    expect(Array.from(before)).toStrictEqual([0, 1, 2, 0]);
    expect(Array.from(after)).toStrictEqual([0, 1, 1, 0]);
    expect(index.cells.length).toBe(3); // the index itself is not touched
  });

  it('NFR-24 a land entry without an owner in the displayed state is 0 and sea is always 0', () => {
    const table = ownerTable(index, new Map([[10, 7], [30, 7]]), factionIndexOf(map));
    expect(Array.from(table)).toStrictEqual([0, 1, 0, 0]);
  });

  it('NFR-24 more than 255 factions are refused', () => {
    const territories = Array.from({ length: 256 }, (_, i) => ({ id: i + 1, owner: i + 1, neighbors: [] as number[] }));
    const big: MapData = { territories };
    const bigIndex = buildEntryIndex(big, 1, 1, Uint32Array.from([1]));
    expect(() => ownerTable(bigIndex, new Map(), factionIndexOf(big))).toThrow(RangeError);
  });

  it('NFR-24 the faction colour list is indexed by faction index', () => {
    const colors = new Map<number, Rgb>([[7, [1, 2, 3]], [8, [4, 5, 6]]]);
    const list = factionColorList(map, colors);
    expect(list[1]).toStrictEqual([1, 2, 3]);
    expect(list[2]).toStrictEqual([4, 5, 6]);
    expect(list).toHaveLength(3);
  });
});

describe('FR-132 loading the package', () => {
  const pngBytes = devPngBytes();
  const body = new Map<string, () => Promise<unknown>>([
    [mapUrl, async () => DEV_MAP_TEXT],
    [presentationUrl, async () => DEV_PRESENTATION_TEXT],
    [imageUrl, async () => pngBytes.buffer.slice(pngBytes.byteOffset, pngBytes.byteOffset + pngBytes.length)],
  ]);

  function recordingFetch(failOn?: string, status = 200) {
    const calls: string[] = [];
    const fetchImpl = async (url: string) => {
      calls.push(url);
      if (failOn === url && status === 0) throw new TypeError('network down');
      const make = body.get(url);
      return {
        ok: failOn === url ? false : make !== undefined,
        text: async () => (await make!()) as string,
        arrayBuffer: async () => (await make!()) as ArrayBuffer,
      };
    };
    return { calls, fetchImpl };
  }

  it('FR-132 fetches exactly the three maps/dev files, each once, and nothing else', async () => {
    const { calls, fetchImpl } = recordingFetch();
    const r = await loadPackage(fetchImpl);
    expect(r.ok).toBe(true);
    expect([...calls].sort()).toStrictEqual([imageUrl, mapUrl, presentationUrl].sort());
    expect(calls).toHaveLength(3);
    for (const url of calls) expect(url).toMatch(/^\/maps\/dev\/(map\.json|presentation\.json|ids\.png)$/);
  });

  it('FR-132 the loaded package is the committed one, unchanged, and passes every check', async () => {
    const started = performance.now();
    const { fetchImpl } = recordingFetch();
    const r = await loadPackage(fetchImpl);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.map).toStrictEqual(DEV_MAP);
    expect(r.value.presentation).toStrictEqual(DEV_PRESENTATION);
    expect(r.value.width).toBe(2048);
    expect(checkPackage(r.value.map, r.value.presentation, r.value.width, r.value.height, r.value.values)).toStrictEqual([]);
    const index = buildEntryIndex(r.value.map as MapData, r.value.width, r.value.height, r.value.values);
    expect(index.ids.length).toBe(88);
    // Logged, not asserted (NFR-24 is measured in the browser): decode + checks + index in Node.
    console.log(`T4 dev map loaded, checked and indexed in Node in ${Math.round(performance.now() - started)} ms`);
  });

  it('FR-132 a failed request or a bad status is a read error naming the artifact, with no drawing', async () => {
    for (const [url, artifact] of [[mapUrl, 'map'], [presentationUrl, 'presentation'], [imageUrl, 'image']] as const) {
      const bad = await loadPackage(recordingFetch(url).fetchImpl);
      expect(bad, artifact).toStrictEqual({ ok: false, errors: [{ kind: 'read-failed', artifact }] });
      const thrown = await loadPackage(recordingFetch(url, 0).fetchImpl);
      expect(thrown, artifact).toStrictEqual({ ok: false, errors: [{ kind: 'read-failed', artifact }] });
    }
  });

  it('FR-132 the sources import the three maps/dev files as asset URLs and name no other file or origin', () => {
    const code = stripComments(loadSource);
    const imports = [...code.matchAll(/import\s+\w+\s+from\s+(['"])([^'"]+)\1/g)].map((m) => m[2]!).filter((s) => s.includes('maps/'));
    expect(imports.sort()).toStrictEqual(
      ['../../../../maps/dev/ids.png?url', '../../../../maps/dev/map.json?url', '../../../../maps/dev/presentation.json?url'].sort(),
    );
    expect(/https?:|\/\/|\bwww\./.test(code)).toBe(false);
    // No string literal that is a path or an address other than the three imports.
    const literals = [...code.matchAll(/'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"|`(?:\\.|[^`\\])*`/g)].map((m) => m[0].slice(1, -1));
    expect(literals.filter((t) => t.includes('/') && !t.startsWith('../../../../maps/dev/') && !t.startsWith('../core/') && !t.startsWith('@mbrg/'))).toStrictEqual([]);
    // The code that remains outside strings does not name an origin either.
    expect(/\blocation\b|\bXMLHttpRequest\b|\bWebSocket\b/.test(codeOnly(code))).toBe(false);
  });
});

describe('FR-134 inflate', () => {
  it('FR-134 inflateStream restores zlib data exactly and fails on garbage', async () => {
    const bytes = Uint8Array.from({ length: 5000 }, (_, i) => (i * 31 + (i >> 3)) & 255);
    const compressed = new Uint8Array(await new Response(new Blob([bytes as BlobPart]).stream().pipeThrough(new CompressionStream('deflate'))).arrayBuffer());
    expect(Array.from(await inflateStream(compressed))).toStrictEqual(Array.from(bytes));
    await expect(inflateStream(Uint8Array.from([1, 2, 3, 4]))).rejects.toBeDefined();
  });
});
