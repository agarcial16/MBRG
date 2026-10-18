import { beforeAll, describe, expect, it } from 'vitest';
import { getRounds, getState, ownerOf, totalRounds } from '@mbrg/sim';
import { parseAddress } from '../src/core/address';
import { buildEntryIndex, factionIndexOf, ownerTable } from '../src/core/entries';
import type { EntryIndex } from '../src/core/entries';
import { contactSet, transferredPieces } from '../src/core/front';
import { factionBoxes, territoryBoxes } from '../src/core/label-layout';
import type { LabelBox } from '../src/core/label-layout';
import { LABEL_PARAMS } from '../src/core/label-params';
import {
  EMPTY_CONTACT,
  EMPTY_CONTACT_SEEDS,
  FROZEN_VALUES,
  LABEL_REVIEW_SET,
  LABEL_SCALES,
  labelReviewAddress,
} from '../src/core/label-review-set';
import type { LabelReviewScene } from '../src/core/label-review-set';
import { decodeIdPng } from '../src/core/png';
import { buildPieceIndex, mainRegions, regionsOf } from '../src/core/regions';
import type { PieceIndex } from '../src/core/regions';
import { REVIEW_POINTS } from '../src/core/review-set';
import { sceneAt } from '../src/core/scene';
import type { SimPort } from '../src/core/scene';
import { inflateStream } from '../src/ui/load';
import { DEV_MAP, DEV_PRESENTATION, devPngBytes } from './helpers/dev-map';

// NFR-34: the label review set is fixed data; each scene must hold what its label says on the committed dev map.
const REAL: SimPort = { totalRounds, getState, getRounds, ownerOf };
const VIEWPORT = { width: 1920, height: 1080 };
const P = LABEL_PARAMS;
const scene = (label: string): LabelReviewScene => LABEL_REVIEW_SET.find((s) => s.label === label)!;

let index: EntryIndex;
let pieces: PieceIndex;
let imageWidth = 0;
const factionIndex = factionIndexOf(DEV_MAP);
const ownersAt = (seed: number, round: number): Uint8Array => {
  const s = sceneAt(DEV_MAP, DEV_PRESENTATION, seed, round, REAL);
  if (!s.ok) throw new Error('scene');
  return ownerTable(index, s.value.owners, factionIndex);
};
const plain = (name: string): string => name.normalize('NFD').replace(/\p{M}/gu, '');
const entryOfName = (name: string): number => {
  const id = DEV_PRESENTATION.territories.find((t) => plain(t.name) === name)!.id;
  return index.indexOf.get(id)!;
};
const factionOfName = (name: string): number => {
  const id = DEV_PRESENTATION.factions.find((f) => plain(f.name) === name)!.id;
  return factionIndex.get(id)!;
};
const FACTION_ASPECTS = new Map<number, number>([...factionIndex.values()].map((f) => [f, 4]));

beforeAll(async () => {
  const decoded = await decodeIdPng(devPngBytes(), inflateStream);
  if (!decoded.ok) throw new Error('png');
  imageWidth = decoded.value.width;
  index = buildEntryIndex(DEV_MAP, decoded.value.width, decoded.value.height, decoded.value.values);
  pieces = buildPieceIndex(index);
});

/** Whether the box (with its margin) lies in the given pieces. */
function boxInPieces(box: LabelBox, set: readonly number[]): boolean {
  const own = new Set(set);
  const fw = Math.floor(box.w - 0.5);
  for (let y = box.y0 - P.margin; y <= box.y0 + box.h + P.margin - 1; y++) {
    for (let x = box.x0 - P.margin; x <= box.x0 + P.margin + fw; x++) {
      if (x < 0 || y < 0 || x >= pieces.width || y >= pieces.height) return false;
      if (!own.has(pieces.pieceOf[y * pieces.width + x]!)) return false;
    }
  }
  return true;
}

/** Whether a box lies at least partly inside the viewport of a camera. */
function inView(box: LabelBox, cam: { x: number; y: number; zoom: number }): boolean {
  const halfW = VIEWPORT.width / 2 / cam.zoom;
  const halfH = VIEWPORT.height / 2 / cam.zoom;
  return box.x0 + box.w > cam.x - halfW && box.x0 < cam.x + halfW && box.y0 + box.h > cam.y - halfH && box.y0 < cam.y + halfH;
}

