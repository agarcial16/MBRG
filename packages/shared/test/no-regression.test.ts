import { describe, expect, it } from 'vitest';
import * as shared from '../src/index';
import * as sim from '../../sim/src/index';

// Runtime exports that existed before spec 003a (specs 001 and 002).
const PRE_003A_SHARED = [
  'VALIDATION_KIND_ORDER',
  'isValidId',
  'MAX_ID',
  'validateMap',
  'entryKind',
  'isSeaZone',
];

// Runtime exports added by spec 003a (additive only, pinned).
const ADDED_BY_003A = [
  'PRESENTATION_KIND_ORDER',
  'ID_IMAGE_KIND_ORDER',
  'isValidName',
  'isValidColor',
  'factionOrder',
  'checkPresentation',
  'encodePixel',
  'decodePixel',
  'contactPairs',
  'checkIdImage',
];

describe('no regression', () => {
  it('NFR-22 the sim package exports exactly its pre-003a public surface', () => {
    expect(Object.keys(sim).sort()).toStrictEqual(
      ['MODE', 'getRounds', 'getState', 'ownerOf', 'totalRounds'].sort(),
    );
  });

  it('NFR-22 the shared package keeps every pre-003a export and adds exactly the 003a ones', () => {
    const exported = Object.keys(shared);
    for (const name of PRE_003A_SHARED) expect(exported).toContain(name);
    expect(exported.sort()).toStrictEqual([...PRE_003A_SHARED, ...ADDED_BY_003A].sort());
  });
});
