// Capture mode (spec 038 FR-713 to FR-716): the viewer drawn for a screenshot taken by the bot, with no interface. Pure: the address,
// the annexation frame and the marks are functions of their inputs, so the same (match, round, frame kind) always gives the same framing (NFR-190).
import { initialCamera } from './camera';
import type { Camera, ImageSize, Viewport } from './camera';
import type { PieceIndex } from './regions';
import type { Box } from './tour-camera';
import { TOUR_PARAMS } from './tour-params';

/** What a capture shows: the whole map, or the annexation of the round (FR-716). */
export type CaptureFrame = 'full' | 'round';

export interface CaptureRequest {
  readonly matchId: string;
  readonly round: number;
  readonly frame: CaptureFrame;
}

export type CaptureAddress = { readonly ok: true; readonly request: CaptureRequest } | { readonly ok: false };

const MATCH_ID = /^[A-Za-z0-9_-]{16}$/;
const DIGITS = /^[0-9]{1,9}$/;

/** The one value of a parameter written once, or undefined when it is absent or repeated. */
function single(params: URLSearchParams, name: string): string | undefined {
  const all = params.getAll(name);
  return all.length === 1 ? all[0] : undefined;
}

/** Reads `?capture=1&match=<id>&round=<k>&frame=full|round`. Anything else is not a request: the page then signals an error (FR-715). */
export function readCaptureAddress(search: string): CaptureAddress {
  const params = new URLSearchParams(search);
  const matchId = single(params, 'match');
  const round = single(params, 'round');
  const frame = single(params, 'frame');
  if (single(params, 'capture') !== '1' || matchId === undefined || !MATCH_ID.test(matchId)) return { ok: false };
  if (round === undefined || !DIGITS.test(round)) return { ok: false };
  if (frame !== 'full' && frame !== 'round') return { ok: false };
  return { ok: true, request: { matchId, round: Number(round), frame } };
}

/** FR-716: the share of the larger side of the annexation kept as a margin on each side, and the least width of a frame as a share of the map's. */
export const CAPTURE_MARGIN = 0.15;
export const CAPTURE_MIN_WIDTH = 0.2;

/**
 * The smallest half-open rectangle holding every pixel of the wanted entries (entry indices of the dense index), or undefined when
 * none of them has a pixel. One pass over the index image.
 */
export function annexationBox(cells: ArrayLike<number>, width: number, height: number, wanted: ReadonlySet<number>): Box | undefined {
  let x0 = width;
  let y0 = height;
  let x1 = -1;
  let y1 = -1;
  if (wanted.size === 0) return undefined;
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      if (!wanted.has(cells[row + x]!)) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      y1 = y;
    }
  }
  return x1 < 0 ? undefined : { x0, y0, x1: x1 + 1, y1: y1 + 1 };
}

/** Spec 039 FR-732: pieces below this share of total absorber area and farther than `OUTLIER_DISTANCE_FACTOR` times the main span are excluded from round-capture framing. */
export const OUTLIER_AREA_SHARE = 0.02;
export const OUTLIER_DISTANCE_FACTOR = 1.5;
const OUTLIER_MIN_REF_SPAN = 200;

/**
 * Half-open bounding box of the significant (non-outlier) pieces of `wanted` entries (spec 039 FR-732, FR-733).
 * Always keeps the largest piece; also keeps every piece whose area is at least 2% of total wanted area or that
 * lies within 1.5x of the main piece's span. When all pieces are small and comparable in size (island-only faction),
 * the area-share rule naturally retains them so the box is never empty.
 */
export function mainAnnexationBox(pieces: PieceIndex, wanted: ReadonlySet<number>): Box | undefined {
  if (wanted.size === 0) return undefined;
  const list: number[] = [];
  let totalArea = 0;
  let mainP = -1;
  for (let p = 0; p < pieces.entryOf.length; p++) {
    if (!wanted.has(pieces.entryOf[p]!)) continue;
    list.push(p);
    const area = pieces.size[p]!;
    totalArea += area;
    if (mainP === -1 || area > pieces.size[mainP]! || (area === pieces.size[mainP] && pieces.first[p]! < pieces.first[mainP]!)) {
      mainP = p;
    }
  }
  if (mainP === -1) return undefined;

  const mb = mainP * 4;
  const mx0 = pieces.box[mb]!;
  const my0 = pieces.box[mb + 1]!;
  const mx1 = pieces.box[mb + 2]! + 1;
  const my1 = pieces.box[mb + 3]! + 1;
  const maxDist = OUTLIER_DISTANCE_FACTOR * Math.max(mx1 - mx0, my1 - my0, OUTLIER_MIN_REF_SPAN);
  const maxDistSq = maxDist * maxDist;
  const minArea = totalArea * OUTLIER_AREA_SHARE;

  let x0 = mx0;
  let y0 = my0;
  let x1 = mx1;
  let y1 = my1;

  for (const p of list) {
    if (p === mainP) continue;
    const b = p * 4;
    const px0 = pieces.box[b]!;
    const py0 = pieces.box[b + 1]!;
    const px1 = pieces.box[b + 2]! + 1;
    const py1 = pieces.box[b + 3]! + 1;
    const significant = pieces.size[p]! >= minArea;
    if (!significant) {
      const dx = Math.max(0, Math.max(mx0 - px1, px0 - mx1));
      const dy = Math.max(0, Math.max(my0 - py1, py0 - my1));
      if (dx * dx + dy * dy > maxDistSq) continue;
    }
    if (px0 < x0) x0 = px0;
    if (py0 < y0) y0 = py0;
    if (px1 > x1) x1 = px1;
    if (py1 > y1) y1 = py1;
  }

  return { x0, y0, x1, y1 };
}

/**
 * The camera of a capture for a drawing area (CSS pixels, no inset). The full map is the viewer's default view. The round frame is the
 * annexation `box` widened by 15 % of its larger side on each side, at least 20 % of the map width wide, grown to the aspect of the
 * area and moved to stay inside the map; a frame the map cannot hold at that aspect is the full map.
 */
export function captureCamera(frame: CaptureFrame, box: Box | undefined, image: ImageSize, area: Viewport): Camera {
  const full = initialCamera(image, area);
  if (frame === 'full' || box === undefined) return full;
  const w = box.x1 - box.x0;
  const h = box.y1 - box.y0;
  const margin = CAPTURE_MARGIN * Math.max(w, h);
  const aspect = area.width / area.height;
  const wide = Math.max(w + 2 * margin, CAPTURE_MIN_WIDTH * image.w, (h + 2 * margin) * aspect);
  const high = wide / aspect;
  if (wide >= image.w || high >= image.h) return full;
  const x = Math.min(Math.max((box.x0 + box.x1) / 2, wide / 2), image.w - wide / 2);
  const y = Math.min(Math.max((box.y0 + box.y1) / 2, high / 2), image.h - high / 2);
  return { x, y, scale: area.width / wide };
}

/** What a capture of a round marks, as the reveal tours end: the absorber lit (its land now holds the victim's) and the rest dimmed. Round 0 has none. */
export function captureMarks(round: number, absorber: number | undefined): { readonly lit: readonly number[]; readonly dim: number } | undefined {
  if (round < 1 || absorber === undefined) return undefined;
  return { lit: [absorber], dim: TOUR_PARAMS.dimMax };
}
