import { errorReply } from '@mbrg/protocol';
import { describe, expect, it } from 'vitest';
import { submissionName, withClientNames } from '../src/core/client-name';
import type { PolicyCaller } from '../src/core/policy';

// Spec 022 decisions of the display name of a client player: pure functions of the caller class and the already-read name.

const client: PolicyCaller = { role: 'client', namespace: 'discord' };
const player: PolicyCaller = { role: 'other' };

describe('submission name decision', () => {
  it('no name: nothing to do for any caller', () => {
    expect(submissionName(client, undefined)).toStrictEqual({ action: 'none' });
    expect(submissionName(player, undefined)).toStrictEqual({ action: 'none' });
  });

  it('a client credential with a name stores it unchanged', () => {
    expect(submissionName(client, 'Ana Lopez')).toStrictEqual({ action: 'store', name: 'Ana Lopez' });
    expect(submissionName({ role: 'client', namespace: 'telegram' }, 'x')).toStrictEqual({ action: 'store', name: 'x' });
  });

  it('a player token with a name is invalid-request naming name', () => {
    expect(submissionName(player, 'Ana')).toStrictEqual({ action: 'refuse', error: errorReply('invalid-request', ['name']) });
  });
});

describe('merging names', () => {
  it('returns a new map with player names first and client names for ids not present', () => {
    const players = new Map([['player:a', 'Ana']]);
    const clients = new Map([['discord:1', 'Bea'], ['player:a', 'Other']]);
    const merged = withClientNames(players, clients);
    expect([...merged]).toStrictEqual([['player:a', 'Ana'], ['discord:1', 'Bea']]);
    expect(merged).not.toBe(players);
    expect([...players]).toStrictEqual([['player:a', 'Ana']]);
    expect([...clients]).toStrictEqual([['discord:1', 'Bea'], ['player:a', 'Other']]);
  });

  it('empty inputs give an empty map', () => {
    expect(withClientNames(new Map(), new Map()).size).toBe(0);
    expect([...withClientNames(new Map(), new Map([['discord:1', 'Bea']]))]).toStrictEqual([['discord:1', 'Bea']]);
  });
});