describe('NFR-34 FR-169 FR-172 FR-182 the label parameters approved by the user in T9 (2026-10-16)', () => {
  it('NFR-34 the chosen literals are pinned (L0 / L1 follow the territory lines of 004: 1.5 / 2)', () => {
    expect(P).toStrictEqual({
      font: { weight: 600, families: ['"Segoe UI"', '"Helvetica Neue"', 'Arial', 'sans-serif'] },
      margin: 2,
      maxHeight: 120,
      minPx: 9,
      fadeStart: 1.5,
      fadeFull: 2,
      durationMs: 1500,
    });
  });
});

describe('FR-169 FR-172 FR-182 the label parameters lie inside the spec ranges', () => {
  it('FR-169 the margin and the largest height are whole numbers inside their ranges', () => {
    expect(Number.isInteger(P.margin) && P.margin >= 1 && P.margin <= 4).toBe(true);
    expect(Number.isInteger(P.maxHeight) && P.maxHeight >= 20 && P.maxHeight <= 200).toBe(true);
  });

  it('FR-172 the minimum size and the fade scales lie inside their ranges', () => {
    expect(P.minPx).toBeGreaterThanOrEqual(6);
    expect(P.minPx).toBeLessThanOrEqual(14);
    expect(P.fadeStart).toBeGreaterThanOrEqual(0.5);
    expect(P.fadeStart).toBeLessThan(P.fadeFull);
    expect(P.fadeFull).toBeLessThanOrEqual(8);
  });

  it('FR-182 the duration lies inside its range and the font list ends with a generic family', () => {
    expect(P.durationMs).toBeGreaterThanOrEqual(800);
    expect(P.durationMs).toBeLessThanOrEqual(3000);
    expect(['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui']).toContain(P.font.families[P.font.families.length - 1]);
    expect(P.font.weight).toBeGreaterThanOrEqual(100);
    expect(P.font.weight).toBeLessThanOrEqual(900);
  });
});

describe('NFR-34 the label review set addresses', () => {
  it('NFR-34 the labels are unique kebab-case words', () => {
    const labels = LABEL_REVIEW_SET.map((s) => s.label);
    expect(new Set(labels).size).toBe(labels.length);
    for (const label of labels) expect(label, label).toMatch(/^[a-z]+(-[a-z0-9]+)*$/);
  });

  it('NFR-34 every address parses with no problem and reads back the same scene and frozen progress', () => {
    const total = totalRounds(DEV_MAP);
    if (!total.ok) throw new Error('total');
    for (const s of LABEL_REVIEW_SET) {
      const parsed = parseAddress(labelReviewAddress(s), total.value, { w: imageWidth, h: imageWidth }, VIEWPORT);
      expect(parsed.problems, s.label).toStrictEqual([]);
      expect(parsed.seed, s.label).toBe(s.seed);
      expect(parsed.round, s.label).toBe(s.round);
      if (s.frozen === undefined) expect(parsed.transition, s.label).toBeUndefined();
      else expect(parsed.transition, s.label).toStrictEqual({ value: Number(s.frozen), text: s.frozen });
      if (s.camera !== undefined) {
        expect(parsed.camera, s.label).toBeDefined();
        expect(parsed.camera!.scale, s.label).toBeGreaterThanOrEqual(Math.min(s.camera.zoom, 32) - 1e-9);
      }
    }
  });

  it('NFR-34 the set covers faction labels at rounds 0, 1 and T of seed 1 at fit scale', () => {
    const total = totalRounds(DEV_MAP);
    if (!total.ok) throw new Error('total');
    for (const round of [0, 1, total.value]) {
      expect(LABEL_REVIEW_SET.some((s) => s.camera === undefined && s.frozen === undefined && s.seed === 1 && s.round === round), `fit round ${round}`).toBe(true);
    }
  });

  it('NFR-34 the crossfade scenes sit below L0, between L0 and L1 and above L1 of the current parameters', () => {
    const below = scene('crossfade-below').camera!.zoom;
    const mid = scene('crossfade-mid').camera!.zoom;
    const above = scene('crossfade-above').camera!.zoom;
    expect(below).toBeLessThan(P.fadeStart);
    expect(mid).toBeGreaterThan(P.fadeStart);
    expect(mid).toBeLessThan(P.fadeFull);
    expect(above).toBeGreaterThan(P.fadeFull);
    expect(above).toBeLessThanOrEqual(32);
    expect([below, mid, above]).toStrictEqual([LABEL_SCALES.belowFade, LABEL_SCALES.midFade, LABEL_SCALES.aboveFade]);
    expect(below).toBeCloseTo(P.fadeStart - 0.25, 9);
    expect(mid).toBeCloseTo((P.fadeStart + P.fadeFull) / 2, 9);
    expect(above).toBeCloseTo(P.fadeFull + 1, 9);
    for (const label of ['crossfade-below', 'crossfade-mid', 'crossfade-above']) {
      expect(scene(label).camera!.x).toBe(REVIEW_POINTS.formerBorder.x);
      expect(scene(label).camera!.y).toBe(REVIEW_POINTS.formerBorder.y);
      expect(scene(label).round).toBe(0);
    }
  });

  it('NFR-34 the step scenes freeze the five forward progress values of round 1, for the whole map and for the island search result', () => {
    expect(FROZEN_VALUES).toStrictEqual(['0', '0.25', '0.5', '0.75', '1']);
    const whole = LABEL_REVIEW_SET.filter((s) => s.label.startsWith('step-') && !s.label.startsWith('step-island'));
    const island = LABEL_REVIEW_SET.filter((s) => s.label.startsWith('step-island'));
    expect(whole.map((s) => s.frozen)).toStrictEqual([...FROZEN_VALUES]);
    expect(island.map((s) => s.frozen)).toStrictEqual([...FROZEN_VALUES]);
    for (const s of whole) expect([s.seed, s.round], s.label).toStrictEqual([1, 1]);
    for (const s of island) expect([s.seed, s.round], s.label).toStrictEqual([EMPTY_CONTACT.seed, EMPTY_CONTACT.round]);
  });
});

