import { beforeAll, describe, expect, it } from 'vitest';
import { getRounds, getState, ownerOf, totalRounds } from '@mbrg/sim';
import { parseAddress } from '../src/core/address';
import { decodeIdPng } from '../src/core/png';
import { REVIEW_POINTS, REVIEW_SET, TERRITORY_LINE_ZOOMS, reviewAddress } from '../src/core/review-set';
import type { ReviewScene } from '../src/core/review-set';
import { TERRITORY_LINE } from '../src/core/theme';
import { inflateStream } from '../src/ui/load';
import { DEV_MAP, DEV_PRESENTATION, devPngBytes } from './helpers/dev-map';

// NFR-27: the review set is fixed data; each point must hold what its label says on the committed dev map.
let width = 0;
let values: Uint32Array = new Uint32Array(0);
beforeAll(async () => {
  const decoded = await decodeIdPng(devPngBytes(), inflateStream);
  if (!decoded.ok) throw new Error('png');
  width = decoded.value.width;
  values = decoded.value.values;
});

const pixel = (x: number, y: number): number =>
  x < 0 || y < 0 || x >= width || y >= width ? 0 : values[Math.floor(y) * width + Math.floor(x)]!;
const isSea = (id: number): boolean => (DEV_MAP.territories.find((t) => t.id === id) as { kind?: string } | undefined)?.kind === 'sea';
const isLand = (id: number): boolean => id !== 0 && !isSea(id);
const idOfName = (name: string): number => DEV_PRESENTATION.territories.find((t) => t.name === name)!.id;
const scene = (label: string): ReviewScene => REVIEW_SET.find((s) => s.label === label)!;
const ownersAt = (round: number): Map<number, number> => {
  const state = getState(DEV_MAP, 1, round);
  if (!state.ok) throw new Error('sim');
  const owners = new Map<number, number>();
  for (const t of DEV_MAP.territories) if (isLand(t.id)) owners.set(t.id, ownerOf(state.value, t.id)!);
  return owners;
};
/** The two pixel values across a vertical edge at (x, y): left and right. */
const across = (p: { x: number; y: number }): [number, number] => [pixel(p.x - 1, p.y), pixel(p.x, p.y)];
const near = (p: { x: number; y: number }, radius: number, pred: (id: number) => boolean): boolean => {
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (Math.hypot(dx, dy) <= radius && pred(pixel(p.x + dx, p.y + dy))) return true;
    }
  }
  return false;
};

describe('NFR-27 the review set addresses', () => {
  it('NFR-27 the labels are unique kebab-case words and the set covers seed 1 rounds 0, 1, 2 and 4 at fit', () => {
    const labels = REVIEW_SET.map((s) => s.label);
    expect(new Set(labels).size).toBe(labels.length);
    for (const label of labels) expect(label).toMatch(/^[a-z]+(-[a-z0-9]+)*$/);
    for (const round of [0, 1, 2, 4]) {
      expect(REVIEW_SET.some((s) => s.camera === undefined && s.round === round && s.seed === 1), `fit round ${round}`).toBe(true);
    }
    expect(REVIEW_SET.every((s) => s.seed === 1)).toBe(true);
  });

  it('NFR-27 every address parses with no problem and reads back the same scene', () => {
    const total = totalRounds(DEV_MAP);
    if (!total.ok) throw new Error('total');
    const image = { w: width, h: width };
    const viewport = { width: 1920, height: 1080 };
    for (const s of REVIEW_SET) {
      const parsed = parseAddress(reviewAddress(s), total.value, image, viewport);
      expect(parsed.problems, s.label).toStrictEqual([]);
      expect(parsed.seed, s.label).toBe(s.seed);
      expect(parsed.round, s.label).toBe(s.round);
      expect(parsed.round, s.label).toBeLessThanOrEqual(total.value);
      if (s.camera === undefined) expect(parsed.camera, s.label).toBeUndefined();
      else {
        expect(parsed.camera, s.label).toBeDefined();
        expect(parsed.camera!.x, s.label).toBeCloseTo(s.camera.x, 1);
        expect(parsed.camera!.y, s.label).toBeCloseTo(s.camera.y, 1);
        // the zoom of the small territory scene is the fit scale of the reference window (clamped up to it)
        expect(parsed.camera!.scale, s.label).toBeGreaterThanOrEqual(Math.min(s.camera.zoom, 32) - 1e-9);
      }
    }
  });

  it('NFR-27 every zoomed scene is at a scale of 8 or more, except the fit scenes and the territory line scenes', () => {
    for (const s of REVIEW_SET) {
      if (s.camera === undefined || s.label.startsWith('territory-line') || s.label === 'small-territory-fit') continue;
      expect(s.camera.zoom, s.label).toBeGreaterThanOrEqual(8);
    }
  });
});

