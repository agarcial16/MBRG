// REGRESSION PINS of the tour frames (spec 009 NFR-59, plan 4.1 to 4.3 aside): the frame digests are written by the
// code under test (`apps/web/src`), so they pin today's behaviour; they are not independent values. Shared by
// `tour-golden.test.ts` and the hand-run `golden/generate-tour-frame-pins.ts`.
import { getState } from '@mbrg/sim';
import type { MapData } from '@mbrg/shared';
import { clampCamera, fitScale } from '../../src/core/camera';
import type { Camera } from '../../src/core/camera';
import { buildEntryIndex, factionIndexOf, ownerTable } from '../../src/core/entries';
import { factionBoxes } from '../../src/core/label-layout';
import { LABEL_PARAMS } from '../../src/core/label-params';
import { buildPieceIndex } from '../../src/core/regions';
import { buildTour } from '../../src/core/tour';
import type { Tour } from '../../src/core/tour';
import { framingBoxOf } from '../../src/core/tour-camera';
import type { Box } from '../../src/core/tour-camera';
import { frameDigest } from '../../src/core/tour-digest';
import { tourFrame } from '../../src/core/tour-frame';
import { fnv1a32, keyText } from '../../src/core/tour-key';
import { compactJson } from '../golden/tours-model';
import type { GoldenRound } from '../golden/tours-model';

export const PIN_AREA = { width: 1920, height: 1080 };
/** Every living faction gets this label aspect (no text is measured in Node): the framing boxes are the label-set boxes. */
export const PIN_ASPECT = 4;

export interface IdPng {
  width: number;
  height: number;
  values: ArrayLike<number>;
}

/** The instants of the pins: 0, 400, 1,000, tau_H - 1, tau_H, tau_H + 800, D - 1, D. */
export function pinInstants(tour: Tour): number[] {
  const tauH = tour.at[tour.at.length - 1]!;
  return [0, 400, 1000, tauH - 1, tauH, tauH + 800, tour.end - 1, tour.end];
}

export interface PinnedTour {
  instants: number[];
  digests: string[];
}

export interface PinnedRound {
  round: number;
  victim: PinnedTour;
  absorber: PinnedTour | null;
}

/** The two tours of a round over faction indices, with the framing boxes of the state at round - 1. */
export function toursOfRound(map: MapData, png: IdPng, round: GoldenRound): { victim: Tour; absorber: Tour | null; start: Camera } {
  const index = buildEntryIndex(map, png.width, png.height, png.values);
  const factionIndex = factionIndexOf(map);
  const state = getState(map, 1, round.round - 1);
  if (!state.ok) throw new Error('state');
  const table = ownerTable(index, new Map(state.value.owners), factionIndex);
  const aspects = new Map([...factionIndex.values()].map((f) => [f, PIN_ASPECT] as [number, number]));
  const boxes = factionBoxes(buildPieceIndex(index), table, aspects, LABEL_PARAMS);
  const idx = (f: number): number => factionIndex.get(f)!;
  const boxesOf = (ids: readonly number[]): Map<number, Box> => {
    const out = new Map<number, Box>();
    for (const id of ids) {
      const box = framingBoxOf(boxes, table, [idx(id)]);
      if (box !== undefined) out.set(idx(id), box);
    }
    return out;
  };
  const image = { w: png.width, h: png.height };
  const victim = buildTour({
    kind: 'victim',
    result: idx(round.victim),
    set: round.participants.map(idx),
    sigma: fnv1a32(keyText('debug', round.round, 'victim')),
    boxes: boxesOf(round.participants),
  });
  const absorber =
    round.candidates.length >= 2
      ? buildTour({
          kind: 'absorber',
          result: idx(round.absorber),
          victim: idx(round.victim),
          set: round.candidates.map(idx),
          sigma: fnv1a32(keyText('debug', round.round, 'absorber')),
          boxes: boxesOf([round.victim, ...round.candidates]),
        })
      : null;
  const start = clampCamera({ x: image.w * 0.3, y: image.h * 0.4, scale: 2.5 * fitScale(image, PIN_AREA) }, image, PIN_AREA);
  return { victim, absorber, start };
}

function pinsOf(tour: Tour, image: { w: number; h: number }, start: Camera): PinnedTour {
  const instants = pinInstants(tour);
  return { instants, digests: instants.map((t) => frameDigest(tourFrame(tour, t, { area: PIN_AREA, image, start, taken: false }))) };
}

export function pinnedRound(map: MapData, png: IdPng, round: GoldenRound): PinnedRound {
  const { victim, absorber, start } = toursOfRound(map, png, round);
  const image = { w: png.width, h: png.height };
  return { round: round.round, victim: pinsOf(victim, image, start), absorber: absorber === null ? null : pinsOf(absorber, image, start) };
}

/** The text of `tour-frame-pins.json`. */
export function framePinsText(map: MapData, png: IdPng, rounds: readonly GoldenRound[]): string {
  const doc = {
    note:
      'REGRESSION PINS of spec 009 (NFR-59), not independent values: the frame digests (fnv1a32 of frameText, apps/web/src/core/tour-digest.ts) are written by the code under test, tour-frame-pins.json by generate-tour-frame-pins.ts. Dev map, debug seed 1, debug keys, drawing area 1920 x 1080, start camera at 2.5 fit scale around (0.3 w, 0.4 h), camera not taken by the user, every living faction with label aspect 4 (no text is measured in Node). A change of any digest is a change of the drawn tours: review it, then regenerate.',
    area: PIN_AREA,
    aspect: PIN_ASPECT,
    rounds: rounds.map((r) => pinnedRound(map, png, r)),
  };
  return compactJson(doc) + '\n';
}
