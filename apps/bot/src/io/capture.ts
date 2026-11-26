// The capture service (spec 038 FR-717 to FR-726): turns a request for a map image into a screenshot of the viewer's capture mode, one at
// a time. It owns the queue (FIFO, one capture at once), the cache (32 entries, least recently used out), the lifetime of the browser (started
// for a capture, closed after 10 s with none queued) and the 20 s limit of a capture. The browser itself is a port (`BrowserDriver`): the real
// one is `capture-chrome.ts`, the tests give a fake. A request never rejects: it gives the image or `undefined` and the failure is logged.
import { CACHE_ENTRIES, CAPTURE_TIMEOUT_MS, IDLE_MS, MAX_IMAGE_BYTES, cacheKey, captureSize, captureUrl, createLru, halfSize } from '../core/capture';
import type { CaptureJob, Size } from '../core/capture';

/** One screenshot to take: the capture page, the size of the window and the time allowed to the page itself. */
export interface Shot {
  readonly url: string;
  readonly width: number;
  readonly height: number;
  readonly timeoutMs: number;
}

export interface BrowserSession {
  /** The PNG of the page once it signals "ready"; throws when it signals "error", times out or the browser fails. */
  shoot(shot: Shot): Promise<Uint8Array>;
  close(): Promise<void>;
}

export interface BrowserDriver {
  launch(): Promise<BrowserSession>;
}

export interface CaptureService {
  /** A round was received for a match: later requests may ask for it, never for a higher one (FR-719). */
  reveal(matchId: string, round: number): void;
  /** The image, or `undefined` when it cannot be had (refused, failed, over time, too big). Never rejects. */
  request(job: CaptureJob): Promise<Uint8Array | undefined>;
  /** Closes the browser and answers what is still queued with nothing. */
  close(): Promise<void>;
}

export type After = (ms: number, fn: () => void) => () => void;

export interface CaptureOptions {
  /** The viewer's base address (spec 021). */
  readonly viewerUrl: string;
  readonly driver: BrowserDriver;
  /** The pixel size of a map (its id image), read when a full map is asked for; none: that image cannot be made. */
  readonly mapSize: (mapId: string) => Promise<Size | undefined>;
  readonly after: After;
  readonly log: (code: string) => void;
  readonly timeoutMs?: number;
  readonly idleMs?: number;
  readonly cacheEntries?: number;
}

export const realAfter: After = (ms, fn) => {
  const timer = setTimeout(fn, ms);
  return () => clearTimeout(timer);
};

export function createCaptureService(options: CaptureOptions): CaptureService {
  const { driver, log } = options;
  const timeoutMs = options.timeoutMs ?? CAPTURE_TIMEOUT_MS;
  const idleMs = options.idleMs ?? IDLE_MS;
  const cache = createLru<Uint8Array>(options.cacheEntries ?? CACHE_ENTRIES);
  const revealed = new Map<string, number>();
  const sizes = new Map<string, Size>();
  let session: BrowserSession | undefined;
  let cancelIdle: (() => void) | undefined;
  let queued = 0;
  let tail: Promise<unknown> = Promise.resolve();
  let closed = false;

  async function dropBrowser(): Promise<void> {
    cancelIdle?.();
    cancelIdle = undefined;
    const old = session;
    session = undefined;
    try {
      await old?.close();
    } catch {
      // a browser that does not close is gone anyway
    }
  }

  /** FR-725: the browser closes after 10 s without a queued capture. */
  function armIdle(): void {
    cancelIdle?.();
    cancelIdle = options.after(idleMs, () => {
      cancelIdle = undefined;
      if (queued === 0) void dropBrowser();
    });
  }

  /** One screenshot within the time limit; a late or failed one closes the browser (a hung page must not be reused). */
  async function shoot(url: string, size: Size): Promise<Uint8Array | undefined> {
    let cancel: (() => void) | undefined;
    const limit = new Promise<'timeout'>((resolve) => {
      cancel = options.after(timeoutMs, () => resolve('timeout'));
    });
    try {
      if (session === undefined) {
        const launching = driver.launch();
        const got = await Promise.race([launching, limit]);
        if (got === 'timeout') {
          // The browser that starts too late is closed as soon as it is there.
          void launching.then((late) => late.close(), () => undefined);
          log('capture-timeout');
          return undefined;
        }
        session = got;
      }
      const taken = await Promise.race([session.shoot({ url, width: size.width, height: size.height, timeoutMs }), limit]);
      if (taken === 'timeout') {
        log('capture-timeout');
        await dropBrowser();
        return undefined;
      }
      return taken;
    } catch {
      log('capture-failed');
      await dropBrowser();
      return undefined;
    } finally {
      cancel?.();
    }
  }

  async function run(job: CaptureJob): Promise<Uint8Array | undefined> {
    const key = cacheKey(job);
    const known = cache.get(key);
    if (known !== undefined) return known;
    if (closed) return undefined;
    const url = captureUrl(options.viewerUrl, job);
    let map: Size | undefined;
    if (job.frame === 'full') {
      map = sizes.get(job.mapId) ?? (await options.mapSize(job.mapId));
      if (map !== undefined) sizes.set(job.mapId, map);
    }
    const size = captureSize(job.frame, map);
    if (url === undefined || size === undefined) {
      log('capture-failed');
      return undefined;
    }
    cancelIdle?.();
    cancelIdle = undefined;
    let image = await shoot(url, size);
    // FR-723: a file over Discord's limit is taken again at half size once, else it is a failure.
    if (image !== undefined && image.length > MAX_IMAGE_BYTES) {
      image = await shoot(url, halfSize(size));
      if (image !== undefined && image.length > MAX_IMAGE_BYTES) {
        log('capture-oversize');
        image = undefined;
      }
    }
    if (image !== undefined) cache.set(key, image);
    return image;
  }

  return {
    reveal(matchId, round) {
      if (round > (revealed.get(matchId) ?? -1)) revealed.set(matchId, round);
    },
    request(job) {
      // FR-719: never a round above the last one received for the match. Round 0 (the starting map) is always revealed.
      if (job.round < 0 || job.round > Math.max(revealed.get(job.matchId) ?? 0, 0)) {
        log('capture-refused');
        return Promise.resolve(undefined);
      }
      queued += 1;
      cancelIdle?.();
      cancelIdle = undefined;
      const turn = tail.then(() => run(job)).catch(() => undefined);
      tail = turn.finally(() => {
        queued -= 1;
        if (queued === 0 && session !== undefined) armIdle();
      });
      return turn;
    },
    async close() {
      closed = true;
      await dropBrowser();
    },
  };
}
