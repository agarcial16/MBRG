import { describe, expect, it } from 'vitest';
import { checkIdImage } from '../src/id-image';
import { validateMap } from '../src/validate';
import { image, mapOf } from './helpers/package-fixtures';

const L = { A: 1, B: 2, C: 3, D: 4, S: 5, U: 900, V: 901 };

function check(map: unknown, rows: string[], legend: Record<string, number> = L) {
  const im = image(rows, legend);
  return checkIdImage(map, im.width, im.height, im.pixels);
}

describe('FR-107 FR-109 FR-110 id image check', () => {
  it('FR-109 a map with a bad structure returns exactly the map validation errors', () => {
    const bad = { territories: [{ id: 0, owner: 1, neighbors: [] }] };
    const expected = validateMap(bad);
    expect(expected.ok).toBe(false);
    const im = image(['AB'], L);
    expect(checkIdImage(bad, im.width, im.height, im.pixels)).toStrictEqual(expected);
    // even when the image is also invalid, only the map errors are reported
    expect(checkIdImage(bad, 0, 0, [])).toStrictEqual(expected);
  });

  it('FR-109 a valid package returns ok with the same width, height and pixels', () => {
    const map = mapOf([1, 2], [[1, 2]]);
    const im = image(['AB'], L);
    const r = checkIdImage(map, im.width, im.height, im.pixels);
    expect(r).toStrictEqual({ ok: true, value: { width: 2, height: 1, pixels: [1, 2] } });
    if (r.ok) expect(r.value.pixels).toBe(im.pixels);
  });

  it('FR-110 invalid-image is reported alone for every invalid input', () => {
    const map = mapOf([1, 2], [[1, 2]]);
    const alone = { ok: false, errors: [{ kind: 'invalid-image' }] };
    const holes = new Array<number>(3);
    holes[0] = 1;
    holes[2] = 2;
    const cases: Array<[unknown, unknown, unknown]> = [
      [2, 2, [1, 2, 0]], // W x H mismatch
      [2, 1, [1, 16777216]],
      [2, 1, [1, -1]],
      [2, 1, [1, 1.5]],
      [2, 1, [1, -0]],
      [2, 1, [1, NaN]],
      [2, 1, [1, '1']],
      [2, 1, [1, 2n]],
      [3, 1, holes],
      ['2', 1, [1, 2]],
      [2, 1, { length: 2, 0: 1, 1: 2 }],
      [0, 1, []],
      [1, 0, []],
      [2, 1, null],
    ];
    for (const [w, h, p] of cases) {
      expect(checkIdImage(map, w, h, p)).toStrictEqual(alone);
    }
  });

  it('FR-110 unknown-pixel-id has id, pixelCount and firstPixel; one error per value by first pixel', () => {
    const map = mapOf([1, 2], [[1, 2]]);
    const r = check(map, ['ABU.', 'VVU.', '....']);
    expect(r).toStrictEqual({
      ok: false,
      errors: [
        { kind: 'unknown-pixel-id', id: 900, pixelCount: 2, firstPixel: { x: 2, y: 0 } },
        { kind: 'unknown-pixel-id', id: 901, pixelCount: 2, firstPixel: { x: 0, y: 1 } },
      ],
    });
  });

  it('FR-107 FR-110 missing-territory-pixels lists entries without pixels in map order', () => {
    const map = mapOf([3, 1, 2], [[3, 1], [1, 2]]);
    expect(check(map, ['B..'])).toStrictEqual({
      ok: false,
      errors: [
        { kind: 'missing-territory-pixels', territory: 3 },
        { kind: 'missing-territory-pixels', territory: 1 },
        { kind: 'extra-adjacency', a: 3, b: 1 },
        { kind: 'extra-adjacency', a: 1, b: 2 },
      ],
    });
  });

  it('FR-107 a sea zone entry also needs pixels', () => {
    const map = mapOf([1, 2, 5], [[1, 5], [2, 5]], [5]);
    expect(check(map, ['AB'])).toStrictEqual({
      ok: false,
      errors: [
        { kind: 'missing-territory-pixels', territory: 5 },
        { kind: 'missing-adjacency', a: 1, b: 2 },
        { kind: 'extra-adjacency', a: 1, b: 5 },
        { kind: 'extra-adjacency', a: 2, b: 5 },
      ],
    });
  });

  it('FR-108 FR-110 missing-adjacency: contact without a link, ordered by map position not id', () => {
    // map order 30, 10, 20, 40; every entry is linked to 40 only (a star keeps the map connected)
    const star = (ids: number[]) => mapOf(ids, [[40, 30], [40, 10], [40, 20]]);
    const legend = { X: 30, Y: 10, Z: 20, W: 40 };
    expect(check(star([30, 10, 20, 40]), ['XYZ', 'WWW'], legend)).toStrictEqual({
      ok: false,
      errors: [
        { kind: 'missing-adjacency', a: 30, b: 10 },
        { kind: 'missing-adjacency', a: 10, b: 20 },
      ],
    });
    // same a, b order differs from id order: map order 30, 20, 10, 40
    expect(check(star([30, 20, 10, 40]), ['YXZ', 'WWW'], legend)).toStrictEqual({
      ok: false,
      errors: [
        { kind: 'missing-adjacency', a: 30, b: 20 },
        { kind: 'missing-adjacency', a: 30, b: 10 },
      ],
    });
  });

  it('FR-108 FR-110 extra-adjacency: links without contact, ordered by map position not id', () => {
    const map = mapOf([30, 10, 20], [[30, 10], [30, 20], [10, 20]]);
    const legend = { X: 30, Y: 10, Z: 20 };
    expect(check(map, ['X.Y.Z'], legend)).toStrictEqual({
      ok: false,
      errors: [
        { kind: 'extra-adjacency', a: 30, b: 10 },
        { kind: 'extra-adjacency', a: 30, b: 20 },
        { kind: 'extra-adjacency', a: 10, b: 20 },
      ],
    });
  });

  it('FR-108 quadripoint with A-D linked is extra-adjacency; the four contacts linked is valid', () => {
    const ok = mapOf([1, 2, 3, 4], [[1, 2], [1, 3], [2, 4], [3, 4]]);
    expect(check(ok, ['AB', 'CD']).ok).toBe(true);
    const withDiagonal = mapOf([1, 2, 3, 4], [[1, 2], [1, 3], [2, 4], [3, 4], [1, 4]]);
    expect(check(withDiagonal, ['AB', 'CD'])).toStrictEqual({
      ok: false,
      errors: [{ kind: 'extra-adjacency', a: 1, b: 4 }],
    });
  });

  it('FR-108 touching through background gives no link: linked is extra, unlinked is valid', () => {
    const rows = ['A.B', 'CCC'];
    expect(check(mapOf([1, 2, 3], [[1, 3], [2, 3]]), rows).ok).toBe(true);
    expect(check(mapOf([1, 2, 3], [[1, 3], [2, 3], [1, 2]]), rows)).toStrictEqual({
      ok: false,
      errors: [{ kind: 'extra-adjacency', a: 1, b: 2 }],
    });
  });

  it('FR-108 a strait drawn as a sea zone is valid; a direct link across it is extra-adjacency', () => {
    const rows = ['ASB'];
    const viaSea = mapOf([1, 2, 5], [[1, 5], [2, 5]], [5]);
    expect(check(viaSea, rows).ok).toBe(true);
    const direct = mapOf([1, 2, 5], [[1, 5], [2, 5], [1, 2]], [5]);
    expect(check(direct, rows)).toStrictEqual({
      ok: false,
      errors: [{ kind: 'extra-adjacency', a: 1, b: 2 }],
    });
  });

  it('FR-108 a single 4-adjacent pair needs a link', () => {
    const rows = ['AB', 'CC'];
    expect(check(mapOf([1, 2, 3], [[1, 3], [2, 3]]), rows)).toStrictEqual({
      ok: false,
      errors: [{ kind: 'missing-adjacency', a: 1, b: 2 }],
    });
    expect(check(mapOf([1, 2, 3], [[1, 3], [2, 3], [1, 2]]), rows).ok).toBe(true);
  });

  it('FR-108 an entry with several pieces (exclave) is valid; contacts are the union', () => {
    const map = mapOf([1, 2, 3], [[1, 2], [1, 3]]);
    expect(check(map, ['AB.AC']).ok).toBe(true);
  });

  it('FR-110 an unknown id touching two entries yields one unknown-pixel-id and no adjacency error', () => {
    const map = mapOf([1, 2, 3], [[1, 3], [2, 3]]);
    expect(check(map, ['AUB', 'CCC'])).toStrictEqual({
      ok: false,
      errors: [{ kind: 'unknown-pixel-id', id: 900, pixelCount: 1, firstPixel: { x: 1, y: 0 } }],
    });
  });

  it('FR-110 a linked entry without pixels: missing-territory-pixels plus one extra-adjacency per link', () => {
    const map = mapOf([1, 2, 3], [[1, 2], [1, 3], [2, 3]]);
    expect(check(map, ['BC'])).toStrictEqual({
      ok: false,
      errors: [
        { kind: 'missing-territory-pixels', territory: 1 },
        { kind: 'extra-adjacency', a: 1, b: 2 },
        { kind: 'extra-adjacency', a: 1, b: 3 },
      ],
    });
  });

  it('FR-108 the same image against a map with other links gives other adjacency errors', () => {
    const rows = ['AB', 'C.'];
    const a = mapOf([1, 2, 3], [[1, 2], [1, 3]]);
    const b = mapOf([1, 2, 3], [[1, 2], [2, 3]]);
    expect(check(a, rows).ok).toBe(true);
    expect(check(b, rows)).toStrictEqual({
      ok: false,
      errors: [
        { kind: 'missing-adjacency', a: 1, b: 3 },
        { kind: 'extra-adjacency', a: 2, b: 3 },
      ],
    });
  });

  it('FR-110 all kinds at once come in table order', () => {
    // map order 50, 30, 90, 70, 20; 70 has no pixels
    const map = mapOf([50, 30, 90, 70, 20], [[50, 90], [30, 90], [70, 20], [90, 20]]);
    const legend = { A: 50, B: 30, C: 90, D: 20, U: 900, V: 5 };
    expect(check(map, ['ABCU', 'VVD.'], legend)).toStrictEqual({
      ok: false,
      errors: [
        { kind: 'unknown-pixel-id', id: 900, pixelCount: 1, firstPixel: { x: 3, y: 0 } },
        { kind: 'unknown-pixel-id', id: 5, pixelCount: 2, firstPixel: { x: 0, y: 1 } },
        { kind: 'missing-territory-pixels', territory: 70 },
        { kind: 'missing-adjacency', a: 50, b: 30 },
        { kind: 'extra-adjacency', a: 50, b: 90 },
        { kind: 'extra-adjacency', a: 70, b: 20 },
      ],
    });
  });
});
