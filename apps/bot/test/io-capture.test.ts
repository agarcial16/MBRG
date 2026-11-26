import { describe, expect, it } from 'vitest';
import { createCaptureService } from '../src/io/capture';
import type { CaptureService } from '../src/io/capture';
import type { CaptureJob } from '../src/core/capture';
import { fakeDriver, fakeTimers } from './helpers/fake-capture';
import type { FakeDriver, FakeTimers } from './helpers/fake-capture';

const MATCH = 'AbCdEfGhIjKlMnOp';
const job = (round: number, frame: CaptureJob['frame'] = 'round', matchId = MATCH): CaptureJob => ({ matchId, mapId: 'world', round, frame });

function setup(over: { cacheEntries?: number } = {}): { service: CaptureService; driver: FakeDriver; timers: FakeTimers; logs: string[]; mapReads: string[] } {
  const driver = fakeDriver();
  const timers = fakeTimers();
  const logs: string[] = [];
  const mapReads: string[] = [];
  const service = createCaptureService({
    viewerUrl: 'https://viewer.example/',
    driver,
    mapSize: async (mapId) => {
      mapReads.push(mapId);
      return { width: 4096, height: 2179 };
    },
    after: timers.after,
    log: (code) => logs.push(code),
    ...over,
  });
  service.reveal(MATCH, 40);
  return { service, driver, timers, logs, mapReads };
}