describe('NFR-27 each point holds what its label says', () => {
  it('NFR-27 the faction border is an edge between two land territories of different factions at round 0 (Espana, Francia)', () => {
    const owners = ownersAt(0);
    const [a, b] = across(REVIEW_POINTS.factionBorder);
    expect(isLand(a) && isLand(b)).toBe(true);
    expect(new Set([owners.get(a), owners.get(b)])).toStrictEqual(new Set([2, 3]));
  });

  it('NFR-27 the former border is a faction edge at round 0 and an edge inside one faction at round 1, with a transferred territory on one side', () => {
    const [a, b] = across(REVIEW_POINTS.formerBorder);
    const before = ownersAt(0);
    const after = ownersAt(1);
    expect(isLand(a) && isLand(b)).toBe(true);
    expect(before.get(a)).not.toBe(before.get(b));
    expect(after.get(a)).toBe(after.get(b));
    const records = getRounds(DEV_MAP, 1, 1);
    if (!records.ok) throw new Error('rounds');
    const transferred = records.value[0]!.transferred;
    expect(transferred.includes(a) || transferred.includes(b)).toBe(true);
  });

  it('NFR-27 the Baleares point is a pixel of Islas Baleares', () => {
    expect(pixel(REVIEW_POINTS.baleares.x, REVIEW_POINTS.baleares.y)).toBe(idOfName('Islas Baleares'));
  });

  it('NFR-27 the Messina point is a sea pixel with Sicilia and Calabria within 20 units', () => {
    const p = REVIEW_POINTS.messina;
    expect(isSea(pixel(p.x, p.y))).toBe(true);
    expect(near(p, 20, (id) => id === idOfName('Sicilia'))).toBe(true);
    expect(near(p, 20, (id) => id === idOfName('Calabria'))).toBe(true);
  });

  it('NFR-27 the sea-zone point is an edge between two sea zones with land within 10 units', () => {
    const [a, b] = across(REVIEW_POINTS.seaZoneCoast);
    expect(isSea(a) && isSea(b) && a !== b).toBe(true);
    expect(near(REVIEW_POINTS.seaZoneCoast, 10, isLand)).toBe(true);
  });

  it('NFR-27 the lagoon point is sea water in a piece that touches only land (spec 003c: enclosed water is sea)', () => {
    const start = Math.floor(REVIEW_POINTS.lagoon.y) * width + Math.floor(REVIEW_POINTS.lagoon.x);
    const id = values[start]!;
    expect(isSea(id)).toBe(true);
    const seen = new Set<number>([start]);
    const queue = [start];
    for (let head = 0; head < queue.length; head++) {
      const p = queue[head]!;
      const x = p % width;
      for (const q of [x > 0 ? p - 1 : -1, x < width - 1 ? p + 1 : -1, p - width, p + width]) {
        if (q < 0 || q >= values.length) continue;
        const v = values[q]!;
        if (v === id) {
          if (!seen.has(q)) {
            seen.add(q);
            queue.push(q);
          }
        } else {
          expect(isLand(v), `the piece touches value ${v}`).toBe(true);
        }
      }
    }
    expect(seen.size).toBeGreaterThanOrEqual(50);
  });

  it('NFR-27 the small territory scene is centred inside the land territory with the fewest map units', () => {
    const counts = new Map<number, number>();
    for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
    const land = [...counts].filter(([id]) => isLand(id)).sort((a, b) => a[1] - b[1] || a[0] - b[0]);
    expect(pixel(REVIEW_POINTS.smallTerritory.x, REVIEW_POINTS.smallTerritory.y)).toBe(land[0]![0]);
    expect(scene('small-territory-fit').round).toBe(0);
  });

  it('NFR-27 the territory line scenes sit on the former border at round 1 at a far, a mid and a near scale of the current parameters', () => {
    const far = scene('territory-line-far');
    const mid = scene('territory-line-mid');
    const near = scene('territory-line-near');
    for (const s of [far, mid, near]) {
      expect(s.round, s.label).toBe(1);
      expect(s.camera!.x, s.label).toBe(REVIEW_POINTS.formerBorder.x);
      expect(s.camera!.y, s.label).toBe(REVIEW_POINTS.formerBorder.y);
    }
    expect(far.camera!.zoom).toBe(TERRITORY_LINE_ZOOMS.far);
    expect(far.camera!.zoom).toBeLessThanOrEqual(TERRITORY_LINE.fadeStart);
    expect(mid.camera!.zoom).toBeGreaterThan(TERRITORY_LINE.fadeStart);
    expect(mid.camera!.zoom).toBeLessThan(TERRITORY_LINE.fadeFull);
    expect(near.camera!.zoom).toBe(32);
  });
});
