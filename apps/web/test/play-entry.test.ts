import { describe, expect, it } from 'vitest';
import { adoptFragment, loadPlayer, type StorageLike } from '../src/core/play-token';
import { entryScreen } from '../src/core/play-entry';

const ID = 'AbCdEfGh01234567';
const PLAYER = 'player:Ab3_x-9.Qz1k';
const TOKEN = 'T0kenT0kenT0kenT0kenT0kenT0ken_-';

function memory(): StorageLike {
  const data = new Map<string, string>();
  return { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v), removeItem: (k) => void data.delete(k) };
}

describe('FR-396 FR-397 FR-398 which screen a match link opens', () => {
  it('FR-396 no stored player: the join screen in a lobby and in a running match', () => {
    expect(entryScreen('lobby', false)).toBe('join');
    expect(entryScreen('running', false)).toBe('join');
  });

  it('FR-397 a stored player resumes: the lobby while waiting, the match once it runs', () => {
    expect(entryScreen('lobby', true)).toBe('lobby');
    expect(entryScreen('running', true)).toBe('match');
  });

  it('FR-396 a finished match and an expired lobby never offer a name field', () => {
    expect(entryScreen('ended', false)).toBe('closed-ended');
    expect(entryScreen('expired', false)).toBe('closed-expired');
  });

  it('FR-397 a stored player of a finished match still watches it, and of an expired lobby sees the plain state', () => {
    expect(entryScreen('ended', true)).toBe('match');
    expect(entryScreen('expired', true)).toBe('closed-expired');
  });
});

describe('FR-397 a personal link restores the player in another browser', () => {
  it('FR-397 a valid fragment is stored for the match and reported adopted', () => {
    const storage = memory();
    expect(adoptFragment(storage, ID, `#p=${encodeURIComponent(PLAYER)}&t=${TOKEN}`)).toBe(true);
    expect(loadPlayer(storage, ID)).toStrictEqual({ playerId: PLAYER, token: TOKEN });
  });

  it('FR-397 a missing or malformed fragment stores nothing and leaves an existing player alone', () => {
    const storage = memory();
    expect(adoptFragment(storage, ID, '')).toBe(false);
    expect(adoptFragment(storage, ID, '#t=x')).toBe(false);
    expect(loadPlayer(storage, ID)).toBeUndefined();
  });
});
