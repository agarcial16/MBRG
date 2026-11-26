import { describe, expect, it } from 'vitest';
import { annexationBox, captureCamera, captureMarks, readCaptureAddress } from '../src/core/capture';
import { chooseScene } from '../src/core/live-address';
import { enter } from '../src/ui/enter';
import { TOUR_PARAMS } from '../src/core/tour-params';

const ID = 'AbCdEfGhIjKlMnOp';

describe('spec 038 capture address (FR-713, FR-716)', () => {
  it('FR-713 reads match, round and frame kind', () => {
    expect(readCaptureAddress(`?capture=1&match=${ID}&round=3&frame=round`)).toStrictEqual({ ok: true, request: { matchId: ID, round: 3, frame: 'round' } });
    expect(readCaptureAddress(`?capture=1&match=${ID}&round=0&frame=full`)).toStrictEqual({ ok: true, request: { matchId: ID, round: 0, frame: 'full' } });
  });

  it('FR-715 anything missing, repeated or malformed is not a request (the page then signals an error)', () => {
    const bad = [
      '?capture=1',
      `?capture=1&match=${ID}`,
      `?capture=1&match=${ID}&round=3`,
      `?capture=1&match=${ID}&round=3&frame=wide`,
      `?capture=1&match=${ID}&round=-1&frame=full`,
      `?capture=1&match=${ID}&round=1.5&frame=full`,
      `?capture=1&match=${ID}&round=1234567890&frame=full`,
      `?capture=1&match=${ID}&round=1&round=2&frame=full`,
      `?capture=1&match=short&round=1&frame=full`,
      `?capture=1&match=${ID}&match=${ID}&round=1&frame=full`,
      `?capture=2&match=${ID}&round=1&frame=full`,
    ];
    for (const search of bad) expect(readCaptureAddress(search), search).toStrictEqual({ ok: false });
  });

  it('FR-713 the scene choice: a capture address wins over every other scene, valid or not', () => {
    expect(chooseScene(`?capture=1&match=${ID}&round=2&frame=full`, false)).toStrictEqual({ kind: 'capture', request: { matchId: ID, round: 2, frame: 'full' } });
    expect(chooseScene(`?capture=1&match=${ID}&round=2&frame=full&spectate=1`, true)).toStrictEqual({ kind: 'capture', request: { matchId: ID, round: 2, frame: 'full' } });
    expect(chooseScene('?capture=1&seed=4', false)).toStrictEqual({ kind: 'capture', request: undefined });
    expect(chooseScene('?capture=1', true)).toStrictEqual({ kind: 'capture', request: undefined });
  });

  it('FR-713 the page entry opens the capture mode, never the live scene, the start screen or a message', async () => {
    const calls: string[] = [];
    const actions = {
      debug: undefined,
      live: () => calls.push('live'),
      start: () => calls.push('start'),
      message: () => calls.push('message'),
      capture: (request: unknown) => calls.push(`capture:${request === undefined ? 'none' : 'request'}`),
    };
    await enter(`?capture=1&match=${ID}&round=2&frame=round`, false, actions);
    await enter('?capture=1&match=bad', false, actions);
    expect(calls).toStrictEqual(['capture:request', 'capture:none']);
  });
});