describe('spec 038 capture service (FR-717 to FR-726)', () => {
  it('FR-723 a round image is shot at 1600 x 900 from the capture address of its match, round and kind', async () => {
    const { service, driver } = setup();
    const image = await service.request(job(3));
    expect(image?.length).toBe(100);
    expect(driver.shots).toStrictEqual([{ url: `https://viewer.example/?capture=1&match=${MATCH}&round=3&frame=round`, width: 1600, height: 900, timeoutMs: 20_000 }]);
  });

  it('FR-723 the full map is shot at the map aspect with its longer side at most 4096, the size read once per map', async () => {
    const { service, driver, mapReads } = setup();
    await service.request(job(3, 'full'));
    await service.request(job(4, 'full'));
    expect(driver.shots.map((s) => [s.width, s.height])).toStrictEqual([[4096, 2179], [4096, 2179]]);
    expect(mapReads).toStrictEqual(['world']);
  });

  it('FR-723 a full map whose size cannot be read is a failure, logged', async () => {
    const driver = fakeDriver();
    const logs: string[] = [];
    const service = createCaptureService({ viewerUrl: 'https://v.example/', driver, mapSize: async () => undefined, after: fakeTimers().after, log: (c) => logs.push(c) });
    expect(await service.request(job(0, 'full'))).toBeUndefined();
    expect(driver.shots).toHaveLength(0);
    expect(logs).toStrictEqual(['capture-failed']);
  });

  it('FR-719 NFR-187 a round above the last revealed one is refused: no browser, no shot', async () => {
    const { service, driver, logs } = setup();
    expect(await service.request(job(41))).toBeUndefined();
    expect(await service.request(job(500, 'full'))).toBeUndefined();
    expect(driver.launches).toBe(0);
    expect(driver.shots).toHaveLength(0);
    expect(logs).toStrictEqual(['capture-refused', 'capture-refused']);
    // the last revealed round itself and any earlier one are allowed
    expect(await service.request(job(40))).toBeDefined();
    expect(await service.request(job(0, 'full'))).toBeDefined();
  });

  it('FR-719 the revealed round of one match says nothing of another match; it only ever rises', async () => {
    const { service, driver } = setup();
    expect(await service.request(job(1, 'round', 'ZyXwVuTsRqPoNmLk'))).toBeUndefined(); // nothing is revealed there: only round 0
    expect(await service.request(job(0, 'round', 'ZyXwVuTsRqPoNmLk'))).toBeDefined();
    service.reveal(MATCH, 10);
    expect(await service.request(job(40))).toBeDefined(); // 40 was revealed first, 10 does not lower it
    expect(driver.shots.length).toBeGreaterThan(0);
  });

  it('FR-724 a cached image is served with no new capture; the key is match, round and kind', async () => {
    const { service, driver } = setup();
    const first = await service.request(job(5));
    const again = await service.request(job(5));
    expect(again).toBe(first);
    expect(driver.shots).toHaveLength(1);
    await service.request(job(5, 'full'));
    expect(driver.shots).toHaveLength(2);
  });

  it('FR-724 at most 32 entries, the least recently used out', async () => {
    const { service, driver } = setup();
    for (let round = 0; round < 32; round += 1) await service.request(job(round));
    expect(driver.shots).toHaveLength(32);
    await service.request(job(0)); // renews round 0
    await service.request(job(32)); // the 33rd entry drops round 1, the least recent
    expect(driver.shots).toHaveLength(33);
    await service.request(job(0));
    expect(driver.shots).toHaveLength(33);
    await service.request(job(1));
    expect(driver.shots).toHaveLength(34);
  });

  it('FR-725 one capture at a time, in order of request', async () => {
    const { service, driver } = setup();
    const order: number[] = [];
    const all = [4, 2, 9, 1].map((round) => service.request(job(round)).then(() => order.push(round)));
    await Promise.all(all);
    expect(driver.peak).toBe(1);
    expect(order).toStrictEqual([4, 2, 9, 1]);
    expect(driver.shots.map((s) => new URL(s.url).searchParams.get('round'))).toStrictEqual(['4', '2', '9', '1']);
  });

  it('FR-725 the browser starts for a capture, stays for the next ones and closes after 10 s without one queued', async () => {
    const { service, driver, timers } = setup();
    expect(driver.launches).toBe(0);
    await service.request(job(1));
    await service.request(job(2));
    expect(driver.launches).toBe(1);
    expect(driver.closes).toBe(0);
    expect(timers.pending()).toStrictEqual([10_000]);
    timers.fireUpTo(10_000);
    await Promise.resolve();
    expect(driver.closes).toBe(1);
    await service.request(job(3));
    expect(driver.launches).toBe(2);
  });

  it('NFR-188 a capture that arrives before the 10 s are up cancels the close', async () => {
    const { service, driver, timers } = setup();
    await service.request(job(1));
    expect(timers.pending()).toStrictEqual([10_000]);
    const next = service.request(job(2));
    expect(timers.pending()).not.toContain(10_000); // cancelled when the capture starts
    await next;
    expect(driver.closes).toBe(0);
    expect(timers.pending()).toStrictEqual([10_000]);
  });

  it('NFR-188 a request served from the cache leaves no browser behind and starts none', async () => {
    const { service, driver } = setup();
    await service.request(job(1));
    const launched = driver.launches;
    await service.request(job(1));
    expect(driver.launches).toBe(launched);
  });

  it('FR-718 a capture over 20 s is a failure: logged, the browser is closed, the next capture starts a fresh one', async () => {
    const { service, driver, timers, logs } = setup();
    driver.behave = (_shot, n) => (n === 1 ? 'hang' : { bytes: 10 });
    const stuck = service.request(job(1));
    for (let i = 0; i < 5; i += 1) await Promise.resolve();
    timers.fireUpTo(20_000);
    expect(await stuck).toBeUndefined();
    expect(logs).toStrictEqual(['capture-timeout']);
    expect(driver.closes).toBe(1);
    expect(await service.request(job(2))).toBeDefined();
    expect(driver.launches).toBe(2);
  });

  it('FR-718 a failed page, a browser that does not start: no image, logged, nothing thrown', async () => {
    const { service, driver, logs } = setup();
    driver.behave = () => 'fail';
    expect(await service.request(job(1))).toBeUndefined();
    driver.failLaunch = true;
    expect(await service.request(job(2))).toBeUndefined();
    expect(logs).toStrictEqual(['capture-failed', 'capture-failed']);
  });

  it('FR-723 a file over 10 MB is taken again at half size once; the half-size file is served and cached', async () => {
    const { service, driver } = setup();
    driver.behave = (shot) => ({ bytes: shot.width > 3000 ? 11 * 1024 * 1024 : 5 * 1024 * 1024 });
    const image = await service.request(job(2, 'full'));
    expect(image?.length).toBe(5 * 1024 * 1024);
    expect(driver.shots.map((s) => [s.width, s.height])).toStrictEqual([[4096, 2179], [2048, 1089]]);
    await service.request(job(2, 'full'));
    expect(driver.shots).toHaveLength(2);
  });

  it('FR-723 still over 10 MB at half size: dropped as a failure, never cached', async () => {
    const { service, driver, logs } = setup();
    driver.behave = () => ({ bytes: 11 * 1024 * 1024 });
    expect(await service.request(job(2))).toBeUndefined();
    expect(driver.shots).toHaveLength(2);
    expect(logs).toStrictEqual(['capture-oversize']);
    expect(await service.request(job(2))).toBeUndefined();
    expect(driver.shots).toHaveLength(4);
  });

  it('NFR-191 nothing but the match, the round and the kind reaches the browser address or a log line', async () => {
    const { service, driver, logs } = setup();
    await service.request(job(3));
    const url = new URL(driver.shots[0]!.url);
    expect([...url.searchParams.keys()].sort()).toStrictEqual(['capture', 'frame', 'match', 'round']);
    expect(logs).toStrictEqual([]);
  });

  it('after close() no request starts a browser', async () => {
    const { service, driver } = setup();
    await service.request(job(1));
    await service.close();
    expect(driver.closes).toBe(1);
    expect(await service.request(job(2))).toBeUndefined();
    expect(driver.launches).toBe(1);
  });
});
