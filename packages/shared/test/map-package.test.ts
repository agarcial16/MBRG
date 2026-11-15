import { describe, expect, it } from 'vitest';
import { checkIdImage } from '../src/id-image';
import { checkPresentation } from '../src/presentation';
import { contactPairs } from '../src/contact';
import { factionOrder } from '../src/faction-order';
import { decodePixel, encodePixel } from '../src/pixel-codec';
import { isValidColor, isValidName } from '../src/names';
import { validateMap } from '../src/validate';
import { entryKind, isSeaZone } from '../src/kinds';
import {
  deepFreeze,
  image,
  twoLandMap,
  twoLandPresentation,
} from './helpers/package-fixtures';

const LEGEND = { A: 1, B: 2 };
const kinds = (r: { ok: boolean; errors?: Array<{ kind: string }> }) =>
  r.ok ? [] : r.errors!.map((e) => e.kind);

describe('FR-82 map package: three artifacts, map unchanged', () => {
  it('FR-82 a valid package passes every check and leaves its inputs deep-equal', () => {
    const map = twoLandMap();
    const presentation = twoLandPresentation();
    const im = image(['AB'], LEGEND);
    const mapCopy = structuredClone(map);
    const presentationCopy = structuredClone(presentation);
    const pixelsCopy = structuredClone(im.pixels);

    expect(validateMap(map).ok).toBe(true);
    expect(checkPresentation(map, presentation).ok).toBe(true);
    expect(checkIdImage(map, im.width, im.height, im.pixels).ok).toBe(true);

    expect(map).toStrictEqual(mapCopy);
    expect(presentation).toStrictEqual(presentationCopy);
    expect(im.pixels).toStrictEqual(pixelsCopy);
  });

  it('FR-82 a name or color on a map entry still fails map validation with unknown-field', () => {
    for (const [field, value] of [['name', 'Huesca'], ['color', '#00ff7a']] as const) {
      const map = twoLandMap();
      Object.assign(map.territories[0]!, { [field]: value });
      const r = validateMap(map);
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.errors).toContainEqual(expect.objectContaining({ kind: 'unknown-field', field }));
      }
      // the other checks report the same map errors and add none of their own
      expect(checkPresentation(map, twoLandPresentation())).toStrictEqual(r);
      const im = image(['AB'], LEGEND);
      expect(checkIdImage(map, im.width, im.height, im.pixels)).toStrictEqual(r);
    }
  });
});

describe('FR-83 artifacts independent of any match', () => {
  it('FR-83 a top-level seed and round in presentation data give one presentation-unknown-field each', () => {
    const data = { ...twoLandPresentation(), seed: 7, round: 3 };
    const r = checkPresentation(twoLandMap(), data);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors).toHaveLength(2);
      expect(kinds(r)).toStrictEqual(['presentation-unknown-field', 'presentation-unknown-field']);
      expect(r.errors.map((e) => (e as { field: string }).field).sort()).toStrictEqual([
        'round',
        'seed',
      ]);
    }
  });

  it('FR-83 a map with a top-level round field fails map validation with unknown-field', () => {
    const map = { ...twoLandMap(), round: 3 };
    const r = validateMap(map);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors).toContainEqual(expect.objectContaining({ kind: 'unknown-field', field: 'round' }));
    }
  });

  it('FR-83 the presentation check and the id image check return equal results when called twice', () => {
    const map = twoLandMap();
    const good = twoLandPresentation();
    const bad = { ...twoLandPresentation(), seed: 1 };
    for (const data of [good, bad]) {
      expect(checkPresentation(map, data)).toStrictEqual(checkPresentation(map, data));
    }
    const ok = image(['AB'], LEGEND);
    const broken = image(['AA'], LEGEND);
    for (const im of [ok, broken]) {
      expect(checkIdImage(map, im.width, im.height, im.pixels)).toStrictEqual(
        checkIdImage(map, im.width, im.height, im.pixels),
      );
    }
    expect(checkPresentation.length).toBe(2);
    expect(checkIdImage.length).toBe(4);
  });
});

describe('FR-104 checks and functions never modify their inputs', () => {
  const invalidMap = { territories: [{ id: 0, owner: 1, neighbors: [] }], round: 1 };
  const invalidPresentation = {
    factions: [{ id: 10, name: ' bad ' }, { id: 99, name: 'Ghost', color: 'red' }],
    territories: 'nope',
    seed: 1,
  };

  it('FR-104 deep-frozen valid inputs are accepted by every check and stay deep-equal', () => {
    const map = deepFreeze(twoLandMap());
    const data = deepFreeze(twoLandPresentation());
    const im = image(['AB'], LEGEND);
    const pixels = deepFreeze(im.pixels);
    const before = structuredClone({ map, data, pixels });

    expect(() => {
      validateMap(map);
      checkPresentation(map, data);
      checkIdImage(map, im.width, im.height, pixels);
      contactPairs(im.width, im.height, pixels);
      factionOrder(map);
      entryKind(map.territories[0]!);
      isSeaZone(map.territories[0] as never);
      isValidName(data.factions[0]!.name);
      isValidColor('#00ff7a');
      encodePixel(5);
      decodePixel(0, 0, 5);
    }).not.toThrow();

    expect({ map, data, pixels }).toStrictEqual(before);
  });

  it('FR-104 deep-frozen invalid inputs never throw and stay deep-equal', () => {
    const map = deepFreeze(structuredClone(invalidMap));
    const goodMap = deepFreeze(twoLandMap());
    const data = deepFreeze(structuredClone(invalidPresentation));
    const bad = deepFreeze([1, 2, 16777216, -0, 1.5, NaN]);
    const dup = deepFreeze([1, 1, 7, 7]);
    const before = structuredClone({ map, goodMap, data, bad, dup });

    expect(() => {
      validateMap(map);
      checkPresentation(map, data);
      checkPresentation(goodMap, data);
      checkIdImage(map, 2, 1, dup);
      checkIdImage(goodMap, 6, 1, bad);
      checkIdImage(goodMap, 2, 2, dup);
      contactPairs(6, 1, bad);
      contactPairs(2, 2, dup);
      factionOrder(map);
      factionOrder(goodMap);
      entryKind(map.territories[0]!);
      isSeaZone(map.territories[0]!);
      isValidName(' padded ');
      isValidColor('red');
      encodePixel(16777216);
      decodePixel(256, 0, 0);
    }).not.toThrow();

    expect({ map, goodMap, data, bad, dup }).toStrictEqual(before);
  });

  it('FR-104 names are reported, never normalized or trimmed', () => {
    const data = deepFreeze({
      factions: [{ id: 10, name: ' Aragon ' }, { id: 20, name: 'Castilla' }],
      territories: [{ id: 1, name: 'Huesca' }, { id: 2, name: 'Burgos' }],
    });
    const r = checkPresentation(deepFreeze(twoLandMap()), data);
    expect(r.ok).toBe(false);
    expect(data.factions[0]!.name).toBe(' Aragon ');
  });
});
