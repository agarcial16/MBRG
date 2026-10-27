import { describe, expect, it, vi } from 'vitest';
import { formatLiveAddress } from '../src/core/live-address';
import { errorText } from '../src/core/live-text';
import { enter, type EnterActions } from '../src/ui/enter';
import { DEFAULT_DEV_SERVER, serverOrigin } from '../src/ui/live-config';
import { after } from '../src/ui/live-timer';
import { syncLiveAddress } from '../src/ui/live-url';
import entrySource from '../src/ui/entry.ts?raw';
import indexHtml from '../index.html?raw';
import { codeOnly, stripComments } from './helpers/scan';

const ID = 'AbCdEfGh01234567';

function actions(debug: boolean): EnterActions & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    debug: debug ? async () => void calls.push('debug') : undefined,
    live: (id) => void calls.push(`live:${id}`),
    message: (text) => void calls.push(`message:${text}`),
    start: () => void calls.push('start'),
  };
}

describe('FR-306 (entry) the page entry chooses the scene of each address', () => {
  it('FR-306 (entry) a match id in the address starts the live scene in both builds', async () => {
    for (const dev of [true, false]) {
      const a = actions(dev);
      await enter(`?match=${ID}`, dev, a);
      expect(a.calls).toStrictEqual([`live:${ID}`]);
    }
  });

  it('FR-306 (entry) a seed alone starts the debug scene in development and shows the need-match message in production', async () => {
    const dev = actions(true);
    await enter('?seed=7&round=3', true, dev);
    expect(dev.calls).toStrictEqual(['debug']);
    const none = actions(true);
    await enter('', true, none);
    expect(none.calls).toStrictEqual(['debug']);
    const seedOnly = actions(false);
    await enter('?seed=7', false, seedOnly);
    expect(seedOnly.calls).toStrictEqual([`message:${errorText('need-match')}`]);
    // Spec 010 FR-366: with no match and no seed the production page is the start screen, not a message.
    for (const search of ['', '?round=2', '?start']) {
      const prod = actions(false);
      await enter(search, false, prod);
      expect(prod.calls, search).toStrictEqual(['start']);
    }
    const dev2 = actions(true);
    await enter('?start', true, dev2);
    expect(dev2.calls).toStrictEqual(['start']);
  });

  it('FR-306 (entry) a development build without the debug action still shows the message (the action is the second guard)', async () => {
    const a = actions(false);
    await enter('?seed=1', true, a);
    expect(a.calls).toStrictEqual([`message:${errorText('need-match')}`]);
  });

  it('FR-306 (entry) both parameters, a malformed match id and a repeated match id show their messages in every build and send nothing', async () => {
    for (const dev of [true, false]) {
      const both = actions(dev);
      await enter(`?match=${ID}&seed=1`, dev, both);
      expect(both.calls).toStrictEqual([`message:${errorText('both')}`]);
      for (const search of ['?match=short', `?match=${ID}&match=${ID}`, '?match=']) {
        const bad = actions(dev);
        await enter(search, dev, bad);
        expect(bad.calls, search).toStrictEqual([`message:${errorText('bad-match')}`]);
      }
    }
  });

  it('FR-306 (entry) the debug scene is imported only behind the development constant, and nowhere else in the entry', () => {
    const code = stripComments(entrySource);
    expect(code).toMatch(/debug:\s*import\.meta\.env\.DEV\s*\?\s*\(\)\s*=>\s*import\(\s*['"]\.\/main['"]\s*\)\s*:\s*undefined/);
    expect([...codeOnly(entrySource).matchAll(/\bimport\.meta\.env\.DEV\b/g)]).toHaveLength(2);
    expect([...stripComments(entrySource).matchAll(/['"]\.\/main['"]/g)]).toHaveLength(1);
    expect(stripComments(entrySource)).not.toMatch(/^\s*import\b[^;]*['"]\.\/main['"]/m);
    // The planted bare dynamic import without the guard would not match the guarded form.
    const planted = "const x = { debug: () => import('./main') };";
    expect(planted).not.toMatch(/import\.meta\.env\.DEV\s*\?/);
  });

  it('FR-306 (entry) index.html loads the entry module, not the debug scene', () => {
    expect(indexHtml).toContain('src="/src/ui/entry.ts"');
    expect(indexHtml).not.toContain('/src/ui/main.ts');
  });
});

describe('FR-303 (shell) the server origin and the live address', () => {
  it('FR-303 (shell) the origin: the variable when set, else the local server in development and the page origin in production', () => {
    expect(DEFAULT_DEV_SERVER).toBe('http://127.0.0.1:8787');
    expect(serverOrigin({ DEV: true }, 'http://localhost:5173')).toBe('http://127.0.0.1:8787');
    expect(serverOrigin({ DEV: false }, 'https://mbrg.example')).toBe('https://mbrg.example');
    expect(serverOrigin({ DEV: false, VITE_MBRG_SERVER: 'https://api.example/' }, 'https://mbrg.example')).toBe('https://api.example');
    expect(serverOrigin({ DEV: true, VITE_MBRG_SERVER: 'http://127.0.0.1:9000' }, 'http://localhost:5173')).toBe('http://127.0.0.1:9000');
    expect(serverOrigin({ DEV: true, VITE_MBRG_SERVER: '' }, 'http://localhost:5173')).toBe('http://127.0.0.1:8787');
  });

  it('FR-303 (shell) the address is rewritten in place with replaceState: match, round and camera, never a seed', () => {
    const calls: unknown[][] = [];
    const history = { replaceState: (...args: unknown[]) => void calls.push(args) };
    syncLiveAddress(ID, 3, { x: 10.04, y: 20, scale: 1.5 }, history);
    expect(calls).toStrictEqual([[null, '', formatLiveAddress(ID, 3, { x: 10.04, y: 20, scale: 1.5 })]]);
    expect(String(calls[0]?.[2])).toBe(`?match=${ID}&round=3&x=10.0&y=20.0&zoom=1.500`);
    expect(String(calls[0]?.[2])).not.toMatch(/seed/);
  });
});

describe('FR-155 (live timers) the timer module', () => {
  it('FR-155 (live timers) after runs once at the delay and its cancel stops it', () => {
    vi.useFakeTimers();
    try {
      const fired: number[] = [];
      const cancel = after(500, () => fired.push(1));
      vi.advanceTimersByTime(499);
      expect(fired).toStrictEqual([]);
      vi.advanceTimersByTime(1);
      expect(fired).toStrictEqual([1]);
      vi.advanceTimersByTime(5000);
      expect(fired).toStrictEqual([1]);
      const cancelled = after(100, () => fired.push(2));
      cancelled();
      cancel();
      vi.advanceTimersByTime(1000);
      expect(fired).toStrictEqual([1]);
    } finally {
      vi.useRealTimers();
    }
  });
});
