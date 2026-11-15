import { describe, expect, it } from 'vitest';
import { clearPlayer, loadHost, loadPlayer, matchLink, personalLink, readFragment, savePlayer, saveHost, type StorageLike } from '../src/core/play-token';
import source from '../src/core/play-token.ts?raw';
import { codeOnly } from './helpers/scan';

const ID = 'AbCdEfGh01234567';
const OTHER = 'ZyXwVuTs76543210';
const PLAYER = 'player:Ab3_x-9.Qz1k';
const TOKEN = 'T0kenT0kenT0kenT0kenT0kenT0ken_-';
const HOST = 'H0stH0stH0stH0stH0stH0stH0st_-ab';

function memory(): StorageLike & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
}

describe('FR-397 the personal token is kept per match in the browser storage', () => {
  it('FR-397 a saved player is loaded again for the same match and only for it', () => {
    const storage = memory();
    savePlayer(storage, ID, { playerId: PLAYER, token: TOKEN });
    expect(loadPlayer(storage, ID)).toStrictEqual({ playerId: PLAYER, token: TOKEN });
    expect(loadPlayer(storage, OTHER)).toBeUndefined();
  });

  it('FR-397 the host token is kept apart from the player token of the same match', () => {
    const storage = memory();
    saveHost(storage, ID, HOST);
    expect(loadHost(storage, ID)).toBe(HOST);
    expect(loadPlayer(storage, ID)).toBeUndefined();
    savePlayer(storage, ID, { playerId: PLAYER, token: TOKEN });
    expect(loadHost(storage, ID)).toBe(HOST);
  });

  it('FR-397 clearing removes the player of that match only', () => {
    const storage = memory();
    savePlayer(storage, ID, { playerId: PLAYER, token: TOKEN });
    savePlayer(storage, OTHER, { playerId: PLAYER, token: TOKEN });
    clearPlayer(storage, ID);
    expect(loadPlayer(storage, ID)).toBeUndefined();
    expect(loadPlayer(storage, OTHER)).toBeDefined();
  });

  it('FR-397 a stored value that is not a valid player is ignored, never trusted', () => {
    const storage = memory();
    for (const bad of ['', 'not json', '[]', '{}', JSON.stringify({ playerId: 'p1', token: TOKEN }), JSON.stringify({ playerId: PLAYER, token: 'short' }), JSON.stringify({ playerId: PLAYER, token: TOKEN, extra: 1 })]) {
      storage.data.set(`mbrg:player:${ID}`, bad);
      expect(loadPlayer(storage, ID), bad).toBeUndefined();
    }
    storage.data.set(`mbrg:host:${ID}`, 'short');
    expect(loadHost(storage, ID)).toBeUndefined();
  });

  it('FR-397 a storage that throws (private mode, quota) loads nothing and saves reports false', () => {
    const broken: StorageLike = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
      removeItem: () => {
        throw new Error('denied');
      },
    };
    expect(loadPlayer(broken, ID)).toBeUndefined();
    expect(loadHost(broken, ID)).toBeUndefined();
    expect(savePlayer(broken, ID, { playerId: PLAYER, token: TOKEN })).toBe(false);
    expect(saveHost(broken, ID, HOST)).toBe(false);
    expect(() => clearPlayer(broken, ID)).not.toThrow();
  });
});

describe('FR-397 the personal link carries the token in the fragment only', () => {
  it('FR-397 NFR-78 the personal link puts the credentials after the # and the match link has none', () => {
    const link = personalLink('https://mbrg.test/', ID, { playerId: PLAYER, token: TOKEN });
    const [beforeHash, hash] = link.split('#') as [string, string];
    expect(beforeHash).toBe(`https://mbrg.test/?match=${ID}`);
    expect(beforeHash).not.toContain(TOKEN);
    expect(hash).toContain(TOKEN);
    expect(matchLink('https://mbrg.test/', ID)).toBe(`https://mbrg.test/?match=${ID}`);
  });

  it('FR-397 the fragment of a personal link reads back as the same player', () => {
    const link = personalLink('https://mbrg.test/', ID, { playerId: PLAYER, token: TOKEN });
    expect(readFragment(`#${link.split('#')[1]}`)).toStrictEqual({ playerId: PLAYER, token: TOKEN });
  });

  it('FR-397 a fragment that is empty, partial, repeated or malformed gives no player', () => {
    for (const hash of ['', '#', `#p=${PLAYER}`, `#t=${TOKEN}`, `#p=bad&t=${TOKEN}`, `#p=${PLAYER}&t=short`, `#p=${PLAYER}&t=${TOKEN}&t=${TOKEN}`, `#p=${PLAYER}&t=${TOKEN}&x=1`, '#%E0%A4%A']) {
      expect(readFragment(hash), hash).toBeUndefined();
    }
  });

  it('NFR-78 the token module never logs, sends or builds a query with a token', () => {
    const code = codeOnly(source);
    expect(code).not.toMatch(/\b(?:console|fetch|XMLHttpRequest|sendBeacon)\b/);
  });
});