describe('NFR-34 FR-167 FR-169 each scene holds what its label says', () => {
  it('NFR-34 FR-167 FR-169 Italia has at least two regions at round 0 and its label box lies in its main region only', () => {
    const owners = ownersAt(1, 0);
    const italia = factionOfName('Italia');
    const regions = regionsOf(pieces, owners).filter((r) => r.owner === italia);
    expect(regions.length).toBeGreaterThanOrEqual(2);
    const main = mainRegions(regionsOf(pieces, owners)).get(italia)!;
    const box = factionBoxes(pieces, owners, FACTION_ASPECTS, P).labels.get(italia)!.box!;
    expect(boxInPieces(box, main.pieces)).toBe(true);
    for (const other of regions) if (other !== main && other.first !== main.first) expect(boxInPieces(box, other.pieces)).toBe(false);
    // the strait scene is centred on the Messina strait and shows the faction labels
    const s = scene('strait-italia');
    expect(s.camera!.x).toBe(REVIEW_POINTS.messina.x);
    expect(s.camera!.y).toBe(REVIEW_POINTS.messina.y);
    expect(s.camera!.zoom).toBeLessThan(P.fadeStart);
    expect(s.round).toBe(0);
  });

  it('NFR-34 FR-167 Espana has the Baleares as a second region and the island scene is centred on Islas Baleares above L1', () => {
    const owners = ownersAt(1, 0);
    const spain = factionOfName('Espana');
    expect(regionsOf(pieces, owners).filter((r) => r.owner === spain).length).toBeGreaterThanOrEqual(2);
    const s = scene('island-baleares');
    const unit = Math.floor(s.camera!.y) * imageWidth + Math.floor(s.camera!.x);
    expect(pieces.entryOf[pieces.pieceOf[unit]!]).toBe(entryOfName('Islas Baleares'));
    expect(s.camera!.zoom).toBeGreaterThan(P.fadeFull);
  });

  it('NFR-34 the dense-area scene holds at least five territory labels drawable at its scale (injected aspect 3)', () => {
    const aspects: number[] = [];
    for (let e = 0; e < index.fills.length; e++) aspects.push(index.fills[e] === 'land' ? 3 : 0);
    const boxes = territoryBoxes(pieces, aspects, P);
    const s = scene('dense-territories');
    expect(s.camera!.zoom).toBeGreaterThan(P.fadeFull);
    let drawable = 0;
    for (const box of boxes) if (box !== undefined && box.h * s.camera!.zoom >= P.minPx && inView(box, s.camera!)) drawable++;
    expect(drawable).toBeGreaterThanOrEqual(5);
    expect(s.camera!.x).toBe(REVIEW_POINTS.smallTerritory.x);
    expect(s.camera!.y).toBe(REVIEW_POINTS.smallTerritory.y);
  });

  it('NFR-34 the crossfade point has faction labels in view below L0 and territory labels in view above L1', () => {
    const owners = ownersAt(1, 0);
    const faction = factionBoxes(pieces, owners, FACTION_ASPECTS, P);
    const below = scene('crossfade-below').camera!;
    const inBelow = [...faction.labels.values()].filter((l) => l.box !== undefined && l.box.h * below.zoom >= P.minPx && inView(l.box, below));
    expect(inBelow.length).toBeGreaterThanOrEqual(1);
    const aspects: number[] = [];
    for (let e = 0; e < index.fills.length; e++) aspects.push(index.fills[e] === 'land' ? 3 : 0);
    const above = scene('crossfade-above').camera!;
    const territories = territoryBoxes(pieces, aspects, P).filter((b) => b !== undefined && b.h * above.zoom >= P.minPx && inView(b, above));
    expect(territories.length).toBeGreaterThanOrEqual(1);
  });
});

