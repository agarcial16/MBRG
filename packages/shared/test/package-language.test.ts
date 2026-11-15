import { describe, expect, it } from 'vitest';
import {
  ID_IMAGE_KIND_ORDER,
  PRESENTATION_KIND_ORDER,
  checkIdImage,
  checkPresentation,
  contactPairs,
  decodePixel,
  encodePixel,
} from '../src/index';
import { image, mapOf, twoLandMap, twoLandPresentation } from './helpers/package-fixtures';

// Literal lists copied from the spec (FR-92 and FR-110 tables), not imported from src.
const PRESENTATION_KINDS = [
  'invalid-presentation',
  'invalid-presentation-list',
  'invalid-presentation-entry',
  'invalid-presentation-id',
  'duplicate-presentation-id',
  'invalid-name',
  'invalid-color',
  'presentation-unknown-field',
  'unknown-presentation-id',
  'missing-presentation',
  'duplicate-faction-name',
  'duplicate-color',
];
const IMAGE_KINDS = [
  'invalid-image',
  'unknown-pixel-id',
  'missing-territory-pixels',
  'missing-adjacency',
  'extra-adjacency',
];
// Data fields of FR-92 and FR-110 (including the nested ones of `location` and `firstPixel`).
const DATA_FIELDS = [
  'list', 'position', 'positions', 'id', 'location', 'at', 'field', 'name', 'factions', 'color',
  'pixelCount', 'firstPixel', 'x', 'y', 'territory', 'a', 'b',
];
const ALLOWED_KEYS = ['kind', ...DATA_FIELDS];

type Err = Record<string, unknown>;

/** Inputs chosen so that, together, the presentation check produces every kind. */
function presentationErrors(): Err[] {
  const out: Err[] = [];
  const add = (r: { ok: boolean; errors?: unknown }) => {
    if (!r.ok) out.push(...(r.errors as Err[]));
  };
  const map = twoLandMap();
  add(checkPresentation(map, null));
  add(checkPresentation(map, {}));
  add(
    checkPresentation(map, {
      version: 1,
      factions: [
        3,
        { id: 'x', name: 'A' },
        { id: 10, name: 'Aragon', anchor: 1 },
        { id: 10, name: '', color: '#GGGGGG' },
        { name: 'Sin id', color: 'red' },
      ],
      territories: [{ id: 1, name: 'Huesca', color: '#00ff7a' }, { id: 2, name: 'Burgos' }],
    }),
  );
  // Relational kinds: three factions, one without entry, one unknown, shared name and colour.
  const three = mapOf([1, 2, 3], [[1, 2], [2, 3]]);
  add(
    checkPresentation(three, {
      factions: [
        { id: 1001, name: 'Igual', color: '#00ff7a' },
        { id: 1002, name: 'Igual', color: '#00ff7a' },
        { id: 99, name: 'Ajena' },
      ],
      territories: [{ id: 1, name: 'Uno' }, { id: 77, name: 'Otro' }],
    }),
  );
  return out;
}

/** Inputs chosen so that, together, the id image check produces every kind. */
function imageErrors(): Err[] {
  const out: Err[] = [];
  const add = (r: { ok: boolean; errors?: unknown }) => {
    if (!r.ok) out.push(...(r.errors as Err[]));
  };
  add(checkIdImage(twoLandMap(), 2, 1, 'not pixels'));
  add(contactPairs(0, 0, []));
  add(encodePixel(-1));
  add(decodePixel(256, 0, 0));
  const map = mapOf([1, 2, 3, 4], [[1, 2], [2, 3], [1, 4]]);
  const im = image(['A.CD9'], { A: 1, C: 3, D: 4, '9': 9 });
  add(checkIdImage(map, im.width, im.height, im.pixels));
  return out;
}

/** Keys of an error and of the plain objects nested in it (`location`, `firstPixel`). */
function keysOf(value: unknown, into: Set<string>): void {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return;
  for (const [k, v] of Object.entries(value)) {
    into.add(k);
    keysOf(v, into);
  }
}

describe('NFR-18 language of the map package contracts', () => {
  it('NFR-18 the kind lists in the source equal the literal spec lists, in table order', () => {
    expect([...PRESENTATION_KIND_ORDER]).toStrictEqual(PRESENTATION_KINDS);
    expect([...ID_IMAGE_KIND_ORDER]).toStrictEqual(IMAGE_KINDS);
  });

  it('NFR-18 every presentation error kind produced is in the literal list, and all are produced', () => {
    const kinds = new Set(presentationErrors().map((e) => e.kind as string));
    for (const k of kinds) expect(PRESENTATION_KINDS).toContain(k);
    expect([...kinds].sort()).toStrictEqual([...PRESENTATION_KINDS].sort());
  });

  it('NFR-18 every id image error kind produced is in the literal list, and all are produced', () => {
    const kinds = new Set(imageErrors().map((e) => e.kind as string));
    for (const k of kinds) expect(IMAGE_KINDS).toContain(k);
    expect([...kinds].sort()).toStrictEqual([...IMAGE_KINDS].sort());
  });

  it('NFR-18 every key of every produced error is a listed data field, and every listed field is produced', () => {
    const produced = new Set<string>();
    for (const e of [...presentationErrors(), ...imageErrors()]) keysOf(e, produced);
    for (const k of produced) expect(ALLOWED_KEYS, k).toContain(k);
    expect([...produced].sort()).toStrictEqual([...ALLOWED_KEYS].sort());
  });

  it('NFR-18 the US spelling color is used and colour appears in no kind, field or error', () => {
    expect([...PRESENTATION_KINDS, ...IMAGE_KINDS, ...DATA_FIELDS].some((s) => /colour/i.test(s))).toBe(false);
    expect(DATA_FIELDS).toContain('color');
    expect(JSON.stringify([...presentationErrors(), ...imageErrors()])).not.toMatch(/colour/i);
    // a valid package produces no error at all, so the rule above is not satisfied by silence
    expect(checkPresentation(twoLandMap(), twoLandPresentation()).ok).toBe(true);
  });
});
