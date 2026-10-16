import { afterEach, describe, expect, it, vi } from 'vitest';
import { fontString } from '../src/core/label-params';
import { createFrameLoop } from '../src/ui/frame-loop';
import { watchMotion } from '../src/ui/motion';
import type { MediaQueryListLike } from '../src/ui/motion';
import { REFERENCE_PX, measureAspects } from '../src/ui/text-metrics';

// The parts of the viewer that drive the animation and measure text (FR-182, FR-184, FR-175, NFR-33).
// They touch the browser, so the browser pieces are replaced by fakes.

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** A fake animation frame queue: `flush` runs the callbacks queued so far and returns how many ran. */
function fakeFrames(): { flush(): number; pending(): number; requests(): number } {
  let queue: (() => void)[] = [];
  let requests = 0;
  vi.stubGlobal('requestAnimationFrame', (cb: () => void) => {
    requests++;
    queue.push(cb);
    return requests;
  });
  return {
    flush() {
      const run = queue;
      queue = [];
      for (const cb of run) cb();
      return run.length;
    },
    pending: () => queue.length,
    requests: () => requests,
  };
}

describe('FR-182 the frame loop draws one frame per display frame and keeps going while a step runs', () => {
  it('FR-182 many requests before a display frame give one frame', () => {
    const frames = fakeFrames();
    const seen: number[] = [];
    const loop = createFrameLoop((t) => {
      seen.push(t);
      return false;
    });
    loop.request();
    loop.request();
    loop.request();
    expect(frames.requests()).toBe(1);
    expect(frames.flush()).toBe(1);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toBeGreaterThanOrEqual(0);
    expect(frames.pending()).toBe(0);
  });

  it('FR-182 a frame that asks for another one gets it, until it says it is done', () => {
    const frames = fakeFrames();
    let left = 3;
    const times: number[] = [];
    const loop = createFrameLoop((t) => {
      times.push(t);
      left--;
      return left > 0;
    });
    loop.request();
    let flushed = 0;
    while (frames.pending() > 0) flushed += frames.flush();
    expect(flushed).toBe(3);
    expect(times).toHaveLength(3);
    for (let i = 1; i < times.length; i++) expect(times[i]!).toBeGreaterThanOrEqual(times[i - 1]!);
    // After the last frame a new request starts a new frame.
    loop.request();
    expect(frames.pending()).toBe(1);
  });

  it('FR-182 a request made inside a frame is not lost and does not double the frames', () => {
    const frames = fakeFrames();
    let count = 0;
    const loop = createFrameLoop(() => {
      count++;
      if (count === 1) loop.request();
      return false;
    });
    loop.request();
    frames.flush();
    expect(frames.pending()).toBe(1);
    frames.flush();
    expect(count).toBe(2);
    expect(frames.pending()).toBe(0);
  });

  it('NFR-33 the frame loop hands over the clock reading of its own clock, taken at the frame', () => {
    const frames = fakeFrames();
    const spy = vi.spyOn(performance, 'now').mockReturnValueOnce(1234.5).mockReturnValue(9999);
    const seen: number[] = [];
    createFrameLoop((t) => {
      seen.push(t);
      return false;
    }).request();
    frames.flush();
    expect(seen).toStrictEqual([1234.5]);
    expect(spy).toHaveBeenCalled();
  });
});

function fakeQuery(initial: boolean): MediaQueryListLike & { set(v: boolean): void; listeners(): number } {
  let matches = initial;
  const handlers = new Set<() => void>();
  return {
    get matches() {
      return matches;
    },
    addEventListener(_type: 'change', handler: () => void) {
      handlers.add(handler);
    },
    set(v: boolean) {
      matches = v;
      for (const h of handlers) h();
    },
    listeners: () => handlers.size,
  };
}

describe('FR-177 FR-184 the reduced-motion preference', () => {
  it('FR-177 the preference is read at every call', () => {
    const query = fakeQuery(false);
    const motion = watchMotion(() => undefined, query);
    expect(motion.reduced()).toBe(false);
    query.set(true);
    expect(motion.reduced()).toBe(true);
  });

  it('FR-184 a change of the preference is reported once per change', () => {
    const query = fakeQuery(false);
    let calls = 0;
    watchMotion(() => calls++, query);
    expect(query.listeners()).toBe(1);
    query.set(true);
    query.set(false);
    expect(calls).toBe(2);
  });

  it('FR-177 a browser that cannot answer the query means motion is allowed', () => {
    vi.stubGlobal('window', {});
    const motion = watchMotion(() => undefined);
    expect(motion.reduced()).toBe(false);
  });

  it('FR-177 the default query asks for prefers-reduced-motion: reduce', () => {
    const asked: string[] = [];
    vi.stubGlobal('window', {
      matchMedia: (q: string) => {
        asked.push(q);
        return fakeQuery(true);
      },
    });
    expect(watchMotion(() => undefined).reduced()).toBe(true);
    expect(asked).toStrictEqual(['(prefers-reduced-motion: reduce)']);
  });
});

describe('FR-175 text aspect ratios are measured once per text at the reference size', () => {
  it('FR-175 the aspect is the advance width at the reference size divided by that size', () => {
    const calls: [string, string][] = [];
    const measure = (font: string, text: string): number => {
      calls.push([font, text]);
      return text.length * 40;
    };
    const aspects = measureAspects(['Roma', 'Francia', 'Roma'], measure);
    expect(REFERENCE_PX).toBe(100);
    expect(aspects.get('Roma')).toBe(4 * 40 / REFERENCE_PX);
    expect(aspects.get('Francia')).toBe(7 * 40 / REFERENCE_PX);
    expect(aspects.size).toBe(2);
    // Once per distinct text, in the label font at the reference size.
    expect(calls).toStrictEqual([
      [fontString(REFERENCE_PX), 'Roma'],
      [fontString(REFERENCE_PX), 'Francia'],
    ]);
  });

  it('FR-175 a text the browser cannot measure gets no aspect', () => {
    const aspects = measureAspects(['a', 'b', 'c'], (_font, text) => (text === 'a' ? 0 : text === 'b' ? Number.NaN : 50));
    expect([...aspects.keys()]).toStrictEqual(['c']);
  });
});

describe('FR-193 FR-194 the address keeps a frozen transition only when it is given', () => {
  it('FR-193 FR-194 the history entry is replaced with the text as written, or without the parameter', async () => {
    const { syncAddress } = await import('../src/ui/url');
    const calls: [unknown, string, string][] = [];
    vi.stubGlobal('history', { replaceState: (s: unknown, t: string, u: string) => calls.push([s, t, u]) });
    syncAddress(1, 3, { x: 10, y: 20, scale: 2 }, '0.25');
    syncAddress(1, 3, { x: 10, y: 20, scale: 2 });
    expect(calls).toStrictEqual([
      [null, '', '?seed=1&round=3&x=10.0&y=20.0&zoom=2.000&transition=0.25'],
      [null, '', '?seed=1&round=3&x=10.0&y=20.0&zoom=2.000'],
    ]);
  });
});