describe('spec 038 annexation frame (FR-716, NFR-190)', () => {
  // A 10 x 6 grid of entries: entry 1 fills columns 2-3 of rows 1-2, entry 2 is a far corner pixel, entry 0 is outside.
  const width = 10;
  const height = 6;
  const cells = new Uint16Array(width * height);
  for (let y = 1; y <= 2; y++) for (let x = 2; x <= 3; x++) cells[y * width + x] = 1;
  cells[5 * width + 9] = 2;

  it('FR-716 the box holds every pixel of the wanted entries (half-open), none gives undefined', () => {
    expect(annexationBox(cells, width, height, new Set([1]))).toStrictEqual({ x0: 2, y0: 1, x1: 4, y1: 3 });
    expect(annexationBox(cells, width, height, new Set([1, 2]))).toStrictEqual({ x0: 2, y0: 1, x1: 10, y1: 6 });
    expect(annexationBox(cells, width, height, new Set([7]))).toBeUndefined();
    expect(annexationBox(cells, width, height, new Set())).toBeUndefined();
  });

  const image = { w: 2000, h: 1000 };
  const round = { width: 1600, height: 900 };

  it('FR-716 the margin is 15 % of the larger side on each side', () => {
    // Box 400 x 100 at (800..1200, 400..500): margin 60, so the frame holds 520 x 220 before the aspect fit.
    const camera = captureCamera('round', { x0: 800, y0: 400, x1: 1200, y1: 500 }, image, round);
    // The visible width in map units is 1600 / scale; the box with margins fits and the aspect is 16:9.
    const visibleW = 1600 / camera.scale;
    const visibleH = 900 / camera.scale;
    expect(visibleW / visibleH).toBeCloseTo(16 / 9, 6);
    expect(visibleW).toBeGreaterThanOrEqual(520 - 1e-6);
    expect(visibleW).toBeLessThanOrEqual(image.w * 0.2 > 520 ? image.w * 0.2 + 1e-6 : 520 * 16 / 9 + 1e-6);
  });

  it('FR-716 the frame is at least 20 % of the map width wide', () => {
    const camera = captureCamera('round', { x0: 1000, y0: 500, x1: 1010, y1: 510 }, image, round);
    expect(1600 / camera.scale).toBeCloseTo(image.w * 0.2, 6);
    expect(camera.x).toBeCloseTo(1005, 6);
    expect(camera.y).toBeCloseTo(505, 6);
  });

  it('FR-716 the frame stays inside the map bounds', () => {
    const corner = captureCamera('round', { x0: 0, y0: 0, x1: 20, y1: 20 }, image, round);
    const w = 1600 / corner.scale;
    const h = 900 / corner.scale;
    expect(corner.x - w / 2).toBeGreaterThanOrEqual(-1e-9);
    expect(corner.y - h / 2).toBeGreaterThanOrEqual(-1e-9);
    const far = captureCamera('round', { x0: 1980, y0: 980, x1: 2000, y1: 1000 }, image, round);
    expect(far.x + 1600 / far.scale / 2).toBeLessThanOrEqual(image.w + 1e-9);
    expect(far.y + 900 / far.scale / 2).toBeLessThanOrEqual(image.h + 1e-9);
  });

  it('FR-716 a frame the map aspect cannot hold is the full map', () => {
    const tall = captureCamera('round', { x0: 900, y0: 0, x1: 1100, y1: 1000 }, image, round);
    expect(tall).toStrictEqual(captureCamera('full', undefined, image, round));
    const wide = captureCamera('round', { x0: 0, y0: 100, x1: 2000, y1: 200 }, image, round);
    expect(wide).toStrictEqual(captureCamera('full', undefined, image, round));
  });

  it('FR-716 the full map is the viewer default view; no territory box also gives it', () => {
    const full = captureCamera('full', undefined, { w: 2000, h: 1000 }, { width: 2000, height: 1000 });
    expect(full).toStrictEqual({ x: 1000, y: 500, scale: 1 });
    expect(captureCamera('round', undefined, image, round)).toStrictEqual(captureCamera('full', undefined, image, round));
  });

  it('NFR-190 the same input gives the same frame', () => {
    const box = { x0: 700, y0: 300, x1: 1100, y1: 520 };
    expect(captureCamera('round', box, image, round)).toStrictEqual(captureCamera('round', box, image, round));
  });
});

describe('spec 038 marks (FR-714)', () => {
  it('FR-714 round 0 has no marks; a later round lights the absorber at the dim the reveal tours end with', () => {
    expect(captureMarks(0, 4)).toBeUndefined();
    expect(captureMarks(3, undefined)).toBeUndefined();
    expect(captureMarks(3, 4)).toStrictEqual({ lit: [4], dim: TOUR_PARAMS.dimMax });
  });
});