describe('NFR-34 the transferred piece with an empty contact set', () => {
  /** Components of transferred pieces of the step into `round` of `seed` whose contact set is empty. */
  function emptyContactPieces(seed: number, round: number): number[][] {
    const earlier = ownersAt(seed, round - 1);
    const later = ownersAt(seed, round);
    const moved = new Set<number>();
    for (let e = 1; e < index.fills.length; e++) if (earlier[e] !== later[e]) moved.add(e);
    if (moved.size === 0) return [];
    const record = sceneAt(DEV_MAP, DEV_PRESENTATION, seed, round, REAL);
    if (!record.ok || record.value.record === undefined) throw new Error('record');
    const absorber = factionIndex.get(record.value.record.absorber)!;
    return transferredPieces(pieces, moved).filter((component) => contactSet(pieces, component, earlier, absorber).length === 0);
  }

  it('NFR-34 the first hit of the search over the seeds 1..1000 (seed, then round) is the recorded seed and round', () => {
    const total = totalRounds(DEV_MAP);
    if (!total.ok) throw new Error('total');
    let hit: { seed: number; round: number } | undefined;
    for (let seed = 1; seed <= EMPTY_CONTACT_SEEDS && hit === undefined; seed++) {
      for (let round = 1; round <= total.value && hit === undefined; round++) {
        if (emptyContactPieces(seed, round).length > 0) hit = { seed, round };
      }
    }
    console.log(`label-review-set: first transferred piece with an empty contact set: ${JSON.stringify(hit)}`);
    expect(hit).toStrictEqual({ seed: EMPTY_CONTACT.seed, round: EMPTY_CONTACT.round });
  });

  it('NFR-34 the island scene is centred on the largest such piece, which is a piece of Mecklemburgo-Pomerania Occidental', () => {
    const found = emptyContactPieces(EMPTY_CONTACT.seed, EMPTY_CONTACT.round);
    expect(found.length).toBeGreaterThanOrEqual(1);
    const size = (component: readonly number[]): number => component.reduce((sum, piece) => sum + pieces.size[piece]!, 0);
    const largest = [...found].sort((a, b) => size(b) - size(a))[0]!;
    const unit = Math.floor(EMPTY_CONTACT.point.y) * imageWidth + Math.floor(EMPTY_CONTACT.point.x);
    expect(largest).toContain(pieces.pieceOf[unit]!);
    expect(pieces.entryOf[pieces.pieceOf[unit]!]).toBe(entryOfName('Mecklemburgo-Pomerania Occidental'));
    expect(EMPTY_CONTACT.zoom).toBeGreaterThanOrEqual(8);
  });
});
