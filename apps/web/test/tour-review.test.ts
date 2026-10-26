import { describe, expect, it } from 'vitest';
import { getState } from '@mbrg/sim';
import { fitScale } from '../src/core/camera';
import { buildEntryIndex, factionIndexOf, ownerTable } from '../src/core/entries';
import { decodeIdPng } from '../src/core/png';
import { TOUR_PARAMS } from '../src/core/tour-params';
import { framingBoxOf } from '../src/core/tour-camera';
import { inflateStream } from '../src/ui/load';
import toursText from './golden/tours.json?raw';
import type { GoldenRound } from './golden/tours-model';
import { DEV_MAP, devPngBytes } from './helpers/dev-map';
import { framePinsAspects } from './helpers/tour-pins-boxes';

// NFR-62 (pure part): the rounds of seed 1 that the screenshots need, found by a test and pinned. The screenshots and their review are
// the visual part (the review page, outside git).
const golden = (JSON.parse(toursText) as { rounds: GoldenRound[] }).rounds;

describe('NFR-62 (pure part) the review rounds of the dev map, seed 1', () => {
  it('NFR-62 (pure part) the victim tour of round 1 has 5 participants and the last round T = 4 has 2', () => {
    expect(golden[0]!.participants).toHaveLength(5);
    expect(golden.at(-1)!.round).toBe(4);
    expect(golden.at(-1)!.participants).toHaveLength(2);
  });

  it('NFR-62 (pure part) the first round with d >= 3 does not exist on the dev map (the largest d is 2); the first with d = 2 is round 3', () => {
    expect(golden.map((r) => r.candidates.length)).toStrictEqual([1, 1, 2, 1]);
    expect(golden.find((r) => r.candidates.length >= 3)).toBeUndefined();
    expect(golden.find((r) => r.candidates.length === 2)!.round).toBe(3);
  });

  it('NFR-62 (pure part) the smallest victim by area is the one of round 2 (59,375 map units) and it is not tiny at the overview', async () => {
    const png = await decodeIdPng(devPngBytes(), inflateStream);
    if (!png.ok) throw new Error('png');
    const index = buildEntryIndex(DEV_MAP, png.value.width, png.value.height, png.value.values);
    const factionIndex = factionIndexOf(DEV_MAP);
    const fit = fitScale({ w: png.value.width, h: png.value.height }, { width: 1920, height: 1080 });
    const found = golden.map((r) => {
      const state = getState(DEV_MAP, 1, r.round - 1);
      if (!state.ok) throw new Error('state');
      const table = ownerTable(index, new Map(state.value.owners), factionIndex);
      const victim = factionIndex.get(r.victim)!;
      let area = 0;
      for (let i = 0; i < index.cells.length; i++) {
        const e = index.cells[i]!;
        if (index.fills[e] === 'land' && table[e] === victim) area++;
      }
      const box = framingBoxOf(framePinsAspects(index, table, factionIndex, { aspect: 4 }), table, [victim])!;
      return { round: r.round, area, w: (box.x1 - box.x0) * fit, h: (box.y1 - box.y0) * fit };
    });
    expect(found.map((f) => f.area)).toStrictEqual([240673, 59375, 396505, 599490]);
    const smallest = found.reduce((a, b) => (b.area < a.area ? b : a));
    expect(smallest.round).toBe(2);
    // On screen at the overview its box is 139 x 249 px: far above the 24 px of the marker rule, so no marker case exists on this map.
    expect(smallest.w).toBeGreaterThan(TOUR_PARAMS.tinyPx);
    expect(smallest.h).toBeGreaterThan(TOUR_PARAMS.tinyPx);
    expect(Math.round(smallest.w)).toBe(139);
    expect(Math.round(smallest.h)).toBe(249);
    for (const f of found) expect(Math.min(f.w, f.h), `round ${f.round}`).toBeGreaterThan(TOUR_PARAMS.tinyPx);
  });
});
