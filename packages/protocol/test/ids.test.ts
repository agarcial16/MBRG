import { describe, expect, it } from 'vitest';
import { PLAYER_NAMESPACE, isLocalId, isMapId, isNamespace, isPlayerId, playerIdOf } from '../src/index';

describe('identifier text rules', () => {
  it('FR-297 a local id is 1 to 64 characters of A-Z a-z 0-9 _ - .', () => {
    for (const ok of ['a', 'Z', '0', '_', '-', '.', 'Ab9_-.x', 'x'.repeat(64)]) expect(isLocalId(ok), ok).toBe(true);
    for (const bad of ['', 'x'.repeat(65), 'a b', 'a/b', 'é', 'a\n', '\na', 'discord:1', 'a:b', ':', 'a\u0000']) {
      expect(isLocalId(bad), JSON.stringify(bad)).toBe(false);
    }
    for (const notText of [1, null, undefined, {}, [], true]) expect(isLocalId(notText)).toBe(false);
  });

  it('FR-297 the namespace separator is not a local id character', () => {
    expect(isLocalId('discord:1')).toBe(false);
    expect(isLocalId('1:')).toBe(false);
  });

  it('FR-297 map ids are 1 to 64 characters of a-z 0-9 -', () => {
    for (const ok of ['dev', 'a-b-1', '0', 'x'.repeat(64)]) expect(isMapId(ok), ok).toBe(true);
    for (const bad of ['', 'Dev', 'a_b', 'a.b', 'x'.repeat(65), 'a b', 'a\n', 7, null]) expect(isMapId(bad), String(bad)).toBe(false);
  });

  it('P40 namespaces are 1 to 16 characters of a-z 0-9', () => {
    for (const ok of ['web', 'd', 'bot9', 'a'.repeat(16)]) expect(isNamespace(ok), ok).toBe(true);
    for (const bad of ['', 'a'.repeat(17), 'Web', 'a-b', 'a_b', 'a:b', 'a.b', 'a\n', 3]) expect(isNamespace(bad), String(bad)).toBe(false);
  });

  it('P31 the player id is the credential namespace, a colon and the local id', () => {
    expect(playerIdOf('web', 'Ana_1')).toBe('web:Ana_1');
    expect(() => playerIdOf('Web', 'a')).toThrow();
    expect(() => playerIdOf('web', 'a:b')).toThrow();
  });

  it('FR-384 the player namespace is player and a joined player id is player:<local id>', () => {
    expect(PLAYER_NAMESPACE).toBe('player');
    expect(isNamespace(PLAYER_NAMESPACE)).toBe(true);
    expect(playerIdOf(PLAYER_NAMESPACE, 'Ab3_x-9.Qz1k')).toBe('player:Ab3_x-9.Qz1k');
    expect(isPlayerId('player:Ab3_x-9.Qz1k')).toBe(true);
    expect(isPlayerId('player:' + 'x'.repeat(12))).toBe(true);
    for (const bad of ['player', 'player:', ':abc', 'player:a:b', 'Player:abc', 'player:a b']) expect(isPlayerId(bad), bad).toBe(false);
  });
});
